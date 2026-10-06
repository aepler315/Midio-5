// Actual sky, terrain air and lake through the sunset afterglow.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openSong, captureFrame } from './range-scene-smoke.mjs';
import { seedBrowserConstruction } from './lib/landscape-browser.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8093';
const out = path.resolve(process.argv[3] || '.smoke/range-twilight');
await fs.mkdir(out, { recursive: true });
const wav = path.join(out, 'pilot.wav');
execFileSync(process.execPath, ['tools/gen-pilot-wav.mjs', wav, '60']);
const report = { frames: [], browserErrors: [], limitation: 'Synthetic audio and software WebGL.' };
const files = ['src/world/DayNight.js', 'src/world/BiomeManager.js', 'src/world/alpine/RangeFrame.js',
  'src/world/alpine/RangeScene.js', 'src/world/alpine/TerrainMaterial.js', 'src/world/alpine/FirmamentGL.js'];
async function identity() {
  const hashes = {};
  for (const file of files) {
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    hashes[file] = hash(await fs.readFile(file));
    const response = await fetch(new URL(file, url));
    assert.ok(response.ok);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hashes[file], `served source: ${file}`);
  }
  return hashes;
}
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const seeded = { async newContext(options) {
  const context = await browser.newContext(options);
  context.on('page', page => {
    page.on('pageerror', error => report.browserErrors.push(error.message));
    page.on('console', message => { if (/Shader Error|program not valid/.test(message.text())) report.browserErrors.push(message.text().slice(0, 400)); });
  });
  await context.addInitScript(seedBrowserConstruction, 315);
  return context;
} };
async function state(page) {
  return page.evaluate(() => {
    const app = window.__SMW, mgr = app.sim.biomes;
    const frame = mgr.rangePresentation.frame;
    return { timeMs: frame.timeMs, twilight: mgr._twilight, sky: frame.light.sky,
      activeBody: mgr.celestialState.activeBody, night: frame.light.night01,
      fullSky: mgr.rangePresentation.scene.prepared.get(app.rangeState.viewId).uniforms.uFullSky.value };
  });
}
try {
  report.sourceHashes = await identity();
  report.browser = browser.version();
  const opened = await openSong(seeded, { url, wav, width: 640, height: 360,
    params: { rangeRenderer: 'v2', seed: '2917029651' } });
  await captureFrame(opened.page, 250);
  for (let second = 1; second <= 15; second++) {
    const frame = await captureFrame(opened.page, second * 1000);
    assert.equal(frame.range.active, true);
    const sample = await state(opened.page);
    assert.equal(sample.fullSky, 1);
    assert.ok(sample.night >= .75);
    await fs.writeFile(path.join(out, `${String(second).padStart(2, '0')}.png`), Buffer.from(frame.png, 'base64'));
    report.frames.push(sample);
    console.log(`${second}s: afterglow=${sample.twilight.amount01.toFixed(3)}, horizon=${sample.sky.horizon}`);
  }
  assert.ok(report.frames[8].twilight.amount01 > .3, 'color lingers into moonrise');
  assert.ok(report.frames[11].twilight.amount01 > .05);
  assert.equal(report.frames[14].twilight.amount01, 0);
  for (const [label, timeMs] of [['moonlight', 30000], ['sunrise', 59500]]) {
    const frame = await captureFrame(opened.page, timeMs);
    const sample = await state(opened.page);
    assert.equal(sample.activeBody, label === 'moonlight' ? 'moon' : 'sun');
    await fs.writeFile(path.join(out, `${label}.png`), Buffer.from(frame.png, 'base64'));
    report[label] = sample;
  }
  await opened.page.evaluate(async () => {
    window.__SMW.seek(9000);
    await window.__SMW.rangeReady({ timeoutMs: 600000 });
  });
  await captureFrame(opened.page, 9000);
  const sought = await state(opened.page);
  assert.deepEqual(sought.twilight.colors, report.frames[8].twilight.colors);
  assert.equal(sought.twilight.rising, report.frames[8].twilight.rising);
  for (const key of ['amount01', 'xFrac']) assert.ok(Math.abs(sought.twilight[key] - report.frames[8].twilight[key]) < 1e-8, `seek ${key}`);
  await captureFrame(opened.page, 9000);
  assert.deepEqual((await state(opened.page)).twilight, sought.twilight);
  report.seek = sought;
  execFileSync('ffmpeg', ['-y', '-framerate', '1', '-start_number', '1', '-i', path.join(out, '%02d.png'),
    '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', path.join(out, 'sunset-fade.gif')], { stdio: 'ignore' });
  assert.deepEqual(await identity(), report.sourceHashes);
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
  await opened.context.close();
} catch (error) {
  report.error = String(error.stack || error);
  throw error;
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
