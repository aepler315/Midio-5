// Perf-degradation ladder (spec §6.2): "under load it sheds in order: vision
// loop -> particle caps -> crack refraction -> L7 foreground veil -> biome
// crossfade quality." Sheds one rung after a sustained run of over-budget
// frames, recovers one rung after a sustained clean window — hysteresis so
// the ladder doesn't chatter around the budget line.
//
// This codebase never built the profile-blend memoization the spec's fifth
// rung ("crossfade quality 128->32 steps") would cheapen, and per-pixel
// crack refraction was likewise never implemented (§4.2.2 already marks it
// desktop-only/optional). Rather than gate fictional features, "crack
// refraction" here sheds the crack glow-tint stroke pass (the nearest real
// cost in that same draw call), and the crossfade-quality rung is folded
// into the particle rung it would otherwise duplicate.

const FRAME_BUDGET_MS = 15; // spec §6.2: 16.6ms frame budget, ~15ms of it
const SHED_AFTER_FRAMES = 60; // ~1s sustained overage at 60fps
const RECOVER_AFTER_MS = 10000; // 10 clean seconds
export const MAX_LEVEL = 4;

export class PerfGovernor {
  constructor() {
    this.level = 0;
    this._overCount = 0;
    this._cleanSinceMs = null;
  }

  /** Call once per rendered frame with the raw rAF-to-rAF delta. */
  sample(deltaMs, nowMs) {
    if (deltaMs > FRAME_BUDGET_MS) {
      this._overCount++;
      this._cleanSinceMs = null;
      if (this._overCount >= SHED_AFTER_FRAMES && this.level < MAX_LEVEL) {
        this.level++;
        this._overCount = 0;
      }
    } else {
      this._overCount = 0;
      if (this._cleanSinceMs === null) this._cleanSinceMs = nowMs;
      else if (this.level > 0 && nowMs - this._cleanSinceMs >= RECOVER_AFTER_MS) {
        this.level--;
        this._cleanSinceMs = nowMs;
      }
    }
  }

  get visionAllowed() { return this.level < 1; }
  get particleMul() { return this.level >= 2 ? 0.6 : 1; }
  get crackGlowEnabled() { return this.level < 3; }
  get veilEnabled() { return this.level < 4; }
}
