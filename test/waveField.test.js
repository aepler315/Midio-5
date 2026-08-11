import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  G, pmSpectralDensity, peakOmega, omegaForK, kForOmega, phaseSpeed,
  buildWaveComponents, fieldVariance, waveFieldSample, windSpeedForSeaState, easeSeaState,
} from '../src/world/WaveField.js';

test('deep-water dispersion: phase speed strictly decreases as wavenumber grows -- longer waves outrun shorter ones', () => {
  const ks = [0.02, 0.05, 0.1, 0.3, 0.8, 2.0];
  let prevSpeed = Infinity;
  for (const k of ks) {
    const speed = phaseSpeed(k);
    assert.ok(speed < prevSpeed, `phase speed must decrease as k grows: k=${k} speed=${speed} prev=${prevSpeed}`);
    prevSpeed = speed;
  }
});

test('omegaForK and kForOmega are inverses of the same dispersion relation', () => {
  for (const k of [0.01, 0.1, 1, 5]) {
    const omega = omegaForK(k);
    assert.ok(Math.abs(kForOmega(omega) - k) < 1e-9, `round-trip failed for k=${k}`);
  }
  // omega^2 = G*k, directly.
  assert.ok(Math.abs(omegaForK(1) ** 2 - G) < 1e-9);
});

test('peakOmega rises as wind speed falls -- calmer wind means a higher-frequency (shorter-wave) peak', () => {
  const calm = peakOmega(2);
  const stormy = peakOmega(12);
  assert.ok(calm > stormy, `calm peak (${calm}) should exceed stormy peak (${stormy})`);
});

test('pmSpectralDensity is zero or negative-safe outside valid inputs, and positive at the spectrum peak', () => {
  assert.equal(pmSpectralDensity(0, 5), 0);
  assert.equal(pmSpectralDensity(5, 0), 0);
  assert.equal(pmSpectralDensity(-1, 5), 0);
  const wind = 6;
  const atPeak = pmSpectralDensity(peakOmega(wind), wind);
  assert.ok(atPeak > 0, 'density at the spectral peak must be positive');
});

test('buildWaveComponents is deterministic per (seed, windSpeed, count)', () => {
  const a = buildWaveComponents(42, 6, 20);
  const b = buildWaveComponents(42, 6, 20);
  assert.deepEqual(a, b);
});

test('a different seed produces a different field (not degenerate)', () => {
  const a = buildWaveComponents(1, 6, 20);
  const b = buildWaveComponents(2, 6, 20);
  assert.notDeepEqual(a, b);
});

test('every built component is finite and has a positive wavenumber/frequency', () => {
  for (const wind of [0.5, 3, 8, 15]) {
    const comps = buildWaveComponents(7, wind, 24);
    assert.equal(comps.length, 24);
    for (const c of comps) {
      assert.ok(Number.isFinite(c.k) && c.k > 0, `k must be finite and positive, got ${c.k}`);
      assert.ok(Number.isFinite(c.omega) && c.omega > 0, `omega must be finite and positive, got ${c.omega}`);
      assert.ok(Number.isFinite(c.amp) && c.amp >= 0, `amp must be finite and non-negative, got ${c.amp}`);
      assert.ok(c.dir === 1 || c.dir === -1);
    }
  }
});

test('total field variance grows with wind speed -- a stormier sea genuinely carries more energy', () => {
  const calmVar = fieldVariance(buildWaveComponents(3, 2, 32));
  const stormVar = fieldVariance(buildWaveComponents(3, 12, 32));
  assert.ok(stormVar > calmVar, `storm variance (${stormVar}) should exceed calm variance (${calmVar})`);
});

