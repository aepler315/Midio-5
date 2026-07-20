import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictJumpArcs, safeWindowForArc } from '../src/sim/JumpPlanner.js';
import { JumpController, jumpY } from '../src/sim/JumpController.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { mulberry32 } from '../src/utils/math.js';

function runLive(kicks, opts = {}) {
  const paramBus = new ParamBus();
  const jump = new JumpController(paramBus, opts);
  // Landing-on-the-next-kick (scheduledJumpD): the live controller needs
  // the same raw kick-time list predictJumpArcs replays, or it would fall
  // back to pure-EMA scheduling while the predictor schedules onto real
  // kicks -- breaking the lockstep this test exists to verify.
  jump.setKickTimes(kicks.map((k) => k.tMs));
  const STEP_MS = 1000 / 120;
  const landings = [];
  let ki = 0;
  let t = 0;
  const endMs = kicks[kicks.length - 1].tMs + 3000;
  while (t <= endMs) {
    jump.clearFrameFlags();
    while (ki < kicks.length && kicks[ki].tMs <= t) {
      jump.onKick(kicks[ki]);
      ki++;
    }
    jump.update(t);
    if (jump.pendingLanding) landings.push(t);
    t += STEP_MS;
  }
  return landings;
}

test('predictJumpArcs matches a live JumpController stepped in real time (simple steady kicks)', () => {
  const kicks = [];
  for (let i = 0; i < 20; i++) kicks.push({ tMs: i * 500, vel: 0.6 + 0.3 * Math.sin(i) });

  const liveLandings = runLive(kicks);
  const arcs = predictJumpArcs(kicks);

  assert.equal(arcs.length, liveLandings.length, 'same number of arcs/landings');
  for (let i = 0; i < arcs.length; i++) {
    assert.ok(Math.abs(arcs[i].landMs - liveLandings[i]) < 10, `arc ${i} landMs ${arcs[i].landMs} vs live ${liveLandings[i]}`);
  }
});

test('predictJumpArcs matches live behavior with high-BPM halftime skipping', () => {
  const kicks = [];
  for (let i = 0; i < 30; i++) kicks.push({ tMs: i * 180, vel: 0.7 }); // ~333bpm kick-to-kick -> halftime kicks in

  const liveLandings = runLive(kicks);
  const arcs = predictJumpArcs(kicks);

  assert.equal(arcs.length, liveLandings.length);
  for (let i = 0; i < arcs.length; i++) {
    assert.ok(Math.abs(arcs[i].landMs - liveLandings[i]) < 15);
  }
});

test('predictJumpArcs matches live behavior when a close kick triggers mid-air retargeting', () => {
  // A steady beat, then one kick lands unusually early (in the last 30% of the
  // fall), which should trigger a compress-and-relaunch in both systems.
  const kicks = [
    { tMs: 0, vel: 0.8 }, { tMs: 500, vel: 0.8 }, { tMs: 1000, vel: 0.8 },
    { tMs: 1000 + 500 * 0.85, vel: 0.8 }, // ~85% through the next 500ms-ish arc -> retarget window
    { tMs: 2200, vel: 0.8 }, { tMs: 2700, vel: 0.8 },
  ];
  const liveLandings = runLive(kicks);
  const arcs = predictJumpArcs(kicks);

  assert.equal(arcs.length, liveLandings.length);
  for (let i = 0; i < arcs.length; i++) {
    assert.ok(Math.abs(arcs[i].landMs - liveLandings[i]) < 15, `arc ${i}: ${arcs[i].landMs} vs ${liveLandings[i]}`);
  }
});

test('predictJumpArcs stays in sync over a long randomized kick sequence', () => {
  const rand = mulberry32(2024);
  const kicks = [];
  let t = 0;
  for (let i = 0; i < 200; i++) {
    t += 250 + rand() * 500;
    kicks.push({ tMs: Math.round(t), vel: 0.4 + rand() * 0.6 });
  }
  const liveLandings = runLive(kicks);
  const arcs = predictJumpArcs(kicks);

  assert.equal(arcs.length, liveLandings.length);
  for (let i = 0; i < arcs.length; i++) {
    assert.ok(Math.abs(arcs[i].landMs - liveLandings[i]) < 15);
  }
});

test('safeWindowForArc finds the above-threshold sub-interval and clips to a truncated landing', () => {
  const arc = { takeoffMs: 1000, landMs: 1500, H: 150, D: 500 };
  const w = safeWindowForArc(arc, 60);
  assert.ok(w);
  assert.ok(w.fromMs > arc.takeoffMs && w.fromMs < arc.takeoffMs + arc.D * 0.4);
  assert.ok(w.toMs <= arc.landMs);
  // Sanity: every point in the window is really above threshold.
  for (let t = w.fromMs; t <= w.toMs; t += 10) {
    const u = (t - arc.takeoffMs) / arc.D;
    assert.ok(jumpY(u, arc.H) >= 60 - 1e-6);
  }
});

test('safeWindowForArc returns null when the arc never clears the threshold', () => {
  const arc = { takeoffMs: 0, landMs: 400, H: 40, D: 400 };
  assert.equal(safeWindowForArc(arc, 200), null);
});

// --- Chart-scheduled landings (scheduledJumpD / nextLandingKickMs) -------

test('predictJumpArcs lands on syncopated kicks: every landMs matches an actual kick within [D_MIN,D_MAX]', () => {
  // Deliberately uneven gaps -- the EMA would smear these into an average
  // that matches none of them; a scheduled landing should hit the real
  // next kick whenever the gap is a plausible target.
  const gaps = [500, 750, 500, 250, 900, 400, 600];
  const kicks = [];
  let t = 0;
  for (const g of gaps) { kicks.push({ tMs: t, vel: 0.8 }); t += g; }
  kicks.push({ tMs: t, vel: 0.8 });

  const arcs = predictJumpArcs(kicks);
  // The final arc has no kick after it to land on at all (a legitimate
  // EMA-fallback landing past the last beat) -- this property is about
  // landing on REAL kicks in the middle of the stream, so only those.
  for (const arc of arcs.slice(0, -1)) {
    const scheduledGap = arc.D; // the arc's OWN scheduled duration (D_MIN/D_MAX-clamped)
    // The arc's landMs matches its intended target whenever the arc
    // reaches it uninterrupted: either the exact gap to its scheduled
    // kick (unclamped), or it sat at a D_MIN/D_MAX boundary (too-close/
    // too-far target, EMA fallback). A LATER retarget can also truncate
    // an earlier arc's stored landMs down to (some kick's tMs +
    // RETARGET_FALL_MS) -- landMs then no longer equals takeoffMs+D by
    // construction (that's the whole point of a retarget), so it's
    // checked against the retarget formula instead.
    const scheduledMatchesAKick = kicks.some((k) => Math.abs(k.tMs - (arc.takeoffMs + scheduledGap)) < 1e-6);
    const atClampBoundary = scheduledGap === 380 || scheduledGap === 1200;
    const truncatedByRetarget = kicks.some((k) => Math.abs(k.tMs + 120 - arc.landMs) < 1e-6);
    assert.ok(
      scheduledMatchesAKick || atClampBoundary || truncatedByRetarget,
      `arc ${JSON.stringify(arc)} matches no kick, no clamp boundary, and no retarget truncation`,
    );
  }
});
