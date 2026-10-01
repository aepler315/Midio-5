// Gust fronts: each kick (spaced at least GUST_FRONT_SPACING_MS from the
// last that started one) sends a front across the Range forest. Shared by
// the music history (which kicks start fronts), the frame (their ages and
// directions) and the forest shader (how many it carries).

/** Fronts carried at once: enough that the oldest has all but settled
 *  everywhere on screen before it is let go. */
export const GUST_FRONTS = 6;
/** Closer kicks ride an earlier front instead of starting their own. */
export const GUST_FRONT_SPACING_MS = 300;
/** Seconds for a front to cross the frame. */
export const GUST_SWEEP_SEC = 0.6;
/** A gust age long past any envelope: an empty slot. */
export const GUST_IDLE_SEC = 1000;
