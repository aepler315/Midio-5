// The three-phase apex jump curve (spec §2.1) — launch (quadratic ease-out),
// apex hang (sin^2 wobble, C1-continuous into/out of the hang), fall
// (quadratic ease-in, accelerating/heavy). Kick-quantized takeoffs with
// mid-air retargeting so a new kick always lands Midio back on the grid.
import { clamp } from '../utils/math.js';

// Jump-curve shape (fractions of the total duration D; A+B+GAMMA = 1 so the
// arc lands exactly at u=1). Tuned for a tighter, more satisfying timing:
// a snappier launch, a longer/more readable float at the apex (so the peak
// visibly hangs on the beat), and a crisper drop into the landing. The
// offline replicas (JumpPlanner/NoteChart) import these, so they stay in
// lockstep automatically, and a longer/higher hang only ever widens the
// obstacle-clearance window (re-verified by obstacleSafety.test).
export const A = 0.32;   // LAUNCH fraction -- snappier takeoff
export const B = 0.36;   // APEX HANG fraction -- longer float at the top
export const GAMMA = 0.32; // FALL fraction -- crisper drop
export const W = 0.08;   // apex headroom fraction

export function jumpY(u, H) {
  const Ha = (1 - W) * H;
  if (u < A) {
    const p = u / A;
    return Ha * (1 - (1 - p) * (1 - p));
  }
  if (u < A + B) {
    const q = (u - A) / B;
    const s = Math.sin(Math.PI * q);
    return Ha + W * H * s * s;
  }
  const r = clamp((u - A - B) / GAMMA, 0, 1);
  return Ha * (1 - r * r);
}

export const H_BASE = 190; // px -- the bigger stage (Midio.groundY moved from 480 to 540)
export const D_MIN = 380, D_MAX = 1200; // ms
export const RETARGET_FALL_MS = 120;
const HIGH_BPM_HALFTIME = 170;
// A jump's landing lands ON the next audible kick whenever one falls in
// range, rather than merely on the beat-period EMA -- the EMA is only ever
// right for perfectly steady four-on-the-floor; any syncopation, fill, or
// tempo drift used to land him off-beat "usually", with the EMA
// coincidentally matching the true next gap only "occasionally" (spec: the
// exact "sometimes outstanding, usually weird" symptom). The chart's kick
// list is known in advance (or, live, the next kick has already sounded/
// been scheduled), so there's no reason to guess when the real target is
// sitting right there. Below this floor a "next kick" is really the same
// hit (layered/duplicate onsets) or one the existing airborne/retarget
// logic already owns -- not a fresh landing target.
export const LANDING_MIN_GAP_MS = 200;

// Now that D is routinely chosen to land EXACTLY on the next kick, a kick
// arriving right at an arc's nominal touchdown is the COMMON case, not a
// freak coincidence -- and which side of "still airborne" it falls on
// decides whether that beat gets a jump or gets swallowed. The shared rule,
// in both the live controller and the offline replicas (JumpPlanner,
// NoteChart): a kick within this tolerance of the scheduled landing IS the
// landing -- resolve the touchdown and relaunch ON that kick. The
// tolerance is a hair over one 120Hz sim step because that's the real slop
// between the replicas' exact math and the live controller's fixed-step
// landing/compress resolution.
export const LANDING_QUANT_EPS_MS = 10;

/**
 * Whether a mid-air retarget may engage at `nowMs` for the current arc
 * (launched at `jumpStartMs`, duration `D`): only when that arc isn't
 * already about to land on its OWN correctly-scheduled kick within
 * RETARGET_FALL_MS. Before double-step hops (D can now go below D_MIN),
 * the retarget window (u in [A+B, A+B+0.3*GAMMA)) could never start earlier
 * than ~247ms into an arc -- safely past LANDING_MIN_GAP_MS (200ms), the
 * floor every other kick-consumption path in this file uses to recognize a
 * near-duplicate onset. A short (<D_MIN) arc's retarget window can now
 * start well under that floor: a near-duplicate kick the dedupe rule would
 * otherwise ignore can land inside r<0.3 and hijack the schedule with a
 * fixed-length compress -- which then SWALLOWS the real target kick if it
 * arrives mid-compress (every branch is gated behind !this.compress),
 * leaving Midio visibly airborne through the beat that was supposed to be
 * his landing. Requiring the arc's own landing to still be comfortably
 * ahead keeps a short hop's own honest touchdown from ever being preempted.
 */
