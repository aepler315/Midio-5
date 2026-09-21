// Every registered world, through real upload, analysis, selection, playback
// and seeking -- plus a per-pass paint audit of the frame each one composes.
// Start npm start first. Usage: node tools/worlds-smoke.mjs [url] [outDir]
//
// WHY THE PAINT AUDIT. This harness used to cover three of the nine worlds
// and assert that each frame held more than sixteen distinct colors. That is
// a liveness check: it proves something rendered, not that the right things
// did. BiomeManager's fata morgana was called every frame for a week while
// drawing exactly zero pixels -- the call landed in a same-named method with
// a different signature -- and nothing here could have noticed, because the
// rest of the frame was as colorful as ever. The same blind spot had already
// swallowed ConstellationWeaver, SkyVoyage's trail and the meteor volleys for
// six world kinds when each kind was split into its own draw function and
// the deep-sky layer was not ported across (see BiomeManager.draw).
//
// So the audit wraps individual draw passes and measures what each one
// actually changes on the stage, rather than judging the composite. A pass
// that runs and paints nothing is now a failure with a name attached.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { renderWorldFrame } from './world-frame.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://127.0.0.1:8080';
const out = path.resolve(process.argv[3] || path.join(root, '.smoke/worlds'));

// Every world on the select screen. `kind` is what BiomeManager reports once
// the world is live -- picking a card builds a per-song VARIANT of that base
// world (see main.js), so the id changes but the kind does not.
//
// `mustPaint` are passes that cannot legitimately draw nothing in this world
// on a settled frame at full quality. Kept deliberately short: the point is a
// tripwire on the passes every frame depends on, not a second copy of each
// world's draw order. `watch` is recorded into report.json without being
// asserted, so a pass that quietly stops painting is visible in a diff even
// where it is allowed to vary.
//
// `mustNotPaint` protects interiors from astronomical layers.
// The positive lists name only passes the world actually invokes -- a pass listed for
// a world that never calls it would sit at zero forever and read like a
// finding. `drawDeepSky` is the reason `watch` exists and cannot be promoted:
// it runs in five worlds and legitimately paints nothing on a 32-second
// fixture, because the Star Atlas is still empty and Midasus has not left on
// a sky voyage yet. Watching it means a real regression -- the deep-sky layer
// going missing again, as it did once already -- still shows up in the diff.
const WORLDS = [
  { name: 'The Range', kind: 'alpine',
    // _drawFataMorgana is the pass that was dead for a week. It is faint by
    // design -- about 4.6% of the frame, peaking at alpha 52/255 -- which is
    // exactly why a whole-frame check could not see it and a per-pass one can.
    mustPaint: ['_drawSky', '_drawGround', '_drawFataMorgana'],
    watch: ['drawDeepSky', '_drawStarfield', '_drawFarShore', '_drawOcean', '_drawLayer'] },
  { name: 'After Hours', kind: 'city',
    mustPaint: ['_drawSky', '_drawGround'],
    watch: ['drawDeepSky', '_drawHaze', '_drawFogBanks', '_drawMoon'] },
  { name: 'Far Side', kind: 'airless',
    mustPaint: ['_drawSky', '_drawGround'],
    watch: ['drawDeepSky'] },
  { name: 'The Fathom', kind: 'abyssal',
    mustPaint: ['_drawSky', '_drawGround'],
    watch: ['_drawCelestial'], mustNotPaint: ['_drawStarfield', 'drawDeepSky'] },
  { name: 'Redline', kind: 'strip',
    mustPaint: ['_drawSky', '_drawGround'],
    watch: ['drawDeepSky', '_drawMoon'] },
  { name: 'The Foundry', kind: 'foundry',
    mustPaint: ['_drawSky', '_drawGround'],
    watch: [], mustNotPaint: ['_drawStarfield', 'drawDeepSky', '_drawMoon', '_drawCelestial'] },
  { name: 'Understory', kind: 'overgrowth',
    mustPaint: ['_drawSky', '_drawGround'],
    watch: [], mustNotPaint: ['_drawStarfield', 'drawDeepSky', '_drawMoon', '_drawCelestial'] },
  { name: 'The Nave', kind: 'nave',
    mustPaint: ['_drawSky', '_drawGround'],
    watch: ['_drawCelestial'], mustNotPaint: ['_drawStarfield', 'drawDeepSky'] },
  // Cathode replaces the renderer rather than the scenery, so BiomeManager
  // never draws for it and there are no BiomeManager passes to audit. Its
  // frame is checked as a whole instead -- see CATHODE_STATS.
  { name: 'Cathode', kind: 'cathode', pixelRenderer: true, mustPaint: [], watch: [] },
];

