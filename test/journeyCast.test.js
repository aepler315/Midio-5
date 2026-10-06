import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { sceneUniforms } from '../src/world/alpine/TerrainMaterial.js';
import { CoveGL } from '../src/world/alpine/CoveGL.js';
import { JOURNEY_CAST_LAYOUT, sampleJourneyCast } from '../src/world/alpine/JourneyCast.js';
import { JOURNEY_VIEW, sampleJourneyState, journeyNearShore, journeyFarShore, journeyGroundHeight } from '../src/world/alpine/JourneyWorld.js';

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
camera.position.set(...JOURNEY_VIEW.camera.eyeStartM); camera.lookAt(...JOURNEY_VIEW.camera.targetStartM); camera.updateMatrixWorld();
const project = p => { const v = new THREE.Vector3(...p).project(camera); return [v.x * 320, v.y * 180]; };
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
const range = values => Math.max(...values) - Math.min(...values);
const feetAt = (broshi, state) => broshi.footOffsetsM.map((foot, index) => {
  const base = (index === 0 ? 9 : -13) / 34 * broshi.heightM;
  const x = base + foot[0], z = foot[2], c = Math.cos(broshi.turnRad), s = Math.sin(broshi.turnRad);
  const worldX = broshi.positionM[0] + c * x - s * z;
  const worldZ = broshi.positionM[2] - s * x - c * z;
  return { world: [worldX + state.travelM, worldZ],
    lift: broshi.positionM[1] + foot[1] - journeyGroundHeight(worldX, worldZ, state) };
});

test('the three roots visibly travel at normal output size while fixed glyph sizes remain legible', () => {
  const start = frame(), one = frame(1000), four = frame(4000);
  assert.equal(start.active, true);
  assert.deepEqual(JOURNEY_CAST_LAYOUT.right, [1, 0, 0]);
  assert.deepEqual(JOURNEY_CAST_LAYOUT.forward, [0, 0, -1]);
  for (const id of ids) {
    assert.ok(distance(project(actor(start, id).positionM), project(actor(one, id).positionM)) > 2, `${id} moves visibly in a second`);
    assert.ok(distance(project(actor(start, id).positionM), project(actor(four, id).positionM)) > 10, `${id} follows a visible path over four seconds`);
    assert.equal(actor(start, id).heightM, JOURNEY_CAST_LAYOUT.heights[id]);
    assert.equal(actor(four, id).heightM, actor(start, id).heightM);
    assert.ok(Object.isFrozen(actor(start, id).positionM));
  }
});

test('silence keeps continuous locomotion without automatic leaps, dives or broad rolls', () => {
  const samples = Array.from({ length: 1441 }, (_, i) => frame(i * 1000 / 60));
  const broshi = samples.map(snapshot => actor(snapshot, 'broshi'));
  const midio = samples.map(snapshot => actor(snapshot, 'midio'));
  const midasus = samples.map(snapshot => actor(snapshot, 'midasus'));
  assert.ok(range(broshi.map(value => value.bodyLiftM)) > .5, 'weight still transfers each stride');
  assert.ok(range(broshi.map(value => value.bodyLiftM)) < 3, 'quiet stride has restrained lift');
  assert.ok(range(broshi.map(value => value.tailAngle)) > .2, 'tail still counters locomotion');
  assert.ok(range(broshi.map(value => value.tailAngle)) < .7, 'quiet tail does not thrash');
  assert.ok(Math.max(...midio.map(value => value.positionM[1])) < 2, 'quiet swimmer stays at the surface');
  assert.ok(Math.min(...midio.map(value => value.positionM[1])) > -3, 'silence does not trigger dives');
  assert.ok(range(midio.map(value => value.strokeAngle)) > .35, 'strokes remain visible');
  assert.ok(range(midasus.map(value => value.positionM[0])) > 80, 'gliding remains visibly alive');
  assert.ok(range(midasus.map(value => value.leanRad)) < .9, 'quiet flight banks without broad rolls');
});

test('strong source activity earns substantially stronger gestures and believable water contact', () => {
  const quiet = [], loud = [];
  for (let timeMs = 0; timeMs < 24000; timeMs += 1000 / 60) {
    quiet.push(frame(timeMs)); loud.push(frame(timeMs, { music: song() }));
  }
  const extent = (snapshots, id, key) => range(snapshots.map(snapshot => actor(snapshot, id)[key]));
  assert.ok(extent(loud, 'broshi', 'tailAngle') > 1.7 * extent(quiet, 'broshi', 'tailAngle'));
  assert.ok(extent(loud, 'midasus', 'leanRad') > 2 * extent(quiet, 'midasus', 'leanRad'));
  const swimmers = loud.map(snapshot => actor(snapshot, 'midio'));
  assert.ok(Math.max(...swimmers.map(value => value.positionM[1])) > 10, 'earned leap clears the surface');
  assert.ok(Math.min(...swimmers.map(value => value.positionM[1])) < -6, 'earned dive submerges the swimmer');
  for (const snapshot of loud) if (actor(snapshot, 'midio').positionM[1] > 10)
    assert.ok(snapshot.swimmer.strength < .1, 'airborne swimmer has no substantial wake');
  assert.ok(quiet.every(snapshot => snapshot.swimmer.strength > .05), 'surface travel keeps a quiet wake');
});

