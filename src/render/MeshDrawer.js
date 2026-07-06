// Wire-mesh character renderer (item 1). Takes a static mesh, applies pose
// transforms on the CPU, and strokes each edge with a color derived from its
// local orientation and deformation. Deformation (how far the transformed edge
// length deviates from its rest length) drives lightness/glow, so squash-stretch,
// jaw snaps, neck bobs, etc. literally light up the moving parts.
import { MIDIO_MESH, BROSHI_MESH, MIDASUS_MESH } from './meshes.js';
import { clamp, lerp } from '../utils/math.js';

// Per-character draw scale (graphics refinement pass). Meshes are authored
// small (~50px tall); each character has its own multiplier at draw sites.
export const CHAR_SCALE_BASE = 2.5;
export const CHAR_SCALE = CHAR_SCALE_BASE; // deprecated alias
export const MIDIO_SCALE   = 2.5 * 1.23; // 3.075
export const BROSHI_SCALE  = 2.5 * 1.18; // 2.95
export const MIDASUS_SCALE = 2.5 * 1.18; // 2.95

const meshes = new WeakMap(); // mesh → { restLengths[], restAngles[] }

function ensureCache(mesh) {
  let c = meshes.get(mesh);
  if (!c) {
    const vs = mesh.vertices;
    const restLengths = new Float32Array(mesh.edges.length);
    const restAngles = new Float32Array(mesh.edges.length);
    for (let i = 0; i < mesh.edges.length; i++) {
      const [a, b] = mesh.edges[i];
      const dx = vs[b].x - vs[a].x;
      const dy = vs[b].y - vs[a].y;
      restLengths[i] = Math.hypot(dx, dy);
      restAngles[i] = Math.atan2(dy, dx);
    }
    c = { restLengths, restAngles };
    meshes.set(mesh, c);
  }
  return c;
}

function rotate(p, cx, cy, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const x = p.x - cx, y = p.y - cy;
  return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
}

function transformVertices(mesh, pose) {
  const out = new Array(mesh.vertices.length);
  const { x = 0, y = 0, scaleX = 1, scaleY = 1, leanDeg = 0, spin = 0,
          jawOpen = 0, neckAngle = 0, armFlare = 0, tailAngle = 0 } = pose;

  // Group-aware local transforms for Broshi's hinged jaw / head / tail.
  const jawAngle = jawOpen * 0.55; // radians
  const headAngle = (neckAngle * Math.PI) / 180;
  const tailSway = (tailAngle * Math.PI) / 180;
  const lean = (leanDeg * Math.PI) / 180;

  // Broshi jaw hinge is vertex 18; head pivot vertex 12; tail root vertex 11.
  const isBroshi = mesh === BROSHI_MESH;
  const jawHinge = isBroshi ? mesh.vertices[18] : null;
  const headPivot = isBroshi ? mesh.vertices[12] : null;
  const tailPivot = isBroshi ? mesh.vertices[11] : null;

  // Arm flare for Midio superhero pose (push arms outward).
  const isMidio = mesh === MIDIO_MESH;

  for (let i = 0; i < mesh.vertices.length; i++) {
    let p = mesh.vertices[i];

    // Sub-mesh transforms in local space.
    if (isBroshi) {
      if (p.group === 'jaw') p = rotate(p, jawHinge.x, jawHinge.y, jawAngle);
      else if (p.group === 'head') p = rotate(p, headPivot.x, headPivot.y, headAngle);
      else if (p.group === 'tail') p = rotate(p, tailPivot.x, tailPivot.y, tailSway);
    }
    if (isMidio && armFlare && p.y < -30) {
      const dir = p.x > 0 ? 1 : -1;
      p = { x: p.x + dir * armFlare * 8, y: p.y - armFlare * 5 };
    }

    // Global scale + lean + spin.
    let tx = p.x * scaleX;
    let ty = p.y * scaleY;
    if (spin) {
      const r = rotate({ x: tx, y: ty }, 0, -27 * scaleY, spin);
      tx = r.x; ty = r.y;
    }
    const cos = Math.cos(lean), sin = Math.sin(lean);
    const rx = tx * cos - ty * sin;
    const ry = tx * sin + ty * cos;
    out[i] = { x: x + rx, y: y + ry };
  }
  return out;
}

