// Orchestrates the 8-layer parallax contract (spec §4.1.1), biome
// scheduling via novelty-curve segmentation (§4.1.3), and gamma-correct
// profile crossfading (§4.1.4). Each biome is pure data (BiomeProfiles.js);
// this file is the one place that knows how to render the contract.
import { BIOMES } from './BiomeProfiles.js';
import { generateSilhouette, drawTiledStrip } from './SilhouetteGenerator.js';
import {
  extractRidgePortrait, lithologyFromShares, landformWindow, relEnergyLadder, snowLine01For,
} from './RidgePortrait.js';
import { getWorld, DEFAULT_WORLD_ID } from './Worlds.js';
import { drawCityWorld } from './city/drawCity.js';
import { drawFarsideWorld } from './farside/drawFarside.js';
import { drawFathomWorld } from './fathom/drawFathom.js';
import { drawRedlineWorld } from './redline/drawRedline.js';
import { drawFoundryWorld } from './foundry/drawFoundry.js';
import { drawUnderstoryWorld } from './understory/drawUnderstory.js';
import { drawNaveWorld } from './nave/drawNave.js';
import { ParticleField } from './ParticleField.js';
import {
  sampleTerrainCurve, curveFacing, facingColorStops, reliefLitStripRGBA, reliefShadeStripRGBA,
  RELIEF_FALLOFF_PX,
} from './TerrainRelief.js';
import { Mandala } from './Mandala.js';
import { CymaticField } from './CymaticField.js';
import { KuramotoSwarm } from './KuramotoSwarm.js';
import { ChaosRibbon } from './ChaosRibbon.js';
import { ReactionDiffusion } from './ReactionDiffusion.js';
import { decorateStrip } from './Landmarks.js';
import {
  DANCE_LAYERS, DANCE_COL_W, danceOffset, danceScale, columnHeight01At, kickEnv, spectrumBars, orogenyHeightMul,
  pullbackHeightMul,
  mountainStripDrawHeight, ridgeSwell01, FAR_DANCE_LAYER,
  massifDrawHeight, massifRidgeHeight01, massifRidgeJagPx, massifClearing01,
  MASSIF_MARKER_SPEED_PX_S, MASSIF_MARKER_LIFE_SEC, nextMassifMarkerDelaySec,
  massifEqStep,
} from './MountainChoreo.js';
import {
  ridgeYSmooth, danceOffsetSmooth, danceScaleSmooth, assignBandFeatures, geoCrestOffset,
} from './GeoCrest.js';
import { occludedSpans, hillCurve } from './ConnectorHills.js';
import { strataBeds } from './RockStrata.js';
import {
  occludedFraction, stepDistantWave, swellCrest,
  isthmusReveal01, foregroundSwellCrest,
} from './DistantWave.js';
import { FlourishGate } from '../sim/FlourishGate.js';
import {
  seaLineY, oceanRowYs, waveRows, rowAlpha, OCEAN_HORIZON_FRAC, OCEAN_NEAR_FRAC,
  breakerLift, whitecapMask, rowPhaseDrift,
} from './Ocean.js';
import { buildWaveComponents, waveFieldSample, windSpeedForSeaState, easeSeaState } from './WaveField.js';
import {
  generateCatalogue, subPixelDraw, twinkleAmplitude, galacticBandCenterY, GALACTIC_BAND,
  extinction01, reddening01, generateDustLanes, generateDeepSky, generatePlanets, perceptualStretch,
} from './StarCatalogue.js';
import { CHARACTER_SCHEMES } from './dna/ShapeGrammar.js';
import {
  islands, ships, seaLifeSchedule, monsterSchedule, tsunamiSchedule,
  tsunamiActive, tsunamiProgress, tsunamiRowFrac, tsunamiPerspectiveScale,
  tsunamiCenterX, tsunamiLift, tsunamiDepthLift, tsunamiProfile, sprayFlecks,
  fishArcY, serpentHumpY,
  wrappedOffset, OCEAN_LIFE_WRAP_PX, OCEAN_LIFE_RATIO, TSUNAMI_WIDTH_PX,
  tsunamiHeightScale, TSUNAMI_OVERTOP_SCALE,
  tsunamiWithdrawalActive, tsunamiWithdrawal01,
} from './OceanLife.js';
import { ConstellationWeaver } from './ConstellationWeaver.js';
import { SpaceRidge } from './SpaceRidge.js';
import { SkyEnsemble } from './SkyEnsemble.js';
import { FarVignettes } from './FarVignettes.js';
import { NearField, NEARFIELD_RATIO } from './NearField.js';
import { GroundScatter, SCATTER_RATIO } from './GroundScatter.js';
import { flameFlicker, smokeDrift } from './Wildfire.js';
import { castBiomes, classifyTransition, intensityBudget, dayArc } from './Dramaturgy.js';
import { cycleMs as dayNightCycleMs, dayNight, celestialYFracFor, celestialXFracFor, horizonFade, sunScreenFrac, cyclePhase01 } from './DayNight.js';
import { fuseSections } from '../lyrics/SectionFusion.js';
import { celestialApproach } from './CelestialApproach.js';
import { snapCutsToReleases } from './BoundarySnap.js';
import { applyConductorSchedule } from '../core/ConductorTrack.js';
import { analyzeSongForm } from './SongForm.js';
import {
  MIN_SECTION_CUT_GAP_MS, SECTION_CUT_BUDGET_MS, MIN_SECTION_CUTS, sectionCutBudget,
} from '../audio/sectionBudget.js';
import { LightningFX } from './Lightning.js';
import { MeteorShowerFX } from './MeteorShower.js';
import { LightRig } from './LightRig.js';
import { hazeAlpha, hazeWarmMix, HAZE_WARM_COLOR, HAZE_EPS, hazeScatter } from './DepthHaze.js';
import { PERSONALITY } from './BiomePersonality.js';
import { isRendered, styleDials, shiftLightness, ensureContrast, ensureMinLightness } from '../render/VisualStyle.js';
import { Murmuration } from './Murmuration.js';
import { Atmosphere } from './Atmosphere.js';
import { CodaDirector } from '../sim/CodaDirector.js';
import { capFlashAlpha } from '../ui/Accessibility.js';
import { superformula, ModalRing } from '../render/oscillators.js';
import {
  computeLight, celestialScreenPos, groundGlowLights, rimGain, CELESTIAL_DEFAULT_XFRAC,
} from '../render/LightField.js';
import {
  clamp, clamp01, smoothstep, mulberry32, hashSeed, lerpHue, lerp,
} from '../utils/math.js';
import { LerpCache, rotateHueHex, hexToRgb, rgbToHsl } from '../utils/color.js';
import { spectralShiftDeg, easeSpectralShift } from '../render/spectral.js';
import { Role } from '../core/NoteEvent.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';
import { VoyagePhase } from '../sim/SkyVoyage.js';

const LAYER_RATIOS = { L1: 0.05, L2: 0.10, L3: 0.18, L4: 0.30, L5: 0.65, L6: 1.00, L7: 1.20 };
// Star catalogue spans the WHOLE frame. An earlier cut generated only over
// the top 78% so stars "behind" the mountains were not wasted — but valleys,
// shorter biomes, and the city skyline all expose sky well below that line,
// and the field read as a chunk sitting in the middle of the sky with a
// dead band above the ridgeline. Terrain occludes what it occludes; the
// catalogue has to cover every pixel that can ever be sky.
const STAR_SKY_FRAC = 1;
const STAR_CATALOGUE_COUNT = 560;
// Aerial perspective per parallax layer: how far each range's own fill is
// pulled toward the sky-horizon color before it is drawn. L5 is the
// nearest range and keeps the biome's authored silhouette color exactly;
// L2 is the furthest and sits nearly half way to the sky. See the
// layerTint() comment in draw() for why this exists.
const AERIAL_PULL = { L2: 0.46, L3: 0.29, L4: 0.13, L5: 0 };
// Crest rim (Stage 3 of the mountain overhaul): the backlit skyline edge
// used to be L4/L5-only, so the two BIGGEST ranges on screen got the LEAST
// depth treatment of the stack. Extended to L2/L3 at reduced,
// depth-appropriate alpha -- full strength stays reserved for the near
// anchors so the crest rim itself still reads as a depth cue, not a flat
// outline repeated at every layer.
const CREST_RIM_ALPHA = { L2: 0.35, L3: 0.55, L4: 1, L5: 1 };
// Cast shadow (Stage 5 of the mountain overhaul): a near range darkens the
// already-drawn farther range in a band just above its own crest. Capped
// low -- this is a subtle depth cue between adjacent ranges, not a hard
// silhouette of one range printed onto another.
const CAST_SHADOW_MAX = 0.18;
const CAST_SHADOW_BAND_PX = 46;
// Sub-bands the falloff is built from. Each traces the near crest at its own
// offset, so the fade is measured from the LOCAL crest everywhere rather than
// from one global extremum -- see _drawCastShadow for why that mattered.
// Four is enough that the steps are invisible at this contrast.
const CAST_SHADOW_STEPS = 4;
// Rock strata (Stage 6, ship-last/cuttable): thin bands, kept well under the
// crest/shoulder contrast so the skyline and the shoulder facets -- both
// already established depth cues -- stay the things you read first.
const STRATA_SPACING_PX = 34;
const STRATA_BAND_PX = 9;
// Beds now run near-horizontally and are truncated by the range's own
// silhouette (see RockStrata.js), so a tall summit legitimately shows several
// while a low shoulder shows one.
//
// Beds are counted UP FROM THE FOOT (the foot is the stable edge -- the crest
// dances), so this cap decides how far up the range they reach. The first
// value tried here was 8, which on a normal range stopped ~90px short of the
// crest and left every summit bare -- and the summits are the part of a range
// that is actually on screen, everything lower being behind the range in
// front of it. High enough to reach the top of a tall range; a runaway guard
// rather than a look control.
const STRATA_MAX_BEDS = 18;
const STRATA_DARKEN = 0.17;
// Ground aerial perspective: how strongly the far edge of the walking ground
// washes toward the air color, and how far down the frame that wash reaches
// before the ground is at its own full color. Kept lighter than any range's
// AERIAL_PULL -- the ground is the NEAREST thing in the scene, so it should
// only lose color right at the horizon where it meets the ranges.
// Crest rim: how far the biome's accent is dragged toward the light's own
// color, and how many stops the falloff gradient gets. Nine is well past the
// point where the ramp is visually smooth; the falloff is quadratic and the
// stroke is at most 7.5px wide, so nothing here needs fine resolution.
// Snow cap opacity at the summit, fading to nothing at the snow line. Snow is
// the brightest thing that can appear on a range, and a range must stay darker
// than the sky it is silhouetted against -- aerial perspective moves a distant
// object TOWARD the sky's value, it never takes it past.
// Ridge shading. The catch-light is a near-white ADDITIVE wash at the crest,
// so it is the range pass's largest single contribution to overall
// brightness; the shade is a multiply, so raising it costs nothing in hue.
// Trading a little catch-light for a little more shade lowers the scene's
// overall value while keeping -- slightly increasing -- the contrast that
// makes the ranges readable. Both were set when this pass was the ONLY
// shading a range got; it is now one of several.
const RIDGE_CATCHLIGHT_ALPHA = 0.13;
const RIDGE_SHADE_STRENGTH = 0.36;
// Foreground swell (the isthmus reveal). Amplitude is absolute rather than
// relief-derived: this water is at the viewer's feet, so its scale is set by
// how near it is, not by how tall the mountains behind it happen to be.
const FG_SWELL_AMP_PX = 26;
const FG_SWELL_DROP_PX = 26;   // how far below the ground line the shore sits
// How far the water is darkened below the sky color it reflects.
const FG_SWELL_DARKEN = 0.30;
const FG_SWELL_ALPHA = 0.86;
const FG_SWELL_EDGE_ALPHA = 0.42;
const SNOW_ALPHA = 0.34;
const RIM_LIGHT_MIX = 0.35;
const RIM_GRADIENT_STOPS = 8;
const GROUND_AERIAL_ALPHA = 0.34;
const GROUND_AERIAL_FALLOFF = 0.38;
// Aerial perspective, optical half: how much each layer's strip bake is
// downsampled before being stretched back up (generateSilhouette's
// softenScale), so distant ranges lose edge acuity the same way AERIAL_PULL
// already pulls their color toward the sky. L5 stays at 1 (full crisp) --
// DepthHaze already never washes it, for the same reason: it's the
// foreground anchor the eye calibrates every other layer's depth against.
const AERIAL_SOFTEN = { L2: 0.40, L3: 0.62, L4: 0.85, L5: 1 };
// Section height is a draw-time multiplier, never baked (generateSilhouette's
// own HEADROOM refit erases in-strip height changes on L2/L3 -- see the
// mountain-overhaul plan). Range chosen so the quietest section is visibly
// smaller and the loudest visibly taller without either reading as broken.
const SECTION_HEIGHT_MUL = [0.88, 1.16];
const LAYER_EQ_RATIO = 0.06; // between L1 (celestial) and L2 (far mountains)
// Terrain footing contact shadow: layered strokes along the ridge's own
// smooth curve approximate the soft vertical falloff a single gradient rect
// used to give a flat ground line -- widest/faintest pass first so the
// stack reads as one soft AO band, not three hard-edged strokes.
const TERRAIN_FOOTING_AO_PASSES = [
  { lw: 30, alpha: 0.035 },
  { lw: 18, alpha: 0.06 },
  { lw: 8, alpha: 0.10 },
];

// Section-detection schedule (_buildSchedule): a real bar grid already gives
// plenty of analysis resolution; these only govern the free-time/no-tempo
// fallback and the cut budget/spacing that apply either way.
const ANALYSIS_MIN_POINTS = 64;       // fallback analysis-point floor regardless of duration
const ANALYSIS_TARGET_STEP_MS = 2000; // ~1 analysis point every 2s for longer songs
// How sure the SSM structure read (StructureAnalyzer) must be before it
// replaces the band-energy schedule. A through-composed piece with no
// repeats and no sharp boundaries scores below this and keeps the old path.
const SSM_CONFIDENCE_FLOOR = 0.45;
// Novelty below this fraction of the song's strongest turn is noise, not a
// section boundary. Mirrors the SSM path's own floor so the two detectors
// refuse to manufacture boundaries on the same terms.
const NOVELTY_NOISE_FLOOR = 0.15;

// --- The shutter: the screen closing down over a section boundary --------
// A hard floor between bites. Section boundaries may legally sit 11s apart,
// and two near-total blackouts that close together read as the game
// malfunctioning rather than as punctuation.
const SHUTTER_MIN_GAP_MS = 45000;
// How much of the screen each half may swallow. Was 0.5 -- with both halves
// closing that is a total blackout, which is more than any transition needs
// to earn its point.
const SHUTTER_MAX_COVER = 0.34;
const WORLD_SPEED_PX_S = 220;
const BAND_COUNT = 7;
const EQ_ATTACK_SEC = 0.08;
const EQ_RELEASE_SEC = 0.6;
const EQ_MAX_HEIGHT_FRAC = 0.4; // never exceed 40% of screen height, however excited the section is

// --- Ridge volume: the dancing ranges read as MASS, not as flat cutouts ---
// Sampling step (px) for the smooth crest polyline shared by the crest
// stroke and the volume pass.
// The slice width used when no PerfGovernor is present (tests, and any
// caller that never wired one up). Matches the governor's own level-0 value:
// with nothing telling us to economize, render at full resolution. Must
// divide the 2048px strip evenly -- see PerfGovernor.danceColumnWidth.
const DANCE_COL_FINE = 16;
const CREST_STEP_PX = 8;
// A summit only earns shoulders if it stands this far (px) above the
// saddles either side of it -- otherwise every ripple in the noise ridge
// would sprout spurs and the skyline would turn to visual noise.
const SHOULDER_MIN_PROMINENCE = 26;
// ...and no two summits within this screen distance both get them.
const SHOULDER_MIN_SPACING_PX = 190;
const SHOULDER_MAX_PER_RANGE = 5;
// The near spur runs this fraction of the summit's height out to the side
// as it descends toward the viewer; the far one is shorter and fades out.
const SHOULDER_NEAR_RUN = 0.62;
const SHOULDER_FAR_RUN = 0.42;
// How far a spur descends, as a multiple of its summit's own prominence.
// Big near summits reach the ground band on their own account; small
// distant ones stay local instead of streaking across the frame.
const SHOULDER_RELIEF_RUN = 2.4;
// Deliberately quieter than the crest line itself (which strokes at up to
// 0.38): these are interior form, and reading them as a second skyline is
// exactly the noise we're avoiding.
const SHOULDER_FACET_ALPHA = 0.22;
const SHOULDER_LINE_ALPHA = 0.20;
// The same warm catch-light generateSilhouette bakes along the skyline, so
// a spur's lit edge reads as the same sun striking the same rock.
const SHOULDER_LIT = '#fff8e6';
// Facet facing: the celestial owns the side, the existing stripX hash is a
// small per-summit perturbation so a whole range doesn't flatten into one
// uniformly-lit wall. A summit only flips against the sun when its hash is
// strongly opposed (sin past this threshold).
export const FACET_SUN_FLIP = 0.62;

/**
 * Which way a summit's near (shaded) facet leans. +1 = right, -1 = left.
 * Omitting the light falls back to the original stripX coin-flip so any
 * caller that hasn't been handed a celestial keeps today's look.
 *
 * The shaded face is the one AWAY from the light (sun on the right shades
 * the left). The hash is allowed to overturn that on a minority of
 * summits -- enough variety that ridges stay ridges, not a lit slab.
 */
export function shoulderFacetSide(stripX, lightX = null, summitX = null) {
  const hash = Math.sin(stripX * 0.0137);
  if (!Number.isFinite(lightX) || !Number.isFinite(summitX)) {
    return hash >= 0 ? 1 : -1;
  }
  const sunBias = summitX < lightX ? -1 : 1;
  if (hash * -sunBias > FACET_SUN_FLIP) return -sunBias;
  return sunBias;
}
// How hard the volume pass leans on each range. Follows the dance ordering
// (MountainChoreo.DANCE_LAYERS): the far skyline is the dramatic one, so it
// gets the most sculpting, and the near hills only enough to stop reading
// as flat cutouts. L5 sits right behind the characters -- anything strong
// there competes with them for attention.
const RIDGE_VOLUME_STRENGTH = { L2: 1.0, L3: 0.85, L4: 0.6, L5: 0.4 };

// --- Connector hills: green country bridging a hidden dancing skyline -----
// A humble forest/grass green. The biome's own halo is dragged most of the
// way toward it, so the country belongs to this world without ever becoming
// the biome's accent colour.
const CONNECTOR_GREEN = '#5f8f5a';
const CONNECTOR_GREEN_MIX = 0.72;
const CONNECTOR_MIN_LIGHTNESS = 0.26;
// How far the country rolls down from the occluding crest at full burial.
const CONNECTOR_DESCEND_PX = 90;
// Quiet by design: this is the subtlest thing in the scene, and it has to
// stay under the crest it's rescuing rather than becoming a second skyline.
// But subtle is not the same as absent -- the first pass measured out at a
// peak of 0.12 once the intensity budget had its say, which read as nothing
// at all against a dark sky.
const CONNECTOR_ALPHA = 0.55;
// How far past its own foot the country keeps going before it dissolves.
// Filling all the way down to the ground band instead reads as a broad wash
// over a third of the frame rather than as hills -- the dead band this is
// bridging is between the crest that hid the ridge and the range in front,
// not everything below it.
const CONNECTOR_BAND_PX = 120;

// --- Distant wave: what stands in for a buried dancing ridge --------------
// See DistantWave.js. Amplitude is a fraction of the far range's own relief,
// so the swell is scaled to the scene it replaces rather than to a fixed px
// number that would read as a ripple in one framing and a tidal wave in
// another. Floored/capped so it survives a flat range and can't tower.
const WAVE_AMP_FRAC = 0.20;
const WAVE_AMP_MIN_PX = 10;
const WAVE_AMP_MAX_PX = 46;
// Where the swell sits: a little above the ridge's mean crest, so the water's
// own crests break the near skyline (which is the entire point -- a wave
// drawn where the ridge already lost the argument would be invisible too).
const WAVE_LIFT_PX = 26;
// Quiet, like the connector country: this is the back of the scene seen
// through a lot of air, not a feature competing with the ranges in front.
const WAVE_ALPHA = 0.40;
// How far below its crest the body fills before dissolving. The near ranges
// cover most of it; this only has to reach past their skyline.
const WAVE_BAND_PX = 150;
// A thin sunlit line on the crest itself -- the one cue that reads as water
// rather than as another hazy ridge.
const WAVE_GLINT_ALPHA = 0.30;

// The ground must never sink into the void, whatever the biome's silhouette
// started at. Chosen to clear the film-grade wash and the vignette that
// still follow it -- both only ever push toward black, and the ground sits
// in their darkest (bottom, off-centre) reach.
const GROUND_MIN_LIGHTNESS = 0.30;
const MILESTONE_METEOR_BASE = [5, 8, 14];
const DROP_METEOR_BASE = 12;
const ACHROMATIC_SAT_THRESHOLD = 0.08;
// Song-form recognition: how far a structural label's signature hue-shift
// can swing (degrees). Bounded so a section reads as "the chorus color"
// without leaving the biome's own palette behind. Layered on top of
// KeyDirector's key-driven rotation via _rotated.
const FORM_HUE_BIAS_MAX = 40;
const FORM_HUE_TAU_SEC = 1.5; // section changes glide their hue, never snap
// Lyric-structure intensity-budget multiplier by section kind (SectionFusion) --
// a chorus/bridge reads louder, an intro/outro settles. Unrecognized/absent
// kind (no lyric data at all) multiplies by exactly 1 -- a strict no-op.
const KIND_BUDGET_MUL = { chorus: 1.15, bridge: 1.3, instrumental: 1.1, intro: 0.9, outro: 0.85, verse: 1.0 };
const OCEAN_WATER_BLUE = '#3ec8f5'; // vivid teal-cyan sea (ocean vibe first)
const OCEAN_DEEP_BLUE = '#0d3a5c'; // abyssal under-tint
const NIGHT_SKY_COLOR = '#060814'; // near-black space, slightly cool
const SPACE_NEBULA_A = '#1a2850'; // deep indigo wash
const SPACE_NEBULA_B = '#2a1860'; // violet space dust
const MOON_COLOR = '#dfe6f2';
const MOON_HALO_COLOR = '#aab8d8';

// Fog band geometry (_drawFogBanks). Pure and exported so the "the gradient
// reaches zero before the band edge" property is directly testable, rather
// than only checkable by eyeballing a screenshot.
//
// The bank used to pour a CIRCULAR gradient (radius 0.45*canvasWidth,
// centered mid-band) straight into a fillRect spanning the band -- but the
// band is far shorter than the gradient is tall, so both the top and bottom
// edges sliced the falloff at ~65% alpha, leaving a dead-flat horizontal
// line across the full canvas width (once per fog bank, stacked under
// 'lighter' compositing). That was the hard line reported at ~0.15h, and
// its fainter twin at ~0.70h, the band's other edge.
//
// Fix: paint an ELLIPSE instead of a circle, squashed just enough that it
// reaches zero exactly at the band's own top/bottom -- same footprint,
// same horizontal reach, nothing left for the rect to cut.
export const FOG_BAND_TOP_FRAC = 0.15;
export const FOG_BAND_HEIGHT_FRAC = 0.55;

/** @returns {{cy:number, r:number, yScale:number, bandTop:number, bandBottom:number}} */
export function fogBandGradientGeometry(canvasWidth, canvasHeight) {
  const bandTop = canvasHeight * FOG_BAND_TOP_FRAC;
  const bandH = canvasHeight * FOG_BAND_HEIGHT_FRAC;
  const cy = bandTop + bandH * 0.5;
  const r = canvasWidth * 0.45;
  const yScale = (bandH * 0.5) / r;
  return { cy, r, yScale, bandTop, bandBottom: bandTop + bandH };
}

/** The gradient's own alpha FRACTION (0..1, before the bank's overall alpha
 *  multiplier) at absolute canvas y, for a bank centered per `geo`. Used by
 *  the draw call's own math and directly by tests -- no canvas needed. */
export function fogBandAlphaFractionAtY(geo, y) {
  const dy = (y - geo.cy) / geo.yScale;
  const d = Math.abs(dy);
  return d >= geo.r ? 0 : 1 - d / geo.r;
}

