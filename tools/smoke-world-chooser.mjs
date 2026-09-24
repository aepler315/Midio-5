// Chooser previews: one card per world, no public scores, Preview does not
// start playback, Play does, Quiet/Peak share timestamps. Start npm start
// first. Usage: node tools/smoke-world-chooser.mjs [url] [outDir]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { withAllWorlds } from './lib/allWorlds.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://127.0.0.1:8080';
const out = path.resolve(process.argv[3] || path.join(root, '.smoke/chooser'));

await fs.mkdir(out, { recursive: true });
const wav = path.join(out, 'chooser-fixture.wav');
execFileSync(process.execPath, [path.join(root, 'tools/gen-test-wav.mjs'), wav, '120', '32']);

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.route('**/soundfonts/', (route) => route.fulfill({ json: [] }));
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  const entry = new URL(url);
  entry.searchParams.set('seed', '315');
  await page.goto(withAllWorlds(entry.href));
  // The title screen's settings live behind a disclosure now, so that a
  // returning player's first screenful is their music rather than a wall
  // of preferences. Open it before reaching for one.
  await page.locator('#titleSettings').evaluate((node) => { node.open = true; });
  const lyrics = page.locator('#lyricGroundingBtn');
  if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
  await page.locator('#fileInput').setInputFiles(wav);
  await page.locator('#worldSelect:not(.hidden)').waitFor({ timeout: 90000 });

  const title = await page.locator('#worldSelectTitle').innerText();
  assert.match(title, /how your song looks/i);

  const cards = page.locator('.worldCard');
  assert.equal(await cards.count(), 9);

  const names = await cards.locator('.worldCardName').allInnerTexts();
  assert.equal(new Set(names).size, 9, 'exactly one card per registered world');
  assert.ok(names.includes('The Range'));
  assert.ok(names.includes('Cathode'));

  const body = await page.locator('#worldSelect').innerText();
  assert.equal(/%|best match|is-best/i.test(body), false, 'no public ranking copy');

  assert.equal(await page.locator('.worldCardPlayBtn').count(), 9);
  assert.equal(await page.locator('.worldCardPreviewBtn').count(), 9);
  assert.ok(await page.locator('#worldPassageQuiet').count());
  assert.ok(await page.locator('#worldPassagePeak').count());
  assert.ok(await page.locator('#worldChooseForMe').count());

  await page.locator('#worldSelect').screenshot({ path: path.join(out, 'chooser.png') });

  const afterHours = cards.filter({ has: page.getByText('After Hours', { exact: true }) });
  await afterHours.locator('.worldCardPreviewBtn').click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => !!window.__SMW?.sim), false, 'Preview must not start playback');
  assert.ok(await afterHours.evaluate((el) => el.classList.contains('is-previewing')));

  await afterHours.locator('.worldCardPlayBtn').click();
  await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 400, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__SMW.sim.biomes.world.kind), 'city');
  assert.deepEqual(errors, [], 'chooser has no browser errors');
  console.log('PASS world chooser: 9 equal cards, no scores, Preview stays on the picker, Play starts After Hours');
} finally {
  await browser.close();
}
