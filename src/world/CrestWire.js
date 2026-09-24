// The live wire along the top of every ridge.
//
// Each range's crest carries a thin glowing line that rides its skyline as a
// travelling wave: a smooth sine when the music is quiet, sharpening into a
// zigzag as it gets loud, and buzzing -- a fast shiver of its amplitude --
// on every kick. Its colour is picked against what it sits between: the
// range's own body below and whatever is behind it above (the sky, or the
// next range back), so the wire always reads, whichever palette the biome
// has.
//
// Pure maths plus one draw helper; BiomeManager supplies the crest polyline
// (the same live, danced curve the old rim stroke used), the colours and
// the music.
import { clamp01 } from '../utils/math.js';
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from '../utils/color.js';

// Per range: wavelength and resting amplitude in px, and how fast the wave
// travels (rad/s). Farther ranges get a finer, calmer wire -- the same
// far-is-calmer rule the dance follows (MountainChoreo.DANCE_LAYERS).
export const WIRE_LAYERS = {
  L2: { wavelength: 13, amp: 1.6, speed: 5.0 },
  L3: { wavelength: 17, amp: 2.2, speed: 5.8 },
  L4: { wavelength: 22, amp: 2.9, speed: 6.6 },
  L5: { wavelength: 28, amp: 3.6, speed: 7.4 },
  massif: { wavelength: 34, amp: 4.0, speed: 2.4 },
};
// How far loudness and a kick can push the amplitude past its resting size.
const LOUD_GAIN = 1.3;
const KICK_GAIN = 1.4;
// The buzz: a fast flutter of the amplitude, strongest right on the kick.
export const BUZZ_HZ = 13;
const BUZZ_DEPTH = 0.45;
// Resampling step along the crest: fine enough for the shortest wavelength.
export const WIRE_STEP_PX = 3;

/** Triangle wave in [-1, 1] with the same phase as Math.sin. */
function tri(phase) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

/**
 * The wire's vertical offset (px) at screen x and time tSec.
 * `sharp` 0..1 morphs sine -> zigzag; `amp` is the amplitude in px already
 * scaled for loudness and the kick (wireAmplitude).
 */
export function wireOffset(x, tSec, { wavelength, speed }, amp, sharp) {
  const phase = (x / wavelength) * Math.PI * 2 - tSec * speed;
  const s = clamp01(sharp);
  return amp * (Math.sin(phase) * (1 - s) + tri(phase) * s);
}

/**
 * The wire's amplitude (px) this frame: resting size, grown by loudness
 * (0..1) and the kick envelope (0..1), with the buzz riding on top.
 */
export function wireAmplitude(cfg, loud, kick, tSec) {
  const base = cfg.amp * (1 + LOUD_GAIN * clamp01(loud) + KICK_GAIN * clamp01(kick));
  const buzz = 1 + BUZZ_DEPTH * clamp01(0.35 + kick) * Math.sin(tSec * BUZZ_HZ * Math.PI * 2);
  return base * buzz;
}

/** Relative luminance (WCAG), 0..1. */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A hue is only worth complementing when the colour has some: below this
// saturation a silhouette is grey and its hue is noise.
const HUE_MIN_SAT = 0.15;

/**
 * A wire colour that stands out from both `body` (the range under it) and
 * `behind` (what is above it), and can glow: fully saturated, kept in a
 * luminous lightness band, on the complement of the body's hue -- or of
 * what is behind it when the body is grey, or of `accent` (the biome's
 * glow colour) when both are. Within the band it takes the lightness with
 * the best worst-case contrast against the two; ties go brighter.
 */
export function wireColor(body, behind, accent = '#4fd8ff') {
  const hsl = (hex) => { const { r, g, b } = hexToRgb(hex); return rgbToHsl(r, g, b); };
  const b0 = hsl(body), b1 = hsl(behind);
  const hue = b0.s >= HUE_MIN_SAT ? (b0.h + 180) % 360
    : b1.s >= HUE_MIN_SAT ? (b1.h + 180) % 360
      : hsl(accent).h;
  let best = null, bestScore = -Infinity;
  for (let l = 0.8; l >= 0.45 - 1e-9; l -= 0.05) {
    const rgb = hslToRgb(hue, 1, l);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    const score = Math.min(contrastRatio(hex, body), contrastRatio(hex, behind));
    if (score > bestScore + 1e-6) { best = hex; bestScore = score; }
  }
  return best;
}

/** The crest polyline resampled every `step` px of x, linearly. */
export function resampleCrest(pts, step = WIRE_STEP_PX) {
  const out = [];
  if (!pts || pts.length < 2) return out;
  let j = 0;
  for (let x = pts[0].x; x <= pts[pts.length - 1].x; x += step) {
    while (j < pts.length - 2 && pts[j + 1].x < x) j++;
    const a = pts[j], b = pts[j + 1];
    const f = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
    out.push({ x, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

/**
 * Stroke the wire along `pts` (a crest polyline, left to right).
 * { cfg, color, amp, sharp, tSec, alpha, glow } -- `glow` false skips the
 * wide additive passes (the cheap rung).
 */
export function drawCrestWire(ctx, pts, { cfg, color, amp, sharp, tSec, alpha = 1, glow = true }) {
  const line = resampleCrest(pts);
  if (line.length < 2 || !(alpha > 0.01)) return;
  for (const p of line) p.y += wireOffset(p.x, tSec, cfg, amp, sharp);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
  };
  ctx.save();
  ctx.lineJoin = sharp > 0.5 ? 'miter' : 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  if (glow) {
    // Ambient glow: wide, faint, additive, so it lifts whatever is behind it.
    ctx.globalCompositeOperation = 'lighter';
    for (const [lw, a] of [[14, 0.07], [6, 0.18]]) {
      ctx.globalAlpha = a * alpha;
      ctx.lineWidth = lw;
      path();
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 0.95 * alpha;
  ctx.lineWidth = 1.6;
  path();
  ctx.stroke();
  ctx.restore();
}
