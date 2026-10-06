// Tests the emitted archive, never the development server. One Chromium and
// context per prefix, used sequentially. No autoplay-policy override.
// node tools/version-browser-smoke.mjs --site _site --output .smoke/version-browser
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CHECKPOINTS, LIVE_ID, MAX_SITE_BYTES } from './version-checkpoints.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function boundedResponseBody(response) {
  let timer;
  try {
    return await Promise.race([
      response.body(),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`Response body timed out: ${response.url()}`)), 15000); }),
    ]);
  } finally { clearTimeout(timer); }
}
function args(argv) {
  const result = { site: '_site', output: '.smoke/version-browser', 'timeout-ms': '180000' };
  let checksOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--checks-only') { checksOnly = true; continue; }
    const name = argv[i].slice(2), value = argv[i + 1];
    if (!argv[i].startsWith('--') || !Object.hasOwn(result, name) || !value) throw new Error(`Invalid option: ${argv[i]}`);
    result[name] = value; i++;
  }
  result.checksOnly = checksOnly;
  result.site = path.resolve(root, result.site); result.output = path.resolve(root, result.output);
  result.timeout = Number(result['timeout-ms']);
  assert.ok(result.timeout >= 10000 && result.timeout <= 600000, 'timeout must be 10000–600000ms');
  assert.ok(result.output !== result.site && !result.output.startsWith(`${result.site}${path.sep}`), 'evidence must be outside the served artifact');
  return result;
}

async function walk(directory, relative = '') {
  const result = [];
  for (const item of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, item.name);
    assert.ok(!item.isSymbolicLink(), `artifact contains symlink ${name}`);
    if (item.isDirectory()) result.push(...await walk(directory, name));
    else { assert.ok(item.isFile(), `artifact contains non-file ${name}`); result.push(name); }
  }
  return result;
}

async function auditArtifact(site) {
  const manifest = JSON.parse(await fs.readFile(path.join(site, 'versions/manifest.json'), 'utf8'));
  const build = JSON.parse(await fs.readFile(path.join(site, 'versions/build-report.json'), 'utf8'));
  assert.equal(manifest.schema, 1); assert.equal(build.schema, 1);
  assert.equal(manifest.liveId, LIVE_ID); assert.equal(build.liveId, LIVE_ID);
  assert.equal(build.buildSha, manifest.buildSha);
  assert.deepEqual(manifest.entries.map(e => [e.id, e.sourceSha]), CHECKPOINTS.map(e => [e.id, e.sourceSha]));
  assert.deepEqual(build.entries.map(e => [e.id, e.sourceSha]), CHECKPOINTS.map(e => [e.id, e.sourceSha]));
  assert.equal(build.budgetBytes, MAX_SITE_BYTES);
  const files = await walk(site), outputHashes = new Map(); let bytes = 0;
  for (const file of files) {
    const body = await fs.readFile(path.join(site, file)); bytes += body.length;
    outputHashes.set(file, hash(body));
    assert.ok(!/(^|\/)(node_modules|\.git|tools|test|docs|data)(\/|$)/.test(file), `private runtime content: ${file}`);
  }
  assert.ok(bytes <= MAX_SITE_BYTES, `artifact ${bytes} bytes exceeds budget`);
  assert.equal(bytes, build.totalBytes, 'build report must count every emitted byte, including itself');
  const identity = [];
  for (const entry of build.entries) {
    const declared = manifest.entries.find(e => e.id === entry.id);
    assert.equal(entry.entryPath, declared.entryPath);
    assert.ok(entry.files.length > 0 && entry.runtime.checked, `${entry.id}: staging runtime verification missing`);
    for (const file of entry.files) {
      const emitted = path.posix.join(entry.entryPath, file.path).replace(/^\.\//, '');
      assert.equal(outputHashes.get(emitted), file.outputHash, `${emitted}: output hash drift`);
      assert.equal((await fs.stat(path.join(site, emitted))).size, file.bytes, `${emitted}: byte count drift`);
      const changed = entry.transformations.filter(t => t.path === file.path);
      if (!changed.length && file.sourceHash) assert.equal(file.sourceHash, file.outputHash, `${emitted}: undocumented adaptation`);
      if (changed.length) {
        assert.equal(changed[0].sourceHash, file.sourceHash, `${emitted}: transformation source mismatch`);
        assert.equal(changed.at(-1).outputHash, file.outputHash, `${emitted}: transformation output mismatch`);
        for (const t of changed) assert.ok(t.count > 0 && t.name, `${emitted}: incomplete transformation ledger`);
      }
    }
    // Independently compare renderer bytes to the pinned Git object. The
    // main/session adapter may change; the renderer must not.
    for (const file of ['src/world/alpine/RangeScene.js', 'src/world/alpine/RangePresentation.js', ...(CHECKPOINTS.indexOf(CHECKPOINTS.find(c => c.id === entry.id)) >= 3 ? ['src/world/alpine/JourneyScene.js'] : [])]) {
      const row = entry.files.find(f => f.path === file);
      assert.ok(row, `${entry.id}: absent ${file}`);
      const original = execFileSync('git', ['show', `${entry.sourceSha}:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
      assert.equal(hash(original), row.sourceHash, `${entry.id}: pinned source hash ${file}`);
      assert.equal(row.sourceHash, row.outputHash, `${entry.id}: renderer was adapted`);
    }
    identity.push({ id: entry.id, sourceSha: entry.sourceSha, files: entry.files.length, transformations: entry.transformations.length, runtime: entry.runtime });
  }
  return { manifest, build, bytes, identity, outputHashes };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav' };
async function serve(site, prefix) {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      let relative = pathname.slice(prefix.length);
      if (relative === 'soundfonts/' || relative.endsWith('/soundfonts/')) {
        // Existing soundfont discovery expects a directory listing. There
        // are no user-installed fonts in this deterministic pilot.
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('[]'); return;
      }
      if (relative.endsWith('/') || !relative) relative += 'index.html';
      const file = path.resolve(site, relative);
      if (!file.startsWith(`${site}${path.sep}`)) { response.writeHead(403).end(); return; }
      const stat = await fs.stat(file);
      if (!stat.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
      if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}${prefix}` };
}

// Observe exact restore completion and the instant before resume. This is
// instrumentation around the production adapter, not a substitute loader.
function installProbe() {
  const probe = window.__VERSION_SMOKE = { restores: [], resumes: [], audioStarts: [], contexts: [], workerUrls: [], captureSources: [], failures: [], failRestore: false, failQuota: false };
  const snapshot = adapter => {
    const { source, ...state } = adapter.getState();
    return { ...state, sourceKind: source?.kind, files: source?.files?.map(f => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified })) || [] };
  };
  let adapter;
  Object.defineProperty(window, '__MIDIO_VERSION_ADAPTER', { configurable: true, get: () => adapter, set(value) {
    adapter = value;
    const load = value.loadSource.bind(value), paused = value.setPaused.bind(value);
    value.loadSource = async (source, intent) => {
      if (probe.failRestore) { probe.failRestore = false; throw new Error('Injected interrupted restore'); }
      const record = { intent: { ...intent }, beforeStarts: probe.audioStarts.length };
      probe.restores.push(record);
      try { const result = await load(source, intent); record.settled = snapshot(value); record.settledAudioContexts = probe.contexts.map(context => context.state); record.starts = probe.audioStarts.slice(record.beforeStarts); return result; }
      catch (error) { record.error = error.message; throw error; }
    };
    value.setPaused = async state => { probe.resumes.push({ requestedPaused: state, state: snapshot(value) }); return paused(state); };
  } });
  const OriginalContext = window.AudioContext;
  if (OriginalContext) {
    window.AudioContext = class extends OriginalContext {
      constructor(...a) { super(...a); probe.contexts.push(this); }
    };
  }
  const originalStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    const context = this.context, OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offline = !!OfflineContext && context instanceof OfflineContext;
    probe.audioStarts.push({ when: a[0] || 0, offset: a[1] || 0, atMs: performance.now(),
      contextKind: offline ? 'OfflineAudioContext' : (OriginalContext && context instanceof OriginalContext ? 'AudioContext' : context.constructor.name), offline, contextState: context.state,
      sampleRate: context.sampleRate, bufferDuration: this.buffer?.duration ?? null, bufferChannels: this.buffer?.numberOfChannels ?? null });
    return originalStart.apply(this, a);
  };
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker { constructor(url, options) { probe.workerUrls.push(new URL(url, location.href).href); super(url, options); } };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...a) {
    if (probe.failQuota && this.name === 'records' && a[0]?.source) throw new DOMException('Injected audio quota error', 'QuotaExceededError');
    return put.apply(this, a);
  };
  const capturedCanvases = new WeakMap();
  const captureStream = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function (...a) {
    const frames = capturedCanvases.get(this) || [];
    capturedCanvases.set(this, frames);
    probe.captureSources.push({ id: this.id, detached: !this.isConnected, width: this.width, height: this.height, frames });
    return captureStream.apply(this, a);
  };
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (source, ...a) {
    const frames = capturedCanvases.get(this.canvas);
    if (frames) frames.push({ sourceId: source?.id || '', sourceTag: source?.tagName || source?.constructor?.name,
      sourceIsStage: source === document.getElementById('stage'), sourceIsCanvas: source instanceof HTMLCanvasElement,
      width: source?.width, height: source?.height, atMs: performance.now() });
    return drawImage.call(this, source, ...a);
  };
}

