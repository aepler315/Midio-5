// Cathode's boss: one dominant pixel sprite standing on the horizon, not a
// small cast quietly taking turns. Feedback on the first two phases was
// specific -- "no characters, and even if there were [a quiet per-instrument
// cast] would bore me to tears" -- so this replaces that plan rather than
// building it: a boss-fight presence that flinches on the beat and tears
// itself apart on a drop, sized to dominate a 320x180 frame the way a boss
// portrait dominates an arcade attract screen.
//
// Authored the same way the skyline is: digit rows are RELATIVE ramp
// levels (0 = darkest outline, 3 = brightest/screen-glow), mapped onto
// whichever persona's ramp is live -- so the boss's color story changes
// with the hardware era for free, through the exact mechanism the skyline
// already uses (see CathodePalettes.rampAt). "Changes form per era" is one
// small swappable topper (antenna/slab/bolt) rather than five full sprites.
import { mulberry32 } from '../../utils/math.js';

const T = '.'; // transparent, kept as a named const so the art below reads

/** Boss body, digit = relative ramp level 0..MAX_REL, '.' = transparent.
 *  Rows are padded to equal width by parseSpriteRows, so they don't all
 *  need to be typed to the same length by hand. A CRT-headed figure:
 *  antenna slot, a screen for a face, blocky shoulders, short legs. */
export const BOSS_ROWS = [
  `${T}${T}${T}${T}${T}${T}0000${T}${T}${T}${T}${T}${T}`,
  `${T}${T}${T}${T}${T}00000000${T}${T}${T}${T}${T}`,
  `${T}${T}${T}0011111111100${T}${T}${T}`,
  `${T}${T}011222222222110${T}${T}`,
  `${T}0123333333333210${T}`,
  `${T}0122333333333210${T}`,
  `${T}0122333333333210${T}`,
  `${T}0122333333333210${T}`,
  `${T}0122333333333210${T}`,
  `${T}0122222222222210${T}`,
  `${T}0011111111111100${T}`,
  `0011${T}${T}${T}${T}${T}${T}${T}${T}1100`,
  `01122${T}${T}${T}${T}${T}${T}122210`,
  `0112222${T}${T}${T}${T}2222210`,
  `${T}0112222222222210${T}`,
  `${T}0112222222222210${T}`,
  `${T}${T}011222222221100${T}${T}`,
  `${T}${T}011222222221100${T}${T}`,
  `${T}${T}${T}0110${T}${T}${T}${T}0110${T}${T}${T}`,
  `${T}${T}${T}0110${T}${T}${T}${T}0110${T}${T}${T}`,
  `${T}${T}${T}0000${T}${T}${T}${T}0000${T}${T}${T}`,
];

/** Per-persona topper, drawn centered above the head. Empty array = none.
 *  Keyed by persona NAME (CathodePalettes.js), not index, so it stays
 *  correct if the persona list is ever reordered. */
export const BOSS_TOPPERS = {
  PHOSPHOR: [], // a bare terminal: no adornment is the point
  DMG: [
    `0${T}${T}${T}${T}${T}0`,
    `${T}0${T}${T}${T}0${T}`,
    `${T}${T}0000${T}${T}`,
  ],
  BREADBIN: [
    '00000000000',
    '01111111110',
  ],
  APERTURE: [
    `${T}${T}01110${T}${T}`,
    `${T}0122210${T}`,
    '011222110',
  ],
  COMPOSITE: [
    `${T}${T}${T}${T}03${T}${T}`,
    `${T}${T}${T}033${T}${T}${T}`,
    `${T}${T}033${T}${T}${T}${T}`,
    `${T}033${T}${T}${T}${T}${T}`,
  ],
};

/** Highest relative level any row/topper digit uses. Keep in sync with the
 *  art above -- it's the denominator spriteRelativeToRampIndex scales by. */
export const MAX_REL_LEVEL = 3;

/**
 * Parse a row-string sprite into a flat, rectangular cell grid: `w`, `h`,
 * and `cells` (Int8Array, row-major, -1 = transparent). Rows are padded
 * with transparent to the longest row's width rather than requiring the
 * art above to be hand-aligned -- a ragged row is far easier to typo into
 * existence than to notice by eye in a block of digits.
 */
export function parseSpriteRows(rows) {
  const h = rows.length;
  const w = h ? Math.max(...rows.map((r) => r.length)) : 0;
  const cells = new Int8Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const d = ch.charCodeAt(0) - 48; // '0'.charCodeAt(0)
      cells[y * w + x] = d >= 0 && d <= 9 ? d : -1;
    }
  }
  return { w, h, cells };
}

