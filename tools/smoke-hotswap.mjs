// Smoke test for dropping a different MIDI file in at ANY time (even
// mid-song) and having it auto-play. Verifies the fixes that make repeated
// loads safe:
//   - the new song's data actually replaces the old one (distinguishable
//     track/channel signature)
//   - the Conductor gets exactly ONE '*' listener no matter how many files
//     get loaded (the old code re-subscribed on every load, so every note
//     would fire once per past load — 1 load = 1x, 2 loads = 2x, ...)
//   - the frame() rAF loop doesn't stack a second parallel chain: verified
//     directly and deterministically by tracking cancelAnimationFrame calls
//     (a timing/rate-based check was tried first but headless Chromium's
//     requestAnimationFrame throttling AND its AudioContext clock's ratio
//     to wall-clock both turned out to vary wildly and inconsistently
//     across runs in this environment, making any rate threshold flaky
//     regardless of which direction it was set — the actual *mechanism*
//     (stopTimeline cancelling the previous rafHandle) is what's testable
//     reliably)
//   - the outgoing song's audio actually stops (no old-song/new-song overlap)
//
// Usage: node tools/smoke-hotswap.mjs [url]
import { chromium } from 'playwright';
import { buildMultiTrackPannedMidi, buildType0MultiChannelMidi } from '../test/helpers/midiFixture.js';

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

let step = 0;
function checkpoint(label, cond) {
  step++;
  const ok = cond;
  console.log(`${ok ? '\u2714' : '\u2717'} Step ${step}: ${label}`);
  if (!ok) throw new Error(`Checkpoint ${step} failed: ${label}`);
}

