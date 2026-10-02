import { applyPalette } from './PaletteQuantize.js';
import { sharedResidency } from './GraphicsResidency.js';

export function fitPixelRect(srcW, srcH, dstW, dstH, scaling = 'fit') {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return { x: 0, y: 0, width: 0, height: 0, scale: 0 };
  const fit = Math.min(dstW / srcW, dstH / srcH);
  const scale = scaling === 'integer' && fit >= 1 ? Math.floor(fit) : fit;
  const width = srcW * scale, height = srcH * scale;
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height, scale };
}
let nextOwner = 0;
/** Owns only the bounded working buffer. The output belongs to the caller. */
export class PixelPresentation {
  constructor({ canvas, presentation, residency = sharedResidency() }) {
    this.canvas = canvas;
    this.residency = residency;
    this.key = `pixel-presentation:${++nextOwner}`;
    this.working = null;
    this.generation = 0;
    this._securityGeneration = null;
    this._disposed = false;
    this.setPresentation(presentation);
  }
  setPresentation(presentation) {
    if (JSON.stringify(presentation) === JSON.stringify(this.presentation)) return;
    this.presentation = { ...presentation };
    this.generation++;
    this._securityGeneration = null;
    this.diagnostics = { requestedLook: presentation.pixelated ? (presentation.paletteId === 'none' ? 'pixel' : 'palette') : 'natural',
      effectiveLook: 'natural', paletteStatus: { applied: false, reason: null, pixels: 0 }, paletteCpuMs: 0, readbackCpuMs: 0 };
    if (!presentation.pixelated) this._releaseWorking();
  }
  _releaseWorking() {
    this.residency.release(this.key);
    this.working = null;
  }
  beginFrame() {
    if (this._disposed) return null;
    const { canvas, presentation: p } = this;
    if (this._outputSize !== `${canvas.width}x${canvas.height}`) {
      this._outputSize = `${canvas.width}x${canvas.height}`;
      this.generation++; this._securityGeneration = null;
    }
    this.diagnostics.output = { width: canvas.width, height: canvas.height };
    if (!p.pixelated || canvas.width === 320 && canvas.height === 180) {
      this.source = canvas;
    } else {
      if (!this.working) {
        const reservation = this.residency.reserve({ key: this.key, bytes: 320 * 180 * 4, owner: 'pixel-presentation', evictable: false });
        if (!reservation) {
          this.diagnostics.effectiveLook = 'pixel';
          this.diagnostics.paletteStatus = { applied: false, reason: 'unavailable', pixels: 0 };
          return null;
        }
        try {
          const buffer = (canvas.ownerDocument || globalThis.document).createElement('canvas');
          buffer.width = 320; buffer.height = 180;
          if (!buffer.getContext('2d')) throw Error('Working context unavailable');
          if (!this.residency.commit(reservation, buffer, c => { c.width = 0; c.height = 0; })) return null;
          this.working = buffer;
        } catch {
          this.residency.release(this.key);
          this.diagnostics.paletteStatus = { applied: false, reason: 'unavailable', pixels: 0 };
          return null;
        }
      }
      this.source = this.working;
    }
    this.diagnostics.working = { width: this.source.width, height: this.source.height };
    this.source.getContext('2d').imageSmoothingEnabled = !p.pixelated;
    return this.source;
  }
  finishFrame() {
    if (!this.source || this._disposed) return;
    const p = this.presentation, source = this.source;
    this.diagnostics.effectiveLook = p.pixelated ? 'pixel' : 'natural';
    let status = { applied: false, reason: null, pixels: 0 };
    if (p.paletteId !== 'none' && p.pixelated) {
      if (this._securityGeneration === this.generation) status = { applied: false, reason: 'security', pixels: source.width * source.height };
      else status = applyPalette(source.getContext('2d'), source, { paletteId: p.paletteId, dither: p.dither });
      if (status.reason === 'security') this._securityGeneration = this.generation;
      if (status.applied) this.diagnostics.effectiveLook = 'palette';
    }
    this.diagnostics.paletteStatus = status;
    this.diagnostics.paletteCpuMs = status.cpuMs || 0;
    this.diagnostics.readbackCpuMs = status.readbackMs || 0;
    if (source !== this.canvas) {
      const ctx = this.canvas.getContext('2d');
      const fit = fitPixelRect(source.width, source.height, this.canvas.width, this.canvas.height, p.scaling);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = !p.pixelated;
      ctx.drawImage(source, fit.x, fit.y, fit.width, fit.height);
    }
  }
  getCaptureSource() { return { canvas: this.source || this.canvas, pixelated: !!this.presentation.pixelated, scaling: this.presentation.scaling }; }
  dispose() { if (this._disposed) return; this._disposed = true; this._releaseWorking(); this.source = null; }
}
