// Broshi, the ground raptor (spec §3.2). Obeys the groove: a relative-
// velocity spring against Midio (no absolute position target), a
// frequency->anatomy mapping driven by live band energy and note onsets,
// and a Rabid overlay gated on global track energy.
import { Role } from '../core/NoteEvent.js';
import { CHOREO_LEAD_MS, apexHopY, visualNow } from '../core/ChoreoClock.js';
import { clamp, clamp01, smoothstep, mulberry32, lerp } from '../utils/math.js';
import { hexLerp, hexToRgb, rgbToHsl } from '../utils/color.js';
import { RABID_WEIGHTS } from '../audio/bands.js';
import { ObjectPool } from '../utils/ObjectPool.js';
import { BROSHI_BODY, BROSHI_HEAD, BROSHI_JAW, BROSHI_EYE, BROSHI_TAIL } from '../render/meshes.js';
import { computeRestLengths, drawMeshPart, displaceMeshRadial, meltMesh, applyTransform, drawGlowHalo } from '../render/MeshDrawer.js';
import { kickEnv } from '../world/MountainChoreo.js';
import { ModalRing } from '../render/oscillators.js';
import { Burrow } from './Burrow.js';

const K = 26, C = 3.4; // spring stiffness (s^-2), damping (s^-1)
const D_TRAIL = -140, D_SURGE = 120, D_PANIC = -220;
const PANIC_LOOKAHEAD_MS = 300;
const RABID_ENTER_G = 0.75, RABID_EXIT_G = 0.60, RABID_ENTER_HOLD_MS = 1500;
const RABID_FADE_SEC = 0.8;
const G_EMA_TAU = 0.4;
const TONGUE_COOLDOWN_MS = 350;

// Calm/idle behaviors (follow-up item 3): a relaxed lope (softer hops, a
// wide lazy tail sway) plus an occasional yawn during sustained quiet
// stretches, so low-intensity sections still feel alive.
const TAIL_BASE_HZ = 1.3, TAIL_CALM_HZ = 0.32;
const TAIL_BASE_DEG = 9, TAIL_CALM_DEG = 18;
const DRAW_SCALE = 1.8; // the stage got bigger: render-only, physics untouched
const WEAVE_PX = 6;      // predatory side-to-side drift while trailing
// BROSHI_BODY+BROSHI_HEAD combined local-space x-span (snout spike to
// swept tail spike, see meshes.js) -- the only source of truth for his
// on-screen width, used by the contact shadow.
const BODY_WIDTH_LOCAL = 57;
const CALM_LEVEL_THRESHOLD = 0.5;
const CALM_BAR_THRESHOLD = 4;
const YAWN_CHANCE_PER_BAR = 0.35;
const YAWN_COOLDOWN_BARS = 8;
const YAWN_DUR_MS = 1400;

// Ferocity/variety pass: airborne barrel rolls on hard hops (likelier the
// more rabid he is), a pounce-crouch telegraph when a surge kicks off, a
// goofy tail-chase spin when things stay calm long enough, and a jittery
// rabid skitter layered onto the predatory weave.
const ROLL_CHANCE_BASE = 0.30;
const ROLL_DUR_MS = 340;
const POUNCE_MS = 180;
const TAILCHASE_DUR_MS = 900;
const TAILCHASE_CHANCE_PER_BAR = 0.18;
const TAILCHASE_COOLDOWN_BARS = 6;

/** Pitch anchoring: a hop's height multiplier from where its triggering
 *  note sits in his own line's observed pitch range -- higher notes lift
 *  him higher (works identically over a bass line's 28-52 register and a
 *  melody's 60-96). Pure/testable; falls back to 1 (no bias) before any
 *  range has been observed. */
export function broshiHopHeightMul(pitch, pitchMin, pitchMax) {
  if (!Number.isFinite(pitch) || !(pitchMax > pitchMin)) return 1;
  const norm = clamp01((pitch - pitchMin) / (pitchMax - pitchMin));
  return 0.75 + 0.6 * norm;
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
};

