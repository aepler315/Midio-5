// Traveling residents of the imagined valley. Everything is sampled from
// heard time, including foot plants; no frame accumulator survives a seek.
import { sampleJourneyState, journeyNearShore, journeyFarShore, journeyGroundHeight } from './JourneyWorld.js';
import { JOURNEY_ORBIT, journeyOrbitPoint, journeyOrbitBasis } from './JourneyOrbit.js';

const IDS = ['midio', 'broshi', 'midasus'];
const TAU = Math.PI * 2;
const STEP_SEC = .76, STANCE = .56;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const unit = value => Math.max(0, Math.min(1, finite(value)));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const phaseAt = (t, period) => ((t / period) % 1 + 1) % 1;
const wrappedDistance = distance => {
  const circumference = JOURNEY_ORBIT.circumferenceM;
  return ((distance + circumference * .5) % circumference + circumference) % circumference - circumference * .5;
};

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
  const x = -174 + 82 * Math.sin(.13 * t - .14) + 12 * Math.sin(.047 * t + .4);
  const z = journeyNearShore(x, state) + 48 + 7 * Math.sin(.17 * t + .8);
  return [x, journeyGroundHeight(x, z, state), z];
}

function swimmerX(t) {
  return 132 * Math.sin(.19 * t - .48) + 18 * Math.sin(.061 * t + .2);
}

// Stroke phase follows distance through the world, never time multiplied by
// a changing musical value. Faster portions of the curved path stroke faster.
function swimPhase(t) {
  return (travelAt(t) + swimmerX(t)) / 52 * TAU;
}

function swimmerRoot(t, state, gesture = 0) {
  const x = swimmerX(t), desiredZ = -235 + 30 * Math.sin(.14 * t + .4);
  const z = Math.max(journeyFarShore(x, state) + 45,
    Math.min(journeyNearShore(x, state) - 45, desiredZ));
  const leap = swimArc(t, 1.4, 2.2), dive = swimArc(t, 3.6, 2.3);
  return [x, -1.2 + .48 * Math.sin(swimPhase(t)) + 16 * gesture * leap - 8 * gesture * dive, z];
}

// Source envelopes carry causal inertia upstream. Phrase evidence controls
// the size of exceptional action; it cannot manufacture activity in silence.
function musicalGesture(activity, direction) {
  const evidence = smooth(unit((activity - .45) / .5));
  if (!direction) return evidence;
  const intensity = unit(direction.intensity01), accent = unit(direction.accent01);
  // The director encodes build/arrival/sustain/recovery in continuous
  // intensity and accent envelopes. Switching an enum must never interrupt
  // an in-progress leap or roll at a section boundary.
  return evidence * unit(smooth(intensity) + .2 * accent);
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
function walkingFeet(t, root, turn, state, stateAt, headingAt, activity) {
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
      lift = (5.5 + 3 * activity) * Math.sin(Math.PI * swing) ** 2;
    }
    const localX = target[0] - state.travelM;
    const x = state.circular ? root[0] + wrappedDistance(localX - root[0]) : localX, z = target[1];
    const dx = x - root[0], dz = z - root[2];
    return [c * dx - s * dz - base,
      journeyGroundHeight(x, z, state) - root[1] + lift, -s * dx - c * dz];
  });
}

/** CoveGL-compatible poses plus a lake wake receiver. Source values already
 * have causal inertia: no physical-audibility gate or live-value phase is
 * applied here. Reduced flash changes only emission. */
