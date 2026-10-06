// Traveling residents of the imagined valley. Everything is sampled from
// heard time, including foot plants; no frame accumulator survives a seek.
import { sampleJourneyState, journeyNearShore, journeyFarShore, journeyGroundHeight } from './JourneyWorld.js';

const IDS = ['midio', 'broshi', 'midasus'];
const TAU = Math.PI * 2;
const STEP_SEC = .76, STANCE = .36;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const unit = value => Math.max(0, Math.min(1, finite(value)));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const phaseAt = (t, period) => ((t / period) % 1 + 1) % 1;

// Each foot releases before the other lands. The same C1 flight envelope
// lifts the body and feet and softens the ground contact during a skip.
function runningFlight(t) {
  const phase = phaseAt(t, STEP_SEC / 2) * .5;
  return phase > STANCE ? Math.sin(Math.PI * (phase - STANCE) / (.5 - STANCE)) ** 2 : 0;
}

function swimArc(t, start, duration) {
  const phase = phaseAt(t, 8.4) * 8.4;
  return phase > start && phase < start + duration ? Math.sin(Math.PI * (phase - start) / duration) ** 2 : 0;
}

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
  heights: { midio: 40, broshi: 45, midasus: 36 },
  dressing: {},
});

// The odd extension is only used by the first foot plant, just before t=0.
// Reading the world's clock keeps foot contact tied to its actual scroll.
function travelAt(t) {
  return Math.sign(t) * sampleJourneyState({ timeMs: Math.abs(t) * 1000 }).travelM;
}

function walkerRoot(t, state) {
  const x = -174 + 112 * Math.sin(.3 * t - .14);
  const z = journeyNearShore(x, state) + 48 + 9 * Math.sin(.59 * t + .8);
  return [x, journeyGroundHeight(x, z, state), z];
}

