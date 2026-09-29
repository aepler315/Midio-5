// Range v2 full-scene evidence: real terrain in the running show and its
// export. Named CLI (plan §10):
//
//   node tools/range-scene-smoke.mjs --url http://127.0.0.1:8092 --source-root "$PWD" \
//     --expect-sha "$(git rev-parse HEAD)" --suite <pilot|selection|motion|lifecycle|export|complete> \
//     --output .smoke/range-v2 [--view <id>] [--width 1280 --height 720]
//
// Every capture records the renderer that actually drew it (v2 or legacy,
// with the reason), the view, forcedCandidate, quality, residency and the
// served identity of the modules and assets involved. A legacy fallback is
// an operational success but never a high-fidelity pass. Exits nonzero when
// a required check fails.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = ['pilot', 'selection', 'motion', 'lifecycle', 'export', 'complete'];
const NAMED = new Set(['url', 'source-root', 'expect-sha', 'suite', 'output', 'view', 'width', 'height']);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const IDENTITY_FILES = [
  'src/world/alpine/RangeScene.js', 'src/world/alpine/RangePresentation.js', 'src/world/alpine/RangeFrame.js',
  'src/world/alpine/TerrainMesh.js', 'src/world/alpine/TerrainGL.js', 'src/world/alpine/TerrainMaterial.js',
  'src/world/alpine/TerrainPackage.js', 'src/world/alpine/RangeAssets.js', 'src/render/GraphicsResidency.js',
  'src/world/terrain/SceneCatalog.js', 'src/world/terrain/SceneTravel.js', 'src/world/terrain/sceneCatalogData.js',
  'src/world/BiomeManager.js', 'src/render/Renderer.js', 'src/vendor/range/three-range.module.js',
];

export function parseSceneArgs(argv) {
  const out = { suite: 'pilot', width: '1280', height: '720' };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].slice(2);
    if (!argv[i].startsWith('--') || !NAMED.has(key)) throw new Error(`unknown flag ${argv[i]}`);
    const value = argv[++i];
    if (value == null || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  for (const k of ['url', 'source-root', 'expect-sha', 'output']) if (!out[k]) throw new Error(`--${k} is required`);
  if (!SUITES.includes(out.suite)) throw new Error(`unknown suite ${out.suite}`);
  return out;
}

/** Served files must be byte-identical to this checkout (and the catalog's
 *  terrain assets to their manifests), or the browser is testing something else. */
async function servedIdentity(url, sourceRoot) {
  const files = [...IDENTITY_FILES];
  const { default: catalog } = await import(path.join(sourceRoot, 'src/world/terrain/sceneCatalogData.js'));
  for (const v of catalog.views) {
    files.push(`src/assets/range/v2/${v.terrainManifestUrl}`);
    const m = JSON.parse(await fs.readFile(path.join(sourceRoot, 'src/assets/range/v2', v.terrainManifestUrl), 'utf8'));
    files.push(path.posix.join('src/assets/range/v2', path.posix.dirname(v.terrainManifestUrl), m.payload.url));
  }
  const hashes = {};
  for (const file of files) {
    const local = sha256(await fs.readFile(path.join(sourceRoot, file)));
    const res = await fetch(new URL(file, url.endsWith('/') ? url : `${url}/`));
    if (!res.ok) throw new Error(`cannot fetch served ${file}: ${res.status}`);
    const served = sha256(Buffer.from(await res.arrayBuffer()));
    if (served !== local) throw new Error(`served ${file} differs from ${sourceRoot}`);
    hashes[file] = served;
  }
  return hashes;
}

