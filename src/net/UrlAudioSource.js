// Loading a song from a URL instead of a file picker.
//
// WHY THIS EXISTS. An `<input type="file">` only opens a chooser if the
// browser implements one. An Android WebView does not implement it itself --
// it calls `WebChromeClient.onShowFileChooser()` and the *host app* decides.
// An app that never overrides that method gets no chooser at all, and the
// tap that should have opened one instead leaves the hidden input focused,
// so Android raises the soft keyboard. That is the whole bug as a player
// sees it: "the upload button just opens the keyboard".
//
// Fermata (github.com/AndreyPavlenko/Fermata) is one such app. Its
// `FermataChromeClient` overrides the JS dialogs, fullscreen, geolocation
// and permission callbacks and nothing else -- `onShowFileChooser` and
// `FileChooserParams` appear nowhere in that repository. No markup or
// script this page can serve will make a chooser appear there, and the File
// System Access API (`showOpenFilePicker`) does not exist in a WebView
// either. The button is not fixable from our side; it needs a different
// route to the bytes.
//
// So: a URL. `loadAudioFiles()` in main.js wants objects with `name`,
// `size` and `arrayBuffer()`, which is exactly a `File` -- so a fetched
// blob wrapped as a File plays, analyses and caches identically to a drop,
// and nothing downstream of the picker changes. (`JamendoSource.js` already
// reaches the pipeline this way.)
//
// MIXED CONTENT, AND WHY LOOPBACK IS THE USEFUL CASE. supermaudio.com is
// https, and an https page may not fetch http:// subresources. The one
// carve-out is loopback: 127.0.0.0/8, `localhost` and `[::1]` count as
// "potentially trustworthy" origins, so they are not treated as mixed
// content. That carve-out is what makes this feature worth having on a
// phone -- a file-server app running on the same phone as Fermata is
// reachable at `http://127.0.0.1:<port>`, and its music is the music the
// player actually wants. A plain LAN address (http://192.168.x.x) is *not*
// exempt and will be blocked, so `classifyUrl` rejects it up front with an
// explanation rather than letting fetch fail opaquely.
//
// CORS IS STILL REQUIRED and cannot be worked around from a page. A
// `no-cors` fetch yields an opaque response whose bytes are unreadable, so
// it is useless for decoding. The server has to send
// `Access-Control-Allow-Origin`. `tools/music-server.mjs` in this repo is a
// minimal one that does; `docs/chooserless-webviews.md` covers the setup.
import {
  AUDIO_LOAD_LIMITS, validateAudioBytes,
} from '../audio/loadLimits.js';

const LISTING_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 45000;

/** Extensions the picker accepts, so a URL and a drop agree on "audio". */
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.mid', '.midi'];

const MIME_BY_EXTENSION = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
};

export class UrlAudioError extends Error {}

/** True for the loopback hosts the mixed-content rules treat as secure.
 *  The whole 127.0.0.0/8 block qualifies, not just 127.0.0.1, and an IPv6
 *  literal arrives from `URL` still wrapped in its brackets. */
export function isLoopbackHost(host) {
  const name = String(host || '').toLowerCase();
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (name === '[::1]' || name === '::1') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(name)
    && name.split('.').every((part) => Number(part) <= 255);
}

export function extensionOf(name) {
  const match = /\.[a-z0-9]+$/i.exec(String(name || ''));
  return match ? match[0].toLowerCase() : '';
}

export function isAudioName(name) {
  return AUDIO_EXTENSIONS.includes(extensionOf(name));
}

/** A filename for a fetched URL. The last non-empty path segment is what a
 *  player recognises ("03 Airbag.flac"), percent-decoded because a server
 *  that had to escape a space should not surface it as `%20` in the HUD. */
export function audioNameFromUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = String(url || '');
  }
  const segment = pathname.split('/').filter(Boolean).pop() || '';
  let name;
  try {
    name = decodeURIComponent(segment);
  } catch {
    name = segment; // a malformed escape is not worth failing a load over
  }
  return name || 'url-audio';
}

/**
 * Decides whether a URL is worth attempting before any request is made, so
 * the failure a player sees names the actual problem. Returns
 * `{ ok, url, code, message }`; `code` is stable for tests and for the UI.
 *
 * @param {string} raw      what the player typed
 * @param {string} pageUrl  the page's own URL (injected for testability)
 */
