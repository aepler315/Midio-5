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
  await fs.writeFile(path.join(source, 'index.html'), '<html><body>working tree</body></html>');
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
  const state=vm.runInNewContext(`${helpers}\nversionAdapterState()`,{versionSession:{phase:'title',source:null,sourceId:null},songRecorder:null,pendingCapturePresetId:null,pendingExportPresetId:null,bulkExportArmed:false,recalibration:{active:false},running:false,conductor:{durationMs:0},audioEngine:null,paused:false,sim:null,lastSongSeed:null,lastWorldId:'the-range',sceneChoice:{viewId:null},rangeMode:{forcedViewId:null},reducedFlash:false,reducedMotion:false,stageResEl:null,stageFpsEl:null,captureClock:{captureRequested:false},btLatencyTrimMs:0});
  assert.equal(state.phase,'title');assert.equal(state.positionMs,0);
 }
});
