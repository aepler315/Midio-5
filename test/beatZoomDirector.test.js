import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeatZoomDirector, pickFigure, BEAT_ZOOM_MIN, BEAT_ZOOM_MAX_BASE, FIGURES } from '../src/sim/BeatZoomDirector.js';

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

test('value stays within bounds across a long run, even at max fever', () => {
  const bz = new BeatZoomDirector(7);
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    bz.fever = 1;
    if (i % 40 === 0) bz.onKick();
    if (i % 900 === 0) bz.onDrop(t);
    bz.update(t, 1 / 120, { phraseIdx: Math.floor(i / 200), calmLevel: (i % 5) / 5, hypeFast: (i % 3) / 3, beatPeriodMs: 500 });
    assert.ok(bz.value >= BEAT_ZOOM_MIN - 1e-6, `value ${bz.value} below floor at step ${i}`);
    assert.ok(bz.value <= BEAT_ZOOM_MAX_BASE * 1.6, `value ${bz.value} blew past the fever-scaled ceiling at step ${i}`);
    t += 1000 / 120;
  }
});

test('a kick snap decays back toward 1 once the figure is snap', () => {
  const bz = new BeatZoomDirector(3);
  bz.update(0, 0, { phraseIdx: 0, calmLevel: 0, hypeFast: 1, beatPeriodMs: 500 });
  // Force the figure directly (mirrors what a phrase boundary would pick under high hypeFast).
  bz._figure = 'snap';
  bz.onKick();
  bz.update(1, 1 / 1000, { phraseIdx: 0, calmLevel: 0, hypeFast: 1, beatPeriodMs: 500 });
  const justAfter = bz.value;
  assert.ok(justAfter > 1, 'snap should push the value above 1 right after a kick');
  let t = 1;
  for (let i = 0; i < 200; i++) {
    t += 1000 / 120;
    bz.update(t, 1000 / 120 / 1000, { phraseIdx: 0, calmLevel: 0, hypeFast: 1, beatPeriodMs: 500 });
  }
  assert.ok(bz.value < justAfter, 'the snap must decay away, not stay pinned');
  assert.ok(Math.abs(bz.value - 1) < 0.01, 'settles back near 1 once the snap has fully decayed');
});

test('a phrase-boundary figure change never causes a value discontinuity', () => {
  const bz = new BeatZoomDirector(5);
  let t = 0, prevValue = null;
  for (let i = 0; i < 2000; i++) {
    bz.update(t, 1000 / 120 / 1000, {
      phraseIdx: Math.floor(i / 150), calmLevel: 0.1, hypeFast: 0.6, beatPeriodMs: 480,
    });
    if (prevValue != null) assert.ok(Math.abs(bz.value - prevValue) < 0.05, `jump at step ${i}: ${prevValue} -> ${bz.value}`);
    prevValue = bz.value;
    t += 1000 / 120;
  }
});
