import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  assertLoopbackSlskdUrl,
  pathsInsideDownloads,
} from '../tools/soulseek-bridge.mjs';

test('assertLoopbackSlskdUrl accepts only loopback http(s) hosts', () => {
  assert.equal(assertLoopbackSlskdUrl('http://127.0.0.1:5030'), 'http://127.0.0.1:5030');
  assert.equal(assertLoopbackSlskdUrl('http://localhost:5030/'), 'http://localhost:5030');
  assert.equal(assertLoopbackSlskdUrl('http://[::1]:5030'), 'http://[::1]:5030');
  assert.throws(() => assertLoopbackSlskdUrl('http://10.0.0.5:5030'), /local/);
  assert.throws(() => assertLoopbackSlskdUrl('http://example.com'), /local/);
  assert.throws(() => assertLoopbackSlskdUrl('file:///etc/passwd'), /http/);
  assert.throws(() => assertLoopbackSlskdUrl('not a url'), /not valid/);
});

test('pathsInsideDownloads never escapes the downloads root', () => {
  const root = path.resolve('/tmp/midio-dl-root');
  const safe = pathsInsideDownloads(root, 'track.mp3');
  assert.equal(safe.length, 1);
  assert.equal(safe[0], path.join(root, 'track.mp3'));

  const nested = pathsInsideDownloads(root, 'artist/track.mp3');
  assert.deepEqual(nested, [
    path.join(root, 'track.mp3'),
    path.join(root, 'artist', 'track.mp3'),
  ]);

  // Traversal segments are dropped; only the basename may be read, and only
  // inside dlRoot. That is containment, not an escape.
  const escaped = pathsInsideDownloads(root, '../../../etc/passwd');
  assert.deepEqual(escaped, [path.join(root, 'passwd')]);

  const abs = pathsInsideDownloads(root, '/etc/passwd');
  assert.deepEqual(abs, [path.join(root, 'passwd')]);
});
