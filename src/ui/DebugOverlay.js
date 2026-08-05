// Debug overlay (spec §5.2.3): backtick toggles visibility, renders the
// ParamBus live/target state and the vision loop's 40-entry ring log so the
// self-tuning loop's recent history is inspectable.
//
// It also carries the tuning readout for movement intensity and timing. The
// whole-song energy trace is the important part: EnergyCurves holds the
// entire curve offline, so the canvas can draw the song end-to-end with the
// p10/p90 references, the detected section boundaries and a live playhead.
// That turns "the characters feel too hyper in the quiet part" into a
// checkable claim -- play the song, watch the trace, and read off the
// timestamps where the curve disagrees with your ears.
import { MAX_LEVEL } from '../render/PerfGovernor.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';

const TRACE_W = 460, TRACE_H = 86;
const TRACE_SMOOTH = 7; // display-only moving average, in trace pixels

/** Centered moving average. Edges shrink the window rather than padding, so
 *  the first and last samples aren't dragged toward zero. */
function smooth(arr, halfWidth = TRACE_SMOOTH) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let k = -halfWidth; k <= halfWidth; k++) {
      const j = i + k;
      if (j >= 0 && j < arr.length) { s += arr[j]; n++; }
    }
    out[i] = n > 0 ? s / n : 0;
  }
  return out;
}

