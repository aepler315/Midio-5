// Soulseek song search (SoulseekSource.js): Soulseek is a peer-to-peer file
// sharing network — the browser cannot speak its TCP protocol, so the local
// dev server (tools/serve.js) holds the connection and exposes a tiny JSON
// API at /api/soulseek/*. This module is the browser half: it talks to the
// local bridge only, and hands downloaded audio to the exact same
// handleFiles() path a local drop uses, so nothing downstream needs to know
// the audio came from the network.
//
// Credentials are stored locally (localStorage) and sent only to the local
// bridge, which forwards them to server.slsknet.org. The bridge never
// exposes them back to the page.
const API_BASE = '/api/soulseek';
const SEARCH_TIMEOUT_MS = 8000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const CRED_KEY = 'smw:soulseekUser';

export class SoulseekError extends Error {}

/** fetch() with a hard timeout — a stalled request must not leave the UI
 *  reading "Searching…" forever. */
async function fetchWithTimeout(url, options = {}, ms = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new SoulseekError('Timed out talking to the local Soulseek bridge.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function post(action, payload, timeoutMs) {
  let res;
  try {
    res = await fetchWithTimeout(`${API_BASE}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, timeoutMs);
  } catch (err) {
    if (err instanceof SoulseekError) throw err;
    throw new SoulseekError(`Could not reach the local Soulseek bridge: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SoulseekError(data.error || `Soulseek request failed (HTTP ${res.status}).`);
  return data;
}

export function getSoulseekUser() {
  try { return localStorage.getItem(CRED_KEY) || ''; } catch { return ''; }
}

export function setSoulseekUser(user) {
  try { localStorage.setItem(CRED_KEY, user || ''); } catch { /* no persistent storage available */ }
}

/** Logs into Soulseek through the local bridge. The password is sent to the
 *  bridge once and never stored. */
export async function soulseekConnect(user, pass) {
  const r = await post('connect', { user, pass }, 20000);
  setSoulseekUser(r.user || user);
  return r;
}

export async function soulseekDisconnect() {
  await post('disconnect', {}, 5000);
}

export async function soulseekStatus() {
  const res = await fetchWithTimeout(`${API_BASE}/status`, {}, 5000);
  return res.json();
}

/**
 * @param {string} query free-text search (title/artist)
 * @returns {Promise<Array<{user:string, file:string, name:string, size:number,
 *   slots:boolean, bitrate:number, speed:number}>>}
 */
export async function soulseekSearch(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const r = await post('search', { query: q, timeoutMs: SEARCH_TIMEOUT_MS }, SEARCH_TIMEOUT_MS + 5000);
  return r.results || [];
}

/** Downloads a search result through the bridge and wraps the audio as a
 *  File — the existing drop/import pipeline (main.js's handleFiles) already
 *  knows how to play a File exactly like a local drop. */
export async function soulseekFetchAsFile(result) {
  const r = await post('download', { file: result }, DOWNLOAD_TIMEOUT_MS + 10000);
  const bytes = atob(r.data);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buf[i] = bytes.charCodeAt(i);
  const safeName = String(r.name || 'soulseek-track').replace(/[\\/:*?"<>|]/g, '_');
  return new File([buf], safeName, { type: 'audio/mpeg' });
}
