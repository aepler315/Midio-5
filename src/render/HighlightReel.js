// The Reel (Movement VI): the product finally ends with proof of what it
// did. A downscaled JPEG thumbnail is grabbed at each drop, each excursion
// launch, the atlas detonation, and the last pre-freeze frame -- capped at
// MAX_FRAMES, spaced by MIN_GAP_MS so a burst of events can't flood the
// filmstrip. `notify()` edge-triggers on a boolean condition so callers
// just describe "is this event happening right now", never track their
// own has-it-fired-yet state.
const MAX_FRAMES = 8;
const MIN_GAP_MS = 5000;
const THUMB_W = 320, THUMB_H = 180; // 16:9 downscale of the 1280x720 stage
const JPEG_QUALITY = 0.72;

export class HighlightReel {
  constructor() {
    this.frames = []; // [{dataUrl, atMs, label}]
    this._lastCaptureMs = -Infinity;
    this._prevCondition = new Map(); // event key -> last boolean seen
    this._thumbCanvas = null; // lazily created (browser-only)
  }

  /** Pure gating check, testable without a canvas. */
  canCapture(nowMs) {
    return this.frames.length < MAX_FRAMES && nowMs - this._lastCaptureMs >= MIN_GAP_MS;
  }

  /** Edge-triggers a capture for the given event `key`: once `conditionNow`
   *  is true, it keeps trying (once per call) until a capture actually
   *  succeeds -- so a gate that's briefly shut (cap/min-gap) doesn't
   *  permanently swallow the event, as long as `conditionNow` is still
   *  true on a later call. Once captured, stays quiet until `conditionNow`
   *  drops back to false, so a held condition never re-fires. */
  notify(key, conditionNow, canvas, nowMs, label) {
    if (!conditionNow) {
      this._prevCondition.set(key, false);
      return false;
    }
    if (this._prevCondition.get(key)) return false; // already captured this rising edge
    if (!this.canCapture(nowMs)) return false; // gate shut -- stay pending, retry next call
    const captured = this.capture(canvas, nowMs, label);
    if (captured) this._prevCondition.set(key, true);
    return captured;
  }

  /** Grabs a downscaled JPEG thumbnail from the live stage canvas right now.
   *  Browser-only (canvas/toDataURL); callers needing the pure gate alone
   *  should use canCapture()/notify(). */
  capture(canvas, nowMs, label) {
    if (!this.canCapture(nowMs)) return false;
    if (!this._thumbCanvas) {
      this._thumbCanvas = document.createElement('canvas');
      this._thumbCanvas.width = THUMB_W;
      this._thumbCanvas.height = THUMB_H;
    }
    const ctx = this._thumbCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, THUMB_W, THUMB_H);
    const dataUrl = this._thumbCanvas.toDataURL('image/jpeg', JPEG_QUALITY);
    this.frames.push({ dataUrl, atMs: nowMs, label });
    this._lastCaptureMs = nowMs;
    return true;
  }
}
