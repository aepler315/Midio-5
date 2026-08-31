import type { Particle } from "./types";

export class SpatialHash {
  cell: number;
  buckets = new Map<number, number[]>();

  constructor(cell = 28) {
    this.cell = cell;
  }

  private key(ix: number, iy: number) {
    return ((ix + 32768) & 0xffff) | (((iy + 32768) & 0xffff) << 16);
  }

  rebuild(particles: Particle[], limit: number) {
    this.buckets.clear();
    const s = 1 / this.cell;
    for (let i = 0; i < limit; i++) {
      const p = particles[i]!;
      if (p.kind === "dust") continue;
      const ix = Math.floor(p.x * s);
      const iy = Math.floor(p.y * s);
      const k = this.key(ix, iy);
      let bin = this.buckets.get(k);
      if (!bin) {
        bin = [];
        this.buckets.set(k, bin);
      }
      bin.push(i);
    }
  }

  query(x: number, y: number, radius: number, out: number[]) {
    out.length = 0;
    const s = 1 / this.cell;
    const r = Math.ceil(radius * s);
    const cx = Math.floor(x * s);
    const cy = Math.floor(y * s);
    for (let iy = cy - r; iy <= cy + r; iy++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        const bin = this.buckets.get(this.key(ix, iy));
        if (bin) for (const i of bin) out.push(i);
      }
    }
    return out;
  }
}
