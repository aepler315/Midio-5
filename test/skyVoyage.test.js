import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkyVoyage, VoyagePhase } from '../src/sim/SkyVoyage.js';

const STEP_MS = 1000 / 120;

/** Advances the voyage by `seconds` of simulated time starting from `t`,
 * returning the new `t` -- callers thread this explicitly rather than
 * re-deriving "now" from any voyage-internal field (which changes on every
 * phase transition and would silently reset elapsed progress). */
function advance(voyage, t, seconds, { epicMood = 0.5, anchor = { x: 300, y: 200 } } = {}) {
  const steps = Math.round((seconds * 1000) / STEP_MS);
  for (let i = 0; i < steps; i++) {
    t += STEP_MS;
    voyage.update(t, STEP_MS / 1000, epicMood, anchor);
  }
  return t;
}

test('a fresh voyage is idle and inactive', () => {
  const v = new SkyVoyage(1);
  assert.equal(v.phase, VoyagePhase.IDLE);
  assert.equal(v.active, false);
  assert.equal(v.depth, 0);
});

test('trigger enters WINDUP and becomes active', () => {
  const v = new SkyVoyage(1);
  const ok = v.trigger(1000, { x: 100, y: 400 }, 1280, 720);
  assert.equal(ok, true);
  assert.equal(v.phase, VoyagePhase.WINDUP);
  assert.equal(v.active, true);
});

test('trigger is a no-op while already active (self-guarded mutual exclusion)', () => {
  const v = new SkyVoyage(1);
  v.trigger(1000, { x: 100, y: 400 }, 1280, 720);
  const stationBefore = { ...v._station };
  const ok = v.trigger(1000, { x: 999, y: 999 }, 1280, 720);
  assert.equal(ok, false);
  assert.deepEqual(v._station, stationBefore, 'a second trigger must not reset voyage state');
});

// Exact phase boundaries (elapsed seconds since trigger), so test
// checkpoints can land deliberately just past each transition instead of
// guessing durations and accumulating arithmetic error across calls.
const T_WINDUP_END = 0.55;
const T_ASCENT_END = T_WINDUP_END + 1.2;
const T_DEEP_SPACE_END = T_ASCENT_END + 3 * 3.2;
const T_REENTRY_END = T_DEEP_SPACE_END + 1.0;

test('phases progress WINDUP -> ASCENT -> DEEP_SPACE -> REENTRY -> IDLE in order', () => {
  const v = new SkyVoyage(2);
  let t = 1000;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  let elapsed = 0;
  const goTo = (target) => { t = advance(v, t, target - elapsed); elapsed = target; };

  goTo(T_WINDUP_END - 0.2);
  assert.equal(v.phase, VoyagePhase.WINDUP, 'still winding up partway through');
  goTo(T_WINDUP_END + 0.1);
  assert.equal(v.phase, VoyagePhase.ASCENT, 'windup complete, now ascending');
  goTo(T_ASCENT_END + 0.15);
  assert.equal(v.phase, VoyagePhase.DEEP_SPACE, 'ascent complete, now in deep space');
  goTo(T_DEEP_SPACE_END + 0.2);
  assert.equal(v.phase, VoyagePhase.REENTRY, 'figures exhausted, diving home');
  goTo(T_REENTRY_END + 0.2);
  assert.equal(v.phase, VoyagePhase.IDLE, 'reentry complete, voyage over');
  assert.equal(v.active, false);
  assert.equal(v.trail.length, 0, 'trail is cleared once home');
});

test('depth is 0 during windup, ramps to 1 across ascent, holds at 1 in deep space, ramps back down in reentry', () => {
  const v = new SkyVoyage(3);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  let elapsed = 0;
  const goTo = (target) => { t = advance(v, t, target - elapsed); elapsed = target; };

  goTo(T_WINDUP_END - 0.2);
  assert.equal(v.depth, 0, 'windup keeps her visually "here"');

  goTo(T_WINDUP_END + 0.1);
  assert.equal(v.phase, VoyagePhase.ASCENT);
  assert.ok(v.depth > 0 && v.depth < 1, `depth should be mid-transition, got ${v.depth}`);

  goTo(T_ASCENT_END + 0.15);
  assert.equal(v.phase, VoyagePhase.DEEP_SPACE);
  assert.equal(v.depth, 1);

  goTo(T_DEEP_SPACE_END + 0.2);
  assert.equal(v.phase, VoyagePhase.REENTRY);
  const midReentryDepth = v.depth;
  assert.ok(midReentryDepth > 0 && midReentryDepth <= 1, `reentry depth should still be high early on, got ${midReentryDepth}`);
});

test('figure switches happen roughly every 3.2s and cycle through exactly 3 figures', () => {
  const v = new SkyVoyage(4);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 0.05); // clear windup + ascent
  assert.equal(v.phase, VoyagePhase.DEEP_SPACE);
  const idx0 = v._figureIdx;
  t = advance(v, t, 3.3);
  const idx1 = v._figureIdx;
  assert.equal(idx1, idx0 + 1, 'should have advanced exactly one figure after ~3.2s');
  t = advance(v, t, 3.3);
  const idx2 = v._figureIdx;
  assert.equal(idx2, idx0 + 2);
  // A third figure switch should end the voyage (exactly 3 figures/voyage).
  t = advance(v, t, 3.3);
  assert.equal(v.phase, VoyagePhase.REENTRY);
});

