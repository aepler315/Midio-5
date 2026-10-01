// Listening owns scenery from frame zero. Cathode's boss belongs to its
// pixel world, independently of the retired shared performers. World-owned
// resident drawings are still visible actors and have no listening ownership.
const landscape = Object.freeze({ performers: false, decorativeActors: false, artificialNearProps: false, cathodeBoss: false, inhabitants: false });
const cathode = Object.freeze({ ...landscape, cathodeBoss: true, inhabitants: false });
export function resolveLandscapePresentation(world = 'alpine') {
  return (typeof world === 'string' ? world : world?.kind) === 'cathode' ? cathode : landscape;
}