async function state(page) {
  return page.evaluate(async () => {
    const a = window.__MIDIO_VERSION_ADAPTER, s = a.getState(), files = [];
    for (const f of s.source?.files || []) {
      const digest = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      files.push({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified, hash: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') });
    }
    const { source, ...rest } = s;
    return { ...rest, sourceKind: source?.kind, files };
  });
}

async function waitReady(page, timeout, allowNavigationError = false) {
  const deadline = Date.now() + timeout; let gestures = 0;
  for (;;) {
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, `Version restore did not settle at ${page.url()}`);
    // Watch both readiness and gesture failures throughout the asynchronous
    // load. Audio activation can fail after the initial adapter-ready signal.
    const handle = await page.waitForFunction(allowError => {
      const nav = document.querySelector('[data-version-navigation]');
      const retry = document.getElementById('versionRetry');
      const status = document.getElementById('versionStatus')?.textContent;
      if (retry && !retry.hidden && /Resume/i.test(retry.textContent)) return { kind: 'resume', status };
      if (!allowError && retry && !retry.hidden && /Retry/i.test(retry.textContent)) throw new Error(status || 'Version restore failed.');
      if (window.__MIDIO_VERSION_ADAPTER?.getState().phase === 'ready'
        && (!nav || nav.getAttribute('data-state') === 'idle' || (allowError && nav.getAttribute('data-state') === 'error'))) return { kind: 'ready' };
      return false;
    }, allowNavigationError, { timeout: remaining });
    const signal = await handle.jsonValue(); await handle.dispose();
    if (signal.kind === 'ready') return;
    assert.ok(gestures < 3, `${signal.status || 'Audio remains blocked after Resume.'} ${page.url()}`);
    console.log(`Version-browser smoke: real Resume gesture ${++gestures} at ${page.url()}`);
    await page.locator('#versionRetry').click();
    // Let the click's restore operation publish its new phase before polling
    // again; every attempt remains a genuine user gesture.
    await page.waitForTimeout(100);
  }
}

async function importAudio(page, files, timeout, allowNavigationError = false) {
  const details = page.locator('#titleSettings');
  if (await details.count()) await details.evaluate(el => { el.open = true; });
  const lyrics = page.locator('#lyricGroundingBtn');
  if (await lyrics.count() && await lyrics.getAttribute('aria-pressed') === 'true') await lyrics.click();
  // A genuine user gesture precedes the file input. No autoplay bypass.
  await page.locator('body').click({ position: { x: 5, y: 150 } });
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForFunction(() => window.__MIDIO_VERSION_ADAPTER?.getState().phase === 'ready'
    || (document.querySelector('#worldSelect') && !document.querySelector('#worldSelect').classList.contains('hidden')), null, { timeout });
  const chooser = page.locator('#worldSelect');
  if (await chooser.isVisible()) {
    const range = page.locator('.worldCard[data-base-world-id="alpine"], .worldCard[data-world-id="alpine"]');
    assert.ok(await range.count(), 'Range card must be present; do not replace historical rendering with a different world');
    await range.first().click();
  }
  await waitReady(page, timeout, allowNavigationError);
  const loaded = await state(page);
  assert.equal(loaded.sourceKind, 'audio-files'); assert.equal(loaded.files.length, files.length);
  return loaded;
}

async function capture(page, output, name) {
  const result = await page.evaluate(() => {
    const app = window.__SMW, mgr = app?.sim?.biomes, presentation = mgr?.rangePresentation;
    const canvas = document.querySelector('#stage'), probe = document.createElement('canvas');
    probe.width = 160; probe.height = 90;
    const ctx = probe.getContext('2d'); ctx.drawImage(canvas, 0, 0, 160, 90);
    const pixels = ctx.getImageData(0, 0, 160, 90).data, colors = new Set(); let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) { colors.add(`${pixels[i] >> 3},${pixels[i + 1] >> 3},${pixels[i + 2] >> 3}`); if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 24) lit++; }
    return { pixels: { colors: colors.size, litFraction: lit / (160 * 90), image: probe.toDataURL() },
      worldKind: mgr?.world?.kind, sceneClass: presentation?.scene?.constructor.name, range: app?.rangeState,
      generation: app?.generation, audioContexts: window.__VERSION_SMOKE.contexts.map(c => c.state),
      hasAudioBuffer: !!app?.audioEngine?.sourceNode?.buffer, frames: app?.sim?.timeMs,
      workers: window.__VERSION_SMOKE.workerUrls, canvasCount: document.querySelectorAll('#stage').length };
  });
  result.pixelHash = hash(result.pixels.image); delete result.pixels.image;
  // Persist the actual fallback/blank frame too. Failed assertions must not
  // erase the runtime reason or scene state that explains their failure.
  await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  return result;
}

