// Generates tileable 2048px silhouette strips for parallax layers 2-5
// (spec §4.1.1). Named summits come from the song's ridge portrait
// (RidgePortrait.js — spectral mass + phrase-scale energy landmarks);
// 1-D fractal value noise weathers the skyline and fills the bed. Cached
// to an offscreen canvas so each biome pays the cost only once.
//
// profile 'alpine' (far peaks L2/L3): Denali / Rainier / Shasta massif —
// broad-shouldered summits joined by high saddles, couloirs, ridged
// high-frequency crags.
// profile 'rolling' (nearer hills L4/L5): softer fbm foothills.
//
// shadeMode 'rendered' bakes soft vertical CGI shading (DKC3 lineage):
// dark foot, mid body, lit crest, faint ridge specular -- once, free forever.
import { ValueNoise1D, ridged } from '../utils/noise.js';
import {
  lerp, mulberry32, clamp01, clamp,
} from '../utils/math.js';
import { shiftLightness } from '../render/VisualStyle.js';
import {
  composeAlpinePeaks, seedPeaks, layerWeathering, spineAt, phraseAt,
} from './RidgePortrait.js';
import {
  summitMass, plateauMass, flankness01, apronMass, massingEnvelope, crenellation, couloirCarve, regionalDip, flankQs,
  shapeDials, flankness,
} from './RidgeShape.js';
import { cityHeightField, bakeWindowStrip } from './city/CitySilhouette.js';
import { pickFormation, plateauProfile } from './ColoradoPlateau.js';

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}

/**
 * Alpine massif height field 0..1 — dominant central summit, satellite
 * peaks, asymmetric broad-shouldered flanks joined by saddles, and
 * high-frequency ridgeline crags.
 * Pure (no canvas); tests can exercise without a DOM.
 */
/**
 * Per-layer geological character. Every alpine range used to be generated
 * from one hardcoded set of numbers, so the far massif and the mid range
 * were the same mountain drawn twice at different scales -- the biggest
 * reason the stack read as one repeated shape. These let each depth carry
 * a genuinely different landform:
 *
 *  - `massif`   a few enormous summits riding one continuous body of high
 *               ground: the kind of skyline you only get from very far away.
 *  - `range`    more numerous, craggier summits with busier couloir
 *               notching -- a mid-distance working range.
 *  - `crags`    many smaller, rougher summits: near foothill rock.
 *
 * Each entry carries its own flank shape (`shoulder`/`spire`/`spireMix`,
 * consumed by RidgeShape.flankQs), how far off-centre its summits sit
 * (`asym`), and how much connective mass piles up around their feet (`apron*`) -- that last group is
 * what decides whether a character reads as a joined-up range or as separate
 * hills standing on a plain.
 */
export const ALPINE_CHARACTERS = {
  massif: {
    peakMin: 3, peakSpan: 2, wBase: 116, wSpan: 130,
    shoulder: 0.62, spire: 3.0, spireMix: 0.20, asym: 0.42,
    apronSpread: 2.6, apronGain: 0.38, apronCap: 0.50,
    notch: 0.09, teeth: 0.05, bed: 0.10,
  },
  range: {
    peakMin: 5, peakSpan: 3, wBase: 74, wSpan: 86,
    shoulder: 0.70, spire: 2.7, spireMix: 0.24, asym: 0.38,
    apronSpread: 2.3, apronGain: 0.40, apronCap: 0.52,
    notch: 0.14, teeth: 0.09, bed: 0.16,
  },
  crags: {
    peakMin: 8, peakSpan: 5, wBase: 48, wSpan: 58,
    shoulder: 0.66, spire: 2.0, spireMix: 0.18, asym: 0.34,
    apronSpread: 2.6, apronGain: 0.46, apronCap: 0.52,
    notch: 0.17, teeth: 0.12, bed: 0.22,
  },
  // spires/plateau exist so ShapeGrammar.pickCharacterScheme (a song's own
  // spike/organic bias) has genuinely different landforms to reach for, not
  // just the depth-ordered massif/range/crags triple every world used to
  // get regardless of song. spires: many, narrow, sharply pinched, minimal
  // apron -- isolated needles reading as their OWN landform, not a busier
  // crags. plateau: a handful of very broad, fully domed, heavily-joined
  // summits -- a high tableland, not a bigger massif.
  spires: {
    peakMin: 10, peakSpan: 6, wBase: 34, wSpan: 40,
    shoulder: 0.85, spire: 3.6, spireMix: 0.34, asym: 0.30,
    apronSpread: 1.9, apronGain: 0.28, apronCap: 0.40,
    notch: 0.20, teeth: 0.16, bed: 0.26,
  },
  plateau: {
    peakMin: 2, peakSpan: 2, wBase: 150, wSpan: 170,
    shoulder: 0.45, spire: 2.2, spireMix: 0.08, asym: 0.48,
    apronSpread: 3.2, apronGain: 0.50, apronCap: 0.62,
    notch: 0.05, teeth: 0.02, bed: 0.06,
  },
};

