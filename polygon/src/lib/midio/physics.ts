import { curl2 } from "./math";
import { SpatialHash } from "./spatial-hash";
import { unfoldedRim } from "./hull";
import type {
  Constraint,
  ModeConfig,
  Particle,
  PhysicsMode,
  Pose,
  Triangle,
  Vec2,
} from "./types";
import { MODE_CONFIG, XPBD_ITERS } from "./types";

const QUERY: number[] = [];

export interface PhysicsWorld {
  particles: Particle[];
  constraints: Constraint[];
  triangles: Triangle[];
  restPoly: Vec2[];
  hullCount: number;
  hubIndex: number;
  coreCount: number;
  dustStart: number;
  hash: SpatialHash;
  meanStrain: number;
  maxStrain: number;
  fractured: number;
  breakTimer: number;
}

export function createWorld(mesh: {
  particles: Particle[];
  constraints: Constraint[];
  triangles: Triangle[];
  hullCount: number;
  hubIndex: number;
  coreCount: number;
  dustStart: number;
  restPoly: Vec2[];
}): PhysicsWorld {
  return {
    ...mesh,
    hash: new SpatialHash(26),
    meanStrain: 0,
    maxStrain: 0,
    fractured: 0,
    breakTimer: 0,
  };
}

export function placeParticles(world: PhysicsWorld, pose: WorldPose) {
  for (const p of world.particles) {
    const x = pose.tx + (p.restX * pose.scaleX * pose.cos - p.restY * pose.scaleY * pose.sin);
    const y = pose.ty + (p.restX * pose.scaleX * pose.sin + p.restY * pose.scaleY * pose.cos);
    p.x = p.px = x;
    p.y = p.py = y;
    p.vx = 0;
    p.vy = 0;
  }
}

function applyCompliance(cs: Constraint[], cfg: ModeConfig) {
  for (const c of cs) {
    if (c.kind === "hull") c.compliance = cfg.hull;
    else if (c.kind === "spoke") c.compliance = cfg.spoke;
    else if (c.kind === "core") c.compliance = cfg.core;
    else c.compliance = cfg.distance;
  }
}

function polarRotation(a00: number, a01: number, a10: number, a11: number) {
  // 2×2 polar decomposition: R from A via A / sqrt(AᵀA) (stable atan2 form).
  const x = a00 + a11;
  const y = a10 - a01;
  const l = Math.hypot(x, y) || 1;
  const c = x / l;
  const s = y / l;
  return { c, s };
}

function shapeMatch(ps: Particle[], indices: number[], pose: WorldPose, stiffness: number) {
  if (indices.length < 3 || stiffness <= 0) return;
  let m = 0,
    cx = 0,
    cy = 0,
    crx = 0,
    cry = 0;
  for (const i of indices) {
    const p = ps[i]!;
    if (p.invMass === 0 || p.kind === "debris" || p.kind === "dust") continue;
    const mass = 1 / p.invMass;
    m += mass;
    cx += p.x * mass;
    cy += p.y * mass;
    const gx = pose.tx + (p.restX * pose.scaleX * pose.cos - p.restY * pose.scaleY * pose.sin);
    const gy = pose.ty + (p.restX * pose.scaleX * pose.sin + p.restY * pose.scaleY * pose.cos);
    crx += gx * mass;
    cry += gy * mass;
  }
  if (m < 1e-6) return;
  cx /= m;
  cy /= m;
  crx /= m;
  cry /= m;

  let a00 = 0,
    a01 = 0,
    a10 = 0,
    a11 = 0;
  for (const i of indices) {
    const p = ps[i]!;
    if (p.invMass === 0 || p.kind === "debris" || p.kind === "dust") continue;
    const mass = 1 / p.invMass;
    const qx = p.x - cx;
    const qy = p.y - cy;
    const gx = pose.tx + (p.restX * pose.scaleX * pose.cos - p.restY * pose.scaleY * pose.sin);
    const gy = pose.ty + (p.restX * pose.scaleX * pose.sin + p.restY * pose.scaleY * pose.cos);
    const rx = gx - crx;
    const ry = gy - cry;
    a00 += mass * qx * rx;
    a01 += mass * qx * ry;
    a10 += mass * qy * rx;
    a11 += mass * qy * ry;
  }
  const R = polarRotation(a00, a01, a10, a11);
  for (const i of indices) {
    const p = ps[i]!;
    if (p.invMass === 0 || p.kind === "debris" || p.kind === "dust") continue;
    const gx = pose.tx + (p.restX * pose.scaleX * pose.cos - p.restY * pose.scaleY * pose.sin);
    const gy = pose.ty + (p.restX * pose.scaleX * pose.sin + p.restY * pose.scaleY * pose.cos);
    const rx = gx - crx;
    const ry = gy - cry;
    const goalX = cx + R.c * rx - R.s * ry;
    const goalY = cy + R.s * rx + R.c * ry;
    p.x += (goalX - p.x) * stiffness;
    p.y += (goalY - p.y) * stiffness;
  }
}

export interface WorldPose extends Pose {
  cos: number;
  sin: number;
  groundY: number;
  apo: number;
}

