// Fixed-timestep simulation container (spec §0.2 rule 3, §6.1). Owns every
// gameplay system and exposes prev/current snapshots so the renderer can
// interpolate smoothly between 120 Hz sim steps regardless of display refresh.
import { Role } from '../core/NoteEvent.js';
import { Lane, laneCounts } from '../core/Casting.js';
import { MAX_LATENCY_MS } from '../core/ChoreoClock.js';
import { skidOffset, skidParams, tractionFrom } from './Traction.js';
import { Midio } from './Midio.js';
import { JumpController, A, GAMMA, W, H_BASE, D_MIN, quantizeJumpVel } from './JumpController.js';
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
import { BeatAnchor } from './BeatAnchor.js';
import { ExcursionDirector } from './ExcursionDirector.js';
import { ApotheosisDirector } from './ApotheosisDirector.js';
import { KeyDirector } from './KeyDirector.js';
import { CodaDirector } from './CodaDirector.js';
import { FilmFinish } from '../render/FilmFinish.js';
import { BiomeManager } from '../world/BiomeManager.js';
import { FractureEngine } from '../world/FractureEngine.js';
import { WorldAssembly } from '../world/WorldAssembly.js';
import { GroundField } from '../world/GroundField.js';
import { PerfGovernor } from '../render/PerfGovernor.js';
import { HighlightReel } from '../render/HighlightReel.js';
import { clamp01 } from '../utils/math.js';
import { resolveSongSeed } from '../utils/seed.js';
import { buildNoteChart } from './NoteChart.js';
import { TapJudge } from './TapJudge.js';
import { ScoreKeeper } from './ScoreKeeper.js';
import { PhraseTracker } from '../core/PhraseTracker.js';
import { AirJumpSequencer } from './AirJumpSequencer.js';
import { RidgeAnchor } from './RidgeAnchor.js';
import { FeverMeter } from './FeverMeter.js';
import { LatencyCalibrator } from './LatencyCalibrator.js';
import { SyncMonitor } from './SyncMonitor.js';
import { GrooveFingerprint } from './GrooveFingerprint.js';
import { OpeningDirector } from './OpeningDirector.js';
import { WeatherDirector } from './WeatherDirector.js';
import { OrogenyDirector } from '../world/OrogenyDirector.js';
import { CueDirector } from './CueDirector.js';
import { CueKind } from '../core/ConductorTrack.js';

const WORLD_SPEED_PX_S = 220;
const CLEAN_WINDOW_MS = 90;
// v_ref = 2*Ha_max/(gamma*D_min) — the fastest "typical" landing (spec §2.2.1).
const V_REF = (2 * (1 - W) * H_BASE * 1.4) / (GAMMA * D_MIN);

