// End-to-end smoke for the tap-recalibration overlay and the SyncMonitor
// auto-prompt.
//
// What it proves that unit tests can't:
//   * pressing C opens the overlay, counts through eight measures, and
//     dismisses itself -- without pausing the song;
//   * the overlay does NOT swallow input: a tap over it still reaches the
//     canvas handler and lands in BeatAnchor (it's pointer-events:none);
//   * pressing C does not itself register a stray beat tap (the keydown
//     handler must return before the catch-all beat-tap branch);
//   * the nudge appears when SyncMonitor says the grid is incoherent, and
//     stays away when it doesn't.
//
// Usage: npm start, then: node tools/smoke-recalibrate.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.SMOKE_URL || 'http://localhost:5173';
const outDir = path.join(os.tmpdir(), 'smw-smoke-recal');
fs.mkdirSync(outDir, { recursive: true });

/** Steady 120bpm kicks plus a simple melody -- a grid the engine reads
 *  correctly, so the nudge should stay away on its own. Deliberately long:
 *  the song must outlast the script, or a completed song tears down the HUD
 *  mid-assertion. */
function buildTestMidi() {
  const LEAD = 960;
  const events = [];
  const kick = (tick) => {
    events.push({ tick: LEAD + tick, bytes: [0x99, 36, 100] });
    events.push({ tick: LEAD + tick + 60, bytes: [0x89, 36, 0] });
  };
  const melody = (tick, pitch) => {
    events.push({ tick: LEAD + tick, bytes: [0x90, pitch, 90] });
    events.push({ tick: LEAD + tick + 460, bytes: [0x80, pitch, 0] });
  };
  // Long enough that the whole script -- a 16s recalibration pass, the
  // toggle checks and the nudge flow -- finishes well before the song does.
  for (let i = 0; i < 300; i++) kick(i * 480);        // 150s of 500ms kicks
  for (let i = 0; i < 150; i++) melody(i * 960, 60 + [0, 4, 7, 4][i % 4]);
  events.sort((a, b) => a.tick - b.tick);

  const vlq = (n) => {
    const st = [n & 0x7f];
    let v = n >> 7;
    while (v) { st.push((v & 0x7f) | 0x80); v >>= 7; }
    return st.reverse();
  };
  const body = [0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
  let last = 0;
  for (const e of events) { body.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
  body.push(0, 0xff, 0x2f, 0x00);
  const len = body.length;
  return Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (480 >> 8) & 255, 480 & 255,
    0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255,
    ...body,
  ]);
}

const midPath = path.join(outDir, 'recal-smoke.mid');
fs.writeFileSync(midPath, buildTestMidi());

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
// No known-failure filter: the two render bugs this used to excuse
// (_drawHypeFrame / _drawDropImpact handing draw()'s logical stage view to
// drawImage) are fixed. A filter that outlives its bug is how the next one
// hides -- these threw for months behind exactly this regex.
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (t.includes('favicon')) return;
  errors.push('[console] ' + t);
});

await page.route('**/soundfonts/', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
await page.goto(URL, { waitUntil: 'load' });

// C before a song runs must be a clean no-op, not a crash.
await page.keyboard.press('c');

await page.setInputFiles('#fileInput', midPath);
await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });

const atAudioMs = (ms) => page.waitForFunction(
  (t) => window.__SMW.audioEngine.nowMs >= t, ms, { timeout: 40000 },
);
const fail = (msg) => { console.error('FAIL: ' + msg); failures.push(msg); };
const failures = [];

await atAudioMs(2000);

// --- pressing C must not itself count as a beat tap -----------------------
const anchorBefore = await page.evaluate(() => ({
  taps: window.__SMW.sim.beatAnchor._history.length,
  playing: !window.__SMW.audioEngine.ctx || window.__SMW.audioEngine.ctx.state === 'running',
}));
await page.keyboard.press('c');
await page.waitForTimeout(120);

const opened = await page.evaluate(() => ({
  visible: !document.getElementById('recalPanel').classList.contains('hidden'),
  taps: window.__SMW.sim.beatAnchor._history.length,
  recalibrating: !!window.__SMW.sim.recalibrating,
  number: document.getElementById('recalNumber').textContent,
}));
if (!opened.visible) fail('C did not open the recalibration overlay');
if (!opened.recalibrating) fail('sim.recalibrating was not set');
if (opened.taps !== anchorBefore.taps) fail('pressing C registered a stray beat tap');
console.log(`overlay open, count showing "${opened.number}"`);
await page.screenshot({ path: path.join(outDir, 'recal1_overlay.png') });

// --- the song must keep playing underneath --------------------------------
const t0 = await page.evaluate(() => window.__SMW.audioEngine.nowMs);
await page.waitForTimeout(600);
const t1 = await page.evaluate(() => window.__SMW.audioEngine.nowMs);
if (!(t1 > t0 + 300)) fail(`audio clock stalled while the overlay was up (${t0} -> ${t1})`);

