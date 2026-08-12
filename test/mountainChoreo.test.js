import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DANCE_LAYERS, danceOffset, kickEnv, spectrumBars,
  mountainStripDrawHeight, MOUNTAIN_SKY_HEADROOM_FRAC,
  massifDrawHeight, MASSIF_SKY_HEADROOM_FRAC,
  massifRidgeHeight01, massifRidgeJagPx, massifClearing01, MASSIF_CLEARING_PERIOD_SEC,
  nextMassifMarkerDelaySec, MASSIF_MARKER_MIN_GAP_SEC, MASSIF_MARKER_MAX_GAP_SEC,
} from '../src/world/MountainChoreo.js';
import { mulberry32 } from '../src/utils/math.js';

test('danceOffset stays bounded and never goes fully still', () => {
  const cfg = DANCE_LAYERS.L4;
  let maxAbs = 0, sumAbs = 0, n = 0;
  for (let t = 0; t < 20; t += 0.13) {
    for (let x = 0; x < 2048; x += 128) {
      const idle = danceOffset(x, t, 0, 0, cfg);
      const full = danceOffset(x, t, 1, 1, cfg);
      assert.ok(Math.abs(full) <= cfg.waveAmp + cfg.bounceAmp + 1e-9);
      maxAbs = Math.max(maxAbs, Math.abs(idle));
      sumAbs += Math.abs(idle); n++;
    }
  }
  // Idle: small (≤ 15% of the wave) but alive (nonzero on average).
  assert.ok(maxAbs <= cfg.waveAmp * 0.15 + 1e-9, `idle too big: ${maxAbs}`);
  assert.ok(sumAbs / n > 0.05, 'mountains should always breathe a little');
});

test('kicks lift every layer, far peaks before near hills', () => {
  const near = DANCE_LAYERS.L5, far = DANCE_LAYERS.L2;
  // 60 ms after the hit: the far skyline is already bouncing…
  const farKick = kickEnv(60 - far.delaySec * 1000);
  assert.ok(farKick > 0.5, `far layer should be mid-bounce, got ${farKick}`);
  // …while the wave has not yet rolled forward to the near hills.
  const nearKick = kickEnv(60 - near.delaySec * 1000);
  assert.equal(nearKick, 0);
  // Bounce lifts (negative offset), scaled by the envelope.
  const withKick = danceOffset(0, 0, 0, 1, far);
  const without = danceOffset(0, 0, 0, 0, far);
  assert.ok(withKick < without, 'a kick must lift the range');
});

test('the dance gets bigger with distance -- the drama is in the BACK', () => {
  // The whole point of the reversal: whatever sits closest to the camera
  // must never be the thing moving most, or the foreground flaps while the
  // horizon sits still.
  const order = ['L5', 'L4', 'L3', 'L2']; // near -> far
  for (let i = 1; i < order.length; i++) {
    const nearer = DANCE_LAYERS[order[i - 1]], farther = DANCE_LAYERS[order[i]];
    assert.ok(farther.waveAmp > nearer.waveAmp, `${order[i]} should heave more than ${order[i - 1]}`);
    assert.ok(farther.bounceAmp > nearer.bounceAmp, `${order[i]} should bounce harder than ${order[i - 1]}`);
    assert.ok(farther.delaySec < nearer.delaySec, `${order[i]} should lead ${order[i - 1]} on the kick`);
  }
});

test('kickEnv snaps up fast and settles smoothly', () => {
  assert.equal(kickEnv(-10), 0);
  assert.ok(kickEnv(40) > 0.99);
  assert.ok(kickEnv(200) < kickEnv(40));
  assert.ok(kickEnv(200) > kickEnv(500));
  assert.ok(kickEnv(2000) < 0.01);
});

test('spectrumBars: mountain-shaped at silence, summit rides the bass', () => {
  const silent = spectrumBars(new Float32Array(7));
  assert.equal(silent.length, 7);
  // Pedestal alone must still be a mountain: rising to the center, falling after.
  for (let i = 1; i <= 3; i++) assert.ok(silent[i].h01 >= silent[i - 1].h01);
  for (let i = 4; i < 7; i++) assert.ok(silent[i].h01 <= silent[i - 1].h01);
  assert.ok(silent[0].h01 > 0.05, 'flanks never vanish entirely');

  // The center column reads band 0 (bass) — the summit follows the kick.
  assert.equal(silent[3].band, 0);
  const bassOnly = spectrumBars([1, 0, 0, 0, 0, 0, 0]);
  assert.ok(bassOnly[3].h01 > silent[3].h01, 'bass energy must raise the summit');
  assert.ok(bassOnly[3].h01 <= 1);
  // Every column maps a distinct band.
  assert.equal(new Set(silent.map((b) => b.band)).size, 7);
});

test('full-blast bars never exceed their bell profile ceiling', () => {
  const full = spectrumBars([1, 1, 1, 1, 1, 1, 1]);
  for (const b of full) assert.ok(b.h01 <= 1 + 1e-9);
  assert.ok(full[3].h01 > full[0].h01, 'center stays tallest even at full blast');
});

// --- The spectrum massif's scale (megalophobia pass) -----------------------

