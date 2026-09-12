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
import { clamp01 } from '../../utils/math.js';
import { dropImpactStrength } from '../../render/Renderer.js';
import { personaFor, rampAt } from './CathodePalettes.js';
import {
  PixelBuffer, PIXEL_W, PIXEL_H, rampIndexFor,
} from './PixelBuffer.js';
import {
  buildLayerHeights, layerConfigFor, layerRampIndex, runsFromHeights,
} from './CathodeBackdrop.js';
import {
  BOSS_ROWS, MAX_TOPPER_ROWS, parseSpriteRows, spriteRelativeToRampIndex, bossFormFor,
  beatFlinchScale, bossReassembleU, glitchBandOffsets,
} from './CathodeBoss.js';

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

/** Ceiling on how far the game's own screen shake (sim.camera.shakeX/Y,
 *  stage-space pixels against a 1280-wide logical stage) is allowed to
 *  throw Cathode's much smaller 320-wide frame -- shake at 100% of the
 *  stage ratio would be a much larger fraction of a small buffer than it
 *  ever reads as on the painterly stage. Scaled down, then clamped again. */
const MAX_SHAKE_BUFFER_PX = 6;

/** Convert the game's own stage-space camera shake into buffer-space
 *  pixels, scaled by how much smaller Cathode's frame is. Reused rather
 *  than reimplemented: the game already computes impact + drift + beat
 *  sway into one number (CameraDirector.js); this only rescales it. */
export function shakeOffsetForBuffer(shakeX, shakeY, stageWidthPx, bufferWidthPx) {
  const ratio = stageWidthPx > 0 ? bufferWidthPx / stageWidthPx : 0;
  const clampAxis = (v) => Math.max(-MAX_SHAKE_BUFFER_PX, Math.min(MAX_SHAKE_BUFFER_PX, Math.round((v || 0) * ratio)));
  return { x: clampAxis(shakeX), y: clampAxis(shakeY) };
}

/** Ground-grid scroll speed, px/sec, scaled by how "epic" the moment reads
 *  (sim.vibe.epic, 0..1). A quiet verse crawls; a hyped chorus never sits
 *  still -- "constant motion" without every frame being equally loud. */
export function gridScrollSpeedFor(epic01) {
  return 24 + 40 * clamp01(epic01);
}

/** How many bands the backdrop tears into on a drop, and how far, scaled
 *  by the drop's own impact envelope (dropImpactStrength) -- separate from
 *  and much subtler than the boss's own longer tear/reassemble, since this
 *  is "the scenery took a hit", not "the boss came apart". */
const BACKDROP_TEAR_BANDS = 6;
const BACKDROP_TEAR_MAX_PX = 10;

/** One cell of the boss sprite drawn at this many buffer pixels, before
 *  the beat-flinch scale is applied on top. */
const BOSS_CELL_PX = 2;
/** How far (in 1x sprite pixels, before BOSS_CELL_PX scaling) a torn row
 *  may shift. Small in sprite space, since it is magnified by both
 *  BOSS_CELL_PX and the flinch scale by the time it reaches the buffer. */
