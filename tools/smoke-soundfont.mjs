// Smoke test for the SoundFont feature. Plays the demo, injects a test SF2,
// cycles fonts via raw mouse events (avoiding Playwright click timeout on the
// auto-hiding fontBar), and verifies the SF2 engine is active with zero page errors.
//
// Usage: node tools/smoke-soundfont.mjs [url]
import { chromium } from 'playwright';
import { buildMinimalSf2 } from '../test/helpers/sf2Fixture.js';

const url = process.argv[2] || 'http://localhost:5173';

const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);

async function launch() {
  for (const executablePath of CHROMIUM_CANDIDATES) {
    try { return await chromium.launch({ executablePath }); } catch { /* try next */ }
  }
  return chromium.launch();
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

let step = 0;
function checkpoint(label, cond) {
  step++;
  const ok = cond;
  console.log(`${ok ? '✔' : '✗'} Step ${step}: ${label}`);
  if (!ok) throw new Error(`Checkpoint ${step} failed: ${label}`);
}

// Step 1: Load page and start demo
await page.goto(url, { waitUntil: 'load' });
await page.click('#demoBtn');
await page.waitForTimeout(1500);
checkpoint('Demo started', await page.evaluate(() => !!window.__SMW));

// Step 2: Verify font library + SF2 engine are exposed
checkpoint('fontLibrary exposed', await page.evaluate(() => !!window.__SMW.fontLibrary));
checkpoint('sf2Engine exposed', await page.evaluate(() => !!window.__SMW.sf2Engine));
checkpoint('SynthRouter is the synth', await page.evaluate(() => !!window.__SMW.synth));

// Step 3: Inject a test SoundFont via the library
const sf2Buffer = buildMinimalSf2('SmokeFont');
const sf2Bytes = Array.from(new Uint8Array(sf2Buffer));
const added = await page.evaluate(async (arr) => {
  const buf = new Uint8Array(arr).buffer;
  await window.__SMW.fontLibrary.addBuffer('smoke.sf2', buf);
  return window.__SMW.fontLibrary.count;
}, sf2Bytes);
checkpoint('SF2 added to library', added === 1);

// Step 4: Verify SF2 engine loaded the font
const sf2Loaded = await page.evaluate(() => !!window.__SMW.sf2Engine.sf2);
checkpoint('SF2 engine has loaded font', sf2Loaded);

// Step 5: Verify SynthRouter routes to SF2 (not fallback)
const routing = await page.evaluate(() => window.__SMW.synth.current === window.__SMW.sf2Engine);
checkpoint('Router routes to SF2 engine', routing);

// Step 6: Cycle font using raw mouse events (avoids click timeout on auto-hiding bar)
// First poke the bar with a mouse move, then use raw down/up on #fontNext
await page.mouse.move(640, 700); // bottom-center area to trigger pokeFontBar
await page.waitForTimeout(200);
const nextRect = await page.evaluate(() => {
  const el = document.getElementById('fontNext');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
checkpoint('fontNext button found', !!nextRect);
if (nextRect) {
  // The mouse.move re-pokes the bar (mousemove listener), making it visible
  await page.mouse.move(nextRect.x, nextRect.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
}
// Verify font name display updated
const fontName = await page.evaluate(() => document.getElementById('fontName')?.textContent);
checkpoint('Font name displayed', fontName === 'SmokeFont');

// Step 7: Verify SF2 synth is receiving note events
// Monkey-patch noteOn to count calls
const noteCount = await page.evaluate(() => {
  const engine = window.__SMW.sf2Engine;
  if (!engine._smokeOrigNoteOn) {
    engine._smokeOrigNoteOn = engine.noteOn;
    engine._smokeNoteCount = 0;
    engine.noteOn = function(evt) { this._smokeNoteCount++; this._smokeOrigNoteOn(evt); };
  }
  return engine._smokeNoteCount;
});
await page.waitForTimeout(2000); // let some notes play
const afterCount = await page.evaluate(() => window.__SMW.sf2Engine._smokeNoteCount);
checkpoint('SF2 synth received note events', afterCount > noteCount);

// Step 8: Verify zero page errors
checkpoint('Zero page errors', errors.length === 0);

// Screenshot
await page.screenshot({ path: '.smoke-soundfont.png' });
console.log(`\nSMOKE PASSED (8/8 checkpoints, ${afterCount - noteCount} note events, ${errors.length} errors)`);
await browser.close();