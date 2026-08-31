import { delaunayTriangulate, poissonDisc } from "./delaunay";
import {
  denseRim,
  EYE_CY,
  EYE_R,
  hexagramVerts,
  HUB,
  pointInPoly,
  signedArea,
} from "./hull";
import { mulberry32 } from "./math";
import type { Constraint, Particle, ParticleKind, Triangle, Vec2 } from "./types";

export interface MeshBuild {
  particles: Particle[];
  constraints: Constraint[];
  triangles: Triangle[];
  hullCount: number;
  hubIndex: number;
  coreCount: number;
  dustStart: number;
  restPoly: Vec2[];
}

function makeParticle(
  x: number,
  y: number,
  kind: ParticleKind,
  mass: number,
  radius: number,
  phase: number,
): Particle {
  return {
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    invMass: mass > 0 ? 1 / mass : 0,
    restX: x,
    restY: y,
    kind,
    radius,
    phase,
    spin: 0,
    grabInvMass: mass > 0 ? 1 / mass : 0,
  };
}

function addConstraint(
  list: Constraint[],
  seen: Set<string>,
  i: number,
  j: number,
  pts: Vec2[],
  kind: Constraint["kind"],
) {
  if (i === j) return;
  const a = Math.min(i, j),
    b = Math.max(i, j);
  const key = `${a}:${b}`;
  if (seen.has(key)) return;
  seen.add(key);
  const pa = pts[a]!,
    pb = pts[b]!;
  list.push({
    i: a,
    j: b,
    rest: Math.hypot(pb.x - pa.x, pb.y - pa.y),
    compliance: 0,
    kind,
    broken: false,
    strain: 0,
  });
}

export function buildMidioMesh(seed = 0x5eed): MeshBuild {
  const rand = mulberry32(seed);
  const rim = denseRim(2);
  const hub = { x: HUB.x, y: HUB.y };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of rim) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 8;
  const interior = poissonDisc(
    maxX - minX + pad * 2,
    maxY - minY + pad * 2,
    12.5,
    rand,
    minX - pad,
    minY - pad,
    (x, y) => {
      if (!pointInPoly({ x, y }, rim)) return false;
      for (const h of rim) {
        if ((h.x - x) ** 2 + (h.y - y) ** 2 < 9 * 9) return false;
      }
      if ((hub.x - x) ** 2 + (hub.y - y) ** 2 < 9 * 9) return false;
      return true;
    },
  );

  const core = hexagramVerts(EYE_R * 0.92, 0, EYE_CY);

  const pts: Vec2[] = [hub, ...rim, ...interior, ...core];
  const kinds: ParticleKind[] = [
    "hub",
    ...rim.map(() => "hull" as const),
    ...interior.map(() => "interior" as const),
    ...core.map(() => "core" as const),
  ];

  const particles: Particle[] = pts.map((p, i) => {
    const kind = kinds[i]!;
    const mass = kind === "hub" ? 3.4 : kind === "hull" ? 1.55 : kind === "core" ? 2.1 : 1;
    const radius = kind === "hub" ? 4.2 : kind === "hull" ? 3.1 : kind === "core" ? 2.4 : 2.2;
    return makeParticle(p.x, p.y, kind, mass, radius, rand() * Math.PI * 2);
  });

  const bodyCount = 1 + rim.length + interior.length;
  const bodyPts = pts.slice(0, bodyCount);
  const trisRaw = delaunayTriangulate(bodyPts);
  const triangles: Triangle[] = [];
  for (const t of trisRaw) {
    const a = bodyPts[t[0]!]!,
      b = bodyPts[t[1]!]!,
      c = bodyPts[t[2]!]!;
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    if (!pointInPoly({ x: cx, y: cy }, rim)) continue;
    const area = signedArea(a, b, c);
    if (Math.abs(area) < 4) continue;
    triangles.push({ a: t[0]!, b: t[1]!, c: t[2]!, restArea: area });
  }

  const constraints: Constraint[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rim.length; i++) {
    addConstraint(constraints, seen, 1 + i, 1 + ((i + 1) % rim.length), pts, "hull");
  }
  for (const t of triangles) {
    addConstraint(constraints, seen, t.a, t.b, pts, "edge");
    addConstraint(constraints, seen, t.b, t.c, pts, "edge");
    addConstraint(constraints, seen, t.c, t.a, pts, "edge");
  }
  for (let i = 0; i < rim.length; i += 2) {
    addConstraint(constraints, seen, 0, 1 + i, pts, "spoke");
  }

  const coreStart = bodyCount;
  for (let i = 0; i < core.length; i++) {
    for (let j = i + 1; j < core.length; j++) {
      addConstraint(constraints, seen, coreStart + i, coreStart + j, pts, "core");
    }
    addConstraint(constraints, seen, 0, coreStart + i, pts, "spoke");
  }

  const dustStart = particles.length;
  const dustN = 42;
  for (let i = 0; i < dustN; i++) {
    const ang = (i / dustN) * Math.PI * 2 + rand() * 0.2;
    const r = 38 + rand() * 70;
    const x = hub.x + Math.cos(ang) * r;
    const y = hub.y + Math.sin(ang) * r * 1.15;
    particles.push(makeParticle(x, y, "dust", 0.28, 1.4, rand() * Math.PI * 2));
  }

  return {
    particles,
    constraints,
    triangles,
    hullCount: rim.length,
    hubIndex: 0,
    coreCount: core.length,
    dustStart,
    restPoly: rim,
  };
}
