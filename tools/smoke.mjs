// Visual smoke test: boots the demo timeline in a headless Chromium and
// captures a short screenshot sequence + console error log. Not a
// correctness suite — a fast way to catch "the canvas is blank" regressions.
// Usage: node tools/serve.js & node tools/smoke.mjs [url] [outDir]
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
    try {
      return await chromium.launch({ executablePath });
    } catch { /* try next candidate, or fall through to default resolution */ }
  }
  return chromium.launch();
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('[console] ' + msg.text()); });
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

await page.goto(url, { waitUntil: 'load' });
await page.click('#demoBtn');

const fs = await import('node:fs');
fs.mkdirSync(outDir, { recursive: true });
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, `seq_${i}.png`) });
}

const comboText = await page.textContent('#comboReadout').catch(() => null);
console.log('combo readout:', comboText);
console.log('errors:', JSON.stringify(errors.filter((e) => !e.includes('favicon')), null, 2));

await browser.close();
