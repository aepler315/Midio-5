import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleJourneyDirection as sample } from '../src/world/alpine/JourneyDirection.js';

const sections=[
  {startMs:0,endMs:20000,provenance:'detected',relEnergy01:.2,motifId:'verse'},
  {startMs:20000,endMs:40000,provenance:'detected',relEnergy01:.85,motifId:'release'},
  {startMs:40000,endMs:60000,provenance:'detected',relEnergy01:.2,motifId:'verse'},
  {startMs:60000,endMs:80000,provenance:'detected',relEnergy01:.85,motifId:'release'},
];
const music={energy01:.8,pulse01:.9,sources:{midio:{activity:.8,pitchActivity:.7},broshi:{activity:.4,pitchActivity:0},midasus:{activity:.1,pitchActivity:.1}}};
const at=(timeMs,extra={})=>sample({timeMs,sections,durationMs:80000,music,...extra});
test('measured sections stage preparation, arrival, release and recovery deterministically',()=>{
  assert.equal(at(18000).phase,'build');
  assert.equal(at(21000).phase,'arrival');
  assert.equal(at(30000).phase,'sustain');
  assert.equal(at(42000).phase,'recovery');
  assert.ok(at(30000).cameraMove.dolly<0,'strong releases reveal the range');
  assert.deepEqual(at(30000).cameraMove,at(70000).cameraMove,'repeated motifs share related shots');
  const held=at(21000);at(70000);at(0);assert.deepEqual(at(21000),held);
});
test('quiet or missing evidence does not fabricate staging, and reduced motion freezes camera',()=>{
  const quiet=sample({timeMs:30000,durationMs:80000});
  assert.equal(quiet.phase,'quiet');assert.equal(quiet.intensity01,0);assert.equal(quiet.focusId,null);
  assert.equal(quiet.cameraMove.dolly,0);
  const reduced=at(30000,{reducedMotion:true});assert.equal(reduced.cameraMove.dolly,0);assert.equal(reduced.cameraMove.yaw,0);
  const decorative=sample({timeMs:30000,sections:sections.map(s=>({...s,provenance:'decorative'})),durationMs:80000});
  assert.equal(decorative.phase,'quiet');
});
test('camera envelopes are continuous at boundaries and do not follow individual pulses',()=>{
  for(const t of [15500,20000,23000,40000,46000]){
    const a=at(t-.1).cameraMove,b=at(t+.1).cameraMove;
    for(const key of ['dolly','yaw','crane','truck'])assert.ok(Math.abs(a[key]-b[key])<.0001,`${key} continuous at ${t}`);
  }
  const a=at(30000),b=at(30000,{music:{...music,pulse01:0}});
  assert.deepEqual(a.cameraMove,b.cameraMove,'pulse changes gestures, not camera');
  assert.ok(a.accent01>b.accent01);
  const focus=sample({timeMs:10000,durationMs:80000,sections:[sections[0]],music:{...music,energy01:.35}});
  assert.equal(focus.focusId,'midio');assert.ok(focus.cameraMove.dolly>0);
});

test('foreground camera push remains continuous when semantic focus enters',()=>{
  let previous=null;
  for(let pitchActivity=.35;pitchActivity<=.75;pitchActivity+=.001){
    const direction=sample({timeMs:10000,music:{energy01:.35,sources:{midio:{activity:.8,pitchActivity},midasus:{activity:.1,pitchActivity:.1}}}});
    if(previous)assert.ok(Math.abs(direction.cameraMove.dolly-previous.cameraMove.dolly)<.0005,'no push jump at focus threshold');
    previous=direction;
  }
});
test('overlapping strong phrases blend motif arcs when the dominant envelope changes',()=>{
  const overlapping=[{startMs:0,endMs:30000,provenance:'detected',relEnergy01:.9,motifId:'release'},
    {startMs:20000,endMs:50000,provenance:'detected',relEnergy01:.9,motifId:'bridge'}];
  const at=timeMs=>sample({timeMs,sections:overlapping,durationMs:60000,music});
  for(const t of [20000,23000,30000,30001,36000]){
    const a=at(t-.1),b=at(t+.1);
    for(const key of ['dolly','yaw','crane','truck'])assert.ok(Math.abs(a.cameraMove[key]-b.cameraMove[key])<.0001,`${key} smooth during phrase crossover`);
  }
});

test('continuous focus strengths preserve actor identity while easing through selection and ties',()=>{
  const at=(midio,midasus=.1)=>sample({music:{sources:{midio:{activity:.8,pitchActivity:midio},midasus:{activity:.8,pitchActivity:midasus}}}});
  const selected=at(.7);assert.ok(selected.focusStrength01>0);
  assert.equal(selected.focusById.midio,selected.focusStrength01);assert.equal(selected.focusById.midasus,0);
  const tie=at(.7,.7);assert.equal(tie.focusStrength01,0);
  assert.deepEqual(tie.focusById,{midio:0,broshi:0,midasus:0});
  const next=at(.1,.7);assert.equal(next.focusById.midasus,next.focusStrength01);
});
