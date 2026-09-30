// World-owned heard-time simulation. No listening performer owns transport or stage coordinates.
import { Role } from '../core/NoteEvent.js';
import { MAX_LATENCY_MS, visualNow } from '../core/ChoreoClock.js';
import { CameraDirector, ZOOM_MIN } from '../render/CameraDirector.js';
import { CalmDirector } from './CalmDirector.js';
import { HypeDirector } from './HypeDirector.js';
import { CutDirector } from './CutDirector.js';
import { VibeDirector } from './VibeDirector.js';
import { epicBiasForKind } from '../lyrics/SectionFusion.js';
import { BeatAnchor } from './BeatAnchor.js';
import { SongBeatTransport } from './SongBeatTransport.js';
import { KeyDirector } from './KeyDirector.js';
import { CodaDirector } from './CodaDirector.js';
import { FilmFinish } from '../render/FilmFinish.js';
import { BiomeManager } from '../world/BiomeManager.js';
import { alpineTerrainProfiles } from '../world/terrain/loadTerrain.js';
import { getWorld } from '../world/Worlds.js';
import { FractureEngine } from '../world/FractureEngine.js';
import { GroundField } from '../world/GroundField.js';
import { PerfGovernor } from '../render/PerfGovernor.js';
import { HighlightReel } from '../render/HighlightReel.js';
import { hashSeed } from '../utils/math.js';
import { resolveSongSeed } from '../utils/seed.js';
import { LatencyCalibrator } from './LatencyCalibrator.js';
import { SyncMonitor } from './SyncMonitor.js';
import { GrooveFingerprint } from './GrooveFingerprint.js';
import { WeatherDirector } from './WeatherDirector.js';
import { OrogenyDirector } from '../world/OrogenyDirector.js';
import { QuakeDirector } from './QuakeDirector.js';
import { FireDirector } from './FireDirector.js';
import { DisasterDirector } from './DisasterDirector.js';
import { FloodDirector } from './FloodDirector.js';
import { CueDirector } from './CueDirector.js';
import { CueKind } from '../core/ConductorTrack.js';
import { compileRangeSources } from '../world/alpine/RangeNarrative.js';
import { ParallelUniverseDirector } from './ParallelUniverseDirector.js';
import { Lane, laneCounts } from '../core/Casting.js';
import { resolveLandscapePresentation } from '../world/LandscapePresentation.js';

const WORLD_SPEED_PX_S = 220;

