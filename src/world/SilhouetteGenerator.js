// Generates tileable 2048px silhouette strips for parallax layers 2-5
// (spec §4.1.1) from 1-D fractal value noise, cached to an offscreen canvas
// so each biome pays the noise-generation cost only once.
import { ValueNoise1D } from '../utils/noise.js';
import { lerp } from '../utils/math.js';

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}

export function generateSilhouette({
  seed, width = 2048, height = 320, octaves = 2, baseline = 0.55, amplitude = 0.30, color, step = 4,
  edgeLight = null, // optional neon ridge-line stroke (CYBER's edgeLight hook)
}) {
  const noise = new ValueNoise1D(seed, 256);
  const n = Math.floor(width / step) + 1;
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * step;
    heights[i] = noise.fbm(x * 0.006, octaves);
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
  for (let i = 0; i < n; i++) {
    const y = height * baseline - heights[i] * height * amplitude;
    ctx.lineTo(i * step, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  if (edgeLight) {
    // Two-pass glow along the ridge: a wide faint stroke under a thin
    // bright one -- baked once, free forever.
    for (const [lw, alpha] of [[4, 0.30], [1.5, 0.85]]) {
      ctx.strokeStyle = edgeLight;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const y = height * baseline - heights[i] * height * amplitude;
        if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(i * step, y);
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
