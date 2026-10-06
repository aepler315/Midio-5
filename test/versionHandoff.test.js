import test from 'node:test';
import assert from 'node:assert/strict';
import { createVersionHandoffStore } from '../src/ui/VersionHandoff.js';

// An atomic storage boundary with rollback; production uses IndexedDB transactions.
function database() {
  let rows = new Map(); let tail = Promise.resolve();
  return { fail: false, atomic(fn) {
    const result = tail.then(async () => {
      if (this.fail) throw new Error('QuotaExceededError');
      const copy = new Map(rows);
      const value = await fn({ get: async k => copy.get(k), put: async (k,v) => copy.set(k,v), delete: async k => copy.delete(k), entries: async () => [...copy] });
      rows = copy; return value;
    }); tail = result.catch(() => {}); return result;
  }, rows: () => rows };
}
function storage(copy) { const data = new Map(copy); return { getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),data }; }
function fixture() {
  const db=database(); const ss=storage(); let time=100;
  const options={ storage:db, sessionStorage:ss, now:()=>time, locks:null, lifecycle:null, heartbeat:false };
  const store=createVersionHandoffStore(options);
  const files=[new File(['bass'],'bass.wav',{type:'audio/wav',lastModified:33}),new File(['vox'],'vox.mp3',{type:'audio/mpeg',lastModified:44})];
  const state={phase:'ready',sourceId:'generation-1',source:{kind:'audio-files',files},positionMs:14567,seed:123,paused:true,worldId:'range',rangeViewId:null,settings:{reducedMotion:true}};
  return {db,ss,store,state,options,setTime:t=>{time=t;}};
}
test('ordered original files and metadata persist once and completion retains latest session', async()=>{
  const h=fixture(); const id=await h.store.saveSource(h.state);
  assert.equal(await h.store.saveSource(h.state),id);
  const source=await h.store.readSource(id);
  assert.deepEqual(source.files.map(f=>[f.name,f.type,f.lastModified]),[['bass.wav','audio/wav',33],['vox.mp3','audio/mpeg',44]]);
  const pending=await h.store.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});
  assert.equal((await h.store.readPending('a')),null);
  assert.equal((await h.store.readPending('b','wrong')),null);
  assert.equal((await h.store.readPending('b')).positionMs,14567);
  await assert.rejects(h.store.completeSwitch({...pending,toId:'a'}));
  assert.ok(await h.store.readPending('b'),'retry keeps files');
  await h.store.completeSwitch(pending);
  assert.equal(await h.store.readPending('b'),null);
  assert.equal((await h.store.readLatest('b')).seed,123);
  assert.equal([...h.db.rows().keys()].filter(k=>k.includes(':source')).length,1);
  await h.store.dispose();
});
test('loading, failed replacements, unsupported sources and operation blockers cannot reuse previous audio', async()=>{
  const h=fixture(); await h.store.saveSource(h.state);
  for(const change of [{phase:'loading'},{phase:'error'},{source:null},{blockedReason:'Recording'}]) {
    await assert.rejects(h.store.saveSource({...h.state,...change}));
  }
  await h.store.discardSource(); assert.equal(await h.store.readSource('generation-1'),null);
  await h.store.dispose();
});
test('a copied sessionStorage tab rotates identity before accepting idle or pending records',async()=>{
  for(const pending of [false,true]) {
    const h=fixture(); const id=await h.store.saveSource(h.state);
    if(pending) await h.store.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});
    const duplicate=createVersionHandoffStore({...h.options,sessionStorage:storage(h.ss.data)});
    assert.equal(await duplicate.readPending('b'),null);
    assert.equal(await duplicate.readSource(id),null);
    assert.notEqual(await duplicate.tabId(),await h.store.tabId());
    await duplicate.dispose(); await h.store.dispose();
  }
});
test('released ownership lets the next document restore; expiry clears all retained records',async()=>{
  const h=fixture(); const id=await h.store.saveSource(h.state);
  await h.store.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});
  await h.store.release();
  const next=createVersionHandoffStore({...h.options,sessionStorage:storage(h.ss.data)});
  assert.ok(await next.readPending('b'));
  h.setTime(86400101); await next.pruneExpired();
  assert.equal(await next.readPending('b'),null); assert.equal(await next.readSource(id),null);
  await next.dispose(); await h.store.dispose();
});
test('transaction failure leaves retryable handoff intact and does not publish a new source',async()=>{
  const h=fixture(); const id=await h.store.saveSource(h.state);
  const pending=await h.store.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});
  h.db.fail=true; await assert.rejects(h.store.completeSwitch(pending));
  await assert.rejects(h.store.saveSource({...h.state,sourceId:'generation-2'}));
  h.db.fail=false; assert.ok(await h.store.readPending('b')); assert.ok(await h.store.readSource(id));
  await h.store.dispose();
});
test('demo is a separate descriptor and replaces the one stored source',async()=>{
  const h=fixture(); const old=await h.store.saveSource(h.state);
  const id=await h.store.saveSource({...h.state,sourceId:'demo-2',source:{kind:'demo'}});
  assert.equal(await h.store.readSource(old),null);
  assert.deepEqual(await h.store.readSource(id),{kind:'demo'});
  await assert.rejects(h.store.prepareSwitch({...h.state,sourceId:old,fromId:'a',toId:'b'}));
  await h.store.dispose();
});

