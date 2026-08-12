/**
 * Soulseek bridge for Midio.
 *
 * Backends (first match wins):
 *   1. Runtime config from the UI (POST /api/soulseek/config)
 *   2. Env: SLSKD_URL + SLSKD_API_KEY  →  proxy to a local/remote slskd
 *   3. Env: SLSK_USER + SLSK_PASS      →  direct Soulseek via slsk-client
 *   4. Demo catalog of free/public-domain audio (always available as fallback)
 *
 * Normalized result shape (client-facing):
 *   { id, title, artist, filename, size, bitrate, speed, slots, user, source, ext }
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AUDIO_EXT = /\.(mp3|flac|wav|ogg|m4a|aac|opus|mid|midi)$/i;
const searches = new Map(); // id → { mode, query, status, results, createdAt, raw }
let runtimeConfig = null; // { mode, slskdUrl, slskdKey, slskUser, slskPass }
let directClient = null;
let directClientPromise = null;

// ── Free / demo-permitted catalog (demo backend) ───────────────────────────
// Reliable hosts only (SoundHelix royalty-free demos). Remote fetch has a
// local procedural-WAV fallback if a URL is ever unreachable.
const DEMO_CATALOG = [
  {
    id: 'demo-helix-1',
    title: 'Neon Skyline',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Neon Skyline.mp3',
    size: 8_945_229,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  },
  {
    id: 'demo-helix-2',
    title: 'Midnight Express',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Midnight Express.mp3',
    size: 10_222_911,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  },
  {
    id: 'demo-helix-3',
    title: 'Crystal Garden',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Crystal Garden.mp3',
    size: 7_500_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  },
  {
    id: 'demo-helix-4',
    title: 'Pulse City',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Pulse City.mp3',
    size: 8_000_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
  },
  {
    id: 'demo-helix-5',
    title: 'Aurora Drive',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Aurora Drive.mp3',
    size: 8_200_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
  },
  {
    id: 'demo-helix-6',
    title: 'Deep Orbit',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Deep Orbit.mp3',
    size: 7_800_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
  },
  {
    id: 'demo-helix-7',
    title: 'Velvet Static',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Velvet Static.mp3',
    size: 8_100_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
  },
  {
    id: 'demo-helix-8',
    title: 'Glass Horizon',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Glass Horizon.mp3',
    size: 7_900_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
  },
  {
    id: 'demo-helix-9',
    title: 'Chrome Ballet',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Chrome Ballet.mp3',
    size: 8_400_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
  },
  {
    id: 'demo-helix-10',
    title: 'Solar Flare',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Solar Flare.mp3',
    size: 8_600_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3',
  },
  {
    id: 'demo-helix-16',
    title: 'Night Market',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Night Market.mp3',
    size: 11_602_841,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3',
  },
  {
    id: 'demo-helix-17',
    title: 'Paper Planets',
    artist: 'SoundHelix',
    filename: 'SoundHelix - Paper Planets.mp3',
    size: 9_000_000,
    bitrate: 128,
    speed: 5_000_000,
    slots: true,
    user: 'midio-demo',
    source: 'demo',
    ext: 'mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-17.mp3',
  },
];

function activeConfig() {
  if (runtimeConfig) return runtimeConfig;
  if (process.env.SLSKD_URL && process.env.SLSKD_API_KEY) {
    return {
      mode: 'slskd',
      slskdUrl: process.env.SLSKD_URL.replace(/\/$/, ''),
      slskdKey: process.env.SLSKD_API_KEY,
    };
  }
  if (process.env.SLSK_USER && process.env.SLSK_PASS) {
    return {
      mode: 'direct',
      slskUser: process.env.SLSK_USER,
      slskPass: process.env.SLSK_PASS,
    };
  }
  return { mode: 'demo' };
}

export function setConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    runtimeConfig = null;
    directClient = null;
    directClientPromise = null;
    return activeConfig();
  }
  const mode = String(cfg.mode || '').toLowerCase();
  if (mode === 'demo' || mode === 'off' || mode === 'clear') {
    runtimeConfig = null;
    directClient = null;
    directClientPromise = null;
    return activeConfig();
  }
  if (mode === 'slskd') {
    const url = String(cfg.slskdUrl || cfg.url || '').trim().replace(/\/$/, '');
    const key = String(cfg.slskdKey || cfg.apiKey || '').trim();
    if (!url || !key) throw new Error('slskd mode needs slskdUrl and slskdKey');
    runtimeConfig = { mode: 'slskd', slskdUrl: url, slskdKey: key };
    directClient = null;
    directClientPromise = null;
    return { mode: 'slskd', slskdUrl: url, connected: true };
  }
  if (mode === 'direct') {
    const user = String(cfg.slskUser || cfg.user || '').trim();
    const pass = String(cfg.slskPass || cfg.pass || cfg.password || '').trim();
    if (!user || !pass) throw new Error('direct mode needs slskUser and slskPass');
    runtimeConfig = { mode: 'direct', slskUser: user, slskPass: pass };
    directClient = null;
    directClientPromise = null;
    return { mode: 'direct', user, connected: true };
  }
  throw new Error(`Unknown Soulseek mode: ${mode}`);
}

export function getStatus() {
  const cfg = activeConfig();
  return {
    mode: cfg.mode,
    connected: cfg.mode !== 'demo',
    slskdUrl: cfg.mode === 'slskd' ? cfg.slskdUrl : null,
    user: cfg.mode === 'direct' ? cfg.slskUser : null,
    demoTracks: DEMO_CATALOG.length,
    note:
      cfg.mode === 'demo'
        ? 'Demo catalog of free music. Connect slskd or a Soulseek account for live network search.'
        : cfg.mode === 'slskd'
          ? `Proxying searches through slskd at ${cfg.slskdUrl}`
          : `Direct Soulseek client as ${cfg.slskUser}`,
  };
}

function basename(p) {
  if (!p) return 'unknown';
  const parts = String(p).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

function parseTitleArtist(filename) {
  const base = basename(filename).replace(/\.[^.]+$/, '');
  // Common patterns: "Artist - Title", "Artist_-_Title", "01 Artist - Title"
  const cleaned = base.replace(/^\d{1,3}[\s._-]+/, '').replace(/_/g, ' ').trim();
  const m = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: cleaned };
}

function formatBytes(n) {
  if (!n || n < 0) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeFile(raw, source) {
  const filename = raw.filename || raw.file || raw.name || 'unknown';
  const { artist, title } = parseTitleArtist(filename);
  const ext = (filename.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  return {
    id: raw.id || `${source}:${raw.user || raw.username || 'x'}:${filename}`,
    title: raw.title || title,
    artist: raw.artist || artist,
    filename,
    size: Number(raw.size || 0),
    sizeLabel: formatBytes(Number(raw.size || 0)),
    bitrate: Number(raw.bitRate || raw.bitrate || 0) || null,
    speed: Number(raw.speed || raw.uploadSpeed || 0) || null,
    slots: raw.slots !== false && raw.hasFreeUploadSlot !== false,
    user: raw.user || raw.username || 'unknown',
    source,
    ext,
    // keep raw fields needed for download
    _file: filename,
    _code: raw.code,
  };
}

// ── Demo search ────────────────────────────────────────────────────────────
function demoSearch(query) {
  const q = String(query || '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  let hits = DEMO_CATALOG;
  if (terms.length) {
    hits = DEMO_CATALOG.filter((t) => {
      const hay = `${t.title} ${t.artist} ${t.filename}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }
  // If nothing matched, still return a few suggestions so the UI isn't empty
  if (!hits.length) hits = DEMO_CATALOG.slice(0, 4);
  return hits.map((t) => ({
    ...t,
    sizeLabel: formatBytes(t.size),
  }));
}

// ── slskd proxy ────────────────────────────────────────────────────────────
async function slskdFetch(cfg, apiPath, opts = {}) {
  const url = `${cfg.slskdUrl}/api/v0${apiPath}`;
  const headers = {
    Accept: 'application/json',
    'X-API-Key': cfg.slskdKey,
    ...(opts.headers || {}),
  };
  if (opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`slskd ${opts.method || 'GET'} ${apiPath} → ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.arrayBuffer();
}

async function startSlskdSearch(cfg, query) {
  const id = randomUUID();
  const body = {
    id,
    searchText: query,
    fileLimit: 200,
    filterResponses: true,
    minimumPeerUploadSpeed: 0,
    minimumResponseFileCount: 1,
    responseLimit: 50,
    searchTimeout: 12_000,
  };
  await slskdFetch(cfg, '/searches', { method: 'POST', body });
  searches.set(id, {
    mode: 'slskd',
    query,
    status: 'inProgress',
    results: [],
    createdAt: Date.now(),
  });
  // Kick off polling in background
  pollSlskdSearch(cfg, id).catch((err) => {
    const s = searches.get(id);
    if (s) {
      s.status = 'error';
      s.error = err.message;
    }
  });
  return id;
}

async function pollSlskdSearch(cfg, id) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await sleep(900);
    let responses;
    try {
      responses = await slskdFetch(cfg, `/searches/${id}/responses`);
    } catch {
      // search may not have responses yet
      const state = await slskdFetch(cfg, `/searches/${id}`).catch(() => null);
      if (state?.isComplete) break;
      continue;
    }
    const files = [];
    for (const resp of responses || []) {
      const user = resp.username || resp.user;
      const speed = resp.uploadSpeed || resp.speed || 0;
      const freeSlot = resp.hasFreeUploadSlot ?? resp.freeUploadSlots > 0;
      for (const f of resp.files || []) {
        const name = f.filename || f.file || '';
        if (!AUDIO_EXT.test(name)) continue;
        files.push(
          normalizeFile(
            {
              ...f,
              user,
              speed,
              slots: freeSlot,
              bitrate: f.bitRate || f.bitrate,
            },
            'slskd',
          ),
        );
      }
    }
    // Prefer free slots + higher bitrate, cap list
    files.sort((a, b) => {
      if (a.slots !== b.slots) return a.slots ? -1 : 1;
      return (b.bitrate || 0) - (a.bitrate || 0) || (b.speed || 0) - (a.speed || 0);
    });
    const s = searches.get(id);
    if (!s) return;
    s.results = files.slice(0, 80);
    const state = await slskdFetch(cfg, `/searches/${id}`).catch(() => null);
    if (state?.isComplete || state?.state === 'Completed') {
      s.status = 'completed';
      return;
    }
  }
  const s = searches.get(id);
  if (s && s.status === 'inProgress') s.status = 'completed';
}

async function downloadViaSlskd(cfg, item) {
  const username = item.user;
  const filePayload = [
    {
      filename: item._file || item.filename,
      size: item.size || 0,
    },
  ];
  await slskdFetch(cfg, `/transfers/downloads/${encodeURIComponent(username)}`, {
    method: 'POST',
    body: filePayload,
  });

  // Poll downloads for this user until the matching file completes
  const deadline = Date.now() + 120_000;
  const target = basename(item._file || item.filename).toLowerCase();
  while (Date.now() < deadline) {
    await sleep(1500);
    const downloads = await slskdFetch(
      cfg,
      `/transfers/downloads/${encodeURIComponent(username)}`,
    ).catch(() => null);
    const dirs = Array.isArray(downloads) ? downloads : downloads ? [downloads] : [];
    for (const dir of dirs) {
      for (const f of dir.files || []) {
        const name = basename(f.filename || '').toLowerCase();
        if (name !== target && !(f.filename || '').toLowerCase().endsWith(target)) continue;
        const state = String(f.state || f.transferState || '').toLowerCase();
        if (state.includes('complete') && !state.includes('incomplete')) {
          // Try to fetch file bytes via slskd files API (path-based)
          const localPath = f.filename || item.filename;
          // slskd serves completed downloads; try common endpoints
          const candidates = [
            `/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(f.id)}`,
          ];
          // Prefer reading from known download directories if co-located (env)
          const dlRoot =
            process.env.SLSKD_DOWNLOADS ||
            process.env.SLSKD_DOWNLOAD_DIR ||
            '';
          if (dlRoot) {
            const tryPaths = [
              path.join(dlRoot, basename(localPath)),
              path.join(dlRoot, localPath.replace(/^\\|^\//, '')),
            ];
            for (const p of tryPaths) {
              if (fs.existsSync(p)) {
                return {
                  buffer: fs.readFileSync(p),
                  filename: basename(localPath),
                  contentType: mimeFor(basename(localPath)),
                };
              }
            }
          }
          // Last resort: return metadata so UI can tell user file is in slskd downloads
          throw new Error(
            `Download completed in slskd for "${basename(localPath)}" but file bytes are not reachable from Midio. ` +
              `Set SLSKD_DOWNLOADS to your slskd downloads folder, or drop the file manually.`,
          );
        }
        if (state.includes('fail') || state.includes('error') || state.includes('cancel')) {
          throw new Error(`slskd transfer failed: ${state}`);
        }
      }
    }
  }
  throw new Error('Timed out waiting for slskd download');
}

// ── Direct Soulseek (slsk-client) ──────────────────────────────────────────
async function getDirectClient(cfg) {
  if (directClient) return directClient;
  if (directClientPromise) return directClientPromise;
  directClientPromise = new Promise((resolve, reject) => {
    let slsk;
    try {
      slsk = require('slsk-client');
    } catch (err) {
      reject(new Error('slsk-client is not installed. Run: npm install slsk-client'));
      return;
    }
    slsk.connect(
      {
        user: cfg.slskUser,
        pass: cfg.slskPass,
      },
      (err, client) => {
        if (err) {
          directClientPromise = null;
          reject(new Error(`Soulseek login failed: ${err.message || err}`));
          return;
        }
        directClient = client;
        resolve(client);
      },
    );
  });
  return directClientPromise;
}

async function startDirectSearch(cfg, query) {
  const id = randomUUID();
  searches.set(id, {
    mode: 'direct',
    query,
    status: 'inProgress',
    results: [],
    createdAt: Date.now(),
  });
  (async () => {
    try {
      const client = await getDirectClient(cfg);
      const res = await new Promise((resolve, reject) => {
        client.search({ req: query, timeout: 8000 }, (err, data) => {
          if (err) reject(err);
          else resolve(data || []);
        });
      });
      const files = (res || [])
        .filter((r) => AUDIO_EXT.test(r.file || r.filename || ''))
        .map((r) =>
          normalizeFile(
            {
              filename: r.file,
              size: r.size,
              bitrate: r.bitrate,
              speed: r.speed,
              slots: r.slots,
              user: r.user,
            },
            'direct',
          ),
        );
      files.sort((a, b) => {
        if (a.slots !== b.slots) return a.slots ? -1 : 1;
        return (b.bitrate || 0) - (a.bitrate || 0) || (b.speed || 0) - (a.speed || 0);
      });
      const s = searches.get(id);
      if (s) {
        s.results = files.slice(0, 80);
        s.status = 'completed';
        // stash raw for download
        s._rawById = new Map(files.map((f, i) => [f.id, res.filter((r) => AUDIO_EXT.test(r.file || ''))[i]]));
        s._rawList = res.filter((r) => AUDIO_EXT.test(r.file || ''));
      }
    } catch (err) {
      const s = searches.get(id);
      if (s) {
        s.status = 'error';
        s.error = err.message || String(err);
      }
    }
  })();
  return id;
}

async function downloadViaDirect(cfg, item) {
  const client = await getDirectClient(cfg);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'midio-slsk-'));
  const outPath = path.join(tmpDir, basename(item.filename).replace(/[^\w.\- ()[\]]+/g, '_'));
  const fileObj = {
    user: item.user,
    file: item._file || item.filename,
    size: item.size,
    slots: item.slots !== false,
    bitrate: item.bitrate || 0,
    speed: item.speed || 0,
  };
  await new Promise((resolve, reject) => {
    client.download({ file: fileObj, path: outPath }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  const buffer = fs.readFileSync(outPath);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return {
    buffer,
    filename: basename(item.filename),
    contentType: mimeFor(basename(item.filename)),
  };
}

// ── Demo download ──────────────────────────────────────────────────────────
function makeProceduralWav(seedStr = 'midio', seconds = 24) {
  // Tiny multi-tone loop so Midio always has something to visualize offline.
  const sr = 22050;
  const n = Math.floor(sr * seconds);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const root = 110 + (h % 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beat = Math.floor(t * 2) % 8;
    const f1 = root * (beat % 2 === 0 ? 1 : 1.25);
    const f2 = root * 1.5;
    const env = Math.min(1, t * 4) * Math.min(1, (seconds - t) * 2);
    const kick = Math.exp(-((t % 0.5) * 18)) * Math.sin(2 * Math.PI * 55 * (t % 0.5));
    const lead = Math.sin(2 * Math.PI * f1 * t) * 0.35 + Math.sin(2 * Math.PI * f2 * t) * 0.2;
    const s = Math.max(-1, Math.min(1, (lead + kick * 0.5) * env));
    buf.writeInt16LE((s * 30000) | 0, 44 + i * 2);
  }
  return buf;
}

async function downloadViaDemo(item) {
  const track =
    DEMO_CATALOG.find((t) => t.id === item.id) ||
    DEMO_CATALOG.find((t) => t.filename === item.filename);
  if (track?.url) {
    try {
      const res = await fetch(track.url, {
        headers: { 'User-Agent': 'Midio-Soulseek-Demo/1.0' },
        redirect: 'follow',
      });
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 1000) {
          return {
            buffer,
            filename: track.filename,
            contentType: mimeFor(track.filename),
          };
        }
      }
    } catch {
      /* fall through to procedural */
    }
  }
  const name = (track?.filename || item.filename || 'midio-demo.wav').replace(/\.mp3$/i, '.wav');
  return {
    buffer: makeProceduralWav(track?.id || item.id || name),
    filename: name.endsWith('.wav') ? name : `${name}.wav`,
    contentType: 'audio/wav',
  };
}

