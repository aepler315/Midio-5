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

/** One lake-view pilot for Auto; deliberate range/biome choices still win. */
export function rangePerformanceViewId(choice = {}, experience = 'performance') {
  return choice.viewId || (experience === 'performance' && !choice.biome ? 'muncho-lake-south' : null);
}
