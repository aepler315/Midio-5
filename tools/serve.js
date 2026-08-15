// Zero-dependency static file server + Soulseek bridge for local dev/testing.
// Usage: node tools/serve.js [port]
// Binds 0.0.0.0 so the live preview can reach the app.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSoulseekBridge, SoulseekBridgeError } from './soulseek-bridge.js';
import {
  getStatus,
  setConfig,
  startSearch,
  getSearch,
  downloadResult,
  listDemoCatalog,
} from './soulseek-bridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || process.argv[2]) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const soulseek = createSoulseekBridge();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.sf2': 'application/octet-stream',
  '.zip': 'application/zip',
};

const SOUNDFONTS_DIR = path.join(ROOT, 'soundfonts');

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, reqPath) {
  // CORS for local tooling
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  try {
    if (reqPath === '/api/soulseek/status' && req.method === 'GET') {
      sendJson(res, 200, await getStatus());
      return true;
    }

    if (reqPath === '/api/soulseek/config' && req.method === 'POST') {
      const body = await readBody(req);
      const status = setConfig(body || {});
      sendJson(res, 200, { ok: true, ...status, ...(await getStatus()) });
      return true;
    }

    if (reqPath === '/api/soulseek/config' && req.method === 'DELETE') {
      setConfig({ mode: 'clear' });
      sendJson(res, 200, { ok: true, ...(await getStatus()) });
      return true;
    }

    if (reqPath === '/api/soulseek/demo' && req.method === 'GET') {
      sendJson(res, 200, { tracks: listDemoCatalog() });
      return true;
    }

    if (reqPath === '/api/soulseek/search' && req.method === 'POST') {
      const body = await readBody(req);
      const query = body?.query || body?.q || body?.searchText || '';
      const started = await startSearch(query);
      sendJson(res, 200, started);
      return true;
    }

    // GET /api/soulseek/search/:id
    const searchMatch = reqPath.match(/^\/api\/soulseek\/search\/([^/]+)$/);
    if (searchMatch && req.method === 'GET') {
      const data = getSearch(decodeURIComponent(searchMatch[1]));
      if (!data) {
        sendJson(res, 404, { error: 'Search not found' });
        return true;
      }
      sendJson(res, 200, data);
      return true;
    }

    if (reqPath === '/api/soulseek/download' && req.method === 'POST') {
      const body = await readBody(req);
      const item = body?.item || body;
      const result = await downloadResult(item);
      res.writeHead(200, {
        'Content-Type': result.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${result.filename.replace(/"/g, '')}"`,
        'X-Filename': encodeURIComponent(result.filename),
        'Cache-Control': 'no-store',
      });
      res.end(result.buffer);
      return true;
    }

    if (reqPath.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not found', path: reqPath });
      return true;
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  let reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  // Soulseek bridge API: the browser cannot speak the Soulseek TCP protocol,
  // so the dev server holds the connection. Credentials are sent to the
  // local bridge only (which forwards them to server.slsknet.org).
  // Two integrations merged onto main both live behind /api/soulseek/*:
  // the zero-config bridge (soulseek-bridge.mjs, config/demo/poll + free
  // music) and PR #64's connect-based bridge (soulseek-bridge.js). The
  // dispatcher routes each request by its path/body shape so both UIs work.
  if (reqPath.startsWith('/api/soulseek/')) {
    await handleSoulseekRoute(req, res, reqPath);
    return;
  }

  // Soundfont auto-discovery: the client fetches this manifest at boot so
  // dropping a .sf2/.zip into soundfonts/ "just works" without the File
  // System Access API's permission prompt. A static host with no server
  // logic simply 404s here, and the client treats that as "nothing found".
  if (await handleApi(req, res, reqPath)) return;

  // Soundfont auto-discovery
  if (reqPath === '/soundfonts/' || reqPath === '/soundfonts') {
    fs.readdir(SOUNDFONTS_DIR, (err, entries) => {
      const files = err ? [] : entries.filter((f) => /\.(sf2|zip)$/i.test(f)).sort();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(files));
    });
    return;
  }

  const filePath = path.join(ROOT, reqPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + reqPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// --- Soulseek bridge API -------------------------------------------------
// POST /api/soulseek/connect   {user, pass}          -> {user}
// POST /api/soulseek/search    {query, timeoutMs?}   -> [result]
// POST /api/soulseek/download  {file}                -> {name, data(base64)}
// POST /api/soulseek/disconnect                     -> {ok:true}
// GET  /api/soulseek/status                         -> {connected, user}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function handleSoulseekApi(req, res, reqPath) {
  const action = reqPath.slice('/api/soulseek/'.length);
  if (req.method === 'GET' && action === 'status') {
    sendJson(res, 200, { connected: soulseek.isConnected(), user: '' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }
  try {
    switch (action) {
      case 'connect': {
        const r = await soulseek.connect({ user: body.user, pass: body.pass });
        sendJson(res, 200, r);
        return;
      }
      case 'search': {
        const r = await soulseek.search({ query: body.query, timeoutMs: body.timeoutMs });
        sendJson(res, 200, { results: r });
        return;
      }
      case 'download': {
        const r = await soulseek.download({ file: body.file });
        sendJson(res, 200, { name: r.name, data: r.buffer.toString('base64') });
        return;
      }
      case 'disconnect': {
        soulseek.disconnect();
        sendJson(res, 200, { ok: true });
        return;
      }
      default:
        sendJson(res, 404, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    sendJson(res, 500, { error: err instanceof SoulseekBridgeError ? err.message : `Soulseek error: ${err.message}` });
  }
}

/** Routes the merged /api/soulseek/* surface. Two integrations coexist on
 *  main behind these paths: the zero-config mjs bridge (slskPanel /
 *  SoulseekSearch.js: /config, /demo, /search/:id polling, binary downloads)
 *  and the PR #64 connect-based js bridge (SoulseekSource.js: /connect,
 *  /disconnect, synchronous {results} search, base64 downloads). Where the
 *  two overlap (/search, /download, /status) the request body disambiguates:
 *  SoulseekSource always sends `timeoutMs` on search and `file` on download;
 *  SoulseekSearch sends neither. /status returns the mjs superset, which
 *  carries both the `mode`/`note` fields the slskPanel reads and the
 *  `connected`/`user` fields SoulseekSource reads. */
async function handleSoulseekRoute(req, res, reqPath) {
  const action = reqPath.slice('/api/soulseek/'.length);

  // Zero-config bridge only (slskPanel / SoulseekSearch.js)
  if (action === 'config') {
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const status = setConfig(body || {});
        sendJson(res, 200, { ok: true, ...status, ...(await getStatus()) });
      } catch (err) {
        sendJson(res, 400, { error: err.message || String(err) });
      }
      return;
    }
    if (req.method === 'DELETE') {
      setConfig({ mode: 'clear' });
      try {
        sendJson(res, 200, { ok: true, ...(await getStatus()) });
      } catch (err) {
        sendJson(res, 500, { ok: true, error: err.message || String(err) });
      }
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (action === 'demo' && req.method === 'GET') {
    sendJson(res, 200, { tracks: listDemoCatalog() });
    return;
  }

  const searchMatch = reqPath.match(/^\/api\/soulseek\/search\/([^/]+)$/);
  if (searchMatch && req.method === 'GET') {
    const data = getSearch(decodeURIComponent(searchMatch[1]));
    if (!data) {
      sendJson(res, 404, { error: 'Search not found' });
      return;
    }
    sendJson(res, 200, data);
    return;
  }

  // Connect-based bridge only (SoulseekSource.js)
  if (action === 'connect' || action === 'disconnect') {
    return handleSoulseekApi(req, res, reqPath);
  }

  if (req.method !== 'POST') {
    if (action === 'status' && req.method === 'GET') {
      // Superset: both clients read what they need from it.
      try {
        sendJson(res, 200, await getStatus());
      } catch (err) {
        sendJson(res, 500, { mode: 'offline', connected: false, note: err.message || String(err) });
      }
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  if (action === 'search') {
    if (body && typeof body.timeoutMs === 'number') {
      // SoulseekSource: synchronous {results} search.
      try {
        const r = await soulseek.search({ query: body.query, timeoutMs: body.timeoutMs });
        sendJson(res, 200, { results: r });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof SoulseekBridgeError ? err.message : `Soulseek error: ${err.message}` });
      }
    } else {
      // SoulseekSearch: start an async search, poll /search/:id for results.
      const query = body?.query || body?.q || body?.searchText || '';
      try {
        const started = await startSearch(query);
        sendJson(res, 200, started);
      } catch (err) {
        sendJson(res, 500, { error: err.message || String(err) });
      }
    }
    return;
  }

  if (action === 'download') {
    if (body && body.file) {
      // SoulseekSource: base64 download.
      try {
        const r = await soulseek.download({ file: body.file });
        sendJson(res, 200, { name: r.name, data: r.buffer.toString('base64') });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof SoulseekBridgeError ? err.message : `Soulseek error: ${err.message}` });
      }
    } else {
      // SoulseekSearch: binary attachment download.
      const item = body?.item || body;
      try {
        const result = await downloadResult(item);
        res.writeHead(200, {
          'Content-Type': result.contentType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${result.filename.replace(/"/g, '')}"`,
          'X-Filename': encodeURIComponent(result.filename),
          'Cache-Control': 'no-store',
        });
        res.end(result.buffer);
      } catch (err) {
        sendJson(res, 500, { error: err.message || String(err) });
      }
    }
    return;
  }

  sendJson(res, 404, { error: `Unknown action: ${action}` });
}

server.listen(PORT, HOST, async () => {
  console.log(`Super Maudio World + Soulseek at http://${HOST}:${PORT}`);
  const status = await getStatus();
  console.log(`Soulseek backend: ${status.mode} — ${status.note}`);
});
