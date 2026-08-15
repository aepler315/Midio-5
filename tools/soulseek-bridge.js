// Soulseek bridge: the Soulseek network is a TCP P2P protocol that browsers
// cannot speak, so the local dev server holds the connection and exposes a
// tiny JSON API (mounted by tools/serve.js at /api/soulseek/*). Credentials
// never leave the machine — the bridge only talks to server.slsknet.org on
// the user's behalf, and the browser only talks to the local bridge.
//
// The slsk-client library is CommonJS with a module-level singleton, so the
// bridge keeps its own reference and routes every call through the library's
// connect/disconnect entry points.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.mid', '.midi']);
const MAX_RESULTS = 50;

export class SoulseekBridgeError extends Error {}

/**
 * @param {{slsk?: object, tmpDir?: string}} [opts] `slsk` is injectable for
 *   tests; `tmpDir` is where downloads land (defaults to the OS temp dir).
 */
export function createSoulseekBridge({ slsk = null, tmpDir = os.tmpdir() } = {}) {
  // slsk-client is an optional dependency (the feature is a bonus source of
  // songs, not core to the app), so it's only required at first actual use —
  // never at server startup. A dev box that never installed it can still
  // boot and play local/dropped files; only the Soulseek panel itself fails,
  // with a clear error, instead of the whole server crashing on import.
  let requiredLib = slsk;
  function lib() {
    if (!requiredLib) requiredLib = require('slsk-client');
    return requiredLib;
  }
  let client = null;
  let user = '';

  function isConnected() {
    return client !== null;
  }

  /** Logs in and keeps the connection alive for later searches/downloads.
   *  Idempotent: reconnecting with the same username is a no-op. */
  function connect({ user: u, pass, timeoutMs = 15000 }) {
    return new Promise((resolve, reject) => {
      if (!u || !pass) {
        reject(new SoulseekBridgeError('Soulseek username and password are required.'));
        return;
      }
      if (client && user === u) {
        resolve({ user: u });
        return;
      }
      let clientLib;
      try {
        clientLib = lib();
      } catch (err) {
        reject(new SoulseekBridgeError(`Soulseek support is not installed on this server: ${err.message}`));
        return;
      }
      if (client) {
        try { clientLib.disconnect(); } catch { /* already gone */ }
        client = null;
      }
      clientLib.connect({ user: u, pass, timeout: timeoutMs }, (err, c) => {
        if (err) {
          client = null;
          reject(new SoulseekBridgeError(`Could not connect to Soulseek: ${err.message}`));
          return;
        }
        client = c;
        user = u;
        resolve({ user: u });
      });
    });
  }

  /** Searches the network; results accumulate until the timeout window
   *  closes (Soulseek never signals "search finished"). Only audio files
   *  are returned, best candidates first (open slot, then speed). */
  function search({ query, timeoutMs = 8000 }) {
    return new Promise((resolve, reject) => {
      if (!client) {
        reject(new SoulseekBridgeError('Not connected to Soulseek — enter your username and password first.'));
        return;
      }
      const q = String(query || '').trim();
      if (!q) { resolve([]); return; }
      client.search({ req: q, timeout: timeoutMs }, (err, results) => {
        if (err) {
          reject(new SoulseekBridgeError(`Soulseek search failed: ${err.message}`));
          return;
        }
        const mapped = (results || [])
          .filter((r) => r && r.file && AUDIO_EXT.has(path.extname(r.file).toLowerCase()))
          .map((r) => ({
            user: r.user,
            file: r.file,
            name: path.basename(r.file).replace(/^@@[^/\\]+[\\/]/, ''),
            size: r.size || 0,
            slots: !!r.slots,
            bitrate: r.bitrate || 0,
            speed: r.speed || 0,
          }))
          .sort((a, b) => (b.slots - a.slots) || (b.speed - a.speed))
          .slice(0, MAX_RESULTS);
        resolve(mapped);
      });
    });
  }

  /** Downloads a search result into the temp dir and resolves with the full
   *  audio buffer (the library buffers the whole file in RAM). */
  function download({ file, timeoutMs = 120000 }) {
    return new Promise((resolve, reject) => {
      if (!client) {
        reject(new SoulseekBridgeError('Not connected to Soulseek.'));
        return;
      }
      if (!file || !file.user || !file.file) {
        reject(new SoulseekBridgeError('Invalid Soulseek file.'));
        return;
      }
      const safeName = path.basename(file.file).replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(tmpDir, `slsk-${Date.now()}-${safeName}`);
      const timer = setTimeout(() => {
        reject(new SoulseekBridgeError(`Download timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      client.download(
        { file: { user: file.user, file: file.file, size: file.size }, path: dest },
        (err, down) => {
          clearTimeout(timer);
          if (err) {
            reject(new SoulseekBridgeError(`Download failed: ${err.message}`));
            return;
          }
          if (!down || !down.buffer || down.buffer.length === 0) {
            reject(new SoulseekBridgeError('Download returned no data.'));
            return;
          }
          resolve({ buffer: down.buffer, name: safeName, path: dest });
        },
      );
    });
  }

  function disconnect() {
    if (client) {
      try { requiredLib.disconnect(); } catch { /* ignore */ }
      client = null;
      user = '';
    }
  }

  return { isConnected, connect, search, download, disconnect };
}
