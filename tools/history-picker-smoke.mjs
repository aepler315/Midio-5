import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { historyMime } from '../src/ui/HistoryFiles.js';
import { readHistory } from './lib/version-history.mjs';

function currentEngineReady() {
  const f = document.getElementById('versionEngine'), w = f.contentWindow;
  return w.location.pathname === new URL(f.dataset.versionUrl).pathname && (w.__MIDIO_VERSION_ADAPTER?.getState().phase === 'ready' || w.__MIDIO_HISTORY_ENGINE?.getState().ready);
}

const siteIndex = process.argv.indexOf('--site');
const site = path.resolve(siteIndex >= 0 ? process.argv[siteIndex + 1] : '_site');
const out = path.resolve('.smoke/history-picker'); await fs.mkdir(out, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(site, 'versions/manifest.json'), 'utf8'));
const report = JSON.parse(await fs.readFile(path.join(site, 'versions/build-report.json'), 'utf8'));
const history = readHistory(process.cwd());
assert.equal(report.commits, history.revisions.length);
assert.equal(manifest.entries.length, history.entries.length);
assert.deepEqual(manifest.entries.map(e => [e.id, e.sourceSha]), history.entries.map(e => [e.id, e.sourceSha]));
const sourceMaps = new Map(history.revisions.map(r => [r.sha, r.files]));
const hashes = new Set();
for (const entry of manifest.entries.filter(e => !e.live)) {
  const map = JSON.parse(await fs.readFile(path.join(site, 'versions/maps', entry.id + '.json'), 'utf8'));
  assert.deepEqual(map, sourceMaps.get(entry.sourceSha), `exact source tree for ${entry.id}`);
  for (const hash of Object.values(map)) hashes.add(hash);
}
for (const hash of hashes) {
  const bytes = await fs.readFile(path.join(site, 'versions/objects', hash));
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(actual, hash, `exact original Git blob ${hash}`);
}
assert.equal(hashes.size, report.uniqueObjects);
console.log(`PASS full coverage: ${report.commits} commits, ${manifest.entries.length} versions, ${hashes.size} original shared blobs`);
if (process.argv.includes('--checks-only')) process.exit(0);
const server = http.createServer((req, res) => {
  let file;
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/project/')) pathname = pathname.slice('/project'.length);
    if (pathname.includes('\\') || pathname.split('/').some(p => p === '.' || p === '..')) throw new Error('Unsafe path');
    if (pathname.endsWith('/')) pathname += 'index.html';
    file = path.join(site, pathname);
    if (!file.startsWith(site + path.sep)) throw new Error('Unsafe path');
  } catch { res.writeHead(400); res.end(); return; }
  res.setHeader('Content-Type', historyMime(file));
  res.setHeader('Cache-Control', 'no-cache');
  const stream = createReadStream(file); stream.on('error', () => { res.writeHead(404); res.end('Not found'); }); stream.pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}), args: ['--enable-unsafe-swiftshader'] });
