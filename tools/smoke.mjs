// Upload audio through the file chooser, analyse it, build a custom world,
// render advancing playback, pause/resume, and stop. Start npm start first.
// Usage: node tools/smoke.mjs [url] [outDir]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultOutDir = path.join(toolsDir, '..', '.smoke');

async function waitForServer(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* npm start may still be starting in CI */ }
    await delay(200);
  }
  throw new Error('App unavailable at ' + url + '. Start npm start first, or pass the server URL.');
}

// Read actual composed pixels: a live audio clock can otherwise pass while
// the canvas is blank or its draw loop is frozen.
async function stageSnapshot(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(document.getElementById('stage'), 0, 0, 64, 36);
    const pixels = ctx.getImageData(0, 0, 64, 36).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      colors.add([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]].join(','));
    }
    return { colors: colors.size, image: canvas.toDataURL() };
  });
}

export async function runAudioSmoke({
  url = 'http://localhost:8080', outDir = defaultOutDir, wavPath = null,
} = {}) {
  outDir = path.resolve(outDir);
  await fs.mkdir(outDir, { recursive: true });
  if (!wavPath) {
    wavPath = path.join(outDir, 'fixture.wav');
    execFileSync(process.execPath, [path.join(toolsDir, 'gen-test-wav.mjs'), wavPath, '120', '24']);
  }
  wavPath = path.resolve(wavPath);
  await fs.access(wavPath);
  const report = { url, wavPath, checkpoints: [], errors: [], passed: false };
  const check = (name, condition) => {
    assert.ok(condition, name);
    report.checkpoints.push(name);
    console.log('PASS ' + name);
  };
  let browser, context, page;
  try {
    await waitForServer(url);
    // An explicit override wins; otherwise use Playwright's installed
    // Chromium. No machine-specific paths or autoplay bypass flags.
    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => report.errors.push('[pageerror] ' + error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push('[console] ' + message.text());
    });
    // User-installed fonts and the optional favicon are unrelated to audio
    // playback. The audio-analysis/rendering path stays real.
    await page.route('**/soundfonts/', (route) => route.fulfill({ json: [] }));
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
    const response = await page.goto(url, { waitUntil: 'load' });
    check('homepage loads', response?.ok());
    await page.locator('#loader:not(.hidden)').waitFor({ state: 'visible' });
    // A fresh context has no cached analysis or saved preferences. Disable
    // optional lyrics through the UI so the test needs no external service.
    const lyrics = page.locator('#lyricGroundingBtn');
    if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
    check('optional lyric lookup is off', await lyrics.getAttribute('aria-pressed') === 'false');
    await page.locator('#stageRes').selectOption('720');

    const chooserReady = page.waitForEvent('filechooser');
    await page.getByText('Browse files', { exact: true }).click();
    await (await chooserReady).setFiles(wavPath);
    // Analysis now ends at the world picker rather than starting the song
    // outright. Take the recommended card -- the analyzed custom world,
    // exactly the one this test has always exercised, now one click away.
    await page.locator('#worldSelect:not(.hidden)').waitFor({ state: 'visible', timeout: 90000 });
    const recommendedCard = page.locator('.worldCard.is-best');
    await recommendedCard.waitFor({ state: 'visible', timeout: 15000 });
    check('the picker leads with the analyzed match',
      await recommendedCard.getAttribute('data-world-id') === 'custom');
    await recommendedCard.click();
    await page.locator('#hud:not(.hidden)').waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 750, null, { timeout: 30000 });
    const state = await page.evaluate(() => {
      const { sim, conductor, audioEngine, worldId, muteTimelineSynth } = window.__SMW;
      return {
        timeMs: sim.timeMs, audioMs: audioEngine.nowMs,
        notes: conductor.timeline.length, durationMs: conductor.durationMs,
        worldId, muteTimelineSynth, audioState: audioEngine.ctx.state,
        hasRecording: !!audioEngine.sourceNode?.buffer,
      };
    });
    report.playback = state;
    check('audio analysis produced a note timeline', state.notes > 0 && state.durationMs > 0);
    check('picking the recommended card starts the custom world and dismisses the picker',
      state.worldId === 'custom' && !await page.locator('#worldSelect').isVisible());
    check('recording plays with the timeline synth muted', state.hasRecording
      && state.audioState === 'running' && state.muteTimelineSynth);
    check('upload screen closes during playback', !await page.locator('#loader').isVisible());

    const firstFrame = await stageSnapshot(page);
    check('stage contains a composed scene', firstFrame.colors > 16);
    await page.screenshot({ path: path.join(outDir, 'playback.png') });
    await page.waitForFunction(({ timeMs, audioMs }) =>
      window.__SMW.sim.timeMs > timeMs + 1000 && window.__SMW.audioEngine.nowMs > audioMs + 1000,
    state, { timeout: 30000 });
    check('audio and simulation clocks advance', true);
    const nextFrame = await stageSnapshot(page);
    check('rendered scene changes during playback', nextFrame.image !== firstFrame.image);

    // Controls deliberately stop receiving pointer events after inactivity.
    // Wake them with the same canvas tap a viewer uses, not a forced click.
    await page.locator('#hudRight.hud-faded').waitFor({ state: 'attached' });
    await page.locator('#stage').click({ position: { x: 640, y: 250 } });
    check('canvas tap wakes faded playback controls',
      !await page.locator('#hudRight.hud-faded').count());
    await page.locator('#pauseBtn').click();
    await page.waitForFunction(() => window.__SMW.audioEngine.ctx.state === 'suspended');
    const pausedAt = await page.evaluate(() => ({
      audio: window.__SMW.audioEngine.nowMs, sim: window.__SMW.sim.timeMs,
    }));
    await delay(300);
    const stillPaused = await page.evaluate(() => ({
      audio: window.__SMW.audioEngine.nowMs, sim: window.__SMW.sim.timeMs,
    }));
    check('pause freezes the audio and simulation clocks', pausedAt.audio === stillPaused.audio
      && pausedAt.sim === stillPaused.sim);
    await page.locator('#pauseBtn').click();
    await page.waitForFunction((t) => window.__SMW.audioEngine.ctx.state === 'running'
      && window.__SMW.sim.timeMs > t + 500, pausedAt.sim);
    check('resume advances playback', true);
    await page.locator('#stopBtn').click();
    await page.locator('#loader:not(.hidden)').waitFor({ state: 'visible' });
    const stopped = await page.evaluate(() => !window.__SMW.audioEngine.playing
      && !window.__SMW.audioEngine.sourceNode && window.__SMW.rafHandle === null);
    check('stop returns to upload and releases playback', stopped
      && !await page.locator('#hud').isVisible());
    check('no user-facing error banner', !await page.locator('#errorBanner').isVisible());
    check('no browser errors', report.errors.length === 0);
    report.passed = true;
    console.log('Audio smoke passed (' + report.checkpoints.length + ' checks). Artifacts: ' + outDir);
  } catch (error) {
    report.failure = error.stack || String(error);
    await page?.screenshot({ path: path.join(outDir, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await context?.tracing.stop({ path: path.join(outDir, 'trace.zip') }).catch(() => {});
    await browser?.close();
    await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runAudioSmoke({ url: process.argv[2], outDir: process.argv[3] }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
