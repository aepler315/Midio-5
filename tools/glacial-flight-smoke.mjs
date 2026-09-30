// Real WebGL evidence for the glacial flight. The song stays local and is
// not included in the repository. Software GL verifies rendering, not FPS.
// node tools/glacial-flight-smoke.mjs --song /path/song.flac --url http://127.0.0.1:8092 --out .smoke/glacial
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openSong, captureFrame } from './range-scene-smoke.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, v, i, all) => {
  if (i % 2 === 0) pairs.push([v.replace(/^--/, ''), all[i + 1]]);
  return pairs;
}, []));
if (!args.song) throw new Error('--song is required');
const out = path.resolve(args.out || '.smoke/glacial-valley');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const opener = args.budget === 'mobile' ? { newContext: async options => {
    const context = await browser.newContext(options);
    await context.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 }));
    return context;
  } } : browser;
  const { page, context, errors } = await openSong(opener, {
    url: args.url || 'http://127.0.0.1:8092', wav: path.resolve(args.song), width: 1280, height: 720,
    params: { rangeRenderer: 'v2', rangeView: args.view || 'pend-oreille-valley' },
  });
  const scenicCapture = () => page.evaluate(() => {
    const pres = window.__SMW.sim.biomes.rangePresentation;
    const canvas = document.createElement('canvas');
    canvas.width = pres.scene.size.width; canvas.height = pres.scene.size.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#192737'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const band of ['far', 'mid', 'near']) {
      const image = pres.scene.renderPartition(pres.frame, band, pres.viewId);
      if (!image) throw new Error(`missing ${band} partition`);
      ctx.drawImage(image, 0, 0);
    }
    return { png: canvas.toDataURL('image/png').split(',')[1], glacier: pres.frame.glacier,
      cameraM: pres.scene.camera.position.toArray() };
  });
  const frames = [];
  for (const ms of (args.times || '12000,150000,159000,300000,345000').split(',').map(Number)) {
    const first = await captureFrame(page, ms);
    const terrainFirst = await scenicCapture();
    const state = await page.evaluate(() => {
      const pres = window.__SMW.sim.biomes.rangePresentation;
      const frame = pres.frame;
      return { glacier: frame?.glacier, progress01: frame?.progress01,
        residency: window.__SMW.rangeState.residency,
        uniforms: [...(pres.scene?.prepared || [])].map(([id, p]) => ({ id,
          enabled: p.uniforms.uGlacierEnabled.value, retreat01: p.uniforms.uGlacierRetreat.value,
          cameraM: pres.scene.camera.position.toArray() })) };
    });
    const repeat = await captureFrame(page, ms);
    const terrainRepeat = await scenicCapture();
    const identical = repeat.png === first.png;
    const scenicIdentical = terrainFirst.png === terrainRepeat.png;
    const stateIdentical = JSON.stringify(terrainFirst.glacier) === JSON.stringify(terrainRepeat.glacier)
      && JSON.stringify(terrainFirst.cameraM) === JSON.stringify(terrainRepeat.cameraM);
    await fs.writeFile(path.join(out, `frame-${ms}.png`), Buffer.from(first.png, 'base64'));
    await fs.writeFile(path.join(out, `terrain-${ms}.png`), Buffer.from(terrainFirst.png, 'base64'));
    frames.push({ timeMs: ms, identical, scenicIdentical, stateIdentical, range: first.range, state });
    console.log(JSON.stringify({ timeMs: ms, identical, scenicIdentical, stateIdentical,
      active: first.range?.active, viewId: first.range?.viewId, glacier: state.glacier }));
  }
  if (args.motion === '1') {
    const dir = path.join(out, 'motion'); await fs.mkdir(dir, { recursive: true });
    for (let i = 0; i < 108; i++) {
      const frame = await captureFrame(page, 150000 + i * (1000 / 12));
      await fs.writeFile(path.join(dir, `${String(i).padStart(4, '0')}.png`), Buffer.from(frame.png, 'base64'));
      if (i % 12 === 0) console.log(`motion ${i}/108`);
    }
  }
  const report = { softwareGL: true, errors, frames };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await context.close();
  if (errors.length || frames.some(f => !f.range?.active || f.range?.mode !== 'v2' || !f.scenicIdentical || !f.stateIdentical
    || f.state.residency.overcommits > 0 || f.state.residency.liveBytes + f.state.residency.pendingBytes > f.state.residency.budgetBytes)) {
    throw new Error(`rendering failed: ${JSON.stringify(errors)}; inspect ${out}/report.json`);
  }
} finally { await browser.close(); }