test('the massif is allowed a far taller ceiling than an ordinary range', () => {
  assert.ok(MASSIF_SKY_HEADROOM_FRAC < MOUNTAIN_SKY_HEADROOM_FRAC,
    'the massif must reserve less headroom than a normal range -- it is allowed to loom much higher');
  const canvasHeight = 720, groundY = 540, growth = 1;
  const ordinary = mountainStripDrawHeight(2000, growth, canvasHeight, groundY);
  const massif = massifDrawHeight(2000, growth, canvasHeight, groundY);
  assert.ok(massif > ordinary, `expected the massif's ceiling (${massif}) to exceed an ordinary range's (${ordinary})`);
  // And it should reach a genuinely imposing fraction of the frame, not just
  // "a bit more" -- most of the screen height, not a sliver.
  assert.ok(massif / canvasHeight > 0.7, `massif ceiling only reached ${(massif / canvasHeight).toFixed(2)} of frame height`);
});

test('massifDrawHeight never exceeds the frame and stays sane at every growth level', () => {
  const canvasHeight = 720, groundY = 540;
  for (let g = 0; g <= 1; g += 0.1) {
    const h = massifDrawHeight(2000, 1 + g, canvasHeight, groundY);
    assert.ok(h > 0 && h <= canvasHeight, `height ${h} out of bounds at growth ${g}`);
  }
});

test('massifRidgeHeight01 forms ONE continuous ridge across all seven bars -- no gaps, no jumps', () => {
  const bars = spectrumBars([1, 0, 1, 0, 1, 0, 1]); // deliberately spiky input
  // Endpoints land exactly on the first/last bar's own height.
  assert.equal(massifRidgeHeight01(bars, 0), bars[0].h01);
  assert.ok(Math.abs(massifRidgeHeight01(bars, 1) - bars[bars.length - 1].h01) < 1e-9);
  // Every bar's own peak is hit exactly at its own u -- the curve passes
  // through each sample point rather than merely approaching it.
  for (let i = 0; i < bars.length; i++) {
    const u = i / (bars.length - 1);
    assert.ok(Math.abs(massifRidgeHeight01(bars, u) - bars[i].h01) < 1e-9, `bar ${i} peak missed at u=${u}`);
  }
  // True continuity check (not just "small per-step delta", which a sharp
  // 0<->1 alternation over few segments can legitimately fail at fine
  // granularity): approaching any u from both sides converges to the same
  // value, everywhere -- the actual definition of no discontinuity.
  for (let u = 0.03; u < 1; u += 0.037) {
    const left = massifRidgeHeight01(bars, u - 1e-6);
    const right = massifRidgeHeight01(bars, u + 1e-6);
    assert.ok(Math.abs(left - right) < 1e-4, `discontinuity detected approaching u=${u}: ${left} vs ${right}`);
  }
  for (let u = 0; u <= 1; u += 0.01) {
    const h = massifRidgeHeight01(bars, u);
    assert.ok(h >= 0 && h <= 1, `height01 out of range at u=${u}: ${h}`);
  }
});

test('massifRidgeHeight01 handles degenerate bar counts without throwing', () => {
  assert.equal(massifRidgeHeight01([], 0.5), 0);
  assert.equal(massifRidgeHeight01([{ h01: 0.6 }], 0.5), 0.6);
});

test('massifRidgeJagPx is deterministic, bounded, and varies across the ridge (not a flat repeat)', () => {
  const a1 = massifRidgeJagPx(0.37);
  const a2 = massifRidgeJagPx(0.37);
  assert.equal(a1, a2, 'must be a pure function of u');
  let anyDiffer = false, sawNegativeOrAbove = false;
  let last = massifRidgeJagPx(0);
  for (let u = 0.02; u <= 1; u += 0.02) {
    const j = massifRidgeJagPx(u);
    if (j < 0) sawNegativeOrAbove = true;
    if (Math.abs(j - last) > 0.5) anyDiffer = true;
    last = j;
  }
  assert.equal(sawNegativeOrAbove, false, 'a jag should only ever notch DOWN from the smooth ridge, never up past it');
  assert.ok(anyDiffer, 'the ridge should read as genuinely irregular, not a flat line');
});

test('massifClearing01 is mostly hazy (near 0) and only rarely, briefly reaches full clarity', () => {
  let nearFullFrames = 0, total = 0, sawFull = false, sumC = 0;
  for (let t = 0; t < MASSIF_CLEARING_PERIOD_SEC * 3; t += 0.25) {
    const c = massifClearing01(t);
    assert.ok(c >= 0 && c <= 1 + 1e-9);
    if (c > 0.95) sawFull = true;
    if (c > 0.9) nearFullFrames++;
    sumC += c;
    total++;
  }
  assert.ok(sawFull, 'the clearing must actually reach (near) full clarity at its peak');
  assert.ok(nearFullFrames / total < 0.15, `near-full clarity should be a rare spike (${nearFullFrames}/${total})`);
  assert.ok(sumC / total < 0.35, `the AVERAGE state should read as hazy, not half-clear (mean ${(sumC / total).toFixed(2)})`);
});

test('massifClearing01 handles negative/huge time without throwing or going out of range', () => {
  for (const t of [-500, 0, 1e7]) {
    const c = massifClearing01(t);
    assert.ok(Number.isFinite(c) && c >= 0 && c <= 1);
  }
});

test('nextMassifMarkerDelaySec stays within its documented gap band and varies with the RNG', () => {
  const rand = mulberry32(7);
  const delays = Array.from({ length: 200 }, () => nextMassifMarkerDelaySec(rand));
  for (const d of delays) {
    assert.ok(d >= MASSIF_MARKER_MIN_GAP_SEC && d <= MASSIF_MARKER_MAX_GAP_SEC, `delay ${d} out of band`);
  }
  assert.ok(new Set(delays).size > 1, 'should not always return the same delay');
});
