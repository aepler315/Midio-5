// Range v2 camera moves, on top of a view's authored rail pose:
//
//   rangeCameraMoveAt()   slow cinematic moves -- push in, drift, orbit,
//                         crane -- one per song section, as a pure function
//                         of heard time (seek, pause and export land on the
//                         same shot). The song ends on a wide, risen shot.
//   RangeUserCamera       the listener's zoom (scroll wheel, two-finger
//                         pinch). The eye flies along the ray under the
//                         pointer, so the place under the cursor stays put.
//   applyCameraMoves()    both applied to a rail pose, clamped so the eye
//                         never sinks into terrain, trees or water and the frame
//                         never shows more than the authored frame does.
//
// The zoom is a dolly (the eye moves), not a lens zoom: the canvas sky,
// sun and aurora sit at infinity, so they correctly stay put while the
// land comes closer, and the terrain renders sharp at every zoom.
//
// Why the frame stays on the map: the user offset is kept inside the
// authored view cone (|right| <= forward * tanX, same for up). A cone moved
// along a vector inside itself is a subset of the original cone, so a
// zoomed frame only ever shows land the authored frame already covers.
import { cameraBasis } from '../terrain/SceneTravel.js';
import { hashSeed, mulberry32 } from '../../utils/math.js';

export const MOVE_KINDS = Object.freeze(['push', 'drift', 'orbit', 'crane']);
export const NEUTRAL_MOVE = Object.freeze({ dolly: 0, yaw: 0, crane: 0, truck: 0, kind: 'rest' });
// Sections shorter than this ride along with the move in progress; a new
// move every few seconds reads as a nervous camera, not a cinematic one.
export const MIN_MOVE_MS = 8000;
// The closing move (the sunset shot) starts this long before the end, or
// at the last section boundary, whichever leaves it more room.
export const FINALE_MS = 20000;
// Amplitudes, as fractions of the rail's eye-to-target distance D (yaw in
// radians). D is kilometres, so these are big on the ground and small on
// screen: a 3 km push toward a summit 20 km away.
export const MOVE_LIMITS = Object.freeze({ dolly: [0, 0.16], yaw: [-0.06, 0.06], crane: [0, 0.035], truck: [-0.025, 0.025] });
const FINALE = Object.freeze({ dolly: 0, crane: 0.03, truck: 0 });

// User zoom: each unit of `fx` moves the eye one rail distance D forward.
export const USER_FX_MAX = 0.72;
const USER_EASE_SEC = 0.18;
// Eye clearance over the static ground or water, metres. The rendered land
// sits higher than the DEM: the musical deformation lifts ridges by up to
// ~180 m (calibrateRangeMusic) and trees stand on top, so the eye keeps
// well above both. More from far up.
const CLEARANCE_MIN_M = 250;
const CLEARANCE_FRAC = 0.01;
const LOW_CLEARANCE_MIN_M = 30;
// The zoom path is checked at least every terrain cell (so no ridge slips
// between samples), within these bounds.
const CLEARANCE_SAMPLES_MIN = 16;
const CLEARANCE_SAMPLES_MAX = 4096;
const DEFAULT_SAMPLE_STEP_M = 30;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const keyCache = new WeakMap();

/** Keyframes {tMs, dolly, yaw, crane, truck, kind}: the camera reaches key
 *  k at its time and eases from key k-1 to key k across the span between. */
