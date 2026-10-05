// The land carries restrained musical motion between the larger section swells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RidgeMotionHistory } from '../src/world/RidgeMotionHistory.js';
import { LAND_SWELL, RANGE_MOTION_REFERENCE_M, landMoment01, landMotion, landWaveDir, rangeMusicState, sceneDeformation, calibrateRangeMusic } from '../src/world/alpine/RangeFrame.js';

const sections = [
  { startMs: 0, label: 'intro', meanEnergy: 0.2, relEnergy01: 0.2 },
  { startMs: 20000, label: 'verse', meanEnergy: 0.3, relEnergy01: 0.4 },
  { startMs: 40000, label: 'drop', meanEnergy: 0.9, relEnergy01: 1 },
  { startMs: 60000, label: 'drop', meanEnergy: 0.9, relEnergy01: 1 },
];
const span = LAND_SWELL.riseMs + LAND_SWELL.holdMs + LAND_SWELL.settleMs;

test('section swells are absent between moments and at the song start', () => {
  for (const t of [0, 5000, 19999, 20000 + span, 39000, 60000 + 4000, 90000]) assert.equal(landMoment01(sections, t), 0, `${t}`);
  assert.equal(landMoment01(null, 1000), 0);
});

test('a lift into a louder part swells fully; a plain change swells less; a repeat not at all', () => {
  const peakOf = (start) => Math.max(...Array.from({ length: 60 }, (_, i) => landMoment01(sections, start + i * 250)));
  const drop = peakOf(40000), verse = peakOf(20000);
  assert.ok(drop > 0.9, `${drop}`);
  assert.ok(Math.abs(verse - LAND_SWELL.changeFloor) < 0.05, `${verse}`);
  assert.equal(peakOf(60000), 0, 'drop into the same drop');
});

test('a swell rises and settles slowly: no frame jolts', () => {
  let prev = 0, maxStep = 0;
  for (let t = 39000; t < 40000 + span + 1000; t += 1000 / 24) {
    const m = landMoment01(sections, t);
    maxStep = Math.max(maxStep, Math.abs(m - prev));
    prev = m;
  }
  assert.ok(maxStep < 0.03, `${maxStep}`);
});

test('heard music moves the land between sections, below the big-moment budget', () => {
  const loud = rangeMusicState({ env: { groove: 1, sustain: 1, kickMul: 1, gesture: 1 }, evaluatedKick01: 1,
    melody: { activity: 1, pitch01: 0.8, pan: 0.3 }, structural01: 1, activity01: 1, tSec: 12 });
  const playing = landMotion(loud, 0, { tSec: 12 });
  assert.ok(Math.abs(sceneDeformation(playing, 900, 400, 1800, [0, 2000])) > 1);
  assert.equal(playing.source, loud, 'the heard channels stay on the frame');
  assert.equal(playing.kick01, loud.kick01, 'water still ripples to the kick');
  const calibrated = calibrateRangeMusic(playing, { depthM: 1000, heightRange: [0, 2000] });
  assert.ok(calibrated.projectedBoundPx >= 4 && calibrated.projectedBoundPx <= 9,
    `musical motion must be legible but restrained: ${calibrated.projectedBoundPx}px`);
  const swell = landMotion(loud, 1, { tSec: 12 });
  assert.ok(Math.abs(sceneDeformation(swell, 900, 400, 1800, [0, 2000])) > 1);
  assert.ok(swell.totalBoundM > playing.totalBoundM * 2, 'section turns remain the big gesture');
  assert.ok(swell.totalBoundM <= RANGE_MOTION_REFERENCE_M);
  assert.equal(sceneDeformation(landMotion(loud, 1, { tSec: 12, reducedMotion: true }), 900, 400, 1800, [0, 2000]), 0);
});