await fs.mkdir(out, { recursive: true });
const wav = path.join(out, 'worlds-fixture.wav');
execFileSync(process.execPath, [path.join(root, 'tools/gen-test-wav.mjs'), wav, '120', '32']);
const buffer = await fs.readFile(wav);
const rate = buffer.readUInt32LE(24);
for (let i = 44; i < buffer.length; i += 2) {
  const seconds = (i - 44) / 2 / rate;
  // Quiet opening, energetic middle, then return. Keep the same notes so
  // dynamic response can be compared without a different song/tempo.
  const gain = seconds < 10 || seconds >= 24 ? 0.12 : 1;
  buffer.writeInt16LE(Math.round(buffer.readInt16LE(i) * gain), i);
}
await fs.writeFile(wav, buffer);

/** Runs in the page: wrap each named pass, draw one frame, and report how
 *  many stage pixels each call changed. Returns {pass: {calls, paintedPx}}. */
const PAINT_AUDIT = (names) => {
  const { sim, renderer, perf } = window.__SMW;
  const mgr = sim.biomes;
  const proto = Object.getPrototypeOf(mgr);
  const stage = document.querySelector('#stage');
  const scratch = document.createElement('canvas');
  scratch.width = stage.width; scratch.height = stage.height;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  const snapshot = () => {
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.drawImage(stage, 0, 0);
    return sctx.getImageData(0, 0, scratch.width, scratch.height).data;
  };
  const changed = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++;
    }
    return n;
  };

  const stats = {};
  const originals = new Map();
  for (const name of names) {
    const fn = proto[name];
    if (typeof fn !== 'function') { stats[name] = { calls: 0, paintedPx: 0, missing: true }; continue; }
    originals.set(name, fn);
    stats[name] = { calls: 0, paintedPx: 0 };
    proto[name] = function wrapped(...args) {
      const before = snapshot();
      const result = fn.apply(this, args);
      stats[name].calls++;
      stats[name].paintedPx += changed(before, snapshot());
      return result;
    };
  }
  try {
    // Full quality for the audited frame: a shed rung legitimately turns
    // whole passes off, which would read as "painted nothing".
    if (perf) perf.level = 0;
    renderer.draw(sim, 1);
  } finally {
    for (const [name, fn] of originals) proto[name] = fn;
  }
  return stats;
};

/** Cathode draws through its own renderer, so it gets a whole-frame check:
 *  a real pixel frame is neither blank nor uniform. */
