// Autonomous closed-loop vision self-tuning (spec §5). A vision model is a
// noisy sensor, not a chat partner: slow sampling, strict schema, heavy
// actuator smoothing (owned by ParamBus), and revert-on-regress. This loop
// must be safe to fail 100% of the time — a provider being absent/unreachable
// or unconfigured degrades to a silent no-op, never a crash or a stuck game.
//
// Provider-agnostic: a provider adapter (src/vision/providers/*.js) owns the
// request shape (auth header, image encoding, JSON mode) and response content
// extraction; parseVisionResponse below is the single JSON validator across
// all of them. Settings (provider, apiKey, baseUrl, model) come from
// VisionSettings and hot-apply via updateSettings() with no reload.
import { RingBuffer } from '../utils/RingBuffer.js';
import { clamp, clamp01 } from '../utils/math.js';

export const CRITIC_SYSTEM = `You are the visual director of a rhythm-driven side-scroller. You receive 4 frames spanning ~1 second, in order, plus telemetry. Judge only what is visible. Respond with ONLY a JSON object matching the schema — no prose, no markdown fences.`;

const ADJUST_KEYS = ['jumpHeight', 'obstacleDensity', 'scrollSpeed', 'eqSensitivity', 'onsetThreshold'];
const CAPTURE_INTERVAL_MS = 350;
const CYCLE_PERIOD_MS = 15000;
const COOLDOWN_MS = 8000;
const MIN_FPS = 45;
const FETCH_TIMEOUT_MS = 20000;
const MIN_CONFIDENCE = 0.4;

export class VisionLoop {
  constructor(canvas, paramBus, sim, {
    enabled = false, settings = null, adapter = null,
  } = {}) {
    this.canvas = canvas;
    this.paramBus = paramBus;
    this.sim = sim;
    this.enabled = enabled;
    this.settings = settings || { provider: 'ollama', apiKey: '', baseUrl: '', model: '' };
    this.adapter = adapter || { id: 'ollama', defaultBaseUrl: 'http://localhost:11434/api/chat', defaultModel: 'llava:13b', needsKey: false };
    // JSON-mode is adapter-supported but adaptive: if a model 400s on the
    // JSON-mode request, we drop to prompt-only and stay there.
    this.jsonMode = this.adapter.supportsJsonMode ?? false;

    this.ring = new RingBuffer(4);
    this.log = new RingBuffer(40);

    this._captureCanvas = document.createElement('canvas');
    this._captureCanvas.width = 512;
    this._captureCanvas.height = 288;
    this._captureCtx = this._captureCanvas.getContext('2d');

    this._lastCaptureMs = -Infinity;
    this._lastCycleMs = -Infinity;
    this._cooldownUntilMs = -Infinity;
    this._inFlight = false;
    this._pendingBlob = false;

    this._fps = 60;
    this._lastFrameTime = null;
  }

  /** Hot-apply new provider settings without a reload. An in-flight cycle
   *  finishes on the old adapter; _inFlight serializes, so no mutex needed.
   *  Switching providers resets the JSON-mode adaptation (the new provider
   *  hasn't told us yet that it can't do JSON mode). */
  updateSettings(settings, adapter) {
    if (settings) this.settings = settings;
    if (adapter) {
      const changed = adapter.id !== this.adapter?.id;
      this.adapter = adapter;
      if (changed) this.jsonMode = adapter.supportsJsonMode ?? false;
    }
  }

  // Derived, for window.__SMW introspection and the debug overlay.
  get endpoint() { return this.settings.baseUrl || this.adapter.defaultBaseUrl; }
  get model() { return this.settings.model || this.adapter.defaultModel; }

  /** Called once per rAF frame (spec §6.1). tRafMs: performance.now(); nowSimMs: song-relative ms. */
  maybeSample(tRafMs, nowSimMs) {
    this._trackFps(tRafMs);
    if (!this.enabled) return;

    if (tRafMs - this._lastCaptureMs >= CAPTURE_INTERVAL_MS && !this._pendingBlob) {
      this._lastCaptureMs = tRafMs;
      this._captureFrame();
    }

    if (tRafMs - this._lastCycleMs < CYCLE_PERIOD_MS) return;
    if (tRafMs < this._cooldownUntilMs) return;
    if (this._fps < MIN_FPS) return; // perf first, aesthetics second
    if (this._inFlight) return;
    if (this.ring.length < 4) return;

    this._lastCycleMs = tRafMs;
    this._runCycle(nowSimMs);
  }

  _trackFps(tRafMs) {
    if (this._lastFrameTime !== null) {
      const dt = tRafMs - this._lastFrameTime;
      if (dt > 0) this._fps = this._fps * 0.9 + (1000 / dt) * 0.1;
    }
    this._lastFrameTime = tRafMs;
  }