export class DebugOverlay {
  constructor(el, sim, paramBus, visionLoop, perfGovernor = null) {
    this.el = el;
    this.sim = sim;
    this.paramBus = paramBus;
    this.visionLoop = visionLoop;
    this.perfGovernor = perfGovernor;
    this.visible = false;

    // The overlay used to be a bare textContent write; it now owns a <pre>
    // plus a <canvas> so the trace can live alongside the text.
    this.el.textContent = '';
    this.canvas = document.createElement('canvas');
    this.canvas.width = TRACE_W;
    this.canvas.height = TRACE_H;
    this.canvas.style.display = 'block';
    this.canvas.style.margin = '0 0 8px';
    this.canvas.style.borderRadius = '4px';
    this.pre = document.createElement('pre');
    this.pre.style.margin = '0';
    this.pre.style.font = 'inherit';
    // Wrap rather than clip: the panel is 380px and several lines are longer.
    this.pre.style.whiteSpace = 'pre-wrap';
    this.el.appendChild(this.canvas);
    this.el.appendChild(this.pre);

    this._trace = null; // cached whole-song curve; rebuilt when the song changes
  }

  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
  }

  toggleVision() {
    this.visionLoop.enabled = !this.visionLoop.enabled;
  }

  /** Sample the normalized curve across the whole song once, at trace
   *  resolution. Cheap (TRACE_W samples) and cached -- the curve is static
   *  for a given song. */
  _buildTrace() {
    const curves = this.sim.energyCurves;
    const durationMs = this.sim.conductor?.durationMs || 0;
    if (!curves || !curves.globalEnergyNorm || durationMs <= 0) return null;
    const norm = new Float32Array(TRACE_W);
    const raw = new Float32Array(TRACE_W);
    for (let x = 0; x < TRACE_W; x++) {
      const t = (x / (TRACE_W - 1)) * durationMs;
      norm[x] = curves.globalEnergyNorm(t, FLAT_WEIGHTS);
      raw[x] = curves.globalEnergy(t, FLAT_WEIGHTS);
    }
    // Smooth for DISPLAY only. Raw 50Hz energy is dominated by per-kick
    // spikes, which bury the thing this trace exists to show: which parts of
    // the song are the quiet ones. The gates downstream read the unsmoothed
    // signal (they do their own EMA); this is purely so the shape is legible.
    return { norm: smooth(norm), raw: smooth(raw), rawSpiky: raw, durationMs, cal: curves.calibration(FLAT_WEIGHTS) };
  }

  _drawTrace() {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, TRACE_W, TRACE_H);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, TRACE_W, TRACE_H);

    if (!this._trace) this._trace = this._buildTrace();
    const tr = this._trace;
    if (!tr) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px monospace';
      ctx.fillText('no energy curves', 8, 20);
      return;
    }

    const y = (v) => TRACE_H - 4 - v * (TRACE_H - 10);

    // Section boundaries first, so the curves draw over them.
    const sections = this.sim.biomes?.sections || [];
    ctx.strokeStyle = 'rgba(255,210,120,0.35)';
    ctx.lineWidth = 1;
    for (const s of sections) {
      const x = Math.round((s.startMs / tr.durationMs) * TRACE_W) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TRACE_H); ctx.stroke();
    }

    // p10/p90 reference lines: where the normalization anchors sit.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([3, 3]);
    for (const v of [0.15, 0.85]) {
      ctx.beginPath(); ctx.moveTo(0, y(v)); ctx.lineTo(TRACE_W, y(v)); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Raw absolute energy (dim) under the normalized curve (bright): the gap
    // between them IS the correction this song is getting.
    const line = (arr, style) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < TRACE_W; x++) {
        const py = y(Math.max(0, Math.min(1, arr[x])));
        if (x === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      }
      ctx.stroke();
    };
    line(tr.raw, 'rgba(120,160,200,0.45)');
    line(tr.norm, 'rgba(120,230,180,0.95)');

    // Playhead.
    const nowMs = this.sim.timeMs || 0;
    const px = Math.round((nowMs / tr.durationMs) * TRACE_W) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, TRACE_H); ctx.stroke();
  }

  render() {
    if (!this.visible) return;
    const p = this.paramBus;
    const lines = [];

    lines.push('=== PARAM BUS ===');
    lines.push(`trust: ${p.trust.toFixed(2)}`);
    for (const k of Object.keys(p.live)) {
      lines.push(`${k.padEnd(16)} live=${p.live[k].toFixed(3)}  target=${p.target[k].toFixed(3)}`);
    }

    lines.push('');
    lines.push(`vision loop: ${this.visionLoop.enabled ? 'ON' : 'OFF'} (press V to toggle)  fps~${Math.round(this.visionLoop._fps)}`);
    if (this.perfGovernor) {
      const g = this.perfGovernor;
      lines.push(`perf governor: level ${g.level}/${MAX_LEVEL}  (vision ${g.visionAllowed ? 'ok' : 'shed'}, particles ×${g.particleMul}, crackGlow ${g.crackGlowEnabled ? 'on' : 'off'}, veil ${g.veilEnabled ? 'on' : 'off'}, phenomena ${g.phenomenaFull ? 'on' : 'off'}, haze ${g.hazeLayers}, postFx ${g.heavyPostFx ? 'on' : 'off'})`);
    }
    lines.push(`reduced flash: ${this.sim.reducedFlash ? 'ON' : 'OFF'} (press R to toggle)`);
    lines.push(`visual style: Midio (single house look)`);
    if (this.sim.highlightReel) {
      lines.push(`highlight reel: ${this.sim.highlightReel.frames.length}/8 captured`);
    }

    // --- movement intensity: is the energy signal saying what you hear? ---
    lines.push('');
    lines.push('=== GROOVE ===  (trace: dim=absolute, bright=song-relative)');
    const curves = this.sim.energyCurves;
    const nowMs = this.sim.timeMs || 0;
    if (curves?.globalEnergyNorm) {
      const cal = curves.calibration(FLAT_WEIGHTS);
      const raw = curves.globalEnergy(nowMs, FLAT_WEIGHTS);
      const norm = curves.globalEnergyNorm(nowMs, FLAT_WEIGHTS);
      lines.push(`energy: raw=${raw.toFixed(3)}  normalized=${norm.toFixed(3)}`);
      lines.push(`song p10=${cal.lo.toFixed(3)} p90=${cal.hi.toFixed(3)} spread=${cal.spread.toFixed(3)}${cal.spread < 0.08 ? '  [FLAT — normalization damped]' : ''}`);
    } else {
      lines.push('energy: (no curves)');
    }
    lines.push(`calm=${this.sim.calm.level.toFixed(2)}  epic=${this.sim.vibe.epic.toFixed(2)}  valence=${this.sim.vibe.valence.toFixed(2)}`);
    lines.push(`hype: fast=${this.sim.hype.fast.toFixed(2)} slow=${this.sim.hype.slow.toFixed(2)} buildUp=${this.sim.hype.buildUp.toFixed(2)} drops=${this.sim.hype.dropCount}`);
    lines.push(`broshi rabid=${this.sim.broshi.rabid ? 'YES' : 'no'} rho=${(this.sim.broshi.rho || 0).toFixed(2)}`);

    // --- structure ---
    lines.push('');
    lines.push('=== STRUCTURE ===');
    if (this.sim.biomes) {
      const b = this.sim.biomes;
      lines.push(`detector: ${b.structureSource || 'energy-novelty'}  confidence=${(b.structureConfidence || 0).toFixed(2)}  sections=${b.sections.length}`);
      const cur = b.sections.find((s) => nowMs >= s.startMs && nowMs < s.endMs);
      if (cur) {
        lines.push(`current: label=${cur.label}  kind=${cur.kind || '(no lyric data)'}  transition=${cur.transition}  profile=${cur.profile}`);
      }
      lines.push(`lyricIntensity: ${b.lyricIntensityEased.toFixed(2)}`);
      const cd = b.connectorDebug;
      if (cd) lines.push(`connector hills: spans=${cd.spans}  buried=${cd.depth01.toFixed(2)}  alpha=${cd.alpha.toFixed(3)}`);
    }

    // What this player has taught the engine about their own groove
    // (GrooveFingerprint) -- persisted across songs, so it is worth being
    // able to see whether it is actually learning anything.
    const gf = this.sim.groove;
    if (gf) {
      lines.push('');
      lines.push('=== GROOVE PROFILE ===');
      const pct = (v) => `${Math.round(v * 100)}%`;
      lines.push(`low:  taps=${gf.low.count}  say=${pct(gf.strength('LOW'))}  [${gf.low.template.map((v) => v.toFixed(2)).join(' ')}]`);
      lines.push(`high: taps=${gf.high.count}  say=${pct(gf.strength('HIGH'))}  [${gf.high.template.map((v) => v.toFixed(2)).join(' ')}]`);
      lines.push(`feel offset: ${gf.offsetMs >= 0 ? '+' : ''}${gf.offsetMs.toFixed(0)}ms   taps at energy ${gf.intensity.toFixed(2)}`);
      if (!gf.ready) lines.push('(cold -- tap F on the low hits and J on the hats to teach it)');
    }

    // --- rotation / flourish decisions, DENIALS included ---
    lines.push('');
    lines.push('=== MOVES (most recent first; denied attempts shown too) ===');
    const log = this.sim.ensemble?.moveLog?.toArray().reverse() || [];
    if (log.length === 0) lines.push('(no flourish decisions yet)');
    for (const m of log.slice(0, 12)) {
      const verdict = m.allowed ? 'FIRED  ' : `denied(${m.why})`;
      lines.push(`t=${(m.tMs / 1000).toFixed(1)}s  ${m.who}/${m.move}  ${verdict}  cue=${m.reason} i=${m.intensity}`);
    }

    // --- sync / recalibration ---
    lines.push('');
    lines.push('=== SYNC ===  (press C to tap-calibrate)');
    if (this.sim.beatAnchor) {
      const ba = this.sim.beatAnchor;
      lines.push(`beat anchor: period=${ba.periodMs.toFixed(0)}ms  confidence=${ba.confidence.toFixed(2)}  (click/tap anywhere to resync)`);
    }
    if (this.sim.syncMonitor) {
      const sm = this.sim.syncMonitor;
      lines.push(`kick scatter: ${sm.scatter.toFixed(2)}  ${sm.incoherent ? 'INCOHERENT — grid may be wrong' : 'grid looks locked'}  prompts=${sm.promptCount}`);
    }

    lines.push('');
    lines.push('=== LYRICS ===');
    if (this.sim.lyricIdentity && (this.sim.lyricIdentity.artist || this.sim.lyricIdentity.title)) {
      const li = this.sim.lyricIdentity;
      lines.push(`identity: ${li.artist || '?'} — ${li.title || '?'}  (source: ${li.source}, conf ${li.confidence.toFixed(2)})`);
    } else {
      lines.push('identity: (unresolved)');
    }

    lines.push('');
    lines.push('=== VISION LOG (most recent first) ===');
    const entries = this.visionLoop.log.toArray().reverse();
    if (entries.length === 0) lines.push('(no cycles yet)');
    for (const e of entries.slice(0, 10)) {
      lines.push(`t=${Math.round(e.t)}ms  applied=${e.applied}  ${e.reason || ''}`);
      if (e.observations) {
        lines.push(`  obs: eq=${e.observations.eq_motion} speed=${e.observations.speed_match} comp=${e.observations.companion_weight} clutter=${e.observations.clutter} sev=${e.severity}`);
      }
      if (e.adjust) lines.push(`  adjust: ${JSON.stringify(e.adjust)}  conf=${e.confidence.toFixed(2)} trust=${e.trust.toFixed(2)}`);
    }

    this.pre.textContent = lines.join('\n');
    this._drawTrace();
  }
}