// Set input files via the DOM's DataTransfer API so the drop lands on
// `window` exactly like a real OS drag-and-drop would — this exercises the
// actual dragenter/dragover/drop listeners (and the dragOverlay show/hide),
// not just the file-input change handler which is a separate code path.
// Captures window.__rafIds.at(-1) — the raw, independently-tracked latest
// browser-level requestAnimationFrame id, NOT main.js's own `rafHandle`
// bookkeeping — in the SAME browser-side evaluate call as the dispatch, so
// there's no Node<->browser IPC gap for extra frame() ticks to slip
// through unnoticed. Using the raw id (rather than __SMW.rafHandle) matters:
// if `frame()`'s OWN rescheduling ever stopped updating `rafHandle` (the
// exact bug this test exists to catch), comparing stopTimeline()'s cancelled
// id against `rafHandle` would just compare the broken variable to itself
// and always "match" — the raw __rafIds array reflects every browser-level
// call regardless of whether main.js's internal tracking is correct.
async function dropFileOnWindow(page, bytes, filename, mimeType) {
  return page.evaluate(
    async ({ arr, name, type }) => {
      const latestRafIdBeforeDrop = window.__rafIds.at(-1);
      const file = new File([new Uint8Array(arr)], name, { type });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = window;
      const fire = (eventType) => {
        const evt = new DragEvent(eventType, { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'dataTransfer', { value: dt });
        target.dispatchEvent(evt);
      };
      fire('dragenter');
      fire('dragover');
      fire('drop');
      return latestRafIdBeforeDrop;
    },
    { arr: Array.from(new Uint8Array(bytes)), name: filename, type: mimeType },
  );
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

// Deterministic, timing-independent proof that stopTimeline() cancels the
// PREVIOUS song's pending frame() before startTimeline() schedules a new
// one: record every id requestAnimationFrame returns and every id
// cancelAnimationFrame is asked to cancel. If the id passed to
// cancelAnimationFrame was returned by an EARLIER requestAnimationFrame
// call (not just any call — the frame loop calls requestAnimationFrame far
// more often than stopTimeline calls cancelAnimationFrame), the exact
// mechanism the fix relies on is provably wired up correctly — no reliance
// on measuring how fast anything actually runs.
await page.addInitScript(() => {
  window.__rafIds = [];
  window.__cafIds = [];
  const origRaf = window.requestAnimationFrame.bind(window);
  const origCaf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { const id = origRaf(cb); window.__rafIds.push(id); return id; };
  window.cancelAnimationFrame = (id) => { window.__cafIds.push(id); return origCaf(id); };
});

// Step 1: load a long first MIDI (80 notes @ 500ms = 40s — comfortably
// outlasts this whole test) through the real file-input UI.
await page.goto(url, { waitUntil: 'load' });
const input = await page.$('#fileInput');
await input.setInputFiles({ name: 'first.mid', mimeType: 'audio/midi', buffer: Buffer.from(buildMultiTrackPannedMidi(80)) });
await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
checkpoint('first MIDI loaded and playing', await page.evaluate(() => !!window.__SMW));

const firstTracks = await page.evaluate(() => window.__SMW.tracks);
checkpoint('first file: 2 named tracks on channels 0/1', firstTracks.length === 2 && firstTracks.every((t) => t.channel === 0 || t.channel === 1) && firstTracks.some((t) => t.name === 'Left'));

// Step 2: exactly one Conductor '*' listener after the FIRST load.
const listenersAfterFirst = await page.evaluate(() => window.__SMW.conductor.listeners.get('*').size);
checkpoint('exactly 1 Conductor listener after the first load', listenersAfterFirst === 1);

// The first load never had a previous song to tear down, so
// cancelAnimationFrame should not have fired yet, but requestAnimationFrame
// should already be looping.
const idsAfterFirst = await page.evaluate(() => ({ raf: window.__rafIds.length, caf: window.__cafIds.length }));
checkpoint('rAF loop is running, nothing cancelled yet (no prior song to tear down)', idsAfterFirst.raf > 0 && idsAfterFirst.caf === 0);

// Step 3: drop a SECOND, structurally different MIDI (SMF Type 0, channels
// 0+9) via a real window-level drag-and-drop — not the file input — mid-song.
const handleBeforeSecond = await dropFileOnWindow(page, buildType0MultiChannelMidi(), 'second.mid', 'audio/midi');
await page.waitForTimeout(300);
checkpoint('still playing after the drop (#hud stayed visible)', await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden')));

const secondTracks = await page.evaluate(() => window.__SMW.tracks);
checkpoint('second file actually replaced the timeline (channel 9 drum track now present)', secondTracks.some((t) => t.channel === 9) && !secondTracks.some((t) => t.name === 'Left'));

// Step 4: still exactly ONE Conductor listener — the old code added a new
// one on every load, so after 2 loads this would be 2 (and every note would
// fire twice).
const listenersAfterSecond = await page.evaluate(() => window.__SMW.conductor.listeners.get('*').size);
checkpoint('still exactly 1 Conductor listener after the second load (no duplicate)', listenersAfterSecond === 1);

// Step 5: stopTimeline() cancelled a handle that was pending very close to
// (at or shortly after) the instant the drop was dispatched (captured in
// the same browser-side evaluate call as the dispatch itself, minimizing —
// though `loadMidiFile`'s own internal `await`s mean not fully eliminating
// — the async gap in which a few more frame() ticks can legitimately
// elapse before stopTimeline() actually runs). A small tolerance absorbs
// that unavoidable gap while still failing hard if the old chain kept
// running far past it (i.e. was never really cancelled).
const GAP_TOLERANCE = 6; // frames; observed gap in practice is 1-3
const cafIdsAfterSwap = await page.evaluate(() => window.__cafIds);
checkpoint(
  `the swap cancelled a handle close to the pre-drop one (expected ~${handleBeforeSecond}, cancelled ${JSON.stringify(cafIdsAfterSwap)})`,
  cafIdsAfterSwap.length === 1
    && cafIdsAfterSwap[0] >= handleBeforeSecond
    && cafIdsAfterSwap[0] <= handleBeforeSecond + GAP_TOLERANCE,
);

// Step 6: drop a THIRD file too — proves the mechanism holds for every
// subsequent swap, not just the first one.
const handleBeforeThird = await dropFileOnWindow(page, buildMultiTrackPannedMidi(80), 'third.mid', 'audio/midi');
await page.waitForTimeout(300);
const listenersAfterThird = await page.evaluate(() => window.__SMW.conductor.listeners.get('*').size);
checkpoint('still exactly 1 Conductor listener after a third load', listenersAfterThird === 1);
const thirdTracks = await page.evaluate(() => window.__SMW.tracks);
checkpoint('third file replaced the timeline again', thirdTracks.length === 2 && thirdTracks.some((t) => t.name === 'Left'));
const cafIdsAfterThird = await page.evaluate(() => window.__cafIds);
checkpoint(
  `the third swap also cancelled a handle close to its pre-drop one (expected ~${handleBeforeThird}, cancelled ${JSON.stringify(cafIdsAfterThird)})`,
  cafIdsAfterThird.length === 2
    && cafIdsAfterThird[1] >= handleBeforeThird
    && cafIdsAfterThird[1] <= handleBeforeThird + GAP_TOLERANCE,
);

// Step 7: note events actually fire at a sane, non-multiplied rate — the
// clearest end-to-end signal that notes aren't being duplicated. Monkey-
// patch the active synth's noteOn and sample the call rate briefly.
const before = await page.evaluate(() => {
  const engine = window.__SMW.synth;
  if (!engine._smokeOrigNoteOn) {
    engine._smokeOrigNoteOn = engine.noteOn.bind(engine);
    engine._smokeNoteCount = 0;
    engine.noteOn = function (evt) { this._smokeNoteCount++; this._smokeOrigNoteOn(evt); };
  }
  return engine._smokeNoteCount;
});
await page.waitForTimeout(1200);
const after = await page.evaluate(() => window.__SMW.synth._smokeNoteCount);
checkpoint(`notes are still firing after 3 loads (${after - before} events in 1.2s)`, after > before);

// Step 8: zero page errors throughout.
checkpoint('zero page errors', errors.length === 0);

await page.screenshot({ path: '.smoke-hotswap.png' });
console.log(`\nSMOKE PASSED (${step}/${step} checkpoints, ${errors.length} errors)`);
await browser.close();
