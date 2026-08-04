// Shared numeric helpers used across the simulation, renderer, and audio pipeline.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function clamp01(v) {
  // Coerce non-finite values (undefined/NaN) to 0 so callers that run before
  // their first update() never poison canvas alphas with "rgba(...,NaN)".
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Soft 1-D separation impulse: 0 outside minDist, smooth quadratic push
 * inside. Not a hard wall — characters ease apart when they crowd.
 * Returns acceleration-like units (caller multiplies by dtSec).
 */
export function softRepel1D(myX, otherX, minDist, strength) {
  if (!(minDist > 0) || !(strength > 0)) return 0;
  const d = myX - otherX;
  const ad = Math.abs(d);
  if (ad >= minDist) return 0;
  if (ad < 1e-4) return strength; // coincident: arbitrary + direction
  const t = 1 - ad / minDist;
  return Math.sign(d) * strength * t * t;
}

/** Mulberry32 seeded PRNG — deterministic, fast, good enough for visuals. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic string/number hash → 32-bit unsigned int, used to seed song-keyed RNGs. */
export function hashSeed(input) {
  const s = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randRange(rand, lo, hi) {
  return lo + rand() * (hi - lo);
}

/** Shortest-arc lerp between two hue angles in degrees, result wrapped to [0, 360). */
export function lerpHue(h0, h1, t) {
  let d = ((h1 - h0 + 540) % 360) - 180;
  return (h0 + d * t + 360) % 360;
}

/** Deterministic Fisher-Yates shuffle driven by a seeded rand(). */
export function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
