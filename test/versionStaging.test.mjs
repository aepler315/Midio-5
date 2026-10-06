import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { stageVersions } from '../tools/stage-versions.mjs';
import { adaptVersion, defineAdapterProfile } from '../tools/lib/version-adapters.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'midio-versions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'repo');
  await fs.mkdir(path.join(source, 'src/ui'), { recursive: true });
  await fs.mkdir(path.join(source, 'soundfonts'), { recursive: true });
  for (const [file, body] of Object.entries({ 'index.html': '<html><body></body></html>', 'CNAME': 'example.test', 'src/main.js': 'export const boot = true;\n', 'soundfonts/tone.bin': 'original', 'private.txt': 'secret' })) await fs.writeFile(path.join(source, file), body);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('-c','user.email=fixture@example.test','-c','user.name=Fixture','commit','-qm','source');
  const sha = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(source, 'index.html'), '<html><body>working tree<script id="midio-version-metadata" type="application/json">{"currentId":"live","liveId":"live","siteRootRelative":"./","archivesAvailable":false}</script></body></html>');
  const checkpoints = [{ id:'old', label:'Old', sourceSha:sha, sourcePr:1 }, { id:'live', label:'Live', sourceSha:sha, sourcePr:2 }];
  const profile = defineAdapterProfile({ sourceSha:sha, expectedHashes:{'index.html':hash('<html><body></body></html>'),'src/main.js':hash('export const boot = true;\n')}, patches:[] });
  return { root, source, output:path.join(root,'site'), sha, checkpoints, profiles:new Map([[sha,profile]]) };
}
test('pinned extraction publishes allowlisted original files and trusted subpath metadata', async (t) => {
  const f = await fixture(t);
  const report = await stageVersions({ sourceDir:f.source, outputDir:f.output, checkpoints:f.checkpoints, liveId:'live', adapterProfiles:f.profiles, sharedFiles:[] });
  assert.equal(await fs.readFile(path.join(f.output,'versions/old/soundfonts/tone.bin'),'utf8'),'original');
  await assert.rejects(fs.access(path.join(f.output,'versions/old/private.txt')));
  await assert.rejects(fs.access(path.join(f.output,'versions/old/CNAME')));
  assert.equal(await fs.readFile(path.join(f.output,'CNAME'),'utf8'),'example.test');
  const manifest=JSON.parse(await fs.readFile(path.join(f.output,'versions/manifest.json'),'utf8'));
  assert.equal(manifest.entries[0].entryPath,'versions/old/');
  assert.equal(manifest.entries[1].entryPath,'./');
  assert.match(await fs.readFile(path.join(f.output,'versions/old/index.html'),'utf8'), /siteRootRelative.*\.\.\/\.\.\//);
  for (const entry of manifest.entries) {
    const html = await fs.readFile(path.join(f.output, entry.entryPath, 'index.html'), 'utf8');
    const metadata = JSON.parse(html.match(/<script id="midio-version-metadata" type="application\/json">(.*?)<\/script>/)[1]);
    assert.equal(metadata.archivesAvailable, true, `${entry.id} can load the staged manifest`);
    const recorded = report.entries.find(e => e.id === entry.id).files.find(e => e.path === 'index.html');
    assert.equal(recorded.outputHash, hash(html));
  }
  const liveHtml=report.entries[1].files.find(x=>x.path==='index.html');
  assert.notEqual(liveHtml.sourceHash,liveHtml.outputHash);
  const unchanged=report.entries[0].files.find(x=>x.path==='soundfonts/tone.bin');
  assert.equal(unchanged.sourceHash,unchanged.outputHash);
});
test('missing commits and unrecognized adapter hashes fail closed', async (t) => {
  const f=await fixture(t);
  await assert.rejects(stageVersions({...f,sourceDir:f.source,outputDir:f.output,liveId:'live',checkpoints:[{...f.checkpoints[0],sourceSha:'f'.repeat(40)},f.checkpoints[1]],sharedFiles:[]}), /commit|object/i);
  const files=new Map([['index.html',Buffer.from('changed')],['src/main.js',Buffer.from('export const boot = true;\n')]]);
  assert.throws(()=>adaptVersion({sourceSha:f.sha,files,checkpointId:'old',siteRootRelative:'../../',profiles:f.profiles}), /hash|mismatch/i);
});
test('staging rejects destructive paths, unsafe checkpoint IDs and invalid budgets before cleanup', async (t) => {
  const f=await fixture(t);
  for(const outputDir of [f.source,path.join(f.source,'src'),f.root]) await assert.rejects(stageVersions({sourceDir:f.source,outputDir,checkpoints:f.checkpoints,liveId:'live',adapterProfiles:f.profiles,sharedFiles:[]}), /source|_site/i);
  await assert.rejects(stageVersions({sourceDir:f.source,outputDir:f.output,checkpoints:[{...f.checkpoints[0],id:'../escape'},f.checkpoints[1]],liveId:'live'}), /checkpoint|id/i);
  for(const budgetBytes of [0,-1,NaN,Infinity,838860801]) await assert.rejects(stageVersions({sourceDir:f.source,outputDir:f.output,checkpoints:f.checkpoints,liveId:'live',budgetBytes}), /budget/i);
});
test('git symlinks are rejected instead of publishing external content', async(t)=>{
 const f=await fixture(t); await fs.symlink('/etc/passwd',path.join(f.source,'src/leak.js')); const git=(...args)=>execFileSync('git',['-C',f.source,...args],{encoding:'utf8'}).trim();git('add','src/leak.js');git('-c','user.email=f@e.test','-c','user.name=Fixture','commit','-qm','unsafe');const sha=git('rev-parse','HEAD');
 await assert.rejects(stageVersions({sourceDir:f.source,outputDir:f.output,checkpoints:[{...f.checkpoints[0],sourceSha:sha},f.checkpoints[1]],liveId:'live',sharedFiles:[]}), /symlink|regular/i);
});
test('complete artifact exceeding budget fails instead of omitting checkpoints',async(t)=>{
 const f=await fixture(t);await assert.rejects(stageVersions({sourceDir:f.source,outputDir:f.output,checkpoints:f.checkpoints,liveId:'live',adapterProfiles:f.profiles,sharedFiles:[],budgetBytes:10}),/budget/i);
});
test('exact patches require one anchor and never change unlisted bytes',()=>{
 const sha='a'.repeat(40), original='alpha\nANCHOR\nomega\n'; const profile=defineAdapterProfile({sourceSha:sha,expectedHashes:{'src/main.js':hash(original),'index.html':hash('<body></body>')},patches:[{path:'src/main.js',name:'test bridge',anchor:'ANCHOR',replacement:'BRIDGE',count:1}]});
 const files=new Map([['src/main.js',Buffer.from(original)],['index.html',Buffer.from('<body></body>')],['src/engine.js',Buffer.from('unchanged')]]);
 const result=adaptVersion({sourceSha:sha,files,checkpointId:'old',siteRootRelative:'../../',profiles:new Map([[sha,profile]])});
 assert.equal(result.files.get('src/main.js').toString(),'alpha\nBRIDGE\nomega\n'); assert.equal(result.files.get('src/engine.js').toString(),'unchanged'); assert.ok(result.transformations.some(x=>x.name==='test bridge'));
 assert.throws(()=>defineAdapterProfile({sourceSha:sha,expectedHashes:{},patches:[{path:'src/main.js',anchor:'',replacement:'x',count:1}]}),/anchor/i);
});

test('all authored profiles pin historical input and isolate cache/library/preferences', async()=>{
 const {CHECKPOINTS}=await import('../tools/version-checkpoints.mjs');const {historicalProfiles}=await import('../tools/lib/version-adapters.mjs');
 const source=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
 for(const checkpoint of CHECKPOINTS){
  const profile=historicalProfiles.get(checkpoint.sourceSha);assert.ok(profile,`Missing profile ${checkpoint.id}`);
  const files=new Map(Object.keys(profile.expectedHashes).map(file=>[file,execFileSync('git',['-C',source,'show',`${checkpoint.sourceSha}:${file}`])]));
  const result=adaptVersion({sourceSha:checkpoint.sourceSha,checkpointId:checkpoint.id,siteRootRelative:'../../',files});
  assert.match(result.files.get('src/main.js').toString(),/__MIDIO_VERSION_ADAPTER/);
  assert.match(result.files.get('src/audio/AnalysisCache.js').toString(),new RegExp(`midio-analysis:${checkpoint.id}`));
  assert.match(result.files.get('src/library/LibraryDB.js').toString(),new RegExp(`midio-library:${checkpoint.id}`));
  assert.doesNotMatch(result.files.get('src/ui/Accessibility.js').toString(),/'smw:reducedFlash'/);
  assert.match(result.files.get('src/main.js').toString(),/playBuffer\(extra\.playBuffer, \(extra\.startAtMs \|\| 0\) \/ 1000\)/);
 }
});

test('historical adapter reads title state before an audio engine exists',async()=>{
 const {CHECKPOINTS}=await import('../tools/version-checkpoints.mjs');const {historicalProfiles}=await import('../tools/lib/version-adapters.mjs');
 for(const c of CHECKPOINTS){
  const profile=historicalProfiles.get(c.sourceSha);const files=new Map(Object.keys(profile.expectedHashes).map(file=>[file,execFileSync('git',['show',`${c.sourceSha}:${file}`])]));
  const {files:output}=adaptVersion({sourceSha:c.sourceSha,checkpointId:c.id,files});const main=output.get('src/main.js').toString();
  const helpers=['effectiveOutputLatencyMs','choreographyOutputLatencyMs','versionAdapterState'].map(name=>main.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0]).join('\n');
  const state=vm.runInNewContext(`${helpers}\nversionAdapterState()`,{loadGen:3,versionSelectionGeneration:3,versionSession:{phase:'title',source:null,sourceId:null},songRecorder:null,pendingCapturePresetId:null,pendingExportPresetId:null,bulkExportArmed:false,recalibration:{active:false},running:false,conductor:{durationMs:0},audioEngine:null,paused:false,sim:null,lastSongSeed:null,lastWorldId:'the-range',sceneChoice:{viewId:null},rangeMode:{forcedViewId:null},reducedFlash:false,reducedMotion:false,stageResEl:null,stageFpsEl:null,captureClock:{captureRequested:false},btLatencyTrimMs:0});
  assert.equal(state.phase,'title');assert.equal(state.positionMs,0);assert.equal(state.generation,3);
 }
});

