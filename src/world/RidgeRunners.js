// Miniature versions of the three characters running along the background
// mountain ridges — the world's own tiny cover band. Each runner lives in
// scroll-stable strip space (so it genuinely runs ALONG the ridge rather
// than sliding with the camera), rides the exact same danceOffset the
// mountain columns use (so it never floats off a dancing ridge), bounces
// with its stride, and hops on the layer-delayed kick like everything else
// in the range. Position math is pure and unit-tested; only draw() touches
// canvas.
import { ridgeYAt } from './SilhouetteGenerator.js';
import { MIDIO_MESH, BROSHI_BODY, BROSHI_HEAD, MIDASUS_MESH, mergeMeshes } from '../render/meshes.js';
import { computeRestLengths, drawMeshPart } from '../render/MeshDrawer.js';
import { danceOffset } from './MountainChoreo.js';
import { mulberry32 } from '../utils/math.js';

const BROSHI_MINI = mergeMeshes([BROSHI_BODY, BROSHI_HEAD]).mesh;

// hue: each mini keeps its owner's stage color family. footY: local-space
// ground line (the star mini is hub-centered, so it floats a little).
export const RUNNER_CAST = [
  { name: 'midio', mesh: MIDIO_MESH, hue: 48, scale: 0.34, footY: 0 },
  { name: 'broshi', mesh: BROSHI_MINI, hue: 135, scale: 0.38, footY: 0 },
  { name: 'midasus', mesh: MIDASUS_MESH, hue: 210, scale: 0.5, footY: 10 },
];

const RUN_SPEED_PX_S = 26;   // strip-space stride; fever doubles it
const STRIDE_HZ = 2.1;       // bounce cycles per second while running
const STRIDE_AMP = 2.2;
const KICK_HOP_PX = 13;

export class RidgeRunners {
  constructor(seed = 7) {
    const rand = mulberry32(seed);
    this.runners = RUNNER_CAST.map((cast, i) => ({
      cast,
      stripX0: rand() * 4096,
      dir: i % 2 === 0 ? 1 : -1, // they don't all run the same way
      speedMul: 0.8 + 0.4 * rand(),
      stridePhase: rand() * Math.PI * 2,
    }));
    this._rest = null;
  }

  /**
   * Pure position pass — everything draw() needs, no canvas.
   * @param {object} strip a generateSilhouette canvas (has .ridge, .width, .height)
   * @param {number} scrollX this layer's scroll offset
   * @param {number} canvasW visible width
   * @param {number} baseY screen-space y of the strip's top edge
   * @param {{tSec:number, groove:number, kick:number, cfg:object, fever:number}} dance
   */
  positionsAt(strip, scrollX, canvasW, baseY, dance) {
    const w = strip.width;
    const fever = dance.fever || 0;
    const out = [];
    for (const r of this.runners) {
      const stripX = r.stripX0 + r.dir * RUN_SPEED_PX_S * r.speedMul * (1 + fever) * dance.tSec;
      // Same tiling as _drawDancingStrip: screen x of a strip-space point.
      const sx = ((((stripX - scrollX) % w) + w) % w);
      const screenX = sx > canvasW + 40 ? sx - w : sx; // try the left tile before culling
      if (screenX < -40 || screenX > canvasW + 40) continue;
      const localX = ((stripX % w) + w) % w;
      const dy = dance.cfg
        ? danceOffset(scrollX + screenX, dance.tSec, dance.groove, dance.kick, dance.cfg, fever)
        : 0;
      const stride = Math.abs(Math.sin(dance.tSec * STRIDE_HZ * Math.PI * 2 + r.stridePhase)) * STRIDE_AMP;
      const hop = KICK_HOP_PX * (dance.kick || 0) * (1 + fever);
      out.push({
        cast: r.cast,
        dir: r.dir,
        x: screenX,
        y: baseY + dy + ridgeYAt(strip, localX) - stride - hop - r.cast.footY * r.cast.scale,
      });
    }
    return out;
  }

  draw(ctx, strip, scrollX, canvasW, baseY, dance, alpha = 0.6) {
    if (!strip.ridge) return;
    if (!this._rest) {
      this._rest = new Map(RUNNER_CAST.map((c) => [c.name, computeRestLengths(c.mesh)]));
    }
    const fever = dance.fever || 0;
    for (const p of this.positionsAt(strip, scrollX, canvasW, baseY, dance)) {
      drawMeshPart(ctx, p.cast.mesh, this._rest.get(p.cast.name), {
        tx: p.x, ty: p.y,
        scaleX: p.cast.scale * p.dir, scaleY: p.cast.scale,
      }, p.cast.hue, {
        satBase: 45 + 25 * fever, lightBase: 58 + 14 * fever,
        alpha: Math.min(1, alpha + 0.35 * fever), widthBase: 1, widthGlow: 1.2, hueSpread: 20,
      });
    }
  }
}
