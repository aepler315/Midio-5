// Evidence contracts. Pixel change is a diagnostic, never a quality score.
import assert from 'node:assert/strict';
import { REAL_BIOMES } from './landscape-fixtures.mjs';

export const DEFAULT_SETTINGS = Object.freeze({ width: 640, height: 360, seed: 315, quality: 0,
  view: 'teton-jackson-lake', biome: 'CONIFER', fps: 12, mode: 'sparse', intervalMs: 10000 });
const integer = (n, min, max, label) => assert.ok(Number.isInteger(n) && n >= min && n <= max, `invalid ${label}`);
const keys = (obj, allowed, label) => {
  assert.ok(obj && typeof obj === 'object' && !Array.isArray(obj), `invalid ${label}`);
  for (const k of Object.keys(obj)) assert.ok(allowed.includes(k), `unknown ${label}.${k}`);
};

export function normalizeManifest(value) {
  keys(value, ['version', 'settings', 'songs'], 'manifest');
  assert.equal(value.version, 1, 'manifest version must be 1');
  keys(value.settings || {}, [...Object.keys(DEFAULT_SETTINGS), 'presentation', 'startMs'], 'settings');
  const settings = { ...DEFAULT_SETTINGS, ...value.settings };
  if (settings.presentation != null) {
    const p = settings.presentation;
    keys(p, ['version', 'look', 'quality', 'palette', 'dither', 'scaling'], 'presentation');
    assert.equal(p.version, 1, 'invalid presentation version');
    assert.ok(['natural', 'pixel', 'palette'].includes(p.look), 'invalid look');
    assert.ok(['auto', 'economy'].includes(p.quality), 'invalid quality');
    assert.ok(['range32', 'rgb332'].includes(p.palette), 'invalid palette');
    assert.ok([0, .35, 1].includes(p.dither), 'invalid dither');
    assert.ok(['fit', 'integer'].includes(p.scaling), 'invalid scaling');
  }
  for (const key of ['width', 'height']) { integer(settings[key], 64, 3840, key); assert.equal(settings[key] % 2, 0, `${key} must be even`); }
  integer(settings.seed, 0, 0xffffffff, 'seed'); integer(settings.quality, 0, 3, 'quality');
  integer(settings.fps, 1, 60, 'fps'); integer(settings.intervalMs, 100, 3600000, 'intervalMs');
  if (settings.startMs != null) integer(settings.startMs, 0, 86400000, 'startMs');
  assert.ok(['sparse', 'continuous'].includes(settings.mode), 'invalid mode');
  assert.ok(settings.view === null || /^[a-z0-9-]+$/.test(settings.view), 'invalid view');
  assert.ok(settings.biome === null || REAL_BIOMES.includes(settings.biome), 'invalid biome');
  assert.ok(Array.isArray(value.songs) && value.songs.length > 0, 'songs cannot be empty');
  const ids = new Set();
  const songs = value.songs.map(song => {
    keys(song, ['id', 'file', 'fixture', 'seconds', 'timesMs', 'clips'], 'song');
    assert.ok(typeof song.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(song.id), 'invalid song id');
    assert.ok(!ids.has(song.id), 'duplicate song id'); ids.add(song.id);
    assert.equal(Number(!!song.file) + Number(!!song.fixture), 1, 'choose exactly one file or fixture');
    if (song.file) assert.ok(typeof song.file === 'string' && /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(song.file), 'unsupported audio file');
    if (song.fixture) assert.ok(['silence', 'kicks', 'contrast'].includes(song.fixture), 'unknown fixture');
    if (song.seconds != null) { assert.ok(song.fixture, 'seconds applies only to fixtures'); integer(song.seconds, 4, 600, 'seconds'); }
    if (song.timesMs != null) {
      assert.ok(Array.isArray(song.timesMs) && song.timesMs.length, 'timesMs cannot be empty');
      for (const t of song.timesMs) integer(t, 0, 86400000, 'timeMs');
    }
    if (song.clips != null) {
      assert.ok(Array.isArray(song.clips), 'invalid clips');
      for (const clip of song.clips) {
        keys(clip, ['startMs', 'durationMs'], 'clip');
        integer(clip.startMs, 0, 86400000, 'clip.startMs'); integer(clip.durationMs, 100, 30000, 'clip.durationMs');
      }
    }
    return { ...song, ...(song.fixture ? { seconds: song.seconds ?? 24 } : {}) };
  });
  return { version: 1, settings, songs };
}