async function wake(page) {
  // Wake through the same real input lifecycle as the viewer. Calling only
  // wakeHud leaves Car mode's 20s idle gate armed, which correctly absorbs
  // the next button tap even though its HUD was programmatically revealed.
  const stage = page.locator('#stage'), bounds = await stage.boundingBox();
  assert.ok(bounds, 'stage must be present for a real wake tap');
  await stage.click({ position: { x: bounds.width / 2, y: bounds.height / 3 } });
}
async function focusVisibleNavigation(locator) {
  await locator.evaluate(button => {
    const nav = button.closest('[data-version-navigation]');
    if (!button.getClientRects().length || getComputedStyle(button).visibility === 'hidden' || nav?.inert || button.disabled) throw new Error('Navigation control must be visible and enabled before focus.');
    button.focus();
    if (document.activeElement !== button) throw new Error('Visible navigation control did not receive native focus.');
  });
}
async function clickHudButton(page, selector) {
  await wake(page);
  const available = page.locator('[data-version-navigation] .version-arrow:not(:disabled)');
  if (await available.count()) await focusVisibleNavigation(available.first());
  // The real target click moves focus normally. Active recording/calibration
  // holds the existing HUD when all navigation controls are disabled.
  await page.locator(selector).click();
}
async function switchVersion(page, direction, expected, timeout) {
  console.log(`Version-browser smoke: ${direction} to ${expected.id}`);
  await wake(page);
  const selector = direction === 'previous' ? '#versionPrevious' : '#versionNext';
  await focusVisibleNavigation(page.locator(selector));
  await page.evaluate(selector => {
    const nav = document.querySelector('[data-version-navigation]'), button = document.querySelector(selector), adapter = window.__MIDIO_VERSION_ADAPTER?.getState();
    const attempt = { url: location.href, selector, atMs: performance.now(), idleMs: performance.now() - (window.__SMW?.carMode?.lastInputMs || 0),
      navigation: { state: nav?.getAttribute('data-state'), inert: nav?.inert, className: nav?.className, hudClass: document.getElementById('hudRight')?.className, disabled: button?.disabled, focused: document.activeElement === button },
      adapter: { phase: adapter?.phase, sourceId: adapter?.sourceId, positionMs: adapter?.positionMs, paused: adapter?.paused, blockedReason: adapter?.blockedReason } };
    window.__VERSION_SMOKE.lastSwitchClick = attempt;
    sessionStorage.setItem('midio:smoke-last-switch-click', JSON.stringify(attempt));
  }, selector);
  await page.locator(selector).click();
  await page.waitForFunction(id => {
    const text = document.getElementById('midio-version-metadata')?.textContent;
    if (text && JSON.parse(text).currentId === id) return true;
    if (document.querySelector('[data-version-navigation]')?.getAttribute('data-state') === 'error') throw new Error(document.getElementById('versionStatus')?.textContent || 'Version navigation failed before departure.');
    return false;
  }, expected.id, { timeout });
  await waitReady(page, timeout);
}

async function verifyRestore(page, before, report) {
  const evidence = await page.evaluate(() => ({ restores: window.__VERSION_SMOKE.restores, resumes: window.__VERSION_SMOKE.resumes }));
  const restored = evidence.restores.findLast(r => r.settled);
  assert.ok(restored, 'destination must restore through the normal adapter load path');
  assert.equal(restored.settled.paused, true, 'loadSource must settle while transport is held paused');
  assert.ok(Math.abs(restored.settled.positionMs - restored.intent.positionMs) <= 100, 'restore tolerance measured before resume');
  assert.equal(restored.settled.seed, before.seed); assert.equal(restored.settled.sourceId, before.sourceId);
  assert.equal(restored.intent.paused, before.paused);
  const realtimeStarts = restored.starts.filter(start => start.offline === false);
  assert.ok(realtimeStarts.length > 0, 'restoration must prepare the actual real-time soundtrack source');
  assert.ok(realtimeStarts.every(start => Math.abs(start.offset * 1000 - restored.settled.positionMs) <= 100), 'real-time restoration emitted audio outside the saved song position');
  assert.ok(realtimeStarts.every(start => start.contextState === 'suspended'), 'real-time soundtrack started before audio was held suspended');
  assert.ok(restored.settledAudioContexts?.length && restored.settledAudioContexts.every(state => state === 'suspended'), 'audio must remain suspended at restore readiness before resume');
  const final = await state(page);
  assert.deepEqual(final.files, before.files, 'original ordered files and metadata survive handoff');
  assert.equal(final.paused, before.paused, 'saved pause state survives handoff');
  report.push({ intent: restored.intent, heldPositionMs: restored.settled.positionMs, beforeResume: evidence.resumes.at(-1), initialAudioStarts: restored.starts,
    realtimeStarts, offlineStarts: restored.starts.filter(start => start.offline), heldAudioContexts: restored.settledAudioContexts });
}

async function readRecords(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('midio-version-handoff-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction('records'), store = tx.objectStore('records'), keys = store.getAllKeys(), values = store.getAll();
      tx.oncomplete = () => resolve(keys.result.map((key, i) => ({ key, value: { ...values.result[i], source: values.result[i].source ? { kind: values.result[i].source.kind, files: values.result[i].source.files?.map(f => ({ name: f.name, type: f.type, size: f.size, lastModified: f.lastModified, isFile: f instanceof File })) } : undefined } })));
      tx.onerror = () => reject(tx.error);
    }); db.close(); return result;
  });
}