async function emittedHistoricalMain(id) {
 const {CHECKPOINTS}=await import('../tools/version-checkpoints.mjs');const {historicalProfiles}=await import('../tools/lib/version-adapters.mjs');
 const checkpoint=CHECKPOINTS.find(c=>c.id===id);const profile=historicalProfiles.get(checkpoint.sourceSha);
 const files=new Map(Object.keys(profile.expectedHashes).map(file=>[file,execFileSync('git',['show',`${checkpoint.sourceSha}:${file}`])]));
 return adaptVersion({sourceSha:checkpoint.sourceSha,checkpointId:id,files}).files.get('src/main.js').toString();
}
const functionSource=(main,name)=>main.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
const titleContext=()=>({loadGen:3,versionSelectionGeneration:3,versionSession:{phase:'title',source:null,sourceId:null},songRecorder:null,pendingCapturePresetId:null,pendingExportPresetId:null,bulkExportArmed:false,recalibration:{active:false},running:false,conductor:{durationMs:0},audioEngine:null,paused:false,sim:null,lastSongSeed:null,lastWorldId:'the-range',sceneChoice:{viewId:null},rangeMode:{forcedViewId:null},reducedFlash:false,reducedMotion:false,stageResEl:null,stageFpsEl:null,captureClock:{captureRequested:false},btLatencyTrimMs:0});

