// Matched Journey evidence; source identity, requested dimensions and fixture
// overrides are recorded separately from natural pilot frames.
// PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium node tools/journey-naturalism-evidence.mjs
//   --url http://127.0.0.1:8123 --source-root /checkout --wav /pilot.wav --output /evidence
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openSong } from './range-scene-smoke.mjs';
import { seedBrowserConstruction } from './lib/landscape-browser.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = process.argv[i + 1];
for (const key of ['url', 'source-root', 'wav', 'output']) assert.ok(args[key], `--${key} required`);
const sourceRoot = path.resolve(args['source-root']);
const out = path.resolve(args.output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(out, { recursive: true });
let stopRequested = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopRequested = true; });
const git = (...argv) => execFileSync('git', ['-C', sourceRoot, ...argv], { encoding: 'utf8' }).trim();
const report = {
  classification: 'Synthetic pilot appearance/correctness evidence; SwiftShader is not hardware performance evidence.',
  sourceRoot, sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain'),
  url: args.url, seed: 2917029651, constructionSeed: 2917029651,
  pilot: { file: path.basename(args.wav), sha256: hash(await fs.readFile(args.wav)), seconds: 60, bpm: 112 },
  browserExecutable: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'Playwright default', cases: [], captureProgress: [],
};
// Keep the loopback server in the capture's process tree; transient workspaces
// may reap independent background sessions between tool executions.
let server = null;
if (args.serve === '1') {
  const address = new URL(args.url);
  assert.ok(['127.0.0.1', 'localhost'].includes(address.hostname), '--serve is loopback only');
  server = spawn('python3', ['-m', 'http.server', address.port || '80', '--bind', '127.0.0.1'],
    { cwd: sourceRoot, stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(args.url)).ok; } catch { /* server starting */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'loopback evidence server did not start');
}
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
report.browserVersion = browser.version();
const sourceHashes = new Map();
const servedHashes = new Map();
const pending = [];
const wrapper = { async newContext(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(seedBrowserConstruction, 2917029651);
  context.on('response', response => {
    const file = new URL(response.url()).pathname.replace(/^\/+/, '');
    if (!file.startsWith('src/') || !response.ok()) return;
    pending.push((async () => {
      const bytes = await response.body().catch(() => fetch(response.url()).then(r => r.arrayBuffer()).then(b => Buffer.from(b)));
      const served = hash(bytes);
      if (!sourceHashes.has(file)) sourceHashes.set(file, hash(await fs.readFile(path.join(sourceRoot, file))));
      assert.equal(served, sourceHashes.get(file), `served ${file} differs from source checkout`);
      servedHashes.set(file, served);
    })());
  });
  return context;
} };

