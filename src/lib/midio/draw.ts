import { EYE_CY, EYE_R, signedArea } from "./hull";
import { hsl } from "./math";
import type { PhysicsWorld } from "./physics";
import type { ConductorState } from "./conductor";
import { MIDIO_HUE, type Abstraction, type PhysicsMode } from "./types";

export interface DrawFrame {
  w: number;
  h: number;
  dpr: number;
  tSec: number;
  world: PhysicsWorld;
  conductor: ConductorState;
  mode: PhysicsMode;
  abstraction: Abstraction;
  pointer: { x: number; y: number; grab: number };
  reduced: boolean;
  iris: { x: number; y: number };
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

function sky(ctx: CanvasRenderingContext2D, w: number, h: number, gy: number) {
  const g = ctx.createLinearGradient(0, 0, 0, gy);
  g.addColorStop(0, "#1c1a16");
  g.addColorStop(0.42, "#6a6a32");
  g.addColorStop(0.72, "#c4b24a");
  g.addColorStop(1, "#8a7a38");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, gy);
}

function stars(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "rgba(255,255,240,0.55)";
  for (let i = 0; i < 42; i++) {
    const x = ((i * 127) % w) + Math.sin(t * 0.04 + i) * 2;
    const y = ((i * 53) % (h * 0.32)) + 8;
    const r = i % 7 === 0 ? 1.6 : 0.9;
    ctx.fillRect(x, y, r, r);
  }
}

function spaceRidge(ctx: CanvasRenderingContext2D, w: number, y: number, t: number) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    const yy = y + Math.sin(i * 0.7 + t * 0.12) * 6;
    if (i === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  ctx.strokeStyle = "rgba(236, 196, 220, 0.55)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    const yy = y + Math.sin(i * 0.7 + t * 0.12) * 6;
    ctx.beginPath();
    ctx.arc(x, yy, 3.1, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 236, 246, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(40, 20, 40, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function moon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 3.2);
  glow.addColorStop(0, "rgba(255,255,230,0.18)");
  glow.addColorStop(1, "rgba(255,255,230,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 7; i++) {
    const a = -0.55 + i * 0.18;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4));
    ctx.lineTo(x + Math.cos(a) * (r + 64 + i * 8), y + Math.sin(a) * (r + 130));
    ctx.strokeStyle = `rgba(255,255,220,${0.07 + i * 0.01})`;
    ctx.lineWidth = 9;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0.55, Math.PI * 1.65, false);
  ctx.arc(x + r * 0.38, y - r * 0.06, r * 0.78, Math.PI * 1.55, 0.65, true);
  ctx.closePath();
  ctx.fillStyle = "#f4f0d8";
  ctx.fill();
  ctx.restore();
}

function mountains(ctx: CanvasRenderingContext2D, w: number, gy: number) {
  const layers = [
    { hue: 168, sat: 28, light: 18, stroke: 292, y: gy - 168, seed: 1.1 },
    { hue: 170, sat: 32, light: 22, stroke: 286, y: gy - 118, seed: 2.4 },
    { hue: 172, sat: 30, light: 16, stroke: 280, y: gy - 72, seed: 3.7 },
  ];
  for (const L of layers) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(0, L.y + 20);
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const peak = Math.abs(Math.sin(i * L.seed + 0.4)) * 54 + Math.abs(Math.sin(i * 2.3 + L.seed)) * 22;
      const jag = i % 3 === 0 ? 18 : i % 2 === 0 ? 6 : 0;
      ctx.lineTo(x, L.y - peak - jag);
    }
    ctx.lineTo(w, gy);
    ctx.closePath();
    ctx.fillStyle = hsl(L.hue, L.sat, L.light, 1);
    ctx.fill();
    ctx.strokeStyle = hsl(L.stroke, 28, 42, 0.85);
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "miter";
    ctx.stroke();
  }
}

function dirt(ctx: CanvasRenderingContext2D, w: number, h: number, gy: number) {
  const g = ctx.createLinearGradient(0, gy, 0, h);
  g.addColorStop(0, "#7a4a32");
  g.addColorStop(0.35, "#5a3222");
  g.addColorStop(1, "#3a2016");
  ctx.fillStyle = g;
  ctx.fillRect(0, gy, w, h - gy);
  ctx.strokeStyle = "rgba(40, 18, 12, 0.45)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const y = gy + 18 + i * 16;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + 4, w * 0.6, y - 3, w, y + 2);
    ctx.stroke();
  }
}

