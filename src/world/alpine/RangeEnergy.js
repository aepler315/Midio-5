const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Immediate canonical music shared by residents and the directional sky.
 * The kick already has an 80ms attack and a physical release. Filtering it
 * again over a phrase removes the gesture. Pressure still carries the body
 * of the sound; current bands and source lanes preserve notes between kicks. */
export function rangeEnergy(music) {
  const audible = unit(music?.activity01) > 0 ? 1 : 0;
  const sources = music?.trioSources || {};
  return {
    audible,
    presence: audible * unit(music?.motionPresence01 ?? music?.activity01),
    rhythm: audible * unit(music?.kick01),
    bass: audible * Math.max(unit(music?.bassPressure01), unit(sources.broshi?.activity),
      .6 * unit(music?.bands?.[0]) + .4 * unit(music?.bands?.[1])),
    melody: audible * Math.max(unit(sources.midio?.activity), unit(sources.midasus?.activity)),
  };
}
