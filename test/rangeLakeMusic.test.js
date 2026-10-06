import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import * as material from '../src/world/alpine/TerrainMaterial.js';
import * as sceneModule from '../src/world/alpine/RangeScene.js';
import { rangeMusicState, viewportState, buildRangeFrame } from '../src/world/alpine/RangeFrame.js';
import catalog from '../src/world/terrain/sceneCatalogData.js';
import { RidgeMotionHistory, createRidgeMusicSampler } from '../src/world/RidgeMotionHistory.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { LerpCache } from '../src/utils/color.js';
const { RangeScene } = sceneModule;

const originM = [1200, 820, -900];
const frame = { performance: true, timeMs: 1500, qualityLevel: 0,
  waterHits: [0, 1, 2, 3, 4, 5].map((i) => ({ tMs: 1000 - i * 100, strength: i ? .6 : 1 })) };
const bind = (u, f) => {
  assert.equal(typeof material.bindLakeMusic, 'function');
  material.bindLakeMusic(u, f, { originM });
  return u;
};

const kick = { tMs: 1000, durMs: 100, vel: 1, role: 'RHYTHM', kick: true, src: 'audio' };
function recording(rms = 1e-6) {
  const curves = new EnergyCurves(4000, 50);
  curves.bands.forEach(b => b.fill(.9));
  curves.rmsBands = curves.bands.map(b => new Float32Array(b.length).fill(rms));
  return curves;
}
function contactFrame(session, timeline = [kick], timeMs = 1080) {
  const profile = { name: 'TAIGA', sky: ['#102030', '#304050', '#607080'] };
  const sim = { presentation: { trioStage: true }, heardTimeMs: timeMs, songSeed: 42,
    biomes: { durationMs: 4000, _dayNightCycleMs: 6000, ridgeMusicSession: session,
      conductor: { timeline }, currentBlend: { from: 'TAIGA', to: 'TAIGA', t: 1 }, world: {},
      _profile: () => profile, _rotated: c => c, lerpCache: new LerpCache(), _airColor: '#556677' } };
  return buildRangeFrame({ frameId: 1, sim, pose: { worldX: 100, midioX: 400 } });
}

test('real RangeFrame and shader contacts reject recording noise suppressed by canonical activity', () => {
  const history = new RidgeMotionHistory({ energyCurves: recording(), timeline: [kick], durationMs: 4000 });
  const session = createRidgeMusicSampler({ primary: history });
  assert.equal(session.sample(1080).activity01, 0);
  assert.equal(session.sample(1080).kick01, 0);
  const snapshot = contactFrame(session);
  assert.equal(snapshot.music.activity01, 0);
  const u = bind(material.sceneUniforms(THREE, {}), snapshot);
  assert.ok(u.uLakeMusicHits.value.every(hit => hit.y === 0), 'noise-derived contacts cannot reach the real lake shader');
});

test('onset activity preserves the audible contact tail after recording silence', () => {
  const curves = recording(.0001);
  curves.rmsBands.forEach(b => b.fill(0, 53));
  const session = createRidgeMusicSampler({ primary: new RidgeMotionHistory({ energyCurves: curves, timeline: [kick], durationMs: 4000 }) });
  assert.ok(session.sample(1000).activity01 > .8);
  assert.equal(session.sample(1300).activity01, 0);
  const snapshot = contactFrame(session, [kick], 1300);
  const u = bind(material.sceneUniforms(THREE, {}), snapshot);
  assert.deepEqual(u.uLakeMusicHits.value[0].toArray(), [.3, session.sample(1000).activity01]);
});

test('later noise contacts cannot crowd an audible releasing ring out of the bounded hit list', () => {
  const curves = recording(.0001); curves.rmsBands.forEach(b => b.fill(0, 51));
  const timeline = [kick, ...Array.from({ length: 8 }, (_, i) => ({ ...kick, tMs: 1030 + i * 10 }))];
  const session = createRidgeMusicSampler({ primary: new RidgeMotionHistory({ energyCurves: curves, timeline, durationMs: 4000 }) });
  assert.ok(session.sample(1000).activity01 > .8);
  assert.equal(session.sample(1030).activity01, 0);
  const snapshot = contactFrame(session, timeline, 1200);
  assert.equal(snapshot.waterHits.length, 1, 'bound audible contacts after physical silence gating');
  const u = bind(material.sceneUniforms(THREE, {}), snapshot);
  assert.deepEqual(u.uLakeMusicHits.value[0].toArray(), [.2, session.sample(1000).activity01]);
});