async function capture(page, timeMs, name, fixture = null) {
  if (stopRequested) throw new Error('Evidence capture interrupted between frames');
  const result = await page.evaluate(async ({ timeMs, fixture }) => {
    const app = window.__SMW;
    const configure = () => {
      app.renderer.hudInFrame = false;
      app.sim.biomes.stormOverride = fixture?.weather || null;
      app.sim.setReducedFlash(!!fixture?.reducedFlash);
      if (fixture?.reducedMotion != null) app.sim.setReducedMotion(!!fixture.reducedMotion);
      if (fixture?.compositorCamera) {
        Object.assign(app.sim.camera, fixture.compositorCamera);
        app.sim.biomes.floatTilt = fixture.compositorCamera.floatTilt || 0;
      }
    };
    let clock = app.renderExportFrame(timeMs, { beforeDraw: configure });
    if (await app.rangeSettle?.()) clock = app.renderExportFrame(timeMs, { beforeDraw: configure });
    const scene = app.sim.biomes.rangePresentation.scene;
    const prepared = scene?.prepared?.values().next().value;
    const uniforms = prepared?.uniforms || {};
    const numericUniforms = {};
    for (const key of ['uFirmamentWeather', 'uStorm', 'uJourneyWeather']) {
      if (uniforms[key]) numericUniforms[key] = uniforms[key].value?.toArray?.() || uniforms[key].value;
    }
    const canvas = document.querySelector('#stage');
    return { clock, dimensions: { width: canvas.width, height: canvas.height },
      png: canvas.toDataURL('image/png').split(',')[1],
      seed: app.songSeed, range: app.rangeState, uniforms: numericUniforms,
      scenicViewport: app.sim.biomes.rangePresentation.frame?.scenicViewport || null,
      cameraInput: { zoom: app.sim.camera.zoom, zoomBase: app.sim.camera._zoomBase, zoomTarget: app.sim.camera._zoomTarget,
        exportReady: app.exportReady, rangeExportMode: app.sim.biomes.rangePresentation.exportMode,
        stageW: app.sim.stageW, stageH: app.sim.stageH,
        perfLevel: app.perfLevel, exportSize: app.exportSize },
      camera: scene?.camera ? { position: scene.camera.position.toArray(), aspect: scene.camera.aspect, fov: scene.camera.fov } : null,
    };
  }, { timeMs, fixture });
  assert.ok(Math.abs(result.clock.timeMs - timeMs) <= 17, `clock ${result.clock.timeMs} differs from ${timeMs}`);
  assert.equal(result.seed, report.seed);
  assert.equal(result.range.scene?.kind, 'journey', 'evidence must draw active Journey');
  if (!fixture?.allowFallback) assert.equal(result.range.active, true, `Journey fallback: ${result.range.reason}`);
  if (args['assert-aspect'] === '1' && !fixture?.allowFallback) {
    const viewport = result.scenicViewport;
    const inset = 2 * (viewport.overscanPx || 0);
    const aspect = (viewport.logicalWidth - inset) / (viewport.logicalHeight - inset);
    assert.ok(Math.abs(aspect - result.dimensions.width / result.dimensions.height) < 1e-6,
      `usable scenic aspect ${aspect} differs from requested ${result.dimensions.width}/${result.dimensions.height}`);
  }
  await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(result.png, 'base64'));
  delete result.png;
  report.captureProgress.push({ name, requestedTimeMs: timeMs, actualTimeMs: result.clock.timeMs,
    dimensions: result.dimensions, active: result.range.active });
  report.lastFrame = { name, ...result };
  // An interruption preserves completed-frame provenance without claiming a
  // final served digest or successful probes until the entire run finishes.
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (stopRequested) throw new Error('Evidence capture interrupted after completed frame');
  return { name, requestedTimeMs: timeMs, fixture, ...result };
}

// Compare only sampled Journey world/cast/camera state. Compositor bloom,
// atmospheric finish and render counters can change on repeated draws.
const rounded = value => JSON.parse(JSON.stringify(value, (_key, item) =>
  typeof item === 'number' ? Math.round(item * 1e7) / 1e7 : item));
