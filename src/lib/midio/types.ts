export type ParticleKind = "hub" | "hull" | "interior" | "core" | "debris" | "dust";
export type ConstraintKind = "hull" | "edge" | "spoke" | "core";
export type PhysicsMode = "crystal" | "visco" | "shatter" | "swarm";
export type Abstraction = "lattice" | "facet" | "voronoi" | "construct" | "orbit";

export const ABSTRACTIONS: { id: Abstraction; label: string; key: string; blurb: string }[] = [
  { id: "lattice", label: "Lattice", key: "Q", blurb: "Point-line-plane. Hull contour + interior braces." },
  { id: "facet", label: "Facet", key: "W", blurb: "Analytical cubism. Strain-tinted Delaunay planes, ghosted viewpoints." },
  { id: "voronoi", label: "Voronoi", key: "E", blurb: "Tessellation dual. Each vertex owns the cell of nearest space." },
  { id: "construct", label: "Construct", key: "R", blurb: "Constructivist beams and suprematist planes. Mass as bars." },
  { id: "orbit", label: "Orbit", key: "T", blurb: "Polar reduction. Concentric hulls and radial spokes from the hub." },
];

export interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  invMass: number;
  restX: number;
  restY: number;
  kind: ParticleKind;
  radius: number;
  phase: number;
  spin: number;
  grabInvMass: number;
}

export interface Constraint {
  i: number;
  j: number;
  rest: number;
  compliance: number;
  kind: ConstraintKind;
  broken: boolean;
  strain: number;
}

export interface Triangle {
  a: number;
  b: number;
  c: number;
  restArea: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pose {
  tx: number;
  ty: number;
  rot: number;
  scaleX: number;
  scaleY: number;
}

export interface ModeConfig {
  distance: number;
  hull: number;
  spoke: number;
  core: number;
  area: number;
  shape: number;
  gravity: number;
  damping: number;
  fracture: number;
  reassembleSec: number;
  flock: number;
}

export const MODE_CONFIG: Record<PhysicsMode, ModeConfig> = {
  crystal: {
    distance: 8e-7,
    hull: 1e-8,
    spoke: 4e-7,
    core: 1e-8,
    area: 4e-5,
    shape: 0.88,
    gravity: 920,
    damping: 0.992,
    fracture: 8,
    reassembleSec: 1.6,
    flock: 0,
  },
  visco: {
    distance: 6e-4,
    hull: 8e-5,
    spoke: 4e-4,
    core: 4e-6,
    area: 1.4e-3,
    shape: 0.34,
    gravity: 640,
    damping: 0.978,
    fracture: 9,
    reassembleSec: 2.2,
    flock: 0,
  },
  shatter: {
    distance: 2e-5,
    hull: 6e-6,
    spoke: 2e-5,
    core: 2e-7,
    shape: 0.62,
    area: 2e-4,
    gravity: 1100,
    damping: 0.988,
    fracture: 0.12,
    reassembleSec: 2.6,
    flock: 0,
  },
  swarm: {
    distance: 2.4e-3,
    hull: 6e-4,
    spoke: 1.6e-3,
    core: 8e-5,
    area: 4e-3,
    shape: 0.14,
    gravity: 180,
    damping: 0.96,
    fracture: 12,
    reassembleSec: 1.2,
    flock: 1,
  },
};

export const MIDIO_HUE = 178;
export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const XPBD_ITERS = 5;