test('waveFieldSample returns finite, bounded displacement across a wide sweep of x and t', () => {
  const comps = buildWaveComponents(9, 8, 24);
  for (let i = 0; i <= 40; i++) {
    const x = i * 137.3;
    const t = i * 3.1;
    const { dx, dy } = waveFieldSample(comps, x, t);
    assert.ok(Number.isFinite(dx) && Number.isFinite(dy), `non-finite at x=${x} t=${t}`);
    // Generous bound: sum of amplitudes is the true ceiling for dy; dx is
    // capped by the steepness limit times the same, so this just guards
    // against a runaway, not a tuned exact bound.
    const ampSum = comps.reduce((s, c) => s + c.amp, 0);
    assert.ok(Math.abs(dy) <= ampSum + 1e-6, `dy exceeded the amplitude ceiling: ${dy} > ${ampSum}`);
    assert.ok(Math.abs(dx) <= ampSum + 1e-6, `dx exceeded the amplitude ceiling: ${dx} > ${ampSum}`);
  }
});

test('the field is deterministic in time -- same (components, x, t) always samples the same point', () => {
  const comps = buildWaveComponents(11, 7, 20);
  const a = waveFieldSample(comps, 500, 12.5);
  const b = waveFieldSample(comps, 500, 12.5);
  assert.deepEqual(a, b);
});

test('swell trains at different k pass through each other -- the field is a true superposition, not a max/blend', () => {
  // Two isolated single-component fields summed directly must equal the
  // field built from both components together, at every sample point --
  // proof there's no per-component gating or clamping hiding in
  // waveFieldSample beyond the shared steepness term (which itself only
  // depends on the full component list length, held equal here).
  const compA = [{ k: 0.05, omega: omegaForK(0.05), amp: 1.5, phase: 0.4, dir: 1 }];
  const compB = [{ k: 0.3, omega: omegaForK(0.3), amp: 0.8, phase: 1.1, dir: -1 }];
  const both = compA.concat(compB);
  for (const t of [0, 5, 17.3]) {
    const sA = waveFieldSample(compA, 300, t);
    const sB = waveFieldSample(compB, 300, t);
    const sBoth = waveFieldSample(both, 300, t);
    // Steepness q depends on components.length, which differs (1 vs 2), so
    // dx isn't linearly additive across different-length component lists --
    // only dy (the plain height sum) is exactly additive. That's the
    // physically meaningful "waves pass through each other" property.
    assert.ok(Math.abs(sBoth.dy - (sA.dy + sB.dy)) < 1e-9, `dy must superpose exactly at t=${t}`);
  }
});

test('windSpeedForSeaState is monotonic and clamps to a sane range', () => {
  assert.ok(windSpeedForSeaState(0) < windSpeedForSeaState(0.5));
  assert.ok(windSpeedForSeaState(0.5) < windSpeedForSeaState(1));
  assert.equal(windSpeedForSeaState(-5), windSpeedForSeaState(0)); // clamps below 0
  assert.equal(windSpeedForSeaState(5), windSpeedForSeaState(1)); // clamps above 1
});

test('easeSeaState never jumps instantly to the target -- a single frame moves only a small fraction of the way', () => {
  const next = easeSeaState(0, 1, 1 / 60, 10);
  assert.ok(next > 0 && next < 0.02, `expected a small step for a 1/60s frame over a 10s tau, got ${next}`);
});

test('easeSeaState converges to the target given enough time, and never overshoots', () => {
  let s = 0;
  for (let i = 0; i < 6000; i++) s = easeSeaState(s, 0.8, 1 / 60, 10); // 100s, 10 time constants
  assert.ok(Math.abs(s - 0.8) < 1e-3, `expected convergence to 0.8, got ${s}`);
  assert.ok(s <= 0.8 + 1e-9, 'must never overshoot the target');
});

test('easeSeaState responds to wind over roughly 10s, not instantaneously -- a drop cannot "make a wave" on one frame', () => {
  let s = 0;
  // After 1 second (1/10 of tau) it should have moved only a modest amount.
  for (let i = 0; i < 60; i++) s = easeSeaState(s, 1, 1 / 60, 10);
  assert.ok(s < 0.2, `expected < 0.2 sea-state rise after 1s of a 10s ease, got ${s}`);
});
