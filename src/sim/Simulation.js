// Fixed-timestep simulation container (spec §0.2 rule 3, §6.1). Owns every
// gameplay system and exposes prev/current snapshots so the renderer can
// interpolate smoothly between 120 Hz sim steps regardless of display refresh.
import { Role } from '../core/NoteEvent.js';
import { Lane, laneCounts } from '../core/Casting.js';
import { MAX_LATENCY_MS } from '../core/ChoreoClock.js';
import { skidOffset, skidParams, tractionFrom } from './Traction.js';
import { Midio } from './Midio.js';
import { JumpController, A, GAMMA, W, H_BASE, D_MIN } from './JumpController.js';
import { CameraDirector } from '../render/CameraDirector.js';
import { ComboSystem } from './ComboSystem.js';
import { ImpactFX } from './ImpactFX.js';
import { RippleFX } from './RippleFX.js';
import { BattleDirector } from './BattleDirector.js';
import { TelegraphScanner } from './TelegraphScanner.js';
import { ObstacleSpawner } from './ObstacleSpawner.js';
import { Midasus } from './Midasus.js';
import { Broshi } from './Broshi.js';
import { MidioPerformer } from './MidioPerformer.js';
import { CalmDirector } from './CalmDirector.js';
import { GnatGag } from './GnatGag.js';
import { HypeDirector } from './HypeDirector.js';
import { VibeDirector } from './VibeDirector.js';
import { epicBiasForKind } from '../lyrics/SectionFusion.js';
import { EnsembleDirector } from './EnsembleDirector.js';
import { ExcursionDirector } from './ExcursionDirector.js';
import { ApotheosisDirector } from './ApotheosisDirector.js';
import { KeyDirector } from './KeyDirector.js';
import { CodaDirector } from './CodaDirector.js';
import { FilmFinish } from '../render/FilmFinish.js';
import { BiomeManager } from '../world/BiomeManager.js';
import { FractureEngine } from '../world/FractureEngine.js';
import { GroundField } from '../world/GroundField.js';
import { PerfGovernor } from '../render/PerfGovernor.js';
import { HighlightReel } from '../render/HighlightReel.js';
import { hashSeed, clamp01 } from '../utils/math.js';
import { buildNoteChart } from './NoteChart.js';
import { TapJudge } from './TapJudge.js';
import { ScoreKeeper } from './ScoreKeeper.js';
import { PhraseTracker } from '../core/PhraseTracker.js';
import { AirJumpSequencer } from './AirJumpSequencer.js';
import { FeverMeter } from './FeverMeter.js';
import { LatencyCalibrator } from './LatencyCalibrator.js';
import { WeatherDirector } from './WeatherDirector.js';
import { OrogenyDirector } from '../world/OrogenyDirector.js';

const WORLD_SPEED_PX_S = 220;
const CLEAN_WINDOW_MS = 90;
// v_ref = 2*Ha_max/(gamma*D_min) — the fastest "typical" landing (spec §2.2.1).
const V_REF = (2 * (1 - W) * H_BASE * 1.4) / (GAMMA * D_MIN);
// Bass-line air jumps: how far ahead (px) an upcoming obstacle must be
// before an extra, non-charted air jump is allowed to retarget the arc --
// the chart's own flawless schedule must never be put at risk for a beat
// that's just decoration.
const BASS_AIR_JUMP_SAFETY_PX = 260;

/** Pure: is it safe to fire an extra bass-driven air jump right now, given
 *  the nearest upcoming obstacle (or null)? Safe when there's no obstacle
 *  ahead, or it's already behind, or it's far enough out that a retargeted
 *  arc has settled back onto the chart's own schedule well before Midio
 *  gets there. */
export function bassAirJumpSafe(obstacle, worldX, safetyPx = BASS_AIR_JUMP_SAFETY_PX) {
  if (!obstacle) return true;
  const distancePx = obstacle.wx - worldX;
  return distancePx < 0 || distancePx > safetyPx;
}

