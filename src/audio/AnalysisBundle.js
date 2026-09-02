// Everything the engine learned about a recording, in a form that can be
// stored, shipped, and handed back later instead of recomputed.
//
// Analysing a dropped song costs tens of seconds of separation, onset and
// pitch work, and the result is identical every time the same recording is
// analysed. This packs that result into a portable object keyed by an
// acoustic fingerprint, so the second play is instant -- and so the same
// artifact can one day be served from a database while the listener's own app
// plays the audio, which is the only way to get a composed show (a real arc,
// on-time sections, a climax in the right place) out of music this page is
// never allowed to touch.
//
// What is NOT in here, deliberately: any audio. A bundle is derived numbers
// only -- band envelopes, onset times, a chroma histogram. It cannot be
// played back or turned into a recording, which is what makes sharing one a
// different act from sharing the song.
//
// Two encoding decisions worth stating, because a naive JSON dump of this
// structure is roughly twenty times larger and would make the whole idea
// impractical to store or serve:
//
//   THE CURVES ARE QUANTIZED. `energyCurves` is seven float arrays at 50Hz --
//   for a four-minute song, 84,000 floats. They are all in 0..1 and every
//   consumer treats them as approximate, so they store as bytes. That is a
//   4x saving with a quantization step of 1/255, far below the precision
//   anything downstream acts on.
//
//   THE TIMELINE IS COLUMNAR. An array of note objects re-states every key
//   name for every note. Stored as parallel typed arrays -- all the times,
//   then all the pitches -- the field names are paid for once.
import { EnergyCurves } from './EnergyCurves.js';
import { BANDS } from './bands.js';
import { Role } from '../core/NoteEvent.js';

/** Bump when the shape changes incompatibly. `unpackBundle` refuses a
 *  version it does not know rather than misreading it, because a bundle
 *  silently decoded under the wrong layout produces a show that is subtly,
 *  inexplicably wrong instead of an error anyone can act on. */
export const BUNDLE_VERSION = 1;

const ROLES = [Role.MELODY, Role.RHYTHM, Role.BASS, Role.PAD];

// --- base64 for typed arrays ----------------------------------------------
// Neither btoa nor Buffer exists in both a browser and node, and this module
// is used from both (the engine packs; the tests read).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | ((c ?? 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export function b64ToBytes(str) {
  const clean = String(str || '').replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

const packU32 = (arr) => bytesToB64(new Uint8Array(Uint32Array.from(arr).buffer));
const unpackU32 = (s) => {
  const bytes = b64ToBytes(s);
  // A copy rather than a view: the decoded bytes are not guaranteed to sit at
  // a 4-byte offset in their own buffer, and Uint32Array demands alignment.
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  return new Uint32Array(aligned.buffer, 0, Math.floor(aligned.length / 4));
};
const packF32 = (arr) => bytesToB64(new Uint8Array(Float32Array.from(arr).buffer));
const unpackF32 = (s) => {
  const bytes = b64ToBytes(s);
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  return new Float32Array(aligned.buffer, 0, Math.floor(aligned.length / 4));
};

/** 0..1 floats to bytes and back. The step is 1/255; nothing downstream acts
 *  on a difference that small. */
function quantize01(arr) {
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    out[i] = v <= 0 || !Number.isFinite(v) ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return out;
}

/**
 * Pack an `audioToTimeline` result plus its identity into a storable object.
 *
 * @param {object} data the analysis, exactly as the adapter returned it
 * @param {object} meta
 * @param {object} meta.fingerprint from fingerprintBuffer()
 * @param {string} [meta.name] the dropped file's name, for display only
 * @param {object} [meta.identity] resolved artist/title, when known
 * @returns {object} JSON-serializable
 */
