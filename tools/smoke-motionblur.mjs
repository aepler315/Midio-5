// Smoke test: the drop motion blur (Renderer._drawDropMotionBlur). Loads a
// synthesized WAV through the real file-input UI, forces a cued drop plus a
// hard impact shake via the __SMW debug surface, then verifies the history
// ring is live and captures frames inside and after the 320ms impact window.
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.SMW_URL || 'http://localhost:8080';

// A tiny mono WAV: a quiet section, then a hard loud one -- enough for the
// app to load and start; the drop itself is cued manually below so the
// audio content only has to be plausible, not drop-shaped.
function makeWav() {
  const sr = 22050, sec = 4;
  const n = sr * sec;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const quiet = 0.06 * Math.sin(2 * Math.PI * 220 * t);
    const loud = t > 2.5 ? 0.85 * (Math.sin(2 * Math.PI * 110 * t) + 0.5 * Math.sin(2 * Math.PI * 277 * t)) : 0;
    const kick = t > 2.5 ? Math.exp(-((t * 5) % 1) * 14) * Math.sin(2 * Math.PI * 55 * t) : 0;
    const v = Math.max(-1, Math.min(1, quiet + loud + kick));
    data.writeInt16LE((v * 32767) | 0, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const wavPath = join(mkdtempSync(join(tmpdir(), 'smw-blur-')), 'drop.wav');
writeFileSync(wavPath, makeWav());

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() !== 'error' || m.text().includes('favicon')) return;
  // The twin of the LRCLIB response filter below: the generic "Failed to
  // load resource" line the browser logs for that same expected 400.
  if ((m.location()?.url || '').includes('lrclib.net')) return;
  errors.push(m.text());
});
page.on('response', (r) => {
  // The synthesized WAV's filename is the song title, so LRCLIB answers 400;
  // the app handles that (no lyrics -> no lookup visuals) and it's not ours.
  if (r.status() >= 400 && !r.url().includes('lrclib.net')) errors.push(`[http ${r.status()}] ${r.url()}`);
});
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.setInputFiles('#fileInput', wavPath);
await page.waitForFunction(() => window.__SMW?.sim, { timeout: 20000 });
// A world-select screen may want a pick; take the first world if so.
await page.evaluate(() => {
  const el = document.querySelector('.worldCard, .worldOption, [class*="worldCard"] button');
  if (el) el.click();
});
await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 });
await page.waitForTimeout(1200); // let the loop and perf governor settle

const state = await page.evaluate(() => {
  const { sim, renderer } = window.__SMW;
  // Force the exact conditions the blur keys on: a cued drop (sets
  // dropAtMs/surge, skipping the audio-inferred detector) plus a hard
  // impact shake, the same call ImpactFX makes on big hits.
  sim.hype.cueDrop(sim.timeMs + 16, 1);
  sim.camera.shake(12);
  return { timeMs: sim.timeMs, perfLevel: window.__SMW.perfLevel, reducedFlash: sim.reducedFlash };
});
await page.waitForTimeout(140); // mid-window: DROP_IMPACT_LIFE_MS is 320
const during = await page.evaluate(() => {
  const { sim, renderer } = window.__SMW;
  const ring = renderer._motionHistory;
  return {
    dropCount: sim.hype.dropCount,
    surge: +sim.hype.surge.toFixed(3),
    ringLive: Array.isArray(ring) && ring.length === 3 && ring[0].width > 0,
    ringFramesDrawn: ring ? ring.every((c) => c.width === renderer.canvas.width && c.height === renderer.canvas.height) : false,
    perfLevel: window.__SMW.perfLevel,
  };
});
await page.screenshot({ path: '.smoke-motionblur-during.png' });
await page.waitForTimeout(600); // well past the window
const after = await page.evaluate(() => {
  const { sim, renderer } = window.__SMW;
  return { surgeTail: +sim.hype.surge.toFixed(3), ringStillLive: !!renderer._motionHistory };
});
await page.screenshot({ path: '.smoke-motionblur-after.png' });

console.log(JSON.stringify({ state, during, after, errors }, null, 2));
const ok = during.ringLive && during.ringFramesDrawn && during.dropCount >= 1 && errors.length === 0;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
await browser.close();
process.exit(ok ? 0 : 1);