// Actual application/audio analysis/world-space cove/final Canvas compositor.
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
  // Install before openSong creates its page, so early failures still leave
  // shader diagnostics in the report written by the outer finally block.
  context.on('page', page => {
    page.on('pageerror', error => report.browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'warning' && /range v2/.test(message.text())) report.browserErrors.push(`warn: ${message.text()}`);
      if (/Shader Error|program not valid/.test(message.text())) report.browserErrors.push(`gl: ${message.text().slice(0, 400)}`);
    });
  });
  await context.addInitScript(seedBrowserConstruction, 315);
  return context;
} };
const report = { browser: browser.version(), limitation: 'Synthetic audio and software WebGL; hardware performance is unmeasured.',
  frames: [], browserErrors: [] };
const identityFiles = ['src/main.js', 'src/render/Renderer.js', 'src/sim/Simulation.js',
  'src/world/LandscapePresentation.js', 'src/world/BiomeManager.js', 'src/world/RidgeMotionHistory.js',
  'src/world/alpine/RangeNarrative.js', 'src/world/alpine/RangePerformance.js',
  'src/world/alpine/RangeFirmament.js', 'src/world/alpine/FirmamentGL.js',
  'src/world/alpine/RangeHabitat.js', 'src/world/alpine/CoveGL.js',
  'src/world/alpine/RangeCamera.js', 'src/world/alpine/RangeFrame.js', 'src/world/alpine/RangeScene.js',
  'src/world/alpine/RangePresentation.js', 'src/world/alpine/TerrainMaterial.js', 'src/world/alpine/WaterMirror.js',
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

async function skyVisibility(page, layer = 'x') {
  return page.evaluate(layer => {
    const app = window.__SMW, mgr = app.sim.biomes;
    const canvas = document.querySelector('#stage'), ctx = canvas.getContext('2d');
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const scene = mgr.rangePresentation.scene;
    const layers = scene.prepared.get(app.rangeState.viewId).uniforms.uFirmamentLayers.value;
    try {
      layers[layer] = 0;
      app.renderExportFrame(app.sim.timeMs);
      const without = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const scale = Math.min(canvas.width / app.sim.stageW, canvas.height / app.sim.stageH);
      const width = app.sim.stageW * scale, height = app.sim.stageH * scale;
      const x0 = (canvas.width - width) / 2, y0 = (canvas.height - height) / 2;
      const columns = [0, 0, 0, 0];
      let visible = 0, strong = 0, lake = 0, beyondFrame = 0;
      for (let y = Math.ceil(y0); y < y0 + height; y++) {
        for (let x = Math.ceil(x0); x < x0 + width; x++) {
          const i = (y * canvas.width + x) * 4;
          const delta = Math.max(before[i] - without[i], before[i + 1] - without[i + 1], before[i + 2] - without[i + 2]);
          if (y < y0 + height * .25) {
            if (delta >= 6) { visible++; columns[Math.min(3, Math.floor((x - x0) / width * 4))]++; }
            if (delta >= 16) strong++;
          }
          // The lower quarter of the cove is open water. A reflected ray that
          // projects above NDC +1 explicitly needs sky outside the screen.
          if (delta >= 3 && y > y0 + height * .75) {
            lake++;
            const ray = new scene.THREE.Vector3((x-x0)/width*2-1, 1-(y-y0)/height*2, .5)
              .unproject(scene.camera).sub(scene.camera.position).normalize();
            ray.y = Math.abs(ray.y);
            const projected = ray.multiplyScalar(60000).add(scene.camera.position).project(scene.camera);
            if (projected.y > 1) beyondFrame++;
          }
        }
      }
      return { visible, strong, columns, lake, beyondFrame,
        criterion: 'layer-on/off pixels: upper sky, lower lake, and water rays reflecting above the viewport' };
    } finally { layers[layer] = 1; app.renderExportFrame(app.sim.timeMs); }
  }, layer);
}

async function motionVisibility(page) {
  return page.evaluate(async () => {
    const app = window.__SMW, pres = app.sim.biomes.rangePresentation;
    const prepared = pres.scene.prepared.get(app.rangeState.viewId), habitat = prepared.habitat;
    const { sampleRangePerformance } = await import('/src/world/alpine/RangePerformance.js');
    const canvas = document.querySelector('#stage'), ctx = canvas.getContext('2d');
    const original = habitat.snapshot, update = habitat.update;
    const later = sampleRangePerformance({ layout: prepared.habitatLayout, timeMs: original.timeMs + 4000, music: pres.frame.habitatMusic });
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const result = {};
    try {
      for (const id of ['midio', 'broshi', 'midasus']) {
        const pose = { ...original, actors: original.actors.map(a => a.id === id ? later.actors.find(b => b.id === id) : a) };
        habitat.update = () => update.call(habitat, pose);
        app.renderExportFrame(app.sim.timeMs);
        const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0, maximum = 0;
        for (let i = 0; i < before.length; i += 4) {
          const delta = Math.max(...[0,1,2].map(c => Math.abs(before[i+c]-after[i+c])));
          if (delta >= 6) changed++;
          maximum = Math.max(maximum, delta);
        }
        result[id] = { changed, maximum };
      }
      return result;
    } finally { habitat.update = update; app.renderExportFrame(app.sim.timeMs); }
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
    const habitat = prepared?.habitat;
    const project = positionM => {
      const world = new pres.scene.THREE.Vector3(...positionM);
      const ndc = world.clone().project(pres.scene.camera);
      const camera = world.clone().applyMatrix4(pres.scene.camera.matrixWorldInverse);
      return { ndc: ndc.toArray(), depthM: -camera.z };
    };
    return { performance: habitat?.snapshot, layout: prepared?.habitatLayout,
      projections: habitat?.snapshot?.actors.map(a => ({ id: a.id,
        ...project([a.positionM[0], a.positionM[1] + a.heightM * .5, a.positionM[2]]),
        anchor: project(prepared.habitatLayout.anchors[a.id]) })),
      sky: prepared && { full: prepared.uniforms.uFullSky.value, time: prepared.uniforms.uFirmamentTime.value,
        aurora: prepared.uniforms.uFirmamentBands.value.x, capture: !!pres.scene.backdrop },
      ownership: habitat && { color: prepared.scenes[prepared.habitatLayout.band].children.includes(habitat.group),
        depth: prepared.depthScene.children.includes(habitat.depthGroup),
        bandDepth: prepared.depthScenes[prepared.habitatLayout.band].children.includes(habitat.bandDepthGroup),
        mirrorAmount: prepared.uniforms.uMirrorAmount.value },
      camera: pose, celestial: mgr.celestialState,
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

// Hide the inhabitants through their real draw owner, including both depth
// prepasses and the mirror. Dressing remains visible so a new pine alone
// cannot pass as evidence that the trio reached the final picture.
async function habitatVisibility(page) {
  return page.evaluate(() => {
    const app = window.__SMW, pres = app.sim.biomes.rangePresentation;
    const habitat = pres.scene.prepared.get(app.rangeState.viewId).habitat;
    const canvas = document.querySelector('#stage'), ctx = canvas.getContext('2d');
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const update = habitat.update;
    const records = Object.values(habitat.actors).flatMap(a => [a, ...(a.babies || [])]);
    const meshes = records.flatMap(a => [a.mesh, ...a.depth]);
    const visible = meshes.map(mesh => mesh.visible);
    try {
      habitat.update = function (...args) {
        const result = update.apply(this, args);
        meshes.forEach(mesh => { mesh.visible = false; });
        return result;
      };
      app.renderExportFrame(app.sim.timeMs);
      const without = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0, strong = 0, minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const delta = Math.max(Math.abs(before[i] - without[i]), Math.abs(before[i + 1] - without[i + 1]), Math.abs(before[i + 2] - without[i + 2]));
        if (delta >= 6) { changed++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
        if (delta >= 16) strong++;
      }
      return { changed, strong, bounds: [minX, minY, maxX, maxY],
        criterion: 'absolute trio-on/off channel difference in the final composite; dressing retained, color, depth and mirror use the same world geometry' };
    } finally {
      habitat.update = update;
      meshes.forEach((mesh, i) => { mesh.visible = visible[i]; });
      app.renderExportFrame(app.sim.timeMs);
    }
  });
}

function checkHabitat(state) {
  assert.equal(state.performance.active, true);
  assert.equal(state.sky.full, 1);
  assert.equal(state.sky.capture, false);
  assert.ok(state.sky.aurora >= .36);
  assert.deepEqual(state.performance.actors.map(a => a.id), ['midio', 'broshi', 'midasus']);
  assert.equal(state.layout.id, 'muncho-cove');
  assert.equal(state.policy.trioHabitat, true);
  assert.equal(state.ownership.color, true);
  assert.equal(state.ownership.depth, true);
  assert.equal(state.ownership.bandDepth, true);
  assert.ok(state.projections.every(p => p.depthM > 0 && Math.abs(p.ndc[0]) < 1 && Math.abs(p.ndc[1]) < 1),
    'all three inhabitants project into the actual camera');
  assert.equal(state.policy.performers, false);
  assert.deepEqual(state.oldSimulation, []);
  assert.equal(state.capture, false);
  assert.ok(state.celestial.night01 >= .75);
  assert.ok(state.celestial.sun.altitude01 < .2);
}

// Export stepping and seek can reconstruct a millisecond value a few ULPs
// apart. Preserve exact structure and identity while allowing sub-micrometre
// pose differences; repeated draws at one held clock remain exact below.
function compareSeekSnapshot(actual, expected, tolerance = 1e-7) {
  const comparison = { tolerance, maxAbsoluteDifference: 0, worstPath: null };
  function visit(a, b, at) {
    assert.equal(typeof a, typeof b, `seek value type at ${at}`);
    if (typeof a === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
      const delta = Math.abs(a - b);
      if (delta > comparison.maxAbsoluteDifference) {
        comparison.maxAbsoluteDifference = delta;
        comparison.worstPath = at;
      }
      assert.ok(delta <= tolerance, `backward seek differs at ${at}: ${a} vs ${b}, difference ${delta}`);
    } else if (a && b && typeof a === 'object') {
      assert.equal(Array.isArray(a), Array.isArray(b), `seek container type at ${at}`);
      assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `seek shape at ${at}`);
      for (const key of Object.keys(a)) visit(a[key], b[key], `${at}.${key}`);
    } else assert.deepEqual(a, b, `seek identity at ${at}`);
  }
  visit(actual, expected, '$');
  return comparison;
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
    checkHabitat(state);
    const png = Buffer.from(frame.png, 'base64');
    await fs.writeFile(path.join(out, `${label}.png`), png);
    report.frames.push({ label, timeMs, clock: frame.clock, range: frame.range,
      identity: frame.identity, ...state, pngHash: createHash('sha256').update(png).digest('hex') });
    if (label === 'moonlight') {
      report.habitatVisibility = await habitatVisibility(opened.page);
      assert.ok(report.habitatVisibility.changed > 30, JSON.stringify(report.habitatVisibility));
      report.skyVisibility = await skyVisibility(opened.page);
      assert.ok(report.skyVisibility.visible > 500, JSON.stringify(report.skyVisibility));
      assert.ok(report.skyVisibility.columns.every(n => n > 10), 'stars span the final upper sky');
      assert.ok(report.skyVisibility.lake > 100 && report.skyVisibility.beyondFrame > 100, JSON.stringify(report.skyVisibility));
      report.constellations = await skyVisibility(opened.page, 'y');
      assert.ok(report.constellations.visible > 100 && report.constellations.lake > 30, JSON.stringify(report.constellations));
      report.aurora = await skyVisibility(opened.page, 'z');
      assert.ok(report.aurora.visible > 500, JSON.stringify(report.aurora));
      report.motion = await motionVisibility(opened.page);
      console.log('Pixel checks:', JSON.stringify({stars:report.skyVisibility,art:report.constellations,aurora:report.aurora,motion:report.motion}));
      for (const [id, diff] of Object.entries(report.motion)) assert.ok(diff.changed > 20, `${id}: ${JSON.stringify(diff)}`);

    }
    console.log(`${label}: ${state.performance.actors.length} cove inhabitants, ${state.celestial.activeBody}, ${frame.range.viewId}`);
  }
  const forward = pose => pose.targetM.map((v, i) => v - pose.eyeM[i]);
  const first = report.frames[0].camera;
  for (const { camera } of report.frames) {
    assert.equal(camera.eyeM[1], first.eyeM[1], 'no crane');
    forward(camera).forEach((v, i) => assert.ok(Math.abs(v - forward(first)[i]) < 1e-7, 'no orbit'));
  }
  assert.notDeepEqual(first.eyeM, report.frames[2].camera.eyeM, 'scenery really travels');
  const anchors = report.frames.map(f => f.projections.map(p => p.anchor));
  assert.ok(anchors[0].every((p, i) => Math.abs(p.ndc[0] - anchors[2][i].ndc[0]) > .02),
    'the world anchors move in projection as the camera passes');
  const depths = report.frames[1].projections.map(p => p.depthM);
  assert.ok(Math.max(...depths) - Math.min(...depths) > 100, 'the trio occupies separate real depths');
  assert.equal(report.frames[1].celestial.activeBody, 'moon');
  assert.equal(report.frames[0].celestial.activeBody, 'sun');
  assert.equal(report.frames[2].celestial.activeBody, 'sun');
  const bassActivity = f => f.performance.actors.find(a => a.id === 'broshi').activity;
  assert.ok(bassActivity(report.frames[1]) > bassActivity(report.frames[0]) + .25, 'real recording analysis distinguishes the stronger bass passage');
  assert.ok(report.frames[1].lake.hits.some(hit => hit[1] > 0), 'heard contacts reach the real lake shader');

  await opened.page.evaluate(async () => {
    window.__SMW.seek(30000);
    await window.__SMW.rangeReady({ timeoutMs: 600000 });
  });
  await fs.mkdir(path.join(out, 'animation'), { recursive: true });
  for (let i = 0; i < 20; i++) {
    const animated = await captureFrame(opened.page, 30000 + i * 400);
    await fs.writeFile(path.join(out, 'animation', `${String(i).padStart(3, '0')}.png`), Buffer.from(animated.png, 'base64'));
  }
  execFileSync('ffmpeg', ['-y', '-framerate', '2.5', '-i', path.join(out, 'animation', '%03d.png'),
    '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', path.join(out, 'living-sky.gif')], { stdio: 'ignore' });

  // Reconstruct an earlier instant through the actual seek entry point.
  await opened.page.evaluate(async () => {
    window.__SMW.seek(30000);
    await window.__SMW.rangeReady({ timeoutMs: 600000 });
  });
  await captureFrame(opened.page, 30000);
  const afterSeek = await facts(opened.page);
  const held = await captureFrame(opened.page, 30000);
  assert.deepEqual((await facts(opened.page)).performance, afterSeek.performance, 'held time reproduces the same cove poses');
  const comparison = compareSeekSnapshot(afterSeek.performance, report.frames[1].performance);
  checkHabitat(afterSeek);
  report.seek = { ...afterSeek, clock: held.clock, comparison };

  // Reduced motion freezes spatial movement while keeping the trio present.
  await opened.page.evaluate(() => { window.__SMW.sim.setReducedMotion(true); window.__SMW.sim.setReducedFlash(true); });
  await captureFrame(opened.page, 30000);
  const reducedA = await facts(opened.page);
  await captureFrame(opened.page, 30200);
  const reducedB = await facts(opened.page);
  assert.deepEqual(reducedA.camera, reducedB.camera);
  const spatial = a => ({ positionM: a.positionM, heightM: a.heightM, leanRad: a.leanRad,
    turnRad: a.turnRad, tailAngle: a.tailAngle, jawOpen: a.jawOpen, headAngle: a.headAngle,
    babies: a.babies?.map(b => ({ positionM: b.positionM, heightM: b.heightM })) });
  assert.deepEqual(reducedA.performance.actors.map(spatial), reducedB.performance.actors.map(spatial));
  assert.equal(reducedB.performance.reducedFlash, true);
  checkHabitat(reducedB);
  report.accessibility = reducedB;

  // Same export entry point, portrait output: fits the authored composition.
  await opened.page.evaluate(async () => {
    window.__SMW.beginBulkExport({ width: 360, height: 640 });
    await window.__SMW.rangeReady({ timeoutMs: 600000 });
  });
  await captureFrame(opened.page, 250);
  const portrait = await captureFrame(opened.page, 30000);
  const portraitState = await facts(opened.page);
  checkHabitat(portraitState);
  assert.equal(portrait.clock.width, 360);
  assert.equal(portrait.clock.height, 640);
  await fs.writeFile(path.join(out, 'portrait.png'), Buffer.from(portrait.png, 'base64'));
  report.portrait = { ...portraitState, clock: portrait.clock, range: portrait.range, identity: portrait.identity };
  report.portrait.skyVisibility = await skyVisibility(opened.page);
  assert.ok(report.portrait.skyVisibility.visible > 50, JSON.stringify(report.portrait.skyVisibility));
  assert.deepEqual(await sourceIdentity(), report.sourceHashes, 'captured source must remain stable');
  assert.deepEqual(report.browserErrors, []);
  await opened.context.close();
  report.passed = true;
} catch (err) {
  report.error = String(err.stack || err);
  throw err;
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
