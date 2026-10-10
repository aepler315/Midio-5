import { applyPalette } from './PaletteQuantize.js';
import { sharedResidency } from './GraphicsResidency.js';

export function fitPixelRect(srcW, srcH, dstW, dstH, scaling = 'fit', origin = { x: 0, y: 0 }) {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return { x: 0, y: 0, width: 0, height: 0, scale: 0 };
  const fit = Math.min(dstW / srcW, dstH / srcH);
  const scale = scaling === 'integer' && fit >= 1 ? Math.floor(fit) : fit;
  const width = srcW * scale, height = srcH * scale;
  let x = (dstW - width) / 2, y = (dstH - height) / 2;
  // All coordinates here are device pixels. A fractional parent origin
  // needs the opposite fractional local offset to align the absolute image.
  // Exact centering can leave opposite bars one physical pixel different.
  if (scaling === 'integer' && fit >= 1) {
    x = Math.round(origin.x + x) - origin.x;
    y = Math.round(origin.y + y) - origin.y;
  }
  return { x, y, width, height, scale };
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
    this.frameId = 0;
    this.failures = 0;
    this._securityGeneration = null;
    this._disposed = false;
    this.setPresentation(presentation);
  }
  _invalidateCapture() {
    this.source = null;
    this._pending = null;
    this._capture = null;
  }
  setPresentation(presentation) {
    if (JSON.stringify(presentation) === JSON.stringify(this.presentation)) return;
    this._invalidateCapture();
    this.presentation = { ...presentation };
    this.generation++;
    this._securityGeneration = null;
    this.diagnostics = { requestedLook: presentation.pixelated ? (presentation.paletteId === 'none' ? 'pixel' : 'palette') : 'natural',
      effectiveLook: 'natural', paletteStatus: { applied: false, reason: null, pixels: 0 }, paletteCpuMs: 0, readbackCpuMs: 0,
      frame: { presented: false, generation: this.generation, reason: 'not-rendered' } };
    if (!presentation.pixelated) this._releaseWorking();
  }
  _releaseWorking() {
    this._invalidateCapture();
    this.residency.release(this.key);
    this.working = null;
  }
  failFrame(reason = 'unavailable') {
    this._invalidateCapture();
    this.failures = Math.min(Number.MAX_SAFE_INTEGER, this.failures + 1);
    const result = { presented: false, generation: this.generation, reason };
    this.diagnostics.frame = { ...result, failures: this.failures };
    return result;
  }
  beginFrame() {
    this._invalidateCapture();
    if (this._disposed) return null;
    const { canvas, presentation: p } = this;
    if (this._outputSize !== `${canvas.width}x${canvas.height}`) {
      this._outputSize = `${canvas.width}x${canvas.height}`;
      this.generation++; this._securityGeneration = null;
    }
    this.diagnostics.output = { width: canvas.width, height: canvas.height };
    this.diagnostics.frame = { presented: false, generation: this.generation, reason: 'in-progress' };
    try {
      if (!(canvas.width > 0 && canvas.height > 0) || !canvas.getContext('2d')) {
        this.failFrame('output-context'); return null;
      }
      if (!p.pixelated || canvas.width === 320 && canvas.height === 180) {
        this.source = canvas;
      } else {
        // A released buffer is not usable even if a JS reference survives.
        if (this.working && this.residency.get(this.key) !== this.working) this._releaseWorking();
        if (!this.working) {
          const reservation = this.residency.reserve({ key: this.key, bytes: 320 * 180 * 4, owner: 'pixel-presentation', evictable: false });
          if (!reservation) {
            this.diagnostics.paletteStatus = { applied: false, reason: 'unavailable', pixels: 0 };
            this.failFrame('allocation-denied'); return null;
          }
          const buffer = (canvas.ownerDocument || globalThis.document).createElement('canvas');
          buffer.width = 320; buffer.height = 180;
          if (!buffer.getContext('2d')) throw Error('Working context unavailable');
          if (!this.residency.commit(reservation, buffer, c => { c.width = 0; c.height = 0; })) {
            this.residency.release(this.key);
            this.failFrame('reservation-commit'); return null;
          }
          this.working = buffer;
        }
        this.source = this.working;
      }
      const ctx = this.source.getContext('2d');
      if (!ctx) throw Error('Source context unavailable');
      ctx.imageSmoothingEnabled = !p.pixelated;
      this.diagnostics.working = { width: this.source.width, height: this.source.height };
      this._pending = { generation: this.generation, outputSize: this._outputSize };
      return this.source;
    } catch {
      this._releaseWorking();
      this.diagnostics.paletteStatus = { applied: false, reason: 'unavailable', pixels: 0 };
      this.failFrame('source-unavailable'); return null;
    }
  }
  finishFrame() {
    if (!this.source || !this._pending || this._disposed) {
      return this.diagnostics.frame?.presented === false ? this.diagnostics.frame : this.failFrame('not-rendered');
    }
    const p = this.presentation, source = this.source, pending = this._pending;
    if (pending.generation !== this.generation || pending.outputSize !== `${this.canvas.width}x${this.canvas.height}`
      || source === this.working && this.residency.get(this.key) !== source) return this.failFrame('stale-frame');
    try {
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
        if (!ctx) return this.failFrame('output-context');
        const fit = fitPixelRect(source.width, source.height, this.canvas.width, this.canvas.height, p.scaling);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.imageSmoothingEnabled = !p.pixelated;
        ctx.drawImage(source, fit.x, fit.y, fit.width, fit.height);
      }
      this._pending = null;
      const result = { presented: true, generation: this.generation, frameId: ++this.frameId };
      this.diagnostics.frame = result;
      this._capture = { ...result, canvas: source, pixelated: !!p.pixelated, scaling: p.scaling,
        width: source.width, height: source.height, outputSize: pending.outputSize };
      return result;
    } catch { return this.failFrame('presentation-failed'); }
  }
  getCaptureSource() {
    const c = this._capture;
    if (!c || this._disposed || c.generation !== this.generation || c.outputSize !== `${this.canvas.width}x${this.canvas.height}`
      || c.width !== c.canvas.width || c.height !== c.canvas.height
      || c.canvas === this.working && this.residency.get(this.key) !== c.canvas) return null;
    return c;
  }
  dispose() { if (this._disposed) return; this._disposed = true; this._releaseWorking(); }
}
