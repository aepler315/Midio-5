// Heard-time poses for residents of the geographic cove. Rendering, depth,
// water clipping and reflections belong to the 3D scene, never this sampler.
import { rangeEnergy } from './RangeEnergy.js';
const IDS = ['midio', 'broshi', 'midasus'];
const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function validLayout(layout) {
  return layout && vector(layout.right) && vector(layout.forward)
    && IDS.every(id => vector(layout.anchors?.[id]) && Number.isFinite(layout.heights?.[id]) && layout.heights[id] > 0);
}

function offset(position, layout, right, up, forward) {
  return position.map((value, axis) => value + layout.right[axis] * right
    + layout.forward[axis] * forward + (axis === 1 ? up : 0));
}

/** A passive, immutable snapshot, reconstructed from heard time and canonical
 * music only. Residents physically answer the current notes and accents;
 * slower idle paths remain underneath, with fixed body size and real roots. */
export function sampleRangePerformance({ timeMs = 0, music = null, layout = null,
  reducedMotion = false, reducedFlash = false } = {}) {
  timeMs = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  reducedMotion = !!reducedMotion;
  reducedFlash = !!reducedFlash;
  const result = { active: !!validLayout(layout), timeMs, actors: [],
    waterResponse: { bass: 0, rhythm: 0, melody: 0, wake: 0 }, reducedMotion, reducedFlash };
  if (!result.active) return freeze(result);

  const t = timeMs / 1000;
  // Raw audibility outranks residual envelopes and detected notes. Silence
  // cannot keep stale bass or synthetic notes driving musical responses.
  const { audible, presence, rhythm, bass, melody } = rangeEnergy(music);
  const motion = reducedMotion ? 0 : 1;
  const flash = reducedFlash ? .22 : 1;
  const readings = music?.trioSources || {};

  result.actors = IDS.map(id => {
    const reading = readings[id] || {};
    const activity = audible * unit(reading.activity);
    const pitchActivity = Math.min(activity, audible * unit(reading.pitchActivity));
    const pitch01 = pitchActivity > 0 ? unit(reading.pitch01) : .5;
    const pitch = (pitch01 - .5) * pitchActivity;
    const lead = presence * activity;
    const localResponse = id === 'broshi' ? bass : id === 'midio' ? rhythm : melody;
    const actor = { id, positionM: [...layout.anchors[id]], heightM: layout.heights[id],
      leanRad: 0, turnRad: 0, tailAngle: 0, jawOpen: 0, headAngle: 0,
      glow: .14 + flash * (.24 * activity + .065 * localResponse),
      activity, pitchActivity, pitch01, source: reading.source ?? null,
      contributors: (reading.contributors || []).map(contributor => ({
        source: contributor.source ?? null,
        activity: audible * unit(contributor.activity),
        pitchActivity: audible * unit(contributor.pitchActivity),
        pitch01: audible && unit(contributor.pitchActivity) > 0 ? unit(contributor.pitch01) : .5,
      })),
      sharedSource: reading.source != null && IDS.some(other => other !== id && readings[other]?.source === reading.source),
    };

    if (id === 'broshi') {
      // All articulation pivots around the grounded root. Bass pressure must
      // never raise his feet, shrink his body or turn each beat into a jump.
      actor.leanRad = motion * (.025 * Math.sin(t * .43 + .4) + .07 * bass * Math.sin(t * 1.8) + .08 * rhythm);
      actor.turnRad = motion * (.04 * Math.sin(t * .29 - .8) + .10 * bass * Math.sin(t * 1.2));
      actor.tailAngle = motion * (.3 * Math.sin(t * .48 + 1.1) + .48 * bass * Math.sin(t * 2.5 + 1.1) - .52 * rhythm);
      actor.jawOpen = motion * (.1 * (.5 + .5 * Math.sin(t * .42 - .6)) + .85 * bass * (.3 + .7 * rhythm));
      actor.headAngle = motion * (.15 * Math.sin(t * .55 - .6) + .16 * bass * Math.sin(t * 1.8 - .6) - .55 * rhythm * (.3 + .7 * bass));
    } else if (id === 'midio') {
      // Buoyancy and a short swim stay within the authored wet cove.
      actor.positionM = offset(actor.positionM, layout,
        motion * (7 * Math.sin(t * .36) + presence * (7 + 8 * activity) * Math.sin(t * 1.55) + 9 * rhythm),
        motion * (1.2 * Math.sin(t * .71) - 3.8 * rhythm + .6 * lead * Math.sin(t * 3.1)),
        motion * (3 * Math.sin(t * .23) + 4 * presence * Math.sin(t * .77)));
      actor.leanRad = motion * (.1 * Math.sin(t * .53 + .7) + .13 * lead * Math.sin(t * 1.55 + .7) - .44 * rhythm);
      actor.turnRad = motion * (.065 * Math.sin(t * .34 - 1.3) + .18 * presence * Math.sin(t * 1.55 - 1.3) + .08 * pitch);
    } else {
      // Midasus wanders within the treetop clearing. Pitch is confidence
      // weighted before it can steer the path.
      actor.positionM = offset(actor.positionM, layout,
        motion * (12 * Math.sin(t * .28) + 18 * lead * Math.sin(t * 1.25) + 8 * rhythm),
        motion * (6.5 * Math.sin(t * .36 + .4) + 14 * lead * (.5 + .5 * Math.sin(t * 1.9 + .4)) + 7 * rhythm + 12 * pitch),
        motion * (2.5 * Math.sin(t * .19 + 1.2) + 5 * presence * Math.sin(t * .83)));
      actor.leanRad = motion * (.09 * Math.sin(t * .43 + 2) + .55 * lead * Math.sin(t * 1.25 + 2) + .55 * rhythm + .18 * pitch);
      actor.turnRad = motion * (.07 * Math.sin(t * .31 + 2) + .3 * lead * Math.sin(t * .93));
      const scatter = [[-11, 5, -7, 2.5], [14, -3, 5, 3.2], [6, 12, 13, 2.1]];
      actor.babies = scatter.map(([right, up, forward, heightM], index) => ({
        positionM: offset(actor.positionM, layout,
          right + motion * (3.5 * Math.sin(t * .62 + index * 2.1) + 12 * lead * Math.cos(t * 2.1 + index * 2.1)),
          up + motion * (2.5 * Math.sin(t * .51 + index * 1.8) + 9 * lead * Math.sin(t * 2.1 + index * 2.1)),
          forward + motion * (1.5 * Math.sin(t * .39 - index) + 4 * lead * Math.cos(t * 2.1 + index * 2.1)),
        ),
        heightM, rotationRad: motion * (.02 * Math.sin(t * .12 + index) + .5 * lead * Math.sin(t * 2.1 + index)) || 0,
      }));
    }
    if (!motion) actor.leanRad = actor.turnRad = actor.tailAngle = actor.jawOpen = actor.headAngle = 0;
    return actor;
  });

  // Reduced motion leaves music in the local glow while suppressing traveling
  // water patterns. Reduced flash is applied separately by the lake material.
  if (!reducedMotion) result.waterResponse = { bass, rhythm, melody,
    wake: unit(.28 * audible * unit(readings.midio?.activity) + .72 * rhythm) };
  return freeze(result);
}