function restWorld(p: Particle, pose: WorldPose) {
  return {
    x: pose.tx + (p.restX * pose.scaleX * pose.cos - p.restY * pose.scaleY * pose.sin),
    y: pose.ty + (p.restX * pose.scaleX * pose.sin + p.restY * pose.scaleY * pose.cos),
  };
}

function pinCom(ps: Particle[], indices: number[], pose: WorldPose, stiffness: number) {
  if (indices.length < 1 || stiffness <= 0) return;
  let m = 0,
    cx = 0,
    cy = 0,
    crx = 0,
    cry = 0;
  for (const i of indices) {
    const p = ps[i]!;
    if (p.invMass === 0 || p.kind === "debris" || p.kind === "dust") continue;
    const mass = 1 / p.invMass;
    m += mass;
    cx += p.x * mass;
    cy += p.y * mass;
    const g = restWorld(p, pose);
    crx += g.x * mass;
    cry += g.y * mass;
  }
  if (m < 1e-6) return;
  const dx = (crx / m - cx / m) * stiffness;
  const dy = (cry / m - cy / m) * stiffness;
  for (const i of indices) {
    const p = ps[i]!;
    if (p.invMass === 0 || p.kind === "debris" || p.kind === "dust") continue;
    p.x += dx;
    p.y += dy;
  }
}