async function configureRunningDisplay(page, report) {
  // The all-checkpoint desktop scene captures keep their default
  // resolution. Running software-GL checks use the app's actual controls to
  // reduce frame pressure while keeping native Range/Journey rendering.
  await wake(page); await page.locator('#displaySettingsBtn').click();
  await page.locator('#displaySettingsDialog[open]').waitFor({ state: 'visible' });
  await page.locator('#stageRes').selectOption('360');
  await page.locator('#stageFps').selectOption('30');
  await page.locator('#displaySettingsClose').click();
  const configured = await state(page);
  assert.equal(configured.settings.stageRes, '360'); assert.equal(configured.settings.stageFps, '30');
  report.compatibilityDisplay = { selectedThrough: 'Display settings UI', stageRes: '360', stageFps: '30',
    appliesTo: 'running restore, mobile, recording and export phases', reason: 'Bounded native scene rendering on Chromium software GL',
    renderer: await page.evaluate(() => ({ mode: window.__SMW?.rangeState?.mode, sceneClass: window.__SMW?.sim?.biomes?.rangePresentation?.scene?.constructor.name })) };
  assert.equal(report.compatibilityDisplay.renderer.mode, 'v2');
  console.log('Version-browser smoke: actual Display controls selected native 360p / 30fps for running phases');
}