export function classifyUrl(raw, pageUrl = 'https://supermaudio.com/') {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, code: 'empty', message: 'Enter a URL first.' };

  let url;
  try {
    // Resolving against the page lets a bare `127.0.0.1:8080/song.mp3` work,
    // which is what someone typing on a car screen will actually enter.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `http://${text}`, pageUrl);
  } catch {
    return { ok: false, code: 'invalid', message: `"${text}" is not a URL.` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // file:// is the one people reach for first, and it is the one thing a
    // page can never read -- say so explicitly instead of "invalid URL".
    const extra = url.protocol === 'file:'
      ? ' A web page cannot read file:// paths; serve the folder over HTTP instead.'
      : '';
    return {
      ok: false,
      code: 'scheme',
      message: `Only http:// and https:// URLs can be loaded.${extra}`,
    };
  }

  let pageIsSecure = false;
  try {
    pageIsSecure = new URL(pageUrl).protocol === 'https:';
  } catch { /* treat an unparseable page URL as insecure: attempt the fetch */ }

  if (pageIsSecure && url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return {
      ok: false,
      code: 'mixed-content',
      message: `This page is served over https, so it cannot load http://${url.hostname}`
        + ' -- the browser blocks it as mixed content. Loopback addresses'
        + ' (http://127.0.0.1) are exempt, so a server running on this same'
        + ' device works; anything else needs https.',
    };
  }

  return { ok: true, url: url.href, code: 'ok', message: '' };
}

/** fetch() with a hard timeout. A request to a host that is listening but
 *  never answers hangs rather than rejecting, which would leave the UI
 *  reading "Loading..." with no way out but a reload. */
async function fetchWithTimeout(url, ms, signal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } catch (err) {
    if (signal?.aborted) throw err; // the caller's own cancellation, not ours
    if (err?.name === 'AbortError') {
      throw new UrlAudioError(`Timed out after ${Math.round(ms / 1000)}s waiting for ${url}.`);
    }
    // A CORS rejection, a refused connection and a wrong port are
    // indistinguishable here by design -- fetch reports "Failed to fetch"
    // for all three so a page cannot probe the network. Since a missing
    // CORS header is overwhelmingly the likeliest cause for a local file
    // server, name it first rather than leaving the player with nothing.
    throw new UrlAudioError(
      `Could not reach ${url}. Either nothing is listening there, or the`
      + ' server did not send an Access-Control-Allow-Origin header (a page'
      + ' cannot read a response without it).',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Pulls playable audio links out of a directory index. This is the part
 * that answers "let me *see* the files" rather than "let me type one
 * path": point it at a folder on a local file server and the page shows
 * what is in it.
 *
 * The HTML is never inserted into the document -- only `href` attributes
 * are read, and each is resolved against the listing's own URL, so a
 * hostile index can contribute a link and nothing more.
 *
 * @param {string} html
 * @param {string} baseUrl
 * @param {{ parse?: (html: string) => Document }} [deps]
 */
export function parseListing(html, baseUrl, deps = {}) {
  const parse = deps.parse
    || ((text) => new DOMParser().parseFromString(text, 'text/html'));
  let doc;
  try {
    doc = parse(String(html || ''));
  } catch {
    return { entries: [], folders: [] };
  }
  const seen = new Set();
  const entries = [];
  const folders = [];
  const base = safeUrl(baseUrl);
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) continue;
    const resolved = safeUrl(href, baseUrl);
    if (!resolved) continue;
    if (seen.has(resolved.href)) continue;
    seen.add(resolved.href);

    if (resolved.pathname.endsWith('/')) {
      // Every directory index links to its own parent; following that link
      // back up is fine, but listing it as a subfolder is not.
      if (base && !isDescendantPath(base.pathname, resolved.pathname)) continue;
      folders.push({ name: folderLabel(resolved), url: resolved.href });
      continue;
    }
    if (!isAudioName(resolved.pathname)) continue;
    // The link text is usually the filename and is the friendlier label,
    // but an index that labels links "download" is better off with the path.
    const label = (anchor.textContent || '').trim();
    entries.push({
      name: isAudioName(label) ? label : audioNameFromUrl(resolved.href),
      url: resolved.href,
    });
  }
  return { entries, folders };
}

/** `new URL` without the try/catch at every call site. */
function safeUrl(raw, base = undefined) {
  try {
    return base === undefined ? new URL(raw) : new URL(raw, base);
  } catch {
    return null;
  }
}

function isDescendantPath(basePath, candidatePath) {
  const parent = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return candidatePath.length > parent.length && candidatePath.startsWith(parent);
}

function folderLabel(url) {
  const segment = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
  try {
    return decodeURIComponent(segment) || '/';
  } catch {
    return segment || '/';
  }
}

/** The JSON shape `tools/music-server.mjs` serves --
 *  `{ folders: [...], files: [{name, url}] }` -- and the looser shapes
 *  other local servers emit: a bare array, or one of strings. Accepting all
 *  of them means a player can point this at whatever they already run. */