/**
 * Applies a song's deriveTerrainParams() nudges to one ALPINE_CHARACTERS
 * entry. Clamped well inside the range where flank/apron math stays
 * sane (spireMix/notch/teeth in [0,1]; the rest bounded around the spread
 * ALPINE_CHARACTERS itself already uses) so an extreme song can push a
 * range noticeably spikier or moundier without ever producing degenerate
 * geometry (inverted flanks, negative apron, etc).
 */
function applyTerrainMods(cfg, mods) {
  if (!mods) return cfg;
  return {
    ...cfg,
    shoulder: clamp(cfg.shoulder * (mods.shoulderMul ?? 1), 0.35, 1.3),
    spire: clamp(cfg.spire * (mods.spireMul ?? 1), 1.6, 4.2),
    spireMix: clamp01(cfg.spireMix + (mods.spireMixAdd ?? 0)),
    asym: clamp(cfg.asym * (mods.asymMul ?? 1), 0.15, 0.55),
    apronGain: clamp(cfg.apronGain + (mods.apronGainAdd ?? 0), 0.20, 0.60),
    apronCap: clamp(cfg.apronCap + (mods.apronCapAdd ?? 0), 0.35, 0.62),
    apronSpread: clamp(cfg.apronSpread + (mods.apronSpreadAdd ?? 0), 1.8, 3.2),
    notch: clamp01(cfg.notch + (mods.notchAdd ?? 0)),
    teeth: clamp01(cfg.teeth + (mods.teethAdd ?? 0)),
  };
}

// The tallest a summit may reach, and the highest its base may sit. Both
// stay under 1 so nothing in the field is ever resolved by clamp01 -- a
// clipped summit is a flat-topped mesa, which is the one shape a peak must
// never be. generateSilhouette's own HEADROOM refit rescales the finished
// ridge to fill the strip anyway, so leaving this margin costs no height
// on screen.
const SUMMIT_CEIL = 0.97;
const BASE_CEIL = 0.50;

