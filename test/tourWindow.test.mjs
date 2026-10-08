import {test} from'node:test';import assert from'node:assert/strict';import{planTerrainWindow,TourWindowCache}from'../src/world/alpine/TerrainWindow.js';
const fixture=()=>({grid:{originM:[-1280,-1280],cellSizeM:20,width:129,height:129},cells:64,tiles:new Map([...Array(4)].map((_,i)=>[`t${i}`,{id:`t${i}`,ix:i%2,iz:Math.floor(i/2),stride:1,minY:0,maxY:100,errorsM:{1:0,2:1,4:3,8:10,16:30,32:100,64:300}}]))});
const poseAt=t=>({eyeM:[0,500,5000-t/10],targetM:[0,50,0],fovYDeg:40});
test('route windows union widened frustums and select coarsest measured safe strides',()=>{
 const p=planTerrainWindow(fixture(),{poseAt,durationMs:30000},0,{heightPx:1080});
 assert.equal(p.strides.size,4);assert.ok(p.triangles<=1500000);assert.ok(p.maxErrorPx<=1+.0001);
 const mobile=planTerrainWindow(fixture(),{poseAt,durationMs:30000},0,{budget:'mobile',heightPx:720});assert.ok(mobile.triangles<=p.triangles);
 const coarse=planTerrainWindow(fixture(),{poseAt,durationMs:30000},0,{bias:2});assert.ok(coarse.triangles<=p.triangles);
});
test('window cache bounds resident meshes, disposes replaced/stale results and handles far seeks',async()=>{
 const disposed=[],cache=new TourWindowCache({build:async index=>({index,dispose(){disposed.push(index)}})});
 await cache.at(0);await cache.at(8000);await cache.at(16000);await cache.at(240000);assert.ok(cache.resident.size<=3);
 assert.ok(cache.resident.has(30));cache.dispose();assert.equal(cache.resident.size,0);assert.ok(disposed.length>=3);
 let resolve;const stale=new TourWindowCache({build:()=>new Promise(r=>resolve=r)}),job=stale.at(0);stale.dispose();resolve({dispose(){disposed.push('late')}});await job;assert.ok(disposed.includes('late'));
});

test('refinement allocates new ownership while keeping the active window and rejects stale worker results',async()=>{
 const {RangeScene}=await import('../src/world/alpine/RangeScene.js');
 const {GraphicsResidency}=await import('../src/render/GraphicsResidency.js');
 const THREE=await import('../src/vendor/range/three-range.module.js');
 const residency=new GraphicsResidency({budgetBytes:10000000});
 const oldKey='range:tour-window:test:0',reservation=residency.reserve({key:oldKey,bytes:100,owner:'test'});
 let retired=false;residency.commit(reservation,{},()=>retired=true);
 const built={bands:Object.fromEntries(['far','mid','near'].map(b=>[b,{positions:new Float32Array(),indices:new Uint32Array(),fringe:new Uint32Array()}])),stats:{}};
 const raw={built,placed:{mesh:new Float32Array(),billboard:new Float32Array(),stride:8,count:0},plan:{}};
 const p={view:{id:'test'},windowCache:{generation:1,closed:false,resident:new Map()},windowWorker:{build:async()=>raw},activeWindow:{key:oldKey},uniforms:{},generation:0};
 const scene={THREE,residency,prepared:new Map([['test',p]]),_tourWindowResource:RangeScene.prototype._tourWindowResource};
 const next=await RangeScene.prototype._buildTourWindow.call(scene,p,0);
 assert.notEqual(next.key,oldKey);assert.equal(retired,false);assert.ok(residency.has(next.key));next.dispose();
 let finish;p.windowWorker.build=()=>new Promise(r=>finish=r);
 const stale=RangeScene.prototype._buildTourWindow.call(scene,p,0);p.windowCache.generation++;finish(raw);
 await assert.rejects(stale,/generation ended/);assert.equal(residency.has(oldKey),true);
 residency.release(oldKey);assert.equal(retired,true);
});
