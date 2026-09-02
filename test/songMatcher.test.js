// Two things decide whether syncing to a room is worth doing at all: can a
// few seconds heard through a microphone pick the right song out of what the
// device knows, and does it report the right PLACE in it. A wrong answer to
// either is worse than no answer -- a show synced to the wrong master looks
// broken rather than absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchProbe, positionMsAt, SyncTracker, bitErrorAt, FRAME_TAIL_MS,
  MATCH_MARGIN, MIN_PROBE_SEC,
} from '../src/audio/SongMatcher.js';
import { fingerprintMono } from '../src/audio/SongFingerprint.js';
import { packBundle } from '../src/audio/AnalysisBundle.js';

const RATE = 44100;

/** Broadband pseudo-music -- see songFingerprint.test.js for why a few sine
 *  partials would be testing the behaviour of empty bands instead. */
function makeSong(seconds, seed = 1) {
  const n = Math.floor(seconds * RATE);
  const out = new Float32Array(n);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const sections = Math.max(1, Math.floor(seconds / 2));
  const roots = [], tilts = [];
  for (let i = 0; i < sections; i++) { roots.push(90 + rnd() * 70); tilts.push(0.5 + rnd()); }
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const sec = Math.min(sections - 1, Math.floor(t / 2));
    let v = 0;
    for (let h = 2; h <= 30; h++) {
      const f = roots[sec] * h;
      if (f < 250 || f > 3000) continue;
      v += Math.sin(2 * Math.PI * f * t + h) * (0.35 / Math.pow(h, tilts[sec]));
    }
    nz += 0.25 * ((rnd() * 2 - 1) - nz);
    v += nz * 0.28;
    const phase = (t * 2) % 1;
    if (phase < 0.02) v += 0.4 * (1 - phase / 0.02) * (rnd() * 2 - 1);
    out[i] = v * 0.5;
  }
  return out;
}

/** A bundle carrying only what the matcher reads: the fingerprint frames. */
function bundleOf(samples, key) {
  const fp = fingerprintMono(samples, RATE);
  const bundle = packBundle(
    { timeline: [], barGrid: [], durationMs: (samples.length / RATE) * 1000, energyCurves: null },
    { fingerprint: { key, frames: fp.frames, frameHz: fp.frameHz }, name: key },
  );
  return { key, bundle };
}

/** What a microphone would give: quieter, filtered, and noisy. */
function throughARoom(samples, seed = 5) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = new Float32Array(samples.length);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y += 0.4 * (samples[i] - y);
    out[i] = (y * 0.8 + samples[i] * 0.3) * 0.5 + (rnd() * 2 - 1) * 0.02;
  }
  return out;
}

test('position is measured at the probe end, which is now', () => {
  // Reporting the probe's START would run the show a whole probe-length
  // behind the music -- seconds of lag that reads as sluggishness.
  assert.equal(positionMsAt(0, 1, 62.5), FRAME_TAIL_MS);
  const tenFramesIn = positionMsAt(10, 1, 62.5);
  assert.ok(Math.abs(tenFramesIn - (160 + FRAME_TAIL_MS)) < 1, `got ${tenFramesIn}`);
  // A 4-frame probe starting at frame 10 ends at frame 13.
  assert.ok(Math.abs(positionMsAt(10, 4, 62.5) - ((13 / 62.5) * 1000 + FRAME_TAIL_MS)) < 1e-6);
});

test('the frame tail is a real offset, not a rounding fudge', () => {
  // One hop because a frame's bits describe its successor, one window because
  // the audio runs that far past where the frame begins. Both are small and
  // both were missing at first, which biased every position 144ms early --
  // invisible to a test that only asks whether the right song was found.
  assert.ok(Math.abs(FRAME_TAIL_MS - 144) < 1e-6, `expected 144ms, got ${FRAME_TAIL_MS}`);
});

test('capture latency is added, because the music kept playing during it', () => {
  // The newest sample in the ring is already stale by a capture batch plus
  // the device's own buffering. The song did not pause for that.
  const withNone = positionMsAt(100, 10, 62.5, 0);
  const withLatency = positionMsAt(100, 10, 62.5, 90);
  assert.ok(Math.abs((withLatency - withNone) - 90) < 1e-9);
});

test('it finds the playing song among several and locates the moment', () => {
  const songs = [makeSong(30, 1), makeSong(30, 2), makeSong(30, 3)];
  const cands = songs.map((s, i) => bundleOf(s, `k${i}`));
  const startSec = 11;
  const probe = songs[1].subarray(startSec * RATE, (startSec + 6) * RATE);
  const hit = matchProbe(probe, RATE, cands);
  assert.ok(hit, 'a clean excerpt of a known song must match');
  assert.equal(hit.key, 'k1');
  const endSec = startSec + 6;
  assert.ok(Math.abs(hit.positionMs / 1000 - endSec) < 0.4,
    `expected ~${endSec}s, got ${(hit.positionMs / 1000).toFixed(2)}s`);
});

