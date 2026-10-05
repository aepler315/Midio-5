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