export function sampleJourneyCast({ timeMs = 0, state = null, music = null,
  reducedMotion = false, reducedFlash = false, direction = null } = {}) {
  timeMs = Math.max(0, finite(timeMs));
  reducedMotion = !!reducedMotion;
  reducedFlash = !!reducedFlash;
  const t = reducedMotion ? 0 : timeMs / 1000;
  state = reducedMotion ? sampleJourneyState({ seed: state?.seed, circular: state?.circular, reducedMotion: true })
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
    const gesture = reducedMotion ? 0 : musicalGesture(activity, direction);
    const focus = .15 * unit(direction?.focusById?.[id]);
    const accent = activity * unit(unit(direction?.accent01) + focus);
    const local = id === 'broshi' ? bass : id === 'midio' ? pulse : melody;
    const actor = { id, heightM: JOURNEY_CAST_LAYOUT.heights[id],
      leanRad: 0, turnRad: 0, tailAngle: 0, jawOpen: 0, headAngle: 0, strokeAngle: 0,
      glow: .14 + flash * (.24 * reading.activity + .04 * local + .025 * energy), ...reading };
    if (id === 'broshi') {
      actor.positionM = walkerRoot(t, state);
      actor.stridePhase = reducedMotion ? 0 : t / STEP_SEC * TAU;
      actor.turnRad = reducedMotion ? 0 : headingAt(t);
      actor.leanRad = .04 * Math.sin(actor.stridePhase * 2) + .09 * activity * Math.sin(1.8 * t) - .04 * accent;
      actor.bodyLiftM = reducedMotion ? 0 : .6 + (1.2 + 1.5 * activity) * Math.sin(actor.stridePhase) ** 2;
      actor.tailAngle = .18 * Math.sin(actor.stridePhase + .7) + .04 * Math.sin(2 * actor.stridePhase - .4)
        + activity * (.36 * Math.sin(2.4 * t) - .18 * pulse) - .12 * accent;
      actor.jawOpen = reducedMotion ? 0 : .03 + .025 * Math.sin(actor.stridePhase) ** 2 + activity * (.14 + .3 * bass + .18 * pulse) + .1 * accent;
      actor.headAngle = .065 * Math.sin(actor.stridePhase - .4) + activity * (.18 * Math.sin(2.2 * t) - .24 * pulse) + .2 * pitch;
      actor.contactOpacity = 1;
      actor.contactScale = 1;
      if (reducedMotion) {
        actor.footOffsetsM = [9, -13].map(base => [0,
          journeyGroundHeight(actor.positionM[0] + base / 34 * actor.heightM, actor.positionM[2], state) - actor.positionM[1], 0]);
      } else actor.footOffsetsM = walkingFeet(t, actor.positionM, actor.turnRad, state, stateAt, headingAt, activity);
    } else if (id === 'midio') {
      actor.positionM = swimmerRoot(t, state, gesture);
      const velocity = 132 * .19 * Math.cos(.19 * t - .48) + 18 * .061 * Math.cos(.061 * t + .2);
      const stroke = swimPhase(t);
      actor.leanRad = -.19 * Math.tanh(velocity / 26) + (.065 + .14 * activity) * Math.sin(stroke - .4)
        + gesture * (.28 * swimArc(t, 1.4, 2.2) - .3 * swimArc(t, 3.6, 2.3)) + .1 * pitch;
      actor.turnRad = .2 * Math.sin(.19 * t + .02) + .08 * pitch;
      actor.strokeAngle = (.24 + .24 * activity + .08 * accent) * Math.sin(stroke);
    } else {
      actor.positionM = [145 + 100 * Math.sin(.16 * t + .35) + 12 * Math.sin(.043 * t),
        128 + 16 * Math.sin(.21 * t - .3) + 7 * Math.sin(.071 * t)
          + gesture * 14 * Math.sin(.63 * t) + 16 * pitch,
        -70 + 26 * Math.cos(.13 * t + 1.3) + 6 * Math.sin(.047 * t)];
      // Banking tracks the long curve. Large rolling motion is earned by
      // a sustained active source or a measured phrase arrival.
      actor.leanRad = -.24 * Math.sin(.16 * t + .35) + .08 * Math.sin(.21 * t)
        + .82 * gesture * Math.sin(.64 * t + .1) + .12 * pitch;
      actor.turnRad = .23 * Math.sin(.14 * t + .8) + .08 * activity * Math.sin(.4 * t);
      actor.babies = [5.8, 6.9, 5.2].map((heightM, index) => {
        const phase = .46 * t + index * TAU / 3, radius = 25 + 6 * activity;
        return { heightM,
          positionM: [actor.positionM[0] + radius * Math.cos(phase),
            actor.positionM[1] + 13 * Math.sin(phase) + 6 * Math.sin(.17 * t + index),
            actor.positionM[2] + 18 * Math.sin(phase + .7)],
          rotationRad: reducedMotion ? 0 : .25 * Math.sin(phase + .3) + .6 * gesture * Math.sin(.64 * t + index),
        };
      });
    }
    if (reducedMotion) actor.leanRad = actor.turnRad = actor.tailAngle = actor.jawOpen = actor.headAngle = actor.strokeAngle = 0;
    return actor;
  });

  const midio = actors[0];
  const before = swimmerRoot(t - .025, stateAt(t - .025));
  const after = swimmerRoot(t + .025, stateAt(t + .025));
  const dx = (after[0] - before[0] + travelAt(t + .025) - travelAt(t - .025)) / .05;
  const dz = (after[2] - before[2]) / .05, speedMps = Math.hypot(dx, dz);
  const contact = 1 - smooth(unit((Math.abs(midio.positionM[1]) - 1) / 10));
  const wake = reducedMotion ? 0 : contact * unit(.32 + .34 * midio.activity + .2 * pulse + .16 * (.5 + .5 * Math.sin(swimPhase(t))));
  return freeze({ active: true, timeMs, actors, reducedMotion, reducedFlash,
    waterResponse: reducedMotion ? { bass: 0, rhythm: 0, melody: 0, wake: 0 } : { bass, rhythm: pulse, melody, wake },
    swimmer: { positionM: [...midio.positionM], directionXZ: speedMps > 1e-6 ? [dx / speedMps, dz / speedMps] : [1, 0],
      speedMps: reducedMotion ? 0 : speedMps, strength: wake },
  });
}

