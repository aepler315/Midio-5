import type { Vec2 } from "./types";

function orient(a: Vec2, b: Vec2, c: Vec2) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function makeTri(points: Vec2[], a: number, b: number, c: number): [number, number, number] {
  return orient(points[a]!, points[b]!, points[c]!) < 0 ? [a, c, b] : [a, b, c];
}

function circumcircleContains(p: Vec2, a: Vec2, b: Vec2, c: Vec2) {
  const ax = a.x - p.x,
    ay = a.y - p.y;
  const bx = b.x - p.x,
    by = b.y - p.y;
  const cx = c.x - p.x,
    cy = c.y - p.y;
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  return det > 1e-9;
}

/** Bowyer–Watson. Returns CCW index triples. */
export function delaunayTriangulate(inputPoints: Vec2[]): number[][] {
  if (inputPoints.length < 3) return [];

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of inputPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX,
    dy = maxY - minY;
  const deltaMax = Math.max(dx, dy, 1) * 10;
  const midX = (minX + maxX) / 2,
    midY = (minY + maxY) / 2;

  const points: Vec2[] = [
    ...inputPoints,
    { x: midX - deltaMax, y: midY - deltaMax },
    { x: midX, y: midY + deltaMax * 2 },
    { x: midX + deltaMax, y: midY - deltaMax },
  ];
  const s1 = inputPoints.length,
    s2 = s1 + 1,
    s3 = s1 + 2;

  let triangles: number[][] = [makeTri(points, s1, s2, s3)];

  for (let pi = 0; pi < inputPoints.length; pi++) {
    const p = points[pi]!;
    const bad: number[][] = [];
    for (const t of triangles) {
      if (circumcircleContains(p, points[t[0]!]!, points[t[1]!]!, points[t[2]!]!)) bad.push(t);
    }
    if (bad.length === 0) continue;

    const edgeMap = new Map<string, { count: number; a: number; b: number }>();
    for (const t of bad) {
      const edges = [
        [t[0]!, t[1]!],
        [t[1]!, t[2]!],
        [t[2]!, t[0]!],
      ];
      for (const [a, b] of edges) {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        const rec = edgeMap.get(k);
        if (rec) rec.count++;
        else edgeMap.set(k, { count: 1, a, b });
      }
    }

    const badSet = new Set(bad);
    triangles = triangles.filter((t) => !badSet.has(t));
    for (const { count, a, b } of edgeMap.values()) {
      if (count === 1) triangles.push(makeTri(points, a, b, pi));
    }
  }

  return triangles.filter(
    (t) => t[0]! < inputPoints.length && t[1]! < inputPoints.length && t[2]! < inputPoints.length,
  );
}

export function poissonDisc(
  width: number,
  height: number,
  radius: number,
  rand: () => number,
  originX = 0,
  originY = 0,
  accept?: (x: number, y: number) => boolean,
  maxAttempts = 28,
): Vec2[] {
  const cellSize = radius / Math.SQRT2;
  const gridW = Math.ceil(width / cellSize) || 1;
  const gridH = Math.ceil(height / cellSize) || 1;
  const grid = new Array<number>(gridW * gridH).fill(-1);
  const points: Vec2[] = [];
  const active: number[] = [];

  const gridIndex = (x: number, y: number) =>
    Math.floor((x - originX) / cellSize) + Math.floor((y - originY) / cellSize) * gridW;

  const fits = (x: number, y: number) => {
    if (x < originX || y < originY || x >= originX + width || y >= originY + height) return false;
    if (accept && !accept(x, y)) return false;
    const gx = Math.floor((x - originX) / cellSize);
    const gy = Math.floor((y - originY) / cellSize);
    for (let j = Math.max(0, gy - 2); j <= Math.min(gridH - 1, gy + 2); j++) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(gridW - 1, gx + 2); i++) {
        const idx = grid[i + j * gridW]!;
        if (idx !== -1) {
          const q = points[idx]!;
          if ((q.x - x) ** 2 + (q.y - y) ** 2 < radius * radius) return false;
        }
      }
    }
    return true;
  };

  let first: Vec2 | null = null;
  for (let tries = 0; tries < 80; tries++) {
    const x = originX + rand() * width;
    const y = originY + rand() * height;
    if (!accept || accept(x, y)) {
      first = { x, y };
      break;
    }
  }
  if (!first) return points;
  points.push(first);
  active.push(0);
  grid[gridIndex(first.x, first.y)] = 0;

  while (active.length > 0) {
    const sel = Math.floor(rand() * active.length);
    const idx = active[sel]!;
    const base = points[idx]!;
    let found = false;
    for (let k = 0; k < maxAttempts; k++) {
      const ang = rand() * Math.PI * 2;
      const r = radius * (1 + rand());
      const x = base.x + Math.cos(ang) * r;
      const y = base.y + Math.sin(ang) * r;
      if (fits(x, y)) {
        points.push({ x, y });
        active.push(points.length - 1);
        const gi = gridIndex(x, y);
        if (gi >= 0 && gi < grid.length) grid[gi] = points.length - 1;
        found = true;
        break;
      }
    }
    if (!found) active.splice(sel, 1);
  }
  return points;
}
