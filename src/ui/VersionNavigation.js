import { validateVersionManifest, getVersionNeighbors, resolveVersionUrl } from './VersionCatalog.js';

// Transport flags, debug/export query parameters and analysis objects are never
// passed to another engine. Adapters apply only preferences they support.
const SETTINGS = ['reducedFlash', 'reducedMotion', 'stageRes', 'stageFps'];
export const compatibleVersionSettings = settings => Object.fromEntries(SETTINGS.filter(key => typeof settings?.[key] === 'boolean' || typeof settings?.[key] === 'number' || typeof settings?.[key] === 'string').map(key => [key, settings[key]]));
const blocked = state => state.blockedReason || (state.phase === 'loading' ? 'Wait for the song to finish loading.' : state.phase === 'error' ? 'Load a song successfully before switching.' : null);
const supported = source => source?.kind === 'demo' || (source?.kind === 'audio-files' && source.files?.length > 0);

/** Mount one DOM-only navigator; playback/export rendering stays in the app. */
export function mountVersionNavigation({ document, manifest: value, currentId, siteRoot, adapter, handoffStore, navigate, preflight }) {
  const manifest = validateVersionManifest(value);
  const entry = manifest.entries.find(e => e.id === currentId);
  const neighbors = getVersionNeighbors(manifest, currentId);
  let lastObserved = adapter.getState();
  const view = document.defaultView;
  const root = document.createElement('nav');
  root.className = 'version-navigation';
  root.setAttribute('data-version-navigation', '');
  root.setAttribute('aria-label', 'Browse Midio versions');
  function button(id, text, className, parent = root) {
    const el = document.createElement('button'); el.id = id; el.type = 'button'; el.textContent = text; el.className = className;
    parent.append(el); return el;
  }
  const previous = button('versionPrevious', '←', 'version-arrow version-previous');
  const next = button('versionNext', '→', 'version-arrow version-next');
  const label = document.createElement('span'); label.className = 'version-label';
  label.textContent = `${entry.label}${entry.live ? ' · Live' : ''}`;
  label.title = `PR #${entry.sourcePr} · ${entry.sourceSha}`;
  root.append(label);
  const status = document.createElement('span'); status.id = 'versionStatus'; status.className = 'version-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true'); root.append(status);
  const actions = document.createElement('span'); actions.className = 'version-actions'; root.append(actions);
  const retry = button('versionRetry', 'Retry', 'version-action version-retry', actions);
  const returnLive = button('versionReturnLive', 'Return to live', 'version-action version-return', actions);

  let phase = 'idle', disposed = false, errorMessage = '', retryOperation = null, gestureRequired = false;
  let restoreHandoff = null, restoreSource = null, booting = false, bootChecked = false;
  let restoreResumed = false, restoreLoaded = false, completedKey = null, invalidation = Promise.resolve();
  let unsubscribe = null, observer = null, pruned = false;
  const controls = [previous, next, retry, returnLive];
  const listeners = [];
  const on = (node, type, fn) => { node?.addEventListener(type, fn); listeners.push(() => node?.removeEventListener(type, fn)); };
  const busy = () => ['preparing', 'restoring', 'leaving'].includes(phase);
  function sync() {
    if (disposed) return;
    const state = adapter.getState();
    const title = state.phase === 'title' || (state.phase === 'loading' && !state.source);
    // Failures remain actionable even if the app's HUD is still hidden during
    // its loader. Successful playback shares the app's existing fade timer.
    const hidden = phase !== 'error' && !title && !!document.getElementById('hudRight')?.classList.contains('hud-faded');
    root.inert = hidden; root.setAttribute('aria-hidden', String(hidden));
    root.classList.toggle('version-faded', hidden); root.classList.toggle('version-title', title);
    root.setAttribute('data-state', phase);
    for (const control of controls) control.tabIndex = hidden ? -1 : 0;
    const reason = restoreHandoff && phase === 'error' ? null : blocked(state);
    previous.disabled = !neighbors.previous || busy() || !!reason;
    next.disabled = !neighbors.next || busy() || !!reason;
    previous.setAttribute('aria-label', neighbors.previous ? `Previous version: ${neighbors.previous.label}` : 'No earlier version');
    next.setAttribute('aria-label', neighbors.next ? `Next version: ${neighbors.next.label}` : 'No later version');
    previous.title = reason || previous.getAttribute('aria-label'); next.title = reason || next.getAttribute('aria-label');
    retry.hidden = phase !== 'error'; retry.disabled = busy(); retry.textContent = gestureRequired ? 'Resume' : 'Retry';
    returnLive.hidden = entry.live && phase !== 'error'; returnLive.disabled = busy() || (!!reason && phase !== 'error');
    if (phase === 'error') status.textContent = errorMessage;
    else if (phase === 'idle') status.textContent = reason || (state.source?.kind === 'demo' ? 'Built-in demos can differ between versions.' : '');
  }
  function failure(error, operation) {
    if (disposed) return;
    phase = 'error'; gestureRequired = error?.code === 'AUDIO_GESTURE_REQUIRED' || error?.name === 'NotAllowedError';
    errorMessage = gestureRequired ? 'Audio needs a tap. Resume to restore your song.' : `${error?.message || 'Version switch failed.'} Retry or return to live.`;
    retryOperation = operation; adapter.wakeHud(); sync();
  }
  function activate(operation) {
    if (disposed || busy()) return;
    // Even a stale/programmatic click delivered before the MutationObserver
    // runs must spend a hidden first activation on waking the HUD.
    sync();
    if (root.inert) { adapter.wakeHud(); return; }
    operation();
  }
  const checkDestination = preflight || (async url => {
    const response = await view.fetch(url.href, { method: 'GET', cache: 'no-store', redirect: 'error' });
    if (!response.ok || (response.url && new URL(response.url).pathname !== url.pathname)) throw new Error('This version is unavailable.');
    if (!(response.headers.get('content-type') || '').includes('text/html')) throw new Error('This version did not return an application page.');
  });
  const move = navigate || (url => view.location.assign(url.href));
  function sameSource(before, after) {
    return before.sourceId === after.sourceId && after.phase === 'ready' && !blocked(after);
  }
  async function switchTo(id) {
    if (disposed || busy()) return;
    const initial = adapter.getState();
    const recovering = phase === 'error' && restoreHandoff;
    if (!recovering && blocked(initial)) { sync(); return; }
    phase = 'preparing'; gestureRequired = false;
    const target = manifest.entries.find(e => e.id === id);
    status.textContent = `Preparing ${target?.label || 'version'}…`; sync();
    let pausedHere = false;
    try {
      const url = resolveVersionUrl(manifest, id, siteRoot);
      await checkDestination(url); if (disposed) return;
      if (recovering) {
        // A restore failure keeps its original intent and raw source; Return
        // must work even though this engine never became ready.
        const handoff = await handoffStore.prepareSwitch({ ...restoreHandoff, phase: 'ready', blockedReason: null, replaceSwitchId: restoreHandoff.switchId, fromId: currentId, toId: id, settings: compatibleVersionSettings(restoreHandoff.settings) });
        if (disposed) return;
        restoreHandoff = handoff;
        url.searchParams.set('versionSwitch', handoff.switchId); await handoffStore.release(); if (disposed) return; phase = 'leaving'; sync(); move(url); return;
      }
      if (initial.phase === 'title' && !initial.source) { await handoffStore.release(); if (disposed) return; phase = 'leaving'; sync(); move(url); return; }
      if (!supported(initial.source)) throw new Error('This source cannot be carried between versions. Load audio files first.');
      if (!sameSource(initial, adapter.getState())) throw new Error('The song changed while preparing the switch.');
      await invalidation;
      const sourceId = await handoffStore.saveSource(initial); if (disposed) return;
      if (!sameSource(initial, adapter.getState())) throw new Error('The song changed while preparing the switch.');
      await adapter.pause(); pausedHere = true;
      const final = adapter.getState();
      if (!sameSource(initial, final)) throw new Error('The song changed while preparing the switch.');
      const handoff = await handoffStore.prepareSwitch({ ...final, fromId: currentId, toId: id, sourceId, paused: initial.paused, settings: compatibleVersionSettings(final.settings) });
      if (disposed) return;
      if (!sameSource(initial, adapter.getState())) throw new Error('The song changed while preparing the switch.');
      restoreHandoff = handoff;
      url.searchParams.set('versionSwitch', handoff.switchId); await handoffStore.release(); if (disposed) return;
      if (!sameSource(initial, adapter.getState())) throw new Error('The song changed while preparing the switch.');
      phase = 'leaving'; sync(); move(url);
    } catch (error) {
      if (pausedHere && sameSource(initial, adapter.getState())) {
        try { await adapter.setPaused(initial.paused); } catch { /* Resume remains available through the error action. */ }
      }
      failure(error, () => switchTo(id));
    }
  }
  async function restore(handoff) {
    if (disposed || busy()) return;
    restoreHandoff = handoff; phase = 'restoring'; gestureRequired = false; status.textContent = `Restoring your song in ${entry.label}…`; sync();
    try {
      if (!restoreSource) restoreSource = await handoffStore.readSource(handoff.sourceId);
      if (!supported(restoreSource)) throw new Error('The saved audio source is unavailable.');
      if (disposed) return;
      if (!restoreResumed) {
        if (!restoreLoaded) await adapter.loadSource(restoreSource, { ...handoff, settings: compatibleVersionSettings(handoff.settings) });
        if (disposed) return;
        const loaded = adapter.getState();
        const position = Math.min(Math.max(0, handoff.positionMs || 0), Math.max(0, loaded.durationMs || 0));
        if (loaded.phase !== 'ready' || !loaded.paused || !Number.isFinite(loaded.positionMs) || Math.abs(loaded.positionMs - position) > 100) {
          throw new Error('The song could not be restored at its saved position.');
        }
        restoreLoaded = true;
        await adapter.setPaused(!!handoff.paused); restoreResumed = true;
      }
      await handoffStore.completeSwitch(handoff);
      if (disposed) return;
      completedKey = `${handoff.sourceId}:${handoff.switchId || ''}`;
      restoreHandoff = null; restoreSource = null; restoreResumed = false; restoreLoaded = false; phase = 'idle'; retryOperation = null;
      // The token is only a pending transaction hint. Keeping it after success
      // would turn a subsequent reload into an attempt to consume stale state.
      if (view.history?.replaceState) {
        const clean = new URL(view.location.href); clean.searchParams.delete('versionSwitch'); view.history.replaceState(view.history.state, '', clean.href);
      }
      adapter.wakeHud(); sync();
    } catch (error) { failure(error, () => restore(handoff)); }
  }
  async function reconcileTransport(latest) {
    const before = adapter.getState();
    if (before.phase !== 'ready' || before.sourceId !== latest.sourceId || blocked(before)) return;
    const position = Math.min(Math.max(0, latest.positionMs || 0), Math.max(0, before.durationMs || 0));
    if (Math.abs(before.positionMs - position) <= 100 && before.paused === !!latest.paused) return;
    phase = 'restoring'; status.textContent = 'Restoring your song position…'; sync();
    try {
      await adapter.pause(); await adapter.seek(position);
      const settled = adapter.getState();
      if (settled.sourceId !== latest.sourceId || settled.phase !== 'ready' || Math.abs(settled.positionMs - position) > 100) throw new Error('The current song changed while restoring its position.');
      await adapter.setPaused(!!latest.paused); phase = 'idle'; sync();
    } catch (error) { failure(error, () => reconcileTransport(latest)); }
  }
  async function boot(reconcileExisting = false) {
    if (disposed || booting || busy() || phase === 'error') return;
    booting = true;
    try {
      if (!pruned) { await handoffStore.pruneExpired?.(); pruned = true; }
      const token = new URL(view.location.href).searchParams.get('versionSwitch') || undefined;
      const pending = await handoffStore.readPending(currentId, token);
      const latest = pending || await handoffStore.readLatest(currentId);
      if (disposed || !latest) return;
      const key = `${latest.sourceId}:${latest.switchId || ''}`;
      if (pending && key === completedKey) return;
      // BFCache already owns its current source. Reload starts on the title;
      // an existing ready/loading source must never be replaced by latest.
      const state = adapter.getState();
      if (!pending && (state.source || state.phase !== 'title')) {
        if (reconcileExisting) await reconcileTransport(latest);
        return;
      }
      if (key === completedKey) return;
      if (bootChecked && state.source) return;
      await restore(latest);
    } catch (error) { failure(error, () => { phase = 'idle'; return boot(); }); }
    finally { bootChecked = true; booting = false; }
  }
  on(previous, 'click', () => activate(() => { if (!previous.disabled) switchTo(neighbors.previous.id); }));
  on(next, 'click', () => activate(() => { if (!next.disabled) switchTo(neighbors.next.id); }));
  on(returnLive, 'click', () => activate(() => { if (!returnLive.disabled) switchTo(manifest.liveId); }));
  on(retry, 'click', () => activate(() => retryOperation?.()));
  on(root, 'focusin', () => adapter.wakeHud()); on(root, 'focusout', () => adapter.wakeHud()); on(root, 'pointerdown', () => adapter.wakeHud());
  try {
    unsubscribe = adapter.subscribe(() => {
      const state = adapter.getState();
      const userReplacement = phase !== 'restoring' && phase !== 'leaving' && ((state.phase === 'loading' && lastObserved.phase !== 'loading') || (state.phase === 'title' && !!lastObserved.sourceId));
      lastObserved = state;
      if (userReplacement) {
        restoreHandoff = null; restoreSource = null; restoreResumed = false; restoreLoaded = false; completedKey = null;
        if (phase === 'error') { phase = 'idle'; retryOperation = null; errorMessage = ''; }
        // Do not let an old latest record survive a replacement that subsequently
        // fails. A fresh successful source is persisted only on the next switch.
        invalidation = handoffStore.discardSource().catch(error => { failure(error, () => switchTo(manifest.liveId)); });
      }
      sync();
    });
    observer = view.MutationObserver ? new view.MutationObserver(sync) : null;
    if (document.getElementById('hudRight')) observer?.observe(document.getElementById('hudRight'), { attributes: true, attributeFilter: ['class'] });
    on(view, 'pageshow', () => {
      // A cached origin document was paused immediately before leaving. Bring
      // it back into the state machine, then apply the destination's latest
      // transport to its existing generation instead of loading a second app.
      if (phase === 'leaving') { phase = 'idle'; restoreHandoff = null; restoreSource = null; restoreLoaded = false; restoreResumed = false; }
      sync(); boot(true);
    });
    handoffStore.setSnapshotProvider?.(() => ({ state: phase === 'idle' ? adapter.getState() : null, currentId }));
    sync();
    (document.getElementById('app') || document.body).append(root);
    const ready = boot();
    return { ready, dispose() { disposed = true; handoffStore.setSnapshotProvider?.(null); unsubscribe?.(); observer?.disconnect(); listeners.forEach(off => off()); root.remove(); } };
  } catch (error) {
    disposed = true; handoffStore.setSnapshotProvider?.(null); unsubscribe?.(); observer?.disconnect(); listeners.forEach(off => off());
    if (root.parentElement) root.remove();
    throw error;
  }
}
