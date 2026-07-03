import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisionLoop } from '../src/vision/VisionLoop.js';
import { ParamBus } from '../src/core/ParamBus.js';

// VisionLoop's constructor touches document.createElement('canvas'); _runCycle
// calls fetch. Shim both so we can drive a cycle headlessly and assert the
// 400 -> prompt-only JSON-mode adaptation.
const _doc = globalThis.document;
const _fetch = globalThis.fetch;

function shimDocument() {
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob: (cb) => cb(null),
    }),
  };
}

const VALID = {
  observations: { eq_motion: 1, speed_match: 0, companion_weight: 0, clutter: 0, notes: '' },
  adjust: { jumpHeight: 1.1, obstacleDensity: 1, scrollSpeed: 1, eqSensitivity: 1, onsetThreshold: 1 },
  confidence: 0.9,
};

function fakeAdapter({ supportsJsonMode = true, needsKey = false } = {}) {
  const calls = [];
  const adapter = {
    id: 'fakemodel', needsKey, supportsJsonMode,
    defaultBaseUrl: 'http://x', defaultModel: 'm',
    buildRequest({ jsonMode }) { calls.push({ jsonMode }); return { url: 'http://x', headers: {}, body: '{}' }; },
    extractContent: (data) => data?.content ?? '',
  };
  return { adapter, calls };
}

function makeLoop(adapter) {
  const paramBus = new ParamBus();
  const sim = { jump: { bpm: 120 }, energyCurves: { globalEnergy: () => 0.5 } };
  const vl = new VisionLoop({}, paramBus, sim, {
    enabled: true,
    settings: { provider: 'fakemodel', apiKey: 'k', baseUrl: 'http://x', model: 'm' },
    adapter,
  });
  for (let i = 0; i < 4; i++) vl.ring.push('AAAA');
  return vl;
}

test('a 400 on a JSON-mode request drops to prompt-only and retries the same cycle', async () => {
  shimDocument();
  const { adapter, calls } = fakeAdapter({ supportsJsonMode: true, needsKey: false });

  let idx = 0;
  globalThis.fetch = async () => {
    idx++;
    if (idx === 1) return { ok: false, status: 400, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ content: JSON.stringify(VALID) }) };
  };

  try {
    const vl = makeLoop(adapter);
    assert.equal(vl.jsonMode, true);
    await vl._runCycle(1000);

    // Two attempts in one cycle: first with JSON mode, retry without it.
    assert.equal(calls.length, 2, 'should retry once after the 400');
    assert.equal(calls[0].jsonMode, true);
    assert.equal(calls[1].jsonMode, false);
    assert.equal(vl.jsonMode, false, 'JSON mode should stay off for subsequent cycles');

    const entries = vl.log.toArray();
    const disabled = entries.find((e) => e.reason === 'json-mode-disabled-by-400');
    assert.ok(disabled, 'should log the adaptation');
    const applied = entries.at(-1);
    assert.equal(applied.applied, true, 'the prompt-only retry should apply');
  } finally {
    globalThis.document = _doc;
    globalThis.fetch = _fetch;
  }
});

test('a subsequent cycle reuses prompt-only mode (no second 400 storm)', async () => {
  shimDocument();
  const { adapter, calls } = fakeAdapter({ supportsJsonMode: true, needsKey: false });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: JSON.stringify(VALID) }) });

  try {
    const vl = makeLoop(adapter);
    vl.jsonMode = false; // already adapted
    await vl._runCycle(1000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].jsonMode, false);
  } finally {
    globalThis.document = _doc;
    globalThis.fetch = _fetch;
  }
});

test('a non-400 failure does NOT flip JSON mode (only a 400 implies mode rejection)', async () => {
  shimDocument();
  const { adapter, calls } = fakeAdapter({ supportsJsonMode: true, needsKey: false });
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });

  try {
    const vl = makeLoop(adapter);
    await vl._runCycle(1000);
    assert.equal(calls.length, 1, 'no retry on a non-400 failure');
    assert.equal(vl.jsonMode, true, 'JSON mode stays on for a rate-limit/auth error');
    const last = vl.log.toArray().at(-1);
    assert.equal(last.applied, false);
    assert.equal(last.reason, 'HTTP 429');
  } finally {
    globalThis.document = _doc;
    globalThis.fetch = _fetch;
  }
});

test('updateSettings to a new provider resets the JSON-mode adaptation', () => {
  shimDocument();
  try {
    const { adapter: a1 } = fakeAdapter({ supportsJsonMode: true });
    const { adapter: a2 } = fakeAdapter({ supportsJsonMode: false });
    a2.id = 'other';
    const vl = makeLoop(a1);
    vl.jsonMode = false; // adapted down
    vl.updateSettings({ provider: 'other', apiKey: '', baseUrl: '', model: '' }, a2);
    assert.equal(vl.jsonMode, false, 'new adapter has supportsJsonMode:false -> jsonMode false');
    // Switching to another JSON-capable provider would reset to true:
    const { adapter: a3 } = fakeAdapter({ supportsJsonMode: true });
    a3.id = 'third';
    vl.updateSettings({ provider: 'third' }, a3);
    assert.equal(vl.jsonMode, true, 'switching to a JSON-capable provider resets jsonMode to true');
  } finally {
    globalThis.document = _doc;
  }
});