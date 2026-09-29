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

test('sky hierarchy: a secondary moon and sparse clouds that drift purely in time', async () => {
  const { rangeV2MoonRadius, rangeCloudBanks } = await import('../src/world/alpine/RangeSkyComposition.js');
  const R = rangeV2MoonRadius(1280, 1);
  assert.ok(Math.abs((2 * R) / 1280 - 0.035) < 0.002, 'about 3.5% of the width across');
  assert.ok(rangeV2MoonRadius(1280, 5) <= 1280 * 0.0175 * 1.25 + 1e-9, 'approach growth is capped');
  const a = rangeCloudBanks({ width: 1280, height: 720, tSec: 30, seed: 7, moon: { x: 150, y: 160, R } });
  const b = rangeCloudBanks({ width: 1280, height: 720, tSec: 30, seed: 7, moon: { x: 150, y: 160, R } });
  assert.deepEqual(a, b);
  assert.ok(a.length <= 8, 'sparse');
  const wisps = a.filter((k) => k.id.startsWith('wisp'));
  assert.equal(wisps.length, 2);
  for (const w of wisps) assert.ok(Math.abs(w.y - 160) < R, 'wisps cross the moon');
  const later = rangeCloudBanks({ width: 1280, height: 720, tSec: 31, seed: 7 });
  assert.ok(Math.abs(later[0].x - a[0].x) < 12, 'slow drift');
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