test('each musical channel survives independently without moving shores or silent land', () => {
  const base = { activity01: 1, motionPresence01: 1, tSec: 12 };
  const neutral = landMotion(rangeMusicState(base), 0, { tSec: 12 });
  const at = m => sceneDeformation(m, 900, 400, 1800, [0, 2000]);
  for (const input of [
    { evaluatedKick01: 1 }, { melody: { activity: 1, pitch01: .8 } },
    { env: { sustain: 1 } },
  ]) {
    const music = landMotion(rangeMusicState({ ...base, ...input }), 0, { tSec: 12 });
    // A travelling wave can cross zero at one point; measure the flank.
    const response = Math.max(...[0, 400, 900, 1600, 2400].map(x => Math.abs(
      sceneDeformation(music, x, 400, 1800, [0, 2000])
      - sceneDeformation(neutral, x, 400, 1800, [0, 2000]))));
    assert.ok(response > .5, JSON.stringify(input));
    assert.ok(sceneDeformation(music, 900, 400, 1800, [0, 2000], 0) === 0, 'shore pinned');
    assert.ok(sceneDeformation(music, 900, 400, 0, [0, 2000]) === 0, 'valley pinned');
  }
  assert.equal(at(landMotion(rangeMusicState(), 0, { tSec: 12 })), 0, 'silence has no idle heave');
});

test('dense music plus a full swell stays inside the calibrated geological budget', () => {
  const source = rangeMusicState({ env: { groove: 1, sustain: 1, scaleMul: 1.3, kickMul: 1, gesture: 1 },
    evaluatedKick01: 1, melody: { activity: 1, pitch01: 1 }, activity01: 1 });
  for (let i = 0; i <= 20; i++) {
    const m = landMotion(source, i / 20, { tSec: 12 });
    assert.ok(m.totalBoundM <= RANGE_MOTION_REFERENCE_M);
    const c = calibrateRangeMusic(m, { depthM: 40000, heightRange: [0, 30] });
    assert.ok(c.totalBoundM <= 1.95, 'geological cap survives the sum of all channels');
    for (let x = -4000; x < 4000; x += 317) {
      assert.ok(Math.abs(sceneDeformation(c, x, 1000, 30, [0, 30])) <= c.totalBoundM + 1e-9);
    }
    const reduced = landMotion(source, i / 20, { reducedMotion: true });
    assert.equal(reduced.totalBoundM, 0);
  }
});

test('late-song pitch changes do not accelerate the melodic carrier', () => {
  const motion = (tSec, pitch01) => landMotion(rangeMusicState({ tSec,
    activity01: 1, melody: { activity: 1, pitch01 } }), 0, { tSec });
  for (const tSec of [10, 300, 600]) {
    const low = motion(tSec, .2), high = motion(tSec, .8);
    assert.equal(low.melodyPhaseRad, high.melodyPhaseRad, 'pitch changes shape, never accumulated phase');
    assert.notEqual(low.melodicM, high.melodicM, 'melodic expression remains');
    assert.notEqual(low.melodyK, high.melodyK, 'pitch still changes wavelength');
  }
});

test('a smooth MIDI pitch change five minutes in has no visible frame jolts', () => {
  const history = new RidgeMotionHistory({ durationMs: 302000, timeline: [
    { vel: 1, src: 'midi', role: 'BASS', lane: 'MIDIO', tMs: 299000, durMs: 1000, pitch: 48 },
    { vel: 1, src: 'midi', role: 'BASS', lane: 'MIDIO', tMs: 300000, durMs: 1000, pitch: 84 },
  ] });
  const metresPerPixel = 1000 / (360 / Math.tan(20 * Math.PI / 180));
  let previous, maxStep = 0;
  for (let t = 300000; t <= 300700; t += 1000 / 60) {
    const s = history.sample(t);
    const source = rangeMusicState({ tSec: t / 1000, melody: s.motionMelody,
      activity01: s.activity01, motionPresence01: s.motionPresence01 });
    const m = calibrateRangeMusic(landMotion(source, 0, { tSec: t / 1000 }),
      { depthM: 1000, heightRange: [0, 2000] });
    const y = sceneDeformation(m, 900, 400, 2000, [0, 2000]) / metresPerPixel;
    if (previous != null) maxStep = Math.max(maxStep, Math.abs(y - previous));
    previous = y;
  }
  assert.ok(maxStep < .35, `late pitch transition jumps ${maxStep}px per frame`);
});