const BOSS_TEAR_MAX_PX = 3;

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

    // The boss. Body parses once (static art); the topper cache is keyed
    // by persona name since there are only ever a handful of personas.
    // -Infinity matches HypeDirector's own "no drop yet" convention, so a
    // song that never drops never reads as having just dropped.
    this._bossBody = parseSpriteRows(BOSS_ROWS);
    this._topperCache = new Map();
    this._authoredDropAtMs = -Infinity;
    // Composited at 1x (one sprite pixel = one canvas pixel) with a margin
    // for the tear effect to shift rows into without clipping, then the
    // whole thing is scaled up in one drawImage call -- that's what lets
    // the beat-flinch pop be a smooth float scale instead of a per-cell
    // rounding mess at this resolution.
    // Height reserves MAX_TOPPER_ROWS above the body regardless of which
    // persona's topper is live, so a shorter (or absent, PHOSPHOR) topper
    // never has to move the body's own draw position -- it just leaves
    // its unused rows transparent.
    this._bossCanvas = document.createElement('canvas');
    this._bossCanvas.width = this._bossBody.w + BOSS_TEAR_MAX_PX * 2;
    this._bossCanvas.height = this._bossBody.h + MAX_TOPPER_ROWS;
    this._bossCtx = this._bossCanvas.getContext('2d');
    if (this._bossCtx) this._bossCtx.imageSmoothingEnabled = false;
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

  _ensureTopper(personaName) {
    if (!this._topperCache.has(personaName)) {
      this._topperCache.set(personaName, parseSpriteRows(bossFormFor(personaName)));
    }
    return this._topperCache.get(personaName);
  }

  /**
   * The boss: composited at 1x onto its own small canvas (rows shifted
   * horizontally there when a tear is in progress, so the shift can't clip
   * against the sprite's own edges -- see the canvas's built-in margin),
   * then scaled onto the buffer in one drawImage call. Scaling there rather
   * than per-cell is what makes the beat-flinch pop a clean float scale
   * instead of an integer-rounding mess at this resolution. The canvas's
   * top MAX_TOPPER_ROWS rows are always reserved for the topper, whatever
   * its actual height, so the body's own draw position never has to move.
   */
  _drawBoss(sim, persona, w, horizon, tSec, dropAtMs) {
    const { buffer } = this;
    const bctx = this._bossCtx;
    if (!bctx) return;
    const body = this._bossBody;
    const { ramp } = persona;
    const margin = BOSS_TEAR_MAX_PX;
    const bodyTop = MAX_TOPPER_ROWS;

    const bossAgeMs = (sim?.timeMs ?? 0) - dropAtMs;
    const tearAmount = clamp01(1 - bossReassembleU(bossAgeMs));
    const rowOffsets = tearAmount > 0
      ? glitchBandOffsets(sim?.songSeed ?? 1, tSec, tearAmount, body.h, BOSS_TEAR_MAX_PX)
      : null;

    bctx.clearRect(0, 0, this._bossCanvas.width, this._bossCanvas.height);
    for (let ry = 0; ry < body.h; ry++) {
      const rowOffset = rowOffsets ? rowOffsets[ry] : 0;
      for (let rx = 0; rx < body.w; rx++) {
        const rel = body.cells[ry * body.w + rx];
        if (rel < 0) continue;
        bctx.fillStyle = rampAt(ramp, spriteRelativeToRampIndex(rel, ramp.length));
        bctx.fillRect(margin + rx + rowOffset, bodyTop + ry, 1, 1);
      }
    }

    // The topper draws bottom-aligned against the body's top row, in the
    // reserved region above it -- unaffected by the tear, since a hat
    // doesn't need to come apart for the head under it to look hit.
    const topper = this._ensureTopper(persona.name);
    if (topper.w > 0 && topper.h > 0) {
      const topperX = margin + Math.round((body.w - topper.w) / 2);
      const topperTop = bodyTop - topper.h;
      for (let ry = 0; ry < topper.h; ry++) {
        for (let rx = 0; rx < topper.w; rx++) {
          const rel = topper.cells[ry * topper.w + rx];
          if (rel < 0) continue;
          bctx.fillStyle = rampAt(ramp, spriteRelativeToRampIndex(rel, ramp.length));
          bctx.fillRect(topperX + rx, topperTop + ry, 1, 1);
        }
      }
    }

    const beatPhase01 = sim?.beatAnchor ? sim.beatAnchor.phaseRad(sim.timeMs ?? 0) / (Math.PI * 2) : 0;
    const flinch = beatFlinchScale(beatPhase01, sim?.beatAnchor?.confidence ?? 0);

    // Feet stay anchored to the horizon and the whole sprite stays
    // horizontally centered regardless of flinch scale -- a hit pops the
    // boss UP and OUT from its base, never sideways or through the floor.
    const cw = this._bossCanvas.width;
    const ch = this._bossCanvas.height;
    const destW = cw * BOSS_CELL_PX * flinch;
    const destH = ch * BOSS_CELL_PX * flinch;
    const destX = Math.round((w - destW) / 2);
    // The image spans topper-region + body, so the body's own bottom edge
    // (what must sit ON the horizon) is the bottom of the WHOLE image, not
    // body.h alone -- destY has to account for the topper rows above it too.
    const destY = Math.round(horizon - destH);
    buffer.ctx.drawImage(this._bossCanvas, 0, 0, cw, ch, destX, destY, destW, destH);
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
    // Epic-scaled: a quiet verse's grid crawls, a hyped chorus's blasts by
    // -- "constant motion" without every moment being equally loud.
    const scroll = Math.round((tSec * gridScrollSpeedFor(sim?.vibe?.epic ?? 0)) % 32);
    for (let x = -scroll; x < w; x += 32) {
      buffer.rect(x, horizon + 1, 1, h - horizon - 1, gridColor);
    }

    // Drop envelope: covers both hype's automatic detection and an
    // authored cut, since both matter equally to "did something just hit".
    // An authored cut is a one-shot flag (true for one step only), so it's
    // latched into a timestamp the same way hype already carries its own
    // -- otherwise the reaction would last exactly one frame.
    if (sim?.cut?.dropJustCut || sim?.cut?.apotheosisJustCut) {
      this._authoredDropAtMs = sim?.timeMs ?? 0;
    }
    const dropAtMs = Math.max(sim?.hype?.dropAtMs ?? -Infinity, this._authoredDropAtMs);
    const dropStrength = dropImpactStrength(sim?.timeMs ?? 0, dropAtMs);

    this._drawBoss(sim, persona, w, horizon, tSec, dropAtMs);

    // Backdrop tear: the scenery drawn so far (sky, skyline, grid, and the
    // boss now standing in it) shifts apart in a few bands for the same
    // short window Renderer's own drop impact uses -- "the whole screen
    // took a hit", distinct from and much shorter than the boss's own
    // longer tear/reassemble above.
    if (dropStrength > 0) {
      const bandH = Math.ceil(h / BACKDROP_TEAR_BANDS);
      const offsets = glitchBandOffsets(sim?.songSeed ?? 1, tSec, dropStrength, BACKDROP_TEAR_BANDS, BACKDROP_TEAR_MAX_PX);
      const fillColor = rampAt(ramp, 0);
      for (let i = 0; i < BACKDROP_TEAR_BANDS; i++) {
        const off = offsets[i];
        if (off === 0) continue;
        const by = i * bandH;
        const bh = Math.min(bandH, h - by);
        if (bh <= 0) continue;
        buffer.ctx.drawImage(buffer.canvas, 0, by, w, bh, off, by, w, bh);
        if (off > 0) buffer.rect(0, by, off, bh, fillColor);
        else buffer.rect(w + off, by, -off, bh, fillColor);
      }
    }

    // Blit up, offset by the game's own screen shake (rescaled into buffer
    // space) so Cathode's frame shakes on the same hits the painterly
    // renderer does. The destination is the real backing store, whatever
    // the stage preset made it -- Cathode's own resolution is fixed, so the
    // preset stays a pure performance lever here rather than changing the
    // look the way it does for the painterly renderer.
    const shake = shakeOffsetForBuffer(sim?.camera?.shakeX ?? 0, sim?.camera?.shakeY ?? 0, sim?.canvasWidth ?? 1280, w);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(
      (shake.x * this.canvas.width) / w,
      (shake.y * this.canvas.height) / h,
    );
    buffer.blitTo(ctx, this.canvas.width, this.canvas.height);
    ctx.restore();

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
    if (this._bossCanvas) { this._bossCanvas.width = 0; this._bossCanvas.height = 0; }
    this._bossCanvas = null;
    this._bossCtx = null;
    this._topperCache = null;
  }
}
