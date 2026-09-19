// Filling in the tags a rip never had, from MusicBrainz.
//
// Free, keyless, CORS-open, and the same shape of dependency the lyrics path
// already takes on LRCLIB -- which is most of why it is the choice here.
// The alternative worth naming is AcoustID, which identifies a recording
// from its audio rather than its filename and would be strictly better; it
// also needs a Chromaprint build and a full decode per track, which turns a
// thousand-file folder from a minute of metadata lookups into an afternoon
// of CPU. This reads what the filename already says and asks whether a real
// release matches it.
//
// MusicBrainz asks anonymous clients for one request per second. That is not
// advice -- exceeding it gets an IP throttled, so the limit is enforced here
// by construction rather than hoped for, and the whole queue runs at that
// pace in the background while the player browses.
//
// Everything that decides anything is pure and exported; `fetchFn`, the
// clock and the sleep are all injected, so the ranking can be tested against
// fixtures without a network or a wall clock.

import { stripSearchNoise } from '../lyrics/SongIdentity.js';

const BASE = 'https://musicbrainz.org/ws/2/recording';
const FETCH_TIMEOUT_MS = 6000;

/** MusicBrainz's published anonymous rate. */
export const MIN_INTERVAL_MS = 1100;

/** Below this, MusicBrainz's own match score says it guessed. Writing a
 *  wrong artist over a right filename is worse than leaving the filename
 *  alone, so the bar is set where a miss stays a miss. */
const MIN_SCORE = 80;

/** How far a candidate's length may sit from the real one, when we know the
 *  real one. Different masters of the same song differ by a second or two;
 *  a different song entirely usually differs by more. */
const DURATION_TOLERANCE_SEC = 8;

/** How much of the two titles must be the same word for a candidate to be
 *  about the same song. Set from the case it exists for: "Paranoid Android"
 *  against "Paranoid" scores 0.5, and they are different songs. */
const MIN_TITLE_SIMILARITY = 0.6;

/** Lucene's syntax characters, neutralised. A song called "C++" or
 *  "Where?" is a query that would otherwise fail to parse. */
export function escapeLucene(value) {
  return String(value || '').replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1').trim();
}

/**
 * Build the search query for a track.
 *
 * Returns null when there is nothing worth asking -- a track with no title
 * guess at all would search for the empty string and get back the database's
 * idea of a popular song, which is the single worst thing to write into
 * someone's library.
 */
export function buildRecordingQuery({ artist = null, title = null, durationSec = null } = {}) {
  const t = escapeLucene(title);
  if (!t) return null;
  const parts = [`recording:"${t}"`];
  const a = escapeLucene(artist);
  if (a) parts.push(`artist:"${a}"`);
  if (Number.isFinite(durationSec) && durationSec > 0) {
    // `dur` is milliseconds. A range rather than a value: it narrows a
    // common title to the right recording without excluding a master that
    // fades a second later than the one on disk.
    const ms = Math.round(durationSec * 1000);
    const slack = DURATION_TOLERANCE_SEC * 1000;
    parts.push(`dur:[${Math.max(0, ms - slack)} TO ${ms + slack}]`);
  }
  return parts.join(' AND ');
}

/** Jaccard over lowercased word sets, after the release qualifiers are
 *  stripped from both sides.
 *
 *  The stripping is what makes the measure usable at all: a library tagged
 *  "Song" against a MusicBrainz title of "Song (2011 Remaster)" shares one
 *  word in four and would otherwise fail the very comparison it should
 *  sail through, while "Paranoid Android" against "Paranoid" -- two
 *  different songs -- shares half and would pass. Qualifiers are noise on
 *  both sides, and `stripSearchNoise` already knows which words they are.
 *
 *  Not meant as a general string distance. */
