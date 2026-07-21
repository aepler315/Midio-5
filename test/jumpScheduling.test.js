// Chart-scheduled landings: a jump should land ON the next audible kick
// whenever one is a plausible target, instead of only ever guessing from
// the beat-period EMA (which only ever matches a perfectly steady beat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduledJumpD, nextLandingKickMs, shortHopHeightMul, LANDING_MIN_GAP_MS, D_MIN, D_MAX,
} from '../src/sim/JumpController.js';

test('scheduledJumpD lands exactly on the next kick when the gap is a plausible target', () => {
  assert.equal(scheduledJumpD(1000, 1500, 500), 500, 'unclamped gap wins outright');
  assert.equal(scheduledJumpD(1000, 1900, 500), 900, 'a syncopated gap still schedules exactly');
});

test('scheduledJumpD: short real gaps become double-step hops; far gaps clamp to D_MAX', () => {
  assert.equal(scheduledJumpD(1000, 1000 + LANDING_MIN_GAP_MS - 1, 500), 500, 'a gap under the floor falls back to the EMA, not a tiny D');
  assert.equal(scheduledJumpD(1000, 1000 + D_MIN - 50, 500), D_MIN - 50,
    'a real kick closer than D_MIN is a short double-step hop that LANDS on it -- not a D_MIN arc sailing past it');
  assert.equal(scheduledJumpD(1000, 1000 + D_MAX + 400, 500), D_MAX, 'a real but long gap clamps down to D_MAX');
});

test('shortHopHeightMul: full height at D_MIN and above, quadratic shrink below', () => {
  assert.equal(shortHopHeightMul(D_MIN), 1);
  assert.equal(shortHopHeightMul(1000), 1);
  const half = shortHopHeightMul(D_MIN / 2);
  assert.ok(Math.abs(half - 0.25) < 1e-9, `expected quadratic shrink, got ${half}`);
});

test('scheduledJumpD falls back to the beat-period EMA when there is no plausible next kick', () => {
  assert.equal(scheduledJumpD(1000, null, 500), 500, 'no kick in range at all');
  assert.equal(scheduledJumpD(1000, 3500, 500), 500, 'a kick so far out it reads as a rest, not a target');
});

test('nextLandingKickMs skips duplicate/too-close kicks and returns the first plausible target', () => {
  const kickTimes = [1000, 1050, 1080, 1600, 2200];
  // From takeoff=1000, scanning from index 1: 1050 (gap 50) and 1080 (gap
  // 80) are both too close (dedupe/layered onsets); 1600 (gap 600) is the
  // first real candidate.
  assert.equal(nextLandingKickMs(kickTimes, 1000, 1), 1600);
});

test('nextLandingKickMs returns null when nothing in the list qualifies', () => {
  assert.equal(nextLandingKickMs([1000, 1050], 1000, 1), null);
  assert.equal(nextLandingKickMs([], 1000, 0), null);
  assert.equal(nextLandingKickMs([1000], 1000, 5), null, 'fromIdx past the end');
});

// --- Back-to-back kicks: jump + double jump, nothing late, no beat eaten ---

import { JumpController } from '../src/sim/JumpController.js';
import { predictJumpArcs } from '../src/sim/JumpPlanner.js';
import { ParamBus } from '../src/core/ParamBus.js';

function stepController(kicks, { airJumpAt = null } = {}) {
  const jump = new JumpController(new ParamBus());
  jump.setKickTimes(kicks.map((k) => k.tMs));
  const STEP_MS = 1000 / 120;
  const takeoffs = [];
  const landings = [];
  const origLaunch = jump._launch.bind(jump);
  jump._launch = (nowMs, H, D) => { takeoffs.push(nowMs); origLaunch(nowMs, H, D); };
  let ki = 0, t = 0;
  const endMs = kicks[kicks.length - 1].tMs + 2000;
  while (t <= endMs) {
    jump.clearFrameFlags();
    while (ki < kicks.length && kicks[ki].tMs <= t) {
      const k = kicks[ki];
      if (airJumpAt != null && k.tMs === airJumpAt) {
        // The autoplay tap drain's double-jump path: an air jump fired at
        // the second of two back-to-back kicks.
        jump.noteKickTiming(k.tMs);
        jump.airJump({ tMs: k.tMs, vel: k.vel });
      } else {
        jump.onKick(k);
      }
      ki++;
    }
    jump.update(t);
    if (jump.pendingLanding) landings.push(t);
    t += STEP_MS;
  }
  return { takeoffs, landings, jump };
}

