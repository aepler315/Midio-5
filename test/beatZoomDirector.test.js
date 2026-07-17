import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeatZoomDirector, pickFigure, BEAT_ZOOM_MIN, BEAT_ZOOM_MAX_BASE, FIGURES } from '../src/sim/BeatZoomDirector.js';

const DT = 1 / 120;

test('pickFigure is deterministic per (seed, phraseIdx)', () => {
  const a = pickFigure(42, 3, { calmLevel: 0.2 });
  const b = pickFigure(42, 3, { calmLevel: 0.2 });
  assert.equal(a, b);
  assert.ok(FIGURES.includes(a));
});

test('pickFigure always dives on a drop, regardless of mood', () => {
  assert.equal(pickFigure(1, 0, { onDrop: true }), 'dive');
  assert.equal(pickFigure(99, 12, { calmLevel: 0.9, onDrop: true }), 'dive');
});

test('value stays within bounds across a long run, even at max fever and full energy gate', () => {
  const bz = new BeatZoomDirector(7);
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    bz.fever = 1;
    if (i % 40 === 0) bz.onKick(0.9, t);
    if (i % 900 === 0) bz.onDrop(t);
    bz.update(t, DT, {
      phraseIdx: Math.floor(i / 200), barPhase01: (i % 240) / 240,
      calmLevel: (i % 5) / 5, hypeFast: (i % 3) / 3, hypeSlow: 1, beatPeriodMs: 500,
    });
    assert.ok(bz.value >= BEAT_ZOOM_MIN - 1e-6, `value ${bz.value} below floor at step ${i}`);
    assert.ok(bz.value <= BEAT_ZOOM_MAX_BASE * 1.6, `value ${bz.value} blew past the fever-scaled ceiling at step ${i}`);
    t += 1000 / 120;
  }
});

test('a kick snap has a real rise time (not an instant jump) and decays back toward 1', () => {
  const bz = new BeatZoomDirector(3);
  let t = 0;
  // Consume the initial phrase transition (phraseIdx 0 vs the fresh -1
  // default) first, THEN force the figure -- update() re-picks on any
  // phraseIdx change, which would otherwise clobber the forced figure.
  bz.update(t, DT, { phraseIdx: 0, calmLevel: 0, hypeFast: 1, hypeSlow: 1, beatPeriodMs: 500 });
  bz._figure = 'snap'; // force it (mirrors what a phrase boundary would pick under high hypeFast)
  bz.onKick(1, t);

  const samples = [];
  for (let i = 0; i < 150; i++) {
    t += 1000 / 120;
    bz.update(t, DT, { phraseIdx: 0, calmLevel: 0, hypeFast: 1, hypeSlow: 1, beatPeriodMs: 500 });
    samples.push(bz.value);
  }
  const rightAfter = samples[0];
  const peak = Math.max(...samples);
  const settled = samples[samples.length - 1];
  assert.ok(peak > 1, `expected the snap to push value above 1, peak=${peak}`);
  assert.ok(rightAfter - 1 < (peak - 1) * 0.5, `expected a real rise time: right-after offset ${rightAfter - 1} should be well under peak offset ${peak - 1}`);
  assert.ok(Math.abs(settled - 1) < 0.01, `expected the snap to fully decay away, settled at ${settled}`);
});

test('every per-step change stays small (<=0.008 at 120Hz) across kicks, a drop, and phrase-boundary figure changes -- no discontinuities', () => {
  const bz = new BeatZoomDirector(5);
  let t = 0, prevValue = null, maxDelta = 0;
  for (let i = 0; i < 3000; i++) {
    if (i % 25 === 0) bz.onKick(0.7 + 0.3 * Math.random(), t);
    if (i === 1200) bz.onDrop(t);
    bz.update(t, DT, {
      phraseIdx: Math.floor(i / 130), barPhase01: (i % 240) / 240,
      calmLevel: 0.1, hypeFast: 0.6, hypeSlow: 0.8, beatPeriodMs: 480,
    });
    if (prevValue != null) maxDelta = Math.max(maxDelta, Math.abs(bz.value - prevValue));
    prevValue = bz.value;
    t += 1000 / 120;
  }
  assert.ok(maxDelta <= 0.008, `expected every per-step delta <= 0.008, got a max of ${maxDelta}`);
});

test('the breath figure is phase-locked to the bar, not free-running on wall clock', () => {
  const settle = (phase) => {
    const bz = new BeatZoomDirector(11);
    let t = 0, v = 1;
    bz.update(t, DT, { phraseIdx: 0, barPhase01: phase, calmLevel: 0.6, hypeFast: 0, hypeSlow: 1, beatPeriodMs: 500 });
    bz._figure = 'breath'; // force after the initial phrase transition (see kick-snap test comment)
    t += 1000 / 120;
    // Hold the bar phase steady long enough for the eased value to converge.
    for (let i = 0; i < 400; i++) {
      bz.update(t, DT, { phraseIdx: 0, barPhase01: phase, calmLevel: 0.6, hypeFast: 0, hypeSlow: 1, beatPeriodMs: 500 });
      v = bz.value;
      t += 1000 / 120;
    }
    return v;
  };
  const atQuarter = settle(0.25); // sin(2*pi*0.25) = 1 -> should converge to the top of the breath
  const atThreeQuarter = settle(0.75); // sin(2*pi*0.75) = -1 -> the bottom
  const atZero = settle(0); // sin(0) = 0 -> near neutral
  assert.ok(atQuarter > atZero, `expected phase 0.25 (${atQuarter}) above phase 0 (${atZero})`);
  assert.ok(atZero > atThreeQuarter, `expected phase 0 (${atZero}) above phase 0.75 (${atThreeQuarter})`);
});

test('amplitude is gated by the song energy (hypeSlow): quiet passages barely move, loud ones breathe visibly', () => {
  const runFor = (hypeSlow) => {
    const bz = new BeatZoomDirector(9);
    let t = 0, maxOffset = 0;
    bz.update(t, DT, { phraseIdx: 0, barPhase01: 0.25, calmLevel: 0.6, hypeFast: 0, hypeSlow, beatPeriodMs: 500 });
    bz._figure = 'breath'; // force after the initial phrase transition (see kick-snap test comment)
    t += 1000 / 120;
    for (let i = 0; i < 600; i++) {
      bz.update(t, DT, { phraseIdx: 0, barPhase01: 0.25, calmLevel: 0.6, hypeFast: 0, hypeSlow, beatPeriodMs: 500 });
      maxOffset = Math.max(maxOffset, Math.abs(bz.value - 1));
      t += 1000 / 120;
    }
    return maxOffset;
  };
  const quiet = runFor(0);
  const loud = runFor(1);
  assert.ok(loud > quiet * 1.5, `expected loud passages (${loud}) to move noticeably more than quiet ones (${quiet})`);
});
