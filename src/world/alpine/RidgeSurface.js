import { landscapePolicy } from './LandscapePolicy.js';

function randomFrom(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function emptySurface(width, biomeKey) {
  return { version: 2, width: width || 0, biomeKey, byteLength: 128, facets: [], gullies: [], stands: [], valleys: [] };
}

function smoothCopy(vals, step) {
  const radius = Math.max(1, Math.round(24 / Math.max(step, 1e-6)));
  const out = new Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    let sum = 0, n = 0;
    const a = Math.max(0, i - radius), b = Math.min(vals.length - 1, i + radius);
    for (let j = a; j <= b; j++) { sum += vals[j]; n++; }
    out[i] = sum / n;
  }
  return out;
}

function normalize3(x, y, z) {
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-8)) return { x: 0, y: 0, z: 1 };
  return { x: x / len, y: y / len, z: z / len };
}

/** Walk from a crest minimum out to the saddles where the slope reverses. */
function saddlesAround(smooth, i) {
  let l = i, lo = smooth[i];
  while (l > 0 && smooth[l - 1] >= smooth[l]) { l--; lo = Math.max(lo, smooth[l]); }
  let r = i, ro = smooth[i];
  while (r < smooth.length - 1 && smooth[r + 1] >= smooth[r]) { r++; ro = Math.max(ro, smooth[r]); }
  return { left: l, right: r, prominence: Math.min(lo, ro) - smooth[i] };
}

function selectSummits(smooth, step) {
  const found = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    if (!(smooth[i] < smooth[i - 1] && smooth[i] <= smooth[i + 1])) continue;
    const span = saddlesAround(smooth, i);
    if (!(span.prominence > 0)) continue;
    found.push({ i, ...span });
  }
  found.sort((a, b) => b.prominence - a.prominence || a.i - b.i);
  const minPx = 64;
  const kept = [];
  for (const peak of found) {
    if (kept.length >= 24) break;
    if (kept.some((k) => Math.abs(k.i - peak.i) * step < minPx)) continue;
    kept.push(peak);
  }
  kept.sort((a, b) => a.i - b.i);
  return kept;
}

function face(id, intervalId, vertices, facing, tone, importance, material) {
  return {
    id, intervalId, vertices,
    normal: normalize3(facing * 0.62, -0.22, 0.75),
    material, intrinsicTone: tone, importance, structural: true,
  };
}

function slopeFace(sx0, sx1, id, intervalId, facing, tone, importance, material, width) {
  const lo = Math.max(0, Math.min(width, Math.min(sx0, sx1)));
  const hi = Math.max(0, Math.min(width, Math.max(sx0, sx1)));
  const crest = facing < 0 ? hi : lo;
  const foot = facing < 0 ? lo : hi;
  const mid = (crest + foot) * 0.5;
  return face(id, intervalId, [
    { sx: crest, depth01: 0 },
    { sx: foot, depth01: 0.1 },
    { sx: foot, depth01: 0.74 },
    { sx: mid, depth01: 0.86 },
    { sx: crest, depth01: 0.4 },
  ], facing, tone, importance, material);
}

function coverKind(policy) {
  if (policy.cover === 'broadleaf') return 'broadleaf';
  if (policy.cover === 'scrub') return 'scrub';
  if (policy.cover === 'grass' || policy.cover === 'mat') return policy.cover === 'mat' ? 'mat' : 'grass';
  if (policy.cover === 'ice' || policy.cover === 'sand' || policy.cover === 'stone') return policy.cover;
  return 'conifer';
}

