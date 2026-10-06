import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { rangeJourneyEnabled } from '../src/world/LandscapePresentation.js';
import { RangePresentation } from '../src/world/alpine/RangePresentation.js';
import {
  JOURNEY_VIEW, sampleJourneyState, journeyLakeShape, journeyNearShore, journeyFarShore,
} from '../src/world/alpine/JourneyWorld.js';
import { journeyGrid, journeyGridX, journeyForest, journeyWaterGeometry } from '../src/world/alpine/JourneyMaterial.js';
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
  const land=journeyGrid(THREE),bank=journeyGrid(THREE,512,24,8400),water=journeyWaterGeometry(THREE),forest=journeyForest(THREE,{});
  const triangles=2*land.index.count/3+bank.index.count/3+water.index.count/3+forest.geometry.attributes.position.count/3*forest.geometry.instanceCount;
  assert.ok(triangles<185000,`main scene terrain/forest triangles: ${triangles}`);
  for(const geometry of [land,bank,water,forest.geometry]){
    assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
    geometry.dispose();
  }
  forest.material.dispose();
});

test('moving lake tips stay on mesh vertices and shoreline interpolation stays subpixel',()=>{
  const camera=new THREE.PerspectiveCamera(JOURNEY_VIEW.camera.fovYDeg,16/9,1,16000);
  camera.position.fromArray(JOURNEY_VIEW.camera.eyeStartM);
  camera.lookAt(...JOURNEY_VIEW.camera.targetStartM);camera.updateMatrixWorld();
  const exactPixel=new THREE.Vector3(),meshPixel=new THREE.Vector3();
  const pixelError=(x,exactZ,meshZ)=>{
    exactPixel.set(x,0,exactZ).project(camera);
    meshPixel.set(x,0,meshZ).project(camera);
    return Math.hypot((exactPixel.x-meshPixel.x)*960,(exactPixel.y-meshPixel.y)*540);
  };
  const grids=[
    {name:'far',shore:journeyFarShore,columns:416,span:16000,tips:[78,338]},
    {name:'near',shore:journeyNearShore,columns:512,span:8400,tips:[96,416]},
  ].map(grid=>({...grid,geometry:journeyGrid(THREE,grid.columns,1,grid.span)}));
  let maximumError=0,worstCase='';
  try{
    // The original fixed grid missed the far tip by 18 m at seed 2917029651,
    // 250 ms. Adjacent playback frames, new coves and long seeks must retain
    // exact tip vertices as both the lake center and its breadth change.
    for(const seed of [0,73,1021,2917029651]){
      for(const timeMs of [0,250,250+1000/30,28000,60000,180000,43200000,172800000]){
        for(const energy01 of [0,1]){
          const state=sampleJourneyState({timeMs,seed,music:{energy01}}),lake=journeyLakeShape(state);
          for(const grid of grids){
            const uv=grid.geometry.getAttribute('uv');
            const xAt=index=>journeyGridX(uv.getX(index),lake,grid.span);
            grid.tips.forEach((index,side)=>{
              const x=xAt(index),expected=lake.centerX+(side?1:-1)*lake.halfWidthM;
              assert.ok(Math.abs(x-expected)<1e-9,`${grid.name} tip follows the moving basin`);
              assert.ok(Math.abs(journeyNearShore(x,state)-journeyFarShore(x,state))<1e-9,
                'the two terrain boundaries meet at the tip vertex');
            });
            for(let i=grid.tips[0];i<grid.tips[1];i++){
              const x0=xAt(i),x1=xAt(i+1),z0=grid.shore(x0,state),z1=grid.shore(x1,state);
              // Water clips per fragment; terrain interpolates the two edge
              // vertices. Measure their disagreement inside every shore edge.
              for(let sample=1;sample<10;sample++){
                const fraction=sample/10,x=x0+(x1-x0)*fraction;
                const error=pixelError(x,grid.shore(x,state),z0+(z1-z0)*fraction);
                if(error>maximumError){
                  maximumError=error;
                  worstCase=`${grid.name}, seed ${seed}, ${timeMs} ms, energy ${energy01}`;
                }
              }
            }
          }
        }
      }
    }
    assert.ok(maximumError<.5,`shoreline gap ${maximumError}px at 1920x1080 (${worstCase})`);
  }finally{
    for(const grid of grids)grid.geometry.dispose();
  }
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
