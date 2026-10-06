import { validateVersionManifest } from './VersionCatalog.js';
import { createVersionHandoffStore } from './VersionHandoff.js';
import { mountVersionNavigation, compatibleVersionSettings } from './VersionNavigation.js';

/** The same bootstrap runs in live and in narrowly adapted historical pages. */
export function bootstrapVersionNavigation({ document, fetch: suppliedFetch, createStore = createVersionHandoffStore }) {
  const view = document.defaultView;
  const fetch = suppliedFetch || view.fetch.bind(view);
  let disposed = false, active = null, fallback = null, store = null, fetching = false;
  const metadata = JSON.parse(document.getElementById('midio-version-metadata')?.textContent || '{}');
  const validId = id => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '');
  if (!validId(metadata.currentId) || !validId(metadata.liveId) || !['./', '../../'].includes(metadata.siteRootRelative)) throw new Error('Invalid trusted version metadata.');
  const siteRoot = new URL(metadata.siteRootRelative, document.baseURI);
  if (siteRoot.origin !== new URL(document.baseURI).origin) throw new Error('Version root must share the application origin.');
  document.documentElement?.classList.add('version-browser-enabled');
  let resolveAdapter;
  const adapterReady = new Promise(resolve => { resolveAdapter = resolve; });
  const registered = event => { const adapter = event.detail || view.__MIDIO_VERSION_ADAPTER; if (adapter) resolveAdapter(adapter); };
  view.addEventListener('midio-version-adapter', registered);
  if (view.__MIDIO_VERSION_ADAPTER) resolveAdapter(view.__MIDIO_VERSION_ADAPTER);
  const getStore = () => store || (store = createStore({ indexedDB: view.indexedDB, sessionStorage: view.sessionStorage, locks: view.navigator?.locks, lifecycle: view }));
  const destinationCheck = async url => {
    const response = await fetch(url.href, { cache: 'no-store', redirect: 'error' });
    if (!response.ok || (response.url && new URL(response.url).pathname !== url.pathname) || !(response.headers.get('content-type') || '').includes('text/html')) throw new Error('This version is unavailable.');
  };
  function showUnavailable(error) {
    if (disposed) return;
    if (!fallback) {
      const root = document.createElement('nav'); root.className = 'version-navigation'; root.setAttribute('data-version-navigation', ''); root.setAttribute('aria-label', 'Browse Midio versions'); root.setAttribute('data-state', 'error');
      const add = (tag, id, text, cls, parent = root) => { const el = document.createElement(tag); el.id = id; el.textContent = text; el.className = cls; if (tag === 'button') el.type = 'button'; parent.append(el); return el; };
      const prev = add('button', 'versionPrevious', '←', 'version-arrow version-previous'); prev.disabled = true; prev.setAttribute('aria-label', 'Previous version unavailable');
      const next = add('button', 'versionNext', '→', 'version-arrow version-next'); next.disabled = true; next.setAttribute('aria-label', 'Next version unavailable');
      add('span', 'versionLabel', 'Version browser unavailable', 'version-label');
      const status = add('span', 'versionStatus', '', 'version-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const actions = add('span', 'versionActions', '', 'version-actions');
      const retry = add('button', 'versionRetry', 'Retry', 'version-action', actions);
      const live = add('button', 'versionReturnLive', 'Return to live', 'version-action', actions);
      retry.addEventListener('click', () => { if (!fetching) start(); });
      live.addEventListener('click', async () => {
        if (fetching) return;
        fetching = true; retry.disabled = true; live.disabled = true;
        let adapter, initial, pausedHere = false;
        try {
          await destinationCheck(siteRoot);
          adapter = await adapterReady; if (disposed) return;
          initial = adapter.getState(); const transport = getStore();
          const pending = await transport.readPending(metadata.currentId);
          let handoff;
          if (pending) handoff = await transport.prepareSwitch({ ...pending, phase: 'ready', blockedReason: null, fromId: metadata.currentId, toId: metadata.liveId, replaceSwitchId: pending.switchId, settings: compatibleVersionSettings(pending.settings) });
          else if (initial.phase === 'ready' && initial.source && !initial.blockedReason) {
            const sourceId = await transport.saveSource(initial);
            if (adapter.getState().sourceId !== initial.sourceId || adapter.getState().phase !== 'ready') throw new Error('The song changed while preparing the switch.');
            await adapter.pause(); pausedHere = true;
            const final = adapter.getState();
            if (final.sourceId !== initial.sourceId || final.phase !== 'ready' || final.blockedReason) throw new Error('The song changed while preparing the switch.');
            handoff = await transport.prepareSwitch({ ...final, fromId: metadata.currentId, toId: metadata.liveId, sourceId, paused: initial.paused, settings: compatibleVersionSettings(final.settings) });
          } else if (initial.phase !== 'title' || initial.source) throw new Error(initial.blockedReason || 'Wait for the current song operation to finish.');
          const url = new URL(siteRoot); if (handoff) url.searchParams.set('versionSwitch', handoff.switchId);
          await transport.release(); if (!disposed) view.location.assign(url.href);
        } catch (error) {
          if (pausedHere && adapter.getState().sourceId === initial.sourceId && adapter.getState().phase === 'ready') { try { await adapter.setPaused(initial.paused); } catch { /* The error remains retryable. */ } }
          showUnavailable(error);
        } finally { fetching = false; if (!disposed && fallback) { retry.disabled = false; live.disabled = false; } }
      });
      (document.getElementById('app') || document.body).append(root); fallback = { root, status, retry, live };
    }
    fallback.status.textContent = `${error?.message || 'Version archives are unavailable in this build.'} Retry or return to live.`;
    fallback.retry.disabled = false; fallback.live.disabled = false;
  }
  async function start() {
    if (disposed || fetching) return;
    fetching = true; if (fallback) { fallback.retry.disabled = true; fallback.live.disabled = true; }
    try {
      const response = await fetch(new URL('versions/manifest.json', siteRoot).href, { cache: 'no-cache', redirect: 'error' });
      if (!response.ok) throw new Error('Version archives are unavailable in this build.');
      const manifest = validateVersionManifest(await response.json());
      if (manifest.liveId !== metadata.liveId) throw new Error('Version metadata does not match the manifest.');
      const adapter = await adapterReady; if (disposed) return;
      fallback?.root.remove(); fallback = null; active?.dispose();
      active = mountVersionNavigation({ document, manifest, currentId: metadata.currentId, siteRoot, adapter, handoffStore: getStore(), preflight: destinationCheck });
      await active.ready;
    } catch (error) { showUnavailable(error); }
    finally { fetching = false; }
  }
  const ready = start();
  return { ready, dispose() { disposed = true; view.removeEventListener('midio-version-adapter', registered); active?.dispose(); fallback?.root.remove(); store?.dispose().catch(() => {}); } };
}

if (typeof document !== 'undefined') bootstrapVersionNavigation({ document });
