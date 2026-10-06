// Traveling residents of the imagined valley. Everything is sampled from
// heard time, including foot plants; no frame accumulator survives a seek.
import { sampleJourneyState, journeyNearShore, journeyFarShore, journeyGroundHeight } from './JourneyWorld.js';

const IDS = ['midio', 'broshi', 'midasus'];
const TAU = Math.PI * 2;
const STEP_SEC = .96, STANCE = .62;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const unit = value => Math.max(0, Math.min(1, finite(value)));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const JOURNEY_CAST_LAYOUT = freeze({
  id: 'journey-cast', waterLevelM: 0,
  right: [1, 0, 0], forward: [0, 0, -1],
  anchors: { midio: [-65, 0, 0], broshi: [-192, 5, 236], midasus: [194, 90, -25] },
  heights: { midio: 34, broshi: 45, midasus: 30 },
  dressing: {},
});

// The odd extension is only used by the first foot plant, just before t=0.
// Reading the world's clock keeps foot contact tied to its actual scroll.
function travelAt(t) {
  return Math.sign(t) * sampleJourneyState({ timeMs: Math.abs(t) * 1000 }).travelM;
}

function walkerRoot(t, state) {
  const x = -178 + 100 * Math.sin(.21 * t - .14);
  const z = journeyNearShore(x, state) + 46 + 8 * Math.sin(.37 * t + .8);
  return [x, journeyGroundHeight(x, z, state), z];
}

function swimmerRoot(t, state, activity = 0, pulse = 0) {
  const x = 145 * Math.sin(.32 * t - .48) + 12 * Math.sin(.74 * t + .2);
  const desiredZ = -12 + 28 * Math.sin(.24 * t + .4);
  // The normal path is far from both bounds; the margins remain explicit
  // because the same shore field evolves as the camera crosses the valley.
  const z = Math.max(journeyFarShore(x, state) + 45,
    Math.min(journeyNearShore(x, state) - 45, desiredZ));
  return [x, -.6 + .65 * Math.sin(.91 * t) + activity * (.45 * Math.sin(1.45 * t) - .7 * pulse), z];
}

function sourceReading(id, music) {
  const reading = music?.sources?.[id] || {};
  const activity = unit(reading.activity);
  const pitchActivity = Math.min(activity, unit(reading.pitchActivity));
  return { activity, pitchActivity, pitch01: pitchActivity > 0 ? unit(reading.pitch01) : .5,
    source: reading.source ?? null,
    sharedSource: reading.source != null && IDS.some(other => other !== id && music?.sources?.[other]?.source === reading.source),
    contributors: (reading.contributors || []).map(contributor => {
      const activity = unit(contributor.activity), pitchActivity = Math.min(activity, unit(contributor.pitchActivity));
      return { source: contributor.source ?? null, activity, pitchActivity,
        pitch01: pitchActivity > 0 ? unit(contributor.pitch01) : .5 };
    }),
  };
}

/** A foot stays at the same world x/z during stance. During swing it travels
 * between the previous and next plant with zero velocity at both endpoints.
 * Ground height is evaluated at each actual foot, not just the body root. */
function walkingFeet(t, root, turn, state, stateAt, headingAt) {
  const height = JOURNEY_CAST_LAYOUT.heights.broshi;
  const c = Math.cos(turn), s = Math.sin(turn);
  return [9, -13].map((base, index) => {
    base *= height / 34;
    const phase = ((t / STEP_SEC + index * .5) % 1 + 1) % 1;
    const start = t - phase * STEP_SEC;
    const place = at => {
      const atState = stateAt(at), p = walkerRoot(at, atState), yaw = headingAt(at);
      return [p[0] + atState.travelM + base * Math.cos(yaw), p[2] - base * Math.sin(yaw)];
    };
    const first = place(start + STEP_SEC * STANCE * .5);
    let target = first, lift = 0;
    if (phase > STANCE) {
      const swing = (phase - STANCE) / (1 - STANCE);
      const next = place(start + STEP_SEC * (1 + STANCE * .5));
      target = first.map((value, axis) => mix(value, next[axis], smooth(swing)));
      lift = 6.8 * Math.sin(Math.PI * swing) ** 2;
    }
    const x = target[0] - state.travelM, z = target[1];
    const dx = x - root[0], dz = z - root[2];
    return [c * dx - s * dz - base,
      journeyGroundHeight(x, z, state) - root[1] + lift, -s * dx - c * dz];
  });
}

/** CoveGL-compatible poses plus a lake wake receiver. Source values already
 * have causal inertia: no physical-audibility gate or live-value phase is
 * applied here. Reduced flash changes only emission. */