function coverVertices(sx, widthSrc, kind, rand, stripWidth) {
  const low = kind === 'grass' || kind === 'mat' || kind === 'scrub' || kind === 'sand' || kind === 'stone' || kind === 'ice';
  const top = low ? 0.18 : 0.04;
  const bot = kind === 'grass' || kind === 'mat' ? 0.34 : kind === 'scrub' || kind === 'sand' ? 0.46 : kind === 'conifer' ? 0.7 : 0.58;
  const lobes = kind === 'conifer' ? 4 : kind === 'broadleaf' ? 3 : 2;
  const verts = [];
  const steps = lobes * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wobble = (rand() - 0.5) * (kind === 'conifer' ? 0.06 : 0.14);
    const arch = kind === 'broadleaf' ? Math.sin(t * Math.PI) * 0.08 : kind === 'conifer' && i % 2 === 1 ? -0.05 : 0;
    verts.push({
      sx: Math.max(0, Math.min(stripWidth, sx + widthSrc * (t - 0.5))),
      depth01: Math.max(0, Math.min(1, top + wobble * 0.2 + arch)),
    });
  }
  verts.push({ sx: Math.max(0, Math.min(stripWidth, sx + widthSrc * 0.42)), depth01: bot });
  verts.push({ sx: Math.max(0, Math.min(stripWidth, sx - widthSrc * 0.42)), depth01: bot });
  return verts;
}

function accountBytes(surface) {
  const facet = surface.facets.reduce((n, f) => n + 180 + f.vertices.length * 48, 0);
  const gully = surface.gullies.reduce((n, g) => n + 140 + g.points.length * 40 + g.widthsSource.length * 16, 0);
  const stand = surface.stands.reduce((n, s) => n + 160 + s.vertices.length * 40, 0);
  return 256 + facet + gully + stand + surface.valleys.length * 120;
}

/**
 * Version 2 descriptors. The sampled skyline is never written.
 * Faces, cover, gullies and edge variation use separate salts.
 */
