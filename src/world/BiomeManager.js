// Orchestrates the 8-layer parallax contract (spec §4.1.1), biome
// scheduling via novelty-curve segmentation (§4.1.3), and gamma-correct
// profile crossfading (§4.1.4). Each biome is pure data (BiomeProfiles.js);
// this file is the one place that knows how to render the contract.
import { BIOMES } from './BiomeProfiles.js';
import { generateSilhouette, drawTiledStrip } from './SilhouetteGenerator.js';
import { ParticleField } from './ParticleField.js';
import { Mandala } from './Mandala.js';
import { CymaticField } from './CymaticField.js';
import { KuramotoSwarm } from './KuramotoSwarm.js';
import { ChaosRibbon } from './ChaosRibbon.js';
import { ReactionDiffusion } from './ReactionDiffusion.js';
import { decorateStrip } from './Landmarks.js';
import { DANCE_LAYERS, DANCE_COL_W, danceOffset, kickEnv, spectrumBars, orogenyHeightMul } from './MountainChoreo.js';
import { ridgeYSmooth, danceOffsetSmooth, assignBandFeatures, geoCrestOffset } from './GeoCrest.js';
import { seaLineY, shimmerBands, shimmerOffsetX } from './Ocean.js';
import { ConstellationWeaver } from './ConstellationWeaver.js';
import { SpaceRidge } from './SpaceRidge.js';
import { SkyEnsemble } from './SkyEnsemble.js';
import { FarVignettes } from './FarVignettes.js';
import { RidgeRunners } from './RidgeRunners.js';
import { castBiomes, classifyTransition, intensityBudget, dayArc } from './Dramaturgy.js';
import { analyzeSongForm } from './SongForm.js';
import { LightningFX } from './Lightning.js';
import { MeteorShowerFX } from './MeteorShower.js';
import { LightRig } from './LightRig.js';
import { hazeAlpha, hazeWarmMix, HAZE_WARM_COLOR, HAZE_EPS } from './DepthHaze.js';
import { PERSONALITY } from './BiomePersonality.js';
import { Murmuration } from './Murmuration.js';
import { Atmosphere } from './Atmosphere.js';
import { CodaDirector } from '../sim/CodaDirector.js';
import { capFlashAlpha } from '../ui/Accessibility.js';
import { superformula, ModalRing } from '../render/oscillators.js';
import { clamp01, smoothstep, mulberry32, hashSeed } from '../utils/math.js';
import { LerpCache, rotateHueHex, hexToRgb, rgbToHsl } from '../utils/color.js';
import { Role } from '../core/NoteEvent.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';

const LAYER_RATIOS = { L1: 0.05, L2: 0.10, L3: 0.18, L4: 0.30, L5: 0.65, L6: 1.00, L7: 1.20 };
const LAYER_EQ_RATIO = 0.06; // between L1 (celestial) and L2 (far mountains)
const WORLD_SPEED_PX_S = 220;
const BAND_COUNT = 7;
const EQ_ATTACK_SEC = 0.08;
const EQ_RELEASE_SEC = 0.6;
const EQ_MAX_HEIGHT_FRAC = 0.4; // never exceed 40% of screen height, however excited the section is
const MILESTONE_METEOR_BASE = [5, 8, 14];
const DROP_METEOR_BASE = 12;
const ACHROMATIC_SAT_THRESHOLD = 0.08;
// Song-form recognition: how far a structural label's signature hue-shift
// can swing (degrees). Bounded so a section reads as "the chorus color"
// without leaving the biome's own palette behind. Layered on top of
// KeyDirector's key-driven rotation via _rotated.
const FORM_HUE_BIAS_MAX = 40;
const FORM_HUE_TAU_SEC = 1.5; // section changes glide their hue, never snap

export class BiomeManager {
  constructor({ conductor, energyCurves, durationMs, canvasWidth, canvasHeight, groundY, songSeed, groundField = null, customBiome = null }) {
    this.conductor = conductor;
    this.energyCurves = energyCurves;
    this.durationMs = durationMs || 0;
    this.w = canvasWidth;
    this.h = canvasHeight;
    this.groundY = groundY;
    this.groundField = groundField;
    this.customBiome = customBiome || null;
    // Instance profile list: stock BIOMES plus an optional MIDI-derived profile.
    this.profiles = customBiome ? [...BIOMES, customBiome] : BIOMES.slice();
    this._lastSectionIdx = null;
    this._cutFlash = 0;
    this._shutterStartMs = -Infinity;
    this._shutterBarMs = 500;
    this.cutFlashJustFired = false;
    this.budget = 1;
    this.hypeBoost = 1; // drop-surge multiplier from the HypeDirector
    this.mandalaScaleMul = 1; // swells while Midasus dances near the celestial
    this._progress = 0;
    this.lerpCache = new LerpCache();
    this.tSec = 0;
    this._starSeed = mulberry32(9001);
    this.stars = Array.from({ length: 40 }, () => ({
      x: this._starSeed() * this.w, y: this._starSeed() * this.h * 0.6, phase: this._starSeed() * Math.PI * 2,
    }));
    this._glitchTimer = 2 + this._starSeed() * 3;
    this._glitchActiveMs = 0;
    this._scanlineY = 0;
    this._pylonFlash = 0;
    this._eqSmoothed = new Float32Array(BAND_COUNT);
    // The geological equalizer: L4's crest reads the same 7 bands as the
    // horizon EQ and the massif, but through per-song, per-band geological
    // features (cliff/arete/knob/outcrop/terrace) pinned to fixed terrain
    // positions -- a distinct silhouette vocabulary, "relevant" to the same
    // music without repeating either sibling equalizer's look.
    this._geoFeatures = assignBandFeatures(hashSeed(`${songSeed}:geocrest`));
    // Far ocean: a sea line + shimmer rows behind the furthest ridgeline,
    // in front of the sky. Seeded per song, same shimmerBands/seaLineY math
    // the horizon EQ's siblings use as templates for band-driven motion.
    this._oceanBands = shimmerBands(hashSeed(`${songSeed}:ocean`));

    // The mountains dance: a groove level (smoothed global energy) drives a
    // traveling ridge wave through every range, and each kick sends a
    // bounce rolling from the near hills out to the far peaks.
    this._danceGroove = 0;
    this._danceKickMs = -Infinity;
    this._danceKickAmp = 0;
    this.fever = 0; // player fever (Simulation.fever.level): cranks the dance and the runners
    this.orogenyGrowth = 0.1; // mountain-building arc (Simulation.orogeny.growth), set externally each step
    // The Lens's world-adaptation return: +1 while easing back from a
    // zoom-IN, -1 while easing back from a zoom-OUT, 0 when idle (see
    // Simulation.step -- zoom.adaptEnv * zoom.adaptDir).
    this.adaptSwell = 0;
    // Miniature characters running along the near ranges' ridges — an
    // independent trio per range so the depths don't mirror each other.
    this.ridgeRunners = {
      L4: new RidgeRunners(hashSeed(`${songSeed}:runners:L4`)),
      L5: new RidgeRunners(hashSeed(`${songSeed}:runners:L5`)),
    };

    this.strips = new Map(); // biomeName -> { L2, L3, L4, L5 }
    for (const b of this.profiles) {
      const seed = hashSeed(b.name);
      const strips = {
        L2: generateSilhouette({ seed: seed + 1, octaves: 1, amplitude: 0.20, baseline: 0.45, color: b.silhouette }),
        L3: generateSilhouette({ seed: seed + 2, octaves: 2, amplitude: 0.26, baseline: 0.55, color: b.silhouette }),
        // No baked edgeLight here: the old baked stroke tore at every
        // dance-column seam (_drawDancingStrip blits in DANCE_COL_W slices,
        // each at its own bounce height). _drawCrest below strokes the same
        // neon line LIVE, continuous across every seam, and turns L4's into
        // the geological equalizer (GeoCrest.js).
        L4: generateSilhouette({ seed: seed + 3, octaves: 3, amplitude: 0.34, baseline: 0.70, color: b.silhouette }),
        L5: generateSilhouette({ seed: seed + 4, octaves: 2, amplitude: 0.22, baseline: 0.85, color: b.silhouette }),
      };
      // Landmarks: per-song placements (songSeed), baked into the strips,
      // each rooted on the noise ridge at its own x. Unknown biome names
      // (custom MIDI profiles) no-op inside decorateStrip — safe.
      decorateStrip(strips.L4, b.name, hashSeed(`${songSeed}:${b.name}:L4`), b.silhouette, { count: 3, scale: 1 });
      decorateStrip(strips.L5, b.name, hashSeed(`${songSeed}:${b.name}:L5`), b.silhouette, { count: 2, scale: 1.9 });
      this.strips.set(b.name, strips);
    }

    this.fields = new Map(); // biomeName -> ParticleField
    for (const b of this.profiles) this.fields.set(b.name, new ParticleField(b.particles, canvasWidth, canvasHeight, hashSeed(b.name + 'p')));

    // Music-reactive weather (decoupled from biome): one field per kind,
    // built once and reused regardless of which biome is active -- unlike
    // `fields` above (each biome's own signature), only WeatherDirector's
    // current kind is ever drawn, and only above its DORMANT_GATE.
    this.weatherState = { kind: 'snow', intensity: 0 }; // set externally each frame from Simulation.weather.state
    this.weatherFields = new Map();
    for (const [kind, count, color, speed] of [
      ['rain', 90, '#9fb8d8', 0],
      ['snow', 70, '#ffffff', 45],
      ['petals', 45, '#ffb6d3', 35],
      ['embers', 55, '#ff7a3c', 60],
    ]) {
      this.weatherFields.set(kind, new ParticleField({ kind, color, count, speed }, canvasWidth, canvasHeight, hashSeed(`weather:${kind}`)));
    }
    this._weatherSuppress = 1; // eased 0..1: 0 while the active biome already has this exact particle kind
    this._activeWeatherIntensity = 0; // weatherState.intensity * suppress, computed in update(), read by draw()
    this.snowCover = 0; // settled snow 0..1, set externally each frame from Simulation.snowCover -- drives the frost caps

    // Planets + astral artifacts: seeded per song/biome, drawn behind the
    // celestial so the sun/moon and ranges occlude them naturally.
    this.skyEnsemble = new SkyEnsemble(songSeed, durationMs);
    // Far-distance vignettes: rare seeded scenes (aliens at dinner, a cloud
    // whale...) witnessed way out between the L2 and L3 ranges.
    this.farVignettes = new FarVignettes(songSeed);

    this._buildSchedule(conductor.barGrid, energyCurves, durationMs, songSeed);
    // MIDI custom biome: cast every section into the generated world so the
    // dropped file IS the place, while stock demos keep dramaturgical casting.
    if (this.customBiome) this.loadCustom(this.customBiome);
    this.mandala = new Mandala(songSeed);
    this.cymatics = new CymaticField(songSeed);
    this.swarm = new KuramotoSwarm(songSeed);
    this.ribbon = new ChaosRibbon(songSeed);
    this.rd = new ReactionDiffusion(songSeed);
    this.lightning = new LightningFX(songSeed);
    this.meteors = new MeteorShowerFX(songSeed);
    // Ambient connect-the-dots: ordinary melody notes weave constellations
    // all song long (unlike Midasus's rare, capped SkyVoyage).
    this.weaver = new ConstellationWeaver(hashSeed(`${songSeed}:weaver`), canvasWidth, canvasHeight);
    // The third equalizer: crystalline node-line + one tumbling wireframe,
    // floating higher and further than everything else in the sky.
    this.spaceRidge = new SpaceRidge(hashSeed(`${songSeed}:spaceridge`));
    this.lightRig = new LightRig(songSeed);
    // Concert beams anchor toward Midio on a drop; sane defaults so a
    // trigger before the first Simulation-set value still points somewhere
    // reasonable rather than at (0,0).
    this.midioX = this.w * 0.5;
    this.midioY = this.groundY;
    // Reward bursts: milestone/drop counts scale with perf headroom
    // (defaults to 1 so BiomeManager works standalone in tests with no
    // wired Simulation/PerfGovernor) and the song's intensity budget.
    this.particleMul = 1;
    this.milestoneAtMs = -Infinity;
    this._lastSeenMilestoneMs = -Infinity;
    this.milestoneIdx = -1;
    this.murmuration = new Murmuration(canvasWidth, canvasHeight, songSeed);
    this._beatMs = 500; // EMA'd kick interval, feeding the swarm's natural frequency
    this._lastKickMs = null;

    // The Wind (Movement II): one global weather field instead of every
    // particle system drifting in its own private noise.
    this.atmosphere = new Atmosphere(songSeed);
    this.wind = { x: 0, y: 0 };
    this.heatShimmer = 0; // set externally from HypeDirector.fast each frame
    this._shedPetals = [];
    const fogSeed = mulberry32(songSeed ^ 0x0f06);
    this._fogBanks = [0, 1, 2].map(() => ({ x: fogSeed() * canvasWidth * 1.6 }));

    // The Key of the World (Movement III): the harmony-driven palette
    // rotation, set externally each frame from KeyDirector.paletteRotation
    // (same pattern as hypeBoost/heatShimmer above). Quantized to 3deg
    // steps before rotating so the LerpCache-style cache below stays hot.
    this.paletteRotation = 0;
    this._rotationCache = new Map();
    // Song-form recognition (SongForm): the active section's structural
    // signature hue, eased so a section change glides the whole palette by
    // its label's bias -- the chorus always the same shift, the verse
    // always another, recurring identically. Composed on top of
    // paletteRotation in _rotated; works in ANY biome (the payoff on the
    // single-biome dropped-song path, where every section is one profile).
    this.sectionHueBias = 0;

    // The Mirror (Movement IV): a shared 1-D ring for the lake's ripples --
    // gentle mode reuse of the same ModalRing driving Midio's body vibration
    // elsewhere, just tuned slower/softer for water instead of a body strike.
    this.lakeRing = new ModalRing({ modes: 3, baseHz: 1.1, decaySec: 1.4, seed: hashSeed('lake' + songSeed) });
    this.dropAtMs = -Infinity; // set externally from HypeDirector.dropAtMs each frame
    this._lastSeenDropAtMs = -Infinity;

    // The Unraveling (Movement V): set externally from CodaDirector.unravel
    // each frame.
    this.unravel = 0;

    // The Reel (Movement VI): set externally, persisted accessibility toggle.
    this.reducedFlash = false;

    conductor.onBar(() => { this._scanlineActive = true; this._scanlineY = 0; this.cymatics.onBar(); });
    conductor.on(Role.RHYTHM, (evt) => {
      if (!evt.kick) return;
      this._pylonFlash = 1;
      this._danceKickMs = evt.tMs;
      this._danceKickAmp = 0.4 + 0.6 * evt.vel;
      this.mandala.kick();
      this.swarm.kick(evt.vel);
      this.ribbon.kick();
      this.rd.onKick();
      this.weaver.onKick(evt.vel);
      if (evt.vel > 0.78) this.murmuration.startle(evt.vel);
      // Heavy kicks strike lightning, but only while a storm is blowing.
      const active = this.currentBlend ? this._profile(this.currentBlend.t > 0.5 ? this.currentBlend.to : this.currentBlend.from) : null;
      if (active && active.fx === 'lightning') this.lightning.maybeTrigger(evt.tMs, evt.vel, this.w, this.groundY);
      // Beats ripple the water, but only while the lake is out.
      if (active && active.fx === 'lakeReflection') this.lakeRing.excite(3 + 9 * evt.vel);
      if (this._lastKickMs != null) {
        const delta = evt.tMs - this._lastKickMs;
        if (delta >= 240 && delta <= 1500) this._beatMs += 0.25 * (delta - this._beatMs);
      }
      this._lastKickMs = evt.tMs;
    });
    conductor.on(Role.MELODY, (evt) => { this.weaver.onMelody(evt); });
  }

