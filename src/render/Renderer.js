// Canvas 2D compositor. Draws sky -> parallax biome layers -> ground ->
// telegraph glints -> world FX -> companions -> Midio -> foreground veil ->
// cracks/shatter -> HUD. Layers are added incrementally as later stages land;
// each stage guards on the subsystem's presence so this file grows additively.
import { drawMesh, MIDIO_MESH, BROSHI_MESH, MIDASUS_MESH, MIDIO_SCALE } from './MeshDrawer.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(sim, alpha, perfGovernor = null) {
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
    ctx.translate(-canvas.width / 2 + camera.shakeX + camera.driftX, -canvas.height / 2 + camera.shakeY + camera.driftY);

    const calmC = sim.calm ? sim.calm.C : 0;
    if (biomeManager) {
      biomeManager.draw(ctx, canvas, pose.worldX, sim.ground, sim.timeMs, calmC, perfGovernor?.level ?? 0);
    } else {
      this._drawFallbackSky(ctx, canvas);
      this._drawGround(ctx, canvas, pose, sim.midio.groundY);
    }

    if (sim.telegraph) sim.telegraph.draw(ctx, sim.midio.groundY);
    const edgeLight = biomeManager ? biomeManager.edgeLight(sim.timeMs) : null;
    if (sim.obstacles) sim.obstacles.draw(ctx, pose.worldX, pose.midioX, sim.midio.groundY, sim.ground, sim.timeMs, edgeLight);
    if (sim.impactFX) sim.impactFX.draw(ctx, pose.worldX, pose.midioX);

    if (sim.broshi) sim.broshi.draw(ctx);

    this._drawMidioGhosts(ctx, sim);
    this._drawMidio(ctx, pose, sim.midio.groundY);

    if (sim.midasus) sim.midasus.draw(ctx);
    if (sim.fracture) sim.fracture.draw(ctx, canvas, { glow: perfGovernor ? perfGovernor.crackGlowEnabled : true });
    if (biomeManager && (!perfGovernor || perfGovernor.veilEnabled)) biomeManager.drawForeground(ctx, canvas, pose.worldX, calmC);

    ctx.restore(); // camera transform
    ctx.restore();

    // Cinematic vignette: soft darkening at the edges so the cast stays the
    // focal point. Kept subtle so it never competes with the biome palette.
    const cx = (canvas.width || 1280) / 2;
    const cy = (canvas.height || 720) / 2;
    const r0 = Math.max(0, cy * 0.35);
    const r1 = Math.max(r0 + 1, cy * 0.85);
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r0) && Number.isFinite(r1)) {
      const vignette = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

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

  _drawMidio(ctx, pose, groundY) {
    const mesh = pose.mesh || {};
    drawMesh(ctx, MIDIO_MESH, {
      x: pose.midioX + (mesh.driftX || 0),
      y: pose.midioY + (mesh.driftY || 0),
      scaleX: pose.scaleX * (mesh.blink || 1) * MIDIO_SCALE,
      scaleY: pose.scaleY * (mesh.blink || 1) * MIDIO_SCALE,
      leanDeg: pose.leanDeg, spin: mesh.spin || 0, armFlare: mesh.armFlare || 0,
    }, MIDIO_MESH.baseHue, { fill: true, lineWidth: 1.5, glow: true, goldPulse: mesh.goldPulse || 0 });
  }

  _drawMidioGhosts(ctx, sim) {
    if (!sim || !sim.performer) return;
    const ghosts = sim.performer.ghosts();
    for (const g of ghosts) {
      drawMesh(ctx, MIDIO_MESH, {
        x: g.x, y: g.y,
        scaleX: g.scaleX * MIDIO_SCALE, scaleY: g.scaleY * MIDIO_SCALE,
        leanDeg: g.leanDeg, spin: g.spin, armFlare: g.armFlare,
      }, MIDIO_MESH.baseHue, { fill: false, lineWidth: 1, glow: false, goldPulse: 0 });
    }
  }
}
