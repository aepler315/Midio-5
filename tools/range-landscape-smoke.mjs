// Start `npm start`, then run this tool against a local server with Chromium.
// Output is ignored by git; no recording or screenshot is checked into source.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { renderWorldFrame } from './world-frame.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['RAINFOREST', 'STEPPE', 'DESERT', 'ICEFIELD', 'CONIFER',
  'TUNDRA', 'TAIGA', 'PINE_OAK', 'BROADLEAF', 'CHAPARRAL', 'CANYON'];

export async function captureLandscapeCase(page, spec) {
  const { seed, biome, timeMs, level = 0, reducedFlash = false,
    width = 1280, height = 720, dpr = 1, stage = 'candidate', pass = 'all' } = spec;
  await page.setViewportSize({ width, height });
  const configuration = await page.evaluate(renderWorldFrame, { atMs: timeMs, quality: level, constructionSeed: seed });
  const detail = await page.evaluate(({ biome, reducedFlash, pass }) => {
    const { sim, renderer } = window.__SMW;
    const mgr = sim.biomes;
    const available = mgr.profiles.some(p => p.name === biome);
    if (!available) return { available: false, profiles: mgr.profiles.map(p => p.name) };
    // Harness-only cast: preserve the selected profile's own strip and range
    // reference. This is a controlled material fixture, not natural schedule.
    mgr.currentBlend = { from: biome, to: biome, t: 1 };
    mgr.reducedFlash = reducedFlash;
    const proto = Object.getPrototypeOf(mgr);
    const saved = new Map();
    const suppress = name => { saved.set(name, proto[name]); proto[name] = () => {}; };
    if (pass === 'no-wires') suppress('_drawCrest');
    if (pass === 'no-fog') { suppress('_drawHaze'); suppress('_drawFogBanks'); }
    if (pass === 'no-connectors') {
      suppress('_drawConnectorHills');
      saved.set('_drawDistantWave', proto._drawDistantWave);
      proto._drawDistantWave = function (...args) {
        const mix = this._distantWaveMix;
        this._distantWaveMix = 0;
        try { return saved.get('_drawDistantWave').apply(this, args); }
        finally { this._distantWaveMix = mix; }
      };
    }
    try { renderer.draw(sim, 1); }
    finally { for (const [name, fn] of saved) proto[name] = fn; }
    const range = mgr.rangesFor(biome);
    const strips = mgr.stripsFor(biome);
    return { available: true, rangeIds: [range?.far?.range?.id, range?.mid?.range?.id, range?.near?.range?.id].filter(Boolean),
      sources: ['L2', 'L3', 'L4'].map(k => strips[k]?.ridge?.source || 'missing'),
      descriptorBytes: ['L2', 'L3', 'L4', 'L5'].reduce((s, k) => s + (strips[k]?.ridge?.surface?.byteLength || 0), 0) };
  }, { biome, reducedFlash, pass });
  if (!detail.available) return { ...spec, stage, skipped: 'biome absent from this song cast', ...detail };
  const filename = `${stage}-${seed}-${biome}-${timeMs}-${level}-${dpr}-${pass}.png`;
  await page.locator('#stage').screenshot({ path: path.join(spec.output, filename) });
  return { seed, biome, timeMs, level, reducedFlash, width, height, dpr, stage, pass,
    sha: spec.sha, png: filename, configuration, ...detail };
}

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:8080';
  const output = path.resolve(process.argv[3] || '.smoke/range-landscape');
  const stage = process.argv[4] || 'candidate';
  await fs.mkdir(output, { recursive: true });
  const wav = path.join(output, 'synthetic-96s.wav');
  execFileSync(process.execPath, [path.join(root, 'tools/gen-test-wav.mjs'), wav, '120', '96']);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const report = { sha, stage, browser: browser.version(), cases: [], pageErrors: [] };
  try {
    for (const seed of [315, 42, 2026]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', e => report.pageErrors.push(e.message));
      await page.route('**/soundfonts/', route => route.fulfill({ json: [] }));
      const entry = new URL(url); entry.searchParams.set('seed', String(seed));
      await page.goto(entry.href);
      await page.locator('#titleSettings').evaluate(node => { node.open = true; });
      await page.locator('#fileInput').setInputFiles(wav);
      await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 1200, null, { timeout: 90000 });
      await page.locator('#pauseBtn').click();
      for (const biome of TARGETS) {
        const times = biome === 'RAINFOREST' ? [15000, 45000, 90000] : [45000];
        for (const timeMs of times) {
          report.cases.push(await captureLandscapeCase(page,
            { seed, biome, timeMs, level: 0, output, stage, sha }));
          if (seed === 315 && biome === 'RAINFOREST' && timeMs === 45000) {
            for (const pass of ['no-wires', 'no-fog', 'no-connectors']) report.cases.push(
              await captureLandscapeCase(page, { seed, biome, timeMs, level: 0, output, stage, sha, pass }));
          }
        }
      }
      await context.close();
    }
    assert.equal(report.pageErrors.length, 0, report.pageErrors.join('\n'));
    assert.ok(report.cases.some(c => c.rangeIds?.length), 'no real range rendered');
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, `${stage}-report.json`), JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
