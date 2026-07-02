import { chromium } from 'playwright';

const wavPath = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (msg) => {
  const t = msg.text();
  if (msg.type() === 'error' && !t.includes('favicon')) errors.push('[console] ' + t);
});
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message + '\n' + err.stack));

await page.goto('http://localhost:5173', { waitUntil: 'load' });
const input = await page.$('#fileInput');
await input.setInputFiles(wavPath);

await page.waitForSelector('#hud:not(.hidden)', { timeout: 60000 });
console.log('game started, running for 15s of real time...');
await page.waitForTimeout(15000);

const stats = await page.evaluate(() => {
  const s = window.__SMW.sim;
  const c = window.__SMW.conductor;
  const kicks = c.timeline.filter(e => e.kick).map(e => Math.round(e.tMs));
  return {
    comboDisplay: s.comboSystem.displayM,
    streak: s.comboSystem.streak,
    jumpBpm: s.jump.bpm,
    jumpBeatPeriodMs: s.jump.beatPeriodMs,
    barGridLen: c.barGrid.length,
    barGridFirst5: c.barGrid.slice(0, 5).map(b => Math.round(b.ms)),
    obstaclesSeen: s.obstacles.candidates.length,
    timelineLen: c.timeline.length,
    kickCount: kicks.length,
    kickTimes: kicks.slice(0, 20),
    kickIntervals: kicks.slice(1, 20).map((t, i) => t - kicks[i]),
  };
});
console.log('stats:', JSON.stringify(stats, null, 2));
console.log('errors:', JSON.stringify(errors, null, 2));

await page.screenshot({ path: '/home/user/Midio-5/.smoke/audio_test.png' });
await browser.close();
