// Generates tileable 2048px silhouette strips for parallax layers 2-5
// (spec §4.1.1) from 1-D fractal value noise, cached to an offscreen canvas
// so each biome pays the noise-generation cost only once.
//
// profile 'alpine' (far peaks L2/L3): Denali / Rainier / Shasta massif —
// sharp summits, steep flanks, couloirs, ridged high-frequency crags.
// profile 'rolling' (nearer hills L4/L5): softer fbm foothills.
//
// shadeMode 'rendered' bakes soft vertical CGI shading (DKC3 lineage):
// dark foot, mid body, lit crest, faint ridge specular -- once, free forever.
import { ValueNoise1D, ridged } from '../utils/noise.js';
import { lerp, mulberry32, clamp01 } from '../utils/math.js';
import { shiftLightness } from '../render/VisualStyle.js';

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}

/**
 * Alpine massif height field 0..1 — dominant central summit, satellite
 * peaks, steep power-law flanks, high-frequency ridgeline crags.
 * Pure (no canvas); tests can exercise without a DOM.
 */
/**
 * Per-layer geological character. Every alpine range used to be generated
 * from one hardcoded set of numbers, so the far massif and the mid range
 * were the same mountain drawn twice at different scales -- the biggest
 * reason the stack read as one repeated shape. These let each depth carry
 * a genuinely different landform:
 *
 *  - `massif`   few, enormous, needle-sharp giants with deep saddles: the
 *               kind of skyline you only get from very far away.
 *  - `range`    more numerous, broader, craggier summits with busier
 *               couloir notching -- a mid-distance working range.
 *  - `crags`    many small, sharp, irregular teeth: near foothill rock.
 */
export const ALPINE_CHARACTERS = {
  massif: { peakMin: 3, peakSpan: 2, wBase: 100, wSpan: 120, sharpMin: 2.2, sharpSpan: 1.2, notch: 0.09, teeth: 0.05, bed: 0.10 },
  range: { peakMin: 5, peakSpan: 3, wBase: 62, wSpan: 78, sharpMin: 1.7, sharpSpan: 0.9, notch: 0.14, teeth: 0.09, bed: 0.16 },
  crags: { peakMin: 8, peakSpan: 5, wBase: 34, wSpan: 46, sharpMin: 1.4, sharpSpan: 0.8, notch: 0.17, teeth: 0.12, bed: 0.22 },
};

export function alpineHeightField(noise, n, step, seed, width, character = 'massif') {
  const cfg = ALPINE_CHARACTERS[character] || ALPINE_CHARACTERS.massif;
  const rand = mulberry32((seed ^ 0xa1b1) >>> 0 || 1);
  // Major peaks; one dominant (Denali-style) near center.
  // Narrow bases + high sharpness → real summits, not table-tops.
  const nPeaks = cfg.peakMin + Math.floor(rand() * cfg.peakSpan);
  const peaks = [];
  for (let i = 0; i < nPeaks; i++) {
    const u = (i + 0.5) / nPeaks + (rand() - 0.5) * 0.08;
    peaks.push({
      x: clamp01(u) * width,
      h: 0.52 + rand() * 0.38,
      // Half-width of the base (px) — tighter = steeper pyramid flanks.
      w: cfg.wBase + rand() * cfg.wSpan,
      // Apex power: higher → needle summit (Shasta), not a plateau.
      sharp: cfg.sharpMin + rand() * cfg.sharpSpan,
    });
  }
  // Promote central peak to this range's king. Scaled to the character's
  // own peak width rather than a fixed 130-170px: on `crags` (34-80px
  // peaks) a hardcoded massif-sized king was the one landform every layer
  // still shared, which kept them looking alike no matter what else moved.
  const main = peaks[Math.floor(nPeaks / 2)];
  main.h = Math.max(main.h, 0.94 + rand() * 0.06);
  main.w = Math.min(main.w, cfg.wBase * (1.05 + rand() * 0.35));
  main.sharp = Math.max(main.sharp, cfg.sharpMin + 0.3);

  // Secondary shoulders / subpeaks (Rainier-style multi-summit) — lower,
  // never wide enough to fill the saddle into a mesa.
  const shoulders = [];
  for (const p of peaks) {
    if (rand() < 0.5) {
      shoulders.push({
        x: p.x + (rand() < 0.5 ? -1 : 1) * (p.w * (0.32 + rand() * 0.2)),
        h: p.h * (0.38 + rand() * 0.22),
        w: p.w * (0.28 + rand() * 0.2),
        sharp: 1.6 + rand() * 0.6,
      });
    }
  }
  const allPeaks = peaks.concat(shoulders);

  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * step;
    // Sparse low foothill bed — keep valleys deep so peaks read as peaks.
    let h = ridged(noise, x * 0.0035, 3) * cfg.bed;
    h += noise.fbm(x * 0.007, 2) * 0.05;

    for (const p of allPeaks) {
      const d = Math.abs(x - p.x) / Math.max(12, p.w);
      if (d >= 1.15) continue;
      // Power-law alpine flanks: steep near summit.
      const core = Math.pow(Math.max(0, 1 - d), p.sharp) * p.h;
      // Thin apron only — a fat apron was gluing peaks into plateaus.
      const apron = Math.pow(Math.max(0, 1 - d * 0.9), 0.7) * p.h * 0.1;
      h = Math.max(h, core + apron * 0.25);
    }

    // Couloir notches — carve V's into mid-flanks (craggy outline).
    const notch = ridged(noise, x * 0.022 + 17, 2);
    if (h > 0.28) {
      h -= notch * cfg.notch * (h - 0.18);
    }

    // High-frequency ridge teeth (arete / serac) — only near the skyline.
    const teeth = ridged(noise, x * 0.05, 2);
    h += teeth * cfg.teeth * clamp01((h - 0.35) * 2.2);

    heights[i] = clamp01(h);
  }
  return heights;
}

/** Rolling foothill field (nearer layers) — classic fbm. */
export function rollingHeightField(noise, n, step, octaves) {
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * step;
    // Map fbm from ~[-1,1] into a positive hill field.
    const f = noise.fbm(x * 0.006, octaves);
    heights[i] = clamp01(0.5 + 0.5 * f);
  }
  return heights;
}

export function generateSilhouette({
  seed, width = 2048, height = 320, octaves = 2, baseline = 0.55, amplitude = 0.30, color, step = 4,
  edgeLight = null, // optional neon ridge-line stroke (CYBER's edgeLight hook)
  shadeMode = 'classic', // 'classic' flat fill | 'rendered' soft CGI volume
  profile = 'rolling', // 'rolling' | 'alpine' (Denali / Rainier / Shasta massifs)
  character = 'massif', // alpine only -- see ALPINE_CHARACTERS
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
    heights = alpineHeightField(noise, n, step, seed, width, character);
  } else {
    heights = rollingHeightField(noise, n, step, octaves);
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
  const HEADROOM = profile === 'alpine' ? 14 : 6;
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
    ctx.globalAlpha = profile === 'alpine' ? 0.20 : 0.14;
    ctx.strokeStyle = 'rgba(255, 248, 230, 0.45)';
    ctx.lineWidth = profile === 'alpine' ? 2.0 : 2.4;
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
