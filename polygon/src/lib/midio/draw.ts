import { EYE_CY, EYE_R, signedArea } from "./hull";
import { hsl } from "./math";
import type { PhysicsWorld } from "./physics";
import type { ConductorState } from "./conductor";
import { MIDIO_HUE, type PhysicsMode } from "./types";

export interface DrawFrame {
  w: number;
  h: number;
  dpr: number;
  tSec: number;
  world: PhysicsWorld;
  conductor: ConductorState;
  mode: PhysicsMode;
  pointer: { x: number; y: number; grab: number };
  reduced: boolean;
  iris: { x: number; y: number };
}

function ridge(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, energy: number) {
  ctx.save();
  for (let layer = 0; layer < 3; layer++) {
    const y0 = h * (0.42 + layer * 0.08);
    const amp = 28 - layer * 6 + energy * 10;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, y0);
    const steps = 14 + layer * 4;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const n = Math.sin(i * 0.9 + layer * 1.7 + t * 0.15) * amp;
      const n2 = Math.sin(i * 2.1 + layer) * amp * 0.35;
      ctx.lineTo(x, y0 - Math.abs(n) - n2);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = hsl(220, 8, 7 + layer * 2.2, 1);
    ctx.fill();
    ctx.strokeStyle = hsl(178, 10, 16 + layer * 3, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function ground(ctx: CanvasRenderingContext2D, w: number, gy: number) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, gy);
  const tiles = 18;
  for (let i = 0; i <= tiles; i++) {
    const x = (i / tiles) * w;
    const y = gy + (i % 2 === 0 ? 5 : 0);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, gy + 220);
  ctx.lineTo(0, gy + 220);
  ctx.closePath();
  ctx.fillStyle = hsl(220, 10, 6, 1);
  ctx.fill();
  ctx.strokeStyle = hsl(178, 12, 22, 0.45);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, gy);
  for (let i = 0; i <= tiles; i++) {
    const x = (i / tiles) * w;
    const y = gy + (i % 2 === 0 ? 5 : 0);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function diamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  fill: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.72, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.72, 0);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

