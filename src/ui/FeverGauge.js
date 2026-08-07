// The fever gauge: the one readout the player was missing. The fever meter
// (FeverMeter.js) drives the whole visual intensity stack -- mountain dance
// up to ~2.8x, light rig heat, ridge-runner speed, judgment burst size,
// bloom -- but had no HUD presence: the player could feel the world get
// crazier but never see the dial. This is a slim spectral bar under the
// combo/score readout, cool teal at rest, gold as it climbs, hot pink at
// max, with a glow that only ignites once the fever is actually earned.
// The pure helpers here are unit-tested; the DOM element lives in
// index.html and is driven from main.js's frame loop.
import { clamp01, lerpHue } from '../utils/math.js';
import { feverStops } from '../render/spectral.js';

// Default stops before a tonic is known: teal at rest, gold earned, hot
// pink max -- the game's calm/earned/insane language. Once the song's
// tonic is detected, main.js feeds it through feverStops() so the gauge
// tracks the song's key like everything else under One Spectrum.
let _stops = {
  cool: { h: 172, s: 66, l: 57 },  // #4fd8c4 teal -- at rest
  warm: { h: 45, s: 100, l: 71 },  // #ffd76a gold -- earned
  hot: { h: 340, s: 90, l: 78 },   // hot pink-white -- insane
};

/** Re-anchor the gauge's three stops to the song's tonic (and halo). */
export function setFeverStops(tonic, haloHex) {
  _stops = feverStops(tonic, haloHex);
}

/** Fill width as a percentage string-ready number (0..100). */
export function feverFillPct(level) {
  return Math.round(clamp01(level) * 100);
}

/** The bar's color at a given fever level: cool -> warm -> hot, hue taking
 *  the shortest arc so the transition never spins the wheel. */
export function feverColor(level) {
  const t = clamp01(level);
  let h, s, l;
  if (t < 0.5) {
    const u = t / 0.5;
    h = lerpHue(_stops.cool.h, _stops.warm.h, u);
    s = _stops.cool.s + (_stops.warm.s - _stops.cool.s) * u;
    l = _stops.cool.l + (_stops.warm.l - _stops.cool.l) * u;
  } else {
    const u = (t - 0.5) / 0.5;
    h = lerpHue(_stops.warm.h, _stops.hot.h, u);
    s = _stops.warm.s + (_stops.hot.s - _stops.warm.s) * u;
    l = _stops.warm.l + (_stops.hot.l - _stops.warm.l) * u;
  }
  return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
}

/** Glow intensity 0..1: stays dark below ~0.3 (a resting bar reads calm,
 *  not perpetually lit) and ramps to full as the fever maxes. */
export function feverGlowAlpha(level) {
  const t = clamp01(level);
  return t < 0.3 ? 0 : (t - 0.3) / 0.7;
}

/** Label opacity: faint at rest so the gauge is discoverable, brightening
 *  with the fever so a hot streak reads as earned. */
export function feverLabelAlpha(level) {
  return 0.35 + 0.65 * clamp01(level);
}
