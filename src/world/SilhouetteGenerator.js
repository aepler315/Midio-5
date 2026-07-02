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
  return canvas;
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