export class Simulation {
  constructor(conductor, paramBus, {
    bpm = 120, energyCurves = null, canvasWidth = 1280, canvasHeight = 720,
    customBiome = null, inputOffsetMs = 0, outputLatencyMs = null, visualLeadMs = 0, lyricSections = null, syncedLyrics = null, structure = null, tonalityTimeline = null,
    groove = null,
    songSeed: pinnedSeed = null,
    conductorCues = null,
    worldId = null,
    terrainProfiles = null,
    songTerrain = null,
    residency = null,
    chapterState = null,
  } = {}) {
    this.conductor = conductor;
    this.paramBus = paramBus;
    this.energyCurves = energyCurves;
    this.customBiome = customBiome || null;
    this.worldId = worldId || 'alpine';
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
    // Display presentation lead; seek preserves the audible destination.
    this.visualLeadMs = Math.max(0, visualLeadMs || 0);

    this.presentation = resolveLandscapePresentation({ worldId: this.worldId, stageWidth: canvasWidth, stageHeight: canvasHeight });
    this.stageAnchor = this.presentation.stageAnchor;
    this.kickTimes = conductor.timeline.filter(e => e.role === Role.RHYTHM && e.kick).map(e => e.tMs);
    const lanes = laneCounts(conductor.timeline);
    this.casting = { midio: lanes[Lane.MIDIO] ? 'lead-lane' : 'bass',
      broshi: lanes[Lane.BROSHI] ? 'bass-lane' : 'melody',
      midasus: lanes[Lane.MIDASUS] ? 'clean-lane' : 'melody', counts: lanes };
    // The old option/URL is accepted but cannot restore the reveal or actors.
    this.rangeListening = false;
    this.beatAnchor = new BeatAnchor(60000 / bpm);
    this.songBeat = new SongBeatTransport({ ...conductor.beatMetadata, bpm: conductor.beatMetadata?.bpm ?? bpm });
    this.beatAnchor.anchorMs = this.songBeat.originMs;
    this.groove = groove || new GrooveFingerprint();
    this.recalibrating = false;
    this.latency = new LatencyCalibrator(inputOffsetMs);
    this.syncMonitor = new SyncMonitor();
    this.camera = new CameraDirector();
    this.perf = new PerfGovernor();
    const songSeed = resolveSongSeed(conductor, pinnedSeed);
    this.songSeed = songSeed;
    this.calm = new CalmDirector();
    this.hype = new HypeDirector();
    this.cut = new CutDirector();
    this.weather = new WeatherDirector();
    this.cues = new CueDirector(conductorCues ? conductorCues.liveCues : []);
    this.filmFinish = new FilmFinish();
    this.vibe = new VibeDirector(conductor.timeline, tonalityTimeline);
    this.keyDirector = new KeyDirector();
    this.coda = new CodaDirector(conductor.durationMs || 0);
    this.groundField = new GroundField(this.stageAnchor.groundY, { conductor, durationMs: conductor.durationMs, songSeed });
    this.fire = new FireDirector();
    this.flood = new FloodDirector();
    this.biomes = new BiomeManager({
      conductor, energyCurves, durationMs: conductor.durationMs,
      canvasWidth, canvasHeight, groundY: this.stageAnchor.groundY, songSeed,
      groundField: this.groundField,
      fire: this.fire,
      flood: this.flood,
      customBiome: this.customBiome,
      lyricSections,
      syncedLyrics,
      structure,
      chapterState,
      conductorSchedule: conductorCues ? conductorCues.scheduleCues : null,
      worldId: this.worldId,
      // Keyed on the world's KIND, not its id. A world chosen in the picker or
      // on the title screen is a tailored variant whose id is 'custom', so the
      // old `worldId === 'alpine'` test was false in normal play: the real
      // Teton skyline only ever appeared in the demo and fallback paths.
      // The range itself is the song's match from the basket (RangeLibrary),
      // with the bundled Tetons as the fallback.
      terrainProfiles: getWorld(this.worldId)?.kind === 'alpine'
        ? (terrainProfiles || alpineTerrainProfiles()) : null,
      // The song's biomes and each one's own ranges (prepareSongTerrain).
      songTerrain: getWorld(this.worldId)?.kind === 'alpine' ? songTerrain : null,
      // The page's graphics ledger (GraphicsResidency); null in tests.
      residency,
    });
    this.worldSources = compileRangeSources({ timeline: conductor.timeline, casting: this.casting });
    this.biomes.worldSources = this.worldSources;
    this.reducedFlash = false;
    this.visualStyle = 'rendered';
    this.biomes.reducedFlash = this.reducedFlash;
    this.biomes.setVisualStyle(this.visualStyle);
    this.parallelUniverse = new ParallelUniverseDirector();
    this.highlightReel = new HighlightReel();
    this.fracture = new FractureEngine(conductor, {
      canvasWidth, canvasHeight, songSeed, durationMs: conductor.durationMs,
      energyCurves,
    });
    // Orogeny: the mountains visibly build across the song, peaking at its
    // energy climax, then subside through the rest of the runtime.
    this.orogeny = new OrogenyDirector(energyCurves, conductor.durationMs || 0, conductor.barGrid);

    // Disasters: large-scale hazard events, arbitrated by DisasterDirector
    // and anchored to the song's own energy climax (the same one orogeny
    // just found) so a quake lands where the song is actually loudest
    // rather than on a wall-clock timer.
    this.quake = new QuakeDirector(songSeed);
    this.groundField.quake = this.quake; // render-only shake, read in visibleBars()
    this.disasters = new DisasterDirector(songSeed, conductor.durationMs || 0, [this.orogeny.climaxMs]);
    this._pendingQuakeTsunamiAtMs = -Infinity; // the linked event -- see the disasters.justStruck block in step()

    this.worldX = 0;
    this.timeMs = 0;

    // The user's cursor, in stage coordinates, fed by main.js. The baby
    // stars are aware of it (they're aware of the user); nothing else reads
    // it, and it never moves the camera. Inactive until the first move and
    // after a couple of idle seconds.
    this.pointer = { x: canvasWidth / 2, y: canvasHeight / 2, active: false, lastMoveMs: -Infinity };

    this.prev = this._snapshot();
    this.curr = this._snapshot();

    this._unsub = [conductor.on(Role.RHYTHM, evt => {
      if (!evt.kick) return;
      this.hype.onKick(evt.vel);
      if (!this.songBeat.freeTime) this.syncMonitor.onKick(evt.tMs, this.songBeat.snapshotAt(evt.tMs).periodMs, this.beatAnchor.anchorMs);
      this.groundField.kickGlow(this.worldX, evt.tMs, evt.vel);
    })];
    this.snowCover = 0;
  }

