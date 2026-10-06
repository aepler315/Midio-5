// Raw visitor files stay local. Transactions include ownership so a copied
// sessionStorage token cannot read or consume another document's handoff.
const DAY_MS = 86400000;
const LEASE_MS = 15000;
const TOKEN_KEY = 'midio:version-tab';
const randomId = () => globalThis.crypto.randomUUID();

function idbStorage(indexedDB) {
  let opened;
  function open() {
    if (!opened) {
      const attempt = new Promise((resolve, reject) => {
        if (!indexedDB) { reject(new Error('Browser storage is unavailable.')); return; }
        let abandoned = false;
        const request = indexedDB.open('midio-version-handoff-v1', 1);
        const failed = error => { abandoned = true; reject(error); };
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onsuccess = () => {
          if (abandoned) request.result.close();
          else resolve(request.result);
        };
        request.onerror = () => failed(request.error);
        request.onblocked = () => failed(new Error('Version storage is blocked.'));
      });
      const retryable = attempt.catch(error => { if (opened === retryable) opened = null; throw error; });
      opened = retryable;
    }
    return opened;
  }
  return { async atomic(fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      const request = r => new Promise((yes, no) => { r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error); });
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Version storage transaction failed.'));
      Promise.resolve(fn({
        get: k => request(store.get(k)), put: (k,v) => request(store.put(v,k)), delete: k => request(store.delete(k)),
        entries: async () => {
          const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
          return keys.map((k,i) => [k,values[i]]);
        },
      })).then(value => { result = value; }).catch(error => { try { tx.abort(); } catch { /* completed */ } reject(error); });
    });
  } };
}

