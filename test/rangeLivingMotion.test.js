import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleRangePerformance } from '../src/world/alpine/RangePerformance.js';
const layout = { anchors: { midio: [-700,825,-6220], broshi: [-520,825.1,-6080], midasus: [-380,890,-5940] }, heights: { midio:28,broshi:35,midasus:22 }, right:[-1,0,0],forward:[0,0,1] };
const sample = (t, options={}) => sampleRangePerformance({layout,timeMs:t,...options});
const at = (p,id) => p.actors.find(a=>a.id===id);
test('residents have readable independent movement even without an assigned lead lane', () => {
  const a=sample(1000),b=sample(5000);
  assert.ok(Math.hypot(...at(a,'midio').positionM.map((v,i)=>v-at(b,'midio').positionM[i]))>3);
  assert.ok(Math.hypot(...at(a,'midasus').positionM.map((v,i)=>v-at(b,'midasus').positionM[i]))>6);
  assert.ok(Math.abs(at(a,'broshi').headAngle-at(b,'broshi').headAngle)>.05);
  assert.ok(Math.abs(at(a,'broshi').tailAngle-at(b,'broshi').tailAngle)>.15);
  assert.deepEqual(at(a,'broshi').positionM,layout.anchors.broshi);
  assert.deepEqual(at(b,'broshi').positionM,layout.anchors.broshi);
  assert.deepEqual(a.waterResponse,{bass:0,rhythm:0,melody:0,wake:0});
});
test('idle motion holds during reduced motion and reconstructs after reverse seek', () => {
  const first=sample(1000); sample(40000); assert.deepEqual(sample(1000),first);
  assert.deepEqual(sample(1000,{reducedMotion:true}).actors,sample(5000,{reducedMotion:true}).actors);
});
