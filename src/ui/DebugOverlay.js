// Debug overlay (spec §5.2.3): backtick toggles visibility, renders the
// ParamBus live/target state and the vision loop's 40-entry ring log so the
// self-tuning loop's recent history is inspectable.
import { MAX_LEVEL } from '../render/PerfGovernor.js';

export class DebugOverlay {
  constructor(el, sim, paramBus, visionLoop, perfGovernor = null) {
    this.el = el;
    this.sim = sim;
    this.paramBus = paramBus;
    this.visionLoop = visionLoop;
    this.perfGovernor = perfGovernor;
    this.visible = false;
  }

  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
  }

  toggleVision() {
    this.visionLoop.enabled = !this.visionLoop.enabled;
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
    if (this.sim.highlightReel) {
      lines.push(`highlight reel: ${this.sim.highlightReel.frames.length}/8 captured`);
    }
    lines.push('');
    lines.push('=== VISION LOG (most recent first) ===');
    const entries = this.visionLoop.log.toArray().reverse();
    if (entries.length === 0) lines.push('(no cycles yet)');
    for (const e of entries.slice(0, 15)) {
      lines.push(`t=${Math.round(e.t)}ms  applied=${e.applied}  ${e.reason || ''}`);
      if (e.observations) {
        lines.push(`  obs: eq=${e.observations.eq_motion} speed=${e.observations.speed_match} comp=${e.observations.companion_weight} clutter=${e.observations.clutter} sev=${e.severity}`);
      }
      if (e.adjust) lines.push(`  adjust: ${JSON.stringify(e.adjust)}  conf=${e.confidence.toFixed(2)} trust=${e.trust.toFixed(2)}`);
    }

    this.el.textContent = lines.join('\n');
  }
}
