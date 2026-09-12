// Cathode's renderer: a sibling of Renderer.js, not a branch inside it.
//
// main.js only ever asks a renderer for three things -- draw(sim, alpha),
// an optional dispose(), and an optional `composer` -- so a world that
// wants a genuinely different pipeline can implement that surface and
// replace the whole frame rather than skinning parts of it. That is why
// Cathode does not go in as a BiomeManager `kind` branch like the other
// worlds: a kind branch replaces the SCENERY, leaving the vector cast and
// the entire post-FX stack drawing on top of it. Pixel scenery under
// bloom-lit wireframe characters is not a different graphical experience.
//
// BiomeManager still runs under Cathode -- Simulation constructs and steps
// it, and it remains the authority on the section schedule and on which
// persona is currently cast (see CathodePalettes.js). Cathode simply never
// calls biomes.draw(); it reads the section state and paints its own frame.
//
// No `composer`: Cathode is a visualizer, so it has no mountain seekbar to
// hit-test. main.js already guards that property (`renderer?.composer ?`),
// so omitting it is a supported shape, not a hole.
import { hexToRgb } from '../../utils/color.js';
import { capFlashAlpha } from '../../ui/Accessibility.js';
import { personaFor, rampAt } from './CathodePalettes.js';
import {
  PixelBuffer, PIXEL_W, PIXEL_H, rampIndexFor,
} from './PixelBuffer.js';
import {
  buildLayerHeights, layerConfigFor, layerRampIndex, runsFromHeights,
} from './CathodeBackdrop.js';

/** How many parallax layers stand between the sky and the ground grid.
 *  Two: near and far. A third stopped reading as depth and started reading
 *  as clutter at 320x180 -- there just aren't enough vertical pixels for a
 *  third band of silhouette to mean anything once the horizon and grid
 *  already claim their share. */
export const LAYER_COUNT = 2;

/** Horizon as a fraction of buffer height. Low enough to leave room for a
 *  cast to stand on, high enough that the sky still carries the persona. */
export function horizonRowFor(h) {
  return Math.round(h * 0.62);
}

/**
 * The full backdrop as raw RGBA pixels: a dithered sky above the horizon,
 * flat darkest-ramp ground below it. Pure, and deliberately expensive --
 * it touches every pixel, so the renderer caches the result and only
 * rebuilds it when the persona (or size) actually changes. A sky is static
 * between section changes; paying 57,600 iterations per frame to redraw
 * something identical would be the whole frame budget for nothing.
 */
export function buildBackdropPixels(ramp, w, h, horizonRow) {
  const rgb = ramp.map(hexToRgb);
  const data = new Uint8ClampedArray(w * h * 4);
  const ground = rgb[0];
  for (let y = 0; y < h; y++) {
    const belowHorizon = y >= horizonRow;
    // Brightest at the horizon, darkest at the top of the frame -- the
    // direction every one of these palettes was designed to be read in.
    const level = horizonRow > 0 ? Math.min(1, y / horizonRow) : 0;
    for (let x = 0; x < w; x++) {
      const c = belowHorizon ? ground : rgb[rampIndexFor(level, ramp.length, x, y)];
      const o = (y * w + x) * 4;
      data[o] = c.r;
      data[o + 1] = c.g;
      data[o + 2] = c.b;
      data[o + 3] = 255;
    }
  }
  return data;
}

/** Scanline darkness. Reduced-flash callers get the same geometry at a
 *  much lower contrast rather than losing the CRT read entirely -- the
 *  lines are the texture, the flicker is what the setting is about. */
export function scanlineAlpha(reducedFlash) {
  return capFlashAlpha(reducedFlash ? 0.10 : 0.22, reducedFlash);
}

/** Corner darkness for the tube vignette. Unlike scanlines this is not
 *  flash-sensitive -- it is a static gradient, not a flicker, so
 *  reducedFlash leaves it alone. */
export const VIGNETTE_ALPHA = 0.35;

