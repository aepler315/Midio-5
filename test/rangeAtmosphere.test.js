// Range v2 Task 13: valley mist and local light.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mistAmount, mistMask, mistParams, emitterStrength, MIST_GLSL, MIST_NOISE_M } from '../src/world/alpine/RangeAtmosphere.js';

const cam = [0, 1500, 0];
const params = { density: 4e-4, baseM: 480, heightM: 250, tSec: 12 };

test('zero density is the identity', () => {
  assert.equal(mistAmount(cam, [9000, 500, -12000], { ...params, density: 0 }), 0);
  assert.equal(mistAmount(cam, [9000, 500, -12000], {}), 0);
});

test('a nearer object on the same ray receives no more mist than one behind it', () => {
  for (const far of [[9000, 500, -12000], [-4000, 700, -8000], [2000, 480, -3000]]) {
    const whole = mistAmount(cam, far, params);
    for (const f of [0.2, 0.5, 0.8]) {
      const near = cam.map((c, i) => c + (far[i] - c) * f);
      assert.ok(mistAmount(cam, near, params) <= whole + 1e-12, `nearer point at ${f} gets more mist`);
    }
  }
});

test('mist settles in the valley: low rays gather far more than high ones', () => {
  let low = 0, high = 0;
  for (let k = 0; k < 20; k++) {
    const x = -8000 + k * 800;
    low += mistAmount(cam, [x, 500, -12000], params);
    high += mistAmount(cam, [x, 2600, -12000], params);
  }
  assert.ok(low > 4 * high, `valley ${low.toFixed(3)} vs summits ${high.toFixed(3)}`);
  assert.ok(low / 20 < 0.95, 'never a solid wall');
});

test('banks are irregular, not a uniform sheet', () => {
  const vals = [];
  for (let k = 0; k < 60; k++) vals.push(mistMask(k * 330, -k * 170, 0));
  assert.ok(Math.min(...vals) < 0.1 && Math.max(...vals) > 0.9);
});

test('drift is pure in heard time: pause holds it, seek reconstructs it', () => {
  const p = [6000, 520, -9000];
  const at = (t) => mistAmount(cam, p, { ...params, tSec: t });
  const first = at(42);
  at(100); at(3);
  assert.equal(at(42), first);
  assert.equal(at(42), at(42));
  // It does move with time: slowly (metres per second).
  assert.notEqual(mistMask(1000, 1000, 0), mistMask(1000, 1000, 400));
  assert.ok(Math.abs(mistMask(1000, 1000, 0) - mistMask(1000, 1000, 0.5)) < 0.02);
});

test('mist parameters follow the view: water level, wetness, calm', () => {
  const wet = mistParams({ rules: { wetness: 0.8 }, waterLevelM: 488, heightRange: [300, 2760] });
  const dry = mistParams({ rules: { wetness: 0.1 }, waterLevelM: 488, heightRange: [300, 2760] });
  assert.equal(wet.baseM, 488);
  assert.ok(wet.density > 4 * dry.density);
  assert.ok(mistParams({ rules: { wetness: 0.8 }, calm01: 1 }).density > mistParams({ rules: { wetness: 0.8 }, calm01: 0 }).density);
  assert.ok(Number.isFinite(mistParams({ heightRange: [300, 2760] }).baseM), 'no water: a valley-floor fallback');
});

test('a cloud sea floods the valley below a flat top that stays under the eye', () => {
  const view = { rules: { wetness: 0.5 }, waterLevelM: 800, heightRange: [750, 2300], cameraY: 2200 };
  const calm = mistParams(view);
  assert.equal(calm.fill, 0);
  assert.ok(calm.topM > 1e8, 'no top without a cloud sea');
  const full = mistParams({ ...view, sea01: 1 });
  assert.equal(full.fill, 1);
  assert.ok(full.topM > 800 && full.topM < 2200, `top ${full.topM} between floor and eye`);
  assert.ok(full.density > calm.density);
  assert.ok(mistParams({ ...view, sea01: 0.5 }).topM < full.topM, 'it rises as it fills');
  assert.equal(mistParams({ ...view, sea01: 1, cameraY: 700 }).fill, 0, 'never with the eye below the floor');
  // Looking down into it: thick below the top, clear above it.
  const p = { ...full, tSec: 0 };
  const cam = [0, 2200, 0];
  assert.ok(mistAmount(cam, [0, 900, -3000], p) > 0.8, 'the valley floor is under cloud');
  assert.ok(mistAmount(cam, [0, full.topM + 200, -1500], p) < mistAmount(cam, [0, 900, -1500], p) * 0.5, 'a peak above the top stands clear');
});