export function canRetarget(nowMs, jumpStartMs, D) {
  const remainingToOwnLanding = jumpStartMs + D - nowMs;
  return remainingToOwnLanding > RETARGET_FALL_MS;
}

/**
 * The jump duration for a launch at `takeoffMs`: exactly the gap to
 * `nextKickMs` when that gap is a plausible landing target (beyond the
 * dedupe floor, within a sane upper bound so a long silence doesn't stretch
 * one jump for seconds), clamped to [D_MIN, D_MAX] same as always; the
 * beat-period EMA otherwise (no known/plausible next kick -- silence, the
 * song's tail, or a target so far out it should be treated as a rest, not
 * chased). Pure and shared by every replica that must schedule the same
 * jump the same way: JumpPlanner.predictJumpArcs (obstacle placement),
 * NoteChart.replayTakeoffTriggers (the tap chart), and this class's own
 * live launch/retarget (see test/jumpPlanner.test.js's lockstep check).
 */
export function scheduledJumpD(takeoffMs, nextKickMs, beatPeriodMs) {
  const gap = nextKickMs != null ? nextKickMs - takeoffMs : NaN;
  if (gap >= LANDING_MIN_GAP_MS && gap <= 2000) {
    // A REAL kick is the target: land on it even when it's closer than
    // D_MIN -- a short, low double-step hop (see shortHopHeightMul) instead
    // of sailing over the second of two back-to-back kicks and touching
    // down ~150ms late in musical no-man's-land, which was exactly the
    // "jumps late on double bass hits" complaint. The gap is already >=
    // LANDING_MIN_GAP_MS, so only the D_MAX ceiling can bind here.
    return Math.min(gap, D_MAX);
  }
  return clamp(beatPeriodMs, D_MIN, D_MAX);
}

/**
 * How tall a jump of duration D stands, relative to a full jump: 1 for any
 * normal-length arc, shrinking quadratically below D_MIN so the double-step
 * hop between two back-to-back kicks is a quick LOW skip rather than a
 * full-height jump crammed into 220ms (which would read as a violent
 * teleport -- and quadratic keeps the landing velocity 2*Ha/(GAMMA*D)
 * scaling LINEARLY down with D, so short hops also land gently).
 */
export function shortHopHeightMul(D) {
  return D >= D_MIN ? 1 : (D / D_MIN) ** 2;
}

/**
 * The first entry in the ascending `kickTimes` (forward-scanned from
 * `fromIdx`) far enough past `takeoffMs` to be a plausible landing target
 * -- or null if none qualifies. A kick closer than LANDING_MIN_GAP_MS is a
 * duplicate/layered onset (or one the airborne/retarget rules already
 * own), not a fresh landing; skip past it rather than giving up on
 * scheduling entirely. Shared so every replica that walks the same kick
 * list agrees on which kick a given takeoff should land on.
 */
export function nextLandingKickMs(kickTimes, takeoffMs, fromIdx = 0) {
  for (let i = fromIdx; i < kickTimes.length; i++) {
    if (kickTimes[i] - takeoffMs >= LANDING_MIN_GAP_MS) return kickTimes[i];
  }
  return null;
}

