// The title/loader backdrop: the one moment in Midio that used to be a
// dead, static gradient. Before a song starts the stage canvas is never
// drawn (frame() returns early while !running), so the player's very first
// impression was a flat #0a0a14 rectangle behind the loader panel. This
// module gives that screen the same living, spectral language the world
// runs on -- a seeded twinkling starfield, a soft nebula, and the trio's
// actual wireframe glyphs drifting and breathing with additive glow -- so
// the first frame already reads as "this is a Midio world" before a note
// plays. Self-contained and cheap: a handful of gradient fills + the same
// drawMeshPart/drawGlowHalo calls the sim uses, no audio, no sim.
//
// Everything is seeded (mulberry32) so the composition is deterministic
// per page load and unit-testable without a canvas.
import { MIDIO_MESH, BROSHI_BODY, BROSHI_HEAD, BROSHI_EYE, BROSHI_TAIL, MIDASUS_MESH } from '../render/meshes.js';
import { computeRestLengths, drawMeshPart, drawGlowHalo } from '../render/MeshDrawer.js';
import { spectralHue } from '../render/stellar.js';
import { spectralTokens } from '../render/spectral.js';
import { mulberry32, clamp } from '../utils/math.js';

export const STAR_COUNT = 90;
export const NEBULA_COUNT = 3;
const STAR_TWINKLE_PERIOD_SEC = 3.2;

/** Where the trio stands on the title stage. Kept in the lower band so
 *  they read around (not under) the title card, which sits top-center. */
export function trioLayout(w = 1280, h = 720) {
  return {
    midasus: { x: w * 0.78, y: h * 0.70, scale: 3.1 },
    midio:   { x: w * 0.50, y: h * 0.78, scale: 2.2 },
    broshi:  { x: w * 0.22, y: h * 0.80, scale: 1.9 },
  };
}

/** Build the deterministic starfield + nebula layout for a given seed. */
export function buildBackdropLayout(seed = 1, w = 1280, h = 720) {
  const rand = mulberry32(seed >>> 0);
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: rand() * w,
      y: rand() * h * 0.72, // keep the lower band clear for the trio
      r: 0.4 + rand() * 1.3,
      phase: rand() * Math.PI * 2,
      speed: 0.6 + rand() * 1.4,
      hue: rand() < 0.5 ? 0 : 200 + rand() * 60, // warm gold vs cool blue
    });
  }
  const nebulae = [];
  for (let i = 0; i < NEBULA_COUNT; i++) {
    nebulae.push({
      x: rand() * w,
      y: rand() * h * 0.6,
      r: 120 + rand() * 160,
      hue: rand() * 360,
      alpha: 0.05 + rand() * 0.05,
    });
  }
  return { stars, nebulae };
}

export class TitleBackdrop {
  constructor({ seed = 1, width = 1280, height = 720, tonic = null } = {}) {
    this.width = width;
    this.height = height;
    this.layout = buildBackdropLayout(seed, width, height);
    // One Spectrum: the trio glyphs key to the song's tonic like the
    // in-game characters. Null tonic (no song yet) keeps the classic
    // fixed hues -- the title screen is its own calm place.
    this.tonic = tonic;
    if (tonic != null) {
      const t = spectralTokens({ tonic, biome: null, anchorHue: 0 });
      this._titleShift = t.shiftDeg;
    } else {
      this._titleShift = 0;
    }
    // Precompute rest lengths once (the sim does the same per character).
    this._midioRest = computeRestLengths(MIDIO_MESH);
    this._broshiBodyRest = computeRestLengths(BROSHI_BODY);
    this._broshiHeadRest = computeRestLengths(BROSHI_HEAD);
    this._broshiEyeRest = computeRestLengths(BROSHI_EYE);
    this._broshiTailRest = computeRestLengths(BROSHI_TAIL);
    this._midasusRest = computeRestLengths(MIDASUS_MESH);
  }

  /** Draw one frame at time tSec. Pure-ish: only reads this.layout + tSec. */
  draw(ctx, tSec) {
    const { width: w, height: h } = this;
    ctx.save();
    this._drawNebula(ctx, tSec);
    this._drawStars(ctx, tSec);
    this._drawTrio(ctx, tSec);
    ctx.restore();
  }

