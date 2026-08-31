export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number) {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function mulberry32(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(n: number) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function hsl(h: number, s: number, l: number, a = 1) {
  return `hsla(${h | 0} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}% / ${clamp01(a)})`;
}

/** Value noise, then curl so the field is divergence-free. */
export function curl2(x: number, y: number, t: number) {
  const e = 0.75;
  const n1 = valueNoise(x, y + e, t);
  const n2 = valueNoise(x, y - e, t);
  const n3 = valueNoise(x + e, y, t);
  const n4 = valueNoise(x - e, y, t);
  return { x: (n1 - n2) * 0.5, y: (n4 - n3) * 0.5 };
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise(x: number, y: number, z: number) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    z0 = Math.floor(z);
  const fx = fade(x - x0),
    fy = fade(y - y0),
    fz = fade(z - z0);
  const n000 = lattice(x0, y0, z0);
  const n100 = lattice(x0 + 1, y0, z0);
  const n010 = lattice(x0, y0 + 1, z0);
  const n110 = lattice(x0 + 1, y0 + 1, z0);
  const n001 = lattice(x0, y0, z0 + 1);
  const n101 = lattice(x0 + 1, y0, z0 + 1);
  const n011 = lattice(x0, y0 + 1, z0 + 1);
  const n111 = lattice(x0 + 1, y0 + 1, z0 + 1);
  const nx00 = lerp(n000, n100, fx);
  const nx10 = lerp(n010, n110, fx);
  const nx01 = lerp(n001, n101, fx);
  const nx11 = lerp(n011, n111, fx);
  return lerp(lerp(nx00, nx10, fy), lerp(nx01, nx11, fy), fz);
}

function lattice(ix: number, iy: number, iz: number) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
}
