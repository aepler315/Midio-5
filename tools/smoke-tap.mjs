// End-to-end smoke for the player-driven rhythm layer: builds a test MIDI
// (steady 500ms kicks + one 8-hit double-bass roll), plays it in a real
// browser, drives taps/holds through sim.enqueueTap at note times (headless
// key timing is too jittery to score against), and asserts the judgment ->
// score -> HUD -> results pipeline end to end. One real Space press proves
// the DOM handler wiring; the rest goes through the public input API.
//
// Usage: start the dev server (npm run dev), then: node tools/smoke-tap.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.SMOKE_URL || 'http://localhost:5173';
const outDir = path.join(os.tmpdir(), 'smw-smoke-tap');
fs.mkdirSync(outDir, { recursive: true });

/** Minimal SMF format-0 file: tempo 120, kicks on ch10 (pitch 36), a few
 * ch1 melody notes for the tonic tracker. A 3s silent lead-in (so the test
 * can install its schedule before the first note), 16 steady 500ms kicks,
 * an 8-hit 150ms roll (one hold note: span 1050ms), then 12 more kicks. */
function buildTestMidi() {
  const LEAD = 2880; // ticks: 3s at 120bpm/480ppqn
  const events = [];
  const kick = (tick) => {
    events.push({ tick: LEAD + tick, bytes: [0x99, 36, 100] });
    events.push({ tick: LEAD + tick + 60, bytes: [0x89, 36, 0] });
  };
  const melody = (tick, pitch) => {
    events.push({ tick: LEAD + tick, bytes: [0x90, pitch, 90] });
    events.push({ tick: LEAD + tick + 480, bytes: [0x80, pitch, 0] });
  };
  for (let i = 0; i < 16; i++) kick(i * 480); // 500ms apart at 120bpm/480ppqn
  const rollStart = 16 * 480;
  for (let i = 0; i < 8; i++) kick(rollStart + i * 144); // 150ms roll
  const resume = rollStart + 8 * 144 + 336;
  for (let i = 0; i < 12; i++) kick(resume + i * 480);
  for (let i = 0; i < 10; i++) melody(i * 960, 60 + [0, 4, 7, 4][i % 4]);
  melody(resume + 12 * 480, 72); // pads the duration past the last kick
  events.sort((a, b) => a.tick - b.tick);

  const vlq = (n) => {
    const st = [n & 0x7f];
    let v = n >> 7;
    while (v) { st.push((v & 0x7f) | 0x80); v >>= 7; }
    return st.reverse();
  };
  const body = [0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // tempo 500000us/qn
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0x00);
  const len = body.length;
  return Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (480 >> 8) & 255, 480 & 255,
    0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255,
    ...body,
  ]);
}

const midPath = path.join(outDir, 'tap-smoke.mid');
fs.writeFileSync(midPath, buildTestMidi());

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('[console] ' + m.text());
});

await page.route('**/soundfonts/', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
await page.goto(URL, { waitUntil: 'load' });

// The Space handler must exist (and no-op cleanly) even before a song runs.
await page.keyboard.press('Space');

await page.setInputFiles('#fileInput', midPath);
await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });

// Deterministic driver: pre-enqueue the whole play-through with exact
// timestamps. enqueueTap is insertion-sorted and the sim drains entries only
// once their stamp passes, so scheduling ahead is exact — headless timer
// throttling (which killed a 4ms polling driver) can't touch it.
const scheduled = await page.evaluate(() => {
  const { sim, audioEngine } = window.__SMW;
  const now = audioEngine.nowMs;
  let count = 0;
  for (const n of sim.noteChart.notes) {
    if (n.tMs <= now + 300) continue; // too late to schedule honestly
    sim.enqueueTap('down', n.tMs + 2); // +2ms: inside the perfect bin
    sim.enqueueTap('up', n.type === 'hold' ? n.endMs - 30 : n.tMs + 150);
    count++;
  }
  // One deliberate mid-gap press: must judge sour.
  const taps = sim.noteChart.notes.filter((n) => n.type === 'tap');
  const anchor = taps[5] || taps[0];
  sim.enqueueTap('down', anchor.tMs + 250);
  sim.enqueueTap('up', anchor.tMs + 310);
  return count;
});
console.log(`scheduled ${scheduled} notes`);