test('phrase staging restrains recovery and reserves arrival accents for active musical sources', () => {
  const direction = { phase: 'arrival', intensity01: 1, accent01: 1, focusId: 'midio' };
  const recovery = { ...direction, phase: 'recovery', intensity01: .12, accent01: 0 };
  const idle = frame(2500), stagedIdle = frame(2500, { direction });
  assert.deepEqual(poses(stagedIdle), poses(idle), 'phrase labels alone cannot fabricate activity');
  const arrival = frame(2500, { direction, music: song() });
  const recovering = frame(2500, { direction: recovery, music: song() });
  assert.ok(actor(arrival, 'midio').positionM[1] > actor(recovering, 'midio').positionM[1] + 6);
  assert.ok(actor(recovering, 'midio').positionM[1] < 4, 'recovery returns to surface locomotion');
  const accented = frame(2500, { direction: { ...direction, accent01: 0 }, music: song() });
  assert.ok(actor(arrival, 'midio').strokeAngle !== actor(accented, 'midio').strokeAngle, 'arrival accent reaches articulation');
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
      assert.ok(Math.abs(x) < 220, 'swimmer remains in the open middle of the finite basin');
      assert.ok(midio.positionM[1] > -15 && midio.positionM[1] < 20, 'leaps and dives remain close to the lake');
      assert.equal(broshi.positionM[1], journeyGroundHeight(broshi.positionM[0], broshi.positionM[2], state));
      const inland = broshi.positionM[2] - journeyNearShore(broshi.positionM[0], state);
      assert.ok(inland >= 35 && inland <= 60, 'walker follows bank');
      assert.ok(midasus.positionM[1] > 35, 'flight remains above water');
      assert.ok(midasus.babies.every(baby => baby.positionM[1] > 15));
      assert.ok(Math.abs(broshi.turnRad) < .65, 'body remains legible while following forward ground velocity');
    }
  }
});

test('routine locomotion transfers weight with grounded alternating foot swings', () => {
  let frontLift = 0, rearLift = 0, plantedSamples = 0;
  for (let timeMs = 3000; timeMs <= 6000; timeMs += 1000 / 60) {
    const state = sampleJourneyState({ timeMs });
    const broshi = actor(frame(timeMs, { state }), 'broshi');
    const lifts = feetAt(broshi, state).map(foot => foot.lift);
    assert.ok(lifts.every(lift => lift > -1e-7), 'feet never penetrate the bank');
    assert.ok(lifts.every(lift => lift < 12), 'feet do not kick above the torso');
    assert.ok(Math.min(...lifts) < 1e-7, 'routine walking always retains ground support');
    assert.equal(broshi.contactOpacity, 1, 'supported weight keeps a firm contact shadow');
    plantedSamples++;
    frontLift = Math.max(frontLift, lifts[0]); rearLift = Math.max(rearLift, lifts[1]);
  }
  assert.ok(frontLift > 4 && rearLift > 4, 'both feet visibly clear the bank');
  assert.ok(plantedSamples > 175);
});

test('supporting feet stay fixed in world space while the bank scrolls past the camera', () => {
  let previous, checked = 0;
  for (let timeMs = 3000; timeMs < 5000; timeMs += 1000 / 60) {
    const state = sampleJourneyState({ timeMs });
    const broshi = actor(frame(timeMs, { state }), 'broshi');
    const feet = feetAt(broshi, state);
    if (previous) feet.forEach((foot, index) => {
      const old = previous[index];
      if (foot.lift < 1e-7 && old.lift < 1e-7) {
        assert.ok(distance(foot.world, old.world) < 1e-7, 'supporting foot must not slide along the bank');
        checked++;
      }
    });
    previous = feet;
  }
  assert.ok(checked > 70, 'exercise multiple supports for both feet');
});

test('planted feet stay fixed while musical envelopes change the basin width', () => {
  let previous, checked = 0;
  for (let i = 0; i < 120; i++) {
    const timeMs = 3000 + i * 1000 / 60, music = song(i / 119);
    const state = sampleJourneyState({ timeMs, music });
    const feet = feetAt(actor(frame(timeMs, { state, music }), 'broshi'), state);
    if (previous) feet.forEach((foot, index) => {
      if (foot.lift < 1e-7 && previous[index].lift < 1e-7) {
        assert.ok(distance(foot.world, previous[index].world) < 1e-7, 'a changing lake cannot drag the planted foot');
        checked++;
      }
    });
    previous = feet;
  }
  assert.ok(checked > 70);
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
  const music = song(.7), direction = { phase: 'arrival', intensity01: .8, accent01: .6, focusId: 'midio' };
  const expected = frame(7350, { music, direction });
  frame(98000, { music, direction }); frame(700, { music, direction });
  assert.deepEqual(frame(7350, { music, direction }), expected);
  assert.deepEqual(frame(7350, { music, direction }), expected);
  assert.ok(Object.isFrozen(expected) && Object.isFrozen(expected.swimmer.directionXZ));
});

