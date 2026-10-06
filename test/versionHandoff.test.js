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
    readBulkExportFromUrl:()=>false, rangePresentation:null,renderer:{draw(){}},running:true,sim:{},canvas:{focus(){}},
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
 const ctx=vm.createContext({loadGen:3,versionSession:{phase:'title',source:null,sourceId:null},songRecorder:null,pendingCapturePresetId:null,pendingExportPresetId:null,bulkExportArmed:false,recalibration:{active:false},running:false,conductor:{durationMs:0},sim:null,lastSongSeed:null,paused:false,lastWorldId:'range',sceneChoice:{viewId:null},reducedFlash:false,reducedMotion:false,stageResEl:null,stageFpsEl:null,audioEngine:null,choreographyOutputLatencyMs(){throw new Error('No AudioEngine exists');}});
 vm.runInContext(mainFunctions(['versionAdapterState']),ctx);
 const state=ctx.versionAdapterState();assert.equal(state.phase,'title');assert.equal(state.positionMs,0);assert.equal(state.source,null);assert.equal(state.generation,3);
});
test('persisted pageshow waits for the outgoing document release instead of rotating its tab',async()=>{
 const h=fixture();await h.store.tabId();
 const listeners=new Map();const lifecycle={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const returning=createVersionHandoffStore({...h.options,lifecycle,sessionStorage:storage(h.ss.data)});
 listeners.get('pageshow')({persisted:true});
 const identity=returning.tabId();
 await new Promise(resolve=>setTimeout(resolve,40));
 await h.store.release();
 assert.equal(await identity,h.ss.getItem('midio:version-tab'));
 await returning.dispose();await h.store.dispose();
});
test('same-store pageshow serializes its prior snapshot and owner release',async()=>{
 const listeners=new Map();const lifecycle={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const h=fixture();await h.store.dispose();const store=createVersionHandoffStore({...h.options,lifecycle});await store.saveSource(h.state);const token=await store.tabId();
 store.setSnapshotProvider(()=>({state:{...h.state,positionMs:17000},currentId:'a'}));
 const hide=listeners.get('pagehide')();const show=listeners.get('pageshow')({persisted:true});
 await hide;await show;
 assert.ok(h.db.rows().has(token+':owner'),'pageshow retains ownership after the earlier hide releases');
 const latest=await store.readLatest('a');
 assert.equal(latest.positionMs,17000);assert.equal(await store.tabId(),token);
 assert.ok(await store.readSource(h.state.sourceId));await store.dispose();
});
test('normal reload waits for fallback lease release while a fresh duplicate still rotates',async()=>{
 const h=fixture();const original=await h.store.tabId();
 const reload=createVersionHandoffStore({...h.options,navigationType:'reload',sessionStorage:storage(h.ss.data)});
 const identity=reload.tabId();await new Promise(resolve=>setTimeout(resolve,40));await h.store.release();
 assert.equal(await identity,original);await reload.dispose();await h.store.dispose();
});
test('winning a Web Lock reclaims its dead previous document lease without rotating a reload',async()=>{
 const held=new Set();const locks={async request(name,_options,fn){if(held.has(name))return fn(null);held.add(name);try{return await fn({name});}finally{held.delete(name);}}};
 const h=fixture();await h.store.dispose();const previous=createVersionHandoffStore({...h.options,locks});const token=await previous.tabId();const id=await previous.saveSource(h.state);await previous.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});
 held.clear(); // Browser released the dead document's lock; its IDB cleanup never ran.
 const reload=createVersionHandoffStore({...h.options,locks,navigationType:'reload',sessionStorage:storage(h.ss.data)});
 assert.equal(await reload.tabId(),token);assert.ok(await reload.readPending('b'));await reload.dispose();await previous.dispose();
});
test('synchronous unload transport snapshot survives aborted IndexedDB cleanup without copying audio',async()=>{
 const h=fixture();await h.store.dispose();const listeners=new Map();const lifecycle={addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 const previous=createVersionHandoffStore({...h.options,lifecycle});const id=await previous.saveSource(h.state);const record=await previous.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});await previous.completeSwitch(record);
 previous.setSnapshotProvider(()=>({state:{...h.state,positionMs:17000},currentId:'b'}));h.db.fail=true;await listeners.get('pagehide')();h.db.fail=false;h.setTime(16000);
 const destination=createVersionHandoffStore({...h.options,navigationType:'reload',sessionStorage:storage(h.ss.data)});
 assert.equal((await destination.readLatest('b')).positionMs,17000);
 const values=[...h.ss.data.values()].join('');assert.equal(values.includes('bass.wav'),false);assert.equal(values.includes('audio-files'),false);
 await destination.dispose();await previous.dispose();
});
test('cold browser history navigation waits for outgoing lease release',async()=>{
 const h=fixture();const token=await h.store.tabId();const history=createVersionHandoffStore({...h.options,navigationType:'back_forward',sessionStorage:storage(h.ss.data)});
 const identity=history.tabId();await new Promise(resolve=>setTimeout(resolve,40));await h.store.release();assert.equal(await identity,token);await history.dispose();await h.store.dispose();
});
test('source invalidation is synchronous so an interrupted discard cannot resurrect old audio on reload',async()=>{
 const h=fixture();const id=await h.store.saveSource(h.state);const pending=await h.store.prepareSwitch({...h.state,sourceId:id,fromId:'a',toId:'b'});await h.store.completeSwitch(pending);
 h.db.fail=true;await assert.rejects(h.store.discardSource());h.db.fail=false;await h.store.release();
 const reload=createVersionHandoffStore({...h.options,navigationType:'reload',sessionStorage:storage(h.ss.data)});
 assert.equal(await reload.readLatest('b'),null);assert.equal(await reload.readSource(id),null);
 await reload.dispose();await h.store.dispose();
});
test('a transient IndexedDB open failure can retry without reloading the page',async()=>{
 const rows=new Map();let opens=0;
 const indexedDB={open(){if(++opens===1)throw new Error('Transient SecurityError');
  const request={};queueMicrotask(()=>{request.result={transaction(){const tx={};let timer;
   const response=fn=>{const r={};queueMicrotask(()=>{r.result=fn();r.onsuccess?.();clearTimeout(timer);timer=setTimeout(()=>tx.oncomplete?.(),1);});return r;};
   tx.objectStore=()=>({get:k=>response(()=>rows.get(k)),put:(v,k)=>response(()=>rows.set(k,v)),delete:k=>response(()=>rows.delete(k)),getAllKeys:()=>response(()=>[...rows.keys()]),getAll:()=>response(()=>[...rows.values()])});return tx;},close(){}};request.onsuccess?.();});return request;
 }};
 const store=createVersionHandoffStore({indexedDB,sessionStorage:storage(),locks:null,lifecycle:null,heartbeat:false});
 await assert.rejects(store.tabId(),/SecurityError/);assert.ok(await store.tabId());assert.equal(opens,2);await store.dispose();
});
test('a connection arriving after a blocked open is rejected closes instead of leaking',async()=>{
 let closed=0;const indexedDB={open(){const request={result:{close(){closed++;}}};queueMicrotask(()=>{request.onblocked?.();queueMicrotask(()=>request.onsuccess?.());});return request;}};
 const store=createVersionHandoffStore({indexedDB,sessionStorage:storage(),locks:null,lifecycle:null,heartbeat:false});await assert.rejects(store.tabId(),/blocked/);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,1);await store.dispose();
});
test('paused restore waits for its own scene then redraws before successful ownership publication',async()=>{
 for(const replaced of [false,true,'rejected','ownedRejected']) {
  const calls=[];let ready,rejectReady;const waiting=new Promise((resolve,reject)=>{ready=resolve;rejectReady=reject;});const selection={id:1};let current=true;
  const ctx=vm.createContext({loadGen:1,sourceSelection:{isCurrent:()=>current},resolveWorldId:x=>x,stopWorldPreview(){},closeWorldChooser(){},lastWorldId:null,readBulkExportFromUrl:()=>false,running:true,sim:{},canvas:{focus(){}},muteTimelineSynth:false,lastAudioBuffer:null,
   audioEngine:{ctx:{state:'running',async suspend(){this.state='suspended';calls.push('suspend');}},resume(){throw new Error('audible restore');},playBuffer(){assert.equal(ctx.audioEngine.ctx.state,'suspended');}},
   rangePresentation:{whenReady(){calls.push('wait');return waiting;}},renderer:{draw(){assert.equal(ctx.audioEngine.ctx.state,'suspended');calls.push('draw');}},startTimeline(){calls.push('timeline');},versionSourceStarted(){calls.push('ready');},
  });
  vm.runInContext(mainFunctions(['startConfirmedWorld']),ctx);
  const starting=ctx.startConfirmedWorld({data:{durationMs:20000},extra:{versionSelection:selection,versionSource:{kind:'demo'},restoreIntent:{positionMs:8000,seed:123,paused:true}}},'range');
  await new Promise(resolve=>setTimeout(resolve,0));assert.ok(calls.includes('wait'));assert.equal(calls.includes('ready'),false);
  if(replaced && replaced !== 'ownedRejected')current=false;
  if(replaced==='rejected' || replaced==='ownedRejected')rejectReady(new Error('Old readiness failed'));else ready();
  if(replaced==='ownedRejected')await assert.rejects(starting,/Old readiness failed/);else await starting;
  assert.deepEqual(calls.filter(x=>x==='draw'||x==='ready'),replaced?[]:['draw','ready']);
 }
});
import { buildWorldVariant } from '../src/world/WorldScore.js';
import { getCustomWorld, setCustomWorld, clearCustomWorld, listWorlds } from '../src/world/Worlds.js';
import { buildSongProfile } from '../src/audio/SongProfile.js';
test('normal custom world handoff regenerates its registered base from destination song profile',()=>{
 const data={timeline:[],durationMs:20000,bpm:120};const profile=buildSongProfile(data);const ctx=vm.createContext({buildWorldVariant,listWorlds,setCustomWorld,getCustomWorld,lastWorldId:'alpine',DEFAULT_WORLD_ID:'alpine'});
 vm.runInContext(mainFunctions(['versionRestoreWorldId']),ctx);
 const id=ctx.versionRestoreWorldId({data,features:profile.watch,profile},{worldId:'custom',settings:{worldBaseId:'alpine'}});
 assert.equal(id,'custom');assert.equal(getCustomWorld().baseId,'alpine');assert.equal(getCustomWorld().registeredId,'alpine');clearCustomWorld();
 assert.throws(()=>ctx.versionRestoreWorldId({data,features:profile.watch,profile},{worldId:'custom',settings:{}}),/cannot restore/);
 assert.throws(()=>ctx.versionRestoreWorldId({data,features:profile.watch,profile},{worldId:'custom',settings:{worldBaseId:'unknown'}}),/cannot restore/);
 ctx.buildWorldVariant=()=>({world:{id:'alpine',baseId:'alpine'}});
 assert.throws(()=>ctx.versionRestoreWorldId({data,features:profile.watch,profile},{worldId:'custom',settings:{worldBaseId:'alpine'}}),/regenerate/);
});
test('live custom-world adapter accepts valid registered metadata before invoking the original file loader',async()=>{
 let loaded=false;const ctx=vm.createContext({stageResEl:null,stageFpsEl:null,listWorlds:()=>[{id:'alpine'}],readFpsCap:()=>60,fpsCapMs:0,versionSession:{phase:'loading',completion:Promise.resolve({worldId:'custom'})},loadAudioFiles(_files,{restoreIntent}){assert.equal(restoreIntent.settings.worldBaseId,'alpine');loaded=true;return Promise.resolve();}});
 vm.runInContext(mainFunctions(['versionLoadSource']),ctx);
 const result=await ctx.versionLoadSource({kind:'audio-files',files:['original']},{worldId:'custom',settings:{worldBaseId:'alpine'}});
 assert.ok(loaded);assert.equal(result.worldId,'custom');
 await assert.rejects(ctx.versionLoadSource({kind:'audio-files',files:['original']},{worldId:'custom',settings:{}}),/cannot restore/);
});
test('a restored terrain failure reports only while its source generation is still current',async()=>{
 for(const stale of [false,true]) {
  const errors=[];let rejectTerrain;const terrain=new Promise((_resolve,reject)=>{rejectTerrain=reject;});let current=true;
  const profile=buildSongProfile({timeline:[],durationMs:20000,bpm:120});const selection={id:1};
  const ctx=vm.createContext({clearCustomWorld(){},PROFILE_VERSION:profile.version,pendingWorldStart:null,sceneChoice:{},prepareSongTerrain:()=>terrain,readPinnedSeed:()=>null,sourceSelection:{isCurrent:()=>current},loadGen:1,showErrorBanner:message=>errors.push(message)});
  vm.runInContext(mainFunctions(['offerWorldsThenStart']),ctx);
  ctx.offerWorldsThenStart({songIdentity:{seed:123,songProfile:profile},durationMs:20000},{versionSelection:selection,restoreIntent:{worldId:'custom',seed:123,settings:{worldBaseId:'alpine'}}});
  if(stale){current=false;ctx.loadGen++;}rejectTerrain(new Error('Terrain failed'));
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(errors,stale?[]:['Terrain failed']);
 }
});
