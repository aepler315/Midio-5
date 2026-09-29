// Range v2: the one presentation adapter allowed to read the simulation
// (plan §7.2). It assembles an immutable RangeFrame -- time, assigned
// views, rail progress, viewports, light, music, support bars and emitters
// -- before anything draws, so GPU/material/forest/water modules never
// reach back into mutable state and the same instant always yields the
// same snapshot (forward seek, backward seek, pause, repeated draws).
import { sceneProgressAt, SCENE_PREVIEW_PROGRESS } from '../terrain/SceneTravel.js';
import { ridgeKickEnv } from '../MountainChoreo.js';
import { dayNight, celestialYFracFor, celestialXFracFor } from '../DayNight.js';
import { MIDIO_IDENTITY_HUE } from '../../render/ColorLaw.js';

const NIGHT_SKY = '#05060d';

function freezeDeep(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) freezeDeep(v);
  }
  return o;
}

/** A viewport's logical size, backing size, overscan and the six-number
 *  Canvas affine transform (a, b, c, d, e, f) in effect when it is drawn. */
export function viewportState({ logicalWidth, logicalHeight, backingWidth, backingHeight, overscanPx = 0,
  transform = [1, 0, 0, 1, 0, 0], nominalWidth = logicalWidth, nominalHeight = logicalHeight, pixelRatio = 1 }) {
  return { logicalWidth, logicalHeight, backingWidth, backingHeight, overscanPx, transform: [...transform], nominalWidth, nominalHeight, pixelRatio };
}

/**
 * The shared musical terrain deformation, metres of vertical offset at
 * local (x, z) with height `y`, for a RangeMusicState and the view's height
 * range. Mesh vertices (GLSL twin in TerrainGL) and rooted objects (forest,
 * water) evaluate this same function at the same source coordinates, so
 * everything attached to the surface moves with it. Bounded by
 * music.amplitudeM + music.kickM at the highest terrain; valleys stay put.
 */
export function sceneDeformation(music, x, z, y, heightRange) {
  if (!music || !(music.amplitudeM > 0 || music.kickM > 0)) return 0;
  const span = Math.max(1, heightRange[1] - heightRange[0]);
  const h01 = Math.min(1, Math.max(0, (y - heightRange[0]) / span));
  const lift = h01 * h01; // peaks move, valley floors and lakes hold still
  const along = x * music.waveDir[0] + z * music.waveDir[1];
  const swell = Math.sin(along * music.waveK - music.phaseRad);
  return lift * (music.amplitudeM * swell + music.kickM);
}

/** RangeMusicState from the Range's existing musical envelope (Ridge.js)
 *  and the ridge kick. Pure in heard time: phase is time-derived, never
 *  integrated, so a seek reconstructs it exactly and a pause (heard time
 *  held) holds every environmental motion still. */
export function rangeMusicState({ env = null, tSec = 0, kickAgeMs = Infinity, kickAmp = 0, reducedFlash = false } = {}) {
  const groove = env?.groove ?? 0;
  const sustain = env?.sustain ?? 0;
  const scaleMul = env?.scaleMul ?? 1;
  const kickMul = env?.kickMul ?? 0;
  const kick01 = Number.isFinite(kickAgeMs) ? ridgeKickEnv(kickAgeMs) * kickAmp * kickMul : 0;
  const flash = reducedFlash ? 0.5 : 1;
  return {
    groove, sustain, scaleMul, kickMul, gesture: env?.gesture ?? 0, kick01,
    // Metres at the highest terrain: a breathing swell, lifted by sustained
    // bass and earned phrase scale, plus a kick bounce.
    amplitudeM: (6 + 26 * groove * (0.4 + 0.6 * sustain)) * scaleMul * flash,
    kickM: 18 * kick01 * flash,
    waveK: (2 * Math.PI) / 3200,
    waveDir: [0.8, -0.6],
    phaseRad: 2 * Math.PI * 0.07 * tSec,
  };
}

/** Sky colours the scene's atmosphere must agree with (same stops and
 *  night pull as BiomeManager._drawSky's three-stop case). */
function skyState(mgr, A, B, t, night) {
  const pull = 0.62 * night;
  const stop = (i, k) => {
    const c = mgr._rotated(mgr.lerpCache.get(A.sky[i], B.sky[i], t));
    return pull * k > 0.02 ? mgr.lerpCache.get(c, NIGHT_SKY, pull * k) : c;
  };
  return { top: stop(0, 1), mid: stop(1, 0.75), horizon: stop(2, 0.45), air: mgr._airColor || stop(2, 0.45) };
}

/**
 * Assemble the frame snapshot.
 *   frameId, generation   renderer frame counter and load generation
 *   sim                   the Simulation (read here and nowhere else)
 *   pose                  sim.lerpState(alpha) for this frame
 *   scenicViewport, groundViewport   viewportState() records
 *   sceneAssignments      Map biome -> SceneChoice (song terrain)
 *   forcedView            optional diagnostic SceneChoice for every biome
 */
