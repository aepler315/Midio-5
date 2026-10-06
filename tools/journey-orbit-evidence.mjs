// Focused circular Journey evidence. Natural application frames stay separate
// from a direct-scene seam fixture beyond the synthetic pilot's 60s duration.
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
const sourceRoot = path.resolve(args['source-root']), out = path.resolve(args.output);
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...argv) => execFileSync('git', ['-C', sourceRoot, ...argv], { encoding: 'utf8' }).trim();
await fs.mkdir(out, { recursive: true });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
const report = { complete: false, classification: 'Synthetic pilot/software WebGL correctness and appearance; no hardware FPS claim.',
  sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain'), sourceRoot,
  seed: 2917029651, pilotSha256: hash(await fs.readFile(args.wav)), cases: [],
  fixture: 'Direct-scene seam frames retain the prepared 30s music/light inputs while overriding heard time, duration, and reveal. They omit Canvas compositor finish/HUD and are not natural long-song analysis.' };
let server;
if (args.serve === '1') {
  const address = new URL(args.url);
  assert.ok(['127.0.0.1', 'localhost'].includes(address.hostname), '--serve is loopback only');
  server = spawn('python3', ['-m', 'http.server', address.port, '--bind', '127.0.0.1'], { cwd: sourceRoot, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = (await fetch(args.url)).ok; } catch { /* starting */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'server did not start');
}
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
report.browser = browser.version();
const served = new Map(), local = new Map(), pending = [];
const wrapper = { async newContext(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(seedBrowserConstruction, report.seed);
  context.on('response', response => {
    const file = new URL(response.url()).pathname.replace(/^\/+/, '');
    if (!file.startsWith('src/') || !response.ok()) return;
    pending.push((async () => {
      const bytes = await response.body().catch(() => fetch(response.url()).then(r => r.arrayBuffer()).then(b => Buffer.from(b)));
      if (!local.has(file)) local.set(file, hash(await fs.readFile(path.join(sourceRoot, file))));
      assert.equal(hash(bytes), local.get(file), `served ${file} differs from source`);
      served.set(file, hash(bytes));
    })());
  });
  return context;
} };
async function checkpoint() { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
async function saveFrame(entry, name, result) {
  if (stopping) throw new Error('Capture interrupted');
  await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(result.png, 'base64'));
  delete result.png;
  const frame = { name, ...result };
  entry.frames.push(frame);
  await checkpoint();
  console.log(`${name}: ${result.source} ${result.timeMs}ms`);
  return frame;
}
async function drawApplication(page, timeMs, fixture = {}) {
  return page.evaluate(async ({ timeMs, fixture }) => {
    const app = window.__SMW;
    const configure = () => {
      app.renderer.hudInFrame = false;
      if (fixture.pinCamera) Object.assign(app.sim.camera, { zoom: 1, roll: 0, shakeX: 0, shakeY: 0, floatTilt: 0 });
      if (fixture.reducedMotion != null) app.sim.setReducedMotion(fixture.reducedMotion);
    };
    let clock = app.renderExportFrame(timeMs, { beforeDraw: configure });
    if (await app.rangeSettle()) clock = app.renderExportFrame(timeMs, { beforeDraw: configure });
    const pres = app.sim.biomes.rangePresentation, scene = pres.scene, snapshot = scene.snapshot();
    // Loss/rebuild can intentionally have no prepared scenic frame. Record the
    // presentation status instead of failing before the lifecycle assertion.
    const viewport = pres.frame?.scenicViewport, margin = 2 * (viewport?.overscanPx || 0);
    const canvas = document.querySelector('#stage');
    return { source: 'application-stage', timeMs: clock.timeMs, requestedTimeMs: timeMs,
      dimensions: { width: canvas.width, height: canvas.height },
      usableAspect: viewport ? (viewport.logicalWidth - margin) / (viewport.logicalHeight - margin) : null,
      active: app.rangeState.active, reason: app.rangeState.reason, scene: snapshot,
      viewport: viewport || null,
      camera: { position: scene.camera.position.toArray(), quaternion: scene.camera.quaternion.toArray(), fov: scene.camera.fov, aspect: scene.camera.aspect },
      orbit: scene.prepared.values().next().value?.uniforms?.uJourneyOrbit?.value,
      png: canvas.toDataURL('image/png').split(',')[1] };
  }, { timeMs, fixture });
}
async function drawSeam(page, timeMs, { width, height, reveal = 0 } = {}) {
  return page.evaluate(({ timeMs, width, height, reveal }) => {
    const app = window.__SMW, pres = app.sim.biomes.rangePresentation, scene = pres.scene;
    const active = pres.frame;
    const frame = { ...active, frameId: active.frameId + Math.round(timeMs * 10), timeMs,
      durationMs: timeMs * 2, reducedMotion: false,
      journeyDirection: { ...active.journeyDirection, orbitReveal01: reveal, focusStrength01: 0 },
      userCamera: null };
    const output = document.createElement('canvas'); output.width = width; output.height = height;
    const ctx = output.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
    const vp = frame.scenicViewport;
    const copy = image => {
      if (!image) throw new Error('direct scene did not render');
      const mx = vp.overscanPx / vp.logicalWidth * image.width, my = vp.overscanPx / vp.logicalHeight * image.height;
      ctx.drawImage(image, mx, my, image.width - 2 * mx, image.height - 2 * my, 0, 0, width, height);
    };
    copy(scene.renderFirmament(frame, pres.viewId));
    copy(scene.renderPartition(frame, 'far', pres.viewId));
    return { source: 'direct-Journey-scene-fixture', timeMs, dimensions: { width, height }, reveal,
      scene: scene.snapshot(), orbit: scene.prepared.values().next().value?.uniforms?.uJourneyOrbit?.value,
      camera: { position: scene.camera.position.toArray(), quaternion: scene.camera.quaternion.toArray(), fov: scene.camera.fov, aspect: scene.camera.aspect },
      png: output.toDataURL('image/png').split(',')[1] };
  }, { timeMs, width, height, reveal });
}
const rounded = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'number' ? Math.round(item * 1e7) / 1e7 : item));
function sample(frame) { return rounded({ travelM: frame.scene.travelM, lake: frame.scene.lake, cast: frame.scene.cast, camera: frame.camera }); }
async function cpuProbes(page) {
  return page.evaluate(async () => {
    const { sampleJourneyState } = await import('/src/world/alpine/JourneyWorld.js');
    const { sampleJourneyCast, journeyOrbitCast } = await import('/src/world/alpine/JourneyCast.js');
    const { journeyOrbitCamera } = await import('/src/world/alpine/JourneyOrbitCamera.js');
    const frame = window.__SMW.sim.biomes.rangePresentation.frame;
    const at = (timeMs, reducedMotion = false) => {
      const state = sampleJourneyState({ timeMs, seed: frame.seed, music: frame.habitatMusic?.journey, circular: true, reducedMotion });
      const pose = journeyOrbitCast(sampleJourneyCast({ timeMs, state, music: frame.habitatMusic?.journey, reducedMotion, direction: frame.journeyDirection }));
      return { state, actors: pose.actors.map(a => ({ id: a.id, positionM: a.positionM, up: a.up, right: a.right,
        footOffsetsM: a.footOffsetsM, leanRad: a.leanRad, turnRad: a.turnRad, bodyLiftM: a.bodyLiftM, babies: a.babies })),
        camera: journeyOrbitCamera({ timeMs, reducedMotion, direction: frame.journeyDirection }) };
    };
    const first = at(9000); at(48000); at(250); const reverse = at(9000);
    return { first, reverse, reducedEarly: at(12000, true), reducedLate: at(48000, true) };
  });
}
try {
  for (const aspect of (args.aspects || 'landscape,portrait').split(',')) {
    const [width, height] = aspect === 'portrait' ? [540, 960] : [960, 540];
    const opened = await openSong(wrapper, { url: args.url, wav: args.wav, width, height,
      params: { seed: String(report.seed), rangeRenderer: 'v2' } });
    const entry = { aspect, dimensions: { width, height }, frames: [], errors: opened.errors };
    report.cases.push(entry);
    for (const time of [250, 9000, 22000, 30000, 48000]) {
      const result = await drawApplication(opened.page, time);
      assert.equal(result.active, true, result.reason);
      assert.equal(result.orbit, 1, 'Journey must enable radial projection');
      assert.ok(Math.abs(result.usableAspect - width / height) < 1e-6, 'requested aspect mismatch');
      await saveFrame(entry, `${aspect}-${time}ms`, result);
      assert.deepEqual(opened.errors, [], 'page/shader errors');
    }
    if (args.preview !== '1') {
      if (aspect === 'landscape') {
        const cpu = await cpuProbes(opened.page);
        assert.deepEqual(rounded(cpu.first), rounded(cpu.reverse), 'CPU seek sample differs');
        assert.deepEqual(rounded(cpu.reducedEarly), rounded(cpu.reducedLate), 'CPU reduced motion is not frozen');
        entry.cpuChecks = { reverseSeek: true, reducedMotion: true };
        const naturalReference = entry.frames.find(frame => frame.name === 'landscape-9000ms');
        await opened.page.evaluate(() => window.__SMW.seek(9000));
        await opened.page.evaluate(() => window.__SMW.rangeReady({ timeoutMs: 60000 }));
        const naturalSeek = await drawApplication(opened.page, 9000);
        assert.equal(naturalSeek.active, true, `seek Journey fallback: ${naturalSeek.reason}`);
        assert.deepEqual(sample(naturalReference), sample(naturalSeek), 'natural Journey seek differs without compositor pinning');
        entry.unpinnedTransportSeek = true;
        await opened.page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
        await drawApplication(opened.page, 250, { pinCamera: true });
        const reference = await drawApplication(opened.page, 9000, { pinCamera: true });
        await drawApplication(opened.page, 48000, { pinCamera: true });
        await opened.page.evaluate(() => window.__SMW.seek(9000));
        await opened.page.evaluate(() => window.__SMW.rangeReady({ timeoutMs: 60000 }));
        const seek = await drawApplication(opened.page, 9000, { pinCamera: true });
        assert.equal(seek.active, true, `matched-input seek Journey fallback: ${seek.reason}`);
        assert.deepEqual(sample(reference), sample(seek), 'real seek differs under matched compositor input');
        entry.transportSeek = true;
        const extension = await opened.page.evaluate(() => {
          window.__orbitEvidenceContext = window.__SMW.sim.biomes.rangePresentation.scene.renderer.getContext().getExtension('WEBGL_lose_context');
          window.__orbitEvidenceContext?.loseContext(); return !!window.__orbitEvidenceContext;
        });
        assert.ok(extension, 'context-loss extension unavailable');
        await opened.page.waitForFunction(() => window.__SMW.sim.biomes.rangePresentation.scene.contextLost);
        const lost = await drawApplication(opened.page, 9500, { pinCamera: true });
        assert.equal(lost.active, false);
        await opened.page.evaluate(() => window.__orbitEvidenceContext.restoreContext());
        await opened.page.waitForFunction(() => !window.__SMW.sim.biomes.rangePresentation.scene.contextLost);
        await opened.page.evaluate(() => window.__SMW.rangeReady({ timeoutMs: 60000 }));
        const restored = await drawApplication(opened.page, 10000, { pinCamera: true });
        assert.equal(restored.active, true); entry.contextRecovery = true;
        await saveFrame(entry, 'context-restored', restored);
      }
      await opened.page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
      await drawApplication(opened.page, 250, { pinCamera: true });
      await drawApplication(opened.page, 30000, { pinCamera: true });
      let lo = 0, hi = 400;
      const circumference = 2 * Math.PI * 1800;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (38 * mid + 24 * Math.sin(mid * .025) < circumference) lo = mid; else hi = mid; }
      const crossingMs = (lo + hi) * 500;
      entry.crossingMs = crossingMs;
      for (const [suffix, offset] of [['before', -100], ['at', 0], ['after', 100]]) {
        await saveFrame(entry, `${aspect}-seam-${suffix}`, await drawSeam(opened.page, crossingMs + offset, { width, height }));
      }
      if (aspect === 'landscape' && args.motion !== '0') {
        await fs.mkdir(path.join(out, 'seam-motion'), { recursive: true });
        for (let i = 0; i <= 12; i++) {
          await saveFrame(entry, `seam-motion/frame-${String(i).padStart(3, '0')}`,
            await drawSeam(opened.page, crossingMs - 1000 + i * 1000 / 6, { width, height }));
        }
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '6', '-i', path.join(out, 'seam-motion/frame-%03d.png'),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(out, 'seam-motion.mp4')]);
      }
    }
    assert.deepEqual(opened.errors, [], 'page/shader errors');
    await opened.context.close();
  }
  await Promise.all(pending);
  report.servedFiles = Object.fromEntries([...served].sort(([a], [b]) => a.localeCompare(b)));
  report.servedDigest = hash(JSON.stringify(report.servedFiles));
  report.complete = true;
} catch (error) {
  report.failure = error.stack;
  if (stopping) { report.interrupted = true; process.exitCode = 130; } else throw error;
} finally {
  await browser.close(); server?.kill(); await checkpoint();
}
console.log(`${report.complete ? 'Complete' : 'Incomplete'}: ${out}`);