export function alpineHeightField(noise, n, step, seed, width, character = 'massif', portrait = null, layerKey = 'L2', terrainMods = null) {
  const cfg = applyTerrainMods(ALPINE_CHARACTERS[character] || ALPINE_CHARACTERS.massif, terrainMods);
  const rand = mulberry32((seed ^ 0xa1b1) >>> 0 || 1);
  const weather = portrait ? layerWeathering(portrait, cfg, layerKey) : {
    notch: cfg.notch, teeth: cfg.teeth, bed: cfg.bed, apronGain: cfg.apronGain,
    apronCap: cfg.apronCap, apronSpread: cfg.apronSpread,
    spineAmp: 0, profileMix: 0, litho: null,
  };

  // Named summits: song portrait when we have one, dart-throwing seed
  // otherwise. Either way the king is the tallest peak, never a forced
  // centre — a range with its high point dead-centre of the tile was
  // half of why every biome's skyline felt manufactured.
  let peaks = (portrait && portrait.landmarks && portrait.landmarks.length)
    ? composeAlpinePeaks({ portrait, cfg, layerKey, seed, width })
    : seedPeaks(cfg, seed, width);
  if (!peaks.length) peaks = seedPeaks(cfg, seed, width);

  // Secondary shoulders / subpeaks (Rainier-style multi-summit) — lower,
  // never wide enough to fill the saddle into a mesa. Fewer of them when
  // the portrait already supplied a busy skyline, so L4 doesn't become a
  // hairball of fill on top of fill.
  const lithoCrest = weather.litho?.crest ?? 0;
  const shoulderChance = portrait
    ? clamp01(0.20 + lithoCrest * 0.40 - (peaks.length >= 6 ? 0.12 : 0))
    : 0.5;
  const shoulders = [];
  for (const p of peaks) {
    if (rand() < shoulderChance) {
      const sw = p.w * (0.28 + rand() * 0.2);
      const sLean = 1 + (rand() * 2 - 1) * cfg.asym;
      shoulders.push({
        x: p.x + (rand() < 0.5 ? -1 : 1) * (p.w * (0.32 + rand() * 0.2)),
        h: p.h * (0.38 + rand() * 0.22),
        w: sw, wL: sw * sLean, wR: sw / sLean,
      });
    }
  }
  const allPeaks = peaks.concat(shoulders);
  const spineAmp = (weather.spineAmp ?? 0) * 0.12;
  const apronCap = weather.apronCap ?? cfg.apronCap;

  // A range is a CREST that runs the whole tile, with summits raising it --
  // not a set of separate cones standing on a plain. See RidgeShape.js for
  // the full diagnosis; the short version is that the old field fell to a
  // bare noise floor wherever no summit landed, which left a long dead-flat
  // stretch in every (tiling, endlessly scrolling) strip and made saddles
  // collapse so neighbours never read as one range.
  const dials = shapeDials(cfg, weather.litho);
  const dip = regionalDip(rand);
  // Which summits buck the regional steep-side. A few, not none and not
  // half: all-same reads stamped, half-and-half reads random.
  for (const p of allPeaks) p.flip = rand() < 0.22;
  const flankQEarly = flankQs(cfg, weather.litho, weather.profileMix ?? 0);
  // Southern-Utah shape language (ColoradoPlateau.js). Every summit is a
  // FORMATION -- flat caprock, near-vertical cliff bands, benches, a talus
  // apron -- rather than an alpine flank, because the rock here is flat-lying
  // sedimentary layers of alternating hardness and erosion works on them
  // layer by layer. Assigned once per summit so a formation keeps its
  // identity, and driven by the section's own lithology where it can be.
  for (const p of allPeaks) {
    p.form = pickFormation(rand, {
      crest: weather.litho?.crest ?? 0.5,
      foot: weather.litho?.foot ?? 0.5,
      tilt: weather.profileMix ?? 0,
      // The song's spike-vs-organic DNA still reaches the shape -- it now
      // chooses the FORMATION rather than bending a flank exponent, which is
      // the only place it can land once summits are formations. flankQ is
      // still computed above and still drives the detail passes.
      spiky: flankness01(flankQEarly),
    });
  }
  const spinePhase = rand() * 10;
  // Flank curvature from the character's own shoulder/spire/spireMix --
  // this is the path a song's spike-vs-organic DNA takes into the shape.
  const flankQ = flankQs(cfg, weather.litho, weather.profileMix ?? 0);
  const apronSpread = dials.apronSpread;

  // Pass 1: the summit field alone -- every named summit's own mass, plus
  // the aprons that join neighbouring feet into saddles. No base yet.
  const summitField = new Float32Array(n);
  const apronField = new Float32Array(n);
  // The strip tiles, so distance to a summit has to wrap: without this a
  // summit sitting near x=0 contributes nothing at x=width-1, which pins a
  // permanent low point at the tile seam -- the one place the eye is
  // guaranteed to keep seeing, since the seam scrolls past on repeat.
  const halfW = Math.max(1, width) / 2;
  const wrapDx = (d) => (d > halfW ? d - width : d < -halfW ? d + width : d);
  for (let i = 0; i < n; i++) {
    const x = i * step;
    let summit = 0;
    let apronSum = 0;
    for (const p of allPeaks) {
      const dx = wrapDx(x - p.x);
      const m = plateauMass(dx, p, dip);
      // Max, not sum: summits must stay separate landforms rather than
      // adding into one dome.
      if (m > summit) summit = m;
      apronSum += apronMass(dx, p, apronSpread) * weather.apronGain;
    }
    summitField[i] = summit;
    apronField[i] = Math.min(apronSum, apronCap);
  }

  // Pass 2: the massing envelope -- a heavily blurred copy of the summit
  // field, so the ground swells under clusters of peaks and subsides
  // between them. This is what makes foothills descend OUT of the high
  // country instead of the high country standing on a flat plinth.
  // Radius is a real fraction of the tile: this is massing, not detail.
  const massRadius = Math.max(4, Math.round(n * 0.085));
  const envelope = massingEnvelope(summitField, dials.spineFloor, dials.spineSwing, massRadius);

  // Pass 3: assemble the structure. Detail is deliberately NOT applied
  // here -- it needs known relief and known local slope, and neither
  // exists until this pass has run. That ordering is what lets couloirs
  // sit on flanks and crenellation sit on crests, instead of both being
  // sprayed at a fixed rate across the whole tile the way the old
  // single-pass field did.
  const structure = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const u = width > 0 ? x / width : 0;
    // Valley floors must not be dead level. Where no summit is near, the
    // envelope alone is flat, which left a ruler-straight horizon across
    // every pass between masses. A little low-frequency roll (and it has
    // to be low-frequency -- this is the valley's own drift, not the
    // crenellation that lives up on the crests) is enough to break it.
    const roll = noise.fbm(x * 0.0016 + 53.7, 2) * 0.045;
    // Capped so there is ALWAYS headroom left for a summit to rise into.
    const base = Math.min(
      BASE_CEIL,
      Math.max(envelope[i], envelope[i] * 0.55 + apronField[i] * 0.62)
        + spineAt(portrait, u, spineAmp) + roll,
    );
    // A full-height summit lands exactly on SUMMIT_CEIL, never past it.
    // The previous cut let base + summit overshoot 1 and relied on clamp01
    // to catch it, which sawed the tops off the tallest summits into flat
    // mesas -- the most conspicuous artifact left in the rendered field,
    // and precisely the wrong shape for the peaks that matter most.
    structure[i] = base + summitField[i] * (SUMMIT_CEIL - base);
  }

  // Pass 4: detail, anchored to the structure it sits on.
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * step;
    let h = structure[i];
    // Relief measured against THIS point's own local base (the envelope),
    // not a global floor -- so a summit standing on high country still
    // reads as having real relief, and the high country itself doesn't.
    const relief = clamp01((h - envelope[i]) / 0.34);
    const prev = structure[i > 0 ? i - 1 : n - 1];
    const next = structure[i < n - 1 ? i + 1 : 0];
    const slope = (next - prev) / (2 * Math.max(1, step));

    h -= couloirCarve(noise, x, relief, flankness(slope), dials.couloir);
    h += crenellation(noise, x, relief, dials.crenel);

    heights[i] = clamp01(h);
  }
  return heights;
}