export class CathodeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.backend = 'cathode';
    this.buffer = new PixelBuffer(PIXEL_W, PIXEL_H);
    this._backdropName = null;
    this._backdrop = null; // ImageData, rebuilt on persona change
    this._scanPattern = null;
    this._scanAlpha = -1;
    this._layers = null; // per-layer {noise, scrollPxPerSec, ...}, rebuilt on song change
    this._layerSeed = null;
    this._vignette = null; // CanvasGradient, rebuilt on canvas resize
    this._vignetteSize = null;
  }

  /** The persona this frame paints in: whichever biome BiomeManager has
   *  cast for the current section, resolved against Cathode's own set. */
  _persona(sim) {
    return personaFor(sim?.biomes?.currentBlend?.to || sim?.biomes?.currentBlend?.from || null);
  }

  _ensureBackdrop(persona) {
    if (this._backdropName === persona.name && this._backdrop) return;
    const { w, h } = this.buffer;
    const pixels = buildBackdropPixels(persona.ramp, w, h, horizonRowFor(h));
    this._backdrop = new ImageData(pixels, w, h);
    this._backdropName = persona.name;
  }

  /** One noise field per layer, held for the whole song -- only the scroll
   *  phase changes frame to frame (see buildLayerHeights' `scrollPx`), so
   *  the underlying field itself has no reason to move or rebuild. Reseeds
   *  only when the song (and so its seed) actually changes. */
  _ensureLayers(songSeed) {
    const seed = Number.isFinite(songSeed) ? songSeed : 1;
    if (this._layerSeed === seed && this._layers) return this._layers;
    this._layers = Array.from({ length: LAYER_COUNT }, (_, i) => layerConfigFor(seed, i));
    this._layerSeed = seed;
    return this._layers;
  }

  /** A radial gradient darkening the corners -- built against the real
   *  backing store (a gradient's coordinates are canvas-space, not
   *  buffer-space), so it has to be rebuilt whenever the stage preset
   *  changes the canvas size, not every frame. */
  _ensureVignette(cw, ch) {
    const key = `${cw}x${ch}`;
    if (this._vignette && this._vignetteSize === key) return this._vignette;
    const cx = cw / 2;
    const cy = ch / 2;
    const inner = Math.min(cw, ch) * 0.35;
    const outer = Math.hypot(cx, cy);
    const g = this.ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${VIGNETTE_ALPHA})`);
    this._vignette = g;
    this._vignetteSize = key;
    return g;
  }

  /** A 1x3 repeating pattern is one fillRect per frame instead of ~360.
   *  Built against the destination context (patterns are context-bound)
   *  and rebuilt only when the alpha changes. */
  _ensureScanPattern(alpha) {
    if (this._scanPattern && this._scanAlpha === alpha) return this._scanPattern;
    const tile = document.createElement('canvas');
    tile.width = 1;
    tile.height = 3;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;
    tctx.fillStyle = `rgba(0,0,0,${alpha})`;
    tctx.fillRect(0, 0, 1, 1);
    this._scanPattern = this.ctx.createPattern(tile, 'repeat');
    this._scanAlpha = alpha;
    return this._scanPattern;
  }

  draw(sim, _alpha) {
    const { ctx, buffer } = this;
    if (!ctx || !buffer.ctx) return;
    const persona = this._persona(sim);
    const { ramp } = persona;
    const { w, h } = buffer;
    const horizon = horizonRowFor(h);

    this._ensureBackdrop(persona);
    buffer.ctx.putImageData(this._backdrop, 0, 0);

    const tSec = (sim?.timeMs ?? 0) / 1000;

    // Parallax skyline: farthest layer first so nearer ones draw over it.
    // Each layer's noise field is held for the whole song (_ensureLayers);
    // only the scroll phase advances per frame.
    const layers = this._ensureLayers(sim?.songSeed);
    for (let li = LAYER_COUNT - 1; li >= 0; li--) {
      const cfg = layers[li];
      const heights = buildLayerHeights(cfg.noise, w, horizon, {
        columnPx: cfg.columnPx,
        ampPx: cfg.ampPx,
        baseRowsAboveHorizon: cfg.baseRowsAboveHorizon,
        scrollPx: Math.round(tSec * cfg.scrollPxPerSec),
      });
      const color = rampAt(ramp, layerRampIndex(ramp.length, li));
      for (const run of runsFromHeights(heights, horizon)) {
        buffer.rect(run.x, horizon - run.height, run.width, run.height, color);
      }
    }

    // Horizon rule: the brightest step in the ramp, one pixel tall. The
    // single line that tells the eye where the floor is.
    buffer.rect(0, horizon, w, 1, rampAt(ramp, ramp.length - 1));

    // A ground grid receding toward the horizon, scrolled by song time so
    // the world reads as moving even before a cast exists. Spacing grows
    // with distance from the horizon, which is what sells the recession
    // without any actual perspective math.
    const gridColor = rampAt(ramp, Math.max(1, ramp.length - 3));
    for (let i = 1; i < 14; i++) {
      const depth = i / 14;
      const y = horizon + Math.round(depth * depth * (h - horizon));
      if (y >= h) break;
      buffer.rect(0, y, w, 1, gridColor);
    }
    const scroll = Math.round((tSec * 24) % 32);
    for (let x = -scroll; x < w; x += 32) {
      buffer.rect(x, horizon + 1, 1, h - horizon - 1, gridColor);
    }

    // Blit up. The destination is the real backing store, whatever the
    // stage preset made it -- Cathode's own resolution is fixed, so the
    // preset stays a pure performance lever here rather than changing the
    // look the way it does for the painterly renderer.
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    buffer.blitTo(ctx, this.canvas.width, this.canvas.height);

    const allowCrt = sim?.perf?.heavyPostFx ?? true;
    if (allowCrt) {
      const pattern = this._ensureScanPattern(scanlineAlpha(!!sim?.reducedFlash));
      if (pattern) {
        ctx.save();
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
      }
      // Vignette rides the same gate as scanlines (both are "is this device
      // paying for the full CRT read"), but is not reducedFlash-sensitive --
      // it is a static darkening, not a flicker.
      const vignette = this._ensureVignette(this.canvas.width, this.canvas.height);
      ctx.save();
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
  }

  dispose() {
    this.buffer?.dispose();
    this.buffer = null;
    this._backdrop = null;
    this._scanPattern = null;
    this._layers = null;
    this._vignette = null;
  }
}
