// Vision provider-settings smoke test: boots the page in headless Chromium,
// exercises the loader form (provider select, api key, persistence), starts
// the demo, opens the debug overlay, toggles the vision loop, and asserts the
// overlay shows the configured provider + fail-safe no-key state. No network.
// Usage: node tools/serve.js & node tools/smoke-vision-providers.mjs [url]
import { chromium } from 'playwright';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:5173';

const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);

async function launch() {
  for (const executablePath of CHROMIUM_CANDIDATES) {
    try { return await chromium.launch({ executablePath }); } catch { /* next */ }
  }
  return chromium.launch();
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

await page.goto(url, { waitUntil: 'load' });

// 1. The settings <details> exists and the provider select has all 5 options.
await page.click('#visionSettings summary');
const optionCount = await page.locator('#visionProvider option').count();
console.log('provider options:', optionCount);

// 2. Pick OpenAI (needs key), type a key, confirm it persisted to localStorage.
await page.selectOption('#visionProvider', 'openai');
await page.fill('#visionApiKey', 'test-key-abc');
await page.waitForTimeout(500); // debounce save (300ms) + slack
const stored = await page.evaluate(() => localStorage.getItem('smw.vision'));
console.log('stored settings:', stored);
const parsed = JSON.parse(stored);
console.log('provider=', parsed.provider, 'apiKey=', parsed.apiKey);

// 3. baseUrl/model placeholders refreshed to OpenAI defaults.
const baseUrlPh = await page.getAttribute('#visionBaseUrl', 'placeholder');
const modelPh = await page.getAttribute('#visionModel', 'placeholder');
console.log('openai placeholders:', baseUrlPh, modelPh);

// 4. Start demo, open debug overlay, enable vision loop with V.
await page.click('#demoBtn');
await page.waitForTimeout(400);
await page.keyboard.press('`');
await page.keyboard.press('v');
await page.waitForTimeout(600);

// 5. Overlay should show the provider id + 'key' state (key configured).
const overlayText = await page.textContent('#debugOverlay');
const visionLine = overlayText.split('\n').find((l) => l.startsWith('vision loop:'));
console.log('vision line:', JSON.stringify(visionLine));
console.log('overlay has [openai key]:', /openai.*key/i.test(overlayText));

// 6. Fail-safe: drive the loop with a needs-key adapter and no key — expect a
//    silent no-op logging 'no-api-key', never a crash. (The form is hidden
//    once the demo starts, so we set this up directly on the loop.)
const failSafe = await page.evaluate(async () => {
  const vl = window.__SMW?.visionLoop;
  if (!vl) return 'no-vision-loop';
  vl.enabled = true;
  vl.settings = { provider: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' };
  vl.adapter = { id: 'openai', needsKey: true, defaultBaseUrl: '', defaultModel: '', buildRequest() { return { url: '', headers: {}, body: '{}' }; }, extractContent() { return ''; } };
  vl._inFlight = false;
  for (let i = 0; i < 4; i++) vl.ring.push('AAAA');
  vl._lastCycleMs = -Infinity;
  vl._cooldownUntilMs = -Infinity;
  await vl._runCycle(12345);
  const last = vl.log.toArray().at(-1);
  return last ? `${last.applied}|${last.reason}` : 'no-log-entry';
});
console.log('fail-safe no-key cycle:', failSafe);

// 7. No console/page errors related to our code.
const realErrors = errors.filter((e) => !e.includes('favicon') && !/Failed to load resource/i.test(e));
console.log('errors:', JSON.stringify(realErrors, null, 2));

await browser.close();

// Exit code from assertions.
const ok = optionCount === 5 && parsed.provider === 'openai' && parsed.apiKey === 'test-key-abc'
  && /openai.*key/i.test(overlayText) && failSafe.startsWith('false|no-api-key')
  && realErrors.length === 0;
console.log('SMOKE_RESULT:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);