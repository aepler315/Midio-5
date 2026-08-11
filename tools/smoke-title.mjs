// Title-backdrop smoke: load the page, DON'T click demo, and confirm the
// stage canvas is actually painted (not the flat #0a0a14 background) by
// sampling a few pixels. Also confirms no console errors on the title screen.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:5173';
const outDir = process.argv[3] || path.join(__dirname, '..', '.smoke');

const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);

async function launch() {
  for (const executablePath of CHROMIUM_CANDIDATES) {
    try { return await chromium.launch({ executablePath }); } catch { /* next */ }
  }
  return chromium.launch();
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

await page.goto(url, { waitUntil: 'load' });
// Let the title backdrop run a couple frames.
await page.waitForTimeout(400);

const fs = await import('node:fs');
fs.mkdirSync(outDir, { recursive: true });
await page.screenshot({ path: path.join(outDir, 'title-backdrop.png') });

// Sample pixels from the stage canvas: top-left (sky/starfield), center
// (should be near the trio / nebula), and a mid-left point.
const samples = await page.evaluate(() => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const pts = [[20, 20], [640, 300], [380, 400], [820, 360]];
  return pts.map(([x, y]) => {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return { x, y, r: d[0], g: d[1], b: d[2] };
  });
});
console.log('pixel samples:', JSON.stringify(samples, null, 2));
const flat = samples.every((s) => s.r === 10 && s.g === 10 && s.b === 20); // #0a0a14
console.log('canvas is flat background (BAD):', flat);
console.log('errors:', JSON.stringify(errors.filter((e) => !e.includes('favicon')), null, 2));
await browser.close();
