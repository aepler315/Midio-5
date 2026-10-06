// Actual application/audio analysis/3D terrain/final Canvas compositor.
// PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium node tools/range-performance-evidence.mjs [url] [output]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openSong, captureFrame } from './range-scene-smoke.mjs';
import { seedBrowserConstruction } from './lib/landscape-browser.mjs';

const out = path.resolve(process.argv[3] || '.smoke/range-performance');
const url = process.argv[2] || 'http://127.0.0.1:8093';
await fs.mkdir(out, { recursive: true });
const wav = path.join(out, 'pilot.wav');
execFileSync(process.execPath, ['tools/gen-pilot-wav.mjs', wav, '60']);
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const seeded = { async newContext(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(seedBrowserConstruction, 315);
  return context;
} };
const report = { browser: browser.version(), limitation: 'Synthetic audio and software WebGL; hardware performance is unmeasured.', frames: [] };
const identityFiles = ['src/main.js', 'src/render/Renderer.js', 'src/sim/Simulation.js',
  'src/world/LandscapePresentation.js', 'src/world/BiomeManager.js', 'src/world/RidgeMotionHistory.js',
  'src/world/alpine/RangeNarrative.js', 'src/world/alpine/RangePerformance.js',
  'src/world/alpine/RangeCamera.js', 'src/world/alpine/RangeFrame.js', 'src/world/alpine/RangeScene.js',
  'src/world/alpine/RangePresentation.js', 'src/world/alpine/TerrainMaterial.js',
  'src/world/alpine/GroundResponse.js', 'src/world/alpine/RangeSkyComposition.js'];
async function sourceIdentity() {
  const hashes = {};
  for (const file of identityFiles) {
    const local = await fs.readFile(file);
    const response = await fetch(new URL(file, url));
    assert.ok(response.ok, `served ${file}`);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    hashes[file] = hash(local);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hashes[file], `server is using this checkout: ${file}`);
  }
  return hashes;
}

async function skyVisibility(page) {
  return page.evaluate(() => {
    const app = window.__SMW, mgr = app.sim.biomes;
    const canvas = document.querySelector('#stage'), ctx = canvas.getContext('2d');
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const painter = mgr._drawStarfield;
    try {
      mgr._drawStarfield = () => {};
      app.renderExportFrame(app.sim.timeMs);
      const without = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const scale = Math.min(canvas.width / app.sim.stageW, canvas.height / app.sim.stageH);
      const width = app.sim.stageW * scale, height = app.sim.stageH * scale;
      const x0 = (canvas.width - width) / 2, y0 = (canvas.height - height) / 2;
      const columns = [0, 0, 0, 0];
      let visible = 0, strong = 0;
      for (let y = Math.ceil(y0); y < y0 + height * .25; y++) {
        for (let x = Math.ceil(x0); x < x0 + width; x++) {
          const i = (y * canvas.width + x) * 4;
          const delta = Math.max(before[i] - without[i], before[i + 1] - without[i + 1], before[i + 2] - without[i + 2]);
          if (delta >= 6) { visible++; columns[Math.min(3, Math.floor((x - x0) / width * 4))]++; }
          if (delta >= 16) strong++;
        }
      }
      return { visible, strong, columns, criterion: 'positive star-on/off channel difference in the upper quarter of the final fitted picture' };
    } finally {
      mgr._drawStarfield = painter;
      app.renderExportFrame(app.sim.timeMs);
    }
  });
}

async function facts(page) {
  return page.evaluate(async () => {
    const app = window.__SMW, sim = app.sim, mgr = sim.biomes;
    const painter = app.renderer.canvasRenderer || app.renderer;
    const pres = mgr.rangePresentation;
    const { default: catalog } = await import('/src/world/terrain/sceneCatalogData.js');
    const view = catalog.views.find(v => v.id === app.rangeState.viewId);
    const pose = view && pres.scene.movedPose(view, pres.frame).pose;
    const prepared = view && pres.scene.prepared.get(view.id);
    return { performance: painter.lastRangePerformance, draw: painter.lastRangePerformanceDraw,
      stageDraws: painter.rangePerformanceDraws, camera: pose, celestial: mgr.celestialState,
      policy: sim.presentation, reducedMotion: sim.reducedMotion, reducedFlash: sim.reducedFlash,
      oldSimulation: ['broshi', 'midasus', 'ensemble', 'excursions', 'focus', 'gaze', 'jump', 'performer']
        .filter(key => !!sim[key]), capture: !!painter._capture,
      lakeHits: pres.frame.waterHits,
      lake: prepared && { originM: prepared.lakeMusicOriginM,
        gain: prepared.uniforms.uLakeMusicGain.value,
        count: prepared.uniforms.uLakeMusicCount.value,
        hits: prepared.uniforms.uLakeMusicHits.value.map(v => v.toArray()) },
    };
  });
}

function checkStage(state) {
  assert.equal(state.draw.actorCount, 3);
  assert.deepEqual(state.performance.actors.map(a => a.id), ['midio', 'broshi', 'midasus']);
  assert.equal(state.policy.trioStage, true);
  assert.equal(state.policy.performers, false);
  assert.deepEqual(state.oldSimulation, []);
  assert.equal(state.capture, false);
  assert.ok(state.celestial.night01 >= .75);
  assert.ok(state.celestial.sun.altitude01 < .2);
}