export function drawScene(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  const { w, h, world, conductor: c, tSec } = f;
  const shake = f.reduced ? 0 : c.trauma * c.trauma;
  const ox = shake * 7 * Math.sin(tSec * 73.1);
  const oy = shake * 5 * Math.cos(tSec * 61.7);
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.translate(ox, oy);

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0b1016");
  g.addColorStop(0.55, "#07080c");
  g.addColorStop(1, "#050608");
  ctx.fillStyle = g;
  ctx.fillRect(-ox, -oy, w, h);

  ctx.fillStyle = hsl(178, 20, 70, 0.08 + c.energy * 0.05);
  for (let i = 0; i < 28; i++) {
    const x = ((i * 97 + tSec * 2) % (w + 40)) - 20;
    const y = (i * 53) % (h * 0.45);
    ctx.fillRect(x, y, 1.2, 1.2);
  }

  ridge(ctx, w, h, tSec, c.energy);
  const gy = h * 0.78;
  ground(ctx, w, gy);

  const hub = world.particles[world.hubIndex]!;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  const shadow = ctx.createRadialGradient(hub.x, gy + 6, 4, hub.x, gy + 6, 70);
  shadow.addColorStop(0, "rgba(0,0,0,0.55)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(hub.x, gy + 8, 92, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const glowR = 52 + c.beatFlash * 22 + c.apo * 16;
  const glow = ctx.createRadialGradient(hub.x, hub.y, 8, hub.x, hub.y, glowR);
  glow.addColorStop(0, hsl(MIDIO_HUE, 40, 70, 0.16 + c.beatFlash * 0.22));
  glow.addColorStop(1, hsl(MIDIO_HUE, 40, 70, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, glowR, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  for (let i = 1; i <= world.hullCount; i++) {
    const p = world.particles[i]!;
    if (i === 1) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = hsl(MIDIO_HUE, 16, 11, 0.92);
  ctx.fill();
  ctx.lineJoin = "miter";
  ctx.miterLimit = 2.4;
  ctx.lineCap = "butt";
  ctx.strokeStyle = hsl(MIDIO_HUE, 18, 82, 0.94);
  ctx.lineWidth = 1.35;
  ctx.stroke();

  ctx.save();
  for (const t of world.triangles) {
    const a = world.particles[t.a]!;
    const b = world.particles[t.b]!;
    const cc = world.particles[t.c]!;
    if (a.kind === "debris" || b.kind === "debris" || cc.kind === "debris") continue;
    const area = signedArea(a, b, cc);
    const strain = Math.min(1, Math.abs(area - t.restArea) / (Math.abs(t.restArea) || 1) * 2.2);
    const light = 14 + strain * 22 + c.beatFlash * 10 + c.apo * 6;
    const sat = 18 + strain * 28;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(cc.x, cc.y);
    ctx.closePath();
    ctx.fillStyle = hsl(MIDIO_HUE, sat, light, 0.55 + strain * 0.25);
    ctx.fill();
  }
  ctx.restore();

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const e of world.constraints) {
    if (e.broken || e.kind === "hull") continue;
    const a = world.particles[e.i]!;
    const b = world.particles[e.j]!;
    if (a.kind === "dust" || b.kind === "dust") continue;
    const glowAmt = Math.min(1, e.strain * 3);
    const isCore = e.kind === "core";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = hsl(
      MIDIO_HUE,
      isCore ? 42 : 22 + glowAmt * 30,
      isCore ? 72 : 58 + glowAmt * 22,
      isCore ? 0.7 : 0.28 + glowAmt * 0.4,
    );
    ctx.lineWidth = isCore ? 1.15 : 0.7 + glowAmt * 1.1;
    ctx.stroke();
  }

  for (let i = 0; i < world.dustStart; i++) {
    const p = world.particles[i]!;
    if (p.kind !== "debris") continue;
    diamond(ctx, p.x, p.y, p.radius * 1.6, tSec * p.spin, hsl(MIDIO_HUE, 26, 62, 0.9));
  }

  for (let i = world.dustStart; i < world.particles.length; i++) {
    const p = world.particles[i]!;
    diamond(
      ctx,
      p.x,
      p.y,
      2.1,
      p.spin,
      hsl(MIDIO_HUE, 18, 72, 0.35 + 0.25 * Math.sin(tSec * 2 + p.phase)),
    );
  }

  const eyeOpen = c.blink;
  const restHub = world.particles[world.hubIndex]!;
  const eyeX = restHub.x + f.iris.x;
  const eyeY = restHub.y + (EYE_CY - restHub.restY) + f.iris.y * 0.15;
  ctx.save();
  ctx.translate(eyeX, eyeY);
  ctx.scale(1, Math.max(0.12, eyeOpen));
  ctx.strokeStyle = hsl(MIDIO_HUE, 30, 82, 0.95);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a0 = ((-90 + k * 60) * Math.PI) / 180;
    const a1 = ((-90 + ((k + 2) % 6) * 60) * Math.PI) / 180;
    if (k % 2 === 0) {
      ctx.moveTo(Math.cos(a0) * EYE_R * 0.55, Math.sin(a0) * EYE_R * 0.55);
      ctx.lineTo(Math.cos(a1) * EYE_R * 0.55, Math.sin(a1) * EYE_R * 0.55);
    }
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -3.2);
  ctx.lineTo(2.4, 0);
  ctx.lineTo(0, 3.2);
  ctx.lineTo(-2.4, 0);
  ctx.closePath();
  ctx.fillStyle = hsl(MIDIO_HUE, 20, 92, 0.95);
  ctx.fill();
  ctx.restore();

  if (f.pointer.grab >= 0) {
    const p = world.particles[f.pointer.grab]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = hsl(MIDIO_HUE, 20, 90, 0.7);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.78);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vg;
  ctx.fillRect(-ox, -oy, w, h);

  if (c.beatFlash > 0.04 && !f.reduced) {
    ctx.fillStyle = hsl(MIDIO_HUE, 30, 80, c.beatFlash * 0.05);
    ctx.fillRect(-ox, -oy, w, h);
  }
}

export function computeIris(
  world: PhysicsWorld,
  pointerX: number,
  pointerY: number,
  blink: number,
) {
  const hub = world.particles[world.hubIndex]!;
  const dx = pointerX - hub.x;
  const dy = pointerY - hub.y;
  const len = Math.hypot(dx, dy) || 1;
  const r = EYE_R * 0.45 * blink;
  return { x: (dx / len) * r, y: (dy / len) * r };
}
