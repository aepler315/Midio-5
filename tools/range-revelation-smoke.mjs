// Real-browser pilot checks. This uses software GL unless the caller supplies
// a hardware browser; timing here is diagnostic, never a device FPS claim.
// node tools/range-revelation-smoke.mjs --url http://127.0.0.1:8092
//   --wav /tmp/revelation.wav --output .smoke/revelation
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openSong, captureFrame } from './range-scene-smoke.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = process.argv[i + 1];
assert.ok(args.url && args.wav && args.output, '--url, --wav and --output are required (use a 120s fixture)');
await fs.mkdir(args.output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const report = { renderer: 'software GL; not hardware performance evidence', frames: [], comparisons: [] };
try {
  const mobile = args.profile === 'mobile';
  report.profile = mobile ? 'emulated mobile, 4 GB device memory' : 'desktop';
  const profileBrowser = { async newContext(options) {
    const context = await browser.newContext({ ...options, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    if (mobile) await context.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 }));
    return context;
  } };
  const { context, page, errors } = await openSong(profileBrowser, {
    url: args.url, wav: args.wav, width: Number(args.width || 1280), height: Number(args.height || 720),
    params: { rangeExperience: 'revelation', rangeView: 'teton-jackson-lake' },
  });
  const sample = () => page.evaluate(() => window.__SMW.sim.rangeNarrativeAt());
  const draw = async (timeMs, name) => {
    const frame = await captureFrame(page, timeMs);
    const narrative = await sample();
    await fs.writeFile(path.join(args.output, `${name}.png`), Buffer.from(frame.png, 'base64'));
    const state = { ...frame }; delete state.png;
    report.frames.push({ name, ...state, narrative });
    assert.ok(frame.range.residency.liveBytes + frame.range.residency.pendingBytes <= frame.range.residency.budgetBytes);
    if (mobile) assert.equal(frame.range.residency.budget, 'mobile');
    return { frame, narrative };
  };
  const opening = await draw(0, 'opening');
  assert.ok(opening.frame.range.active, 'opening must use v2');
  assert.equal(opening.narrative.revelation, 0);
  assert.deepEqual(opening.narrative.cast, { midio: 1, broshi: 1, midasus: 1 });
  const overlap = await draw(50000, 'handoff');
  assert.ok(overlap.narrative.revelation > 0 && overlap.narrative.revelation < 1);
  for (const [name, factor] of [['cast-off', 0], ['reduced-cast', .25]]) {
    await page.evaluate(f => {
      const sim = window.__SMW.sim;
      sim.__originalNarrative ||= sim.rangeNarrativeAt;
      sim.rangeNarrativeAt = function (...xs) {
        const n = this.__originalNarrative(...xs);
        return n && { ...n, cast: { midio: f, broshi: f, midasus: f } };
      };
    }, factor);
    const comparison = await draw(50000, name);
    assert.equal(comparison.frame.seed, overlap.frame.seed);
    assert.equal(comparison.frame.range.viewId, overlap.frame.range.viewId);
    assert.equal(comparison.narrative.revelation, overlap.narrative.revelation);
    report.comparisons.push({ name, matchedTimeMs: comparison.frame.clock.timeMs });
  }
  await page.evaluate(() => { const sim = window.__SMW.sim; sim.rangeNarrativeAt = sim.__originalNarrative; });
  const final = await draw(80000, 'final');
  assert.equal(final.narrative.revelation, 1);
  assert.deepEqual(final.narrative.cast, { midio: 0, broshi: 0, midasus: 0 });
  const repeated = await draw(80000, 'final-repeated');
  assert.deepEqual(repeated.narrative, final.narrative);
  assert.ok(final.frame.range.narrative, 'narrative diagnostics travel with renderer state');
  const emitters = await page.evaluate(() => window.__SMW.sim.biomes.rangePresentation.frame.emitters);
  assert.ok(emitters.every(e => e.presence === 0));

  // Drop expensive film passes without losing the essential narrative sky.
  await page.evaluate(() => {
    const sim = window.__SMW.sim;
    sim.reducedMotion = true; sim.reducedFlash = true;
    const r = window.__SMW.renderer.canvasRenderer || window.__SMW.renderer;
    r.__film = r._drawFilmFinish;
    r.__pressureCalls = 0;
    r._drawFilmFinish = function (...xs) { this.__pressureCalls++; return this.__film(...xs); };
    sim.perf.heavyPostFx = false;
  });
  const reduced = await draw(80000, 'reduced-policy');
  assert.deepEqual(reduced.narrative, final.narrative);
  assert.ok(await page.evaluate(() => (window.__SMW.renderer.canvasRenderer || window.__SMW.renderer).__pressureCalls > 0));
  await page.evaluate(() => {
    const ext = window.__SMW.sim.biomes.rangePresentation.scene.renderer.getContext().getExtension('WEBGL_lose_context');
    assertContextExtension(ext);
    window.__narrativeContext = ext; ext.loseContext();
    function assertContextExtension(value) { if (!value) throw new Error('context loss extension unavailable'); }
  });
  await page.waitForFunction(() => window.__SMW.sim.biomes.rangePresentation.scene.contextLost);
  const lost = await draw(80000, 'legacy-context-loss');
  assert.equal(lost.frame.range.active, false);
  assert.equal(lost.frame.range.reason, 'context-lost');
  assert.deepEqual(lost.narrative, final.narrative);
  await page.evaluate(() => window.__narrativeContext.restoreContext());
  await page.waitForFunction(() => !window.__SMW.sim.biomes.rangePresentation.scene.contextLost);
  const restored = await draw(80000, 'restored');
  assert.ok(restored.frame.range.active);
  assert.deepEqual(restored.narrative, final.narrative);

  // Reconstructing the same song replays the indexed arc, independent of the
  // previous late state. The export uses the same immutable analysis/seed.
  await page.evaluate(() => window.__SMW.beginBulkExport(window.__SMW.exportSize));
  const replay = await draw(50000, 'replayed-handoff');
  assert.deepEqual(replay.narrative, overlap.narrative);
  assert.equal(replay.frame.seed, overlap.frame.seed);
  await page.evaluate(() => { window.__SMW.sim.rangeListening = false; });
  assert.equal(await sample(), null, 'explicit gameplay choice retains the cast');
  report.errors = errors;
  assert.deepEqual(errors, [], 'no runtime or shader errors');
  await context.close();
  await fs.writeFile(path.join(args.output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Range revelation: ${report.frames.length} real-browser frames passed; report ${args.output}/report.json`);
} finally { await browser.close(); }