  _applyCues(nowMs) {
    for (const cue of this.cues.fired) {
      const strength = typeof cue.value === 'number' ? cue.value : 1;
      switch (cue.kind) {
        case CueKind.DROP:
          this.hype.cueDrop(nowMs, strength);
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
          break;
        default:
          break;
      }
    }
  }

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
    const kicks = this.kickTimes;
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

  startAt(nowMs) {
    this.conductor.seekTo(Math.max(0, nowMs - this.visualLeadMs), { primeAhead: true });
    this.cues.seekTo(nowMs);
    this.disasters.seekTo(nowMs);
    this.biomes._lastSectionIdx = null;
    const energy = this.energyCurves?.globalEnergyNorm(nowMs) ?? 0;
    this.hype.fast = energy; this.hype.slow = energy;
    this.step(0, nowMs);
    this.prev = this._snapshot(); this.curr = this._snapshot();
  }

  dispose() {
    for (const unsub of this._unsub) unsub();
    this._unsub.length = 0;
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

  setReducedMotion(v) {
    this.reducedMotion = !!v;
    this.biomes.reducedMotion = !!v;
  }

  syncSongBeat(nowMs) {
    const state = this.songBeat.snapshotAt(nowMs);
    this.beatAnchor.setSongBeatMs(state.periodMs, nowMs);
    if (!this.beatAnchor._history.length) this.beatAnchor.anchorMs = state.anchorMs;
    this.beatAnchor.update(nowMs);
    this.biomes.beatTransport = state;
    this.biomes._beatMs = state.periodMs;
    // Source confidence owns the musical grid even before the viewer taps.
    // Keep tap confidence separate for calibration and landing mechanics.
    this.presentationBeatAnchor = {
      periodMs: this.beatAnchor.periodMs, anchorMs: this.beatAnchor.anchorMs,
      confidence: state.freeTime ? 0 : Math.max(state.confidence, this.beatAnchor.confidence),
      phaseRad: timeMs => this.beatAnchor.phaseRad(timeMs),
    };
    return state;
  }

  rangeNarrativeAt() { return null; }
  sampleWorldSources(timeMs = this.heardTimeMs ?? this.timeMs ?? 0) { return this.worldSources.sample(timeMs); }
  setVisualStyle(v) {
    this.visualStyle = v === 'classic' ? 'classic' : 'rendered';
    this.biomes?.setVisualStyle?.(this.visualStyle);
  }

  step(dtMs, nowMs) {
    this.prev = this.curr;
    this.timeMs = nowMs;
    const dtSec = dtMs / 1000;
    this.visualLagMs = this._outputLatencyFn ? Math.min(MAX_LATENCY_MS, Math.max(0, this._outputLatencyFn() || 0)) : 0;
    this.heardTimeMs = visualNow(nowMs, this.visualLagMs);
    this.biomes.visualLagMs = this.visualLagMs;
    this.syncSongBeat(this.heardTimeMs);
    this.cues.clearFrameFlags();
    this.conductor.dispatchUpTo(nowMs);
    this.cues.update(nowMs);
    this._applyCues(nowMs);
    this.calm.update(nowMs, dtSec, this.energyCurves);
    this.hype.update(nowMs, dtSec, this.energyCurves);
    // Lyric structure's epic bias (SectionFusion): zero, and thus a strict
    // no-op, whenever there's no lyric data (biomes.currentKind stays
    // null). One-frame lag against biomes.update() (which runs later this
    // same step) is inaudible against a signal already eased over ~1.5s.
    // kindConfidenceEased gates the kind-based bonus so an uncertain label
    // (position-only bridge, low-confidence lyric alignment) cannot force
    // the same escalation as a confidently identified one.
    this.vibe.epicBias = epicBiasForKind(
      this.biomes.currentKind, this.biomes.lyricIntensityEased, this.biomes.kindConfidenceEased,
    );
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
    // Disasters: the arbiter decides WHEN/IF a hazard starts (reading the
    // still-live directors for exclusivity, and live weather for fire's
    // dryness precondition), then each hazard's own director owns its
    // actual envelope. Order matters: the arbiter may call strike() this
    // same frame, so each director's own update() runs right after and
    // picks up age=0 immediately rather than one frame late.
    this.disasters.update(nowMs, this.worldX, {
      quake: this.quake, fire: this.fire, weather: this.weather,
      windAngle: this.biomes.atmosphere ? this.biomes.atmosphere.prevailingAngle() : 0,
    });
    this.quake.update(nowMs, dtSec, this.camera);
    this.fire.update(nowMs, dtSec);
    // A wildfire forces the music-reactive weather layer to embers for its
    // whole life -- reuses the existing particle kind/crossfade machinery
    // rather than a parallel fire-particle system. One-shot on the frame
    // the arbiter actually strikes it, matching cueKind's own one-cue-per-
    // call contract.
    if (this.disasters.justStruck && this.disasters.struckKind === 'fire') {
      this.weather.cueKind(nowMs, 'embers');
    }
    // The linked event: a quake at sea kicks up a real wave. Armed once,
    // 20-40s after the strike (deterministic per-song jitter, not
    // wall-clock random) -- BiomeManager.armTsunami() just pushes a real
    // entry onto the same schedule every other tsunami wall goes through,
    // so withdrawal telegraph/approach/run-up/flood all fire exactly as
    // they would for any other wall.
    if (this.disasters.justStruck && this.disasters.struckKind === 'quake') {
      const delayMs = 20000 + (hashSeed(`${this.songSeed}:seaQuakeTsunami:${nowMs}`) % 20000);
      this._pendingQuakeTsunamiAtMs = nowMs + delayMs;
    }
    if (Number.isFinite(this._pendingQuakeTsunamiAtMs) && nowMs >= this._pendingQuakeTsunamiAtMs) {
      if (this.biomes.acceptsOceanHazard()) {
        this.biomes.armTsunami(nowMs, this.quake.epicenterWorldX >= this.worldX ? 1 : -1);
      }
      this._pendingQuakeTsunamiAtMs = -Infinity;
    }
    const biomeSnow = this.biomes.currentParticleKind?.() === 'snow' ? .8 : 0;
    this.snowCover = Math.max(this.weather.groundCover, biomeSnow, this.biomes.floodFooting01());
    this.biomes.snowCover = this.snowCover;
    // Kick-grid agreement remains diagnostic. An accent pattern cannot
    // retune the source transport's phase or period.
    this.syncMonitor.update(nowMs, {
      beatPeriodMs: this.beatAnchor.periodMs,
      anchorConfidence: this.beatAnchor.confidence,
      suppress: this.recalibrating || this.songBeat.freeTime || this.songBeat.confidence < .2,
    });
    this.syncMonitor.consumeCorrection();
    if (this.biomes.sectionJustChanged) this.parallelUniverse.shift(`${this.songSeed}:${this.biomes._lastSectionIdx}`);
    this.parallelUniverse.update(dtSec);
    this.worldX += WORLD_SPEED_PX_S * this.paramBus.live.scrollSpeed * dtSec;
    this.groundField.update(nowMs, dtSec, this.worldX, this.energyCurves, this.calm.level, this.heardTimeMs);
    this.biomes.openingGain = 1;
    this.biomes.focusMul = 1;
    this.biomes.stillnessMul = this.cut.stillnessMul(nowMs);
    this.biomes.hypeBoost = 1 + .6 * this.hype.surge;
    this.biomes.heatShimmer = this.hype.fast;
    this.biomes.paletteRotation = this.keyDirector.paletteRotation;
    this.biomes.tonic = this.vibe.tonicConfidence >= .15 ? this.keyDirector.tonic : null;
    this.biomes.dropAtMs = this.hype.dropAtMs;
    this.biomes.unravel = this.coda.unravel;
    this.biomes.particleMul = this.perf.particleMul;
    this.biomes.fever = 0;
    this.biomes.midioX = this.stageAnchor.originX; // deprecated world-origin alias
    this.biomes.midioY = this.stageAnchor.groundY;
    this.biomes.weatherState = this.weather.state; // music-reactive rain/snow/petals/embers, decoupled from biome
    this.biomes.dustLevel01 = this.quake.dustLevel01; // the air stays hazy for a while after a quake settles
    this.biomes.smokeLevel01 = this.fire.smokeLevel01; // the sky stays smoke-reddened for a while after a fire dies down
    // Parallel-universe drift (ParallelUniverseDirector): a per-section,
    // cosmetics-only variation on top of everything above.
    this.biomes.universeHueDeg = this.parallelUniverse.hueDeg;
    this.biomes.universeHazeMul = this.parallelUniverse.hazeMul;
    this.biomes.universeWindMul = this.parallelUniverse.windMul;
    this.biomes.universeTerrainMul = this.parallelUniverse.terrainMul;
    // As the camera pulls back, the layers lean as if the vantage point
    // itself is rising past them (BiomeManager scales this per layer by
    // depth) -- read after camera.update() runs later this step, one frame
    // behind like every other biomes.* field set here, same as the
    // camera-driven fields above.
    this.biomes.floatTilt = this.camera.floatTilt;
    // Same one-frame-behind read as floatTilt above, normalized so 0 is
    // normal framing and 1 is the hardest pull-back (ZOOM_MIN) -- lets the
    // nearer ridges grow to close the flat gap on a wide shot.
    this.biomes.pullback01 = (1 - this.camera.zoom) / (1 - ZOOM_MIN);
    // Perf has to land before the world steps. Cathode never calls
    // biomes.draw(), which used to be the only assignment of this policy,
    // so optional simulators kept running on its cheap path.
    this.biomes.adoptPerf(this.perf);
    this.biomes.update(nowMs, dtSec, this.energyCurves, this.calm.level, this.worldX);
    this.biomes.pumpStripPrewarm();
    // Flood: runs right after biomes.update() so a tsunami-overtop arm
    // called from inside that update (BiomeManager already owns tsunami
    // scheduling) lands in this same frame's envelope, not one frame late
    // -- same ordering discipline as disasters.update() -> quake.update().
    this.flood.update(nowMs, dtSec, { rainAccum01: this.weather.rainAccum01 });
    this.filmFinish.update(nowMs, dtSec, this.calm.level, this.biomes.budget, this.hype);
    if (this.biomes.cutFlashJustFired) { this.camera.shake(3.5); }
    this.fracture.update(nowMs, dtSec, this.energyCurves, this.camera);
    // Authored world cuts: the drop gets camera+color snaps here; called after filmFinish.update() above so a hit() this
    // frame isn't immediately overwritten by that same update() call. The
    // finale reuses fracture's own trigger rather than duplicating timing --
    // FractureEngine's freeze/shatter/silence is already an authored cut.
    this.cut.update(this, dtSec, nowMs);
    if (this.fracture.justEnteredFinale) { this.filmFinish.hit('finale'); }
    // Disaster cuts: a quake strike and a tsunami wall's arrival get the
    // same authored camera+color snap the drop/finale already
    // do -- same "called after filmFinish.update() above" ordering as
    // those, so the hit() isn't immediately overwritten this same frame.
    if (this.disasters.justStruck && this.disasters.struckKind === 'quake') this.filmFinish.hit('quake');
    if (this.biomes.tsunamiJustArrived && this.biomes.acceptsOceanHazard()) {
      this.filmFinish.hit('tsunami');
      this.camera.shake(4);
    }
    this.orogeny.update(nowMs);
    this.biomes.orogenyGrowth = this.orogeny.growth;
    const beatPeriodMs = Math.max(1, this.beatAnchor.periodMs);
    const beatTauMs = ((this.heardTimeMs - this.beatAnchor.anchorMs) % beatPeriodMs + beatPeriodMs) % beatPeriodMs;
    const beatEnergy = this.songBeat.freeTime ? 0 : Math.max(this.vibe.epic, this.hype.surge);
    this.camera.update(dtSec, this.calm.level, this.reducedFlash || this.reducedMotion, beatTauMs, beatEnergy, this.parallelUniverse.pulse);
    this.paramBus.step();
    this.curr = this._snapshot();
  }
  _snapshot() { return { worldX: this.worldX }; }
  lerpState(alpha) {
    const worldX = this.prev.worldX + (this.curr.worldX - this.prev.worldX) * alpha;
    const { originX, groundY } = this.stageAnchor;
    // Deprecated pose aliases remain plain coordinates for old world painters.
    return { worldX, originX, groundY, midioX: originX, midioDrawX: originX,
      midioY: groundY, scaleX: 1, scaleY: 1, leanDeg: 0, airborne: false };
  }
}