export function cameraMoveKeys(sections, durationMs, seed = 0) {
  const dur = Number(durationMs) || 0;
  if (!(dur > 0)) return [{ tMs: 0, ...NEUTRAL_MOVE }];
  const cached = Array.isArray(sections) && keyCache.get(sections);
  if (cached && cached.dur === dur && cached.seed === seed) return cached.keys;
  const list = Array.isArray(sections) ? sections : [];
  const finaleAt = Math.max(0, dur - FINALE_MS);
  // Accepted boundaries: section starts at least MIN_MOVE_MS apart, before
  // the finale. The section running from each one picks the next move.
  const starts = [{ tMs: 0, section: list[0] || null }];
  for (const s of list) {
    const t = Number(s?.startMs);
    if (!(t > 0) || t >= finaleAt) continue;
    if (t - starts.at(-1).tMs < MIN_MOVE_MS || finaleAt - t < MIN_MOVE_MS) continue;
    starts.push({ tMs: t, section: s });
  }
  const rand = mulberry32(hashSeed(`range-camera:${seed}`));
  const keys = [{ tMs: 0, ...NEUTRAL_MOVE }];
  let lastKind = null;
  for (let i = 0; i < starts.length; i++) {
    const cur = keys.at(-1);
    const end = i + 1 < starts.length ? starts[i + 1].tMs : finaleAt;
    if (!(end > cur.tMs)) continue;
    const energy = clamp(Number(starts[i].section?.relEnergy01 ?? 0.5) || 0, 0, 1);
    let kind = MOVE_KINDS[Math.floor(rand() * MOVE_KINDS.length) % MOVE_KINDS.length];
    // A loud section pushes in toward the peaks.
    if (energy >= 0.6 && lastKind !== 'push') kind = 'push';
    if (kind === lastKind) kind = MOVE_KINDS[(MOVE_KINDS.indexOf(kind) + 1) % MOVE_KINDS.length];
    lastKind = kind;
    const r = rand();
    const next = { ...cur, tMs: end, kind };
    if (kind === 'push') {
      // Loud sections lean in; a push that would barely move pulls back.
      let d = lerp(0.03, MOVE_LIMITS.dolly[1], energy);
      if (Math.abs(d - cur.dolly) < 0.04) d = cur.dolly > 0.08 ? 0.01 : 0.14;
      next.dolly = d;
    } else if (kind === 'drift') {
      next.truck = -(Math.sign(cur.truck) || (r < 0.5 ? -1 : 1)) * lerp(0.012, MOVE_LIMITS.truck[1], r);
    } else if (kind === 'orbit') {
      next.yaw = -(Math.sign(cur.yaw) || (r < 0.5 ? -1 : 1)) * lerp(0.025, MOVE_LIMITS.yaw[1], r);
    } else {
      // Quiet sections rise and look down over the land; a risen camera
      // settles back.
      next.crane = cur.crane > 0.015 ? 0 : lerp(0.015, MOVE_LIMITS.crane[1], 1 - energy);
    }
    keys.push(next);
  }
  // The finale: pull back wide and rise, holding half the last orbit.
  const last = keys.at(-1);
  keys.push({ tMs: dur, ...FINALE, yaw: last.yaw * 0.5, kind: 'finale' });
  if (Array.isArray(sections)) keyCache.set(sections, { dur, seed, keys });
  return keys;
}

/** The cinematic move offset at heard time `timeMs`. Neutral for previews
 *  and under reduced motion. */
export function rangeCameraMoveAt({ timeMs = 0, sections = null, durationMs = 0, seed = 0, reducedMotion = false, preview = false } = {}) {
  if (reducedMotion || preview || !(durationMs > 0)) return NEUTRAL_MOVE;
  const keys = cameraMoveKeys(sections, durationMs, seed);
  const t = clamp(Number(timeMs) || 0, 0, durationMs);
  let k = 1;
  while (k < keys.length - 1 && keys[k].tMs <= t) k++;
  const a = keys[k - 1], b = keys[k] || a;
  const u = b.tMs > a.tMs ? smoother(clamp((t - a.tMs) / (b.tMs - a.tMs), 0, 1)) : 1;
  return {
    dolly: lerp(a.dolly, b.dolly, u), yaw: lerp(a.yaw, b.yaw, u),
    crane: lerp(a.crane, b.crane, u), truck: lerp(a.truck, b.truck, u), kind: b.kind,
  };
}

function groundAt(heightAt, waterLevelM, x, z) {
  const h = heightAt ? heightAt(x, z) : NaN;
  const w = Number.isFinite(waterLevelM) ? waterLevelM : -Infinity;
  // Off the terrain package: no ground known. The view cone keeps the
  // frame on the map; the eye itself may legitimately hang past its edge.
  return Number.isFinite(h) ? Math.max(h, w) : (Number.isFinite(w) ? w : -Infinity);
}

/**
 * Apply a cinematic move and a user zoom to a rail pose.
 *   pose   { eyeM, targetM, fovYDeg } (cameraPoseAt)
 *   move   rangeCameraMoveAt() result, or null
 *   user   { fx, rx, uy } offset in multiples of the rail distance along
 *          forward/right/up, or null
 *   heightAt(x, z) -> metres (NaN off the map), waterLevelM: the floor.
 * Returns { eyeM, targetM, fovYDeg, userScale } where userScale (0..1) is
 * how much of the user offset the terrain allowed.
 */
