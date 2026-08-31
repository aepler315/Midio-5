import type { Vec2 } from "./types";

const RAW_HUB: Vec2 = { x: 0, y: -30 };
const RAW_RIM: Vec2[] = [
  { x: 0.6, y: -64 },
  { x: 6.2, y: -54 },
  { x: 11.4, y: -40 },
  { x: 10.2, y: -24 },
  { x: 8.0, y: -10 },
  { x: 6.8, y: 0 },
  { x: 0.0, y: -3.2 },
  { x: -6.2, y: 0 },
  { x: -7.4, y: -11 },
  { x: -9.4, y: -25 },
  { x: -10.4, y: -41 },
  { x: -5.4, y: -55 },
];

export const HULL_SCALE = 4.6;
export const HUB: Vec2 = { x: RAW_HUB.x * HULL_SCALE, y: RAW_HUB.y * HULL_SCALE };
export const EYE_CY = -38 * HULL_SCALE;
export const EYE_R = 4.4 * HULL_SCALE;

export function scalePt(p: Vec2, s = HULL_SCALE): Vec2 {
  return { x: p.x * s, y: p.y * s };
}

export function originalRim(scale = HULL_SCALE): Vec2[] {
  return RAW_RIM.map((p) => scalePt(p, scale));
}

export function denseRim(subdiv = 2, scale = HULL_SCALE): Vec2[] {
  const rim = originalRim(scale);
  const out: Vec2[] = [];
  const n = rim.length;
  for (let i = 0; i < n; i++) {
    const a = rim[i]!;
    const b = rim[(i + 1) % n]!;
    out.push({ x: a.x, y: a.y });
    for (let k = 1; k <= subdiv; k++) {
      const t = k / (subdiv + 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function unfoldedRim(rim: Vec2[], hub: Vec2, amount: number): Vec2[] {
  return rim.map((v, i) => {
    const dx = v.x - hub.x;
    const dy = v.y - hub.y;
    const r = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const even = i % 3 === 0;
    const reach = even ? r * (1 + 0.35 * amount) : r * (1 + 1.05 * amount);
    return { x: hub.x + Math.cos(ang) * reach, y: hub.y + Math.sin(ang) * reach };
  });
}

export function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    const intersect =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polyCentroid(poly: Vec2[]): Vec2 {
  let x = 0,
    y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  const n = poly.length || 1;
  return { x: x / n, y: y / n };
}

export function signedArea(a: Vec2, b: Vec2, c: Vec2) {
  return 0.5 * ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

export function hexagramVerts(r: number, cx: number, cy: number): Vec2[] {
  const tri = (offsetDeg: number) =>
    [0, 1, 2].map((i) => {
      const a = ((offsetDeg + i * 120) * Math.PI) / 180;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });
  return [{ x: cx, y: cy }, ...tri(-90), ...tri(90)];
}
