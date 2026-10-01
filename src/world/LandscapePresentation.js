// Listening owns scenery from frame zero. Cathode's boss belongs to its
// pixel world, independently of the retired shared performers. The trio
// return only as small residents of the inhabited shore (InhabitedShore.js):
// world-owned drawings with no simulation, lights, capture or camera pull.
const landscape = Object.freeze({ performers: false, decorativeActors: false, artificialNearProps: false, cathodeBoss: false, inhabitants: true });
const cathode = Object.freeze({ ...landscape, cathodeBoss: true, inhabitants: false });
export function resolveLandscapePresentation(world = 'alpine') {
  return (typeof world === 'string' ? world : world?.kind) === 'cathode' ? cathode : landscape;
}