  _drawNebula(ctx, tSec) {
    for (const n of this.layout.nebulae) {
      const drift = Math.sin(tSec * 0.05 + n.hue) * 18;
      const g = ctx.createRadialGradient(n.x + drift, n.y, 0, n.x + drift, n.y, n.r);
      g.addColorStop(0, `hsla(${n.hue.toFixed(0)},60%,55%,${n.alpha.toFixed(3)})`);
      g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  _drawStars(ctx, tSec) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.layout.stars) {
      const tw = 0.5 + 0.5 * Math.sin(tSec * s.speed * 2 + s.phase);
      const alpha = 0.25 + 0.55 * tw;
      ctx.fillStyle = `hsla(${s.hue.toFixed(0)},70%,${(70 + 20 * tw).toFixed(0)}%,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (0.7 + 0.5 * tw), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawTrio(ctx, tSec) {
    // The trio drift slowly and breathe -- the same "always slightly alive"
    // pulse the characters carry in-game, so the title reads as a stage
    // they're already standing on, not a poster. Under One Spectrum the
    // glyphs' hues all shift by the title's key shift as one body.
    //
    // They stand in the lower band (see trioLayout): the title card used
    // to cover the old center-stage placement completely, so the living
    // glyphs were drawn and then immediately hidden by an opaque panel.
    const breathe = (phase) => 1 + 0.03 * Math.sin(tSec * 1.6 + phase);
    const driftY = (phase) => Math.sin(tSec * 0.4 + phase) * 6;
    const rot = (h) => (((h + this._titleShift) % 360) + 360) % 360;
    const layout = trioLayout(this.width, this.height);

    // Midasus: the hexagram, stage-right.
    const midasusHue = rot(spectralHue(0));
    const mx = layout.midasus.x, my = layout.midasus.y + driftY(0);
    const mScale = layout.midasus.scale * breathe(0);
    drawGlowHalo(ctx, mx, my, 30 * mScale, 30 * mScale, midasusHue, 0.5, { sat: 58, light: 78 });
    drawMeshPart(ctx, MIDASUS_MESH, this._midasusRest, {
      tx: mx, ty: my, rot: tSec * 0.1, scaleX: mScale, scaleY: mScale,
    }, midasusHue, { satBase: 58, lightBase: 70, outline: true });

    // Midio: the crystal-obelisk, center-front of the stage.
    const midioHue = rot(spectralHue(7));
    const jx = layout.midio.x, jy = layout.midio.y + driftY(1.3);
    const jScale = layout.midio.scale * breathe(1.3);
    drawGlowHalo(ctx, jx, jy, 26 * jScale, 30 * jScale, midioHue, 0.45, { sat: 60, light: 76 });
    drawMeshPart(ctx, MIDIO_MESH, this._midioRest, {
      tx: jx, ty: jy, rot: Math.sin(tSec * 0.3) * 0.06, scaleX: jScale, scaleY: jScale,
    }, midioHue, { satBase: 60, lightBase: 68, outline: true });

    // Broshi: the comet star, stage-left, raked forward.
    const broshiHue = rot(spectralHue(2));
    const bx = layout.broshi.x, by = layout.broshi.y + driftY(2.1);
    const bScale = layout.broshi.scale * breathe(2.1);
    const group = { tx: bx, ty: by, rot: 0.12, scaleX: bScale, scaleY: bScale };
    drawGlowHalo(ctx, bx, by, 30 * bScale, 24 * bScale, broshiHue, 0.4, { sat: 34, light: 78 });
    drawMeshPart(ctx, BROSHI_BODY, this._broshiBodyRest, group, broshiHue, { satBase: 40, lightBase: 66, outline: true });
    drawMeshPart(ctx, BROSHI_HEAD, this._broshiHeadRest, group, broshiHue, { satBase: 40, lightBase: 66, outline: true });
    drawMeshPart(ctx, BROSHI_EYE, this._broshiEyeRest, group, broshiHue, { satBase: 30, lightBase: 15, alpha: 0.9 });
    const tailTip = { x: -48 * bScale, y: -6 * bScale };
    const tailMesh = { vertices: [{ x: -26 * bScale, y: -16 * bScale }, tailTip], edges: [[0, 1]] };
    drawMeshPart(ctx, tailMesh, this._broshiTailRest, group, broshiHue - 10, { satBase: 24, lightBase: 48, widthBase: 1.2 });
  }
}