test('authored MIDI contacts retain their strength at the zero-attack onset', () => {
  const midi = { ...kick, src: 'midi', vel: .8 };
  const session = createRidgeMusicSampler({ primary: new RidgeMotionHistory({ timeline: [midi], durationMs: 4000 }) });
  assert.equal(session.sample(1000).activity01, 0);
  const u = bind(material.sceneUniforms(THREE, {}), contactFrame(session, [midi]));
  assert.deepEqual(u.uLakeMusicHits.value[0].toArray(), [.08, .8]);
});

test('lake contact strength follows recorded canonical handoff at the onset and reconstructs after seek', () => {
  const previous = new RidgeMotionHistory({ energyCurves: recording(), timeline: [kick], durationMs: 4000, generation: 'opening' });
  const primary = new RidgeMotionHistory({ energyCurves: recording(.0001), timeline: [kick], durationMs: 4000, generation: 'final' });
  const session = createRidgeMusicSampler({ previous, primary, handoffStartMs: 800 });
  const expected = session.sample(1000).activity01;
  assert.ok(expected > .3 && expected < .4, 'the real handoff contributes a partial audible source');
  const u = bind(material.sceneUniforms(THREE, {}), contactFrame(session));
  assert.equal(u.uLakeMusicHits.value[0].y, expected);
  contactFrame(session, [kick], 3000); contactFrame(session, [kick], 500);
  bind(u, contactFrame(session));
  assert.equal(u.uLakeMusicHits.value[0].y, expected);
  const reconstructed = createRidgeMusicSampler({ previous, primary, handoffStartMs: 800 });
  assert.deepEqual(contactFrame(reconstructed).waterHits, contactFrame(session).waterHits);
});

test('lake impulse anchor remains on a real hydroflattened sample when the giant reflection stands on land', () => {
  assert.equal(typeof sceneModule.lakeMusicOrigin, 'function');
  const flowBytes = new Uint8Array(9).fill(252); flowBytes[4] = 255;
  const tile = { visible: true, ix: 0, iz: 0, stride: 1, samples: 3, flowBytes, heightsM: new Float32Array(9).fill(825) };
  const data = { grid: { originM: [0, 0], cellSizeM: 100 }, cells: 2, tiles: new Map([['wet', tile]]) };
  const shifted = { hasLake: true, centers: [[250, 825, 100]] };
  assert.deepEqual(sceneModule.lakeMusicOrigin(data, shifted, 825), [100, 825, 100]);
  assert.equal(sceneModule.lakeMusicOrigin(data, { ...shifted, hasLake: false }, 825), null);
});

test('geographic water receives bounded real hit age and strength in a fixed world position', () => {
  const u = bind(material.sceneUniforms(THREE, {}), frame);
  assert.equal(u.uLakeMusicHits.value.length, 4);
  assert.deepEqual(u.uLakeMusicHits.value[0].toArray(), [.5, 1]);
  assert.deepEqual(u.uLakeMusicOrigin.value.toArray(), [1200, -900]);
  assert.equal(u.uLakeMusicGain.value, 1);
  assert.ok(u.uLakeMusicHits.value.every(hit => hit.y >= 0 && hit.y <= 1));
});

test('low quality bounds hit cost while reduced motion and landscape disable geographic impulses', () => {
  const u = material.sceneUniforms(THREE, {});
  bind(u, { ...frame, qualityLevel: 6 });
  assert.equal(u.uLakeMusicHits.value.filter(hit => hit.y > 0).length, 2);
  bind(u, { ...frame, reducedFlash: true });
  assert.equal(u.uLakeMusicGain.value, .35);
  assert.ok(u.uLakeMusicHits.value[0].y > 0, 'reduced flash retains normal motion');
  for (const disabled of [{ ...frame, reducedMotion: true }, { ...frame, performance: false }]) {
    bind(u, disabled);
    assert.equal(u.uLakeMusicGain.value, 0);
    assert.ok(u.uLakeMusicHits.value.every(hit => hit.y === 0));
  }
});

