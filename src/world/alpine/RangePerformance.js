// Heard-time poses for residents of the geographic cove. Rendering, depth,
// water clipping and reflections belong to the 3D scene, never this sampler.
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
 * music only. Quick musical changes live in the water and local light; body
 * gestures are small, slow changes around a fixed-size resting silhouette. */
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
  // cannot keep a stale bass estimate, synthetic note or orbit moving.
  const audible = unit(music?.activity01) > 0 ? 1 : 0;
  const presence = audible * unit(music?.motionPresence01 ?? music?.activity01);
  const motion = reducedMotion ? 0 : presence;
  const flash = reducedFlash ? .22 : 1;
  const readings = music?.trioSources || {};
  const rhythm = audible * Math.max(unit(music?.kick01), unit(music?.rhythmAccent01));
  const bass = audible * Math.max(unit(music?.bassPressure01), unit(readings.broshi?.activity));
  const melody = audible * Math.max(unit(readings.midio?.activity), unit(readings.midasus?.activity));

  result.actors = IDS.map(id => {
    const reading = readings[id] || {};
    const activity = audible * unit(reading.activity);
    const pitchActivity = Math.min(activity, audible * unit(reading.pitchActivity));
    const pitch01 = pitchActivity > 0 ? unit(reading.pitch01) : .5;
    const pitch = (pitch01 - .5) * pitchActivity;
    const movement = motion * activity;
    const localResponse = id === 'broshi' ? bass : id === 'midio' ? rhythm : melody;
    const actor = { id, positionM: [...layout.anchors[id]], heightM: layout.heights[id],
      leanRad: 0, turnRad: 0, tailAngle: 0, jawOpen: 0,
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
      actor.leanRad = movement * .028 * Math.sin(t * .16 + .4);
      actor.turnRad = movement * .035 * Math.sin(t * .11 - .8);
      actor.tailAngle = movement * .055 * Math.sin(t * .19 + 1.1);
      actor.jawOpen = movement * .055 * (.5 + .5 * Math.sin(t * .14 - .6));
    } else if (id === 'midio') {
      // The root stays exactly at the authored waterline; the renderer places
      // the lower body below it. Measured melody gives only a subtle gaze.
      actor.leanRad = movement * .025 * Math.sin(t * .17 + .7);
      actor.turnRad = motion * (activity * .028 * Math.sin(t * .12 - 1.3) + .018 * pitch);
    } else {
      // Midasus occupies treetop depth, with a few metres of wandering rather
      // than a large orbit. Pitch is confidence weighted before it can steer.
      actor.positionM = offset(actor.positionM, layout,
        movement * 3.2 * Math.sin(t * .11),
        movement * 2.4 * Math.sin(t * .14 + .4) + motion * pitch,
        movement * 1.8 * Math.sin(t * .073 + 1.2));
      actor.leanRad = motion * (activity * .03 * Math.sin(t * .13 + 2) + .018 * pitch);
      actor.turnRad = movement * .03 * Math.sin(t * .095 + 2);
      const scatter = [[-11, 5, -7, 2.5], [14, -3, 5, 3.2], [6, 12, 13, 2.1]];
      actor.babies = scatter.map(([right, up, forward, heightM], index) => ({
        positionM: offset(actor.positionM, layout,
          right + movement * 1.7 * Math.sin(t * .15 + index * 2.1),
          up + movement * 1.2 * Math.sin(t * .12 + index * 1.8),
          forward + movement * .9 * Math.sin(t * .09 - index)),
        heightM, rotationRad: movement * .04 * Math.sin(t * .12 + index) || 0,
      }));
    }
    if (!movement) actor.leanRad = actor.turnRad = actor.tailAngle = actor.jawOpen = 0;
    return actor;
  });

  // Reduced motion leaves music in the local glow while suppressing traveling
  // water patterns. Reduced flash is applied separately by the lake material.
  if (!reducedMotion) result.waterResponse = { bass, rhythm, melody,
    wake: unit(.28 * audible * unit(readings.midio?.activity) + .72 * rhythm) };
  return freeze(result);
}
