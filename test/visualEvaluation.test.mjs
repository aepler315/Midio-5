import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManifest, captureSchedule, compareReports, imageDifference } from '../tools/lib/visual-evaluation.mjs';

const manifest = (song = {}) => ({ version: 1, songs: [{ id: 'song', fixture: 'contrast', ...song }] });
test('rejects empty, duplicate, unsafe and ambiguous song inputs', () => {
  for (const input of [{ version: 1, songs: [] }, { version: 1, songs: [{ id: '../x', fixture: 'silence' }] },
    { version: 1, songs: [{ id: 'a', fixture: 'silence' }, { id: 'a', fixture: 'kicks' }] },
    manifest({ file: 'song.wav' }), manifest({ timesMs: [] }), manifest({ clips: [{ startMs: -1, durationMs: 1000 }] })]) {
    assert.throws(() => normalizeManifest(input));
  }
  assert.throws(() => normalizeManifest({ ...manifest(), settings: { fps: 0 } }));
  assert.throws(() => normalizeManifest({ ...manifest(), settings: { width: 641 } }));
  assert.throws(() => normalizeManifest({ ...manifest(), settings: { unknown: true } }));
});
test('sorts and de-duplicates checkpoints while capturing every clip frame with preroll', () => {
  const m = normalizeManifest({ ...manifest({ timesMs: [2000, 0, 2000], clips: [{ startMs: 2000, durationMs: 1000 }] }), settings: { fps: 4 } });
  const schedule = captureSchedule(m.songs[0], 4000, m.settings);
  assert.deepEqual(schedule.filter(f => f.checkpoint).map(f => f.timeMs), [0, 2000]);
  assert.deepEqual(schedule.filter(f => f.clips.length).map(f => f.timeMs), [2000, 2250, 2500, 2750]);
  assert.ok(schedule.some(f => f.timeMs === 1000 && !f.save));
  assert.throws(() => captureSchedule({ ...m.songs[0], timesMs: [5000] }, 4000, m.settings), /duration/);
  assert.throws(() => captureSchedule({ ...m.songs[0], clips: [{ startMs: 3500, durationMs: 1000 }] }, 4000, m.settings), /duration/);
});
test('continuous mode draws from zero instead of silently skipping earlier frames', () => {
  const m = normalizeManifest({ ...manifest({ timesMs: [1000], clips: [] }), settings: { mode: 'continuous', fps: 4 } });
  const frames = captureSchedule(m.songs[0], 4000, m.settings);
  assert.deepEqual(frames.map(f => f.timeMs), [0, 250, 500, 750, 1000]);
  assert.equal(frames.filter(f => f.save).length, 1);
});
const report = () => ({ version: 1, status: 'passed', browser: 'chromium-1', environment: { gl: 'software' },
  settings: { seed: 315 }, songs: [{ id: 'a', audioSha256: 'hash', durationMs: 4000,
    schedule: [{ timeMs: 1000, save: true }], frames: [{ timeMs: 1000, png: 'x.png', sha256: 'same', thumbnail: [0, 0, 0, 255] }] }] });
test('comparison rejects missing evidence and mismatched inputs, settings and browser', () => {
  for (const change of [r => { r.status = 'failed'; }, r => { r.browser = 'other'; },
    r => { r.settings.seed = 9; }, r => { r.songs[0].audioSha256 = 'other'; },
    r => { r.songs[0].frames = []; }, r => { r.songs = []; },
    r => { r.songs[0].schedule[0].timeMs = 2; }]) {
    const after = report(); change(after);
    assert.throws(() => compareReports(report(), after), /incompatible|missing/i);
  }
});
test('comparison reports changed pixels without assigning a quality verdict', () => {
  const a = report(), b = report();
  b.songs[0].frames[0].sha256 = 'changed'; b.songs[0].frames[0].thumbnail = [255, 0, 0, 255];
  const diff = compareReports(a, b);
  assert.equal(diff.frames[0].identical, false);
  assert.equal(diff.frames[0].difference.changedFraction, 1);
  assert.equal(diff.verdict, 'unreviewed');
  assert.deepEqual(imageDifference([0, 0, 0, 255], [0, 0, 0, 255]), { changedFraction: 0, meanAbsoluteError: 0 });
});
test('comparison refuses frames drawn at different actual musical times', () => {
  const a = report(), b = report();
  a.songs[0].frames[0].actualTimeMs = 1000;
  b.songs[0].frames[0].actualTimeMs = 1008;
  assert.throws(() => compareReports(a, b), /incompatible.*time/i);
});
