// Capture the Range's moonrise, overhead moon and moonset using real audio
// analysis and the production compositor. Run with the app served on 8092:
// PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium node tools/moon-cycle-evidence.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openSong, captureFrame } from './range-scene-smoke.mjs';
import { seedBrowserConstruction } from './lib/landscape-browser.mjs';

const out = path.resolve('.smoke/moon-cycle');
await fs.mkdir(out, { recursive: true });
const wav = path.join(out, 'pilot.wav');
execFileSync(process.execPath, ['tools/gen-pilot-wav.mjs', wav, '60']);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const seeded = { async newContext(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(seedBrowserConstruction, 315);
  return context;
} };
const report = { browser: browser.version(), limitation: 'Synthetic audio and software WebGL; not hardware performance.', frames: [] };
try {
  // Measure the final storm compositor's transmission, not just whether the
  // star painter ran underneath it. A full-screen overcast hid every star.
  const probe = await browser.newPage();
  await probe.goto(process.argv[2] || 'http://127.0.0.1:8092');
  report.stormSky = await probe.evaluate(async () => {
    const { drawStormSky } = await import('/src/world/alpine/RangeStorm.js');
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const paint = color => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 640, 360);
      drawStormSky(ctx, canvas, { amount: 1, break01: 0, flash: 0 }, { tSec: 30, seed: 315 });
      return ctx.getImageData(0, 0, 640, 360).data;
    };
    const dark = paint('#000000'), bright = paint('#ffffff');
    const transmission = (y0, y1) => {
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < 640; x++) {
        const i = (y * 640 + x) * 4;
        sum += (bright[i] - dark[i]) / 255;
      }
      return sum / ((y1 - y0) * 640);
    };
    return { upperSkyTransmission: transmission(0, 43), horizonTransmission: transmission(180, 216) };
  });
  await probe.close();
  assert.ok(report.stormSky.upperSkyTransmission > 0.6, JSON.stringify(report.stormSky));
  assert.ok(report.stormSky.horizonTransmission < 0.5, 'rain still veils the distant land');
  const opened = await openSong(seeded, { url: process.argv[2] || 'http://127.0.0.1:8092', wav,
    width: 640, height: 360, params: { rangeRenderer: 'v2', rangeView: 'teton-jackson-lake', seed: '2917029651' } });
  await captureFrame(opened.page, 250, { hook: 'conifer' });
  for (const [label, timeMs] of [['rising', 12000], ['overhead', 30000], ['setting', 48000]]) {
    const frame = await captureFrame(opened.page, timeMs, { hook: 'conifer' });
    const lighting = await opened.page.evaluate(() => {
      const mgr = window.__SMW.sim.biomes;
      return { celestial: mgr.celestialState, light: mgr._scenicLight, twilight: mgr._twilight };
    });
    assert.equal(frame.range.active, true, frame.range.reason);
    assert.equal(frame.range.viewId, 'teton-jackson-lake');
    assert.equal(lighting.celestial.activeBody, 'moon');
    assert.equal(lighting.celestial.night01, 1);
    assert.equal(lighting.celestial.sun.directGain, 0);
    assert.equal(lighting.twilight, null);
    assert.equal(lighting.light.colorHex, '#c8d8ff');
    const png = Buffer.from(frame.png, 'base64');
    await fs.writeFile(path.join(out, `${label}.png`), png);
    report.frames.push({ label, timeMs, lighting, range: frame.range, identity: frame.identity,
      pngHash: createHash('sha256').update(png).digest('hex') });
    console.log(`${label}: moon altitude ${lighting.celestial.moon.altitude01.toFixed(3)}, night=${lighting.celestial.night01}`);
  }
  assert.deepEqual(opened.errors, []);
  await opened.context.close();
  report.passed = true;
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
