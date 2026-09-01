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

// What sample() actually receives is the raw rAF-to-rAF delta: the frame
// PERIOD, vsync wait included -- not the time spent working inside it. So
// this threshold has to be a frame-period threshold, and the old value (15,
// described in its own comment as "16.6ms frame budget, ~15ms of it") was a
// WORK budget being compared against a period. On any 60Hz display that made
// every healthy frame ~16.67ms "over budget" and no frame ever clean: the
// accumulator reached 60 in about 54 frames, shed a rung, reset, and did it
// again -- MAX_LEVEL in roughly five seconds, on hardware that was keeping up
// perfectly, with recovery impossible because a clean frame could never
// occur. Everything gated on the deeper rungs (phenomena, the heavy overlay
// passes, the terrain's own detail) switched itself off a few seconds into
// every song on every machine.
//
// 18.5ms sits clear of a 60Hz period (16.67) plus its ordinary vsync jitter,
// and below the 20ms one bad frame is elsewhere taken to mean. Crossing it
// means the frame period slipped past ~54fps, which is a real dropped frame.
// A 120Hz display (8.3ms) is comfortably clean; a 30fps scene (33ms) still
// sheds, as it should.
export const FRAME_BUDGET_MS = 18.5;
const SHED_AFTER_FRAMES = 60; // ~1s sustained overage at 60fps, at exactly-at-budget severity
const SHED_WEIGHT_CAP = 6; // one catastrophic frame (tab hitch, GC pause) can't shed more than ~6 "normal" frames' worth
const RECOVER_AFTER_MS = 10000; // 10 clean seconds
// A clean frame used to zero the accumulator outright, so judder --
// frames alternating just above and below budget, the exact pattern that
// reads as visible stutter -- never built up the 60 units needed to shed
// a rung: every other frame wiped out the previous one's contribution.
// Decaying instead (by less than a single over-budget frame's minimum
// severity of 1) lets that alternating pattern still net-accumulate,
// while a genuinely sustained clean run still drains it to zero.
const OVER_DECAY_PER_CLEAN_FRAME = 0.5;
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

// Warm-up grace. Starting a song is inherently janky for a moment: two dozen
// 2048px silhouette strips get baked, shaders and fonts warm up, the first
// frames touch cold paths. None of that is steady-state overdraw, but the
// accumulator could not tell the difference -- at a catastrophic severity of
// 6 per frame it takes only ten such frames to shed a rung, so a load hitch
// alone could cascade several rungs before the scene had settled. That is
// exactly the "all the terrain detail is there for two seconds and then
// gone, permanently" report this exists to fix: everything gated on the
// deeper rungs (phenomena, the heavy overlay passes) was being switched off
// by the load, not by the frame cost of actually running.
//
// Frames inside the window still RENDER normally -- they simply do not vote
// on the shed level. Recovery is unaffected, so a machine that genuinely
// cannot afford the scene still sheds, just a moment later and on evidence
// from a settled frame rather than from its own loading screen.
export const WARMUP_MS = 2500;

export class PerfGovernor {
  constructor({ startLevel = 0 } = {}) {
    this.level = Math.max(0, Math.min(MAX_LEVEL, startLevel));
    this._overCount = 0;
    this._cleanSinceMs = null;
    this._warmUntilMs = null;
  }

  /** Restart the warm-up grace: call when a new song starts (or the world is
   *  rebuilt), since that is when the expensive one-off bake happens. */
  beginWarmup(nowMs) {
    this._warmUntilMs = nowMs + WARMUP_MS;
    this._overCount = 0;
    this._cleanSinceMs = null;
  }

  /** Call once per rendered frame with the raw rAF-to-rAF delta. */
  sample(deltaMs, nowMs) {
    // Opt-in, not automatic: a governor that has never been told a song is
    // starting behaves exactly as it always did. Seeding this implicitly on
    // the first sample would quietly change the meaning of every existing
    // caller and test for the sake of one call site that can just say so.
    if (this._warmUntilMs !== null && nowMs < this._warmUntilMs) return;
    if (deltaMs > FRAME_BUDGET_MS) {
      const severity = Math.min(SHED_WEIGHT_CAP, deltaMs / FRAME_BUDGET_MS);
      this._overCount += severity;
      this._cleanSinceMs = null;
      if (this._overCount >= SHED_AFTER_FRAMES && this.level < MAX_LEVEL) {
        this.level++;
        this._overCount = 0;
      }
    } else {
      this._overCount = Math.max(0, this._overCount - OVER_DECAY_PER_CLEAN_FRAME);
      if (this._cleanSinceMs === null) this._cleanSinceMs = nowMs;
      else if (this.level > 0 && nowMs - this._cleanSinceMs >= RECOVER_AFTER_MS) {
        this.level--;
        this._cleanSinceMs = nowMs;
      }
    }
  }

  get visionAllowed() { return this.level < 1; }
  get particleMul() { return this.level >= 2 ? 0.6 : 1; }
  // Movement VII: the celestial-light passes join the same ladder -- rim
  // light is the pricier per-edge work so it sheds at the particle-cap
  // rung; contact shadows shed alongside crack glow, one rung later.
  get rimLightEnabled() { return this.level < 2; }
  get contactShadowsEnabled() { return this.level < 3; }
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
  // RainbowBrush: up to 320 additive dabs redrawn every frame, purely
  // cosmetic trail decoration -- widened spacing via particleMul but never
  // actually gated by a rung. Sheds alongside the other optional atmosphere.
  get brushEnabled() { return this.level < 5; }
  // Collapse the three depth-haze layers to one once still over budget past
  // the phenomena cut.
  get hazeLayers() { return this.level < 6 ? 3 : 1; }
  // The heaviest overlay passes: film-grade wash + vignette, and the hype
  // frame's echo self-blit.
  get heavyPostFx() { return this.level < 6; }
}
