// Real typing into the app's text fields must stay text.
//
// Before KeyboardOwnership.js the window keydown handler ran its shortcuts
// before its own typing guard: typing a URL lost every a/s/w/d (swallowed as
// "inert" movement keys), an r toggled reduced flashes, a c opened
// recalibration and a Ctrl+C during playback tapped the beat. Playwright's
// fill() sends no key events, which is why the older URL smoke never saw it;
// this one uses keyboard.type() and real chords.
//
// Start `npm start` first. node tools/input-shortcuts-smoke.mjs [url]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { withAllWorlds } from './lib/allWorlds.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8080';
const out = path.resolve(process.argv[3] || '.smoke/input-shortcuts');
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
let failures = 0;

const reducedFlash = page => page.evaluate(() => localStorage.getItem('smw:reducedFlash'));
const tapCount = page => page.evaluate(() => window.__inputSmokeTaps ?? null);

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/soundfonts/', route => route.fulfill({ json: [] }));
  await context.route('**/favicon.ico', route => route.fulfill({ status: 204 }));

  const run = async (name, check) => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      // A known starting preference, so "unchanged" means something.
      await page.addInitScript(() => { try { localStorage.setItem('smw:reducedFlash', '0'); } catch { /* none */ } });
      await page.goto(withAllWorlds(url));
      await page.locator('#dropzone').waitFor();
      await check(page);
      assert.deepEqual(errors, [], 'no page errors');
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.message}`);
      await page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {});
    } finally {
      await page.close();
    }
  };

  await run('url-field-keeps-every-letter', async (page) => {
    await page.locator('#urlLoadOpenBtn').click();
    await page.locator('#urlLoad:not(.hidden)').waitFor({ timeout: 5000 });
    const input = page.locator('#urlLoadInput');
    await input.click();
    await input.fill('');
    await page.keyboard.type('http://localhost:8088/');
    assert.equal(await input.inputValue(), 'http://localhost:8088/');
    await page.keyboard.type(' bass r');
    assert.equal(await input.inputValue(), 'http://localhost:8088/ bass r');
    assert.equal(await reducedFlash(page), '0', 'typing r must not toggle reduced flashes');
    assert.equal(await page.evaluate(() => document.getElementById('fontModal')?.classList.contains('hidden') ?? true), true,
      'typing g must not open the font list');
  });

  await run('library-search-keeps-every-letter', async (page) => {
    // The Browse button only shows once a library exists; revealing its
    // section is enough, since the click itself still goes through the
    // app's real openLibrary() handler.
    await page.evaluate(() => document.getElementById('libraryHome')?.classList.remove('hidden'));
    await page.locator('#libraryOpenBtn').click();
    const search = page.locator('.librarySearch');
    await search.waitFor({ timeout: 5000 });
    await search.click();
    await page.keyboard.type('bass');
    await page.keyboard.type('r');
    assert.equal(await search.inputValue(), 'bassr');
    assert.equal(await reducedFlash(page), '0', 'typing r must not toggle reduced flashes');
  });

  await run('playback-fields-and-chords-do-not-tap', async (page) => {
    await page.locator('#demoBtn').click();
    await page.locator('#worldSelect:not(.hidden)').waitFor({ timeout: 90000 });
    await page.locator('.worldCard[data-world-id="redline"]').click();
    await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 750, null, { timeout: 90000 });
    await page.evaluate(() => {
      const sim = window.__SMW.sim;
      const real = sim.onBeatTap.bind(sim);
      window.__inputSmokeTaps = 0;
      sim.onBeatTap = (...args) => { window.__inputSmokeTaps++; return real(...args); };
      // Real elements in the real document: one plain field and one nested
      // contenteditable, as a lyrics editor or a future panel would add.
      const field = document.createElement('input');
      field.id = 'inputSmokeField';
      const editor = document.createElement('div');
      editor.id = 'inputSmokeEditor';
      editor.setAttribute('contenteditable', '');
      const inner = document.createElement('span');
      inner.id = 'inputSmokeInner';
      inner.textContent = '';
      editor.append(inner);
      for (const el of [field, editor]) {
        Object.assign(el.style, { position: 'fixed', top: '8px', left: '8px', zIndex: 99999, minWidth: '200px', minHeight: '20px', background: '#fff' });
      }
      editor.style.top = '40px';
      document.body.append(field, editor);
    });

    const field = page.locator('#inputSmokeField');
    await field.focus();
    await page.keyboard.type('fjr wasd');
    assert.equal(await field.inputValue(), 'fjr wasd', 'every letter reaches the field');
    await page.locator('#inputSmokeEditor').focus();
    await page.keyboard.type('fj r');
    assert.equal(await page.locator('#inputSmokeEditor').textContent(), 'fj r');
    assert.equal(await tapCount(page), 0, 'typing must not tap the beat');
    assert.equal(await reducedFlash(page), '0', 'typing r must not toggle reduced flashes');

    // Chords with the stage focused belong to the browser too.
    await page.evaluate(() => { document.activeElement?.blur(); });
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+f');
    await page.keyboard.press('Alt+j');
    assert.equal(await tapCount(page), 0, 'chords must not tap the beat');

    // Ordinary stage keys still do their jobs.
    await page.keyboard.press('f');
    assert.equal(await tapCount(page), 1, 'F on the stage still taps the beat');
    await page.keyboard.press('r');
    assert.equal(await reducedFlash(page), '1', 'R on the stage still toggles reduced flashes');
    await page.keyboard.press('r');
    assert.equal(await reducedFlash(page), '0');
  });
} finally {
  await browser.close();
}

if (failures) {
  console.error(`${failures} input-shortcut check(s) failed`);
  process.exit(1);
}
console.log('input-shortcuts smoke: all checks passed');
