import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DANCE_LAYERS, danceOffset, kickEnv, spectrumBars } from '../src/world/MountainChoreo.js';

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