export function captureSchedule(song, durationMs, settings) {
  assert.ok(Number.isFinite(durationMs) && durationMs > 0, 'invalid song duration');
  const start = settings.startMs ?? 0;
  assert.ok(start < durationMs, 'start exceeds duration');
  const times = song.timesMs ?? Array.from({ length: Math.ceil((durationMs - start) / settings.intervalMs) }, (_, i) => start + i * settings.intervalMs);
  const clips = song.clips ?? [{ startMs: Math.floor(durationMs * 0.5), durationMs: Math.min(2000, Math.floor(durationMs * 0.25)) }];
  for (const t of times) assert.ok(t < durationMs, `checkpoint ${t} exceeds duration ${durationMs}`);
  for (const t of times) assert.ok(t >= start, `checkpoint ${t} precedes start ${start}`);
  for (const c of clips) assert.ok(c.startMs >= start, `clip precedes start ${start}`);
  for (const c of clips) assert.ok(c.startMs + c.durationMs <= durationMs, `clip exceeds duration ${durationMs}`);
  const points = new Map();
  const add = (timeMs, checkpoint = false, clip = null) => {
    const t = Math.round(timeMs * 1000) / 1000;
    const p = points.get(t) || { timeMs: t, checkpoint: false, clips: [], save: false };
    p.checkpoint ||= checkpoint;
    if (clip != null && !p.clips.includes(clip)) p.clips.push(clip);
    p.save = p.checkpoint || !!p.clips.length; points.set(t, p);
  };
  times.forEach(t => add(t, true));
  const dt = 1000 / settings.fps;
  clips.forEach((c, i) => {
    for (let n = Math.ceil(Math.min(1000, c.startMs - start) / dt); n > 0; n--) add(Math.max(start, c.startMs - n * dt));
    for (let n = 0; n * dt < c.durationMs - 0.001; n++) add(c.startMs + n * dt, false, i);
  });
  assert.ok(points.size, 'empty capture schedule');
  const end = Math.max(...points.keys());
  if (settings.mode === 'continuous') for (let n = 0; start + n * dt <= end; n++) add(start + n * dt);
  // The opening assembly needs an early actual paint, even in sparse mode.
  if (start <= 250 && end >= 250) add(250);
  // In continuous mode the regular frame grid already paints the opening.
  if (settings.mode === 'continuous' && !times.includes(250) && !points.get(250)?.save && 250 % dt > 0.001) points.delete(250);
  return [...points.values()].sort((a, b) => a.timeMs - b.timeMs);
}

export function imageDifference(a, b) {
  assert.ok(Array.isArray(a) && a.length > 0 && a.length === b?.length && a.length % 4 === 0, 'incompatible thumbnails');
  let changed = 0, total = 0;
  for (let i = 0; i < a.length; i += 4) {
    let max = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); total += d; max = Math.max(max, d); }
    if (max > 2) changed++;
  }
  return { changedFraction: changed / (a.length / 4), meanAbsoluteError: total / (a.length / 4 * 3 * 255) };
}