test('glacial demo and URL claims emit independent generation before loading; Stop emits a newer generation',async()=>{
 const main=await emittedHistoricalMain('glacial-flight');
 const selectionBridge=main.slice(main.includes('let versionSelectionGeneration') ? main.indexOf('let versionSelectionGeneration') : main.indexOf('const sourceSelection ='),main.indexOf('// Retained so'));
 const functions=['effectiveOutputLatencyMs','choreographyOutputLatencyMs','versionAdapterState','startDemoSample','beginUrlLoadOperation','backToTitle'].map(name=>functionSource(main,name)).join('\n');
 const context=vm.createContext({...titleContext(),crypto:{randomUUID:()=> 'source'},cancelUrlLoad(){},bootAudio:()=>new Promise(()=>{}),urlLoadAbort:null,AbortController,setUrlLoadBusy(){},stopTimeline(){},completePanelEl:{classList:{add(){}}},hudEl:{classList:{add(){}}},hudLeftEl:{classList:{add(){}}},hudRightEl:{classList:{add(){}}},loaderEl:{classList:{remove(){}}},exportDialogEl:{open:false},lastAudioBuffer:null,loadShow:null,stopWorldPreview(){},closeWorldChooser(){},syncRecordUI(){},startTitleBackdrop(){},canvas:{focus(){}},performance:{now:()=>0},wakeHud(){},pendingWorldStart:null});
 vm.runInContext(`${selectionBridge}\n${functions}\nconst states=[];versionListeners.add(state=>states.push({generation:state.generation,phase:state.phase}));\nstartDemoSample();beginUrlLoadOperation();`,context);
 const states=vm.runInContext('states',context);assert.equal(states.length,2);assert.ok(states[1].generation>states[0].generation,'URL replacement must emit a new identity before any fetch/decode');
 const generation=states[1].generation;vm.runInContext('loadGen += 1;',context);
 assert.equal(vm.runInContext('versionAdapterState().generation',context),generation,'internal historical audio boot must not change selection identity');
 // Stop's ownership notification must precede unrelated title/layout cleanup.
 try { vm.runInContext('backToTitle()',context); } catch { /* Remaining historical title DOM is outside this contract. */ }
 assert.equal(states.at(-1).phase,'title');assert.ok(states.at(-1).generation>generation,'Stop must revoke ownership before its title notification');
});

