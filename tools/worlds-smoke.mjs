// Compare one identical quiet/energetic fixture across Range, After Hours,
// and Fathom through real upload, analysis, selection, playback and seeking.
// Start npm start first. Usage: node tools/worlds-smoke.mjs [url] [outDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://localhost:8080';
const out = path.resolve(process.argv[3] || path.join(root, '.smoke/worlds'));
await fs.mkdir(out, { recursive: true });
const wav = path.join(out, 'worlds-fixture.wav');
execFileSync(process.execPath, [path.join(root, 'tools/gen-test-wav.mjs'), wav, '120', '32']);
const buffer = await fs.readFile(wav);
const rate = buffer.readUInt32LE(24);
for (let i = 44; i < buffer.length; i += 2) {
  const seconds = (i - 44) / 2 / rate;
  // Quiet opening, energetic middle, then return. Keep the same notes so
  // dynamic response can be compared without a different song/tempo.
  const gain = seconds < 10 || seconds >= 24 ? 0.12 : 1;
  buffer.writeInt16LE(Math.round(buffer.readInt16LE(i) * gain), i);
}
await fs.writeFile(wav, buffer);

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const report = { passed: false, worlds: [] };
try {
  for (const [name, kind] of [['The Range', 'alpine'], ['After Hours', 'city'], ['The Fathom', 'abyssal']]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.route('**/soundfonts/', route => route.fulfill({ json: [] }));
      await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
      const entry = new URL(url); entry.searchParams.set('seed', '315');
      await page.goto(entry.href);
      const lyrics = page.locator('#lyricGroundingBtn');
      if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
      await page.locator('#stageRes').selectOption('720');
      await page.locator('#fileInput').setInputFiles(wav);
      await page.locator('#worldSelect:not(.hidden)').waitFor({ timeout: 90000 });
      await page.locator('.worldCard').filter({ has: page.getByText(name, { exact: true }) }).click();
      await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 1200, null, { timeout: 60000 });
      assert.equal(await page.evaluate(() => window.__SMW.sim.biomes.world.kind), kind);
      const samples = [];
      for (const [label, atMs] of [['quiet', 6000], ['energetic', 18000], ['return', 27000]]) {
        await page.evaluate(ms => window.__SMW.seek(ms), atMs);
        await page.waitForFunction(ms => window.__SMW.sim.biomes.tSec * 1000 > ms + 500, atMs);
        const sample = await page.evaluate(async () => {
          const { sim } = window.__SMW;
          const mgr = sim.biomes;
          const { sampleWorldMusic } = await import('/src/world/WorldMusic.js');
          const music = sampleWorldMusic({ nowMs: mgr.tSec * 1000, energyCurves: mgr.energyCurves,
            rhythm: mgr.worldRhythm, section: mgr.sections[mgr._lastSectionIdx] });
          const c = document.createElement('canvas'); c.width = 64; c.height = 36;
          const ctx = c.getContext('2d'); ctx.drawImage(document.querySelector('#stage'), 0, 0, 64, 36);
          const pixels = ctx.getImageData(0, 0, 64, 36).data;
          const colors = new Set();
          for (let i = 0; i < pixels.length; i += 4) colors.add(pixels.slice(i, i + 3).join(','));
          return { timeMs: mgr.tSec * 1000, music, rhythmMs: mgr.worldRhythm?.tMs, colors: colors.size };
        });
        assert.ok(sample.colors > 16, name + ' renders a composed ' + label + ' scene');
        assert.ok(Number.isFinite(sample.rhythmMs), name + ' receives detected rhythm through the conductor');
        assert.ok(Object.values(sample.music).every(Number.isFinite));
        await page.locator('#stage').screenshot({ path: path.join(out, `${kind}-${label}.png`) });
        samples.push({ label, ...sample });
      }
      assert.ok(samples[1].music.energy > samples[0].music.energy, name + ' recognizes the louder passage');
      // Exercise backward seek and the reduced-motion preference.
      await page.keyboard.press('r');
      await page.evaluate(() => window.__SMW.seek(4000));
      await page.waitForFunction(() => window.__SMW.sim.biomes.tSec > 4.5 && window.__SMW.sim.biomes.tSec < 8);
      assert.equal(await page.evaluate(() => window.__SMW.sim.biomes.reducedFlash), true);
      await page.locator('#stage').screenshot({ path: path.join(out, `${kind}-reduced.png`) });
      assert.deepEqual(errors, [], name + ' has no browser errors');
      report.worlds.push({ name, kind, samples, errors });
      console.log('PASS ' + name + ': selection, 3 passages, rhythm, dynamic response, backward seek, reduced motion');
    } finally { await context.close(); }
  }
  report.passed = true;
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
