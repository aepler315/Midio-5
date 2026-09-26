// Start `npm start`, then run this tool against a local server with Chromium.
// Output is ignored by git; no recording or screenshot is checked into source.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { renderWorldFrame } from './world-frame.mjs';
import { casesForPreset, requireBiomes } from './lib/landscape-fixtures.mjs';
import { assertActualDpr, verifyServedIdentity } from './lib/landscape-evidence.mjs';

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
    mgr._landscapeDiag = pass && pass !== 'all' ? { pass } : null;
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
    finally {
      mgr._landscapeDiag = null;
      for (const [name, fn] of saved) proto[name] = fn;
    }
    const range = mgr.rangesFor(biome);
    const strips = mgr.stripsFor(biome);
    return { available: true, dpr: window.devicePixelRatio, rangeIds: [range?.far?.range?.id, range?.mid?.range?.id, range?.near?.range?.id].filter(Boolean),
      sources: ['L2', 'L3', 'L4'].map(k => strips[k]?.ridge?.source || 'missing'),
      descriptorBytes: ['L2', 'L3', 'L4', 'L5'].reduce((s, k) => s + (strips[k]?.ridge?.surface?.byteLength || 0), 0) };
  }, { biome, reducedFlash, pass });
  if (!detail.available) {
    throw new Error(`required biome ${biome} missing from the cast`);
  }
  assertActualDpr(dpr, detail.dpr);
  const filename = `${stage}-${seed}-${biome}-${timeMs}-${level}-${dpr}-${pass}.png`;
  await page.locator('#stage').screenshot({ path: path.join(spec.output, filename) });
  return { seed, biome, timeMs, level, reducedFlash, width, height, dpr, stage, pass,
    sha: spec.sha, png: filename, configuration, ...detail };
}

const NAMED = new Set(['url', 'source-root', 'expect-sha', 'preset', 'output']);

export function parseLandscapeArgs(argv) {
  const positional = argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const named = argv.slice(2).some((arg) => arg.startsWith('--'));
  if (!named) {
    return {
      legacy: true,
      url: positional[0] || 'http://127.0.0.1:8080',
      output: positional[1] || '.smoke/range-landscape',
      stage: positional[2] || 'candidate',
      preset: null,
    };
  }
  const out = { legacy: false, preset: 'primary' };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`unexpected argument ${flag}`);
    const key = flag.slice(2);
    if (!NAMED.has(key)) throw new Error(`unknown landscape flag --${key}`);
    const value = argv[++i];
    if (value == null || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  if (!out.url || !out['source-root'] || !out['expect-sha']) {
    throw new Error('named landscape runs require --url, --source-root and --expect-sha');
  }
  casesForPreset(out.preset);
  return out;
}

async function main() {
  const args = parseLandscapeArgs(process.argv);
  const url = args.url;
  const output = path.resolve(args.output || '.smoke/range-landscape');
  const stage = args.stage || 'candidate';
  if (args['expect-sha']) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: args['source-root'], encoding: 'utf8' }).trim();
    if (!head.startsWith(args['expect-sha']) && args['expect-sha'] !== head) {
      throw new Error(`source root ${args['source-root']} is ${head}, not ${args['expect-sha']}`);
    }
  }
  await fs.mkdir(output, { recursive: true });
  const wav = path.join(output, 'synthetic-96s.wav');
  execFileSync(process.execPath, [path.join(root, 'tools/gen-test-wav.mjs'), wav, '120', '96']);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const report = { sha, stage, browser: browser.version(), preset: args.preset || 'legacy', cases: [], pageErrors: [] };
  const jobs = args.legacy
    ? [315, 42, 2026].flatMap((seed) => TARGETS.flatMap((biome) => {
      const times = biome === 'RAINFOREST' ? [15000, 45000, 90000] : [45000];
      const rows = times.map((timeMs) => ({ seed, biome, timeMs, level: 0, width: 1280, height: 720, dpr: 1, pass: 'all' }));
      if (seed === 315 && biome === 'RAINFOREST') {
        for (const pass of ['no-wires', 'no-fog', 'no-connectors', 'ridge-faces', 'ground-base']) {
          rows.push({ seed, biome, timeMs: 45000, level: 0, width: 1280, height: 720, dpr: 1, pass });
        }
      }
      return rows;
    }))
    : casesForPreset(args.preset);
  try {
    let context = null;
    let page = null;
    let loadedSeed = null;
    for (const job of jobs) {
      if (!context || loadedSeed !== job.seed) {
        if (context) await context.close();
        context = await browser.newContext({
          viewport: { width: job.width || 1280, height: job.height || 720 },
          deviceScaleFactor: job.dpr || 1,
          serviceWorkers: 'block',
        });
        page = await context.newPage();
        page.on('pageerror', e => report.pageErrors.push(e.message));
        await page.route('**/soundfonts/', route => route.fulfill({ json: [] }));
        const entry = new URL(url); entry.searchParams.set('seed', String(job.seed));
        await page.goto(entry.href);
        await page.locator('#titleSettings').evaluate(node => { node.open = true; });
        await page.locator('#fileInput').setInputFiles(wav);
        await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 1200, null, { timeout: 90000 });
        await page.locator('#pauseBtn').click();
        loadedSeed = job.seed;
      }
      report.cases.push(await captureLandscapeCase(page, { ...job, output, stage, sha, pass: job.pass || 'all' }));
    }
    if (context) await context.close();
    assert.equal(report.pageErrors.length, 0, report.pageErrors.join('\n'));
    assert.ok(report.cases.some(c => c.rangeIds?.length), 'no real range rendered');
    if (args.legacy || args.preset === 'primary' || args.preset === 'full') {
      requireBiomes([...new Set(report.cases.map((item) => item.biome))]);
    }
    if (args['expect-sha'] && args['expect-sha'].length >= 40) {
      verifyServedIdentity({
        expectSha: args['expect-sha'], expectedHashes: {},
        served: { commit: sha, hashes: {} },
      });
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, `${stage}-report.json`), JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
