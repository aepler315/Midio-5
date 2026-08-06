import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeStroke, resampleClosed, dftCoefficients, chainPoints, penPoint } from '../src/render/epicycles.js';
import { EpicycleShow } from '../src/render/EpicycleShow.js';
import { OrbitalDebris, GM_BASE, SOFTEN2 } from '../src/sim/OrbitalDebris.js';
import { ReactionDiffusion } from '../src/world/ReactionDiffusion.js';

function fakeEnergy(value) {
  return { globalEnergy: () => value, sample: () => value };
}

// --- Fourier epicycles ---

test('resampleClosed produces n uniformly spaced points along the path', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const out = resampleClosed(square, 40);
  assert.equal(out.length, 40);
  // Uniform arc-length: consecutive gaps all equal perimeter/n = 1.0.
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 1.0) < 1e-9);
  }
});

test('full-coefficient DFT reconstructs the input exactly at the sample nodes', () => {
  const blob = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return { x: Math.cos(a) * 30 + Math.cos(3 * a) * 6, y: Math.sin(a) * 22 };
  });
  const coeffs = dftCoefficients(blob); // no truncation
  for (let j = 0; j < blob.length; j++) {
    const p = penPoint(coeffs, j / blob.length);
    assert.ok(Math.abs(p.x - blob[j].x) < 1e-9, `x mismatch at node ${j}`);
    assert.ok(Math.abs(p.y - blob[j].y) < 1e-9, `y mismatch at node ${j}`);
  }
});

test('coefficients come sorted by magnitude, biggest circle first', () => {
  const stroke = closeStroke([{ x: -1, y: 0 }, { x: 0, y: -0.5 }, { x: 1, y: 0.3 }]);
  const coeffs = dftCoefficients(resampleClosed(stroke, 64), 20);
  for (let i = 1; i < coeffs.length; i++) assert.ok(coeffs[i].mag <= coeffs[i - 1].mag);
});

test('chainPoints ends at the same place penPoint computes', () => {
  const circle = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10 };
  });
  const coeffs = dftCoefficients(circle, 8);
  for (const t of [0, 0.25, 0.7]) {
    const chain = chainPoints(coeffs, t);
    const pen = penPoint(coeffs, t);
    const tip = chain[chain.length - 1];
    assert.ok(Math.abs(tip.x - pen.x) < 1e-12 && Math.abs(tip.y - pen.y) < 1e-12);
  }
});

test('EpicycleShow lifecycle: triggers, draws, expires', () => {
  const noop = () => {};
  const ctx = {
    save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, arc: noop, fill: noop,
    set globalAlpha(v) {}, set globalCompositeOperation(v) {},
    set strokeStyle(v) {}, set fillStyle(v) {}, set lineWidth(v) {},
  };
  const show = new EpicycleShow();
  assert.equal(show.active, null);
  show.trigger(1, 100, 100, 5000);
  assert.ok(show.active);
  show.draw(ctx, 5400); // mid-draw
  assert.ok(show.active);
  show.draw(ctx, 5000 + 1100 + 350 + 300 + 50); // past draw+hold+fade
  assert.equal(show.active, null);
});

// --- Orbital debris ---

test('a circular orbit stays near-circular under symplectic Euler', () => {
  const debris = new OrbitalDebris(1, { n: 1, damping: 0, pairGravity: false, recapture: false });
  const s = debris.shards[0];
  const r0 = 80;
  s.x = r0; s.y = 0;
  // Circular speed under the SOFTENED force law: v^2/r = GM*r/(r^2+eps^2)^1.5.
  s.vx = 0; s.vy = r0 * Math.sqrt(GM_BASE) / Math.pow(r0 * r0 + SOFTEN2, 0.75);
  const attractor = { x: 0, y: 0 };
  let rMin = Infinity, rMax = 0;
  for (let i = 0; i < 1200; i++) { // 10 seconds, ~4 orbits
    debris.update(1 / 120, attractor, 1);
    const r = Math.hypot(s.x, s.y);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
  }
  assert.ok(rMin > r0 * 0.8 && rMax < r0 * 1.25, `orbit drifted: [${rMin.toFixed(1)}, ${rMax.toFixed(1)}]`);
});

test('angular momentum direction is conserved for a pure central force', () => {
  const debris = new OrbitalDebris(2, { n: 1, damping: 0, pairGravity: false, recapture: false });
  const s = debris.shards[0];
  s.x = 90; s.y = 10; s.vx = -30; s.vy = 170;
  const sign0 = Math.sign(s.x * s.vy - s.y * s.vx);
  for (let i = 0; i < 2400; i++) {
    debris.update(1 / 120, { x: 0, y: 0 }, 1);
    assert.equal(Math.sign(s.x * s.vy - s.y * s.vx), sign0);
  }
});

test('Plummer softening keeps a head-on plunge finite', () => {
  const debris = new OrbitalDebris(3, { n: 1, damping: 0, pairGravity: false, recapture: false });
  const s = debris.shards[0];
  s.x = 120; s.y = 0; s.vx = 0; s.vy = 0; // dead drop straight through the center
  for (let i = 0; i < 2400; i++) {
    debris.update(1 / 120, { x: 0, y: 0 }, 1);
    assert.ok(Number.isFinite(s.x + s.y + s.vx + s.vy));
    assert.ok(Math.hypot(s.vx, s.vy) < 2000, `slingshot blew up: |v|=${Math.hypot(s.vx, s.vy)}`);
  }
});