test('the double jump on the second of two OVERLAPPING kicks lands ON the next kick, not on the EMA', () => {
  // Two kicks 180ms apart (below the dedupe floor -- kick 2 is genuinely
  // mid-air, so it resolves as a double jump), then the downbeat.
  const kicks = [{ tMs: 1000, vel: 0.8 }, { tMs: 1180, vel: 0.8 }, { tMs: 1750, vel: 0.8 }];
  const { landings } = stepController(kicks, { airJumpAt: 1180 });
  // The double jump's touchdown must fall on the 1750 kick (within a step
  // of quantization), not at 1180 + 0.9*EMA (musically nowhere).
  const nearest = landings.reduce((best, l) => (Math.abs(l - 1750) < Math.abs(best - 1750) ? l : best), -Infinity);
  assert.ok(Math.abs(nearest - 1750) < 15, `double-jump landing should hit the 1750 kick, landings: ${landings.map((l) => l.toFixed(0)).join(',')}`);
});

test('back-to-back kicks become a double-step: short hop lands ON the second kick, full jump onward', () => {
  // The user-reported pattern: kick pairs 224ms apart. The old D_MIN floor
  // forced a 380ms arc that sailed over the second kick and touched down
  // ~156ms late in musical no-man's-land, and the second kick got nothing.
  const kicks = [1000, 1224, 1901, 2125, 2802].map((tMs) => ({ tMs, vel: 0.8 }));
  const { takeoffs, landings } = stepController(kicks);
  for (const k of [1224, 1901, 2125, 2802]) {
    assert.ok(landings.some((l) => Math.abs(l - k) < 15), `expected a landing ON the ${k} kick, landings: ${landings.map((l) => l.toFixed(0)).join(',')}`);
    assert.ok(takeoffs.some((to) => Math.abs(to - k) < 15), `expected a takeoff on the ${k} kick, takeoffs: ${takeoffs.map((t) => t.toFixed(0)).join(',')}`);
  }
});

test('no beat is swallowed after back-to-back kicks: every kick after the pair gets its takeoff', () => {
  // kick pair (0ms gap 250) then steady beats -- the old one-sided tie rule
  // left the retarget arc landing EXACTLY on 1750 and 1750 reading as
  // "still airborne, past the retarget window": swallowed, jump a full
  // beat late. The landing-tie relaunch fixes it.
  const kicks = [1000, 1250, 1750, 2250, 2750].map((tMs) => ({ tMs, vel: 0.8 }));
  const { takeoffs } = stepController(kicks);
  for (const beat of [1750, 2250, 2750]) {
    const hit = takeoffs.some((to) => Math.abs(to - beat) < 15);
    assert.ok(hit, `expected a takeoff on the ${beat} kick; takeoffs: ${takeoffs.map((t) => t.toFixed(0)).join(',')}`);
  }
});

test('offline predictJumpArcs stays in lockstep through the back-to-back + landing-tie sequence', () => {
  const kicks = [1000, 1250, 1750, 2250, 2750].map((tMs) => ({ tMs, vel: 0.8 }));
  const { landings } = stepController(kicks);
  const arcs = predictJumpArcs(kicks);
  assert.equal(arcs.length, landings.length, `arcs ${arcs.length} vs live landings ${landings.length}`);
  for (let i = 0; i < arcs.length; i++) {
    assert.ok(Math.abs(arcs[i].landMs - landings[i]) < 15, `arc ${i}: ${arcs[i].landMs} vs live ${landings[i]}`);
  }
});
