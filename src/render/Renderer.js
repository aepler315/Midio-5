// Canvas 2D compositor. Draws sky -> parallax biome layers -> ground ->
// telegraph glints -> world FX -> companions -> Midio -> foreground veil ->
// cracks/shatter -> HUD. Layers are added incrementally as later stages land;
// each stage guards on the subsystem's presence so this file grows additively.
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
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

    this._drawMidio(ctx, pose, sim.midio.groundY);

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

  _drawMidio(ctx, pose, groundY) {
    ctx.save();
    ctx.translate(pose.midioX, pose.midioY);
    ctx.rotate((pose.leanDeg * Math.PI) / 180);
    ctx.scale(pose.scaleX, pose.scaleY);

    const w = 46, h = 54;
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath();
    ctx.ellipse(0, -h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1a0d16';
    ctx.beginPath();
    ctx.ellipse(10, -h / 2 - 4, 5, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