const spatialSample = frame => rounded({
  travelM: frame.range.scene.travelM, lake: frame.range.scene.lake,
  cast: frame.range.scene.cast, camera: frame.camera,
});
const frozenSample = frame => rounded({
  travelM: frame.range.scene.travelM, lake: frame.range.scene.lake, camera: frame.camera,
  waterResponse: frame.range.scene.cast.waterResponse,
  actors: frame.range.scene.cast.actors.map(actor => ({
    id: actor.id, positionM: actor.positionM, footOffsetsM: actor.footOffsetsM,
    leanRad: actor.leanRad, turnRad: actor.turnRad, tailAngle: actor.tailAngle,
    jawOpen: actor.jawOpen, headAngle: actor.headAngle, strokeAngle: actor.strokeAngle,
    bodyLiftM: actor.bodyLiftM, stridePhase: actor.stridePhase, babies: actor.babies,
  })),
});
const pageReset = page => page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
async function behavioralProbes(page, entry) {
  const naturalReference = entry.frames.find(frame => frame.name === 'landscape-9s');
  const pinned = { compositorCamera: { zoom: 1, roll: 0, shakeX: 0, shakeY: 0, floatTilt: 0 } };
  const seek = async timeMs => {
    await page.evaluate(timeMs => window.__SMW.seek(timeMs), timeMs);
    await page.evaluate(() => window.__SMW.rangeReady({ timeoutMs: 60000 }));
  };
  await pageReset(page);
  await capture(page, 250, 'probe-reference-opening', pinned);
  const reference = await capture(page, 9000, 'probe-reference-9s', pinned);
  const coreSample = frame => { const sample = spatialSample(frame); delete sample.camera; return sample; };
  assert.deepEqual(coreSample(reference), coreSample(naturalReference), 'fixed compositor input preserves natural Journey world/cast');
  await capture(page, 48000, 'probe-before-backward-seek-48s', pinned);
  await seek(9000);
  const backward = await capture(page, 9000, 'probe-backward-seek-9s', pinned);
  assert.deepEqual(spatialSample(backward), spatialSample(reference), 'backward seek reconstructs Journey sample');
  const held = await capture(page, 9000, 'probe-held-9s', pinned);
  assert.deepEqual(spatialSample(held), spatialSample(backward), 'held time preserves sampled Journey state');
  await page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
  await capture(page, 250, 'probe-cold-opening', pinned);
  const cold = await capture(page, 9000, 'probe-cold-seek-9s', pinned);
  assert.deepEqual(spatialSample(cold), spatialSample(reference), 'cold export reconstructs Journey sample');
  await page.evaluate(() => window.__SMW.sim.setReducedMotion(true));
  const reducedA = await capture(page, 12000, 'probe-reduced-motion-12s', { ...pinned, reducedMotion: true });
  const reducedB = await capture(page, 32000, 'probe-reduced-motion-32s', { ...pinned, reducedMotion: true });
  assert.equal(reducedA.range.scene.travelM, 0);
  assert.equal(reducedB.range.scene.travelM, 0);
  assert.deepEqual(frozenSample(reducedA), frozenSample(reducedB), 'reduced motion freezes world, cast and scenic camera');
  await page.evaluate(() => window.__SMW.sim.setReducedMotion(false));
  const extAvailable = await page.evaluate(() => {
    const renderer = window.__SMW.sim.biomes.rangePresentation.scene.renderer;
    window.__journeyEvidenceContext = renderer.getContext().getExtension('WEBGL_lose_context');
    if (!window.__journeyEvidenceContext) return false;
    window.__journeyEvidenceContext.loseContext();
    return true;
  });
  assert.ok(extAvailable, 'WEBGL_lose_context is required for recovery evidence');
  await page.waitForFunction(() => window.__SMW.sim.biomes.rangePresentation.scene.contextLost, null, { timeout: 10000 });
  const lost = await capture(page, 33000, 'probe-context-lost-33s', { ...pinned, allowFallback: true });
  assert.equal(lost.range.active, false, 'lost context must release Journey GPU rendering');
  await page.evaluate(() => window.__journeyEvidenceContext.restoreContext());
  await page.waitForFunction(() => !window.__SMW.sim.biomes.rangePresentation.scene.contextLost, null, { timeout: 10000 });
  await page.evaluate(() => window.__SMW.rangeReady({ timeoutMs: 60000 }));
  const restored = await capture(page, 33500, 'probe-context-restored-33_5s', pinned);
  assert.equal(restored.range.active, true, 'restored context must resume Journey');
  entry.behavior = { checks: { backwardSeek: true, heldSample: true, coldSeek: true, reducedMotion: true, contextRecovery: true },
    comparison: 'Sampled Journey world/cast/camera rounded to 1e-7 with explicitly pinned compositor zoom/roll/shake input; no whole-output camera/pixel equality or hardware timing claim.',
    compositorLimitation: 'Natural legacy compositor zoom springs differ on cold transport reconstruction; the raw Journey camera is compared with matching viewport input. Natural capture frames remain unpinned.',
    fixture: pinned,
    frames: [reference, backward, held, cold, reducedA, reducedB, lost, restored] };
}

