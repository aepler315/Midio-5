import assert from 'node:assert/strict';
import { test } from 'node:test';
import { persistVisionConfig, readVisionConfig } from '../src/vision/config.js';

function fakeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('vision persistence removes legacy API keys and never restores one', () => {
  const storage = fakeStorage();
  storage.setItem('smw:visionApiKey', 'old-secret');
  persistVisionConfig({
    provider: 'gemini',
    apiKey: 'new-secret',
    model: 'gemini-test',
    endpoint: null,
  }, storage);
  assert.equal(storage.getItem('smw:visionApiKey'), null);
  assert.deepEqual(readVisionConfig(storage), {
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-test',
    endpoint: null,
  });
});