function swimmerRoot(t, state, activity = 0, pulse = 0) {
  const x = 168 * Math.sin(.42 * t - .48) + 12 * Math.sin(1.32 * t + .2);
  const desiredZ = -235 + 38 * Math.sin(.43 * t + .4);
  // The normal path is far from both bounds; the margins remain explicit
  // because the same shore field evolves as the camera crosses the valley.
  const z = Math.max(journeyFarShore(x, state) + 45,
    Math.min(journeyNearShore(x, state) - 45, desiredZ));
  const leap = swimArc(t, 1.4, 2.2), dive = swimArc(t, 3.6, 2.3);
  return [x, -1.8 + (1.55 + .7 * activity) * Math.sin(4.8 * t)
    + (14 + 3 * activity) * leap - (8 + 2 * activity) * dive - .9 * activity * pulse, z];
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
function walkingFeet(t, root, turn, state, stateAt, headingAt, activity, flight) {
  const height = JOURNEY_CAST_LAYOUT.heights.broshi;
  const c = Math.cos(turn), s = Math.sin(turn);
  return [9, -13].map((base, index) => {
    base *= height / 34;
    const phase = phaseAt(t + index * STEP_SEC * .5, STEP_SEC);
    const start = t - phase * STEP_SEC;
    const place = at => {
      // A musical change in lake width must not drag an existing plant.
      // Anchor x/z on the neutral bank; the actual surface still supplies y.
      const atState = stateAt(at, 0), p = walkerRoot(at, atState), yaw = headingAt(at, 0);
      return [p[0] + atState.travelM + base * Math.cos(yaw), p[2] - base * Math.sin(yaw)];
    };
    const first = place(start + STEP_SEC * STANCE * .5);
    let target = first, lift = 0;
    if (phase > STANCE) {
      const swing = (phase - STANCE) / (1 - STANCE);
      const next = place(start + STEP_SEC * (1 + STANCE * .5));
      target = first.map((value, axis) => mix(value, next[axis], smooth(swing)));
      lift = (11.5 + 3 * activity) * Math.sin(Math.PI * swing) ** 2
        + (3.2 + 1.4 * activity) * flight;
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
  const stateAt = (at, energy = state.energy) => ({ ...state, energy, timeSec: at, travelM: state.travelM + travelAt(at) - clock });
  const headingAt = (at, energy = state.energy) => {
    const before = walkerRoot(at - .025, stateAt(at - .025, energy));
    const after = walkerRoot(at + .025, stateAt(at + .025, energy));
    const dx = after[0] - before[0] + travelAt(at + .025) - travelAt(at - .025);
    const dz = after[2] - before[2];
    // The ground scroll is faster than Broshi's lateral excursion: he runs
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
      leanRad: 0, turnRad: 0, tailAngle: 0, jawOpen: 0, headAngle: 0, strokeAngle: 0,
      glow: .14 + flash * (.24 * reading.activity + .04 * local + .025 * energy), ...reading };
    if (id === 'broshi') {
      const flight = reducedMotion ? 0 : runningFlight(t);
      actor.positionM = walkerRoot(t, state);
      actor.stridePhase = reducedMotion ? 0 : t / STEP_SEC * TAU;
      actor.turnRad = reducedMotion ? 0 : headingAt(t);
      actor.leanRad = .12 * Math.sin(actor.stridePhase * 2) + .08 * activity * Math.sin(1.8 * t);
      actor.bodyLiftM = reducedMotion ? 0 : 1.4 + 1.9 * Math.sin(actor.stridePhase) ** 2 + (6 + 2 * activity) * flight;
      actor.tailAngle = .48 * Math.sin(actor.stridePhase + .7) + .1 * Math.sin(2 * actor.stridePhase - .4)
        + activity * (.3 * Math.sin(2.4 * t) - .26 * pulse);
      actor.jawOpen = reducedMotion ? 0 : .06 + .1 * Math.sin(actor.stridePhase) ** 2 + activity * (.22 + .4 * bass + .18 * pulse);
      actor.headAngle = .17 * Math.sin(actor.stridePhase - .4) + activity * (.18 * Math.sin(2.2 * t) - .24 * pulse) + .2 * pitch;
      actor.contactOpacity = 1 - .65 * flight;
      actor.contactScale = 1 + .24 * flight;
      if (reducedMotion) {
        actor.footOffsetsM = [9, -13].map(base => [0,
          journeyGroundHeight(actor.positionM[0] + base / 34 * actor.heightM, actor.positionM[2], state) - actor.positionM[1], 0]);
      } else actor.footOffsetsM = walkingFeet(t, actor.positionM, actor.turnRad, state, stateAt, headingAt, activity, flight);
    } else if (id === 'midio') {
      actor.positionM = swimmerRoot(t, state, activity, reducedMotion ? 0 : pulse);
      const velocity = 168 * .42 * Math.cos(.42 * t - .48) + 12 * 1.32 * Math.cos(1.32 * t + .2);
      actor.leanRad = -.5 * Math.tanh(velocity / 38) + (.27 + .12 * activity) * Math.sin(4.8 * t - .4)
        - .2 * swimArc(t, 3.6, 2.3) + .15 * pitch;
      actor.turnRad = .38 * Math.sin(.42 * t + .02) + .12 * Math.sin(2.4 * t) + .12 * pitch;
      actor.strokeAngle = (.46 + .24 * activity) * Math.sin(4.8 * t);
    } else {
      actor.positionM = [145 + 154 * Math.sin(.47 * t + .35) + 14 * Math.sin(1.12 * t)
          + activity * 8 * Math.sin(1.23 * t),
        130 + 43 * Math.sin(.66 * t - .3) + 19 * Math.sin(.27 * t)
          + activity * 8 * Math.sin(1.8 * t) + 16 * pitch,
        -70 + 60 * Math.cos(.38 * t + 1.3) + 12 * Math.sin(.91 * t)];
      actor.leanRad = -.58 * Math.sin(.47 * t + .35) + 1.05 * Math.sin(.82 * t + .1)
        + .23 * activity * Math.sin(1.7 * t) + .18 * pitch;
      actor.turnRad = .46 * Math.sin(.41 * t + .8) + .18 * activity * Math.sin(1.3 * t);
      actor.babies = [5.8, 6.9, 5.2].map((heightM, index) => {
        const phase = 1.7 * t + index * TAU / 3, radius = 30 + 6 * activity;
        return { heightM,
          positionM: [actor.positionM[0] + radius * Math.cos(phase),
            actor.positionM[1] + 23 * Math.sin(phase) + 9 * Math.sin(.7 * t + index),
            actor.positionM[2] + 20 * Math.sin(phase + .7)],
          rotationRad: reducedMotion ? 0 : 1.1 * Math.sin(phase + .3) + .25 * activity * Math.sin(2.3 * t + index),
        };
      });
    }
    if (reducedMotion) actor.leanRad = actor.turnRad = actor.tailAngle = actor.jawOpen = actor.headAngle = actor.strokeAngle = 0;
    return actor;
  });

  const midio = actors[0];
  const before = swimmerRoot(t - .025, stateAt(t - .025)), after = swimmerRoot(t + .025, stateAt(t + .025));
  const dx = (after[0] - before[0] + travelAt(t + .025) - travelAt(t - .025)) / .05;
  const dz = (after[2] - before[2]) / .05, speedMps = Math.hypot(dx, dz);
  const contact = 1 - smooth(unit((Math.abs(midio.positionM[1]) - 1) / 10));
  const wake = reducedMotion ? 0 : contact * unit(.32 + .34 * midio.activity + .2 * pulse + .16 * (.5 + .5 * Math.sin(4.8 * t)));
  return freeze({ active: true, timeMs, actors, reducedMotion, reducedFlash,
    waterResponse: reducedMotion ? { bass: 0, rhythm: 0, melody: 0, wake: 0 } : { bass, rhythm: pulse, melody, wake },
    swimmer: { positionM: [...midio.positionM], directionXZ: speedMps > 1e-6 ? [dx / speedMps, dz / speedMps] : [1, 0],
      speedMps: reducedMotion ? 0 : speedMps, strength: wake },
  });
}