export function parseJsonListing(json, baseUrl) {
  const fileRows = Array.isArray(json) ? json : (Array.isArray(json?.files) ? json.files : []);
  const folderRows = Array.isArray(json?.folders) ? json.folders : [];
  const entries = [];
  const folders = [];

  for (const row of fileRows) {
    const rawName = typeof row === 'string' ? row : (row?.name || row?.url || '');
    const rawUrl = typeof row === 'string' ? row : (row?.url || row?.name || '');
    if (!rawName || !rawUrl) continue;
    const resolved = safeUrl(rawUrl, baseUrl);
    if (!resolved) continue;
    if (!isAudioName(resolved.pathname) && !isAudioName(rawName)) continue;
    entries.push({ name: audioNameFromUrl(resolved.href) || String(rawName), url: resolved.href });
  }

  for (const row of folderRows) {
    const rawUrl = typeof row === 'string' ? row : (row?.url || row?.name || '');
    if (!rawUrl) continue;
    const resolved = safeUrl(rawUrl, baseUrl);
    if (!resolved) continue;
    const name = typeof row === 'object' && row?.name ? String(row.name) : folderLabel(resolved);
    folders.push({ name, url: resolved.href });
  }

  return { entries, folders };
}

/**
 * Downloads one URL and wraps it as a File the drop pipeline accepts.
 *
 * The size limit is checked against `Content-Length` *before* the body is
 * read, so a mistyped URL pointing at a disk image is refused instead of
 * being pulled down in full first; the received bytes are re-checked
 * afterwards because Content-Length is a claim, not a guarantee.
 */
export async function fetchAudioAsFile(url, { signal = null, limits = AUDIO_LOAD_LIMITS } = {}) {
  const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS, signal);
  if (!res.ok) {
    throw new UrlAudioError(`${url} returned HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`);
  }
  const name = audioNameFromUrl(url);
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limits.maxFileBytes) {
    throw new UrlAudioError(
      `${name} is ${Math.round(declared / (1024 * 1024))}MB, over the`
      + ` ${Math.round(limits.maxFileBytes / (1024 * 1024))}MB limit.`,
    );
  }
  const blob = await res.blob();
  try {
    validateAudioBytes(blob.size, name, limits);
  } catch (err) {
    throw new UrlAudioError(err.message);
  }
  if (blob.size === 0) throw new UrlAudioError(`${name} came back empty.`);
  const type = blob.type && blob.type !== 'application/octet-stream'
    ? blob.type
    : (MIME_BY_EXTENSION[extensionOf(name)] || 'audio/mpeg');
  return new File([blob], name, { type });
}

/**
 * The one entry point the UI needs: given what the player typed, either
 * hand back a playable File or a list of what is in that folder.
 *
 * Which one is decided by the response's own Content-Type rather than by
 * guessing from the URL, because a directory index is served both with and
 * without a trailing slash and both with and without a filename.
 *
 * @returns {Promise<{ kind: 'audio', file: File }
 *   | { kind: 'listing', entries: Array<{name:string,url:string}>,
 *       folders: Array<{name:string,url:string}>, url: string }>}
 */
export async function openAudioUrl(raw, { pageUrl = undefined, signal = null, limits = AUDIO_LOAD_LIMITS } = {}) {
  const verdict = pageUrl === undefined ? classifyUrl(raw) : classifyUrl(raw, pageUrl);
  if (!verdict.ok) throw new UrlAudioError(verdict.message);
  const url = verdict.url;

  // A URL that plainly names an audio file is fetched straight as audio --
  // no HEAD probe, so the common case costs exactly one request.
  if (isAudioName(new URL(url).pathname)) {
    return { kind: 'audio', file: await fetchAudioAsFile(url, { signal, limits }) };
  }

  const res = await fetchWithTimeout(url, LISTING_TIMEOUT_MS, signal);
  if (!res.ok) {
    throw new UrlAudioError(`${url} returned HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`);
  }
  const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();

  if (contentType.includes('json')) {
    const { entries, folders } = parseJsonListing(await res.json(), url);
    if (!entries.length && !folders.length) {
      throw new UrlAudioError(`No audio files listed at ${url}.`);
    }
    return { kind: 'listing', entries, folders, url };
  }
  if (contentType.includes('html')) {
    const { entries, folders } = parseListing(await res.text(), url);
    if (!entries.length && !folders.length) {
      throw new UrlAudioError(
        `No audio links found at ${url}. If that is a folder, make sure the`
        + ' server serves a directory index.',
      );
    }
    return { kind: 'listing', entries, folders, url };
  }

  // Not a listing and not an audio-looking path: an extensionless URL from
  // a server that streams audio anyway. Take the bytes it already sent.
  if (contentType.startsWith('audio/') || contentType.includes('octet-stream') || !contentType) {
    const blob = await res.blob();
    try {
      validateAudioBytes(blob.size, audioNameFromUrl(url), limits);
    } catch (err) {
      throw new UrlAudioError(err.message);
    }
    if (blob.size === 0) throw new UrlAudioError(`${url} came back empty.`);
    const name = audioNameFromUrl(url);
    const withExtension = isAudioName(name) ? name : `${name}.mp3`;
    return {
      kind: 'audio',
      file: new File([blob], withExtension, { type: blob.type || 'audio/mpeg' }),
    };
  }

  throw new UrlAudioError(`${url} served ${contentType}, which is neither audio nor a folder listing.`);
}
