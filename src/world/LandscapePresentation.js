// Listening owns scenery from frame zero. Cathode's boss belongs to its
// pixel world, independently of the retired shared performers.
const landscape = Object.freeze({ performers: false, decorativeActors: false, artificialNearProps: false, cathodeBoss: false });
const cathode = Object.freeze({ ...landscape, cathodeBoss: true });
export function resolveLandscapePresentation(world = 'alpine') {
  return (typeof world === 'string' ? world : world?.kind) === 'cathode' ? cathode : landscape;
}