test('a louder repeat of the same part still never swells', () => {
  const secs = [{ startMs: 0, label: 'a', meanEnergy: 0.1, relEnergy01: 0.1 }, { startMs: 20000, label: 'a', meanEnergy: 0.9, relEnergy01: 1 }];
  for (let t = 20000; t < 20000 + span; t += 500) assert.equal(landMoment01(secs, t), 0);
});

test('a live re-analysis keeps the swells already heard and starts none in the past', () => {
  // Playing on the opening analysis: a change at 30 s. The whole-song
  // analysis lands at 36 s with that boundary moved to 33 s and a new one at 35 s.
  const before = [{ startMs: 0, label: 'a' }, { startMs: 30000, label: 'b' }];
  const after = [{ startMs: 0, label: 'a' }, { startMs: 33000, label: 'b' }, { startMs: 35000, label: 'c' }, { startMs: 50000, label: 'd' }];
  const history = { sections: before, throughMs: 36000 };
  for (let t = 36000; t < 46000; t += 1000 / 24) {
    assert.equal(landMoment01(after, t, history), landMoment01(before, t), `${t}`);
  }
  // Boundaries after the handoff come from the new analysis.
  assert.ok(landMoment01(after, 54000, history) > 0.3);
  assert.equal(landMoment01(before, 54000), 0);
});

test('boundaries crossed while the show was rebuilt start no swell after it rejoins', () => {
  // Cutoff captured at 36 s; the rebuilt show rejoins the kept audio at 40 s.
  const before = [{ startMs: 0, label: 'a' }];
  const after = [{ startMs: 0, label: 'a' }, { startMs: 38000, label: 'b' }, { startMs: 41000, label: 'c' }];
  const history = { sections: before, throughMs: 36000, rejoinMs: 40000 };
  assert.equal(landMoment01(after, 40000, history), 0, 'the 38 s change was never seen, so it starts nothing');
  assert.ok(landMoment01(after, 44000, history) > 0.3, 'the 41 s change swells as usual');
  // Without the rejoin time the 38 s change would pop in mid-rise.
  assert.ok(landMoment01(after, 40000, { sections: before, throughMs: 36000 }) > 0);
});

test('a decorative pacing cut never swells, even between different labels', () => {
  const secs = [{ startMs: 0, label: 'a' }, { startMs: 80000, label: 'b', provenance: 'decorative' }];
  for (let t = 80000; t < 80000 + span; t += 500) assert.equal(landMoment01(secs, t), 0);
});

test('the swell keeps one direction for the whole song', () => {
  const a = rangeMusicState({ motif: { angle: 0.4 }, tSec: 3 }), b = rangeMusicState({ motif: { angle: -0.4 }, tSec: 3 });
  assert.notDeepEqual(a.waveDir, b.waveDir, 'the heard channels still turn with the section');
  assert.deepEqual(landMotion(a, 0.5, { seed: 7 }).waveDir, landMotion(b, 0.5, { seed: 7 }).waveDir);
  assert.deepEqual(landMotion(a, 0.5, { seed: 7 }).waveDir, landWaveDir(7));
});

test('an authored section cue swells even when the analysis gave both sides one label', () => {
  const secs = [{ startMs: 0, label: 0 }, { startMs: 32000, label: 0, provenance: 'authored' }];
  assert.ok(landMoment01(secs, 32000 + LAND_SWELL.riseMs + 1000) >= LAND_SWELL.changeFloor - 1e-9);
});
