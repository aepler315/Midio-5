import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { sceneUniforms } from '../src/world/alpine/TerrainMaterial.js';
import { CoveGL } from '../src/world/alpine/CoveGL.js';
import { JOURNEY_CAST_LAYOUT, sampleJourneyCast } from '../src/world/alpine/JourneyCast.js';
import { sampleJourneyState, journeyNearShore, journeyFarShore, journeyGroundHeight } from '../src/world/alpine/JourneyWorld.js';

const ids = ['midio', 'broshi', 'midasus'];
const actor = (snapshot, id) => snapshot.actors.find(value => value.id === id);
const silence = { energy01: 0, bass01: 0, melody01: 0, pulse01: 0, presence01: 0, bands: Array(7).fill(0) };
const song = (level = 1, pitch01 = .8, pitchActivity = level) => ({
  energy01: level, bass01: level * .7, melody01: level * .8, pulse01: level * .5, presence01: level,
  bands: Array(7).fill(level), sources: Object.fromEntries(ids.map(id => [id,
    { source: `lane:${id.toUpperCase()}`, activity: level, pitchActivity, pitch01 }])) });
const frame = (timeMs = 0, options = {}) => {
  const music = options.music ?? silence;
  const state = options.state ?? sampleJourneyState({ timeMs, music, seed: options.seed ?? 0 });
  return sampleJourneyCast({ timeMs, state, ...options, music });
};
const poses = snapshot => snapshot.actors.map(({ glow, activity, pitchActivity, pitch01, source, contributors, sharedSource, ...pose }) => pose);
const camera = new THREE.PerspectiveCamera(44, 640 / 360, .1, 10000);
camera.position.set(0, 155, 820); camera.lookAt(0, 125, -1200); camera.updateMatrixWorld();
const project = p => { const v = new THREE.Vector3(...p).project(camera); return [v.x * 320, v.y * 180]; };
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));

test('the three roots visibly travel at normal output size while fixed glyph sizes remain legible', () => {
  const start = frame(), one = frame(1000), four = frame(4000);
  assert.equal(start.active, true);
  assert.deepEqual(JOURNEY_CAST_LAYOUT.right, [1, 0, 0]);
  assert.deepEqual(JOURNEY_CAST_LAYOUT.forward, [0, 0, -1]);
  for (const id of ids) {
    assert.ok(distance(project(actor(start, id).positionM), project(actor(one, id).positionM)) > 6, `${id} moves >6px in a second`);
    assert.ok(distance(project(actor(start, id).positionM), project(actor(four, id).positionM)) > 20, `${id} moves >20px in four seconds`);
    assert.equal(actor(start, id).heightM, JOURNEY_CAST_LAYOUT.heights[id]);
    assert.equal(actor(four, id).heightM, actor(start, id).heightM);
    assert.ok(Object.isFrozen(actor(start, id).positionM));
  }
});

test('moving shores contain the swimmer and support the walker throughout full valley travel', () => {
  for (const seed of [0, 1, 71]) {
    for (let timeMs = 0; timeMs <= 240000; timeMs += 211) {
      const music = song(.5 + .5 * Math.sin(timeMs * .00041));
      const state = sampleJourneyState({ timeMs, seed, music });
      const snapshot = frame(timeMs, { state, music });
      const midio = actor(snapshot, 'midio'), broshi = actor(snapshot, 'broshi'), midasus = actor(snapshot, 'midasus');
      const [x, , z] = midio.positionM;
      assert.ok(z < journeyNearShore(x, state) - midio.heightM, 'swimmer clears near bank');
      assert.ok(z > journeyFarShore(x, state) + midio.heightM, 'swimmer clears far bank');
      assert.ok(Math.abs(midio.positionM[1]) < 4, 'swimmer remains buoyant at water surface');
      assert.equal(broshi.positionM[1], journeyGroundHeight(broshi.positionM[0], broshi.positionM[2], state));
      const inland = broshi.positionM[2] - journeyNearShore(broshi.positionM[0], state);
      assert.ok(inland >= 35 && inland <= 60, 'walker follows bank');
      assert.ok(midasus.positionM[1] > 35, 'flight remains above water');
      assert.ok(midasus.babies.every(baby => baby.positionM[1] > 15));
      assert.ok(Math.abs(broshi.turnRad) < .65, 'body remains legible while following forward ground velocity');
    }
  }
});

