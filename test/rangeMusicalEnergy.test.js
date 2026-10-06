import test from 'node:test';
import assert from 'node:assert/strict';
import { RidgeMotionHistory } from '../src/world/RidgeMotionHistory.js';
import { sampleRangePerformance } from '../src/world/alpine/RangePerformance.js';
import { sampleFirmamentMusic } from '../src/world/alpine/RangeFirmament.js';
import { rangeMusicState, landMotion, calibrateRangeMusic, sceneDeformation, RANGE_MOTION_REFERENCE_M } from '../src/world/alpine/RangeFrame.js';

const layout = { anchors: { midio: [-700,825,-6220], broshi: [-520,825.1,-6080], midasus: [-380,890,-5940] },
  heights: { midio:28,broshi:35,midasus:22 }, right:[-1,0,0],forward:[0,0,1] };
const history = new RidgeMotionHistory({ durationMs: 5000, timeline: [
  { tMs:1000,durMs:800,vel:1,src:'midi',role:'RHYTHM',kick:true },
  { tMs:1000,durMs:800,vel:1,src:'midi',role:'BASS',pitch:40 },
  { tMs:1000,durMs:800,vel:1,src:'midi',role:'MELODY',pitch:84 },
] });
const pose = (timeMs,music=history.sample(timeMs),options={}) => sampleRangePerformance({layout,timeMs,music,...options});

test('a heard accent changes bodies within 160ms, rather than only their lights', () => {
  const hit = pose(1160), quiet = pose(1160,null);
  const [midio,broshi,midasus] = hit.actors, [m0,b0,s0] = quiet.actors;
  assert.ok(Math.abs(midio.leanRad-m0.leanRad)>.2,'Midio rolls into the beat');
  assert.ok(Math.hypot(...midio.positionM.map((v,i)=>v-m0.positionM[i]))>8,'Midio has a visible swim stroke');
  assert.ok(Math.abs(broshi.headAngle-b0.headAngle)>.2,'Broshi articulates on the accent');
  assert.ok(Math.abs(broshi.tailAngle-b0.tailAngle)>.2,'the tail carries the gesture');
  assert.deepEqual(broshi.positionM,layout.anchors.broshi,'feet stay grounded');
  assert.ok(midasus.positionM[1]-s0.positionM[1]>6,'Midasus rises through the melody');
  assert.ok(Math.abs(midasus.leanRad-s0.leanRad)>.25,'the star turns as it moves');
  const spatial = p => p.actors.map(({positionM,leanRad,turnRad,headAngle,tailAngle,babies}) =>
    ({positionM,leanRad,turnRad,headAngle,tailAngle,babies}));
  assert.deepEqual(spatial(pose(999)),spatial(pose(999,null)),'no anticipatory musical motion');
});

test('the aurora retains its light and receives the current beat, bass and melody separately', () => {
  const hit = sampleFirmamentMusic(history,1160), quiet = sampleFirmamentMusic(null,1160);
  assert.ok(hit.rhythm01>.5,'accents survive the phrase light filter');
  assert.ok(hit.bass01>.7,'bass reaches the curtain before a beat has elapsed');
  assert.ok(hit.melody01>.7,'melody reaches the curtain before a beat has elapsed');
  assert.equal(quiet.rhythm01,0);
  assert.ok(quiet.aurora01>=.36);
  sampleFirmamentMusic(history,4000);
  assert.deepEqual(sampleFirmamentMusic(history,1160),hit,'seek reconstructs the musical field');
});

test('performance land retains a visible accent while keeping the shore and geological cap', () => {
  const base={activity01:1,motionPresence01:1};
  const still=rangeMusicState(base), hit=rangeMusicState({...base,evaluatedKick01:1});
  const options={depthM:1000,heightRange:[0,2000],nominalHeight:720};
  const a=calibrateRangeMusic(landMotion(still,0,{performance:true}),options);
  const b=calibrateRangeMusic(landMotion(hit,0,{performance:true}),options);
  const pxPerMetre=360/Math.tan(20*Math.PI/180)/1000;
  const diff=Math.abs(sceneDeformation(b,900,400,2000,[0,2000])-sceneDeformation(a,900,400,2000,[0,2000]))*pxPerMetre;
  assert.ok(diff>3.5,`summit accent is only ${diff}px`);
  assert.equal(sceneDeformation(b,900,400,2000,[0,2000],0),0);
  const full=rangeMusicState({...base,env:{groove:1,sustain:1,scaleMul:1.3,kickMul:1,gesture:1},evaluatedKick01:1,melody:{activity:1,pitch01:1}});
  for(let m=0;m<=1;m+=.05){
    const land=landMotion(full,m,{performance:true});
    assert.ok(land.totalBoundM<=RANGE_MOTION_REFERENCE_M+1e-9);
    assert.equal(landMotion(full,m,{performance:true,reducedMotion:true}).totalBoundM,0);
  }
});