try {
  for (const prefix of ['/', '/project/']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.tracing.start({ screenshots: true, snapshots: true });
    try {
      await page.goto(origin + prefix + '?rangeRenderer=legacy');
      await page.waitForFunction(() => document.getElementById('versionPicker').textContent.includes('Latest'));
      await page.frameLocator('#versionEngine').locator('#stage').waitFor();
      assert.equal(await page.evaluate(async () => {
        const { retainHistorySource } = await import('./src/ui/HistorySource.js');
        const child = document.createElement('iframe'); document.body.append(child);
        const original = new child.contentWindow.File(['retained bytes'], 'test.wav', { type: 'audio/wav', lastModified: 123 });
        const held = retainHistorySource({ kind: 'audio-files', files: [original] }).files[0]; child.remove();
        return new TextDecoder().decode(await held.arrayBuffer());
      }), 'retained bytes', 'retained file remains readable after its originating frame is destroyed');
      assert.ok(await page.locator('#versionNext').isDisabled(), 'latest is the default and the chronological end');
      await page.locator('#versionPicker').click();
      assert.equal(await page.locator('#versionList button').count(), manifest.entries.length, 'every catalog entry is selectable');
      await page.locator('#versionSearch').fill('circular');
      assert.ok(await page.locator('#versionList button').count() >= 2, 'search includes circular experiments and restoration');
      await page.locator('#versionSearch').fill('no-such-version-at-all');
      assert.equal(await page.locator('#versionList button').count(), 0);
      await page.locator('#versionSearch').fill('');
      const oldest = manifest.entries[0];
      await page.locator(`[data-version-id="${oldest.id}"]`).click();
      const app = page.frameLocator('#versionEngine');
      await app.locator('#demoBtn').waitFor();
      await page.waitForFunction(() => !!document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE);
      assert.ok(await page.locator('#versionPrevious').isDisabled(), 'earliest is the chronological start');
      assert.ok(new URL(page.url()).searchParams.get('version') === oldest.id);
      await app.locator('#demoBtn').click();
      await page.waitForFunction(currentEngineReady);
      const colors = await app.locator('#stage').evaluate(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, unique = new Set();
        for (let i = 0; i < pixels.length; i += 128) unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        return unique.size;
      });
      assert.ok(colors > 10, 'original earliest renderer draws a composed frame');
      // Clear the retained demo with a page reload, then check representative
      // middle and late snapshots without asking them to bypass original menus.
      const middle = manifest.entries.find(e => e.sourcePr === 200) || manifest.entries[Math.floor(manifest.entries.length / 2)];
      await page.goto(`${origin}${prefix}?version=${middle.id}&rangeRenderer=legacy`);
      await page.frameLocator('#versionEngine').locator('#fileInput').waitFor({ state: 'attached' });
      await page.waitForFunction(() => !!document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE);
      const late = manifest.entries.find(e => e.sourcePr === 400);
      await page.locator('#versionPicker').click(); await page.locator(`[data-version-id="${late.id}"]`).click();
      await page.frameLocator('#versionEngine').locator('#fileInput').waitFor({ state: 'attached' });
      await page.waitForFunction(() => { const f = document.getElementById('versionEngine'); return f.contentWindow.location.href === f.dataset.versionUrl && !!f.contentWindow.__MIDIO_HISTORY_ENGINE; });
      await page.goBack();
      await page.waitForFunction(id => { const f = document.getElementById('versionEngine'); return f.contentWindow.location.href === f.dataset.versionUrl && f.contentWindow.location.pathname.includes(id) && !!f.contentWindow.__MIDIO_HISTORY_ENGINE; }, middle.id);
      await page.locator('#versionPicker').click(); await page.locator('#versionLatest').click();
      await page.waitForFunction(() => { const f = document.getElementById('versionEngine'); return f.contentWindow.location.href === f.dataset.versionUrl && (f.contentWindow.__MIDIO_VERSION_ADAPTER?.getState().phase === 'title' || !!f.contentWindow.__MIDIO_HISTORY_ENGINE); });
      await page.frameLocator('#versionEngine').locator('#titleSettings').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('version'), null);
      // Real source handoff between the latest engine and its preceding visual
      // revision. Audio generation, loading, seek and HUD clocks remain real.
      const wav = path.join(out, 'fixture.wav'); execFileSync(process.execPath, ['tools/gen-test-wav.mjs', wav, '120', '60']);
      const current = page.frameLocator('#versionEngine');
      await current.locator('#titleSettings').evaluate(node => { node.open = true; });
      const lyrics = current.locator('#lyricGroundingBtn'); if (await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
      await current.locator('#fileInput').setInputFiles(wav);
      console.log(`CHECK ${prefix}: uploaded real source into latest engine`);
      await page.waitForFunction(currentEngineReady, null, { timeout: 90000 });
      await page.evaluate(async () => { const w = document.getElementById('versionEngine').contentWindow, a = w.__MIDIO_VERSION_ADAPTER || w.__MIDIO_HISTORY_ENGINE; await a.setPaused(true); await a.seek(10000); a.wakeHud(); });
      await page.locator('#versionPrevious').click();
      console.log(`CHECK ${prefix}: restoring source into preceding visual revision`);
      await page.waitForFunction(currentEngineReady, null, { timeout: 90000 });
      await page.waitForFunction(() => { const s = document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE.getState(); return s.paused && Math.abs(s.positionMs - 10000) < 1000; }, null, { timeout: 30000 });
      await page.waitForFunction(() => !document.getElementById('versionStatus').textContent);
      assert.equal(await page.evaluate(() => document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE.getState().sourceName), 'fixture.wav', 'raw song file decoded by the historical engine');
      const adapterState = await page.evaluate(() => document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE.getState());
      assert.ok(adapterState.paused, 'paused intent survives a switch');
      // Use an actual playback HUD transition; parent controls mirror its
      // state and are removed from hit-testing and keyboard navigation.
      await current.locator('#pauseBtn').click();
      await page.waitForFunction(() => !document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE.getState().paused);
      await page.waitForFunction(() => document.getElementById('versionEngine').contentDocument.getElementById('hudRight').classList.contains('hud-faded'), null, { timeout: 20000 });
      await page.waitForFunction(() => document.getElementById('versionNavigation').inert);
      assert.equal(await page.locator('#versionPrevious').getAttribute('tabindex'), '-1');
      await current.locator('#stage').click({ position: { x: 300, y: 200 } });
      await page.waitForFunction(() => !document.getElementById('versionNavigation').inert);
      await page.evaluate(() => document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE.setPaused(true));
      await page.locator('#versionNext').click();
      await page.waitForFunction(currentEngineReady, null, { timeout: 90000 });
      assert.ok(await page.locator('#versionNext').isDisabled());
      if (prefix === '/') {
        // Fullscreen must retain the picker, and a version choice from that
        // fullscreen tree must return its controls to the surviving host.
        await page.evaluate(() => (document.getElementById('versionEngine').contentWindow.__MIDIO_VERSION_ADAPTER || document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE).wakeHud());
        await current.locator('#fullscreenBtn').click();
        await page.waitForFunction(() => !!document.getElementById('versionEngine').contentDocument.fullscreenElement);
        const fullscreen = current.locator('#historyFullscreenOverlay');
        await fullscreen.locator('#versionPicker').click();
        // Search by a plain-letter word from the target's own label, so the
        // check holds whatever the newest commits are called.
        const target = manifest.entries.at(-2);
        const word = target.label.toLowerCase().match(/[a-z]+/g).sort((a, b) => b.length - a.length)[0];
        await fullscreen.locator('#versionSearch').pressSequentially(word);
        assert.equal(await fullscreen.locator('#versionSearch').inputValue(), word, 'fullscreen search owns its letter keys');
        await fullscreen.locator(`[data-version-id="${target.id}"]`).click();
        await page.waitForFunction(() => !document.fullscreenElement && !!document.getElementById('versionNavigation'));
        await page.waitForFunction(currentEngineReady, null, { timeout: 90000 });
        await page.locator('#versionNext').click();
        await page.waitForFunction(currentEngineReady, null, { timeout: 90000 });
        // Cancel an actual old-engine load after it has created audio but
        // before it owns a simulation. The retained host File must survive.
        await page.evaluate(() => (document.getElementById('versionEngine').contentWindow.__MIDIO_VERSION_ADAPTER || document.getElementById('versionEngine').contentWindow.__MIDIO_HISTORY_ENGINE).wakeHud());
        await page.locator('#versionPrevious').click();
        await page.waitForFunction(() => {
          const f = document.getElementById('versionEngine'), s = f.contentWindow.__MIDIO_HISTORY_ENGINE?.getState();
          return f.contentWindow.location.pathname === new URL(f.dataset.versionUrl).pathname && s?.audioState && !s.ready;
        });
        await page.locator('#versionNext').click();
        await page.waitForFunction(currentEngineReady, null, { timeout: 90000 });
        assert.equal(await page.locator('iframe').count(), 1, 'one engine survives an interrupted restore');
        assert.equal(await page.evaluate(() => (() => { const w = document.getElementById('versionEngine').contentWindow; return w.__MIDIO_VERSION_ADAPTER?.getState().source.files[0].name || w.__MIDIO_HISTORY_ENGINE.getState().sourceName; })()), 'fixture.wav');
        console.log('PASS fullscreen selection and interrupted source restore');
      }
      assert.deepEqual(errors, [], 'no engine, module or picker page errors');
      await page.screenshot({ path: path.join(out, prefix === '/' ? 'root.png' : 'project.png') });
      console.log(`PASS ${prefix}: full menu, search, latest default, early/middle/late engines, deep links, browser history, song handoff and HUD fade`);
    } catch (error) {
      await page.screenshot({ path: path.join(out, 'failure.png') });
      console.error(await page.evaluate(() => { const f = document.getElementById('versionEngine'); return { expected: f.dataset.versionUrl, actual: f.contentWindow.location.href, state: f.contentWindow.__MIDIO_VERSION_ADAPTER?.getState() || f.contentWindow.__MIDIO_HISTORY_ENGINE?.getState(), status: document.getElementById('versionStatus')?.textContent, progress: f.contentDocument.getElementById('progressText')?.textContent, error: f.contentDocument.querySelector('.errorBanner')?.textContent }; }));
      throw error;
    } finally {
      await context.tracing.stop({ path: path.join(out, prefix === '/' ? 'root-trace.zip' : 'project-trace.zip') }); await context.close();
    }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