export function applyCameraMoves(pose, move, user, { heightAt = null, waterLevelM = null, sampleStepM = DEFAULT_SAMPLE_STEP_M } = {}) {
  const T0 = pose.targetM;
  const d0 = sub(T0, pose.eyeM);
  const D = Math.hypot(...d0);
  if (!(D > 1)) return { ...pose, userScale: 1 };
  // Clearance above the ground for every moved eye. A view authored lower
  // than the full clearance (a desert floor shot) keeps half its own
  // height above ground instead, never under LOW_CLEARANCE_MIN_M, so its
  // moves stay clear and its zoom is not dead from the first step.
  const clearance = Math.max(CLEARANCE_MIN_M, CLEARANCE_FRAC * D);
  const above = pose.eyeM[1] - groundAt(heightAt, waterLevelM, pose.eyeM[0], pose.eyeM[2]);
  const flight = above < clearance ? Math.max(LOW_CLEARANCE_MIN_M, 0.5 * above) : clearance;
  const floorAt = (p) => groundAt(heightAt, waterLevelM, p[0], p[2]) + flight;
  const marginAt = (p) => p[1] - floorAt(p);
  let eye = pose.eyeM, target = T0;
  if (move && move !== NEUTRAL_MOVE) {
    const yaw = move.yaw || 0;
    if (yaw) {
      // Orbit: swing the eye round a vertical axis through the target.
      const c = Math.cos(yaw), s = Math.sin(yaw), dx = eye[0] - T0[0], dz = eye[2] - T0[2];
      eye = [T0[0] + dx * c - dz * s, eye[1], T0[2] + dx * s + dz * c];
    }
    eye = add(eye, [0, 1, 0], (move.crane || 0) * D);
    eye = add(eye, sub(T0, eye), move.dolly || 0);
    if (move.truck) {
      const { right } = cameraBasis({ eyeM: eye, targetM: target });
      eye = add(eye, right, move.truck * D);
      target = add(target, right, move.truck * D);
    }
    // A move never takes the eye into a hillside: lift it clear instead.
    const floor = floorAt(eye);
    if (eye[1] < floor) eye = [eye[0], floor, eye[2]];
  }
  let userScale = 1;
  if (user && (user.fx || user.rx || user.uy)) {
    const { forward, right, up } = cameraBasis({ eyeM: eye, targetM: target });
    const v = add(add(add([0, 0, 0], forward, user.fx * D), right, user.rx * D), up, user.uy * D);
    // Fly as far along the offset as the ground allows: the first sample
    // that would put the eye under its clearance stops the flight there.
    const need = Math.min(0, marginAt(eye));
    if (heightAt || Number.isFinite(waterLevelM)) {
      const step = Number.isFinite(sampleStepM) && sampleStepM > 0 ? sampleStepM : DEFAULT_SAMPLE_STEP_M;
      const n = Math.min(CLEARANCE_SAMPLES_MAX, Math.max(CLEARANCE_SAMPLES_MIN, Math.ceil(Math.hypot(...v) / step)));
      for (let i = 1; i <= n; i++) {
        const s = i / n, p = add(eye, v, s);
        if (marginAt(p) >= need) continue;
        // Refine between the last clear sample and this one, so an easing
        // zoom slows to a stop instead of stepping sample to sample.
        let lo = (i - 1) / n, hi = s;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2, q = add(eye, v, mid);
          if (marginAt(q) >= need) lo = mid; else hi = mid;
        }
        userScale = lo;
        break;
      }
    }
    eye = add(eye, v, userScale);
    target = add(target, v, userScale);
  }
  return { eyeM: eye, targetM: target, fovYDeg: pose.fovYDeg, userScale };
}

/**
 * The listener's zoom. Input calls zoomAt(); the scene reads sample() once
 * per frame (eased, real-time, not song time) and reports back through
 * noteFrame() the frustum it drew with and how far the terrain let it fly.
 */