test('it still works on audio that went through a room', () => {
  const songs = [makeSong(30, 7), makeSong(30, 8)];
  const cands = songs.map((s, i) => bundleOf(s, `k${i}`));
  const startSec = 16;
  const probe = throughARoom(songs[0].subarray(startSec * RATE, (startSec + 6) * RATE));
  const hit = matchProbe(probe, RATE, cands);
  assert.ok(hit, 'a room-degraded excerpt should still match');
  assert.equal(hit.key, 'k0');
  assert.ok(Math.abs(hit.positionMs / 1000 - (startSec + 6)) < 0.5,
    `got ${(hit.positionMs / 1000).toFixed(2)}s`);
});

test('a song the device does not know is refused, not guessed at', () => {
  const cands = [bundleOf(makeSong(30, 1), 'a'), bundleOf(makeSong(30, 2), 'b')];
  const stranger = makeSong(30, 99).subarray(5 * RATE, 11 * RATE);
  assert.equal(matchProbe(stranger, RATE, cands), null);
});

test('two candidates that fit equally well produce no verdict', () => {
  // The same recording cached twice under two keys: the error is low for
  // both and there is genuinely no way to tell which is playing. Refusing is
  // the correct outcome, not picking one.
  const song = makeSong(30, 4);
  const cands = [bundleOf(song, 'rip-a'), bundleOf(song, 'rip-b')];
  const probe = song.subarray(9 * RATE, 15 * RATE);
  assert.equal(matchProbe(probe, RATE, cands), null,
    'an ambiguous match must be refused');
});

test('the margin rule does not block a lone candidate', () => {
  // With one bundle there is no runner-up to beat, so only the error matters.
  const song = makeSong(30, 4);
  const hit = matchProbe(song.subarray(9 * RATE, 15 * RATE), RATE, [bundleOf(song, 'only')]);
  assert.ok(hit);
  assert.equal(hit.key, 'only');
});

test('too short a probe is not enough evidence', () => {
  const song = makeSong(30, 1);
  const cands = [bundleOf(song, 'a')];
  const short = song.subarray(0, Math.floor((MIN_PROBE_SEC - 1) * RATE));
  assert.equal(matchProbe(short, RATE, cands), null);
});

test('empty inputs are handled rather than thrown on', () => {
  assert.equal(matchProbe(null, RATE, []), null);
  assert.equal(matchProbe(new Float32Array(0), RATE, []), null);
  assert.equal(matchProbe(makeSong(6), RATE, []), null);
  assert.equal(matchProbe(makeSong(6), RATE, null), null);
});

test('a candidate shorter than the probe is skipped, not misaligned', () => {
  const song = makeSong(30, 1);
  const cands = [bundleOf(makeSong(2, 5), 'tiny'), bundleOf(song, 'real')];
  const hit = matchProbe(song.subarray(10 * RATE, 16 * RATE), RATE, cands);
  assert.ok(hit);
  assert.equal(hit.key, 'real');
});

test('the reported error and margin describe the verdict', () => {
  const songs = [makeSong(30, 1), makeSong(30, 2)];
  const cands = songs.map((s, i) => bundleOf(s, `k${i}`));
  const hit = matchProbe(songs[0].subarray(8 * RATE, 14 * RATE), RATE, cands);
  assert.ok(hit.ber >= 0 && hit.ber < 0.3);
  assert.ok(hit.margin >= MATCH_MARGIN, `margin ${hit.margin} should clear the bar`);
});

// --- SyncTracker ----------------------------------------------------------

test('a small error is walked off gradually, never jumped', () => {
  // A show that teleports its playhead re-fires section changes and snaps the
  // camera; one that runs a few percent fast for a moment is invisible.
  const t = new SyncTracker();
  const { jump } = t.measure(10_200, 10_000);
  assert.equal(jump, false);
  let moved = 0;
  for (let i = 0; i < 500; i++) moved += t.step(16);
  assert.ok(Math.abs(moved - 200) < 1, `should have eased the full 200ms, moved ${moved}`);
  assert.equal(t.pending, 0);
});

test('the ease never runs faster than its rate limit', () => {
  const t = new SyncTracker({ easeRate: 0.04 });
  t.measure(10_200, 10_000);
  const one = t.step(16);
  assert.ok(one <= 16 * 0.04 + 1e-9, `one frame moved ${one}, over the 4% budget`);
});

test('a correction backwards is eased too', () => {
  const t = new SyncTracker();
  t.measure(9_800, 10_000);
  let moved = 0;
  for (let i = 0; i < 500; i++) moved += t.step(16);
  assert.ok(Math.abs(moved + 200) < 1, `should have eased -200ms, moved ${moved}`);
});