function mimeFor(name) {
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  return (
    {
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      opus: 'audio/opus',
      mid: 'audio/midi',
      midi: 'audio/midi',
    }[ext] || 'application/octet-stream'
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function startSearch(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Empty search query');
  if (q.length > 200) throw new Error('Query too long');

  const cfg = activeConfig();
  if (cfg.mode === 'slskd') {
    const id = await startSlskdSearch(cfg, q);
    return { id, mode: 'slskd' };
  }
  if (cfg.mode === 'direct') {
    const id = await startDirectSearch(cfg, q);
    return { id, mode: 'direct' };
  }
  // Demo — instant
  const id = randomUUID();
  searches.set(id, {
    mode: 'demo',
    query: q,
    status: 'completed',
    results: demoSearch(q),
    createdAt: Date.now(),
  });
  return { id, mode: 'demo' };
}

export function getSearch(id) {
  const s = searches.get(id);
  if (!s) return null;
  return {
    id,
    query: s.query,
    status: s.status,
    mode: s.mode,
    error: s.error || null,
    results: s.results || [],
    resultCount: (s.results || []).length,
  };
}

export async function downloadResult(item) {
  if (!item || typeof item !== 'object') throw new Error('Missing download item');
  const cfg = activeConfig();
  const source = item.source || cfg.mode;

  if (source === 'demo' || cfg.mode === 'demo') {
    return downloadViaDemo(item);
  }
  if (source === 'slskd' || cfg.mode === 'slskd') {
    return downloadViaSlskd(cfg, item);
  }
  if (source === 'direct' || cfg.mode === 'direct') {
    return downloadViaDirect(cfg, item);
  }
  return downloadViaDemo(item);
}

export function listDemoCatalog() {
  return DEMO_CATALOG.map((t) => ({
    ...t,
    sizeLabel: formatBytes(t.size),
  }));
}
