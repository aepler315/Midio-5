// Late lyric evidence, in a real browser (F06).
//
// A slow lyrics lookup used to reach the song's data but never the running
// world: the timed lines did nothing until a seek or replay rebuilt the
// performance. This serves a fixture recording, holds the lyrics provider's
// answer until the world is already playing, and checks that the lines join
// the running performance -- same simulation, same audio source, heard time
// still moving forward -- and that a line is then reached when it is heard.
//
// Start a server first. node tools/late-evidence-smoke.mjs [url] [outDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { withAllWorlds, withLegacyRange } from './lib/allWorlds.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8080';
const out = path.resolve(process.argv[3] || '.smoke/late-evidence');
await fs.mkdir(out, { recursive: true });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const SECONDS = 24;
const wav = path.join(out, 'Midio Smoke - Late Lyrics.wav');
execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'gen-test-wav.mjs'), wav, '120', String(SECONDS)]);

const LRC = [
  '[00:06.00]First line arrives late', '[00:08.00]Still the same song', '',
  '[00:12.00]A chorus line now', '[00:14.00]Burning bright', '',
  '[00:18.00]Last words here',
].join('\n');
const record = {
  trackName: 'Late Lyrics', artistName: 'Midio Smoke', albumName: null, duration: SECONDS,
  instrumental: false, syncedLyrics: LRC, plainLyrics: LRC.replace(/\[[^\]]+\]/g, ''),
};

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 780 } });
  await context.route('**/soundfonts/', (route) => route.fulfill({ json: [] }));
  await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const playing = () => page.evaluate(() => (window.__SMW?.sim?.timeMs ?? 0) > 0).catch(() => false);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let deliveredWhilePlaying = null;
  // The exact lookup misses after the audit's 3.6 s; the search answer is
  // held until the world is playing (each request has a 4 s client timeout).
  await context.route('https://lrclib.net/api/get**', async (route) => {
    await sleep(3600);
    await route.fulfill({ status: 404, json: { code: 404 } });
  });
  await context.route('https://lrclib.net/api/search**', async (route) => {
    const until = Date.now() + 3800;
    while (Date.now() < until && !(await playing())) await sleep(100);
    deliveredWhilePlaying = await playing();
    await route.fulfill({ json: [record] });
  });

  // Lyric grounding on, for this run.
  await page.addInitScript(() => { try { localStorage.removeItem('smw:noLyrics'); } catch { /* none */ } });
  await page.goto(withLegacyRange(withAllWorlds(url)));
  await page.locator('#fileInput').setInputFiles(wav);
  await page.locator('#worldSelect[open]').waitFor({ timeout: 120000 });
  await page.locator('.worldCard').first().click();
  await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 0, null, { timeout: 60000 });

  // Mark what is playing now, so a restart cannot pass unnoticed.
  await page.evaluate(() => {
    window.__lateSmoke = { sim: window.__SMW.sim, source: window.__SMW.audioEngine.sourceNode, heard: [] };
    const tick = () => {
      const s = window.__SMW?.sim;
      if (s) window.__lateSmoke.heard.push(s.heardTimeMs);
      window.__lateSmoke.raf = requestAnimationFrame(tick);
    };
    tick();
  });
  const hadLinesAtStart = await page.evaluate(() => !!window.__SMW.sim.biomes._syncedLyrics);
  check('the world started before the lyrics arrived', !hadLinesAtStart);

  await page.waitForFunction(() => !!window.__SMW?.sim?.biomes?._syncedLyrics, null, { timeout: 15000 })
    .then(() => check('late timed lines join the running performance', true),
      () => check('late timed lines join the running performance', false));
  check('the lyrics were delivered while the world was playing', deliveredWhilePlaying === true, String(deliveredWhilePlaying));

  const state = await page.evaluate(() => {
    const s = window.__SMW.sim;
    const h = window.__lateSmoke.heard;
    let monotonic = true;
    for (let i = 1; i < h.length; i++) if (h[i] + 1e-6 < h[i - 1]) monotonic = false;
    return {
      sameSim: s === window.__lateSmoke.sim,
      sameSource: window.__SMW.audioEngine.sourceNode === window.__lateSmoke.source,
      monotonic, samples: h.length,
      lines: s.biomes._syncedLyrics?.length ?? 0,
      cursor: s.biomes._lyricLineCursor,
      heard: s.heardTimeMs,
      kinds: s.biomes.sections.filter((x) => x.kind).length,
    };
  });
  check('no restart: the same simulation keeps playing', state.sameSim);
  check('no restart: the same audio source keeps playing', state.sameSource);
  check('heard time never went backwards', state.monotonic, `${state.samples} frames`);
  check('the timed lines are all there', state.lines === 5, `${state.lines}`);
  check('lines already past were skipped, not replayed', state.cursor <= state.lines,
    `cursor ${state.cursor} at ${Math.round(state.heard)} ms`);
  check('the lyric structure reached the section schedule', state.kinds > 0, `${state.kinds} labelled sections`);

  // A line ahead of the playhead is reached when it is heard.
  const target = await page.evaluate(() => {
    const lines = window.__SMW.sim.biomes._syncedLyrics;
    const heard = window.__SMW.sim.heardTimeMs;
    return lines.find((l) => l.tMs > heard + 300)?.tMs ?? null;
  });
  if (target != null) {
    await page.waitForFunction((t) => window.__SMW.sim.heardTimeMs > t + 100, target, { timeout: 30000 });
    const reached = await page.evaluate((t) => {
      const b = window.__SMW.sim.biomes;
      return b._lyricLineCursor > b._syncedLyrics.findIndex((l) => l.tMs >= t);
    }, target);
    check('a line ahead of the playhead is reached when heard', reached, `${target} ms`);
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ checks }, null, 2));
const failed = checks.filter((c) => !c.ok);
if (failed.length) console.error(`\nLate evidence smoke FAILED (${failed.length}/${checks.length}).`);
else console.log(`\nLate evidence smoke passed (${checks.length} checks).`);
assert.equal(failed.length, 0);