export class Simulation {
  constructor(conductor, paramBus, {
    bpm = 120, energyCurves = null, canvasWidth = 1280, canvasHeight = 720,
    customBiome = null, inputOffsetMs = 0, outputLatencyMs = null, lyricSections = null, structure = null,
    groove = null,
    songSeed: pinnedSeed = null,
    conductorCues = null,
  } = {}) {
    this.conductor = conductor;
    this.paramBus = paramBus;
    this.energyCurves = energyCurves;
    this.customBiome = customBiome || null;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.stageW = canvasWidth;
    this.stageH = canvasHeight;
    this.bpm = bpm;
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
    // Player beat-anchor (BeatAnchor.js): a tap anywhere marks where the
    // player feels the pulse. It's a phase/period REFERENCE the ensemble
    // and jump scheduler pull toward, alongside (never replacing) the
    // chart -- see onBeatTap. The anchor's own live reference stays a
    // fixed object for the sim's lifetime; JumpController reads its current
    // fields on every call, so wiring it in once here is enough.
    this.beatAnchor = new BeatAnchor(60000 / bpm);
    this.jump.setAnchor(this.beatAnchor);
    // Cross-song memory of how this player hears a beat (GrooveFingerprint).
    // Unlike the anchor, which is rebuilt per song, this one is handed in by
    // main.js already carrying whatever previous sessions taught it.
    this.groove = groove || new GrooveFingerprint();
    // Set explicitly rather than left implicitly undefined: SyncMonitor reads
    // it as `suppress` on every step.
    this.recalibrating = false;
    // Holds the world back until the song has actually got going, judged
    // from the audio rather than from elapsed time (OpeningDirector).
    this.opening = new OpeningDirector();
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
    // Midio takes his cue from the furthest range: he only leaves the ground
    // while that skyline is heaved up near the top of its swing, and performs
    // the rest of the chart on foot. See RidgeAnchor.js for why.
    this.ridgeAnchor = new RidgeAnchor();
    // Steady accurate taps × song energy = how insane the visuals get.
    this.fever = new FeverMeter();
    // Steady-but-biased taps are pipeline latency, not player error: the
    // calibrator watches judged offsets and shifts the input offset to
    // cancel a consistent lag. main.js applies offsetMs at stamp time.
    this.latency = new LatencyCalibrator(inputOffsetMs);
    // Watches whether the beat grid actually matches the music, and decides
    // (timidly -- see its prompting policy) when to offer a tap recalibration.
    this.syncMonitor = new SyncMonitor();

    this.obstacles.buildCandidates(conductor.timeline, 60000 / bpm, this.midio.halfWidth, this.noteChart.holdSpans);

    this.midasus = new Midasus(conductor.timeline, this.midio, {
      groundY: this.midio.groundY, ceilingY: 40, stageW: canvasWidth, stageH: canvasHeight,
      noteFilter: this._midasusCleanLane ? (e) => e.lane === Lane.MIDASUS : null,
    });
    this.broshi = new Broshi(conductor, paramBus, {
      hopFilter: this._broshiBassLane ? (e) => e.lane === Lane.BROSHI : null,
    });
    this.broshi._lastBarPeriodMs = (60000 / bpm) * 4;

    const songSeed = resolveSongSeed(conductor, pinnedSeed);
    this.songSeed = songSeed;
    this.performer = new MidioPerformer(songSeed);
    this.apotheosis = new ApotheosisDirector();
    this.calm = new CalmDirector();
    this.hype = new HypeDirector();
    this.weather = new WeatherDirector();
    // The conductor track's live half (ConductorTrack.js / CueDirector.js).
    // Empty when the song brought no cue sheet, which is every MIDI without
    // a track named "Conductor", every raw-audio drop, and the demo -- so
    // the whole feature costs one no-op cursor advance per step when unused.
    this.cues = new CueDirector(conductorCues ? conductorCues.liveCues : []);
    this._lastDropCount = 0; // matches HypeDirector's own initial dropCount -- no spurious punch at t=0
    this._pendingDiscReason = null; // drop-cued disc spin, deferred one phase (see step())
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
      structure,
      conductorSchedule: conductorCues ? conductorCues.scheduleCues : null,
    });
    this.reducedFlash = false;
    this.visualStyle = 'rendered';
    this.biomes.reducedFlash = this.reducedFlash;
    this.biomes.setVisualStyle(this.visualStyle);
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
      energyCurves,
    });
    // The opening's counterpart to the finale's shatter -- see WorldAssembly.js.
    this.assembly = new WorldAssembly({ canvasWidth, canvasHeight, songSeed });

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
    // conductor is a single long-lived instance (see main.js) reused across
    // every song load, so every subscription made here must be torn down in
    // dispose() -- otherwise each replay leaves this sim's listeners firing
    // forever, stacked on top of whichever sim replaces it.
    this._unsub = [];
    this._unsub.push(conductor.on(Role.RHYTHM, (evt) => {
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
        // Grid coherence (SyncMonitor): how well the song's own kicks line up
        // with the beat grid everything is choreographed against. Scattered
        // kicks mean the tempo read is wrong, which is what "the characters
        // are moving randomly" actually looks like from the outside.
        this.syncMonitor.onKick(evt.tMs, this.jump.beatPeriodMs, this.beatAnchor.anchorMs);
        this.groundField.kickGlow(this.worldX, evt.tMs, evt.vel);
        this.midasus.voyage.onKick(evt.vel); // deep-space sparkle burst (self-gated on phase)
        if (this.apotheosis.active) this.performer.captureGoldAfterimage(this.midio, this.timeMs);
      }
    }));

    // Midio's accent line: when the casting found a lead lane (synth leads,
    // driven guitars, horns -- see Casting.js), his extra mid-air beats ride
    // THAT line; otherwise the pre-casting bass anchoring stands. Either
    // way an onset while airborne can pop an extra beat mid-air -- a busy
    // line makes him fly busier, a sparse one leaves him be. Guarded so it
    // never risks the chart's own clearance guarantee.
    this._unsub.push(conductor.on('*', (evt) => {
      if (!this._midioAccentFilter(evt)) return;
      if (!this.jump.airborne) return;
      const grant = this.airSeq.tryConsume(evt.tMs);
      if (!grant) return;
      const performed = this.jump.airJump({ tMs: evt.tMs, vel: evt.vel }, grant.boostMul * 0.8, grant);
      if (!performed) this.airSeq.refund();
    }));

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

  /**
   * Fan this step's conductor-track cues out into the engine
   * (ConductorTrack.js for the schema, CueDirector.js for the dispatch).
   *
   * Every arm here reaches a director through a method built for authored
   * input -- cueDrop, forceChange, cueCalm, cueKind, cueMeteors, strike --
   * rather than the music-driven path next to it. That distinction is the
   * whole point: the detectors are inferring things about the song and are
   * allowed to be wrong or to decline, but a cue was written on purpose, so
   * honoring it can't be conditional on a probability roll or on a threshold
   * the author can't see. Hard floors that exist for physical reasons (a
   * flourish can't restart mid-spin) still apply.
   *
   * SECTION/BIOME never arrive here -- they're schedule cues, already folded
   * into BiomeManager's plan at construction (see applyConductorSchedule).
   */
  _applyCues(nowMs) {
    for (const cue of this.cues.fired) {
      const strength = typeof cue.value === 'number' ? cue.value : 1;
      switch (cue.kind) {
        case CueKind.DROP:
          this.hype.cueDrop(nowMs, strength);
          // Matches the drop-driven disc spin's own one-phase deferral so a
          // cued drop punctuates exactly like a detected one (see step()).
          this._pendingDiscReason = 'cue';
          break;
        case CueKind.APOTHEOSIS:
          this.apotheosis.forceTrigger(nowMs);
          break;
        case CueKind.FLOURISH:
          this.ensemble.maybeDisc(nowMs, 'cue', this.vibe.epic);
          break;
        case CueKind.KEY_CHANGE:
          this.keyDirector.forceChange(nowMs);
          break;
        case CueKind.CALM:
          this.calm.cueCalm(nowMs, strength);
          break;
        case CueKind.METEORS:
          this.biomes.cueMeteors(nowMs, strength);
          break;
        case CueKind.LIGHTNING:
          this.biomes.cueLightning(nowMs);
          break;
        case CueKind.WEATHER:
          this.weather.cueKind(nowMs, cue.value);
          break;
        case CueKind.SHAKE:
          this.camera.shake(3 + 9 * strength);
          break;
        case CueKind.GROUND_PULSE:
          this.groundField.impulse(this.worldX, strength, nowMs);
          this.rippleFX.trigger(this.worldX, this.midio.groundY, strength);
          break;
        case CueKind.FEVER:
          this.fever.spark(0.25 * strength);
          break;
        default:
          break;
      }
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
      // Hop on hold ticks when grounded so multi-second rolls don't freeze
      // him after the opening jump lands. Obstacles are excluded from hold
      // spans, so these hops stay clearable-safe.
      // Same far-range gate the chart taps go through (RidgeAnchor.js): a
      // roll under a sunk skyline is danced out on the ground, not hopped.
      if (evt.kind === 'holdTick' && !this.jump.airborne && this.ridgeAnchor.open) {
        this.jump.onPlayerTap({ tMs: evt.tMs, vel: 0.55 });
      }
      this.scoreKeeper.applyEvent(evt, this.comboSystem.displayM);

      switch (evt.kind) {
        case 'hit':
        case 'holdStart':
          if (evt.tier === 'sour') {
            this.impactFX.judgment(this.worldX, this.midio.groundY, 'sour', particleMul);
            this.camera.shake(2.5);
          } else if (evt.tier) { // tier null = late-armed hold: the glow ramp is its own cue
            this.impactFX.judgment(this.worldX, this.midio.groundY, evt.tier, particleMul);
            this.comboSystem.sustain(evt.tMs); // a clean press keeps the combo warm through its airtime
            if (evt.tier === 'perfect') this.performer.goldFlash = 1;
          }
          break;
        case 'sour':
          this.impactFX.judgment(this.worldX, this.midio.groundY, 'sour', particleMul);
          this.camera.shake(2.5);
          break;
        case 'holdComplete':
          this.impactFX.splat(this.worldX, this.midio.groundY);
          this.impactFX.ignite(this.worldX, this.midio.groundY);
          break;
        case 'holdChoke':
          this.camera.shake(3);
          break;
        default:
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

  /** A player beat-tap (canvas click / almost-any-key), already stamped on
   *  whatever clock main.js wants the anchor to reason in (visualNow --
   *  "the clock the EAR is on"). Not a jump trigger: it only ever re-phases
   *  the ensemble/jump scheduler toward wherever the player felt the beat.
   *  The neutral splat is the only feedback -- no text overlay. */
  onBeatTap(tMs, role = null) {
    this.beatAnchor.tap(tMs);
    this.impactFX.splat(this.worldX, this.midio.groundY);
    // A real tapped-in pass means the grid is being steered by the player,
    // so stop measuring the stretch that would have prompted for one.
    if (this.beatAnchor.confidence >= 0.5) this.syncMonitor.onCalibrated();
    // ...and teach the fingerprint what this player was answering. The tap
    // carries a role (which hand) and lands at a moment with a spectral
    // signature; together those are what let the engine eventually tell a
    // kick from a hat the way THIS player hears it, rather than by the one
    // fixed band-share rule everybody currently shares.
    this.groove.observe({
      role,
      tMs,
      bands: this.energyCurves ? this.energyCurves.sampleAll(tMs) : null,
      energyNorm: this.energyCurves ? this.energyCurves.globalEnergyNorm(tMs) : 0,
      nearestOnsetMs: this._nearestKickMs(tMs),
    });
  }

  /** The detected onset closest to `tMs`, or null when the chart has none in
   *  reach. Feeds the fingerprint's timing offset: the gap between where the
   *  player tapped and where the song actually hit is this player's feel. */
  _nearestKickMs(tMs) {
    const kicks = this.jump._kickTimes;
    if (!kicks || !kicks.length) return null;
    // Binary search -- this runs per tap, but the list is every kick in the
    // song and a linear scan on a dense track is wasteful for no reason.
    let lo = 0, hi = kicks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (kicks[mid] < tMs) lo = mid + 1; else hi = mid;
    }
    let best = kicks[lo];
    if (lo > 0 && Math.abs(kicks[lo - 1] - tMs) < Math.abs(best - tMs)) best = kicks[lo - 1];
    return best;
  }

  /** Tear down every subscription this sim (and its owned subsystems) made
   *  on the shared conductor. Must run before the sim is discarded --
   *  conductor outlives every song, so a replay that skips this leaves the
   *  old sim's listeners firing forever, stacked on top of the new one's. */
  dispose() {
    for (const unsub of this._unsub) unsub();
    this._unsub.length = 0;
    this.broshi.dispose();
    this.biomes.dispose();
    this.fracture.dispose();
  }

  /** The Reel (Movement VI): live-toggle the reduced-flash accessibility
   *  setting, cascading to every consumer that caps its own flash alphas. */
  setReducedFlash(v) {
    this.reducedFlash = v;
    this.biomes.reducedFlash = v;
    this.fracture.reducedFlash = v;
  }

  /** Global graphics presentation: classic (SMW-flat) or rendered (DKC-CGI). */
  setVisualStyle(v) {
    this.visualStyle = v === 'classic' ? 'classic' : 'rendered';
    this.biomes?.setVisualStyle?.(this.visualStyle);
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
    this.cues.clearFrameFlags();

    this.conductor.dispatchUpTo(nowMs);
    // Conductor-track cues run alongside the timeline dispatch, before any
    // director updates this step, so a cue and the music it was written
    // against land on the same frame.
    this.cues.update(nowMs);
    this._applyCues(nowMs);
    this._driveAutoplay(nowMs);

    // The far skyline's swell at Midio's own column decides whether the
    // notes about to drain become leaps or footwork. Read off last frame's
    // biome state (biomes.update runs later in this step) -- a 16ms lag on a
    // ~9s swell is not a thing anyone can see.
    this.ridgeAnchor.update(this.biomes.farRidgeSwell01(this.midio.screenX), dtSec);
    this.midio.ridgeBob = this.ridgeAnchor.bobPx;

    // Drain autoplay presses stamped up to this step's time. Hold notes
    // still score as slides once grounded (performer hold pose), but the
    // opening press of a roll ALWAYS launches — otherwise dense bass rolls
    // plant Midio motionless for the whole hold span (often seconds).
    // Chart/player taps never silently vanish mid-hang: onPlayerTap force-
    // cuts the current arc if needed (see JumpController).
    while (this.inputQueue.length && this.inputQueue[0].tMs <= nowMs) {
      const ev = this.inputQueue.shift();
      if (ev.kind === 'down') {
        const res = this.judge.onTapDown(ev.tMs);
        // Accent anchoring: the takeoff itself stays chart-timed
        // (obstacles are placed against it), but its height rides his own
        // line -- a lead-lane note under a jump (or, pre-casting, a heavy
        // bass moment) makes that jump bigger, never smaller, so
        // clearance only ever improves.
        const accentAtTakeoff = this._takeoffAccent(ev.tMs);
        const rawVel = Math.min(1, (res.matchedVel ?? 0.7) * (1 + 0.3 * accentAtTakeoff));
        // Quantized to a few readable height tiers (see quantizeJumpVel):
        // duration is already beat-locked, this brings height up to the
        // same discipline instead of jittering with every note's raw
        // dynamics. Everything downstream that reads jump "intensity"
        // (lastLaunchVel, trick selection, modal excite) rides the same
        // tiered signal, so the performance layer reinforces the read
        // instead of adding its own independent noise on top.
        const vel = quantizeJumpVel(rawVel);
        const tapEvt = { tMs: ev.tMs, vel };
        // A tap before the character hits the ground is a double jump —
        // budgeted per 4-/8-measure phrase; if the budget is spent (or the
        // air jump declines), force-relaunch via onPlayerTap so the chart
        // beat is never swallowed.
        // Gated on the far range (RidgeAnchor.js): while that skyline has
        // sunk away, the note is still judged above -- perfect, combo
        // intact -- but he stays on the ground and performs it there
        // (MidioPerformer's grounded strut/stomp dip picks it up for free).
        // An arc already in the air is never cut short by the gate closing;
        // it lands on schedule as always.
        let performed = false;
        if (this.ridgeAnchor.open) {
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
      this.camera.shake(5);
      // A drop is the single best thing a disc spin can punctuate. Deferred
      // rather than cued here because ensemble.update() (which clears the
      // one-frame flag) hasn't run yet this step.
      this._pendingDiscReason = 'drop';
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
      this.camera.shake(3.5);
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
    // Keep the anchor's notion of "the song's own beat" tracking the live
    // chart tempo (JumpController's own kick EMA), so its ladder-snap
    // reasoning stays meaningful across any mid-song tempo drift.
    this.beatAnchor.setSongBeatMs(this.jump.beatPeriodMs, nowMs);
    this.beatAnchor.update(nowMs);
    this.syncMonitor.update(nowMs, {
      anchorConfidence: this.beatAnchor.confidence,
      suppress: this.recalibrating,
    });
    this.ensemble.update(nowMs, dtSec, this.vibe, this.jump.beatPeriodMs, this.beatAnchor, this.hype.buildUp);
    // A scene transition is a rare cue for the whole trio to share a brief
    // tumble accent (see EnsembleDirector.maybeTumble) -- one-frame lag
    // against biomes.update() below is inaudible/invisible at 16ms.
    if (this.biomes.sectionJustChanged) this.ensemble.maybeTumble(nowMs, this.biomes.lastTransitionStyle);
    // ...and the same transition is the trio's main reason to spin into a
    // disc. Song-relative intensity (VibeDirector.epic, now normalized
    // against this song's own dynamic range) decides how eager they are:
    // a quiet section change usually passes without a flourish.
    if (this.biomes.sectionJustChanged) this.ensemble.maybeDisc(nowMs, 'section', this.vibe.epic);
    if (this._pendingDiscReason) {
      this.ensemble.maybeDisc(nowMs, this._pendingDiscReason, this.vibe.epic);
      this._pendingDiscReason = null;
    }
    // Midio roams toward his ensemble anchor -- slow, never gameplay-fast.
    const dxA = this.ensemble.anchors[0].x - this.midio.screenX;
    this.midio.screenX += Math.max(-30 * dtSec, Math.min(30 * dtSec, dxA));
    this.jump.update(nowMs);
    this.midio.y = this.jump.y;

    this.groundField.update(nowMs, dtSec, this.worldX, this.energyCurves, this.calm.level);
    this.midio.groundY = this.groundField.heightAt(this.worldX);
    if (this.groundField.justRecovered) this.camera.shake(5.5);

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

    if (this.jump.pendingGhostKick) {
      // High-BPM halftime (JumpController.js, > HIGH_BPM_HALFTIME): every
      // second kick is deliberately withheld from launching a jump --
      // JumpPlanner.js calls it "routes to FX only" -- but nothing ever
      // consumed the flag it set, so half the kicks in a fast song produced
      // no visible response at all. A light ground splat, scaled by the
      // kick's own velocity, is the promised FX without a full landing.
      const gk = this.jump.pendingGhostKick;
      this.impactFX.splat(this.worldX, this.midio.groundY);
      this.performer.modal.excite(2 + 2 * gk.vel);
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
      this.impactFX.trigger(this.worldX, this.midio.groundY, I, this.camera, this.perf.particleMul);
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
        this.perf.particleMul,
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
      if (this.performer.milestoneFlash) {
        this.apotheosis.onMilestone();
        // A combo milestone is a genuine event worth a trio flourish --
        // unlike the plain clean landing this used to key off, which under
        // autoplay arrives on every kick.
        this.ensemble.maybeDisc(nowMs, 'milestone', this.vibe.epic);
      }
      if (this.apotheosis.active) this.impactFX.ignite(this.worldX, this.midio.groundY);
    }

    this.apotheosis.update(nowMs, dtSec, { vibe: this.vibe, hype: this.hype, calm: this.calm });
    if (this.apotheosis.justEnded) {
      this.performer.modal.excite(8);
      this.impactFX.splat(this.worldX, this.midio.groundY);
    }

    this.comboSystem.update(nowMs, this.jump.beatPeriodMs);

    const worldSpeed = WORLD_SPEED_PX_S * this.paramBus.live.scrollSpeed;
    this.worldX += worldSpeed * dtSec;

    this.obstacles.update(nowMs, this.worldX, worldSpeed / 1000);
    this.telegraph.update(nowMs, this.conductor, this.midio, this.jump, this.impactFX, this.worldX, this.midio.groundY, this.noteChart);
    this.performer.update(
      nowMs, dtSec, this.midio, this.jump, this.comboSystem, this.calm.level, this.ensemble, this.judge.holdState,
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
    const burrowWasActive = this.broshi.burrow.active;
    this.excursions.update(nowMs, dtSec, {
      vibe: this.vibe, calm: this.calm, hype: this.hype, energyCurves: this.energyCurves,
      conductor: this.conductor, midasus: this.midasus, broshi: this.broshi, worldX: this.worldX,
    });
    // He punches through the ground on the way down -- the screen itself
    // takes a small crack where he broke the surface, same glass-fracture
    // language FractureEngine already draws elsewhere (see also justSurfaced
    // below, the eruption's matching crack on the way back up).
    if (!burrowWasActive && this.broshi.burrow.active) {
      this.fracture.spawnSurfaceCrack(this.broshi.screenX, this.midio.groundY, this.camera);
    }

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
      // Soft spacing: last-frame Broshi position (good enough for gentle push).
      broshiX: this.broshi.renderX, broshiY: this.midio.groundY - this.broshi.hopY - 20,
      // Rare shared transition tumble (see EnsembleDirector.maybeTumble).
      tumbleRotX: this.ensemble.rotX(2), tumbleRotY: this.ensemble.rotY(2),
      // Shared build-up swell (EnsembleDirector.swell) -- see Broshi/Renderer for the other two.
      swell: this.ensemble.swell(2),
      // Her disc spin. Cued by EnsembleDirector.maybeDisc (section change /
      // drop / milestone, rate-limited), NOT by justClean -- under autoplay
      // every landing is clean, which is why she used to spin nonstop.
      discCue: this.ensemble.discCue,
    }, this.perf.particleMul, this.biomes.wind);
    // She's off on a voyage -> the ensemble's Kuramoto math should feel the
    // hole (this takes effect next frame; the weight eases over ~1.5s
    // regardless, so the one-step lag is inaudible/invisible).
    this.ensemble.setPresence(2, this.midasus.voyage.active ? 0 : 1);
    if (this.midasus.voyage.justLanded) { this.camera.shake(4); }
    if (this.midasus.voyage.justLaunched) { this.camera.shake(4); }
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
      this.camera.shake(5);
    }
    this.broshi.update(nowMs, dtSec, this.midio, this.energyCurves, this.worldX, this.midio.groundY, this.calm.level, {
      trailX: this.ensemble.anchors[1].x, phase: this.ensemble.phase(1), melt: 1.8 + 4 * this.vibe.epic,
      // A true companion watches his hero: airborne state + height for the
      // "watch him fly" head-tilt and takeoff crouch, the landing/clean
      // edges for the cheer + echo hop, world speed for the trot shimmy.
      midioAirborne: this.jump.airborne, midioY: this.midio.y,
      // justClean still drives his cheer/jaw/tail (cheap, and it reads as
      // companionship). Only the disc SPIN moved to the rate-limited cue.
      justLanded: !!this.jump.pendingLanding, justClean: this.comboSystem.justClean,
      discCue: this.ensemble.discCue,
      worldSpeed,
      // Soft spacing from Midasus when she dives into the floor band.
      midasusX: this.midasus.p.x,
      // He reacts to the sky, not just his hero: a shiver in snowfall, a
      // shake-off flick in rain -- the same music-reactive weather layer
      // BiomeManager/Traction already read, just also reaching Broshi.
      weatherKind: this.weather.kind, weatherIntensity: this.weather.intensity,
      // Rare shared transition tumble (see EnsembleDirector.maybeTumble).
      tumbleRotX: this.ensemble.rotX(1), tumbleRotY: this.ensemble.rotY(1),
      // Shared build-up swell (EnsembleDirector.swell) -- see Midasus/Renderer for the other two.
      swell: this.ensemble.swell(1),
    }, this.groundField, this.perf.particleMul);
    // The eruption's matching crack, on his way back up through the pane.
    if (this.broshi.burrow.justSurfaced) {
      this.fracture.spawnSurfaceCrack(this.broshi.screenX, this.midio.groundY, this.camera);
    }
    // He's underground -> same presence handoff as Midasus's voyage.
    this.ensemble.setPresence(1, this.broshi.burrow.active ? 0 : 1);
    // Enemy-wave combat: fixed defender join order (Midasus, Broshi, Midio)
    // matches BattleDirector.DEFENDER_ORDER.
    this.battle.update(nowMs, dtMs, [
      { x: this.midasus.p.x, y: this.midasus.p.y },
      { x: this.broshi.renderX, y: this.midio.groundY - this.broshi.hopY },
      { x: this.midio.screenX, y: this.midio.renderY },
    ], this.visualLagMs, this.reducedFlash, this.canvasWidth);
    this.opening.update(nowMs, dtSec, this.energyCurves);
    this.biomes.openingGain = this.opening.gain;
    this.biomes.hypeBoost = 1 + 0.6 * this.hype.surge + 1.1 * this.fever.level; // drops + player fever surge every phenomena system
    this.biomes.heatShimmer = this.hype.fast; // a hard hype spike shimmers the far range
    this.biomes.paletteRotation = this.keyDirector.paletteRotation; // the world transposes with the song's key
    // One Spectrum: the world keys to the same tonic the characters do --
    // but only once a tonic is actually DETECTED (confidence cleared the
    // margin), so the first beat of a song never snaps the palette to C.
    this.biomes.tonic = this.vibe.tonicConfidence >= 0.15 ? this.keyDirector.tonic : null;
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
    if (this.biomes.cutFlashJustFired) { this.camera.shake(3.5); }
    this.fracture.update(nowMs, dtSec, this.energyCurves, this.camera);
    this.assembly.update(nowMs);
    // Finale silence is owned by main.js (has AudioEngine) — flag only here.

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
    // Off-frame pull-back: only the UNINTENDED case counts, so a performer
    // mid-excursion (Midasus's voyage, Broshi's burrow) is left out here --
    // those are authored departures and chasing them with the camera would
    // fight the exit's own effect.
    const onFrameXs = [this.midio.screenX];
    if (!this.broshi.burrow.active) onFrameXs.push(this.broshi.screenX);
    if (!this.midasus.voyage.active) onFrameXs.push(this.midasus.p.x);
    this.camera.setZoomTarget(onFrameXs, this.stageW);
    // Beat sway input: ms since the most recent beat-grid crossing, from the
    // SAME anchor (live song tempo from the first beat, refined by any
    // player taps) everything else that locks to the beat already reads.
    const beatPeriodMs = Math.max(1, this.beatAnchor.periodMs);
    const beatTauMs = ((nowMs - this.beatAnchor.anchorMs) % beatPeriodMs + beatPeriodMs) % beatPeriodMs;
    const beatEnergy = Math.max(this.vibe.epic, this.hype.surge);
    this.camera.update(dtSec, this.calm.level, this.reducedFlash, beatTauMs, beatEnergy);
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
