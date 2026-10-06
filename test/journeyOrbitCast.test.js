import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import * as cast from '../src/world/alpine/JourneyCast.js';
import { sampleJourneyState, journeyGroundHeight } from '../src/world/alpine/JourneyWorld.js';
import { sceneUniforms } from '../src/world/alpine/TerrainMaterial.js';
import { CoveGL } from '../src/world/alpine/CoveGL.js';

const R = 1800, C = Math.PI * 2 * R;
const near = (actual, expected, tolerance = 1e-8) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < tolerance,
    `axis ${axis}: ${value} should be ${expected[axis]}`));
};
const actor = (pose, id) => pose.actors.find(value => value.id === id);
const sample = (timeMs, options = {}) => {
  const state = sampleJourneyState({ timeMs, circular: true, ...options });
  return { state, pose: cast.sampleJourneyCast({ timeMs, state, ...options }) };
};
const footPoint = (broshi, index) => {
  const foot = broshi.footOffsetsM[index], base = (index === 0 ? 9 : -13) / 34 * broshi.heightM;
  const c = Math.cos(broshi.turnRad), s = Math.sin(broshi.turnRad);
  const local = [c * (base + foot[0]) - s * foot[2], foot[1], s * (base + foot[0]) + c * foot[2]];
  const basis = [broshi.right || [1, 0, 0], broshi.up || [0, 1, 0], broshi.forward || [0, 0, -1]];
  return broshi.positionM.map((value, axis) => value + local.reduce((sum, part, i) => sum + basis[i][axis] * part, 0));
};

test('circular cast anchors and companions follow their own radial bases while wake coordinates stay intrinsic', () => {
  assert.equal(typeof cast.journeyOrbitCast, 'function', 'the scene needs a pure cast projection');
  const latitude30 = 1000 * Math.PI, cos30 = Math.sqrt(3) / 2;
  const pose = { actors: [{ id: 'midio', heightM: 40, positionM: [C / 4, 10, latitude30] },
    { id: 'midasus', heightM: 36, positionM: [C / 2, 20, -latitude30],
      babies: [{ positionM: [-C / 4, 30, latitude30], heightM: 6, rotationRad: .2 }] }],
  swimmer: { positionM: [C / 4, 10, latitude30], directionXZ: [.8, .6], speedMps: 20, strength: .5 } };
  const converted = cast.journeyOrbitCast(pose);
  near(converted.actors[0].positionM, [1810 * cos30, -1800, 905]);
  near(converted.actors[0].right, [0, -1, 0]);
  near(converted.actors[0].up, [cos30, 0, .5]);
  near(converted.actors[0].forward, [.5, 0, -cos30]);
  near(converted.actors[1].positionM, [0, -1800 - 1820 * cos30, -910]);
  near(converted.actors[1].babies[0].positionM, [-1830 * cos30, -1800, 915]);
  near(converted.actors[1].babies[0].up, [-cos30, 0, .5]);
  assert.equal(converted.actors[0].heightM, 40, 'projecting the root must preserve actor scale');
  assert.deepEqual(converted.swimmer, pose.swimmer, 'the water shader samples the intrinsic lake');
  assert.deepEqual(pose.actors[0].positionM, [C / 4, 10, latitude30], 'projection leaves the intrinsic sample intact');
  assert.ok(Object.isFrozen(converted.actors[1].babies[0].up));
});

test('projected walking feet reconstruct the curved ground instead of following a tangent plane', () => {
  assert.equal(typeof cast.journeyOrbitCast, 'function');
  for (const timeMs of [0, 190, 370, 3020, 8700, 299000, 300000, 301000]) {
    const { state, pose } = sample(timeMs);
    const flat = actor(pose, 'broshi'), radial = actor(cast.journeyOrbitCast(pose), 'broshi');
    for (const index of [0, 1]) {
      const intrinsic = footPoint(flat, index), rendered = footPoint(radial, index);
      const angle = intrinsic[0] / R, latitude = intrinsic[2] * .30 / R, altitude = intrinsic[1];
      near(rendered, [(R + altitude) * Math.cos(latitude) * Math.sin(angle),
        (R + altitude) * Math.cos(latitude) * Math.cos(angle) - R, (R + altitude) * Math.sin(latitude)]);
      const phase = ((timeMs / 1000 + index * .38) / .76 % 1 + 1) % 1;
      if (phase <= .56) assert.ok(Math.abs(Math.hypot(rendered[0], rendered[1] + R, rendered[2]) - R
        - journeyGroundHeight(intrinsic[0], intrinsic[2], state)) < 1e-8, 'stance contact lands on the real radial surface');
    }
  }
});

