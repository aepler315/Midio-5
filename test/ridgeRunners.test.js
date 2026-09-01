import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RidgeRunners, RUNNER_CAST } from '../src/world/RidgeRunners.js';
import { ridgeYAt } from '../src/world/SilhouetteGenerator.js';
import { DANCE_LAYERS, danceOffset } from '../src/world/MountainChoreo.js';

/** A fake silhouette strip with a known ridge profile. */
function fakeStrip(width = 2048, height = 320) {
  const n = width / 4 + 1;
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) heights[i] = 0.5 + 0.5 * Math.sin(i / 17);
  return { width, height, ridge: { heights, step: 4, baseline: 0.7, amplitude: 0.34, height } };
}

const DANCE = { tSec: 3, groove: 0.6, kick: 0, cfg: DANCE_LAYERS.L4, fever: 0 };

test('the cast is the trio: Midio, Broshi, and the star', () => {
  assert.deepEqual(RUNNER_CAST.map((c) => c.name), ['midio', 'broshi', 'midasus']);
});

test('runners sit exactly on the (dancing) ridge line', () => {
  const rr = new RidgeRunners(1);
  const strip = fakeStrip();
  const baseY = 400;
  const ps = rr.positionsAt(strip, 0, 1280, baseY, DANCE);
  assert.ok(ps.length > 0, 'someone must be on screen');
  for (const p of ps) {
    const localX = p.x; // scrollX=0: screen x IS strip x here (within one tile)
    const ridge = baseY + ridgeYAt(strip, ((localX % strip.width) + strip.width) % strip.width)
      + danceOffset(localX, DANCE.tSec, DANCE.groove, 0, DANCE.cfg, 0);
    assert.ok(p.y <= ridge + 0.001, 'feet never sink below the ridge');
    assert.ok(ridge - p.y < 14, `should hug the ridge, gap was ${ridge - p.y}px`);
  }
});

test('runners advance along the strip over time (they run, not drift with camera)', () => {
  const rr = new RidgeRunners(2);
  const strip = fakeStrip();
  const a = rr.positionsAt(strip, 0, 1e9, 0, { ...DANCE, tSec: 0 });
  const b = rr.positionsAt(strip, 0, 1e9, 0, { ...DANCE, tSec: 5 });
  // canvasW=1e9 keeps everyone visible so the arrays align by cast.
  assert.equal(a.length, b.length);
  let moved = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(b[i].x - a[i].x) > 20) moved++;
  assert.ok(moved >= a.length - 1, 'nearly every runner must cover ground in 5s');
});

test('a kick hop lifts runners off the ridge', () => {
  const rr = new RidgeRunners(3);
  const strip = fakeStrip();
  const flat = rr.positionsAt(strip, 0, 1e9, 0, { ...DANCE, kick: 0 });
  const hop = rr.positionsAt(strip, 0, 1e9, 0, { ...DANCE, kick: 1 });
  for (let i = 0; i < flat.length; i++) {
    // The dance itself also moves with kick; compare net including it: the
    // hop term is 13px on top of the shared bounce, so y must drop by more
    // than the strip's own kick bounce alone would.
    assert.ok(hop[i].y < flat[i].y - 8, 'kick must add a visible hop');
  }
});

test('fever speeds the run up', () => {
  const strip = fakeStrip();
  const cold = new RidgeRunners(4).positionsAt(strip, 0, 1e9, 0, { ...DANCE, tSec: 10, fever: 0 });
  const hot = new RidgeRunners(4).positionsAt(strip, 0, 1e9, 0, { ...DANCE, tSec: 10, fever: 1 });
  let diffs = 0;
  for (let i = 0; i < cold.length; i++) if (Math.abs(hot[i].x - cold[i].x) > 30) diffs++;
  assert.ok(diffs >= cold.length - 1, 'fever must visibly stretch the covered distance');
});

test('off-screen runners are culled against the canvas width', () => {
  const rr = new RidgeRunners(5);
  const strip = fakeStrip();
  const ps = rr.positionsAt(strip, 0, 200, 0, DANCE); // tiny viewport
  for (const p of ps) assert.ok(p.x >= -40 && p.x <= 240);
});

// Mountain overhaul Stage 1/2 fix: runners used to always read the ridge at
// scale=1 (ridgeYAt returns raw, unscaled strip pixels) while the range
// itself is drawn at `dh = strip.height * growthMul` -- so whenever orogeny
// growth, camera pull-back, or now per-section heightMul scales the range
// away from its baked height, the runners visibly drifted off the ridge
// they're supposed to be standing on. positionsAt's new `scale` param
// (BiomeManager passes the same scale _crestPoints computed for that exact
// strip that frame) fixes it: the ridge reading itself has to be scaled,
// not just baseY.
test('runners track a scaled range (growthMul != 1) -- the pre-existing drift bug', () => {
  // Compare the SAME runners (same seed, same tSec, so stride/hop/dance are
  // identical) at two different scales. Everything about positionsAt's
  // formula except the `ridgeYAt(...) * scale` term is scale-independent,
  // so the y delta between the two calls must equal exactly the delta that
  // term produces -- if the ridge reading were still hard-coded to scale=1
  // (the pre-existing bug), this delta would be ~0 instead, and runners
  // would visibly drift off a range drawn at anything but its baked height.
  const strip = fakeStrip();
  const baseY = 400;
  const scaleA = 0.85, scaleB = 1.25;
  const psA = new RidgeRunners(6).positionsAt(strip, 0, 1280, baseY, { ...DANCE, kick: 0 }, scaleA);
  const psB = new RidgeRunners(6).positionsAt(strip, 0, 1280, baseY, { ...DANCE, kick: 0 }, scaleB);
  assert.equal(psA.length, psB.length);
  assert.ok(psA.length > 0);
  for (let i = 0; i < psA.length; i++) {
    const localX = ((psA[i].x % strip.width) + strip.width) % strip.width;
    const expectedDelta = ridgeYAt(strip, localX) * (scaleB - scaleA);
    const actualDelta = psB[i].y - psA[i].y;
    assert.ok(Math.abs(actualDelta - expectedDelta) < 1,
      `runner ${i}: expected the scaled-ridge delta ${expectedDelta}, got ${actualDelta}`);
  }
});