  _buildSchedule(barGrid, energyCurves, durationMs, songSeed) {
    let barTimes = barGrid.length >= 8 ? barGrid.map((b) => b.ms) : this._evenSplit(durationMs, 8);
    if (barTimes.length < 2) barTimes = [0, durationMs];

    const vectors = barTimes.map((ms) => (energyCurves ? energyCurves.sampleAll(ms) : new Array(7).fill(0)));
    const means = barTimes.map((_, i) => {
      const start = Math.max(0, i - 3);
      const slice = vectors.slice(start, i + 1);
      const avg = new Array(7).fill(0);
      for (const v of slice) for (let k = 0; k < 7; k++) avg[k] += v[k] / slice.length;
      return avg;
    });
    const novelty = barTimes.map((_, i) => {
      if (i < 4) return 0;
      let d = 0;
      for (let k = 0; k < 7; k++) d += (means[i][k] - means[i - 4][k]) ** 2;
      return Math.sqrt(d);
    });

    const minGap = 8;
    const peaks = [];
    const sorted = novelty.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    for (const [v, i] of sorted) {
      if (peaks.length >= 7) break;
      if (v <= 1e-6) continue;
      if (peaks.some((p) => Math.abs(p - i) < minGap)) continue;
      peaks.push(i);
    }
    peaks.sort((a, b) => a - b);

    const cuts = [0, ...peaks, barTimes.length - 1];

    this.sections = [];
    const meanEnergies = [];
    const shapes = []; // per-section mean 7-band spectral vector -- timbral fingerprint
    const maxNovelty = Math.max(...novelty, 1e-9);
    for (let i = 0; i < cuts.length - 1; i++) {
      if (cuts[i + 1] <= cuts[i]) continue;
      // Section's mean global energy (for casting) AND its mean per-band
      // vector (its timbral shape, for form recognition -- see SongForm).
      let e = 0, count = 0;
      const shape = new Array(7).fill(0);
      for (let b = cuts[i]; b < cuts[i + 1]; b++, count++) {
        for (let k = 0; k < 7; k++) { e += vectors[b][k] / 7; shape[k] += vectors[b][k]; }
      }
      if (count > 0) for (let k = 0; k < 7; k++) shape[k] /= count;
      meanEnergies.push(count > 0 ? e / count : 0);
      shapes.push(shape);
      this.sections.push({
        startMs: barTimes[cuts[i]],
        endMs: i === cuts.length - 2 ? durationMs : barTimes[cuts[i + 1]],
        // Boundary sharpness picks the transition style into this section.
        transition: this.sections.length === 0 ? 'fade' : classifyTransition(novelty[cuts[i]], maxNovelty),
        barMs: (barTimes[Math.min(barTimes.length - 1, cuts[i] + 1)] - barTimes[cuts[i]]) || 500,
      });
    }
    if (this.sections.length === 0) {
      this.sections = [{ startMs: 0, endMs: durationMs, transition: 'fade', barMs: 500 }];
      meanEnergies.push(0.5);
      shapes.push(new Array(7).fill(1));
    }

    // Song-form recognition: which sections are the SAME music (SongForm).
    // A returning chorus gets the same structural label as its earlier
    // selves, so it can wear the same face instead of reading as new.
    const labels = analyzeSongForm(this.sections.map((_, i) => ({ energy: meanEnergies[i], shape: shapes[i] })));

    // Cast the show by structural LABEL, not per-section: every recurrence
    // of a label shares a biome name (stock path), so the returning skyline
    // is literally the same -- strips/landmarks bake per (songSeed, name).
    const uniqueLabels = [...new Set(labels)]; // first-appearance order
    const labelEnergy = uniqueLabels.map((lab) => {
      let s = 0, n = 0;
      labels.forEach((l, i) => { if (l === lab) { s += meanEnergies[i]; n++; } });
      return n > 0 ? s / n : 0;
    });
    const labelCast = castBiomes(labelEnergy, songSeed);
    const biomeByLabel = new Map(uniqueLabels.map((lab, i) => [lab, labelCast[i]]));

    // Each label also gets a deterministic color signature (a hue bias),
    // so even in a single-biome dropped song the chorus recurs in the same
    // hue-shift and the verse in another -- form made visible in ANY biome.
    const hueByLabel = new Map(uniqueLabels.map((lab) => {
      const r = mulberry32(hashSeed(`${songSeed}:form:${lab}`));
      return [lab, (r() * 2 - 1) * FORM_HUE_BIAS_MAX];
    }));

    const seenLabels = new Set();
    this.sections.forEach((s, i) => {
      s.label = labels[i];
      s.profile = biomeByLabel.get(labels[i]);
      s.hueBias = hueByLabel.get(labels[i]);
      // Recognition: re-entering a label seen earlier snaps back into the
      // familiar place (a cut of recognition) rather than fading somewhere
      // new. First occurrence keeps its novelty-derived transition.
      if (i > 0 && seenLabels.has(labels[i])) s.transition = 'cut';
      seenLabels.add(labels[i]);
    });
  }

