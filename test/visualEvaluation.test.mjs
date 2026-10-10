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
const report = () => ({ version: 1, status: 'passed', browser: 'chromium-1',
  source: { commit: 'a'.repeat(40), digest: 'a'.repeat(64), hashes: { 'index.html': 'a'.repeat(64), 'src/main.js': 'b'.repeat(64) }, changedDuringRun: false }, environment: { gl: 'software', vendor: 'test', deviceMemory: 8, dpr: 1 },
  settings: { width: 640, height: 360, seed: 315, quality: 0, view: 'teton-jackson-lake', biome: 'CONIFER', fps: 12, mode: 'sparse', intervalMs: 10000 }, songs: [{ id: 'a', audioSha256: 'a'.repeat(64), durationMs: 4000,
    schedule: [{ timeMs: 1000, save: true }], frames: [{ timeMs: 1000, actualTimeMs: 1000, png: 'x.png', sha256: 'b'.repeat(64), thumbnail: [0, 0, 0, 255] }] }] });
test('comparison rejects missing evidence and mismatched inputs, settings and browser', () => {
  for (const change of [r => { r.status = 'failed'; }, r => { r.browser = 'other'; },
    r => { r.settings.seed = 9; }, r => { r.songs[0].audioSha256 = 'c'.repeat(64); },
    r => { r.songs[0].frames = []; }, r => { r.songs = []; },
    r => { r.songs[0].schedule[0].timeMs = 2; }]) {
    const after = report(); change(after);
    assert.throws(() => compareReports(report(), after), /incompatible|missing|invalid/i);
  }
});
test('comparison reports changed pixels without assigning a quality verdict', () => {
  const a = report(), b = report();
  b.songs[0].frames[0].sha256 = 'c'.repeat(64); b.songs[0].frames[0].thumbnail = [255, 0, 0, 255];
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
test('paired missing provenance cannot masquerade as compatible evidence', () => {
  const deletions = [r => { delete r.browser; }, r => { delete r.environment; }, r => { delete r.settings; },
    r => { delete r.songs[0].durationMs; }, r => { delete r.songs[0].audioSha256; },
    r => { delete r.songs[0].frames[0].actualTimeMs; }, r => { delete r.settings.seed; }, r => { delete r.source; }, r => { r.source.changedDuringRun = true; }];
  for (const remove of deletions) { const a = report(), b = report(); remove(a); remove(b); assert.throws(() => compareReports(a, b), /missing|invalid/i); }
});

test('visual manifests accept independent presentation profiles and reject invalid values', () => {
  const presentation = { version: 1, look: 'palette', quality: 'auto', palette: 'range32', dither: .35, scaling: 'integer' };
  const m = normalizeManifest({ ...manifest(), settings: { presentation } });
  assert.deepEqual(m.settings.presentation, presentation);
  for (const change of [{ look: 'cathode' }, { quality: 'low' }, { scaling: 'stretch' }, { dither: 9 }, { palette: 'missing' }]) {
    assert.throws(() => normalizeManifest({ ...manifest(), settings: { presentation: { ...presentation, ...change } } }));
  }
});

test('a bounded continuous capture draws every frame from its explicit start and rejects earlier checkpoints', () => {
  const m=normalizeManifest({ ...manifest({timesMs:[1500,2000],clips:[{startMs:1500,durationMs:250}]}),settings:{mode:'continuous',fps:4,startMs:1500} });
  assert.deepEqual(captureSchedule(m.songs[0],4000,m.settings).map(p=>p.timeMs),[1500,1750,2000]);
  assert.throws(()=>captureSchedule({...m.songs[0],timesMs:[1000]},4000,m.settings),/start/);
});
