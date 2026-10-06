// Range lake mirror: the terrain seen from a camera reflected about the
// view's water level, rendered once per frame at reduced size and sampled
// by the water in the terrain shader through a projection matrix (the same
// trick as three's Reflector, without its oblique near plane: fragments
// below the water are clipped in the shaders instead).

/** The mirror image is drawn at this fraction of the partition size. */
export const MIRROR_SCALE = 0.5;
/** Ground within this many metres above the water is clipped from the
 *  mirror image (the shore strip and the water itself). */
export const MIRROR_CLIP_M = 0.5;
/** Water within this many metres of the mirror plane uses it; other lakes
 *  (another level, a river reach) keep the sky reflection. */
export const MIRROR_LEVEL_TOLERANCE_M = 3;
/** Reflections are drawn as if the viewer stood this fraction of its true
 *  height above the water (the reflected ray's elevation, as a tangent, is
 *  scaled by it). From a rail hundreds of metres above a lake a physical
 *  reflection is nearly all sky; a lower eye fills the water with its
 *  shores and the ranges beyond. Applied to the mirror camera and to the
 *  backdrop lookup alike, so both agree on each reflected ray. */
export const MIRROR_LIFT = 0.45;
/** A view mirrors only when this many sampled water samples near its level
 *  stand on tiles visible from the rail. */
export const MIRROR_MIN_SAMPLES = 40;

/** Fade a reflected screen capture into directional sky before its edge. */
export const BACKDROP_FEATHER_UV = .045;

/** Valid captured picture in texture UVs (bottom-left origin). The capture
 * includes scenic overscan, but the source Canvas only contains the fitted
 * nominal picture. Opaque portrait letterboxing is invalid reflection too. */
export function backdropBounds(viewport, transform, canvas) {
  const W = viewport?.logicalWidth, H = viewport?.logicalHeight;
  const width = canvas?.width, height = canvas?.height, margin = viewport?.overscanPx || 0;
  const nw = viewport?.nominalWidth || W - 2 * margin, nh = viewport?.nominalHeight || H - 2 * margin;
  const a = transform?.a ?? 1, d = transform?.d ?? 1, e = transform?.e ?? 0, f = transform?.f ?? 0;
  if (![W, H, width, height, nw, nh, a, d].every(v => Number.isFinite(v) && v > 0)
    || ![e, f].every(Number.isFinite)) return [0, 0, 0, 0];
  const scale = Math.min(width / nw, height / nh);
  const fitW = nw * scale, fitH = nh * scale;
  const fitX = (width - fitW) / 2, fitY = (height - fitH) / 2;
  const sourceW = a * W, sourceH = d * H;
  const x0 = Math.max(0, fitX, e), y0 = Math.max(0, fitY, f);
  const x1 = Math.min(width, fitX + fitW, e + sourceW), y1 = Math.min(height, fitY + fitH, f + sourceH);
  if (!(x1 > x0 && y1 > y0)) return [0, 0, 0, 0];
  return [(x0 - e) / sourceW, 1 - (y1 - f) / sourceH,
    (x1 - e) / sourceW, 1 - (y0 - f) / sourceH];
}

/** CPU twin of the reflection shader's validity weight, for projection and
 * capture regression tests; transparent or missing pixels never darken sky. */
export function backdropWeight(uv, bounds, alpha = 1) {
  if (!Array.isArray(uv) || !Array.isArray(bounds) || uv.length !== 2 || bounds.length !== 4
    || ![...uv, ...bounds, alpha].every(Number.isFinite) || !(bounds[2] > bounds[0] && bounds[3] > bounds[1])) return 0;
  const edge = Math.min(uv[0] - bounds[0], uv[1] - bounds[1], bounds[2] - uv[0], bounds[3] - uv[1]);
  const t = Math.max(0, Math.min(1, edge / BACKDROP_FEATHER_UV));
  return t * t * (3 - 2 * t) * Math.max(0, Math.min(1, alpha));
}

export function mirrorSize(width, height, scale = MIRROR_SCALE) {
  return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
}

/** The level a view's lake mirrors at, or null when no visible water lies
 *  near `levelM` (only rivers, or lakes the rail never sees). Samples every
 *  `stride`th water sample, as waterLevel does. */
export function mirrorLevelFor(data, levelM, { stride = 7 } = {}) {
  if (!Number.isFinite(levelM)) return null;
  let n = 0;
  for (const t of data.tiles.values()) {
    if (!t.visible || !t.flowBytes) continue;
    for (let i = 0; i < t.flowBytes.length; i += stride) {
      if (t.flowBytes[i] === 255 && Math.abs(t.heightsM[i] - levelM) < MIRROR_LEVEL_TOLERANCE_M && ++n >= MIRROR_MIN_SAMPLES) return levelM;
    }
  }
  return null;
}

/**
 * Pose `out` (a PerspectiveCamera) as `camera` reflected about the plane
 * y = levelM: position and forward/up directions mirrored, same projection.
 * The result is a proper camera, so its image of a point X is the real
 * camera's image of X's reflection with x negated; projecting the water
 * point through it (mirrorTextureMatrix) finds the reflected ground.
 * `lift` < 1 moves the mirror eye that fraction of the way toward the
 * plane (see MIRROR_LIFT); the water still projects into the same frame.
 */
export function mirrorCameraFor(THREE, camera, levelM, out, lift = 1) {
  camera.updateMatrixWorld();
  const q = camera.getWorldQuaternion(new THREE.Quaternion());
  const pos = camera.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  fwd.y = -fwd.y; up.y = -up.y;
  out.position.set(pos.x, levelM - lift * (pos.y - levelM), pos.z);
  out.up.copy(up);
  out.lookAt(out.position.clone().add(fwd));
  out.projectionMatrix.copy(camera.projectionMatrix);
  out.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  out.updateMatrixWorld();
  out.matrixWorldInverse.copy(out.matrixWorld).invert();
  return out;
}

/** World point -> mirror image uv (in .xy / .w). */
export function mirrorTextureMatrix(THREE, mirrorCamera, out = new THREE.Matrix4()) {
  out.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  out.multiply(mirrorCamera.projectionMatrix);
  out.multiply(mirrorCamera.matrixWorldInverse);
  return out;
}