export function buildRidgeSurface({ seed, biomeKey, layerKey, width, ridgeYs, step, bottomY }) {
  if (!ridgeYs?.length || !(width > 0) || !(step > 0) || !(bottomY > 0)) return emptySurface(width, biomeKey);
  const policy = landscapePolicy(biomeKey);
  const key = `${seed}:${biomeKey}:${layerKey}`;
  const faceRand = randomFrom(`${key}:surface:facets`);
  const coverRand = randomFrom(`${key}:surface:cover`);
  const gullyRand = randomFrom(`${key}:surface:gullies`);
  const edgeRand = randomFrom(`${key}:surface:edge`);
  const vals = Array.from(ridgeYs);
  const smooth = smoothCopy(vals, step);
  let hi = -Infinity, lo = Infinity;
  for (const y of smooth) { if (y > hi) hi = y; if (y < lo) lo = y; }
  const extent = hi - lo;
  const sxAt = (i) => Math.max(0, Math.min(width, i * step));
  const facets = [];
  const gullies = [];
  const stands = [];
  const valleys = [];
  const covered = [];
  const material = policy.cover === 'ice' ? 'ice' : policy.cover === 'sand' ? 'sand' : 'stone';

  if (extent >= 7) {
    const minProm = Math.max(5, extent * 0.075);
    for (const peak of selectSummits(smooth, step)) {
      if (peak.prominence < minProm) continue;
      const peakSx = sxAt(peak.i);
      const leftSx = sxAt(peak.left);
      const rightSx = sxAt(peak.right);
      const intervalId = `${Math.round(leftSx)}-${Math.round(rightSx)}`;
      const importance = peak.prominence / Math.max(extent, 1);
      const tone = Math.max(0.35, Math.min(0.7, 0.4 + importance * 0.3));
      if (peakSx - leftSx >= 12) {
        facets.push(slopeFace(leftSx, peakSx, `${key}:face:${intervalId}:L`, intervalId, -1, -tone, importance, material, width));
      }
      if (rightSx - peakSx >= 12) {
        facets.push(slopeFace(peakSx, rightSx, `${key}:face:${intervalId}:R`, intervalId, 1, tone, importance, material, width));
      }
      // A narrow summit still owns a crest vertex so an off-grid peak is not dropped.
      if (peakSx - leftSx < 12 && rightSx - peakSx < 12) {
        facets.push(face(`${key}:face:${intervalId}:P`, intervalId, [
          { sx: peakSx, depth01: 0 },
          { sx: Math.max(0, peakSx - 18), depth01: 0.55 },
          { sx: Math.min(width, peakSx + 18), depth01: 0.55 },
        ], faceRand() < 0.5 ? -1 : 1, tone, importance, material));
      }
      covered.push([leftSx, rightSx]);
      valleys.push({
        id: `${key}:valley:${intervalId}`, sx0: leftSx, sx1: rightSx,
        depth01: 0.53, importance,
      });
      if (gullies.length < 32 && rightSx - leftSx > 36) {
        const gx = (leftSx + rightSx) * 0.5;
        const sway = (gullyRand() - 0.5) * Math.min(24, (rightSx - leftSx) * 0.15);
        gullies.push({
          id: `${key}:gully:${intervalId}`,
          points: [
            { sx: Math.max(0, Math.min(width, gx)), depth01: 0.08 },
            { sx: Math.max(0, Math.min(width, gx + sway)), depth01: 0.46 },
            { sx: Math.max(0, Math.min(width, gx + sway * 0.4)), depth01: 0.82 },
          ],
          widthsSource: [2.4 + gullyRand(), 1.2, 0.35],
        });
      }
    }
  }

  const claimed = (sx) => covered.some(([a, b]) => sx >= a && sx <= b);
  const panelSpan = Math.max(180, step * 48);
  for (let x = 0; x < width - panelSpan * 0.65 && facets.length < 40; x += panelSpan) {
    const mid = x + panelSpan * 0.5;
    if (claimed(mid)) continue;
    const intervalId = `panel:${Math.round(x)}`;
    const tone = (facets.length % 2 === 0 ? 1 : -1) * 0.08;
    facets.push(face(`${key}:panel:${intervalId}`, intervalId, [
      { sx: x, depth01: 0.06 },
      { sx: Math.min(width, x + panelSpan), depth01: 0.08 },
      { sx: Math.min(width, x + panelSpan * 0.82), depth01: 0.7 },
      { sx: x + panelSpan * 0.18, depth01: 0.66 },
    ], tone < 0 ? -1 : 1, tone, 0.15, material));
  }

  const kind = coverKind(policy);
  if (policy.canopy > 0.2 && kind !== 'sand' && kind !== 'stone' && kind !== 'ice') {
    const spacing = kind === 'grass' || kind === 'mat' ? 220 : 150;
    for (let sx = spacing * 0.5; sx < width - 40 && stands.length < 48; sx += spacing) {
      const i = Math.min(smooth.length - 2, Math.max(1, Math.round(sx / step)));
      const slope = Math.abs(smooth[i + 1] - smooth[i - 1]) / (2 * step);
      if (slope > 0.55 || coverRand() > policy.canopy) continue;
      const widthSrc = (kind === 'broadleaf' ? 70 : kind === 'conifer' ? 46 : 34) + coverRand() * 16;
      const at = Math.max(widthSrc, Math.min(width - widthSrc, sx + (coverRand() - 0.5) * 20));
      const intervalId = `cover:${Math.round(at)}`;
      stands.push({
        id: `${key}:stand:${intervalId}`, intervalId,
        vertices: coverVertices(at, widthSrc, kind, edgeRand, width),
        kind, edgeSeed: Math.floor(edgeRand() * 1e9), structural: true,
      });
    }
  }

  const surface = { version: 2, width, biomeKey, byteLength: 0, facets, gullies, stands, valleys };
  surface.byteLength = accountBytes(surface);
  return surface;
}

/** Sum of descriptor bytes for every surface in the active A/B strip sets. */
export function aggregateSurfaceBytes(surfaces) {
  let total = 0;
  for (const surface of surfaces || []) total += surface?.byteLength || 0;
  return total;
}