function hullPath(ctx: CanvasRenderingContext2D, world: PhysicsWorld) {
  ctx.beginPath();
  for (let i = 1; i <= world.hullCount; i++) {
    const p = world.particles[i]!;
    if (i === 1) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

function circumcenter(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) {
    return { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3 };
  }
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  return {
    x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
    y: (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d,
  };
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  f: DrawFrame,
  alpha = 0.95,
) {
  const c = f.conductor;
  const restHub = f.world.particles[f.world.hubIndex]!;
  const eyeX = restHub.x + f.iris.x;
  const eyeY = restHub.y + (EYE_CY - restHub.restY) + f.iris.y * 0.15;
  ctx.save();
  ctx.translate(eyeX, eyeY);
  ctx.scale(1, Math.max(0.12, c.blink));
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = hsl(MIDIO_HUE, 30, 88, 0.95);
  ctx.lineWidth = 1.5;
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
  ctx.fillStyle = hsl(MIDIO_HUE, 20, 94, 0.95);
  ctx.fill();
  ctx.restore();
}

function drawDebris(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  const { world, tSec } = f;
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
      hsl(MIDIO_HUE, 18, 72, 0.28 + 0.22 * Math.sin(tSec * 2 + p.phase)),
    );
  }
}

function drawLattice(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  const { world, conductor: c } = f;
  hullPath(ctx, world);
  ctx.fillStyle = hsl(MIDIO_HUE, 12, 88, 0.1);
  ctx.fill();

  ctx.save();
  for (const t of world.triangles) {
    const a = world.particles[t.a]!;
    const b = world.particles[t.b]!;
    const cc = world.particles[t.c]!;
    if (a.kind === "debris" || b.kind === "debris" || cc.kind === "debris") continue;
    const area = signedArea(a, b, cc);
    const strain = Math.min(1, (Math.abs(area - t.restArea) / (Math.abs(t.restArea) || 1)) * 2.2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(cc.x, cc.y);
    ctx.closePath();
    ctx.fillStyle = hsl(140, 40 + strain * 20, 42 + strain * 18, 0.07 + strain * 0.12);
    ctx.fill();
  }
  ctx.restore();

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const e of world.constraints) {
    if (e.broken) continue;
    const a = world.particles[e.i]!;
    const b = world.particles[e.j]!;
    if (a.kind === "dust" || b.kind === "dust") continue;
    if (e.kind === "hull") continue;
    const glowAmt = Math.min(1, e.strain * 3);
    const isCore = e.kind === "core";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = hsl(
      isCore ? MIDIO_HUE : 128,
      isCore ? 40 : 62 + glowAmt * 20,
      isCore ? 78 : 58 + glowAmt * 18,
      isCore ? 0.85 : 0.72 + glowAmt * 0.2,
    );
    ctx.lineWidth = isCore ? 1.35 : 1.55 + glowAmt * 1.2;
    ctx.stroke();
  }

  ctx.lineJoin = "miter";
  ctx.miterLimit = 2.6;
  ctx.lineCap = "butt";
  hullPath(ctx, world);
  ctx.strokeStyle = "rgba(12, 16, 22, 0.85)";
  ctx.lineWidth = 4.4;
  ctx.stroke();
  ctx.strokeStyle = "rgba(248, 252, 255, 0.96)";
  ctx.lineWidth = 2.15;
  ctx.stroke();
  drawEye(ctx, f);
}

