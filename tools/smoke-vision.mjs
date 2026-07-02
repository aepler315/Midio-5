import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message + '\n' + err.stack));

await page.goto('http://localhost:5173', { waitUntil: 'load' });
await page.click('#demoBtn');
await page.waitForTimeout(500);

await page.keyboard.press('`'); // open debug overlay
await page.keyboard.press('v'); // enable vision loop (fetch to unreachable localhost:11434)

await page.waitForTimeout(17000); // past one 15s cycle period

const overlayVisible = await page.evaluate(() => !document.getElementById('debugOverlay').classList.contains('hidden'));
const overlayText = await page.evaluate(() => document.getElementById('debugOverlay').textContent);
const stats = await page.evaluate(() => {
  const s = window.__SMW.sim;
  const v = window.__SMW.visionLoop;
  return {
    running: !!window.__SMW.sim,
    comboDisplay: s.comboSystem.displayM,
    visionEnabled: v.enabled,
    logLength: v.log.length,
    logEntries: v.log.toArray(),
    paramBusLive: s.paramBus.live,
  };
});

console.log('overlayVisible:', overlayVisible);
console.log('stats:', JSON.stringify(stats, null, 2));
console.log('errors:', JSON.stringify(errors, null, 2));
await page.screenshot({ path: '/home/user/Midio-5/.smoke/vision_overlay.png' });
console.log('--- overlay text ---');
console.log(overlayText);

await browser.close();