function confirmedStartContext(main) {
 const events=[];const selection={};let resolveReady,rejectReady;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const context=vm.createContext({events,loadGen:3,sourceSelection:{isCurrent:value=>value===selection},resolveWorldId:value=>value,stopWorldPreview(){},closeWorldChooser(){},lastWorldId:null,readBulkExportFromUrl:()=>null,audioEngine:{ctx:{state:'running',async suspend(){this.state='suspended';events.push('suspended');}},playBuffer(buffer,offset){events.push(['buffer',offset]);}},muteTimelineSynth:false,running:false,sim:null,startTimeline(data,extra){context.running=true;context.sim={};events.push(['timeline',extra.startAtMs,extra.restorePaused]);},canvas:{focus(){}},lastAudioBuffer:null,rangePresentation:{whenReady(){events.push('whenReady');return ready;}},renderer:{draw(){events.push('draw');}},versionSourceStarted(){events.push('started');}});
 vm.runInContext(functionSource(main,'startConfirmedWorld'),context);
 const pending={data:{durationMs:20000},extra:{versionSelection:selection,versionSource:{kind:'demo'},playBuffer:{},restoreIntent:{positionMs:8000,seed:123}}};
 return {context,events,pending,resolveReady,rejectReady};
}
test('every paused historical restore waits its own scene and draws held transport before source completion',async()=>{
 const {CHECKPOINTS}=await import('../tools/version-checkpoints.mjs');
 for(const c of CHECKPOINTS){
  const {context,events,pending,resolveReady}=confirmedStartContext(await emittedHistoricalMain(c.id));
  let completed=false;const restoring=context.startConfirmedWorld(pending,'the-range').then(()=>{completed=true;});await new Promise(resolve=>setImmediate(resolve));
  assert.ok(events.includes('whenReady'),`${c.id} must wait its own scene`);assert.equal(completed,false);assert.equal(context.audioEngine.ctx.state,'suspended');
  assert.deepEqual(events.find(event=>Array.isArray(event)&&event[0]==='buffer'),['buffer',8]);assert.ok(!events.includes('draw'));assert.ok(!events.includes('started'));
  resolveReady();await restoring;assert.deepEqual(events.slice(-2),['draw','started']);assert.equal(context.audioEngine.ctx.state,'suspended');
 }
});
test('historical restore readiness failure only reaches the owning selection; stale failure cannot corrupt a replacement',async()=>{
 const {CHECKPOINTS}=await import('../tools/version-checkpoints.mjs');
 for(const c of CHECKPOINTS){
  for(const stale of [true,false]){
   const {context,events,pending,rejectReady}=confirmedStartContext(await emittedHistoricalMain(c.id));const restoring=context.startConfirmedWorld(pending,'the-range');await new Promise(resolve=>setImmediate(resolve));
   assert.ok(events.includes('whenReady'));if(stale)context.sourceSelection.isCurrent=()=>false;
   rejectReady(new Error('owned scene failed'));
   if(stale)await assert.doesNotReject(restoring);else await assert.rejects(restoring,/owned scene failed/);
   assert.ok(!events.includes('draw'));assert.ok(!events.includes('started'));
  }
 }
});

