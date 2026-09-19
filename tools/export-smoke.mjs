// Video export, end to end in a real browser.
//
// The unit tests cover the ladder, the letterbox maths and the recorder's
// state machine against fakes. What they cannot see is the two places this
// feature actually touches the app: the render-loop hook that composites
// each frame, and the tap on the audio graph. Both are one line in a file
// nobody edits for this feature's sake, and both fail silently -- a
// recording still saves, it is just black, or silent.
//
// So this records for real, saves the file, and decodes it back in the
// browser to prove there is a picture in it and that a non-16:9 target got
// bars rather than a stretch.
//
// Start a server first. node tools/export-smoke.mjs [url] [outDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8080';
const out = path.resolve(process.argv[3] || '.smoke/export');
await fs.mkdir(out, { recursive: true });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const wav = path.join(out, 'export-fixture.wav');
execFileSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'gen-test-wav.mjs'), wav, '120', '20']);

/** Decode a file the page just wrote, and report what is actually in it. */
const inspect = async (page, bytes, mime) => page.evaluate(async ({ b64, type }) => {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const objectUrl = URL.createObjectURL(new Blob([buf], { type }));
  const video = document.createElement('video');
  video.muted = true;
  video.src = objectUrl;
  try {
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('the file will not decode'));
      setTimeout(() => rej(new Error('metadata timeout')), 20000);
    });
    // Play a moment before sampling: the decoded-byte counters below are
    // the only way to tell a file with sound in it from a silent one, and
    // the audio tap on the master bus is exactly the kind of wiring that
    // fails without failing anything.
    await video.play().catch(() => {});
    await new Promise((res) => setTimeout(res, 1200));
    video.pause();
    await new Promise((res) => { video.onseeked = res; video.currentTime = Math.min(2, video.duration / 2); });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    const rowLit = (y) => {
      let lit = 0;
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
      }
      return lit / canvas.width;
    };
    for (let i = 0; i < px.length; i += 4) colors.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      colors: colors.size,
      audioBytes: video.webkitAudioDecodedByteCount ?? null,
      topRowLit: rowLit(4),
      middleRowLit: rowLit(Math.floor(canvas.height / 2)),
      bottomRowLit: rowLit(canvas.height - 5),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}, { b64: bytes.toString('base64'), type: mime });

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 780 }, acceptDownloads: true });
  await context.route('**/soundfonts/', (route) => route.fulfill({ json: [] }));
  await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const entry = new URL(url);
  entry.searchParams.set('seed', '315');
  await page.goto(entry.href);
  await page.locator('#titleSettings').evaluate((node) => { node.open = true; });
  const lyrics = page.locator('#lyricGroundingBtn');
  if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
  await page.locator('#stageRes').selectOption('720');

  const candidate = await page.evaluate(async () => {
    const { pickMimeType } = await import('/src/render/VideoExport.js');
    return pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  });
  check('the browser offers a recordable container', !!candidate, candidate?.mimeType);
  if (!candidate) throw new Error('no recordable container');

  await page.locator('#fileInput').setInputFiles(wav);
  await page.locator('#worldSelect[open]').waitFor({ timeout: 120000 });
  await page.locator('.worldCard').first().click();
  await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 1500, null, { timeout: 60000 });

  // --- record from the HUD, mid-song
  await page.click('#recordBtn');
  check('recording is armed', await page.getAttribute('#recordBtn', 'aria-pressed') === 'true');
  await page.waitForTimeout(4000);
  // The HUD holds itself open while recording: its stop control is the only
  // way out, and a faded HUD sits under the canvas.
  check('the HUD stays reachable while recording', await page.locator('#recordBtn').isVisible());

  const hudDownload = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#recordBtn');
  const saved = await hudDownload;
  const hudPath = path.join(out, 'hud' + path.extname(saved.suggestedFilename()));
  await saved.saveAs(hudPath);
  const hudBytes = await fs.readFile(hudPath);
  check('a HUD recording saves a file', hudBytes.length > 10000, `${hudBytes.length} bytes as ${saved.suggestedFilename()}`);
  check('recording is disarmed after saving', await page.getAttribute('#recordBtn', 'aria-pressed') === 'false');

  const hud = await inspect(page, hudBytes, candidate.mimeType);
  check('the saved file decodes at the stage size', hud.width === 1280 && hud.height === 720, `${hud.width}x${hud.height}`);
  check('the saved file has a picture in it, not a black frame',
    hud.colors > 200 && hud.middleRowLit > 0.5, `${hud.colors} colors, ${hud.middleRowLit.toFixed(2)} lit`);
  check('the saved file is about as long as the recording', hud.duration > 2 && hud.duration < 20, `${hud.duration.toFixed(1)}s`);
  // The song itself, tapped off the master bus. A recording that is silent
  // still saves, plays and looks right -- nothing else would catch this.
  check('the saved file has sound in it', hud.audioBytes === null || hud.audioBytes > 0, `${hud.audioBytes} audio bytes decoded`);

  // --- full-song export at the car preset
  await page.evaluate(() => window.__SMW.seek(17000));
  await page.locator('#completePanel:not(.hidden)').waitFor({ timeout: 120000 });
  await page.selectOption('#exportPreset', 'car');
  check('the export note names the target and the format',
    /head unit/i.test(await page.textContent('#exportNote')));

  const carDownload = page.waitForEvent('download', { timeout: 240000 });
  await page.click('#exportBtn');
  await page.waitForTimeout(1200);
  check('a full-song export replays with the recorder armed',
    await page.getAttribute('#recordBtn', 'aria-pressed') === 'true');
  const carSaved = await carDownload;
  const carPath = path.join(out, 'car' + path.extname(carSaved.suggestedFilename()));
  await carSaved.saveAs(carPath);
  const car = await inspect(page, await fs.readFile(carPath), candidate.mimeType);

  check('the car export is exactly 800x480', car.width === 800 && car.height === 480, `${car.width}x${car.height}`);
  // The stage is 16:9 and the target is 5:3, so the show must sit in a
  // letterbox: black top and bottom, picture through the middle. A stretch
  // would light all three rows.
  check('the car export is letterboxed, not stretched',
    car.topRowLit === 0 && car.bottomRowLit === 0 && car.middleRowLit > 0.5,
    `top ${car.topRowLit} middle ${car.middleRowLit.toFixed(2)} bottom ${car.bottomRowLit}`);
  check('the car export covers the whole song', car.duration > 15, `${car.duration.toFixed(1)}s`);
  check('the car export has sound in it', car.audioBytes === null || car.audioBytes > 0, `${car.audioBytes} audio bytes decoded`);
  check('the result line states what the file actually is',
    /Saved .*(H\.264|VP9|VP8|AV1|MP4|WEBM)/.test(await page.textContent('#exportNote')),
    (await page.textContent('#exportNote')).slice(0, 120));

  check('no browser errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ checks }, null, 2));
if (failed.length) {
  console.error(`\nExport smoke FAILED (${failed.length}/${checks.length}).`);
  process.exitCode = 1;
} else {
  console.log(`\nExport smoke passed (${checks.length} checks). Artifacts: ${out}`);
}
assert.equal(failed.length, 0);