test('local light is bounded, softened for reduced flash and height', () => {
  const full = emitterStrength({});
  assert.ok(full > 0 && full <= 0.22);
  const rf = emitterStrength({ reducedFlash: true });
  assert.ok(rf > 0 && rf < full);
  assert.ok(emitterStrength({ airbornePx: 500 }) < full * 0.5);
  assert.ok(emitterStrength({ airbornePx: 500 }) > 0);
});

test('the shader twin uses the same constants', () => {
  for (const k of ['uMistTime * 1.6', 'uMistTime * 0.7', `${MIST_NOISE_M.toFixed(1)}`, 'smoothstep(0.35, 0.75, n)', '2.0 * (1.0 - s)']) {
    assert.ok(MIST_GLSL.includes(k), `GLSL lacks ${k}`);
  }
});

test('sky hierarchy: a secondary moon and sparse clouds that drift together, purely in time', async () => {
  const { rangeV2MoonRadius, rangeCloudBanks } = await import('../src/world/alpine/RangeSkyComposition.js');
  const R = rangeV2MoonRadius(1280, 1);
  assert.ok(Math.abs((2 * R) / 1280 - 0.035) < 0.002, 'about 3.5% of the width across');
  assert.ok(rangeV2MoonRadius(1280, 5) <= 1280 * 0.0175 * 1.25 + 1e-9, 'approach growth is capped');
  const a = rangeCloudBanks({ width: 1280, height: 720, tSec: 30, seed: 7 });
  const b = rangeCloudBanks({ width: 1280, height: 720, tSec: 30, seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(a.length <= 8, 'sparse');
  // One wind: every bank drifts the same way, slowly (a few px a second).
  const later = rangeCloudBanks({ width: 1280, height: 720, tSec: 31, seed: 7 });
  for (let i = 0; i < a.length; i++) {
    const dx = later[i].x - a[i].x;
    if (Math.abs(dx) > 100) continue; // wrapped round, off frame
    assert.ok(dx > 0 && dx < 5, `${a[i].id} moved ${dx}`);
  }
  // A camera swing and tilt carry the whole sky together.
  const panned = rangeCloudBanks({ width: 1280, height: 720, tSec: 30, seed: 7, panPx: 40, panYPx: -12 });
  for (let i = 0; i < a.length; i++) {
    const dx = panned[i].x - a[i].x;
    assert.ok(Math.abs(panned[i].y - a[i].y + 12) < 1e-9);
    if (Math.abs(dx) > 100) continue;
    assert.ok(Math.abs(dx - 40) < 1e-6, `${a[i].id} panned ${dx}`);
  }
});

test('fewer fog samples (the quality ladder) approximate the full integral and never exceed the full sample count', () => {
  // Single rays land on different puffs of the ~900 m mask; what must hold
  // is the amount of haze over the frame.
  const mean = (steps) => {
    let a = 0, n = 0;
    for (let x = -12000; x <= 12000; x += 1500) for (let z = -24000; z <= -2000; z += 1500) {
      for (const y of [500, 700, 1000]) { a += mistAmount(cam, [x, y, z], { ...params, steps }); n++; }
    }
    return a / n;
  };
  const full = mean(6);
  for (const steps of [4, 3, 2]) {
    const lite = mean(steps);
    assert.ok(Math.abs(lite / full - 1) < 0.05, `${steps} steps: frame haze ${lite.toFixed(4)} vs ${full.toFixed(4)}`);
  }
  const far = [9000, 500, -12000];
  // Asking for more than MIST_SAMPLES is the full integral, not more work.
  assert.equal(mistAmount(cam, far, { ...params, steps: 99 }), mistAmount(cam, far, params));
  // The shader bounds its loop the same way.
  assert.match(MIST_GLSL, /if \(float\(i\) >= n\) break;/);
  assert.match(MIST_GLSL, /od \*= uMistDensity \* L \/ n;/);
});

test('the sky turns with the camera: a far landmark and the clouds pan alike', async () => {
  const { skyTurn } = await import('../src/world/alpine/RangeSkyComposition.js');
  const { applyCameraMoves } = await import('../src/world/alpine/RangeCamera.js');
  const { cameraBasis, projectPoint } = await import('../src/world/terrain/SceneTravel.js');
  const rail = { eyeM: [0, 2000, 0], targetM: [0, 1000, 20000], fovYDeg: 40 };
  const ref = cameraBasis(rail).forward;
  const still = skyTurn(rail, ref);
  assert.ok(Math.abs(still.x) < 1e-9 && Math.abs(still.y) < 1e-9);
  // A star straight down the rail's view (clouds hang far beyond the land):
  // in NDC of any lens the turn lands where it does, sideways for a swing,
  // up the frame for a crane.
  const peak = rail.eyeM.map((v, i) => v + ref[i] * 1e8);
  for (const move of [{ yaw: 0.05 }, { crane: 0.03 }, { yaw: -0.04, crane: 0.02 }]) {
    const moved = applyCameraMoves(rail, { dolly: 0, yaw: 0, crane: 0, truck: 0, kind: 'orbit', ...move }, null);
    const turn = skyTurn(moved, ref);
    for (const fovYDeg of [18, 40]) {
      const tanY = Math.tan(fovYDeg * Math.PI / 360);
      const q = projectPoint({ ...moved, fovYDeg }, 16 / 9, peak);
      assert.ok(Math.abs(turn.x / (tanY * 16 / 9) - q.x) < 2e-3, `${JSON.stringify(move)} x at ${fovYDeg}`);
      assert.ok(Math.abs(turn.y / tanY - q.y) < 2e-3, `${JSON.stringify(move)} y at ${fovYDeg}`);
    }
    if (move.yaw) assert.ok(Math.abs(turn.x) > 0.01);
    if (move.crane) assert.ok(turn.y > 0.005, 'craning up tips the sky up the frame');
  }
});

test('the sky pan uses the scene\'s own moved pose and follows a late-joining view only as it fades in', async () => {
  const { RangePresentation } = await import('../src/world/alpine/RangePresentation.js');
  const { cameraBasis } = await import('../src/world/terrain/SceneTravel.js');
  const rail = { eyeM: [0, 2000, 0], targetM: [0, 1000, 20000], fovYDeg: 40 };
  // Each view's scene pose: A swung one way, B the other (as if lifted or
  // turned by the scene's own constraints).
  const swing = (yaw) => {
    const f = cameraBasis(rail).forward, c = Math.cos(yaw), s = Math.sin(yaw);
    return { ...rail, targetM: [rail.eyeM[0] + (f[0] * c - f[2] * s) * 2e4, rail.eyeM[1] + f[1] * 2e4, rail.eyeM[2] + (f[0] * s + f[2] * c) * 2e4] };
  };
  const proj = { fovYDeg: 40, aspect: 16 / 9 };
  const scene = { movedPose: (v) => ({ rail, proj, pose: swing(v.id === 'a' ? 0.04 : -0.04) }) };
  const frame = { cameraMove: { yaw: 0 }, scenicViewport: { logicalWidth: 1280, logicalHeight: 720 } };
  const pan = (seamP, incomingFade, incoming = { id: 'b' }) =>
    RangePresentation.prototype._skyPan.call({ scene, seamP, incomingFade }, { id: 'a' }, incoming, frame);
  const alone = pan(0.5, 1, null);
  assert.ok(Math.abs(alone.x) > 0.02, 'the scene pose drives the pan');
  assert.deepEqual(pan(0.5, 0), alone, 'a view that has just joined (still invisible) moves nothing');
  const half = pan(0.5, 1), end = pan(1, 1);
  assert.ok(Math.abs(half.x) < Math.abs(alone.x));
  assert.ok(Math.sign(end.x) === -Math.sign(alone.x), 'across the seam the pan is the incoming view\'s');
});
