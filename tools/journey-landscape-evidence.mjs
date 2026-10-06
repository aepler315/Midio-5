// Actual application evidence for the landscape rebuild. Preview and motion
// are separate invocations so visual review can happen before the longer run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { openSong } from './range-scene-smoke.mjs';
import { seedBrowserConstruction } from './lib/landscape-browser.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = process.argv[i + 1];
for (const key of ['url', 'source-root', 'wav', 'output']) assert.ok(args[key], `--${key} required`);
const phase = args.phase || 'preview';
assert.ok(['preview', 'motion'].includes(phase), '--phase must be preview or motion');
const sourceRoot = path.resolve(args['source-root']), out = path.resolve(args.output, phase);
const hash = data => createHash('sha256').update(data).digest('hex');
const git = (...argv) => execFileSync('git', ['-C', sourceRoot, ...argv], { encoding: 'utf8' }).trim();
await fs.mkdir(out, { recursive: true });
let stopping = false, browser, server;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
const report = { complete: false, phase, startedAt: new Date().toISOString(), sourceRoot,
  captureSource: { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').split('\n').filter(Boolean) },
  harnessSha256: hash(await fs.readFile(new URL(import.meta.url))),
  pilotSha256: hash(await fs.readFile(args.wav)), seed: 2917029651, cases: [], sourceErrors: [],
  constraints: 'Actual application fixed-step export with a synthetic 60s pilot, Chromium SwiftShader software WebGL, HUD disabled and scene-native captions retained. Render/readback timings are offline software observations, not hardware FPS or real-time playback claims. No visual acceptance is asserted by the harness.' };
const served = new Map(), pending = [];
const checkpoint = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
async function capture(page, timeMs) {
  const started = performance.now();
  const frame = await page.evaluate(async timeMs => {
    const app = window.__SMW;
    const configure = () => { app.renderer.hudInFrame = false; };
    const started = performance.now();
    let clock = app.renderExportFrame(timeMs, { beforeDraw: configure });
    if (await app.rangeSettle()) clock = app.renderExportFrame(timeMs, { beforeDraw: configure });
    const renderAndSettleMs = performance.now() - started;
    const pres = app.sim.biomes.rangePresentation, scene = pres.scene, snapshot = scene.snapshot();
    const status = app.rangeState;
    const ledgerEstimate = {};
    for (const key of ['budgetBytes', 'liveBytes', 'pendingBytes', 'peakBytes', 'denials', 'overcommits', 'entryCount']) {
      if (status.residency?.[key] != null) ledgerEstimate[key] = status.residency[key];
    }
    const viewport = pres.frame?.scenicViewport;
    const margin = 2 * (viewport?.overscanPx || 0);
    const canvas = document.querySelector('#stage');
    const prepared = scene.prepared?.values().next().value;
    const uniforms = {};
    for (const key of ['uJourneyOrbit', 'uJourneyWeather', 'uStorm', 'uDayNight', 'uSunDirection', 'uExposure']) {
      const v = prepared?.uniforms?.[key]?.value;
      if (v != null) uniforms[key] = v.toArray?.() || v;
    }
    return { source: 'application-stage', requestedTimeMs: timeMs, timeMs: clock.timeMs,
      dimensions: { width: canvas.width, height: canvas.height },
      active: status.active, reason: status.reason, ledgerEstimate,
      usableAspect: viewport ? (viewport.logicalWidth - margin) / (viewport.logicalHeight - margin) : null,
      viewport, light: pres.frame?.light || null, uniforms,
      camera: scene.camera ? { position: scene.camera.position.toArray(), quaternion: scene.camera.quaternion.toArray(), fov: scene.camera.fov, aspect: scene.camera.aspect } : null,
      scene: { kind: snapshot.kind, contextLost: snapshot.contextLost, size: snapshot.size, stats: snapshot.stats,
        travelM: snapshot.travelM, lake: snapshot.lake, cast: snapshot.cast },
      renderAndSettleMs, png: canvas.toDataURL('image/png').split(',')[1] };
  }, timeMs);
  frame.wallMs = performance.now() - started;
  return frame;
}
async function save(entry, name, frame, errors) {
  if (stopping) throw new Error('Interrupted between frames');
  assert.equal(frame.active, true, `Journey GPU fallback: ${frame.reason}`);
  assert.equal(frame.scene.kind, 'journey', 'capture must show Journey');
  assert.deepEqual(frame.dimensions, entry.dimensions);
  assert.ok(Math.abs(frame.usableAspect - entry.dimensions.width / entry.dimensions.height) < 1e-6, 'actual scene aspect mismatch');
  assert.ok(Math.abs(frame.timeMs - frame.requestedTimeMs) <= 17, 'export clock differs by more than one fixed step');
  assert.deepEqual(errors, [], 'page/shader errors');
  const bytes = Buffer.from(frame.png, 'base64'); delete frame.png;
  const file = path.join(out, `${name}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  frame.name = name; frame.pngSha256 = hash(bytes); entry.frames.push(frame);
  return file;
}
try {
  const address = new URL(args.url);
  assert.ok(['localhost', '127.0.0.1'].includes(address.hostname), 'child server must be loopback');
  server = spawn('python3', ['-m', 'http.server', address.port, '--bind', '127.0.0.1'], { cwd: sourceRoot, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = (await fetch(args.url)).ok; } catch { /* server starting */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'child HTTP server unavailable');
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  report.browser = browser.version();
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) report.browserExecutableSha256 = hash(await fs.readFile(process.env.PLAYWRIGHT_CHROMIUM_PATH));
  const wrapper = { async newContext(options) {
    const context = await browser.newContext(options);
    await context.addInitScript(seedBrowserConstruction, report.seed);
    context.on('response', response => {
      const file = new URL(response.url()).pathname.replace(/^\/+/, '');
      if (!file.startsWith('src/') || !response.ok()) return;
      pending.push((async () => {
        const bytes = await response.body().catch(() => fetch(response.url()).then(r => r.arrayBuffer()).then(b => Buffer.from(b)));
        const digest = hash(bytes);
        assert.equal(digest, hash(await fs.readFile(path.join(sourceRoot, file))), `served ${file} differs from checkout`);
        if (served.has(file)) assert.equal(digest, served.get(file), `${file} changed during capture`);
        served.set(file, digest);
      })().catch(error => { report.sourceErrors.push(error.message); }));
    });
    return context;
  } };
  for (const aspect of (args.aspects || 'landscape,portrait').split(',')) {
    assert.ok(['landscape', 'portrait'].includes(aspect), 'unsupported aspect');
    const dimensions = aspect === 'landscape' ? { width: 960, height: 540 } : { width: 540, height: 960 };
    const opened = await openSong(wrapper, { url: args.url, wav: args.wav, ...dimensions, params: { seed: String(report.seed), rangeRenderer: 'v2' } });
    const entry = { aspect, dimensions, errors: opened.errors, frames: [] }; report.cases.push(entry);
    if (phase === 'motion' && aspect === 'landscape') {
      // A single armed app/export clock advances monotonically through every
      // sample; no seeking/resetting/pinning the camera between movie frames.
      for (let i = 0; i <= 120; i++) {
        const timeMs = 9000 + i * 1000 / 12;
        const name = `landscape-motion/frame-${String(i).padStart(3, '0')}`;
        const file = await save(entry, name, await capture(opened.page, timeMs), opened.errors);
        if (i % 24 === 0) await fs.copyFile(file, path.join(out, `landscape-${Math.round(timeMs)}ms.png`));
        if (i % 12 === 0) { await checkpoint(); console.log(`Landscape motion ${i}/120 (${(timeMs / 1000).toFixed(1)}s)`); }
      }
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', path.join(out, 'landscape-motion/frame-%03d.png'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(out, 'landscape-motion.mp4')]);
      report.motion = { frames: 121, fps: 12, sampledStartMs: 9000, sampledEndMs: 19000, encodedDurationSec: 121 / 12, audio: false };
    } else {
      const times = phase === 'preview' ? (args.times ? args.times.split(',').map(Number) : [250, 9000, 22000]) : [9000, 11000, 13000, 15000, 17000, 19000];
      let previousTimeMs = -1;
      for (const timeMs of times) {
        if (timeMs < previousTimeMs) {
          await opened.page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
          await opened.page.evaluate(() => window.__SMW.rangeReady({ timeoutMs: 60000 }));
        }
        const name = `${aspect}-${timeMs}ms`;
        await save(entry, name, await capture(opened.page, timeMs), opened.errors);
        previousTimeMs = timeMs;
        await checkpoint(); console.log(`${name} ready`);
      }
    }
    await opened.context.close();
  }
  await Promise.all(pending);
  assert.deepEqual(report.sourceErrors, [], 'served source changed or differs');
  for (const [file, digest] of served) assert.equal(hash(await fs.readFile(path.join(sourceRoot, file))), digest, `${file} changed after load`);
  report.servedFiles = Object.fromEntries([...served].sort(([a], [b]) => a.localeCompare(b)));
  report.servedDigest = hash(JSON.stringify(report.servedFiles));
  const frames = report.cases.flatMap(c => c.frames);
  const times = frames.map(f => f.wallMs).sort((a, b) => a - b);
  report.softwareObservation = { capturedFrames: frames.length, captureWallMs: { min: times[0], median: times[Math.floor(times.length / 2)], max: times.at(-1) },
    maxDrawCalls: Math.max(...frames.map(f => f.scene.stats?.drawCalls || 0)), maxTriangles: Math.max(...frames.map(f => f.scene.stats?.triangles || 0)) };
  report.complete = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = stopping ? 130 : 1;
} finally {
  await Promise.all(pending);
  report.servedFiles = Object.fromEntries([...served].sort(([a], [b]) => a.localeCompare(b)));
  report.servedDigest = hash(JSON.stringify(report.servedFiles));
  await browser?.close(); server?.kill(); report.finishedAt = new Date().toISOString(); await checkpoint();
}
console.log(`${report.complete ? 'Complete' : 'Incomplete'} ${phase}: ${out}`);
