// The Range's shoreline inhabitants are separate from retired gameplay ownership.
const landscape = Object.freeze({ performers: false, decorativeActors: false, artificialNearProps: false, inhabitants: false, trioHabitat: false });
const performance = Object.freeze({ ...landscape, trioHabitat: true });

export function resolveRangeExperience(search = '') {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return q.get('rangeExperience')?.toLowerCase() === 'landscape' ? 'landscape' : 'performance';
}

export function resolveLandscapePresentation(world, { rangeExperience = 'performance' } = {}) {
  const alpine = world === 'range' || world === 'alpine' || world?.kind === 'alpine';
  return alpine && rangeExperience !== 'landscape' ? performance : landscape;
}

/** Only deliberate places force a geographic view; Auto belongs to Journey. */
export function rangePerformanceViewId(choice = {}) {
  return choice.viewId || null;
}

/** Auto performance travels through an imagined valley. Deliberate places
 * and the landscape experience keep their geographic renderer. */
export function rangeJourneyEnabled(choice = {}, experience = 'performance') {
  return experience === 'performance' && !choice.viewId && !choice.biome;
}
