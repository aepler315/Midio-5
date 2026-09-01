import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfGovernor, MAX_LEVEL, resolvePerfStartLevel } from '../src/render/PerfGovernor.js';

function feedFrames(gov, n, deltaMs, startMs = 0, stepMs = 16.6) {
  let t = startMs;
  for (let i = 0; i < n; i++) { gov.sample(deltaMs, t); t += stepMs; }
  return t;
}

test('stays at level 0 under a healthy frame budget', () => {
  const gov = new PerfGovernor();
  feedFrames(gov, 200, 10);
  assert.equal(gov.level, 0);
  assert.equal(gov.visionAllowed, true);
  assert.equal(gov.particleMul, 1);
  assert.equal(gov.crackGlowEnabled, true);
  assert.equal(gov.bloomEnabled, true);
  assert.equal(gov.veilEnabled, true);
  assert.equal(gov.rimLightEnabled, true);
  assert.equal(gov.contactShadowsEnabled, true);
});

test('sheds one rung after sustained over-budget frames, in spec order', () => {
  const gov = new PerfGovernor();
  // deltaMs=20 is 20/15 of budget -- with severity-weighted shedding this
  // crosses the threshold at frame 45, not 60 (see the scaled-shedding
  // tests below for the "barely over budget still takes ~1s" case).
  feedFrames(gov, 44, 20);
  assert.equal(gov.level, 0, 'should not shed before the sustained-severity threshold');
  feedFrames(gov, 1, 20);
  assert.equal(gov.level, 1);
  assert.equal(gov.visionAllowed, false, 'vision loop sheds first');
  assert.equal(gov.particleMul, 1, 'particles untouched at level 1');
  assert.equal(gov.rimLightEnabled, true, 'rim light untouched at level 1');
  assert.equal(gov.contactShadowsEnabled, true, 'contact shadows untouched at level 1');
});

test('rim light sheds at level 2 alongside the particle cap; contact shadows survive one rung longer', () => {
  const gov = new PerfGovernor();
  feedFrames(gov, 120, 20); // two shed rungs -> level 2
  assert.equal(gov.level, 2);
  assert.equal(gov.particleMul, 0.6);
  assert.equal(gov.rimLightEnabled, false);
  assert.equal(gov.contactShadowsEnabled, true, 'contact shadows shed at level 3, not 2');
});

test('a frame barely over budget still takes ~60 frames (~1s) to shed', () => {
  const gov = new PerfGovernor();
  feedFrames(gov, 59, 15.1);
  assert.equal(gov.level, 0);
  feedFrames(gov, 1, 15.1);
  assert.equal(gov.level, 1);
});

test('a badly over-budget frame sheds a rung in far fewer frames', () => {
  const gov = new PerfGovernor();
  // deltaMs=45 is 3x budget -- severity 3, so 20 frames (not 60) sheds.
  feedFrames(gov, 19, 45);
  assert.equal(gov.level, 0);
  feedFrames(gov, 1, 45);
  assert.equal(gov.level, 1);
});

test('severity is capped so one catastrophic frame cannot shed multiple rungs at once', () => {
  const gov = new PerfGovernor();
  gov.sample(5000, 0); // one huge stall (e.g. a tab coming back into focus)
  assert.equal(gov.level, 0, 'a single frame, however bad, only ever adds capped severity');
});

test('sheds progressively further under sustained pressure', () => {
  const gov = new PerfGovernor();
  let t = 0;
  // Barely-over-budget severity (~1x) so each 60-frame batch sheds exactly
  // one rung with no carry-over into the next, isolating "does the ladder
  // walk down in order" from the severity-scaling behavior (tested above).
  for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
    t = feedFrames(gov, 60, 15.1, t);
    assert.equal(gov.level, lvl);
  }
  // Fully shed: every lever off.
  assert.equal(gov.visionAllowed, false);
  assert.equal(gov.particleMul, 0.6);
  assert.equal(gov.crackGlowEnabled, false);
  assert.equal(gov.bloomEnabled, false);
  assert.equal(gov.veilEnabled, false);
  assert.equal(gov.phenomenaFull, false);
  assert.equal(gov.hazeLayers, 1);
  assert.equal(gov.heavyPostFx, false);
  assert.equal(gov.brushEnabled, false);

  // Further over-budget frames don't shed past MAX_LEVEL.
  feedFrames(gov, 200, 20, t);
  assert.equal(gov.level, MAX_LEVEL);
});

test('a single over-budget frame does not reset recovery progress unnecessarily, but recovers after 10 clean seconds', () => {
  const gov = new PerfGovernor();
  let t = feedFrames(gov, 60, 20, 0); // shed to level 1
  assert.equal(gov.level, 1);

  // Under 10s of clean frames: no recovery yet.
  t = feedFrames(gov, 100, 5, t, 90); // ~9s of clean frames
  assert.equal(gov.level, 1);

  // Push past the 10s clean threshold.
  t = feedFrames(gov, 20, 5, t, 90); // another ~1.8s
  assert.equal(gov.level, 0);
});

test('judder -- frames alternating just above and below budget -- still sheds a rung eventually', () => {
  const gov = new PerfGovernor();
  let t = 0;
  // Alternate one badly-over-budget frame (severity 2) with one clean frame.
  // A hard reset-to-zero on every clean frame would erase all accumulated
  // severity and this loop would never shed; decaying instead lets it
  // net-accumulate every pair.
  for (let i = 0; i < 400 && gov.level === 0; i++) {
    gov.sample(30, t); t += 16.6;
    gov.sample(5, t); t += 16.6;
  }
  assert.equal(gov.level, 1, 'sustained judder should shed a rung, not stay at 0 forever');
});