test('historical adapters preserve generated custom world base and reload custom through their normal source loader',async()=>{
 const {CHECKPOINTS}=await import('../tools/version-checkpoints.mjs');
 for(const c of CHECKPOINTS){
  const main=await emittedHistoricalMain(c.id);let loads=0;
  const context=vm.createContext({...titleContext(),sim:{worldId:'custom',songSeed:123},getCustomWorld:()=>({id:'custom',registeredId:'alpine',baseId:'alpine'}),listWorlds:()=>[{id:'alpine'}],readFpsCap:()=>60,fpsCapMs:0,loadAudioFiles(files,restore){loads++;context.versionSession={phase:'loading',completion:Promise.resolve('loaded')};assert.equal(restore.restoreIntent.worldId,'custom');assert.equal(restore.restoreIntent.settings.worldBaseId,'alpine');return Promise.resolve();}});
  vm.runInContext(['effectiveOutputLatencyMs','choreographyOutputLatencyMs','versionAdapterState','versionLoadSource'].map(name=>functionSource(main,name)).join('\n'),context);
  const settings=context.versionAdapterState().settings;assert.equal(settings.worldBaseId,'alpine',`${c.id} must preserve the registered custom base`);
  await assert.doesNotReject(context.versionLoadSource({kind:'audio-files',files:[]},{worldId:'custom',settings:{worldBaseId:'alpine'}}));assert.equal(loads,1);
  for(const worldBaseId of [undefined,'not-a-world']) await assert.rejects(context.versionLoadSource({kind:'audio-files',files:[]},{worldId:'custom',settings:{worldBaseId}}),/world/i);
  assert.equal(loads,1,'unsupported custom descriptors must not start unrelated playback');
 }
});

test('historical custom restores regenerate only the requested registered base from destination analysis',async()=>{
 const {CHECKPOINTS}=await import('../tools/version-checkpoints.mjs');
 for(const c of CHECKPOINTS){
  const main=await emittedHistoricalMain(c.id);assert.ok(main.includes('function versionRestoreWorldId('),`${c.id} must regenerate custom world explicitly`);
  const pending={features:{drive:.7},profile:{version:1},data:{destinationAnalysis:true}};let saved=null;let bad=false;
  const context=vm.createContext({lastWorldId:'alpine',DEFAULT_WORLD_ID:'alpine',listWorlds:()=>[{id:'alpine'}],buildWorldVariant(baseId,features,data){assert.equal(baseId,'alpine');assert.equal(features,pending.features);assert.equal(data.profile,pending.profile);assert.equal(data.destinationAnalysis,true);return{world:{id:bad?'alpine':'custom',registeredId:'alpine'}};},setCustomWorld(world){saved=world;}});
  vm.runInContext(functionSource(main,'versionRestoreWorldId'),context);
  assert.equal(context.versionRestoreWorldId(pending,{worldId:'custom',settings:{worldBaseId:'alpine'}}),'custom');assert.equal(saved.id,'custom');
  for(const settings of [{},{worldBaseId:'missing'}])assert.throws(()=>context.versionRestoreWorldId(pending,{worldId:'custom',settings}),/world/i);
  saved=null;bad=true;assert.throws(()=>context.versionRestoreWorldId(pending,{worldId:'custom',settings:{worldBaseId:'alpine'}}),/regenerate|world/i);assert.equal(saved,null,'invalid regeneration cannot silently substitute a stock world');
 }
});

test('historical restored terrain rejection cannot poison a newer selection; owned rejection remains visible',async()=>{
 const {CHECKPOINTS}=await import('../tools/version-checkpoints.mjs');
 for(const c of CHECKPOINTS){
  for(const stale of [true,false]){
   const main=await emittedHistoricalMain(c.id);let rejectTerrain;const terrain=new Promise((resolve,reject)=>{rejectTerrain=reject;});const errors=[];const selection={};
   const context=vm.createContext({loadGen:3,console:{error(){}},clearCustomWorld(){},PROFILE_VERSION:1,prepareSongTerrain:()=>terrain,sceneChoice:{viewId:null,biome:null},readPinnedSeed:()=>null,recordFitDiagnostic:()=>null,lastFitDiagnostic:null,pendingWorldStart:null,sourceSelection:{isCurrent:value=>value===selection},showErrorBanner(message){errors.push(message);},confirmWorld(){throw new Error('failed terrain must never start');}});
   vm.runInContext(functionSource(main,'offerWorldsThenStart'),context);
   context.offerWorldsThenStart({songIdentity:{seed:123,songProfile:{version:1,watch:{drive:.7}}}},{versionSelection:selection,restoreIntent:{seed:123,worldId:'alpine'}});
   if(stale)context.sourceSelection.isCurrent=()=>false;
   rejectTerrain(new Error('terrain unavailable'));await new Promise(resolve=>setImmediate(resolve));
   assert.equal(errors.length,stale?0:1,`${c.id} terrain failure belongs only to its original selection`);
  }
 }
});
