// Listening owns the landscape from frame zero in every registered world.
const landscape = Object.freeze({ performers: false, decorativeActors: false, artificialNearProps: false, inhabitants: false });
export function resolveLandscapePresentation() { return landscape; }