export function packBundle(data, { fingerprint, name = '', identity = null } = {}) {
  const curves = data.energyCurves;
  const timeline = data.timeline || [];
  const n = timeline.length;
  const tMs = new Float32Array(n), durMs = new Float32Array(n);
  const pitch = new Uint8Array(n), vel = new Uint8Array(n);
  // Role, the kick flag and the source all fit in one byte with room spare.
  const flags = new Uint8Array(n), channel = new Uint8Array(n), pan = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const e = timeline[i];
    tMs[i] = e.tMs; durMs[i] = e.durMs;
    pitch[i] = Math.max(0, Math.min(127, e.pitch | 0));
    vel[i] = Math.round(Math.max(0, Math.min(1, e.vel)) * 255);
    const roleIdx = Math.max(0, ROLES.indexOf(e.role));
    flags[i] = roleIdx | (e.kick ? 0x80 : 0);
    channel[i] = Math.max(0, Math.min(255, e.channel | 0));
    pan[i] = Math.round(Math.max(-1, Math.min(1, e.pan || 0)) * 127);
  }

  return {
    v: BUNDLE_VERSION,
    key: fingerprint?.key || '',
    // The frames themselves, not just the key: a different rip of the same
    // master hashes to a different key, and only the sequence can be aligned
    // against it. This is also what makes a bundle locatable by sound alone.
    fpFrames: fingerprint?.frames ? packU32(fingerprint.frames) : '',
    fpFrameHz: fingerprint?.frameHz || 0,
    name,
    identity: identity ? { artist: identity.artist || '', title: identity.title || '' } : null,
    createdMs: Date.now(),

    durationMs: data.durationMs || 0,
    bpm: data.bpm || 0,
    beatPeriodMs: data.beatPeriodMs || 0,
    confidence: data.confidence ?? 0,
    freeTime: !!data.freeTime,
    barGrid: packF32((data.barGrid || []).map((b) => b.ms)),
    stems: data.stems || null,
    analysis: data.analysis || null,
    structure: data.structure
      ? {
        boundariesMs: packF32(data.structure.boundariesMs || []),
        labels: data.structure.labels || [],
        confidence: data.structure.confidence ?? 0,
      }
      : null,

    curves: curves
      ? {
        rateHz: curves.rateHz,
        n: curves.n,
        bands: curves.bands.map((b) => bytesToB64(quantize01(b))),
      }
      : null,

    notes: {
      count: n,
      tMs: packF32(tMs),
      durMs: packF32(durMs),
      pitch: bytesToB64(pitch),
      vel: bytesToB64(vel),
      flags: bytesToB64(flags),
      channel: bytesToB64(channel),
      pan: bytesToB64(new Uint8Array(pan.buffer, pan.byteOffset, pan.length)),
    },
  };
}

/**
 * Rebuild an analysis from a bundle.
 *
 * The result is shaped exactly like `audioToTimeline`'s return, so every
 * caller downstream is unchanged -- that equivalence is the whole point, and
 * `test/analysisBundle.test.js` pins it by round-tripping a real analysis.
 *
 * @returns {object|null} null when the bundle is unreadable (wrong version,
 *   truncated, hand-edited) -- the caller then analyses from scratch, which
 *   is slow but always correct.
 */
export function unpackBundle(bundle) {
  if (!bundle || bundle.v !== BUNDLE_VERSION) return null;
  try {
    const barMs = unpackF32(bundle.barGrid || '');
    const barGrid = Array.from(barMs, (ms, index) => ({ ms, index }));

    let energyCurves = null;
    if (bundle.curves) {
      energyCurves = new EnergyCurves(1, bundle.curves.rateHz || 50);
      energyCurves.n = bundle.curves.n;
      energyCurves.bands = bundle.curves.bands.map((s) => {
        const bytes = b64ToBytes(s);
        const out = new Float32Array(bundle.curves.n);
        for (let i = 0; i < out.length; i++) out[i] = (bytes[i] || 0) / 255;
        return out;
      });
      energyCurves._calCache = new Map();
    }

    const nt = bundle.notes?.count || 0;
    const tMs = unpackF32(bundle.notes?.tMs || '');
    const durMs = unpackF32(bundle.notes?.durMs || '');
    const pitch = b64ToBytes(bundle.notes?.pitch || '');
    const vel = b64ToBytes(bundle.notes?.vel || '');
    const flags = b64ToBytes(bundle.notes?.flags || '');
    const channel = b64ToBytes(bundle.notes?.channel || '');
    const panBytes = b64ToBytes(bundle.notes?.pan || '');
    const timeline = new Array(nt);
    for (let i = 0; i < nt; i++) {
      const pan8 = panBytes[i] > 127 ? panBytes[i] - 256 : panBytes[i];
      timeline[i] = {
        tMs: tMs[i], durMs: durMs[i], pitch: pitch[i], vel: vel[i] / 255,
        role: ROLES[flags[i] & 0x7f] || Role.MELODY,
        kick: !!(flags[i] & 0x80),
        src: 'audio', channel: channel[i], pan: (pan8 || 0) / 127, program: -1, lane: null,
      };
    }

    return {
      timeline, barGrid,
      durationMs: bundle.durationMs || 0,
      bpm: bundle.bpm || 0,
      beatPeriodMs: bundle.beatPeriodMs || 0,
      confidence: bundle.confidence ?? 0,
      freeTime: !!bundle.freeTime,
      energyCurves,
      analysis: bundle.analysis || null,
      structure: bundle.structure
        ? {
          boundariesMs: Array.from(unpackF32(bundle.structure.boundariesMs || '')),
          labels: bundle.structure.labels || [],
          // A restored bundle carries no novelty curve: nothing reads it
          // after the boundaries are chosen, and it is the largest array in
          // the structure for no downstream benefit.
          novelty: [],
          cutIndices: [],
          confidence: bundle.structure.confidence ?? 0,
        }
        : null,
      stems: bundle.stems || null,
      /** Set so the rest of the app can tell a restored analysis from a fresh
       *  one -- for the progress copy, and so a bug here is attributable. */
      fromBundle: true,
    };
  } catch {
    return null;
  }
}

/** The fingerprint frames a bundle was keyed by, for alignment. */
export function bundleFrames(bundle) {
  return bundle?.fpFrames ? unpackU32(bundle.fpFrames) : new Uint32Array(0);
}
