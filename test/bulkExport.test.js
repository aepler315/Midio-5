import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepExportClock, evenExportSize } from '../src/render/BulkExport.js';

// A recording stepper: every call is kept so the tests can assert on the
// shape of the advance, not just where it ended up.
function recorder() {
  const calls = [];
  return { calls, step: (dt, at) => calls.push({ dt, at }) };
}

test('stepExportClock advances in whole fixed steps', () => {
  const { calls, step } = recorder();
  const advanced = stepExportClock({ simTime: 0, targetMs: 50, stepMs: 10, step });
  assert.deepEqual(advanced, { simTime: 50, steps: 5 });
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0], { dt: 10, at: 10 });
  assert.deepEqual(calls[4], { dt: 10, at: 50 });
});

test('stepExportClock reports the instant it actually reached, not the one asked for', () => {
  // 33.37ms is a real frame interval (29.97fps) against a 16ms step: the
  // exporter must draw what was simulated, or the sim would drift behind the
  // time written into the video.
  const { calls, step } = recorder();
  const advanced = stepExportClock({ simTime: 0, targetMs: 33.37, stepMs: 16, step });
  assert.equal(advanced.steps, 2);
  assert.equal(advanced.simTime, 32);
  assert.equal(calls.at(-1).at, 32);
});

test('stepExportClock carries the remainder into the next frame rather than losing it', () => {
  // Frame times accumulate, so the leftover from one frame is made up by the
  // next. Over four frames of 33.37ms the clock must not fall a step behind
  // per frame.
  const { calls, step } = recorder();
  let simTime = 0;
  for (let frame = 1; frame <= 4; frame += 1) {
    simTime = stepExportClock({ simTime, targetMs: frame * 33.37, stepMs: 16, step }).simTime;
  }
  assert.equal(calls.length, 8);
  assert.equal(simTime, 128);
  // Still within one step of the requested 133.48ms, not four steps adrift.
  assert.ok(133.48 - simTime < 16);
});

test('stepExportClock does not run backwards', () => {
  const { calls, step } = recorder();
  const advanced = stepExportClock({ simTime: 100, targetMs: 40, stepMs: 10, step });
  assert.deepEqual(advanced, { simTime: 100, steps: 0 });
  assert.equal(calls.length, 0);
});

test('stepExportClock re-requesting the same frame is a no-op', () => {
  const { calls, step } = recorder();
  const first = stepExportClock({ simTime: 0, targetMs: 40, stepMs: 10, step });
  const again = stepExportClock({ simTime: first.simTime, targetMs: 40, stepMs: 10, step });
  assert.equal(again.simTime, first.simTime);
  assert.equal(again.steps, 0);
  assert.equal(calls.length, 4);
});

test('stepExportClock refuses a step that would never reach the target', () => {
  const { step } = recorder();
  // Each of these would spin forever in a naive loop.
  for (const stepMs of [0, -16, NaN, Infinity]) {
    assert.throws(() => stepExportClock({ simTime: 0, targetMs: 100, stepMs, step }), /positive number of milliseconds/);
  }
});

test('stepExportClock refuses times that are not numbers', () => {
  const { step } = recorder();
  assert.throws(() => stepExportClock({ simTime: NaN, targetMs: 10, stepMs: 10, step }), /clock time is not a number/);
  assert.throws(() => stepExportClock({ simTime: 0, targetMs: NaN, stepMs: 10, step }), /frame time is not a number/);
  assert.throws(() => stepExportClock({ simTime: 0, targetMs: 10, stepMs: 10 }), /step function/);
});

test('evenExportSize passes an even pair through unchanged', () => {
  assert.deepEqual(evenExportSize({ w: 1280, h: 720 }), { w: 1280, h: 720 });
  assert.deepEqual(evenExportSize({ w: 800, h: 480 }), { w: 800, h: 480 });
  assert.deepEqual(evenExportSize({ w: 2, h: 2 }), { w: 2, h: 2 });
});

test('evenExportSize is idempotent', () => {
  // startTimeline re-validates a size beginBulkExport already approved.
  const once = evenExportSize({ w: 3840, h: 2160 });
  assert.deepEqual(evenExportSize(once), once);
});

test('evenExportSize coerces numeric strings, as query parameters arrive', () => {
  assert.deepEqual(evenExportSize({ w: '1920', h: '1080' }), { w: 1920, h: 1080 });
});

test('evenExportSize rejects odd sizes rather than nudging them', () => {
  // Silently exporting 1279 wide would change the aspect ratio of a long
  // render without saying so.
  assert.equal(evenExportSize({ w: 1279, h: 720 }), null);
  assert.equal(evenExportSize({ w: 1280, h: 721 }), null);
});

test('evenExportSize rejects sizes that are not usable pixels', () => {
  for (const size of [
    { w: NaN, h: 720 }, { w: 1280, h: NaN },
    { w: 0, h: 0 }, { w: -1280, h: -720 },
    { w: 1280.5, h: 720 }, { w: Infinity, h: 720 },
    { w: 'wide', h: 'tall' },
  ]) {
    assert.equal(evenExportSize(size), null, `${size.w}x${size.h} should be rejected`);
  }
});

test('evenExportSize survives a missing size', () => {
  // `exportSize || fromUrl || bulkExportSize` is null when nothing is armed.
  assert.equal(evenExportSize(null), null);
  assert.equal(evenExportSize(undefined), null);
  assert.equal(evenExportSize(1280), null);
});
