import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildRangeHabitat, rangeHabitatCameraPose } from '../src/world/alpine/RangeHabitat.js';
import { rangeRailPose, applyCameraMoves, NEUTRAL_MOVE, USER_FX_MAX } from '../src/world/alpine/RangeCamera.js';
import { cameraBasis, cameraPoseAt, projectPoint, focalPx } from '../src/world/terrain/SceneTravel.js';
import { terrainHeightAt } from '../src/world/alpine/TerrainMesh.js';
import catalog from '../src/world/terrain/sceneCatalogData.js';
import { loadShippedTerrain } from '../tools/lib/range-exposure.mjs';

const view = catalog.views.find(v => v.id === 'muncho-lake-south');
const data = await loadShippedTerrain(fileURLToPath(new URL('../src/assets/range/v2/', import.meta.url)), view);
const habitat = buildRangeHabitat(data, view);

test('Muncho residents occupy the real water, wet gravel and air above the shore', () => {
  assert.equal(habitat?.id, 'muncho-cove');
  assert.equal(habitat.waterLevelM, 825);
  assert.equal(habitat.band, 'mid');
  for (const [id, anchor] of Object.entries(habitat.anchors)) {
    assert.equal(terrainHeightAt(data, anchor[0], anchor[2]), habitat.ground[id]);
    assert.ok(Object.isFrozen(anchor));
  }
  assert.equal(habitat.anchors.midio[1], habitat.waterLevelM);
  assert.ok(habitat.ground.broshi > habitat.waterLevelM && habitat.ground.broshi < habitat.waterLevelM + 1);
  assert.equal(habitat.anchors.broshi[1], habitat.ground.broshi);
  assert.ok(habitat.anchors.midasus[1] - habitat.ground.midasus >= 50);
  assert.ok(Object.isFrozen(habitat) && Object.isFrozen(habitat.heights) && Object.isFrozen(habitat.ground));
  assert.ok(Math.abs(Math.hypot(...habitat.forward) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...habitat.right) - 1) < 1e-12);
  assert.ok(Math.abs(habitat.forward.reduce((v, n, i) => v + n * habitat.right[i], 0)) < 1e-12);
});

test('missing or incompatible terrain cannot invent an inhabited cove', () => {
  assert.equal(buildRangeHabitat(null, view), null);
  assert.equal(buildRangeHabitat(data, { ...view, id: 'another-lake' }), null);
  assert.equal(buildRangeHabitat({ ...data, manifest: { ...data.manifest, viewId: 'another-lake' } }, view), null);
  assert.equal(buildRangeHabitat({ ...data, byIndex: new Map() }, view), null);
  assert.equal(buildRangeHabitat({ ...data, grid: { cellSizeM: 20 } }, view), null);
  assert.equal(buildRangeHabitat({ ...data, byIndex: {} }, view), null);
  const dry = new Map([...data.byIndex].map(([key, tile]) => [key, { ...tile, flowBytes: new Uint8Array(tile.flowBytes.length) }]));
  assert.equal(buildRangeHabitat({ ...data, byIndex: dry }, view), null, 'a lake-shaped heightfield without water evidence stays uninhabited');
  const missing = new Map([...data.byIndex].map(([key, tile]) => [key, { ...tile, heightsM: new Float32Array(tile.heightsM.length).fill(NaN) }]));
  assert.equal(buildRangeHabitat({ ...data, byIndex: missing }, view), null);
});

test('rocks, reeds and pine are separate natural roots on sampled gentle terrain', () => {
  const { rocks, reeds, pine } = habitat.dressing;
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  assert.ok(rocks.length >= 4 && reeds.length >= 4);
  for (const p of [...rocks, ...reeds, pine]) {
    const [x, y, z] = p.positionM;
    assert.equal(y, terrainHeightAt(data, x, z));
    const radius = p.radiusM || p.spreadM || p.widthM / 2;
    for (const [dx, dz] of [[-radius, 0], [radius, 0], [0, -radius], [0, radius]]) {
      assert.ok(Math.abs(terrainHeightAt(data, x + dx, z + dz) - y) / radius <= .25);
    }
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.positionM));
  }
  assert.ok(rocks.every(r => distance(r.positionM, habitat.anchors.broshi) < 40));
  assert.ok(reeds.filter(r => distance(r.positionM, habitat.anchors.midio) < 40).length >= 3);
  assert.ok(distance(pine.positionM, habitat.anchors.midasus) < 60);
  assert.ok(pine.positionM[1] + pine.heightM > habitat.anchors.midasus[1]);
  const pose = rangeHabitatCameraPose(view, .5);
  assert.ok(projectPoint(pose, 16 / 9, pine.positionM).depth < projectPoint(pose, 16 / 9, habitat.anchors.midasus).depth,
    'the pine can cross in front of the floating resident');
  assert.deepEqual(JSON.parse(JSON.stringify(habitat)), habitat, 'the layout stays serializable for diagnostics and export');
});