  _captureFrame() {
    this._pendingBlob = true;
    this._captureCtx.drawImage(this.canvas, 0, 0, this._captureCanvas.width, this._captureCanvas.height);
    this._captureCanvas.toBlob((blob) => {
      if (!blob) { this._pendingBlob = false; return; }
      const reader = new FileReader();
      reader.onload = () => {
        this._pendingBlob = false;
        const base64 = String(reader.result).split(',')[1];
        if (base64) this.ring.push(base64);
      };
      reader.onerror = () => { this._pendingBlob = false; };
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.7);
  }

  async _runCycle(nowSimMs) {
    this._inFlight = true;
    const frames = this.ring.toArray();
    const telemetry = this._buildTelemetry(nowSimMs);

    // Fail-safe: cloud providers need a key. No key -> silent no-op, never a
    // crash. Ollama is local and needs none.
    if (this.adapter.needsKey && !this.settings.apiKey) {
      this._inFlight = false;
      this.log.push({ t: nowSimMs, applied: false, reason: 'no-api-key' });
      return;
    }

    try {
      let result = await this._attempt(frames, telemetry);
      // Some vision models 400 on the JSON-mode request. Drop to prompt-only
      // and retry the same cycle once; stay prompt-only for subsequent cycles.
      if (result.status === 400 && this.jsonMode) {
        this.jsonMode = false;
        this.log.push({ t: nowSimMs, applied: false, reason: 'json-mode-disabled-by-400' });
        result = await this._attempt(frames, telemetry);
      }
      if (result.parsed) this._applyResult(result.parsed, nowSimMs);
      else this.log.push({ t: nowSimMs, applied: false, reason: result.reason || 'invalid-or-low-confidence-payload' });
    } catch (err) {
      this.log.push({ t: nowSimMs, applied: false, reason: String((err && err.message) || err) });
    } finally {
      this._inFlight = false;
    }
  }

  // One request+parse attempt. Returns { status, parsed, reason }. Network
  // errors throw (caught by _runCycle); a non-OK HTTP returns a status reason.
  async _attempt(frames, telemetry) {
    const { url, headers, body } = this.adapter.buildRequest({
      frames, telemetry, system: CRITIC_SYSTEM,
      baseUrl: this.endpoint, model: this.model, apiKey: this.settings.apiKey,
      jsonMode: this.jsonMode,
    });
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers,
      body,
    });
    if (!res.ok) return { status: res.status, parsed: null, reason: `HTTP ${res.status}` };
    const data = await res.json();
    const content = this.adapter.extractContent(data);
    const parsed = parseVisionResponse(content);
    return { status: res.status, parsed, reason: parsed ? null : 'invalid-or-low-confidence-payload' };
  }

  _buildTelemetry(nowSimMs) {
    const p = this.paramBus.live;
    const bpm = this.sim.jump ? this.sim.jump.bpm : 0;
    const energy = this.sim.energyCurves ? this.sim.energyCurves.globalEnergy(nowSimMs) : 0;
    return [
      `TELEMETRY: bpm=${Math.round(bpm)} sectionEnergy=${energy.toFixed(2)}/1 fps=${Math.round(this._fps)}`,
      `multipliers: jump=${p.jumpHeight.toFixed(2)} obstacles=${p.obstacleDensity.toFixed(2)} scroll=${p.scrollSpeed.toFixed(2)} eqSens=${p.eqSensitivity.toFixed(2)} onset=${p.onsetThreshold.toFixed(2)}`,
      'CHECKLIST — score each 0(fine)–3(broken):',
      'eq_motion: are EQ bars moving with apparent music energy, or stagnant/pinned?',
      'speed_match: does world scroll urgency match the energy of the frames?',
      'companion_weight: do companion poses differ across frames (alive) or repeat?',
      'clutter: is the character silhouette readable against particles/cracks?',
      'Then propose multiplier targets (0.5–1.5) for: jumpHeight, obstacleDensity, scrollSpeed, eqSensitivity, onsetThreshold. Only move what your observations justify; return 1.0 for anything fine.',
    ].join('\n');
  }

  _applyResult(parsed, nowSimMs) {
    const severity = parsed.observations.eq_motion + parsed.observations.speed_match
      + parsed.observations.companion_weight + parsed.observations.clutter;

    // Evaluate the PREVIOUS applied cycle's effect first (may revert it),
    // then snapshot the (possibly-reverted) state before applying this
    // cycle's own proposal (spec §5.2.3).
    this.paramBus.updateTrust(severity);
    this.paramBus.snapshotForRevert();
    this.paramBus.propose(parsed.adjust, parsed.confidence);

    this._cooldownUntilMs = this._lastCycleMs + COOLDOWN_MS;

    this.log.push({
      t: nowSimMs, applied: true, observations: parsed.observations, adjust: parsed.adjust,
      confidence: parsed.confidence, trust: this.paramBus.trust, severity,
    });
  }
}

/**
 * Defensive parse of a vision-model response into a validated adjustment
 * (spec §5.2.1): strip stray fences, type-check every field, clamp
 * everything to schema bounds, reject the whole payload on any doubt.
 * Provider-agnostic — takes the already-extracted content *string* from the
 * adapter's extractContent(), so it works for Ollama, OpenAI, Anthropic,
 * Gemini, and OpenRouter uniformly. Pure function — exported standalone so
 * it's unit-testable without a DOM.
 */
export function parseVisionResponse(contentStr) {
  try {
    let content = String(contentStr ?? '').trim()
      .replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const obj = JSON.parse(content);
    if (!obj || typeof obj !== 'object') return null;

    const obs = obj.observations, adj = obj.adjust, confidence = obj.confidence;
    if (!obs || !adj || typeof confidence !== 'number') return null;
    if (!ADJUST_KEYS.every((k) => k in adj)) return null;

    const clampScore = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(3, Math.round(v))) : 0);
    const observations = {
      eq_motion: clampScore(obs.eq_motion),
      speed_match: clampScore(obs.speed_match),
      companion_weight: clampScore(obs.companion_weight),
      clutter: clampScore(obs.clutter),
      notes: typeof obs.notes === 'string' ? obs.notes.slice(0, 160) : '',
    };

    const adjust = {};
    for (const k of ADJUST_KEYS) {
      const v = adj[k];
      adjust[k] = Number.isFinite(v) ? clamp(v, 0.5, 1.5) : 1.0;
    }

    const conf = clamp01(confidence);
    if (conf < MIN_CONFIDENCE) return null;

    return { observations, adjust, confidence: conf };
  } catch {
    return null;
  }
}
