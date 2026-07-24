import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DANCE_LAYERS, danceOffset, danceGeom, danceSample, kickEnv, spectrumBars,
} from '../src/world/MountainChoreo.js';
import { softPeak01 } from '../src/world/SilhouetteGenerator.js';

// Multi-mode wave peaks at ~1.35; bound every full-blast sample by that.
const WAVE_PEAK = 1.35;

test('danceOffset stays bounded and never goes fully still', () => {
  const cfg = DANCE_LAYERS.L4;
  let maxAbs = 0, sumAbs = 0, n = 0;
  for (let t = 0; t < 20; t += 0.13) {
    for (let x = 0; x < 2048; x += 128) {
      const idle = danceOffset(x, t, 0, 0, cfg);
      const full = danceOffset(x, t, 1, 1, cfg);
      assert.ok(Math.abs(full) <= cfg.waveAmp * WAVE_PEAK + cfg.bounceAmp + 1e-9);
      maxAbs = Math.max(maxAbs, Math.abs(idle));
      sumAbs += Math.abs(idle); n++;
    }
  }
  // Idle: small (≤ 15% of multi-mode wave peak) but alive (nonzero on average).
  assert.ok(maxAbs <= cfg.waveAmp * WAVE_PEAK * 0.15 + 1e-9, `idle too big: ${maxAbs}`);
  assert.ok(sumAbs / n > 0.05, 'mountains should always breathe a little');
});

test('kicks lift every layer, near hills before far peaks', () => {
  const near = DANCE_LAYERS.L5, far = DANCE_LAYERS.L2;
  // 60 ms after the hit: the near layer is already bouncing…
  const nearKick = kickEnv(60 - near.delaySec * 1000);
  assert.ok(nearKick > 0.5, `near layer should be mid-bounce, got ${nearKick}`);
  // …while the wave has not yet reached the far peaks.
  const farKick = kickEnv(60 - far.delaySec * 1000);
  assert.equal(farKick, 0);
  // Bounce lifts (negative offset), scaled by the envelope.
  const withKick = danceOffset(0, 0, 0, 1, near);
  const without = danceOffset(0, 0, 0, 0, near);
  assert.ok(withKick < without, 'a kick must lift the range');
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

test('danceGeom stretches and shears within sane geometric bounds', () => {
  const cfg = DANCE_LAYERS.L5;
  for (let t = 0; t < 8; t += 0.2) {
    for (let x = 0; x < 1024; x += 64) {
      const g = danceGeom(x, t, 1, 1, cfg);
      assert.ok(g.scaleY > 0.85 && g.scaleY < 1.25, `scaleY out of range: ${g.scaleY}`);
      assert.ok(Math.abs(g.shear) <= (cfg.shearAmp ?? 4) + 1e-9);
    }
  }
  // Idle still breathes geometrically (scale drifts off 1).
  let sawBreath = false;
  for (let t = 0; t < 10; t += 0.17) {
    const g = danceGeom(200, t, 0, 0, cfg);
    if (Math.abs(g.scaleY - 1) > 0.001) sawBreath = true;
  }
  assert.ok(sawBreath, 'idle should still geometrically breathe');
});

test('danceSample packages offset + geometry coherently', () => {
  const cfg = DANCE_LAYERS.L3;
  const s = danceSample(100, 1.5, 0.6, 0.4, cfg);
  assert.equal(s.dy, danceOffset(100, 1.5, 0.6, 0.4, cfg));
  const g = danceGeom(100, 1.5, 0.6, 0.4, cfg);
  assert.equal(s.scaleY, g.scaleY);
  assert.equal(s.shear, g.shear);
});

test('every mountain layer including the new L2b has a dance personality', () => {
  for (const key of ['L2', 'L2b', 'L3', 'L4', 'L5']) {
    assert.ok(DANCE_LAYERS[key], `missing DANCE_LAYERS.${key}`);
    assert.ok(DANCE_LAYERS[key].scaleAmp > 0, `${key} needs geometric scale`);
    assert.ok(DANCE_LAYERS[key].shearAmp > 0, `${key} needs geometric shear`);
  }
  // Far layers bounce later than near.
  assert.ok(DANCE_LAYERS.L2.delaySec > DANCE_LAYERS.L2b.delaySec);
  assert.ok(DANCE_LAYERS.L2b.delaySec > DANCE_LAYERS.L3.delaySec);
  assert.ok(DANCE_LAYERS.L5.delaySec === 0);
});

test('softPeak01 rounds tops: high inputs compress, mid values stay readable', () => {
  assert.equal(softPeak01(0), 0);
  assert.equal(softPeak01(1), 1);
  // Power > 1: tall outliers pull down (less pointy), shoulders remain.
  assert.ok(softPeak01(0.9) < 0.9, 'tops should compress');
  assert.ok(softPeak01(0.3) > 0.15, 'shoulders should stay present');
  assert.ok(softPeak01(0.2) < softPeak01(0.5));
  assert.ok(softPeak01(0.5) < softPeak01(0.8));
});