  _evenSplit(durationMs, n) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push((i / n) * durationMs);
    return out;
  }

  _sectionAt(nowMs) {
    let idx = this.sections.length - 1;
    for (let i = 0; i < this.sections.length; i++) {
      if (this.sections[i].startMs <= nowMs) idx = i; else break;
    }
    return idx;
  }

  _blend(nowMs) {
    const idx = this._sectionAt(nowMs);
    const sec = this.sections[idx];
    if (idx === 0) return { from: sec.profile, to: sec.profile, t: 1 };
    // Transition style sets the crossfade length: a hard cut lands in a
    // small fraction of a bar, a shutter wipes over one bar, a fade
    // breathes across four.
    const bars = sec.transition === 'cut' ? 0.08 : sec.transition === 'shutter' ? 1 : 4;
    const t = smoothstep(0, 1, (nowMs - sec.startMs) / (bars * sec.barMs));
    // Once the crossfade completes, retire the old biome entirely --
    // otherwise its taller peaks and particles ghost through forever.
    if (t >= 0.999) return { from: sec.profile, to: sec.profile, t: 1 };
    return { from: this.sections[idx - 1].profile, to: sec.profile, t };
  }

  _profile(name) {
    return this.profiles.find((b) => b.name === name) || this.profiles[0] || BIOMES[0];
  }

  /**
   * Register (or re-cast) a custom biome profile for the current song.
   * Safe to call after construction; strips/fields must already exist for
   * the profile name (constructor path always builds them when customBiome
   * is passed in). Hot registration of a brand-new profile mid-song is not
   * supported — drop a new MIDI to rebuild the world.
   */
  loadCustom(custom) {
    if (!custom || !custom.name) return;
    if (!this.profiles.some((b) => b.name === custom.name)) {
      this.profiles.push(custom);
    }
    this.customBiome = custom;
    if (this.sections && this.sections.length) {
      for (const s of this.sections) s.profile = custom.name;
      // Reset blend so the next draw lands fully on the custom world.
      this.currentBlend = { from: custom.name, to: custom.name, t: 1 };
      this._lastSectionIdx = null;
    }
  }

  /** The Key of the World: hue-rotate a color by the current (quantized)
   *  palette rotation. Quantizing to 3deg steps before rotating means the
   *  same handful of rotated hex strings recur across many frames, so this
   *  small cache actually hits instead of growing unbounded. */
  _rotated(hex) {
    // The key-driven rotation and the song-form section signature compose
    // into one hue offset (both quantized together to 3deg steps so the
    // cache stays hot).
    const deg = Math.round(((this.paletteRotation || 0) + (this.sectionHueBias || 0)) / 3) * 3;
    if (deg === 0) return hex;
    const key = hex + '|' + deg;
    let v = this._rotationCache.get(key);
    if (v === undefined) {
      v = rotateHueHex(hex, deg);
      this._rotationCache.set(key, v);
    }
    return v;
  }

  /** The current blended halo color -- shared accent for HUD-level effects. */
  currentHaloColor() {
    if (!this.currentBlend) return '#ffffff';
    const { from, to, t } = this.currentBlend;
    return this.lerpCache.get(this._profile(from).celestial.haloColor, this._profile(to).celestial.haloColor, t);
  }

  /** The current sky's base (horizon) tone -- used as a full-bleed backdrop
   *  fill so zooming out past 1.0 never exposes blank canvas at the edges
   *  of the (deliberately un-overscanned) parallax layers. */
  /** The ACTIVE profile's own ambient particle kind ('snow', 'rain', ...) --
   *  Simulation reads this so an inherently frozen biome ices the footing
   *  even when the music-reactive weather layer is doing something else. */
  currentParticleKind() {
    if (!this.currentBlend) return null;
    const { from, to, t } = this.currentBlend;
    return this._profile(t > 0.5 ? to : from).particles.kind;
  }

  currentSkyBase() {
    if (!this.currentBlend) return '#141428';
    const { from, to, t } = this.currentBlend;
    return this.lerpCache.get(this._profile(from).sky[1], this._profile(to).sky[1], t);
  }

  /** Fires a reward meteor volley sized by both PerfGovernor headroom and
   *  the song's staged intensity budget, colored from the current blended
   *  halo (an achromatic biome like ARCTIC's near-white sun gets a
   *  desaturated volley instead of an arbitrary hue). */
  _triggerMeteors(nowMs, baseCount) {
    const count = Math.max(2, Math.round(baseCount * this.particleMul * this.budget));
    const { r, g, b } = hexToRgb(this.currentHaloColor());
    const { h, s } = rgbToHsl(r, g, b);
    const hue = s < ACHROMATIC_SAT_THRESHOLD ? -1 : h;
    this.meteors.trigger(nowMs, count, hue);
  }

  update(nowMs, dtSec, energyCurves, calmLevel = 0, worldX = 0) {
    this.tSec = nowMs / 1000;
    this.calmLevel = calmLevel;
    const { from, to, t } = this._blend(nowMs);
    this.currentBlend = { from, to, t };

    // Dramaturgy: detect section boundaries and fire their transition FX.
    const sectionIdx = this._sectionAt(nowMs);
    this.cutFlashJustFired = false;
    if (sectionIdx !== this._lastSectionIdx) {
      const sec = this.sections[sectionIdx];
      if (this._lastSectionIdx != null) {
        if (sec.transition === 'cut') { this._cutFlash = 1; this.cutFlashJustFired = true; }
        else if (sec.transition === 'shutter') { this._shutterStartMs = nowMs; this._shutterBarMs = sec.barMs; }
      }
      this._lastSectionIdx = sectionIdx;
    }
    this._cutFlash = Math.max(0, this._cutFlash - dtSec / 0.25);

    // Song-form recognition: glide the whole palette toward the active
    // section's structural signature hue, so a returning chorus settles
    // back into the same shift it always wears (a recognizable "place")
    // rather than snapping. Constant, steady color -- reduced-flash safe.
    const targetHueBias = this.sections[sectionIdx]?.hueBias || 0;
    this.sectionHueBias += (1 - Math.exp(-dtSec / FORM_HUE_TAU_SEC)) * (targetHueBias - this.sectionHueBias);

    // Intensity budget: stage the show -- restrained intro, full finale.
    this._progress = this.durationMs > 0 ? clamp01(nowMs / this.durationMs) : 0.5;
    this.budget = intensityBudget(this._progress);
    const gain = this.budget * this.hypeBoost;
    this.mandala.intensity = gain;
    this.murmuration.intensity = gain;
    this.cymatics.intensity = gain;
    this.swarm.intensity = gain;
    this.ribbon.intensity = gain;
    this.rd.intensity = gain;

    // Biome personality: the dominant biome tunes the phenomena dials.
    const pers = PERSONALITY[t > 0.5 ? to : from] || {};
    this.cymatics.modePool = pers.cymaticModes || null;
    const [bandLo, bandHi] = pers.swarmBand || [0.18, 0.53];
    this.swarm.setBand(bandLo, bandHi);
    this.mandala.rateMul = pers.mandalaRate ?? 1;
    this.rd.bias = pers.rdBias ?? 0;
    this._ribbonScaleMul = pers.ribbonScale ?? 1;
    this._hazeMul = pers.haze ?? 1;

    // The Wind: one sample per frame, shared by every consumer below --
    // never re-derived per particle. An active weather front gusts it up:
    // rain and snow arrive WITH wind, not into still air.
    this.atmosphere.turbulence = (pers.turbulence ?? 1) * (1 + 0.6 * this._activeWeatherIntensity);
    const energyInstant = energyCurves ? clamp01(energyCurves.globalEnergy(nowMs, FLAT_WEIGHTS)) : 0;
    this.atmosphere.update(dtSec, energyInstant);

    // Groove for the dancing ranges: energy-driven, calmed sections settle.
    const grooveTarget = energyInstant * (1 - 0.55 * calmLevel);
    this._danceGroove += (1 - Math.exp(-dtSec / 0.30)) * (grooveTarget - this._danceGroove);
    const wind = this.atmosphere.at(worldX, this.h * 0.4);
    this.wind = wind;

    // Music-reactive weather: stand down (eased, not snapped) if the active
    // biome's own particle signature already IS this kind -- STORM already
    // rains, ARCTIC already snows, SAKURA already sheds petals, EMBER
    // already lofts embers, so this layer would just double them up there.
    const activeProfile = this._profile(t > 0.5 ? to : from);
    const suppressTarget = activeProfile.particles.kind === this.weatherState.kind ? 0 : 1;
    this._weatherSuppress += (1 - Math.exp(-dtSec / 1.0)) * (suppressTarget - this._weatherSuppress);
    this._activeWeatherIntensity = this.weatherState.intensity * this._weatherSuppress;
    if (this._activeWeatherIntensity > 0.01) {
      const weatherField = this.weatherFields.get(this.weatherState.kind);
      if (weatherField) weatherField.update(dtSec, this.tSec, energyCurves, nowMs, calmLevel, wind);
    }

    this.fields.get(from).update(dtSec, this.tSec, energyCurves, nowMs, calmLevel, wind);
    if (to !== from) this.fields.get(to).update(dtSec, this.tSec, energyCurves, nowMs, calmLevel, wind);
    this._updateShedPetals(dtSec, worldX, wind, this._profile(t > 0.5 ? to : from));
    for (const bank of this._fogBanks) {
      const period = this.w * 1.6;
      bank.x = (((bank.x + wind.x * dtSec * 0.6) % period) + period) % period;
    }

    // Horizon EQ (follow-up item 2): fast attack so hits register, slow
    // release so it breathes instead of flickering -- excited, never noisy.
    for (let b = 0; b < BAND_COUNT; b++) {
      const raw = energyCurves ? clamp01(energyCurves.sample(b, nowMs)) : 0;
      const tau = raw > this._eqSmoothed[b] ? EQ_ATTACK_SEC : EQ_RELEASE_SEC;
      this._eqSmoothed[b] += (1 - Math.exp(-dtSec / tau)) * (raw - this._eqSmoothed[b]);
    }

    this.mandala.update(nowMs, dtSec, energyCurves, calmLevel);
    this.cymatics.update(nowMs, dtSec, energyCurves, calmLevel);
    this.swarm.update(nowMs, dtSec, energyCurves, this._beatMs, calmLevel);
    this.ribbon.update(nowMs, dtSec, energyCurves, calmLevel);
    this.rd.update(nowMs, dtSec, energyCurves, calmLevel);
    this.lightning.update(dtSec);
    this.lightRig.update(nowMs, dtSec, this._beatMs, calmLevel, this.budget, this.fever || 0);
    this.meteors.update(dtSec);
    this.weaver.update(nowMs, dtSec);
    this.spaceRidge.update(nowMs, dtSec, this._eqSmoothed);
    // Drops send a heavy ring through the lake and snap every light-rig beam
    // onto Midio for a moment -- edge-detected off the externally-set
    // dropAtMs (same passthrough pattern as heatShimmer).
    if (Number.isFinite(this.dropAtMs) && this.dropAtMs !== this._lastSeenDropAtMs) {
      this._lastSeenDropAtMs = this.dropAtMs;
      this.lakeRing.excite(22);
      this.lightRig.trigger(nowMs, this.midioX, this.midioY);
      this._triggerMeteors(nowMs, DROP_METEOR_BASE);
    }
    // Combo milestones (streak 5/10/20) throw their own reward volley.
    if (Number.isFinite(this.milestoneAtMs) && this.milestoneAtMs !== this._lastSeenMilestoneMs) {
      this._lastSeenMilestoneMs = this.milestoneAtMs;
      const idx = Math.max(0, Math.min(MILESTONE_METEOR_BASE.length - 1, this.milestoneIdx));
      this._triggerMeteors(nowMs, MILESTONE_METEOR_BASE[idx]);
    }
    this.lakeRing.update(dtSec);
    this.murmuration.update(nowMs, dtSec, energyCurves, calmLevel, wind);

    if (this._scanlineActive) {
      this._scanlineY += dtSec * this.h * 2.2;
      if (this._scanlineY > this.h) this._scanlineActive = false;
    }
    this._pylonFlash = Math.max(0, this._pylonFlash - dtSec / 0.15);

    this._glitchActiveMs -= dtSec * 1000;
    this._glitchTimer -= dtSec;
    if (this._glitchTimer <= 0) { this._glitchActiveMs = 60; this._glitchTimer = 2.5 + this._starSeed() * 3.5; }
  }

  draw(ctx, canvas, worldX, originX = 0, skyVoyage = null, particleMul = 1, perf = null) {
    // Deeper PerfGovernor rungs (mobile performance round): the optional
    // phenomena layer and the depth-haze layer count both read this for
    // the rest of the frame, so it's stashed on `this` rather than threaded
    // through every helper's signature.
    this._perf = perf;
    const phenomenaFull = perf ? perf.phenomenaFull : true;
    const { from, to, t } = this.currentBlend || { from: this.sections[0].profile, to: this.sections[0].profile, t: 1 };
    const A = this._profile(from), B = this._profile(to);

    this._drawSky(ctx, canvas, A, B, t);

    // Planets + astral artifacts, behind everything else in the heavens --
    // purely atmospheric, first to go on the deepest perf rung.
    if (phenomenaFull) this.skyEnsemble.draw(ctx, canvas, this.tSec * 1000, {
      fromName: A.name, toName: B.name, t,
      colors: {
        skyMid: this._rotated(this.lerpCache.get(A.sky[1], B.sky[1], t)),
        silhouette: this._rotated(this.lerpCache.get(A.silhouette, B.silhouette, t)),
        halo: this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t)),
      },
      tSec: this.tSec, groove: this._danceGroove,
      reducedFlash: this.reducedFlash,
    });

    // Day arc: dawn/dusk tint washes and the celestial's slow climb/descent.
    const arc = dayArc(this._progress);
    for (const wash of [arc.dawn, arc.dusk]) {
      if (wash.alpha > 0.005) {
        ctx.save();
        ctx.globalAlpha = wash.alpha;
        ctx.fillStyle = wash.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }

    this._drawCelestial(ctx, canvas, A, B, t, arc.celestialYFrac);
    // Spirograph resonance mandala, centered on the celestial body so it
    // reads as the sun/moon itself resonating with the track.
    const mandalaColor = this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t);
    this.mandala.draw(ctx, canvas.width * 0.78, canvas.height * arc.celestialYFrac, canvas.height * 0.30 * this.mandalaScaleMul, mandalaColor);
    // Phenomena layer, deep sky: cymatic dust settling into Chladni
    // figures, and the chaos ribbon opposite the celestial for balance.
    if (phenomenaFull) this.cymatics.draw(ctx, canvas, mandalaColor);
    this.ribbon.draw(ctx, canvas.width * 0.22, canvas.height * 0.30, canvas.height * 0.075 * (this._ribbonScaleMul || 1), mandalaColor);
    this.lightning.draw(ctx, canvas, this.tSec * 1000, this.reducedFlash); // behind the ranges: bolts land beyond the hills
    if (phenomenaFull) this.spaceRidge.draw(ctx, canvas, worldX, this._rotated(rotateHueHex(mandalaColor, 45)), this.tSec, this.reducedFlash);
    this.drawDeepSky(ctx, skyVoyage); // Midasus's sky voyage, when she's away -- behind the mountains below
    if (phenomenaFull) this.weaver.draw(ctx, canvas, this.reducedFlash); // ambient connect-the-dots, same deep-sky depth
    if (phenomenaFull) this.meteors.draw(ctx, canvas, this.reducedFlash); // reward volleys, same deep-sky depth, occluded by the ranges drawn below
    this._drawOcean(ctx, canvas, worldX, A, B, t, phenomenaFull);
    this._drawHorizonEQ(ctx, canvas, worldX, A, B, t);
    this._drawSpectrumMassif(ctx, canvas, worldX, A, B, t);

    // Concert beams: anchored at the celestial, drawn before the mountain
    // silhouettes so the ranges occlude their lower reach the same way
    // Lightning's bolts do.
    const cx = canvas.width * 0.78, cy = canvas.height * arc.celestialYFrac;
    this.lightRig.draw(ctx, canvas, cx, cy, mandalaColor, particleMul, this.reducedFlash);

    // The Unraveling: each layer's scroll ratio drifts apart from the rest
    // as the world delaminates -- nearer layers race ahead more than far
    // ones (the ratio itself is the depth proxy, so no separate table).
    const scrollX0 = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L2, this.unravel);
    const scrollX1 = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L3, this.unravel);
    const scrollX2 = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L4, this.unravel);
    const scrollX3 = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L5, this.unravel);
    const tint = this._rotated(this.lerpCache.get(A.silhouette, B.silhouette, t));
    // Depth haze: three wash layers (L2/L3/L4) at healthy perf; the deepest
    // rung collapses to just L3, the middle layer -- enough of an
    // atmosphere cue to not read as flat, at a third of the cost.
    const hazeLayers = this._perf ? this._perf.hazeLayers : 3;

    this._drawLayer(ctx, canvas, 'L2', scrollX0, tint, t, A, B);
    if (hazeLayers >= 3) this._drawHaze(ctx, canvas, 'L2', A, B, t, arc);
    // Far-distance vignettes: between the farthest range and everything
    // nearer, so the L3/L4/L5 ridges partially occlude them -- genuinely
    // "witnessed in the far distance", not sprites pasted on the sky.
    if (phenomenaFull) this.farVignettes.draw(ctx, canvas, worldX, {
      tSec: this.tSec,
      kick: kickEnv(this.tSec * 1000 - this._danceKickMs - 170) * this._danceKickAmp,
      silhouette: tint,
      sky: this._rotated(this.lerpCache.get(A.sky[1], B.sky[1], t)),
      halo: this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t)),
    });
    this._drawLayer(ctx, canvas, 'L3', scrollX1, tint, t, A, B);
    this._drawHaze(ctx, canvas, 'L3', A, B, t, arc);

    // Ambient particle field lives roughly at mid-depth. The Unraveling:
    // particle hues converge toward the biome's own halo color as the
    // ending arc progresses.
    this.fields.get(from).draw(ctx, particleMul, mandalaColor, this.unravel);
    if (to !== from && t > 0.02) {
      ctx.save(); ctx.globalAlpha = t;
      this.fields.get(to).draw(ctx, particleMul, mandalaColor, this.unravel);
      ctx.restore();
    }
    // Music-reactive weather, same mid-depth as the ambient field above --
    // density (and thus fever's boost) comes free from `particleMul`, hue
    // convergence at the coda comes free from `this.unravel`.
    if (this._activeWeatherIntensity > 0.01) {
      const weatherField = this.weatherFields.get(this.weatherState.kind);
      if (weatherField) weatherField.draw(ctx, this._activeWeatherIntensity * particleMul, mandalaColor, this.unravel);
    }

    // The Kuramoto swarm shares this depth: synchronized flashing motes,
    // with the murmuration wheeling among them.
    this.swarm.draw(ctx, canvas, mandalaColor);
    if (phenomenaFull) this.murmuration.draw(ctx, this.tSec * 1000, mandalaColor, particleMul);
    this._drawFogBanks(ctx, canvas);

    this._drawLayer(ctx, canvas, 'L4', scrollX2, tint, t, A, B);
    if (hazeLayers >= 3) this._drawHaze(ctx, canvas, 'L4', A, B, t, arc);
    this._drawLayer(ctx, canvas, 'L5', scrollX3, tint, t, A, B);

    this._drawGround(ctx, canvas, worldX, originX, A, B, t);
    this._drawTransitionOverlays(ctx, canvas, B);
  }

  /** Aerial perspective: a translucent sky-colored wash after a mountain
   *  layer, strongest behind the farthest range (L2) and none behind the
   *  nearest (L5), so distance accumulates atmosphere the way it does in
   *  the real world instead of every range reading as the same flat
   *  cutout. Color pulls toward a warm dawn/dusk tone via the day arc;
   *  the per-biome PERSONALITY.haze dial and calmLevel both scale it. */
  _drawHaze(ctx, canvas, layerKey, A, B, t, arc) {
    // Atmospheric inhale: the world-adaptation return thickens the haze
    // mid-morph and clears it as the view settles -- a soft crossfade that
    // masks the pure scale change with something that reads as air itself
    // responding, not a camera reset.
    const alpha = hazeAlpha(layerKey, this._hazeMul, this.calmLevel) * (1 + 0.4 * Math.abs(this.adaptSwell || 0));
    if (alpha < HAZE_EPS) return;
    const skyTint = this.lerpCache.get(A.sky[2], B.sky[2], t);
    const hazeColor = this._rotated(this.lerpCache.get(skyTint, HAZE_WARM_COLOR, hazeWarmMix(arc.hazeWarm)));
    const { r, g, b } = hexToRgb(hazeColor);
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${alpha.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Midasus's deep-space excursion: drawn here (behind the mountain
   * silhouettes drawn further down in draw()) so she genuinely reads as
   * "way in the distance" rather than just smaller. Renders her fading
   * constellations (completed figures frozen into the sky), the live
   * persistent trail sky-writing the current figure, and a small mote of
   * light at her current position. A no-op whenever she isn't away. */
  drawDeepSky(ctx, voyage) {
    if (!voyage) return;
    const nowMs = this.tSec * 1000;

    // The Star Atlas draws whether or not she's away: every crystallized
    // constellation stays in the sky for the rest of the song, twinkling
    // per-star and glinting with the beat (atlasPulse rides hype.slam).
    if (voyage.atlas.length) {
      const pulse = voyage.atlasPulse || 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const entry of voyage.atlas) {
        ctx.strokeStyle = `hsla(${entry.hue}, 35%, 82%, ${0.09 * (1 + 1.2 * pulse)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        entry.stars.forEach((s, i) => { if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
        ctx.stroke();
        for (const s of entry.stars) {
          const twinkle = 0.5 + 0.5 * Math.sin(nowMs * 0.0013 + s.phase);
          ctx.fillStyle = `hsla(${entry.hue}, 45%, 88%, ${(0.16 + 0.16 * twinkle) * (1 + 1.6 * pulse)})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 1.1 + 0.5 * twinkle, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // The finale's supernova cascade: each detonating atlas star throws an
    // expanding ring, a hot core, and a five-ray flare. Drawn whether or
    // not she's away -- she's home watching her own myths go up.
    if (voyage.novae.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const n of voyage.novae) {
        const age = nowMs - n.bornMs - n.delayMs;
        if (age < 0) continue; // still waiting on its popcorn delay
        const u = Math.min(1, age / 1100);
        const easeOut = 1 - (1 - u) ** 3;
        const fade = 1 - u;

        ctx.strokeStyle = `hsla(${n.hue}, 70%, 85%, ${capFlashAlpha(0.7 * fade, this.reducedFlash)})`;
        ctx.lineWidth = 0.5 + 2 * fade;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 4 + 62 * easeOut, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = `hsla(${n.hue}, 30%, 96%, ${capFlashAlpha(fade, this.reducedFlash)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1 + 3 * fade, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `hsla(${n.hue}, 60%, 90%, ${capFlashAlpha(0.5 * fade, this.reducedFlash)})`;
        ctx.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const ang = n.phase + (k / 5) * Math.PI * 2;
          const len = 10 + 42 * easeOut;
          ctx.beginPath();
          ctx.moveTo(n.x + Math.cos(ang) * 5, n.y + Math.sin(ang) * 5);
          ctx.lineTo(n.x + Math.cos(ang) * len, n.y + Math.sin(ang) * len);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    if (voyage.depth <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const c of voyage.constellations) {
      const life = 1 - clamp01((nowMs - c.bornMs) / 6000);
      if (life <= 0) continue;
      ctx.strokeStyle = `hsla(${c.hue}, 60%, 80%, ${0.5 * life})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      c.points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.stroke();
      ctx.fillStyle = `hsla(${c.hue}, 75%, 90%, ${0.9 * life})`;
      for (const p of c.points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Persistent trail: a soft wide glow pass underneath a bright thin
    // core, the way a comet's tail actually reads -- this is the geometry
    // she's sky-writing, so it needs to be legible, not a faint scratch.
    const trail = voyage.trail;
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const u = i / trail.length; // older points fade toward transparent
      ctx.strokeStyle = `hsla(${b.hue}, 65%, 78%, ${0.22 * u})`;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = `hsla(${b.hue}, 75%, 88%, ${0.85 * u})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Kick sparkles: radial bursts flung off her on every beat out there.
    for (const s of voyage.sparkles) {
      const life = 1 - s.age / 0.6;
      if (life <= 0) continue;
      ctx.fillStyle = `hsla(${s.hue}, 80%, 88%, ${0.85 * life})`;
      ctx.fillRect(s.x - 1, s.y - 1, 2.2, 2.2);
    }

    // Micro-slashes: each melody onset cuts a brief bright line at her
    // deep-sky position -- her note-slash vocabulary, miniaturized.
    ctx.lineCap = 'round';
    for (const s of voyage.microSlashes) {
      const u = s.age / 0.25;
      if (u >= 1) continue;
      const ext = 8 + 14 * u;
      ctx.strokeStyle = `hsla(${s.hue}, 75%, 85%, ${0.9 * (1 - u)})`;
      ctx.lineWidth = 1.6 * (1 - u * 0.5);
      ctx.beginPath();
      ctx.moveTo(s.x - Math.cos(s.ang) * ext, s.y - Math.sin(s.ang) * ext);
      ctx.lineTo(s.x + Math.cos(s.ang) * ext, s.y + Math.sin(s.ang) * ext);
      ctx.stroke();
    }

    // Her current position: fades in from nothing (still "here" at the
    // start of ascent) to a small glowing comet-head once fully away.
    const r = 2 + 3 * (1 - voyage.depth);
    ctx.fillStyle = `hsla(${voyage.hue}, 60%, 85%, ${0.28 * voyage.depth})`;
    ctx.beginPath();
    ctx.arc(voyage.p.x, voyage.p.y, r * 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsla(${voyage.hue}, 80%, 92%, ${0.6 + 0.4 * voyage.depth})`;
    ctx.beginPath();
    ctx.arc(voyage.p.x, voyage.p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** Cut flash + shutter wipe, fired by the Dramaturgy Director. */
  _drawTransitionOverlays(ctx, canvas, B) {
    const nowMs = this.tSec * 1000;
    const u = (nowMs - this._shutterStartMs) / this._shutterBarMs;
    if (u >= 0 && u <= 1) {
      // Vertical shutter columns closing then reopening over one bar,
      // phase-staggered so the wipe ripples instead of slamming.
      ctx.save();
      ctx.fillStyle = B.silhouette;
      const cols = 14;
      const colW = canvas.width / cols;
      for (let i = 0; i < cols; i++) {
        const stagger = 0.8 + 0.2 * Math.sin(i * 1.7);
        const h = canvas.height * 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.05)) * stagger;
        ctx.fillRect(i * colW, 0, colW + 1, h);
        ctx.fillRect(i * colW, canvas.height - h, colW + 1, h);
      }
      ctx.restore();
    }
    if (this._cutFlash > 0.01) {
      ctx.save();
      ctx.globalAlpha = capFlashAlpha(0.35 * this._cutFlash, this.reducedFlash);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  drawForeground(ctx, canvas, worldX, veilEnabled = true) {
    // L7: oversized, blurred, low-alpha foreground veil (spec §4.1.1).
    // Calm sections lift the veil alpha a little -- a small, cheap way to
    // keep this backmost layer visibly breathing when nothing else is loud.
    if (!veilEnabled) return;
    ctx.save();
    ctx.globalAlpha = 0.10 * (1 + 0.6 * (this.calmLevel || 0));
    const scrollX = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L7, this.unravel);
    for (let i = 0; i < 3; i++) {
      const x = ((i * 480 - scrollX) % (canvas.width + 400) + canvas.width + 400) % (canvas.width + 400) - 200;
      const cy = canvas.height * (0.3 + 0.2 * i);
      // Wider, softer radial fill stands in for the old blur(6px) pass --
      // same soft-edged look, no per-frame offscreen-layer/GPU-flush cost.
      const rx = 220, ry = 130;
      const g = ctx.createRadialGradient(x, cy, 0, x, cy, Math.max(rx, ry));
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawSky(ctx, canvas, A, B, t) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    for (let i = 0; i < 3; i++) g.addColorStop(i / 2, this._rotated(this.lerpCache.get(A.sky[i], B.sky[i], t)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (A.fx === 'starTwinkle' || B.fx === 'starTwinkle') {
      const alpha = (A.fx === 'starTwinkle' ? 1 - t : 0) + (B.fx === 'starTwinkle' ? t : 0);
      if (alpha > 0.02) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        // Calm sections twinkle faster -- a small, free source of motion
        // for a layer that otherwise barely changes frame to frame.
        const twinkleRate = 1.3 * (1 + 0.6 * (this.calmLevel || 0));
        for (const s of this.stars) {
          const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.tSec * twinkleRate + s.phase));
          ctx.globalAlpha = alpha * a;
          ctx.fillRect(s.x, s.y, 1.6, 1.6);
        }
        ctx.restore();
      }
    }
    if (A.fx === 'aurora' || B.fx === 'aurora') {
      const alpha = (A.fx === 'aurora' ? 1 - t : 0) + (B.fx === 'aurora' ? t : 0);
      if (alpha > 0.02) this._drawAurora(ctx, canvas, alpha);
    }
  }

  _drawAurora(ctx, canvas, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 3; band++) {
      const hue = 160 + ((this.tSec * 12 + band * 40) % 140);
      ctx.strokeStyle = `hsla(${hue},80%,60%,${0.16 * alpha})`;
      ctx.lineWidth = 18;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 16) {
        const y = 60 + band * 30 + Math.sin(x * 0.006 + this.tSec * 0.6 + band) * 26;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawCelestial(ctx, canvas, A, B, t, cyFrac = 0.22) {
    const cx = canvas.width * 0.78, cy = canvas.height * cyFrac;
    if (B === A) {
      this._drawOneCelestial(ctx, cx, cy, A.celestial, 1);
    } else {
      this._drawOneCelestial(ctx, cx, cy, A.celestial, 1 - t);
      this._drawOneCelestial(ctx, cx, cy, B.celestial, t);
    }

    const promAlpha = (A.fx === 'prominence' ? 1 - t : 0) + (B.fx === 'prominence' ? t : 0);
    if (promAlpha > 0.02) this._drawProminence(ctx, cx, cy, promAlpha);
  }

  /** A far ocean behind the furthest ridgeline, in front of the sky: a
   *  filled band along a gently undulating sea line (seaLineY -- bass-scaled
   *  amplitude, a kick presses it down) plus a handful of seeded dashed
   *  shimmer rows. Sits behind the horizon EQ's glow, the spectrum massif,
   *  and every mountain layer, so later draws naturally occlude most of it
   *  -- reads as genuinely distant. The filled band is core scenery (always
   *  drawn); the shimmer detail sheds at the deepest perf rung. */
  _drawOcean(ctx, canvas, worldX, A, B, t, phenomenaFull) {
    const seaTop = canvas.height * 0.585;
    const seaBottom = canvas.height * 0.74;
    const scroll = worldX * 0.025;
    const bass = 0.5 * ((this._eqSmoothed[0] || 0) + (this._eqSmoothed[1] || 0));
    const kick = kickEnv(this.tSec * 1000 - this._danceKickMs - 250) * this._danceKickAmp;

    const skyMid = this.lerpCache.get(A.sky[1], B.sky[1], t);
    const sil = this.lerpCache.get(A.silhouette, B.silhouette, t);
    const body = this._rotated(this.lerpCache.get(sil, skyMid, 0.45));
    const deep = this._rotated(sil);
    const cap = this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));

    const N = 48;
    const pts = new Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const u = ((i / N) + scroll / canvas.width) % 1;
      pts[i] = { x: (i / N) * canvas.width, y: seaTop + seaLineY(u, this.tSec, bass, kick) };
    }

    ctx.save();
    const grad = ctx.createLinearGradient(0, seaTop, 0, seaBottom);
    grad.addColorStop(0, body);
    grad.addColorStop(1, deep);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, seaBottom);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(canvas.width, seaBottom);
    ctx.closePath();
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = cap;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    if (phenomenaFull) {
      const groove = clamp01(this._danceGroove);
      for (const band of this._oceanBands) {
        ctx.globalAlpha = band.alpha * (0.3 + 0.7 * groove);
        ctx.lineWidth = 1;
        ctx.setLineDash([band.dashLen, band.gapLen]);
        ctx.lineDashOffset = shimmerOffsetX(band, this.tSec, worldX);
        ctx.beginPath();
        ctx.moveTo(0, seaTop + (seaBottom - seaTop) * band.yFrac);
        ctx.lineTo(canvas.width, seaTop + (seaBottom - seaTop) * band.yFrac);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // A soft celestial reflection column, under the sun/moon's screen x.
      const rx = canvas.width * 0.78;
      const rGrad = ctx.createLinearGradient(rx, seaTop, rx, seaBottom);
      rGrad.addColorStop(0, `${cap}22`);
      rGrad.addColorStop(1, `${cap}00`);
      ctx.fillStyle = rGrad;
      ctx.globalAlpha = 0.10;
      ctx.fillRect(rx - 60, seaTop, 120, seaBottom - seaTop);
    }
    ctx.restore();
  }

  /**
   * The spectrum as weather, not as bars: a continuous luminous ridge on
   * the horizon whose silhouette IS the 7-band spectrum -- cosine-
   * interpolated between bands so there is not a straight line in it,
   * slowly scrolling through the bands, with a traveling undulation riding
   * the crest. Filled glow below, a bright aurora crest line on top.
   */
  _drawHorizonEQ(ctx, canvas, worldX, A, B, t) {
    const color = this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t);
    const baseline = canvas.height * 0.60;
    const maxH = canvas.height * EQ_MAX_HEIGHT_FRAC;
    const scroll = worldX * 0.0018;
    const tS = this.tSec;

    const N = 64;
    const pts = new Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      // Which pair of bands this column sits between (wrapping, scrolling).
      const p = ((u * BAND_COUNT + scroll) % BAND_COUNT + BAND_COUNT) % BAND_COUNT;
      const i0 = Math.floor(p) % BAND_COUNT, i1 = (i0 + 1) % BAND_COUNT;
      const f = p - Math.floor(p);
      const c = (1 - Math.cos(f * Math.PI)) / 2; // cosine ease: no corners
      const v = clamp01(this._eqSmoothed[i0] * (1 - c) + this._eqSmoothed[i1] * c);
      const wave = Math.sin(u * Math.PI * 7 + tS * 1.6) * 7 * (0.25 + v);
      pts[i] = { x: u * canvas.width, y: baseline - (v * maxH + wave) };
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Body: a soft filled glow from the crest down.
    const grad = ctx.createLinearGradient(0, baseline - maxH, 0, baseline + 30);
    grad.addColorStop(0, `${color}55`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.5 * this.budget;
    ctx.beginPath();
    ctx.moveTo(0, baseline + 30);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(canvas.width, baseline + 30);
    ctx.closePath();
    ctx.fill();

    // Crest: wide faint halo under a bright aurora line.
    for (const [lw, a] of [[7, 0.14], [2.2, 0.6]]) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = a * this.budget;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawOneCelestial(ctx, cx, cy, c, alpha) {
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, c.radius * (c.dominant ? 3.2 : 2.2));
    halo.addColorStop(0, c.haloColor);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, c.radius * (c.dominant ? 3.2 : 2.2), 0, Math.PI * 2);
    ctx.fill();

    if (c.wireframe) {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius, 0, Math.PI * 2);
      ctx.moveTo(cx - c.radius, cy); ctx.lineTo(cx + c.radius, cy);
      ctx.moveTo(cx, cy - c.radius); ctx.lineTo(cx, cy + c.radius);
      ctx.stroke();
    } else if (c.shape) {
      // Superformula silhouette: this biome's sun/moon is a Gielis curve,
      // slowly rotating, normalized so `radius` still means what it says.
      // Odd m only closes after 4*pi (the curve needs two revolutions),
      // even m closes after 2*pi.
      const { m, n1, n2, n3 } = c.shape;
      const span = (m % 2 === 1 ? 4 : 2) * Math.PI;
      const steps = m % 2 === 1 ? 192 : 96;
      let rMax = 0;
      const rs = new Array(steps + 1);
      for (let i = 0; i <= steps; i++) {
        rs[i] = superformula((i / steps) * span, m, n1, n2, n3);
        if (rs[i] > rMax) rMax = rs[i];
      }
      const rot = this.tSec * 0.05;
      ctx.fillStyle = c.color;
      ctx.globalAlpha = alpha * (c.veiled ? 0.6 : 1);
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const phi = (i / steps) * span;
        const r = (rs[i] / rMax) * c.radius;
        const x = cx + Math.cos(phi + rot) * r;
        const y = cy + Math.sin(phi + rot) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = c.color;
      ctx.globalAlpha = alpha * (c.veiled ? 0.6 : 1);
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (c.ring) {
      ctx.strokeStyle = c.haloColor;
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (c.shattered) {
      ctx.strokeStyle = '#05010d';
      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - c.radius * 0.3, cy - c.radius * 0.6);
      ctx.lineTo(cx + c.radius * 0.1, cy + c.radius * 0.4);
      ctx.moveTo(cx + c.radius * 0.4, cy - c.radius * 0.5);
      ctx.lineTo(cx - c.radius * 0.1, cy + c.radius * 0.2);
      ctx.stroke();
    }
    if (c.shafts) {
      ctx.globalAlpha = alpha * 0.10;
      ctx.fillStyle = c.color;
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((i - 2) * 0.22 + Math.sin(this.tSec * 0.2 + i) * 0.03);
        ctx.fillRect(-8, 0, 16, 600);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  _drawProminence(ctx, cx, cy, alpha) {
    const e0 = this.energyCurves ? this.energyCurves.sample(0, this.tSec * 1000) : 0.3;
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = '#ffcf6b';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + this.tSec * 0.15;
      const r1 = 80, r2 = 80 + 30 * (0.3 + e0);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.6);
      ctx.quadraticCurveTo(
        cx + Math.cos(ang) * (r1 + r2) * 0.7, cy + Math.sin(ang) * (r1 + r2) * 0.4 - 20,
        cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2 * 0.6,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The Wind: 2-3 translucent fog banks drifting on the same global wind
   *  as everything else, opacity proportional to how calm the section is
   *  -- calm stretches finally get weather, not just slower motion. */
  _drawFogBanks(ctx, canvas) {
    const alpha = 0.16 * (this.calmLevel || 0);
    if (alpha < 0.01) return;
    const period = canvas.width * 1.6;
    const cy = canvas.height * 0.42, r = canvas.width * 0.45;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const bank of this._fogBanks) {
      for (const x of bank.x < canvas.width * 0.5 ? [bank.x, bank.x + period] : [bank.x]) {
        const g = ctx.createRadialGradient(x, cy, 0, x, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, canvas.height * 0.15, canvas.width, canvas.height * 0.55);
      }
    }
    ctx.restore();
  }

  _drawLayer(ctx, canvas, layerKey, scrollX, tint, t, A, B) {
    const stripsA = this.strips.get(A.name), stripsB = this.strips.get(B.name);
    // Lift the ranges so their ridges actually clear the ground band --
    // strip bottoms stay tucked safely beneath the ground fill.
    const yOff = this.groundY + 40 - canvas.height;
    ctx.save();
    const biomeShimmerAlpha = (A.fx === 'heatShimmer' ? 1 - t : 0) + (B.fx === 'heatShimmer' ? t : 0);
    const applyBiomeShimmer = biomeShimmerAlpha > 0.05 && layerKey !== 'L5';
    // Movement II: heat shimmer isn't only SOLAR's signature anymore -- a
    // hard hype-fast spike reuses the exact same slice-offset trick on the
    // farthest range, above the horizon, regardless of biome.
    const applyDynamicShimmer = layerKey === 'L2' && (this.heatShimmer || 0) > 0.7;
    if (applyBiomeShimmer || applyDynamicShimmer) {
      this._drawShimmered(ctx, canvas, stripsA[layerKey], scrollX, yOff);
    } else {
      this._drawDancingStrip(ctx, canvas, stripsA[layerKey], scrollX, yOff, layerKey);
      if ((layerKey === 'L4' || layerKey === 'L5') && A.edgeLight) {
        this._drawCrest(ctx, canvas, stripsA[layerKey], scrollX, yOff, layerKey, A.edgeLight, 1);
      }
    }
    if (B !== A && t > 0.02) {
      ctx.globalAlpha = t;
      this._drawDancingStrip(ctx, canvas, stripsB[layerKey], scrollX, yOff, layerKey);
      ctx.globalAlpha = 1;
      if ((layerKey === 'L4' || layerKey === 'L5') && B.edgeLight) {
        this._drawCrest(ctx, canvas, stripsB[layerKey], scrollX, yOff, layerKey, B.edgeLight, t);
      }
    }
    // Miniature characters run along the two nearest ranges' ridges,
    // riding the same dance the columns do.
    if (layerKey === 'L4' || layerKey === 'L5') {
      const strip = (t > 0.5 ? stripsB : stripsA)[layerKey];
      const cfg = DANCE_LAYERS[layerKey];
      const kick = kickEnv(this.tSec * 1000 - this._danceKickMs - cfg.delaySec * 1000) * this._danceKickAmp;
      this.ridgeRunners[layerKey].draw(ctx, strip, scrollX, canvas.width, canvas.height - strip.height + yOff, {
        tSec: this.tSec, groove: this._danceGroove, kick, cfg, fever: this.fever || 0,
      }, layerKey === 'L5' ? 0.55 : 0.4);
    }
    ctx.restore();
  }

  /** The mountains dance: the strip is drawn in column slices, each riding
   *  a groove-scaled traveling wave along the ridge, and the whole range
   *  bounces on kicks — near hills first, far peaks a beat-fraction later
   *  (per-layer delaySec), a crowd wave rolling into the distance. Column
   *  phase is computed in scroll-stable strip space so the wave travels
   *  with time, never jittering with camera scroll. The strips overhang
   *  the ground band by ~40px, which quietly swallows the bottom gap a
   *  lifted column would otherwise open. */
  _drawDancingStrip(ctx, canvas, strip, scrollX, yOff, layerKey) {
    const cfg = DANCE_LAYERS[layerKey];
    if (!cfg) {
      drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
      return;
    }
    const nowMs = this.tSec * 1000;
    const kick = kickEnv(nowMs - this._danceKickMs - cfg.delaySec * 1000) * this._danceKickAmp;
    // Orogeny: the range grows taller toward the song's energy climax, then
    // subsides -- height only, anchored at the base so the ridge visibly
    // rears up rather than the whole strip just scaling in place. The
    // Lens's world-adaptation return rides the same knob: leaning back out
    // from a zoom-in swells the ranges taller as the view widens, leaning
    // back in from a zoom-out settles them shorter -- the skyline visibly
    // meets the returning view instead of the camera just snapping back.
    const adaptSwell = this.adaptSwell || 0;
    const growthMul = orogenyHeightMul(layerKey, clamp01((this.orogenyGrowth || 0) + 0.22 * adaptSwell));
    const dh = strip.height * growthMul;
    const baseY = canvas.height - dh + yOff;
    const danceAmpMul = 1 + 0.35 * Math.abs(adaptSwell);
    const w = strip.width;
    let x = -(((scrollX % w) + w) % w);
    while (x < canvas.width) {
      for (let cx = 0; cx < w; cx += DANCE_COL_W) {
        const cw = Math.min(DANCE_COL_W, w - cx);
        const sx = x + cx;
        if (sx + cw < 0 || sx > canvas.width) continue;
        const dy = danceOffset(scrollX + sx, this.tSec, this._danceGroove, kick, cfg, this.fever || 0) * danceAmpMul;
        ctx.drawImage(strip, cx, 0, cw, strip.height, sx, baseY + dy, cw, dh);
      }
      x += w;
    }
  }

  /** The neon ridge line, drawn LIVE instead of baked into the strip bitmap
   *  (the old baked stroke tore at every 128px dance-column seam). Walks the
   *  same danceOffset/growthMul/baseY math _drawDancingStrip uses, but
   *  smoothly (GeoCrest's ridgeYSmooth/danceOffsetSmooth) so the line stays
   *  one continuous polyline across every seam and every strip-tile wrap.
   *  L4 additionally subtracts geoCrestOffset -- the 7-band spectrum,
   *  sculpted into geological features (cliffs, aretes, knobs, outcrops,
   *  terraces) fixed to terrain positions -- making it the third, distinct
   *  equalizer alongside the horizon EQ and the spectrum massif. L5 keeps
   *  the plain unbroken crest (today's look, minus the tear). */
  _drawCrest(ctx, canvas, strip, scrollX, yOff, layerKey, edgeLight, alpha) {
    if (!strip.ridge) return;
    const cfg = DANCE_LAYERS[layerKey];
    if (!cfg) return;
    const nowMs = this.tSec * 1000;
    const kick = kickEnv(nowMs - this._danceKickMs - cfg.delaySec * 1000) * this._danceKickAmp;
    const adaptSwell = this.adaptSwell || 0;
    const growthMul = orogenyHeightMul(layerKey, clamp01((this.orogenyGrowth || 0) + 0.22 * adaptSwell));
    const dh = strip.height * growthMul;
    const baseY = canvas.height - dh + yOff;
    const danceAmpMul = 1 + 0.35 * Math.abs(adaptSwell);
    const w = strip.width;
    const isGeo = layerKey === 'L4';
    const tSec = this.tSec;
    const fever = this.fever || 0;
    const groove = this._danceGroove;

    const pts = new Array(Math.ceil(canvas.width / 8) + 3);
    let n = 0;
    for (let x = -8; x <= canvas.width + 8; x += 8) {
      const stripX = scrollX + x;
      const u = (((stripX % w) + w) % w);
      const yR = ridgeYSmooth(strip.ridge, u) * growthMul;
      const dy = danceOffsetSmooth(stripX, tSec, groove, kick, cfg, fever) * danceAmpMul;
      const lift = isGeo ? geoCrestOffset(u / w, this._eqSmoothed, this._geoFeatures, tSec) : 0;
      pts[n++] = { x, y: baseY + yR + dy - lift, lift };
    }
    pts.length = n;

    ctx.save();
    if (isGeo) {
      let anyLift = false;
      for (const p of pts) if (p.lift > 1) { anyLift = true; break; }
      if (anyLift) {
        ctx.globalAlpha = 0.10 * alpha;
        ctx.fillStyle = edgeLight;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y + pts[i].lift);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Two-pass glow, same weights as the old baked stroke.
    for (const [lw, a] of [[4, 0.30], [1.5, 0.85]]) {
      ctx.strokeStyle = edgeLight;
      ctx.globalAlpha = a * alpha;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** One super-distant mountain that IS the spectrum: seven chunky bars —
   *  bass building the summit at the center, treble falling away to the
   *  flanks (see spectrumBars) — riding the same attack/release-smoothed
   *  band levels as the horizon EQ. It sits on the slowest scroll ratio in
   *  the scene and is haze-mixed toward the sky, so it reads as the
   *  farthest solid thing in the world; a pedestal bell keeps it a
   *  mountain even in total silence, and thin halo-colored crest caps are
   *  the "this peak is an equalizer" tell. */
  _drawSpectrumMassif(ctx, canvas, worldX, A, B, t) {
    const bars = spectrumBars(this._eqSmoothed);
    const barW = 46, gap = 3;
    const massifW = bars.length * (barW + gap) - gap;
    const period = canvas.width * 1.5;
    const scroll = worldX * CodaDirector.delaminateRatio(0.03, this.unravel);
    const left = ((((canvas.width * 0.58 - scroll) % period) + period) % period) - massifW;
    if (left > canvas.width || left + massifW < 0) return;

    const baseY = this.groundY - 26;
    // The massif is the farthest solid thing in the scene -- it rides the
    // same orogeny arc as the L2 range (the far-most parallax layer).
    const maxH = 234 * orogenyHeightMul('L2', clamp01((this.orogenyGrowth || 0) + 0.22 * (this.adaptSwell || 0)));
    const skyMid = this.lerpCache.get(A.sky[1], B.sky[1], t);
    const sil = this.lerpCache.get(A.silhouette, B.silhouette, t);
    const body = this._rotated(this.lerpCache.get(sil, skyMid, 0.55));
    const cap = this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));

    ctx.save();
    ctx.fillStyle = body;
    for (let i = 0; i < bars.length; i++) {
      const h = bars[i].h01 * maxH;
      const bx = left + i * (barW + gap);
      ctx.fillRect(bx, baseY - h, barW, h);
    }
    ctx.fillStyle = cap;
    ctx.globalAlpha = 0.32 * (0.5 + 0.5 * this.budget);
    for (let i = 0; i < bars.length; i++) {
      const h = bars[i].h01 * maxH;
      ctx.fillRect(left + i * (barW + gap), baseY - h, barW, 2.5);
    }
    ctx.restore();
  }

  _drawShimmered(ctx, canvas, strip, scrollX, yOff = 0) {
    const w = strip.width, h = strip.height;
    const baseY = canvas.height - h + yOff;
    let x0 = -(((scrollX % w) + w) % w);
    const step = 6;
    for (let sx = x0; sx < canvas.width; sx += w) {
      for (let row = 0; row < h; row += step) {
        const offset = 2 * Math.sin(row / 24 + this.tSec * 4);
        ctx.drawImage(strip, 0, row, w, step, sx + offset, baseY + row, w, step);
      }
    }
  }

  _drawGround(ctx, canvas, worldX, originX, A, B, t) {
    const groundColor = this.lerpCache.get(A.silhouette, B.silhouette, t);
    const localGroundY = this.groundField ? this.groundField.heightAt(worldX) : this.groundY;
    const activeFx = t > 0.5 ? B.fx : A.fx;
    // The Mirror: GroundField's physics (collision height) are untouched,
    // but the lake is where the terrain-EQ visually takes a rest -- a
    // still, flat surface instead of jittering EQ-bar terrain.
    const isLake = activeFx === 'lakeReflection';

    if (this.groundField && !isLake) {
      // Ground as shifted EQ-bar-shaped slices (follow-up item 5): each bar
      // echoes the horizon EQ's own per-band reading, just offset by a few
      // columns, so the terrain visually rhymes with the music playing far
      // in the background.
      const bars = this.groundField.visibleBars(worldX, originX, canvas.width);
      ctx.fillStyle = groundColor;
      for (const bar of bars) ctx.fillRect(bar.x, bar.y, bar.width + 1, canvas.height - bar.y);

      const haloColor = this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t);
      const { r, g, b } = hexToRgb(haloColor);
      const rgb = `${r},${g},${b}`;

      // Crest caps: the ground rhymes with the spectrum massif's own
      // halo-tinted crest -- a thin bright line riding the groove wave,
      // silent (skipped) whenever the track's global energy is near zero.
      const grooveNow = bars.length ? bars[0].groove || 0 : 0;
      if (grooveNow > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.28 * grooveNow, this.reducedFlash)})`;
        for (const bar of bars) ctx.fillRect(bar.x, bar.y, bar.width + 1, 2);
        ctx.restore();
      }

      // Settled snow: frost caps ride the bar tops -- a pale band whose
      // thickness grows with cover, plus seeded glints so ice reads as ICE
      // (slippery, see Traction.js) rather than just pale paint. Melts to
      // zero cost the moment cover does.
      if ((this.snowCover || 0) > 0.03) {
        const cover = this.snowCover;
        ctx.save();
        ctx.fillStyle = `rgba(230,242,255,${(0.34 * cover).toFixed(3)})`;
        // One pass: caps for every bar, glinting bars collected as we go
        // (usually 0-3) for the tiny additive pass below.
        const glints = [];
        for (const bar of bars) {
          ctx.fillRect(bar.x, bar.y, bar.width + 1, 4 + 9 * cover);
          // Specular glints: a few bars catch the light each moment,
          // drifting with world scroll so the sheen slides underfoot.
          const glint = 0.5 + 0.5 * Math.sin(bar.x * 0.13 + worldX * 0.011 + this.tSec * 1.7);
          if (glint > 0.86) glints.push([bar, 0.30 * cover * (glint - 0.86) / 0.14]);
        }
        ctx.globalCompositeOperation = 'lighter';
        for (const [bar, a] of glints) {
          ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          ctx.fillRect(bar.x, bar.y, bar.width + 1, 1.6);
        }
        ctx.restore();
      }

      // Kick ground glow: an emissive rim over bars a kick-synced pulse
      // (GroundField.kickGlow) is currently racing through -- tinted toward
      // the biome's own halo color so it reads as the world's light, not a
      // generic overlay. Silent (zero cost) whenever no pulse is active.
      const glowBars = bars.filter((bar) => bar.glow > 0.01);
      if (glowBars.length) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const bar of glowBars) {
          const alpha = capFlashAlpha(0.5 * bar.glow, this.reducedFlash);
          const rimH = Math.min(60, canvas.height - bar.y);
          const grad = ctx.createLinearGradient(0, bar.y, 0, bar.y + rimH);
          grad.addColorStop(0, `rgba(${rgb},${alpha})`);
          grad.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(bar.x, bar.y, bar.width + 1, rimH);
        }
        ctx.restore();
      }

      // Gray-Scott texture living inside the ground: clip to the slice
      // silhouette so the pattern rides the terrain's vertical motion.
      // Purely decorative texture over the flat fill above it, so the
      // deepest perf rung skips it outright rather than clip+draw for
      // nothing.
      if (!this._perf || this._perf.phenomenaFull) {
        let minTop = canvas.height;
        ctx.save();
        ctx.beginPath();
        for (const bar of bars) {
          ctx.rect(bar.x, bar.y, bar.width + 1, canvas.height - bar.y);
          if (bar.y < minTop) minTop = bar.y;
        }
        ctx.clip();
        this.rd.draw(ctx, canvas, worldX, minTop);
        ctx.restore();
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        ctx.moveTo(bar.x, bar.y);
        ctx.lineTo(bar.x + bar.width, bar.y);
        if (i + 1 < bars.length) ctx.lineTo(bar.x + bar.width, bars[i + 1].y); // vertical connector at the seam
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = groundColor;
      ctx.fillRect(0, localGroundY, canvas.width, canvas.height - localGroundY);
    }

    if (activeFx === 'neonGrid') this._drawNeonGrid(ctx, canvas, worldX, localGroundY);
    else if (activeFx === 'canopyDapple') this._drawCanopyDapple(ctx, canvas, localGroundY);
    else if (activeFx === 'glitchTear' && this._glitchActiveMs > 0) this._drawGlitchTear(ctx, canvas);
    else if (activeFx === 'petalPile') this._drawPetalPiles(ctx, canvas, worldX, localGroundY, t > 0.5 ? B : A);
    else if (isLake) this._drawLakeReflection(ctx, canvas, localGroundY);
  }

  /** The Mirror (Movement IV): flip the sky/phenomena/silhouette region
   *  already painted above the waterline straight down into the lake band
   *  -- the mandala, aurora, murmuration, and Midasus's sky voyage all
   *  reflect for free, since this reads back whatever canvas pixels are
   *  already there. Then ripples: a kick/drop-excited ModalRing drives a
   *  horizontal sine offset per row-slice, re-blitting the reflection
   *  sideways in place (the same self-referential drawImage trick as the
   *  hype-frame echo in Renderer.js). */
  _drawLakeReflection(ctx, canvas, groundY) {
    const lakeHeight = canvas.height - groundY;
    if (lakeHeight <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, groundY, canvas.width, lakeHeight);
    ctx.clip();

    ctx.globalAlpha = 0.35;
    ctx.translate(0, 2 * groundY);
    ctx.scale(1, -1);
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();

    // Vertical fade with depth: the reflection dissolves toward the far
    // (bottom) edge of the lake band rather than cutting off sharply.
    ctx.save();
    const fadeGrad = ctx.createLinearGradient(0, groundY, 0, canvas.height);
    fadeGrad.addColorStop(0, 'rgba(0,0,0,0)');
    fadeGrad.addColorStop(1, 'rgba(6,10,18,0.75)');
    ctx.fillStyle = fadeGrad;
    ctx.fillRect(0, groundY, canvas.width, lakeHeight);
    ctx.restore();

    // Ripples.
    const SLICES = 8;
    const step = Math.max(1, Math.ceil(lakeHeight / SLICES));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, groundY, canvas.width, lakeHeight);
    ctx.clip();
    for (let row = 0, i = 0; row < lakeHeight; row += step, i++) {
      const theta = (i / SLICES) * Math.PI * 2;
      const offset = this.lakeRing.displacementAt(theta) * 3;
      if (Math.abs(offset) < 0.05) continue;
      ctx.drawImage(canvas, 0, groundY + row, canvas.width, step, offset, groundY + row, canvas.width, step);
    }
    ctx.restore();
  }

  /** The Wind: SAKURA's piles actively shed a few petals downwind rather
   *  than just sitting there as static ellipses. */
  _updateShedPetals(dtSec, worldX, wind, activeProfile) {
    if (activeProfile.fx === 'petalPile' && this._starSeed() < 0.5 * dtSec && this._shedPetals.length < 40) {
      this._shedPetals.push({
        wx: worldX + this.w * 0.5 + (this._starSeed() * 2 - 1) * this.w * 0.9,
        y: this.groundY - 4, vy: -16 - 10 * this._starSeed(),
        age: 0, life: 2 + this._starSeed(),
        color: activeProfile.particles.color,
        rot: this._starSeed() * Math.PI * 2, spin: (this._starSeed() * 2 - 1) * 2,
      });
    }
    for (let i = this._shedPetals.length - 1; i >= 0; i--) {
      const sp = this._shedPetals[i];
      sp.age += dtSec;
      sp.wx += wind.x * dtSec;
      sp.vy += 40 * dtSec; // settles back toward the ground
      sp.y += sp.vy * dtSec * 0.2 + Math.sin(sp.age * 3) * 0.3;
      sp.rot += sp.spin * dtSec;
      if (sp.age >= sp.life) this._shedPetals.splice(i, 1);
    }
  }

  /** SAKURA's dormant hook: soft petal drifts scrolling with the ground,
   *  plus any petals actively shedding off the piles right now. */
  _drawPetalPiles(ctx, canvas, worldX, groundY, profile) {
    ctx.save();
    ctx.fillStyle = profile.particles.color;
    const spacing = 300;
    for (let i = 0; i < 6; i++) {
      const x = ((i * spacing - worldX) % (canvas.width + spacing) + canvas.width + spacing) % (canvas.width + spacing) - spacing / 2;
      const breathe = 0.8 + 0.2 * Math.sin(this.tSec * 0.5 + i * 2.1);
      ctx.globalAlpha = 0.22 * breathe;
      ctx.beginPath();
      ctx.ellipse(x, groundY + 3, 40 + (i % 3) * 16, 7 + (i % 2) * 3, 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }
    for (const sp of this._shedPetals) {
      const sx = sp.wx - worldX;
      if (sx < -30 || sx > canvas.width + 30) continue;
      ctx.globalAlpha = 0.55 * (1 - sp.age / sp.life);
      ctx.fillStyle = sp.color;
      ctx.save();
      ctx.translate(sx, sp.y);
      ctx.rotate(sp.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  _drawNeonGrid(ctx, canvas, worldX, groundY) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,208,0.35)';
    ctx.lineWidth = 1;
    const spacing = 48;
    const offset = worldX % spacing;
    for (let x = -offset; x < canvas.width; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = groundY; y < canvas.height; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    if (this._scanlineActive) {
      ctx.fillStyle = 'rgba(0,255,208,0.12)';
      ctx.fillRect(0, this._scanlineY, canvas.width, 6);
    }
    if (this._pylonFlash > 0.02) {
      ctx.globalAlpha = this._pylonFlash;
      ctx.fillStyle = '#00ffd0';
      for (let i = 0; i < 3; i++) {
        const x = ((i * 420 - worldX * 0.65) % (canvas.width + 200) + canvas.width + 200) % (canvas.width + 200) - 100;
        ctx.fillRect(x, groundY - 140, 6, 140);
      }
    }
    ctx.restore();
  }

  _drawCanopyDapple(ctx, canvas, groundY) {
    ctx.save();
    ctx.fillStyle = 'rgba(234,255,176,0.10)';
    for (let i = 0; i < 5; i++) {
      const flick = 0.6 + 0.4 * Math.sin(this.tSec * (0.8 + i * 0.3) + i);
      ctx.globalAlpha = 0.5 * flick;
      const x = ((i * 240) % canvas.width);
      ctx.beginPath();
      ctx.ellipse(x, groundY + 30, 60, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawGlitchTear(ctx, canvas) {
    const rowY = Math.floor((mulberry32(Math.floor(this.tSec * 4))() ) * (canvas.height - 100));
    const rowH = 18;
    const shift = 6 * (mulberry32(Math.floor(this.tSec * 4) + 1)() * 2 - 1);
    const snapshot = ctx.getImageData(0, rowY, canvas.width, rowH);
    ctx.putImageData(snapshot, shift, rowY);
  }
}