async function mobileChecks(page, output, report) {
  const initialPaused = (await state(page)).paused;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await wake(page);
  const readLayout = () => page.evaluate(() => {
    const ids = ['versionPrevious', 'versionNext', 'pauseBtn', 'recordBtn', 'fullscreenBtn', 'btLatencyBtn', 'displaySettingsBtn', 'calibrateBtn'];
    const bounds = el => {
      if (!el?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
      const r = el.getBoundingClientRect();
      return { id: el.id || el.className, x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const label = document.querySelector('.version-label');
    return {
      currentId: JSON.parse(document.getElementById('midio-version-metadata').textContent).currentId,
      label: { text: label?.textContent.trim() || '', bounds: bounds(label) },
      landscapeHint: bounds(document.getElementById('landscapeHint')),
      controls: ids.map(id => bounds(document.getElementById(id))).filter(Boolean),
    };
  });
  const separated = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const assertLabel = layout => {
    const checkpoint = CHECKPOINTS.find(entry => entry.id === layout.currentId);
    assert.ok(checkpoint, 'mobile label belongs to a catalog checkpoint');
    assert.equal(layout.label.text, `${checkpoint.label}${checkpoint.id === LIVE_ID ? ' · Live' : ''}`, 'mobile label identifies the current checkpoint');
    const label = layout.label.bounds;
    assert.ok(label && label.width > 0 && label.height > 0 && label.x >= 0 && label.x + label.width <= 390, 'mobile checkpoint label is visible inside the viewport');
    if (layout.landscapeHint) assert.ok(separated(label, layout.landscapeHint), 'mobile checkpoint label overlaps visible landscape hint');
    for (const control of layout.controls) assert.ok(separated(label, control), `mobile checkpoint label overlaps ${control.id}`);
  };
  const layout = await readLayout(), geometry = layout.controls;
  // Persist real bounds before assertions so a failed portrait layout is
  // reviewable even when the rest of the mobile lifecycle cannot continue.
  report.mobile = { geometry, layout, reducedMotion: true, timeoutMeasuredDuring: 'running playback' };
  assertLabel(layout);
  for (const b of geometry.filter(b => b.id.startsWith('version'))) {
    assert.ok(b.width >= 52 && b.height >= 52 && b.x >= 0 && b.x + b.width <= 390, `${b.id}: mobile touch target`);
    for (const other of geometry.filter(o => !o.id.startsWith('version'))) assert.ok(b.x + b.width <= other.x || other.x + other.width <= b.x || b.y + b.height <= other.y || other.y + other.height <= b.y, `${b.id} overlaps ${other.id}`);
  }
  await focusVisibleNavigation(page.locator('#versionPrevious'));
  await page.evaluate(() => window.__MIDIO_VERSION_ADAPTER.setPaused(false));
  await page.waitForTimeout(3300);
  assert.ok(await page.locator('#versionPrevious').isVisible(), 'focused arrow holds HUD visible');
  assert.equal(await page.locator('#versionPrevious').evaluate(el => getComputedStyle(el).opacity), '1');
  await page.locator('#versionPrevious').evaluate(el => el.blur());
  await page.waitForFunction(() => document.querySelector('#hudRight')?.classList.contains('hud-faded'), null, { timeout: 15000 });
  const hidden = await page.locator('#versionPrevious').evaluate(el => ({ tab: el.tabIndex, inert: !!el.closest('[inert]'), pointer: getComputedStyle(el).pointerEvents }));
  assert.ok(hidden.inert || hidden.tab < 0, 'faded arrows removed from keyboard activation');
  const oldUrl = page.url(), rect = geometry.find(g => g.id === 'versionPrevious');
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.waitForTimeout(250); assert.equal(page.url(), oldUrl, 'first tap on faded arrow location only wakes HUD');
  await wake(page);
  report.mobile.hidden = hidden; report.mobile.portraitLayout = await readLayout();
  await page.screenshot({ path: path.join(output, 'portrait.png') });
  assertLabel(report.mobile.portraitLayout);
  await page.evaluate(paused => window.__MIDIO_VERSION_ADAPTER.setPaused(paused), initialPaused);
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function runPrefix(options, audit, prefix, wavs) {
  const hosted = await serve(options.site, prefix), output = path.join(options.output, prefix === '/' ? 'root' : 'project-subpath');
  await fs.mkdir(output, { recursive: true });
  const report = { prefix, passed: false, traversalSkipped: options.checksOnly, traversal: [], restores: [], checks: [], errors: [], identityFallbacks: [], limitations: options.checksOnly ? ['Diagnostic checks-only mode skips catalog traversal and cannot establish full eight-checkpoint browser proof.'] : [] };
  let browser, context;
  const expectedHttpFailures = new Set();
  const addPage = async () => {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => report.errors.push({ type: 'pageerror', url: page.url(), text: e.message }));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) report.errors.push({ type: 'console', url: page.url(), text: message.text() }); });
    page.on('response', response => {
      if (response.url().startsWith(hosted.url) && response.status() >= 400 && !expectedHttpFailures.has(new URL(response.url()).pathname)) report.errors.push({ type: 'resource', url: response.url(), status: response.status() });
    });
    page.on('requestfailed', request => {
      if (request.url().startsWith(hosted.url) && !/ERR_ABORTED/.test(request.failure()?.errorText || '')) report.errors.push({ type: 'requestfailed', url: request.url(), text: request.failure()?.errorText });
    });
    return page;
  };
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
    await context.addInitScript(installProbe);
    await context.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await addPage(), loaded = new Map(), pending = [];
    // CDP uses the browser's own screencast, avoiding Playwright's optional
    // downloaded ffmpeg binary. System ffmpeg encodes these actual frames.
    const screencastDir = path.join(output, 'screencast'); await fs.mkdir(screencastDir, { recursive: true });
    const cdp = await context.newCDPSession(page), frameWrites = []; let frameCount = 0, lastFrameAt = 0;
    cdp.on('Page.screencastFrame', event => {
      cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      if (Date.now() - lastFrameAt < 2000 || frameCount >= 600) return;
      lastFrameAt = Date.now();
      frameWrites.push(fs.writeFile(path.join(screencastDir, `${String(frameCount++).padStart(5, '0')}.jpg`), Buffer.from(event.data, 'base64')));
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 960, maxHeight: 540, everyNthFrame: 1 });
    page.on('response', response => {
      const url = new URL(response.url()); if (!url.href.startsWith(hosted.url) || response.status() !== 200 || !/\.(js|json|bin|wasm|png|jpg|webp|tif)$/.test(url.pathname)) return;
      const file = decodeURIComponent(url.pathname.slice(prefix.length));
      pending.push(boundedResponseBody(response).catch(async error => {
        const fallback = { file, url: response.url(), reason: error.message }; report.identityFallbacks.push(fallback);
        const r = await fetch(fallback.url, { signal: AbortSignal.timeout(15000) }); assert.ok(r.ok);
        const bytes = Buffer.from(await r.arrayBuffer()); fallback.digest = hash(bytes); return bytes;
      }).then(bytes => { assert.equal(hash(bytes), audit.outputHashes.get(file), `served runtime bytes differ: ${file}`); loaded.set(file, hash(bytes)); }).catch(error => report.errors.push({ type: 'identity', file, text: error.message })));
    });
    await page.goto(hosted.url); await page.locator('#versionPrevious').waitFor();
    const desktop = await page.locator('#versionPrevious').boundingBox(); assert.ok(desktop.width >= 64 && desktop.height >= 64, 'desktop arrow target');
    let song = await importAudio(page, [wavs[0]], options.timeout);
    // Adapter readiness establishes audio/source ownership. The normal live
    // draw loop must also finish asynchronous Range preparation before we
    // pause it; paused playback does not advance that initial render work.
    try {
      await page.waitForFunction(() => window.__SMW?.rangeState?.active === true, null, { timeout: options.timeout });
    } catch (error) {
      report.initialRenderFailure = await capture(page, output, 'initial-render-not-ready');
      throw error;
    }
    await page.evaluate(async () => { await window.__MIDIO_VERSION_ADAPTER.setPaused(true); await window.__MIDIO_VERSION_ADAPTER.seek(6200); });
    song = await state(page); assert.ok(song.positionMs > 5000, 'pilot position is nonzero');
    const liveIndex = audit.manifest.entries.findIndex(e => e.id === LIVE_ID);
    let index = liveIndex;
    const captureCheckpoint = async direction => {
      const entry = audit.manifest.entries[index];
      await page.evaluate(() => window.__SMW?.rangeReady?.({ timeoutMs: 120000 }));
      await page.waitForTimeout(250);
      const frame = await capture(page, output, `${String(report.traversal.length).padStart(2, '0')}-${direction}-${entry.id}`);
      report.traversal.push({ id: entry.id, direction, sourceSha: entry.sourceSha, frame });
      assert.ok(frame.pixels.colors > 16 && frame.pixels.litFraction > 0.02, `${entry.id}: blank scene`);
      assert.equal(frame.canvasCount, 1, `${entry.id}: multiple active application canvases`);
      assert.ok(frame.audioContexts.filter(s => s !== 'closed').length <= 1, `${entry.id}: multiple audio engines`);
      const expectedScene = index < 3 ? 'RangeScene' : 'JourneyScene';
      assert.equal(frame.worldKind, 'alpine', `${entry.id}: wrong world`);
      assert.equal(frame.sceneClass, expectedScene, `${entry.id}: expected actual historical ${expectedScene}`);
      assert.equal(frame.range.active, true, `${entry.id}: range renderer fell back`);
      assert.equal(frame.range.scene?.contextLost, false, `${entry.id}: WebGL context lost`);
      const meta = await page.locator('#midio-version-metadata').textContent();
      assert.equal(JSON.parse(meta).currentId, entry.id);
      assert.ok(frame.workers.every(url => url.startsWith(new URL(entry.entryPath, hosted.url).href)), `${entry.id}: workers escaped selected build`);
      console.log(`Version-browser smoke: captured ${entry.id} (${frame.sceneClass}, active=${frame.range.active}, colors=${frame.pixels.colors})`);
    };
    if (!options.checksOnly) {
      await captureCheckpoint('initial');
      // First reach oldest, then cover every scene forward and backward.
      for (const [direction, end] of [['previous', 0], ['next', 7], ['previous', 0]]) {
        while (index !== end) {
          const before = await state(page); index += direction === 'next' ? 1 : -1;
          await switchVersion(page, direction, audit.manifest.entries[index], options.timeout);
          await verifyRestore(page, before, report.restores); await captureCheckpoint(direction);
        }
        await wake(page); assert.equal(await page.locator(direction === 'next' ? '#versionNext' : '#versionPrevious').isDisabled(), true, 'endpoint does not wrap');
      }
      const pictures = ['natural-valley', 'circular-world', 'spherical-world'].map(id => report.traversal.find(e => e.id === id).frame.pixelHash);
      assert.equal(new Set(pictures).size, 3, 'live and rejected circular experiments must produce different rendered frames');
      await wake(page); await page.locator('#versionReturnLive').click();
      await page.waitForURL(hosted.url + '*', { timeout: options.timeout }); await waitReady(page, options.timeout);
    }
    await configureRunningDisplay(page, report);
    const beforeRun = await state(page);
    await clickHudButton(page, '#pauseBtn');
    await page.waitForFunction(p => window.__MIDIO_VERSION_ADAPTER.getState().positionMs > p + 250, beforeRun.positionMs);
    song = await state(page); assert.equal(song.paused, false);
    await switchVersion(page, 'next', audit.manifest.entries[liveIndex + 1], options.timeout);
    await verifyRestore(page, song, report.restores); report.checks.push('running restore before resumed clock');
    console.log('Version-browser smoke: running restore passed; checking reload and history');
    const restoredDisplay = (await state(page)).settings;
    assert.equal(restoredDisplay.stageRes, '360'); assert.equal(restoredDisplay.stageFps, '30');
    await page.evaluate(() => window.__MIDIO_VERSION_ADAPTER.setPaused(true));
    song = await state(page); await page.reload(); await waitReady(page, options.timeout); await verifyRestore(page, song, report.restores);
    await page.goBack(); await waitReady(page, options.timeout);
    assert.equal((await state(page)).sourceId, song.sourceId);
    await page.goForward(); await waitReady(page, options.timeout);
    assert.equal((await state(page)).sourceId, song.sourceId); report.checks.push('reload and browser history preserve current source');
    console.log('Version-browser smoke: reload/history passed; checking mobile HUD lifecycle');
    await mobileChecks(page, output, report);
    console.log('Version-browser smoke: mobile HUD passed; checking real calibration and recording');
    // The real calibration/recording UI must block departure. Recording is
    // saved so the evidence includes the actual output, not just a flag.
    await page.evaluate(() => window.__MIDIO_VERSION_ADAPTER.setPaused(false));
    await clickHudButton(page, '#calibrateBtn');
    await page.waitForFunction(() => /calibr/i.test(window.__MIDIO_VERSION_ADAPTER.getState().blockedReason || '')
      && document.getElementById('versionPrevious').disabled && document.getElementById('versionNext').disabled);
    assert.equal(await page.locator('#versionPrevious').isDisabled(), true); assert.equal(await page.locator('#versionNext').isDisabled(), true);
    await clickHudButton(page, '#calibrateBtn');
    await page.waitForFunction(() => !window.__MIDIO_VERSION_ADAPTER.getState().blockedReason
      && !document.getElementById('versionPrevious').disabled && !document.getElementById('versionNext').disabled);
    await clickHudButton(page, '#recordBtn');
    await page.waitForFunction(() => /record/i.test(window.__MIDIO_VERSION_ADAPTER.getState().blockedReason || '')
      && document.getElementById('versionPrevious').disabled && document.getElementById('versionNext').disabled);
    assert.equal(await page.locator('#versionPrevious').isDisabled(), true); assert.equal(await page.locator('#versionNext').isDisabled(), true);
    await page.waitForFunction(() => document.getElementById('recordBtn')?.title === 'Stop recording and save the video', null, { timeout: options.timeout });
    await page.waitForTimeout(1800);
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 }); await clickHudButton(page, '#recordBtn');
    const download = await downloadPromise; await download.saveAs(path.join(output, `recording-${path.basename(download.suggestedFilename())}`));
    const captures = await page.evaluate(() => window.__VERSION_SMOKE.captureSources);
    assert.ok(captures.length && captures.every(c => c.detached && c.frames.length > 0 && c.frames.every(f => f.sourceIsStage && f.sourceIsCanvas)), 'recorder captures detached compositor frames drawn only from stage pixels; DOM version chrome stays outside output');
    report.recordingCaptureSources = captures;
    await page.waitForFunction(() => !window.__MIDIO_VERSION_ADAPTER.getState().blockedReason);
    await page.evaluate(() => window.__MIDIO_VERSION_ADAPTER.setPaused(true)); report.checks.push('real recording and calibration block arrows; saved canvas recording excludes DOM chrome');
    console.log('Version-browser smoke: calibration and saved recording passed');

    // Reach Complete through the real transport, then start the application's
    // full-song export UI. Its existing HUD stop button ends the actual export
    // early and saves a sample, bounding this check without mutating recorder
    // state or waiting for all thirty seconds of this pilot.
    console.log('Version-browser smoke: actual full-song export start/stop');
    await page.evaluate(async () => {
      const adapter = window.__MIDIO_VERSION_ADAPTER;
      await adapter.seek(Math.max(0, adapter.getState().durationMs - 1000)); await adapter.setPaused(false);
    });
    await page.locator('#completePanel:not(.hidden)').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#exportPreset').selectOption('car');
    await page.locator('#exportBtn').click();
    await page.waitForFunction(() => /record|export/i.test(window.__MIDIO_VERSION_ADAPTER.getState().blockedReason || '')
      && document.getElementById('versionPrevious').disabled && document.getElementById('versionNext').disabled, null, { timeout: options.timeout });
    assert.equal(await page.locator('#versionPrevious').isDisabled(), true); assert.equal(await page.locator('#versionNext').isDisabled(), true);
    await page.waitForFunction(() => document.getElementById('recordBtn')?.title === 'Stop recording and save the video', null, { timeout: options.timeout });
    const exporting = await state(page);
    assert.ok(exporting.positionMs < 10000, 'full-song export restarted actual playback near the beginning');
    await page.waitForTimeout(1200);
    const exportDownloadPromise = page.waitForEvent('download', { timeout: 30000 }); await clickHudButton(page, '#recordBtn');
    const exportDownload = await exportDownloadPromise;
    await exportDownload.saveAs(path.join(output, `full-song-export-stopped${path.extname(exportDownload.suggestedFilename())}`));
    const exportCaptures = await page.evaluate(() => window.__VERSION_SMOKE.captureSources);
    assert.ok(exportCaptures.length > captures.length && exportCaptures.every(c => c.detached && c.frames.length > 0 && c.frames.every(f => f.sourceIsStage && f.sourceIsCanvas)), 'actual export compositor draws only stage pixels and excludes DOM version controls');
    await page.waitForFunction(() => !window.__MIDIO_VERSION_ADAPTER.getState().blockedReason);
    await page.evaluate(async () => { await window.__MIDIO_VERSION_ADAPTER.setPaused(true); await window.__MIDIO_VERSION_ADAPTER.seek(6200); });
    report.export = { startedThrough: 'exportBtn', stoppedThrough: 'recordBtn', blockedReason: exporting.blockedReason, sampleFile: `full-song-export-stopped${path.extname(exportDownload.suggestedFilename())}`, captureSources: exportCaptures.slice(captures.length) };
    report.checks.push('actual full-song export blocks both arrows and excludes DOM chrome; real stop UI saves bounded sample');
    console.log('Version-browser smoke: actual export start/stop passed; checking missing destination retry');

    // Failure before departure must preserve both current song and pause.
    await wake(page); const beforeFailure = await state(page), beforeUrl = page.url();
    const destination = new URL(audit.manifest.entries[liveIndex].entryPath, hosted.url).href;
    expectedHttpFailures.add(new URL(destination).pathname);
    await page.route(destination, route => route.fulfill({ status: 503, body: 'Injected missing destination' }));
    await page.locator('#versionPrevious').click(); await page.locator('#versionRetry').waitFor({ state: 'visible' });
    assert.equal(page.url(), beforeUrl); assert.equal((await state(page)).sourceId, beforeFailure.sourceId);
    await page.unroute(destination); await page.locator('#versionRetry').click();
    await page.waitForURL(hosted.url + '*', { timeout: options.timeout }); await waitReady(page, options.timeout);
    report.checks.push('missing destination stays recoverable and retries');
    expectedHttpFailures.delete(new URL(destination).pathname);
    console.log('Version-browser smoke: missing destination recovery passed; checking replacement/stems/quota');

    // Source replacement and ordered raw stems use the genuine loader.
    const replaced = await importAudio(page, [wavs[1], wavs[2]], options.timeout);
    assert.notEqual(replaced.sourceId, song.sourceId);
    assert.deepEqual(replaced.files.map(f => f.name), wavs.slice(1).map(f => path.basename(f)));
    await page.evaluate(async () => { await window.__MIDIO_VERSION_ADAPTER.setPaused(true); await window.__MIDIO_VERSION_ADAPTER.seek(5400); window.__VERSION_SMOKE.failQuota = true; });
    const beforeQuota = await state(page);
    const originalUrl = page.url(); await wake(page); await page.locator('#versionNext').click();
    await page.locator('#versionRetry').waitFor({ state: 'visible' }); assert.equal(page.url(), originalUrl);
    assert.equal((await state(page)).sourceId, replaced.sourceId);
    await page.evaluate(() => { window.__VERSION_SMOKE.failQuota = false; }); await page.locator('#versionRetry').click();
    await page.waitForURL(new URL('versions/circular-world/', hosted.url).href + '*', { timeout: options.timeout }); await waitReady(page, options.timeout);
    await verifyRestore(page, beforeQuota, report.restores);
    const rows = await readRecords(page);
    const sourceRows = rows.filter(r => r.key.endsWith(':source'));
    assert.equal(sourceRows.length, 1); assert.equal(sourceRows[0].value.source.files.length, 2);
    assert.ok(sourceRows[0].value.source.files.every(f => f.isFile), 'real IndexedDB retains File metadata');
    report.indexedDB = rows; report.checks.push('ordered stems, replacement, real IndexedDB and quota recovery');
    console.log('Version-browser smoke: replacement/stems/quota passed; checking interrupted restore');

    const beforeInterrupted = await state(page);
    await page.addInitScript(() => { if (location.pathname.includes('/spherical-world/')) window.__VERSION_SMOKE.failRestore = true; });
    await wake(page); await page.locator('#versionNext').click();
    await page.waitForURL(new URL('versions/spherical-world/', hosted.url).href + '*', { timeout: options.timeout });
    await page.locator('#versionRetry').waitFor({ state: 'visible' });
    assert.ok((await readRecords(page)).some(r => r.key.endsWith(':pending') && r.value.sourceId === beforeInterrupted.sourceId), 'failed restore retains recoverable pending source');
    await page.locator('#versionRetry').click(); await waitReady(page, options.timeout);
    await verifyRestore(page, beforeInterrupted, report.restores); report.checks.push('interrupted restore retains raw source and retries');

    await wake(page);
    const beforeRapid = await state(page);
    await page.locator('#versionPrevious').evaluate(button => { button.click(); button.click(); });
    await page.waitForURL(new URL('versions/circular-world/', hosted.url).href + '*', { timeout: options.timeout }); await waitReady(page, options.timeout);
    await verifyRestore(page, beforeRapid, report.restores);
    assert.equal(await page.evaluate(() => window.__VERSION_SMOKE.restores.filter(r => r.settled).length), 1, 'rapid activation creates one successful restore');
    report.checks.push('rapid clicks prepare one switch');
    console.log('Version-browser smoke: interrupted restore and rapid activation passed; checking tab ownership');

    // window.open copies sessionStorage, exercising actual duplicate-tab
    // ownership while the original owner remains alive.
    const oldTab = await page.evaluate(() => sessionStorage.getItem('midio:version-tab'));
    const popupPromise = context.waitForEvent('page');
    await page.evaluate(url => window.open(url, '_blank'), hosted.url);
    const duplicate = await popupPromise; await duplicate.waitForLoadState();
    await duplicate.waitForFunction(old => sessionStorage.getItem('midio:version-tab') && sessionStorage.getItem('midio:version-tab') !== old, oldTab, { timeout: 15000 });
    assert.equal(await duplicate.evaluate(() => window.__MIDIO_VERSION_ADAPTER.getState().phase), 'title');
    await duplicate.close(); report.checks.push('copied-sessionStorage duplicate rotates and cannot take source');

    // Hold a real matching pending IDB record while its owner is alive, then
    // copy sessionStorage through window.open. This targets the ownership
    // race independently of analysis/loading time.
    const pendingCopy = await page.evaluate(async () => {
      const tabId = sessionStorage.getItem('midio:version-tab'), s = window.__MIDIO_VERSION_ADAPTER.getState();
      const handoff = { schema: 1, tabId, switchId: crypto.randomUUID(), fromId: 'circular-world', toId: 'spherical-world', sourceId: s.sourceId, createdAtMs: Date.now(), positionMs: s.positionMs, paused: s.paused, seed: s.seed, worldId: s.worldId, rangeViewId: s.rangeViewId, settings: s.settings };
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('midio-version-handoff-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise((resolve, reject) => { const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(handoff, `${tabId}:pending`); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close(); return handoff;
    });
    const pendingPopupPromise = context.waitForEvent('page');
    await page.evaluate(url => window.open(url, '_blank'), new URL(`versions/spherical-world/?versionSwitch=${pendingCopy.switchId}`, hosted.url).href);
    const pendingDuplicate = await pendingPopupPromise; await pendingDuplicate.waitForLoadState();
    await pendingDuplicate.waitForFunction(old => sessionStorage.getItem('midio:version-tab') && sessionStorage.getItem('midio:version-tab') !== old, oldTab, { timeout: 15000 });
    assert.equal(await pendingDuplicate.evaluate(() => window.__MIDIO_VERSION_ADAPTER.getState().phase), 'title');
    assert.ok((await readRecords(page)).some(r => r.key === `${oldTab}:pending` && r.value.switchId === pendingCopy.switchId), 'duplicate cannot consume the original pending transaction');
    await pendingDuplicate.close();
    await page.evaluate(async token => {
      const db = await new Promise(resolve => { const r = indexedDB.open('midio-version-handoff-v1', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise((resolve, reject) => { const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').delete(`${token}:pending`); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
    }, oldTab);
    report.checks.push('duplicate with copied token cannot consume an owned pending switch');

    const direct = await addPage(); await direct.goto(new URL('versions/moonlit-cove/', hosted.url).href);
    await direct.locator('#versionReturnLive').waitFor();
    assert.equal(await direct.evaluate(() => window.__MIDIO_VERSION_ADAPTER.getState().phase), 'title', 'independent direct archive never takes another tab song');
    await direct.locator('#versionReturnLive').click(); await direct.waitForURL(hosted.url);
    await direct.close(); report.checks.push('independent tab, direct archive and return to live');

    const independent = await addPage(); await independent.goto(hosted.url);
    const independentSong = await importAudio(independent, [wavs[1]], options.timeout);
    assert.notEqual(independentSong.sourceId, beforeRapid.sourceId);
    await independent.evaluate(async () => { await window.__MIDIO_VERSION_ADAPTER.setPaused(true); await window.__MIDIO_VERSION_ADAPTER.seek(4800); });
    const independentBefore = await state(independent);
    await switchVersion(independent, 'next', audit.manifest.entries[liveIndex + 1], options.timeout);
    await verifyRestore(independent, independentBefore, report.restores);
    assert.equal((await state(page)).sourceId, beforeRapid.sourceId, 'other tab cannot take over original source');
    await independent.close(); report.checks.push('two independently loaded tabs retain different sources through navigation');
    console.log('Version-browser smoke: tab ownership passed; checking storage and manifest denial');

    const denied = await addPage();
    await denied.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, ...a) => { if (name === 'midio-version-handoff-v1') throw new DOMException('Injected storage denial', 'SecurityError'); return open(name, ...a); };
    });
    await denied.goto(hosted.url); const deniedSong = await importAudio(denied, [wavs[0]], options.timeout, true);
    await denied.evaluate(() => window.__MIDIO_VERSION_ADAPTER.setPaused(true)); await wake(denied);
    const deniedUrl = denied.url(); await denied.locator('#versionNext').click();
    await denied.locator('#versionRetry').waitFor({ state: 'visible' });
    assert.equal(denied.url(), deniedUrl); assert.equal((await state(denied)).sourceId, deniedSong.sourceId);
    await denied.close(); report.checks.push('IndexedDB open denial keeps loaded audio on the source page');

    const missing = await addPage();
    expectedHttpFailures.add(new URL('versions/manifest.json', hosted.url).pathname);
    await missing.route('**/versions/manifest.json', route => route.fulfill({ status: 404, body: 'Injected missing manifest' }));
    await missing.goto(hosted.url);
    await missing.locator('#fileInput').waitFor({ state: 'attached' });
    const chooser = missing.waitForEvent('filechooser'); await missing.getByText('Browse files', { exact: true }).click(); await chooser;
    assert.equal(await missing.evaluate(() => window.__MIDIO_VERSION_ADAPTER.getState().phase), 'title');
    await missing.close(); report.checks.push('missing manifest preserves ordinary file picker');
    expectedHttpFailures.delete(new URL('versions/manifest.json', hosted.url).pathname);
    await Promise.all(pending); assert.ok(loaded.size > 30, 'served historical modules/assets actually loaded');
    report.loadedFiles = [...loaded].map(([file, digest]) => ({ file, hash: digest }));
    assert.deepEqual(report.errors, [], 'unexpected runtime, console or shader errors');
    await cdp.send('Page.stopScreencast'); await Promise.all(frameWrites);
    assert.ok(frameCount >= 2, 'actual click-through screencast captured');
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-framerate', '2', '-i', path.join(screencastDir, '%05d.jpg'), '-vf', 'scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(output, 'click-through.mp4')], { timeout: 60000, stdio: 'pipe' });
    report.video = { path: 'click-through.mp4', frames: frameCount, samplingMs: 2000, playbackFps: 2, speed: 4 };
    report.limitations.push('Chromium only; no real iOS audio policy, physical safe-area device or deployment duration measured.',
      'The full-song export check starts the real export and stops it early through the HUD; it does not verify a complete exported pilot file. Pending duplication uses a matching injected IDB record while the original owner remains alive.',
      'Audio source-start offsets and one AudioContext are observed; acoustic output and process-wide audio exclusivity require a real device check.');
    report.passed = true;
  } catch (error) {
    report.failure = { message: error.message, stack: error.stack };
    report.failurePages = [];
    for (const [index, page] of (context?.pages() || []).entries()) {
      if (page.isClosed()) continue;
      const diagnostic = { url: page.url() }; report.failurePages.push(diagnostic);
      let diagnosticTimeout;
      try {
        diagnostic.state = await Promise.race([
          page.evaluate(() => {
            const adapter = window.__MIDIO_VERSION_ADAPTER;
            const state = adapter?.getState(), source = state?.source;
            const { source: omitted, ...safeState } = state || {};
            void omitted;
            const nav = document.querySelector('[data-version-navigation]'), metadata = document.getElementById('midio-version-metadata')?.textContent;
            return { adapter: { ...safeState, sourceKind: source?.kind, files: source?.files?.map(file => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified })) || [] },
              navigation: { state: nav?.getAttribute('data-state'), status: document.getElementById('versionStatus')?.textContent, retry: document.getElementById('versionRetry')?.textContent },
              metadata: metadata ? JSON.parse(metadata) : null, range: window.__SMW?.rangeState,
              sceneClass: window.__SMW?.sim?.biomes?.rangePresentation?.scene?.constructor.name,
              probe: { restores: window.__VERSION_SMOKE?.restores, resumes: window.__VERSION_SMOKE?.resumes,
                lastSwitchClick: window.__VERSION_SMOKE?.lastSwitchClick || JSON.parse(sessionStorage.getItem('midio:smoke-last-switch-click') || 'null') } };
          }),
          new Promise((resolve, reject) => { diagnosticTimeout = setTimeout(() => reject(new Error('Diagnostic evaluation timed out')), 5000); }),
        ]);
      } catch (diagnosticError) { diagnostic.error = diagnosticError.message; }
      finally { clearTimeout(diagnosticTimeout); }
      try { await page.screenshot({ path: path.join(output, `failure-page-${index}.png`), timeout: 5000 }); diagnostic.screenshot = `failure-page-${index}.png`; }
      catch (screenshotError) { diagnostic.screenshotError = screenshotError.message; }
    }
    throw error;
  }
  finally {
    await context?.tracing.stop({ path: path.join(output, 'trace.zip') }).catch(() => {});
    await context?.close(); await browser?.close();
    hosted.server.closeAllConnections();
    await new Promise(resolve => hosted.server.close(resolve));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  return report;
}

