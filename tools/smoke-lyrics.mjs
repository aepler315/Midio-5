// Live verification for the lyric-informed section-label feature: drops a
// synthetic WAV, route-intercepts lrclib.net with a fixture synced-lyrics
// LRC laying out intro/verse/chorus/verse/chorus/bridge/instrumental/outro,
// and confirms the fused section schedule (SectionFusion) carries those
// kinds through to BiomeManager. A second pass confirms the fully offline
// path (lrclib.net aborted, as if there's no network) degrades to exactly
// today's behavior: no hang, no lyric data, game plays fine.
import { chromium } from 'playwright';

const wavPath = process.argv[2] || '/home/user/Midio-5/.smoke/lyrics_test.wav';

// Matches the schedule baked into the WAV's 100s duration -- see the
// worked-out gap/median-threshold math in the task notes: six ~2000ms
// intra-block gaps (well under the 8000ms split threshold) and four
// ~10000ms + one 25000ms inter-block gaps (well over it), so toBlocks
// splits exactly where intended.
const LRC = `[00:10.00]walking down this empty street alone
[00:12.00]waiting for the sun to rise again
[00:22.00]we rise up together forever bright
[00:24.00]shining like a fire in the night
[00:34.00]another day another mile to go
[00:36.00]counting all the stars we used to know
[00:46.00]we rise up together forever bright
[00:48.00]shining like a fire in the night
[00:58.00]and in the silence i can hear you scream
[01:00.00]burning bridges we will never see
[01:25.00]we rise up together forever bright
[01:27.00]shining like a fire in the night`;

const FIXTURE_RECORD = {
  id: 1, trackName: 'Test Song', artistName: 'Test Artist', albumName: 'Test Album',
  duration: 100, instrumental: false, plainLyrics: LRC.replace(/\[[^\]]+\]/g, ''), syncedLyrics: LRC,
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function runScenario(name, { intercept }) {
  console.log(`\n=== ${name} ===`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push('[console] ' + msg.text()); });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

  await page.route('**lrclib.net/**', intercept);

  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  const input = await page.$('#fileInput');
  await input.setInputFiles(wavPath);

  // The identity/lyrics row appears on the audition panel while separation
  // runs; give it a moment to reflect the auto-Find attempt.
  await page.waitForTimeout(3000);
  const rowState = await page.evaluate(() => ({
    rowHidden: document.getElementById('lyricsRow')?.classList.contains('hidden'),
    status: document.getElementById('lyricsStatus')?.textContent,
    fieldsHidden: document.getElementById('lyricsFields')?.classList.contains('hidden'),
  }));
  console.log('lyrics row mid-flow:', JSON.stringify(rowState));

  await page.waitForSelector('#hud:not(.hidden)', { timeout: 60000 });
  console.log('game started');

  const stats = await page.evaluate(() => {
    const sim = window.__SMW.sim;
    return {
      lyricIdentity: sim.lyricIdentity,
      sectionsCount: sim.biomes.sections.length,
      sectionKinds: sim.biomes.sections.map((s) => s.kind),
      sectionStarts: sim.biomes.sections.map((s) => Math.round(s.startMs)),
      currentKind: sim.biomes.currentKind,
      lyricIntensityEased: sim.biomes.lyricIntensityEased,
    };
  });
  console.log('sim state:', JSON.stringify(stats, null, 2));
  console.log('page errors:', JSON.stringify(errors, null, 2));

  await page.screenshot({ path: `/home/user/Midio-5/.smoke/lyrics_${name}.png` });
  await page.close();
  return { stats, errors };
}

const found = await runScenario('found', {
  intercept: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_RECORD) }),
});

const offline = await runScenario('offline', {
  intercept: (route) => route.abort('failed'),
});

await browser.close();

console.log('\n=== VERDICT ===');
const kinds = found.stats.sectionKinds;
const checks = [
  ['found: has a chorus section', kinds.includes('chorus')],
  ['found: has a bridge section', kinds.includes('bridge')],
  ['found: has an instrumental section', kinds.includes('instrumental')],
  ['found: has a verse section', kinds.includes('verse')],
  ['found: identity resolved with a title', !!found.stats.lyricIdentity?.title],
  ['found: no console/page errors', found.errors.length === 0],
  ['offline: no lyric kinds at all (untouched novelty sections, no `kind` field)', offline.stats.sectionKinds.every((k) => k == null)],
  ['offline: currentKind stays null', offline.stats.currentKind === null],
  // The aborted lrclib.net route is deliberately simulating "no network" --
  // its ERR_FAILED console lines are the expected shape of that, not a bug.
  ['offline: no UNEXPECTED console/page errors', offline.errors.every((e) => e.includes('ERR_FAILED'))],
];
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} -- ${label}`);
const allPass = checks.every(([, ok]) => ok);
console.log(allPass ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(allPass ? 0 : 1);