function edgeColor(baseHue, angle, deform, alpha, goldPulse = 0, energy = 0) {
  const hue = (baseHue + (angle * 180) / Math.PI) % 360;
  const light = 52 + 38 * deform + 12 * energy;
  const sat = 82 + 16 * deform;
  const a = clamp(alpha + goldPulse * 0.55 + energy * 0.25, 0, 1);
  return `hsla(${hue},${sat}%,${light}%,${a})`;
}

function drawAura(ctx, tv, baseHue, energy = 0, goldPulse = 0) {
  let cx = 0, cy = 0, n = 0;
  for (const p of tv) { cx += p.x; cy += p.y; n++; }
  if (!n) return;
  cx /= n; cy /= n;
  const r = 38 + 28 * energy + 18 * goldPulse;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `hsla(${baseHue}, 90%, 72%, ${0.22 + energy * 0.18})`);
  g.addColorStop(0.45, `hsla(${baseHue}, 85%, 55%, ${0.10 + goldPulse * 0.12})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function fillMesh(ctx, mesh, tv, baseHue, energy = 0) {
  if (!mesh.fillLoops || mesh.fillLoops.length === 0) return;
  ctx.save();
  for (let li = 0; li < mesh.fillLoops.length; li++) {
    const loop = mesh.fillLoops[li];
    ctx.fillStyle = li === 0
      ? `hsla(${baseHue}, 68%, ${22 + energy * 8}%, ${0.42 + energy * 0.12})`
      : `hsla(${baseHue}, 62%, 32%, ${0.28 + energy * 0.08})`;
    ctx.beginPath();
    for (let i = 0; i < loop.length; i++) {
      const p = tv[loop[i]];
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawMesh(ctx, mesh, pose, baseHue, opts = {}) {
  const { fill = false, lineWidth = 2.2, glow = true, goldPulse = 0, energy = 0, aura = true } = opts;
  const { restLengths, restAngles } = ensureCache(mesh);
  const tv = transformVertices(mesh, pose);

  const uniformScale = Math.sqrt(Math.abs((pose.scaleX || 1) * (pose.scaleY || 1))) || 1;

  if (aura && (energy > 0.05 || goldPulse > 0.05 || glow)) drawAura(ctx, tv, baseHue, energy, goldPulse);
  if (fill) fillMesh(ctx, mesh, tv, baseHue, energy);

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (glow) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < mesh.edges.length; i++) {
      const [a, b] = mesh.edges[i];
      const p0 = tv[a], p1 = tv[b];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const effectiveRest = restLengths[i] * uniformScale;
      const deform = effectiveRest > 0 ? Math.abs(len - effectiveRest) / effectiveRest : 0;
      const glowAmt = deform + energy * 0.12;
      if (glowAmt < 0.05) continue;
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      ctx.strokeStyle = edgeColor(baseHue, ang, deform, 0.38 + energy * 0.15, goldPulse, energy);
      ctx.lineWidth = lineWidth + 5 * glowAmt;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    ctx.lineWidth = lineWidth;
  }

  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < mesh.edges.length; i++) {
    const [a, b] = mesh.edges[i];
    const p0 = tv[a], p1 = tv[b];
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const effectiveRest = restLengths[i] * uniformScale;
    const deform = effectiveRest > 0 ? Math.abs(len - effectiveRest) / effectiveRest : 0;
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    ctx.strokeStyle = edgeColor(baseHue, ang, deform, 0.95, goldPulse, energy);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  ctx.restore();
}


export { MIDIO_MESH, BROSHI_MESH, MIDASUS_MESH };