/** Rolling foothill field (nearer layers) — classic fbm, with a gentle
 *  phrase-scale bass undulation when a portrait is present. The phrase
 *  wave is one period of the song's energy loop, not the full envelope,
 *  so the hills breathe at the song's scale without tracing a spectrogram. */
export function rollingHeightField(noise, n, step, octaves, portrait = null, width = 0, terrainMods = null) {
  const heights = new Float32Array(n);
  const stripW = width > 0 ? width : Math.max(1, (n - 1) * step);
  const bass = portrait?.bassShare ?? 0;
  const phraseAmp = 0.16 * bass * (0.45 + 0.55 * (portrait?.phraseStrength ?? 0));
  // A spiky/vertical-stack-heavy song reads grainier hills even in this
  // soft 'rolling' profile (strip worlds' L2-L4, and every world's nearest
  // L5 layer); an organic/regular one stays smoother. Both default to a
  // no-op so a caller with no DNA gets byte-identical output.
  const octAdj = clamp(octaves + Math.round(terrainMods?.rollingOctaveBias ?? 0), 1, 5);
  const ampMul = terrainMods?.rollingAmpMul ?? 1;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    // Map fbm from ~[-1,1] into a positive hill field.
    const f = noise.fbm(x * 0.006, octAdj);
    const u = x / stripW;
    const phrase = phraseAmp > 0 ? (phraseAt(portrait, u) * 2 - 1) * phraseAmp : 0;
    const spine = spineAt(portrait, u, 0.04 * (portrait?.bassShare ?? 0));
    heights[i] = clamp01(0.5 + 0.5 * f * ampMul + phrase * 0.5 + spine);
  }
  return heights;
}