function drawFacet(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  const { world, conductor: c } = f;
  const beat = c.beatFlash;
  for (let ghost = 2; ghost >= 0; ghost--) {
    const ox = (ghost - 1) * (7 + beat * 10);
    const oy = (1 - ghost) * (4 + beat * 6);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.globalAlpha = ghost === 0 ? 1 : 0.22 + beat * 0.12;
    for (const t of world.triangles) {
      const a = world.particles[t.a]!;
      const b = world.particles[t.b]!;
      const cc = world.particles[t.c]!;
      if (a.kind === "debris" || b.kind === "debris" || cc.kind === "debris") continue;
      const area = signedArea(a, b, cc);
      const strain = Math.min(1, (Math.abs(area - t.restArea) / (Math.abs(t.restArea) || 1)) * 2.2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(cc.x, cc.y);
      ctx.closePath();
      const hue = MIDIO_HUE + ghost * 18 + strain * 24;
      ctx.fillStyle = hsl(hue, 28 + strain * 30, 18 + ghost * 10 + strain * 22, 0.82);
      ctx.fill();
      ctx.strokeStyle = hsl(MIDIO_HUE, 10, 8, 0.55);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    ctx.restore();
  }
  hullPath(ctx, world);
  ctx.strokeStyle = hsl(MIDIO_HUE, 12, 88, 0.35);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  drawEye(ctx, f, 0.8);
}

function drawVoronoi(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  const { world } = f;
  const n = world.dustStart;
  const cells: { x: number; y: number }[][] = Array.from({ length: n }, () => []);
  for (const t of world.triangles) {
    const a = world.particles[t.a]!;
    const b = world.particles[t.b]!;
    const cc = world.particles[t.c]!;
    if (a.kind === "debris" || b.kind === "debris" || cc.kind === "debris") continue;
    const c0 = circumcenter(a.x, a.y, b.x, b.y, cc.x, cc.y);
    cells[t.a]!.push(c0);
    cells[t.b]!.push(c0);
    cells[t.c]!.push(c0);
  }
  ctx.save();
  hullPath(ctx, world);
  ctx.clip();
  for (let i = 0; i < n; i++) {
    const site = world.particles[i]!;
    if (site.kind === "debris" || site.kind === "dust") continue;
    const pts = cells[i]!;
    if (pts.length < 3) continue;
    pts.sort((p, q) => Math.atan2(p.y - site.y, p.x - site.x) - Math.atan2(q.y - site.y, q.x - site.x));
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]!.x, pts[k]!.y);
    ctx.closePath();
    const kindHue = site.kind === "hub" ? MIDIO_HUE : site.kind === "core" ? 48 : site.kind === "hull" ? 170 : 140;
    ctx.fillStyle = hsl(kindHue, 36, 22 + (i % 5) * 6, 0.78);
    ctx.fill();
    ctx.strokeStyle = hsl(MIDIO_HUE, 20, 88, 0.55);
    ctx.lineWidth = 0.85;
    ctx.stroke();
  }
  ctx.restore();
  hullPath(ctx, world);
  ctx.strokeStyle = "rgba(248, 252, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const p = world.particles[i]!;
    if (p.kind === "debris") continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.kind === "hub" ? 3.2 : 1.6, 0, Math.PI * 2);
    ctx.fillStyle = hsl(MIDIO_HUE, 20, 92, 0.85);
    ctx.fill();
  }
  drawEye(ctx, f, 0.7);
}

function drawConstruct(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  const { world, conductor: c } = f;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 1; i <= world.hullCount; i++) {
    const p = world.particles[i]!;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  ctx.fillStyle = hsl(MIDIO_HUE, 18, 72, 0.1 + c.beatFlash * 0.08);
  ctx.fillRect(minX + bw * 0.12, minY + bh * 0.08, bw * 0.46, bh * 0.28);
  ctx.fillStyle = hsl(12, 40, 42, 0.1);
  ctx.fillRect(minX + bw * 0.48, minY + bh * 0.34, bw * 0.38, bh * 0.22);
  ctx.fillStyle = hsl(48, 50, 58, 0.08);
  ctx.fillRect(minX + bw * 0.22, minY + bh * 0.58, bw * 0.52, bh * 0.3);

  for (const e of world.constraints) {
    if (e.broken) continue;
    const a = world.particles[e.i]!;
    const b = world.particles[e.j]!;
    if (a.kind === "dust" || b.kind === "dust") continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const hw = e.kind === "hull" ? 3.4 : e.kind === "spoke" ? 2.2 : e.kind === "core" ? 2.6 : 1.4;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * hw, a.y + ny * hw);
    ctx.lineTo(b.x + nx * hw, b.y + ny * hw);
    ctx.lineTo(b.x - nx * hw, b.y - ny * hw);
    ctx.lineTo(a.x - nx * hw, a.y - ny * hw);
    ctx.closePath();
    ctx.fillStyle = e.kind === "hull"
      ? "rgba(244, 248, 252, 0.92)"
      : hsl(128, 55, 48, 0.78);
    ctx.fill();
    ctx.strokeStyle = "rgba(10, 14, 20, 0.7)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  for (let i = 0; i <= world.hullCount; i++) {
    const p = world.particles[i]!;
    const s = p.kind === "hub" ? 7 : 4.2;
    ctx.fillStyle = i === 0 ? hsl(MIDIO_HUE, 30, 88, 0.95) : "rgba(248,252,255,0.95)";
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    ctx.strokeStyle = "rgba(10,14,20,0.8)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  drawEye(ctx, f, 0.55);
}

