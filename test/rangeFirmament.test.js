import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { sampleFirmamentMusic, CONSTELLATION_ART, reflectedSkyDirection } from '../src/world/alpine/RangeFirmament.js';
import { FirmamentGL, FIRMAMENT_BYTES, firmamentUniforms, FIRMAMENT_GLSL } from '../src/world/alpine/FirmamentGL.js';
test('aurora has a continuous floor and a causal release instead of isolated flashes',()=>{
  const times=[];
  const history={sample(t){ times.push(t); return {pressureEnergy01:t>=1000&&t<2200?1:0,motionMelody:{activity:0}}; }};
  const quiet=sampleFirmamentMusic(null,10000), loud=sampleFirmamentMusic(history,2100),release=sampleFirmamentMusic(history,2800);
  assert.ok(quiet.aurora01>=.35);
  assert.ok(loud.aurora01>quiet.aurora01+.15);
  assert.ok(release.aurora01>quiet.aurora01+.15);
  assert.ok(times.every(t=>t<=2800));
  assert.deepEqual(sampleFirmamentMusic(history,2100),loud);
});
test('constellation art populates both the visible sky and elevations above the screen',()=>{
  assert.ok(CONSTELLATION_ART.length>=6);
  assert.ok(CONSTELLATION_ART.some(a=>a.altitude>.35));
  assert.ok(CONSTELLATION_ART.filter(a=>a.altitude<.2).length>=3);
  for(const art of CONSTELLATION_ART){
    assert.ok(art.edges.length>=8);
    for(const edge of art.edges) assert.ok(edge.every(i=>art.points[i]?.every(Number.isFinite)));
  }
});
test('water reflects world directions above the screen without clamping a capture rectangle',()=>{
  const ray=[.1,-.5,.85], sky=reflectedSkyDirection(ray);
  assert.ok(sky[1]>.4);
  assert.ok(Math.abs(Math.hypot(...sky)-1)<1e-12);
  assert.ok(Math.abs(sky[0]/sky[2]-ray[0]/ray[2])<1e-12);
  assert.match(FIRMAMENT_GLSL,/firmamentStars/);
  assert.match(FIRMAMENT_GLSL,/constellationArt/);
  assert.doesNotMatch(FIRMAMENT_GLSL,/uBackdrop|gl_FragCoord|uViewProj/);
});
test('sky pass owns only its triangle/material and disposes them once',()=>{
  const sky=new FirmamentGL(THREE,firmamentUniforms(THREE));
  assert.ok(sky.mesh.geometry.attributes.position.array.byteLength<=FIRMAMENT_BYTES);
  let disposed=0;
  sky.mesh.geometry.addEventListener('dispose',()=>disposed++);
  sky.mesh.material.addEventListener('dispose',()=>disposed++);
  sky.dispose();sky.dispose();assert.equal(disposed,2);
});

test('performance sky bypasses and releases the old screen capture even when a mirror exists', async () => {
  const { RangeScene } = await import('../src/world/alpine/RangeScene.js');
  let released = 0;
  const scene = { releaseBackdrop() { released++; } };
  assert.equal(RangeScene.prototype.captureBackdrop.call(scene, null, null, { performance: true }), false);
  assert.equal(released, 1);
});

test('sky pass and water share the exact directional field and retain sky when the terrain mirror is disabled', async () => {
  const { SCENE_FRAG, sceneUniforms } = await import('../src/world/alpine/TerrainMaterial.js');
  const uniforms = sceneUniforms(THREE, {}), sky = new FirmamentGL(THREE, uniforms);
  try {
    assert.equal(sky.mesh.material.uniforms, uniforms);
    assert.ok(SCENE_FRAG.includes(FIRMAMENT_GLSL));
    assert.ok(sky.mesh.material.fragmentShader.includes(FIRMAMENT_GLSL));
    assert.match(SCENE_FRAG, /water && \(uMirrorAmount > 0\.0 \|\| uFullSky > \.5\)/);
  } finally { sky.dispose(); }
});
