import assert from 'node:assert/strict';
import { seedBrowserConstruction, installSeedReceiver } from './landscape-browser.mjs';

// Uses the real upload/analysis and existing export APIs. No synthetic control
// bus is substituted for the decoded audio.
export async function openEvaluationSong(browser, { url, audioPath, settings, diagnostics }) {
  const context = await browser.newContext({ viewport: { width: settings.width, height: settings.height },
    deviceScaleFactor: 1, serviceWorkers: 'block' });
  try {
    await context.addInitScript(seedBrowserConstruction, settings.seed);
    await context.addInitScript(installSeedReceiver);
    const origin = new URL(url).origin;
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => diagnostics.errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' || /Shader Error|program not valid/.test(m.text())) diagnostics.errors.push(m.text());
      else if (m.type() === 'warning') diagnostics.warnings.push(m.text());
    });
    page.on('response', res => {
      const u = new URL(res.url());
      if (u.origin !== origin) return;
      diagnostics.loadedFiles.add(u.pathname);
      if (res.status() >= 400) diagnostics.errors.push(`HTTP ${res.status()} ${u.pathname}`);
    });
    page.on('requestfailed', req => {
      if (new URL(req.url()).origin === origin) diagnostics.errors.push(`request failed ${new URL(req.url()).pathname}: ${req.failure()?.errorText}`);
    });
    const entry = new URL(url);
    for (const [key, value] of Object.entries({ bulkExport: 1, exportW: settings.width, exportH: settings.height,
      rangeRenderer: 'v2', rangeView: settings.view, seed: settings.seed, perf: 'high' })) {
      if (value != null) entry.searchParams.set(key, value);
    }
    await page.goto(entry.href);
    await page.locator('#titleSettings').evaluate(node => { node.open = true; });
    const lyrics = page.locator('#lyricGroundingBtn');
    if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
    await page.locator('#fileInput').setInputFiles(audioPath);
    await page.waitForFunction(() => window.__SMW?.exportReady || window.__SMW_EXPORT_ERROR, null, { timeout: 300000 });
    const info = await page.evaluate(async settings => {
      if (window.__SMW_EXPORT_ERROR) throw new Error(window.__SMW_EXPORT_ERROR);
      window.__resetLandscapeRandom();
      window.__SMW.beginBulkExport({ width: settings.width, height: settings.height });
      await window.__SMW.rangeReady({ timeoutMs: 120000 });
      window.__SMW.perf.setFixtureLevel(settings.quality);
      const gl = window.__SMW.sim.biomes.rangePresentation?.scene?.renderer?.getContext();
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { durationMs: window.__SMW.durationMs, seed: window.__SMW.songSeed,
        environment: { gl: gl ? gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL || gl.RENDERER) : null,
          vendor: gl ? gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL || gl.VENDOR) : null,
          deviceMemory: navigator.deviceMemory ?? null, dpr: devicePixelRatio } };
    }, settings);
    assert.equal(info.seed, settings.seed, 'song seed did not match the pinned seed');
    return { context, page, ...info };
  } catch (err) { await context.close(); throw err; }
}

export async function renderEvaluationFrame(page, point, settings) {
  return page.evaluate(async ({ point, settings }) => {
    const smw = window.__SMW;
    const beforeDraw = () => {
      if (settings.biome) smw.sim.biomes.currentBlend = { from: settings.biome, to: settings.biome, t: 1,
        travel: false, travelP: 1, fromHeightMul: 1, toHeightMul: 1, fromSnowLine01: 1, toSnowLine01: 1 };
    };
    let clock = smw.renderExportFrame(point.timeMs, { beforeDraw });
    if (await smw.rangeSettle({ timeoutMs: 120000 })) clock = smw.renderExportFrame(point.timeMs, { beforeDraw });
    const state = smw.rangeState;
    if (Math.abs(clock.timeMs - point.timeMs) > 1000 / 60 + 0.01) throw new Error(`clock drift at ${point.timeMs}: ${clock.timeMs}`);
    if (clock.width !== settings.width || clock.height !== settings.height || clock.draws !== 1) throw new Error('wrong frame size or draw count');
    if (smw.perfLevel !== settings.quality) throw new Error('quality drift');
    if (state.mode !== 'v2' || !state.active || state.runtime !== 'ready') throw new Error(`Range v2 inactive: ${JSON.stringify(state)}`);
    if (settings.view && state.viewId !== settings.view) throw new Error(`wrong view ${state.viewId}`);
    if (!point.save) return null;
    const canvas = document.querySelector('#stage');
    const thumb = document.createElement('canvas'); thumb.width = 64; thumb.height = 36;
    const ctx = thumb.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvas, 0, 0, 64, 36);
    const thumbnail = [...ctx.getImageData(0, 0, 64, 36).data];
    const sim = smw.sim, frame = sim.biomes.rangePresentation?.frame;
    return { timeMs: point.timeMs, actualTimeMs: clock.timeMs, checkpoint: point.checkpoint, clips: point.clips,
      pngData: canvas.toDataURL('image/png').split(',')[1], thumbnail, range: state, quality: smw.perfLevel,
      audio: { heardTimeMs: sim.heardTimeMs, energy: sim.energyCurves?.globalEnergyNorm(sim.heardTimeMs) ?? null,
        bands: sim.energyCurves?.sampleAll(sim.heardTimeMs) ?? null },
      controls: { camera: sim.camera, cameraMove: frame?.cameraMove ?? null, storm: frame?.storm ?? null,
        land: frame?.music ?? null, sectionId: frame?.sectionId ?? null, motifId: frame?.motifId ?? null },
      generation: smw.generation, seed: smw.songSeed };
  }, { point, settings });
}