export class Simulation {
  constructor(conductor, paramBus, {
    bpm = 120, energyCurves = null, canvasWidth = 1280, canvasHeight = 720,
    customBiome = null, inputOffsetMs = 0, outputLatencyMs = null, lyricSections = null,
  } = {}) {
    this.conductor = conductor;
    this.paramBus = paramBus;
    this.energyCurves = energyCurves;
    this.customBiome = customBiome || null;
    this.canvasWidth = canvasWidth;
    // Output-latency compensation (ChoreoClock): main.js passes a live
    // getter onto the AudioContext's reported latency; decorative
    // beat-anchored envelopes evaluate on the heard clock via visualLagMs.
    this._outputLatencyFn = typeof outputLatencyMs === 'function' ? outputLatencyMs : null;
    this.visualLagMs = 0;

    // Casting (Casting.js): which character performs which line, decided by
    // the adapters from track names / stem filenames / spectra. Empty lanes
    // fall back to the pre-casting wiring so an untagged timeline (the
    // procedural demo, old fixtures) behaves exactly as before.
    const lanes = laneCounts(conductor.timeline);
    // The one resolver: these three booleans drive ALL routing below (the
    // Midasus/Broshi filters, the accent filter, and _takeoffAccent), so a
    // fallback rule can never desync between consumers. this.casting is a
    // read-only summary derived from the same booleans (debug/UI only).
    this._midasusCleanLane = lanes[Lane.MIDASUS] > 0;
    this._broshiBassLane = lanes[Lane.BROSHI] > 0;
    this._midioLeadLane = lanes[Lane.MIDIO] > 0;
    this.casting = {
      midasus: this._midasusCleanLane ? 'clean-lane' : 'melody',
      broshi: this._broshiBassLane ? 'bass-lane' : 'melody',
      midio: this._midioLeadLane ? 'lead-lane' : 'bass',
      counts: lanes,
    };
    this._midioAccentFilter = this._midioLeadLane
      ? (e) => e.lane === Lane.MIDIO
      : (e) => e.role === Role.BASS;

    this.midio = new Midio();
    this.jump = new JumpController(paramBus);
    // Landing-on-the-next-kick (JumpController.scheduledJumpD): the same
    // raw kick-time list NoteChart/JumpPlanner replay, so live launches and
    // retargets schedule onto the real next onset instead of only ever
    // guessing from the beat-period EMA -- see NoteChart.js/JumpPlanner.js
    // for why the schedule was previously "occasionally outstanding,
    // usually weird" (an EMA only matches steady four-on-the-floor).
    this.jump.setKickTimes(conductor.timeline.filter((e) => e.role === Role.RHYTHM && e.kick).map((e) => e.tMs));
    this.camera = new CameraDirector();
    this.comboSystem = new ComboSystem();
    this.impactFX = new ImpactFX();
    this.rippleFX = new RippleFX();
    this.telegraph = new TelegraphScanner();
    this.obstacles = new ObstacleSpawner(paramBus);

    // Autoplay: Midio performs the song himself. The chart is the offline
    // jump predictor's own takeoff schedule (see NoteChart.js) -- "perform
    // every note exactly on time" reproduces the same arcs ObstacleSpawner
    // placed obstacles against, so nothing here can ever be uncleared. The
    // judge/score/combo/fever machinery is unchanged from the old
    // player-driven build; it's just always fed a flawless performance now.
    this.noteChart = buildNoteChart(conductor.timeline, conductor.durationMs || 0);
    this.judge = new TapJudge(this.noteChart);
    this.scoreKeeper = new ScoreKeeper(this.noteChart.maxPossibleScore);
    this.inputQueue = [];
    this._lastHoldComboMs = -Infinity;
    this._autoplayCursor = 0;

    // Phrase structure (4- or 8-measure groupings, chosen by the energy
    // autocorrelation upgrade in PhraseTracker) paces the double-jump budget.
    this.phrases = new PhraseTracker(conductor.barGrid, energyCurves);
    this.airSeq = new AirJumpSequencer(this.phrases);
    // Steady accurate taps × song energy = how insane the visuals get.
    this.fever = new FeverMeter();
    // Steady-but-biased taps are pipeline latency, not player error: the
    // calibrator watches judged offsets and shifts the input offset to
    // cancel a consistent lag. main.js applies offsetMs at stamp time.
    this.latency = new LatencyCalibrator(inputOffsetMs);

    this.obstacles.buildCandidates(conductor.timeline, 60000 / bpm, this.midio.halfWidth, this.noteChart.holdSpans);

    this.midasus = new Midasus(conductor.timeline, this.midio, {
      groundY: this.midio.groundY, ceilingY: 40, stageW: canvasWidth, stageH: canvasHeight,
      noteFilter: this._midasusCleanLane ? (e) => e.lane === Lane.MIDASUS : null,
    });
    this.broshi = new Broshi(conductor, paramBus, {
      hopFilter: this._broshiBassLane ? (e) => e.lane === Lane.BROSHI : null,
    });
    this.broshi._lastBarPeriodMs = (60000 / bpm) * 4;

    const songSeed = hashSeed(`${conductor.timeline.length}:${conductor.durationMs}:${conductor.timeline[0]?.tMs ?? 0}:${conductor.timeline.at(-1)?.tMs ?? 0}`);
    this.performer = new MidioPerformer(songSeed);
    this.apotheosis = new ApotheosisDirector();
    this.calm = new CalmDirector();
    this.hype = new HypeDirector();
    this.weather = new WeatherDirector();
    this._lastDropCount = 0; // matches HypeDirector's own initial dropCount -- no spurious punch at t=0
    this.filmFinish = new FilmFinish();
    this.vibe = new VibeDirector(conductor.timeline);
    this.keyDirector = new KeyDirector();
    this.coda = new CodaDirector(conductor.durationMs || 0);
    this.ensemble = new EnsembleDirector(songSeed, { stageW: canvasWidth, stageH: canvasHeight });
    this.excursions = new ExcursionDirector(conductor.durationMs || 0);
    this.gnat = new GnatGag(songSeed, { canvasWidth, canvasHeight });
    this.groundField = new GroundField(this.midio.groundY, {
      conductor, durationMs: conductor.durationMs, songSeed,
    });
    this.biomes = new BiomeManager({
      conductor, energyCurves, durationMs: conductor.durationMs,
      canvasWidth, canvasHeight, groundY: this.midio.groundY, songSeed,
      groundField: this.groundField,
      customBiome: this.customBiome,
      lyricSections,
    });
    this.biomes.reducedFlash = this.reducedFlash;
    // Enemy-wave combat: flying/crawling enemies spawn during the song's
    // identified high-energy/tension windows, and the three characters
    // shoot them down with dots of light timed to vaporize exactly on the
    // 16th-note grid -- one defender at a time, escalating as the backlog
    // grows, per DEFENDER_ORDER (Midasus, Broshi, Midio).
    this.battle = new BattleDirector({
      barGrid: conductor.barGrid, durationMs: conductor.durationMs, energyCurves, seed: songSeed,
    });
    this.highlightReel = new HighlightReel();
    this.fracture = new FractureEngine(conductor, {
      canvasWidth, canvasHeight, songSeed, durationMs: conductor.durationMs,
    });

    // Orogeny: the mountains visibly build across the song, peaking at its
    // energy climax, then subside through the rest of the runtime.
    this.orogeny = new OrogenyDirector(energyCurves, conductor.durationMs || 0, conductor.barGrid);

    this.worldX = 0;
    this.timeMs = 0;

    // The user's cursor, in stage coordinates, fed by main.js. The baby
    // stars are aware of it (they're aware of the user); nothing else reads
    // it, and it never moves the camera. Inactive until the first move and
    // after a couple of idle seconds.
    this.pointer = { x: canvasWidth / 2, y: canvasHeight / 2, active: false, lastMoveMs: -Infinity };

    this.prev = this._snapshot();
    this.curr = this._snapshot();

    this._holdSpanIdx = 0;
    this._skippedRollKick = false;
    conductor.on(Role.RHYTHM, (evt) => {
      if (evt.kick) {
        // Kicks no longer launch jumps (the player does) — but the inter-kick
        // EMA must keep flowing: it drives jump duration, the combo grace/
        // break windows, and the ensemble/strut timing. Kicks INSIDE a hold
        // span are the roll's pay ticks, not beat carriers — feeding their
        // 150ms gaps in would crush the EMA, shrink the combo break window
        // below the next physical landing gap, and mistime the next jump.
        // The span's first kick still carries its beat in; after the span,
        // the baseline resets so the roll-sized gap never reads as a beat.
        const spans = this.noteChart.holdSpans;
        while (this._holdSpanIdx < spans.length && evt.tMs > spans[this._holdSpanIdx].toMs) this._holdSpanIdx++;
        const span = spans[this._holdSpanIdx];
        if (span && evt.tMs > span.fromMs && evt.tMs <= span.toMs) {
          this._skippedRollKick = true;
        } else {
          if (this._skippedRollKick) {
            this._skippedRollKick = false;
            this.jump.resetKickBaseline();
          }
          this.jump.noteKickTiming(evt.tMs);
        }
        this.gnat.onKick(evt);
        this.performer.onKick(evt.tMs);
        this.hype.onKick(evt.vel);
        this.groundField.kickGlow(this.worldX, evt.tMs, evt.vel);
        this.midasus.voyage.onKick(evt.vel); // deep-space sparkle burst (self-gated on phase)
        if (this.apotheosis.active) this.performer.captureGoldAfterimage(this.midio, this.timeMs);
      }
    });

    // Midio's accent line: when the casting found a lead lane (synth leads,
    // driven guitars, horns -- see Casting.js), his extra mid-air beats ride
    // THAT line; otherwise the pre-casting bass anchoring stands. Either
    // way an onset while airborne can pop an extra beat mid-air -- a busy
    // line makes him fly busier, a sparse one leaves him be. Guarded so it
    // never risks the chart's own clearance guarantee.
    conductor.on('*', (evt) => {
      if (!this._midioAccentFilter(evt)) return;
      if (!this.jump.airborne) return;
      if (!bassAirJumpSafe(this.obstacles.nearestAhead(this.worldX), this.worldX)) return;
      const grant = this.airSeq.tryConsume(evt.tMs);
      if (!grant) return;
      const performed = this.jump.airJump({ tMs: evt.tMs, vel: evt.vel }, grant.boostMul * 0.8, grant);
      if (!performed) this.airSeq.refund();
    });

    // Slippery surfaces (Traction.js): settled snow turns landings into
    // bounded render-only skids. Null when the ground grips.
    this._skid = null;
    this.snowCover = 0;
  }

