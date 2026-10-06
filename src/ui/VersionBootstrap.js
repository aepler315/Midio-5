import { validateVersionManifest } from './VersionCatalog.js';
import { createVersionHandoffStore } from './VersionHandoff.js';
import { mountVersionNavigation, compatibleVersionSettings } from './VersionNavigation.js';

/** The same bootstrap runs in live and in narrowly adapted historical pages. */
export function bootstrapVersionNavigation({ document, fetch: suppliedFetch, createStore = createVersionHandoffStore }) {
  const view = document.defaultView;
  const fetch = suppliedFetch || view.fetch.bind(view);
  let disposed = false, active = null, fallback = null, store = null, fetching = false;
  let adapter = null, unsubscribe = null, lastState = null, fallbackEpoch = 0, fallbackError = '', invalidation = Promise.resolve();
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
  function syncFallback() {
    if (!fallback || disposed) return;
    let state;
    try { state = adapter?.getState(); } catch { /* Adapter boot failures keep Retry available. */ }
    fallback.retry.disabled = fetching;
    fallback.live.disabled = fetching || !state || !!state.blockedReason || state.phase === 'loading';
    fallback.status.textContent = `${state?.blockedReason || fallbackError} Retry or return to live.`;
  }
  adapterReady.then(value => {
    if (disposed) return;
    adapter = value; lastState = adapter.getState();
    unsubscribe = adapter.subscribe(() => {
      const state = adapter.getState();
      const replacement = state.generation !== lastState.generation || (state.phase === 'loading' && lastState.phase !== 'loading') || (state.phase === 'title' && !!lastState.sourceId);
      lastState = state;
      if (fallback && !active && replacement) {
        fallbackEpoch++;
        invalidation = Promise.resolve().then(() => getStore().discardSource()).catch(error => showUnavailable(error));
      }
      syncFallback();
    });
    syncFallback();
  }).catch(error => showUnavailable(error));
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
        syncFallback();
        if (fetching || live.disabled) return;
        const epoch = ++fallbackEpoch;
        fetching = true; retry.disabled = true; live.disabled = true;
        let initial, pausedHere = false;
        try {
          initial = adapter.getState();
          const guard = () => {
            const state = adapter.getState();
            if (disposed || epoch !== fallbackEpoch || state.generation !== initial.generation || state.sourceId !== initial.sourceId || state.phase !== initial.phase) throw new Error('The song changed while preparing the switch.');
            if (state.blockedReason || state.phase === 'loading') throw new Error(state.blockedReason || 'Wait for the song to finish loading.');
            return state;
          };
          guard(); await destinationCheck(siteRoot); guard();
          await invalidation; guard();
          const transport = getStore();
          let pending = await transport.readPending(metadata.currentId); guard();
          // A pending restore is only recovery for the source it describes.
          // An already selected ready source takes precedence over stale data.
          if (pending && initial.sourceId && pending.sourceId !== initial.sourceId) { await transport.discardSource(); guard(); pending = null; }
          let handoff;
          if (pending) {
            let carry = pending;
            if (initial.phase === 'ready' && initial.sourceId === pending.sourceId) { await adapter.pause(); pausedHere = true; carry = { ...pending, ...guard(), paused: initial.paused }; }
            handoff = await transport.prepareSwitch({ ...carry, phase: 'ready', blockedReason: null, fromId: metadata.currentId, toId: metadata.liveId, replaceSwitchId: pending.switchId, settings: compatibleVersionSettings(carry.settings) }); guard();
          } else if (initial.phase === 'ready' && initial.source) {
            const sourceId = await transport.saveSource(initial); guard();
            await adapter.pause(); pausedHere = true; const final = guard();
            handoff = await transport.prepareSwitch({ ...final, fromId: metadata.currentId, toId: metadata.liveId, sourceId, paused: initial.paused, settings: compatibleVersionSettings(final.settings) }); guard();
          } else if (initial.phase !== 'title' || initial.source) throw new Error(initial.blockedReason || 'Wait for the current song operation to finish.');
          const url = new URL(siteRoot); if (handoff) url.searchParams.set('versionSwitch', handoff.switchId);
          await transport.release(); guard(); view.location.assign(url.href);
        } catch (error) {
          if (pausedHere && adapter.getState().generation === initial.generation && adapter.getState().sourceId === initial.sourceId && adapter.getState().phase === 'ready') { try { await adapter.setPaused(initial.paused); } catch { /* The error remains retryable. */ } }
          showUnavailable(error);
        } finally { fetching = false; syncFallback(); }
      });
      (document.getElementById('app') || document.body).append(root); fallback = { root, status, retry, live };
    }
    fallbackError = error?.message || 'Version archives are unavailable in this build.';
    syncFallback();
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
    finally { fetching = false; syncFallback(); }
  }
  const ready = start();
  return { ready, dispose() { disposed = true; unsubscribe?.(); view.removeEventListener('midio-version-adapter', registered); active?.dispose(); fallback?.root.remove(); store?.dispose().catch(() => {}); } };
}

if (typeof document !== 'undefined') bootstrapVersionNavigation({ document });
