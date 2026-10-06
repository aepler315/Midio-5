import test from 'node:test';
import assert from 'node:assert/strict';
import * as camera from '../src/world/alpine/JourneyOrbitCamera.js';
import { sampleJourneyDirection } from '../src/world/alpine/JourneyDirection.js';
const view={tanX:.72,tanY:.404};
test('opening reveals the circle and returns to a steady rim composition',()=>{
  assert.equal(typeof camera.journeyOrbitCamera,'function');
  const opening=camera.journeyOrbitCamera({...view,timeMs:0});
  const follow=camera.journeyOrbitCamera({...view,timeMs:12000});
  assert.equal(opening.reveal01,1);
  assert.equal(follow.reveal01,0);
  assert.ok(opening.eyeM[2]>follow.eyeM[2]*5);
  assert.deepEqual(follow,camera.journeyOrbitCamera({...view,timeMs:120000}));
  const direction=pose=>pose.eyeM.map((v,i)=>(v-pose.targetM[i])/(pose.eyeM[2]-pose.targetM[2]));
  direction(opening).forEach((v,i)=>assert.ok(Math.abs(v-direction(follow)[i])<1e-10,'sky viewing orientation must stay fixed'));
});
test('portrait reveal retreats enough to fit and reduced motion keeps the rim still',()=>{
  const wide=camera.journeyOrbitCamera({...view,timeMs:0});
  const tall=camera.journeyOrbitCamera({tanX:.22,tanY:.404,timeMs:0});
  assert.ok(tall.eyeM[2]>wide.eyeM[2]);
  const a=camera.journeyOrbitCamera({...view,timeMs:0,reducedMotion:true});
  const b=camera.journeyOrbitCamera({...view,timeMs:32000,reducedMotion:true,direction:{orbitReveal01:1}});
  assert.deepEqual(a,b);
});
test('a detected arrival reveals the orbit briefly without following pulses',()=>{
  const input={sections:[{startMs:20000,endMs:60000,relEnergy01:.9,provenance:'detected'}],durationMs:90000};
  const at=timeMs=>sampleJourneyDirection({...input,timeMs});
  assert.ok(at(22000).orbitReveal01>.7);
  assert.equal(at(40000).orbitReveal01,0,'sustained choruses return to the cast');
  assert.deepEqual(at(22000).orbitReveal01,sampleJourneyDirection({...input,timeMs:22000,music:{pulse01:1}}).orbitReveal01);
});