export class JumpController {
  constructor(paramBus, { hBase = H_BASE } = {}) {
    this.P = paramBus;
    this.hBase = hBase;

    this.state = 'GROUND'; // 'GROUND' | 'AIR'
    this.jumpStartMs = 0;
    this.D = 500;
    this.H = 100;
    this.y = 0; // px above ground, >=0
    this.lastLaunchVel = 0.7; // velocity of the kick that started the current/most recent jump

    this.lastKickMs = null;
    this.beatPeriodMs = 500;
    this.kickCount = 0;

    // Landing-on-the-next-kick (see scheduledJumpD/nextLandingKickMs above):
    // the full raw kick-time list (same one JumpPlanner/NoteChart replay),
    // set once via setKickTimes. _kickIdx is a monotonic cursor tracking
    // "where the CURRENT triggering kick sits in that list" -- advanced
    // every onKick/onPlayerTap in the same forward-only order those already
    // arrive in, so searching "the next kick after this one" is O(1)
    // amortized and always agrees with the offline replicas' own index walk.
    // Left empty by default: any caller that never wires this up (tests,
    // fixtures) gets exactly the old EMA-only behavior.
    this._kickTimes = [];
    this._kickIdx = 0;

    this.compress = null;      // {startMs, fromY, dur} — mid-air retarget in progress
    this._pendingLaunch = null;

    /** Set for exactly one sim step on landing; consumed by ComboSystem/ImpactFX. */
    this.pendingLanding = null;
    /** Set for one step when a kick is skipped (half-time) — routes to landing FX instead. */
    this.pendingGhostKick = null;
    /** Set for one step when an air jump fires — {y, index, isFlourish} for FX. */
    this.pendingAirJump = null;
  }

  get bpm() { return 60000 / this.beatPeriodMs; }

  /** The full raw kick-time list (sorted ascending, every RHYTHM kick --
   *  same source ObstacleSpawner/NoteChart feed JumpPlanner/replayTakeoff-
   *  Triggers), so landings can be scheduled onto whichever of them is
   *  next rather than only ever guessed from the beat-period EMA. */
  setKickTimes(kickTimes) {
    this._kickTimes = kickTimes || [];
    this._kickIdx = 0;
  }

  /** Advance the cursor to (at or just past) `tMs` in the kick-time list --
   *  called once per triggering kick, in the same forward-only order they
   *  arrive, so it always points at the CURRENT kick's own position. */
  _advanceKickCursor(tMs) {
    while (this._kickIdx < this._kickTimes.length && this._kickTimes[this._kickIdx] < tMs) this._kickIdx++;
  }

  /**
   * @param evt the RHYTHM/kick NoteEvent (evt.tMs is the exact musical
   *   onset; the dispatcher may not reach it until up to one sim step
   *   later)
   */
  onKick(evt) {
    // Everything below is anchored to evt.tMs, the exact onset time — NOT
    // the caller's discretized "now". Kick-quantized jumps land almost
    // exactly when the next kick arrives, so the gap between a kick's true
    // time and the ~8ms-later instant the fixed-step sim actually gets to
    // process it is not noise to ignore: feeding that jitter into the
    // beat-period EMA compounds a slowly-growing phase error into D every
    // cycle, and resolving state against the wrong instant can leave a
    // kick seeing stale AIR state and silently dropping its launch.
    const tMs = evt.tMs;
    this.update(tMs); // resolve any landing/compress transition due by tMs first
    this._updateBeatPeriod(tMs);
    this._advanceKickCursor(tMs);
    this.kickCount++;
    if (this.bpm > HIGH_BPM_HALFTIME && this.kickCount % 2 === 0) {
      this.pendingGhostKick = { vel: evt.vel };
      return;
    }
    this._launchOrRetarget(evt, tMs);
  }

  /** Player-driven mode: kicks no longer launch jumps, but the inter-kick
   * EMA must keep flowing — it drives jump duration, the combo grace/break
   * windows, and the ensemble/strut timing. This is onKick minus the launch. */
  noteKickTiming(tMs) {
    this._updateBeatPeriod(tMs);
  }

  /** Forget the last kick so the next one sets no interval. Called after a
   * span of kicks was deliberately withheld from the EMA (a double-bass
   * roll): without this, the first kick after the span would feed the whole
   * gap in as one giant "beat". */
  resetKickBaseline() {
    this.lastKickMs = null;
  }

