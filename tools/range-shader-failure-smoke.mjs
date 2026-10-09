// Start npm run dev first. Exercise a real compiler rejection, rather than
// mocking scene readiness: invalid terrain GLSL must select complete legacy
// scenery and release the rejected view's resources before it can draw.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { openSong, captureFrame } from './range-scene-smoke.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://127.0.0.1:8080';
const out = path.resolve(process.argv[3] || '.smoke/range-shader-failure');
await fs.mkdir(out, { recursive: true });
const wav = process.argv[4] || path.join(out, 'fixture.wav');
if (!process.argv[4]) execFileSync(process.execPath, [path.join(root, 'tools/gen-test-wav.mjs'), wav, '120', '24']);
const source = await fs.readFile(path.join(root, 'src/world/alpine/TerrainMaterial.js'), 'utf8');
const faulty = source.replace('export const SCENE_FRAG = /* glsl */`',
  'export const SCENE_FRAG = /* glsl */`\n  deliberately_invalid_terrain_shader;');
assert.notEqual(faulty, source, 'fault injection reaches the terrain fragment shader');
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const report = { fault: 'invalid terrain GLSL', audio: path.resolve(wav), timeMs: 12000, browser: browser.version(), passed: false };
try {
  const faultBrowser = { newContext: async options => {
    const context = await browser.newContext(options);
    await context.route('**/src/world/alpine/TerrainMaterial.js', route =>
      route.fulfill({ contentType: 'text/javascript', body: faulty }));
    return context;
  } };
  const { context, page, errors } = await openSong(faultBrowser, {
    url, wav,
    width: 640, height: 360,
    params: { rangeTour: 'off', rangeView: 'teton-jackson-lake', seed: '315' },
  });
  try {
    const frame = await captureFrame(page, 12000, { hook: 'conifer' });
    await fs.writeFile(path.join(out, '12000.png'), Buffer.from(frame.png, 'base64'));
    report.range = frame.range;
    report.errors = errors;
    report.resources = await page.evaluate(() => {
      const scene = window.__SMW.sim.biomes.rangePresentation.scene;
      return { prepared: [...scene.prepared.keys()], residency: scene.residency.snapshot() };
    });
    assert.equal(frame.range.active, false, 'a failed terrain shader cannot claim an active scene');
    assert.match(frame.range.failures['teton-jackson-lake'], /^shader:/);
    assert.deepEqual(report.resources.prepared, []);
    for (const owner of ['range-terrain-gpu', 'range-terrain-cpu', 'range-material']) {
      assert.equal(report.resources.residency.byOwner[owner], undefined, `${owner} released after rejection`);
    }
    assert.ok(!errors.some(error => error.startsWith('gl:')), 'failure handled before first shader use');
    report.passed = true;
    console.log('Compiler rejection selects legacy scenery; rejected view resources released.');
  } finally { await context.close(); }
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