test('the walking gait transfers support between two feet on the actual bank', () => {
  let frontLift = 0, rearLift = 0;
  for (let timeMs = 3000; timeMs <= 6000; timeMs += 1000 / 60) {
    const state = sampleJourneyState({ timeMs });
    const broshi = actor(frame(timeMs, { state }), 'broshi');
    const lifts = broshi.footOffsetsM.map((foot, index) => {
      const base = (index === 0 ? 9 : -13) / 34 * broshi.heightM;
      const x = base + foot[0], z = foot[2], c = Math.cos(broshi.turnRad), s = Math.sin(broshi.turnRad);
      const worldX = broshi.positionM[0] + c * x - s * z;
      const worldZ = broshi.positionM[2] - s * x - c * z;
      return broshi.positionM[1] + foot[1] - journeyGroundHeight(worldX, worldZ, state);
    });
    assert.ok(lifts.every(lift => lift > -1e-7), 'feet never penetrate the bank');
    assert.ok(Math.min(...lifts) < 1e-7, 'one foot always bears weight');
    frontLift = Math.max(frontLift, lifts[0]); rearLift = Math.max(rearLift, lifts[1]);
  }
  assert.ok(frontLift > 5 && rearLift > 5, 'both feet make a visible swing');
});

test('supporting feet stay fixed in world space while the bank scrolls past the camera', () => {
  let previous, checked = 0;
  for (let timeMs = 3000; timeMs < 5000; timeMs += 1000 / 60) {
    const state = sampleJourneyState({ timeMs });
    const broshi = actor(frame(timeMs, { state }), 'broshi');
    const feet = broshi.footOffsetsM.map((foot, index) => {
      const phase = (broshi.stridePhase / (Math.PI * 2) + index * .5) % 1;
      const base = (index === 0 ? 9 : -13) / 34 * broshi.heightM;
      const x = base + foot[0], z = foot[2], c = Math.cos(broshi.turnRad), s = Math.sin(broshi.turnRad);
      return { phase, world: [broshi.positionM[0] + state.travelM + c * x - s * z,
        broshi.positionM[2] - s * x - c * z] };
    });
    if (previous) feet.forEach((foot, index) => {
      const old = previous[index];
      if (foot.phase < .61 && old.phase < foot.phase) {
        assert.ok(distance(foot.world, old.world) < 1e-7, 'supporting foot must not slide along the bank');
        checked++;
      }
    });
    previous = feet;
  }
  assert.ok(checked > 80, 'exercise multiple supports for both feet');
});

test('source pitch confidence steers distinct gestures without muting inertial envelopes', () => {
  const low = frame(7500, { music: song(.7, 0, 0) }), high = frame(7500, { music: song(.7, 1, 0) });
  assert.deepEqual(low.actors, high.actors, 'untrusted pitch must not steer any resident');
  const trustedLow = frame(7500, { music: song(.7, 0) }), trustedHigh = frame(7500, { music: song(.7, 1) });
  assert.ok(actor(trustedHigh, 'midasus').positionM[1] > actor(trustedLow, 'midasus').positionM[1]);
  assert.equal(actor(high, 'broshi').source, 'lane:BROSHI');
  assert.equal(actor(high, 'broshi').pitchActivity, 0);
  const residual = frame(7500, { music: { ...song(.7), activity01: 0 } });
  assert.equal(actor(residual, 'broshi').activity, .7, 'causal music survives obsolete physical-audibility gate');
  assert.ok(actor(high, 'midio').glow > actor(frame(7500), 'midio').glow);
});

test('held time and reverse seeks reconstruct roots, articulation, companions, and wakes exactly', () => {
  const music = song(.7), expected = frame(7350, { music });
  frame(98000, { music }); frame(700, { music });
  assert.deepEqual(frame(7350, { music }), expected);
  assert.deepEqual(frame(7350, { music }), expected);
  assert.ok(Object.isFrozen(expected) && Object.isFrozen(expected.swimmer.directionXZ));
});

