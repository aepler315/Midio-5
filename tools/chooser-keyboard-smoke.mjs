// Real keyboard/default-action and modal-focus checks at desktop/phone widths.
// Start npm start first. node tools/chooser-keyboard-smoke.mjs [url] [outDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8080';
const out = path.resolve(process.argv[3] || '.smoke/chooser-keyboard');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
const results = [];
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.route('**/soundfonts/', route => route.fulfill({ json: [] }));
    await context.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    const run = async (name, check) => {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      try {
        await page.goto(url);
        await check(page);
        assert.deepEqual(errors, [], 'no page errors');
        results.push({ width: viewport.width, name, passed: true });
        console.log(`PASS ${viewport.width}: ${name}`);
      } catch (error) {
        results.push({ width: viewport.width, name, passed: false, error: error.message });
        console.error(`FAIL ${viewport.width}: ${name}: ${error.message}`);
        await page.screenshot({ path: path.join(out, `${viewport.width}-${name}.png`) });
      } finally { await page.close(); }
    };
    const open = async page => {
      await page.locator('#demoBtn').click();
      await page.locator('#worldSelect:not(.hidden)').waitFor();
    };
    const focusedInside = page => page.evaluate(() =>
      document.getElementById('worldSelect').contains(document.activeElement));

    await run('modal-focus', async page => {
      await open(page);
      assert.equal(await focusedInside(page), true, 'opening must move focus into the chooser');
      await page.locator('#stageRes').evaluate(el => el.focus());
      assert.equal(await focusedInside(page), true, 'background controls must be inert');
      await page.locator('#worldSelectBack').focus();
      await page.keyboard.press('Tab');
      assert.equal(await focusedInside(page), true, 'Tab from last control stays inside');
      await page.locator('#worldPassageQuiet').focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'worldSelectBack');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#worldSelect').screenshot({ path: path.join(out, `${viewport.width}-chooser.png`) });
      await page.keyboard.press('Escape');
      await page.locator('#worldSelect.hidden').waitFor({ state: 'attached', timeout: 3000 });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dropzone');
      assert.equal(await page.locator('#loader').isVisible(), true);
      assert.equal(await page.evaluate(() => !!window.__SMW?.sim), false);
      // Reopening must re-establish the modal rather than leave a stale open flag.
      await open(page);
      assert.equal(await focusedInside(page), true);
      await page.locator('#worldSelectBack').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dropzone');
    });

    for (const key of ['Enter', 'Space']) {
      await run(`preview-${key}`, async page => {
        await open(page);
        const card = page.locator('.worldCard').filter({ has: page.getByText('After Hours', { exact: true }) });
        await card.getByRole('button', { name: 'Preview After Hours', exact: true }).focus();
        await page.keyboard.press(key);
        await page.waitForFunction(() => document.querySelector('[aria-label="Preview After Hours"]')
          ?.getAttribute('aria-pressed') === 'true', null, { timeout: 4000 });
        assert.equal(await page.evaluate(() => !!window.__SMW?.sim), false, 'Preview must not start playback');
        assert.equal(await page.locator('#worldSelect').isVisible(), true);
        await card.getByRole('button', { name: 'Play in After Hours', exact: true }).focus();
        await page.keyboard.press(key);
        await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 400, null, { timeout: 30000 });
        assert.equal(await page.evaluate(() => window.__SMW.sim.biomes.world.kind), 'city');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'stage');
        assert.equal(await page.locator('#worldSelect').isVisible(), false);
      });
    }

    await run('preview-reduced-flash', async page => {
      await open(page);
      await page.locator('#worldPassageQuiet').click();
      const card = page.locator('.worldCard').filter({ has: page.getByText('After Hours', { exact: true }) });
      const preview = card.getByRole('button', { name: 'Preview After Hours', exact: true });
      await preview.click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Preview After Hours"]')
        ?.getAttribute('aria-pressed') === 'true');
      assert.equal(await card.locator('.worldCardLive').isVisible(), false);
      await page.keyboard.press('r');
      await card.locator('.worldCardLive').waitFor({ state: 'visible', timeout: 4000 });
      assert.equal(await page.evaluate(() => localStorage.getItem('smw:reducedFlash')), '0');
      await page.keyboard.press('r');
      await card.locator('.worldCardLive').waitFor({ state: 'hidden', timeout: 4000 });
      assert.equal(await page.evaluate(() => localStorage.getItem('smw:reducedFlash')), '1');
      assert.equal(await preview.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#worldPassageQuiet').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => !!window.__SMW?.sim), false);
      await page.keyboard.press('Escape');
      await page.locator('#worldSelect.hidden').waitFor({ state: 'attached', timeout: 3000 });
    });

    await run('card-shortcuts', async page => {
      await open(page);
      const first = page.locator('.worldCard').first();
      await first.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.baseWorldId), 'nocturne');
      const fpsBefore = await page.locator('#fpsHud').getAttribute('class');
      await page.keyboard.press('p');
      await page.waitForFunction(() => document.querySelector('[aria-label="Preview After Hours"]')
        ?.getAttribute('aria-pressed') === 'true', null, { timeout: 4000 });
      assert.equal(await page.locator('#fpsHud').getAttribute('class'), fpsBefore, 'P must not also toggle the gameplay HUD');
      await page.keyboard.press('Escape');
      await page.locator('#worldSelect.hidden').waitFor({ state: 'attached', timeout: 3000 });
      assert.equal(await page.evaluate(() => !!window.__SMW?.sim), false);
    });

    for (const key of ['Enter', 'Space']) {
      await run(`sample-${key}`, async page => {
        let pickerOpened = false;
        page.on('filechooser', () => { pickerOpened = true; });
        await page.locator('#demoBtn').focus();
        await page.keyboard.press(key);
        await page.locator('#worldSelect:not(.hidden)').waitFor({ timeout: 4000 });
        assert.equal(pickerOpened, false, 'sample activation must not open the upload picker');
      });
    }
    await context.close();
  }
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
assert.ok(results.every(r => r.passed), `${results.filter(r => !r.passed).length} chooser keyboard scenarios failed`);
