import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWorldFrame } from '../tools/world-frame.mjs';

test('controlled capture seeks before reading the replacement scene and rendering', () => {
  const calls = [];
  const sim = { timeMs: 18080, biomes: { tSec: 18.08, world: { kind: 'nave', response: { smoothingMs: 1400 } } } };
  const replacement = { sim, perf: { level: 6 }, renderer: { draw: (s) => calls.push(['draw', s]) } };
  globalThis.window = { __SMW: { sim: { timeMs: 27080 }, renderer: { draw: (s) => calls.push(['draw', s]) }, seek: (ms) => { calls.push(['seek', ms]); window.__SMW = replacement; } } };
  globalThis.document = { querySelector: () => ({ width: 1280, height: 720 }) };
  try {
    const capture = renderWorldFrame({ atMs: 18000, quality: 0 });
    assert.deepEqual(calls, [['seek', 18000], ['draw', sim]]);
    assert.equal(replacement.perf.level, 0);
    assert.equal(capture.requestedMs, 18000);
    assert.equal(capture.timeMs, 18080);
    assert.equal(capture.response.smoothingMs, 1400);
    assert.deepEqual(capture.backingStore, { width: 1280, height: 720 });
  } finally { delete globalThis.window; delete globalThis.document; }
});
