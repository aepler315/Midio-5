import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSoulseekBridge, SoulseekBridgeError } from '../tools/soulseek-bridge.js';

/** A fake slsk-client library: connect/search/download with the same
 *  callback shapes the real one uses, so the bridge is tested without
 *  touching the network. */
function fakeSlsk({ failConnect = false, results = [], failDownload = false } = {}) {
  const calls = { connect: 0, search: 0, download: 0, disconnect: 0 };
  const client = {
    search(opts, cb) {
      calls.search += 1;
      setTimeout(() => cb(null, results), 1);
    },
    download(opts, cb) {
      calls.download += 1;
      if (failDownload) { cb(new Error('peer refused')); return; }
      setTimeout(() => cb(null, { buffer: Buffer.from('AUDIOBYTES'), path: opts.path }), 1);
    },
  };
  return {
    calls,
    connect(opts, cb) {
      calls.connect += 1;
      if (failConnect) { cb(new Error('login rejected')); return; }
      setTimeout(() => cb(null, client), 1);
    },
    disconnect() { calls.disconnect += 1; },
  };
}

test('connect: resolves with the user and keeps the client', async () => {
  const slsk = fakeSlsk();
  const bridge = createSoulseekBridge({ slsk });
  const r = await bridge.connect({ user: 'ada', pass: 'secret' });
  assert.deepEqual(r, { user: 'ada' });
  assert.equal(bridge.isConnected(), true);
  assert.equal(slsk.calls.connect, 1);
});

test('connect: rejects with a bridge error when the library fails', async () => {
  const slsk = fakeSlsk({ failConnect: true });
  const bridge = createSoulseekBridge({ slsk });
  await assert.rejects(
    () => bridge.connect({ user: 'ada', pass: 'secret' }),
    (err) => err instanceof SoulseekBridgeError && /login rejected/.test(err.message),
  );
  assert.equal(bridge.isConnected(), false);
});

test('connect: rejects when credentials are missing', async () => {
  const bridge = createSoulseekBridge({ slsk: fakeSlsk() });
  await assert.rejects(() => bridge.connect({ user: '', pass: '' }), SoulseekBridgeError);
});

test('connect: reconnecting with the same user is a no-op', async () => {
  const slsk = fakeSlsk();
  const bridge = createSoulseekBridge({ slsk });
  await bridge.connect({ user: 'ada', pass: 'secret' });
  await bridge.connect({ user: 'ada', pass: 'secret' });
  assert.equal(slsk.calls.connect, 1);
});

test('search: returns only audio files, best candidates first', async () => {
  const slsk = fakeSlsk({
    results: [
      { user: 'slow', file: '@@slow-files/song.mp3', size: 1000, slots: true, speed: 10 },
      { user: 'fast', file: '@@fast-files/song.mp3', size: 2000, slots: true, speed: 9000 },
      { user: 'doc', file: '@@doc-files/notes.txt', size: 5, slots: true, speed: 9999 },
      { user: 'busy', file: '@@busy-files/song.flac', size: 3000, slots: false, speed: 5000 },
    ],
  });
  const bridge = createSoulseekBridge({ slsk });
  await bridge.connect({ user: 'ada', pass: 'secret' });
  const results = await bridge.search({ query: 'song' });
  assert.deepEqual(results.map((r) => r.user), ['fast', 'slow', 'busy']);
  assert.equal(results[0].name, 'song.mp3');
  assert.equal(results[0].slots, true);
  assert.equal(results[2].slots, false);
});

test('search: rejects when not connected', async () => {
  const bridge = createSoulseekBridge({ slsk: fakeSlsk() });
  await assert.rejects(() => bridge.search({ query: 'x' }), /Not connected/);
});

test('search: empty query resolves to an empty list without calling the library', async () => {
  const slsk = fakeSlsk();
  const bridge = createSoulseekBridge({ slsk });
  await bridge.connect({ user: 'ada', pass: 'secret' });
  const results = await bridge.search({ query: '   ' });
  assert.deepEqual(results, []);
  assert.equal(slsk.calls.search, 0);
});

test('download: resolves with the audio buffer and a safe filename', async () => {
  const slsk = fakeSlsk();
  const bridge = createSoulseekBridge({ slsk, tmpDir: '/tmp/slsk-test' });
  await bridge.connect({ user: 'ada', pass: 'secret' });
  const r = await bridge.download({ file: { user: 'fast', file: '@@fast-files/song.mp3', size: 2000 } });
  assert.equal(r.buffer.toString(), 'AUDIOBYTES');
  assert.equal(r.name, 'song.mp3');
  assert.match(r.path, /slsk-\d+-song\.mp3$/);
  assert.ok(r.path.includes('slsk-test'), `expected path under tmpDir, got: ${r.path}`);
});

test('download: rejects when not connected', async () => {
  const bridge = createSoulseekBridge({ slsk: fakeSlsk() });
  await assert.rejects(() => bridge.download({ file: { user: 'x', file: 'y.mp3' } }), /Not connected/);
});

test('download: rejects with a bridge error when the library fails', async () => {
  const slsk = fakeSlsk({ failDownload: true });
  const bridge = createSoulseekBridge({ slsk });
  await bridge.connect({ user: 'ada', pass: 'secret' });
  await assert.rejects(
    () => bridge.download({ file: { user: 'x', file: 'y.mp3', size: 1 } }),
    (err) => err instanceof SoulseekBridgeError && /peer refused/.test(err.message),
  );
});

test('disconnect: drops the client and reports disconnected', async () => {
  const slsk = fakeSlsk();
  const bridge = createSoulseekBridge({ slsk });
  await bridge.connect({ user: 'ada', pass: 'secret' });
  bridge.disconnect();
  assert.equal(bridge.isConnected(), false);
  assert.equal(slsk.calls.disconnect, 1);
});