export function sampleJourneyCast({ timeMs = 0, state = null, music = null,
  reducedMotion = false, reducedFlash = false } = {}) {
  timeMs = Math.max(0, finite(timeMs));
  reducedMotion = !!reducedMotion;
  reducedFlash = !!reducedFlash;
  const t = reducedMotion ? 0 : timeMs / 1000;
  state = reducedMotion ? sampleJourneyState({ seed: state?.seed, reducedMotion: true })
    : state || sampleJourneyState({ timeMs, music });
  const energy = unit(music?.energy01 ?? state.energy);
  const bass = unit(music?.bass01 ?? state.bass), melody = unit(music?.melody01 ?? state.melody);
  const pulse = unit(music?.pulse01 ?? state.pulse);
  const flash = reducedFlash ? .2 : 1;
  const clock = travelAt(t);
  const stateAt = at => ({ ...state, timeSec: at, travelM: state.travelM + travelAt(at) - clock });
  const headingAt = at => {
    const before = walkerRoot(at - .025, stateAt(at - .025));
    const after = walkerRoot(at + .025, stateAt(at + .025));
    const dx = after[0] - before[0] + travelAt(at + .025) - travelAt(at - .025);
    const dz = after[2] - before[2];
    // The ground scroll is faster than Broshi's lateral excursion: he walks
    // forward in the world even as his screen-space root changes direction.
    // Modest banking preserves the thin retained glyph's broad silhouette.
    return .6 * Math.tanh(Math.atan2(-dz, dx) / .6);
  };

  const actors = IDS.map(id => {
    const reading = sourceReading(id, music);
    const activity = reducedMotion ? 0 : reading.activity;
    const pitch = reducedMotion ? 0 : (reading.pitch01 - .5) * reading.pitchActivity;
    const local = id === 'broshi' ? bass : id === 'midio' ? pulse : melody;
    const actor = { id, heightM: JOURNEY_CAST_LAYOUT.heights[id],
      leanRad: 0, turnRad: 0, tailAngle: 0, jawOpen: 0, headAngle: 0,
      glow: .14 + flash * (.24 * reading.activity + .04 * local + .025 * energy), ...reading };
    if (id === 'broshi') {
      actor.positionM = walkerRoot(t, state);
      actor.stridePhase = reducedMotion ? 0 : t / STEP_SEC * TAU;
      actor.turnRad = reducedMotion ? 0 : headingAt(t);
      actor.leanRad = .035 * Math.sin(actor.stridePhase * 2) + .045 * activity * Math.sin(1.8 * t);
      actor.bodyLiftM = reducedMotion ? 0 : .65 + 1.15 * Math.sin(actor.stridePhase) ** 2;
      actor.tailAngle = .2 * Math.sin(actor.stridePhase + .7) + activity * (.22 * Math.sin(2.4 * t) - .2 * pulse);
      actor.jawOpen = activity * (.22 + .5 * bass + .18 * pulse);
      actor.headAngle = .08 * Math.sin(actor.stridePhase - .4) + activity * (.12 * Math.sin(1.8 * t) - .28 * pulse) + .13 * pitch;
      if (reducedMotion) {
        actor.footOffsetsM = [9, -13].map(base => [0,
          journeyGroundHeight(actor.positionM[0] + base / 34 * actor.heightM, actor.positionM[2], state) - actor.positionM[1], 0]);
      } else actor.footOffsetsM = walkingFeet(t, actor.positionM, actor.turnRad, state, stateAt, headingAt);
    } else if (id === 'midio') {
      actor.positionM = swimmerRoot(t, state, activity, reducedMotion ? 0 : pulse);
      const velocity = 145 * .32 * Math.cos(.32 * t - .48) + 12 * .74 * Math.cos(.74 * t + .2);
      actor.leanRad = -.22 * Math.tanh(velocity / 35) + .12 * Math.sin(2.15 * t)
        + activity * (.1 * Math.sin(3.2 * t) - .12 * pulse);
      actor.turnRad = .36 * Math.sin(.32 * t + .02) + .08 * pitch;
    } else {
      actor.positionM = [150 + 128 * Math.sin(.28 * t + .35) + activity * 6 * Math.sin(1.23 * t),
        100 + 34 * Math.sin(.36 * t - .3) + 14 * Math.sin(.13 * t)
          + activity * 7 * Math.sin(1.6 * t) + 12 * pitch,
        -36 + 42 * Math.cos(.21 * t + 1.3)];
      actor.leanRad = -.23 * Math.sin(.28 * t + .35) + .12 * activity * Math.sin(1.1 * t) + .1 * pitch;
      actor.turnRad = .34 * Math.sin(.19 * t + .8) + .07 * activity * Math.sin(.93 * t);
      actor.babies = [4.8, 5.7, 4.2].map((heightM, index) => {
        const phase = .95 * t + index * TAU / 3, radius = 22 + 4 * activity;
        return { heightM,
          positionM: [actor.positionM[0] + radius * Math.cos(phase),
            actor.positionM[1] + 14 * Math.sin(phase) + 7 * Math.sin(.29 * t + index),
            actor.positionM[2] + 12 * Math.sin(phase + .7)],
          rotationRad: reducedMotion ? 0 : .4 * Math.sin(phase + .3) + .15 * activity * Math.sin(1.7 * t + index),
        };
      });
    }
    if (reducedMotion) actor.leanRad = actor.turnRad = actor.tailAngle = actor.jawOpen = actor.headAngle = 0;
    return actor;
  });

  const midio = actors[0];
  const before = swimmerRoot(t - .025, stateAt(t - .025)), after = swimmerRoot(t + .025, stateAt(t + .025));
  const dx = (after[0] - before[0] + travelAt(t + .025) - travelAt(t - .025)) / .05;
  const dz = (after[2] - before[2]) / .05, speedMps = Math.hypot(dx, dz);
  const wake = reducedMotion ? 0 : unit(.25 + .45 * midio.activity + .3 * pulse);
  return freeze({ active: true, timeMs, actors, reducedMotion, reducedFlash,
    waterResponse: reducedMotion ? { bass: 0, rhythm: 0, melody: 0, wake: 0 } : { bass, rhythm: pulse, melody, wake },
    swimmer: { positionM: [...midio.positionM], directionXZ: speedMps > 1e-6 ? [dx / speedMps, dz / speedMps] : [1, 0],
      speedMps: reducedMotion ? 0 : speedMps, strength: wake },
  });
}