test('seeking reconstructs lake uniforms and invalid contacts cannot leak into the shader', () => {
  const u = material.sceneUniforms(THREE, {});
  bind(u, frame);
  const expected = u.uLakeMusicHits.value.map(v => v.toArray());
  bind(u, { ...frame, timeMs: 5500 });
  bind(u, frame);
  assert.deepEqual(u.uLakeMusicHits.value.map(v => v.toArray()), expected);
  bind(u, { ...frame, waterHits: [{ tMs: NaN, strength: 1 }, { tMs: 1501, strength: 1 },
    { tMs: 1000, strength: Infinity }, { tMs: 1000, strength: -1 }] });
  assert.ok(u.uLakeMusicHits.value.every(hit => hit.y === 0 && Number.isFinite(hit.x)));
});

test('the production scene binds lake hits into the material used by every terrain partition', () => {
  const scene = Object.create(RangeScene.prototype);
  Object.assign(scene, { THREE, camera: new THREE.PerspectiveCamera(), mirrors: { A: null, B: null } });
  scene.camera.position.set(0, 1500, 10000);
  scene.camera.lookAt(0, 820, 0);
  scene.camera.updateMatrixWorld();
  const uniforms = material.sceneUniforms(THREE, { uHeightRange: { value: new THREE.Vector2(700, 2500) } });
  const prepared = { view: catalog.views.find(v => v.id === 'muncho-lake-south'), uniforms, waterLevelM: 820, lakeMusicOriginM: originM,
    giantLayout: { hasLake: true, centers: [[originM[0] + 150, originM[1], originM[2]], originM, originM], skyCenters: [originM, originM, originM],
      spans: [1000, 1000, 1000], skySpan: 1000, right: [1, 0, 0], forward: [0, 0, -1] } };
  const snapshot = { ...frame, progress01: .5, music: rangeMusicState({}),
    scenicViewport: viewportState({ logicalWidth: 1280, logicalHeight: 720, nominalHeight: 720 }),
    light: { night01: .8, celestial: { body: 'moon', intensity: .7, xFrac: .5, yFrac: .2, colorHex: '#aaccee' } } };
  scene._setUniforms(prepared, snapshot);
  assert.equal(uniforms.uLakeMusicCount.value, 4);
  assert.deepEqual(uniforms.uLakeMusicHits.value[0].toArray(), [.5, 1]);
  assert.deepEqual(uniforms.uLakeMusicOrigin.value.toArray(), [1200, -900]);
  scene._setUniforms(prepared, { ...snapshot, performance: false });
  assert.equal(uniforms.uLakeMusicGain.value, 0, 'the next presentation cannot keep the preceding ripple');
});

test('production lake ring helper has a bounded expanding response and expires in silence', () => {
  const helper = material.SCENE_FRAG.match(/float lakeRing\(float radius, float age, float strength\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(helper, 'the actual water shader exposes its ring envelope');
  const ring = new Function('radius', 'age', 'strength', 'clamp', helper[1]
    .replace(/\bfloat /g, 'let ').replace(/\bexp\(/g, 'Math.exp(').replace(/\babs\(/g, 'Math.abs(')
    .replace(/\bmax\(/g, 'Math.max(').replace(/\bclamp\(/g, 'clamp('));
  const fn = (radius, age, strength) => ring(radius, age, strength, (x, lo, hi) => Math.max(lo, Math.min(hi, x)));
  assert.equal(fn(200, -.1, 1), 0);
  assert.equal(fn(200, 2.1, 1), 0);
  assert.equal(fn(200, .5, 0), 0);
  let bestEarly = [0, 0], bestLate = [0, 0];
  for (let radius = 0; radius < 600; radius++) {
    const early = fn(radius, .1, 1), late = fn(radius, 1, 1);
    assert.ok(early >= 0 && early <= 1 && late >= 0 && late <= 1);
    if (early > bestEarly[1]) bestEarly = [radius, early];
    if (late > bestLate[1]) bestLate = [radius, late];
  }
  assert.ok(bestLate[0] > bestEarly[0], 'the contact expands across real water');
  assert.ok(bestLate[1] < bestEarly[1], 'the contact decays rather than accumulating');
});