// Waits are anchored to the AUDIO clock, not page time — the load pipeline
// costs 1-2s and a fixed sleep would drift every screenshot off its moment.
const atAudioMs = (ms) => page.waitForFunction(
  (t) => window.__SMW.audioEngine.nowMs >= t, ms, { timeout: 30000 },
);

await atAudioMs(5100);
await page.screenshot({ path: path.join(outDir, 'tap1_world.png') });

// One real keyboard press mid-song: proves the DOM path end to end. Its
// judgment is whatever its timing earns (the assertions leave slack for it).
await page.keyboard.press('Space');

// Mid-hold (the roll runs 11.0-12.05s): slide pose, charge glow, strip bar.
await atAudioMs(11500);
await page.screenshot({ path: path.join(outDir, 'tap2_hold_slide.png') });

// Let the song finish (duration ~19.6s + shatter), then read everything.
await page.waitForSelector('#completePanel:not(.hidden)', { timeout: 40000 });
await page.screenshot({ path: path.join(outDir, 'tap3_results.png') });

const result = await page.evaluate(() => {
  const { sim } = window.__SMW;
  const sk = sim.scoreKeeper;
  return {
    score: sk.score,
    timingEarned: sk.timingEarned,
    maxPossible: sk.maxPossible,
    accuracyPct: sk.accuracyPct,
    grade: sk.grade,
    counts: sk.counts,
    misses: sk.misses,
    holdsCompleted: sk.holdsCompleted,
    holdsChoked: sk.holdsChoked,
    peakStreak: sk.peakStreak,
    tapCount: sim.noteChart.tapCount,
    holdCount: sim.noteChart.holdCount,
    scoreReadout: document.getElementById('scoreReadout')?.textContent ?? null,
    resultsText: document.getElementById('resultsGrid')?.innerText ?? '',
  };
});

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

expect(errors.length === 0, `page errors: ${JSON.stringify(errors)}`);
expect(result.holdCount === 1, `expected exactly 1 hold note, got ${result.holdCount}`);
expect(result.tapCount >= 20, `expected >=20 tap notes, got ${result.tapCount}`);
expect(result.score > 2500, `score too low: ${result.score}`);
const hits = result.counts.perfect + result.counts.great + result.counts.good;
expect(hits >= 22, `too few judged hits: ${JSON.stringify(result.counts)}`);
expect(result.counts.perfect >= 20, `a +2ms schedule should be nearly all perfect: ${JSON.stringify(result.counts)}`);
expect(result.counts.sour >= 1, 'the deliberate mid-gap tap should judge sour');
expect(result.misses <= 1, `a fully-scheduled run should not miss: ${result.misses}`);
expect(result.holdsCompleted === 1, `hold not completed: ${result.holdsCompleted} (choked: ${result.holdsChoked})`);
expect(result.accuracyPct !== null && result.accuracyPct >= 85, `accuracy: ${result.accuracyPct}`);
expect(result.grade === 'S' || result.grade === 'A', `grade: ${result.grade}`);
expect(result.scoreReadout !== null && result.scoreReadout !== '0', `HUD score readout: ${result.scoreReadout}`);
expect(/perfect/.test(result.resultsText), 'results grid should render tier counts');
// Pins the roll-EMA fix: a perfect run's streak must ride THROUGH the hold
// and out the other side (16 steady + rate-limited hold credits + the
// post-roll landings), not break right after it.
expect(result.peakStreak >= 25, `peak streak: ${result.peakStreak}`);

console.log('stats:', JSON.stringify(result, null, 1));
if (failures.length) {
  console.error('SMOKE FAILURES:\n - ' + failures.join('\n - '));
  await browser.close();
  process.exit(1);
}
console.log('smoke-tap: all assertions passed. Screenshots in', outDir);
await browser.close();
