// An authored cove in Muncho's shipped geographic terrain. Residents keep
// world coordinates: camera travel, zoom, water and trees share their depth.
import { terrainHeightAt } from './TerrainMesh.js';

const VIEW_ID = 'muncho-lake-south';
const LOOK = Object.freeze([200.8, -83.37, 957.3]);
const horizontalLength = Math.hypot(LOOK[0], LOOK[2]);
const FORWARD = Object.freeze([LOOK[0] / horizontalLength, 0, LOOK[2] / horizontalLength]);
const RIGHT = Object.freeze([-FORWARD[2], 0, FORWARD[0]]);
const POSITIONS = Object.freeze({ midio: [-700, -6220], broshi: [-520, -6080], midasus: [-380, -5940] });

/** The cove rail uses the distant mountain view's direction, with a shorter
 * look distance so listener zoom remains proportionate to the nearby shore. */
export function rangeHabitatCameraPose(view, progress01 = .5) {
  if (view?.id !== VIEW_ID) return null;
  const progress = Number.isFinite(progress01) ? Math.max(0, Math.min(1, progress01)) : .5;
  const eyeM = [-780 - 120 * progress, 970, -6780];
  return { eyeM, targetM: eyeM.map((v, i) => v + LOOK[i]), fovYDeg: 31.4 };
}

// Water uses the same sample triangle as terrainHeightAt, including points
// between lattice samples; 255 is the package's hydroflattened water mask.
function surfaceAt(data, x, z) {
  const gx = (x - data.grid.originM[0]) / data.grid.cellSizeM;
  const gz = (z - data.grid.originM[1]) / data.grid.cellSizeM;
  const tile = data.byIndex.get(`${Math.floor(gx / data.cells)},${Math.floor(gz / data.cells)}`);
  if (!tile?.visible || tile.band !== 'mid' || !tile.flowBytes || !tile.heightsM) return null;
  const u = (gx - tile.ix * data.cells) / tile.stride, v = (gz - tile.iz * data.cells) / tile.stride;
  const u0 = Math.min(tile.samples - 2, Math.floor(u)), v0 = Math.min(tile.samples - 2, Math.floor(v));
  if (u0 < 0 || v0 < 0) return null;
  const i = v0 * tile.samples + u0, tx = u - u0, tz = v - v0;
  const a = tile.flowBytes[i], b = tile.flowBytes[i + 1];
  const c = tile.flowBytes[i + tile.samples], d = tile.flowBytes[i + tile.samples + 1];
  const flow = tx >= tz ? a + (b - a) * tx + (d - b) * tz : a + (d - c) * tx + (c - a) * tz;
  return { height: terrainHeightAt(data, x, z), flow };
}

function dressingAt(data, waterLevelM) {
  const planted = (x, z, shape, radius) => {
    const root = surfaceAt(data, x, z);
    if (!root || !Number.isFinite(root.height) || root.height < waterLevelM - .1) return null;
    // Keep entire footprints on available, gently sloping ground. These
    // objects are scattered along the bank, never raised into a shared base.
    for (const [dx, dz] of [[-radius, 0], [radius, 0], [0, -radius], [0, radius]]) {
      const edge = surfaceAt(data, x + dx, z + dz);
      if (!edge || !Number.isFinite(edge.height) || Math.abs(edge.height - root.height) / radius > .25) return null;
    }
    return Object.freeze({ positionM: Object.freeze([x, root.height, z]), ...shape });
  };
  const rocks = [
    [-508, -6084, 7, 5], [-542, -6064, 5, 4], [-489, -6098, 9, 7],
    [-534, -6090, 6, 4.5], [-505, -6052, 8, 5.5],
  ].map(([x, z, radiusM, heightM]) => planted(x, z, { radiusM, heightM }, radiusM));
  const reeds = [
    [-705, -6240, 8, 5], [-673, -6232, 6, 4], [-720, -6211, 7, 5],
    [-654, -6177, 5, 4], [-526, -6109, 9, 8], [-557, -6067, 7, 6],
  ].map(([x, z, heightM, spreadM]) => planted(x, z, { heightM, spreadM }, spreadM));
  const pine = planted(-397.62, -5982.61, { heightM: 70, widthM: 36 }, 18);
  if (!pine || [...rocks, ...reeds].some(p => !p)) return null;
  return Object.freeze({ rocks: Object.freeze(rocks), reeds: Object.freeze(reeds), pine });
}

/** Resolve only a cove that is present in this package. Incompatible or
 * unsupported terrain gets no habitat instead of a fabricated shoreline. */
export function buildRangeHabitat(data, view) {
  if (view?.id !== VIEW_ID || data?.manifest?.viewId !== VIEW_ID || typeof data.byIndex?.get !== 'function'
    || !(data.grid?.cellSizeM > 0) || !Array.isArray(data.grid.originM)
    || !data.grid.originM.every(Number.isFinite) || !(data.cells > 0)) return null;
  const ground = {}, samples = {};
  for (const [id, [x, z]] of Object.entries(POSITIONS)) {
    const sample = surfaceAt(data, x, z);
    if (!sample || !Number.isFinite(sample.height) || !Number.isFinite(sample.flow)) return null;
    ground[id] = sample.height;
    samples[id] = sample;
  }
  const waterLevelM = ground.midio;
  if (samples.midio.flow !== 255 || samples.broshi.flow >= 254 || samples.midasus.flow >= 254
    || Math.abs(waterLevelM - 825) > .5 || Math.abs(ground.broshi - waterLevelM) > 2
    || ground.midasus < waterLevelM || ground.midasus - waterLevelM > 35) return null;
  const [bx, bz] = POSITIONS.broshi;
  const nearWater = [[-20, 0], [20, 0], [0, -20], [0, 20]]
    .some(([dx, dz]) => {
      const sample = surfaceAt(data, bx + dx, bz + dz);
      return sample?.flow === 255 && Math.abs(sample.height - waterLevelM) < .1;
    });
  if (!nearWater) return null;
  const dressing = dressingAt(data, waterLevelM);
  if (!dressing) return null;
  const anchors = Object.freeze({
    midio: Object.freeze([-700, waterLevelM, -6220]),
    broshi: Object.freeze([-520, ground.broshi, -6080]),
    midasus: Object.freeze([-380, ground.midasus + 58, -5940]),
  });
  return Object.freeze({ id: 'muncho-cove', band: 'mid', waterLevelM, anchors,
    heights: Object.freeze({ midio: 28, broshi: 35, midasus: 22 }),
    ground: Object.freeze(ground), right: RIGHT, forward: FORWARD, dressing });
}