export class Broshi {
  /**
   * @param {?Function} opts.hopFilter which events are HIS line to hop --
   *   set by Simulation from the casting lanes (bass -> him when a bass
   *   lane exists; the melody fallback keeps un-cast timelines dancing).
   */
  constructor(conductor, paramBus, { seed = 555, hopFilter = null } = {}) {
    this.conductor = conductor;
    this.rand = mulberry32(seed);
    this._hopFilter = hopFilter || ((evt) => evt.role === Role.MELODY);
    // Output-latency compensation (ChoreoClock): set by Simulation each
    // step; every decorative envelope below evaluates on the heard clock.
    this.visualLagMs = 0;

    this.state = 'TRAIL'; // TRAIL | SURGE | PANIC
    this.surgeUntilMs = -Infinity;
    this._barEnergyAccum = 0;
    this._barEnergySamples = 0;
    this._barEnergyHistory = [];
    this._barsSinceSurge = 0;
    this._lastBarPeriodMs = 500;

    this.xRel = D_TRAIL;
    this.xRelVel = 0;

    this.G = 0;
    this.rabid = false;
    this.rho = 0;
    this._rabidCandidateSinceMs = null;

    this.tongue = { state: 'idle', t: 0, len: 0, cooldownUntilMs: 0, targetLen: 0 };
    this.jawOpen = 0; // 0..1
    this._jawUntilMs = -Infinity;
    this.hopY = 0;
    // screenX/renderX/groundY are only ever computed inside update() (they
    // need `midio`'s live position, not available at construction) -- but a
    // fresh restart (Play again / video export) can render the very first
    // frame before any step has run yet (zero completed sim.step() calls
    // still gets rendered, interpolating the freshly-constructed state).
    // Previously undefined here, so that first draw() translated to
    // NaN/NaN and crashed the whole render loop; 0 is a safe placeholder,
    // overwritten by the first real update() a step later.
    this.screenX = 0;
    this.renderX = 0;
    this.groundY = 0;
    // Apex-on-beat hop (ChoreoClock): a parabola anchored so its peak lands
    // exactly ON the note's own tMs -- he leaves the ground before the note
    // sounds. Null when grounded.
    this._hop = null;
    this._kickTMs = -Infinity; // the latest AUDIBLE kick's onset, for the closed-form beat flash
    // Kicks not yet heard (see MidioPerformer._kickPending): on high-latency
    // outputs a newer kick must not orphan the one still in flight to the
    // ear, so onsets queue and update() promotes them at their heard moment.
    this._kickPending = [];
    this.neckAngle = 0;
    this._neckStartMs = -Infinity;
    this._neckAmp = 0;

    this.spittle = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 60);
    this.drool = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 60);
    this._droolAccum = 0;
    // A comet-star trail (Midasus's stardust ribbon, his own version): a
    // stream of fading motes off the tail on hops and rolls, thicker the
    // more rabid he's running.
    this.trail = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 120);
    this._trailAccum = 0;

    this._bodyRest = computeRestLengths(BROSHI_BODY);
    this._headRest = computeRestLengths(BROSHI_HEAD);
    this._jawRest = computeRestLengths(BROSHI_JAW);
    this._eyeRest = computeRestLengths(BROSHI_EYE);
    this._tailRest = computeRestLengths(BROSHI_TAIL);

    this._calmLevel = 0;
    this._calmBarsStreak = 0;
    this._barsSinceYawn = Infinity;
    this._yawnStartMs = -Infinity;
    this.tailAngle = 0;
    this._tailPhase = this.rand() * Math.PI * 2;

    // Body vibration: struck by kicks and hops, and fed a continuous low
    // shiver while rabid so his whole silhouette trembles at high energy.
    this.modal = new ModalRing({ modes: 4, baseHz: 7, decaySec: 0.5, seed: seed + 1 });
    this.beatFlash = 0;
    this._nowMs = 0;
    this._trailTarget = D_TRAIL;
    this._ensPhase = null;
    this._melt = 0;

    // Barrel roll / pounce / tail-chase state (render-only, like the weave).
    this.bodyRoll = 0;         // radians added to the whole-glyph rotation
    this.squashX = 1;
    this.squashY = 1;
    this._rollStartMs = -Infinity;
    this._rollDurMs = ROLL_DUR_MS;
    this._rollTurns = 1;
    this._rollDir = 1;
    this._pounceStartMs = -Infinity;
    this._lastState = 'TRAIL';
    this._barsSinceTailChase = Infinity;
    // Occasional underground excursion: drawn beneath the world (see
    // Renderer.js), fog-of-war dirt-sight owned entirely by Burrow.
    this.burrow = new Burrow(seed + 2);

    // Line anchoring: he hops HIS line (the bass when the casting found
    // one, the melody otherwise). Pitch range is learned adaptively from
    // onsets actually seen so far (no full timeline is handed to him at
    // construction, unlike Midasus).
    this._pitchMin = Infinity;
    this._pitchMax = -Infinity;
    // His line's onset times, delivered by the anticipation channel (up to
    // CHOREO_LEAD_MS early) -- bucketed against the bar boundary by each
    // note's OWN tMs in _onBar, so the density windows stay bar-aligned
    // even though delivery runs ahead.
    this._laneOnsetTimes = [];
    this._barMelodyHistory = [];

    conductor.onBar((bar) => this._onBar(bar));
    conductor.on(Role.RHYTHM, (evt) => {
      if (evt.kick) { this._onKick(evt); this.burrow.onKick(evt.vel); }
      // Kicks still snap the jaw and light the beat flash (see _onKick) --
      // he still feels the drums, he just doesn't hop to them anymore.
    });
    // His hop line arrives EARLY (ChoreoClock's anticipation channel), each
    // event carrying its true tMs, so the hop's apex can be anchored right
    // on the note instead of starting rise-time late.
    conductor.subscribeAhead('*', CHOREO_LEAD_MS, (evt) => {
      if (!this._hopFilter(evt)) return;
      if (Number.isFinite(evt.pitch)) {
        this._pitchMin = Math.min(this._pitchMin, evt.pitch);
        this._pitchMax = Math.max(this._pitchMax, evt.pitch);
      }
      this._laneOnsetTimes.push(evt.tMs ?? this._nowMs);
      if (evt.vel >= 0.3) this._onMiniHopTrigger(evt);
    });
    // The head still nods to the tune regardless of which line his BODY
    // answers to -- head to the melody, feet to his own instrument.
    conductor.on(Role.MELODY, (evt) => {
      this._onHeadBob(evt);
      this.burrow.onMelodyOnset(evt);
    });
  }

  /** Test/debug hook: send him underground right now regardless of natural
   * triggers. No-op if he's already away. */
  forceBurrow(nowMs, worldX) {
    // The hole belongs where HE stands, not at Midio's world anchor:
    // his world-x is Midio's plus the trailing spring offset.
    return this.burrow.trigger(nowMs, { x: this.screenX, y: this.groundY }, worldX, this.groundY, worldX + this.xRel);
  }

  _onBar(bar) {
    const barEnergy = this._barEnergySamples > 0 ? this._barEnergyAccum / this._barEnergySamples : 0;
    const hist = this._barEnergyHistory;
    if (hist.length > 0) {
      const window = hist.slice(-4);
      const mean4 = window.reduce((a, b) => a + b, 0) / window.length;
      if (mean4 > 1e-6 && barEnergy > mean4 * 1.3) this._triggerSurge(bar.ms);
    }
    hist.push(barEnergy);
    if (hist.length > 8) hist.shift();

    // Line density: a bar of unusually busy playing on HIS line (a run, a
    // flurry) reads as excitement too, independent of the drums' energy.
    // Only onsets whose own tMs lands before this boundary belong to the
    // closing bar; anticipated notes from the next bar stay queued for it.
    const closed = this._laneOnsetTimes.filter((t) => t < bar.ms).length;
    this._laneOnsetTimes = this._laneOnsetTimes.filter((t) => t >= bar.ms);
    const mhist = this._barMelodyHistory;
    if (mhist.length > 0) {
      const mwindow = mhist.slice(-4);
      const mmean4 = mwindow.reduce((a, b) => a + b, 0) / mwindow.length;
      if (mmean4 > 1e-6 && closed > mmean4 * 1.5) this._triggerSurge(bar.ms);
    }
    mhist.push(closed);
    if (mhist.length > 8) mhist.shift();

    this._barsSinceSurge++;
    if (this._barsSinceSurge >= 8) this._triggerSurge(bar.ms);
    this._barEnergyAccum = 0;
    this._barEnergySamples = 0;

    if (this._calmLevel > CALM_LEVEL_THRESHOLD) this._calmBarsStreak++;
    else this._calmBarsStreak = 0;
    this._barsSinceYawn++;
    this._barsSinceTailChase++;
    if (this._calmBarsStreak >= CALM_BAR_THRESHOLD && this._barsSinceYawn >= YAWN_COOLDOWN_BARS
      && !this.rabid && this.rand() < YAWN_CHANCE_PER_BAR) {
      this._yawnStartMs = bar.ms;
      this._barsSinceYawn = 0;
    }
    // Bored enough for long enough -> he chases his own tail: a slow goofy
    // double spin, mutually exclusive with the yawn so they don't stack.
    if (this._calmBarsStreak >= 2 && this._barsSinceTailChase >= TAILCHASE_COOLDOWN_BARS
      && !this.rabid && bar.ms - this._yawnStartMs > YAWN_DUR_MS
      && this.rand() < TAILCHASE_CHANCE_PER_BAR) {
      this._rollStartMs = bar.ms;
      this._rollDurMs = TAILCHASE_DUR_MS;
      this._rollTurns = 2;
      this._rollDir = this.rand() < 0.5 ? 1 : -1;
      this._barsSinceTailChase = 0;
    }
  }

  _triggerSurge(nowMs) {
    if (this.state === 'PANIC') return;
    this.state = 'SURGE';
    this.surgeUntilMs = nowMs + this._lastBarPeriodMs;
    this._barsSinceSurge = 0;
  }

  _onKick(evt) {
    this.jawOpen = 1;
    this._jawUntilMs = -Infinity; // set precisely in update() using nowMs snapshot
    this._jawKickPending = true;
    // The flash itself is computed closed-form in update() -- kickEnv
    // anchored on the kick's true onset, latency-compensated -- so its
    // shape and phase are exact regardless of dispatch step timing.
    this._kickPending.push(evt && Number.isFinite(evt.tMs) ? evt.tMs : this._nowMs);
    if (this._kickPending.length > 8) this._kickPending.shift();
  }

  _onMiniHopTrigger(evt) {
    this._hopPending = { vel: evt.vel, pitch: evt.pitch, anchorMs: evt.tMs };
  }

  _onHeadBob(evt) {
    this._neckPending = { vel: evt.vel };
  }

  update(nowMs, dtSec, midio, energyCurves, obstacles, worldX, groundY, calmLevel = 0, ensemble = null, groundField = null) {
    this._calmLevel = calmLevel;
    this._ensPhase = ensemble ? ensemble.phase : null;
    this._melt = ensemble ? ensemble.melt : 0;
    // The ensemble roams him around the floor: his spring's TRAIL set-point
    // chases the formation anchor instead of a fixed -140px offset.
    this._trailTarget = ensemble ? clamp(ensemble.trailX - midio.screenX, -420, 320) : D_TRAIL;
    const gInstant = energyCurves ? energyCurves.globalEnergy(nowMs, RABID_WEIGHTS) : 0;
    this._barEnergyAccum += gInstant;
    this._barEnergySamples++;

    // The heard clock (ChoreoClock): every anchored envelope below -- hop
    // arc, beat flash -- evaluates against this, not the raw song clock.
    const vNow = visualNow(nowMs, this.visualLagMs);

    if (this._jawKickPending) { this._jawKickPending = false; this._jawUntilMs = nowMs + 80; this.jawOpen = 1; this.modal.excite(2.6); }
    if (this._hopPending) {
      const { vel, pitch, anchorMs } = this._hopPending;
      this._hopPending = null;
      // Busy guard: on runs denser than the anticipation lead, the next
      // note's early trigger would otherwise replace the CURRENT hop before
      // its window even opens, flattening every hop on fast lines. One hop
      // finishes before the next installs; mid-run triggers just drop.
      if (!this._hop || vNow >= this._hop.anchorMs + this._hop.riseMs) {
        this._startHop(nowMs, vel, pitch, anchorMs);
        this.modal.excite(0.6 + 1.2 * vel);
      }
    }
    if (this._neckPending) { const { vel } = this._neckPending; this._neckPending = null; this._neckStartMs = nowMs; this._neckAmp = 10 + 16 * vel; }

    // --- locomotion FSM ---
    const obs = obstacles ? obstacles.nearestAhead(worldX) : null;
    const dangerNear = !!obs && obs.tMs - nowMs <= PANIC_LOOKAHEAD_MS && obs.tMs - nowMs >= -100;
    if (dangerNear) this.state = 'PANIC';
    else if (this.state === 'PANIC') this.state = 'TRAIL';
    else if (this.state === 'SURGE' && nowMs >= this.surgeUntilMs) this.state = 'TRAIL';

    // Pounce telegraph: the instant a surge starts he coils — a quick
    // crouch-and-release squash before the burst forward reads as intent.
    if (this.state === 'SURGE' && this._lastState !== 'SURGE') this._pounceStartMs = nowMs;
    this._lastState = this.state;

    const dStar = this.state === 'SURGE' ? D_SURGE : this.state === 'PANIC' ? D_PANIC : this._trailTarget;
    // Iced footing (Traction.js): lost traction is lost damping -- the
    // stiffness (his legs) is untouched but he genuinely can't shed speed,
    // so he overshoots the formation and slides back. Floor keeps the
    // spring visibly underdamped, never divergent.
    const cEff = C * (0.35 + 0.65 * (this.traction ?? 1));
    const accel = -K * (this.xRel - dStar) - cEff * this.xRelVel;
    this.xRelVel += accel * dtSec;
    this.xRel += this.xRelVel * dtSec;

    // --- Rabid gate ---
    const alpha = 1 - Math.exp(-dtSec / G_EMA_TAU);
    this.G += alpha * (gInstant - this.G);
    if (!this.rabid) {
      if (this.G > RABID_ENTER_G) {
        if (this._rabidCandidateSinceMs == null) this._rabidCandidateSinceMs = nowMs;
        if (nowMs - this._rabidCandidateSinceMs >= RABID_ENTER_HOLD_MS) this.rabid = true;
      } else {
        this._rabidCandidateSinceMs = null;
      }
    } else if (this.G < RABID_EXIT_G) {
      this.rabid = false;
    }
    this.rho = this.rabid
      ? smoothstep(RABID_ENTER_G, 0.95, this.G)
      : Math.max(0, this.rho - dtSec / RABID_FADE_SEC);

    // --- tongue-lash (BASS band E1) ---
    const e1 = energyCurves ? energyCurves.sample(1, nowMs) : 0;
    const s = smoothstep(0.55, 0.80, e1);
    const tongueCap = 96 * (1 + 0.5 * this.rho);
    const cooldownMs = TONGUE_COOLDOWN_MS * (1 - 0.45 * this.rho);
    if (this.tongue.state === 'idle' && nowMs >= this.tongue.cooldownUntilMs && s > 0.05) {
      this.tongue.state = 'extend';
      this.tongue.t = 0;
      this.tongue.targetLen = tongueCap * s;
    } else if (this.tongue.state === 'extend') {
      this.tongue.t += dtSec / 0.09;
      this.tongue.len = this.tongue.targetLen * easeOutCubic(clamp(this.tongue.t, 0, 1));
      if (this.tongue.t >= 1) {
        this.tongue.state = 'retract';
        this.tongue.t = 0;
        this._spawnSpittle();
      }
    } else if (this.tongue.state === 'retract') {
      this.tongue.t += dtSec / 0.22;
      const e = easeOutElastic(clamp(this.tongue.t, 0, 1));
      this.tongue.len = Math.max(0, this.tongue.targetLen * (1 - e));
      if (this.tongue.t >= 1) {
        this.tongue.state = 'idle';
        this.tongue.len = 0;
        this.tongue.cooldownUntilMs = nowMs + cooldownMs;
      }
    }

    // --- jaw (yawn takes priority over the idle decay, kicks/rabid override both) ---
    const sinceYawn = nowMs - this._yawnStartMs;
    if (sinceYawn >= 0 && sinceYawn < YAWN_DUR_MS) {
      this.jawOpen = Math.sin((sinceYawn / YAWN_DUR_MS) * Math.PI) * 0.85;
    } else if (nowMs >= this._jawUntilMs) {
      this.jawOpen = Math.max(0, this.jawOpen - dtSec / 0.05);
    }
    const jawSnapHz = 2 * (1 + 3 * this.rho);
    if (this.rabid) this.jawOpen = 0.5 + 0.5 * Math.sin(2 * Math.PI * jawSnapHz * (nowMs / 1000));

    // --- tail sway: wider and lazier the calmer things get, never still ---
    const tailHz = lerp(TAIL_BASE_HZ, TAIL_CALM_HZ, calmLevel);
    const tailDeg = lerp(TAIL_BASE_DEG, TAIL_CALM_DEG, calmLevel);
    this.tailAngle = tailDeg * Math.sin(2 * Math.PI * tailHz * (nowMs / 1000) + this._tailPhase);

    // --- barrel roll / tail-chase spin: one shared roll channel ---
    const rollU = (nowMs - this._rollStartMs) / this._rollDurMs;
    if (rollU >= 0 && rollU < 1) {
      this.bodyRoll = this._rollDir * this._rollTurns * Math.PI * 2 * easeOutCubic(rollU);
      // Mid-tail-chase his tail whips fast — he's chasing it, after all.
      if (this._rollDurMs >= TAILCHASE_DUR_MS) {
        this.tailAngle += 14 * Math.sin(2 * Math.PI * 6 * (nowMs / 1000));
      }
    } else {
      this.bodyRoll = 0;
    }

    // --- pounce crouch: sine in-out squash over POUNCE_MS ---
    const pounceU = (nowMs - this._pounceStartMs) / POUNCE_MS;
    const crouch = pounceU >= 0 && pounceU < 1 ? Math.sin(pounceU * Math.PI) : 0;
    this.squashY = 1 - 0.22 * crouch;
    this.squashX = 1 + 0.16 * crouch;

    // --- body vibration: continuous feed while rabid, ring-down otherwise ---
    if (this.rho > 0.05) this.modal.excite(4 * this.rho * dtSec);
    this.modal.update(dtSec);

    // --- mini-hop: closed-form parabola whose apex lands exactly ON the
    // triggering note's own onset, evaluated on the heard clock (ChoreoClock
    // apex-on-beat). No per-step integration, so no tick quantization.
    if (this._hop) {
      this.hopY = apexHopY(vNow, this._hop.anchorMs, this._hop.riseMs, this._hop.h);
      if (vNow > this._hop.anchorMs + this._hop.riseMs) this._hop = null;
    } else {
      this.hopY = 0;
    }

    // --- head-bob (neck angle) ---
    const dt = nowMs - this._neckStartMs;
    this.neckAngle = dt >= 0 && dt < 600
      ? this._neckAmp * Math.exp(-dt / 180) * Math.sin((2 * Math.PI * dt) / 220)
      : 0;

    // --- rabid aura / drool ---
    if (this.rabid) {
      this._droolAccum += 4 * this.rho * dtSec;
      while (this._droolAccum >= 1) {
        this._droolAccum -= 1;
        this.drool.spawn({ x: 0, y: 0, vy: 40, life: 0.6 + 0.3 * this.rand() });
      }
    }

    this.spittle.step(dtSec, (o, dtt) => { o.x += o.vx * dtt; o.y += o.vy * dtt; o.vy += 400 * dtt; o.age += dtt; return o.age < o.life; });
    this.drool.step(dtSec, (o, dtt) => { o.y += o.vy * dtt; o.age += dtt; return o.age < o.life; });

    // Comet trail: rate scales with speed and rabid-ness, motes drift
    // behind him (world-relative, since they should stay in place as he
    // runs on) and fade over ~0.4s.
    const trailSpeed = Math.abs(this.xRelVel);
    const trailRate = (4 + 26 * Math.min(1, trailSpeed / 250)) * (1 + 1.2 * this.rho);
    this._trailAccum += trailRate * dtSec;
    while (this._trailAccum >= 1) {
      this._trailAccum -= 1;
      this.trail.spawn({
        x: -18 - 4 * this.rand(), y: -13 + (this.rand() * 2 - 1) * 5,
        life: 0.28 + 0.18 * this.rand(),
      });
    }
    this.trail.step(dtSec, (o, dtt) => { o.age += dtt; return o.age < o.life; });

    // Beat flash: the mountains' own kickEnv anchored on the kick's true
    // onset -- identical shape and phase to the ranges' bounce, and it
    // peaks when the EAR gets the kick, not when the dispatcher did. Queued
    // onsets promote at their own heard moments so a newer kick never
    // orphans one still in flight to the ear.
    while (this._kickPending.length && this._kickPending[0] <= vNow) this._kickTMs = this._kickPending.shift();
    this.beatFlash = kickEnv(vNow - this._kickTMs);
    this._nowMs = nowMs;
    this.groundY = groundY;
    this.screenX = midio.screenX + this.xRel;
    // Predatory weave (+ rabid skitter): stalks side to side instead of
    // gliding on rails. Render-only -- the spring physics/panic hops above
    // are untouched. Hoisted here (rather than computed inline in draw())
    // so Renderer can read his true rendered x for the contact shadow
    // without reaching into underscore-prefixed internals.
    const weave = WEAVE_PX * (1 - 0.5 * this._calmLevel) * Math.sin(this._ensPhase != null ? this._ensPhase : nowMs * 0.006)
      + 3.5 * this.rho * Math.sin(nowMs * 0.031);
    this.renderX = this.screenX + weave;

    // Locomotion/rendering above keeps running harmlessly underneath (so a
    // resurface never has to catch up on anything); once he's away,
    // draw() skips him here and Renderer draws the underground band
    // instead (see Burrow.draw, called directly from Renderer.js). The
    // bass band (e1, computed above for the tongue) doubles as the cave
    // walls' vibration drive.
    this.burrow.update(nowMs, dtSec, worldX, groundField, e1);
    if (this.burrow.justSurfaced) {
      // The pop-out: a real hop arc, a hard body ring, and a beat flash --
      // he bursts out of the ground, he doesn't fade back in. And always
      // with a celebratory flip: he's proud of the tunnel. (A reaction, not
      // a charted note, so its hop anchors a rise-time ahead of "now".)
      this._hop = { anchorMs: vNow + 150, h: 40, riseMs: 150 };
      this._rollStartMs = nowMs;
      this._rollDurMs = 300;
      this._rollTurns = 1;
      this._rollDir = 1;
      this.modal.excite(5);
      // Backdated to kickEnv's peak so the pop-out flash is INSTANTLY full,
      // matching the old hard set-to-1 -- not a 40ms ramp from zero.
      this._kickTMs = vNow - 40;
    }
  }

  _startHop(nowMs, vel, pitch, anchorMs = nowMs + 80) {
    // Relaxed lope: calm sections soften the hop instead of cutting it
    // entirely. Pitch anchoring: a higher note lifts him higher (and the
    // hop resolves a touch quicker -- lighter, not heavier). The arc is
    // anchored so its APEX lands on anchorMs -- the note's own onset.
    const liftMul = broshiHopHeightMul(pitch, this._pitchMin, this._pitchMax);
    this._hop = {
      anchorMs,
      h: (16 + 26 * vel) * liftMul * (1 - 0.5 * this._calmLevel),
      riseMs: 80 / Math.sqrt(liftMul),
    };
    // Hard hops sometimes come with a full barrel roll — likelier (and
    // occasionally doubled) the more rabid he's running.
    const rollU = (nowMs - this._rollStartMs) / this._rollDurMs;
    const rolling = rollU >= 0 && rollU < 1;
    if (!rolling && vel > 0.6 && this.rand() < ROLL_CHANCE_BASE + 0.4 * this.rho) {
      this._rollStartMs = nowMs;
      this._rollDurMs = ROLL_DUR_MS;
      this._rollTurns = this.rho > 0.6 && this.rand() < 0.5 ? 2 : 1;
      this._rollDir = this.xRelVel >= 0 ? 1 : -1;
    }
  }

  _spawnSpittle() {
    for (let i = 0; i < 3; i++) {
      const ang = -0.38 + (this.rand() * 2 - 1) * 0.3; // ~22deg below horizontal, jittered
      const speed = 80 + 60 * this.rand();
      this.spittle.spawn({
        x: this.tongue.len, y: 0,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        life: 0.3 + 0.2 * this.rand(),
      });
    }
  }

  /** Current on-screen width in px -- the contact shadow's only source of
   *  truth for his size. Widens on the same pounce-crouch squash frames
   *  his body does. */
  get shadowWidthPx() {
    return BODY_WIDTH_LOCAL * DRAW_SCALE * this.squashX;
  }

  draw(ctx) {
    if (this.burrow.depth > 0.02) return; // he's underground; Renderer draws the Burrow band instead
    const skinHex = hexLerp('#63c74d', '#e43b44', this.rho);
    const skinRgb = hexToRgb(skinHex);
    const baseHue = rgbToHsl(skinRgb.r, skinRgb.g, skinRgb.b).h;
    const x = this.renderX;
    const y = this.groundY - this.hopY;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(DRAW_SCALE, DRAW_SCALE);

    if (this.rho > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.38 * this.rho;
      ctx.strokeStyle = '#e8f2ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const ang = (i / 14) * Math.PI * 2;
        const r = (i % 2 === 0 ? 30 : 21) + (this.rand() * 2 - 1) * 4; // serrated, not round
        const px = Math.cos(ang) * r, py = -16 + Math.sin(ang) * r * 0.7;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // tongue (behind head, extends forward/down)
    if (this.tongue.len > 0.5) {
      ctx.strokeStyle = 'rgba(200,228,255,0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(6, -16);
      const midX = 6 + this.tongue.len * 0.55, midY = -16 + this.tongue.len * 0.10;
      const endX = 6 + this.tongue.len * Math.cos(22 * Math.PI / 180);
      const endY = -16 + this.tongue.len * Math.sin(22 * Math.PI / 180);
      ctx.lineTo(midX, midY); // an angular lash, not a soft curve
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,230,255,0.8)';
    for (const p of this.spittle.active) {
      ctx.fillRect(6 + p.x - 1, -16 + p.y - 1, 2.4, 2.4); // sparks, not droplets
    }

    // Comet trail: fading motes behind him, drawn before the body so his
    // silhouette sits on top of his own tail of light.
    if (this.trail.active.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.trail.active) {
        const u = p.age / p.life;
        ctx.fillStyle = `hsla(${baseHue},60%,72%,${(1 - u) * 0.55})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2 * (1 - u), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore(); // done with the ctx.translate-relative aura/tongue/spittle drawing

    // Body/head/jaw/eye as a low-poly wireframe (follow-up item 1): manually
    // transformed (not via ctx.rotate) so edge angle/length -- and therefore
    // hue/glow -- actually reacts to the neck-bob and jaw snap.
    const neckRad = (this.neckAngle * Math.PI) / 180;
    // bodyRoll tumbles the whole glyph (barrel roll / tail-chase); the
    // pounce squash coils it. Both render-only, like everything else here.
    const group = {
      tx: x, ty: y, rot: neckRad + this.bodyRoll,
      scaleX: DRAW_SCALE * this.squashX, scaleY: DRAW_SCALE * this.squashY,
    };
    const bodyHub = BROSHI_BODY.vertices[0];
    const bodyMesh = meltMesh(
      displaceMeshRadial(BROSHI_BODY, bodyHub.x, bodyHub.y, this.modal),
      bodyHub.x, bodyHub.y, this._nowMs / 1000, this._melt || 0, 2,
    );
    const glyphOpts = { satBase: 30, lightBase: 56, hueSpread: 20 };

    // Stellar under-glow (the same trick Midasus's core uses): a blurred,
    // larger, additive copy of the body drawn first so he catches light
    // like an instrument instead of reading flat next to her.
    const glowAlpha = 0.16 + 0.24 * this.rho + 0.3 * this.beatFlash;
    const glowCenter = applyTransform(bodyHub, group);
    drawGlowHalo(ctx, glowCenter.x, glowCenter.y, 28 * group.scaleX, 24 * group.scaleY, baseHue, glowAlpha, { sat: 30, light: 74 });

    // Ink contour under the crisp strokes (outline): the raptor's
    // silhouette stays sharp against his own under-glow and comet trail.
    drawMeshPart(ctx, bodyMesh, this._bodyRest, group, baseHue, { ...glyphOpts, outline: true });
    drawMeshPart(ctx, BROSHI_HEAD, this._headRest, group, baseHue, { ...glyphOpts, outline: true });
    if (this.beatFlash > 0.03) {
      // Kick ignition: the whole glyph flashes additively with the beat.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawMeshPart(ctx, bodyMesh, this._bodyRest, group, baseHue, { alpha: 0.6 * this.beatFlash, satBase: 65, lightBase: 72, widthBase: 2.2 });
      ctx.restore();
    }

    const jawTip = BROSHI_JAW.vertices[1];
    const jawMesh = { vertices: [BROSHI_JAW.vertices[0], { x: jawTip.x, y: jawTip.y + this.jawOpen * 10 }], edges: BROSHI_JAW.edges };
    drawMeshPart(ctx, jawMesh, this._jawRest, group, baseHue + 15, { satBase: 22, lightBase: 62, widthBase: 1.2 });

    const tailRad = (this.tailAngle * Math.PI) / 180;
    const [tailBase, tailTip0] = BROSHI_TAIL.vertices;
    const tdx = tailTip0.x - tailBase.x, tdy = tailTip0.y - tailBase.y;
    const tailTip = {
      x: tailBase.x + tdx * Math.cos(tailRad) - tdy * Math.sin(tailRad),
      y: tailBase.y + tdx * Math.sin(tailRad) + tdy * Math.cos(tailRad),
    };
    const tailMesh = { vertices: [tailBase, tailTip], edges: BROSHI_TAIL.edges };
    drawMeshPart(ctx, tailMesh, this._tailRest, group, baseHue - 10, { satBase: 24, lightBase: 48, widthBase: 1.2 });

    const eyeLit = this.rho > 0.3;
    drawMeshPart(ctx, BROSHI_EYE, this._eyeRest, group, eyeLit ? 0 : baseHue, {
      satBase: eyeLit ? 20 : 30, lightBase: eyeLit ? 80 : 15, alpha: eyeLit ? 0.5 + 0.4 * this.rho : 0.9,
    });

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(DRAW_SCALE, DRAW_SCALE);
    for (const d of this.drool.active) {
      ctx.fillStyle = 'rgba(150,220,255,0.7)';
      ctx.beginPath();
      ctx.arc(12, -16 + d.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