export function physicsStep(
  world: PhysicsWorld,
  dt: number,
  pose: WorldPose,
  mode: PhysicsMode,
  energy: number,
  tSec: number,
  kickImpulse: number,
  pointer: { x: number; y: number; down: boolean; grab: number } | null,
) {
  const cfg = MODE_CONFIG[mode];
  applyCompliance(world.constraints, cfg);
  const ps = world.particles;
  const g = cfg.gravity;

  if (kickImpulse > 0) {
    const hub = ps[world.hubIndex]!;
    for (let i = 0; i < world.dustStart; i++) {
      const p = ps[i]!;
      if (p.kind === "dust") continue;
      const dx = p.x - hub.x;
      const dy = p.y - hub.y;
      const len = Math.hypot(dx, dy) || 1;
      const mag = kickImpulse * (0.45 + 0.55 * (p.kind === "hull" ? 1 : 0.6));
      p.vx += (dx / len) * mag;
      p.vy += (dy / len) * mag * 0.35 - mag * 0.25;
    }
    if (mode === "shatter") {
      for (const c of world.constraints) {
        if (c.broken || c.kind === "core" || c.kind === "hull") continue;
        if (Math.random() < 0.07 + energy * 0.05) {
          c.broken = true;
          world.fractured++;
          const a = ps[c.i]!;
          const b = ps[c.j]!;
          if (a.kind === "interior") a.kind = "debris";
          if (b.kind === "interior") b.kind = "debris";
        }
      }
    }
  }

  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    if (p.invMass === 0) continue;
    if (p.kind === "dust") {
      const fl = curl2(p.x * 0.012, p.y * 0.012, tSec * 0.35);
      const rest = restWorld(p, pose);
      p.vx += (fl.x * 90 + (rest.x - p.x) * 1.6) * dt;
      p.vy += (fl.y * 90 + (rest.y - p.y) * 1.6 - 18) * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 2.4;
      continue;
    }
    p.vy += g * dt;
    if (cfg.flock) {
      const rest = restWorld(p, pose);
      p.vx += (rest.x - p.x) * 4.2 * dt;
      p.vy += (rest.y - p.y) * 4.2 * dt;
      const fl = curl2(p.x * 0.02, p.y * 0.02, tSec * 0.7);
      p.vx += fl.x * 140 * dt;
      p.vy += fl.y * 140 * dt;
    }
    p.vx *= cfg.damping;
    p.vy *= cfg.damping;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  if (pointer?.down && pointer.grab >= 0) {
    const p = ps[pointer.grab];
    if (p && p.kind !== "dust") {
      p.x = pointer.x;
      p.y = pointer.y;
      p.vx = 0;
      p.vy = 0;
    }
  }

  const dt2 = dt * dt;
  for (let iter = 0; iter < XPBD_ITERS; iter++) {
    let strainSum = 0,
      strainN = 0,
      maxS = 0;
    for (const c of world.constraints) {
      if (c.broken) continue;
      const a = ps[c.i]!;
      const b = ps[c.j]!;
      if (a.kind === "debris" && b.kind === "debris") continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-8) continue;
      const C = len - c.rest;
      const rel = Math.abs(C) / (c.rest || 1);
      c.strain = rel;
      strainSum += rel;
      strainN++;
      if (rel > maxS) maxS = rel;
      const w = a.invMass + b.invMass;
      if (w <= 0) continue;
      const alpha = c.compliance / dt2;
      const dlambda = -C / (w + alpha);
      const nx = dx / len;
      const ny = dy / len;
      a.x -= nx * dlambda * a.invMass;
      a.y -= ny * dlambda * a.invMass;
      b.x += nx * dlambda * b.invMass;
      b.y += ny * dlambda * b.invMass;
    }
    world.meanStrain = strainN ? strainSum / strainN : 0;
    world.maxStrain = maxS;

    for (const t of world.triangles) {
      const a = ps[t.a]!,
        b = ps[t.b]!,
        c = ps[t.c]!;
      if (a.kind === "debris" || b.kind === "debris" || c.kind === "debris") continue;
      const area = 0.5 * ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      const C = area - t.restArea;
      const wsum = a.invMass + b.invMass + c.invMass;
      if (wsum <= 0) continue;
      const gax = 0.5 * (b.y - c.y),
        gay = 0.5 * (c.x - b.x);
      const gbx = 0.5 * (c.y - a.y),
        gby = 0.5 * (a.x - c.x);
      const gcx = 0.5 * (a.y - b.y),
        gcy = 0.5 * (b.x - a.x);
      const grad2 =
        a.invMass * (gax * gax + gay * gay) +
        b.invMass * (gbx * gbx + gby * gby) +
        c.invMass * (gcx * gcx + gcy * gcy);
      const alpha = cfg.area / dt2;
      const dlambda = -C / (grad2 + alpha + 1e-8);
      a.x += gax * dlambda * a.invMass;
      a.y += gay * dlambda * a.invMass;
      b.x += gbx * dlambda * b.invMass;
      b.y += gby * dlambda * b.invMass;
      c.x += gcx * dlambda * c.invMass;
      c.y += gcy * dlambda * c.invMass;
    }
  }

  const bodyIdx: number[] = [];
  const coreIdx: number[] = [];
  for (let i = 0; i < world.dustStart; i++) {
    const p = ps[i]!;
    if (p.kind === "core") coreIdx.push(i);
    else if (p.kind !== "debris" && p.kind !== "dust") bodyIdx.push(i);
  }
  shapeMatch(ps, bodyIdx, pose, cfg.shape);
  shapeMatch(ps, coreIdx, pose, Math.min(1, cfg.shape + 0.12));
  pinCom(ps, bodyIdx, pose, Math.min(1, 0.35 + cfg.shape * 0.65));
  pinCom(ps, coreIdx, pose, 1);

  if (mode === "shatter") {
    for (const c of world.constraints) {
      if (c.broken || c.kind === "core") continue;
      if (c.strain > cfg.fracture) {
        c.broken = true;
        world.fractured++;
        const a = ps[c.i]!;
        const b = ps[c.j]!;
        if (a.kind === "interior") a.kind = "debris";
        if (b.kind === "interior") b.kind = "debris";
        a.spin = (Math.random() * 2 - 1) * 8;
        b.spin = (Math.random() * 2 - 1) * 8;
      }
    }
    if (world.fractured > 0) world.breakTimer += dt;
    if (world.breakTimer > cfg.reassembleSec) reassemble(world);
  } else if (world.fractured > 0) {
    world.breakTimer += dt;
    if (world.breakTimer > cfg.reassembleSec * 0.5) reassemble(world);
  }

  world.hash.rebuild(ps, world.dustStart);
  for (let i = 0; i < world.dustStart; i++) {
    const p = ps[i]!;
    if (p.kind !== "debris") continue;
    world.hash.query(p.x, p.y, p.radius * 2.2, QUERY);
    for (const j of QUERY) {
      if (j <= i) continue;
      const q = ps[j]!;
      if (q.kind !== "debris") continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      const min = p.radius + q.radius;
      if (d2 > min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d,
        ny = dy / d;
      const pen = min - d;
      const w = p.invMass + q.invMass;
      if (w <= 0) continue;
      p.x -= nx * pen * (p.invMass / w);
      p.y -= ny * pen * (p.invMass / w);
      q.x += nx * pen * (q.invMass / w);
      q.y += ny * pen * (q.invMass / w);
    }
  }

  const gy = pose.groundY;
  for (let i = 0; i < world.dustStart; i++) {
    const p = ps[i]!;
    if (p.y + p.radius > gy) {
      const pen = p.y + p.radius - gy;
      p.y -= pen;
      if (p.vy > 0) p.vy *= -0.18;
      p.vx *= 0.72;
    }
  }
}

function reassemble(world: PhysicsWorld) {
  for (const c of world.constraints) c.broken = false;
  for (const p of world.particles) {
    if (p.kind === "debris") p.kind = "interior";
    p.spin = 0;
  }
  world.fractured = 0;
  world.breakTimer = 0;
}

export function applyApotheosis(world: PhysicsWorld, amount: number) {
  const rim = world.restPoly;
  const hub = { x: world.particles[world.hubIndex]!.restX, y: world.particles[world.hubIndex]!.restY };
  const next = unfoldedRim(rim, hub, amount);
  for (let i = 0; i < world.hullCount; i++) {
    const p = world.particles[1 + i]!;
    const t = next[i] ?? rim[i]!;
    p.restX = t.x;
    p.restY = t.y;
  }
}

export function nearestParticle(world: PhysicsWorld, x: number, y: number, maxR = 46) {
  let best = -1,
    bestD = maxR * maxR;
  for (let i = 0; i < world.dustStart; i++) {
    const p = world.particles[i]!;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