test('the cove rail keeps residents visible at different depths with stable world scale', () => {
  const first = rangeHabitatCameraPose(view, 0);
  for (let i = 0; i <= 40; i++) {
    const pose = rangeHabitatCameraPose(view, i / 40);
    assert.ok(Math.abs(cameraBasis(pose).forward[0] - cameraBasis(first).forward[0]) < 1e-12);
    assert.equal(pose.eyeM[1], first.eyeM[1]);
    const projected = {};
    for (const [id, point] of Object.entries(habitat.anchors)) {
      const q = projectPoint(pose, 16 / 9, point);
      projected[id] = q;
      assert.ok(q && Math.abs(q.x) < .8 && q.y > -.7 && q.y < .2, `${id} remains comfortably framed at ${i / 40}`);
      const heightPx = focalPx(pose.fovYDeg, 720) * habitat.heights[id] / q.depth;
      assert.ok(heightPx > 28 && heightPx < 75, `${id} reads as a resident at ${heightPx}px`);
    }
    assert.ok(projected.midio.depth < projected.broshi.depth);
    assert.ok(projected.broshi.depth < projected.midasus.depth);
    assert.ok(Math.abs(projected.midio.x - projected.broshi.x) > .3);
  }
  assert.notDeepEqual(first.eyeM, rangeHabitatCameraPose(view, 1).eyeM);
  assert.deepEqual(rangeHabitatCameraPose(view, -1), first);
  assert.deepEqual(rangeHabitatCameraPose(view, 2), rangeHabitatCameraPose(view, 1));
});

test('the entire cove rail and listener zoom clear geographic terrain', () => {
  for (let i = 0; i <= 40; i++) {
    const rail = rangeHabitatCameraPose(view, i / 40);
    assert.ok(rail.eyeM[1] - terrainHeightAt(data, rail.eyeM[0], rail.eyeM[2]) >= 140);
    for (const uy of [-.1, 0, .1]) {
      const pose = applyCameraMoves(rail, NEUTRAL_MOVE, { fx: USER_FX_MAX, rx: .04, uy }, {
        heightAt: (x, z) => terrainHeightAt(data, x, z), waterLevelM: habitat.waterLevelM,
        sampleStepM: data.grid.cellSizeM,
        heightRangeM: [data.manifest.boundsM.min[1], data.manifest.boundsM.max[1]],
      });
      const ground = Math.max(habitat.waterLevelM, terrainHeightAt(data, pose.eyeM[0], pose.eyeM[2]));
      assert.ok(Number.isFinite(ground) && pose.eyeM[1] - ground >= 70);
      assert.ok(pose.userScale > 0 && pose.userScale <= 1, 'zoom approaches the habitat while respecting ground clearance');
    }
  }
});

test('reduced motion holds the cove, seeking reconstructs it, and scenery-only keeps its authored camera', () => {
  const frame = { performance: true, progress01: .32 };
  const sampled = rangeRailPose(view, frame);
  rangeRailPose(view, { ...frame, progress01: .98 });
  rangeRailPose(view, { ...frame, progress01: .04 });
  assert.deepEqual(rangeRailPose(view, frame), sampled);
  assert.deepEqual(rangeRailPose(view, { ...frame, reducedMotion: true }),
    rangeRailPose(view, { ...frame, reducedMotion: true, progress01: .9 }));
  assert.deepEqual(rangeRailPose(view, { ...frame, performance: false }), cameraPoseAt(view, frame.progress01));
  assert.equal(rangeHabitatCameraPose({ ...view, id: 'another-lake' }, .5), null);
});

test('the living trio stays in the real wet cove and above the bank along its motion paths', async () => {
  const { sampleRangePerformance } = await import('../src/world/alpine/RangePerformance.js');
  const music = { activity01: 1, motionPresence01: 1, bassPressure01: 1,
    trioSources: Object.fromEntries(['midio', 'broshi', 'midasus'].map(id => [id, { activity: 1, pitchActivity: 1, pitch01: 0 }])) };
  for (let timeMs = 0; timeMs <= 60000; timeMs += 50) {
    music.kick01 = (Math.sin(timeMs * .012) + 1) / 2;
    const pose = sampleRangePerformance({ layout: habitat, music, timeMs });
    const [midio, broshi, midasus] = pose.actors;
    assert.equal(terrainHeightAt(data, midio.positionM[0], midio.positionM[2]), habitat.waterLevelM);
    assert.ok(Math.abs(midio.positionM[1] - habitat.waterLevelM) <= 5.6);
    assert.deepEqual(broshi.positionM, habitat.anchors.broshi);
    assert.ok(midasus.positionM[1] - terrainHeightAt(data, midasus.positionM[0], midasus.positionM[2]) > 30);
    for (const actor of pose.actors) {
      const q = projectPoint(rangeHabitatCameraPose(view, timeMs / 60000), 16 / 9, actor.positionM);
      assert.ok(q && Math.abs(q.x) < .9 && Math.abs(q.y) < .9, `${actor.id} remains framed`);
    }
  }
});