export function titleSimilarity(a, b) {
  const words = (raw) => {
    const text = String(raw || '');
    const clean = stripSearchNoise(text) ?? text;
    return new Set(clean.toLowerCase().match(/[a-z0-9]+/g) || []);
  };
  const sa = words(a), sb = words(b);
  if (!sa.size && !sb.size) return 1;
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function creditedArtist(recording) {
  const credits = recording?.['artist-credit'];
  if (!Array.isArray(credits) || !credits.length) return null;
  // Join on each credit's own joinphrase so "Artist feat. Other" comes back
  // the way the release prints it rather than as two separate names.
  return credits.map((c) => `${c?.name || c?.artist?.name || ''}${c?.joinphrase || ''}`).join('').trim() || null;
}

/** Release-group secondary types that mean "this is not where the song came
 *  from". A search result is dominated by compilations and DJ mixes -- they
 *  outnumber the original album and are dated later -- so taking the
 *  earliest release outright files a studio track under whichever mix CD
 *  happens to be listed first. */
const NOT_AN_ORIGINAL = new Set(['compilation', 'dj-mix', 'live', 'remix', 'mixtape/street', 'demo']);

function isOriginalRelease(release) {
  const secondary = release?.['release-group']?.['secondary-types'];
  if (!Array.isArray(secondary)) return true;
  return !secondary.some((type) => NOT_AN_ORIGINAL.has(String(type).toLowerCase()));
}

function releaseYear(release) {
  const year = parseInt(String(release?.date || '').slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/** Which release to call the album: the earliest one that looks like an
 *  original, or -- if every listed release is a compilation -- the earliest
 *  of those, because a compilation is still a truer answer than nothing. */
function bestRelease(recording) {
  const releases = Array.isArray(recording?.releases) ? recording.releases : [];
  if (!releases.length) return null;
  const originals = releases.filter(isOriginalRelease);
  const pool = originals.length ? originals : releases;
  let best = null;
  for (const release of pool) {
    const year = releaseYear(release);
    if (!best) { best = { release, year }; continue; }
    if (year !== null && (best.year === null || year < best.year)) best = { release, year };
  }
  return best;
}

/** The year the RECORDING first appeared, which MusicBrainz states directly
 *  and is what someone means by a song's year -- not the year of whichever
 *  reissue we ended up naming as the album. */
function recordingYear(recording, release) {
  const first = parseInt(String(recording?.['first-release-date'] || '').slice(0, 4), 10);
  if (Number.isFinite(first)) return first;
  return release?.year ?? null;
}

/**
 * Choose a tag from a MusicBrainz result list, or return null.
 *
 * Null is a first-class answer here and the common one for a badly named
 * file. Nothing downstream writes a null result, so a track that cannot be
 * identified keeps the name it came with.
 */
export function pickBest(recordings, { title = null, durationSec = null } = {}) {
  const list = Array.isArray(recordings) ? recordings : [];
  let best = null;
  for (const rec of list) {
    const score = Number(rec?.score) || 0;
    if (score < MIN_SCORE) continue;
    const similarity = titleSimilarity(title, rec?.title);
    // MusicBrainz scores a query against its index; this checks the answer
    // against what we actually asked about. A high score for a title that
    // shares no words with ours is the search engine being helpful in a way
    // we do not want.
    if (title && similarity < MIN_TITLE_SIMILARITY) continue;
    if (Number.isFinite(durationSec) && durationSec > 0 && Number.isFinite(rec?.length)) {
      if (Math.abs(rec.length / 1000 - durationSec) > DURATION_TOLERANCE_SEC) continue;
    }
    const rank = score + similarity * 20;
    if (!best || rank > best.rank) best = { rec, rank, similarity, score };
  }
  if (!best) return null;
  const release = bestRelease(best.rec);
  return {
    title: best.rec.title || null,
    artist: creditedArtist(best.rec),
    album: release?.release?.title || null,
    year: recordingYear(best.rec, release),
    tagSource: 'auto',
    confidence: Math.min(1, best.score / 100),
  };
}

async function fetchJson(fetchFn, url) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res?.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Look one track up. Resolves to a tag patch or null; never throws.
 *
 * Two attempts at most: the filename's guess as-is, then -- if it offered an
 * artist and got nothing -- the title alone. A "Artist - Title" split that
 * put the wrong half on each side is the common way a filename lies, and
 * dropping the artist constraint is the cheapest way to survive it.
 */
export async function lookupTags({ artist = null, title = null, durationSec = null } = {}, fetchFn = (typeof fetch !== 'undefined' ? fetch : null)) {
  if (!fetchFn || !title) return null;
  for (const attempt of artist ? [{ artist, title }, { artist: null, title }] : [{ artist: null, title }]) {
    const query = buildRecordingQuery({ ...attempt, durationSec });
    if (!query) continue;
    const url = `${BASE}?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
    const json = await fetchJson(fetchFn, url);
    const picked = pickBest(json?.recordings, { title, durationSec });
    if (picked) return picked;
  }
  return null;
}

/**
 * A queue that never asks MusicBrainz faster than it allows.
 *
 * The pacing is a floor on the gap between REQUESTS, measured from when the
 * last one started, not a sleep after each one: a lookup that itself took
 * two seconds has already paid the interval and should not wait again. That
 * distinction is why the clock is injected rather than read directly.
 */
export function createTagQueue({
  fetchFn = (typeof fetch !== 'undefined' ? fetch : null),
  minIntervalMs = MIN_INTERVAL_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  lookup = lookupTags,
} = {}) {
  let lastStartMs = -Infinity;

  return {
    /**
     * Tag `tracks` one at a time, calling `onResult(track, patch)` after
     * each -- patch is null when nothing was found. Results are reported as
     * they arrive rather than in a batch at the end, because at one per
     * second a folder of two hundred takes four minutes and the player
     * should watch it fill in, not wait for it.
     */
    async run(tracks, { onResult = null, onProgress = null, signal = null } = {}) {
      const list = [...(tracks || [])];
      let tagged = 0;
      for (let i = 0; i < list.length; i++) {
        if (signal?.aborted) break;
        const wait = lastStartMs + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
        if (signal?.aborted) break;
        lastStartMs = now();
        const track = list[i];
        const patch = await lookup(
          { artist: track.artist, title: track.title || track.name, durationSec: track.durationSec },
          fetchFn,
        );
        if (patch) tagged++;
        onResult?.(track, patch);
        onProgress?.(i + 1, list.length, tagged);
      }
      return tagged;
    },
  };
}