try {
  const dimensions = args.aspects ? args.aspects.split(',') : ['landscape', 'square', 'portrait'];
  for (const aspect of dimensions) {
    const [width, height] = ({ landscape: [960, 540], square: [720, 720], portrait: [540, 960] })[aspect];
    const opened = await openSong(wrapper, { url: args.url, wav: args.wav, width, height,
      params: { seed: String(report.seed), rangeRenderer: 'v2' } });
    const entry = { aspect, requested: { width, height }, ready: opened.state, frames: [], errors: opened.errors };
    report.cases.push(entry);
    console.log(`${aspect}: ready ${JSON.stringify(opened.state.scene?.kind)}`);
    for (const seconds of args['only-probes'] === '1' ? [0.25, 9, 48] : [0.25, 9, 22, 28, 30, 32, 48, 58.5]) {
      entry.frames.push(await capture(opened.page, seconds * 1000, `${aspect}-${String(seconds).replace('.', '_')}s`));
      console.log(`${aspect}: ${seconds}s`);
    }
    if (aspect === 'landscape' && args.probes === '1' && args['only-probes'] !== '1') await behavioralProbes(opened.page, entry);
    if (aspect === 'landscape' && args['only-probes'] !== '1') {
      for (const [name, weather, reducedFlash] of [
        ['clear', { amount: 0, flash: 0, break01: 0, wet01: 0 }, false],
        ['storm', { amount: 1, flash: 0, flashU: .58, break01: 0, wet01: 1 }, false],
        ['flash', { amount: 1, flash: 1, flashU: .58, break01: 0, wet01: 1 }, false],
        ['reduced-flash', { amount: 1, flash: 1, flashU: .58, break01: 0, wet01: 1 }, true],
        ['clearing', { amount: .12, flash: 0, break01: 1, wet01: .8 }, false],
      ]) {
        await opened.page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
        await capture(opened.page, 250, `weather-${name}-opening`);
        entry.frames.push(await capture(opened.page, 30000, `weather-${name}-30s`, { weather, reducedFlash }));
      }
      if (args.motion !== '0') {
        await opened.page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
        await capture(opened.page, 250, 'motion-opening');
        entry.motion = [];
        await fs.mkdir(path.join(out, 'motion'), { recursive: true });
        for (let frame = 0; frame <= 60; frame++) {
          entry.motion.push(await capture(opened.page, 28000 + frame * 1000 / 15, `motion/frame-${String(frame).padStart(3, '0')}`));
        }
        // Compact supplementary motion covers quiet locomotion and controlled
        // receivers during a flash/clearing transition, not just still frames.
        entry.quietMotion = [];
        entry.weatherMotion = [];
        for (const [label, startMs, rows] of [
          ['quiet-motion', 9000, entry.quietMotion], ['weather-motion', 30000, entry.weatherMotion],
        ]) {
          await pageReset(opened.page);
          await capture(opened.page, 250, `${label}-opening`);
          await fs.mkdir(path.join(out, label), { recursive: true });
          for (let frame = 0; frame <= 12; frame++) {
            const clearing = Math.max(0, (frame - 6) / 6);
            const fixture = label === 'weather-motion' ? { weather: {
              amount: 1 - clearing, flash: frame === 3 ? 1 : frame === 4 ? .25 : 0,
              flashU: .58, break01: clearing, wet01: 1,
            } } : null;
            rows.push(await capture(opened.page, startMs + frame * 1000 / 6,
              `${label}/frame-${String(frame).padStart(3, '0')}`, fixture));
          }
          console.log(`${label}: 13 frames at 6fps`);
        }
      }
    }
    if (args['only-probes'] === '1') await behavioralProbes(opened.page, entry);
    assert.deepEqual(opened.errors, [], 'page or shader errors');
    await opened.context.close();
  }
  await Promise.all(pending);
  report.servedFiles = Object.fromEntries([...servedHashes].sort(([a], [b]) => a.localeCompare(b)));
  report.servedDigest = hash(JSON.stringify(report.servedFiles));
  report.complete = true;
} catch (error) {
  report.failure = error.stack;
  if (stopRequested) {
    report.interrupted = true;
    process.exitCode = 130;
  } else throw error;
} finally {
  await browser.close();
  server?.kill();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(`${report.complete ? 'Evidence' : 'Incomplete interrupted evidence'}: ${out}`);