function validateReport(report) {
  assert.ok(report && typeof report === 'object', 'missing report');
  assert.ok(typeof report.browser === 'string' && report.browser.length, 'missing browser');
  const source = report.source;
  assert.ok(source && /^[a-f0-9]{40}$/.test(source.commit) && /^[a-f0-9]{64}$/.test(source.digest)
    && source.changedDuringRun === false && source.hashes && /^[a-f0-9]{64}$/.test(source.hashes['index.html'])
    && /^[a-f0-9]{64}$/.test(source.hashes['src/main.js'])
    && Object.values(source.hashes).every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)), 'missing or invalid source provenance');
  for (const key of Object.keys(DEFAULT_SETTINGS)) assert.ok(report.settings && Object.hasOwn(report.settings, key), `missing setting ${key}`);
  normalizeManifest({ version: 1, settings: report.settings, songs: [{ id: 'validation', fixture: 'silence' }] });
  const env = report.environment;
  assert.ok(env && typeof env.gl === 'string' && env.gl.length && typeof env.vendor === 'string'
    && env.vendor.length && env.dpr === 1 && Object.hasOwn(env, 'deviceMemory')
    && (env.deviceMemory === null || (Number.isFinite(env.deviceMemory) && env.deviceMemory > 0)), 'missing or invalid render environment');
  assert.ok(Array.isArray(report.songs) && report.songs.length, 'missing songs');
  const ids = new Set();
  for (const song of report.songs) {
    assert.ok(typeof song.id === 'string' && song.id.length && !ids.has(song.id), 'invalid song id'); ids.add(song.id);
    assert.ok(Number.isFinite(song.durationMs) && song.durationMs > 0, 'missing or invalid duration');
    assert.ok(typeof song.audioSha256 === 'string' && /^[a-f0-9]{64}$/.test(song.audioSha256), 'missing or invalid audio hash');
    assert.ok(Array.isArray(song.schedule) && song.schedule.length && Array.isArray(song.frames) && song.frames.length, 'missing captures');
    let prior = -1;
    for (const point of song.schedule) {
      assert.ok(Number.isFinite(point.timeMs) && point.timeMs >= 0 && point.timeMs < song.durationMs
        && point.timeMs > prior && typeof point.save === 'boolean', 'invalid capture schedule'); prior = point.timeMs;
    }
    for (const frame of song.frames) {
      assert.ok(Number.isFinite(frame.timeMs) && Number.isFinite(frame.actualTimeMs) && frame.actualTimeMs >= 0
        && frame.actualTimeMs < song.durationMs && Math.abs(frame.actualTimeMs - frame.timeMs) <= 1000 / 60 + .01, 'missing or invalid actual time');
      assert.ok(typeof frame.sha256 === 'string' && /^[a-f0-9]{64}$/.test(frame.sha256), 'missing or invalid image hash');
      assert.ok(typeof frame.png === 'string' && frame.png.length, 'missing image path');
      assert.ok(Array.isArray(frame.thumbnail) && frame.thumbnail.length > 0 && frame.thumbnail.length % 4 === 0
        && frame.thumbnail.every(v => Number.isInteger(v) && v >= 0 && v <= 255), 'missing or invalid thumbnail');
    }
  }
}

export function compareReports(before, after) {
  validateReport(before); validateReport(after);
  const same = (a, b, label) => assert.deepEqual(a, b, `incompatible ${label}`);
  same(before.version, 1, 'report version'); same(after.version, 1, 'report version');
  same(before.status, 'passed', 'baseline status'); same(after.status, 'passed', 'candidate status');
  same(before.settings, after.settings, 'settings'); same(before.browser, after.browser, 'browser');
  same(before.environment, after.environment, 'render environment');
  same(before.songs.map(s => s.id), after.songs.map(s => s.id), 'song set');
  assert.ok(before.songs.length, 'missing songs');
  const frames = [];
  for (let i = 0; i < before.songs.length; i++) {
    const a = before.songs[i], b = after.songs[i];
    same(a.audioSha256, b.audioSha256, `${a.id} audio`); same(a.durationMs, b.durationMs, `${a.id} duration`);
    same(a.schedule, b.schedule, `${a.id} schedule`);
    same(a.clips, b.clips, `${a.id} clips`);
    const expected = a.schedule.filter(f => f.save).map(f => f.timeMs);
    assert.ok(expected.length, 'missing captures');
    same(a.frames.map(f => f.timeMs), expected, 'missing baseline captures');
    same(b.frames.map(f => f.timeMs), expected, 'missing candidate captures');
    same(a.frames.map(f => f.actualTimeMs), b.frames.map(f => f.actualTimeMs), `${a.id} actual time`);
    a.frames.forEach((f, n) => frames.push({ songId: a.id, timeMs: f.timeMs, before: f.png, after: b.frames[n].png,
      identical: f.sha256 === b.frames[n].sha256, difference: imageDifference(f.thumbnail, b.frames[n].thumbnail) }));
  }
  return { version: 1, verdict: 'unreviewed', frames };
}