test('reduced motion freezes roots and gait through changing music and terrain while reduced flash changes light only', () => {
  const early = frame(2700, { music: song(.2), reducedMotion: true });
  const late = frame(80000, { music: song(.9), reducedMotion: true });
  assert.deepEqual(poses(early), poses(late));
  assert.equal(early.swimmer.strength, 0);
  assert.deepEqual(early.waterResponse, { bass: 0, rhythm: 0, melody: 0, wake: 0 });
  assert.ok(actor(late, 'midio').glow > actor(early, 'midio').glow);
  const ordinary = frame(9600, { music: song() }), lowFlash = frame(9600, { music: song(), reducedFlash: true });
  assert.deepEqual(poses(ordinary), poses(lowFlash));
  assert.deepEqual(ordinary.swimmer, lowFlash.swimmer);
  for (const id of ids) assert.ok(actor(lowFlash, id).glow < actor(ordinary, id).glow);
});

test('sixty-Hz musical ramps keep the path and articulation continuous, even late in a song', () => {
  for (const startMs of [0, 3500000]) {
    let previous;
    for (let i = 0; i < 720; i++) {
      const timeMs = startMs + i * 1000 / 60;
      const level = .5 - .5 * Math.cos(i / 719 * Math.PI * 2);
      const snapshot = frame(timeMs, { music: song(level, .5 + .5 * Math.sin(i * .006)) });
      if (previous) for (const value of snapshot.actors) {
        const before = actor(previous, value.id);
        assert.ok(distance(value.positionM, before.positionM) < 1.6, `${value.id} continuous root`);
        for (const key of ['leanRad', 'turnRad', 'tailAngle', 'headAngle', 'jawOpen'])
          assert.ok(Math.abs(value[key] - before[key]) < .08, `${value.id} continuous ${key}`);
        if (value.footOffsetsM) value.footOffsetsM.forEach((foot, index) =>
          assert.ok(distance(foot, before.footOffsetsM[index]) < 3, 'smooth contact/swing transition'));
      }
      previous = snapshot;
    }
  }
});

const layout = {
  right: [1, 0, 0], forward: [0, 0, -1],
  anchors: { midio: [0, 0, 0], broshi: [-170, 4, 220], midasus: [160, 85, -20] },
  heights: { midio: 34, broshi: 45, midasus: 30 }, dressing: {},
};

test('walking contact follows Broshi through forward, held, and reverse poses', () => {
  const cove = new CoveGL(THREE, sceneUniforms(THREE, {}), layout);
  const at = (x, z, turnRad) => ({ actors: [{ id: 'broshi', positionM: [x, 7, z], heightM: 45, turnRad }] });
  try {
    const early = at(-135, 260, .3), late = at(-60, 280, -.2);
    for (const frame of [early, late, late, early]) {
      cove.update(frame);
      assert.deepEqual(cove.contact.uniforms.uRoot.value.toArray(), frame.actors[0].positionM);
      assert.equal(cove.contact.uniforms.uTurn.value, frame.actors[0].turnRad);
      assert.equal(cove.contact.mesh.visible, true);
    }
    cove.update({ actors: [] });
    assert.equal(cove.contact.mesh.visible, false, 'missing walker leaves no orphan contact shadow');
  } finally { cove.dispose(); }
});

test('localized foot articulation reaches color and both depth passes and resets for old cove poses', () => {
  const cove = new CoveGL(THREE, sceneUniforms(THREE, {}), layout);
  try {
    const broshi = { id: 'broshi', positionM: [-145, 5, 248], heightM: 45,
      footOffsetsM: [[-4, 0, 1], [5, 5, -1]], bodyLiftM: 1.5 };
    cove.update({ actors: [broshi] });
    const record = cove.actors.broshi, uniforms = record.uniforms;
    assert.deepEqual(uniforms.uFrontFoot?.value.toArray(), [-4, 0, 1]);
    assert.deepEqual(uniforms.uRearFoot?.value.toArray(), [5, 5, -1]);
    assert.equal(uniforms.uBodyLift?.value, 1.5);
    for (const pass of record.depth) {
      assert.equal(pass.material.uniforms.uFrontFoot, uniforms.uFrontFoot);
      assert.equal(pass.material.uniforms.uRearFoot, uniforms.uRearFoot);
      assert.equal(pass.material.uniforms.uBodyLift, uniforms.uBodyLift);
    }
    cove.update({ actors: [{ id: 'broshi', positionM: layout.anchors.broshi }] });
    assert.deepEqual(uniforms.uFrontFoot.value.toArray(), [0, 0, 0]);
    assert.deepEqual(uniforms.uRearFoot.value.toArray(), [0, 0, 0]);
    assert.equal(uniforms.uBodyLift.value, 0);
  } finally { cove.dispose(); }
});
