// Canvas 2D compositor. Draws sky -> parallax biome layers -> ground ->
// telegraph glints -> world FX -> companions -> Midio -> foreground veil ->
// cracks/shatter -> HUD. Layers are added incrementally as later stages land;
// each stage guards on the subsystem's presence so this file grows additively.
import { MIDIO_MESH, MIDIO_BODY, MIDIO_EYE } from './meshes.js';
import { computeRestLengths, drawMeshPart, displaceMeshRadial } from './MeshDrawer.js';
import { EpicycleShow } from './EpicycleShow.js';
import { ComposerStrip } from './ComposerStrip.js';
import { RainbowBrush } from './RainbowBrush.js';

const MIDIO_BASE_HUE = 42; // warm gold, matching his original color
const MIDIO_EYE_CY = -31; // MIDIO_EYE's local center, for blink scaling around its own middle
const MIDIO_DRAW_SCALE = 1.45; // ferocity pass: render-only, physics untouched

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._midioRestLengths = computeRestLengths(MIDIO_MESH);
    this._midioBodyRest = computeRestLengths(MIDIO_BODY);
    this._midioEyeRest = computeRestLengths(MIDIO_EYE);
    this.epicycles = new EpicycleShow();
    this._lastMilestoneMs = null;
    this.composer = null; // lazy: needs the conductor's timeline at first draw
    this.brush = new RainbowBrush();
  }

  draw(sim, alpha) {
    const { ctx, canvas } = this;
    const fracture = sim.fracture || null;

    if (fracture && (fracture.isFrozen || fracture.isDone)) {
      fracture.drawShatter(ctx, canvas);
      return;
    }

    const pose = sim.lerpState(alpha);
    const camera = sim.camera;
    const biomeManager = sim.biomes || null;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.rotate(camera.roll || 0); // damped impact roll, pivoting on screen center
    ctx.translate(-canvas.width / 2 + camera.shakeX, -canvas.height / 2 + camera.shakeY);

    if (biomeManager) {
      biomeManager.draw(ctx, canvas, pose.worldX, pose.midioX);
    } else {
      this._drawFallbackSky(ctx, canvas);
      this._drawGround(ctx, canvas, pose, sim.midio.groundY);
    }

    if (sim.telegraph) sim.telegraph.draw(ctx, sim.midio.groundY);
    if (sim.obstacles) sim.obstacles.draw(ctx, pose.worldX, pose.midioX, sim.midio.groundY);
    if (sim.impactFX) sim.impactFX.draw(ctx, pose.worldX, pose.midioX);

    // Rainbow brush: paint Midio's jump arcs, world-locked behind him.
    this.brush.update(sim.timeMs, pose.airborne, pose.worldX, pose.midioY);
    this.brush.draw(ctx, pose.worldX, pose.midioX, sim.timeMs);

    if (sim.broshi) sim.broshi.draw(ctx, pose);

    if (sim.performer) this._drawMidioAfterimages(ctx, sim.performer, pose.midioX);
    this._drawMidio(ctx, pose, sim.performer);

    // Combo milestone: a Fourier epicycle machine draws the digit above Midio.
    const lm = sim.performer ? sim.performer.lastMilestone : null;
    if (lm && lm.atMs !== this._lastMilestoneMs) {
      this._lastMilestoneMs = lm.atMs;
      this.epicycles.trigger(lm.idx, pose.midioX + 30, sim.midio.groundY - 245, sim.timeMs);
    }
    this.epicycles.draw(ctx, sim.timeMs);
    this._drawDropShockwave(ctx, canvas, sim, pose);

    if (sim.midasus) sim.midasus.draw(ctx);
    if (sim.gnat) sim.gnat.draw(ctx, sim.timeMs);
    if (sim.fracture) sim.fracture.draw(ctx, canvas);
    if (biomeManager) biomeManager.drawForeground(ctx, canvas, pose.worldX);

    ctx.restore(); // camera transform
    ctx.restore();

    // Mario Paint composer strip: fixed HUD layer, outside camera shake/zoom.
    if (sim.conductor) {
      if (!this.composer) this.composer = new ComposerStrip(sim.conductor.timeline, sim.conductor.barGrid, sim.conductor.durationMs);
      this.composer.draw(ctx, canvas, sim.timeMs);
    }

    if (sim.hype) this._drawHypeFrame(ctx, canvas, sim);

    if (fracture && fracture.isAboutToFreeze) fracture.captureFreeze(canvas, sim.timeMs);
  }

  /** Drop shockwave: two expanding rings thrown from Midio on a detected drop. */
  _drawDropShockwave(ctx, canvas, sim, pose) {
    const hype = sim.hype;
    if (!hype) return;
    const u = hype.ringU(sim.timeMs);
    if (u == null) return;
    const cx = pose.midioX, cy = sim.midio.groundY - 60;
    const maxR = Math.hypot(canvas.width, canvas.height) * 0.75;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [lag, alphaMul, lw] of [[0, 1, 3.5], [0.12, 0.5, 1.8]]) {
      const uu = u - lag;
      if (uu <= 0) continue;
      const r = maxR * (1 - (1 - uu) ** 2); // ease-out: it detonates, then coasts
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = (1 - uu) ** 2 * 0.55 * alphaMul;
      ctx.lineWidth = lw + 10 * (1 - uu);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The energy frame: a thin border that breathes with the track, slams on
   * kicks, and echoes the whole frame during a drop surge -- the always-on,
   * any-distance signal that the screen is running on the music. */
  _drawHypeFrame(ctx, canvas, sim) {
    const hype = sim.hype;
    const color = sim.biomes && sim.biomes.currentHaloColor ? sim.biomes.currentHaloColor() : '#ffffff';

    // Frame echo: on hard hits the previous frame ghosts outward once.
    const echo = Math.max(hype.surge > 0.45 ? hype.surge : 0, hype.slam > 0.7 ? hype.slam * 0.8 : 0);
    if (echo > 0.05) {
      const off = 3 + 5 * echo;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.14 * echo;
      ctx.drawImage(canvas, this._echoFlip ? off : -off, 0);
      ctx.restore();
      this._echoFlip = !this._echoFlip;
    }

    const breathe = 0.08 + 0.20 * hype.fast + 0.45 * hype.slam + 0.3 * hype.surge;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.globalAlpha = Math.min(0.75, breathe);
    ctx.lineWidth = 2 + 9 * hype.slam + 6 * hype.surge;
    const inset = 5 + 3 * hype.slam;
    ctx.beginPath();
    ctx.roundRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, 14);
    ctx.stroke();
    ctx.restore();
  }

  _drawFallbackSky(ctx, canvas) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#1a1a3e');
    g.addColorStop(1, '#4a3b6b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _drawGround(ctx, canvas, pose, groundY) {
    ctx.fillStyle = '#2b2145';
    ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    const spacing = 60;
    const offset = pose.worldX % spacing;
    ctx.beginPath();
    for (let x = -offset; x < canvas.width; x += spacing) {
      ctx.moveTo(x, groundY);
      ctx.lineTo(x + 20, groundY);
    }
    ctx.stroke();
  }

  _drawMidio(ctx, pose, performer) {
    const flash = performer ? performer.goldFlash : 0;
    const blink = performer ? performer.blinkScale : 1;
    const transform = {
      tx: pose.midioX, ty: pose.midioY,
      rot: (pose.leanDeg * Math.PI) / 180,
      scaleX: pose.scaleX * MIDIO_DRAW_SCALE, scaleY: pose.scaleY * MIDIO_DRAW_SCALE,
    };
    const hue = flash > 0 ? MIDIO_BASE_HUE + (48 - MIDIO_BASE_HUE) * flash : MIDIO_BASE_HUE;
    // Spectral treatment: near-white filament with a narrow warm fringe.
    // The milestone gold flash reads as the glyph igniting into color.
    const options = { satBase: 26 + flash * 45, lightBase: 68 + flash * 14, hueSpread: 16 };

    // Modal vibration: rim vertices ride the performer's ring-down field.
    // Rest lengths stay the undisplaced ones, so the wobble reads as edge
    // deformation and lights up the glow automatically.
    const hub = MIDIO_BODY.vertices[0];
    const bodyMesh = displaceMeshRadial(MIDIO_BODY, hub.x, hub.y, performer ? performer.modal : null);
    drawMeshPart(ctx, bodyMesh, this._midioBodyRest, transform, hue, options);

    if (blink < 0.98) {
      const blinkEye = {
        vertices: MIDIO_EYE.vertices.map((v) => ({ x: v.x, y: MIDIO_EYE_CY + (v.y - MIDIO_EYE_CY) * blink })),
        edges: MIDIO_EYE.edges,
      };
      drawMeshPart(ctx, blinkEye, this._midioEyeRest, transform, hue, options);
    } else {
      drawMeshPart(ctx, MIDIO_EYE, this._midioEyeRest, transform, hue, options);
    }

    // Kick ignition: the sigil flashes additively right on the beat.
    const beatFlash = performer ? performer.beatFlash : 0;
    if (beatFlash > 0.03) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawMeshPart(ctx, bodyMesh, this._midioBodyRest, transform, hue, {
        alpha: 0.65 * beatFlash, satBase: 70, lightBase: 74, widthBase: 2.4,
      });
      ctx.restore();
    }
  }

  /** Motion-streak ghosts trailing a fast jump (follow-up item 6). */
  _drawMidioAfterimages(ctx, performer, midioX) {
    const frames = performer.afterimages;
    const n = frames.length;
    if (n === 0) return;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      const alpha = 0.28 * ((i + 1) / n);
      ctx.globalAlpha = alpha;
      drawMeshPart(ctx, MIDIO_MESH, this._midioRestLengths, {
        tx: midioX, ty: f.y, rot: (f.rot * Math.PI) / 180,
        scaleX: f.scaleX * MIDIO_DRAW_SCALE, scaleY: f.scaleY * MIDIO_DRAW_SCALE,
      }, MIDIO_BASE_HUE, { alpha: 1, satBase: 18, lightBase: 60, hueSpread: 16 });
    }
    ctx.restore();
  }
}
