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
//
// Mobile performance round: the ladder used to be reactive-only (shed after
// ~1s of visible jank, same speed regardless of how far over budget a frame
// ran) and shallow (its four rungs never touched the optional phenomena
// systems or the overlay-pass stack, the actual bulk of the frame on a
// weak GPU). Two extensions:
//  - `sample()` now weighs each over-budget frame by how far over it ran,
//    so a badly blown frame (2-3x budget) sheds a rung in a few frames
//    instead of ~60 — a barely-over-budget frame still takes ~1s, same as
//    before.
//  - Two deeper rungs (5-6) gate the optional phenomena layer and the
//    overlay-pass stack, so a device that's still over budget after the
//    original four rungs degrades to a clean core instead of stuttering.

const FRAME_BUDGET_MS = 15; // spec §6.2: 16.6ms frame budget, ~15ms of it
const SHED_AFTER_FRAMES = 60; // ~1s sustained overage at 60fps, at exactly-at-budget severity
const SHED_WEIGHT_CAP = 6; // one catastrophic frame (tab hitch, GC pause) can't shed more than ~6 "normal" frames' worth
const RECOVER_AFTER_MS = 10000; // 10 clean seconds
export const MAX_LEVEL = 6;

/** Resolve the initial shed level: a `?perf=lite|high` URL override wins;
 *  otherwise a coarse-pointer/small-viewport device heuristic starts a
 *  phone a rung down so the first second is already smooth rather than
 *  janky-then-corrected. */
export function resolvePerfStartLevel(search = '', { isCoarsePointer = false, isSmallViewport = false } = {}) {
  try {
    const raw = search || '';
    const q = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
    const p = (q.get('perf') || '').toLowerCase();
    if (p === 'lite') return 2;
    if (p === 'high') return 0;
  } catch { /* fall through to the device heuristic */ }
  return (isCoarsePointer || isSmallViewport) ? 1 : 0;
}

export class PerfGovernor {
  constructor({ startLevel = 0 } = {}) {
    this.level = Math.max(0, Math.min(MAX_LEVEL, startLevel));
    this._overCount = 0;
    this._cleanSinceMs = null;
  }

  /** Call once per rendered frame with the raw rAF-to-rAF delta. */
  sample(deltaMs, nowMs) {
    if (deltaMs > FRAME_BUDGET_MS) {
      const severity = Math.min(SHED_WEIGHT_CAP, deltaMs / FRAME_BUDGET_MS);
      this._overCount += severity;
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
  // Bloom (music-reactive post-pass, see Renderer._drawBloom): a few
  // downsampled offscreen draws plus one full-frame additive blit -- real
  // but modest cost, shed at the same rung as crack-glow.
  get bloomEnabled() { return this.level < 3; }
  get veilEnabled() { return this.level < 4; }
  // Deeper rungs: the optional phenomena layer (ReactionDiffusion ground
  // texture, CymaticField, Murmuration, SkyEnsemble planets, FarVignettes,
  // MeteorShower) -- all genuinely optional atmosphere, none of it gameplay.
  get phenomenaFull() { return this.level < 5; }
  // Collapse the three depth-haze layers to one once still over budget past
  // the phenomena cut.
  get hazeLayers() { return this.level < 6 ? 3 : 1; }
  // The heaviest overlay passes: film-grade wash + vignette, and the hype
  // frame's echo self-blit.
  get heavyPostFx() { return this.level < 6; }
}