export function createVersionHandoffStore({ indexedDB = globalThis.indexedDB, sessionStorage = globalThis.sessionStorage,
  now = Date.now, storage = null, locks = globalThis.navigator?.locks, lifecycle = globalThis.window,
  heartbeat = true, navigationType = globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.type } = {}) {
  const db = storage || idbStorage(indexedDB);
  const documentId = randomId();
  let token, claimed = false, acquiring, releaseLock, lockCompletion, timer, snapshotProvider, savedSourceId, lifecycleHide, lifecycleRestore, disposed = false;
  const key = name => `${token}:${name}`;
  const snapshotKey = () => `midio:version-transport:${token}`;
  function clearSnapshot() { sessionStorage?.setItem(snapshotKey(), ''); }
  function readSnapshot() {
    let value;
    try { value = JSON.parse(sessionStorage?.getItem(snapshotKey()) || 'null'); } catch { return null; }
    return value?.schema === 1 && value.tabId === token && now() - value.createdAtMs < DAY_MS ? value : null;
  }
  function sourceInvalidated(sourceId) {
    const snapshot = readSnapshot();
    return !!snapshot && (snapshot.invalidated || (snapshot.sourceId && snapshot.sourceId !== sourceId));
  }
  function storedToken() {
    try { return sessionStorage?.getItem(TOKEN_KEY) || randomId(); }
    catch { throw new Error('Session storage is unavailable.'); }
  }
  async function lockToken() {
    if (!locks?.request) return true;
    return new Promise((resolve,reject) => {
      lockCompletion = locks.request(`midio-version:${token}`, { ifAvailable: true }, async lock => {
        if (!lock) { resolve(false); return; }
        await new Promise(release => { releaseLock = release; resolve(true); });
      }).catch(reject);
    });
  }
  async function acquire(waitForPrevious = (navigationType === 'reload' || navigationType === 'back_forward')) {
    if (disposed) throw new Error('Version storage has been disposed.');
    if (claimed) return;
    if (acquiring) return acquiring;
    acquiring = (async () => {
      token = storedToken();
      let waits = 0;
      const waitForOwner = async () => {
        if (++waits > 80) throw new Error('The previous page has not released this session. Retry restoration.');
        await new Promise(resolve => setTimeout(resolve, 25));
      };
      for (;;) {
        if (!await lockToken()) {
          if (waitForPrevious) await waitForOwner();
          else token = randomId();
          continue;
        }
        const won = await db.atomic(async tx => {
          const owner = await tx.get(key('owner'));
          if (owner && owner.documentId !== documentId && owner.expiresAtMs > now() && !(owner.usesWebLock && releaseLock)) return false;
          await tx.put(key('owner'), { documentId, usesWebLock: !!releaseLock, expiresAtMs: now() + LEASE_MS }); return true;
        });
        if (won) break;
        releaseLock?.(); await lockCompletion; releaseLock = null;
        if (waitForPrevious) await waitForOwner();
        else token = randomId();
      }
      sessionStorage?.setItem(TOKEN_KEY, token);
      claimed = true;
      if (heartbeat) timer = setInterval(() => owned(async () => {}).catch(() => {}), LEASE_MS / 3);
    })();
    try { await acquiring; } catch (error) { releaseLock?.(); await lockCompletion; releaseLock = null; throw error; } finally { acquiring = null; }
  }
  async function owned(fn) {
    if (lifecycleRestore) await lifecycleRestore;
    await acquire();
    return db.atomic(async tx => {
      const owner = await tx.get(key('owner'));
      if (!owner || owner.documentId !== documentId) throw new Error('This session belongs to another tab.');
      await tx.put(key('owner'), { documentId, usesWebLock: !!releaseLock, expiresAtMs: now() + LEASE_MS });
      return fn(tx);
    });
  }
  const valid = value => value && now() - value.createdAtMs < DAY_MS;
  async function release() {
    if (acquiring) await acquiring;
    clearInterval(timer); timer = null;
    if (claimed) await db.atomic(async tx => {
      if ((await tx.get(key('owner')))?.documentId === documentId) await tx.delete(key('owner'));
    });
    claimed = false; releaseLock?.(); await lockCompletion; releaseLock = null;
  }
  async function updateLatest(state, currentId) {
    if (state.phase !== 'ready' || state.blockedReason || !state.sourceId) throw new Error('The selected song is not ready.');
    return owned(async tx => {
      const source = await tx.get(key('source'));
      if (!valid(source) || source.sourceId !== state.sourceId) throw new Error('The selected song has changed.');
      const latest = await tx.get(key('latest'));
      await tx.put(key('latest'), { schema: 1, tabId: token, switchId: latest?.switchId || randomId(), fromId: currentId, toId: currentId,
        sourceId: state.sourceId, createdAtMs: now(), positionMs: state.positionMs, seed: state.seed, paused: !!state.paused,
        worldId: state.worldId ?? null, rangeViewId: state.rangeViewId ?? null, settings: { ...(state.settings || {}) } });
    });
  }
  const snapshotAndRelease = async () => {
    try {
      if (claimed && snapshotProvider) {
        const snapshot = snapshotProvider();
        if (snapshot?.state?.phase === 'ready' && snapshot.state.sourceId === savedSourceId && !snapshot.state.blockedReason) {
          const state = snapshot.state;
          // unload may terminate asynchronous IndexedDB callbacks. This small,
          // synchronous transport-only envelope carries no audio and is trusted
          // only after destination ownership and the IDB source both match.
          sessionStorage?.setItem(snapshotKey(), JSON.stringify({ schema: 1, tabId: token, sourceId: savedSourceId, createdAtMs: now(),
            positionMs: state.positionMs, seed: state.seed, paused: !!state.paused, worldId: state.worldId ?? null,
            rangeViewId: state.rangeViewId ?? null, settings: { ...(state.settings || {}) } }));
          await updateLatest(state, snapshot.currentId);
        }
      }
    } catch { /* An unsaved or replaced source cannot overwrite the last successful session. */ }
    finally { await release().catch(() => {}); }
  };
  const pagehide = () => { lifecycleHide = snapshotAndRelease(); return lifecycleHide; };
  const pageshow = event => {
    const restore = (async () => { await lifecycleHide; await acquire(!!event?.persisted || (navigationType === 'reload' || navigationType === 'back_forward')); })();
    lifecycleRestore = restore;
    const finished = () => { if (lifecycleRestore === restore) lifecycleRestore = null; };
    restore.then(finished, finished);
    return restore;
  };
  lifecycle?.addEventListener('pagehide', pagehide);
  lifecycle?.addEventListener('pageshow', pageshow);
  return {
    tabId: async () => { if (lifecycleRestore) await lifecycleRestore; await acquire(); return token; }, release, updateLatest,
    setSnapshotProvider(provider) { snapshotProvider = provider; },
    async saveSource(state) {
      if (state.phase !== 'ready' || state.blockedReason || !state.sourceId || !['audio-files','demo'].includes(state.source?.kind)) throw new Error(state.blockedReason || 'The selected song is not ready to carry.');
      if (state.source.kind === 'audio-files' && !state.source.files?.length) throw new Error('Original audio files are unavailable.');
      const sourceId = await owned(async tx => {
        const existing = await tx.get(key('source'));
        if (valid(existing) && existing.sourceId === state.sourceId) return state.sourceId;
        await tx.put(key('source'), { sourceId: state.sourceId, source: state.source.kind === 'demo' ? {kind:'demo'} : {kind:'audio-files',files:[...state.source.files]}, createdAtMs: now() });
        await tx.delete(key('pending')); await tx.delete(key('latest'));
        return state.sourceId;
      });
      savedSourceId = sourceId;
      clearSnapshot();
      return sourceId;
    },
    async readSource(sourceId) { return owned(async tx => { const row=await tx.get(key('source')); if (!sourceInvalidated(sourceId) && valid(row) && row.sourceId===sourceId) { savedSourceId = sourceId; return row.source; } return null; }); },
    async prepareSwitch(state) {
      if (state.phase !== 'ready' || state.blockedReason) throw new Error(state.blockedReason || 'The song is not ready.');
      return owned(async tx => {
        const source = await tx.get(key('source'));
        if (!valid(source) || source.sourceId!==state.sourceId) throw new Error('The selected song has changed.');
        const previous = await tx.get(key('pending'));
        if (valid(previous) && (previous.switchId !== state.replaceSwitchId || previous.sourceId !== state.sourceId)) throw new Error('A version switch is already pending.');
        const handoff={schema:1,tabId:token,switchId:randomId(),fromId:state.fromId,toId:state.toId,sourceId:state.sourceId,createdAtMs:now(),positionMs:Math.max(0,Number(state.positionMs)||0),seed:state.seed,paused:!!state.paused,worldId:state.worldId??null,rangeViewId:state.rangeViewId??null,settings:{...(state.settings||{})}};
        await tx.put(key('pending'),handoff); return handoff;
      });
    },
    async readPending(toId, switchId) { return owned(async tx => { const row=await tx.get(key('pending')); return valid(row) && !sourceInvalidated(row.sourceId) && row.tabId===token && row.toId===toId && (!switchId || row.switchId===switchId) ? row : null; }); },
    async readLatest(toId) { return owned(async tx => {
      let row = await tx.get(key('latest'));
      if (!valid(row) || sourceInvalidated(row.sourceId)) return null;
      const source = await tx.get(key('source'));
      if (!valid(source) || source.sourceId !== row.sourceId) return null;
      const snapshot = readSnapshot();
      if (valid(snapshot) && snapshot.schema === 1 && snapshot.tabId === token && snapshot.sourceId === row.sourceId && snapshot.createdAtMs >= row.createdAtMs) {
        row = { ...row, ...snapshot, toId };
        await tx.put(key('latest'), row);
      }
      savedSourceId = source.sourceId;
      return { ...row, toId };
    }); },
    async completeSwitch(handoff) { return owned(async tx => {
      const pending=await tx.get(key('pending'));
      if (!pending) {
        const latest = await tx.get(key('latest'));
        if (valid(latest) && latest.tabId === token && latest.switchId === handoff.switchId && latest.sourceId === handoff.sourceId) return;
      }
      if (!valid(pending) || pending.tabId!==token || pending.switchId!==handoff.switchId || pending.toId!==handoff.toId || pending.sourceId!==handoff.sourceId) throw new Error('This handoff does not match the destination.');
      await tx.put(key('latest'),pending); await tx.delete(key('pending'));
    }); },
    async discardSource() {
      // Write before the first await: reload must not resurrect a replaced song
      // if IndexedDB deletion is interrupted by unload or storage failure.
      if (claimed) sessionStorage?.setItem(snapshotKey(), JSON.stringify({ schema: 1, tabId: token, invalidated: true, createdAtMs: now() }));
      savedSourceId = null;
      return owned(async tx => { for(const name of ['source','pending','latest']) await tx.delete(key(name)); });
    },
    async pruneExpired() { return owned(async tx => {
      for(const [k,v] of await tx.entries()) if(k.endsWith(':owner') ? v.expiresAtMs<=now() : !valid(v)) await tx.delete(k);
    }); },
    async dispose() { lifecycle?.removeEventListener('pagehide',pagehide); lifecycle?.removeEventListener('pageshow',pageshow); await release(); disposed=true; },
  };
}
