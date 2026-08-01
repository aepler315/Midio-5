// Records a live replay of the stage into a downloadable video: the song
// replays in real time (deterministic, seeded, autoplay-driven -- see
// Simulation) while this taps the canvas via captureStream and the single
// AudioEngine.master gain node via createMediaStreamDestination, feeding
// both into a MediaRecorder. 1080p/1440p are per-frame high-quality
// upscales of the fixed 1280x720 stage (the sim's anchors are absolute
// stage pixels -- Midio.js -- so there is no native hi-res render path).
// Pure helpers first (testable without a DOM); the class wraps the
// stateful browser APIs.

export const RES_PRESETS = {
  720: { w: 1280, h: 720 },
  1080: { w: 1920, h: 1080 },
  1440: { w: 2560, h: 1440 },
};

export function exportDims(preset) {
  return RES_PRESETS[preset] || RES_PRESETS[720];
}

// mp4 candidates first (best portability); webm always last as the
// universally-supported fallback in Chromium/Firefox.
export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** First supported mime from `candidates`, or null if none are. Pure --
 *  `isSupported` is injected so this is testable without a real
 *  MediaRecorder. */
export function pickRecorderMime(candidates, isSupported) {
  for (const c of candidates) {
    if (isSupported(c)) return c;
  }
  return null;
}

export function extensionForMime(mime) {
  if (!mime) return 'webm';
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** Rough target bitrate (bits/sec), clamped to a sane 6-24 Mbps window --
 *  monotone in resolution and frame rate. */
export function videoBitrate(w, h, fps) {
  const raw = w * h * fps * 0.12;
  return Math.round(Math.max(6_000_000, Math.min(24_000_000, raw)));
}

export function exportFilename(name, preset, fps, mime) {
  const slug = String(name || 'song').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'song';
  const ext = extensionForMime(mime);
  return `super-midio-world-${slug}-${preset}p${fps}.${ext}`;
}

export class VideoExporter {
  constructor({ audioEngine, sourceCanvas }) {
    this.audioEngine = audioEngine;
    this.sourceCanvas = sourceCanvas;
    this.exportCanvas = null;
    this.exportCtx = null;
    this.recorder = null;
    this.mime = null;
    this._chunks = [];
    this._audioDest = null;
    this._stream = null;
    this.active = false;
  }

  start({ width, height, fps }) {
    const doc = this.sourceCanvas.ownerDocument || document;
    this.exportCanvas = doc.createElement('canvas');
    this.exportCanvas.width = width;
    this.exportCanvas.height = height;
    this.exportCtx = this.exportCanvas.getContext('2d');
    this.exportCtx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in this.exportCtx) this.exportCtx.imageSmoothingQuality = 'high';

    const videoStream = this.exportCanvas.captureStream(fps);
    this._audioDest = this.audioEngine.ctx.createMediaStreamDestination();
    this.audioEngine.master.connect(this._audioDest);

    this._stream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...this._audioDest.stream.getAudioTracks(),
    ]);

    this.mime = pickRecorderMime(MIME_CANDIDATES, (m) => MediaRecorder.isTypeSupported(m));
    const opts = { videoBitsPerSecond: videoBitrate(width, height, fps) };
    if (this.mime) opts.mimeType = this.mime;
    this._chunks = [];
    this.recorder = new MediaRecorder(this._stream, opts);
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
    this.recorder.start(1000);
    this.active = true;
  }

  /** Blits the current stage frame into the export canvas at its (possibly
   *  larger) resolution. Call once per rendered frame while recording. */
  captureFrame() {
    if (!this.active || !this.exportCtx) return;
    this.exportCtx.drawImage(this.sourceCanvas, 0, 0, this.exportCanvas.width, this.exportCanvas.height);
  }

  /** Stops recording and resolves with the recorded Blob. */
  stop() {
    if (!this.active || !this.recorder) return Promise.resolve(null);
    this.active = false;
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        const blob = new Blob(this._chunks, { type: this.mime || 'video/webm' });
        this._teardown();
        resolve(blob);
      };
      this.recorder.stop();
    });
  }

  /** Aborts a live recording, discarding whatever was captured. */
  abort() {
    if (!this.active) return;
    this.active = false;
    try { this.recorder?.stop(); } catch { /* already stopped */ }
    this._chunks = [];
    this._teardown();
  }

  _teardown() {
    try { this.audioEngine.master.disconnect(this._audioDest); } catch { /* already disconnected */ }
    this._audioDest = null;
    this._stream = null;
  }
}
