import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { rangeJourneyEnabled } from '../src/world/LandscapePresentation.js';
import { RangePresentation } from '../src/world/alpine/RangePresentation.js';
import { JOURNEY_VIEW } from '../src/world/alpine/JourneyWorld.js';
import { journeyGrid, journeyForest, journeyWaterGeometry } from '../src/world/alpine/JourneyMaterial.js';
import { sceneCaptionFor } from '../src/ui/RangeCaption.js';
import { JourneyScene } from '../src/world/alpine/JourneyScene.js';

test('Auto performance selects the traveling valley while deliberate places remain available',()=>{
  assert.equal(rangeJourneyEnabled(),true);
  assert.equal(rangeJourneyEnabled({},'landscape'),false);
  assert.equal(rangeJourneyEnabled({viewId:'muncho-lake-south'}),false);
  assert.equal(rangeJourneyEnabled({biome:'DESERT'}),false);
  const p=new RangePresentation({mode:'v2',journey:true,forcedViewId:'muncho-lake-south'});
  p.setSong({generation:1});
  assert.equal(p.captionViewFor('DESERT'),JOURNEY_VIEW);
  assert.deepEqual(p._songViews(),[JOURNEY_VIEW]);
  const caption=sceneCaptionFor(JOURNEY_VIEW,{massif:{name:'Real massif'}},{title:'Real biome'});
  assert.deepEqual(caption.rows,[{label:'',name:'Moonlit Journey',region:''}]);
  assert.equal(caption.credit,'');assert.equal(caption.biome,null);
  p.setJourney(false);
  assert.equal(p.captionViewFor('DESERT').id,'muncho-lake-south');
  p.dispose();
});

test('an in-flight runtime cannot replace a newer scene selection or survive disposal',async()=>{
  let resolve,disposed=0;
  const p=new RangePresentation({mode:'v2',journey:true,sceneFactory:()=>new Promise(r=>{resolve=r;})});
  const pending=p._ensureRuntime();
  p.setJourney(false);
  resolve({dispose(){disposed++;}});
  await pending;
  assert.equal(disposed,1);assert.equal(p.scene,null);assert.equal(p.runtimeState,'idle');
  const another=p._ensureRuntime();p.dispose();
  resolve({dispose(){disposed++;}});await another;
  assert.equal(disposed,2);assert.equal(p.scene,null);
});

test('journey geometry fits the shipped runtime and bounded mesh budget',()=>{
  const land=journeyGrid(THREE),water=journeyWaterGeometry(THREE),forest=journeyForest(THREE,{});
  const triangles=3*land.index.count/3+water.index.count/3+forest.geometry.attributes.position.count/3*forest.geometry.instanceCount;
  assert.ok(triangles<100000,`main scene terrain/forest triangles: ${triangles}`);
  for(const geometry of [land,water,forest.geometry]){
    assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
    geometry.dispose();
  }
  forest.material.dispose();
});

test('listener zoom changes the journey camera and stays above its terrain',()=>{
  const frame={timeMs:30000,seed:315,scenicViewport:{logicalWidth:1408,logicalHeight:848,
    nominalWidth:1280,nominalHeight:720,overscanPx:64}};
  const pose=userCamera=>JourneyScene.prototype.movedPose(JOURNEY_VIEW,{...frame,userCamera}).pose;
  const rail=pose(null),zoom=pose({fx:.35,rx:.05,uy:-.01}),close=pose({fx:.95,rx:0,uy:-.5});
  assert.ok(zoom.eyeM[2]<rail.eyeM[2]-100);
  assert.ok(zoom.eyeM[0]>rail.eyeM[0]);
  assert.ok(close.eyeM[1]>0,'terrain clearance constrains the downward zoom');
  assert.ok(close.userScale<1);
});
