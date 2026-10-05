// Isolated before/after comparison of the RangeFrame response in the real
// compositor. Usage: PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium node
// tools/range-response-evidence.mjs [url] [baseline-ref] [output-directory]
// The baseline substitutes only RangeFrame.js; every other module is current.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { openSong, captureFrame } from './range-scene-smoke.mjs';
import { installSeedReceiver, seedBrowserConstruction } from './lib/landscape-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://127.0.0.1:8092';
const baselineRef = process.argv[3] || 'dfb0a3ced552da04ad2ccf5052bdb5b7ce6e7ea6';
const out = path.resolve(process.argv[4] || '.smoke/range-response');
const file = 'src/world/alpine/RangeFrame.js';
const before = execFileSync('git', ['show', `${baselineRef}:${file}`], { cwd: root });
const after = await fs.readFile(path.join(root, file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(out, { recursive: true });
const wav = path.join(out, 'pilot.wav');
execFileSync(process.execPath, [path.join(root, 'tools/gen-pilot-wav.mjs'), wav, '60']);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { baselineRef, sourceHashes: { before: hash(before), after: hash(after) },
  audioHash: hash(await fs.readFile(wav)), browser: browser.version(),
  limitations: 'Synthetic audio; software WebGL; isolated RangeFrame comparison; not a listening acceptance test or device performance measurement.',
  width: 640, height: 360, fps: 12, startMs: 44000, cases: {}, openings: {} };
try {
  for (const [name, source] of [['before', before], ['after', after]]) {
    const dir = path.join(out, name);
    await fs.mkdir(dir, { recursive: true });
    const seededBrowser = { async newContext(options) {
      const context = await browser.newContext(options);
      await context.addInitScript(installSeedReceiver);
      await context.addInitScript(seedBrowserConstruction, 315);
      await context.route('**/src/world/alpine/RangeFrame.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
      return context;
    } };
    const opened = await openSong(seededBrowser, { url, wav, width: report.width, height: report.height,
      params: { rangeRenderer: 'v2', rangeView: 'teton-jackson-lake', seed: '2917029651' } });
    const frames = report.cases[name] = [];
    try {
      await captureFrame(opened.page, 250, { hook: 'conifer' });
      const opening = await captureFrame(opened.page, 6000, { hook: 'conifer' });
      report.openings[name] = await opened.page.evaluate(() => window.__SMW.sim.biomes.rangePresentation.frame.music);
      await fs.writeFile(path.join(dir, 'opening.png'), Buffer.from(opening.png, 'base64'));
      for (let i = 0; i < 12; i++) {
        const timeMs = report.startMs + i * 1000 / report.fps;
        const frame = await captureFrame(opened.page, timeMs, { hook: 'conifer' });
        assert.equal(frame.range.active, true, frame.range.reason);
        assert.equal(frame.range.viewId, 'teton-jackson-lake');
        assert.equal(frame.range.forcedCandidate, false);
        const music = await opened.page.evaluate(() => window.__SMW.sim.biomes.rangePresentation.frame.music);
        const png = Buffer.from(frame.png, 'base64');
        await fs.writeFile(path.join(dir, `f${String(i).padStart(3, '0')}.png`), png);
        frames.push({ timeMs, music, pngHash: hash(png), quality: frame.quality, identity: frame.identity });
        console.log(`${name} ${timeMs.toFixed(0)}ms: motion bound ${music.totalBoundM.toFixed(3)}m`);
      }
      assert.deepEqual(opened.errors, []);
    } finally { await opened.context.close(); }
  }
  assert.ok(report.cases.after.some((f, i) => f.pngHash !== report.cases.before[i].pngHash), 'the restored response must reach composed pixels');
  assert.ok(report.cases.after.some(f => f.music.kickM > 0 || f.music.melodicM > 0), 'heard accents must reach the terrain');
  assert.equal(report.openings.after.landMoment01, 0, 'opening comparison has no section swell');
  assert.ok(report.openings.after.totalBoundM > 1, 'music moves the terrain between section swells');
  assert.deepEqual(report.cases.before.map(f => f.quality), report.cases.after.map(f => f.quality), 'matched quality');
  report.passed = true;
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
