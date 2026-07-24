// Generates tileable 2048px silhouette strips for parallax mountain layers
// (spec §4.1.1) from 1-D fractal value noise, cached to an offscreen canvas
// so each biome pays the noise-generation cost only once. Peaks are
// deliberately rounded (soft-peak shaping + neighbor smoothing + quadratic
// ridge strokes) so the ranges read as rolling massifs rather than a
// sawtooth skyline.
import { ValueNoise1D } from '../utils/noise.js';
import { lerp, clamp01 } from '../utils/math.js';

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}

/** Soft-peak curve: compresses high values so ridges round off instead of
 *  spiking. Input is treated as a 0..1 height; output stays in 0..1. */
export function softPeak01(h01) {
  const h = clamp01(h01);
  // Power > 1 pulls tall outliers down (less pointy summits) while keeping
  // mid-range shoulders readable. Endpoint-fixed and monotone.
  return Math.pow(h, 1.28);
}

/** One-pass 5-tap box smooth on a circular height buffer (tile-safe). */
function smoothHeights(src, passes = 2) {
  const n = src.length;
  let a = Float32Array.from(src);
  let b = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const i0 = (i - 2 + n) % n, i1 = (i - 1 + n) % n;
      const i3 = (i + 1) % n, i4 = (i + 2) % n;
      b[i] = (a[i0] + 2 * a[i1] + 3 * a[i] + 2 * a[i3] + a[i4]) / 9;
    }
    const tmp = a; a = b; b = tmp;
  }
  return a;
}

export function generateSilhouette({
  seed, width = 2048, height = 320, octaves = 2, baseline = 0.55, amplitude = 0.30, color, step = 6,
  edgeLight = null, // optional neon ridge-line stroke (CYBER's edgeLight hook)
  softness = 1,     // 0 = legacy sharp, 1 = fully rounded massifs
}) {
  const noise = new ValueNoise1D(seed, 256);
  const n = Math.floor(width / step) + 1;
  const raw = new Float32Array(n);
  // Lower spatial frequency than the old 0.006 so massifs are broader.
  const freq = 0.0036;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    // Map fbm (~[-1,1]) into a positive ridge height, then soft-peak it.
    const n01 = clamp01(0.5 + 0.5 * noise.fbm(x * freq, octaves));
    raw[i] = softPeak01(n01);
  }

  // Extra low-frequency envelope: a few wide rolling hills so the skyline
  // never collapses into a uniform soft mush — still mountain-shaped.
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const env = 0.55 + 0.45 * softPeak01(0.5 + 0.5 * noise.sample(x * 0.0011 + 17));
    raw[i] *= env;
  }

  let heights = smoothHeights(raw, 1 + Math.round(2 * clamp01(softness)));
  // Re-apply soft peak after smoothing so residual high-frequency energy
  // can't re-sharpen the ridge (locks the less-pointy look in).
  if (softness > 0) {
    for (let i = 0; i < n; i++) heights[i] = lerp(heights[i], softPeak01(heights[i]), clamp01(softness));
  }

  // Force a seamless horizontal wrap by blending the tail back to the head.
  const blendCount = Math.max(1, Math.floor(n * 0.12));
  for (let i = 0; i < blendCount; i++) {
    const idx = n - blendCount + i;
    const t = i / blendCount;
    heights[idx] = lerp(heights[idx], heights[0], t * t * (3 - 2 * t));
  }

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, height);
  // Quadratic midpoints: each segment bows gently, never a hard corner.
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const y = height * baseline - heights[i] * height * amplitude;
    if (i === 0) {
      ctx.lineTo(x, y);
    } else {
      const px = (i - 1) * step;
      const py = height * baseline - heights[i - 1] * height * amplitude;
      const mx = (px + x) * 0.5;
      const my = (py + y) * 0.5;
      ctx.quadraticCurveTo(px, py, mx, my);
    }
  }
  // Close the last half-segment into the final sample, then the strip floor.
  {
    const last = n - 1;
    const x = last * step;
    const y = height * baseline - heights[last] * height * amplitude;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  if (edgeLight) {
    // Two-pass glow along the ridge: a wide faint stroke under a thin
    // bright one -- baked once, free forever. Same rounded path.
    for (const [lw, alpha] of [[5, 0.28], [1.6, 0.85]]) {
      ctx.strokeStyle = edgeLight;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = i * step;
        const y = height * baseline - heights[i] * height * amplitude;
        if (i === 0) ctx.moveTo(x, y);
        else {
          const px = (i - 1) * step;
          const py = height * baseline - heights[i - 1] * height * amplitude;
          const mx = (px + x) * 0.5;
          const my = (py + y) * 0.5;
          ctx.quadraticCurveTo(px, py, mx, my);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // Ridge metadata: lets landmark decoration root itself on the actual
  // skyline instead of the layer baseline.
  canvas.ridge = { heights, step, baseline, amplitude, height };
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