test('circular silhouettes grow with their rigs while excursions tighten and flat sizes stay unchanged', () => {
  for (const timeMs of [0, 6000, 14000, 60000, 300000]) {
    const spherical = sample(timeMs).pose;
    const flat = cast.sampleJourneyCast({ timeMs });
    for (const [id, height, center] of [['midio', 64, 0], ['broshi', 72, -174], ['midasus', 57.6, 145]]) {
      const a = actor(spherical, id), b = actor(flat, id);
      assert.ok(Math.abs(a.heightM - height) < 1e-10, `${id} has a readable circular silhouette`);
      assert.equal(b.heightM, cast.JOURNEY_CAST_LAYOUT.heights[id], 'the old cove keeps its scale');
      assert.ok(Math.abs(a.positionM[0] - center - (b.positionM[0] - center) * .7) < 1e-10,
        `${id} keeps its path with a smaller excursion`);
    }
    const broshi = actor(spherical, 'broshi'), oldBroshi = actor(flat, 'broshi');
    assert.equal(broshi.bodyLiftM, oldBroshi.bodyLiftM * 1.6, 'weight transfer remains proportional');
    actor(spherical, 'midasus').babies.forEach((baby, i) =>
      assert.equal(baby.heightM, actor(flat, 'midasus').babies[i].heightM * 1.6));
  }
});

test('stance contacts remain attached to one longitude across a circumference crossing', () => {
  assert.equal(typeof cast.journeyOrbitCast, 'function');
  let low = 0, high = C / 37 * 1000;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (sampleJourneyState({ timeMs: mid }).travelM < C) low = mid; else high = mid;
  }
  const contacts = [high - 8, high, high + 8].map(timeMs => {
    const { state, pose } = sample(timeMs);
    const flat = actor(pose, 'broshi'), projected = actor(cast.journeyOrbitCast(pose), 'broshi');
    return { state, flat, projected, timeMs };
  });
  const index = [0, 1].find(index => contacts.every(({ timeMs }) => {
    const phase = ((timeMs / 1000 + index * .38) / .76 % 1 + 1) % 1;
    return phase > .02 && phase < .54;
  }));
  assert.notEqual(index, undefined, 'a foot is in stance through the crossing');
  const longitudes = contacts.map(({ state, projected }) => {
    const p = footPoint(projected, index);
    return Math.atan2(p[0], p[1] + R) * R + state.travelM;
  });
  assert.ok(Math.max(...longitudes) - Math.min(...longitudes) < 1e-7, 'the planted foot does not slide as travel wraps');
});

test('circular poses remain deterministic after seeks and reduced motion preserves circular geography', () => {
  assert.equal(typeof cast.journeyOrbitCast, 'function');
  const expected = cast.journeyOrbitCast(sample(7350, { seed: 71 }).pose);
  cast.journeyOrbitCast(sample(3500000, { seed: 71 }).pose);
  cast.journeyOrbitCast(sample(700, { seed: 71 }).pose);
  assert.deepEqual(cast.journeyOrbitCast(sample(7350, { seed: 71 }).pose), expected);
  const early = sample(2700, { seed: 71, reducedMotion: true });
  const late = sample(80000, { seed: 71, reducedMotion: true });
  assert.deepEqual(cast.journeyOrbitCast(early.pose).actors, cast.journeyOrbitCast(late.pose).actors);
  const broshi = actor(early.pose, 'broshi');
  assert.equal(broshi.positionM[1], journeyGroundHeight(broshi.positionM[0], broshi.positionM[2], early.state));
  assert.equal(early.pose.swimmer.strength, 0);
});

test('CoveGL shares radial bases and clipping with depth, companions and contact shadows then resets flat defaults', () => {
  const shared = sceneUniforms(THREE, {}), cove = new CoveGL(THREE, shared, cast.JOURNEY_CAST_LAYOUT);
  const flat = sample(7350).pose;
  const orbitPose = { actors: flat.actors.map(value => ({ ...value,
    right: [0, -1, 0], up: [1, 0, 0], forward: [0, 0, -1], orbitRadiusM: R,
    babies: value.babies?.map(baby => ({ ...baby, right: [-1, 0, 0], up: [0, -1, 0], forward: [0, 0, -1], orbitRadiusM: R })) })) };
  try {
    cove.update(orbitPose);
    for (const record of Object.values(cove.actors)) {
      assert.deepEqual(record.uniforms.uUp?.value.toArray(), [1, 0, 0]);
      assert.deepEqual(record.uniforms.uRight.value.toArray(), [0, -1, 0]);
      assert.equal(record.uniforms.uOrbitRadius?.value, R);
      for (const depth of record.depth) assert.equal(depth.material.uniforms, record.uniforms);
    }
    near(cove.contact.uniforms.uUp.value.toArray(), [1, 0, 0]);
    near(cove.contact.uniforms.uRight.value.toArray(), [0, -1, 0]);
    assert.equal(cove.contact.uniforms.uOrbitRadius.value, R);
    near(cove.actors.midasus.babies[0].uniforms.uUp.value.toArray(), [0, -1, 0]);
    assert.equal(cove.actors.midio.uniforms.uClipBelow, shared.uClipBelow);
    cove.update(flat);
    for (const record of [...Object.values(cove.actors), ...cove.actors.midasus.babies, cove.contact]) {
      near(record.uniforms.uUp.value.toArray(), [0, 1, 0]);
      near(record.uniforms.uRight.value.toArray(), [1, 0, 0]);
      assert.equal(record.uniforms.uOrbitRadius.value, 0, 'old cove poses restore world-height clipping');
    }
  } finally { cove.dispose(); }
});
