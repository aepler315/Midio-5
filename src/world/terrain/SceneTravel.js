// Range v2: where a curated scenic view's camera is, as a pure function of
// heard time. Two pieces, both stateless:
//
//   sceneProgressAt()  heard time -> progress 0..1 along the view's rail. A
//                      thin adapter over ProfileTravel's finite, music-driven
//                      travel (the same start station, energy-integral rate
//                      and fit-to-length the scanned skylines use), read on a
//                      canonical 8192px strip with a 1280px reference window.
//                      No frame-to-frame accumulation: seeking, pausing and
//                      redrawing land on the same place by construction.
//   cameraPoseAt()     progress -> a perspective camera pose on the view's
//                      straight rail. Screen size, DPR and quality never enter
//                      it; aspect-ratio framing is a projection concern.
//
// Local scene axes: X east, Y up, Z south, metres (plan §7.1).
import { terrainScrollPx } from './ProfileTravel.js';

export const SCENE_STRIP_WIDTH = 8192;
export const SCENE_REFERENCE_WINDOW = 1280;
export const SCENE_ROOM = SCENE_STRIP_WIDTH - SCENE_REFERENCE_WINDOW; // 6912
export const SCENE_PREVIEW_PROGRESS = 0.5;
export const FOV_MIN_DEG = 5;
export const FOV_MAX_DEG = 120;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/**
 * Progress 0..1 along a view's rail at heard time `timeMs`.
 * A zero or unknown duration is a preview: the rail's midpoint, matching the
 * scanned skylines' midpoint preview station.
 */
export function sceneProgressAt({ timeMs = 0, curves = null, durationMs = 0, reducedFlash = false, response = null } = {}) {
  const dur = Number(durationMs) || 0;
  if (!(dur > 0)) return SCENE_PREVIEW_PROGRESS;
  const tSec = Math.max(0, Number(timeMs) || 0) / 1000;
  const scrollPx = terrainScrollPx({
    tSec, curves, durationMs: dur, stripWidth: SCENE_STRIP_WIDTH, reducedFlash, response,
    depth: 1, fit: { viewWidth: SCENE_REFERENCE_WINDOW, maxDepth: 1 },
  });
  return clamp01(scrollPx / SCENE_ROOM);
}

/** Validate a view's camera rail. Returns a list of problems (empty = ok). */
export function cameraRailErrors(camera) {
  const errors = [];
  if (!camera || typeof camera !== 'object') return ['camera missing'];
  for (const k of ['eyeStartM', 'eyeEndM', 'targetStartM', 'targetEndM']) {
    if (!isVec3(camera[k])) errors.push(`camera.${k} must be three finite numbers`);
  }
  const fov = camera.fovYDeg;
  if (!(Number.isFinite(fov) && fov >= FOV_MIN_DEG && fov <= FOV_MAX_DEG)) {
    errors.push(`camera.fovYDeg must be within ${FOV_MIN_DEG}..${FOV_MAX_DEG}`);
  }
  if (errors.length) return errors;
  for (const [eye, target, name] of [[camera.eyeStartM, camera.targetStartM, 'start'], [camera.eyeEndM, camera.targetEndM, 'end']]) {
    const d = sub(target, eye);
    const len = Math.hypot(...d);
    if (!(len > 1)) errors.push(`camera ${name} eye and target coincide`);
    else if (Math.abs(d[1] / len) > 0.98) errors.push(`camera ${name} looks straight up or down`);
  }
  return errors;
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The camera pose at rail progress `progress01` (clamped): eye and target
 *  interpolated between the authored endpoints, world-up kept. Throws on an
 *  invalid rail rather than returning a degenerate camera. */
export function cameraPoseAt(view, progress01) {
  const camera = view?.camera;
  const errors = cameraRailErrors(camera);
  if (errors.length) throw new Error(`invalid camera rail for ${view?.id ?? 'view'}: ${errors.join('; ')}`);
  const u = clamp01(Number.isFinite(progress01) ? progress01 : 0);
  return {
    eyeM: lerp3(camera.eyeStartM, camera.eyeEndM, u),
    targetM: lerp3(camera.targetStartM, camera.targetEndM, u),
    fovYDeg: camera.fovYDeg,
  };
}

/** Orthonormal camera basis: forward, right, up (world-up kept). */
export function cameraBasis(pose) {
  const forward = norm(sub(pose.targetM, pose.eyeM));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { forward, right, up };
}

/**
 * Project a local point for a pose at aspect `aspect` (width/height).
 * Returns { x, y } in normalized device coordinates (-1..1, y up) and the
 * view depth `depth` (metres along forward), or null behind the eye.
 * `fovScale` widens the frustum (pull-back/overscan), 1 = the view's own.
 */
export function projectPoint(pose, aspect, point, fovScale = 1) {
  const { forward, right, up } = cameraBasis(pose);
  const d = sub(point, pose.eyeM);
  const depth = dot(d, forward);
  if (!(depth > 1e-6)) return null;
  const t = Math.tan((pose.fovYDeg * Math.PI) / 360) * fovScale;
  return { x: dot(d, right) / (depth * t * aspect), y: dot(d, up) / (depth * t), depth };
}

/** Pixels per metre of vertical offset at `depth` for a viewport `heightPx`. */
export function focalPx(fovYDeg, heightPx) {
  return heightPx / (2 * Math.tan((fovYDeg * Math.PI) / 360));
}

/** Whether an axis-aligned box {min:[x,y,z], max:[x,y,z]} can appear in the
 *  pose's frustum at `aspect` widened by `fovScale`. Conservative: tests the
 *  box against the four side planes and the near plane. */
export function boxMayBeVisible(pose, aspect, box, fovScale = 1) {
  const { forward, right, up } = cameraBasis(pose);
  const t = Math.tan((pose.fovYDeg * Math.PI) / 360) * fovScale;
  const tx = t * aspect;
  // Plane normals pointing into the volume: the near plane (forward) and
  // the four sides, n = forward * tan -/+ axis.
  const side = (axis, tan, sign) => norm([
    forward[0] * tan - sign * axis[0], forward[1] * tan - sign * axis[1], forward[2] * tan - sign * axis[2],
  ]);
  const planes = [forward, side(right, tx, 1), side(right, tx, -1), side(up, t, 1), side(up, t, -1)];
  for (const n of planes) {
    // The box corner furthest along n must be on the inside.
    const p = [n[0] >= 0 ? box.max[0] : box.min[0], n[1] >= 0 ? box.max[1] : box.min[1], n[2] >= 0 ? box.max[2] : box.min[2]];
    if (dot(n, sub(p, pose.eyeM)) < 0) return false;
  }
  return true;
}

/** Shortest distance from the eye to a box. */
export function distanceToBox(eye, box) {
  const dx = Math.max(box.min[0] - eye[0], 0, eye[0] - box.max[0]);
  const dy = Math.max(box.min[1] - eye[1], 0, eye[1] - box.max[1]);
  const dz = Math.max(box.min[2] - eye[2], 0, eye[2] - box.max[2]);
  return Math.hypot(dx, dy, dz);
}