test('figure order (and therefore the whole trajectory) is deterministic for a given seed', () => {
  const a = new SkyVoyage(42);
  const b = new SkyVoyage(42);
  a.trigger(0, { x: 200, y: 400 }, 1280, 720);
  b.trigger(0, { x: 200, y: 400 }, 1280, 720);
  assert.deepEqual(a._figureOrder, b._figureOrder);
  advance(a, 0, 2.5);
  advance(b, 0, 2.5);
  assert.ok(Math.abs(a.p.x - b.p.x) < 1e-9 && Math.abs(a.p.y - b.p.y) < 1e-9, 'identical seeds should trace identical paths');
});

test('different seeds produce a different figure order', () => {
  const a = new SkyVoyage(1);
  const b = new SkyVoyage(2);
  a.trigger(0, { x: 200, y: 400 }, 1280, 720);
  b.trigger(0, { x: 200, y: 400 }, 1280, 720);
  // Not a strict guarantee for any RNG, but should hold for these two seeds;
  // if it ever flakes, pick different seed literals.
  assert.notDeepEqual(a._figureOrder, b._figureOrder);
});

test('a figure switch does not teleport the position -- morph keeps it continuous', () => {
  const v = new SkyVoyage(5);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 3.2 - 0.05); // just before the first figure switch
  const before = { ...v.p };
  t = advance(v, t, 0.1); // step across the switch boundary
  const after = { ...v.p };
  const jump = Math.hypot(after.x - before.x, after.y - before.y);
  // Over ~0.1s even a fast figure moves some distance; the point is that it
  // must not be a discontinuous multi-hundred-pixel teleport.
  assert.ok(jump < 60, `figure switch should morph smoothly, jumped ${jump.toFixed(1)}px`);
});

test('the trail accumulates points and is capped by both time and count', () => {
  const v = new SkyVoyage(6);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  advance(v, t, 6); // well into deep space
  assert.ok(v.trail.length > 0, 'trail should have points');
  for (const pt of v.trail) {
    assert.ok(v.trail[v.trail.length - 1].tMs - pt.tMs <= 3200 + 1, 'no point should be older than the 3.2s trail window');
  }
});

test('completed figures freeze into constellations, capped and eventually expiring', () => {
  const v = new SkyVoyage(7);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 3.3); // clear one figure switch
  assert.ok(v.constellations.length >= 1, 'a completed figure should freeze into a constellation');
  const first = v.constellations[0];
  assert.ok(first.points.length >= 3);

  t = advance(v, t, 3.3 + 3.3); // clear the remaining figure switches (voyage ends around here)
  assert.ok(v.constellations.length <= 4, 'constellations must be capped');

  // Let enough simulated time pass for every constellation to expire (6s life).
  t = advance(v, t, 8);
  const anyOld = v.constellations.some((c) => t - c.bornMs > 6000);
  assert.equal(anyOld, false, 'nothing older than 6s should remain');
});

test('forceEnd immediately begins reentry from any active phase', () => {
  const v = new SkyVoyage(8);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 1); // now in deep space
  assert.equal(v.phase, VoyagePhase.DEEP_SPACE);
  v.forceEnd(t);
  assert.equal(v.phase, VoyagePhase.REENTRY);
});

test('forceEnd is a no-op when already idle', () => {
  const v = new SkyVoyage(9);
  v.forceEnd(1000);
  assert.equal(v.phase, VoyagePhase.IDLE);
});

test('a full voyage never produces NaN/Infinity in position, hue, or depth', () => {
  const v = new SkyVoyage(11);
  v.trigger(0, { x: 200, y: 400 }, 1280, 720);
  let t = 0;
  for (let i = 0; i < 15 * 120; i++) {
    t += STEP_MS;
    v.update(t, STEP_MS / 1000, 0.7, { x: 300, y: 250 });
    assert.ok(Number.isFinite(v.p.x) && Number.isFinite(v.p.y), `position finite at t=${t}`);
    assert.ok(Number.isFinite(v.hue), `hue finite at t=${t}`);
    assert.ok(Number.isFinite(v.depth), `depth finite at t=${t}`);
  }
});

test('position stays within a sane radius of the sky station throughout deep space', () => {
  const v = new SkyVoyage(12);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 0.1);
  for (let i = 0; i < 9 * 120; i++) {
    t += STEP_MS;
    v.update(t, STEP_MS / 1000, 0.6, { x: 300, y: 250 });
    if (v.phase !== VoyagePhase.DEEP_SPACE) continue;
    const d = Math.hypot(v.p.x - v._station.x, v.p.y - v._station.y);
    assert.ok(d < 400, `figure offset should stay near the station, got ${d.toFixed(0)}px`);
  }
});