// --- taps must pass THROUGH the overlay to the canvas ---------------------
// pointer-events:none is the whole reason the existing tap routing keeps
// working; a click at dead centre lands on the big numeral's box.
for (let i = 0; i < 4; i++) {
  await page.mouse.click(640, 360);
  await page.waitForTimeout(500); // ~one beat at 120bpm
}
const afterTaps = await page.evaluate(() => window.__SMW.sim.beatAnchor._history.length);
if (afterTaps <= opened.taps) fail(`taps over the overlay did not reach BeatAnchor (${opened.taps} -> ${afterTaps})`);
console.log(`taps through the overlay reached the anchor: ${opened.taps} -> ${afterTaps}`);

// --- the count runs to 8 measures and dismisses itself --------------------
// 8 measures x 4 beats x 500ms = 16s from the moment it opened.
const highest = await page.evaluate(async () => {
  let max = 0;
  for (let i = 0; i < 200; i++) {
    const el = document.getElementById('recalNumber');
    const panel = document.getElementById('recalPanel');
    if (!panel.classList.contains('hidden')) max = Math.max(max, Number(el.textContent) || 0);
    if (panel.classList.contains('hidden') && max > 0) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  return { max, hidden: document.getElementById('recalPanel').classList.contains('hidden') };
});
if (highest.max < 8) fail(`the count only reached measure ${highest.max} of 8`);
if (!highest.hidden) fail('the overlay did not dismiss itself after 8 measures');
if (await page.evaluate(() => !!window.__SMW.sim.recalibrating)) fail('sim.recalibrating stuck on after the pass');
console.log(`counted to ${highest.max}, dismissed itself`);

// --- C toggles it back off ------------------------------------------------
await page.keyboard.press('c');
await page.waitForTimeout(100);
if (await page.evaluate(() => document.getElementById('recalPanel').classList.contains('hidden'))) {
  fail('C did not reopen the overlay');
}
await page.keyboard.press('c');
await page.waitForTimeout(100);
if (!await page.evaluate(() => document.getElementById('recalPanel').classList.contains('hidden'))) {
  fail('C did not close the overlay');
}

// --- a locked grid must never nudge ---------------------------------------
const sync = await page.evaluate(() => {
  const sm = window.__SMW.sim.syncMonitor;
  return { scatter: sm.scatter, incoherent: sm.incoherent, prompts: sm.promptCount };
});
console.log(`sync: scatter=${sync.scatter.toFixed(2)} incoherent=${sync.incoherent} prompts=${sync.prompts}`);
if (sync.incoherent) fail(`steady 120bpm kicks read as incoherent (scatter ${sync.scatter})`);
if (sync.prompts > 0) fail('nudged on a perfectly locked grid');
if (!await page.evaluate(() => document.getElementById('recalNudge').classList.contains('hidden'))) {
  fail('the nudge is visible on a locked grid');
}

// --- and a scattered one must ---------------------------------------------
// Drive the monitor directly with off-grid kicks: forcing a genuinely
// mis-detected tempo through the audio path isn't reproducible, and what's
// under test here is the prompt -> nudge wiring, not the detector (which
// test/syncMonitor.test.js covers).
const nudged = await page.evaluate(async () => {
  const sm = window.__SMW.sim.syncMonitor;
  sm.promptCount = 0;
  sm._lastPromptMs = -Infinity;
  let t = 0;
  for (let i = 0; i < 16; i++) { t += 500 * (0.4 + ((i * 61) % 100) / 100); sm.onKick(t, 500, 0); }
  const now = window.__SMW.sim.timeMs;
  sm._badSinceMs = now - 30000;      // a sustained bad stretch
  sm.update(now, { anchorConfidence: 0 });
  const prompted = sm.promptPending;
  await new Promise((r) => setTimeout(r, 400)); // let a frame consume it
  return { prompted, visible: !document.getElementById('recalNudge').classList.contains('hidden') };
});
if (!nudged.prompted) fail('SyncMonitor did not prompt on a scattered grid');
if (!nudged.visible) fail('the nudge did not appear after SyncMonitor prompted');
await page.screenshot({ path: path.join(outDir, 'recal2_nudge.png') });
console.log('nudge appeared on a scattered grid');

// The nudge button opens the overlay too.
await page.click('#recalNudgeBtn');
await page.waitForTimeout(150);
if (await page.evaluate(() => document.getElementById('recalPanel').classList.contains('hidden'))) {
  fail('the nudge button did not open the overlay');
}
if (!await page.evaluate(() => document.getElementById('recalNudge').classList.contains('hidden'))) {
  fail('the nudge did not hide once accepted');
}

await browser.close();

if (errors.length) { console.error('page errors:\n' + errors.join('\n')); failures.push('page errors'); }
if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n - ` + failures.join('\n - '));
  process.exit(1);
}
console.log(`\nOK — screenshots in ${outDir}`);