export function buildRangeFrame({
  frameId, generation = 0, sim, pose, scenicViewport, groundViewport, sceneAssignments = null, forcedView = null,
}) {
  const mgr = sim.biomes;
  const blend = mgr.currentBlend || { from: mgr.sections?.[0]?.profile, to: mgr.sections?.[0]?.profile, t: 1 };
  const nameOf = (p) => (typeof p === 'string' ? p : p?.name ?? null);
  const biomeFrom = nameOf(blend.from), biomeTo = nameOf(blend.to);
  const choice = (b) => forcedView || sceneAssignments?.get?.(b) || null;
  const timeMs = (mgr.tSec || 0) * 1000;
  const reducedFlash = !!mgr.reducedFlash;
  const progress01 = mgr.terrainPreview ? SCENE_PREVIEW_PROGRESS : sceneProgressAt({
    timeMs, curves: mgr.energyCurves, durationMs: mgr.durationMs, reducedFlash, response: mgr.world?.response,
  });
  const dn = dayNight(timeMs, mgr._dayNightCycleMs);
  const sunUp = dn.sunAlt > 0.001;
  const A = mgr._profile(blend.from), B = mgr._profile(blend.to);
  const t = blend.t ?? 1;
  const light = mgr.light || null;
  const lightState = {
    space: 'scenic-stage logical px (the zoomed transform); celestial fractions of the scenic stage',
    celestial: {
      body: sunUp ? 'sun' : 'moon',
      xFrac: celestialXFracFor(sunUp ? dn.sunAz01 : dn.moonAz01),
      yFrac: celestialYFracFor(sunUp ? dn.sunAlt : dn.moonAlt),
      altitude01: sunUp ? dn.sunAlt : dn.moonAlt,
      colorHex: light?.colorHex ?? '#ffffff',
      intensity: light?.intensity ?? 1,
    },
    night01: dn.night || 0, dawn01: dn.dawnAlpha || 0, dusk01: dn.duskAlpha || 0,
    sky: A && B ? skyState(mgr, A, B, t, dn.night || 0) : null,
  };
  const env = typeof mgr._ridgeEnvelope === 'function' ? mgr._ridgeEnvelope() : null;
  const music = rangeMusicState({
    env, tSec: mgr.tSec || 0, kickAgeMs: timeMs - (mgr._danceKickMs ?? -Infinity), kickAmp: mgr._danceKickAmp || 0,
    reducedFlash,
  });
  // Support curve exactly as the ground painter receives it (render-only
  // ripple/groove/quake included); physics heightAt() is not consulted.
  const gf = mgr.groundField;
  const groundWidth = groundViewport?.logicalWidth ?? sim.stageW ?? 1280;
  const groundBars = gf ? gf.visibleBars(pose.worldX, pose.midioX, groundWidth).map((b) => ({
    x: b.x, width: b.width, y: b.y, glow: b.glow || 0,
  })) : [];
  const emitters = [];
  if (sim.midio) {
    emitters.push({ id: 'midio', x: pose.midioDrawX, y: pose.midioY, hue: MIDIO_IDENTITY_HUE, visible: true,
      supportY: sim.midio.groundY, airborneM: Math.max(0, sim.midio.groundY - pose.midioY) });
  }
  if (sim.broshi) {
    const b = sim.broshi;
    emitters.push({ id: 'broshi', x: b.renderX, y: b.groundY - (b.hopY || 0), hue: b.hue, visible: b.burrow.depth <= 0.02,
      supportY: b.groundY, airborneM: Math.max(0, b.hopY || 0), burrowed: b.burrow.depth > 0.02 });
  }
  if (sim.midasus) {
    const m = sim.midasus;
    emitters.push({ id: 'midasus', x: m.p.x, y: m.p.y, hue: m.hue, visible: m.voyage.depth <= 0,
      supportY: m.yFloor, airborneM: Math.max(0, m.yFloor - m.p.y), voyaging: m.voyage.depth > 0 });
  }
  const from = choice(biomeFrom), to = choice(biomeTo);
  return freezeDeep({
    frameId, generation, timeMs, seed: sim.songSeed ?? 0,
    biomeFrom, biomeTo, transition01: t,
    viewFromId: from?.view?.id ?? null, viewToId: to?.view?.id ?? null,
    forcedCandidate: !!forcedView?.forcedCandidate,
    progress01, qualityLevel: sim.perf?.level ?? 0, reducedFlash,
    scenicViewport, groundViewport,
    light: lightState, music, groundBars, emitters,
    // World anchoring for fixed-ground dressing (rock stage, pools).
    worldX: pose.worldX, originX: pose.midioX,
  });
}
