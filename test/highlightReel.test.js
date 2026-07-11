import { test } from 'node:test';
import assert from 'node:assert/strict';

// HighlightReel.capture() creates its own thumbnail canvas via
// document.createElement('canvas'), which doesn't exist in plain Node.
// Stubbing a minimal fake DOM here (before importing the module under
// test) keeps the pure gating/edge-detection logic testable without a
// real browser -- the actual pixel-drawing path is smoke-tested instead.
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage() {},
    }),
    toDataURL: () => 'data:image/jpeg;base64,fake',
  }),
};

const { HighlightReel } = await import('../src/render/HighlightReel.js');

// A minimal fake canvas: capture() only needs drawImage()/toDataURL() on the
// thumbnail canvas HighlightReel creates itself via document.createElement,
// so the "source" canvas passed in just needs to survive drawImage's read.
function fakeSourceCanvas() {
  return { width: 1280, height: 720 };
}

test('canCapture is true from a fresh reel and false once MAX_FRAMES is reached', () => {
  const reel = new HighlightReel();
  assert.equal(reel.canCapture(0), true);
  for (let i = 0; i < 8; i++) {
    assert.equal(reel.notify(`k${i}`, true, fakeSourceCanvas(), i * 6000, `frame ${i}`), true);
  }
  assert.equal(reel.frames.length, 8);
  assert.equal(reel.canCapture(100000), false);
  assert.equal(reel.notify('k9', true, fakeSourceCanvas(), 100000, 'one more'), false);
  assert.equal(reel.frames.length, 8, 'must never exceed the 8-frame cap');
});

test('min-gap: two events within 5s of each other only capture the first', () => {
  const reel = new HighlightReel();
  assert.equal(reel.notify('a', true, fakeSourceCanvas(), 0, 'first'), true);
  // A different event key, but still inside the shared min-gap window.
  assert.equal(reel.notify('b', true, fakeSourceCanvas(), 4999, 'too soon'), false);
  assert.equal(reel.notify('b', true, fakeSourceCanvas(), 5000, 'right at the gap'), true);
  assert.equal(reel.frames.length, 2);
});

test('notify only fires on the rising edge -- holding conditionNow=true does not re-capture', () => {
  const reel = new HighlightReel();
  assert.equal(reel.notify('drop', true, fakeSourceCanvas(), 0, 'Drop'), true);
  assert.equal(reel.notify('drop', true, fakeSourceCanvas(), 100, 'Drop'), false, 'still true -- no new edge');
  assert.equal(reel.notify('drop', true, fakeSourceCanvas(), 200, 'Drop'), false);
  assert.equal(reel.frames.length, 1);
});

test('notify re-fires on a second rising edge for the same key after it falls back to false', () => {
  const reel = new HighlightReel();
  assert.equal(reel.notify('voyage', true, fakeSourceCanvas(), 0, 'Sky Voyage'), true);
  reel.notify('voyage', false, fakeSourceCanvas(), 100, 'Sky Voyage'); // falls
  assert.equal(reel.notify('voyage', true, fakeSourceCanvas(), 6000, 'Sky Voyage'), true, 'a fresh rising edge, past the min-gap');
  assert.equal(reel.frames.length, 2);
});

test('different event keys track independent edges (one does not mask another)', () => {
  const reel = new HighlightReel();
  assert.equal(reel.notify('drop', true, fakeSourceCanvas(), 0, 'Drop'), true);
  // "voyage" has never been seen before -- its own rising edge, but still
  // gated by the shared min-gap, so it's rejected here...
  assert.equal(reel.notify('voyage', true, fakeSourceCanvas(), 500, 'Sky Voyage'), false);
  // ...and succeeds once the shared gap has elapsed, still counting as
  // "voyage"'s own first-ever rising edge.
  assert.equal(reel.notify('voyage', true, fakeSourceCanvas(), 5000, 'Sky Voyage'), true);
});

test('captured frames record atMs and label', () => {
  const reel = new HighlightReel();
  reel.notify('detonation', true, fakeSourceCanvas(), 12345, 'Supernova');
  assert.equal(reel.frames[0].atMs, 12345);
  assert.equal(reel.frames[0].label, 'Supernova');
  assert.equal(typeof reel.frames[0].dataUrl, 'string');
  assert.ok(reel.frames[0].dataUrl.startsWith('data:'));
});

test('capture() directly respects the same gate as notify()', () => {
  const reel = new HighlightReel();
  reel._lastCaptureMs = 0;
  assert.equal(reel.capture(fakeSourceCanvas(), 100, 'too soon'), false);
  assert.equal(reel.capture(fakeSourceCanvas(), 5000, 'ok'), true);
});
