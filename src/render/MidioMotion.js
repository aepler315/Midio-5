// Midio's always-on motion.
//
// He was the only one of the trio standing still. Midasus traces Lissajous
// figures and spins into pirouettes; Broshi has his own restless vocabulary;
// Midio stood on the ground on two feet and leaned. Everything that made him
// look alive was an EVENT -- a jump, a trick, a landing squash, a milestone
// shimmy -- so between events he was a static glyph, and the only thing left
// carrying him across the ground was a walk, which is the one thing a
// nine-vertex crystal shard cannot do attractively.
//
// So the motion here is deliberately CONTINUOUS and never event-gated: he
// hovers, he precesses, and his core counter-rotates, all of it running
// whether or not anything is happening in the song. That also removes the
// need for a walk cycle outright -- a being that never touches the ground
// has no gait to animate.
//
// Every term is built from co-prime-ish frequencies so the composite never
// visibly loops, and every term keeps a non-zero floor at full motionScale:
// "constant energetic motion" means it must never settle, even in silence.
//
// Pure and DOM-free; the renderer applies these to Midio's draw transform,
// and tests exercise them directly.
import { clamp01 } from '../utils/math.js';

// Hover. Two co-prime-ish terms so the float never reads as a metronome.
// The base is what he does in dead silence; the energy term is what the
// song adds on top.
export const HOVER_BASE_PX = 3.4;
export const HOVER_ENERGY_PX = 4.6;
export const HOVER_HZ_A = 0.61;
export const HOVER_HZ_B = 1.43;
// A constant lift so he is never resting ON the ground line -- this is what
// retires the gait. Small enough that the jump's own height still reads as
// the dominant vertical motion.
export const HOVER_LIFT_PX = 5.5;

// Precession: a slow roll of the whole glyph. Not a spin -- a full rotation
// would throw the eye (and the silhouette's crest) around and cost him his
// readable "up". This is the sway of something suspended.
export const PRECESS_BASE_DEG = 2.4;
export const PRECESS_ENERGY_DEG = 3.6;
export const PRECESS_HZ_A = 0.29;
export const PRECESS_HZ_B = 0.73;

// The core, by contrast, DOES turn all the way round, continuously, and
// against the precession. That counter-rotation is the trick that reads as
// "powered" rather than "drifting" -- the same reason Midasus's orbiting
// babies sell her as alive while she is otherwise just translating.
export const CORE_SPIN_BASE_DPS = 22;
export const CORE_SPIN_ENERGY_DPS = 78;

/** Vertical offset in px, NEGATIVE being up (screen space), including the
 *  constant lift that keeps him off the ground. */
export function midioHoverPx(tSec, energy01 = 0, motionScale = 1) {
  const m = clamp01(motionScale);
  if (m <= 0) return 0;
  const e = clamp01(energy01);
  const amp = HOVER_BASE_PX + HOVER_ENERGY_PX * e;
  const wave = Math.sin(tSec * HOVER_HZ_A * Math.PI * 2)
    * 0.68
    + Math.sin(tSec * HOVER_HZ_B * Math.PI * 2 + 1.7) * 0.32;
  return -(HOVER_LIFT_PX + amp * 0.5 * (1 + wave)) * m;
}

/** Whole-body sway in degrees. Bounded well inside a lean that would read
 *  as falling over. */
export function midioPrecessDeg(tSec, energy01 = 0, motionScale = 1) {
  const m = clamp01(motionScale);
  if (m <= 0) return 0;
  const e = clamp01(energy01);
  const amp = PRECESS_BASE_DEG + PRECESS_ENERGY_DEG * e;
  const wave = Math.sin(tSec * PRECESS_HZ_A * Math.PI * 2) * 0.7
    + Math.sin(tSec * PRECESS_HZ_B * Math.PI * 2 + 0.9) * 0.3;
  return amp * wave * m;
}

/** Continuously accumulating core rotation in degrees. Monotonic (it only
 *  ever advances) so it can never stall on a beat, and unwrapped by the
 *  caller -- Math.sin/cos of it is all the renderer needs. */
export function midioCoreSpinDeg(tSec, energy01 = 0, motionScale = 1) {
  const m = clamp01(motionScale);
  if (m <= 0) return 0;
  const e = clamp01(energy01);
  return tSec * (CORE_SPIN_BASE_DPS + CORE_SPIN_ENERGY_DPS * e) * m;
}

/** The three together, for one frame. */
export function midioMotion(tSec, energy01 = 0, motionScale = 1) {
  return {
    hoverPx: midioHoverPx(tSec, energy01, motionScale),
    precessDeg: midioPrecessDeg(tSec, energy01, motionScale),
    coreSpinDeg: midioCoreSpinDeg(tSec, energy01, motionScale),
  };
}
