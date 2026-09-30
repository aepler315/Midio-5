import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as accessibility from '../src/ui/Accessibility.js';

test('reduced motion is persisted independently of reduced flash and defaults to OS preference', () => {
  const values = new Map();
  const oldStorage = globalThis.localStorage, oldWindow = globalThis.window;
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  try {
    assert.equal(accessibility.getReducedMotion(), true);
    accessibility.setReducedMotion(false);
    accessibility.setReducedFlash(true);
    assert.equal(accessibility.getReducedMotion(), false);
    assert.equal(accessibility.getReducedFlash(), true);
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});