async function launch() {
  return chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

/** Open the app in export mode with a song and the requested Range mode. */
export async function openSong(browser, { url, wav, width, height, params = {}, dpr = 1 }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'warning' && /range v2/.test(m.text())) errors.push(`warn: ${m.text()}`); });
  await page.route('**/soundfonts/', (route) => route.fulfill({ json: [] }));
  await context.route(/^https:\/\//, (route) => route.abort());
  const entry = new URL(url);
  entry.searchParams.set('bulkExport', '1');
  entry.searchParams.set('exportW', String(width * dpr));
  entry.searchParams.set('exportH', String(height * dpr));
  for (const [k, v] of Object.entries(params)) if (v != null) entry.searchParams.set(k, v);
  await page.goto(entry.href);
  await page.locator('#titleSettings').evaluate((node) => { node.open = true; });
  const lyrics = page.locator('#lyricGroundingBtn');
  if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
  await page.locator('#fileInput').setInputFiles(wav);
  await page.waitForFunction(() => window.__SMW?.exportReady || window.__SMW_EXPORT_ERROR, null, { timeout: 300000 });
  const armError = await page.evaluate(() => window.__SMW_EXPORT_ERROR || null);
  if (armError) throw new Error(armError);
  await page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
  const state = await page.evaluate(() => window.__SMW.rangeReady({ timeoutMs: 600000 }));
  return { context, page, errors, state };
}

/** Draw one export frame at `timeMs` and return its PNG and Range state. */
export async function captureFrame(page, timeMs, { hook = null } = {}) {
  return page.evaluate(async ({ timeMs: t, hook: h }) => {
    const smw = window.__SMW;
    if (h === 'no-far') {
      const pres = smw.sim.biomes.rangePresentation;
      if (pres) { const orig = pres.drawPartition; pres.drawPartition = function (ctx, pass, stage) { return pass === 'far' ? false : orig.call(this, ctx, pass, stage); }; }
    }
    const t0 = performance.now();
    const clock = smw.renderExportFrame(t);
    const drawMs = performance.now() - t0;
    const canvas = document.querySelector('#stage');
    return {
      clock, drawMs, png: canvas.toDataURL('image/png').split(',')[1],
      range: smw.rangeState, quality: smw.perfLevel, generation: smw.generation, seed: smw.songSeed,
      world: smw.sim.biomes.world.kind,
    };
  }, { timeMs, hook });
}

async function writePng(dir, name, b64) {
  const file = path.join(dir, name);
  await fs.writeFile(file, Buffer.from(b64, 'base64'));
  return file;
}

async function suitePilot(ctx) {
  const { browser, args, wav, out, report } = ctx;
  const width = Number(args.width), height = Number(args.height);
  const view = args.view || 'nc-ross-lake-north';
  const v2 = await openSong(browser, { url: args.url, wav, width, height, params: { rangeRenderer: 'v2', rangeView: view } });
  report.pilot = { view, prepared: v2.state, frames: [] };
  assert.equal(v2.state.runtime, 'ready', `v2 runtime not ready: ${JSON.stringify(v2.state)}`);
  assert.ok(v2.state.scene?.prepared?.includes(view), `pilot view not prepared: ${JSON.stringify(v2.state.failures)}`);
  for (const t of [6000, 30000, 60000, 90000]) {
    if (t === 60000) {
      // Pass-disabled diagnostic at 60s, before the 60s frame: the far
      // partition's pixels must be absent. The export clock only runs forward.
      const noFar = await captureFrame(v2.page, 59000, { hook: 'no-far' });
      report.pilot.noFarPng = path.relative(root, await writePng(out, `pilot-v2-${view}-59000-no-far.png`, noFar.png));
      await v2.page.evaluate(() => { const p = window.__SMW.sim.biomes.rangePresentation; delete p.drawPartition; });
    }
    const f = await captureFrame(v2.page, t);
    const png = await writePng(out, `pilot-v2-${view}-${t}.png`, f.png);
    delete f.png;
    assert.equal(f.range.active, true, `v2 not active at ${t}ms: ${f.range.reason}`);
    assert.equal(f.range.viewId, view);
    assert.equal(f.range.forcedCandidate, true, 'a forced candidate must be labelled');
    report.pilot.frames.push({ ...f, png: path.relative(root, png) });
    console.log(`pilot v2 ${t}ms: view=${f.range.viewId} u=${f.range.progress01?.toFixed(3)} draw=${f.drawMs.toFixed(0)}ms partition=${f.range.timings.lastPartitionMs.toFixed(0)}ms copy=${f.range.timings.lastCopyMs.toFixed(1)}ms`);
  }
  report.pilot.pageErrors = v2.errors;
  await v2.context.close();
  const legacy = await openSong(browser, { url: args.url, wav, width, height, params: { rangeRenderer: 'legacy' } });
  await captureFrame(legacy.page, 6000); // past the opening assembly, as the v2 run was
  const lf = await captureFrame(legacy.page, 30000);
  report.pilot.legacyPng = path.relative(root, await writePng(out, 'pilot-legacy-30000.png', lf.png));
  assert.equal(lf.range.active, false);
  await legacy.context.close();
  assert.deepEqual(v2.errors.filter((e) => !e.startsWith('warn')), [], 'page errors');
}