try {
  report.sourceHashes = await sourceIdentity();
  const opened = await openSong(seeded, { url, wav, width: 640, height: 360,
    params: { rangeRenderer: 'v2', seed: '2917029651' } });
  await captureFrame(opened.page, 250);
  for (const [label, timeMs] of [['sunset', 1000], ['moonlight', 30000], ['sunrise', 59500]]) {
    const frame = await captureFrame(opened.page, timeMs);
    const state = await facts(opened.page);
    assert.equal(frame.range.active, true, frame.range.reason);
    assert.equal(frame.range.viewId, 'muncho-lake-south', 'default pilot must be selected without a view override');
    checkStage(state);
    const png = Buffer.from(frame.png, 'base64');
    await fs.writeFile(path.join(out, `${label}.png`), png);
    report.frames.push({ label, timeMs, clock: frame.clock, range: frame.range,
      identity: frame.identity, ...state, pngHash: createHash('sha256').update(png).digest('hex') });
    if (label === 'moonlight') {
      report.skyVisibility = await skyVisibility(opened.page);
      assert.ok(report.skyVisibility.visible > 100, JSON.stringify(report.skyVisibility));
      assert.ok(report.skyVisibility.columns.every(n => n > 10), 'stars span the final upper sky');
    }
    console.log(`${label}: ${state.draw.actorCount} performers, ${state.celestial.activeBody}, ${frame.range.viewId}`);
  }
  const forward = pose => pose.targetM.map((v, i) => v - pose.eyeM[i]);
  const first = report.frames[0].camera;
  for (const { camera } of report.frames) {
    assert.equal(camera.eyeM[1], first.eyeM[1], 'no crane');
    forward(camera).forEach((v, i) => assert.ok(Math.abs(v - forward(first)[i]) < 1e-7, 'no orbit'));
  }
  assert.notDeepEqual(first.eyeM, report.frames[2].camera.eyeM, 'scenery really travels');
  assert.equal(report.frames[1].celestial.activeBody, 'moon');
  assert.equal(report.frames[0].celestial.activeBody, 'sun');
  assert.equal(report.frames[2].celestial.activeBody, 'sun');
  const bassActivity = f => f.performance.actors.find(a => a.id === 'broshi').activity;
  assert.ok(bassActivity(report.frames[1]) > bassActivity(report.frames[0]) + .25, 'real recording analysis distinguishes the stronger bass passage');
  assert.ok(report.frames[1].lake.hits.some(hit => hit[1] > 0), 'heard contacts reach the real lake shader');

  // Reconstruct an earlier instant through the actual seek entry point.
  await opened.page.evaluate(async () => {
    window.__SMW.seek(30000);
    await window.__SMW.rangeReady({ timeoutMs: 600000 });
  });
  await captureFrame(opened.page, 30000);
  const afterSeek = await facts(opened.page);
  const held = await captureFrame(opened.page, 30000);
  assert.deepEqual((await facts(opened.page)).performance, afterSeek.performance, 'held time reproduces the same stage');
  checkStage(afterSeek);
  report.seek = { ...afterSeek, clock: held.clock };

  // Reduced motion freezes spatial movement while keeping the trio present.
  await opened.page.evaluate(() => { window.__SMW.sim.setReducedMotion(true); window.__SMW.sim.setReducedFlash(true); });
  await captureFrame(opened.page, 30000);
  const reducedA = await facts(opened.page);
  await captureFrame(opened.page, 30200);
  const reducedB = await facts(opened.page);
  assert.deepEqual(reducedA.camera, reducedB.camera);
  assert.deepEqual(reducedA.performance.actors.map(a => a.transform), reducedB.performance.actors.map(a => a.transform));
  checkStage(reducedB);
  report.accessibility = reducedB;

  // Same export entry point, portrait output: fits the authored composition.
  await opened.page.evaluate(async () => {
    window.__SMW.beginBulkExport({ width: 360, height: 640 });
    await window.__SMW.rangeReady({ timeoutMs: 600000 });
  });
  await captureFrame(opened.page, 250);
  const portrait = await captureFrame(opened.page, 30000);
  const portraitState = await facts(opened.page);
  checkStage(portraitState);
  assert.equal(portrait.clock.width, 360);
  assert.equal(portrait.clock.height, 640);
  await fs.writeFile(path.join(out, 'portrait.png'), Buffer.from(portrait.png, 'base64'));
  report.portrait = { ...portraitState, clock: portrait.clock, range: portrait.range, identity: portrait.identity };
  report.portrait.skyVisibility = await skyVisibility(opened.page);
  assert.ok(report.portrait.skyVisibility.visible > 50, JSON.stringify(report.portrait.skyVisibility));
  assert.deepEqual(await sourceIdentity(), report.sourceHashes, 'captured source must remain stable');
  assert.deepEqual(opened.errors, []);
  await opened.context.close();
  report.passed = true;
} catch (err) {
  report.error = String(err.stack || err);
  throw err;
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
