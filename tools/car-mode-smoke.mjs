// Car mode: a wake-up tap must be swallowed, and every other tap must still
// reach the UI. Start npm start first. node tools/car-mode-smoke.mjs [url]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8080';
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
let failures = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await context.route('**/soundfonts/', route => route.fulfill({ json: [] }));
  await context.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.locator('#demoBtn').click();
  await page.locator('#worldSelect:not(.hidden)').waitFor();
  await page.locator('#worldChooseForMe').click();
  await page.locator('#hud:not(.hidden)').waitFor();
  await page.waitForFunction(() => !!window.__SMW?.carMode);

  const paused = () => page.evaluate(() => window.__SMW.sim && document.getElementById('pauseBtn').getAttribute('aria-pressed'));
  const run = async (name, check) => {
    try { await check(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
  };

  await run('a song run holds a wake lock', async () => {
    assert.equal(await page.evaluate(() => window.__SMW.carMode.keepAwake.enabled), true);
  });

  await run('a long wait with no display sleep does not eat the next tap', async () => {
    const before = await paused();
    await page.evaluate(() => window.__SMW.carMode.backdateInput(60000));
    await page.locator('#pauseBtn').click();
    assert.notEqual(await paused(), before, 'idle alone must not absorb a tap');
    await page.locator('#pauseBtn').click();
  });

  await run('an ordinary tap still reaches the button', async () => {
    const before = await paused();
    await page.locator('#pauseBtn').click();
    assert.notEqual(await paused(), before, 'pause must toggle on a normal tap');
    await page.locator('#pauseBtn').click();
  });

  await run('the tap that wakes a blanked display is swallowed', async () => {
    const before = await paused();
    await page.evaluate(() => window.__SMW.carMode.simulateDisplaySleep(60000));
    await page.locator('#pauseBtn').click();
    assert.equal(await paused(), before, 'a wake-up tap must not toggle pause');
  });

  await run('the tap right after a wake-up tap works normally again', async () => {
    const before = await paused();
    await page.locator('#pauseBtn').click();
    assert.notEqual(await paused(), before, 'only the first tap is spent on waking');
    await page.locator('#pauseBtn').click();
  });

  await run('no page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}
console.log(failures === 0 ? 'car-mode smoke: OK' : `car-mode smoke: ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
