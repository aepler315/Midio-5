import { createRenderer } from './WebGLRenderer.js';
import { PixelPresentation } from './PixelPresentation.js';

export function createPresentingRenderer({ canvas, mode = 'canvas', presentation, residency, rendererFactory = createRenderer }) {
  return new PresentingRenderer({ canvas, mode, presentation, residency, rendererFactory });
}
class PresentingRenderer {
  constructor({ canvas, mode, presentation, residency, rendererFactory }) {
    this.canvas = canvas;
    this.inner = rendererFactory(canvas, mode);
    this.output = new PixelPresentation({ canvas, presentation, residency });
    this._disposed = false;
  }
  get backend() { return this.inner.backend || 'canvas'; }
  get canvasRenderer() { return this.inner.canvasRenderer || this.inner; }
  get drawCount() { return this.inner.drawCount; }
  get composer() { return this.canvasRenderer.composer; }
  set composer(value) { this.canvasRenderer.composer = value; }
  get rangePresentation() { return this.inner.rangePresentation; }
  set rangePresentation(value) { this.inner.rangePresentation = value; }
  get hudInFrame() { return this.inner.hudInFrame; }
  set hudInFrame(value) { this.inner.hudInFrame = value; }
  get rangeListeningActive() { return this.canvasRenderer.rangeListeningActive; }
  get diagnostics() { return this.output.diagnostics; }
  setPresentation(value) { this.output.setPresentation(value); }
  getCaptureSource() { return this.output.getCaptureSource(); }
  draw(sim, alpha) {
    const source = this.output.beginFrame();
    if (!source) return;
    const scene = this.canvasRenderer;
    scene.canvas = source; scene.ctx = source.getContext('2d');
    this.inner.presentationPixelated = this.output.presentation.pixelated;
    this.inner.draw(sim, alpha);
    this.output.finishFrame();
    this.output.diagnostics.qualityLevel = sim?.perf?.level ?? null;
  }
  dispose() { if (this._disposed) return; this._disposed = true; this.inner.dispose(); this.output.dispose(); }
}