test('deeper rungs (5-6) gate phenomena and the overlay-pass stack, past the original four', () => {
  const gov = new PerfGovernor();
  gov.level = 4;
  assert.equal(gov.phenomenaFull, true, 'still full at the end of the original ladder');
  assert.equal(gov.hazeLayers, 3);
  assert.equal(gov.heavyPostFx, true);
  assert.equal(gov.brushEnabled, true, 'brush still on at the end of the original ladder');

  gov.level = 5;
  assert.equal(gov.phenomenaFull, false, 'rung 5 sheds optional phenomena');
  assert.equal(gov.hazeLayers, 3, 'haze still full at rung 5');
  assert.equal(gov.heavyPostFx, true);
  assert.equal(gov.brushEnabled, false, 'rung 5 sheds the rainbow brush alongside phenomena');

  gov.level = 6;
  assert.equal(gov.phenomenaFull, false);
  assert.equal(gov.hazeLayers, 1, 'rung 6 collapses haze to a single layer');
  assert.equal(gov.heavyPostFx, false, 'rung 6 also drops the heaviest overlay passes');
  assert.equal(gov.brushEnabled, false);
});

test('constructor accepts a proactive startLevel, clamped to [0, MAX_LEVEL]', () => {
  assert.equal(new PerfGovernor().level, 0, 'defaults to 0');
  assert.equal(new PerfGovernor({ startLevel: 2 }).level, 2);
  assert.equal(new PerfGovernor({ startLevel: -3 }).level, 0, 'clamped at the floor');
  assert.equal(new PerfGovernor({ startLevel: 99 }).level, MAX_LEVEL, 'clamped at the ceiling');
});

test('resolvePerfStartLevel: ?perf=lite|high overrides the device heuristic', () => {
  assert.equal(resolvePerfStartLevel('?perf=lite', { isCoarsePointer: false }), 2);
  assert.equal(resolvePerfStartLevel('?perf=high', { isCoarsePointer: true }), 0);
  assert.equal(resolvePerfStartLevel('perf=lite'), 2, 'works without a leading ?');
});

test('resolvePerfStartLevel: falls back to a coarse-pointer/small-viewport device heuristic', () => {
  assert.equal(resolvePerfStartLevel('', {}), 0, 'a normal desktop starts at full quality');
  assert.equal(resolvePerfStartLevel('', { isCoarsePointer: true }), 1, 'touch devices start a rung down');
  assert.equal(resolvePerfStartLevel('', { isSmallViewport: true }), 1, 'small viewports start a rung down');
});

test('resolvePerfStartLevel tolerates a malformed search string', () => {
  assert.equal(resolvePerfStartLevel(undefined, {}), 0);
});

test('an over-budget frame during a clean streak resets the recovery timer', () => {
  const gov = new PerfGovernor();
  let t = feedFrames(gov, 60, 20, 0); // shed to level 1
  t = feedFrames(gov, 100, 5, t, 90); // ~9s clean, not yet recovered
  assert.equal(gov.level, 1);

  gov.sample(20, t); // one bad frame resets the clean-streak clock
  t += 90;
  t = feedFrames(gov, 100, 5, t, 90); // another ~9s clean — still shy of 10s since reset
  assert.equal(gov.level, 1, 'recovery timer should have restarted after the interruption');
});

// --- Warm-up grace -------------------------------------------------------
// Starting a song bakes two dozen 2048px strips and touches every cold path
// in the renderer. Those frames are catastrophically long but say nothing
// about steady-state cost, and at severity 6 apiece only ten of them shed a
// rung -- so a load hitch alone used to cascade the governor several rungs
// deep and switch off every optional pass permanently, which is what "the
// terrain detail is only there for the first two seconds" actually was.

test('a load hitch does not vote: the warm-up window absorbs it', async () => {
  const { PerfGovernor, WARMUP_MS } = await import('../src/render/PerfGovernor.js');
  const g = new PerfGovernor({ startLevel: 0 });
  let t = 0;
  g.beginWarmup(t);   // what main.js does the moment a song starts
  // 120 catastrophic frames, all inside the warm-up window.
  for (let i = 0; i < 120; i++) { g.sample(200, t); t += 12; }
  assert.equal(g.level, 0, 'the bake must not shed a single rung');
  assert.ok(t < WARMUP_MS, 'sanity: this burst really was inside the window');
});

test('a genuinely over-budget scene still sheds, just after the window', async () => {
  const { PerfGovernor, WARMUP_MS } = await import('../src/render/PerfGovernor.js');
  const g = new PerfGovernor({ startLevel: 0 });
  g.beginWarmup(0);
  let t = WARMUP_MS + 1;
  for (let i = 0; i < 400; i++) { g.sample(45, t); t += 16; }
  assert.ok(g.level > 0, 'a sustained real overage must still shed');
});

test('beginWarmup re-arms the grace for a new song', async () => {
  const { PerfGovernor, WARMUP_MS } = await import('../src/render/PerfGovernor.js');
  const g = new PerfGovernor({ startLevel: 0 });
  let t = 0;
  g.beginWarmup(t);
  t += WARMUP_MS + 1;
  g.beginWarmup(t);                       // new song loads here
  for (let i = 0; i < 120; i++) { g.sample(200, t); t += 12; }
  assert.equal(g.level, 0, 'the second song\'s bake must be absorbed too');
});
