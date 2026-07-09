// Smoke test for multi-track MIDI visibility + intertwined pan-out +
// SoundFont folder auto-load. Loads a real multi-channel MIDI file through
// the file-input UI (not a sim-drive shortcut), drops a temp .sf2 into
// soundfonts/ before the server sees it, and verifies:
//   - all tracks/channels are parsed and shown in the track badge/list
//   - opposite-panned, overlapping tracks are flagged "intertwined" and
//     their notes actually ease from center to full pan over the song
//   - the soundfonts/ folder auto-loads with zero clicks
//   - the font cycler arrows grey out at <=1 font and re-enable at 2+
//
// Usage: node tools/serve.js & node tools/smoke-multitrack.mjs [url]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildMultiTrackPannedMidi } from '../test/helpers/midiFixture.js';
import { buildMinimalSf2 } from '../test/helpers/sf2Fixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
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

// --- Fixtures on disk: a temp multi-track MIDI + a temp soundfont dropped
// straight into soundfonts/ (auto-discovered by tools/serve.js). Both are
// cleaned up unconditionally at the end so the repo tree stays pristine.
const midiPath = path.join(os.tmpdir(), `smoke-multitrack-${Date.now()}.mid`);
// 80 notes @ 500ms apart = 40s — comfortably outlasts this test's own
// wall-clock time so the song is still playing (and #hud/#trackBadge still
// visible) through every checkpoint below.
fs.writeFileSync(midiPath, Buffer.from(buildMultiTrackPannedMidi(80)));

const soundfontsDir = path.join(REPO_ROOT, 'soundfonts');
const sfPath = path.join(soundfontsDir, `.smoke-autoload-${Date.now()}.sf2`);
fs.mkdirSync(soundfontsDir, { recursive: true });
fs.writeFileSync(sfPath, Buffer.from(buildMinimalSf2('AutoloadFont')));

let step = 0;
function checkpoint(label, cond) {
  step++;
  if (cond) {
    console.log(`\u2714 Step ${step}: ${label}`);
  } else {
    console.error(`\u2717 Step ${step}: ${label}`);
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  try { fs.unlinkSync(midiPath); } catch { /* already gone */ }
  try { fs.unlinkSync(sfPath); } catch { /* already gone */ }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

try {
  // Step 1: load the multi-track MIDI through the real file-input UI.
  await page.goto(url, { waitUntil: 'load' });
  const input = await page.$('#fileInput');
  await input.setInputFiles(midiPath);
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  checkpoint('MIDI loaded and playing', await page.evaluate(() => !!window.__SMW));

  // Step 2: both channels parsed as distinct tracks.
  const tracks = await page.evaluate(() => window.__SMW.tracks);
  checkpoint('both tracks parsed', Array.isArray(tracks) && tracks.length === 2);

  // Step 3: they were detected as an intertwined (opposite hard-pan, overlapping) pair.
  const pairs = await page.evaluate(() => window.__SMW.pairs);
  checkpoint('intertwined pair detected', Array.isArray(pairs) && pairs.length === 1);
  checkpoint('both tracks marked intertwined', tracks.every((t) => t.intertwined === true));

  // Step 4: the pan-out actually reaches the note timeline — early notes
  // near-center, later notes near the full authored hard-pan spread.
  const panSpread = await page.evaluate(() => {
    const timeline = window.__SMW.conductor.timeline;
    const left = timeline.filter((e) => e.channel === 0);
    const right = timeline.filter((e) => e.channel === 1);
    return {
      firstAbs: Math.max(Math.abs(left[0].pan), Math.abs(right[0].pan)),
      lastLeft: left.at(-1).pan,
      lastRight: right.at(-1).pan,
    };
  });
  checkpoint(
    `pan starts centered (${panSpread.firstAbs.toFixed(3)}) and widens (L=${panSpread.lastLeft.toFixed(2)}, R=${panSpread.lastRight.toFixed(2)})`,
    panSpread.firstAbs < 0.05 && panSpread.lastLeft < -0.5 && panSpread.lastRight > 0.5,
  );

  // Step 5: the track badge is visible and shows the right count.
  const badgeVisible = await page.evaluate(() => !document.getElementById('trackBadge').classList.contains('hidden'));
  checkpoint('track badge visible', badgeVisible);
  const badgeText = await page.evaluate(() => document.getElementById('trackBadgeBtn').textContent);
  checkpoint(`badge shows track count (got "${badgeText}")`, /2 track/.test(badgeText));

  // Step 6: clicking the badge expands the list with one row per track,
  // and it shows the intertwined marker.
  await page.click('#trackBadgeBtn');
  const expanded = await page.evaluate(() => document.getElementById('trackBadge').classList.contains('expanded'));
  checkpoint('badge expands on click', expanded);
  const rowCount = await page.evaluate(() => document.querySelectorAll('#trackList .trackRow').length);
  checkpoint('track list has one row per track', rowCount === 2);
  const hasHint = await page.evaluate(() => !!document.querySelector('#trackList .trackListHint'));
  checkpoint('intertwined hint shown', hasHint);

  // Step 7: pressing T toggles it back off.
  await page.keyboard.press('t');
  const collapsed = await page.evaluate(() => !document.getElementById('trackBadge').classList.contains('expanded'));
  checkpoint('T key toggles the panel closed', collapsed);

  // Step 8: soundfonts/ auto-load — give the background fetch a moment,
  // then confirm the dropped font loaded with zero clicks and the cycler
  // arrows correctly grey out since there's only one font.
  await page.waitForFunction(() => window.__SMW.fontLibrary && window.__SMW.fontLibrary.count >= 1, { timeout: 5000 });
  const autoLoaded = await page.evaluate(() => ({
    count: window.__SMW.fontLibrary.count,
    name: window.__SMW.fontLibrary.active?.name,
  }));
  checkpoint(`soundfonts/ auto-loaded (${autoLoaded.name})`, autoLoaded.count === 1 && autoLoaded.name === 'AutoloadFont');
  await page.mouse.move(640, 700); // poke the fontBar open (auto-hides otherwise)
  await page.waitForTimeout(150);
  const arrowsDisabledAtOne = await page.evaluate(() => ({
    prev: document.getElementById('fontPrev').classList.contains('disabled'),
    next: document.getElementById('fontNext').classList.contains('disabled'),
  }));
  checkpoint('cycler arrows greyed out with only 1 font', arrowsDisabledAtOne.prev && arrowsDisabledAtOne.next);

  // Step 9: adding a second font re-enables the arrows.
  const sf2Bytes = Array.from(new Uint8Array(buildMinimalSf2('SecondFont')));
  await page.evaluate(async (arr) => {
    await window.__SMW.fontLibrary.addBuffer('second.sf2', new Uint8Array(arr).buffer);
  }, sf2Bytes);
  const arrowsEnabledAtTwo = await page.evaluate(() => ({
    prev: document.getElementById('fontPrev').classList.contains('disabled'),
    next: document.getElementById('fontNext').classList.contains('disabled'),
  }));
  checkpoint('cycler arrows re-enable with 2 fonts', !arrowsEnabledAtTwo.prev && !arrowsEnabledAtTwo.next);

  // Step 10: zero page errors throughout.
  checkpoint('zero page errors', errors.length === 0);

  await page.screenshot({ path: path.join(REPO_ROOT, '.smoke-multitrack.png') });
  console.log(`\nSMOKE PASSED (${step}/${step} checkpoints, ${errors.length} errors)`);
} finally {
  cleanup();
  await browser.close();
}