  /**
   * A player press. Same anchoring discipline as onKick (judge/launch at the
   * press's own DOM-captured audio-clock time, not the sim step that drains
   * it), same launch/retarget rules — but no EMA write (the beat period
   * stays chart-driven) and no halftime ghosting (a human already taps at
   * whatever rate a human can).
   * @param evt {{tMs:number, vel:number}} vel inherited from the matched
   *   kick when the press hit a chart note, or a neutral default when not.
   */
  onPlayerTap(evt) {
    const tMs = evt.tMs;
    this.update(tMs); // resolve any landing/compress transition due by tMs first
    this._advanceKickCursor(tMs);
    this._launchOrRetarget(evt, tMs);
  }

  /**
   * Double jump: a tap before the character hits the ground relaunches the
   * arc from the CURRENT height — C0-continuous, no teleport. The new arc's
   * apex is the current height plus a boost, and the arc is entered at the
   * launch-phase point whose height equals where the character already is,
   * so y never snaps. The budget/sequence policy lives in AirJumpSequencer;
   * this only refuses when the character turns out to be grounded by tMs
   * (the caller then refunds and falls through to a normal ground launch).
   * @returns {boolean} true if the air jump fired
   */
  airJump(evt, boostMul = 1, meta = {}) {
    const tMs = evt.tMs;
    this.update(tMs); // the press may postdate the landing this step hasn't resolved yet
    if (this.state !== 'AIR') return false;

    const yNow = this.y;
    const extra = this.hBase * (0.5 + 0.6 * evt.vel) * boostMul * this.P.live.jumpHeight;
    const H2 = (yNow + extra) / (1 - W);
    // Launch-phase height is Ha*(1-(1-p)^2); invert for the p where it equals yNow.
    const p = 1 - Math.sqrt(Math.max(0, 1 - yNow / ((1 - W) * H2)));
    // Land ON the next audible kick, like every other launch now does --
    // this was the back-to-back-kicks lateness: jump on kick 1, double-jump
    // on kick 2, but the double jump's landing rode 0.9x the beat-period
    // EMA, so he came down somewhere musically arbitrary and the NEXT
    // kick's tap found him still airborne (and often unbudgeted), eating a
    // beat. The arc is entered mid-launch at phase p, so its landing sits
    // at tMs + D2*(1 - p*A); solving for the landing to hit the next kick's
    // gap gives D2 = gap/(1 - p*A). EMA fallback when no kick is in range.
    this._advanceKickCursor(tMs);
    const nextKickMs = nextLandingKickMs(this._kickTimes, tMs, this._kickIdx);
    const gap = nextKickMs != null ? nextKickMs - tMs : NaN;
    const D2 = clamp(
      gap >= LANDING_MIN_GAP_MS && gap <= 2000 ? gap / (1 - p * A) : 0.9 * this.beatPeriodMs,
      D_MIN, D_MAX,
    );
    this.compress = null;
    this._pendingLaunch = null;
    this.lastLaunchVel = evt.vel;
    this.state = 'AIR';
    this.jumpStartMs = tMs - p * A * D2;
    this.H = H2;
    this.D = D2;
    this.y = yNow;
    this.pendingAirJump = { y: yNow, index: meta.index ?? 0, isFlourish: !!meta.isFlourish };
    return true;
  }

  _updateBeatPeriod(nowMs) {
    if (this.lastKickMs != null) {
      const interval = nowMs - this.lastKickMs;
      if (interval > 120 && interval < 2000) {
        this.beatPeriodMs = this.beatPeriodMs * 0.7 + interval * 0.3;
      }
    }
    this.lastKickMs = nowMs;
  }

