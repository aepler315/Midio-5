// Wire-mesh character renderer (item 1). Takes a static mesh, applies pose
// transforms on the CPU, and strokes each edge with a color derived from its
// local orientation and deformation. Deformation (how far the transformed edge
// length deviates from its rest length) drives lightness/glow, so squash-stretch,
// jaw snaps, neck bobs, etc. literally light up the moving parts.
import { MIDIO_MESH, BROSHI_MESH, MIDASUS_MESH } from './meshes.js';
import { clamp, lerp } from '../utils/math.js';

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

function edgeColor(baseHue, angle, deform, alpha, goldPulse = 0) {
  // Hue from edge orientation rotated by character base hue.
  const hue = (baseHue + (angle * 180) / Math.PI) % 360;
  // Deformation → lightness boost and saturation/glow.
  const light = 45 + 20 * deform;
  const sat = 70 + 10 * deform;
  const a = alpha + goldPulse * 0.35;
  return `hsla(${hue},${sat}%,${light}%,${clamp(a, 0, 1)})`;
}

export function drawMesh(ctx, mesh, pose, baseHue, opts = {}) {
  const { fill = false, lineWidth = 1.5, glow = true, goldPulse = 0 } = opts;
  const { restLengths, restAngles } = ensureCache(mesh);
  const tv = transformVertices(mesh, pose);

  if (fill) {
    ctx.save();
    ctx.fillStyle = `hsla(${baseHue}, 50%, 10%, 0.35)`;
    ctx.beginPath();
    for (let i = 0; i < mesh.edges.length; i++) {
      const [a, b] = mesh.edges[i];
      const p0 = tv[a], p1 = tv[b];
      if (i === 0) ctx.moveTo(p0.x, p0.y); else ctx.lineTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  // First pass: high-deform edges get an additive glow.
  if (glow) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < mesh.edges.length; i++) {
      const [a, b] = mesh.edges[i];
      const p0 = tv[a], p1 = tv[b];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const deform = restLengths[i] > 0 ? Math.abs(len - restLengths[i]) / restLengths[i] : 0;
      if (deform < 0.18) continue;
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      ctx.strokeStyle = edgeColor(baseHue, ang, deform, 0.28, goldPulse);
      ctx.lineWidth = lineWidth + 3 * deform;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    ctx.lineWidth = lineWidth;
  }

  // Second pass: every edge, base stroke.
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < mesh.edges.length; i++) {
    const [a, b] = mesh.edges[i];
    const p0 = tv[a], p1 = tv[b];
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const deform = restLengths[i] > 0 ? Math.abs(len - restLengths[i]) / restLengths[i] : 0;
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    ctx.strokeStyle = edgeColor(baseHue, ang, deform, 0.9, goldPulse);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  ctx.restore();
}

export { MIDIO_MESH, BROSHI_MESH, MIDASUS_MESH };