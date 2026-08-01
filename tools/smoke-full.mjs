// Final end-to-end pass: loads a real, multi-track MIDI file through the
// actual file-input UI (not a direct sim-drive shortcut) and lets it play
// for real time, checking every subsystem is live and error-free together.
import { chromium } from 'playwright';

const midiPath = process.argv[2];

// Same launch strategy as the other smoke tests: env override, then the CI
// image's pinned chromium, then whatever Playwright has installed locally.
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

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message + '\n' + err.stack));

await page.goto('http://localhost:5173', { waitUntil: 'load' });
const input = await page.$('#fileInput');
await input.setInputFiles(midiPath);
await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });

const checkpoints = [];
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2500);
  const snap = await page.evaluate(() => {
    const s = window.__SMW.sim;
    const c = window.__SMW.conductor;
    return {
      tracks: c.timeline.length ? undefined : undefined,
      comboDisplay: s.comboSystem.displayM,
      streak: s.comboSystem.streak,
      worldX: Math.round(s.worldX),
      broshiState: s.broshi.state,
      midasusIdx: s.midasus.i,
      crackCount: s.fracture.cracks.length,
      biomeSection: s.biomes._sectionAt(s.timeMs),
      fractureDone: s.fracture.isDone,
    };
  });
  checkpoints.push(snap);
  await page.screenshot({ path: `/home/user/Midio-5/.smoke/full_${i}.png` });
  if (snap.fractureDone) break;
}

const trackInfo = await page.evaluate(() => window.__SMW.conductor.timeline.length);
console.log('timeline events:', trackInfo);
console.log('checkpoints:', JSON.stringify(checkpoints, null, 2));
console.log('errors:', JSON.stringify(errors, null, 2));

await browser.close();
