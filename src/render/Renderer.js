// Canvas 2D compositor. Draws sky -> parallax biome layers -> ground ->
// telegraph glints -> world FX -> companions -> Midio -> foreground veil ->
// cracks/shatter -> HUD. Layers are added incrementally as later stages land;
// each stage guards on the subsystem's presence so this file grows additively.
import { MIDIO_MESH, MIDIO_BODY, MIDIO_EYE } from './meshes.js';
import { computeRestLengths, drawMeshPart, displaceMeshRadial } from './MeshDrawer.js';
import { EpicycleShow } from './EpicycleShow.js';

const MIDIO_BASE_HUE = 42; // warm gold, matching his original color
const MIDIO_EYE_CY = -31; // MIDIO_EYE's local center, for blink scaling around its own middle

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._midioRestLengths = computeRestLengths(MIDIO_MESH);
    this._midioBodyRest = computeRestLengths(MIDIO_BODY);
    this._midioEyeRest = computeRestLengths(MIDIO_EYE);
    this.epicycles = new EpicycleShow();
    this._lastMilestoneMs = null;
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

    if (sim.midasus) sim.midasus.draw(ctx);
    if (sim.fracture) sim.fracture.draw(ctx, canvas);
    if (biomeManager) biomeManager.drawForeground(ctx, canvas, pose.worldX);

    ctx.restore(); // camera transform
    ctx.restore();

    if (fracture && fracture.isAboutToFreeze) fracture.captureFreeze(canvas, sim.timeMs);
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
      scaleX: pose.scaleX, scaleY: pose.scaleY,
    };
    const hue = flash > 0 ? MIDIO_BASE_HUE + (48 - MIDIO_BASE_HUE) * flash : MIDIO_BASE_HUE;
    const options = { lightBase: 52 + flash * 24, satBase: 68 + flash * 20 };

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
        tx: midioX, ty: f.y, rot: (f.rot * Math.PI) / 180, scaleX: f.scaleX, scaleY: f.scaleY,
      }, MIDIO_BASE_HUE, { alpha: 1 });
    }
    ctx.restore();
  }
}
