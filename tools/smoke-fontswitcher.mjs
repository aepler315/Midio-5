// Smoke test for the SoundFont switcher popup: lists every loaded font,
// click a row to activate it, click x to hide it (excluded from the
// rotation until restored), and a settings view listing hidden fonts with a
// + to unhide them. Replaces the old </> arrow cycler entirely.
//
// Usage: node tools/smoke-fontswitcher.mjs [url]
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

let step = 0;
function checkpoint(label, cond) {
  step++;
  const ok = cond;
  console.log(`${ok ? '\u2714' : '\u2717'} Step ${step}: ${label}`);
  if (!ok) throw new Error(`Checkpoint ${step} failed: ${label}`);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

// Mock the soundfonts/ manifest to empty BEFORE navigating: the real folder
// can hold gigabytes of real user-dropped fonts (minutes to fetch+parse
// sequentially), which would make every count here a moving target. This
// test is about the switcher UI's own logic, not the real-folder auto-load
// mechanism (covered separately by smoke-multitrack.mjs).
await page.route('**/soundfonts/', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));

// Step 1: start the demo (no MIDI file needed) and inject three fonts.
await page.goto(url, { waitUntil: 'load' });
await page.click('#demoBtn');
await page.waitForTimeout(1000);
checkpoint('demo started', await page.evaluate(() => !!window.__SMW));
// This test scripts explicit select/hide/unhide sequences against tiny
// one-shot fixture fonts that the per-song audition (rightly) rejects as
// spikes-only — put the recommender in observe-only mode so it badges but
// never fights the scripted clicks. Its policy is covered by
// smoke-recommend.mjs.
await page.evaluate(() => { window.__SMW.fontRecommender.autoApply = false; });
checkpoint('library starts empty (manifest mocked)', await page.evaluate(() => window.__SMW.fontLibrary.count === 0));

const names = ['AlphaFont', 'BetaFont', 'GammaFont'];
for (const name of names) {
  const bytes = Array.from(new Uint8Array(buildMinimalSf2(name)));
  // eslint-disable-next-line no-await-in-loop
  await page.evaluate(async (arr) => { await window.__SMW.fontLibrary.addBuffer('x.sf2', new Uint8Array(arr).buffer); }, bytes);
}
checkpoint('3 fonts loaded', await page.evaluate(() => window.__SMW.fontLibrary.count === 3));

// Step 2: open the popup via the fontBar pill.
await page.mouse.move(640, 700); // poke the bar visible first
await page.waitForTimeout(150);
await page.click('#fontBarBtn');
checkpoint('popup opens from the fontBar pill', await page.evaluate(() => !document.getElementById('fontModal').classList.contains('hidden')));
checkpoint('popup lists all 3 fonts', await page.evaluate(() => document.querySelectorAll('#fontModalList .fontRow').length === 3));
checkpoint('the active font row is marked active', await page.evaluate(() => document.querySelectorAll('#fontModalList .fontRow.active').length === 1));

// Step 3: click a row (not its x button) to activate that font.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#fontModalList .fontRow')].find((r) => r.textContent.includes('BetaFont'));
  row.querySelector('.fontRowName').click(); // click the name, not the action button
});
await page.waitForTimeout(100);
checkpoint('clicking a row activates that font', await page.evaluate(() => window.__SMW.fontLibrary.active?.name === 'BetaFont'));
checkpoint('fontName pill reflects the new active font', await page.evaluate(() => document.getElementById('fontName').textContent === 'BetaFont'));

// Step 4: click x on AlphaFont's row to hide it.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#fontModalList .fontRow')].find((r) => r.textContent.includes('AlphaFont'));
  row.querySelector('.fontRowAction').click();
});
await page.waitForTimeout(100);
checkpoint('hidden font disappears from the popup list', await page.evaluate(() => document.querySelectorAll('#fontModalList .fontRow').length === 2));
checkpoint('fontLibrary reports 1 hidden font', await page.evaluate(() => window.__SMW.fontLibrary.hiddenFonts.length === 1));
checkpoint('hiding a non-active font leaves the active one alone', await page.evaluate(() => window.__SMW.fontLibrary.active?.name === 'BetaFont'));

// Step 5: hiding the ACTIVE font auto-advances to another visible one.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#fontModalList .fontRow')].find((r) => r.textContent.includes('BetaFont'));
  row.querySelector('.fontRowAction').click();
});
await page.waitForTimeout(100);
checkpoint('hiding the active font auto-advances (still some font active)', await page.evaluate(() => window.__SMW.fontLibrary.active?.name === 'GammaFont'));

// Step 6: open the hidden-fonts ("settings") view via the toggle button.
const toggleText = await page.evaluate(() => document.getElementById('fontHiddenToggle').textContent);
checkpoint(`hidden-toggle shows the count (got "${toggleText}")`, /Hidden \(2\)/.test(toggleText));
await page.click('#fontHiddenToggle');
checkpoint('settings view shows the 2 hidden fonts', await page.evaluate(() => document.querySelectorAll('#fontModalList .fontRow').length === 2));
checkpoint('modal title reflects the hidden view', await page.evaluate(() => document.getElementById('fontModalTitle').textContent === 'Hidden SoundFonts'));

// Step 7: click + to unhide AlphaFont.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#fontModalList .fontRow')].find((r) => r.textContent.includes('AlphaFont'));
  row.querySelector('.fontRowAction').click();
});
await page.waitForTimeout(100);
checkpoint('unhidden font leaves the hidden list', await page.evaluate(() => window.__SMW.fontLibrary.hiddenFonts.length === 1));
checkpoint('unhide does not steal activation', await page.evaluate(() => window.__SMW.fontLibrary.active?.name === 'GammaFont'));

// Step 8: close the modal, then reopen it directly into the hidden view via
// the settings gear button (the "menu in the settings page" entry point).
await page.click('#fontModalClose');
checkpoint('popup closes', await page.evaluate(() => document.getElementById('fontModal').classList.contains('hidden')));
await page.click('#settingsBtn');
checkpoint('settings gear opens straight into the hidden view', await page.evaluate(() =>
  !document.getElementById('fontModal').classList.contains('hidden') && document.getElementById('fontModalTitle').textContent === 'Hidden SoundFonts'));
checkpoint('settings view still shows BetaFont as hidden', await page.evaluate(() => document.querySelectorAll('#fontModalList .fontRow').length === 1));

// Step 9: Escape closes the modal.
await page.keyboard.press('Escape');
checkpoint('Escape key closes the popup', await page.evaluate(() => document.getElementById('fontModal').classList.contains('hidden')));

// Step 10: F key opens it back up (in the default "list" view).
await page.keyboard.press('f');
checkpoint('F key opens the popup', await page.evaluate(() => !document.getElementById('fontModal').classList.contains('hidden')));
checkpoint('F key opens the visible-fonts list view, not the hidden one', await page.evaluate(() => document.getElementById('fontModalTitle').textContent === 'SoundFonts'));

// Step 11: clicking the backdrop (not the panel) closes it.
await page.evaluate(() => document.getElementById('fontModal').click());
checkpoint('backdrop click closes the popup', await page.evaluate(() => document.getElementById('fontModal').classList.contains('hidden')));

// Step 12: zero page errors throughout.
checkpoint('zero page errors', errors.length === 0);

await page.screenshot({ path: '.smoke-fontswitcher.png' });
console.log(`\nSMOKE PASSED (${step}/${step} checkpoints, ${errors.length} errors)`);
await browser.close();