export class BiomeManager {
  constructor({ conductor, energyCurves, durationMs, canvasWidth, canvasHeight, groundY, songSeed, groundField = null, fire = null, flood = null, customBiome = null, lyricSections = null, structure = null, conductorSchedule = null, worldId = null }) {
    this.conductor = conductor;
    this.energyCurves = energyCurves;
    this.durationMs = durationMs || 0;
    this._dayNightCycleMs = dayNightCycleMs(this.durationMs);
    this.w = canvasWidth;
    this.h = canvasHeight;
    this.groundY = groundY;
    this.groundField = groundField;
    this.fire = fire; // FireDirector (src/sim/FireDirector.js), owned by Simulation -- see _drawWildfire()
    this.flood = flood; // FloodDirector (src/sim/FloodDirector.js), owned by Simulation -- see armFromTsunami() in update() and _drawFlood()
    this.customBiome = customBiome || null;
    this.world = getWorld(worldId || DEFAULT_WORLD_ID);
    this.worldId = this.world.id;
    // Palettes live on the world. Alpine keeps the stock biomes (+ optional
    // MIDI-derived custom). City worlds bring their own night palettes and
    // ignore the alpine custom biome so a generated mountain skin never
    // paints itself onto a skyline.
    this.profiles = this.world.palettes.slice();
    if (customBiome && this.world.kind === 'alpine') {
      this.profiles = [...this.profiles, customBiome];
    }
    this._lastSectionIdx = null;
    // Distant wave (DistantWave.js): how buried L2 currently is, whether the
    // swell has taken its place, and how far through the crossfade we are.
    // The occlusion figure is refreshed every frame from draw()'s geometry,
    // but only ever ACTED on at a section boundary.
    this._ridgeOcclusionRaw = 0;
    this._ridgeOcclusion01 = 0;
    this._distantWaveOn = false;
    this._distantWaveMix = 0;
    this._cutFlash = 0;
    this._shutterStartMs = -Infinity;
    this._shutterBarMs = 500;
    // The shutter is the most aggressive thing on screen; it gets the same
    // hard-floor rate limiter the character flourishes use.
    this._shutterGate = new FlourishGate({ minGapMs: SHUTTER_MIN_GAP_MS, chance: 1 });
    this.shutterDebug = null;
    this.cutFlashJustFired = false;
    // Edge-triggered once per section boundary, any transition style -- other
    // systems (character tumble choreography) hang a rare accent off this.
    this.sectionJustChanged = false;
    this.lastTransitionStyle = null;
    // Lyric-fused structure (SectionFusion): a section's `kind` (verse/
    // chorus/bridge/instrumental/intro/outro) and its lyric intensity/
    // valence, when lyrics were found and fused into the schedule below.
    // Absent lyricSections -> currentKind stays null and every one of
    // these stays at its neutral default, forever -- a strict no-op.
    this._lyricSections = lyricSections;
    this.currentKind = null;
    this.lyricIntensityEased = 0.4;
    this._kindBudgetMulEased = 1;
    this.budget = 1;
    this.openingGain = 1; // OpeningDirector, set per-step by Simulation
    this.hypeBoost = 1; // drop-surge multiplier from the HypeDirector
    this.focusMul = 1; // FocusDirector's 'sky' dampener -- 1 unless some other subject has focus
    this.stillnessMul = 1; // CutDirector's held-breath dip right after an authored drop/apotheosis cut
    this.mandalaScaleMul = 1; // swells while Midasus dances near the celestial
    this._progress = 0;
    // Safe defaults before the first update() so a zero-dt first frame
    // (draw before step) never feeds NaN into canvas gradients and kills rAF.
    this.calmLevel = 0;
    this._hazeMul = 1;
    this.dustLevel01 = 0; // set externally each frame from Simulation.quake.dustLevel01
    this.smokeLevel01 = 0; // set externally each frame from Simulation.fire.smokeLevel01
    this._ribbonScaleMul = 1;
    this.lerpCache = new LerpCache();
    this.tSec = 0;
    this._starSeed = mulberry32(9001);
    // Layered starfield generated from a real catalogue (StarCatalogue.js):
    // luminosity function (faint stars vastly outnumber bright ones),
    // spectral-class-weighted blackbody color, a galactic-plane density
    // band, and sub-pixel stars that contribute partial light instead of
    // vanishing or getting rounded up -- the "incomprehensibly distant"
    // read the brief asked for. Generated once and cached, exactly like
    // the silhouette strips, so the density costs nothing per frame; only
    // twinkle (in _drawStarfield) is computed live. Bumped from a flat 96
    // to 280 -- still cheap since only the brightest slice (layer 2) pays
    // for a radial-gradient hero glow; the rest are one fillRect each.
    // The field is generated over the full frame: every pixel that can ever
    // be sky (valleys, city streets of sky between towers, the zenith) gets
    // stars, and the mountain / skyline stack paints over the rest. A
    // shorter catalogue left a dead band above the ridgeline that read as
    // "the stars are a chunk in the middle of the sky."
    const catalogue = generateCatalogue(hashSeed(`${songSeed}:starcat`), STAR_CATALOGUE_COUNT, this.w, this.h * STAR_SKY_FRAC);
    // See StarCatalogue.perceptualStretch for why this is applied to
    // subPixelDraw's OUTPUT below, never fed in as its input.
    // Hero glow (layer 2) is reserved by RANK, not by an absolute magnitude
    // cutoff -- the realistic population makes true hero-magnitude stars
    // vanishingly rare at this sample size, so a fixed threshold could
    // easily reserve zero. A guaranteed slice keeps the sky visually alive
    // without touching the underlying (correctly faint-dominated) catalogue.
    // A fixed 6 (regardless of population) read as a sparse scatter of
    // glow-dots rather than "a sky full of stars" -- the un-glowed cheap
    // dots that make up the rest are real (see perceptualStretch) but
    // small and easily washed out by anything drawn over them (haze,
    // cloud, nebula washes), so most of a genuinely full-looking sky needs
    // to come from the reliably-visible glow tier, not the faint majority.
    const byMag = catalogue.slice().sort((a, b) => a.mag - b.mag);
    const heroCutMag = byMag[Math.min(byMag.length - 1, Math.floor(byMag.length * 0.08))].mag;
    const midCutMag = byMag[Math.min(byMag.length - 1, Math.floor(byMag.length * 0.35))].mag;
    // Every position below is cached as a FRACTION of the field it was
    // generated over (xFrac/yFrac), not an absolute pixel -- the canvas
    // BiomeManager actually draws into is not always this.w x this.h. The
    // camera's off-frame pull-back (CameraDirector.zoom) widens the logical
    // stage Renderer hands to draw() (stage.width = nominalW/zoom, plus a
    // shake margin), so a live game frame can be meaningfully wider than
    // the dimensions the catalogue was built against. Baking absolute pixel
    // coordinates here meant every star, dust lane, deep-sky smudge, and
    // planet stayed pinned to their ORIGINAL narrower span while the sky
    // around them widened -- reading as the whole field crammed into a
    // band down the middle instead of spread edge to edge. Storing a
    // fraction and rescaling against the real canvas at draw time (see
    // _drawStarfield) fixes that at every zoom level and every resize.
    const skyH = this.h * STAR_SKY_FRAC;
    this.stars = catalogue.map((s) => {
      const { drawSize, drawAlpha: rawAlpha } = subPixelDraw(s.sizePx, s.brightness);
      const drawAlpha = perceptualStretch(rawAlpha);
      const layer = s.mag <= heroCutMag ? 2 : s.mag <= midCutMag ? 1 : 0;
      return {
        xFrac: s.x / this.w, yFrac: s.y / skyH, phase: s.phase,
        size: drawSize, bright: drawAlpha, layer,
        hue: s.hue,
        mag: s.mag, altitude01: s.altitude01, // read by twinkleAmplitude in _drawStarfield
        // Air path, resolved once: low stars are permanently dimmer and
        // redder than the same star overhead (StarCatalogue.extinction01).
        // Constant per star, so it belongs in the cache, not the frame loop.
        ext: extinction01(s.altitude01),
        redden: reddening01(s.altitude01),
      };
    });
    // The rest of the sky's furniture, all generated over the same sky
    // region and cached alongside the stars (same fraction convention):
    // dark nebulae that break up the milky wash, a few resolved deep-sky
    // smudges, and the planets.
    const toFrac = (list) => list.map((o) => ({
      ...o, xFrac: o.x / this.w, yFrac: o.y / skyH,
    }));
    this.dustLanes = toFrac(generateDustLanes(hashSeed(`${songSeed}:dust`), 7, this.w, skyH))
      .map((d) => ({ ...d, rxFrac: d.rx / this.w, ryFrac: d.ry / skyH }));
    this.deepSky = toFrac(generateDeepSky(hashSeed(`${songSeed}:deepsky`), 6, this.w, skyH))
      .map((o) => ({ ...o, rFrac: o.r / skyH }));
    this.planets = toFrac(generatePlanets(hashSeed(`${songSeed}:planets`), 3, this.w, skyH));
    this._glitchTimer = 2 + this._starSeed() * 3;
    this._glitchActiveMs = 0;
    this._scanlineY = 0;
    this._pylonFlash = 0;
    this._eqSmoothed = new Float32Array(BAND_COUNT);
    // The massif reads the same 7 raw bands but through its own far slower
    // attack/release (massifEqStep) -- see MountainChoreo.js's
    // MASSIF_EQ_ATTACK_SEC/MASSIF_EQ_RELEASE_SEC doc for why a mountain
    // range sold as impossibly vast can't be allowed to hop on every kick.
    this._massifEqSmoothed = new Float32Array(BAND_COUNT);
    // The geological equalizer: L4's crest reads the same 7 bands as the
    // horizon EQ and the massif, but through per-song, per-band geological
    // features (cliff/arete/knob/outcrop/terrace) pinned to fixed terrain
    // positions -- a distinct silhouette vocabulary, "relevant" to the same
    // music without repeating either sibling equalizer's look.
    this._geoFeatures = assignBandFeatures(hashSeed(`${songSeed}:geocrest`));
    // Far ocean: denser row stack for a readable water plane between ridges.
    // Infinite flat plane of water in perspective, not a solid band (a
    // solid band at ridge height is fully occluded by the opaque ridges).
    this._oceanRows = waveRows(hashSeed(`${songSeed}:ocean`), 28);
    // Spectral depth pass, layered under the rows above (see WaveField.js):
    // a real Pierson-Moskowitz sea, re-sampled whenever the eased sea state
    // moves. Seeded once so it's deterministic per song like everything else.
    this._waveFieldSeed = hashSeed(`${songSeed}:wavefield`);
    this._seaState = 0;
    this._waveComponents = buildWaveComponents(this._waveFieldSeed, windSpeedForSeaState(0), 24);

    // The mountains dance: a groove level (smoothed global energy) drives a
    // traveling ridge wave through every range, and each kick sends a
    // bounce rolling from the near hills out to the far peaks.
    this._danceGroove = 0;
    // Stage 2 (ridge deformation): a slower one-pole on _danceGroove itself
    // -- "has this section been loud for a while", distinct from the kick's
    // instant transient. Flanks swell on this; summits sharpen on the kick.
    this._danceSustain = 0;
    this._danceKickMs = -Infinity;
    this._danceKickAmp = 0;
    this._danceWorldX = 0;
    this.fever = 0; // player fever (Simulation.fever.level): cranks the dance and the runners
    // Parallel-universe drift (ParallelUniverseDirector, set externally each
    // step): cosmetic-only per-section variation. Neutral until the first shift.
    this.universeHueDeg = 0;
    this.universeHazeMul = 1;
    this.universeWindMul = 1;
    this.universeTerrainMul = 1;
    // Float tilt (CameraDirector.floatTilt, set externally each step): a
    // small per-layer-scaled rotation applied in _drawLayer while the
    // camera is pulled back, so nearer ranges lean more than far ones --
    // see LAYER_TILT_PIVOT_KEY below for why the ground itself never tilts.
    this.floatTilt = 0;
    this.orogenyGrowth = 0.1; // mountain-building arc (Simulation.orogeny.growth), set externally each step
    // Off-frame pull-back (CameraDirector.zoom, set externally each step): 0
    // at normal framing, 1 at the hardest pull-back (ZOOM_MIN). Grows the
    // nearer ranges (see MountainChoreo.pullbackHeightMul) so a wide shot
    // doesn't just shrink the world in place -- the ridges nearest the
    // player rise up to close the flat gap a pull-back would otherwise open.
    this.pullback01 = 0;
    // The massif's scale markers (MountainChoreo.js): tiny, ordinary-parallax
    // silhouettes that occasionally drift across its face -- the comparison
    // against something the eye already knows the size of is what actually
    // sells "this is unfathomably huge," not raw height alone.
    this._massifRand = mulberry32(hashSeed(`${songSeed}:massif`));
    this._massifMarkers = []; // {x0, y, bornMs}
    this._massifNextSpawnMs = nextMassifMarkerDelaySec(this._massifRand) * 1000;
    // Miniature characters running along the near ranges' ridges — an
    // independent trio per range so the depths don't mirror each other.

    this.songSeed = songSeed;
    this.visualStyle = 'rendered'; // set via setVisualStyle from Simulation / main
    this.strips = new Map(); // biomeName -> { L2, L3, L4, L5 }

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
      ['sunshine', 20, '#fff6c8', 0],
      ['fog', 14, '#c9d6e0', 0],
      ['wind', 40, '#dfe8ee', 0],
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
    // Near-field foreground occluders: the mirror image of farVignettes at
    // the OTHER end of the depth stack -- huge biome-landmark silhouettes
    // sweeping past faster than the characters, close enough to occlude
    // them. Drawn in drawForeground(), after everything else.
    this.nearField = new NearField(songSeed);
    this.groundScatter = new GroundScatter(songSeed);

    this._buildSchedule(conductor.barGrid, energyCurves, durationMs, songSeed, lyricSections, structure, conductorSchedule);
    // Strips are baked AFTER the schedule exists (moved here from right
    // after construction's field init) so _buildStripSet can key each
    // profile's per-label variant (lithology/landform/landmarks/heightMul --
    // see _buildSchedule's this._profileVariants) off sections that now
    // actually exist. setVisualStyle() also calls _rebuildStrips() directly,
    // standalone, after this -- this._profileVariants is still whatever
    // _buildSchedule last computed, so that path is unaffected.
    this._rebuildStrips();
    // MIDI custom biome: cast every section into the generated world so the
    // dropped file IS the place, while stock demos keep dramaturgical casting.
    // MIDI custom biome: alpine only — city worlds keep their own palettes.
    if (this.customBiome && this.world.kind === 'alpine') this.loadCustom(this.customBiome);

    // Ocean ecosystem: islands + ships sit on the water always; sea life,
    // the rare monster, and tsunamis (anchored on the song's loudest bars)
    // are the phenomena-gated extras.
    this._islands = islands(hashSeed(`${songSeed}:islands`), 7);
    this._ships = ships(hashSeed(`${songSeed}:ships`), 5);
    this._seaLife = seaLifeSchedule(hashSeed(`${songSeed}:sealife`), durationMs, { minGapMs: 3500, maxGapMs: 9000 });
    this._seaLifeIdx = 0;
    this._monsters = monsterSchedule(hashSeed(`${songSeed}:monster`), durationMs);
    this._monsterIdx = 0;
    this._tsunamis = tsunamiSchedule(hashSeed(`${songSeed}:tsunami`), durationMs, this._oceanHotspotMs || []);
    this._tsunamiIdx = 0;
    this._tsunamiFlecks = sprayFlecks(hashSeed(`${songSeed}:tsunamispray`));
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
    // One Spectrum: the song's detected key (pitch class 0..11, fed from
    // KeyDirector) plus how far the world should key to it (0..1). The
    // spectral key shift is eased (one-pole, characters-style) so a key
    // change GLIDES the whole frame as one body -- the world and the
    // characters never disagree, and nothing ever snaps (reduced-flash
    // safe). This subsumes the old slow paletteRotation drift (same tonic
    // signal at 7.5deg/semitone); the spectral shift lands the anchor ON
    // the key at the full 30deg/semitone.
    this.tonic = null;
    this.spectralAmount = 1;
    this._specShift = 0;       // eased degrees, read by _rotated
    this._specShiftTarget = 0;
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
    this._lakeReflectGroundY = null; // set each frame by _drawGround; read by drawCharacterReflections
    this.dropAtMs = -Infinity; // set externally from HypeDirector.dropAtMs each frame
    this._lastSeenDropAtMs = -Infinity;

    // The Unraveling (Movement V): set externally from CodaDirector.unravel
    // each frame.
    this.unravel = 0;

    // The Reel (Movement VI): set externally, persisted accessibility toggle.
    this.reducedFlash = false;

    // conductor outlives every song (see main.js); dispose() must undo
    // exactly these three subscriptions or a replay stacks a fresh
    // BiomeManager's listeners on top of every previous one still firing.
    this._unsub = [
      conductor.onBar(() => { this._scanlineActive = true; this._scanlineY = 0; this.cymatics.onBar(); }),
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
      }),
      conductor.on(Role.MELODY, (evt) => { this.weaver.onMelody(evt); }),
    ];
  }

  /** Undo every conductor subscription made at construction. */
  dispose() {
    for (const unsub of this._unsub) unsub();
    this._unsub.length = 0;
  }

  _buildSchedule(barGrid, energyCurves, durationMs, songSeed, lyricSections = null, structure = null, conductorSchedule = null) {
    // Without a real bar grid (free-time / tempo-less audio), the analysis
    // resolution used to collapse to a fixed 9 points regardless of song
    // length -- with novelty forced to 0 for the first 4 and a minimum peak
    // spacing measured in THOSE 9 indices, at most one cut could ever be
    // placed, so section detection silently bottomed out at exactly 3
    // sections no matter how long or eventful the song was. Scale the
    // fallback resolution with duration instead.
    let barTimes = barGrid.length >= 8
      ? barGrid.map((b) => b.ms)
      : this._evenSplit(durationMs, Math.max(ANALYSIS_MIN_POINTS, Math.round(durationMs / ANALYSIS_TARGET_STEP_MS)));
    if (barTimes.length < 2) barTimes = [0, durationMs];

    const vectors = barTimes.map((ms) => (energyCurves ? energyCurves.sampleAll(ms) : new Array(7).fill(0)));
    // Hotspot bar times (top-2 by scalar bar energy) -- anchors for things
    // that should land where the song is actually loudest, e.g. tsunamis.
    const barScalarEnergy = vectors.map((v) => v.reduce((a, x) => a + x, 0) / 7);
    this._oceanHotspotMs = barTimes
      .map((ms, i) => [barScalarEnergy[i], ms])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .map((p) => p[1]);
    const means = barTimes.map((_, i) => {
      const start = Math.max(0, i - 3);
      const slice = vectors.slice(start, i + 1);
      const avg = new Array(7).fill(0);
      for (const v of slice) for (let k = 0; k < 7; k++) avg[k] += v[k] / slice.length;
      return avg;
    });
    // Compare each point against ~4 samples back, clamped to 0 instead of
    // unconditionally returning 0 for the first 4 -- the opening material
    // can now register as a boundary too, instead of being silently exempt.
    const novelty = barTimes.map((_, i) => {
      const j = Math.max(0, i - 4);
      if (j === i) return 0;
      let d = 0;
      for (let k = 0; k < 7; k++) d += (means[i][k] - means[j][k]) ** 2;
      return Math.sqrt(d);
    });

    // Minimum spacing between cuts, expressed in TIME (not analysis-point
    // indices) so it means the same thing regardless of whether barTimes
    // came from a fine bar grid or the coarser even-split fallback above --
    // an 8-index minimum was ~16s on a bar grid but only ~2 fallback points
    // (its whole bug) in the other.
    const avgStepMs = barTimes.length > 1 ? (barTimes[barTimes.length - 1] - barTimes[0]) / (barTimes.length - 1) : durationMs;
    const minGap = Math.max(1, Math.round(MIN_SECTION_CUT_GAP_MS / Math.max(1, avgStepMs)));
    // Cut budget scales with song length instead of a flat 7 -- a 5-minute
    // song can now express close to a section every 24s.
    const maxCuts = sectionCutBudget(durationMs);
    const lastIdx = barTimes.length - 1;
    const peakNovelty = Math.max(...novelty, 0);
    /** Greedy strongest-first peak picking. `floorMul` is the noise floor as a
     *  fraction of the strongest novelty: the normal pass refuses to
     *  manufacture boundaries out of near-flat material, and the relaxation in
     *  _ensureMinimumSections re-runs with it dropped. */
    const pickPeaks = (floorMul) => {
      const out = [];
      const sorted = novelty.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      for (const [v, i] of sorted) {
        if (out.length >= maxCuts) break;
        if (v <= 1e-6) continue;
        if (v <= peakNovelty * floorMul) break;
        // Spaced against the song's own edges as well as against each other.
        // Index 0 and the final index are ALWAYS cuts, so a peak crowding
        // either one produces a runt section -- and a lone peak landing on the
        // final index collapses the schedule to a single section outright
        // (cuts [0, last, last], whose first pair is then dropped as empty).
        // A big outro or fade-out makes that very reachable on real songs.
        if (i < minGap || lastIdx - i < minGap) continue;
        if (out.some((p) => Math.abs(p - i) < minGap)) continue;
        out.push(i);
      }
      out.sort((a, b) => a - b);
      return out;
    };
    const peaks = pickPeaks(NOVELTY_NOISE_FLOOR);

    // The SSM read (StructureAnalyzer) wins when it's confident: its
    // boundaries come from a checkerboard kernel over a chroma+timbre
    // self-similarity matrix rather than a difference of trailing band-energy
    // means, and it hears harmony, which the novelty path above cannot.
    //
    // Its boundaries arrive as TIMES, not as indices. They used to arrive as
    // cut indices, which was silently wrong whenever the two sides built
    // different analysis grids: with no bar grid, AudioAdapter steps a flat
    // 2000ms while _evenSplit here returns n+1 points at a much finer step for
    // songs under ~128s. Indices from one grid read against the other put every
    // cut at the wrong time, bunched toward the song's start -- and the old
    // `<= barTimes.length - 1` guard never caught it, because the array being
    // indexed was the longer of the two. Times are unambiguous; indices are
    // only meaningful next to the grid that produced them.
    //
    // Everything falls back cleanly: MIDI, the demo timeline, free-time audio
    // and any low-confidence read keep the band-energy schedule exactly as it
    // was.
    const ssmCuts = structure && Array.isArray(structure.boundariesMs)
      ? this._cutsFromTimes(structure.boundariesMs, barTimes)
      : null;
    const ssmUsable = structure
      && structure.confidence >= SSM_CONFIDENCE_FLOOR
      // At least two sections. A one-section read is the detector reporting it
      // found nothing, and must never displace an energy read that found real
      // boundaries (StructureAnalyzer caps its confidence for this reason too).
      && ssmCuts && ssmCuts.length >= 3;
    this.structureConfidence = structure ? structure.confidence : 0;

    const chosen = ssmUsable ? ssmCuts : [0, ...peaks, lastIdx];
    // _ensureMinimumSections can DISCARD `chosen` wholesale -- re-picking from
    // the energy novelty with the noise floor dropped, or falling back to even
    // time-splits. So provenance cannot be decided before it runs: this used to
    // be set from `ssmUsable` alone, one line above, and a schedule built
    // entirely from relaxed energy peaks (or from the clock) still reported
    // itself as 'ssm'. That made the whole class of "the SSM read was thrown
    // away" bug invisible in debug output, including the label loss below.
    const { cuts: rawCuts, source: floorSource } = this._ensureMinimumSections(
      chosen, { pickPeaks, barTimes, durationMs, lastIdx },
    );
    // Put each boundary on the RELEASE rather than on the run-up to it
    // (BoundarySnap.js). Both detectors answer "where does the material
    // change?" -- but in produced music a drop is preceded by a build, the
    // energy vector changes when the BUILD starts, and the detector marks the
    // build. The show then fired its release about a bar early, over material
    // still winding up. The same correction also pulls back the band-energy
    // fallback's trailing-window lag, since it looks both ways for the step.
    // The song's first and last cuts are pinned: they are the edges of the
    // schedule, not releases, and moving one leaves a gap.
    const cuts = snapCutsToReleases(rawCuts, barScalarEnergy, {
      pinned: [rawCuts[0], rawCuts[rawCuts.length - 1]],
    });
    // The floor's own answer wins when it intervened, because that IS what the
    // schedule is now made of; otherwise the chosen detector gets the credit.
    const ssmKept = ssmUsable && !floorSource;
    this.structureSource = floorSource || (ssmUsable ? 'ssm' : 'energy-novelty');
    // Which cuts are genuine energy-novelty peaks, and so have a meaningful
    // sharpness to classify from. Everything else -- an SSM boundary (found
    // by a different detector, on a different signal) or an even time-split
    // inserted by the minimum-sections floor -- has only whatever the energy
    // novelty happened to read at that index, which is not that boundary's
    // strength in any sense. Handing those an arbitrary value is how a
    // boundary with no drama in it was assigned the most violent transition
    // in the game, and is most of why the effect felt random.
    const peakSet = new Set(peaks);

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
        // Boundary sharpness picks the transition style into this section --
        // but only where that sharpness is real. An unmeasured boundary
        // fades: the gentlest option is the honest one when we do not
        // actually know how hard the song turned.
        transition: this.sections.length === 0 || !peakSet.has(cuts[i])
          ? 'fade'
          : classifyTransition(novelty[cuts[i]], maxNovelty),
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
    // Labels: the SSM's repetition pass finds material that literally recurs,
    // which is what a returning chorus IS. analyzeSongForm's band-shape
    // clustering is the fallback -- it can only ask whether two sections have
    // a similar average spectrum.
    //
    // Matching them up used to require `structure.labels.length ===
    // this.sections.length`, which is far more fragile than it looks: the
    // section list is not a copy of the SSM's segment list. _cutsFromTimes
    // drops any boundary that lands on the tail or fails to advance the index
    // (two boundaries collapsing onto one point of a coarser grid), the loop
    // above skips empty spans, and lyric fusion has yet to run. Any one of
    // those makes the counts differ by one and throws away the ENTIRE
    // repetition read -- the better half of the SSM, and the only thing in the
    // pipeline that knows a returning chorus is literally the same music --
    // falling back to band-shape clustering with no signal that it happened.
    // Map each section back to its nearest SSM boundary instead, so a dropped
    // or merged boundary costs one label rather than all of them.
    const ssmLabels = ssmKept ? this._labelsFromSsm(structure) : null;
    const labels = ssmLabels
      || analyzeSongForm(this.sections.map((_, i) => ({ energy: meanEnergies[i], shape: shapes[i] })));

    // Cast the show by structural LABEL, not per-section: every recurrence
    // of a label shares a biome name (stock path), so the returning skyline
    // is literally the same -- strips/landmarks bake per (songSeed, name).
    const uniqueLabels = [...new Set(labels)]; // first-appearance order
    const labelEnergy = uniqueLabels.map((lab) => {
      let s = 0, n = 0;
      labels.forEach((l, i) => { if (l === lab) { s += meanEnergies[i]; n++; } });
      return n > 0 ? s / n : 0;
    });
    const labelCast = this.world?.cast
      ? this.world.cast(labelEnergy, songSeed)
      : castBiomes(labelEnergy, songSeed);
    const biomeByLabel = new Map(uniqueLabels.map((lab, i) => [lab, labelCast[i]]));

    // Each label also gets a deterministic color signature (a hue bias),
    // so even in a single-biome dropped song the chorus recurs in the same
    // hue-shift and the verse in another -- form made visible in ANY biome.
    const hueByLabel = new Map(uniqueLabels.map((lab) => {
      const r = mulberry32(hashSeed(`${songSeed}:form:${lab}`));
      return [lab, (r() * 2 - 1) * FORM_HUE_BIAS_MAX];
    }));

    // Relative energy rank across THIS song's own labels (min-max, not an
    // absolute threshold) -- so a quiet song's chorus still reads as its
    // biggest, and a loud song's bridge still reads as a lull, regardless
    // of the track's overall loudness.
    const relEnergyValues = relEnergyLadder(labelEnergy);
    const relEnergyByLabel = new Map(uniqueLabels.map((lab, i) => [lab, relEnergyValues[i]]));

    // One shape recomposition per label (Stage 1 of the mountain overhaul):
    // lithology from the label's own averaged spectrum, a landform-ladder
    // window from spectral position + relative energy, and landmarks
    // resampled from just that label's own first occurrence in the song
    // (a representative instance) instead of the whole track. Alpine only --
    // city/farside/etc. worlds keep their own single-variant look.
    const labelShape = new Map(uniqueLabels.map((lab) => {
      const idxs = [];
      labels.forEach((l, i) => { if (l === lab) idxs.push(i); });
      const shape = new Array(7).fill(0);
      for (const i of idxs) for (let k = 0; k < 7; k++) shape[k] += shapes[i][k];
      for (let k = 0; k < 7; k++) shape[k] /= Math.max(1, idxs.length);
      return [lab, shape];
    }));
    const worldKindForVariants = this.world?.kind || 'alpine';
    const buildVariant = worldKindForVariants === 'alpine' ? (lab) => {
      const shape = labelShape.get(lab);
      const rel = relEnergyByLabel.get(lab) ?? 0.5;
      let wsum = 0, wtot = 0;
      for (let k = 0; k < 7; k++) { wsum += shape[k] * k; wtot += shape[k]; }
      const spectralPos01 = wtot > 1e-9 ? clamp01(wsum / (6 * wtot)) : 0.5;
      const firstIdx = labels.indexOf(lab);
      const window = firstIdx >= 0
        ? { startMs: this.sections[firstIdx].startMs, endMs: this.sections[firstIdx].endMs }
        : null;
      const windowedPortrait = extractRidgePortrait(energyCurves, durationMs, window);
      const litho = lithologyFromShares(shape);
      if (windowedPortrait) windowedPortrait.lithology = litho;
      return {
        lithology: litho,
        character: landformWindow(spectralPos01, rel),
        portrait: windowedPortrait,
        heightMul: lerp(SECTION_HEIGHT_MUL[0], SECTION_HEIGHT_MUL[1], rel),
        relEnergy01: rel,
        snowLine01: snowLine01For(litho.crest, rel),
      };
    } : null;
    // Keyed by BIOME NAME, not label: biomeByLabel maps labels 1:1 to a
    // cast biome in the common case, so a variant per name costs exactly
    // what the cast already implies. On the rare tie (two labels casting
    // the same biome), the first label to claim the name wins -- an
    // acceptable, deterministic edge case rather than a second keying
    // scheme threaded through every strip consumer.
    this._profileVariants = buildVariant ? new Map() : null;
    if (buildVariant) {
      for (const lab of uniqueLabels) {
        const name = biomeByLabel.get(lab);
        if (!this._profileVariants.has(name)) this._profileVariants.set(name, buildVariant(lab));
      }
    }

    const seenLabels = new Set();
    this.sections.forEach((s, i) => {
      s.label = labels[i];
      s.profile = biomeByLabel.get(labels[i]);
      s.hueBias = hueByLabel.get(labels[i]);
      s.meanEnergy = meanEnergies[i];
      s.shape = shapes[i];
      s.relEnergy01 = relEnergyByLabel.get(labels[i]) ?? 0.5;
      s.heightMul = this._profileVariants?.get(s.profile)?.heightMul
        ?? lerp(SECTION_HEIGHT_MUL[0], SECTION_HEIGHT_MUL[1], s.relEnergy01);
      s.snowLine01 = this._profileVariants?.get(s.profile)?.snowLine01 ?? 1;
      // Recognition: re-entering a label seen earlier snaps back into the
      // familiar place (a cut of recognition) rather than fading somewhere
      // new. First occurrence keeps its novelty-derived transition.
      if (i > 0 && seenLabels.has(labels[i])) s.transition = 'cut';
      seenLabels.add(labels[i]);
    });

    // Lyric fusion (SectionFusion): when lyrics were found and resolved,
    // fold their structural read (verse/chorus/bridge/instrumental/intro/
    // outro + per-section valence/intensity) onto this novelty-derived
    // schedule -- synced lyrics can insert/merge boundaries snapped to the
    // beat grid, plain lyrics only add labels. Absent lyricSections is a
    // true no-op (fuseSections returns the exact same array).
    this.sections = fuseSections(this.sections, lyricSections, barGrid, durationMs);

    // The conductor track has the last word (ConductorTrack.js). Everything
    // above this line is INFERRED -- novelty cuts, form labels, lyric
    // structure -- and every one of those reads can be wrong about a
    // particular song. A cue is not a read: the player wrote it, so an
    // authored boundary or biome overrides whatever was detected there.
    // Absent cues is a true no-op (the same array reference comes back).
    this.sections = applyConductorSchedule(this.sections, conductorSchedule, barGrid, durationMs);
  }

  _evenSplit(durationMs, n) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push((i / n) * durationMs);
    return out;
  }

  /** Boundary TIMES -> cut indices into this schedule's own `barTimes`, by
   *  nearest point. This is the whole defence against the two sides
   *  disagreeing about their analysis grid: whatever grid the detector ran on,
   *  its answers land at the right moments in the song. Always closed with the
   *  final index, which `boundariesMs` deliberately omits. */
  _cutsFromTimes(boundariesMs, barTimes) {
    const lastIdx = barTimes.length - 1;
    const nearest = (ms) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i <= lastIdx; i++) {
        const d = Math.abs(barTimes[i] - ms);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };
    const cuts = [];
    for (const ms of boundariesMs) {
      const i = nearest(ms);
      if (i >= lastIdx) continue;              // would collapse against the tail
      if (cuts.length && i <= cuts[cuts.length - 1]) continue; // keep it strictly rising
      cuts.push(i);
    }
    if (cuts[0] !== 0) cuts.unshift(0);
    cuts.push(lastIdx);
    return cuts;
  }

  /**
   * One structural label per built section, read off the SSM's repetition
   * pass by nearest boundary.
   *
   * Nearest rather than containment: a section's startMs is `barTimes[cut]`,
   * i.e. the SSM boundary already snapped to the nearest point of THIS
   * schedule's grid (_cutsFromTimes), so it can land a few milliseconds
   * either side of the boundary it came from. Containment would hand a
   * section that rounded down the previous segment's label; nearest is the
   * exact inverse of the snap that produced it, and reproduces the old 1:1
   * mapping whenever the counts do line up.
   *
   * @returns {?number[]} null when the analyzer's own labels/boundaries are
   *   missing or disagree with each other -- caller falls back to SongForm.
   */
  _labelsFromSsm(structure) {
    const bounds = structure?.boundariesMs, labels = structure?.labels;
    if (!Array.isArray(bounds) || !Array.isArray(labels) || !bounds.length
      || bounds.length !== labels.length) return null;
    return this.sections.map((s) => {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < bounds.length; k++) {
        const d = Math.abs(bounds[k] - s.startMs);
        if (d < bestD) { bestD = d; best = k; }
      }
      return labels[best];
    });
  }

  /**
   * A minimum number of sections, for songs long enough to deserve them.
   *
   * MIN_SECTION_CUTS was previously only ever the lower bound of the clamp on
   * `maxCuts` -- it guaranteed the section *budget* was at least 3, never that
   * three cuts were actually made. Nothing anywhere counted the result, so a
   * whole song could (and did) come out as a single biome: a heavily
   * compressed master whose trailing-mean novelty barely moves clears the
   * absolute 1e-6 test but nothing else, and every candidate gets rejected.
   *
   * So: count, and if the song is long enough to hold several sections but
   * didn't get them, relax in order -- first re-pick with the noise floor
   * dropped (the material is flat, but its *relative* peaks are still where
   * the song actually turns), and only if that still fails, fall back to even
   * time-splits. An even split is a poor read of the music, but it is a far
   * better experience than four minutes of one unchanging world.
   *
   * @returns {{cuts: number[], source: ?string}} `source` names what the
   *   returned cuts are actually made of when this intervened, and is null
   *   when it left `cuts` alone. The caller cannot tell otherwise -- both
   *   relaxation paths REPLACE the schedule it was given, including a
   *   confident SSM one -- and reporting the discarded detector as the
   *   schedule's source is how that went unnoticed.
   */
  _ensureMinimumSections(cuts, { pickPeaks, barTimes, durationMs, lastIdx }) {
    const deserved = Math.min(MIN_SECTION_CUTS, Math.floor(durationMs / SECTION_CUT_BUDGET_MS));
    if (deserved < 2 || cuts.length - 1 >= deserved) return { cuts, source: null };

    const relaxed = pickPeaks(0);
    if (relaxed.length + 1 >= deserved) return { cuts: [0, ...relaxed, lastIdx], source: 'energy-novelty' };

    // Nothing in the signal to go on: split the time evenly instead.
    const want = Math.max(deserved, relaxed.length + 1);
    const even = [];
    for (let k = 1; k < want; k++) {
      const ms = (k / want) * durationMs;
      let best = 0, bestD = Infinity;
      for (let i = 1; i < lastIdx; i++) {
        const d = Math.abs(barTimes[i] - ms);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best > 0 && (even.length === 0 || best > even[even.length - 1])) even.push(best);
    }
    return even.length
      ? { cuts: [0, ...even, lastIdx], source: 'even-split' }
      : { cuts, source: null };
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
    const hm = sec.heightMul ?? 1;
    const sl = sec.snowLine01 ?? 1;
    if (idx === 0) {
      return {
        from: sec.profile, to: sec.profile, t: 1,
        fromHeightMul: hm, toHeightMul: hm, fromSnowLine01: sl, toSnowLine01: sl,
      };
    }
    // Transition style sets the crossfade length: a hard cut lands in a
    // small fraction of a bar, a shutter wipes over one bar, a fade
    // breathes across four.
    const bars = sec.transition === 'cut' ? 0.08 : sec.transition === 'shutter' ? 1 : 4;
    const t = smoothstep(0, 1, (nowMs - sec.startMs) / (bars * sec.barMs));
    // Once the crossfade completes, retire the old biome entirely --
    // otherwise its taller peaks and particles ghost through forever.
    if (t >= 0.999) {
      return {
        from: sec.profile, to: sec.profile, t: 1,
        fromHeightMul: hm, toHeightMul: hm, fromSnowLine01: sl, toSnowLine01: sl,
      };
    }
    const prevHm = this.sections[idx - 1].heightMul ?? 1;
    const prevSl = this.sections[idx - 1].snowLine01 ?? 1;
    return {
      from: this.sections[idx - 1].profile, to: sec.profile, t,
      fromHeightMul: prevHm, toHeightMul: hm, fromSnowLine01: prevSl, toSnowLine01: sl,
    };
  }

  /**
   * Global presentation mode (classic SMW-flat vs rendered DKC-CGI).
   * Rebuilds silhouette strips when shade mode changes.
   */
  setVisualStyle(style) {
    const next = style === 'classic' ? 'classic' : 'rendered';
    if (this.visualStyle === next) return;
    this.visualStyle = next;
    this._rebuildStrips();
  }

  _rebuildStrips() {
    const songSeed = this.songSeed ?? 1;
    // Always soft CGI silhouettes (flat cutouts lost the DKC mass).
    const shadeMode = 'rendered';
    // One portrait per song: spectral mass + phrase-scale energy landmarks.
    // Layers read different facets of it so the stack rhymes without cloning.
    // Cheap (64 samples + a handful of landmarks) and cached on the manager
    // so a shade-mode rebuild doesn't redo the analysis.
    if (!this._ridgePortrait) {
      this._ridgePortrait = extractRidgePortrait(this.energyCurves, this.durationMs);
    }
    this.strips = new Map();
    for (const b of this.profiles) {
      this.strips.set(b.name, this._buildStripSet(b));
    }
  }

  /** Bake one profile's L2-L5 strip set. Extracted from _rebuildStrips so
   *  stripsFor() can lazily build the same thing on a cache miss (a profile
   *  name not eagerly baked -- see Stage 1's "only bake what's cast"). */
  _buildStripSet(b) {
    const songSeed = this.songSeed ?? 1;
    const shadeMode = 'rendered';
    if (!this._ridgePortrait) {
      this._ridgePortrait = extractRidgePortrait(this.energyCurves, this.durationMs);
    }
    // Per-section recomposition (Stage 1): a profile cast for a specific
    // structural label gets that label's own windowed portrait/lithology
    // instead of the whole-song aggregate, so a chorus and a verse sharing
    // a biome's color palette still get structurally different mountains.
    // Absent for city/farside/etc. worlds, and for any profile not tied to
    // a label yet (setVisualStyle's pre-schedule fallback) -- both fall
    // back to the whole-song portrait exactly as before this stage.
    const variant = this._profileVariants?.get(b.name) || null;
    const portrait = variant?.portrait || this._ridgePortrait;
    const worldKind = this.world?.kind || 'alpine';
    const noAerial = this.world?.aerial === false;
    {
      const seed = hashSeed(b.name);
      const el = b.edgeLight || null;
      let strips;
      if (worldKind === 'city') {
        const terrainMods = this.world?.terrainMods || null;
        strips = {
          L2: generateSilhouette({
            seed: seed + 1, height: 400, octaves: 3, amplitude: 0.56, baseline: 0.38,
            color: b.silhouette, shadeMode, profile: 'city',
            softenScale: 0.88, portrait, layerKey: 'L2', terrainMods,
            edgeLight: el,
          }),
          L3: generateSilhouette({
            seed: seed + 2, height: 360, octaves: 3, amplitude: 0.46, baseline: 0.46,
            color: b.silhouette, shadeMode, profile: 'city',
            softenScale: 0.94, portrait, layerKey: 'L3', terrainMods,
            edgeLight: el,
          }),
          L4: generateSilhouette({
            seed: seed + 3, height: 300, octaves: 2, amplitude: 0.30, baseline: 0.66,
            color: b.silhouette, shadeMode, profile: 'city',
            softenScale: 1, portrait, layerKey: 'L4', terrainMods,
            edgeLight: el,
          }),
          L5: generateSilhouette({
            seed: seed + 4, height: 220, octaves: 2, amplitude: 0.12, baseline: 0.92,
            color: b.silhouette, shadeMode, profile: 'city',
            softenScale: 1, portrait, layerKey: 'L5', terrainMods,
          }),
        };
      } else {
        const soften = noAerial
          ? { L2: 0.75, L3: 0.85, L4: 0.95, L5: 1 }
          : AERIAL_SOFTEN;
        const prof = worldKind === 'strip' ? 'rolling' : 'alpine';
        const terrainMods = this.world?.terrainMods || null;
        // Which landform each depth gets (not just how that landform is
        // shaped -- terrainMods above still does that): a song's own
        // spike/organic bias picks between the classic massif/range/crags
        // triple and two more distinct schemes (ShapeGrammar.
        // pickCharacterScheme), so a spiky song's whole stack skews toward
        // true needle spires up close and an organic song's toward a
        // joined tableland at the horizon, instead of every world reaching
        // for the identical three landforms regardless of what generated
        // it. Falls back to the original fixed triple when absent.
        const scheme = variant?.character || this.world?.characterScheme || CHARACTER_SCHEMES.classic;
        strips = {
          L2: generateSilhouette({
            seed: seed + 1, height: 400, octaves: 4, amplitude: 0.52, baseline: 0.42,
            color: b.silhouette, shadeMode, profile: prof, character: scheme[0],
            softenScale: soften.L2, portrait, layerKey: 'L2', terrainMods,
            edgeLight: el,
          }),
          L3: generateSilhouette({
            seed: seed + 2, height: 360, octaves: 3, amplitude: 0.44, baseline: 0.50,
            color: b.silhouette, shadeMode, profile: prof, character: scheme[1],
            softenScale: soften.L3, portrait, layerKey: 'L3', terrainMods,
            edgeLight: el,
          }),
          L4: generateSilhouette({
            seed: seed + 3, height: 330, octaves: 3, amplitude: 0.34, baseline: 0.64,
            color: b.silhouette, shadeMode, profile: prof, character: scheme[2],
            softenScale: soften.L4, portrait, layerKey: 'L4', terrainMods,
            edgeLight: el,
          }),
          L5: generateSilhouette({
            seed: seed + 4, octaves: 2, amplitude: 0.46, baseline: 0.82,
            color: b.silhouette, shadeMode, profile: 'rolling',
            softenScale: soften.L5, portrait, layerKey: 'L5', terrainMods,
          }),
        };
        // b.landmarkKey (PaletteSynth.js) is the archetype LANDMARKS is
        // actually keyed by; a synthesized palette's own display `name`
        // (e.g. "NAVE_A_0") never matches, and falls back to b.name for the
        // stock path where name IS already an archetype key.
        const landmarkKey = b.landmarkKey || b.name;
        decorateStrip(strips.L4, landmarkKey, hashSeed(`${songSeed}:${b.name}:L4`), b.silhouette, { count: 3, scale: 1 });
        decorateStrip(strips.L5, landmarkKey, hashSeed(`${songSeed}:${b.name}:L5`), b.silhouette, { count: 2, scale: 1.9 });
      }
      return strips;
    }
  }

  /** Lazy-bake indirection over this.strips: a profile name eagerly baked by
   *  _rebuildStrips() is a plain lookup; a name not yet baked (Stage 1's
   *  "only bake what's cast" -- a variant not chosen for any section) is
   *  built on first use and cached, so every call site gets the same strip
   *  set whether it was baked up front or on demand. */
  stripsFor(key) {
    let strips = this.strips.get(key);
    if (strips) return strips;
    const profile = this._profile(key);
    strips = this._buildStripSet(profile);
    this.strips.set(key, strips);
    return strips;
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
    // The One-Spectrum key shift (eased, landing the anchor on the tonic)
    // and the song-form section signature compose into one hue offset --
    // quantized together to 3deg steps so the cache stays hot.
    const deg = Math.round((this._spectralShift() + (this.sectionHueBias || 0)) / 3) * 3;
    if (deg === 0) return hex;
    const key = hex + '|' + deg;
    let v = this._rotationCache.get(key);
    if (v === undefined) {
      v = rotateHueHex(hex, deg);
      this._rotationCache.set(key, v);
    }
    return v;
  }

  /** One Spectrum: how far the world's color should rotate so its anchor
   *  hue lands on the song's key. Anchor = the active biome's halo hue
   *  (identity-bearing). Eased in update() so a key change glides; the
   *  target is zero when there's no detected tonic yet (the first beat of
   *  a song) so the world never snaps on boot. */
  _spectralShift() {
    return this._specShift || 0;
  }

  /** Ease the One-Spectrum key shift toward its target: the active
   *  biome's anchor hue must land on the song's tonic, at 30deg/semitone
   *  (the characters' own spectral spacing). Same one-pole timescale as
   *  the characters' hue glide (FORM_HUE_TAU_SEC class), so the world and
   *  the characters move together and reduced-flash sees a glide, never
   *  a snap. */
  _updateSpectralShift(dtSec) {
    const tonic = this.tonic;
    let target = 0;
    if (tonic != null && this.currentBlend) {
      const { from, to, t } = this.currentBlend;
      const active = this._profile(t > 0.5 ? to : from);
      const anchorHex = (active && active.celestial && active.celestial.haloColor) || '#ffdca0';
      const { r, g, b } = hexToRgb(anchorHex);
      const { h } = rgbToHsl(r, g, b);
      target = spectralShiftDeg(h, tonic) * (this.spectralAmount ?? 1);
    }
    this._specShiftTarget = target;
    this._specShift = easeSpectralShift(this._specShift, target, dtSec);
  }

  /** The current blended halo color -- shared accent for HUD-level effects. */
  currentHaloColor() {
    if (!this.currentBlend) return '#ffffff';
    const { from, to, t } = this.currentBlend;
    return this._rotated(this.lerpCache.get(this._profile(from).celestial.haloColor, this._profile(to).celestial.haloColor, t));
  }

  /** Movement VII: the celestial body as an actual light -- position, color, intensity. */
  currentLight() {
    return this.light || computeLight({ canvasWidth: this.w, canvasHeight: this.h, budget: this._lightBudget ?? this.budget });
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

  /** The current blended ambient-particle color -- lets a landing puff
   *  (RippleFX) or any other one-off effect read as "of this biome"
   *  without needing its own per-biome color table. */
  currentParticleColor() {
    if (!this.currentBlend) return '#ffffff';
    const { from, to, t } = this.currentBlend;
    return this._rotated(this.lerpCache.get(this._profile(from).particles.color, this._profile(to).particles.color, t));
  }

  currentSkyBase() {
    if (!this.currentBlend) return '#141428';
    const { from, to, t } = this.currentBlend;
    return this._rotated(this.lerpCache.get(this._profile(from).sky[1], this._profile(to).sky[1], t));
  }

  /** Fires a reward meteor volley sized by both PerfGovernor headroom and
   *  the song's staged intensity budget, colored from the current blended
   *  halo (an achromatic biome like ARCTIC's near-white sun gets a
   *  desaturated volley instead of an arbitrary hue). */
  /** Conductor-cued phenomena (ConductorTrack.js). These reach past the
   *  reward/storm gating the internal callers go through -- an authored cue
   *  fires its volley or its bolt wherever it was written, including under a
   *  clear sky -- but reuse the same FX objects and the same halo-derived
   *  coloring, so a cued volley is indistinguishable from an earned one. */
  cueMeteors(nowMs, strength = 1) {
    this._triggerMeteors(nowMs, Math.max(2, Math.round(6 + 26 * strength)));
  }

  cueLightning(nowMs) {
    this.lightning.strike(nowMs, this.w, this.groundY);
  }

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
    this._danceWorldX = worldX; // kept for farRidgeSwell01(), read by the sim
    const {
      from, to, t, fromHeightMul, toHeightMul, fromSnowLine01, toSnowLine01,
    } = this._blend(nowMs);
    this.currentBlend = {
      from, to, t, fromHeightMul, toHeightMul, fromSnowLine01, toSnowLine01,
    };
    // One Spectrum: glide the key shift (needs the blend just resolved).
    this._updateSpectralShift(dtSec);

    // Dramaturgy: detect section boundaries and fire their transition FX.
    const sectionIdx = this._sectionAt(nowMs);
    this.cutFlashJustFired = false;
    this.sectionJustChanged = false;
    if (sectionIdx !== this._lastSectionIdx) {
      const sec = this.sections[sectionIdx];
      if (this._lastSectionIdx != null) {
        if (sec.transition === 'cut') { this._cutFlash = 1; this.cutFlashJustFired = true; }
        else if (sec.transition === 'shutter') {
          // Through a real rate limiter. Boundaries are allowed to sit
          // MIN_SECTION_CUT_GAP_MS (11s) apart, so before this two near-total
          // blackouts eleven seconds apart were a permitted outcome -- and
          // nothing else in the game punctuates that hard. The gate's floor
          // cannot be bypassed (transition: true skips only the probability
          // roll), which is exactly the guarantee wanted here.
          const fired = this._shutterGate.tryFire(nowMs, { intensity: this.vibeEpic || 0, transition: true });
          this.shutterDebug = { fired, reason: this._shutterGate.lastReason, atMs: nowMs };
          if (fired) { this._shutterStartMs = nowMs; this._shutterBarMs = sec.barMs; }
        }
        // A lyric-identified instrumental/solo section gets the same
        // spotlight snap a hype drop does -- the show notices the vocals
        // stepping back just as much as it notices them stepping forward.
        if (sec.kind === 'instrumental') this.lightRig.trigger(nowMs, this.midioX, this.midioY);
        this.sectionJustChanged = true;
        this.lastTransitionStyle = sec.transition;
      }
      this._lastSectionIdx = sectionIdx;
    }
    // The crossfade the boundary started (the decision above is the only
    // thing that moves the target; this just walks toward it).
    // Smooth the raw per-frame occlusion draw() measured. The ridge is
    // dancing, so any single frame's figure is noisy; a ~1s one-pole means
    // the number a boundary reads describes the FRAMING rather than whichever
    // part of the swing the boundary happened to land on.
    if (typeof this._ridgeOcclusionRaw === 'number') {
      const k = 1 - Math.exp(-dtSec / 1.0);
      this._ridgeOcclusion01 += (this._ridgeOcclusionRaw - this._ridgeOcclusion01) * k;
    }
    // Distant wave. `sectionJustChanged` is the ONE gate on the horizon
    // changing its mind about being rock or water: asking per-frame would
    // flip the back of the scene every time a tall column danced past the
    // threshold, whereas this lands every swap on a musical boundary,
    // alongside the transition FX that already cover it. Every other frame
    // only walks the crossfade the last boundary started.
    const wave = stepDistantWave(
      { on: this._distantWaveOn, mix: this._distantWaveMix },
      { occlusion01: this._ridgeOcclusion01, sectionChanged: this.sectionJustChanged, dtSec },
    );
    this._distantWaveOn = wave.on;
    this._distantWaveMix = wave.mix;
    this._cutFlash = Math.max(0, this._cutFlash - dtSec / 0.25);

    // Song-form recognition: glide the whole palette toward the active
    // section's structural signature hue, so a returning chorus settles
    // back into the same shift it always wears (a recognizable "place")
    // rather than snapping. Constant, steady color -- reduced-flash safe.
    const activeSection = this.sections[sectionIdx];
    let targetHueBias = activeSection?.hueBias || 0;
    // The lyric-identified bridge is the one place asked to look
    // unmistakably different from everything around it -- the "epic
    // bridge" payoff -- so its hue swing is forced large regardless of
    // how the seeded per-label bias happened to land.
    if (activeSection?.kind === 'bridge') {
      targetHueBias = Math.sign(targetHueBias || 1) * Math.max(Math.abs(targetHueBias), FORM_HUE_BIAS_MAX * 0.9) * 1.5;
    }
    // The current "parallel universe"'s own small hue drift rides the same
    // easing as the structural hue bias above -- one smooth glide, not two
    // competing color systems.
    targetHueBias += this.universeHueDeg || 0;
    this.sectionHueBias += (1 - Math.exp(-dtSec / FORM_HUE_TAU_SEC)) * (targetHueBias - this.sectionHueBias);

    // Lyric structure (SectionFusion): the active section's kind and its
    // eased lyric intensity, both neutral defaults (null / 0.4) when no
    // lyric data was ever fused in.
    this.currentKind = activeSection?.kind || null;
    const targetLyricIntensity = activeSection?.lyricIntensity ?? 0.4;
    this.lyricIntensityEased += (1 - Math.exp(-dtSec / FORM_HUE_TAU_SEC)) * (targetLyricIntensity - this.lyricIntensityEased);
    const targetKindBudgetMul = KIND_BUDGET_MUL[this.currentKind] ?? 1;
    this._kindBudgetMulEased += (1 - Math.exp(-dtSec / FORM_HUE_TAU_SEC)) * (targetKindBudgetMul - this._kindBudgetMulEased);

    // Intensity budget: stage the show -- restrained intro, full finale --
    // additionally scaled by the lyric-structure kind (a chorus/bridge
    // reads louder, an intro/outro settles), a no-op multiplier of 1 when
    // there's no lyric data.
    this._progress = this.durationMs > 0 ? clamp01(nowMs / this.durationMs) : 0.5;
    // Staging (time) x lyric kind x whether the song has actually started
    // (audio). The first two cannot hear the music; openingGain is what keeps
    // a fade-in from opening on a fully-lit world.
    // this._lightBudget is the undampened base: the celestial LIGHT itself
    // (rim-lighting, contact shadows -- computed below into this.light) must
    // never dim just because focus picked a subject other than 'sky', or
    // the very subject focus is emphasizing (Midio mid-apotheosis, Midasus
    // mid-voyage) would visibly dim along with everything else. focusMul
    // folds into the PUBLIC this.budget instead -- every existing decorative
    // budget-scaled site (the many ctx.globalAlpha = X * this.budget draws
    // below, plus LightRig's own budget param) dampens for free whenever
    // some other subject has focus, with no per-site changes needed.
    this._lightBudget = intensityBudget(this._progress) * this._kindBudgetMulEased * this.openingGain;
    this.budget = this._lightBudget * this.focusMul * this.stillnessMul;
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
    // Quake dust and wildfire smoke: the air stays hazy/reddened for a
    // while after either settles (QuakeDirector.dustLevel01,
    // FireDirector.smokeLevel01, both pushed in each frame by Simulation)
    // -- folded into the same haze multiplier every other dial already
    // feeds, so this costs nothing new at draw time. Smoke pushes harder
    // than dust (3x vs 2x) -- a wildfire should visibly choke the sky, not
    // just tint it.
    this._hazeMul = (pers.haze ?? 1) * (this.universeHazeMul || 1)
      * (1 + 2 * clamp01(this.dustLevel01 || 0))
      * (1 + 3 * clamp01(this.smokeLevel01 || 0));

    // The Wind: one sample per frame, shared by every consumer below --
    // never re-derived per particle. An active weather front gusts it up:
    // rain and snow arrive WITH wind, not into still air.
    this.atmosphere.turbulence = (pers.turbulence ?? 1) * (this.universeWindMul || 1) * (1 + 0.6 * this._activeWeatherIntensity);
    const energyInstant = energyCurves ? clamp01(energyCurves.globalEnergy(nowMs, FLAT_WEIGHTS)) : 0;
    this.atmosphere.update(dtSec, energyInstant);

    // Groove for the dancing ranges: energy-driven, calmed sections settle,
    // the current universe's terrain drift nudges the amplitude a little
    // further either way.
    const grooveTarget = energyInstant * (1 - 0.55 * calmLevel) * (this.universeTerrainMul || 1);
    this._danceGroove += (1 - Math.exp(-dtSec / 0.30)) * (grooveTarget - this._danceGroove);
    this._danceSustain += (1 - Math.exp(-dtSec / 1.1)) * (this._danceGroove - this._danceSustain);
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
    // Rain (and any other ground-colliding particle) lands on the real
    // terrain, not a hardcoded screen-fraction shelf. Screen x -> world x
    // via the same origin Midio is drawn at, so a drop over a valley
    // actually falls into it.
    const originX = Number.isFinite(this.midioX) ? this.midioX : this.w * 0.5;
    const groundYAt = this.groundField
      ? (sx) => this.groundField.heightAt(worldX + (sx - originX))
      : null;

    if (this._activeWeatherIntensity > 0.01) {
      const weatherField = this.weatherFields.get(this.weatherState.kind);
      if (weatherField) weatherField.update(dtSec, this.tSec, energyCurves, nowMs, calmLevel, wind, groundYAt);
    }

    this.fields.get(from).update(dtSec, this.tSec, energyCurves, nowMs, calmLevel, wind, groundYAt);
    if (to !== from) this.fields.get(to).update(dtSec, this.tSec, energyCurves, nowMs, calmLevel, wind, groundYAt);
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
      this._massifEqSmoothed[b] = massifEqStep(this._massifEqSmoothed[b], raw, dtSec);
    }

    // Ocean weather (WaveField.js): overall low-band energy is the ONLY
    // channel the music has into the spectral sea, and even that only ever
    // shifts sea state, eased over ~10s -- a drop raises the sea state, it
    // never makes a wave. The surface itself always obeys its own physics.
    const targetSeaState = (this._eqSmoothed[0] + this._eqSmoothed[1] + this._eqSmoothed[2]) / 3;
    const nextSeaState = easeSeaState(this._seaState, targetSeaState, dtSec, 10);
    if (Math.abs(nextSeaState - this._seaState) > 0.01) {
      this._waveComponents = buildWaveComponents(this._waveFieldSeed, windSpeedForSeaState(nextSeaState), 24);
    }
    this._seaState = nextSeaState;

    this.mandala.update(nowMs, dtSec, energyCurves, calmLevel);
    this.cymatics.update(nowMs, dtSec, energyCurves, calmLevel);
    this.swarm.update(nowMs, dtSec, energyCurves, this._beatMs, calmLevel);
    this.ribbon.update(nowMs, dtSec, energyCurves, calmLevel);
    this.rd.update(nowMs, dtSec, energyCurves, calmLevel);
    this.lightning.update(dtSec);
    this.lightRig.update(nowMs, dtSec, this._beatMs, calmLevel, this.budget, this.fever || 0);
    this.meteors.update(dtSec);
    this.weaver.update(nowMs, dtSec);
    this.spaceRidge.update(nowMs, dtSec, this._eqSmoothed, this.calmLevel);
    // Drops send a heavy ring through the lake and snap every light-rig beam
    // onto Midio for a moment -- edge-detected off the externally-set
    // dropAtMs (same passthrough pattern as heatShimmer).
    if (Number.isFinite(this.dropAtMs) && this.dropAtMs !== this._lastSeenDropAtMs) {
      this._lastSeenDropAtMs = this.dropAtMs;
      this.lakeRing.excite(22);
      this.lightRig.trigger(nowMs, this.midioX, this.midioY);
      this._triggerMeteors(nowMs, DROP_METEOR_BASE);
      // A drop also throws a bonus tsunami wall across the ocean, if one
      // hasn't rolled through recently.
      if (nowMs - (this._lastDropTsunamiMs ?? -Infinity) >= 30000) {
        this._lastDropTsunamiMs = nowMs;
        this._tsunamis.push({ tMs: nowMs, dir: this._tsunamis.length % 2 === 0 ? 1 : -1 });
      }
    }
    // Spilling over: the first time ANY active tsunami's height envelope
    // crosses TSUNAMI_OVERTOP_SCALE, arm a flood over the near ground
    // plane. The envelope itself (rise -> hold -> recede) lives in
    // FloodDirector (src/sim/FloodDirector.js, owned by Simulation) --
    // this only detects the trigger, since tsunami scheduling/state is
    // BiomeManager's own domain. armFromTsunami() is itself guarded
    // per-event, so a wall's crest sitting above the threshold across
    // several frames only ever arms once.
    const activeNow = this._activeTsunami(this.w || 1280);
    if (activeNow && tsunamiHeightScale(nowMs - activeNow.ev.tMs) >= TSUNAMI_OVERTOP_SCALE) {
      this.flood?.armFromTsunami(nowMs, activeNow.ev.tMs);
    }
    // Edge-triggered one-frame flag for the moment a wall's approach
    // window actually begins (not the withdrawal lead-up) -- Simulation
    // reads this to fire the same authored-cut treatment (FilmFinish.hit)
    // the drop/apotheosis/finale already get.
    this.tsunamiJustArrived = !!activeNow && !this._wasTsunamiActive;
    this._wasTsunamiActive = !!activeNow;
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

  draw(ctx, canvas, worldX, originX = 0, skyVoyage = null, particleMul = 1, perf = null, groundView = null) {
    // Deeper PerfGovernor rungs (mobile performance round): the optional
    // phenomena layer and the depth-haze layer count both read this for
    // the rest of the frame, so it's stashed on `this` rather than threaded
    // through every helper's signature.
    this._perf = perf;
    // _crestPoints is re-derived by _drawRidgeVolume, _drawCrest, and
    // _drawConnectorHills for the same layer -- up to ~14x/frame across
    // L2-L5 with a crossfade active. Everything within one frame that would
    // make it recompute (strip identity, scrollX, layerKey, terrainEnergy)
    // is captured in the cache key, so this is safe to clear once here and
    // let every caller below share one derivation per unique input.
    this._crestCache = new Map();
    const phenomenaFull = perf ? perf.phenomenaFull : true;
    const {
      from, to, t, fromHeightMul = 1, toHeightMul = 1, fromSnowLine01 = 1, toSnowLine01 = 1,
    } = this.currentBlend
      || { from: this.sections[0].profile, to: this.sections[0].profile, t: 1 };
    const A = this._profile(from), B = this._profile(to);
    this._drawHeightMul = { from: fromHeightMul, to: toHeightMul };
    this._drawSnowLine = { from: fromSnowLine01, to: toSnowLine01 };

    // Sunrise/moonrise cycle: which body is up, how high, and how dark the
    // sky should read. Computed once per frame -- feeds the sky gradient,
    // the celestial itself, the mandala/light-rig anchor, and the ocean's
    // reflection glint, so everything tracks the same body.
    const dn = dayNight(this.tSec * 1000, this._dayNightCycleMs);
    const sunUp = dn.sunAlt > 0.001;
    const activeAlt = sunUp ? dn.sunAlt : dn.moonAlt;
    // Cast shadow (Stage 5 of the mountain overhaul): a near range can only
    // physically shadow a farther one when light comes from roughly behind
    // the camera -- low on the horizon, not overhead -- so strength is tied
    // to how LOW the active body currently sits (activeAlt near 0 = near
    // the horizon = longest shadows), not to any particular light direction.
    this._castShadowStrength = (1 - clamp01(activeAlt)) * CAST_SHADOW_MAX;
    const celestialYFrac = celestialYFracFor(activeAlt);
    // ...and how far across the sky it has travelled. Whichever body is up
    // owns the light, so the light's anchor follows that body's own arc --
    // which is what makes shadows swing through the day instead of pointing
    // one fixed direction from dawn to dusk.
    const celestialXFrac = celestialXFracFor(sunUp ? dn.sunAz01 : dn.moonAz01);
    // Aerial-perspective haze still warms/cools on the song's own progress
    // arc (a separate, slower signal than the sunrise/moonrise cycle) --
    // only `.hazeWarm` from the old day-arc survives here.
    const arc = dayArc(this._progress);

    // Movement VII: the celestial body doubles as a light -- every
    // consumer downstream this frame (layers, characters, obstacles)
    // reads the same `this.light` rather than re-deriving its position.
    this.light = computeLight({
      canvasWidth: canvas.width, canvasHeight: canvas.height,
      celestialYFrac, celestialXFrac, haloColorHex: this.currentHaloColor(),
      budget: this._lightBudget, unravel: this.unravel,
      dayArcAlpha: dn.dawnAlpha + dn.duskAlpha,
      reducedFlash: this.reducedFlash,
    });

    // The horizon color, and from it the air color every range body and the
    // ground are washed toward. Computed HERE, above the world-kind dispatch
    // below, rather than further down in the classic path -- seven of the
    // eight kinds return before that point, so `_airColor` was simply never
    // set for any of them and every consumer silently fell back.
    const horizonPull = (0.62 * (dn.night || 0) + (styleDials(this.visualStyle).spaceWash ? 0.14 : 0)) * 0.45;
    const skyHorizon = this._rotated(this.lerpCache.get(A.sky[2], B.sky[2], t));
    const skyHorizonNight = horizonPull > 0.02
      ? this.lerpCache.get(skyHorizon, NIGHT_SKY_COLOR, horizonPull)
      : skyHorizon;
    this._airColor = skyHorizonNight;

    const _kind = this.world?.kind;
    // Five of these six newer world kinds get the same deep-sky star layer
    // (drawDeepSky/weaver/meteors) the classic path below draws -- it was
    // simply never ported when each kind got split into its own draw
    // function, so ConstellationWeaver, SkyVoyage's sky-writing trail, and
    // meteor-shower reward volleys never rendered at all for a song assigned
    // one of these kinds. Two are deliberately left out because showing
    // stars there contradicts what the world already says about itself:
    // drawFathomWorld's own header states "No stars... the sky is the water
    // surface overhead", and drawNaveWorld's sky is an interior vault
    // ceiling, not open air.
    if (_kind === 'city') {
      drawCityWorld(this, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage);
      return;
    }
    if (_kind === 'airless') {
      drawFarsideWorld(this, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage);
      return;
    }
    if (_kind === 'abyssal') {
      drawFathomWorld(this, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView);
      return;
    }
    if (_kind === 'strip') {
      drawRedlineWorld(this, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage);
      return;
    }
    if (_kind === 'foundry') {
      drawFoundryWorld(this, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage);
      return;
    }
    if (_kind === 'overgrowth') {
      drawUnderstoryWorld(this, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage);
      return;
    }
    if (_kind === 'nave') {
      drawNaveWorld(this, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView);
      return;
    }

    this._drawSky(ctx, canvas, A, B, t, dn.night);

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

    // Dawn/dusk tint washes bracket the sun's own rise and set.
    for (const wash of [{ color: '#ff9a6b', alpha: dn.dawnAlpha }, { color: '#141040', alpha: dn.duskAlpha }]) {
      if (wash.alpha > 0.005) {
        ctx.save();
        ctx.globalAlpha = wash.alpha;
        ctx.fillStyle = wash.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }

    // The sun (this biome's celestial, crossfaded A->B as usual) while
    // it's up; a plain pale moon takes over once it sets. Both fade in/out
    // over their last stretch of altitude rather than popping at the
    // horizon, and both rise from and set into the sea horizon.
    if (sunUp) this._drawCelestial(ctx, canvas, A, B, t, celestialYFrac, horizonFade(dn.sunAlt), celestialXFrac);
    if (dn.moonAlt > 0.001) {
      // Where the sun really is -- below the horizon all night, which is the
      // whole point: it's what makes the moon read as lit from underneath.
      const sun = sunScreenFrac(cyclePhase01(this.tSec * 1000, this._dayNightCycleMs));
      this._drawMoon(
        ctx, canvas, celestialYFracFor(dn.moonAlt), horizonFade(dn.moonAlt),
        0.22 * this.spaceRidge.tidalOffsetPx(canvas.height),
        celestialXFracFor(dn.moonAz01),
        sun.xFrac, sun.yFrac, this._moonPhase01(),
      );
    }
    // Spirograph resonance mandala, centered on the celestial body so it
    // reads as the sun/moon itself resonating with the track.
    const mandalaColor = this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
    // Hybrid sky wire: mandala / ribbon / weaver scale with skyWireAlpha
    // (Soft ~0.38, Neon ~0.72) so geometry feels musical without striping.
    const skyA = styleDials(this.visualStyle).skyWireAlpha ?? 1;
    // Both are pure background phenomena (a ~700-point spirograph path and a
    // ~420-point attractor trail redrawn every frame) -- real atmosphere but
    // never gameplay, so they shed at the same rung as the rest of the
    // optional phenomena layer below rather than paying full cost regardless
    // of perf level.
    if (phenomenaFull && skyA > 0.02) {
      const prevM = this.mandala.intensity;
      this.mandala.intensity = prevM * skyA;
      this.mandala.draw(ctx, canvas.width * celestialXFrac, canvas.height * celestialYFrac, canvas.height * 0.30 * this.mandalaScaleMul, mandalaColor);
      this.mandala.intensity = prevM;
    }
    // Phenomena layer, deep sky: cymatic dust settling into Chladni
    // figures, and the chaos ribbon opposite the celestial for balance.
    if (phenomenaFull) this.cymatics.draw(ctx, canvas, mandalaColor);
    if (phenomenaFull) {
      const ribbonA = Math.max(0.18, skyA);
      const prevR = this.ribbon.intensity;
      this.ribbon.intensity = prevR * ribbonA;
      this.ribbon.draw(ctx, canvas.width * 0.22, canvas.height * 0.30, canvas.height * 0.075 * (this._ribbonScaleMul || 1), mandalaColor);
      this.ribbon.intensity = prevR;
    }
    this.lightning.draw(ctx, canvas, this.tSec * 1000, this.reducedFlash); // behind the ranges: bolts land beyond the hills
    // Space ridge: orbital jewelry — faint in Soft, present in Neon. Its
    // draw call was removed for a stretch while a still-live SkyVoyage
    // station bug (see SkyVoyage.js trigger()) was misdiagnosed as this;
    // restored once the real cause was found and fixed. Reinstated on
    // explicit request after the sky read as too empty without it.
    {
      const spaceCol = this._rotated(rotateHueHex(mandalaColor, 45));
      const ridgeA = styleDials(this.visualStyle).spaceRidgeAlpha ?? 1;
      if (ridgeA > 0.02) {
        ctx.save();
        ctx.globalAlpha = ridgeA * (phenomenaFull ? 1 : 0.4);
        this.spaceRidge.draw(ctx, canvas, spaceCol, this.tSec, this.reducedFlash);
        ctx.restore();
      }
    }
    this.drawDeepSky(ctx, skyVoyage, canvas); // Midasus's sky voyage, when she's away -- behind the mountains below
    // Ambient connect-the-dots + reward volleys read as starlight, so the
    // night sky brightens them the same way it brightens the atlas stars.
    const nightAlphaMul = (1 + 1.2 * dn.night) * Math.max(0.25, skyA);
    if (phenomenaFull && skyA > 0.02) this.weaver.draw(ctx, canvas, this.reducedFlash, nightAlphaMul);
    if (phenomenaFull) this.meteors.draw(ctx, canvas, this.reducedFlash); // reward volleys, same deep-sky depth, occluded by the ranges drawn below
    this._drawOcean(ctx, canvas, worldX, A, B, t, phenomenaFull, dn.night);
    this._drawOceanLife(ctx, canvas, worldX, A, B, t, phenomenaFull);
    this._drawHorizonEQ(ctx, canvas, worldX, A, B, t);
    this._drawSpectrumMassif(ctx, canvas, worldX, A, B, t);

    // Concert beams: anchored at the celestial, drawn before the mountain
    // silhouettes so the ranges occlude their lower reach the same way
    // Lightning's bolts do.
    const cx = canvas.width * celestialXFrac, cy = canvas.height * celestialYFrac;
    this.lightRig.draw(ctx, canvas, cx, cy, mandalaColor, particleMul, this.reducedFlash);

    // The Unraveling: each layer's scroll ratio drifts apart from the rest
    // as the world delaminates -- nearer layers race ahead more than far
    // ones (the ratio itself is the depth proxy, so no separate table).
    const scrollX0 = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L2, this.unravel);
    const scrollX1 = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L3, this.unravel);
    const scrollX2 = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L4, this.unravel);
    const scrollX3 = worldX * CodaDirector.delaminateRatio(LAYER_RATIOS.L5, this.unravel);
    // A biome's silhouette is one fixed authored color; the sky behind it
    // pulls toward near-black at night (see _drawSky's nightPull). On a
    // palette that already runs dark, those two can converge and the ranges
    // read as barely-there smears instead of silhouettes -- so pin the
    // mountain tint to stay legible against the actual horizon color it's
    // about to sit in front of, at the same pull the sky gradient just used.
    const tint = ensureContrast(this._rotated(this.lerpCache.get(A.silhouette, B.silhouette, t)), skyHorizonNight, 0.14);
    // Aerial perspective. Every range used to be painted in this ONE tint,
    // which is the single biggest reason the four layers read as the same
    // mountain repeated four times: depth was carried entirely by the haze
    // washes drawn BETWEEN them, and nothing about the ranges themselves
    // said "this one is further away."
    //
    // Real distance desaturates a silhouette toward the color of the air
    // in front of it, so each layer's own fill is pulled toward the sky
    // horizon by its depth fraction: L5 (nearest) keeps the authored
    // silhouette color outright, L2 (furthest) sits nearly half way to the
    // sky. Cheap -- four cached hex lerps per frame -- and it stacks with
    // the existing haze rather than replacing it.
    const layerTint = (layerKey) => {
      const pull = AERIAL_PULL[layerKey] || 0;
      return pull > 0.001 ? this.lerpCache.get(tint, skyHorizonNight, pull) : tint;
    };
    const tintL2 = layerTint('L2'), tintL3 = layerTint('L3');
    const tintL4 = layerTint('L4'), tintL5 = layerTint('L5');
    // Depth haze: three wash layers (L2/L3/L4) at healthy perf; the deepest
    // rung collapses to just L3, the middle layer -- enough of an
    // atmosphere cue to not read as flat, at a third of the cost.
    const hazeLayers = this._perf ? this._perf.hazeLayers : 3;

    // Behind every range: the swell that takes over the horizon when the
    // view angle has buried the dancing ridge. Also where L2's occlusion is
    // measured for the next section boundary's decision, so this has to run
    // whether or not the wave is currently up.
    this._drawDistantWave(ctx, canvas, { scrollX0, scrollX1, scrollX2 }, A, B, t);
    this._drawLayer(ctx, canvas, 'L2', scrollX0, tintL2, t, A, B);
    if (hazeLayers >= 3) this._drawHaze(ctx, canvas, 'L2', A, B, t, arc);
    // Far-distance vignettes: between the farthest range and everything
    // nearer, so the L3/L4/L5 ridges partially occlude them -- genuinely
    // "witnessed in the far distance", not sprites pasted on the sky.
    if (phenomenaFull) this.farVignettes.draw(ctx, canvas, worldX, {
      tSec: this.tSec,
      kick: kickEnv(this.tSec * 1000 - this._danceKickMs - 170) * this._danceKickAmp,
      silhouette: tintL2, // they sit at L2's depth, so they wear L2's air
      sky: this._rotated(this.lerpCache.get(A.sky[1], B.sky[1], t)),
      halo: this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t)),
    });
    this._drawLayer(ctx, canvas, 'L3', scrollX1, tintL3, t, A, B);
    this._drawHaze(ctx, canvas, 'L3', A, B, t, arc);
    this._drawCastShadow(ctx, canvas, 'L2', 'L3', scrollX0, scrollX1, A, B, t);

    // Ambient particle field lives roughly at mid-depth. The Unraveling:
    // particle hues converge toward the biome's own halo color as the
    // ending arc progresses.
    // Particle counts are fixed at construction and never saw the intensity
    // budget, so a fading-in song still opened on a fully-populated frame.
    // Fading the whole field is cheaper and less jarring than culling
    // individual particles, which would pop as the gain rose.
    const openA = this.openingGain;
    // Same secondary-light assembly characters use (Renderer.js), gated on
    // the same rim-light rung -- particles are the largest draw-call
    // population in the frame and must pay nothing on the deep rungs.
    const rimOn = this._perf ? this._perf.rimLightEnabled : true;
    const particleLights = rimOn
      ? [
        this.light,
        ...groundGlowLights(
          this.groundField ? this.groundField.activeGlowScreenLights(worldX, originX) : [],
          mandalaColor,
        ),
      ].filter(Boolean)
      : null;
    ctx.save();
    if (openA < 0.999) ctx.globalAlpha = openA;
    this.fields.get(from).draw(ctx, particleMul, mandalaColor, this.unravel, particleLights);
    ctx.restore();
    if (to !== from && t > 0.02) {
      ctx.save(); ctx.globalAlpha = t * openA;
      this.fields.get(to).draw(ctx, particleMul, mandalaColor, this.unravel, particleLights);
      ctx.restore();
    }
    // Music-reactive weather, same mid-depth as the ambient field above --
    // density (and thus fever's boost) comes free from `particleMul`, hue
    // convergence at the coda comes free from `this.unravel`.
    if (this._activeWeatherIntensity > 0.01) {
      const weatherField = this.weatherFields.get(this.weatherState.kind);
      if (weatherField) weatherField.draw(ctx, this._activeWeatherIntensity * particleMul, mandalaColor, this.unravel, particleLights);
    }

    // The Kuramoto swarm shares this depth: synchronized flashing motes,
    // with the murmuration wheeling among them. Same optional-phenomena rung
    // as the murmuration it flies with -- 48 individually stroked arcs a
    // frame, atmosphere rather than gameplay.
    if (phenomenaFull) this.swarm.draw(ctx, canvas, mandalaColor);
    if (phenomenaFull) this.murmuration.draw(ctx, this.tSec * 1000, mandalaColor, particleMul);
    this._drawFogBanks(ctx, canvas);

    this._drawLayer(ctx, canvas, 'L4', scrollX2, tintL4, t, A, B);
    if (hazeLayers >= 3) this._drawHaze(ctx, canvas, 'L4', A, B, t, arc);
    this._drawCastShadow(ctx, canvas, 'L3', 'L4', scrollX1, scrollX2, A, B, t);
    // Green country bridging the sightline wherever the dancing far skyline
    // has ducked behind the hills in front of it. Between L4 and L5 so the
    // nearest hills still overlap it and it reads as depth rather than as a
    // pane laid over the scene.
    this._drawConnectorHills(ctx, canvas, { scrollX0, scrollX1, scrollX2 }, A, B, t);
    this._drawLayer(ctx, canvas, 'L5', scrollX3, tintL5, t, A, B);
    this._drawCastShadow(ctx, canvas, 'L4', 'L5', scrollX2, scrollX3, A, B, t);

    // Ground view: switch to the fixed, never-zoomed transform for the
    // ground and everything painted from here on (see Renderer.draw's
    // groundView comment for the full reasoning). Everything above this
    // point -- sky, massif, L2-L5 -- stays on the zoomed transform that was
    // already active when draw() was called, which is exactly what makes a
    // camera pull-back read as "more sky and mountain becomes visible
    // above a ground that never moves" instead of "everything, ground
    // included, shrinks in place." No-ops (keeps the caller's transform)
    // when no groundView was handed in -- tests and any caller that hasn't
    // opted in still get the old, single-transform behavior.
    const groundCanvas = groundView ? groundView.stage : canvas;
    if (groundView) groundView.apply();
    this._drawGround(ctx, groundCanvas, worldX, originX, A, B, t, tint);
    // Light contact seam only — keep ranges readable (heavy mist/AO massacred them).
    this._drawTerrainFooting(ctx, groundCanvas, worldX, originX, A, B, t);
    this._drawFlood(ctx, groundCanvas);
    // In FRONT of the ground: as the camera pulls back, the near water comes
    // into frame and the strip they run along turns out to be an isthmus.
    this._drawForegroundSwell(ctx, groundCanvas, worldX, A, B, t);
    this._drawTransitionOverlays(ctx, groundCanvas, B);
  }

  /**
   * The near shore, revealed by pulling the camera back.
   *
   * At normal framing the trio run along a strip of ground with mountains
   * behind it, and that ground could be a continent. A wide shot has room
   * below the ground line to answer the question, so this fills it: sea on
   * the NEAR side too, which makes the strip an isthmus.
   *
   * Same swell mathematics as the distant wave at the horizon (see
   * DistantWave.js) with perspective applied -- longer wavelengths, larger
   * amplitude, faster apparent travel. Matching the form while scaling those
   * three is what makes the two read as one ocean seen at two distances
   * rather than as two unrelated effects.
   */
  _drawForegroundSwell(ctx, canvas, worldX, A, B, t) {
    const reveal = isthmusReveal01(this.pullback01 || 0);
    if (reveal <= 0.002) return;
    if (this._perf && !this._perf.heavyPostFx) return;

    // Anchored below the walking ground, so it never rises over the strip
    // they are actually standing on -- this is the water BEYOND the near
    // edge of the land, not a flood.
    const groundY = this._zoomedGroundY(canvas);
    // Sits in the upper part of the near-ground band. Deeper than this and
    // the shore is behind the transport bar, which is where the first
    // attempt put it -- present in a pixel diff, and cropped out of the shot.
    const baselineY = groundY + FG_SWELL_DROP_PX + (canvas.height - groundY) * 0.12;
    if (baselineY > canvas.height + FG_SWELL_AMP_PX * 4) return;

    const profile = t > 0.5 ? B : A;
    const energy = clamp01(profile.terrainEnergy ?? 1);
    // The nearest parallax in the scene: this water is at the viewer's feet,
    // so it travels with the ground rather than with any far layer, or it
    // reads as painted on the lens.
    const pts = foregroundSwellCrest({
      width: canvas.width, baselineY, ampPx: FG_SWELL_AMP_PX,
      tSec: this.tSec, scrollX: worldX, stepPx: CREST_STEP_PX, energy01: energy,
    });
    if (pts.length < 2) return;

    // Water reads as sky reflected: the same air color the ranges and the
    // ground are washed toward, pulled toward the biome's own halo so the
    // near sea belongs to this world. Darker than the distant swell -- near
    // water is deeper, and it has to stay under the characters standing in
    // front of it rather than competing with them.
    // Water reflects the sky, so it takes the same air color the ranges and
    // the ground are washed toward -- but DARKENED. The first attempt used
    // that color at full lightness and read as a lit sandbar rather than as
    // sea: near water is deep, and a body of water below a lit shore is the
    // darker of the two, not the brighter. The floor keeps it from going to
    // pure black on an already-dark palette.
    const base = ensureMinLightness(
      shiftLightness(
        this.lerpCache.get(this._airColor || '#3a4a60', this._rotated(profile.celestial.haloColor), 0.16),
        -FG_SWELL_DARKEN,
      ),
      0.08,
    );
    const { r, g, b } = hexToRgb(base);
    // NOT scaled by this.budget the way the atmospheric passes are. The
    // budget ramps from ~0.25 over a song's opening, and multiplying by it
    // made this two grey levels deep -- present in a pixel diff, invisible to
    // a viewer. This is not decoration: it is the answer to "what am I
    // standing on", and the whole point is that a wide shot reveals it. It
    // dims a little while the show is still coming up, and no further.
    const alpha = FG_SWELL_ALPHA * reveal * (0.6 + 0.4 * clamp01(this.budget));
    if (alpha < 0.01) return;

    ctx.save();
    const grad = ctx.createLinearGradient(0, baselineY - FG_SWELL_AMP_PX * 4, 0, canvas.height);
    grad.addColorStop(0, `rgba(${r},${g},${b},${(alpha * 0.72).toFixed(3)})`);
    grad.addColorStop(0.35, `rgba(${r},${g},${b},${alpha.toFixed(3)})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${(alpha * 0.94).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[pts.length - 1].x, canvas.height);
    ctx.lineTo(pts[0].x, canvas.height);
    ctx.closePath();
    ctx.fill();

    // The shore line itself. Near water gets a crisper edge than the distant
    // swell's soft glint -- acuity is a depth cue in its own right, and this
    // is the closest thing in the frame.
    if (!this.reducedFlash) {
      ctx.globalAlpha = FG_SWELL_EDGE_ALPHA * reveal * (0.6 + 0.4 * clamp01(this.budget));
      ctx.strokeStyle = this._rotated(profile.celestial.haloColor);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Subtle dark contact where ranges meet the walking ground -- follows the
   *  ridge's own smooth top curve (same path _drawGround built) rather than
   *  the flat physics reference, so the seam tracks the terrain instead of
   *  floating over/under it whenever the EQ bars rise or fall. */
  _drawTerrainFooting(ctx, canvas, worldX, originX, A, B, t) {
    const activeFx = t > 0.5 ? B.fx : A.fx;
    const isLake = activeFx === 'lakeReflection';
    ctx.save();
    if (this.groundField && !isLake) {
      const bars = this.groundField.visibleBars(worldX, originX, canvas.width);
      const strokePath = this._terrainTopPath(bars, canvas.height, false, canvas.width);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const pass of TERRAIN_FOOTING_AO_PASSES) {
        ctx.strokeStyle = `rgba(0,0,0,${pass.alpha})`;
        ctx.lineWidth = pass.lw;
        ctx.stroke(strokePath);
      }
    } else {
      const gy = this.groundField ? this.groundField.heightAt(worldX) : this.groundY;
      const ao = ctx.createLinearGradient(0, gy - 28, 0, gy + 8);
      ao.addColorStop(0, 'rgba(0,0,0,0)');
      ao.addColorStop(0.7, 'rgba(0,0,0,0.12)');
      ao.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ao;
      ctx.fillRect(0, gy - 28, canvas.width, 36);
    }
    ctx.restore();
  }

  /** Temporary flood: rising water (a tsunami spilling over, or the ground
   *  waterlogging under sustained rain -- see FloodDirector) across the
   *  near ground plane, then receding -- drawn on top of the ground/
   *  mountain layers (unlike the ocean plane itself, drawn far underneath
   *  everything in this same draw() call) so it genuinely reads as
   *  submerging the foreground where Midio walks.
   *  Pure rendering only -- floodActive/floodLevel01 are computed in
   *  FloodDirector (src/sim/FloodDirector.js), not here -- Simulation reads
   *  flood.level01/active for wet-footing traction the same frame,
   *  without depending on draw() having already run. */
  _drawFlood(ctx, canvas) {
    if (!this.flood?.active) return;
    const level01 = this.flood.level01;
    const FLOOD_RISE_PX = 46;
    const levelY = this.groundY - FLOOD_RISE_PX * level01;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createLinearGradient(0, levelY - 20, 0, canvas.height);
    grad.addColorStop(0, `${OCEAN_WATER_BLUE}00`);
    grad.addColorStop(0.3, `${OCEAN_WATER_BLUE}55`);
    grad.addColorStop(1, `${OCEAN_WATER_BLUE}33`);
    ctx.fillStyle = grad;
    ctx.globalAlpha = capFlashAlpha(0.85 * level01, this.reducedFlash);
    ctx.beginPath();
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * canvas.width;
      const y = levelY + Math.sin(x * 0.02 + this.tSec * 2) * 3;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Aerial perspective: a translucent sky-colored wash after a mountain
   *  layer, strongest behind the farthest range (L2) and none behind the
   *  nearest (L5), so distance accumulates atmosphere the way it does in
   *  the real world instead of every range reading as the same flat
   *  cutout. Color pulls toward a warm dawn/dusk tone via the day arc;
   *  the per-biome PERSONALITY.haze dial and calmLevel both scale it. */
  _drawHaze(ctx, canvas, layerKey, A, B, t, arc) {
    const styleHaze = styleDials(this.visualStyle).hazeMul || 1;
    const hazeMul = (Number.isFinite(this._hazeMul) ? this._hazeMul : 1) * styleHaze;
    const alpha = hazeAlpha(layerKey, hazeMul, this.calmLevel || 0);
    if (!(alpha > HAZE_EPS) || !Number.isFinite(alpha)) return;
    const skyTint = this.lerpCache.get(A.sky[2], B.sky[2], t);
    const hazeColor = this._rotated(this.lerpCache.get(skyTint, HAZE_WARM_COLOR, hazeWarmMix(arc?.hazeWarm ?? 0)));
    const { r, g, b } = hexToRgb(hazeColor);
    if (![r, g, b].every(Number.isFinite)) return;
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${alpha.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Forward scatter: one additive radial fill centred on the celestial,
    // so the air brightens toward the light instead of reading as a flat
    // tint. Dies with the layer (hazeLayers already collapses L2/L4 at
    // the deep rung) and is a hard skip when hazeScatter returns null.
    const scatter = hazeScatter(layerKey, this.light, hazeMul, canvas.height);
    if (scatter) {
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(scatter.cx, scatter.cy, 0, scatter.cx, scatter.cy, scatter.radius);
      halo.addColorStop(0, `rgba(${r},${g},${b},${scatter.alpha.toFixed(3)})`);
      halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(scatter.cx, scatter.cy, scatter.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Midasus's deep-space excursion: drawn here (behind the mountain
   * silhouettes drawn further down in draw()) so she genuinely reads as
   * "way in the distance" rather than just smaller. Renders her fading
   * constellations (completed figures frozen into the sky), the live
   * persistent trail sky-writing the current figure, and a small mote of
   * light at her current position. A no-op whenever she isn't away. */
  drawDeepSky(ctx, voyage, canvas) {
    if (!voyage) return;
    const nowMs = this.tSec * 1000;
    // Every position SkyVoyage stores (station, trail, constellations, the
    // permanent atlas, novae, sparkles, micro-slashes) is baked as an
    // ABSOLUTE pixel against Midasus's own stageW/stageH -- the nominal
    // canvasWidth/Height Simulation was constructed with (see Midasus.js),
    // which is NOT the same frame this draws into: Renderer pads the stage
    // by SHAKE_MARGIN_PX on every side and widens it further under camera
    // pull-back (CameraDirector.zoom), so the live canvas is routinely
    // wider/taller than the nominal dims these points were computed
    // against. Every other sky object in this file (stars, constellation
    // weaver, dust lanes...) stores a FRACTION and rescales against the
    // actual canvas at draw time for exactly this reason; SkyVoyage never
    // did, so her whole sky-writing trail sat pinned to the nominal span
    // while the live frame around it grew -- reading as drawn in the wrong
    // part of the screen, and (since the terrain silhouette below IS
    // rescaled to the live canvas every frame) landing in front of terrain
    // it should have been safely behind. This.w/this.h are the same
    // canvasWidth/canvasHeight Midasus was constructed with, so they're the
    // correct reference frame to rescale against.
    const sx = canvas.width / this.w, sy = canvas.height / this.h;
    const X = (x) => x * sx, Y = (y) => y * sy;

    // The Star Atlas draws whether or not she's away: every crystallized
    // constellation stays in the sky for the rest of the song, twinkling
    // per-star and glinting with the beat (atlasPulse rides hype.slam).
    if (voyage.atlas.length) {
      const pulse = voyage.atlasPulse || 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const entry of voyage.atlas) {
        // Short neighbor edges only — full polyline over sparse stars made
        // the "random straight line" sky triangles.
        ctx.strokeStyle = `hsla(${entry.hue}, 35%, 82%, ${0.09 * (1 + 1.2 * pulse)})`;
        ctx.lineWidth = 0.8;
        ctx.lineCap = 'round';
        const ATLAS_EDGE = 20;
        for (let i = 1; i < entry.stars.length; i++) {
          const a = entry.stars[i - 1], b = entry.stars[i];
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx * dx + dy * dy > ATLAS_EDGE * ATLAS_EDGE) continue;
          ctx.beginPath();
          ctx.moveTo(X(a.x), Y(a.y));
          ctx.lineTo(X(b.x), Y(b.y));
          ctx.stroke();
        }
        for (const s of entry.stars) {
          const twinkle = 0.5 + 0.5 * Math.sin(nowMs * 0.0013 + s.phase);
          ctx.fillStyle = `hsla(${entry.hue}, 45%, 88%, ${(0.16 + 0.16 * twinkle) * (1 + 1.6 * pulse)})`;
          ctx.beginPath();
          ctx.arc(X(s.x), Y(s.y), 1.1 + 0.5 * twinkle, 0, Math.PI * 2);
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
        const nx = X(n.x), ny = Y(n.y);

        ctx.strokeStyle = `hsla(${n.hue}, 70%, 85%, ${capFlashAlpha(0.7 * fade, this.reducedFlash)})`;
        ctx.lineWidth = 0.5 + 2 * fade;
        ctx.beginPath();
        ctx.arc(nx, ny, 4 + 62 * easeOut, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = `hsla(${n.hue}, 30%, 96%, ${capFlashAlpha(fade, this.reducedFlash)})`;
        ctx.beginPath();
        ctx.arc(nx, ny, 1 + 3 * fade, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `hsla(${n.hue}, 60%, 90%, ${capFlashAlpha(0.5 * fade, this.reducedFlash)})`;
        ctx.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const ang = n.phase + (k / 5) * Math.PI * 2;
          const len = 10 + 42 * easeOut;
          ctx.beginPath();
          ctx.moveTo(nx + Math.cos(ang) * 5, ny + Math.sin(ang) * 5);
          ctx.lineTo(nx + Math.cos(ang) * len, ny + Math.sin(ang) * len);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    if (voyage.depth <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Frozen figures: short curve segments only (skip long chords that
    // used to read as random straight lines across the sky).
    const CONST_EDGE_MAX = 22;
    for (const c of voyage.constellations) {
      const life = 1 - clamp01((nowMs - c.bornMs) / 6000);
      if (life <= 0) continue;
      ctx.strokeStyle = `hsla(${c.hue}, 60%, 80%, ${0.45 * life})`;
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < c.points.length; i++) {
        const a = c.points[i - 1], b = c.points[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx * dx + dy * dy > CONST_EDGE_MAX * CONST_EDGE_MAX) continue;
        ctx.beginPath();
        ctx.moveTo(X(a.x), Y(a.y));
        ctx.lineTo(X(b.x), Y(b.y));
        ctx.stroke();
      }
      ctx.fillStyle = `hsla(${c.hue}, 75%, 90%, ${0.9 * life})`;
      for (const p of c.points) {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Atlas crystal edges: only short links (same rule — no sky triangles).
    // (Full atlas stroke is drawn above; keep stars, drop long polylines.)

    // Persistent trail: a soft wide glow pass underneath a bright thin
    // core. Skip gap / teleport chords so a phase jump never paints a
    // straight line across the figure.
    const trail = voyage.trail;
    const GAP = 28;
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      if (b.gap) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx * dx + dy * dy > GAP * GAP) continue;
      const u = i / trail.length; // older points fade toward transparent
      const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y);
      ctx.strokeStyle = `hsla(${b.hue}, 65%, 78%, ${0.22 * u})`;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = `hsla(${b.hue}, 75%, 88%, ${0.85 * u})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    // Kick sparkles: radial bursts flung off her on every beat out there.
    for (const s of voyage.sparkles) {
      const life = 1 - s.age / 0.6;
      if (life <= 0) continue;
      ctx.fillStyle = `hsla(${s.hue}, 80%, 88%, ${0.85 * life})`;
      ctx.fillRect(X(s.x) - 1, Y(s.y) - 1, 2.2, 2.2);
    }

    // Micro-slashes: each melody onset cuts a brief bright line at her
    // deep-sky position -- her note-slash vocabulary, miniaturized.
    ctx.lineCap = 'round';
    for (const s of voyage.microSlashes) {
      const u = s.age / 0.25;
      if (u >= 1) continue;
      const ext = 8 + 14 * u;
      const sx2 = X(s.x), sy2 = Y(s.y);
      ctx.strokeStyle = `hsla(${s.hue}, 75%, 85%, ${0.9 * (1 - u)})`;
      ctx.lineWidth = 1.6 * (1 - u * 0.5);
      ctx.beginPath();
      ctx.moveTo(sx2 - Math.cos(s.ang) * ext, sy2 - Math.sin(s.ang) * ext);
      ctx.lineTo(sx2 + Math.cos(s.ang) * ext, sy2 + Math.sin(s.ang) * ext);
      ctx.stroke();
    }

    // Her current position: a small glowing comet-head, but ONLY once she's
    // genuinely deep-sky -- WINDUP/ASCENT/REENTRY now render her real mesh
    // in the character layer (see Midasus.draw()), so drawing this dot
    // during those phases would double her up.
    if (voyage.phase === VoyagePhase.DEEP_SPACE) {
      const r = 2 + 3 * (1 - voyage.depth);
      const px = X(voyage.p.x), py = Y(voyage.p.y);
      ctx.fillStyle = `hsla(${voyage.hue}, 60%, 85%, ${0.28 * voyage.depth})`;
      ctx.beginPath();
      ctx.arc(px, py, r * 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${voyage.hue}, 80%, 92%, ${0.6 + 0.4 * voyage.depth})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /** Cut flash + shutter wipe, fired by the Dramaturgy Director. */
  _drawTransitionOverlays(ctx, canvas, B) {
    const nowMs = this.tSec * 1000;
    const u = (nowMs - this._shutterStartMs) / this._shutterBarMs;
    if (u >= 0 && u <= 1) {
      // Vertical shutter columns closing then reopening over one bar,
      // phase-staggered so the wipe ripples instead of slamming.
      //
      // Coverage is capped well short of meeting in the middle. At 0.5 per
      // half these columns closed the frame to solid black for about a
      // second -- the screen biting shut. It should read as the world
      // narrowing on a moment, not as the picture being taken away.
      //
      // Reduced-flash halves it again. This is the largest, highest-contrast
      // event in the game and it was the one thing in this file ignoring the
      // accessibility cap entirely.
      const cover = this.reducedFlash ? SHUTTER_MAX_COVER * 0.5 : SHUTTER_MAX_COVER;
      ctx.save();
      ctx.fillStyle = B.silhouette;
      const cols = 14;
      const colW = canvas.width / cols;
      for (let i = 0; i < cols; i++) {
        const stagger = 0.8 + 0.2 * Math.sin(i * 1.7);
        const h = canvas.height * cover * Math.sin(Math.PI * Math.min(1, u * 1.05)) * stagger;
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

    // Near-field occluders: huge biome-landmark silhouettes sweeping past
    // faster than the characters, close enough to occlude them. Gated on
    // the same perf signal as the veil above -- costs a handful of vector
    // shape draws per visible sector, cheaper than the veil's 3 gradients.
    if (this.currentBlend) {
      const dominant = this.currentBlend.t > 0.5 ? this.currentBlend.to : this.currentBlend.from;
      // Same name/archetype mismatch as decorateStrip above: NearField keys
      // LANDMARKS and (via biomeByName) its silhouette-darkening color off
      // an archetype name, not a synthesized palette's own display name.
      const dominantLandmarkKey = this._profile(dominant)?.landmarkKey || dominant;
      const ratio = CodaDirector.delaminateRatio(NEARFIELD_RATIO, this.unravel);
      const kick = kickEnv(this.tSec * 1000 - this._danceKickMs - 60) * this._danceKickAmp;
      this.nearField.draw(ctx, canvas, worldX, {
        tSec: this.tSec, kick, biomeName: dominantLandmarkKey, reducedMotion: !!this.reducedFlash, ratio,
      });

      // Ground scatter: the frontmost plane's small detail, drawn after
      // NearField so the two near-field layers stack near-to-camera last.
      // This is the only layer in the scene that outruns the characters by
      // this much, and that is what finally gives the ground a read on how
      // fast the world is going past. Sheds on the same perf rung as the
      // rest of the foreground (this whole method is already gated on it).
      this.groundScatter.draw(ctx, canvas, worldX, {
        groundY: this.groundY,
        kick,
        ratio: CodaDirector.delaminateRatio(SCATTER_RATIO, this.unravel),
        // Rides the ambient light budget like every other decorative layer,
        // so a quiet section quiets the ground too instead of leaving grit
        // at full contrast against a faded world.
        alpha: 0.55 + 0.45 * clamp01(this.budget),
      });
    }

    this._drawWildfire(ctx, canvas, worldX);
  }

  /** Wildfire: near flames tracking the burn front's real world-x extent,
   *  a wind-sheared smoke column, and a permanent dark scorch strip left
   *  behind on the ground -- "weather with consequences," the same
   *  pattern groundCover (frost) and floodLevel01 (wet footing) already
   *  established. Ground-locked (screen-x uses the same
   *  Midio-anchored origin as everything else drawn on the walking
   *  ground), unlike GroundScatter's own independently-scrolling
   *  parallax address space, so the burn genuinely tracks a real
   *  location Midio walks through rather than a decorative texture. */
  _drawWildfire(ctx, canvas, worldX) {
    if (!this.fire) return;
    const originX = Number.isFinite(this.midioX) ? this.midioX : this.w * 0.5;
    const toScreen = (wx) => wx - worldX + originX;

    // Permanent scorch: every recorded burned interval, drawn regardless
    // of whether the fire itself is still active, so walking back through
    // an old burn still reads as scarred ground.
    if (this.fire.burnedIntervals.length) {
      ctx.save();
      ctx.fillStyle = 'rgba(20,12,8,0.4)';
      for (const iv of this.fire.burnedIntervals) {
        const sx0 = toScreen(iv.x0), sx1 = toScreen(iv.x1);
        if (sx1 < -20 || sx0 > canvas.width + 20) continue;
        ctx.fillRect(Math.max(-20, sx0), this.groundY - 3, Math.min(canvas.width + 20, sx1) - Math.max(-20, sx0), 10);
      }
      ctx.restore();
    }

    const I = this.fire.intensity01;
    if (!(I > 0.02)) return;
    const sx0 = toScreen(this.fire.x0), sx1 = toScreen(this.fire.x1);
    if (sx1 < -60 || sx0 > canvas.width + 60) return; // whole front off-screen

    // Near flames: a bounded number of flickering columns spread evenly
    // across the front's visible span, regardless of how wide the real
    // world extent has grown -- draw cost never scales with fire age.
    const spanPx = Math.max(1, sx1 - sx0);
    const count = Math.max(3, Math.min(28, Math.round(spanPx / 40)));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const sx = sx0 + (spanPx * (i + 0.5)) / count;
      if (sx < -20 || sx > canvas.width + 20) continue;
      const worldXAt = worldX + (sx - originX);
      const flick = flameFlicker(worldXAt, this.tSec);
      const h = (14 + 20 * flick) * I;
      const w = 8 + 5 * flick;
      const grad = ctx.createLinearGradient(sx, this.groundY, sx, this.groundY - h);
      grad.addColorStop(0, `rgba(255,120,30,${(0.85 * I).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(255,70,20,${(0.6 * I).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,210,60,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx - w / 2, this.groundY);
      ctx.quadraticCurveTo(sx - w * 0.15, this.groundY - h * 0.6, sx, this.groundY - h);
      ctx.quadraticCurveTo(sx + w * 0.15, this.groundY - h * 0.6, sx + w / 2, this.groundY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Smoke column: a handful of soft, upward-drifting puffs rising from
    // the front's midpoint, sheared by the same wind that shapes the
    // front's own asymmetry -- the sky-grade half of this is the haze
    // multiplier boost in the personality update block, this is the
    // visible plume itself.
    const midSx = (sx0 + sx1) / 2;
    const windLeanPx = 40 * (this.fire.windProjectionValue || 0);
    ctx.save();
    ctx.globalAlpha = 0.5 * I;
    for (let i = 0; i < 5; i++) {
      const h01 = i / 4;
      const puffY = this.groundY - 30 - h01 * 220;
      const puffX = midSx + smokeDrift(h01, this.tSec, windLeanPx);
      const r = 26 + 34 * h01;
      const g = ctx.createRadialGradient(puffX, puffY, 0, puffX, puffY, r);
      g.addColorStop(0, `rgba(70,60,55,${(0.5 * (1 - h01 * 0.6)).toFixed(3)})`);
      g.addColorStop(1, 'rgba(70,60,55,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(puffX, puffY, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawSky(ctx, canvas, A, B, t, night = 0) {
    const dials = styleDials(this.visualStyle);
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    // Night + rendered both pull toward deep space so stars/ocean have a stage.
    const nightPull = 0.62 * night + (dials.spaceWash ? 0.14 : 0);
    // Variable stop count (SongDNA.harmonicComplexity, via PaletteSynth's
    // skyStops): a harmonically richer song gets a subtler, more banded sky
    // gradient instead of the flat 3-stop default. Only takes effect when
    // BOTH sides of a transition carry skyStops of the same length --
    // crossfading against a stock biome or the older customBiome importer
    // (neither sets skyStops) falls back to the original fixed 3-stop
    // A.sky/B.sky exactly as before, so nothing else that reads sky[0..2]
    // for its own purposes (fire glow, water reflection, light rig, etc.)
    // is affected either way.
    const stopsA = A.skyStops, stopsB = B.skyStops;
    const useVariable = Array.isArray(stopsA) && Array.isArray(stopsB)
      && stopsA.length === stopsB.length && stopsA.length >= 3;
    const n = useVariable ? stopsA.length : 3;
    for (let i = 0; i < n; i++) {
      const from = useVariable ? stopsA[i] : A.sky[i];
      const to = useVariable ? stopsB[i] : B.sky[i];
      const stop = this._rotated(this.lerpCache.get(from, to, t));
      // Upper sky (i=0) goes more space-black; lower sky keeps more biome
      // color. n===3 keeps the exact original 1/0.75/0.45 steps (byte-
      // identical for every biome that doesn't opt into extra stops); a
      // richer n interpolates the same curve continuously across more stops.
      const posFrac = n > 1 ? i / (n - 1) : 0;
      const pull = n === 3
        ? nightPull * (i === 0 ? 1 : i === 1 ? 0.75 : 0.45)
        : nightPull * lerp(1, 0.45, posFrac);
      g.addColorStop(posFrac, pull > 0.02
        ? this.lerpCache.get(stop, NIGHT_SKY_COLOR, pull)
        : stop);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);


    if (A.fx === 'aurora' || B.fx === 'aurora') {
      const auroraAlpha = (A.fx === 'aurora' ? 1 - t : 0) + (B.fx === 'aurora' ? t : 0);
      if (auroraAlpha > 0.02) this._drawAurora(ctx, canvas, auroraAlpha);
    }
    if (A.fx === 'nebulaBloom' || B.fx === 'nebulaBloom') {
      const alpha = (A.fx === 'nebulaBloom' ? 1 - t : 0) + (B.fx === 'nebulaBloom' ? t : 0);
      if (alpha > 0.02) this._drawNebulaBloom(ctx, canvas, alpha, A, B, t);
    }
    if (A.fx === 'godRays' || B.fx === 'godRays') {
      const alpha = (A.fx === 'godRays' ? 1 - t : 0) + (B.fx === 'godRays' ? t : 0);
      if (alpha > 0.02) this._drawGodRays(ctx, canvas, alpha);
    }
    if (A.fx === 'sporeGlow' || B.fx === 'sporeGlow') {
      const alpha = (A.fx === 'sporeGlow' ? 1 - t : 0) + (B.fx === 'sporeGlow' ? t : 0);
      if (alpha > 0.02) this._drawSporeGlow(ctx, canvas, alpha, t > 0.5 ? B : A);
    }
    if (A.fx === 'bioluminescence' || B.fx === 'bioluminescence') {
      const alpha = (A.fx === 'bioluminescence' ? 1 - t : 0) + (B.fx === 'bioluminescence' ? t : 0);
      if (alpha > 0.02) this._drawBioluminescence(ctx, canvas, alpha);
    }
    if (A.fx === 'sunMotes' || B.fx === 'sunMotes') {
      const alpha = (A.fx === 'sunMotes' ? 1 - t : 0) + (B.fx === 'sunMotes' ? t : 0);
      if (alpha > 0.02) this._drawSunMotes(ctx, canvas, alpha, t > 0.5 ? B : A);
    }
    if (A.fx === 'crystalGlint' || B.fx === 'crystalGlint') {
      const alpha = (A.fx === 'crystalGlint' ? 1 - t : 0) + (B.fx === 'crystalGlint' ? t : 0);
      if (alpha > 0.02) this._drawCrystalGlint(ctx, canvas, alpha, t > 0.5 ? B : A);
    }
    if (A.fx === 'emberGlow' || B.fx === 'emberGlow') {
      const alpha = (A.fx === 'emberGlow' ? 1 - t : 0) + (B.fx === 'emberGlow' ? t : 0);
      if (alpha > 0.02) this._drawEmberGlow(ctx, canvas, alpha, t > 0.5 ? B : A);
    }
    // Soft atmospheric + faint space-nebula wash (under stars).
    {
      const top = this._rotated(this.lerpCache.get(A.sky[0], B.sky[0], t));
      const mid = this._rotated(this.lerpCache.get(A.sky[1], B.sky[1], t));
      const { r: r0, g: g0, b: b0 } = hexToRgb(top);
      const { r: r1, g: g1, b: b1 } = hexToRgb(mid);
      const nebA = hexToRgb(SPACE_NEBULA_A);
      const nebB = hexToRgb(SPACE_NEBULA_B);
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      const plate = ctx.createRadialGradient(
        canvas.width * 0.55, canvas.height * 0.16, 16,
        canvas.width * 0.5, canvas.height * 0.32, canvas.height * 0.7,
      );
      plate.addColorStop(0, `rgba(${r1},${g1},${b1},0.4)`);
      plate.addColorStop(0.5, `rgba(${r0},${g0},${b0},0.16)`);
      plate.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = plate;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Indigo / violet space dust — orbital, not pure daylight.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.07 + 0.1 * night;
      const dust = ctx.createRadialGradient(
        canvas.width * 0.28, canvas.height * 0.12, 10,
        canvas.width * 0.35, canvas.height * 0.22, canvas.width * 0.38,
      );
      dust.addColorStop(0, `rgba(${nebB.r},${nebB.g},${nebB.b},0.55)`);
      dust.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dust;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.55);
      ctx.globalAlpha = 0.05 + 0.08 * night;
      const dust2 = ctx.createRadialGradient(
        canvas.width * 0.78, canvas.height * 0.18, 8,
        canvas.width * 0.72, canvas.height * 0.28, canvas.width * 0.32,
      );
      dust2.addColorStop(0, `rgba(${nebA.r},${nebA.g},${nebA.b},0.5)`);
      dust2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dust2;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.5);
      ctx.restore();
    }

    // Star backdrop last in the sky stack so it always reads as depth behind
    // the world, not a faint garnish wiped by washes above it.
    this._drawStarfield(ctx, canvas, A, B, t, night);
  }

  /** Layered starfield: ambient by day, rich at night / starTwinkle biomes. */
  _drawStarfield(ctx, canvas, A, B, t, night = 0) {
    const dials = styleDials(this.visualStyle);
    const showStars = A.fx === 'starTwinkle' || B.fx === 'starTwinkle';
    const twinkleBlend = showStars
      ? (A.fx === 'starTwinkle' ? 1 - t : 0) + (B.fx === 'starTwinkle' ? t : 0)
      : 0;
    // Always a living backdrop — night, space style, and star biomes amplify.
    // Base raised from 0.34 -- too dim outside the best conditions, reading
    // as "a dull band of mostly nothing" (reported live; see
    // StarCatalogue.perceptualStretch's floor, raised alongside this).
    const starAmb = dials.starAmbient ?? 1;
    const ambient = (0.48 + 0.18 * (this.calmLevel || 0)) * starAmb;
    const nightBoost = 0.55 + 1.55 * night;
    const biomeBoost = 0.95 * twinkleBlend;
    const spaceFloor = dials.spaceWash ? 0.22 : 0;
    const alpha = clamp01(ambient * nightBoost + biomeBoost + spaceFloor) * this.openingGain;
    if (alpha < 0.04) return;

    const twinkleRate = 1.15 + 0.7 * (this.calmLevel || 0) + 0.35 * night;
    const scroll = (this.tSec * 1.8) % canvas.width; // glacial drift
    // The sky field's height on the ACTUAL canvas being drawn to -- shared
    // by every rescale below (stars, dust lanes, deep sky) so they all
    // agree on where the field ends, no matter how wide the stage is.
    const skyH = canvas.height * STAR_SKY_FRAC;

    // Soft milky / galactic wash. Sits on the SAME tilted axis the star
    // density does (GALACTIC_BAND, shared with StarCatalogue) -- it used to
    // be a horizontal bar pinned at 0.14 of the canvas while the density
    // ridge sat at 0.32, so the painted galaxy and the actual stars
    // disagreed about where the plane was.
    {
      const yL = galacticBandCenterY(0, skyH);
      const yR = galacticBandCenterY(1, skyH);
      const half = skyH * GALACTIC_BAND.halfFrac;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const bandA = 0.05 + 0.06 * night;
      // Rotate into the band's own frame so the gradient runs perpendicular
      // to the plane rather than straight down the screen.
      const ang = Math.atan2(yR - yL, canvas.width);
      const diag = Math.hypot(canvas.width, yR - yL);
      ctx.translate(0, yL);
      ctx.rotate(ang);
      const band = ctx.createLinearGradient(0, -half, 0, half);
      band.addColorStop(0, 'rgba(160,190,255,0)');
      band.addColorStop(0.5, `rgba(190,210,255,${bandA.toFixed(3)})`);
      band.addColorStop(1, 'rgba(160,190,255,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, -half, diag, half * 2);
      // Dark nebulae, drawn INSIDE the band's own rotated frame and clipped
      // to the wash they occlude. A smooth airbrushed stripe is the most
      // synthetic thing a night sky can do; the real plane is broken up by
      // dust clouds that block the glow behind them (the Great Rift), so the
      // band gets its structure from what's missing, not from more light.
      // 'multiply' against black, NOT destination-out: these have to darken
      // the sky they sit in front of, and destination-out would punch a hole
      // clean through the backdrop to transparent instead.
      ctx.globalCompositeOperation = 'multiply';
      for (const d of this.dustLanes) {
        // Rescaled from the cached fraction against the ACTUAL canvas, not
        // the field the catalogue was generated over -- see the comment at
        // the star cache above for why that distinction matters.
        const dx = d.xFrac * canvas.width;
        const dyAbs = d.yFrac * skyH;
        // The lanes were generated in field space against the same tilted
        // axis, so undo the band's own tilt to place them in this frame.
        const dy = dyAbs - galacticBandCenterY(dx / Math.max(1, canvas.width), skyH);
        const breathe = 0.85 + 0.15 * Math.sin(this.tSec * 0.06 + d.phase);
        ctx.save();
        ctx.translate(dx, dy);
        ctx.rotate(d.rot - ang);
        const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g2.addColorStop(0, `rgba(0,0,0,${(d.alpha * breathe).toFixed(3)})`);
        g2.addColorStop(0.55, `rgba(0,0,0,${(d.alpha * breathe * 0.5).toFixed(3)})`);
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.scale(d.rxFrac * canvas.width, d.ryFrac * skyH);
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // Deep-sky objects: faint resolved smudges, under the stars so a star
    // can sit in front of one. These do not twinkle -- an extended source
    // averages scintillation away, which is exactly the cue that separates
    // "a nebula" from "a bright star" at a glance.
    {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const o of this.deepSky) {
        const a = alpha * o.alpha * (0.85 + 0.15 * Math.sin(this.tSec * 0.09 + o.phase));
        if (a < 0.004) continue;
        const ox = o.xFrac * canvas.width, oy = o.yFrac * skyH, or_ = o.rFrac * skyH;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate(o.rot);
        ctx.scale(1, o.squash);
        const g3 = ctx.createRadialGradient(0, 0, 0, 0, 0, or_);
        g3.addColorStop(0, `hsla(${o.hue},58%,80%,${(a * 1.6).toFixed(4)})`);
        g3.addColorStop(0.45, `hsla(${o.hue},52%,68%,${(a * 0.7).toFixed(4)})`);
        g3.addColorStop(1, `hsla(${o.hue},48%,60%,0)`);
        ctx.fillStyle = g3;
        ctx.beginPath();
        ctx.arc(0, 0, or_, 0, Math.PI * 2);
        ctx.fill();
        // A cluster is granular, not a smooth blob -- a few resolved
        // members are what make it read as a swarm of stars.
        if (o.kind === 'cluster') {
          ctx.fillStyle = `hsla(${o.hue},40%,92%,${(a * 2.2).toFixed(4)})`;
          for (let k = 0; k < 9; k++) {
            const ang2 = (k / 9) * Math.PI * 2 + o.phase;
            const rr = or_ * (0.15 + 0.65 * ((k * 7919) % 100) / 100);
            ctx.fillRect(Math.cos(ang2) * rr, Math.sin(ang2) * rr, 1, 1);
          }
        }
        ctx.restore();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Cheap dots for the field; soft glow only for hero stars (layer 2).
    for (const s of this.stars) {
      // Per-star scintillation depth (StarCatalogue.js): fainter, more
      // point-like stars and stars nearer the horizon twinkle harder, real
      // atmospheric stars do not all blink at the same depth. Falls back to
      // a fixed mid-range depth for anything without catalogue fields (kept
      // defensive since `stars` is public state some other path could feed).
      const twDepth = s.mag != null
        ? twinkleAmplitude(s.mag, s.altitude01 ?? 0.5)
        : 0.4;
      const tw = (1 - twDepth) + twDepth * (0.5 + 0.5 * Math.sin(this.tSec * twinkleRate * (0.7 + s.bright) + s.phase));
      // Air path: low stars lose real light before they ever reach the eye,
      // so the field thins and warms toward the ridgeline instead of walling
      // off at full brightness the way a flat scatter does.
      const a = alpha * s.bright * tw * (s.ext ?? 1);
      // Faint floor: a 0.03 cut used to wipe the dimmer half of the field
      // (especially near the horizon, after extinction), leaving only the
      // brighter mid-sky survivors — another way the stars read as a chunk.
      if (a < 0.01) continue;
      const layerDrift = (1 + s.layer * 0.6) * scroll * 0.02;
      // Rescaled from the cached fraction against the ACTUAL canvas, not the
      // (possibly narrower) field the catalogue was generated over -- a
      // camera pull-back widens the stage BiomeManager draws into, and an
      // absolute pixel baked in at generation time would stay pinned to its
      // original span while the sky around it widened.
      let x = s.xFrac * canvas.width + layerDrift;
      if (x > canvas.width) x -= canvas.width;
      else if (x < 0) x += canvas.width;
      const y = s.yFrac * skyH;
      const sz = s.size;

      // The same air path that dimmed it also scatters its blue out first,
      // so what survives is warmer. Pull the star's own spectral hue toward
      // horizon-orange in proportion to how much light it lost.
      const red = s.redden ?? 0;
      const hue = s.hue > 0 ? lerpHue(s.hue, 24, red * 0.6) : 24;
      const useHue = s.hue > 0 || red > 0.35;

      if (s.layer === 2) {
        const r = Math.max(1.2, sz * 1.6);
        ctx.globalAlpha = a * 0.55;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        if (useHue) {
          grad.addColorStop(0, `hsla(${hue},62%,92%,1)`);
          grad.addColorStop(0.45, `hsla(${hue},50%,80%,0.3)`);
          grad.addColorStop(1, `hsla(${hue},40%,70%,0)`);
        } else {
          grad.addColorStop(0, 'rgba(255,255,255,1)');
          grad.addColorStop(0.4, 'rgba(220,230,255,0.35)');
          grad.addColorStop(1, 'rgba(200,220,255,0)');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // Diffraction spikes, only on the ones bright enough to earn them.
        // They have to TAPER -- a constant-width, constant-alpha cross reads
        // as a drawn crosshair rather than as light -- so each arm runs
        // through a gradient that is solid only at the core and reaches zero
        // at the tip, which is the shape real spikes actually have.
        if (a > 0.34) {
          const spike = r * (1.6 + 1.0 * tw);
          const tint = useHue ? `hsla(${hue},45%,94%,` : 'rgba(226,236,255,';
          ctx.globalAlpha = a * 0.45;
          ctx.lineWidth = 0.7;
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const gS = ctx.createLinearGradient(
              x - dx * spike, y - dy * spike, x + dx * spike, y + dy * spike,
            );
            gS.addColorStop(0, `${tint}0)`);
            gS.addColorStop(0.5, `${tint}1)`);
            gS.addColorStop(1, `${tint}0)`);
            ctx.strokeStyle = gS;
            ctx.beginPath();
            ctx.moveTo(x - dx * spike, y - dy * spike);
            ctx.lineTo(x + dx * spike, y + dy * spike);
            ctx.stroke();
          }
        }

        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      } else {
        ctx.globalAlpha = a;
        if (useHue) ctx.fillStyle = `hsl(${hue},55%,88%)`;
        else ctx.fillStyle = s.layer === 1 ? '#f0f4ff' : '#d8e0f5';
        ctx.fillRect(x, y, sz, sz);
      }
    }

    // Planets, over the stars: brighter than anything near them, obviously
    // colored, and deliberately NOT twinkling -- a resolved disc averages
    // scintillation away, so holding perfectly steady in a field of
    // shivering points is the whole tell.
    for (const p of this.planets) {
      const pa = alpha * p.bright * extinction01(p.altitude01) * 1.15;
      if (pa < 0.03) continue;
      const py = p.yFrac * skyH;
      let px = p.xFrac * canvas.width + scroll * 0.02;
      if (px > canvas.width) px -= canvas.width;
      const r = 3.2 * p.size;
      ctx.globalAlpha = pa * 0.5;
      const pg = ctx.createRadialGradient(px, py, 0, px, py, r);
      pg.addColorStop(0, `hsla(${p.hue},${p.sat}%,88%,1)`);
      pg.addColorStop(0.4, `hsla(${p.hue},${p.sat}%,76%,0.35)`);
      pg.addColorStop(1, `hsla(${p.hue},${p.sat}%,70%,0)`);
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      // The disc itself -- a couple of px across, not a point.
      ctx.globalAlpha = pa;
      ctx.fillStyle = `hsl(${p.hue},${Math.round(p.sat * 0.8)}%,92%)`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.9, p.size * 0.62), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Soft pastel gas clouds for NEBULA — additive blobs that drift slowly. */
  _drawNebulaBloom(ctx, canvas, alpha, A, B, t) {
    const c0 = this._rotated(this.lerpCache.get(A.sky[2] || '#ff8ec8', B.sky[2] || '#ff8ec8', t));
    const c1 = this._rotated(this.lerpCache.get(A.celestial?.haloColor || '#c89bff', B.celestial?.haloColor || '#c89bff', t));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const blobs = [
      { x: 0.22, y: 0.22, rx: 0.28, ry: 0.16, col: c0, ph: 0 },
      { x: 0.62, y: 0.18, rx: 0.34, ry: 0.20, col: c1, ph: 1.7 },
      { x: 0.45, y: 0.38, rx: 0.22, ry: 0.14, col: c0, ph: 3.1 },
      { x: 0.78, y: 0.32, rx: 0.18, ry: 0.12, col: c1, ph: 4.4 },
    ];
    for (const b of blobs) {
      const breathe = 0.75 + 0.25 * Math.sin(this.tSec * 0.35 + b.ph);
      const cx = canvas.width * (b.x + 0.02 * Math.sin(this.tSec * 0.2 + b.ph));
      const cy = canvas.height * (b.y + 0.015 * Math.cos(this.tSec * 0.25 + b.ph));
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, canvas.width * b.rx * breathe);
      grad.addColorStop(0, `${b.col}55`);
      grad.addColorStop(0.55, `${b.col}18`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.55 * alpha * breathe;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, canvas.width * b.rx * breathe, canvas.height * b.ry * breathe, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Underwater / late-afternoon light shafts for CORAL (and similar). */
  _drawGodRays(ctx, canvas, alpha) {
    const cx = canvas.width * 0.72;
    const cy = canvas.height * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const ang = -0.55 + i * 0.16 + Math.sin(this.tSec * 0.4 + i) * 0.03;
      const len = canvas.height * (0.55 + 0.1 * Math.sin(this.tSec * 0.5 + i * 0.7));
      const half = 8 + i * 2.5;
      const flick = 0.55 + 0.45 * Math.sin(this.tSec * (0.9 + i * 0.11) + i);
      ctx.globalAlpha = 0.07 * alpha * flick;
      ctx.fillStyle = '#ffe8c0';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang - 0.04) * half, cy + Math.sin(ang - 0.04) * half);
      ctx.lineTo(cx + Math.cos(ang) * len + Math.cos(ang + Math.PI / 2) * half * 2.5,
        cy + Math.sin(ang) * len + Math.sin(ang + Math.PI / 2) * half * 2.5);
      ctx.lineTo(cx + Math.cos(ang) * len - Math.cos(ang + Math.PI / 2) * half * 2.5,
        cy + Math.sin(ang) * len - Math.sin(ang + Math.PI / 2) * half * 2.5);
      ctx.lineTo(cx + Math.cos(ang + 0.04) * half, cy + Math.sin(ang + 0.04) * half);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  _drawAurora(ctx, canvas, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Soft filled ribbons (no hard stroke edges — stroke bands
    // read as cyan sky-wide "line glitch" when stacked).
    for (let band = 0; band < 3; band++) {
      const hue = 160 + ((this.tSec * 12 + band * 40) % 140);
      ctx.fillStyle = `hsla(${hue},70%,58%,${0.07 * alpha})`;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 16) {
        const y = 60 + band * 30 + Math.sin(x * 0.006 + this.tSec * 0.6 + band) * 26;
        if (x === 0) ctx.moveTo(x, y - 14); else ctx.lineTo(x, y - 14);
      }
      for (let x = canvas.width; x >= 0; x -= 16) {
        const y = 60 + band * 30 + Math.sin(x * 0.006 + this.tSec * 0.6 + band) * 26;
        ctx.lineTo(x, y + 14);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Rising bioluminescent motes for LUMEN's spore-lit canopy: soft glow
   *  patches that pulse and drift upward, distinct from starTwinkle's fixed
   *  pinpoint dots. */
  _drawSporeGlow(ctx, canvas, alpha, profile) {
    const col = profile?.particles?.color || '#9dffc8';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i++) {
      const phase = i * 1.3;
      const x = canvas.width * ((i * 0.097 + 0.05) % 1);
      const rise = (this.tSec * 8 + i * 37) % (canvas.height * 0.7);
      const y = canvas.height * 0.85 - rise;
      const pulse = 0.5 + 0.5 * Math.sin(this.tSec * 1.1 + phase);
      const r = 3 + 4 * pulse;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      grad.addColorStop(0, `${col}aa`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha * (0.35 + 0.4 * pulse);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Vertical bioluminescent curtains rising from the deep for ABYSS --
   *  aurora's cousin, but columns of light drifting upward instead of
   *  horizontal wavy bands, so the two never read the same. */
  _drawBioluminescence(ctx, canvas, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let col = 0; col < 5; col++) {
      const hue = 175 + col * 8;
      const x = canvas.width * (0.12 + col * 0.19) + Math.sin(this.tSec * 0.25 + col) * 14;
      const sway = Math.sin(this.tSec * 0.3 + col * 1.7) * 18;
      ctx.strokeStyle = `hsla(${hue},90%,65%,${0.14 * alpha})`;
      ctx.lineWidth = 14;
      ctx.beginPath();
      for (let y = canvas.height; y >= canvas.height * 0.15; y -= 20) {
        const drift = sway * (1 - y / canvas.height);
        if (y === canvas.height) ctx.moveTo(x + drift, y); else ctx.lineTo(x + drift, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Drifting golden light motes for AURUM -- an ambient sunlit haze
   *  wandering the whole frame, unlike petalPile's grounded, shedding
   *  piles. */
  _drawSunMotes(ctx, canvas, alpha, profile) {
    const col = profile?.particles?.color || '#ffcc66';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 24; i++) {
      const seed = i * 12.9898;
      const x = canvas.width * ((Math.sin(seed) * 0.5 + 0.5 + this.tSec * 0.01 * (1 + (i % 3))) % 1);
      const y = canvas.height * ((Math.cos(seed * 1.7) * 0.5 + 0.5 + Math.sin(this.tSec * 0.2 + i) * 0.05) % 1);
      const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.tSec * 1.4 + i * 2.1));
      ctx.globalAlpha = alpha * 0.5 * twinkle;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + 1.2 * twinkle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Sharp four-point flare glints for GEODE -- faceted crystal catching
   *  light at hard angles, unlike starTwinkle's soft round dots: each glint
   *  is a thin cross flare that snaps to full brightness and decays, never
   *  a smooth pulse. */
  _drawCrystalGlint(ctx, canvas, alpha, profile) {
    const col = profile?.particles?.color || '#e0b0ff';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col;
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const seed = i * 7.234;
      const x = canvas.width * ((Math.sin(seed) * 0.5 + 0.5));
      const y = canvas.height * ((Math.cos(seed * 1.9) * 0.5 + 0.5) * 0.6);
      const cyclePos = (this.tSec * 0.5 + i * 0.37) % 1;
      const snap = Math.max(0, 1 - cyclePos * 4); // sharp attack, fast decay
      if (snap <= 0.01) continue;
      const len = 4 + 14 * snap;
      ctx.globalAlpha = alpha * snap;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - len, y); ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len); ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Rising cinders with a trailing streak for EMBER -- hotter and faster
   *  than sporeGlow's slow drift, with a directional tail so it reads as
   *  fire rather than bioluminescence. */
  _drawEmberGlow(ctx, canvas, alpha, profile) {
    const col = profile?.particles?.color || '#ff7a3c';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const phase = i * 1.7;
      const x = canvas.width * ((i * 0.083 + 0.03) % 1) + Math.sin(this.tSec * 2 + phase) * 10;
      const rise = (this.tSec * 30 + i * 41) % (canvas.height * 0.75);
      const y = canvas.height * 0.9 - rise;
      const flicker = 0.5 + 0.5 * Math.sin(this.tSec * 5 + phase);
      ctx.strokeStyle = col;
      ctx.globalAlpha = alpha * (0.3 + 0.4 * flicker);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 12 + 6 * flicker);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.globalAlpha = alpha * (0.5 + 0.5 * flicker);
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + flicker, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The approach (CelestialApproach.js) for this frame, or null before it
   *  has anything to work with. Resolved once per frame in draw() so the sun,
   *  the moon, the light rig and the mandala all read the same body. */
  _celestialApproachAt(canvas, cx, cy) {
    const midioX = this.midioX ?? canvas.width * 0.32;
    // Anchored to the GROUND, not to Midio's live render y. He jumps; the sun
    // does not. `observerDy` feeds back only the small, distance-scaled
    // parallax a real observer's motion would produce.
    const groundY = this._zoomedGroundY(canvas);
    const observerDy = Number.isFinite(this.midioY) ? this.midioY - groundY : 0;
    return celestialApproach({
      orbitX: cx, orbitY: cy, midioX, groundY, observerDy,
      progress01: clamp01(this._progress || 0),
    });
  }

  _drawCelestial(ctx, canvas, A, B, t, cyFrac = 0.22, alpha = 1, cxFrac = CELESTIAL_DEFAULT_XFRAC) {
    // The body is closing on a point just up and left of Midio over the length
    // of the song. Position drifts linearly and slowly; apparent size grows as
    // 1/distance and therefore accelerates. See CelestialApproach.js for why
    // that ratio is the whole effect.
    const app = this._celestialApproachAt(canvas, canvas.width * cxFrac, canvas.height * cyFrac);
    const cx = app.x, cy = app.y;
    const grow = app.scale;
    const rotCel = (c) => ({
      ...c,
      color: this._rotated(c.color),
      haloColor: this._rotated(c.haloColor),
      radius: (c.radius || 0) * grow,
    });
    if (B === A) {
      this._drawOneCelestial(ctx, cx, cy, rotCel(A.celestial), alpha);
      this._drawCompanions(ctx, canvas, cx, cy, A.celestial.companions, alpha);
    } else {
      this._drawOneCelestial(ctx, cx, cy, rotCel(A.celestial), (1 - t) * alpha);
      this._drawOneCelestial(ctx, cx, cy, rotCel(B.celestial), t * alpha);
      this._drawCompanions(ctx, canvas, cx, cy, A.celestial.companions, (1 - t) * alpha);
      this._drawCompanions(ctx, canvas, cx, cy, B.celestial.companions, t * alpha);
    }

    const promAlpha = ((A.fx === 'prominence' ? 1 - t : 0) + (B.fx === 'prominence' ? t : 0)) * alpha;
    if (promAlpha > 0.02) this._drawProminence(ctx, cx, cy, promAlpha);
  }

  /**
   * Small decorative bodies near the primary celestial (PaletteSynth's
   * buildCompanions -- more of them for a harmonically richer song).
   * Deliberately drawn as plain _drawOneCelestial discs paired with the
   * primary's own crossfade alpha: no day/night light contribution, no
   * mandala anchoring, no occlusion. A biome without companions (every
   * stock world, and any custom world for a harmonically simple song)
   * draws nothing here -- today's single-body sky is unchanged.
   */
  _drawCompanions(ctx, canvas, cx, cy, companions, alpha) {
    if (!Array.isArray(companions) || !companions.length || alpha <= 0.02) return;
    const primaryR = Math.max(14, canvas.height * 0.0361);
    for (const co of companions) {
      const ccx = cx + co.dxFrac * canvas.width;
      const ccy = cy + co.dyFrac * canvas.height;
      this._drawOneCelestial(ctx, ccx, ccy, {
        color: this._rotated(co.color),
        haloColor: this._rotated(co.haloColor),
        radius: Math.max(3, primaryR * co.radiusFrac),
      }, alpha * 0.85);
    }
  }

  /** A plain pale moon, taking over from the biome's own sun once it sets
   *  -- deliberately generic (not crossfaded between biomes) so it always
   *  reads as "the moon," with a simple crescent bite for character.
   *  `tidalOffsetPx` lets the space ridge's own vast tidal drift (see
   *  SpaceRidge.tidalOffsetPx) nudge the moon a little too -- a body small
   *  enough to visibly yield to something far larger, kept subtle (a
   *  fraction of the amplitude, hard-clamped) so it never reads as bouncing. */
  /** Illuminated fraction of the moon's disc this frame, 0..1.
   *
   *  The day/night cycle here runs sun and moon in strict opposition (the
   *  moon rises exactly as the sun sets), and a body at opposition is, in
   *  reality, always FULL -- so reading a phase off this cycle's own
   *  geometry would only ever produce a full moon. The phase is therefore
   *  its own slow term, one synodic cycle across the song: a real lunar
   *  phenomenon on a compressed clock, the same compression the 90-second
   *  "day" already is.
   *
   *  The song opens near new and waxes to full at the midpoint. See
   *  MOON_MIN_ILLUM in _drawMoon for why it never actually reaches new. */
  _moonPhase01() {
    return clamp01(this._progress || 0);
  }

  /**
   * The moon: a lit sphere, drawn as one.
   *
   * The phase boundary on a sphere lit from the side is not a circular bite
   * out of the disc -- it is the sphere's own great-circle terminator seen in
   * projection, which is a HALF-ELLIPSE sharing the disc's poles, its width
   * shrinking to nothing at quarter phase and bulging the opposite way
   * through gibbous. The previous offset-circle cut could only ever produce
   * crescents (never a correct gibbous), and even its crescents had the wrong
   * limb curvature, because two circles of different radii don't meet the way
   * a limb and a terminator do. Building the lit region out of a true limb
   * arc plus a true terminator ellipse is both simpler and actually right.
   *
   * The whole construction is then rotated so its lit side faces the sun's
   * real position (`sunXFrac`/`sunYFrac`, continued below the horizon by
   * DayNight.sunScreenFrac) -- at night that sun is underneath, so the moon
   * is lit from below, which is exactly what it does in the sky.
   */
  _drawMoon(ctx, canvas, cyFrac, alpha, tidalOffsetPx = 0, cxFrac = CELESTIAL_DEFAULT_XFRAC,
    sunXFrac = null, sunYFrac = null, phase01 = 0.5) {
    if (alpha <= 0.02) return;
    // Same approach the sun is on (CelestialApproach.js): both bodies are
    // closing on the convergence point, so the moon grows through the night
    // exactly as the sun grows through the day and the two agree about how
    // far away the sky is.
    const app = this._celestialApproachAt(
      canvas, canvas.width * cxFrac, canvas.height * cyFrac + clamp(tidalOffsetPx, -6, 6),
    );
    const cx = app.x, cy = app.y;
    // Scales with the frame like every other sky element, instead of staying
    // a fixed 26px while a camera pull-back widens the stage around it.
    // Matches the old constant exactly at the nominal 720-tall stage.
    const R = Math.max(14, canvas.height * 0.0361) * app.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.2);
    halo.addColorStop(0, MOON_HALO_COLOR);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Earthshine: the unlit part of a real moon is not empty sky -- it's
    // dimly lit by light bouncing off the planet, which is why you can make
    // out the whole disc behind a thin crescent. Also keeps the moon reading
    // as a sphere at slim phases instead of a detached sliver.
    ctx.globalAlpha = alpha * 0.13;
    ctx.fillStyle = MOON_COLOR;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // Illuminated fraction -> terminator half-width. k = R at new (terminator
    // hugs the lit limb, nothing showing), 0 at quarter (a straight edge),
    // -R at full (terminator hugs the far limb, whole disc showing).
    //
    // Floored short of a true new moon: at f = 0 the moon is genuinely
    // invisible, and since the phase here is tied to song progress that
    // would mean no moon at all through the opening of every song, which
    // reads as a missing feature rather than as astronomy. A thin crescent
    // is the same shape a new moon is a day either side of new, so this
    // costs nothing in fidelity.
    const MOON_MIN_ILLUM = 0.16;
    const f = Math.max(MOON_MIN_ILLUM, 0.5 - 0.5 * Math.cos(2 * Math.PI * clamp01(phase01)));
    const k = R * (1 - 2 * f);

    // Point +x at the sun, so the bright limb faces it.
    const sunX = sunXFrac == null ? cx + R : canvas.width * sunXFrac;
    const sunY = sunYFrac == null ? cy : canvas.height * sunYFrac;
    const toSun = Math.atan2(sunY - cy, sunX - cx);

    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(toSun);
    ctx.beginPath();
    // Lit limb: the sunward half of the disc, top -> right -> bottom.
    ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
    // Terminator: back from bottom to top along the projected great circle.
    // Sweep direction follows k's sign, which is what turns the same two
    // curves into a crescent (bulging sunward) or a gibbous (bulging away).
    ctx.ellipse(0, 0, Math.abs(k), R, 0, Math.PI / 2, -Math.PI / 2, k > 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** A far ocean seen through/behind the mountain silhouettes: not a solid
   *  band (which a ridge simply paints over) but an abstract field of
   *  wave-contour rows receding toward a high horizon, like an infinite
   *  flat plane of water in perspective -- rows compress and fade as they
   *  approach the horizon, and the whole field fades at the left/right
   *  screen edges. Drawn before the horizon EQ, spectrum massif, and every
   *  mountain layer, so those naturally occlude the lower portion; the
   *  visible remainder (above/between the ridgelines) IS the ocean. The row
   *  stack always draws (visibility is the feature); it thins and drops the
   *  celestial glint at the deepest perf rung. */
  /** Which tsunami (if any) is currently approaching, with its depth /
   *  perspective state -- looked up once per frame and shared by the row
   *  swell and the wall silhouette. */
  _activeTsunami(canvasWidth) {
    const nowMs = this.tSec * 1000;
    for (const ev of this._tsunamis) {
      if (!tsunamiActive(ev, nowMs)) continue;
      const age = nowMs - ev.tMs;
      const progress = tsunamiProgress(age);
      return {
        ev,
        progress,
        rowFrac: tsunamiRowFrac(progress),
        scale: tsunamiPerspectiveScale(progress),
        heightScale: tsunamiHeightScale(age),
        centerX: tsunamiCenterX(ev, canvasWidth),
      };
    }
    return null;
  }

  /** Schedules a new tsunami wall, same shape as the existing drop-cued
   *  bonus wall (see the dropAtMs block in update()) -- used by Simulation
   *  for the quake -> tsunami linked event (DisasterDirector arms a
   *  sea-epicenter quake, then calls this ~20-40s later so the aftershock
   *  reads as having kicked up a real wave). Keeps `_tsunamis` sorted so
   *  `_activeTsunami`'s first-match scan stays correct. */
  armTsunami(tMs, dir = 1) {
    this._tsunamis.push({ tMs, dir });
    this._tsunamis.sort((a, b) => a.tMs - b.tMs);
  }

  /** 0..1 withdrawal depth across every scheduled tsunami -- at most one
   *  can be in its withdrawal window at a time in practice (the schedule
   *  spaces walls well apart), but this takes the max rather than assuming
   *  that to stay correct either way. */
  _activeWithdrawal() {
    const nowMs = this.tSec * 1000;
    let level = 0;
    for (const ev of this._tsunamis) {
      if (tsunamiWithdrawalActive(ev, nowMs)) level = Math.max(level, tsunamiWithdrawal01(ev, nowMs));
    }
    return level;
  }

  _drawOcean(ctx, canvas, worldX, A, B, t, phenomenaFull, night = 0) {
    const horizonY = canvas.height * OCEAN_HORIZON_FRAC;
    // Withdrawal telegraph: the sea visibly drains back toward the horizon
    // in the seconds before a tsunami wall's own approach begins -- pulling
    // the near edge of the WHOLE plane up toward the horizon shrinks every
    // downstream draw (the backing fill, the body plate, every contour row
    // via oceanRowYs) for free, since they all key off nearY.
    const withdrawal01 = this._activeWithdrawal();
    const nearY = canvas.height * OCEAN_NEAR_FRAC - (canvas.height * (OCEAN_NEAR_FRAC - OCEAN_HORIZON_FRAC)) * 0.4 * withdrawal01;
    const bass = 0.5 * ((this._eqSmoothed[0] || 0) + (this._eqSmoothed[1] || 0));
    const treble = 0.5 * ((this._eqSmoothed[5] || 0) + (this._eqSmoothed[6] || 0));
    const kick = kickEnv(this.tSec * 1000 - this._danceKickMs - 250) * this._danceKickAmp;
    const tsunami = this._activeTsunami(canvas.width);
    const dials = styleDials(this.visualStyle);
    const presence = 1.28 * (dials.oceanPresence ?? 1);
    const lineMul = dials.oceanLineAlpha ?? 1;
    const bodyMul = dials.oceanBodyAlpha ?? 1;
    const reflectMul = dials.oceanReflect ?? 1;

    const skyMid = this.lerpCache.get(A.sky[1], B.sky[1], t);
    const sil = this.lerpCache.get(A.silhouette, B.silhouette, t);
    const base = this.lerpCache.get(sil, skyMid, 0.28);
    // Lean hard into teal sea + abyssal deep so the plane reads as ocean.
    const water = this._rotated(this.lerpCache.get(base, OCEAN_WATER_BLUE, 0.68));
    const deepWater = this._rotated(this.lerpCache.get(base, OCEAN_DEEP_BLUE, 0.62));
    const cap = this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));

    // Rendered: fewer contour rows so the plane reads as water mass, not a
    // neon wireframe grid. Classic keeps the denser field.
    const rowBudget = Math.max(8, Math.ceil(this._oceanRows.length * (dials.rowCountMul ?? 1)));
    const fullRows = this._oceanRows.slice(0, rowBudget);
    const rows = phenomenaFull ? fullRows : fullRows.slice(0, Math.ceil(fullRows.length * 0.65));
    const rowYs = oceanRowYs(horizonY, nearY, rows.length);

    // Fade to transparent at the screen edges -- an infinite plane trails
    // off sideways as much as it recedes into the distance.
    const edgeFade = ctx.createLinearGradient(0, 0, canvas.width, 0);
    edgeFade.addColorStop(0, `${water}00`);
    edgeFade.addColorStop(0.1, water);
    edgeFade.addColorStop(0.9, water);
    edgeFade.addColorStop(1, `${water}00`);

    ctx.save();
    // Normal compositing so water sits as a soft plate instead of laser lines.
    ctx.globalCompositeOperation = 'source-over';

    // Opaque backing, UNDER the translucent body plate below: water is a
    // solid surface, and the glassy gradient/contour layers on top of this
    // were the ocean's entire visible thickness -- at their own peak alpha
    // (~26%, the body plate's `55` stop times its multipliers) that let the
    // sky's stars/nebulae/planets, generated as low as 62% of the canvas,
    // shine straight through the water anywhere past its own horizon. A
    // real ocean is opaque; no amount of translucency tuning on the pretty
    // layers fixes that, so this fill guarantees nothing behind ever shows
    // through, and everything else keeps its existing glassy look on top of
    // it. Feathers only at the horizon seam (where sky and water always
    // blend in reality) -- solid everywhere else on the plane.
    {
      const backing = ctx.createLinearGradient(0, horizonY, 0, nearY);
      backing.addColorStop(0, `${water}00`);
      backing.addColorStop(0.08, deepWater);
      backing.addColorStop(1, deepWater);
      // Deliberately NOT scaled by this.budget (the ambient light-budget
      // dimmer that fades decorative elements down in quiet sections) --
      // that system governs how VIVID things read, not whether physical
      // opacity holds. Gating this on it reintroduced the exact leak this
      // layer exists to close: budget dips as low as ~0.1 in calm stretches,
      // which would have dropped the backing back to near-transparent right
      // when the sky is otherwise at its most visible.
      ctx.globalAlpha = 1;
      ctx.fillStyle = backing;
      ctx.fillRect(0, horizonY, canvas.width, Math.max(1, nearY - horizonY));
    }

    // Body plate: a continuous water mass under the wave contours so the
    // plane reads as ocean even when mountains occlude parts of the stack.
    {
      const body = ctx.createLinearGradient(0, horizonY, 0, nearY);
      body.addColorStop(0, `${water}00`);
      body.addColorStop(0.1, `${water}48`);
      body.addColorStop(0.4, `${deepWater}55`);
      body.addColorStop(0.75, `${water}36`);
      body.addColorStop(1, `${water}00`);
      ctx.globalAlpha = 0.78 * this.budget * presence * bodyMul;
      ctx.fillStyle = body;
      ctx.fillRect(0, horizonY, canvas.width, Math.max(1, nearY - horizonY));
    }

    // Wave contour polylines — soft perspective lines on the water plate.
    const drawContours = dials.oceanDrawContours !== false && lineMul > 0.02;
    const N = 48;
    const nRows = rows.length;
    if (drawContours) {
      // source-over so lines sit IN the water mass (not laser-cyan soup).
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = edgeFade;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let j = 0; j < nRows; j++) {
        const row = rows[j];
        const alpha = rowAlpha(j, nRows) * row.alphaMul * this.budget * presence * lineMul * 0.7;
        if (alpha <= 0.01) continue;
        const gapAbove = j === 0 ? nearY - rowYs[0] : rowYs[j - 1] - rowYs[j];
        const ampScale = row.ampMul * Math.max(0.2, clamp01(gapAbove / 24));
        const scroll = worldX * (0.03 + 0.09 * (1 - j / nRows));
        const rowFrac = nRows <= 1 ? 0.5 : j / (nRows - 1);
        const depthSwell = tsunami
          ? tsunamiDepthLift(rowFrac, tsunami.rowFrac) * tsunami.scale * tsunami.heightScale
          : 0;
        const drift = rowPhaseDrift(j, this.tSec);
        ctx.globalAlpha = alpha * 0.75;
        // Slightly thicker + lower contrast so lines read as water, not HUD rules.
        ctx.lineWidth = 1.4 + 0.4 * (1 - j / nRows);
        ctx.beginPath();
        const samples = [];
        for (let i = 0; i <= N; i++) {
          const u = ((i / N + row.uPhase + scroll / canvas.width + drift) % 1 + 1) % 1;
          let x = (i / N) * canvas.width;
          let y = rowYs[j]
            + seaLineY(u, this.tSec * row.speedMul, bass, kick) * ampScale
            - breakerLift(u, this.tSec * row.speedMul, 0.35 + 0.65 * treble) * ampScale * 0.55;
          // Spectral depth pass (WaveField.js), layered on top of the hand-
          // tuned rows above -- deliberately subtle (small coefficients
          // against seaLineY's own amplitude) so the vibe stays exactly
          // what it was; only gated on phenomenaFull since the row count
          // itself already trims for lower perf tiers.
          if (phenomenaFull) {
            const wave = waveFieldSample(this._waveComponents, x + scroll, this.tSec);
            x += wave.dx * 0.6 * ampScale;
            y += wave.dy * 0.4 * ampScale;
          }
          if (depthSwell > 0.01) {
            const halfW = TSUNAMI_WIDTH_PX * (0.35 + 0.65 * tsunami.scale);
            y -= tsunamiLift(x - tsunami.centerX, halfW) * depthSwell * 85 * (0.55 + 0.45 * ampScale);
          }
          samples.push({ x, y, u });
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        if (phenomenaFull && rowFrac < 0.72) {
          ctx.fillStyle = cap;
          for (let i = 0; i < samples.length; i += 2) {
            const s = samples[i];
            const m = whitecapMask(s.u, this.tSec * row.speedMul, rowFrac);
            if (m < 0.35) continue;
            ctx.globalAlpha = alpha * m * 0.55;
            ctx.beginPath();
            ctx.arc(s.x, s.y - 1.2, 1.1 + 0.9 * m, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    } else if (phenomenaFull && tsunami) {
      // Still need tsunami geometry even when contours are off — swell the plate only.
    }

    if (tsunami && tsunami.scale > 0.02) {
      // Approach from far horizon → near ocean edge. Size is perspective-
      // driven (tiny while distant, large as it nears the player). Still a
      // translucent watery veil + foam crest -- never a solid mountain
      // silhouette sliding sideways.
      const { centerX, scale: persp, heightScale, rowFrac: tRf } = tsunami;
      const baseY = this._oceanLifeRowY(canvas, tRf);
      const wallH = (nearY - horizonY) * 0.62 * heightScale * (0.12 + 0.88 * persp);
      const WS = TSUNAMI_WIDTH_PX * (0.28 + 0.72 * persp);
      const crestY = (s) => baseY - tsunamiProfile(s) * wallH;
      const alphaMul = this.budget * heightScale * (0.2 + 0.8 * persp);
      const footY = Math.min(nearY, baseY + wallH * 0.15);

      const veilGrad = ctx.createLinearGradient(0, baseY - wallH, 0, footY);
      veilGrad.addColorStop(0, `${water}00`);
      veilGrad.addColorStop(0.45, `${water}2a`);
      veilGrad.addColorStop(1, `${water}00`);
      ctx.fillStyle = veilGrad;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const s = -1 + (i / 24) * 2;
        const x = centerX + s * WS;
        const y = crestY(s);
        if (i === 0) ctx.moveTo(x, footY);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(centerX + WS, footY);
      ctx.closePath();
      ctx.globalAlpha = capFlashAlpha(0.65 * alphaMul, this.reducedFlash);
      ctx.fill();

      ctx.fillStyle = cap;
      for (const f of this._tsunamiFlecks) {
        const x = centerX + f.sOff * WS;
        const by = crestY(f.sOff);
        const bob = Math.sin(this.tSec * 4 + f.phase) * 3 * persp;
        ctx.globalAlpha = capFlashAlpha(0.5 * alphaMul, this.reducedFlash);
        ctx.beginPath();
        ctx.arc(x, by - f.riseFrac * wallH * 0.4 + bob, 1.2 + 1.2 * persp, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Horizon seam: very soft blend into sky (hard bar reads as a UI rule line).
    {
      const hz = ctx.createLinearGradient(0, horizonY - 14, 0, horizonY + 18);
      hz.addColorStop(0, `${water}00`);
      hz.addColorStop(0.5, `${water}18`);
      hz.addColorStop(1, `${water}00`);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.35 * this.budget * presence;
      ctx.fillStyle = hz;
      ctx.fillRect(0, horizonY - 14, canvas.width, 32);
    }

    // Body sheen just below the horizon — soft water mass, not a bright stripe.
    const sheenH = Math.min(120, nearY - horizonY);
    const sheen = ctx.createLinearGradient(0, horizonY, 0, horizonY + sheenH);
    sheen.addColorStop(0, `${water}22`);
    sheen.addColorStop(0.4, `${water}12`);
    sheen.addColorStop(1, `${water}00`);
    ctx.fillStyle = sheen;
    ctx.globalAlpha = 0.7 * this.budget * presence;
    ctx.fillRect(0, horizonY, canvas.width, sheenH);

    if (phenomenaFull) {
      // Celestial reflection path: sun by day, cooler moon path at night.
      const rx = canvas.width * 0.78;
      const glintH = (nearY - horizonY) * 0.98;
      const shimmer = 5 * Math.sin(this.tSec * 1.1);
      const glintCol = night > 0.45 ? this._rotated(MOON_HALO_COLOR) : cap;
      const rGrad = ctx.createLinearGradient(rx, horizonY, rx, horizonY + glintH);
      rGrad.addColorStop(0, `${glintCol}66`);
      rGrad.addColorStop(0.25, `${glintCol}32`);
      rGrad.addColorStop(0.65, `${glintCol}14`);
      rGrad.addColorStop(1, `${glintCol}00`);
      ctx.fillStyle = rGrad;
      ctx.globalAlpha = (0.26 + 0.12 * night) * this.budget * reflectMul;
      // Tapered column (wider at horizon, narrow toward near edge).
      ctx.beginPath();
      ctx.moveTo(rx - 10 + shimmer * 0.2, horizonY + glintH);
      ctx.lineTo(rx - 48 + shimmer * 0.3, horizonY);
      ctx.lineTo(rx + 48 + shimmer * 0.3, horizonY);
      ctx.lineTo(rx + 10 + shimmer * 0.2, horizonY + glintH);
      ctx.closePath();
      ctx.fill();

      // Secondary sparkle along the reflection path: soft dots only
      // (1px-tall rects read as dashed glitch).
      const sparkleN = 5;
      ctx.fillStyle = glintCol;
      for (let i = 0; i < sparkleN; i++) {
        const u = (i + 0.5) / sparkleN;
        const sy = horizonY + glintH * u;
        const bob = Math.sin(this.tSec * 2.2 + i * 1.3) * 2;
        ctx.globalAlpha = (0.08 + 0.10 * (1 - u)) * this.budget * (0.6 + 0.4 * bass);
        ctx.beginPath();
        ctx.arc(rx + bob, sy, 1.6 + 1.2 * (1 - u), 0, Math.PI * 2);
        ctx.fill();
      }

      // Foam: soft flecks only.
      ctx.fillStyle = cap;
      for (let i = 0; i < 9; i++) {
        const fx = ((i * 0.12 + worldX * 0.00008) % 1) * canvas.width;
        const fy = horizonY + sheenH * (0.28 + 0.08 * Math.sin(this.tSec * 0.5 + i));
        ctx.globalAlpha = 0.12 * this.budget * presence;
        ctx.beginPath();
        ctx.arc(fx, fy, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Maps an OceanLife rowFrac (0=nearest .. 1=at the horizon) to a screen
   *  y and a size scale, biased the same perspective direction as the wave
   *  rows themselves. */
  _oceanLifeRowY(canvas, rowFrac) {
    const horizonY = canvas.height * OCEAN_HORIZON_FRAC;
    const nearY = canvas.height * OCEAN_NEAR_FRAC;
    return horizonY + (nearY - horizonY) * Math.pow(1 - rowFrac, 1.6);
  }

  /** Everything living on/over the ocean: islands and ships always (a
   *  handful of strokes each), sea life and the rare monster gated on
   *  phenomenaFull -- witnessed set pieces, not core scenery. */
  _drawOceanLife(ctx, canvas, worldX, A, B, t, phenomenaFull) {
    const skyMid = this.lerpCache.get(A.sky[1], B.sky[1], t);
    const sil = this.lerpCache.get(A.silhouette, B.silhouette, t);
    const water = this._rotated(this.lerpCache.get(sil, skyMid, 0.45));
    const cap = this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
    const bass = 0.5 * ((this._eqSmoothed[0] || 0) + (this._eqSmoothed[1] || 0));
    const kick = kickEnv(this.tSec * 1000 - this._danceKickMs - 250) * this._danceKickAmp;
    const nowMs = this.tSec * 1000;
    const scroll = worldX * OCEAN_LIFE_RATIO;
    const pad = 200;

    ctx.save();
    // Islands/ships sit on the water plate — normal composite, not additive
    // "lighter" (that made mesa silhouettes float as purple diamonds in the sky).
    ctx.globalCompositeOperation = 'source-over';

    // Islands -- dark land masses grounded on the ocean rows.
    const horizonY = canvas.height * OCEAN_HORIZON_FRAC;
    const nearY = canvas.height * OCEAN_NEAR_FRAC;
    for (const isl of this._islands) {
      const x = wrappedOffset(isl.x0, scroll);
      if (x < -pad || x > canvas.width + pad) continue;
      const y = this._oceanLifeRowY(canvas, isl.rowFrac);
      // Only draw while the foot is on the ocean band (never free-float in sky).
      if (y < horizonY - 4 || y > nearY + 20) continue;
      const scale = 1 - 0.65 * isl.rowFrac;
      const w = isl.w * scale, h = Math.max(8, isl.h * scale);
      ctx.globalAlpha = capFlashAlpha(0.72 * this.budget, this.reducedFlash);
      ctx.fillStyle = this._rotated(sil);
      ctx.beginPath();
      if (isl.kind === 'cone') {
        ctx.moveTo(x - w / 2, y);
        ctx.lineTo(x, y - h);
        ctx.lineTo(x + w / 2, y);
      } else if (isl.kind === 'mesa') {
        // A steep table-mountain, not a gentle trapezoid: the plateau is
        // much narrower than the base, the cliff faces are concave (near-
        // vertical rock, not a sloped berm), and the crest is a ragged
        // forested treeline rather than a flat table edge -- Forest Haven,
        // not a sandbar.
        const topHalf = w * 0.30;
        const jag = isl.crownJag || [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
        ctx.moveTo(x - w / 2, y);
        ctx.quadraticCurveTo(x - w * 0.42, y - h * 0.55, x - topHalf, y - h);
        const crownN = jag.length;
        for (let k = 0; k <= crownN; k++) {
          const cx = x - topHalf + (k / crownN) * (topHalf * 2);
          const bump = k === 0 || k === crownN ? 0 : (jag[k - 1] - 0.5) * h * 0.26;
          ctx.lineTo(cx, y - h - bump);
        }
        ctx.quadraticCurveTo(x + w * 0.42, y - h * 0.55, x + w / 2, y);
      } else {
        ctx.ellipse(x, y - h * 0.15, w / 2, h * 0.3, 0, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.fill();
      if (isl.kind === 'mesa') {
        // Faint cliff striations on the near cliff face -- just enough
        // texture to read as rock, not a flat cutout.
        ctx.globalAlpha = capFlashAlpha(0.16 * this.budget, this.reducedFlash);
        ctx.strokeStyle = water;
        ctx.lineWidth = Math.max(0.8, 1 * scale);
        ctx.beginPath();
        ctx.moveTo(x - w * 0.34, y - h * 0.12);
        ctx.lineTo(x - w * 0.22, y - h * 0.72);
        ctx.moveTo(x + w * 0.20, y - h * 0.08);
        ctx.lineTo(x + w * 0.30, y - h * 0.6);
        ctx.stroke();
      }
      if (isl.kind === 'palm') {
        ctx.strokeStyle = this._rotated(sil);
        ctx.lineWidth = Math.max(1, 1.5 * scale);
        ctx.beginPath();
        ctx.moveTo(x - w * 0.1, y - h * 0.2);
        ctx.lineTo(x - w * 0.05, y - h * 0.9);
        ctx.stroke();
      }
      // Thin wet foot into the water (flat, not a second “bun” dome).
      ctx.globalAlpha = capFlashAlpha(0.22 * this.budget, this.reducedFlash);
      ctx.fillStyle = water;
      ctx.fillRect(x - w * 0.5, y - 1, w, Math.max(2, 2.5 * scale));
      // Waterline cap — thin, not a neon laser.
      ctx.strokeStyle = cap;
      ctx.lineWidth = Math.max(0.8, 1 * scale);
      ctx.globalAlpha = capFlashAlpha(0.22 * this.budget, this.reducedFlash);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.55, y);
      ctx.lineTo(x + w * 0.55, y);
      ctx.stroke();
      if (isl.beacon) {
        // Small lamp on the crest only — no skyward beam.
        const blink = 0.45 + 0.55 * Math.sin(this.tSec * 2.3 + isl.x0);
        ctx.globalAlpha = capFlashAlpha(0.5 * blink * this.budget, this.reducedFlash);
        ctx.fillStyle = cap;
        ctx.beginPath();
        ctx.arc(x, y - h - 1.5 * scale, 1.4 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'lighter';

    // Run-up: a tsunami wall's swell lifts and rocks any ship sitting near
    // its current depth row, same tsunamiDepthLift/scale/heightScale math
    // _drawOcean already uses for the wave rows themselves -- ships
    // visibly answer the wall passing beneath them instead of drifting on
    // obliviously.
    const tsunami = this._activeTsunami(canvas.width);

    // Ships -- slow drifters, hull+mast, bobbing on the wave line at their u.
    for (const ship of this._ships) {
      const x = wrappedOffset(ship.x0 - ship.driftPxS * this.tSec, scroll);
      if (x < -pad || x > canvas.width + pad) continue;
      const y = this._oceanLifeRowY(canvas, ship.rowFrac);
      const u = ((x / canvas.width) % 1 + 1) % 1;
      let bob = seaLineY(u, this.tSec, bass, kick) * 0.3;
      if (tsunami) {
        const runUp = tsunamiDepthLift(ship.rowFrac, tsunami.rowFrac) * tsunami.scale * tsunami.heightScale;
        bob -= runUp * 22; // lifts the hull as the swell passes beneath it
      }
      const s = ship.size * (1 - 0.5 * ship.rowFrac);
      ctx.globalAlpha = capFlashAlpha(0.55 * this.budget, this.reducedFlash);
      ctx.strokeStyle = water;
      ctx.fillStyle = water;
      ctx.lineWidth = Math.max(1, 1.2 * s);
      if (ship.kind === 'wreck') {
        // Half-sunken hull, broken mast -- still a few strokes, sits lower.
        ctx.beginPath();
        ctx.moveTo(x - 16 * s, y + bob + 2 * s);
        ctx.lineTo(x + 10 * s, y + bob);
        ctx.lineTo(x + 6 * s, y + bob + 5 * s);
        ctx.lineTo(x - 12 * s, y + bob + 6 * s);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - 2 * s, y + bob);
        ctx.lineTo(x + 4 * s, y + bob - 10 * s);
        ctx.stroke();
      } else {
        ctx.beginPath(); // hull
        ctx.moveTo(x - 14 * s, y + bob);
        ctx.lineTo(x + 14 * s, y + bob);
        ctx.lineTo(x + 10 * s, y + bob + 4 * s);
        ctx.lineTo(x - 10 * s, y + bob + 4 * s);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath(); // mast + sail
        ctx.moveTo(x, y + bob);
        ctx.lineTo(x, y + bob - 16 * s);
        ctx.lineTo(x + 9 * s, y + bob - 4 * s);
        ctx.closePath();
        ctx.stroke();
      }
    }

    if (phenomenaFull) {
      // Sea life: brief witnessed events -- fish leaps, dolphin pods, a
      // whale spout. Placed by a fixed screen fraction, not world scroll
      // (they're transient, like a meteor, not scenery).
      while (this._seaLifeIdx < this._seaLife.length && this._seaLife[this._seaLifeIdx].tMs + this._seaLife[this._seaLifeIdx].durMs < nowMs) this._seaLifeIdx++;
      for (let k = this._seaLifeIdx; k < this._seaLife.length; k++) {
        const ev = this._seaLife[k];
        if (ev.tMs > nowMs) break;
        const age = nowMs - ev.tMs;
        const u = clamp01(age / ev.durMs);
        const x = ev.u * canvas.width;
        const y = this._oceanLifeRowY(canvas, ev.rowFrac);
        ctx.strokeStyle = water; ctx.fillStyle = water;
        if (ev.kind === 'fish') {
          const arc = fishArcY(u);
          ctx.globalAlpha = capFlashAlpha((1 - Math.abs(u - 0.5) * 1.6) * this.budget, this.reducedFlash);
          ctx.beginPath();
          ctx.ellipse(x, y - arc, 5, 2, -0.5, 0, Math.PI * 2);
          ctx.fill();
          if (arc < 3) {
            ctx.globalAlpha = capFlashAlpha(0.4 * this.budget, this.reducedFlash);
            ctx.beginPath(); ctx.arc(x, y, 6 * (1 - u), 0, Math.PI * 2); ctx.stroke();
          }
        } else if (ev.kind === 'pod') {
          ctx.globalAlpha = capFlashAlpha(0.7 * this.budget, this.reducedFlash);
          for (let i = 0; i < 3; i++) {
            const pu = clamp01(u * 3 - i * 0.6) % 1;
            if (pu <= 0 || pu >= 1) continue;
              const arc = fishArcY(pu);
            ctx.beginPath();
            ctx.ellipse(x + i * 26 - 26, y - arc, 7, 3, -0.4, 0, Math.PI * 2);
            ctx.fill();
          }
        } else { // spout
          const rise = clamp01(u * 3);
          const h = 30 * (1 - Math.max(0, u - 0.35) / 0.65);
          ctx.globalAlpha = capFlashAlpha(0.8 * this.budget * rise, this.reducedFlash);
          ctx.beginPath();
          ctx.ellipse(x, y, 20, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          if (h > 0) {
            ctx.strokeStyle = cap;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(x, y - 4);
            ctx.lineTo(x, y - 4 - h);
            ctx.stroke();
          }
        }
      }

      // The rare sea monster: a serpent that rises, undulates, and submerges.
      while (this._monsterIdx < this._monsters.length && this._monsters[this._monsterIdx].tMs + this._monsters[this._monsterIdx].durMs < nowMs) this._monsterIdx++;
      if (this._monsterIdx < this._monsters.length) {
        const ev = this._monsters[this._monsterIdx];
        const age = nowMs - ev.tMs;
        if (age >= 0 && age <= ev.durMs) {
          const u = age / ev.durMs;
          const rise = Math.sin(clamp01(u * 3) * Math.PI * 0.5) * clamp01((1 - u) * 3 + 0.3);
          const x = ev.u * canvas.width;
          const y = this._oceanLifeRowY(canvas, 0.35);
          ctx.globalAlpha = capFlashAlpha(0.75 * this.budget, this.reducedFlash);
          ctx.strokeStyle = water;
          ctx.lineWidth = 5;
          ctx.lineCap = 'round';
          for (let h = 0; h < 3; h++) {
            const hx = x - 60 + h * 34;
            const hy = y - rise * (26 - h * 5) + serpentHumpY(u, h * 2.1 + this.tSec * 2);
            ctx.beginPath();
            ctx.moveTo(hx - 12, y);
            ctx.quadraticCurveTo(hx, hy, hx + 12, y);
            ctx.stroke();
          }
          // Head.
          ctx.fillStyle = water;
          ctx.beginPath();
          ctx.ellipse(x + 46, y - rise * 30, 9, 6, -0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
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
    const color = this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
    const eqMul = styleDials(this.visualStyle).horizonEqAlpha ?? 1;
    if (eqMul < 0.05) return;
    const baseline = canvas.height * 0.60;
    const maxH = canvas.height * EQ_MAX_HEIGHT_FRAC;
    const scroll = worldX * 0.0018;
    const tS = this.tSec;

    // One extra sample past each edge so the wave terminates off-screen
    // instead of clipping mid-oscillation exactly on the canvas boundary.
    const N = 64;
    const EDGE_STEPS = 1;
    const pts = new Array(N + 1 + 2 * EDGE_STEPS);
    for (let k = 0; k < pts.length; k++) {
      const i = k - EDGE_STEPS;
      const u = i / N;
      // Which pair of bands this column sits between (wrapping, scrolling).
      const p = ((u * BAND_COUNT + scroll) % BAND_COUNT + BAND_COUNT) % BAND_COUNT;
      const i0 = Math.floor(p) % BAND_COUNT, i1 = (i0 + 1) % BAND_COUNT;
      const f = p - Math.floor(p);
      const c = (1 - Math.cos(f * Math.PI)) / 2; // cosine ease: no corners
      const v = clamp01(this._eqSmoothed[i0] * (1 - c) + this._eqSmoothed[i1] * c);
      const wave = Math.sin(u * Math.PI * 7 + tS * 1.6) * 7 * (0.25 + v);
      pts[k] = { x: u * canvas.width, y: baseline - (v * maxH + wave) };
    }

    ctx.save();
    // Soft additive aurora glow over the CGI sky.
    ctx.globalCompositeOperation = 'lighter';

    // Body: luminous fill from crest down — the musical weather mass.
    const grad = ctx.createLinearGradient(0, baseline - maxH, 0, baseline + 30);
    grad.addColorStop(0, `${color}99`);
    grad.addColorStop(0.55, `${color}4d`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.75 * this.budget * eqMul;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, baseline + 30);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1].x, baseline + 30);
    ctx.closePath();
    ctx.fill();

    // Bright aurora crest line on top — the fill alone reads as a haze;
    // this is what makes the spectrum's own shape legible against the sky.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    for (const [lw, alpha] of [[10, 0.16], [4, 0.32], [1.6, 0.85]]) {
      ctx.globalAlpha = alpha * this.budget * eqMul;
      ctx.lineWidth = lw;
      ctx.beginPath();
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
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
      // A single flat fill read as a plain pale disc no matter how faceted
      // the outline is -- especially for shallow superformula params
      // (GEODE's hexagon barely dips below its own peak radius) where the
      // silhouette alone is too subtle to notice against the halo glow. A
      // simple off-center sphere-shaded gradient gives every faceted
      // celestial actual depth instead of relying on the outline to sell it.
      const rgb = hexToRgb(c.color);
      const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const shade = ctx.createRadialGradient(
        cx - c.radius * 0.35, cy - c.radius * 0.35, 0,
        cx, cy, c.radius * 1.15,
      );
      shade.addColorStop(0, `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${Math.min(94, l + 14).toFixed(0)}%)`);
      shade.addColorStop(0.6, c.color);
      shade.addColorStop(1, `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${Math.max(4, l - 20).toFixed(0)}%)`);
      ctx.fillStyle = shade;
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
    const fogMul = styleDials(this.visualStyle).fogMul;
    // Always carries a little atmosphere, more on calm stretches.
    const calm = this.calmLevel || 0;
    const alpha = 0.10 * fogMul + 0.14 * fogMul * calm;
    if (alpha < 0.01) return;
    const period = canvas.width * 1.6;
    // See fogBandGradientGeometry's own doc comment: an ellipse fitted to
    // the band, reaching zero at its top/bottom, in place of the old circle
    // a shorter rect used to cut off mid-falloff.
    const { cy, r, yScale } = fogBandGradientGeometry(canvas.width, canvas.height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const bank of this._fogBanks) {
      for (const x of bank.x < canvas.width * 0.5 ? [bank.x, bank.x + period] : [bank.x]) {
        ctx.save();
        ctx.translate(x, cy);
        ctx.scale(1, yScale);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /** `this.groundY` is fixed at construction against the NOMINAL
   *  (unzoomed) frame, but during a camera pull-back this method's caller
   *  is drawing into the wider/taller zoomed logical stage instead
   *  (CameraDirector.zoom < 1 -- see Renderer.js). Combining the two
   *  directly -- `this.groundY + 40 - canvas.height` -- has canvas.height
   *  cancel out exactly, pinning the ranges to a fixed absolute Y
   *  regardless of zoom. mountainStripDrawHeight's headroom cap
   *  (`canvas.height * HEADROOM_FRAC`) then GROWS as the frame widens
   *  while its "bottom" anchor (groundY+40) stays fixed and small, so the
   *  allowed strip height actively SHRINKS the further the camera pulls
   *  back -- ranges collapse to a thin sliver near the bottom of frame
   *  instead of growing to fill the newly revealed space, leaving the sky
   *  and ocean (which correctly scale off plain canvas.height fractions)
   *  to cover a much bigger, under-detailed area than intended. Scaling
   *  groundY by the same ratio canvas.height/this.h that the zoomed stage
   *  itself grew by keeps the ranges' anchor and headroom growing in step
   *  with the pull-back, exactly like the sky and ocean already do. */
  _zoomedGroundY(canvas) {
    const zoomScale = this.h > 0 ? canvas.height / this.h : 1;
    return this.groundY * zoomScale;
  }

  _drawLayer(ctx, canvas, layerKey, scrollX, tint, t, A, B) {
    const stripsA = this.stripsFor(A.name), stripsB = this.stripsFor(B.name);
    // Per-section height (Stage 1): a draw-time multiplier, set once per
    // frame in draw() from the active section(s) -- never baked, since
    // generateSilhouette's own HEADROOM refit would erase it on L2/L3.
    const { from: heightMulA = 1, to: heightMulB = 1 } = this._drawHeightMul || {};
    // Snowline (Stage 4): also a per-section value, read the same way.
    const { from: snowLineA = 1, to: snowLineB = 1 } = this._drawSnowLine || {};
    const zGroundY = this._zoomedGroundY(canvas);
    // Lift the ranges so their ridges actually clear the ground band --
    // strip bottoms stay tucked safely beneath the ground fill.
    const yOff = zGroundY + 40 - canvas.height;
    ctx.save();
    // Float tilt (CameraDirector.floatTilt): as the camera pulls back, each
    // range leans as if the vantage point itself is rising past it -- scaled
    // by the SAME depth ratio that already governs its parallax scroll
    // speed, so the nearest range (L5) gets the full tilt and the farthest
    // (L2) barely moves, exactly like their scroll speeds already do.
    // Pivoted near the range's own base (the ground line) so its foot stays
    // put and its peak is what visibly swings -- the ground itself never
    // tilts (see the separate fixed ground transform in draw()), so this
    // reads as the mountains leaning away from a level floor, not the
    // floor tilting under them.
    const tilt = (this.floatTilt || 0) * (LAYER_RATIOS[layerKey] / LAYER_RATIOS.L5);
    if (tilt) {
      const pivotX = canvas.width / 2, pivotY = zGroundY;
      ctx.translate(pivotX, pivotY);
      ctx.rotate(tilt);
      ctx.translate(-pivotX, -pivotY);
    }
    const wantShimmerSlices = styleDials(this.visualStyle).heatShimmerSlices !== false;
    const biomeShimmerAlpha = (A.fx === 'heatShimmer' ? 1 - t : 0) + (B.fx === 'heatShimmer' ? t : 0);
    const applyBiomeShimmer = wantShimmerSlices && biomeShimmerAlpha > 0.05 && layerKey !== 'L5';
    // Movement II: heat shimmer isn't only SOLAR's signature anymore -- a
    // hard hype-fast spike reuses the exact same slice-offset trick on the
    // farthest range, above the horizon, regardless of biome.
    // Rendered skips the row-slice warp (it paints horizontal hairlines).
    const applyDynamicShimmer = wantShimmerSlices && layerKey === 'L2' && (this.heatShimmer || 0) > 0.7;
    if (applyBiomeShimmer || applyDynamicShimmer) {
      this._drawShimmered(ctx, canvas, stripsA[layerKey], scrollX, yOff);
    } else {
      this._drawDancingStrip(ctx, canvas, stripsA[layerKey], scrollX, yOff, layerKey, A.terrainEnergy ?? 1, heightMulA);
      // Volume before the crest: the skyline stroke has to sit on top of
      // its own mountain's shading, not under it.
      this._drawRidgeVolume(ctx, canvas, stripsA[layerKey], scrollX, yOff, layerKey, 1, A.terrainEnergy ?? 1, heightMulA, snowLineA);
      // Crest rim: full strength at the near anchors (L4/L5), extended to
      // L2/L3 at reduced alpha (Stage 3) -- gated on heavyPostFx there since
      // it's a wider live pass across the two biggest ranges on screen.
      const rimOkA = layerKey === 'L4' || layerKey === 'L5' || !this._perf || this._perf.heavyPostFx;
      if (rimOkA && A.edgeLight) {
        this._drawCrest(ctx, canvas, stripsA[layerKey], scrollX, yOff, layerKey, A.edgeLight, CREST_RIM_ALPHA[layerKey] ?? 1, A.terrainEnergy ?? 1, heightMulA);
      }
    }
    if (B !== A && t > 0.02) {
      ctx.globalAlpha = t;
      this._drawDancingStrip(ctx, canvas, stripsB[layerKey], scrollX, yOff, layerKey, B.terrainEnergy ?? 1, heightMulB);
      ctx.globalAlpha = 1;
      this._drawRidgeVolume(ctx, canvas, stripsB[layerKey], scrollX, yOff, layerKey, t, B.terrainEnergy ?? 1, heightMulB, snowLineB);
      const rimOkB = layerKey === 'L4' || layerKey === 'L5' || !this._perf || this._perf.heavyPostFx;
      if (rimOkB && B.edgeLight) {
        this._drawCrest(ctx, canvas, stripsB[layerKey], scrollX, yOff, layerKey, B.edgeLight, t * (CREST_RIM_ALPHA[layerKey] ?? 1), B.terrainEnergy ?? 1, heightMulB);
      }
    }
    ctx.restore();
  }

  /** How heaved the furthest range is right now at one screen column, 0..1
   *  (see MountainChoreo.ridgeSwell01). Midio's jump gate rides this, so it
   *  is read from the sim rather than from a draw pass -- it deliberately
   *  re-derives the same strip-space column position _drawDancingStrip uses
   *  (worldX through the L2 parallax ratio, delamination included) so the
   *  number describes the range the player is actually looking at.
   *  @param {number} screenX the column to read, in stage space */
  farRidgeSwell01(screenX = 0) {
    const cfg = DANCE_LAYERS[FAR_DANCE_LAYER];
    if (!cfg) return 0;
    const kick = kickEnv(this.tSec * 1000 - this._danceKickMs - cfg.delaySec * 1000) * this._danceKickAmp;
    const scrollX = this._danceWorldX * CodaDirector.delaminateRatio(LAYER_RATIOS[FAR_DANCE_LAYER], this.unravel);
    return ridgeSwell01(scrollX + screenX, this.tSec, cfg, kick);
  }

  /** The mountains dance: the strip is drawn in column slices, each riding
   *  a groove-scaled traveling wave along the ridge, and the whole range
   *  bounces on kicks — near hills first, far peaks a beat-fraction later
   *  (per-layer delaySec), a crowd wave rolling into the distance. Column
   *  phase is computed in scroll-stable strip space so the wave travels
   *  with time, never jittering with camera scroll. The strips overhang
   *  the ground band by ~40px, which quietly swallows the bottom gap a
   *  lifted column would otherwise open. */
  _drawDancingStrip(ctx, canvas, strip, scrollX, yOff, layerKey, terrainEnergy = 1, heightMul = 1) {
    const cfg = DANCE_LAYERS[layerKey];
    if (!cfg) {
      drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
      return;
    }
    const nowMs = this.tSec * 1000;
    const kick = kickEnv(nowMs - this._danceKickMs - cfg.delaySec * 1000) * this._danceKickAmp;
    // Orogeny grows the range, then mountainStripDrawHeight hard-caps so peaks
    // stay on-frame (ocean/sky remain visible; off-screen summits are useless).
    // heightMul is the per-section draw-time multiplier (Stage 1 of the
    // mountain overhaul) -- never baked, since generateSilhouette's own
    // HEADROOM refit would erase an in-strip height change on L2/L3.
    const growthMul = orogenyHeightMul(layerKey, clamp01(this.orogenyGrowth || 0))
      * pullbackHeightMul(layerKey, clamp01(this.pullback01 || 0))
      * Math.max(0, heightMul);
    const dh = mountainStripDrawHeight(strip.height, growthMul, canvas.height, this._zoomedGroundY(canvas));
    const baseY = canvas.height - dh + yOff;
    // Stage 2 (ridge deformation): summits sharpen on the kick, flanks swell
    // on sustained energy -- gated by terrainEnergy exactly like the offset
    // dance above, so a flat/calm biome doesn't deform either.
    const sustain = this._danceSustain || 0;
    // Slice width is the dance's sampling resolution, and a quality setting
    // (PerfGovernor.danceColumnWidth): the step between neighbouring slices
    // is the offset curve's slope times this width, so narrowing it shrinks
    // the staircase in the skyline proportionally. _crestPoints must read the
    // SAME width, or the live crest polyline lands where the blit didn't.
    const colW = this._danceColW();
    const w = strip.width;
    let x = -(((scrollX % w) + w) % w);
    while (x < canvas.width) {
      for (let cx = 0; cx < w; cx += colW) {
        const cw = Math.min(colW, w - cx);
        // 1px horizontal overlap hides hairline seams between dance columns.
        const drawW = Math.min(cw + 1, w - cx);
        const sx = x + cx;
        if (sx + drawW < 0 || sx > canvas.width) continue;
        // Offsets at this column's own two BOUNDARIES, not one sample held
        // flat across it. Drawn with a vertical shear between them, the
        // column's left edge lands exactly where its left neighbour's right
        // edge did, so the silhouette is piecewise-linear instead of a
        // staircase and there is no seam left to hide.
        //
        // The old code sampled the LEFT EDGE and held it constant, while the
        // live crest stroke blended between column CENTERS -- a ramp phase-
        // shifted half a column from a staircase. That is why the neon ridge
        // line floated off the fill it traces.
        const dyL = danceOffset(scrollX + sx, this.tSec, this._danceGroove, kick, cfg, this.fever || 0) * terrainEnergy;
        const dyR = danceOffset(scrollX + sx + cw, this.tSec, this._danceGroove, kick, cfg, this.fever || 0) * terrainEnergy;
        const dy = dyL;
        const shear = (dyR - dyL) / Math.max(1, cw);
        // Foot-anchored: this column's own foot (baseY + dh + dy, the same
        // translation the offset dance already applies) never moves: only
        // the elevation above it stretches, so a squat foothill barely
        // grows while this range's own summit visibly heaves.
        const h01 = columnHeight01At(strip.ridge, cx);
        const rawScale = danceScale(h01, kick, sustain, cfg);
        const colDh = dh * (1 + (rawScale - 1) * terrainEnergy);
        const footY = baseY + dh + dy;
        if (Math.abs(shear) < 1e-6) {
          ctx.drawImage(strip, cx, 0, drawW, strip.height, sx, footY - colDh, drawW, colDh);
        } else {
          // transform(1, k, 0, 1, 0, 0) maps (x, y) -> (x, y + k*x), so the
          // destination y is pre-compensated by -k*sx to put the column's
          // LEFT edge exactly on footY - colDh; the shear then carries it to
          // footY - colDh + (dyR - dyL) at the right edge. A pure vertical
          // shear translates the column continuously, which is exactly what
          // the offset dance is -- the foot stays as glued as it ever was,
          // it simply arrives at each x by a ramp rather than a jump.
          ctx.save();
          ctx.transform(1, shear, 0, 1, 0, 0);
          ctx.drawImage(strip, cx, 0, drawW, strip.height, sx, footY - colDh - shear * sx, drawW, colDh);
          ctx.restore();
        }
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
  /** The smooth screen-space crest polyline for a dancing range, plus the
   *  band it encloses. Extracted so the crest stroke and the volume pass
   *  (depth gradient + peak shoulders) walk one identical curve -- if they
   *  re-derived it separately, any drift between them would show up as the
   *  shading peeling away from the skyline it is supposed to belong to. */
  /** The width _drawDancingStrip is slicing the strip at this frame -- the
   *  dance's sampling resolution, and a quality setting (see
   *  PerfGovernor.danceColumnWidth). Read through one accessor so the blit
   *  and the live crest polyline can never disagree about it: they are the
   *  same silhouette, and a mismatch puts the crest where the blit isn't. */
  _danceColW() {
    return this._perf ? this._perf.danceColumnWidth : DANCE_COL_FINE;
  }

  _crestPoints(canvas, strip, scrollX, yOff, layerKey, terrainEnergy = 1, heightMul = 1) {
    if (!strip.ridge) return null;
    const cfg = DANCE_LAYERS[layerKey];
    if (!cfg) return null;
    // Shared per-frame cache (cleared once at the top of draw()): this same
    // (strip, layerKey, scrollX, terrainEnergy, heightMul) combination is
    // re-derived by _drawRidgeVolume, _drawCrest, and _drawConnectorHills
    // for the same frame -- up to ~14x across L2-L5 with a crossfade
    // active. yOff/canvas are constant for the whole frame so they don't
    // need to be in the key.
    const cache = this._crestCache;
    let byStrip = cache && cache.get(strip);
    const colW = this._danceColW();
    const cacheKey = `${layerKey}|${scrollX}|${terrainEnergy}|${heightMul}|${colW}`;
    if (byStrip) {
      const hit = byStrip.get(cacheKey);
      if (hit) return hit;
    }
    const nowMs = this.tSec * 1000;
    const kick = kickEnv(nowMs - this._danceKickMs - cfg.delaySec * 1000) * this._danceKickAmp;
    const growthMul = orogenyHeightMul(layerKey, clamp01(this.orogenyGrowth || 0))
      * pullbackHeightMul(layerKey, clamp01(this.pullback01 || 0))
      * Math.max(0, heightMul);
    const dh = mountainStripDrawHeight(strip.height, growthMul, canvas.height, this._zoomedGroundY(canvas));
    const scale = dh / Math.max(1, strip.height);
    const baseY = canvas.height - dh + yOff;
    const w = strip.width;
    const isGeo = layerKey === 'L4';
    const tSec = this.tSec;
    const fever = this.fever || 0;
    const groove = this._danceGroove;
    const sustain = this._danceSustain || 0;

    const pts = new Array(Math.ceil(canvas.width / CREST_STEP_PX) + 3);
    let n = 0;
    let crestY = Infinity;
    for (let x = -CREST_STEP_PX; x <= canvas.width + CREST_STEP_PX; x += CREST_STEP_PX) {
      const stripX = scrollX + x;
      const u = (((stripX % w) + w) % w);
      const yR = ridgeYSmooth(strip.ridge, u) * scale;
      const dy = danceOffsetSmooth(stripX, tSec, groove, kick, cfg, fever, colW) * terrainEnergy;
      const lift = (isGeo ? geoCrestOffset(u / w, this._eqSmoothed, this._geoFeatures, tSec) : 0) * terrainEnergy;
      // Stage 2 (ridge deformation): foot-anchored per-column scale -- the
      // strip's foot (screen y = baseY + dh) never moves; only the
      // elevation above it stretches, by this column's own relative peak
      // height (h01, mirroring _drawDancingStrip's raw per-column read,
      // but smoothly blended across column seams like the rest of this
      // live curve already is).
      const h01 = columnHeight01At(strip.ridge, stripX);
      const rawScale = danceScaleSmooth(strip.ridge, stripX, kick, sustain, cfg, colW);
      const localScale = 1 + (rawScale - 1) * terrainEnergy;
      const heightAboveFoot = dh - yR;
      const yRDeformed = dh - heightAboveFoot * localScale;
      const y = baseY + yRDeformed + dy - lift;
      if (y < crestY) crestY = y;
      pts[n++] = { x, y, lift, stripX, dy, scale: scale * localScale, h01 };
    }
    pts.length = n;
    // The strips are blitted from baseY down over `dh`, so this is where the
    // range's body actually ends and the ground band swallows it.
    const geom = {
      pts, baseY, bottomY: baseY + dh,
      footY: baseY + dh, crestY, dh, stripHeight: strip.height,
    };
    if (cache) {
      if (!byStrip) { byStrip = new Map(); cache.set(strip, byStrip); }
      byStrip.set(cacheKey, geom);
    }
    return geom;
  }

  _drawCrest(ctx, canvas, strip, scrollX, yOff, layerKey, edgeLight, alpha, terrainEnergy = 1, heightMul = 1) {
    const geom = this._crestPoints(canvas, strip, scrollX, yOff, layerKey, terrainEnergy, heightMul);
    if (!geom) return;
    const { pts } = geom;
    const isGeo = layerKey === 'L4';

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
    // Ridge glow: a soft wide pass (CGI catch-light) rather than stacked
    // hairline polylines that stripe the sky.
    const crestDials = styleDials(this.visualStyle);
    const crestMul = crestDials.crestGlowAlpha ?? 1;
    if (crestDials.crestStroke !== false && crestMul > 0.02) {
      const passes = [[7.5, 0.10], [3.2, 0.22], [1.1, 0.38]];
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // A rim is light spilling over an edge, so it takes its color from the
      // LIGHT as much as from the biome's own accent. Stroked in raw
      // `edgeLight` it was a marker pen tracing the mountain in whatever
      // saturated hue the palette happened to name -- which on a bright
      // palette reads as neon piping rather than as a backlit ridge.
      const rimColor = this.light
        ? this.lerpCache.get(edgeLight, this.light.colorHex, RIM_LIGHT_MIX)
        : edgeLight;
      const { r: rr, g: rg, b: rb } = hexToRgb(rimColor);
      // ...and it has to fall off away from the source. A constant alpha all
      // the way across the frame is the other half of why it read as an
      // outline: real rim light is strongest where the ridge faces the light
      // and nearly gone on the far side. One horizontal gradient per pass
      // does that in the same single stroke call the flat version cost.
      const lightX = this.light ? this.light.x : canvas.width * 0.5;
      const rimGrad = (baseA) => {
        const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
        for (let s = 0; s <= RIM_GRADIENT_STOPS; s++) {
          const u = s / RIM_GRADIENT_STOPS;
          const a = baseA * rimGain(u * canvas.width, lightX, canvas.width);
          grad.addColorStop(u, `rgba(${rr},${rg},${rb},${a.toFixed(4)})`);
        }
        return grad;
      };
      for (const [lw, a] of passes) {
        ctx.strokeStyle = rimGrad(a * alpha * crestMul);
        ctx.globalAlpha = 1;
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * The green connector country (ConnectorHills.js).
   *
   * The far range carries the biggest dance, which means it spends a lot of
   * its time hidden behind the nearer hills -- and when it does, there's a
   * dead band between whatever hid it and the ground, with nothing to carry
   * the eye down through. These hills fill exactly that, only there, and only
   * as much as the ridge is actually buried.
   *
   * Deliberately the quietest thing on screen: a soft forest/grass green at
   * low alpha with no crest stroke of its own, so it reads as distance rather
   * than as another skyline competing with the one it's rescuing.
   */
  /**
   * The distant swell that stands in for the dancing ridge when the view
   * angle has buried it (DistantWave.js).
   *
   * Two jobs, deliberately in one pass because both need the same geometry:
   *
   *  1. **Measure.** Every frame, how much of L2 the nearer ranges are
   *     eating, into `_ridgeOcclusionRaw`. update() smooths it and, at a
   *     section boundary and nowhere else, lets it decide the swap.
   *  2. **Draw.** Whatever the crossfade currently says. Drawn BEFORE L2 --
   *     behind every range -- so the near hills occlude the swell's body and
   *     only its crests break their skyline. That's what makes it read as
   *     water seen past the mountains rather than a band laid over the sky.
   *
   * The measurement is never gated: the decision has to be made on the same
   * evidence at every shed level, or dropping a rung mid-song would silently
   * change what the next boundary decides. Only the drawing sheds, on the
   * same rung as the connector country it partners with.
   */
  _drawDistantWave(ctx, canvas, { scrollX0, scrollX1, scrollX2 }, A, B, t) {
    const profile = t > 0.5 ? B : A;
    const strips = this.stripsFor(profile.name);
    if (!strips) return;
    const { from: heightMulA = 1, to: heightMulB = 1 } = this._drawHeightMul || {};
    const heightMul = t > 0.5 ? heightMulB : heightMulA;
    const energy = profile.terrainEnergy ?? 1;
    const yOff = this._zoomedGroundY(canvas) + 40 - canvas.height;
    const dancy = this._crestPoints(canvas, strips.L2, scrollX0, yOff, 'L2', energy, heightMul);
    if (!dancy) return;
    const nearer = [
      this._crestPoints(canvas, strips.L3, scrollX1, yOff, 'L3', energy, heightMul),
      this._crestPoints(canvas, strips.L4, scrollX2, yOff, 'L4', energy, heightMul),
    ].filter(Boolean);
    if (!nearer.length) return;
    const skyline = dancy.pts.map((_, i) => {
      let top = Infinity;
      for (const g of nearer) if (g.pts[i] && g.pts[i].y < top) top = g.pts[i].y;
      return top;
    });
    this._ridgeOcclusionRaw = occludedFraction(dancy.pts, skyline);

    const mix = this._distantWaveMix || 0;
    this.distantWaveDebug = { occlusion01: this._ridgeOcclusion01, on: this._distantWaveOn, mix };
    if (mix < 0.01) return;
    if (this._perf && !this._perf.heavyPostFx) return;

    let sumY = 0, minY = Infinity, maxY = -Infinity;
    for (const p of dancy.pts) { sumY += p.y; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const meanY = sumY / dancy.pts.length;
    const relief = Math.max(0, maxY - minY);
    const ampPx = Math.min(WAVE_AMP_MAX_PX, Math.max(WAVE_AMP_MIN_PX, relief * WAVE_AMP_FRAC));
    // Where the swell sits. The obvious answer -- the ridge's own crest line
    // -- is wrong, and wrong for the same reason the feature exists: a ridge
    // this pass has just decided is BURIED is, by definition, below the
    // skyline that buried it, so a wave drawn there is hidden too. So the
    // baseline is taken from whichever line is higher on screen, the ridge's
    // mean crest or the occluding skyline's, with the skyline candidate
    // lifted by a full amplitude so the swell's troughs clear it rather than
    // only its crests. Clamped out of the upper sky band so a very tall near
    // range can't push the sea up among the stars.
    let sumSky = 0;
    for (const y of skyline) sumSky += y;
    const meanSky = sumSky / skyline.length;
    const baselineY = Math.max(
      canvas.height * 0.15,
      Math.min(meanY - WAVE_LIFT_PX, meanSky - ampPx - WAVE_LIFT_PX),
    );

    const pts = swellCrest({
      width: canvas.width, baselineY, ampPx, tSec: this.tSec,
      scrollX: scrollX0, stepPx: CREST_STEP_PX, energy01: clamp01(energy),
    });
    if (pts.length < 2) return;

    // Water at this distance is mostly sky: the same air color every range's
    // body is washed toward (Stage 3), nudged toward the biome's own halo so
    // the sea belongs to this world rather than being one grey everywhere.
    const base = ensureMinLightness(
      this.lerpCache.get(this._airColor || '#5a6b80', this._rotated(profile.celestial.haloColor), 0.22),
      0.22,
    );
    const { r, g, b } = hexToRgb(base);
    const alpha = WAVE_ALPHA * mix * this.budget;
    if (alpha < 0.01) return;

    ctx.save();
    const bottom = baselineY + ampPx + WAVE_BAND_PX;
    const grad = ctx.createLinearGradient(0, baselineY - ampPx, 0, bottom);
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha.toFixed(3)})`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${(alpha * 0.7).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[pts.length - 1].x, bottom);
    ctx.lineTo(pts[0].x, bottom);
    ctx.closePath();
    ctx.fill();

    // The crest glint. Without it this is just another hazy ridge -- the
    // moving highlight on the swell is the whole reason the eye reads water
    // and keeps watching the back of the scene.
    if (!this.reducedFlash) {
      ctx.globalAlpha = WAVE_GLINT_ALPHA * mix * this.budget;
      ctx.strokeStyle = this._rotated(profile.celestial.haloColor);
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawConnectorHills(ctx, canvas, { scrollX0, scrollX1, scrollX2 }, A, B, t) {
    if (this._perf && !this._perf.heavyPostFx) return;
    const profile = t > 0.5 ? B : A;
    const strips = this.stripsFor(profile.name);
    if (!strips) return;
    const { from: heightMulA = 1, to: heightMulB = 1 } = this._drawHeightMul || {};
    const heightMul = t > 0.5 ? heightMulB : heightMulA;
    const yOff = this._zoomedGroundY(canvas) + 40 - canvas.height;
    const dancy = this._crestPoints(canvas, strips.L2, scrollX0, yOff, 'L2', profile.terrainEnergy ?? 1, heightMul);
    if (!dancy) return;

    // The skyline doing the hiding: whichever of the nearer ranges stands
    // highest at each x (screen y, so the minimum).
    const nearer = [
      this._crestPoints(canvas, strips.L3, scrollX1, yOff, 'L3', profile.terrainEnergy ?? 1, heightMul),
      this._crestPoints(canvas, strips.L4, scrollX2, yOff, 'L4', profile.terrainEnergy ?? 1, heightMul),
    ].filter(Boolean);
    if (!nearer.length) return;
    const skyline = dancy.pts.map((_, i) => {
      let top = Infinity;
      for (const g of nearer) if (g.pts[i] && g.pts[i].y < top) top = g.pts[i].y;
      return top;
    });

    const spans = occludedSpans(dancy.pts, skyline);
    // Debug readout (DebugOverlay, backtick): what the pass actually saw this
    // frame. Reconstructing it from outside means guessing the parallax
    // ratios, which is its own source of wrong answers.
    this.connectorDebug = { spans: spans.length, depth01: spans.length ? Math.max(...spans.map((x) => x.depth01)) : 0, alpha: 0 };
    if (!spans.length) return;

    // Forest/grass, pulled from the biome's own halo so it still belongs to
    // this world, but dragged well toward green and desaturated. Floored so it
    // survives the dark palettes, same lesson as the ground.
    const base = ensureMinLightness(
      this.lerpCache.get(this._rotated(profile.celestial.haloColor), CONNECTOR_GREEN, CONNECTOR_GREEN_MIX),
      CONNECTOR_MIN_LIGHTNESS,
    );
    const { r, g, b } = hexToRgb(base);

    ctx.save();
    for (const span of spans) {
      const pts = hillCurve(span, dancy.pts, skyline, { descendPx: CONNECTOR_DESCEND_PX });
      if (pts.length < 2) continue;
      // Wider camera pull-back also earns a stronger connector wash -- the
      // wide shot is exactly where the flat gap it bridges is most visible.
      // The distant wave answers the same complaint these hills do -- a
      // sightline broken by a buried ridge -- so when the swell has taken
      // the horizon, the country stands down rather than stacking a second
      // fix on top of the first.
      const alpha = CONNECTOR_ALPHA * span.depth01 * this.budget
        * (1 + 0.5 * clamp01(this.pullback01 || 0)) * (1 - (this._distantWaveMix || 0));
      this.connectorDebug.alpha = Math.max(this.connectorDebug.alpha, alpha);
      if (alpha < 0.01) continue;

      // A band that follows the hills down and dissolves, not a fill to the
      // floor: it bridges the gap the hidden ridge left, then hands the eye
      // over to the range in front.
      let topY = Infinity, footY = -Infinity;
      for (const q of pts) { if (q.y < topY) topY = q.y; if (q.y > footY) footY = q.y; }
      const bottom = Math.min(this._zoomedGroundY(canvas) + 40, footY + CONNECTOR_BAND_PX);
      const grad = ctx.createLinearGradient(0, topY, 0, bottom);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha.toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},${(alpha * 0.6).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[pts.length - 1].x, bottom);
      ctx.lineTo(pts[0].x, bottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Cast shadow (Stage 5 of the mountain overhaul): the near range darkens
   * the already-drawn farther range in a band above the near range's OWN
   * crest -- this is where the near silhouette actually stands in front of
   * the far one, so it's the physically sensible place for its shadow to
   * fall. multiply-blended (matches _drawRidgeVolume's own shade
   * vocabulary) and clipped to the far range's body using the same cached
   * _crestPoints geometry _drawRidgeVolume reads, so no new geometry pass
   * is needed. Deliberately no horizontal shift: asserting a shadow
   * DIRECTION would only be honest under a low, off-camera sun, and this
   * runs at every sun elevation (strength alone falls off at high noon --
   * see this._castShadowStrength).
   */
  _drawCastShadow(ctx, canvas, farLayerKey, nearLayerKey, scrollFar, scrollNear, A, B, t) {
    if (this._perf && !this._perf.heavyPostFx) return;
    const strength = this._castShadowStrength || 0;
    if (strength <= 0.002) return;
    const profile = t > 0.5 ? B : A;
    const strips = this.stripsFor(profile.name);
    if (!strips) return;
    const farStrip = strips[farLayerKey], nearStrip = strips[nearLayerKey];
    if (!farStrip || !nearStrip) return;
    const { from: heightMulA = 1, to: heightMulB = 1 } = this._drawHeightMul || {};
    const heightMul = t > 0.5 ? heightMulB : heightMulA;
    const yOff = this._zoomedGroundY(canvas) + 40 - canvas.height;
    const energy = profile.terrainEnergy ?? 1;
    const farGeom = this._crestPoints(canvas, farStrip, scrollFar, yOff, farLayerKey, energy, heightMul);
    const nearGeom = this._crestPoints(canvas, nearStrip, scrollNear, yOff, nearLayerKey, energy, heightMul);
    if (!farGeom || !nearGeom) return;
    if (!(farGeom.bottomY > farGeom.crestY)) return;

    const farBody = new Path2D();
    farBody.moveTo(farGeom.pts[0].x, farGeom.pts[0].y);
    for (let i = 1; i < farGeom.pts.length; i++) farBody.lineTo(farGeom.pts[i].x, farGeom.pts[i].y);
    farBody.lineTo(farGeom.pts[farGeom.pts.length - 1].x, farGeom.bottomY);
    farBody.lineTo(farGeom.pts[0].x, farGeom.bottomY);
    farBody.closePath();

    // The fade used to come from a vertical gradient anchored at
    // `nearGeom.crestY` -- the single highest point of the near range across
    // the whole screen. That is a global extremum over a DANCING ridge:
    // whichever column happens to be tallest changes abruptly frame to frame,
    // so the gradient's position snapped around and the shadow flickered.
    //
    // A screen-vertical gradient was the wrong instrument anyway. The band
    // follows a wavy crest, so one gradient can only be correct at whatever
    // height it was anchored to and is wrong everywhere else. Stacked
    // sub-bands, each tracing the crest polyline at its own offset, put the
    // falloff where it belongs -- measured from the LOCAL crest at every x --
    // and depend on no extremum at all, so there is nothing left to snap.
    const nPts = nearGeom.pts;
    ctx.save();
    ctx.clip(farBody);
    ctx.globalCompositeOperation = 'multiply';
    const step = CAST_SHADOW_BAND_PX / CAST_SHADOW_STEPS;
    for (let s2 = 0; s2 < CAST_SHADOW_STEPS; s2++) {
      // Darkest against the crest, fading upward away from it.
      const a = strength * (1 - s2 / CAST_SHADOW_STEPS);
      if (a < 0.004) continue;
      const g = Math.max(0, Math.min(255, Math.round(255 * (1 - a))));
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      const lo = -s2 * step, hi = -(s2 + 1) * step;
      const band = new Path2D();
      band.moveTo(nPts[0].x, nPts[0].y + lo);
      for (let i = 1; i < nPts.length; i++) band.lineTo(nPts[i].x, nPts[i].y + lo);
      for (let i = nPts.length - 1; i >= 0; i--) band.lineTo(nPts[i].x, nPts[i].y + hi);
      band.closePath();
      ctx.fill(band);
    }
    ctx.restore();
  }

  /** Summits worth sculpting: local maxima of the crest whose prominence
   *  (height above the lower of the two saddles flanking them) clears
   *  SHOULDER_MIN_PROMINENCE, thinned so no two sit closer than
   *  SHOULDER_MIN_SPACING_PX and only the tallest few survive. Prominence
   *  rather than a bare local-max test is the whole point: on a noise ridge
   *  every third sample is a local max, and spurring all of them is how you
   *  turn a mountain range into a hairball. */
  _ridgePeaks(pts) {
    const cands = [];
    for (let i = 1; i < pts.length - 1; i++) {
      if (!(pts[i].y < pts[i - 1].y && pts[i].y <= pts[i + 1].y)) continue;
      // Walk out both ways to the saddle before the ground rises again.
      let l = i, lo = pts[i].y;
      while (l > 0 && pts[l - 1].y >= pts[l].y) { l--; lo = Math.max(lo, pts[l].y); }
      let r = i, ro = pts[i].y;
      while (r < pts.length - 1 && pts[r + 1].y >= pts[r].y) { r++; ro = Math.max(ro, pts[r].y); }
      const prominence = Math.min(lo, ro) - pts[i].y;
      if (prominence >= SHOULDER_MIN_PROMINENCE) cands.push({ i, prominence });
    }
    cands.sort((a, b) => b.prominence - a.prominence);
    const kept = [];
    for (const c of cands) {
      if (kept.length >= SHOULDER_MAX_PER_RANGE) break;
      if (kept.some((k) => Math.abs(pts[k.i].x - pts[c.i].x) < SHOULDER_MIN_SPACING_PX)) continue;
      kept.push(c);
    }
    return kept;
  }

  /**
   * Gives a dancing range its third dimension. Two things, both live over
   * the blitted strip:
   *
   * 1. A depth gradient anchored to the SCREEN rather than to the strip
   *    bitmap. The baked gradient inside each strip is shifted per dance
   *    column (_drawDancingStrip blits in DANCE_COL_W slices, each at its
   *    own vertical offset), so at every column boundary the same screen row
   *    lands on a different part of that gradient -- a hard vertical shade
   *    step every 128px, marching across the range as it dances. Re-laying
   *    the gradient in screen space over the whole body restores one
   *    continuous shade across all of them.
   *
   * 2. Shoulders on the summits: from each peak, a spur descending toward
   *    the viewer all the way into the ground band, and a shorter one
   *    running away from us that fades out before it lands. The facet
   *    between the near spur and the skyline is shaded, which is what
   *    actually turns the silhouette into a solid -- a ridge line with a
   *    flat fill under it reads as a paper cutout no matter how nicely it
   *    moves. Kept well under the crest's own contrast so the skyline stays
   *    the thing you read first.
   */
  /**
   * Shading and depth for one range body.
   *
   * `geology` (snow caps, sedimentary bedding) is alpine-specific and off by
   * default for callers that opt in from another world kind: a city skyline
   * or a foundry's stacks have silhouettes that need shading just as much,
   * but snowcaps and rock strata on them would be nonsense. The SHADING half
   * is universal -- the strip bake is a single flat fill by design (see
   * SilhouetteGenerator: a baked gradient sliced into independently-offset
   * dance columns is a hard seam at every column boundary), so this pass is
   * the only source of shading depth any range has, in any world.
   */
  _drawRidgeVolume(ctx, canvas, strip, scrollX, yOff, layerKey, alpha, terrainEnergy = 1, heightMul = 1, snowLine01 = 1, { geology = true } = {}) {
    const strength = RIDGE_VOLUME_STRENGTH[layerKey] ?? 0;
    if (strength <= 0) return;
    const geom = this._crestPoints(canvas, strip, scrollX, yOff, layerKey, terrainEnergy, heightMul);
    if (!geom) return;
    const { pts, bottomY, crestY } = geom;
    if (!(bottomY > crestY)) return;

    // The body path: the skyline, then straight down and back along the
    // range's own bottom edge.
    const body = new Path2D();
    body.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) body.lineTo(pts[i].x, pts[i].y);
    body.lineTo(pts[pts.length - 1].x, bottomY);
    body.lineTo(pts[0].x, bottomY);
    body.closePath();

    ctx.save();
    ctx.clip(body);

    // Screen-anchored depth: catch the light along the crest, sink the
    // foot, leave the middle alone. Deliberately NOT a repaint in the
    // biome's own color -- the strips are already haze-mixed toward the sky
    // by distance, and re-filling them with a lightened silhouette hue
    // throws that away (a saturated palette turns into a slab of neon).
    // Just as deliberately not a pure darkening either: these scenes are
    // already dim, and the complaint being answered here is that the ranges
    // are hard to READ, so the pass has to add contrast without spending
    // overall brightness to get it.
    //
    // Coefficients bumped from 0.11/0.26 -- the strip used to also carry a
    // baked vertical gradient (SilhouetteGenerator's 'rendered' shadeMode),
    // and this pass only ever ADDED contrast on top of that. The strip is
    // now a flat mid-tone fill (see SilhouetteGenerator.js for why: a baked
    // gradient sliced into independently-offset dance columns is a hard
    // vertical seam at every column boundary), so this screen-space pass is
    // the range's ONLY source of shading depth and has to carry the full
    // load alone.
    const grad = ctx.createLinearGradient(0, crestY, 0, bottomY);
    grad.addColorStop(0, `rgba(255,250,240,${(RIDGE_CATCHLIGHT_ALPHA * alpha * strength).toFixed(3)})`);
    grad.addColorStop(0.34, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill(body);

    // The shade half: genuine multiply occlusion instead of an alpha-
    // blended black wash. A translucent black fill under the default
    // source-over composites IDENTICALLY to true multiply when the
    // source is pure black (co = cb*(1-a) either way) -- it can only ever
    // wash the surface toward black, never darken it while keeping its
    // own hue, which is why the shaded half always read flat. A fully-
    // OPAQUE gray fill under 'multiply' instead scales the destination by
    // that gray value (co = cb*g), so whatever hue/saturation the strip
    // already carries survives into its own shadow. Multiply can only
    // ever darken (g<=1 always), which is exactly why this has to be a
    // second pass rather than folded into the lit gradient above.
    const shadeStrength = RIDGE_SHADE_STRENGTH * alpha * strength;
    const g = Math.max(0, Math.min(255, Math.round(255 * (1 - shadeStrength))));
    const shadeGrad = ctx.createLinearGradient(0, crestY, 0, bottomY);
    shadeGrad.addColorStop(0, 'rgb(255,255,255)');
    shadeGrad.addColorStop(0.34, 'rgb(255,255,255)');
    shadeGrad.addColorStop(1, `rgb(${g},${g},${g})`);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = shadeGrad;
    ctx.fill(body);
    ctx.restore();

    // Aerial perspective (Stage 3 of the mountain overhaul): AERIAL_PULL was
    // already computed once per frame into tintL2..tintL5 (see draw()) and
    // handed to _drawLayer as its `tint` argument -- which this function
    // never read, so the whole table was dead code, tuned against a scene
    // where it never touched a pixel. This is the first live use of it: a
    // wash toward this._airColor (the same sky-horizon color the tint pull
    // targets), bottom-weighted since haze pools in valleys rather than
    // clinging to a summit. L5 gets AERIAL_PULL.L5 === 0, so this is a
    // guaranteed no-op there -- the near anchor stays exactly as crisp as
    // its authored color.
    const aerialPull = AERIAL_PULL[layerKey] || 0;
    if (aerialPull > 0.001 && this._airColor) {
      const air = hexToRgb(this._airColor);
      const aerialAlpha = aerialPull * alpha * strength;
      const aerialGrad = ctx.createLinearGradient(0, crestY, 0, bottomY);
      aerialGrad.addColorStop(0, `rgba(${air.r},${air.g},${air.b},${(aerialAlpha * 0.35).toFixed(3)})`);
      aerialGrad.addColorStop(1, `rgba(${air.r},${air.g},${air.b},${aerialAlpha.toFixed(3)})`);
      ctx.fillStyle = aerialGrad;
      ctx.fill(body);
    }

    // Snowline (Stage 4): song-grounded caps riding the same per-column
    // h01 Stage 2 already computes for this exact crest -- a summit whose
    // OWN relative height (h01, 0..1 within this range) clears the active
    // section's snowLine01 threshold gets capped, one that doesn't stays
    // bare rock. Free clip (already inside `body`), free deformation (h01
    // already reflects Stage 2's dance), gated on phenomenaFull since it's
    // atmosphere rather than the mountain's own form.
    const wantSnow = geology && (!this._perf || this._perf.phenomenaFull);
    if (wantSnow && snowLine01 < 1) {
      // Snow is an ALTITUDE, and this used to ask the wrong question of the
      // wrong variable: `p.h01 > snowLine01` tests a column's relative height
      // within the range, and h01 is a per-64px-column figure, so the answer
      // stepped between neighbouring crest samples. A cap therefore began and
      // ended in a single sample's width -- a vertical white cliff dropped
      // down the mountainside, which is what the "flat-topped slabs with
      // straight sides" in the report actually were.
      //
      // The honest test is whether the SURFACE is above the snow line, which
      // is continuous by construction: where the ridge crosses the altitude
      // the cap's top and bottom edges meet and the polygon simply closes.
      // Nothing to step, so there is no cliff to draw.
      // ...and the altitude itself was inverted. `snowLine01` is a
      // height-RANK threshold in [0.55, 1] (snowLine01For: "column-height-rank
      // above which a column's own peak is capped"), so snow belongs on the
      // top `1 - snowLine01` of the relief -- at 0.8, the top fifth. Measuring
      // `(1 - snowLine01)` UP FROM THE FOOT instead put the line at a fifth of
      // the way up and buried four fifths of every range in snow.
      //
      // That inversion has been here since the snowline landed, but it was
      // masked: while the per-column h01 test gated which columns got any snow
      // at all, this altitude only ever clamped them. Removing that test (it
      // was the cause of the vertical snow cliffs) promoted the bug to the
      // whole behavior, and the ranges went white.
      const snowAltY = bottomY - snowLine01 * (bottomY - crestY);
      // ...and the line itself gets a gentle wander, so it doesn't read as a
      // ruler laid across the range. Small next to the relief it sits in.
      const wobble = (stripX) => 6 * Math.sin(stripX / 260) + 3 * Math.sin(stripX / 97 + 1.7);
      const altAt = (p) => snowAltY + wobble(p.stripX);
      let anyCap = false;
      for (const p of pts) if (p.y < altAt(p)) { anyCap = true; break; }
      if (anyCap) {
        const cap = new Path2D();
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const y = Math.min(p.y, altAt(p));
          if (i === 0) cap.moveTo(p.x, y); else cap.lineTo(p.x, y);
        }
        for (let i = pts.length - 1; i >= 0; i--) cap.lineTo(pts[i].x, altAt(pts[i]));
        cap.closePath();
        // Pulled toward this._airColor (Stage 3) rather than pure white --
        // otherwise a snow cap pops out of the haze that's supposed to be
        // receding it into the distance along with everything else at
        // this depth.
        const snowColor = this._airColor
          ? this.lerpCache.get('#f5f9ff', this._airColor, 0.22)
          : '#f5f9ff';
        // Fading out toward the snow line rather than filling flat: a
        // constant alpha ends on a hard horizontal edge right where the cap
        // meets bare rock, and that edge was reading as the bottom of a slab.
        const snowTop = Math.max(crestY - 8, 0);
        const { r: sr, g: sg, b: sb } = hexToRgb(snowColor);
        const a0 = SNOW_ALPHA * alpha * strength;
        const snowGrad = ctx.createLinearGradient(0, snowTop, 0, snowAltY + 10);
        snowGrad.addColorStop(0, `rgba(${sr},${sg},${sb},${a0.toFixed(3)})`);
        snowGrad.addColorStop(0.65, `rgba(${sr},${sg},${sb},${(a0 * 0.72).toFixed(3)})`);
        snowGrad.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
        ctx.fillStyle = snowGrad;
        ctx.fill(cap);
      }
    }

    // Rock strata (Stage 6 -- highest-risk/most cuttable stage of the
    // mountain overhaul, L2/L3 only: L4 already carries GeoCrest + shoulders,
    // L5 is rolling hills). Thin multiply bands PARALLEL TO THE LOCAL CREST
    // -- each one traces the same live `pts` polyline everything else in
    // this pass already reads (already carrying Stage 2's per-column
    // deformation), just offset further down -- rather than a fixed
    // screen-horizontal stripe. That distinction is the whole safety case:
    // a horizontal stripe baked into the strip bitmap is exactly the family
    // the original column-seam bug came from (SilhouetteGenerator.js), and
    // a live but screen-horizontal stripe would still crawl unnaturally
    // against a dancing, foot-anchored ridge. Tracing the polyline means
    // every band moves WITH the ridge, so there is no seam to reintroduce.
    if (geology && (layerKey === 'L2' || layerKey === 'L3') && (!this._perf || this._perf.heavyPostFx)) {
      // Beds dip opposite ways on the two layers so the ranges read as two
      // separate pieces of country rather than one structure drawn twice.
      const beds = strataBeds({
        width: canvas.width, crestY, bottomY, scrollX,
        spacingPx: STRATA_SPACING_PX, maxBeds: STRATA_MAX_BEDS,
        dipSign: layerKey === 'L2' ? 1 : -1,
      });
      if (beds.length) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        // One Path2D per DISTINCT TONE rather than one for everything: beds
        // differ in darkness now (see strataBeds' `tone`) and a single fill
        // can only carry one color. `tone` takes a small fixed set of values
        // by construction, so this is three fills for a whole range -- still
        // fewer than the four full-width polygon fills this replaced, and the
        // frame is dominated by compositing rather than by path work.
        //
        // Grouped by exact value, not by bucket-and-take-the-midpoint: that
        // first attempt rendered a 0.71 bed at 0.4 and washed the bedding out
        // to nearly nothing.
        const byTone = new Map();
        for (const bed of beds) {
          const key = bed.tone.toFixed(4);
          if (!byTone.has(key)) byTone.set(key, { tone: bed.tone, beds: [] });
          byTone.get(key).beds.push(bed);
        }
        for (const { tone, beds: inBucket } of byTone.values()) {
          const g = Math.max(0, Math.min(255,
            Math.round(255 * (1 - STRATA_DARKEN * tone * alpha * strength))));
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          const band = new Path2D();
          for (const bed of inBucket) {
            const bp = bed.pts;
            band.moveTo(bp[0].x, bp[0].y);
            for (let i = 1; i < bp.length; i++) band.lineTo(bp[i].x, bp[i].y);
            for (let i = bp.length - 1; i >= 0; i--) band.lineTo(bp[i].x, bp[i].y + STRATA_BAND_PX);
            band.closePath();
          }
          ctx.fill(band);
        }
        ctx.restore();
      }
    }

    // Cheap enough (a handful of path fills, no offscreen buffers) that it
    // only sheds on the very bottom rung -- this is the form of the
    // mountain, not optional atmosphere like the phenomena layer.
    if (!this._perf || this._perf.heavyPostFx) {
      this._drawShoulders(ctx, pts, bottomY, alpha * strength);
    }
    ctx.restore();
  }

  /** The spurs themselves. Called already clipped to the range's body, so a
   *  facet can be built generously and still never spill past the skyline. */
  _drawShoulders(ctx, pts, bottomY, alpha) {
    // Neutral shading, not a tinted one. These have to read the same on all
    // seventeen palettes -- an ARCTIC blue and a SOLAR orange both just want
    // their shadowed face darker and their lit edge caught, and mixing the
    // biome's own hue back in only muddies whatever the sky already did.
    const lit = SHOULDER_LIT;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const { i, prominence } of this._ridgePeaks(pts)) {
      const p = pts[i];
      // A spur descends to ITS OWN summit's base, not to the world's ground
      // -- sizing it off the drop to the ground band instead made every
      // distant bump throw a 250px streak across the whole scene, which is
      // precisely the "visually noisy" failure this is trying to avoid. A
      // genuinely big near summit still reaches the ground, because its own
      // relief is that tall; a small far one keeps its spur to itself.
      const drop = Math.min(bottomY - p.y, prominence * SHOULDER_RELIEF_RUN);
      if (drop <= 10) continue;
      const footY = p.y + drop;
      // Facing follows the celestial, with the original stripX hash kept as
      // a per-summit perturbation so a whole range doesn't flatten into one
      // uniformly-lit wall. Falls back to the hash alone when no light is
      // on `this` (tests, and any caller that hasn't computed one yet).
      const lightX = this.light && Number.isFinite(this.light.x) ? this.light.x : null;
      const s = shoulderFacetSide(p.stripX, lightX, p.x);
      const nearRun = drop * SHOULDER_NEAR_RUN * s;
      const farRun = drop * SHOULDER_FAR_RUN * -s;

      // --- the face between the skyline and the near spur ---------------
      const facet = new Path2D();
      facet.moveTo(p.x, p.y);
      // Follow the real skyline out to where the spur's foot lands, so the
      // facet's upper edge IS the mountain's own outline.
      const stepDir = s > 0 ? 1 : -1;
      for (let k = i + stepDir; k >= 0 && k < pts.length; k += stepDir) {
        facet.lineTo(pts[k].x, pts[k].y);
        if ((pts[k].x - p.x) * stepDir >= Math.abs(nearRun)) break;
      }
      facet.lineTo(p.x + nearRun, footY);
      facet.lineTo(p.x, footY);
      facet.closePath();
      // Same multiply-occlusion treatment as the range body's own shade
      // pass above: an opaque gray under 'multiply' scales the surface
      // down rather than washing it toward black over top of it.
      {
        const shadeStrength = alpha * SHOULDER_FACET_ALPHA;
        const sg = Math.max(0, Math.min(255, Math.round(255 * (1 - shadeStrength))));
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${sg},${sg},${sg})`;
        ctx.fill(facet);
        ctx.restore();
      }

      // The spur's own edge -- a catch-light along the top of the ridge
      // running at us, which is what sells it as an edge rather than a
      // shadow with a straight side. Faded out along its length so it
      // dissolves into the body instead of ending on a hard tip.
      const { r, g, b } = hexToRgb(lit);
      const nearFade = ctx.createLinearGradient(p.x, p.y, p.x + nearRun, footY);
      nearFade.addColorStop(0, `rgba(${r},${g},${b},${(alpha * SHOULDER_LINE_ALPHA).toFixed(3)})`);
      nearFade.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.strokeStyle = nearFade;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x + nearRun * 0.34, p.y + drop * 0.58, p.x + nearRun, footY);
      ctx.stroke();

      // --- the shoulder running away from us ----------------------------
      // Shorter, shallower, and faded out before it reaches the bottom:
      // it's meant to leave the frame into depth, not to land.
      const farEndY = p.y + drop * 0.62;
      const fade = ctx.createLinearGradient(p.x, p.y, p.x + farRun, farEndY);
      fade.addColorStop(0, `rgba(${r},${g},${b},${(alpha * SHOULDER_LINE_ALPHA * 0.7).toFixed(3)})`);
      fade.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.strokeStyle = fade;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x + farRun * 0.45, p.y + drop * 0.22, p.x + farRun, farEndY);
      ctx.stroke();
    }
  }

  /** One super-distant mountain range that IS the spectrum: seven chunky
   *  bars — bass building the summit at the center, treble falling away to
   *  the flanks (see spectrumBars) — riding the SAME 7 raw bands as the
   *  horizon EQ but through their own far slower attack/release
   *  (massifEqStep, seconds not fractions of a second): the horizon EQ can
   *  hop with the beat, the massif can only ever crawl. It sits on the
   *  slowest scroll ratio in the scene, so it reads as the single farthest,
   *  most ancient thing in the world -- which is the whole basis for
   *  letting it loom far taller than any ordinary range (massifDrawHeight)
   *  without reading as absurd: something that far away, and that vast, is
   *  allowed to simply BE that big and barely seem to move at all.
   *  A jagged (not flat) crest, a permanent haze veil near its own summit
   *  that only rarely thins into a full clearing, and the occasional tiny
   *  scale marker drifting across its face (_drawMassifMarkers) are what
   *  turn "very tall bar graph" into something that induces real
   *  megalophobia -- the raw height alone was never going to do that on
   *  its own. Thin halo-colored crest caps stay the "this peak is an
   *  equalizer" tell, same as always. */
  _drawSpectrumMassif(ctx, canvas, worldX, A, B, t) {
    const bars = spectrumBars(this._massifEqSmoothed);
    const barW = 46, gap = 3;
    const massifW = bars.length * (barW + gap) - gap;
    const period = canvas.width * 1.5;
    const scroll = worldX * CodaDirector.delaminateRatio(0.03, this.unravel);
    const left = ((((canvas.width * 0.58 - scroll) % period) + period) % period) - massifW;
    if (left > canvas.width || left + massifW < 0) return;

    // Same bottom anchor as L2's own strips (_drawLayer's yOff), so the
    // massif reads as sitting at L2's altitude/layer instead of floating at
    // its own -- vertical position only; paint order, parallax (the scroll
    // above), and color stay untouched.
    const baseY = this._zoomedGroundY(canvas) + 40;
    // Massif rides L2 orogeny, but answers to its OWN far taller ceiling
    // (massifDrawHeight, not the ordinary-range mountainStripDrawHeight) --
    // see MountainChoreo.js's MASSIF_SKY_HEADROOM_FRAC for why that's safe
    // here specifically and nowhere else. The nominal height fed in is
    // deliberately way beyond anything growth could produce on its own
    // (unlike the ordinary ranges' 210, sized to their own strip bitmap) --
    // this massif isn't SCALED into its size by orogeny the way the
    // foreground ranges are, it simply already IS that size, so the real
    // ceiling (ordinary frame geometry) is always what actually binds.
    const growth = orogenyHeightMul('L2', clamp01(this.orogenyGrowth || 0));
    const maxH = massifDrawHeight(2000, growth, canvas.height, this._zoomedGroundY(canvas));
    const skyMid = this.lerpCache.get(A.sky[1], B.sky[1], t);
    const sil = this.lerpCache.get(A.silhouette, B.silhouette, t);
    const body = this._rotated(this.lerpCache.get(sil, skyMid, 0.55));
    const cap = this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));

    const nowMs = this.tSec * 1000;
    // The clearing: mostly veiled near its own crest, rarely fully bared --
    // see massifClearing01's doc for why the window is deliberately narrow.
    const clearing = massifClearing01(this.tSec);

    // ONE continuous ridge line across the whole width -- not seven
    // separate rectangles with gaps between them. At genuinely towering
    // heights, narrow gapped columns stop reading as terrain and start
    // reading as a picket fence of skyscrapers; a single smoothly
    // interpolated (massifRidgeHeight01), jaggedly roughened
    // (massifRidgeJagPx) skyline reads as one impossibly large mountain
    // RANGE instead, while the bass-builds-the-summit EQ shape survives
    // completely intact -- it's still exactly the same seven peaks, just
    // connected.
    const RIDGE_STEP_PX = 8;
    const ridgePts = [];
    for (let x = 0; x <= massifW; x += RIDGE_STEP_PX) {
      const u = x / massifW;
      ridgePts.push({ x: left + x, y: baseY - massifRidgeHeight01(bars, u) * maxH + massifRidgeJagPx(u) });
    }
    const lastX = ridgePts[ridgePts.length - 1].x;
    if (lastX < left + massifW - 0.01) {
      ridgePts.push({ x: left + massifW, y: baseY - massifRidgeHeight01(bars, 1) * maxH + massifRidgeJagPx(1) });
    }

    ctx.save();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(ridgePts[0].x, baseY);
    for (const p of ridgePts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(ridgePts[ridgePts.length - 1].x, baseY);
    ctx.closePath();
    ctx.fill();

    // The haze veil: a permanent wash sitting at a fixed altitude band near
    // the massif's own highest possible peak, thinning only during a rare
    // clearing. Real distant summits vanish into their own atmosphere long
    // before you'd ever reach one -- "can't quite see all of it, even now"
    // is itself doing scale work that raw height never could alone.
    const veilAlpha = 0.55 * (1 - clearing);
    if (veilAlpha > 0.01) {
      const skyRgb = hexToRgb(skyMid);
      const veilTopY = baseY - maxH;
      const veilBottomY = baseY - maxH * 0.45;
      // An elliptical (not rectangular) falloff -- a plain vertical-only
      // gradient inside a fillRect fades top-to-bottom but leaves the
      // rect's own left/right edges perfectly hard, which read as a
      // conspicuous straight-sided box floating in the sky. Radial gradient
      // + a non-uniform scale turns that same falloff into an ellipse that
      // fades on every side.
      const cx = left + massifW / 2;
      const cy = (veilTopY + veilBottomY) / 2;
      const ry = Math.max(1, (veilBottomY - veilTopY) / 2) * 1.15;
      const rx = massifW / 2 + 50;
      const sx = rx / ry;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, 1);
      const veil = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      veil.addColorStop(0, `rgba(${skyRgb.r},${skyRgb.g},${skyRgb.b},${veilAlpha.toFixed(3)})`);
      veil.addColorStop(1, `rgba(${skyRgb.r},${skyRgb.g},${skyRgb.b},0)`);
      ctx.fillStyle = veil;
      ctx.fillRect(-ry * 1.3, -ry * 1.3, ry * 2.6, ry * 2.6);
      ctx.restore();
    }

    // Soft massif crest cap — musical equalizer tell — traced along the
    // exact same ridge path so it never drifts off the silhouette it's
    // supposed to be capping.
    if (styleDials(this.visualStyle).massifCrestCaps !== false) {
      ctx.strokeStyle = cap;
      ctx.globalAlpha = 0.28 * (0.5 + 0.5 * this.budget);
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ridgePts[0].x, ridgePts[0].y);
      for (const p of ridgePts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    this._drawMassifMarkers(ctx, nowMs, left, massifW, baseY - maxH, baseY - maxH * 0.4);
  }

  /** Tiny, ordinary-parallax silhouettes drifting across the massif's face
   *  on a seeded timer (MountainChoreo.js's marker constants). This is the
   *  actual "occasionally perceived in a way that makes its raw size
   *  known" mechanic: a shape crossing in front of the massif at a normal,
   *  everyday speed, while the massif itself barely seems to move at all,
   *  IS the scale reveal -- the comparison does work no amount of raw
   *  height alone ever could. */
  _drawMassifMarkers(ctx, nowMs, left, massifW, topY, bottomY) {
    if (nowMs >= this._massifNextSpawnMs && massifW > 40) {
      this._massifMarkers.push({
        x0: left + this._massifRand() * massifW * 0.3,
        y: topY + this._massifRand() * Math.max(1, bottomY - topY),
        bornMs: nowMs,
      });
      this._massifNextSpawnMs = nowMs + nextMassifMarkerDelaySec(this._massifRand) * 1000;
    }
    if (!this._massifMarkers.length) return;
    ctx.save();
    ctx.fillStyle = 'rgba(6,6,12,0.6)';
    this._massifMarkers = this._massifMarkers.filter((m) => {
      const ageSec = (nowMs - m.bornMs) / 1000;
      if (ageSec > MASSIF_MARKER_LIFE_SEC) return false;
      const x = m.x0 + MASSIF_MARKER_SPEED_PX_S * ageSec;
      // Eases in and out of visibility rather than popping -- a hard cut at
      // either end would read as a glitch, not a distant bird/ship passing.
      const fade = Math.min(1, ageSec * 3) * Math.min(1, (MASSIF_MARKER_LIFE_SEC - ageSec) * 3);
      const wobble = Math.sin(ageSec * 3 + m.bornMs * 0.001) * 2;
      ctx.globalAlpha = 0.55 * fade;
      ctx.beginPath();
      ctx.moveTo(x, m.y + wobble);
      ctx.lineTo(x - 5, m.y + wobble + 2.2);
      ctx.lineTo(x - 5, m.y + wobble - 2.2);
      ctx.closePath();
      ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;
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

  /** Reused 1×W facing strip + W×falloff band for the ground relief. */
  _reliefBand(width) {
    const w = Math.max(1, width | 0);
    if (typeof document === 'undefined' || !document.createElement) return null;
    if (!this._reliefScratch || this._reliefScratch.w !== w) {
      const strip = document.createElement('canvas');
      strip.width = w;
      strip.height = 1;
      const band = document.createElement('canvas');
      band.width = w;
      band.height = RELIEF_FALLOFF_PX;
      this._reliefScratch = {
        w,
        strip,
        stripCtx: strip.getContext('2d', { willReadFrequently: true }),
        band,
        bandCtx: band.getContext('2d'),
      };
    }
    return this._reliefScratch;
  }

  /** Builds a smooth curve through each bar's top-center point -- the
   *  quadratic-midpoint technique (each segment's control point is the
   *  sample itself, its endpoint the midpoint to the next sample) turns the
   *  hard 90px staircase into a continuous ridge while the underlying
   *  physics (GroundField.heightAt) stays exactly the discrete spring
   *  simulation it always was; this is render-only. `closed` also draws the
   *  two side edges down to `canvas.height` and closes the path, for fills
   *  and clips; the open (stroke) form stops at the last top point. */
  _terrainTopPath(bars, canvasHeight, closed, canvasWidth = null) {
    const path = new Path2D();
    if (bars.length === 0) return path;
    const pts = bars.map((b) => ({ x: b.x + b.width / 2, y: b.y }));
    const lastBar = bars[bars.length - 1];
    const right = Number.isFinite(canvasWidth)
      ? Math.max(canvasWidth, lastBar.x + lastBar.width)
      : lastBar.x + lastBar.width;
    if (closed) path.moveTo(0, canvasHeight);
    if (closed) path.lineTo(pts[0].x, pts[0].y); else path.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const cur = pts[i], next = pts[i + 1];
      const midX = (cur.x + next.x) / 2, midY = (cur.y + next.y) / 2;
      path.quadraticCurveTo(cur.x, cur.y, midX, midY);
    }
    const lastPt = pts[pts.length - 1];
    path.lineTo(lastPt.x, lastPt.y);
    if (closed) {
      path.lineTo(right, lastPt.y);
      path.lineTo(right, canvasHeight);
      path.closePath();
    }
    return path;
  }

  /**
   * The inside of the ground. Everything below the crest used to be one
   * flat fillRect of a single color -- the terrain relief pass lit the top
   * ~14px and the rest of the frame's entire lower third was a poster-flat
   * slab, which is exactly as boring as it sounds and gave the eye nothing
   * to read the world's speed against.
   *
   * Two cheap passes, both clipped to the terrain path so they can never
   * spill into the sky:
   *  1. a vertical light falloff -- ground gets darker the deeper it goes,
   *     the same way any lit solid does, which alone kills the flat read;
   *  2. sparse seeded strata scrolling at world speed, so the ground has
   *     visible grain and you can actually see the land moving past.
   *
   * Strata are generated once per song and drawn as a handful of wavy
   * strokes, so this costs a fixed few draw calls regardless of scroll.
   */
  _drawGroundInterior(ctx, canvas, fillPath, bars, groundColor, worldX) {
    // Deliberately NOT gated on the perf ladder: every pass in here is a
    // fixed, small number of draw calls regardless of scroll or scene
    // complexity (a handful of strata strokes, a couple dozen root/ore
    // marks, one gradient fill), not a per-frame cost that scales with
    // load. It used to skip outright at the deepest perf rung, which meant
    // the ground went completely flat and textureless in exactly the
    // scenes heavy enough to trigger that rung -- the moment everything
    // ELSE on screen was busiest, the ground was blankest.
    let crest = canvas.height;
    for (const b of bars) if (b.y < crest) crest = b.y;
    const depth = canvas.height - crest;
    if (depth < 8) return;

    ctx.save();
    ctx.clip(fillPath);

    // 1. Soil horizon. The single most legible "this is ground, not a
    // colored region" cue: a crust of surface material hugging the terrain
    // contour with denser subsoil beneath it, exactly the topsoil/bedrock
    // boundary you see in any road cutting. Built by re-running the same
    // terrain path a fixed distance lower and filling everything below it
    // darker -- so the crust automatically follows every bump the ridge
    // has, for one extra path fill.
    const soilPx = Math.min(26, Math.max(9, depth * 0.06));
    const sunk = this._terrainTopPath(
      bars.map((b) => ({ ...b, y: b.y + soilPx })), canvas.height, true, canvas.width,
    );
    ctx.fillStyle = shiftLightness(groundColor, -0.07);
    ctx.fill(sunk);

    // 2. Strata. Drawn in WORLD space (phase driven by worldX) so they
    // travel with the terrain instead of sitting still on the screen --
    // that motion is the whole point, it's what makes the ground read as
    // ground being crossed rather than as a colored region.
    const strata = this._strata || (this._strata = this._buildStrata());
    ctx.lineCap = 'round';
    for (const s of strata) {
      const y = crest + soilPx + (depth - soilPx) * s.depth01;
      if (y > canvas.height + 4) continue;
      // Nearer-to-surface strata scroll slightly faster: a little internal
      // parallax inside the solid, so it has thickness rather than being
      // one sheet of wallpaper.
      const sx = worldX * (0.85 + 0.3 * (1 - s.depth01));
      ctx.strokeStyle = s.light ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
      ctx.globalAlpha = s.alpha;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 16) {
        const yy = y + Math.sin((x + sx) / s.wavelength + s.phase) * s.amp
          + Math.sin((x + sx) / (s.wavelength * 0.37) + s.phase * 1.7) * s.amp * 0.45;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 3. Roots and ore: persistent dressing so the band has something in it
    // beyond flat dirt and Broshi's occasional cave. Both are seeded once
    // per song and drawn in WORLD space like the strata above, so they
    // scroll with the terrain instead of sitting pinned to the screen.
    this._drawRoots(ctx, canvas, crest, depth, worldX);
    this._drawOreFlecks(ctx, canvas, crest, depth, worldX);

    // 4. Light falls off with depth into the solid -- drawn LAST so it
    // sinks everything above into the dark with distance from the surface.
    // Recedes toward an unlit lower band, but the surface (where the trio
    // actually stands) stays a real, lit material -- going to true black
    // by ~55% of the band made the footing under the characters read as
    // void, which is the opposite of "the ground catches the light".
    const grad = ctx.createLinearGradient(0, crest, 0, canvas.height);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.38, shiftLightness(groundColor, -0.10));
    grad.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, crest, canvas.width, depth);
    ctx.restore();
  }

  /** Seeded root definitions -- fixed per song. Each is a short, tapering,
   *  gently forking tendril hanging from a point on the soil horizon,
   *  reading as the underside of surface foliage rather than anything
   *  planted at generation time (there's no per-plant correlation --
   *  purely ambient texture, cheap because it's baked once). */
  _buildRoots() {
    const rand = mulberry32(hashSeed(`${this.songSeed}:roots`));
    const out = [];
    const SPAN = 2400; // world-x period the pattern repeats over
    const COUNT = 22;
    for (let i = 0; i < COUNT; i++) {
      out.push({
        worldX: rand() * SPAN,
        len: 14 + rand() * 34,
        lean: (rand() - 0.5) * 0.6,
        forkAt: 0.4 + rand() * 0.4,
        forkLen: 8 + rand() * 16,
        forkSide: rand() < 0.5 ? -1 : 1,
        width: 1.1 + rand() * 1.3,
      });
    }
    return { span: SPAN, roots: out };
  }

  _drawRoots(ctx, canvas, crest, depth, worldX) {
    const { span, roots } = this._roots || (this._roots = this._buildRoots());
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineCap = 'round';
    const phase = worldX % span;
    for (let rep = -1; rep <= Math.ceil(canvas.width / span) + 1; rep++) {
      for (const r of roots) {
        const x = r.worldX + rep * span - phase;
        if (x < -20 || x > canvas.width + 20) continue;
        const reach = Math.min(r.len, depth * 0.7);
        if (reach < 6) continue;
        ctx.lineWidth = r.width;
        ctx.beginPath();
        ctx.moveTo(x, crest);
        const midX = x + r.lean * reach;
        const midY = crest + reach * r.forkAt;
        ctx.lineTo(midX, midY);
        ctx.lineTo(midX + r.lean * (reach - reach * r.forkAt), crest + reach);
        ctx.stroke();
        // A short fork off the main tendril -- keeps it reading as roots,
        // not a single straight scratch.
        ctx.beginPath();
        ctx.moveTo(midX, midY);
        ctx.lineTo(midX + r.forkSide * r.forkLen * 0.6, midY + r.forkLen);
        ctx.stroke();
      }
    }
  }

  /** Seeded ore-fleck definitions -- small glints buried in the soil,
   *  reacting faintly to the melody band like the strata's light passes
   *  already do elsewhere in this class, so the band never reads as fully
   *  inert even between cave events. */
  _buildOreFlecks() {
    const rand = mulberry32(hashSeed(`${this.songSeed}:ore`));
    const out = [];
    const SPAN = 1800;
    const COUNT = 14;
    const HUES = ['#ffe08a', '#8ad9ff', '#c9a4ff'];
    for (let i = 0; i < COUNT; i++) {
      out.push({
        worldX: rand() * SPAN,
        depth01: 0.15 + rand() * 0.75,
        r: 1.4 + rand() * 2.2,
        color: HUES[(rand() * HUES.length) | 0],
        phase: rand() * Math.PI * 2,
      });
    }
    return { span: SPAN, flecks: out };
  }

  _drawOreFlecks(ctx, canvas, crest, depth, worldX) {
    const { span, flecks } = this._oreFlecks || (this._oreFlecks = this._buildOreFlecks());
    const phase = worldX % span;
    const nowMs = this.tSec * 1000;
    for (let rep = -1; rep <= Math.ceil(canvas.width / span) + 1; rep++) {
      for (const f of flecks) {
        const x = f.worldX + rep * span - phase;
        if (x < -6 || x > canvas.width + 6) continue;
        const y = crest + depth * f.depth01;
        if (y > canvas.height - 4) continue;
        const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(nowMs / 900 + f.phase));
        ctx.globalAlpha = 0.5 * twinkle;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(x, y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Seeded strata definitions -- fixed per song, so the same seed always
   *  produces the same ground grain (a replay can be pointed at). */
  _buildStrata() {
    const rand = mulberry32(hashSeed(`${this.songSeed}:strata`));
    const out = [];
    const COUNT = 9;
    for (let i = 0; i < COUNT; i++) {
      // Bias toward the upper half of the solid: that's the part actually
      // on screen most of the time, and real bedding planes crowd nearer
      // the surface rather than spreading evenly to the core.
      const d = Math.pow(rand(), 1.6);
      out.push({
        depth01: 0.04 + d * 0.94,
        // Short enough to visibly undulate across a 1280px frame -- long
        // wavelengths read as dead straight scratches, not bedding planes.
        wavelength: 150 + rand() * 260,
        amp: 4 + rand() * 16,
        phase: rand() * Math.PI * 2,
        width: 1.4 + rand() * 3.2,
        // A few pale bedding planes among mostly dark ones -- pure dark
        // strata on a dark ground read as smudges, the light ones are what
        // actually make the layering legible.
        light: rand() < 0.34,
        alpha: 0.09 + rand() * 0.11,
      });
    }
    return out.sort((a, b) => a.depth01 - b.depth01);
  }

  _drawGround(ctx, canvas, worldX, originX, A, B, t, mountainTint = null) {
    // Match the mountains' own contrast-corrected tint when it's handed in
    // (draw()'s per-frame guard against a dark palette washing out at
    // night) rather than re-deriving the raw, uncorrected silhouette --
    // otherwise the ground could end up *less* legible than the range it's
    // standing in front of.
    const groundColorRaw = mountainTint ?? this._rotated(this.lerpCache.get(A.silhouette, B.silhouette, t));
    // Lifted a touch *lighter* than the nearest range -- not darker -- so
    // the ground always keeps an edge (previously the one silhouette-tinted
    // element skipping the key/section hue rotation entirely) and, just as
    // important, so it has headroom to survive the film-finish vignette and
    // fog wash still to come: those only ever push toward black, and the
    // ground sits in their darkest (bottom, off-center) reach. A color that
    // starts already dark has nothing left once they're through with it.
    // ...and then floored outright. The relative lift alone is not enough:
    // +0.14 from a near-black silhouette (CYBER, LUMEN, STORM, ABYSS all sit
    // under 0.10 lightness) is still near-black, and under a bright ocean
    // that reads as no ground at all -- just void below the water. The floor
    // is what makes "there is ground here" true on every palette rather than
    // only on the ones that started bright.
    const groundColor = ensureMinLightness(
      shiftLightness(groundColorRaw, 0.14),
      GROUND_MIN_LIGHTNESS,
    );
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
      // in the background. Rendered as one continuous smoothed ridge (see
      // _terrainTopPath) rather than per-slice rects.
      const bars = this.groundField.visibleBars(worldX, originX, canvas.width);
      const fillPath = this._terrainTopPath(bars, canvas.height, true, canvas.width);
      const strokePath = this._terrainTopPath(bars, canvas.height, false, canvas.width);
      ctx.fillStyle = groundColor;
      ctx.fill(fillPath);
      // Aerial perspective for the ground.
      //
      // Every range got this in Stage 3 of the mountain overhaul; the ground
      // never did, so it stayed ONE flat color from the horizon line all the
      // way to the bottom of the frame -- the single biggest reason it reads
      // as a sheet of construction paper laid under the scene rather than as
      // land receding away from you. It is also the largest continuous area
      // on screen, so it is where a missing depth cue costs the most.
      //
      // Same vocabulary as _drawRidgeVolume's aerial pass: wash the FAR edge
      // (the top, where the ground meets the ranges) toward this._airColor,
      // and leave the near edge alone at full color. Runs before
      // _drawGroundInterior so the interior detail still reads on top of it.
      if (this._airColor && bars.length) {
        let minTop = canvas.height;
        for (const bar of bars) if (bar.y < minTop) minTop = bar.y;
        const near = Math.max(minTop + 1, canvas.height);
        const { r: ar, g: ag, b: ab } = hexToRgb(this._airColor);
        const depth = ctx.createLinearGradient(0, minTop, 0, near);
        depth.addColorStop(0, `rgba(${ar},${ag},${ab},${GROUND_AERIAL_ALPHA})`);
        depth.addColorStop(GROUND_AERIAL_FALLOFF, `rgba(${ar},${ag},${ab},0)`);
        depth.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = depth;
        ctx.fill(fillPath);
      }
      this._drawGroundInterior(ctx, canvas, fillPath, bars, groundColor, worldX);

      // Terrain relief: clip to the ridge and stamp a 1px-tall facing
      // strip, stretched and faded with depth. A per-pixel strip cannot
      // grow a hard vertical cut the way a many-stop CanvasGradient can
      // when neighbouring stops collapse. Gated on rimLightEnabled; omit
      // the light and this is a no-op (byte-identical to the flat fill).
      const rimOn = this._perf ? this._perf.rimLightEnabled : true;
      const reliefSamples = (rimOn && this.light)
        ? sampleTerrainCurve(bars)
        : null;
      const facing = reliefSamples ? curveFacing(reliefSamples, this.light) : null;
      if (facing && facing.some((f) => Math.abs(f) > 0.01)) {
        ctx.save();
        ctx.clip(fillPath);
        let minTop = canvas.height;
        for (const bar of bars) if (bar.y < minTop) minTop = bar.y;
        const band = this._reliefBand(canvas.width);
        if (band) {
          // Lit and shade are two separate strips now, not one combined
          // pass: they need different final composite operations onto
          // the real canvas (a warm-white catch-light adds brightness
          // under the default source-over; the shade half needs
          // 'multiply' for genuine occlusion -- see reliefShadeStripRGBA).
          // Same strip+band scratch buffers, reused sequentially for each.
          const bctx = band.bandCtx;
          const paintBand = (rgba, finalComposite) => {
            band.stripCtx.putImageData(new ImageData(rgba, canvas.width, 1), 0, 0);
            bctx.setTransform(1, 0, 0, 1, 0, 0);
            bctx.clearRect(0, 0, band.band.width, band.band.height);
            bctx.globalCompositeOperation = 'source-over';
            bctx.drawImage(band.strip, 0, 0, canvas.width, RELIEF_FALLOFF_PX);
            bctx.globalCompositeOperation = 'destination-in';
            const fade = bctx.createLinearGradient(0, 0, 0, RELIEF_FALLOFF_PX);
            fade.addColorStop(0, 'rgba(0,0,0,1)');
            fade.addColorStop(1, 'rgba(0,0,0,0)');
            bctx.fillStyle = fade;
            bctx.fillRect(0, 0, canvas.width, RELIEF_FALLOFF_PX);
            ctx.globalCompositeOperation = finalComposite;
            ctx.drawImage(band.band, 0, minTop);
          };
          paintBand(reliefLitStripRGBA(reliefSamples, facing, canvas.width), 'source-over');
          paintBand(reliefShadeStripRGBA(reliefSamples, facing, canvas.width), 'multiply');
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
      }

      const haloColor = this._rotated(this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
      const { r, g, b } = hexToRgb(haloColor);
      const rgb = `${r},${g},${b}`;

      // Soft groove cap: music-terrain tell, soft alpha so it reads as
      // energy riding the land — not a cyan hairline glitch. A thick stroke
      // along the same ridge curve rather than a per-bar rect.
      const grooveNow = bars.length ? bars[0].groove || 0 : 0;
      const wantGroundCaps = styleDials(this.visualStyle).groundCrestCaps !== false;
      if (grooveNow > 0.05 && wantGroundCaps) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const a = 0.16 * grooveNow;
        ctx.strokeStyle = `rgba(${rgb},${capFlashAlpha(a, this.reducedFlash)})`;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.stroke(strokePath);
        ctx.restore();
      }

      // Settled snow: a frost cap riding the ridge -- a pale band whose
      // thickness grows with cover, plus seeded glints so ice reads as ICE
      // (slippery, see Traction.js) rather than just pale paint. Melts to
      // zero cost the moment cover does.
      if ((this.snowCover || 0) > 0.03) {
        const cover = this.snowCover;
        ctx.save();
        ctx.strokeStyle = `rgba(230,242,255,${(0.34 * cover).toFixed(3)})`;
        ctx.lineWidth = 4 + 9 * cover;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(strokePath);
        // Specular glints: a few bar-top points catch the light each moment,
        // drifting with world scroll so the sheen slides underfoot.
        const glints = [];
        for (const bar of bars) {
          const glint = 0.5 + 0.5 * Math.sin(bar.x * 0.13 + worldX * 0.011 + this.tSec * 1.7);
          if (glint > 0.86) glints.push([bar, 0.30 * cover * (glint - 0.86) / 0.14]);
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#fff';
        for (const [bar, a] of glints) {
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.arc(bar.x + bar.width / 2, bar.y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
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
          // An elliptical falloff centered on the bar, not a rect filled with
          // a vertical-only gradient -- the old version faded top-to-bottom
          // but left the bar's own width as a hard-edged box (flat top, hard
          // left/right sides) sitting right on the ground line every time a
          // kick pulse raced through, exactly the "straight lined box" /
          // "hard cutoff" artifact this fades away on every side instead.
          const cx = bar.x + bar.width / 2, cy = bar.y;
          const ry = rimH;
          const rx = bar.width / 2 + 6;
          const sx = rx / ry;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(sx, 1);
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
          grad.addColorStop(0, `rgba(${rgb},${alpha})`);
          grad.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, ry, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }

      // Gray-Scott texture living inside the ground: clip to the ridge's
      // silhouette (one smooth Path2D, not a union of per-slice rects) so
      // the pattern rides the terrain's own vertical motion. Purely
      // decorative texture over the flat fill above it, so the deepest perf
      // rung skips it outright rather than clip+draw for nothing.
      if (!this._perf || this._perf.phenomenaFull) {
        let minTop = canvas.height;
        for (const bar of bars) if (bar.y < minTop) minTop = bar.y;
        ctx.save();
        ctx.clip(fillPath);
        this.rd.draw(ctx, canvas, worldX, minTop);
        ctx.restore();
      }

      if (facing) {
        // Crest catch: today's 0.18 stroke, one smoothed path, alpha
        // modulated along the same horizontal gradient the body uses.
        // A single stroke of `strokePath` keeps the rim on the ridge
        // it belongs to, instead of N straight segments between bar
        // centres that don't match the quadratic fill.
        const crestStops = facingColorStops(
          reliefSamples, facing, 0, canvas.width, 'crest',
        );
        if (crestStops.length >= 2) {
          const crest = ctx.createLinearGradient(0, 0, canvas.width, 0);
          for (const s of crestStops) crest.addColorStop(s.offset, s.color);
          ctx.strokeStyle = crest;
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        }
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(strokePath);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke(strokePath);
      }
    } else {
      ctx.fillStyle = groundColor;
      ctx.fillRect(0, localGroundY, canvas.width, canvas.height - localGroundY);
    }

    if (activeFx === 'neonGrid') this._drawNeonGrid(ctx, canvas, worldX, localGroundY);
    else if (activeFx === 'canopyDapple') this._drawCanopyDapple(ctx, canvas, localGroundY);
    else if (activeFx === 'glitchTear' && this._glitchActiveMs > 0) this._drawGlitchTear(ctx, canvas);
    else if (activeFx === 'petalPile') this._drawPetalPiles(ctx, canvas, worldX, localGroundY, t > 0.5 ? B : A);
    else if (activeFx === 'mirage') this._drawMirage(ctx, canvas, worldX, localGroundY);
    else if (isLake) this._drawLakeReflection(ctx, canvas, localGroundY);
    // Remembered for drawCharacterReflections: Renderer calls that AFTER the
    // trio draws (their live screen positions aren't known this early), but
    // only the lake band -- and only THIS frame's ground line -- is a valid
    // surface to reflect them into.
    this._lakeReflectGroundY = isLake ? localGroundY : null;
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
    // `canvas` is draw()'s LOGICAL stage view -- a plain {width, height},
    // not a drawable. Passing it to drawImage threw on every frame MIRROR
    // was on screen, and since _drawGround runs near the END of the world
    // draw, the swallowed throw took every character, the HUD, bloom and the
    // film finish with it. Source the real backing store; destination stays
    // in logical units because we are under the sx/sy transform.
    ctx.drawImage(ctx.canvas, 0, 0, canvas.width, canvas.height);
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
    // Backing store may be 1x-4x the logical stage (stage-resolution preset).
    const dpr = ctx.canvas.height / Math.max(1, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, groundY, canvas.width, lakeHeight);
    ctx.clip();
    for (let row = 0, i = 0; row < lakeHeight; row += step, i++) {
      const theta = (i / SLICES) * Math.PI * 2;
      const offset = this.lakeRing.displacementAt(theta) * 3;
      if (Math.abs(offset) < 0.05) continue;
      // Source rect is in DEVICE pixels (it indexes the backing store);
      // destination stays logical. Same distinction as the mirror blit above.
      ctx.drawImage(ctx.canvas,
        0, (groundY + row) * dpr, ctx.canvas.width, step * dpr,
        offset, groundY + row, canvas.width, step);
    }
    ctx.restore();
  }

  /** Faint character reflections in the Mirror lake (Movement IV): the sky
   *  and terrain already reflect for free (see _drawLakeReflection above),
   *  but that pass runs before the trio is drawn, so it can never pick them
   *  up from the backing store the way it does everything else. Called by
   *  Renderer right after the trio draws, when their live screen positions
   *  and hues are finally known -- a soft color-matched glow standing in for
   *  each present character, not a full mirrored sprite (there's no cheap
   *  way to re-render their mesh a second time, and a colored echo already
   *  reads as "reflected" against the rippling water beneath it).
   *  `entries`: [{x, hue, active}] in screen space; inactive entries
   *  (burrowed, voyaging) are skipped so nothing reflects a performer who
   *  isn't actually standing on the shore. */
  drawCharacterReflections(ctx, canvas, entries) {
    const groundY = this._lakeReflectGroundY;
    if (groundY == null) return;
    const lakeHeight = canvas.height - groundY;
    if (lakeHeight <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, groundY, canvas.width, lakeHeight);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of entries) {
      if (!e || !e.active || !Number.isFinite(e.x)) continue;
      // Same ring the water ripples borrow from _drawLakeReflection, sampled
      // at this character's own horizontal position so their reflection
      // wobbles in sync with the water right under them, not in lockstep
      // with everyone else's.
      const theta = ((e.x / canvas.width) % 1 + 1) * Math.PI * 2;
      const ripple = this.lakeRing.displacementAt(theta) * 3;
      const grad = ctx.createLinearGradient(0, groundY, 0, groundY + 74);
      grad.addColorStop(0, `hsla(${e.hue}, 70%, 68%, 0.28)`);
      grad.addColorStop(1, `hsla(${e.hue}, 70%, 68%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(e.x + ripple, groundY + 30, 18, 30, 0, 0, Math.PI * 2);
      ctx.fill();
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
   *  plus any petals actively shedding off the piles right now.
   *  (Was one giant half-ellipse per pile — read as hamburger buns under the ridge.) */
  _drawPetalPiles(ctx, canvas, worldX, groundY, profile) {
    ctx.save();
    ctx.fillStyle = profile.particles.color;
    const spacing = 300;
    for (let i = 0; i < 6; i++) {
      const x = ((i * spacing - worldX) % (canvas.width + spacing) + canvas.width + spacing) % (canvas.width + spacing) - spacing / 2;
      const breathe = 0.8 + 0.2 * Math.sin(this.tSec * 0.5 + i * 2.1);
      // Small stacked petal flecks on the ground line — not a dome under the cliff.
      const n = 5 + (i % 3);
      for (let k = 0; k < n; k++) {
        const ox = (k - (n - 1) / 2) * 7 + Math.sin(i * 1.7 + k) * 2;
        const oy = -2 - (k % 3) * 1.6;
        const rw = 5 + (k % 3) * 1.4;
        const rh = 2.2 + (k % 2) * 0.6;
        ctx.globalAlpha = 0.18 * breathe * (0.7 + 0.3 * ((k + i) % 3) / 2);
        ctx.beginPath();
        ctx.ellipse(x + ox, groundY + oy, rw, rh, (k - 2) * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
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

  /** DUNE's desert mirage: a faint, wavering duplicate of the horizon
   *  hovering just above the sand -- distinct from heatShimmer's ridge-slice
   *  distortion, since it reads as a false-water illusion sitting on the
   *  ground rather than a haze over distant terrain. */
  _drawMirage(ctx, canvas, worldX, groundY) {
    const bandH = Math.min(26, canvas.height - groundY);
    if (bandH <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, groundY - bandH, canvas.width, bandH);
    ctx.clip();
    ctx.globalAlpha = 0.22;
    ctx.translate(0, 2 * (groundY - bandH));
    ctx.scale(1, -1);
    // Same logical-view-vs-drawable fix as the lake reflection. This one is
    // currently unreachable -- no profile emits fx:'mirage' -- but it would
    // have thrown the instant one did, so it is corrected rather than left
    // as a trap for whoever wires DUNE's mirage up.
    ctx.drawImage(ctx.canvas, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,235,190,0.25)';
    ctx.lineWidth = 2;
    const waveOffset = worldX * 0.02;
    for (let row = 0; row < bandH; row += 6) {
      const y = groundY - bandH + row;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 10) {
        const yy = y + Math.sin(x * 0.05 + this.tSec * 2 + waveOffset) * 2;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
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
