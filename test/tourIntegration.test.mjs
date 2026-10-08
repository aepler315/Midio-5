import{test}from'node:test';import assert from'node:assert/strict';import{scenePoseAt,pathStations}from'../src/world/terrain/SceneTravel.js';import{resolveRangeMode}from'../src/world/alpine/RangePresentation.js';import{applyCameraMoves}from'../src/world/alpine/RangeCamera.js';
test('tour mode resolves query and persistence without changing ordinary Range',()=>{
 assert.equal(resolveRangeMode('?rangeTour=tetons').tour,'tetons');assert.equal(resolveRangeMode('',{getItem:()=> 'tetons'}).tour,'tetons');assert.equal(resolveRangeMode('?rangeTour=off',{getItem:()=> 'tetons'}).tour,null);assert.equal(resolveRangeMode('',{getItem:()=>{throw Error('blocked')}}).tour,null);
});
test('scene provider uses heard time, samples review paths, and disables extra camera moves',()=>{
 const tour={durationMs:10000,poseAt:t=>({eyeM:[t,100,0],targetM:[t,100,-1000],fovYDeg:35,tour:true})},view={tour};
 assert.deepEqual(scenePoseAt(view,{timeMs:1234}),tour.poseAt(1234));assert.equal(pathStations(view,3)[2].eyeM[0],10000);
 const pose=tour.poseAt(2000);assert.equal(applyCameraMoves(pose,{dolly:.5,yaw:.4},{zoom:2}),pose);
});

test('tour sky uses world directions across rear-facing turns', async () => {
 const {tourSkyDirection,projectSkyDirection,tourCloudBanks}=await import('../src/world/alpine/RangeSkyComposition.js');
 const pose={eyeM:[0,100,0],targetM:[0,100,-1000],fovYDeg:50};
 assert.equal(projectSkyDirection(pose,[0,0,1],16/9).visible,false);
 assert.equal(projectSkyDirection(pose,[0,0,-1],16/9).xFrac,.5);
 assert.ok(tourSkyDirection(90,0)[0]>.999);
 const a=tourCloudBanks({pose,width:1280,height:720,seed:12});
 const b=tourCloudBanks({pose:{...pose,targetM:[170,100,985]},width:1280,height:720,seed:12});
 assert.ok(a.length>0&&b.length>0);assert.notDeepEqual(a.map(c=>c.id),b.map(c=>c.id));
});

test('leaving tour mode cannot reuse a cancelled residency generation',async()=>{
 const {RangePresentation}=await import('../src/world/alpine/RangePresentation.js');
 const {GraphicsResidency}=await import('../src/render/GraphicsResidency.js');
 const residency=new GraphicsResidency({budgetBytes:10000000});
 const presentation=new RangePresentation({mode:'v2',residency});
 presentation.generation=4;residency.cancelGeneration(2);
 presentation.setSong({generation:2});
 assert.ok(residency.reserve({key:'ordinary-after-tour',bytes:10,owner:'test',generation:presentation.generation}));
 presentation.dispose();
});