import vm from 'node:vm';
import { mainFunctions } from './helpers/mainSource.js';
test('confirmed restore suspends before any source starts and applies seed and nonzero offset',async()=>{
  const calls=[];
  const selection={id:1};
  const ctx=vm.createContext({
    resolveWorldId:x=>x, stopWorldPreview(){},closeWorldChooser(){}, lastWorldId:null,
    sourceSelection:{isCurrent:s=>s===selection},loadGen:1,
    readBulkExportFromUrl:()=>false, running:true,sim:{},canvas:{focus(){}},
    muteTimelineSynth:false,lastAudioBuffer:null,
    audioEngine:{ctx:{state:'running',suspend:async()=>{calls.push('suspend');ctx.audioEngine.ctx.state='suspended';}},resume:()=>calls.push('resume'),playBuffer:(_b,t)=>calls.push(['play',t])},
    startTimeline:(_d,extra)=>calls.push(['timeline',extra]),
    versionSourceStarted:(_selection,source)=>calls.push(['ready',source.kind]),
  });
  vm.runInContext(mainFunctions(['startConfirmedWorld']),ctx);
  await ctx.startConfirmedWorld({data:{durationMs:20000},seed:9,extra:{playBuffer:{duration:20},versionSelection:selection,versionSource:{kind:'audio-files',files:[]},restoreIntent:{positionMs:14567,seed:123,paused:false}}},'range');
  assert.equal(calls[0],'suspend'); assert.equal(calls.some(x=>x==='resume'),false);
  const extra=calls.find(x=>x[0]==='timeline')[1];
  assert.equal(extra.songSeed,123); assert.equal(extra.startAtMs,14567); assert.equal(extra.startAtWallMs,0);assert.equal(extra.preservePause,true);assert.equal(extra.restorePaused,true);
  assert.deepEqual(calls.find(x=>x[0]==='play'),['play',14.567]);
});
test('a stale confirmed generation cannot start or own a song',async()=>{
  const ctx=vm.createContext({sourceSelection:{isCurrent:()=>false},resolveWorldId:x=>x,stopWorldPreview(){throw new Error('stale start');}});
  vm.runInContext(mainFunctions(['startConfirmedWorld']),ctx);
  await ctx.startConfirmedWorld({data:{},extra:{versionSelection:{id:1}}},'range');
});
test('failed destination can return using only the exact pending switch token',async()=>{
 const h=fixture(); const id=await h.store.saveSource(h.state);
 const pending=await h.store.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});
 await assert.rejects(h.store.prepareSwitch({...h.state,sourceId:id,fromId:'b',toId:'a',replaceSwitchId:'wrong'}));
 const back=await h.store.prepareSwitch({...h.state,sourceId:id,fromId:'b',toId:'a',replaceSwitchId:pending.switchId});
 assert.equal(back.toId,'a'); assert.equal(await h.store.readPending('b'),null);
 await h.store.completeSwitch(back); await h.store.completeSwitch(back);
 assert.equal((await h.store.readLatest('b')).sourceId,id);
 await h.store.dispose();
});
test('lease takeover is fail-closed for the original background document',async()=>{
 const h=fixture(); const id=await h.store.saveSource(h.state); h.setTime(16000);
 const duplicate=createVersionHandoffStore({...h.options,sessionStorage:storage(h.ss.data)});
 assert.equal(await duplicate.tabId(),await h.store.tabId());
 await assert.rejects(h.store.readSource(id),/another tab/);
 await h.store.dispose(); await duplicate.dispose();
});
import { SourceSelection } from '../src/audio/SourceSelection.js';
function generationHarness() {
 const ctx=vm.createContext({SourceSelection, sourceSelection:new SourceSelection(),crypto:globalThis.crypto,loadGen:0,
   versionSession:{phase:'title'},versionListeners:new Set(),versionAdapterState:()=>ctx.versionSession,
 });
 vm.runInContext(mainFunctions(['claimSelection','versionEmit','versionSelectionChanged','versionLoadFailed','versionSourceStarted','versionClearSource']),ctx);
 return ctx;
}
test('only actual successful current generation owns its originals; a failed replacement clears the prior source',()=>{
 const ctx=generationHarness(); const first=ctx.claimSelection({kind:'file'});
 ctx.versionSourceStarted(first,{kind:'audio-files',files:['first']}); assert.equal(ctx.versionSession.source.files[0],'first');
 const next=ctx.claimSelection({kind:'file'}); assert.equal(ctx.versionSession.source,null);
 ctx.versionSourceStarted(first,{kind:'audio-files',files:['stale']}); assert.equal(ctx.versionSession.source,null);
 ctx.versionLoadFailed('Bad recording'); assert.equal(ctx.versionSession.phase,'error');assert.equal(ctx.versionSession.source,null);
 ctx.versionSourceStarted(next,{kind:'demo'}); assert.equal(ctx.versionSession.source.kind,'demo');
 ctx.versionClearSource(); assert.equal(ctx.versionSession.phase,'title');
});
test('direct invalid replacement claims ownership before validation so navigation cannot carry old files',async()=>{
 const ctx=generationHarness(); const first=ctx.claimSelection({kind:'file'});ctx.versionSourceStarted(first,{kind:'audio-files',files:['first']});
 ctx.validateAudioFiles=()=>{throw new Error('Invalid input');};ctx.AUDIO_LOAD_LIMITS={};ctx.showErrorBanner=ctx.versionLoadFailed;
 vm.runInContext(mainFunctions(['loadAudioFiles']),ctx);
 await ctx.loadAudioFiles([]);
 assert.equal(ctx.versionSession.phase,'error');assert.equal(ctx.versionSession.source,null);
});
test('Web Locks rotates a copied token and releases it for the next document',async()=>{
 const held=new Set();
 const locks={async request(name,_options,fn){
   if(held.has(name)) return fn(null);
   held.add(name); try{return await fn({name});}finally{held.delete(name);}
 }};
 const h=fixture(); await h.store.dispose();
 const a=createVersionHandoffStore({...h.options,locks});const id=await a.saveSource(h.state);
 const pending=await a.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});
 const ss=storage(h.ss.data); const b=createVersionHandoffStore({...h.options,locks,sessionStorage:ss});
 assert.notEqual(await b.tabId(),await a.tabId()); assert.equal(await b.readPending('b'),null);
 await a.release();
 const next=createVersionHandoffStore({...h.options,locks,sessionStorage:storage(h.ss.data)});
 assert.equal((await next.readPending('b')).switchId,pending.switchId);
 await b.dispose();await next.dispose();await a.dispose();
});
test('lifecycle snapshots current position only for the matching saved generation',async()=>{
 const listeners=new Map();const lifecycle={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const h=fixture();await h.store.dispose();const store=createVersionHandoffStore({...h.options,lifecycle});
 const id=await store.saveSource(h.state);const switchRecord=await store.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});await store.completeSwitch(switchRecord);
 store.setSnapshotProvider(()=>({state:{...h.state,positionMs:18000},currentId:'b'}));
 await listeners.get('pagehide')();
 const next=createVersionHandoffStore({...h.options,sessionStorage:storage(h.ss.data)});
 assert.equal((await next.readLatest('b')).positionMs,18000);
 await assert.rejects(next.updateLatest({...h.state,sourceId:'new-selection'},'b'));
 await store.dispose();await next.dispose();
});
test('URL folder and failed URL replacement leave explicit error rather than a permanent loading phase',async()=>{
 for(const listing of [true,false]) {
  const ctx=generationHarness();const first=ctx.claimSelection({kind:'file'});ctx.versionSourceStarted(first,{kind:'audio-files',files:['old']});
  Object.assign(ctx,{beginUrlLoadOperation:()=>new AbortController().signal,AbortController,location:{href:'http://localhost/'},renderUrlListing(){},endUrlLoadOperation(){},urlLoadInputEl:null,urlLoadStatusEl:null,UrlAudioError:Error,
    openAudioUrl:async()=>{if(!listing)throw new Error('Unavailable URL');return {kind:'listing',entries:[],url:'http://localhost/folder/'};},
  });
  vm.runInContext(mainFunctions(['openUrlTarget','setUrlLoadStatus']),ctx);
  await ctx.openUrlTarget('http://localhost/folder/');
  assert.equal(ctx.versionSession.phase,'error');assert.equal(ctx.versionSession.source,null);
 }
});
test('title-state adapter reads position zero before any AudioEngine exists',()=>{
 const ctx=vm.createContext({versionSession:{phase:'title',source:null,sourceId:null},songRecorder:null,pendingCapturePresetId:null,pendingExportPresetId:null,bulkExportArmed:false,recalibration:{active:false},running:false,conductor:{durationMs:0},sim:null,lastSongSeed:null,paused:false,lastWorldId:'range',sceneChoice:{viewId:null},reducedFlash:false,reducedMotion:false,stageResEl:null,stageFpsEl:null,audioEngine:null,choreographyOutputLatencyMs(){throw new Error('No AudioEngine exists');}});
 vm.runInContext(mainFunctions(['versionAdapterState']),ctx);
 const state=ctx.versionAdapterState();assert.equal(state.phase,'title');assert.equal(state.positionMs,0);assert.equal(state.source,null);
});
