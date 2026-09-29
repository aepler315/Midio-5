// Scratch exploration driver (not committed): bake the wide DEM with an
// overhead rail, then render many candidate poses at 640x360.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readDemGrid } from './tools/lib/terrain-source.mjs';
import { bakeTerrain } from './tools/lib/terrain-bake.mjs';
import { startReviewServer } from './tools/review-range-views.mjs';
import { execFileSync } from 'node:child_process';

const dir = '.terrain-cache/views/explore';
const grid = await readDemGrid('.terrain-cache/work/explore');
const view = { id: 'explore', camera: { eyeStartM: [0, 9000, 30000], eyeEndM: [0, 9000, 30001], targetStartM: [0, 0, 0], targetEndM: [0, 0, 1], fovYDeg: 110 } };
if (!process.argv.includes('--skip-bake')) {
  const baked = await bakeTerrain(grid, view, { visibility: { fovScale: 3, aspect: 2 }, budgets: { desktop: { errorPx: 1.5, heightPx: 1080 }, mobile: { errorPx: 3, heightPx: 720 } } });
  await fs.writeFile(`${dir}/explore.terrain.json`, JSON.stringify(baked.manifest));
  await fs.writeFile(`${dir}/explore.terrain.bin.gz`, baked.payload);
  await fs.writeFile(`${dir}/explore.view.json`, JSON.stringify(view));
  console.log('baked', baked.stats);
}
const [lon0, lat0] = grid.centerLonLat;
const toLocal = (lon, lat) => [(lon - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), -(lat - lat0) * 111320];
const poses = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const { server, port } = await startReviewServer(() => dir);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${port}/src/dev/range-scene-review.html?manifest=/views/explore/explore.terrain.json&view=/views/explore/explore.view.json`);
await page.waitForFunction(() => window.__review?.ready || window.__review?.error, null, { timeout: 900000 });
const files = [], labels = [];
for (const p of poses) {
  const [ex, ez] = toLocal(...p.eye); const [tx, tz] = toLocal(...p.target);
  const eyeY = p.eyeAlt, tY = p.targetAlt;
  await page.evaluate((o) => window.__review.renderPose(o), { eye: [ex, eyeY, ez], target: [tx, tY, tz], fovYDeg: p.fov || 35, width: 640, height: 360 });
  const png = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png').split(',')[1]);
  const f = path.resolve(`.smoke/explore/${p.name}.png`);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, Buffer.from(png, 'base64'));
  files.push(f); labels.push(p.name);
}
await browser.close(); server.close();
const script = `
import json, sys
from PIL import Image, ImageDraw
files, labels, out = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3]
cols = 3
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * (h + 16)), (20, 20, 24))
d = ImageDraw.Draw(sheet)
for k, im in enumerate(ims):
    x, y = (k % cols) * w, (k // cols) * (h + 16)
    sheet.paste(im, (x, y + 16)); d.text((x + 4, y + 2), labels[k], fill=(255, 255, 255))
    for fy in (0.25, 0.5, 0.75):
        d.line([x, y + 16 + int(h * fy), x + 8, y + 16 + int(h * fy)], fill=(255, 80, 80))
sheet.save(out, quality=85)
`;
execFileSync('/usr/bin/python3.12', ['-c', script, JSON.stringify(files), JSON.stringify(labels), process.argv[3]]);
console.log('sheet', process.argv[3]);
