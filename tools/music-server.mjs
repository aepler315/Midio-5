#!/usr/bin/env node
// A minimal music file server for the "browser with no file chooser" case.
//
// WHY THIS IS NEEDED AT ALL. Fermata's built-in browser never implements
// `WebChromeClient.onShowFileChooser()`, so `<input type="file">` cannot
// open a chooser there and the page has no way to read a file off the
// device (see docs/chooserless-webviews.md). The way in that remains is a
// URL -- but a page can only read a cross-origin response if the server
// sends `Access-Control-Allow-Origin`, and the ordinary options
// (`python3 -m http.server`, most Android file-manager "share over HTTP"
// features) do not send it. Their bytes arrive and are then unreadable.
//
// So this serves a music folder with the two things the page needs: CORS,
// and a listing it can turn into a browsable list.
//
// Run it on the SAME device as the browser. An https page may not fetch
// http:// URLs, with one exception: loopback (127.0.0.1, localhost, ::1)
// counts as a potentially-trustworthy origin and is not treated as mixed
// content. So `http://127.0.0.1:8088` is readable from
// https://supermaudio.com, while `http://192.168.1.50:8088` is blocked. On
// a phone that runs both Fermata and the music, loopback is exactly right.
//
//   node tools/music-server.mjs ~/Music            # then load http://127.0.0.1:8088/
//   node tools/music-server.mjs ~/Music 9000       # a different port
//   MUSIC_HOST=0.0.0.0 node tools/music-server.mjs ~/Music
//
// On Android this runs under Termux (`pkg install nodejs`).
//
// SCOPE. Read-only, GET/HEAD/OPTIONS only, and every request is confined to
// the one directory given on the command line -- `..`, dotfiles and
// symlinks that escape the root are refused. It binds loopback by default,
// so nothing is exposed to the network unless MUSIC_HOST says otherwise.
// It is a local convenience, not a public file server: it has no
// authentication, so do not bind it to a public interface.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// Canonicalised, not merely resolved. Containment is checked by comparing
// against `fsp.realpath()` of each request path, so if ROOT is itself a
// symlink the two live in different trees and EVERY request -- `/` included
// -- looks like an escape and 403s. That is not hypothetical: on the
// documented Termux setup, shared-storage music paths are normally reached
// through exactly such a symlink.
const ROOT_ARG = path.resolve(process.argv[2] || process.env.MUSIC_DIR || process.cwd());
let ROOT;
try {
  ROOT = fs.realpathSync(ROOT_ARG);
} catch {
  console.error(`music-server: cannot read ${ROOT_ARG}`);
  process.exit(1);
}
const PORT = Number(process.argv[3] || process.env.MUSIC_PORT) || 8088;
const HOST = process.env.MUSIC_HOST || '127.0.0.1';

const MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};
// No .mid/.midi: the page's URL loader sends everything to decodeAudioData
// and has no MIDI ingest path, so listing one would advertise a song that
// cannot play. See the note in src/net/UrlAudioSource.js.
const AUDIO_EXTENSIONS = new Set(Object.keys(MIME));

function isAudio(name) {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Resolves a request path inside ROOT, or null if it tries to leave.
 *  Rejecting `..` and dotfiles per segment before resolving avoids the
 *  same-prefix sibling trap a string check on the resolved path has
 *  (`/music` must not admit `/music-private`). */
function safePath(reqPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(reqPath.split('?')[0]);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..' || s.startsWith('.'))) return null;
  const full = path.resolve(ROOT, ...segments);
  const relative = path.relative(ROOT, full);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return full;
}

/** Same containment check after symlinks are followed -- a link inside the
 *  folder can still point outside it. */
async function realPathInRoot(full) {
  const real = await fsp.realpath(full);
  const relative = path.relative(ROOT, real);
  if (relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) return null;
  return real;
}

function corsHeaders() {
  return {
    // The page fetching this is a different origin by definition, and
    // without this header its JavaScript cannot read the bytes at all.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Range,Content-Type',
    // A cross-origin reader only sees these response headers if they are
    // explicitly exposed; Content-Length is how the page refuses an
    // oversized file before downloading it.
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges',
  };
}

async function sendListing(res, dir, urlPath) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const base = urlPath.endsWith('/') ? urlPath : `${urlPath}/`;
  const folders = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) folders.push(`${base}${encodeURIComponent(entry.name)}/`);
    else if (entry.isFile() && isAudio(entry.name)) {
      files.push({ name: entry.name, url: `${base}${encodeURIComponent(entry.name)}` });
    }
  }
  folders.sort();
  files.sort((a, b) => a.name.localeCompare(b.name));
  res.writeHead(200, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ path: base, folders, files }));
}

function sendFile(req, res, file, size) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = {
    ...corsHeaders(),
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
  };

  // Range support: the page reads whole files, but a plain <audio> element
  // pointed at the same URL will ask for ranges and misbehave without it.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : 0;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (!range[1]) start = Math.max(0, size - Number(range[2])); // suffix range
    if (!range[1]) end = size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { ...corsHeaders(), 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': String(size) });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...corsHeaders(), Allow: 'GET, HEAD, OPTIONS' });
    res.end();
    return;
  }

  const urlPath = (req.url || '/').split('?')[0] || '/';
  const full = safePath(urlPath);
  if (!full) {
    res.writeHead(403, { ...corsHeaders(), 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  try {
    const real = await realPathInRoot(full);
    if (!real) {
      res.writeHead(403, { ...corsHeaders(), 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    const stat = await fsp.stat(real);
    if (stat.isDirectory()) await sendListing(res, real, urlPath);
    else if (stat.isFile() && isAudio(real)) sendFile(req, res, real, stat.size);
    else {
      res.writeHead(404, { ...corsHeaders(), 'Content-Type': 'text/plain' });
      res.end('Not an audio file');
    }
  } catch {
    res.writeHead(404, { ...corsHeaders(), 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`music-server: serving ${ROOT}`);
  console.log(`  http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/`);
  console.log('  Paste that into Midio\'s "Load from a URL" field.');
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log('  NOTE: bound to a non-loopback address. An https page cannot');
    console.log('  fetch http:// from a LAN address -- only loopback is exempt.');
  }
});
