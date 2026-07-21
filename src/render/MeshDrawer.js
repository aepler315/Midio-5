// Applies a per-frame pose transform to a rest-pose mesh and strokes each
// edge with a color derived purely from its own geometry (follow-up item
// 1): hue from the edge's screen-space angle, brightness/glow from how far
// its current length has deformed from rest. Squash-and-stretch, jaw
// snaps, and neck bobs all become visible motion this way, for free.
import { curl2 } from '../utils/fields.js';

/** Precompute each edge's local (undeformed) length once per mesh. */
export function computeRestLengths(mesh) {
  return mesh.edges.map(([i, j]) => {
    const a = mesh.vertices[i], b = mesh.vertices[j];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
}

/** Matches canvas composition order translate*rotate*scale applied to v. */
export function applyTransform(v, { tx = 0, ty = 0, rot = 0, scaleX = 1, scaleY = 1 }) {
  const sx = v.x * scaleX, sy = v.y * scaleY;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return { x: tx + sx * cos - sy * sin, y: ty + sx * sin + sy * cos };
}

/**
 * Draws one mesh part already resolved to screen-space points.
 * @param {{x:number,y:number}[]} points same length/order as mesh.vertices
 */
export function drawMeshEdges(ctx, mesh, restLengths, points, baseHueDeg, {
  satBase = 68, lightBase = 52, glowBoost = 34, alpha = 0.9, widthBase = 1.6, widthGlow = 2.0,
  hueSpread = 50, // edges vary within +/-hueSpread/2 of baseHueDeg, not the full wheel -- a cohesive character, not a rainbow
  outline = false, // true -> a near-black contour pass UNDER the spectral stroke: the silhouette reads razor-sharp against the glow underlays
} = {}) {
  if (outline) {
    const o = outline === true ? {} : outline;
    ctx.save();
    ctx.strokeStyle = o.color || 'rgba(7,10,20,0.85)';
    ctx.lineWidth = widthBase + (o.widthAdd ?? 2.4);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [i, j] of mesh.edges) {
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[j].x, points[j].y);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (let e = 0; e < mesh.edges.length; e++) {
    const [i, j] = mesh.edges[e];
    const a = points[i], b = points[j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // Fold angle into [0,180) first (an edge and its reverse are the same
    // line), then map that half-turn onto the hue band.
    const angleDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 180;
    const hue = (baseHueDeg + (angleDeg / 180) * hueSpread - hueSpread / 2 + 360) % 360;
    const rest = restLengths[e];
    const deform = rest > 0.001 ? Math.abs(len - rest) / rest : 0;
    const glow = Math.min(1, deform * 3);

    const light = Math.min(88, lightBase + glow * glowBoost);
    const sat = Math.min(100, satBase + glow * 22);

    if (glow > 0.15) {
      ctx.strokeStyle = `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${(alpha * 0.35).toFixed(2)})`;
      ctx.lineWidth = widthBase + widthGlow * glow + 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.strokeStyle = `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${alpha})`;
    ctx.lineWidth = widthBase + widthGlow * glow;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

/** Convenience: transform every vertex of a mesh with a single rigid transform, then draw. */
export function drawMeshPart(ctx, mesh, restLengths, transform, baseHueDeg, options) {
  const points = mesh.vertices.map((v) => applyTransform(v, transform));
  drawMeshEdges(ctx, mesh, restLengths, points, baseHueDeg, options);
  return points;
}

/**
 * Additive soft halo: a hue-tinted radial gradient (opaque center -> fully
 * transparent edge) filled into an ellipse. Stands in for the old "blurred,
 * enlarged, additive mesh copy" under-glow trick without a `ctx.filter`
 * blur -- on mobile Canvas2D every `filter` use forces an offscreen layer
 * allocation + GPU flush, which a plain gradient fill avoids entirely.
 */
export function drawGlowHalo(ctx, cx, cy, rx, ry, hueDeg, alpha, { sat = 70, light = 74 } = {}) {
  if (alpha <= 0.002 || rx <= 0.5 || ry <= 0.5) return;
  const r = Math.max(rx, ry);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `hsl(${hueDeg.toFixed(0)},${sat}%,${light}%)`);
  g.addColorStop(1, `hsla(${hueDeg.toFixed(0)},${sat}%,${light}%,0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The salvia melt: every vertex flows through a slow divergence-free
 * curl-noise field, so the form is never at rest -- a liquid instrument
 * rather than a rigid glyph. Two incommensurate field samples blend so
 * the flow never settles into a loop. Rest lengths are NOT recomputed:
 * the melt registers as continuous edge deformation, which the drawer
 * turns into shifting glow and hue -- the body itself plays.
 */
export function meltMesh(mesh, cx, cy, tSec, amt, seed = 0) {
  if (amt <= 0.02) return mesh;
  const vertices = mesh.vertices.map((v) => {
    const dx = v.x - cx, dy = v.y - cy;
    if (dx * dx + dy * dy < 4) return v; // the hub holds still: a fixed heart in a flowing body
    const f = curl2((v.x + seed * 37.7) * 0.028, (v.y - seed * 11.3) * 0.028, tSec * 0.21 + seed);
    const g = curl2((v.y + seed * 5.1) * 0.041, v.x * 0.041, tSec * 0.34 - seed * 2);
    return { x: v.x + (f.x * 0.7 + g.x * 0.3) * amt, y: v.y + (f.y * 0.7 + g.y * 0.3) * amt };
  });
  return { vertices, edges: mesh.edges };
}

/**
 * Per-vertex lerp between two meshes that share vertex count and edge
 * topology (spec: the Apotheosis morph) -- t=0 is exactly meshA, t=1 is
 * exactly meshB, continuous in between. Edges are taken from meshA since
 * the two are required to be topologically identical.
 */
export function lerpMesh(meshA, meshB, t) {
  if (t <= 0) return meshA;
  if (t >= 1) return meshB;
  const vertices = meshA.vertices.map((v, i) => {
    const w = meshB.vertices[i];
    return { x: v.x + (w.x - v.x) * t, y: v.y + (w.y - v.y) * t };
  });
  return { vertices, edges: meshA.edges };
}

/**
 * Radially displace a mesh's vertices about (cx,cy) by a ModalRing-style
 * field (anything with .energy and .displacementAt(theta)). Rest lengths
 * are intentionally NOT recomputed: displacement changes edge lengths
 * relative to rest, which is exactly what drives the glow/brightness in
 * drawMeshEdges -- the vibration lights the wireframe up for free.
 */
export function displaceMeshRadial(mesh, cx, cy, field) {
  if (!field || field.energy < 0.05) return mesh;
  const vertices = mesh.vertices.map((v) => {
    const dx = v.x - cx, dy = v.y - cy;
    const r = Math.hypot(dx, dy);
    if (r < 2) return v; // hub vertex: no radial direction to displace along
    const s = (r + field.displacementAt(Math.atan2(dy, dx))) / r;
    return { x: cx + dx * s, y: cy + dy * s };
  });
  return { vertices, edges: mesh.edges };
}