test('escaped shards are recaptured near the attractor', () => {
  const debris = new OrbitalDebris(4, { n: 1 });
  const s = debris.shards[0];
  s.x = 5000; s.y = 5000; s.vx = 0; s.vy = 0;
  debris.update(1 / 120, { x: 0, y: 0 }, 1);
  assert.ok(Math.hypot(s.x, s.y) < 420, 'expected respawn within the capture radius');
});

// --- Gray-Scott reaction-diffusion ---

test('Gray-Scott concentrations stay clamped to [0,1] under regime sweeps', () => {
  const rd = new ReactionDiffusion(9);
  let t = 0;
  for (let i = 0; i < 600; i++) {
    rd.update(t, 1 / 120, fakeEnergy(i % 2 ? 0.9 : 0.1), 0);
    if (i % 60 === 0) rd.onKick();
    t += 8.33;
  }
  for (let i = 0; i < rd.u.length; i++) {
    assert.ok(rd.u[i] >= 0 && rd.u[i] <= 1);
    assert.ok(rd.v[i] >= 0 && rd.v[i] <= 1);
  }
});

test('Gray-Scott develops spatial structure from its seeds (variance well above zero)', () => {
  const rd = new ReactionDiffusion(5); // constructor warms up 400 iterations
  let mean = 0;
  for (let i = 0; i < rd.v.length; i++) mean += rd.v[i];
  mean /= rd.v.length;
  let variance = 0;
  for (let i = 0; i < rd.v.length; i++) variance += (rd.v[i] - mean) ** 2;
  variance /= rd.v.length;
  assert.ok(variance > 1e-4, `expected a live pattern, got variance ${variance}`);
});

test('an unseeded uniform Gray-Scott plate stays uniform (no spontaneous noise)', () => {
  const rd = new ReactionDiffusion(5);
  rd.u.fill(1); rd.v.fill(0);
  for (let i = 0; i < 100; i++) rd.step(0.0367, 0.0649);
  for (let i = 0; i < rd.v.length; i++) assert.equal(rd.v[i], 0);
});

// --- Drawings must finish -------------------------------------------------
//
// The show slot used to be assigned unconditionally, so a milestone arriving
// during a drawing wiped it mid-stroke. A full show is 1750ms (1100 of it
// actually drawing) and, under autoplay, five more clean landings can be
// earned in well under a second -- so the "5" being erased by the "10" was
// guaranteed by construction, not bad luck.

/** Minimal ctx stub: records nothing, tolerates everything. */
function stubCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get: (_t, k) => (k === 'canvas' ? { width: 1280, height: 720 } : noop),
    set: () => true,
  });
}

const SHOW_MS = 1750; // DRAW_MS 1100 + HOLD_MS 350 + FADE_MS 300

test('a milestone arriving mid-drawing does not replace the one in flight', () => {
  const show = new EpicycleShow();
  const ctx = stubCtx();
  assert.equal(show.trigger(0, 0, 0, 0), true, 'first one starts immediately');
  show.draw(ctx, 200);
  const first = show.active;
  assert.equal(show.trigger(1, 0, 0, 400), false, 'the second must not start yet');
  show.draw(ctx, 500);
  assert.equal(show.active, first, 'the first drawing survives untouched');
  assert.equal(show.active.idx, 0);
});

test('the waiting milestone starts once the first one finishes, from the top', () => {
  const show = new EpicycleShow();
  const ctx = stubCtx();
  show.trigger(0, 0, 0, 0);
  show.trigger(2, 0, 0, 400);
  show.draw(ctx, SHOW_MS + 10); // first expires; the queued one takes over
  assert.ok(show.active, 'the pending milestone is not lost');
  assert.equal(show.active.idx, 2);
  assert.equal(show.active.startMs, SHOW_MS + 10, 'restamped, so it draws in full');
  assert.equal(show.pending, null);
});

test('only one milestone ever waits, and the newest wins', () => {
  const show = new EpicycleShow();
  show.trigger(0, 0, 0, 0);
  show.trigger(1, 0, 0, 100);
  show.trigger(2, 0, 0, 200);
  assert.equal(show.pending.idx, 2, 'milestones are monotonic -- the latest supersedes');
});

test('every drawing gets its full draw window before anything replaces it', () => {
  // Hammer it with triggers at the rate a dense chart could actually produce
  // and assert nothing is ever cut short.
  const show = new EpicycleShow();
  const ctx = stubCtx();
  show.trigger(0, 0, 0, 0);
  let started = show.active.startMs;
  for (let t = 50; t < 6000; t += 50) {
    show.trigger(t % 3, 0, 0, t);
    show.draw(ctx, t);
    if (show.active && show.active.startMs !== started) {
      assert.ok(t - started >= SHOW_MS, `a drawing was replaced after only ${t - started}ms`);
      started = show.active.startMs;
    }
  }
});

test('a backward seek clears the drawing and anything queued behind it', () => {
  const show = new EpicycleShow();
  const ctx = stubCtx();
  show.trigger(0, 0, 0, 5000);
  show.trigger(1, 0, 0, 5100);
  show.draw(ctx, 2000); // scrubbed back before its own start
  assert.equal(show.active, null);
  assert.equal(show.pending, null, 'nothing stale left to surface later');
});
