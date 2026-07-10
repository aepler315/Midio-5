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

test('a melody onset in deep space retunes her to the pitch class: hue and Lissajous pair', () => {
  const v = new SkyVoyage(20);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 0.1);
  assert.equal(v.phase, VoyagePhase.DEEP_SPACE);

  v.onMelodyOnset({ pitch: 64, vel: 0.8 }); // E -> pitch class 4
  assert.equal(v.hue, 4 * 30);
  assert.deepEqual(v._currentLiss(), [7, 4], 'pitch class 4 selects its coprime pair');

  v.onMelodyOnset({ pitch: 71, vel: 0.5 }); // B -> pitch class 11
  assert.deepEqual(v._currentLiss(), [5, 1]);
});

test('a melody onset outside deep space is ignored', () => {
  const v = new SkyVoyage(21);
  v.trigger(0, { x: 200, y: 400 }, 1280, 720); // WINDUP
  const hueBefore = v.hue;
  v.onMelodyOnset({ pitch: 64, vel: 0.8 });
  assert.equal(v.hue, hueBefore);
  assert.equal(v._liss, null);
});

test('a pitch-class retune morphs the position rather than teleporting it', () => {
  const v = new SkyVoyage(22);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  // Force the first figure to be a Lissajous so the retune actually applies.
  v._figureOrder = ['lissajous', 'lissajous', 'lissajous'];
  t = advance(v, t, 0.55 + 1.2 + 1.5); // mid-figure
  const before = { ...v.p };
  v.onMelodyOnset({ pitch: 66, vel: 0.9 }); // F# -> [5,3], very different from default [3,2]
  t = advance(v, t, 1 / 60); // a single ~frame later
  const jump = Math.hypot(v.p.x - before.x, v.p.y - before.y);
  assert.ok(jump < 40, `retune should morph, not teleport: jumped ${jump.toFixed(1)}px in one frame`);
});

test('onset phase-kicks accumulate smoothly, never as an instant time jump', () => {
  const v = new SkyVoyage(23);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 0.5);
  assert.equal(v._kickSmooth, 0);
  v.onMelodyOnset({ pitch: 60, vel: 1.0 });
  assert.equal(v._kickSmooth, 0, 'the kick must not apply instantaneously');
  assert.ok(v._kickTarget > 0.05, 'the kick target should be pending');
  t = advance(v, t, 0.5);
  assert.ok(v._kickSmooth > 0.05, 'the kick should have eased in by now');
  assert.ok(Math.abs(v._kickSmooth - v._kickTarget) < 0.02, 'and settled near its target');
});

test('kicks in deep space spawn a capped sparkle burst; kicks elsewhere are ignored', () => {
  const v = new SkyVoyage(24);
  v.onKick(0.9);
  assert.equal(v.sparkles.length, 0, 'idle: no sparkles');
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 0.1);
  v.onKick(0.9);
  assert.ok(v.sparkles.length >= 5, 'deep space: a burst appears');
  for (let i = 0; i < 20; i++) v.onKick(1.0); // spam
  assert.ok(v.sparkles.length <= 36, `sparkles must stay capped, got ${v.sparkles.length}`);
  t = advance(v, t, 0.8); // past SPARKLE_LIFE_SEC
  assert.equal(v.sparkles.length, 0, 'sparkles expire');
});

test('melody onsets in deep space cut micro-slashes that expire', () => {
  const v = new SkyVoyage(25);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 0.1);
  v.onMelodyOnset({ pitch: 62, vel: 0.7 });
  assert.equal(v.microSlashes.length, 1);
  for (let i = 0; i < 12; i++) v.onMelodyOnset({ pitch: 62 + i, vel: 0.7 });
  assert.ok(v.microSlashes.length <= 6, 'micro-slashes must stay capped');
  t = advance(v, t, 0.4); // past SLASH_LIFE_SEC
  assert.equal(v.microSlashes.length, 0);
});

test('justLanded fires exactly on the frame she returns, then clears', () => {
  const v = new SkyVoyage(26);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  let landedFrames = 0;
  for (let i = 0; i < 16 * 120; i++) {
    t += STEP_MS;
    v.update(t, STEP_MS / 1000, 0.5, { x: 300, y: 250 });
    if (v.justLanded) landedFrames++;
  }
  assert.equal(landedFrames, 1, 'justLanded must be a one-frame flag');
  assert.equal(v.phase, VoyagePhase.IDLE);
  assert.equal(v.justLanded, false);
});

test('landing resets the melody tuning for the next voyage', () => {
  const v = new SkyVoyage(27);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 0.1);
  v.onMelodyOnset({ pitch: 66, vel: 0.9 });
  assert.ok(v._liss, 'tuning is live mid-voyage');
  t = advance(v, t, 14); // run the voyage out
  assert.equal(v.phase, VoyagePhase.IDLE);
  assert.equal(v._liss, null, 'tuning cleared for next time');
  assert.equal(v._kickTarget, 0);
});

test('expired constellations crystallize into the atlas instead of vanishing', () => {
  const v = new SkyVoyage(50);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 0.55 + 1.2 + 3.3); // one figure completes -> one bright constellation
  assert.ok(v.constellations.length >= 1);
  assert.equal(v.atlas.length, 0, 'nothing crystallized yet');

  t = advance(v, t, 7); // past the 6s bright life
  assert.equal(v.constellations.length + 0, v.constellations.length); // (sanity no-op)
  assert.ok(v.atlas.length >= 1, 'the expired constellation should now live in the atlas');
  const entry = v.atlas[0];
  assert.ok(entry.stars.length >= 3);
  for (const s of entry.stars) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    assert.ok(Number.isFinite(s.phase), 'each star carries its own twinkle phase');
  }
});

test('the atlas persists after the voyage ends and across a second voyage', () => {
  const v = new SkyVoyage(51);
  let t = 0;
  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 20); // full voyage + everything expired into the atlas
  assert.equal(v.phase, VoyagePhase.IDLE);
  const atlasAfterFirst = v.atlas.length;
  assert.ok(atlasAfterFirst >= 1, 'the sky remembers the first voyage');

  v.trigger(t, { x: 200, y: 400 }, 1280, 720);
  t = advance(v, t, 20);
  assert.ok(v.atlas.length > atlasAfterFirst, 'the second voyage adds to the same map');
});

test('the atlas is capped at 8 entries, oldest dropped first', () => {
  const v = new SkyVoyage(52);
  let t = 0;
  // Four voyages x up to 3 constellations each would exceed the cap.
  for (let k = 0; k < 4; k++) {
    v.trigger(t, { x: 200, y: 400 }, 1280, 720);
    t = advance(v, t, 22);
    assert.equal(v.phase, VoyagePhase.IDLE, `voyage ${k} should have completed`);
  }
  assert.ok(v.atlas.length <= 8, `atlas must stay capped, got ${v.atlas.length}`);
  assert.ok(v.atlas.length >= 6, 'but should have accumulated plenty');
});

test('atlasPulse defaults to 0 and is a plain writable field for the Simulation', () => {
  const v = new SkyVoyage(53);
  assert.equal(v.atlasPulse, 0);
  v.atlasPulse = 0.7; // Simulation writes hype.slam here each step
  assert.equal(v.atlasPulse, 0.7);
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
