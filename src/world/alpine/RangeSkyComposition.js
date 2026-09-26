/** One frame's Range-specific upper-sky ownership. The live ridge supplies
 * the geometry; incidental paint is admitted only outside its actual body. */
export function createRangeSkyComposition(spaceRidge, canvas, { voyageActive = false } = {}) {
  const corridorAt = spaceRidge.corridor(canvas);
  const allowPoint = (x, y) => {
    const { top, bottom } = corridorAt(x);
    return y < top || y > bottom;
  };
  return {
    allowPoint,
    allowStar: (index, x, y) => index % 5 === 0 && allowPoint(x, y),
    showWeaver: !voyageActive,
    weaverOptions: { maxFigures: 1, maxRetained: 0, allowPoint },
    celestialShafts: false,
    biomeRays: false,
  };
}

export function rangeMoonRadius(canvasHeight, scale) {
  return Math.min(Math.max(14, canvasHeight * 0.0361) * scale, canvasHeight * 0.07);
}
