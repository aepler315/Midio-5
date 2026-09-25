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

/** Descriptors represent inferred surface form. The sampled skyline is never changed. */
export function buildRidgeSurface({ seed, biomeKey, layerKey, width, ridgeYs, step, bottomY }) {
  const empty = () => ({ version: 1, width, biomeKey, byteLength: 128, facets: [], gullies: [], stands: [], valleys: [] });
  if (!ridgeYs?.length || !(width > 0) || !(step > 0) || !(bottomY > 0)) return empty();
  const policy = landscapePolicy(biomeKey);
  const key = `${seed}:${biomeKey}:${layerKey}`;
  const faceRand = randomFrom(`${key}:surface:facets`);
  const coverRand = randomFrom(`${key}:surface:cover`);
  const vals = Array.from(ridgeYs);
  const smooth = vals.map((_, i) => {
    const radius = Math.max(1, Math.round(24 / step));
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(vals.length - 1, i + radius); j++) { sum += vals[j]; n++; }
    return sum / n;
  });
  const extent = Math.max(...smooth) - Math.min(...smooth);
  const facets = [], gullies = [], stands = [], valleys = [];
  const stride = Math.max(1, Math.ceil(128 / step));
  // Select local peaks from the fitted outline. A plateau stays broad and quiet.
  if (extent >= 7) for (let i = stride; i < smooth.length - stride && facets.length < 128; i += stride) {
    const left = Math.max(0, i - stride), right = Math.min(smooth.length - 1, i + stride);
    const prominence = Math.min(smooth[left] - smooth[i], smooth[right] - smooth[i]);
    if (prominence < Math.max(5, extent * .075)) continue;
    const sx = Math.min(width, i * step);
    const span = Math.min(130, Math.max(48, stride * step * .72));
    const vertex = (x, d) => ({ sx: Math.max(0, Math.min(width, x)), depth01: d });
    facets.push({ id: `${key}:face:${i}`, vertices: [
      vertex(sx, 0), vertex(sx - span * .9, .56), vertex(sx - span * .25, .82),
      vertex(sx + span * (.2 + faceRand() * .3), .58),
    ], normalX: -.5 - faceRand() * .4, material: policy.cover });
    facets.push({ id: `${key}:shade:${i}`, vertices: [
      vertex(sx, 0), vertex(sx + span, .63), vertex(sx + span * .2, .83),
    ], normalX: .5 + faceRand() * .4, material: policy.cover });
    const saddleX = Math.min(width, sx + span);
    valleys.push({ id: `${key}:valley:${i}`, sx: saddleX, widthPx: span * 1.3, depth01: .53 });
    if (gullies.length < 64) gullies.push({ id: `${key}:gully:${i}`, points: [
      vertex(saddleX, .1), vertex(saddleX - span * .15, .46), vertex(saddleX + span * .05, .79),
    ], widthPx: 1.3 + faceRand() * 1.4 });
  }
  if (policy.canopy > .2) for (let sx = 64; sx < width - 64 && stands.length < 128; sx += 96) {
    const i = Math.min(smooth.length - 2, Math.max(1, Math.round(sx / step)));
    const slope = Math.abs(smooth[i + 1] - smooth[i - 1]) / (2 * step);
    if (slope > .5 || coverRand() > policy.canopy) continue;
    stands.push({ id: `${key}:stand:${i}`, sx: sx + coverRand() * 35, depth01: .25 + coverRand() * .3,
      widthPx: 25 + coverRand() * 35, heightPx: 10 + coverRand() * 14,
      kind: policy.cover === 'broadleaf' ? 'broadleaf' : policy.cover === 'scrub' ? 'scrub' : 'conifer' });
  }
  const byteLength = 128 + facets.length * 256 + gullies.length * 160 + stands.length * 128 + valleys.length * 96;
  return { version: 1, width, biomeKey, byteLength, facets, gullies, stands, valleys };
}