  /** Queues an autoplay press: kind 'down' | 'up' at tMs. Insertion-sorted
   *  so a hold's 'up' (enqueued far in the future, at the hold's endMs) and
   *  a later note's 'down' always drain in true time order regardless of
   *  which was queued first. */
  enqueueTap(kind, tMs) {
    const q = this.inputQueue;
    let i = q.length;
    while (i > 0 && q[i - 1].tMs > tMs) i--;
    q.splice(i, 0, { kind, tMs });
  }

  /** Walks the note chart and queues a flawless press for every note that
   *  has now arrived -- offset 0 always judges 'perfect' (TapJudge's own
   *  pointsForOffset(0) === 100), so this literally performs the chart
   *  rather than faking a score. Tap notes get a 60ms-later 'up' (well
   *  under HOLD_MAX_GAP_MS/HOLD_ARM_EARLY_MS so it can never mis-arm a
   *  following hold); hold notes hold down to endMs, so onTapUp's grace
   *  window pays every tick plus the full completion bonus. */
  _driveAutoplay(nowMs) {
    const notes = this.noteChart.notes;
    while (this._autoplayCursor < notes.length && notes[this._autoplayCursor].tMs <= nowMs) {
      const n = notes[this._autoplayCursor++];
      this.enqueueTap('down', n.tMs);
      this.enqueueTap('up', n.type === 'hold' ? n.endMs : n.tMs + 60);
    }
  }

