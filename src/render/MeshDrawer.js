// Applies a per-frame pose transform to a rest-pose mesh and strokes each
// edge with a color derived purely from its own geometry (follow-up item
// 1): hue from the edge's screen-space angle, brightness/glow from how far
// its current length has deformed from rest. Squash-and-stretch, jaw
// snaps, and neck bobs all become visible motion this way, for free.

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
} = {}) {
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
