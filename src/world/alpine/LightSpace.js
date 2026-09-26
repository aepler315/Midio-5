/** Scenic logical → device → ground logical. Intensity and color stay put. */
export function convertLightBetween(light, fromMatrix, toMatrix) {
  if (!light || !fromMatrix?.transformPoint || !toMatrix?.inverse) return light;
  const inverse = toMatrix.inverse();
  if (!inverse?.transformPoint) return light;
  const map = (x, y) => {
    const device = fromMatrix.transformPoint({ x, y });
    return inverse.transformPoint({ x: device.x, y: device.y });
  };
  const origin = map(light.x, light.y);
  const dirX = Number.isFinite(light.dirX) ? light.dirX : 0;
  const dirY = Number.isFinite(light.dirY) ? light.dirY : 1;
  const tip = map(light.x + dirX, light.y + dirY);
  const dx = tip.x - origin.x;
  const dy = tip.y - origin.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    ...light,
    x: origin.x,
    y: origin.y,
    dirX: dx / len,
    dirY: dy / len,
    space: 'ground',
  };
}