function drawOrbit(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  const { world, conductor: c } = f;
  const hub = world.particles[world.hubIndex]!;
  const rings = [0.28, 0.5, 0.72, 1];
  ctx.lineJoin = "miter";
  ctx.miterLimit = 2.4;
  ctx.lineCap = "butt";
  for (let r = 0; r < rings.length; r++) {
    const t = rings[r]!;
    ctx.beginPath();
    for (let i = 1; i <= world.hullCount; i++) {
      const p = world.particles[i]!;
      const x = hub.x + (p.x - hub.x) * t;
      const y = hub.y + (p.y - hub.y) * t;
      if (i === 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = hsl(MIDIO_HUE, 20, 88, 0.28 + t * 0.55);
    ctx.lineWidth = 0.8 + t * 1.4;
    ctx.stroke();
  }
  for (let i = 1; i <= world.hullCount; i += 2) {
    const p = world.particles[i]!;
    ctx.beginPath();
    ctx.moveTo(hub.x, hub.y);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = hsl(128, 50, 55, 0.55 + c.beatFlash * 0.25);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  let maxR = 0;
  for (let i = 1; i <= world.hullCount; i++) {
    const p = world.particles[i]!;
    const rr = Math.hypot(p.x - hub.x, p.y - hub.y);
    if (rr > maxR) maxR = rr;
  }
  for (const t of rings) {
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, maxR * t, 0, Math.PI * 2);
    ctx.strokeStyle = hsl(MIDIO_HUE, 12, 80, 0.12);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  hullPath(ctx, world);
  ctx.strokeStyle = "rgba(248,252,255,0.92)";
  ctx.lineWidth = 2.1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, 4.2, 0, Math.PI * 2);
  ctx.fillStyle = hsl(MIDIO_HUE, 24, 92, 0.95);
  ctx.fill();
  drawEye(ctx, f);
}

function drawGlyph(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  switch (f.abstraction) {
    case "facet":
      drawFacet(ctx, f);
      break;
    case "voronoi":
      drawVoronoi(ctx, f);
      break;
    case "construct":
      drawConstruct(ctx, f);
      break;
    case "orbit":
      drawOrbit(ctx, f);
      break;
    default:
      drawLattice(ctx, f);
  }
  drawDebris(ctx, f);
}

export function drawScene(ctx: CanvasRenderingContext2D, f: DrawFrame) {
  const { w, h, world, conductor: c, tSec } = f;
  const shake = f.reduced ? 0 : c.trauma * c.trauma;
  const ox = shake * 7 * Math.sin(tSec * 73.1);
  const oy = shake * 5 * Math.cos(tSec * 61.7);
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.translate(ox, oy);

  const gy = h * 0.78;
  sky(ctx, w, h, gy);
  stars(ctx, w, h, tSec);
  spaceRidge(ctx, w, h * 0.13, tSec);
  moon(ctx, w * 0.78, h * 0.16, 28);
  mountains(ctx, w, gy);
  dirt(ctx, w, h, gy);

  const hub = world.particles[world.hubIndex]!;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  const shadow = ctx.createRadialGradient(hub.x, gy + 6, 4, hub.x, gy + 6, 80);
  shadow.addColorStop(0, "rgba(0,0,0,0.5)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(hub.x, gy + 8, 58, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const glowR = 58 + c.beatFlash * 22 + c.apo * 16;
  const glow = ctx.createRadialGradient(hub.x, hub.y, 6, hub.x, hub.y, glowR);
  glow.addColorStop(0, hsl(MIDIO_HUE, 48, 72, 0.22 + c.beatFlash * 0.2));
  glow.addColorStop(1, hsl(MIDIO_HUE, 40, 70, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, glowR, 0, Math.PI * 2);
  ctx.fill();

  drawGlyph(ctx, f);

  if (f.pointer.grab >= 0) {
    const p = world.particles[f.pointer.grab]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = hsl(MIDIO_HUE, 20, 90, 0.7);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  if (c.beatFlash > 0.04 && !f.reduced) {
    ctx.fillStyle = hsl(MIDIO_HUE, 30, 80, c.beatFlash * 0.04);
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