  _launchOrRetarget(evt, nowMs) {
    const H = this.hBase * (0.6 + 0.8 * evt.vel) * this.P.live.jumpHeight;
    // Land ON the next audible kick when one falls in range (searched
    // fresh from the cursor _advanceKickCursor just placed at THIS kick's
    // own position -- see scheduledJumpD/nextLandingKickMs above), rather
    // than merely guessing from the beat-period EMA; the EMA only ever
    // happens to match the real next gap on perfectly steady, unsyncopated
    // stretches. A fresh ground launch takes off right now; a mid-air
    // retarget actually launches RETARGET_FALL_MS later (once the compress
    // lands), so the search's takeoff floor -- and D itself -- must be
    // anchored to THAT instant, not nowMs.

    // Landing-tie relaunch: now that landings are routinely scheduled to
    // fall EXACTLY on the next kick, that kick's own trigger arrives with
    // the arc a hair short of touching down (sim-step quantization, a
    // retarget's one-step-late relaunch) -- and used to read as "still
    // airborne, past the retarget window, ignore", swallowing the beat
    // entirely. A kick landing within LANDING_QUANT_EPS_MS of the scheduled
    // touchdown IS the touchdown: resolve the landing now and fall through
    // to a fresh on-beat launch. (Offline replicas mirror this via their
    // symmetric landMs - LANDING_QUANT_EPS_MS airborne test.)
    if (this.state === 'AIR' && !this.compress) {
      const remainingMs = this.jumpStartMs + this.D - nowMs;
      if (remainingMs > 0 && remainingMs <= LANDING_QUANT_EPS_MS) {
        const Ha = (1 - W) * this.H;
        this._land((2 * Ha) / (GAMMA * this.D));
      }
    }

    if (this.state === 'GROUND') {
      const nextKickMs = nextLandingKickMs(this._kickTimes, nowMs, this._kickIdx + 1);
      const D = scheduledJumpD(nowMs, nextKickMs, this.beatPeriodMs);
      this.lastLaunchVel = evt.vel;
      this._launch(nowMs, H * shortHopHeightMul(D), D);
      return;
    }

    const u = (nowMs - this.jumpStartMs) / this.D;
    if (u >= A + B) {
      const r = (u - A - B) / GAMMA;
      if (r < 0.3 && !this.compress && canRetarget(nowMs, this.jumpStartMs, this.D)) {
        const retargetLaunchMs = nowMs + RETARGET_FALL_MS;
        const nextKickMs = nextLandingKickMs(this._kickTimes, retargetLaunchMs, this._kickIdx + 1);
        const D = scheduledJumpD(retargetLaunchMs, nextKickMs, this.beatPeriodMs);
        this.compress = { startMs: nowMs, fromY: this.y, dur: RETARGET_FALL_MS };
        this._pendingLaunch = { H: H * shortHopHeightMul(D), D, vel: evt.vel };
      }
    }
    // Mid launch/hang: ignore — already committed, avoids impossible double-jumps.
  }

  _launch(nowMs, H, D) {
    this.state = 'AIR';
    this.jumpStartMs = nowMs;
    this.H = H;
    this.D = D;
    this.compress = null;
  }

  /** Clear one-shot per-step event flags. Call at the START of each sim step,
   * before Conductor dispatch, so listeners downstream can observe this
   * step's landing/ghost-kick events after update() runs. */
  clearFrameFlags() {
    this.pendingLanding = null;
    this.pendingGhostKick = null;
    this.pendingAirJump = null;
  }

  update(nowMs) {
    if (this.compress) {
      const t = nowMs - this.compress.startMs;
      const r = clamp(t / this.compress.dur, 0, 1);
      this.y = this.compress.fromY * (1 - r * r);
      if (r >= 1) {
        const vLand = (2 * this.compress.fromY) / this.compress.dur;
        this._land(vLand);
        this.compress = null;
        if (this._pendingLaunch) {
          const { H, D, vel } = this._pendingLaunch;
          this._pendingLaunch = null;
          this.lastLaunchVel = vel;
          this._launch(nowMs, H, D);
        }
      }
      return;
    }

    if (this.state === 'AIR') {
      const u = (nowMs - this.jumpStartMs) / this.D;
      if (u >= 1) {
        const Ha = (1 - W) * this.H;
        const vLand = (2 * Ha) / (GAMMA * this.D);
        this._land(vLand);
      } else {
        this.y = jumpY(u, this.H);
      }
    }
  }

  _land(vLandPxMs) {
    this.state = 'GROUND';
    this.y = 0;
    this.pendingLanding = { vLandPxMs };
  }

  get airborne() { return this.state === 'AIR'; }
}
