/** Project an inferred strip-space point through the same live crest as the fill. */
export function projectSurfacePoint({ sx, depth01 }, { geom, stripWidth, terrain }) {
  if (!geom?.pts?.length || !Number.isFinite(sx) || !Number.isFinite(depth01)) return null;
  if (terrain && (sx < 0 || sx > stripWidth)) return null;
  const pts = geom.pts;
  if (sx < pts[0].stripX || sx > pts[pts.length - 1].stripX) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pts[m].stripX < sx) lo = m; else hi = m;
  }
  const a = pts[lo], b = pts[hi], t = (sx - a.stripX) / Math.max(1e-9, b.stripX - a.stripX);
  const x = a.x + (b.x - a.x) * t;
  const crest = a.y + (b.y - a.y) * t;
  const dy = (a.dy || 0) + ((b.dy || 0) - (a.dy || 0)) * t;
  return { x, y: crest + depth01 * (geom.bottomY + dy - crest) };
}

export function surfaceCopies(width, minSx, maxSx, terrain) {
  if (terrain) return [0];
  const first = Math.floor(minSx / width), last = Math.floor(maxSx / width);
  const offsets = [];
  for (let i = first; i <= last; i++) offsets.push(i * width);
  return offsets;
}

function clipEdge(vertices, boundary, keep) {
  const out = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const insideA = keep(a.sx), insideB = keep(b.sx);
    if (insideA) out.push(a);
    if (insideA !== insideB && a.sx !== b.sx) {
      const t = (boundary - a.sx) / (b.sx - a.sx);
      out.push({ sx: boundary, depth01: a.depth01 + (b.depth01 - a.depth01) * t });
    }
  }
  return out;
}

function projectedPath(ctx, vertices, offset, projection) {
  const pts = projection.geom.pts;
  const minSx = pts[0].stripX, maxSx = pts.at(-1).stripX;
  let clipped = clipEdge(vertices.map(v => ({ sx: v.sx + offset, depth01: v.depth01 })), minSx, x => x >= minSx);
  clipped = clipEdge(clipped, maxSx, x => x <= maxSx);
  if (clipped.length < 3) return false;
  const segments = [];
  for (let i = 0; i < clipped.length; i++) {
    const a = clipped[i], b = clipped[(i + 1) % clipped.length];
    const n = Math.max(1, Math.ceil(Math.abs(b.sx - a.sx) / 16));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const p = projectSurfacePoint({ sx: a.sx + (b.sx - a.sx) * t,
        depth01: a.depth01 + (b.depth01 - a.depth01) * t }, projection);
      if (p) segments.push(p);
    }
  }
  if (segments.length < 3) return false;
  ctx.beginPath();
  ctx.moveTo(segments[0].x, segments[0].y);
  for (let i = 1; i < segments.length; i++) ctx.lineTo(segments[i].x, segments[i].y);
  ctx.closePath();
  return true;
}

export function drawRidgeSurface(ctx, { surface, geom, terrain = false, policy, budget, light, alpha = 1 }) {
  if (!surface || !geom?.pts?.length) return;
  const projection = { geom, stripWidth: surface.width, terrain };
  const offsets = surfaceCopies(surface.width, geom.pts[0].stripX,
    geom.pts[geom.pts.length - 1].stripX, terrain);
  const minX = geom.pts[0].stripX - 64, maxX = geom.pts.at(-1).stripX + 64;
  const centerX = (geom.pts[0].x + geom.pts.at(-1).x) * .5;
  const halfWidth = Math.max(1, (geom.pts.at(-1).x - geom.pts[0].x) * .5);
  const lightX = Number.isFinite(light?.x) ? Math.max(-1, Math.min(1, (light.x - centerX) / halfWidth)) : -.5;
  const lightIntensity = Math.max(0, Math.min(1, light?.intensity ?? 1));
  ctx.save();
  for (const offset of offsets) {
    let faceCount = 0;
    for (const facet of surface.facets) {
      if (facet.vertices.every(v => v.sx + offset < minX)
        || facet.vertices.every(v => v.sx + offset > maxX)) continue;
      if (faceCount++ >= budget.facetsPerLayer) break;
      if (!projectedPath(ctx, facet.vertices, offset, projection)) continue;
      const facing = Math.max(0, Math.min(1, .5 + facet.normalX * lightX * .4));
      ctx.fillStyle = facing > .5 ? `rgba(244,232,204,${(alpha * (facing - .5) * .14 * lightIntensity).toFixed(3)})`
        : `rgba(5,14,20,${(alpha * (.5 - facing) * .24).toFixed(3)})`;
      ctx.fill();
    }
    let gullyCount = 0;
    for (const gully of surface.gullies) {
      if (gully.points.every(v => v.sx + offset < minX)
        || gully.points.every(v => v.sx + offset > maxX)) continue;
      if (gullyCount++ >= budget.gulliesPerLayer) break;
      const points = gully.points.map(p => projectSurfacePoint({ sx: p.sx + offset, depth01: p.depth01 }, projection));
      if (points.some(p => !p)) continue;
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.lineWidth = gully.widthPx;
      ctx.strokeStyle = `rgba(5,15,18,${(alpha * .17).toFixed(3)})`;
      ctx.stroke();
    }
    let standCount = 0;
    if (policy?.canopy > .2) for (const stand of surface.stands) {
      if (stand.sx + offset < minX || stand.sx + offset > maxX) continue;
      if (standCount++ >= budget.standsPerLayer) break;
      const p = projectSurfacePoint({ sx: stand.sx + offset, depth01: stand.depth01 }, projection);
      if (!p) continue;
      ctx.fillStyle = `rgba(9,27,23,${(alpha * .22).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, stand.widthPx * .5, stand.heightPx * .55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