  /** Fan the judge's one-shot events out into score, combo, and FX. */
  _applyJudgeEvents() {
    // Fever cranks the judgment FX too: the same perfect press throws a
    // bigger burst at high fever than it does cold.
    const particleMul = (this.perf ? this.perf.particleMul : 1) * (1 + 1.5 * this.fever.level);
    for (const evt of this.judge.stepEvents) {
      this.fever.onJudge(evt);
      if ((evt.kind === 'hit' || evt.kind === 'holdStart') && evt.offsetMs != null) {
        this.latency.onJudgedHit(evt.offsetMs);
      }
      // Hold ticks/completions keep the combo alive through a landing-free
      // hold (RULE 4 would otherwise break the streak mid-note) — but a
      // dense roll must not grow the streak faster than landings ever
      // could, so combo credit is rate-limited while every tick still pays.
      if (evt.kind === 'holdTick' || evt.kind === 'holdComplete') {
        if (evt.tMs - this._lastHoldComboMs >= 300) {
          this._lastHoldComboMs = evt.tMs;
          this.comboSystem.onLanding(evt.tMs, true);
          this.performer.onStreak(this.comboSystem.streak, evt.tMs);
          this.scoreKeeper.noteStreak(this.comboSystem.streak);
        }
      }
      this.scoreKeeper.applyEvent(evt, this.comboSystem.displayM);

      switch (evt.kind) {
        case 'hit':
        case 'holdStart':
          if (evt.tier === 'sour') {
            this.impactFX.judgment(this.worldX, this.midio.groundY, 'sour', particleMul);
            this.camera.shake(4);
          } else if (evt.tier) { // tier null = late-armed hold: the glow ramp is its own cue
            this.impactFX.judgment(this.worldX, this.midio.groundY, evt.tier, particleMul);
            this.comboSystem.sustain(evt.tMs); // a clean press keeps the combo warm through its airtime
            if (evt.tier === 'perfect') this.performer.goldFlash = 1;
          }
          break;
        case 'sour':
          this.impactFX.judgment(this.worldX, this.midio.groundY, 'sour', particleMul);
          this.camera.shake(4);
          break;
        case 'holdComplete':
          this.impactFX.splat(this.worldX, this.midio.groundY);
          this.impactFX.ignite(this.worldX, this.midio.groundY);
          break;
        case 'holdChoke':
          this.camera.shake(5);
          break;
        default: // 'miss' | 'holdTick': deliberately quiet on the visual side
          break;
      }
    }
  }

  /** How hard Midio's own line is hitting at a takeoff instant, 0..1: the
   *  nearest lead-lane note's velocity when the casting found a lead lane,
   *  else the live bass band (the pre-casting behavior). */
  _takeoffAccent(tMs) {
    if (this._midioLeadLane) {
      const e = this.conductor.nearestEventMs((evt) => evt.lane === Lane.MIDIO, tMs, 120);
      return e ? e.vel : 0;
    }
    return this.energyCurves ? clamp01(this.energyCurves.sample(1, tMs)) : 0;
  }