/** Present intrinsic poses on the circular rim. Articulation and dimensions
 * remain in metres; only roots and ground contacts undergo depth compression.
 * The lake wake deliberately keeps the intrinsic coordinates it samples. */
export function journeyOrbitCast(pose) {
  const project = actor => {
    const basis = journeyOrbitBasis(actor.positionM[0]);
    const positionM = journeyOrbitPoint(actor.positionM);
    const converted = { ...actor, positionM, ...basis, orbitRadiusM: JOURNEY_ORBIT.radiusM };
    if (actor.footOffsetsM?.length === 2) {
      const c = Math.cos(finite(actor.turnRad)), s = Math.sin(finite(actor.turnRad));
      converted.footOffsetsM = actor.footOffsetsM.map((foot, index) => {
        const base = (index === 0 ? 9 : -13) / 34 * actor.heightM;
        const x = base + foot[0], z = foot[2];
        // Recover the actual intrinsic target before projection. Rotating an
        // offset alone leaves the feet in a tangent plane above the bank.
        const target = journeyOrbitPoint([
          actor.positionM[0] + wrappedDistance(c * x - s * z),
          actor.positionM[1] + foot[1], actor.positionM[2] - s * x - c * z,
        ]);
        const delta = target.map((value, axis) => value - positionM[axis]);
        const dot = axis => axis.reduce((sum, value, i) => sum + value * delta[i], 0);
        const right = dot(basis.right), up = dot(basis.up), forward = dot(basis.forward);
        // CoveGL applies local yaw after foot offsets, so undo that yaw here.
        return [c * right + s * forward - base, up, -s * right + c * forward];
      });
    }
    if (actor.babies) converted.babies = actor.babies.map(project);
    return converted;
  };
  return freeze({ ...pose, circular: true, actors: pose.actors.map(project) });
}
