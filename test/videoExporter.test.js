import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RES_PRESETS, exportDims, MIME_CANDIDATES, pickRecorderMime, extensionForMime,
  videoBitrate, exportFilename,
} from '../src/export/VideoExporter.js';

test('exportDims returns the exact preset, unknown falls back to 720p', () => {
  assert.deepEqual(exportDims(720), RES_PRESETS[720]);
  assert.deepEqual(exportDims(1080), RES_PRESETS[1080]);
  assert.deepEqual(exportDims(1440), RES_PRESETS[1440]);
  assert.deepEqual(exportDims(9999), RES_PRESETS[720]);
  assert.deepEqual(exportDims(undefined), RES_PRESETS[720]);
});

test('pickRecorderMime returns the first supported candidate, prefers mp4', () => {
  const allSupported = () => true;
  assert.equal(pickRecorderMime(MIME_CANDIDATES, allSupported), MIME_CANDIDATES[0]);
  assert.ok(pickRecorderMime(MIME_CANDIDATES, allSupported).startsWith('video/mp4'));

  const onlyWebm = (m) => m.startsWith('video/webm');
  assert.equal(pickRecorderMime(MIME_CANDIDATES, onlyWebm), 'video/webm;codecs=vp9,opus');

  const noneSupported = () => false;
  assert.equal(pickRecorderMime(MIME_CANDIDATES, noneSupported), null);
});

test('extensionForMime maps mp4/webm correctly, null -> webm', () => {
  assert.equal(extensionForMime('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(extensionForMime('video/mp4'), 'mp4');
  assert.equal(extensionForMime('video/webm;codecs=vp9,opus'), 'webm');
  assert.equal(extensionForMime('video/webm'), 'webm');
  assert.equal(extensionForMime(null), 'webm');
  assert.equal(extensionForMime(undefined), 'webm');
});

test('exportFilename builds a clean, extension-correct name', () => {
  const name = exportFilename('My Cool Song.mid', 1080, 60, 'video/mp4;codecs=avc1');
  assert.equal(name, 'super-midio-world-my-cool-song-1080p60.mp4');
  const webmName = exportFilename('weird!!chars??.wav', 720, 30, 'video/webm');
  assert.equal(webmName, 'super-midio-world-weird-chars-720p30.webm');
  assert.equal(exportFilename('', 720, 30, null), 'super-midio-world-song-720p30.webm');
});

test('videoBitrate is monotone in width, height, and fps, and stays clamped', () => {
  const base = videoBitrate(1280, 720, 30);
  assert.ok(videoBitrate(1920, 1080, 30) > base);
  assert.ok(videoBitrate(1280, 720, 60) > base);
  assert.ok(videoBitrate(2560, 1440, 60) > base);
  for (const [w, h, fps] of [[1280, 720, 30], [1920, 1080, 30], [1920, 1080, 60], [2560, 1440, 60], [1, 1, 1]]) {
    const b = videoBitrate(w, h, fps);
    assert.ok(b >= 6_000_000 && b <= 24_000_000, `out of clamp range: ${b}`);
  }
});