/** Magenta marker pixels (the diagnostic far partition) in RGBA bytes. */
export function countMarkers(rgba, { lossy = false } = {}) {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    if (lossy ? (r > 190 && b > 190 && g < 80) : (r === 255 && g === 0 && b === 255)) n++;
  }
  return n;
}

async function pngMarkers(file) {
  const py = process.env.MIDIO_GDAL_PYTHON || '/usr/bin/python3.12';
  const script = 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB")\n'
    + 'print(sum(1 for (r,g,b) in im.getdata() if r>190 and b>190 and g<80))';
  return Number(execFileSync(py, ['-c', script, file], { encoding: 'utf8' }).trim());
}

async function suiteExport(ctx) {
  const { browser, args, wav, out, report } = ctx;
  const view = args.view || 'nc-ross-lake-north';
  const params = { rangeRenderer: 'v2', rangeView: view, rangeDiag: 'markers' };
  report.export = { view, checks: [] };
  const check = (name, ok, detail = '') => {
    report.export.checks.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} export: ${name}${detail ? ` -- ${detail}` : ''}`);
    if (!ok) throw new Error(`export check failed: ${name} ${detail}`);
  };
  // 1. Main stage (the canvas every output path reads).
  const s = await openSong(browser, { url: args.url, wav, width: 1280, height: 720, params });
  await captureFrame(s.page, 6000);
  const stage = await captureFrame(s.page, 20000);
  const stagePng = await writePng(out, 'export-stage-markers.png', stage.png);
  const stageCount = await pngMarkers(stagePng);
  check('markers reach the main stage canvas', stage.range.active && stageCount > 500, `${stageCount} px, active=${stage.range.active}`);
  const off = await captureFrame(s.page, 21000, { hook: 'no-far' });
  const offCount = await pngMarkers(await writePng(out, 'export-stage-no-far.png', off.png));
  check('markers vanish when their partition is disabled', offCount === 0, `${offCount} px`);
  await s.context.close();
  // 2. The actual bulk exporter, end to end through ffmpeg.
  const exportDir = path.join(out, 'bulk');
  await fs.rm(exportDir, { recursive: true, force: true });
  const u = new URL(args.url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  execFileSync(process.execPath, [path.join(root, 'tools/bulk-export.mjs'), '--url', u.href, '--res', '1080', '--fps', '30',
    '--max-seconds', '3', '--world', 'alpine', '--seed', '315', '--out', exportDir, wav], { stdio: 'inherit', timeout: 3600000 });
  const mp4 = (await fs.readdir(exportDir)).find((f) => f.endsWith('.mp4'));
  check('bulk export wrote an MP4', !!mp4, mp4 || 'none');
  const framePng = path.join(out, 'export-bulk-frame.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '2.5', '-i', path.join(exportDir, mp4), '-frames:v', '1', framePng]);
  const bulkCount = await pngMarkers(framePng);
  check('markers reach the bulk-exported video', bulkCount > 500, `${bulkCount} px`);
  // 3. The live recorder (SongRecorder), recorded from the HUD.
  const context = await browser.newContext({ viewport: { width: 1280, height: 780 }, acceptDownloads: true });
  await context.route('**/soundfonts/', (route) => route.fulfill({ json: [] }));
  await context.route(/^https:\/\//, (route) => route.abort());
  const page = await context.newPage();
  const live = new URL(args.url);
  for (const [k, v] of Object.entries(params)) live.searchParams.set(k, v);
  live.searchParams.set('seed', '315');
  await page.goto(live.href);
  await page.locator('#titleSettings').evaluate((node) => { node.open = true; });
  const lyrics = page.locator('#lyricGroundingBtn');
  if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
  await page.locator('#stageRes').selectOption('720');
  await page.locator('#fileInput').setInputFiles(wav);
  // One-world builds start without a picker; all-worlds builds open it.
  const picker = await Promise.race([
    page.locator('#worldSelect[open]').waitFor({ timeout: 300000 }).then(() => true),
    page.waitForFunction(() => !!window.__SMW?.sim, null, { timeout: 300000 }).then(() => false),
  ]);
  if (picker) {
    const card = page.locator('.worldCard[data-base-world-id="alpine"]');
    await (await card.count() ? card.first() : page.locator('.worldCard').first()).locator('.worldCardPlayBtn').click();
  }
  await page.waitForFunction(() => window.__SMW?.rangeState?.active, null, { timeout: 600000 });
  const clickRecord = async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await page.locator('#hudRight.hud-faded').count()) await page.locator('#stage').click({ position: { x: 640, y: 250 } });
      try { await page.locator('#recordBtn').click({ timeout: 5000 }); return; } catch { /* retry */ }
    }
    throw new Error('record button unreachable');
  };
  await clickRecord();
  await page.waitForTimeout(8000);
  const download = page.waitForEvent('download', { timeout: 120000 });
  await clickRecord();
  const saved = await download;
  const recPath = path.join(out, `export-recorder${path.extname(saved.suggestedFilename())}`);
  await saved.saveAs(recPath);
  const recPng = path.join(out, 'export-recorder-frame.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-sseof', '-1', '-i', recPath, '-frames:v', '1', recPng]);
  const recCount = await pngMarkers(recPng);
  check('markers reach the recorded video', recCount > 200, `${recCount} px`);
  report.export.files = { stage: path.relative(root, stagePng), bulk: path.relative(root, framePng), recorder: path.relative(root, recPng) };
  await context.close();
}

async function main() {
  const args = parseSceneArgs(process.argv);
  const sourceRoot = path.resolve(args['source-root']);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  if (!sha.startsWith(args['expect-sha'])) throw new Error(`source is ${sha}, not ${args['expect-sha']}`);
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'tools'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const out = path.resolve(args.output);
  await fs.mkdir(out, { recursive: true });
  const wav = path.join(out, 'synthetic-96s.wav');
  execFileSync(process.execPath, [path.join(root, 'tools/gen-test-wav.mjs'), wav, '120', '96']);
  const report = {
    sha, dirty: dirty || null, suite: args.suite, served: await servedIdentity(args.url, sourceRoot),
    renderer: 'Chromium SwiftShader (software WebGL2); timings are not device measurements',
  };
  const browser = await launch();
  report.browser = browser.version();
  const ctx = { browser, args, wav, out, report };
  let failed = null;
  try {
    const suites = args.suite === 'complete' ? SUITES.filter((s) => s !== 'complete') : [args.suite];
    const impl = { pilot: suitePilot, export: suiteExport };
    for (const s of suites) {
      if (!impl[s]) { report[s] = { status: 'unimplemented' }; console.log(`${s}: not implemented yet`); continue; }
      await impl[s](ctx);
    }
  } catch (err) {
    failed = err;
    report.error = String(err?.stack || err);
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'range-scene-report.json'), JSON.stringify(report, null, 1));
  }
  if (failed) { console.error(failed); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