const CATHODE_STATS = () => {
  const stage = document.querySelector('#stage');
  const c = document.createElement('canvas');
  c.width = stage.width; c.height = stage.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(stage, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const colors = new Set();
  let nonBlank = 0;
  for (let i = 0; i < px.length; i += 4) {
    colors.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
    if (px[i] + px[i + 1] + px[i + 2] > 12) nonBlank++;
  }
  return {
    colors: colors.size,
    litFraction: +(nonBlank / (c.width * c.height)).toFixed(3),
    rendererIsPixel: window.__SMW.renderer?.constructor?.name || null,
  };
};

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const report = { passed: false, worlds: [] };
const failures = [];
try {
  for (const world of WORLDS) {
    const { name, kind } = world;
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.route('**/soundfonts/', route => route.fulfill({ json: [] }));
      await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
      const entry = new URL(url);
      entry.searchParams.set('seed', '315');
      entry.searchParams.set('perf', 'high'); // start the ladder at full quality
      await page.goto(entry.href);
      // The title screen's settings live behind a disclosure now, so that a
      // returning player's first screenful is their music rather than a
      // wall of preferences. Open it before reaching for one.
      await page.locator('#titleSettings').evaluate((node) => { node.open = true; });
      const lyrics = page.locator('#lyricGroundingBtn');
      if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
      await page.locator('#stageRes').selectOption('720');
      await page.locator('#fileInput').setInputFiles(wav);
      await page.locator('#worldSelect:not(.hidden)').waitFor({ timeout: 90000 });
      await page.locator('.worldCard').filter({ has: page.getByText(name, { exact: true }) }).click();
      await page.waitForFunction(() => window.__SMW?.sim?.timeMs > 1200, null, { timeout: 60000 });
      assert.equal(await page.evaluate(() => window.__SMW.sim.biomes.world.kind), kind);
      // Exercise backward seek and the reduced-motion preference while the
      // song is far from the ending boundary.
      await page.keyboard.press('r');
      await page.evaluate(() => window.__SMW.seek(4000));
      await page.waitForFunction(() => {
        const tSec = window.__SMW?.sim?.biomes?.tSec;
        return Number.isFinite(tSec) && tSec > 4.5 && tSec < 12;
      }, null, { timeout: 60000 });
      assert.equal(await page.evaluate(() => window.__SMW.sim.biomes.reducedFlash), true);
      await page.locator('#stage').screenshot({ path: path.join(out, `${kind}-reduced.png`) });
      assert.ok(await page.evaluate(() => Number.isFinite(window.__SMW.sim.biomes.worldRhythm?.tMs)),
        name + ' receives detected rhythm during live playback');
      // Keep reduced-motion assertions isolated from the per-world paint and
      // dynamics checks below.
      await page.keyboard.press('r');
      assert.equal(await page.evaluate(() => window.__SMW.sim.biomes.reducedFlash), false);
      await page.locator('#pauseBtn').click();
      assert.equal(await page.locator('#pauseBtn').getAttribute('aria-pressed'), 'true');
      const samples = [];
      for (const [label, atMs] of [['quiet', 6000], ['energetic', 18000], ['return', 27000]]) {
        const configuration = await page.evaluate(renderWorldFrame, { atMs, quality: 0 });
        const sample = await page.evaluate(async () => {
          const { sim } = window.__SMW;
          const mgr = sim.biomes;
          const { sampleManagerMusic } = await import('/src/world/WorldMusic.js');
          const music = sampleManagerMusic(mgr);
          const c = document.createElement('canvas'); c.width = 64; c.height = 36;
          const ctx = c.getContext('2d'); ctx.drawImage(document.querySelector('#stage'), 0, 0, 64, 36);
          const pixels = ctx.getImageData(0, 0, 64, 36).data;
          const colors = new Set();
          for (let i = 0; i < pixels.length; i += 4) colors.add(pixels.slice(i, i + 3).join(','));
          return { timeMs: mgr.tSec * 1000, music, rhythmMs: mgr.worldRhythm?.tMs, colors: colors.size };
        });
        assert.ok(sample.colors > 16, name + ' renders a composed ' + label + ' scene');
        assert.ok(sample.rhythmMs == null || Number.isFinite(sample.rhythmMs), name + ' rhythm is absent or finite after destination rebuild');
        assert.ok(Object.values(sample.music).every(Number.isFinite));
        await page.locator('#stage').screenshot({ path: path.join(out, `${kind}-${label}.png`) });
        samples.push({ label, ...configuration, ...sample });
      }
      assert.ok(samples[1].music.energy > samples[0].music.energy, name + ' recognizes the louder passage');

      // The per-pass audit, on the energetic passage -- the busiest frame,
      // and the one where every optional layer is in play.
      const auditConfiguration = await page.evaluate(renderWorldFrame, { atMs: 18000, quality: 0 });
      let paint = null, cathode = null;
      if (world.pixelRenderer) {
        cathode = await page.evaluate(CATHODE_STATS);
        assert.ok(cathode.colors > 4, name + ' composes a real pixel frame');
        assert.ok(cathode.litFraction > 0.05, name + ' frame is not essentially blank');
      } else {
        paint = await page.evaluate(PAINT_AUDIT, [...world.mustPaint, ...world.watch, ...(world.mustNotPaint || [])]);
        for (const pass of world.mustPaint) {
          const s = paint[pass];
          if (!s || s.missing) { failures.push(`${name}: ${pass} is not a method on BiomeManager`); continue; }
          if (s.calls === 0) { failures.push(`${name}: ${pass} never ran`); continue; }
          if (s.paintedPx === 0) failures.push(`${name}: ${pass} ran ${s.calls}x and changed 0 pixels`);
        }
      }

      for (const pass of world.mustNotPaint || []) {
        assert.equal(paint[pass]?.missing, undefined, `${name}: missing ${pass} audit target`);
        assert.equal(paint[pass]?.paintedPx, 0, `${name}: ${pass} must not paint an interior`);
      }
      assert.deepEqual(errors, [], name + ' has no browser errors');
      report.worlds.push({ name, kind, samples, auditConfiguration, paint, cathode, errors });
      const painted = paint
        ? Object.entries(paint).filter(([, s]) => s.paintedPx > 0).map(([k]) => k).join(', ')
        : 'pixel renderer';
      console.log(`PASS ${name}: selection, 3 passages, rhythm, dynamic response, backward seek, reduced motion`);
      console.log(`     painted: ${painted}`);
    } finally { await context.close(); }
  }
  if (failures.length) {
    // Reported together rather than thrown at the first one: a pass that
    // stopped painting in several worlds at once is a different story from
    // one that stopped in a single world, and only the full list tells them
    // apart.
    throw new assert.AssertionError({
      message: `passes that ran without painting:\n  ${failures.join('\n  ')}`,
    });
  }
  report.passed = true;
} finally {
  report.failures = failures;
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
