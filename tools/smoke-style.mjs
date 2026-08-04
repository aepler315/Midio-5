import { createRequire } from 'node:module';
const require = createRequire('C:/Users/aeple/Development/Midio - Copy/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('pageerror', (e) => errors.push('PAGE: ' + (e.message || e)));
page.on('console', (m) => {
  const t = m.type();
  const text = m.text();
  if (t === 'error' || t === 'warning') errors.push(`${t}: ${text}`);
  if (text.includes('[') || t === 'error') logs.push(`${t}: ${text}`);
});

await page.goto('http://localhost:5173/?style=rendered', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(500);

// Confirm fixed main.js is loaded
const mainHas = await page.evaluate(async () => {
  const r = await fetch('/src/main.js');
  const t = await r.text();
  return {
    building: t.includes('Building world'),
    localLetSim: /let\s+sim\s*;/.test(t),
    assignSim: t.includes('sim = new Simulation'),
  };
});
console.log('main.js', mainHas);

// Force demo without waiting for navigation stability (audio can block click)
await page.evaluate(() => {
  window.__smokeErrors = [];
  const orig = console.error;
  console.error = (...a) => { window.__smokeErrors.push(a.map(String).join(' ')); orig.apply(console, a); };
  document.getElementById('demoBtn')?.click();
});

const start = Date.now();
let last = null;
let ok = false;
while (Date.now() - start < 20000) {
  last = await page.evaluate(() => ({
    hasSim: !!window.__SMW?.sim,
    hasRenderer: !!window.__SMW?.renderer,
    running: !!window.__SMW,
    timeMs: window.__SMW?.sim?.timeMs ?? null,
    style: window.__SMW?.sim?.visualStyle ?? null,
    strips: window.__SMW?.sim?.biomes?.strips?.size ?? null,
    hudHidden: document.getElementById('hud')?.classList.contains('hidden'),
    loaderHidden: document.getElementById('loader')?.classList.contains('hidden'),
    progress: document.getElementById('progressText')?.textContent || '',
    progressHidden: document.getElementById('progressText')?.classList.contains('hidden'),
    smokeErrors: window.__smokeErrors || [],
  }));
  if (last.hasSim && !last.hudHidden) {
    ok = true;
    console.log('ready', Date.now() - start, 'ms', last);
    break;
  }
  await page.waitForTimeout(250);
}
if (!ok) console.log('NOT ready', last);

// Let a second of game time pass
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  let drawErr = null;
  let drawMs = null;
  try {
    const r = window.__SMW?.renderer;
    const s = window.__SMW?.sim;
    if (r && s) {
      const t0 = performance.now();
      r.draw(s, 0);
      drawMs = performance.now() - t0;
    }
  } catch (e) {
    drawErr = String(e && e.stack || e);
  }
  return {
    timeMs: window.__SMW?.sim?.timeMs ?? null,
    drawMs,
    drawErr,
    smokeErrors: window.__smokeErrors || [],
  };
});

console.log(JSON.stringify({ ok, after, errors, logs: logs.slice(0, 30) }, null, 2));
await browser.close();
process.exit(ok && after.timeMs > 0 && !after.drawErr ? 0 : 2);