const options = args(process.argv.slice(2));
await fs.mkdir(options.output, { recursive: true });
const report = { schema: 1, startedAt: new Date().toISOString(), passed: false, traversalSkipped: options.checksOnly, prefixes: [] };
try {
  const audit = await auditArtifact(options.site);
  report.artifact = { buildSha: audit.build.buildSha, bytes: audit.bytes, budgetBytes: MAX_SITE_BYTES, checkpoints: audit.identity };
  const wavs = ['pilot.wav', '01-drum-stem.wav', '02-melody-stem.wav'].map(file => path.join(options.output, file));
  for (let i = 0; i < wavs.length; i++) execFileSync(process.execPath, [path.join(root, 'tools/gen-test-wav.mjs'), wavs[i], String(120 + i * 6), i === 0 ? '90' : '30']);
  for (const prefix of ['/', '/Midio-5/']) {
    console.log(`Version-browser smoke: ${prefix}`);
    const result = await runPrefix(options, audit, prefix, wavs);
    report.prefixes.push({ prefix, passed: result.passed, traversals: result.traversal.length, checks: result.checks, limitations: result.limitations });
  }
  report.passed = true;
  console.log(`Version-browser ${options.checksOnly ? 'diagnostic checks passed; full catalog traversal skipped' : 'smoke passed both prefixes'}; report: ${path.join(options.output, 'report.json')}`);
} catch (error) { report.failure = { message: error.message, stack: error.stack }; console.error(error.stack); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(options.output, 'report.json'), JSON.stringify(report, null, 2)); }
