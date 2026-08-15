import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SoulseekError, getSoulseekUser, setSoulseekUser,
  soulseekSearch, soulseekFetchAsFile,
} from '../src/net/SoulseekSource.js';

// Node's test runner has no localStorage (browser API) — provide a minimal
// in-memory one so the credential helpers can be exercised.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

/** Runs the module's fetch calls against a fake fetch that routes by URL. */
function withFetch(fetchFn, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    return fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('getSoulseekUser/setSoulseekUser: round-trips through localStorage', () => {
  setSoulseekUser('ada');
  assert.equal(getSoulseekUser(), 'ada');
  setSoulseekUser('');
  assert.equal(getSoulseekUser(), '');
});

test('soulseekSearch: posts the query to the bridge and returns results', async () => {
  const calls = [];
  const result = await withFetch(async (url, opts) => {
    calls.push({ url, opts });
    return jsonResponse({ results: [{ user: 'fast', file: '@@f/song.mp3', name: 'song.mp3', slots: true }] });
  }, () => soulseekSearch('autechre'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/soulseek/search');
  assert.equal(JSON.parse(calls[0].opts.body).query, 'autechre');
  assert.equal(result.length, 1);
  assert.equal(result[0].user, 'fast');
});

test('soulseekSearch: empty query returns [] without fetching', async () => {
  let fetched = false;
  const result = await withFetch(async () => { fetched = true; return jsonResponse({ results: [] }); },
    () => soulseekSearch('   '));
  assert.deepEqual(result, []);
  assert.equal(fetched, false);
});

test('soulseekSearch: a non-ok bridge response becomes a SoulseekError', async () => {
  await assert.rejects(
    () => withFetch(async () => jsonResponse({ error: 'Not connected to Soulseek.' }, 500),
      () => soulseekSearch('x')),
    (err) => err instanceof SoulseekError && /Not connected/.test(err.message),
  );
});

test('soulseekFetchAsFile: decodes the base64 payload into a playable File', async () => {
  const bytes = new TextEncoder().encode('AUDIOBYTES');
  const b64 = Buffer.from(bytes).toString('base64');
  const file = await withFetch(async () => jsonResponse({ name: 'song.mp3', data: b64 }),
    () => soulseekFetchAsFile({ user: 'fast', file: '@@f/song.mp3' }));
  assert.equal(file.name, 'song.mp3');
  assert.equal(file.type, 'audio/mpeg');
  const back = new Uint8Array(await file.arrayBuffer());
  assert.equal(new TextDecoder().decode(back), 'AUDIOBYTES');
});

test('soulseekFetchAsFile: sanitizes unsafe characters in the filename', async () => {
  const file = await withFetch(async () => jsonResponse({ name: 'a/b:c*.mp3', data: 'QQ==' }),
    () => soulseekFetchAsFile({ user: 'x', file: 'y' }));
  assert.equal(file.name, 'a_b_c_.mp3');
});
