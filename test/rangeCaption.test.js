// The caption naming the real range behind The Range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLED_RANGE, RangeCaption, rangeCaptionFor } from '../src/ui/RangeCaption.js';

test('only the alpine world gets a caption', () => {
  const hood = { id: 'mount-hood', name: 'Mount Hood', region: 'Oregon, USA', source: 'discovered' };
  assert.equal(rangeCaptionFor(hood, 'ocean'), null);
  assert.equal(rangeCaptionFor(hood, undefined), null);
  assert.deepEqual(rangeCaptionFor(hood, 'alpine'), {
    title: 'Mount Hood', place: 'Oregon, USA',
    credit: 'Real elevation: AWS Terrain Tiles · summit: GeoNames (CC BY 4.0)',
  });
});

test('a curated range is not credited to GeoNames; no match names the bundled Tetons', () => {
  const rainier = rangeCaptionFor({ name: 'Mount Rainier', region: 'Washington, USA', source: 'curated' }, 'alpine');
  assert.ok(!rainier.credit.includes('GeoNames'));
  assert.equal(rangeCaptionFor(null, 'alpine').title, BUNDLED_RANGE.name);
});

function fakeEl() {
  const classes = new Set(['hidden']);
  const parts = { title: { textContent: '' }, place: { textContent: '' }, credit: { textContent: '' } };
  return {
    classes, parts,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    querySelector: (sel) => parts[sel.match(/data-part="(\w+)"/)[1]],
  };
}

function fakeClock() {
  let now = 0; const queue = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; queue.push(t); return t; },
    clearTimer: (t) => { const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); },
    advance(ms) {
      now += ms;
      for (const t of queue.filter((q) => q.at <= now)) { queue.splice(queue.indexOf(t), 1); t.fn(); }
    },
  };
}

test('the caption fades in after the delay, holds, then fades out', () => {
  const el = fakeEl(), clock = fakeClock();
  const cap = new RangeCaption(el, clock);
  cap.show({ title: 'Denali', place: 'Alaska, USA', credit: 'c' }, { delayMs: 100, holdMs: 1000 });
  assert.equal(el.parts.title.textContent, 'Denali');
  assert.ok(!el.classes.has('hidden') && !el.classes.has('shown'));
  clock.advance(100);
  assert.ok(el.classes.has('shown'));
  clock.advance(1000);
  assert.ok(!el.classes.has('shown'));
});

test('stopping the song cancels a pending caption', () => {
  const el = fakeEl(), clock = fakeClock();
  const cap = new RangeCaption(el, clock);
  cap.show({ title: 'Denali' }, { delayMs: 100, holdMs: 1000 });
  cap.hide();
  clock.advance(500);
  assert.ok(!el.classes.has('shown'), 'the next song must not inherit the last one\'s caption');
  cap.show(null);
  assert.ok(!el.classes.has('shown'), 'no caption for a non-alpine world');
});

test('the default timers work when called as methods', async () => {
  const el = fakeEl();
  const cap = new RangeCaption(el);
  cap.show({ title: 'Denali' }, { delayMs: 0, holdMs: 10000 });
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(el.classes.has('shown'));
  cap.hide();
});