test('reduced motion freezes roots and gait through changing music and terrain while reduced flash changes light only', () => {
  const early = frame(2700, { music: song(.2), reducedMotion: true });
  const late = frame(80000, { music: song(.9), reducedMotion: true,
    direction: { phase: 'arrival', intensity01: 1, accent01: 1, focusId: 'broshi' } });
  assert.deepEqual(poses(early), poses(late));
  assert.equal(early.swimmer.strength, 0);
  assert.deepEqual(early.waterResponse, { bass: 0, rhythm: 0, melody: 0, wake: 0 });
  assert.ok(actor(late, 'midio').glow > actor(early, 'midio').glow);
  const direction = { phase: 'sustain', intensity01: 1, accent01: .7, focusId: 'midasus' };
  const ordinary = frame(9600, { music: song(), direction });
  const lowFlash = frame(9600, { music: song(), direction, reducedFlash: true });
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
        assert.ok(distance(value.positionM, before.positionM) < 2.3, `${value.id} continuous root`);
        for (const key of ['leanRad', 'turnRad', 'tailAngle', 'headAngle', 'jawOpen', 'strokeAngle'])
          assert.ok(Math.abs(value[key] - before[key]) < .1, `${value.id} continuous ${key}`);
        if (value.footOffsetsM) value.footOffsetsM.forEach((foot, index) =>
          assert.ok(distance(foot, before.footOffsetsM[index]) < 4, 'smooth contact/swing transition'));
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
    late.actors[0].contactOpacity = .4;
    late.actors[0].contactScale = 1.2;
    for (const frame of [early, late, late, early]) {
      cove.update(frame);
      assert.deepEqual(cove.contact.uniforms.uRoot.value.toArray(), frame.actors[0].positionM);
      assert.equal(cove.contact.uniforms.uTurn.value, frame.actors[0].turnRad);
      assert.equal(cove.contact.uniforms.uShadowOpacity?.value, frame.actors[0].contactOpacity ?? 1);
      assert.equal(cove.contact.uniforms.uSize.value, frame.actors[0].contactScale ?? 1);
      assert.equal(cove.contact.mesh.visible, true);
    }
    cove.update({ actors: [] });
    assert.equal(cove.contact.mesh.visible, false, 'missing walker leaves no orphan contact shadow');
  } finally { cove.dispose(); }
});

test('swimming strokes reach color and both depth passes and reset for old cove poses', () => {
  const cove = new CoveGL(THREE, sceneUniforms(THREE, {}), layout);
  try {
    cove.update({ actors: [{ id: 'midio', positionM: [0, 4, 0], strokeAngle: .45 }] });
    const record = cove.actors.midio;
    assert.equal(record.uniforms.uStroke?.value, .45);
    for (const pass of record.depth) assert.equal(pass.material.uniforms.uStroke, record.uniforms.uStroke);
    cove.update({ actors: [{ id: 'midio', positionM: [0, 0, 0] }] });
    assert.equal(record.uniforms.uStroke.value, 0);
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

test('curved paths have bounded acceleration independent of live musical clock changes', () => {
  for (const startMs of [10000, 3500000]) {
    let last, velocity;
    for (let i = 0; i < 300; i++) {
      const timeMs = startMs + i * 1000 / 60;
      const current = frame(timeMs);
      if (last) for (const id of ids) {
        const a = actor(current, id).positionM, b = actor(last, id).positionM;
        const v = a.map((value, axis) => (value - b[axis]) * 60);
        if (velocity?.[id]) assert.ok(distance(v, velocity[id]) * 60 < (id === 'broshi' ? 65 : 40), `${id} purposeful acceleration`);
        (velocity ??= {})[id] = v;
      }
      last = current;
    }
    const state = sampleJourneyState({ timeMs: startMs });
    const quiet = frame(startMs, { state }), active = frame(startMs, { state, music: song() });
    for (const id of ids) {
      assert.equal(actor(quiet, id).positionM[0], actor(active, id).positionM[0], 'activity cannot reset spatial phase');
      assert.equal(actor(quiet, id).positionM[2], actor(active, id).positionM[2]);
    }
  }
});

test('phrase enum boundaries do not interrupt ongoing physical gestures', () => {
  const direction = { intensity01: .8, accent01: .15, focusId: 'midio' };
  for (const [before, after] of [['build', 'arrival'], ['arrival', 'sustain'], ['sustain', 'recovery']]) {
    const a = frame(2500, { music: song(), direction: { ...direction, phase: before } });
    const b = frame(2500, { music: song(), direction: { ...direction, phase: after } });
    assert.deepEqual(poses(a), poses(b), 'continuous numeric envelopes carry phrase preparation and recovery');
  }
});