  /** The user's cursor position in stage coordinates (main.js maps client
   *  coords through the canvas rect). Marks the pointer active; it idles out
   *  after a couple of seconds of no movement (see step()). */
  setPointer(x, y) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = true;
    this.pointer.lastMoveMs = this.timeMs;
  }

  /** The Reel (Movement VI): live-toggle the reduced-flash accessibility
   *  setting, cascading to every consumer that caps its own flash alphas. */
  setReducedFlash(v) {
    this.reducedFlash = v;
    this.biomes.reducedFlash = v;
  }

  step(dtMs, nowMs) {
    this.prev = this.curr;
    this.timeMs = nowMs;
    const dtSec = dtMs / 1000;

    // ChoreoClock: sample the audio pipeline's output latency once per step
    // and hand it to every performer whose decorative envelopes anchor on
    // note onsets -- their peaks then land when the EAR gets the beat.
    this.visualLagMs = this._outputLatencyFn ? Math.min(MAX_LATENCY_MS, Math.max(0, this._outputLatencyFn() || 0)) : 0;
    this.performer.visualLagMs = this.visualLagMs;
    this.broshi.visualLagMs = this.visualLagMs;
    this.midasus.visualLagMs = this.visualLagMs;

    this.jump.clearFrameFlags();
    this.comboSystem.clearFrameFlags();
    this.performer.clearFrameFlags();
    this.judge.clearFrameFlags();

    this.conductor.dispatchUpTo(nowMs);
    this._driveAutoplay(nowMs);

    // Drain autoplay presses stamped up to this step's time. Hold starts
    // suppress the physical jump (a hold is a grounded slide); everything
    // else attempts a launch under the usual launch/retarget rules, with
    // the matched kick's velocity when the press hit a chart note.
    while (this.inputQueue.length && this.inputQueue[0].tMs <= nowMs) {
      const ev = this.inputQueue.shift();
      if (ev.kind === 'down') {
        const res = this.judge.onTapDown(ev.tMs);
        if (!res.startedHold) {
          // Accent anchoring: the takeoff itself stays chart-timed
          // (obstacles are placed against it), but its height rides his own
          // line -- a lead-lane note under a jump (or, pre-casting, a heavy
          // bass moment) makes that jump bigger, never smaller, so
          // clearance only ever improves.
          const accentAtTakeoff = this._takeoffAccent(ev.tMs);
          const vel = Math.min(1, (res.matchedVel ?? 0.7) * (1 + 0.3 * accentAtTakeoff));
          const tapEvt = { tMs: ev.tMs, vel };
          // A tap before the character hits the ground is a double jump —
          // budgeted per 4-/8-measure phrase, then feet-first physics again.
          let performed = false;
          if (this.jump.airborne) {
            const grant = this.airSeq.tryConsume(ev.tMs);
            if (grant) {
              performed = this.jump.airJump(tapEvt, grant.boostMul, grant);
              if (!performed) this.airSeq.refund(); // landed by tMs after all
            }
          }
          if (!performed) this.jump.onPlayerTap(tapEvt);
        }
      } else {
        this.judge.onTapUp(ev.tMs);
      }
    }
    this.judge.update(nowMs);
    this._applyJudgeEvents();
    this.fever.update(nowMs, dtSec, this.energyCurves);
    this.calm.update(nowMs, dtSec, this.energyCurves);
    this.hype.update(nowMs, dtSec, this.energyCurves);
    // Drop impact pack: a fresh drop (dropCount ticking up) throws a hard
    // shake, on top of the shockwave ring / chromatic shock / speed-lines
    // the Renderer draws off dropAtMs.
    if (this.hype.dropCount !== this._lastDropCount) {
      this._lastDropCount = this.hype.dropCount;
      this.camera.shake(9);
    }
    // Lyric structure's epic bias (SectionFusion): zero, and thus a strict
    // no-op, whenever there's no lyric data (biomes.currentKind stays
    // null). One-frame lag against biomes.update() (which runs later this
    // same step) is inaudible against a signal already eased over ~1.5s.
    this.vibe.epicBias = epicBiasForKind(this.biomes.currentKind, this.biomes.lyricIntensityEased);
    this.vibe.update(nowMs, dtSec, this.energyCurves);
    this.keyDirector.update(nowMs, dtSec, {
      tonic: this.vibe.tonic, tonicConfidence: this.vibe.tonicConfidence, conductor: this.conductor,
    });
    if (this.keyDirector.justKeyChange) {
      this.biomes.mandala.reseed(this.keyDirector.lastKeyChange.to);
      this.camera.shake(6);
    }
    this.coda.update(nowMs);
    this.groundField.flatten = this.coda.unravel; // the ground lies down as the ending arc progresses
    this.weather.update(nowMs, dtSec, {
      valence: this.vibe.valence, epic: this.vibe.epic, calm: this.calm.level,
      energySlow: this.hype.slow, surge: this.hype.surge, unravel: this.coda.unravel,
    });
    // Slippery surfaces: settled snowfall OR a biome that is snow to begin
    // with (ARCTIC's own particle signature) ices the footing; a tsunami's
    // temporary flood (BiomeManager.floodLevel01) wets it the same way --
    // Traction.js doesn't care WHY the ground lost its grip, just how much.
    // The skid this drives is render-only (see Traction.js); Broshi's
    // trailing spring genuinely loses damping, so he visibly overshoots
    // and slides back.
    const biomeSnow = this.biomes.currentParticleKind && this.biomes.currentParticleKind() === 'snow' ? 0.8 : 0;
    this.snowCover = Math.max(this.weather.groundCover, biomeSnow, this.biomes.floodLevel01 || 0);
    this.broshi.traction = tractionFrom(this.snowCover);
    this.biomes.snowCover = this.snowCover;
    this.ensemble.update(nowMs, dtSec, this.vibe, this.jump.beatPeriodMs);
    // Midio roams toward his ensemble anchor -- slow, never gameplay-fast.
    const dxA = this.ensemble.anchors[0].x - this.midio.screenX;
    this.midio.screenX += Math.max(-30 * dtSec, Math.min(30 * dtSec, dxA));
    this.jump.update(nowMs);
    this.midio.y = this.jump.y;

    this.groundField.update(nowMs, dtSec, this.worldX, this.energyCurves);
    this.midio.groundY = this.groundField.heightAt(this.worldX);
    if (this.groundField.justRecovered) this.camera.shake(10);

    if (this.jump.pendingAirJump) {
      // The double jump reads as its own beat: a burst at the character's
      // altitude, a camera kiss, and the body rings. The flourish (the
      // phrase's last air jump) hits harder.
      const aj = this.jump.pendingAirJump;
      const airY = this.midio.groundY - aj.y;
      this.impactFX.splat(this.worldX, airY);
      this.performer.modal.excite(aj.isFlourish ? 6 : 3);
      if (aj.isFlourish) {
        this.impactFX.ignite(this.worldX, airY);
        this.fever.spark(0.12); // the phrase's flourish stokes the fever directly
      }
    }

    if (this.jump.pendingLanding) {
      const nearestKick = this.conductor.nearestEventMs(
        (e) => e.role === Role.RHYTHM && e.kick, nowMs, CLEAN_WINDOW_MS + 20,
      );
      const isClean = ComboSystem.isCleanLanding(nowMs, nearestKick ? nearestKick.tMs : null);
      const I = ImpactFX.intensity(this.jump.pendingLanding.vLandPxMs, V_REF);
      this.comboSystem.onLanding(nowMs, isClean);
      this.performer.onLanding(nowMs, this.comboSystem.justClean, this.comboSystem.displayM, I);
      this.performer.onStreak(this.comboSystem.streak, nowMs);
      this.scoreKeeper.noteStreak(this.comboSystem.streak);
      this.impactFX.trigger(this.worldX, this.midio.groundY, I, this.camera);
      this.groundField.impulse(this.worldX, I, nowMs); // a shockwave ripples the terrain outward from the landing
      this.rippleFX.trigger(this.worldX, this.midio.groundY, I); // the screen-space visual echo of that shockwave
      // The world visibly answers back: a landing kicks up whatever the
      // active biome's ambient particle color is (snow, embers, pollen...)
      // -- zero new per-biome code, just BiomeProfiles' existing palette.
      // Mid-flood, it's a splash instead -- same puff, water-blue tint
      // (matching OceanLife/BiomeManager's own water color).
      this.rippleFX.landingPuff(
        this.worldX, this.midio.groundY, I,
        this.biomes.floodActive ? '#55c8f0' : this.biomes.currentParticleColor(),
      );
      if (this.comboSystem.justClean) this.impactFX.splat(this.worldX, this.midio.groundY);
      this.fracture.registerImpact(I);

      // Iced footing: a hard landing on settled snow starts a bounded,
      // render-only skid (plus a white powder puff where boots hit).
      const skid = skidParams(this.snowCover, I);
      if (skid) {
        this._skid = { startMs: nowMs, ...skid };
        this.impactFX.splat(this.worldX, this.midio.groundY);
        this.impactFX.sputter(this.worldX, this.midio.groundY, 0.06);
      }

      // The Apotheosis: gameplay precision powers the show -- every clean
      // landing and combo milestone literally charges the transformation.
      if (this.comboSystem.justClean) this.apotheosis.onCleanLanding();
      if (this.performer.milestoneFlash) this.apotheosis.onMilestone();
      if (this.apotheosis.active) this.impactFX.ignite(this.worldX, this.midio.groundY);
    }

    this.apotheosis.update(nowMs, dtSec, { vibe: this.vibe, hype: this.hype, calm: this.calm });
    if (this.apotheosis.justEnded) {
      this.performer.modal.excite(8);
      this.impactFX.splat(this.worldX, this.midio.groundY);
    }

    const stumbled = this.obstacles.checkCollision(this.worldX, this.midio.halfWidth, this.jump.y);
    if (stumbled) this.comboSystem.onStumble();

    this.comboSystem.update(nowMs, this.jump.beatPeriodMs);

    const worldSpeed = WORLD_SPEED_PX_S * this.paramBus.live.scrollSpeed;
    this.worldX += worldSpeed * dtSec;

    this.obstacles.update(nowMs, this.worldX, worldSpeed / 1000);
    this.telegraph.update(nowMs, this.conductor, this.midio, this.jump, this.impactFX, this.worldX, this.midio.groundY, this.obstacles, this.noteChart);
    this.performer.update(
      nowMs, dtSec, this.midio, this.jump, this.comboSystem, this.calm.level, this.ensemble, this.judge.holdState,
      this.obstacles.nearestAhead(this.worldX),
    );
    // Riding a hold: heel dust streams from the slide the whole way.
    if (this.judge.holdState.active && !this.jump.airborne) {
      this.impactFX.sputter(this.worldX, this.midio.groundY, dtSec);
    }
    this.impactFX.step(dtSec);
    this.rippleFX.update(dtSec * 1000);

    // Decides whether Midasus or Broshi leaves the ensemble this frame;
    // triggering here (before their own update() calls below) means a
    // freshly-launched excursion starts animating in this very frame
    // rather than waiting one extra tick.
    this.excursions.update(nowMs, dtSec, {
      vibe: this.vibe, calm: this.calm, hype: this.hype, energyCurves: this.energyCurves,
      conductor: this.conductor, midasus: this.midasus, broshi: this.broshi, worldX: this.worldX,
    });

    // The cursor idles out after a couple of seconds of stillness.
    if (this.pointer.active && nowMs - this.pointer.lastMoveMs > 2500) this.pointer.active = false;
    // Points of interest for the hyper-curious baby stars: Midio, Broshi, and
    // the nearest upcoming obstacle (Broshi's render pose is one frame stale
    // here -- he updates below -- which is fine for a thing to be curious at).
    const babyInterests = [
      { x: this.midio.screenX, y: this.midio.groundY - this.midio.y - 40 },
      { x: this.broshi.renderX, y: this.broshi.groundY - this.broshi.hopY - 20 },
    ];
    const nearestObs = this.obstacles.nearestAhead(this.worldX);
    if (nearestObs) {
      babyInterests.push({ x: nearestObs.wx - this.worldX + this.midio.screenX, y: this.midio.groundY - nearestObs.height / 2 });
    }

    this.midasus.update(nowMs, dtSec, this.calm.level, {
      x: this.ensemble.anchors[2].x, y: this.ensemble.anchors[2].y,
      phase: this.ensemble.phase(2), melt: 2 + 4.5 * this.vibe.epic, epic: this.vibe.epic,
      interests: babyInterests, pointer: this.pointer,
    }, this.perf.particleMul, this.biomes.wind);
    // She's off on a voyage -> the ensemble's Kuramoto math should feel the
    // hole (this takes effect next frame; the weight eases over ~1.5s
    // regardless, so the one-step lag is inaudible/invisible).
    this.ensemble.setPresence(2, this.midasus.voyage.active ? 0 : 1);
    if (this.midasus.voyage.justLanded) { this.camera.shake(7); }
    // The sky notices her presence: the celestial's mandala swells while
    // she's dancing around it, and the accumulated star atlas glints with
    // every beat for the rest of the song.
    this.biomes.mandalaScaleMul = 1 + 0.12 * this.midasus.voyage.depth;
    this.midasus.voyage.atlasPulse = this.hype.slam;
    // The finale: 4s before the end (3.7s before the fracture freezes the
    // frame at durationMs-300), every accumulated atlas star goes
    // supernova -- her myths detonate as the song shatters.
    if (!this._atlasDetonated && this.conductor.durationMs > 0
      && nowMs >= this.conductor.durationMs - 4000 && this.midasus.voyage.atlas.length > 0) {
      this._atlasDetonated = true;
      this.midasus.voyage.detonateAtlas(nowMs);
      this.camera.shake(9);
    }
    this.broshi.update(nowMs, dtSec, this.midio, this.energyCurves, this.obstacles, this.worldX, this.midio.groundY, this.calm.level, {
      trailX: this.ensemble.anchors[1].x, phase: this.ensemble.phase(1), melt: 1.8 + 4 * this.vibe.epic,
      // A true companion watches his hero: airborne state + height for the
      // "watch him fly" head-tilt and takeoff crouch, the landing/clean
      // edges for the cheer + echo hop, world speed for the trot shimmy.
      midioAirborne: this.jump.airborne, midioY: this.midio.y,
      justLanded: !!this.jump.pendingLanding, justClean: this.comboSystem.justClean,
      worldSpeed,
      // He reacts to the sky, not just his hero: a shiver in snowfall, a
      // shake-off flick in rain -- the same music-reactive weather layer
      // BiomeManager/Traction already read, just also reaching Broshi.
      weatherKind: this.weather.kind, weatherIntensity: this.weather.intensity,
    }, this.groundField);
    // He's underground -> same presence handoff as Midasus's voyage.
    this.ensemble.setPresence(1, this.broshi.burrow.active ? 0 : 1);
    // Enemy-wave combat: fixed defender join order (Midasus, Broshi, Midio)
    // matches BattleDirector.DEFENDER_ORDER.
    this.battle.update(nowMs, dtMs, [
      { x: this.midasus.p.x, y: this.midasus.p.y },
      { x: this.broshi.renderX, y: this.midio.groundY - this.broshi.hopY },
      { x: this.midio.screenX, y: this.midio.renderY },
    ], this.visualLagMs, this.reducedFlash, this.canvasWidth);
    this.biomes.hypeBoost = 1 + 0.6 * this.hype.surge + 1.1 * this.fever.level; // drops + player fever surge every phenomena system
    this.biomes.heatShimmer = this.hype.fast; // a hard hype spike shimmers the far range
    this.biomes.paletteRotation = this.keyDirector.paletteRotation; // the world transposes with the song's key
    this.biomes.dropAtMs = this.hype.dropAtMs; // drops send a heavy ring through the lake
    this.biomes.unravel = this.coda.unravel; // parallax delaminates, particle hues converge to the halo
    this.biomes.particleMul = this.perf.particleMul * (1 + this.fever.level); // perf headroom × player fever
    this.biomes.fever = this.fever.level; // the mountains dance harder as the fever climbs
    this.biomes.midioX = this.midio.screenX; // the light rig's drop-snap points at him
    this.biomes.midioY = this.midio.renderY;
    this.biomes.weatherState = this.weather.state; // music-reactive rain/snow/petals/embers, decoupled from biome
    if (this.performer.lastMilestone) {
      this.biomes.milestoneAtMs = this.performer.lastMilestone.atMs;
      this.biomes.milestoneIdx = this.performer.lastMilestone.idx;
    }
    this.biomes.update(nowMs, dtSec, this.energyCurves, this.calm.level, this.worldX);
    this.filmFinish.update(nowMs, dtSec, this.calm.level, this.biomes.budget, this.hype);
    if (this.biomes.cutFlashJustFired) { this.camera.shake(6); }
    this.fracture.update(nowMs, dtSec, this.energyCurves, this.camera);

    // Orogeny: the mountains build toward the song's energy climax, then
    // gradually subside through the rest of the runtime.
    this.orogeny.update(nowMs);
    this.biomes.orogenyGrowth = this.orogeny.growth;

    // The live skid offset: pure screen-space (collision/chart never see
    // it), eased by skidOffset's catch-your-footing shape, ended when done.
    if (this._skid) {
      const u = (nowMs - this._skid.startMs) / this._skid.durMs;
      this.midio.slipX = this._skid.amp * skidOffset(u);
      if (u >= 1) { this._skid = null; this.midio.slipX = 0; }
    } else {
      this.midio.slipX = 0;
    }

    this.gnat.update(nowMs, dtSec, this.calm.level);
    this.camera.update(dtSec, this.calm.level, this.reducedFlash);
    this.paramBus.step();

    this.curr = this._snapshot();
  }

  _snapshot() {
    return {
      worldX: this.worldX,
      midioY: this.midio.renderY,
      slipX: this.midio.slipX || 0,
      scaleX: this.midio.scaleX,
      scaleY: this.midio.scaleY,
      leanDeg: this.midio.leanDeg,
    };
  }

  /** alpha in [0,1] — blend between the last two sim states for a jitter-free render. */
  lerpState(alpha) {
    const p = this.prev, c = this.curr;
    const lerp = (a, b) => a + (b - a) * alpha;
    return {
      // midioX doubles as the world->screen ORIGIN for ground, obstacles,
      // burrow, and impact FX (Renderer passes it as originX), so the skid
      // must NOT live here -- folding it in would translate the whole
      // world along with him and cancel the visible slide. midioDrawX is
      // where his own body (mesh, shadow, afterimages) actually renders:
      // origin plus the interpolated skid.
      worldX: lerp(p.worldX, c.worldX),
      midioX: this.midio.screenX,
      midioDrawX: this.midio.screenX + lerp(p.slipX ?? 0, c.slipX ?? 0),
      midioY: lerp(p.midioY, c.midioY),
      scaleX: lerp(p.scaleX, c.scaleX),
      scaleY: lerp(p.scaleY, c.scaleY),
      leanDeg: lerp(p.leanDeg, c.leanDeg),
      airborne: this.jump.airborne,
    };
  }
}