export class RangeUserCamera {
  constructor({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
    this._now = now;
    this.reset();
  }

  reset() {
    this.target = { fx: 0, rx: 0, uy: 0 };
    this.current = { fx: 0, rx: 0, uy: 0 };
    this._sampledAt = null;
    this.userScale = 1;
    this.tan = { x: Math.tan((35 * Math.PI) / 360) * (16 / 9), y: Math.tan((35 * Math.PI) / 360) };
    this.lastFrameAt = -Infinity;
  }

  /** Whether a Range view drew recently enough for input to mean zoom. */
  isActive(now = this._now()) { return now - this.lastFrameAt < 600; }

  get zoomed() { return this.target.fx > 1e-4 || this.current.fx > 1e-4; }

  /** The scene's frame report: the drawn frustum's half-angle tangents and
   *  the fraction of the user offset the terrain allowed. */
  noteFrame({ tanX, tanY, userScale = 1, frameId = null } = {}) {
    // Both views draw during view-to-view travel: within one frame the
    // narrower cone and the shorter flight win.
    if (frameId != null && frameId === this._frameId) {
      tanX = Math.min(tanX, this._frameTan.x);
      tanY = Math.min(tanY, this._frameTan.y);
      userScale = Math.min(userScale, this.userScale);
    }
    this._frameId = frameId;
    this._frameTan = { x: tanX, y: tanY };
    if (Number.isFinite(tanX) && tanX > 0 && Number.isFinite(tanY) && tanY > 0
      && (tanX !== this.tan.x || tanY !== this.tan.y)) {
      // A new view (or a resize) can narrow the cone: re-clamp both offsets.
      this.tan = { x: tanX, y: tanY };
      this._clampToCone(this.target);
      this._clampToCone(this.current);
    }
    this.userScale = clamp(Number.isFinite(userScale) ? userScale : 1, 0, 1);
    this.lastFrameAt = this._now();
  }

  /**
   * Zoom by `factor` (> 1 in, < 1 out) toward the point at normalized
   * device coordinates (ndcX, ndcY), -1..1 with y up. Each step covers the
   * same fraction of the distance left to the target, so zoom feels even.
   */
  zoomAt(factor, ndcX = 0, ndcY = 0) {
    if (!(factor > 0) || factor === 1) return;
    // Ground stopped the flight short: start from where the camera is.
    if (this.userScale < 0.999) {
      for (const o of [this.target, this.current]) { o.fx *= this.userScale; o.rx *= this.userScale; o.uy *= this.userScale; }
      this.userScale = 1;
    }
    const t = this.target;
    const remaining = 1 - t.fx;
    const step = remaining - remaining / factor;
    const nx = clamp(ndcX, -1, 1), ny = clamp(ndcY, -1, 1);
    const fx0 = t.fx;
    t.fx = clamp(t.fx + step, 0, USER_FX_MAX);
    // Zooming in heads toward the pointer, by the forward distance actually
    // taken (at the cap, none: no sideways pan). Zooming out backs straight
    // out and lets the cone clamp below recentre the frame.
    const taken = t.fx - fx0;
    if (taken > 0) {
      t.rx += taken * nx * this.tan.x;
      t.uy += taken * ny * this.tan.y;
    }
    if (t.fx < 1e-4) { t.fx = 0; t.rx = 0; t.uy = 0; }
    this._clampToCone(t);
  }

  /** Keep an offset inside the authored view cone (see header), a hair in. */
  _clampToCone(o) {
    const cx = o.fx * this.tan.x * 0.98, cy = o.fx * this.tan.y * 0.98;
    o.rx = clamp(o.rx, -cx, cx);
    o.uy = clamp(o.uy, -cy, cy);
  }

  /** The eased offset for this frame. */
  sample(now = this._now()) {
    const dt = this._sampledAt == null ? 1 : Math.max(0, (now - this._sampledAt) / 1000);
    this._sampledAt = now;
    const k = 1 - Math.exp(-dt / USER_EASE_SEC);
    const c = this.current, t = this.target;
    for (const key of ['fx', 'rx', 'uy']) {
      c[key] += (t[key] - c[key]) * k;
      if (Math.abs(t[key] - c[key]) < 1e-5) c[key] = t[key];
    }
    return { fx: c.fx, rx: c.rx, uy: c.uy };
  }
}

/** The page's one listener camera: main.js feeds it input, the Range frame
 *  snapshots it, RangeScene reports back to it. */
export const rangeUserCamera = new RangeUserCamera();