test('a seek is too far to walk off and is reported as a jump', () => {
  const t = new SyncTracker({ maxEaseMs: 400 });
  const { jump, errorMs } = t.measure(60_000, 10_000);
  assert.equal(jump, true);
  assert.equal(errorMs, 50_000);
  assert.equal(t.step(16), 0, 'a jump leaves nothing to ease');
});

test('a new measurement replaces the outstanding correction', () => {
  // Corrections must not accumulate: each measurement is the whole truth
  // about the error, not an increment to it.
  const t = new SyncTracker();
  t.measure(10_100, 10_000);
  t.step(16);
  t.measure(10_050, 10_000);
  assert.ok(Math.abs(t.pending - 50) < 1e-9, `pending should be the latest error, got ${t.pending}`);
});

test('with nothing pending the clock is left alone', () => {
  const t = new SyncTracker();
  assert.equal(t.step(16), 0);
});

test('the correlation peak is one frame wide, which is why no coarse stride exists', () => {
  // A regression test for a bug I wrote and removed. Scanning candidates at a
  // coarse stride and refining around the winner is the obvious way to make
  // matching cheaper. It cannot work here, and this pins the reason so nobody
  // reintroduces it: the peak has no shoulders. Two frames off the true
  // alignment the error is already at the noise floor, so a strided scan has
  // nothing to follow toward the answer -- it steps over it and reports
  // whatever it happened to land on.
  const song = makeSong(30, 4);
  const ref = fingerprintMono(song, RATE).frames;
  const probe = fingerprintMono(song.subarray(9 * RATE, 15 * RATE), RATE).frames;

  let peakOff = 0, peakBer = 1;
  for (let off = 0; off + probe.length <= ref.length; off++) {
    const ber = bitErrorAt(ref, probe, off);
    if (ber < peakBer) { peakBer = ber; peakOff = off; }
  }
  assert.ok(peakBer < 0.2, `the true alignment should be clear, got ${peakBer}`);
  // Two frames away — 32ms — and the signal is gone.
  for (const d of [-4, -2, 2, 4]) {
    const near = bitErrorAt(ref, probe, peakOff + d);
    assert.ok(near > 0.35,
      `offset ${d} from the peak should be at the noise floor, got ${near}`);
  }
});

test('a steady rate difference is learned, not chased forever', () => {
  // Correcting only the offset leaves the show permanently behind by whatever
  // accumulates between checks: each correction is undone before the next
  // measurement arrives. Two independent clocks -- a phone's audio hardware
  // and whatever is playing the song -- genuinely do not tick at the same
  // speed, so the rate has to be part of the model.
  const t = new SyncTracker();
  const DRIFT = 1.02;      // the music runs 2% faster than this page's clock
  const INTERVAL = 15000;
  let clock = 0, song = 0;
  let lastError = 0;
  for (let round = 0; round < 6; round++) {
    // Fifteen seconds of frames: the clock advances by dt plus whatever the
    // tracker asks for, the song by its own faster rate.
    for (let i = 0; i < INTERVAL / 16; i++) {
      clock += 16 + t.step(16);
      song += 16 * DRIFT;
    }
    const { jump, errorMs } = t.measure(song, clock);
    assert.equal(jump, false, `round ${round} should not need a jump`);
    lastError = errorMs;
  }
  assert.ok(Math.abs(t.rate - DRIFT) < 0.005, `rate should converge on ${DRIFT}, got ${t.rate}`);
  assert.ok(Math.abs(lastError) < 40,
    `residual error should shrink to near zero, still ${lastError.toFixed(0)}ms`);
});

test('the rate estimate ignores intervals too short to be evidence', () => {
  const t = new SyncTracker();
  t.measure(1000, 1000);
  t.measure(2500, 1500); // 1.5s apart: noise, not a rate
  assert.equal(t.rate, 1);
});

test('an implausible ratio is rejected rather than adopted', () => {
  // A bad match or a seek under the jump threshold would otherwise make the
  // show sprint.
  const t = new SyncTracker();
  t.measure(0, 0);
  t.measure(60_000, 10_000);
  assert.equal(t.rate, 1, 'a 6x ratio is not a clock running fast');
});

test('a jump restarts the rate estimate rather than measuring across it', () => {
  // The interval spanning a discontinuity says nothing about relative speed.
  const t = new SyncTracker();
  t.measure(10_000, 10_000);
  const { jump } = t.measure(80_000, 25_000);
  assert.equal(jump, true);
  assert.equal(t.lastMeasuredMs, null);
  assert.equal(t.lastClockMs, null);
  assert.equal(t.rate, 1, 'no rate may be inferred across the jump');
});

test('with no drift the rate stays at one and the clock is left alone', () => {
  const t = new SyncTracker();
  let clock = 0, song = 0;
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 1000; i++) { clock += 16 + t.step(16); song += 16; }
    t.measure(song, clock);
  }
  assert.ok(Math.abs(t.rate - 1) < 1e-6, `rate drifted to ${t.rate}`);
  assert.equal(t.step(16), 0);
});