/** Map a sprite's relative level (0..MAX_REL_LEVEL) onto a real index into
 *  a persona ramp of `rampLen` colors, so the same digits read sensibly on
 *  both a 4-color CGA ramp and a 16-color C64 one. Clamped both ends. */
export function spriteRelativeToRampIndex(relLevel, rampLen) {
  if (!(rampLen > 0)) return 0;
  const last = rampLen - 1;
  const t = Math.max(0, Math.min(1, relLevel / MAX_REL_LEVEL));
  return Math.max(0, Math.min(last, Math.round(t * last)));
}

/** Tallest authored topper, in rows. Sizing constant for callers that need
 *  to reserve a fixed region above the body regardless of which persona's
 *  (possibly shorter, possibly absent) topper actually draws into it --
 *  computed from the art above rather than hand-kept in sync with it. */
export const MAX_TOPPER_ROWS = Object.values(BOSS_TOPPERS).reduce((max, rows) => Math.max(max, rows.length), 0);

/** The topper for a persona name, or the empty array for one with none
 *  authored (PHOSPHOR, or any name that isn't a recognized persona --
 *  never throws, since a missing topper should read as "no hat", not
 *  crash the boss). */
export function bossFormFor(personaName) {
  return BOSS_TOPPERS[personaName] || [];
}

// --- beat flinch -------------------------------------------------------

/** How much of a beat, at its start, the flinch pop holds for. */
export const FLINCH_WINDOW = 0.12;
/** Squash/pop scale during the flinch window; 1 (no-op) the rest of the beat. */
export const FLINCH_SCALE = 1.14;
/** Below this beat-lock confidence, an unlocked/noisy phase must not drive
 *  a visible flinch -- it would read as random jitter, not a hit. */
export const FLINCH_CONFIDENCE_FLOOR = 0.5;

/**
 * A single-step (not eased) scale multiplier for the boss's beat-synced
 * flinch: FLINCH_SCALE for the first FLINCH_WINDOW of each beat, 1
 * otherwise. Frame-quantized on purpose -- a discrete pop reads as a hit;
 * an eased one reads as a bounce, which is the wrong genre of motion for
 * an attract-mode boss.
 */
export function beatFlinchScale(phase01, confidence) {
  if (!(confidence >= FLINCH_CONFIDENCE_FLOOR)) return 1;
  const p = ((phase01 % 1) + 1) % 1;
  return p < FLINCH_WINDOW ? FLINCH_SCALE : 1;
}

// --- drop glitch/reassemble ---------------------------------------------

/** How long the boss's own tear-and-reform takes. Deliberately longer than
 *  Renderer's DROP_IMPACT_LIFE_MS (320ms): a boss-sized shatter needs more
 *  than a third of a second to read before it's back together. */
export const BOSS_REASSEMBLE_MS = 560;

/**
 * 0 (fully torn apart) to 1 (fully reassembled) over BOSS_REASSEMBLE_MS.
 * 0 before the burst starts or long after `dropAtMs` is stale, 1 once
 * reassembly completes -- callers multiply this into how far each glitch
 * band is displaced, so 1 means "no displacement, drawn normally".
 */
export function bossReassembleU(ageMs) {
  if (!(ageMs >= 0)) return 1; // no drop yet (dropAtMs is -Infinity) reads as "together"
  if (ageMs >= BOSS_REASSEMBLE_MS) return 1;
  const u = ageMs / BOSS_REASSEMBLE_MS;
  return 1 - (1 - u) * (1 - u); // ease-out: snaps back fast, settles gently
}

/**
 * Per-horizontal-band pixel offsets for a datamosh-style tear, one entry
 * per band. Deterministic for a given (seed, tSec, bandCount) so the same
 * instant always tears the same way (no per-frame flicker-noise at 60fps);
 * `stepSec` quantizes time into holds a few frames long, which is what
 * reads as an analog glitch instead of static. Offsets scale linearly with
 * `intensity01` and are exactly 0 at intensity 0, so a caller can always
 * multiply this in unconditionally without a separate on/off branch.
 */
export function glitchBandOffsets(seed, tSec, intensity01, bandCount, maxOffsetPx, stepSec = 0.05) {
  const offsets = new Array(Math.max(0, bandCount)).fill(0);
  const amount = Math.max(0, Math.min(1, intensity01));
  if (amount <= 0 || maxOffsetPx <= 0) return offsets;
  const step = Math.max(1, Math.round(tSec / stepSec));
  for (let i = 0; i < offsets.length; i++) {
    const rand = mulberry32(((seed >>> 0) ^ Math.imul(step, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0);
    const signed = rand() * 2 - 1; // [-1, 1]
    offsets[i] = Math.round(signed * amount * maxOffsetPx);
  }
  return offsets;
}