export function generateSilhouette({
  seed, width = 2048, height = 320, octaves = 2, baseline = 0.55, amplitude = 0.30, color, step = 4,
  edgeLight = null, // optional neon ridge-line stroke (CYBER's edgeLight hook)
  shadeMode = 'classic', // 'classic' flat fill | 'rendered' soft CGI volume
  profile = 'rolling', // 'rolling' | 'alpine' (Denali / Rainier / Shasta massifs)
  character = 'massif', // alpine only -- see ALPINE_CHARACTERS
  // Song-anchored outline (RidgePortrait). Null keeps the seeded fallback
  // so tests and anything without energy curves still get a range. layerKey
  // picks which facet of the portrait this depth reads (L2 form / L3
  // timbre / L4 grain / L5 phrase hills).
  portrait = null,
  layerKey = 'L2',
  // Continuous song-shape nudges to the alpine character (deriveTerrainParams
  // in ShapeGrammar.js). Alpine-profile only; ignored otherwise.
  terrainMods = null,
  // Aerial perspective, optical half (The Light Show, pass 7): DepthHaze
  // already washes far layers toward the sky color, but color alone isn't
  // the cue a distant object actually gives -- it also loses edge acuity.
  // Every layer used to bake pixel-crisp regardless of depth, so a massif
  // rendered "too far away to judge" had the identical edge sharpness as
  // ground six feet from the camera; the sharpness cue was winning against
  // the haze cue rather than agreeing with it.
  //
  // 1 = bake at full resolution (today's behavior, unchanged). <1 bakes
  // the ENTIRE strip (fill, specular, edgeLight -- everything below) onto a
  // canvas smaller by this factor, then stretches that bitmap back up into
  // a canvas of the requested width/height, letting the browser's own
  // bilinear filtering do the softening. This happens once per biome per
  // layer at strip-build time, never per frame -- a real blur() filter was
  // deliberately ruled out earlier in this file's history for exactly the
  // per-frame GPU-flush cost this sidesteps (see BiomeManager.js's
  // drawForeground comment on the same tradeoff).
  //
  // Softening touches ONLY the returned canvas's pixels. `heights`/`step`/
  // `amplitude` below -- the vector ridge data ridgeYAt/ridgeYSmooth read,
  // and everything downstream of them (dance-column offsets, landmark
  // placement, and BiomeManager._drawRidgeVolume/_drawCrest's live
  // screen-space shading) -- are computed at full precision regardless of
  // softenScale and returned unchanged. So the shading gradients painted on
  // top each frame stay exactly aligned to the true skyline; only the baked
  // silhouette body blurs under them, which reads as a soft, backlit edge
  // rather than a mismatch.
  softenScale = 1,
}) {
  const noise = new ValueNoise1D(seed, 256);
  const n = Math.floor(width / step) + 1;

  let heights;
  if (profile === 'alpine') {
    heights = alpineHeightField(noise, n, step, seed, width, character, portrait, layerKey, terrainMods);
  } else if (profile === 'city') {
    heights = cityHeightField(n, step, seed, width, portrait, layerKey, terrainMods);
  } else {
    heights = rollingHeightField(noise, n, step, octaves, portrait, width, terrainMods);
  }

  // Force a seamless horizontal wrap by blending the tail back to the head.
  const blendCount = Math.max(1, Math.floor(n * 0.12));
  for (let i = 0; i < blendCount; i++) {
    const idx = n - blendCount + i;
    const t = i / blendCount;
    heights[idx] = lerp(heights[idx], heights[0], t * t * (3 - 2 * t));
  }

  // Precompute ridge y samples + the highest crest (for gradient top).
  // Alpine: slightly more vertical throw so tall peaks really pierce the sky.
  const amp = profile === 'alpine' ? amplitude * 1.12 : amplitude;
  const footY = height * baseline;
  const ridgeYs = new Float32Array(n);
  let minY = height;
  for (let i = 0; i < n; i++) {
    ridgeYs[i] = footY - heights[i] * height * amp;
    if (ridgeYs[i] < minY) minY = ridgeYs[i];
  }

  // CRITICAL: peaks that compute above the strip top (y < 0) are clipped by
  // the canvas into flat mesas. Rescale the vertical throw so the tallest
  // summit keeps headroom — shape stays pointy, nothing shears off.
  const HEADROOM = profile === 'alpine' ? 14 : profile === 'city' ? 10 : 6;
  if (minY < HEADROOM) {
    const span = footY - minY;
    const target = footY - HEADROOM;
    if (span > 1e-6 && target > 0) {
      const s = target / span;
      for (let i = 0; i < n; i++) {
        ridgeYs[i] = footY - (footY - ridgeYs[i]) * s;
      }
      minY = HEADROOM;
    } else {
      minY = Math.max(HEADROOM, minY);
    }
  }
  // Gradient crest starts a little above the skyline
  const gradTop = Math.max(0, minY - 8);

  // Fitted amplitude so ridgeYAt matches the painted (unclipped) skyline.
  let hMax = 0;
  for (let i = 0; i < n; i++) if (heights[i] > hMax) hMax = heights[i];
  const ampFitted = hMax > 1e-6
    ? (footY - minY) / (height * hMax)
    : amp;

  // Softened bakes draw at a reduced physical size; everything below still
  // addresses coordinates in full logical width/height, so a plain
  // ctx.scale() is enough to redirect the identical drawing calls onto the
  // smaller backing store with no other changes.
  const soften = Math.min(1, Math.max(0.1, softenScale));
  const bakeW = soften < 1 ? Math.max(1, Math.round(width * soften)) : width;
  const bakeH = soften < 1 ? Math.max(1, Math.round(height * soften)) : height;
  const bakeCanvas = makeCanvas(bakeW, bakeH);
  const ctx = bakeCanvas.getContext('2d');
  if (soften < 1) ctx.scale(soften, soften);
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let i = 0; i < n; i++) ctx.lineTo(i * step, ridgeYs[i]);
  ctx.lineTo(width, height);
  ctx.closePath();

  if (shadeMode === 'rendered') {
    // Flat mid-tone fill -- NOT a baked vertical gradient. This bitmap gets
    // sliced into DANCE_COL_W columns and each column is blitted at its own
    // vertical offset (BiomeManager._drawDancingStrip, the mountains'
    // dance). A gradient baked in here has its color keyed to LOCAL strip Y;
    // once two neighbouring columns are offset differently, the same
    // on-screen row samples two different points of that gradient, which is
    // a hard vertical shade step marching across the range as it dances
    // (worse exactly when the dance is strongest, e.g. mid-transition with
    // two ranges cross-fading and both dancing). Halving the column width
    // once already shrank the step; it could never remove it, because the
    // cause is the bake, not the slicing.
    //
    // The depth this gradient used to provide is now painted LIVE, in
    // screen space, by BiomeManager._drawRidgeVolume right after this strip
    // is blitted -- it already existed for exactly this reason (see its own
    // doc comment) and now carries the full shading load instead of merely
    // adding contrast on top of a still-seamed bake. A flat fill has no
    // per-row color variation at all, so there is nothing left to seam.
    ctx.fillStyle = shiftLightness(color, -0.02); // same "mid" tone as before
    ctx.fill();

    // Soft specular catch-light along the skyline — very low alpha, no hard
    // hairline (stacked strokes read as glitchy neon outlines through gaps).
    // Alpine: slightly stronger rim so jagged summits read against the sky.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = profile === 'alpine' ? 0.20 : profile === 'city' ? 0.10 : 0.14;
    ctx.strokeStyle = 'rgba(255, 248, 230, 0.45)';
    ctx.lineWidth = profile === 'alpine' ? 2.0 : profile === 'city' ? 1.2 : 2.4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(0, ridgeYs[i]); else ctx.lineTo(i * step, ridgeYs[i]);
    }
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }

  if (edgeLight) {
    // Two-pass glow along the ridge: a wide faint stroke under a thin
    // bright one -- baked once, free forever.
    for (const [lw, alpha] of [[4, 0.30], [1.5, 0.85]]) {
      ctx.strokeStyle = edgeLight;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (i === 0) ctx.moveTo(0, ridgeYs[i]); else ctx.lineTo(i * step, ridgeYs[i]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Stretch the reduced-resolution bake back up to the requested logical
  // size in one shot -- the browser's own bilinear upscale is the entire
  // softening effect, and it costs exactly one drawImage call made once at
  // strip-build time, never per frame.
  let canvas = bakeCanvas;
  if (soften < 1) {
    canvas = makeCanvas(width, height);
    const upCtx = canvas.getContext('2d');
    upCtx.drawImage(bakeCanvas, 0, 0, width, height);
  }

  // Ridge metadata: lets landmark decoration root itself on the actual
  // skyline instead of the layer baseline. amplitude is the *fitted*
  // throw so ridgeYAt matches what was painted (no clipped-mesa ghost).
  // Full precision regardless of softenScale -- see the softenScale doc
  // above for why the vector data and the baked pixels are independent.
  canvas.ridge = { heights, step, baseline, amplitude: ampFitted, height, profile };
  if (profile === 'city') {
    canvas.windows = bakeWindowStrip(ridgeYs, {
      width, height, step, seed, color: '#f2d090',
    });
  }
  return canvas;
}

/** Screen-space (in-strip) y of the noise ridge at a given strip x. */
export function ridgeYAt(strip, x) {
  const r = strip.ridge;
  if (!r) return strip.height * 0.7;
  const i = Math.max(0, Math.min(r.heights.length - 1, Math.round(x / r.step)));
  return r.height * r.baseline - r.heights[i] * r.height * r.amplitude;
}

/** Draws a tileable strip scroll-wrapped across the canvas width at the given y offset. */
export function drawTiledStrip(ctx, strip, scrollX, canvasWidth, canvasHeight, yOffset = 0) {
  const w = strip.width;
  let x = -(((scrollX % w) + w) % w);
  while (x < canvasWidth) {
    ctx.drawImage(strip, x, canvasHeight - strip.height + yOffset);
    x += w;
  }
}
