// A cache cannot evict what is being drawn, so the budget has to clear the
// working set a single frame demands or it does nothing but thrash. Every
// world's draw function fetches two strip sets in a row -- the biome being
// left and the one being entered -- and at bake dimensions that pair is
// ~71.6MB of alpine or ~139.4MB of city (whose layers own a second emissive
// surface each). A 64MB budget could not hold either pair, nor even one city
// biome on its own, so a transition evicted and rebuilt tens of megabytes of
// canvas per frame. This clears the largest pair with room for one more set;
// terrainStripCache.test.js pins the relationship so it cannot drift back.
export const DEFAULT_TERRAIN_STRIP_BUDGET = 176 * 1024 * 1024;

export function stripSetBytes(strips) {
  let bytes = 0;
  for (const surface of Object.values(strips || {})) {
    const width = Number(surface?.width);
    const height = Number(surface?.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      bytes += width * height * 4;
      const nested = surface.windows;
      const nestedWidth = Number(nested?.width);
      const nestedHeight = Number(nested?.height);
      if (Number.isFinite(nestedWidth) && Number.isFinite(nestedHeight)
        && nestedWidth > 0 && nestedHeight > 0) bytes += nestedWidth * nestedHeight * 4;
    }
  }
  return bytes;
}

function release(strips) {
  for (const surface of Object.values(strips || {})) {
    if (typeof surface?.getContext === 'function') {
      surface.width = 0;
      surface.height = 0;
    }
    if (typeof surface?.windows?.getContext === 'function') {
      surface.windows.width = 0;
      surface.windows.height = 0;
    }
  }
}

export class TerrainStripCache {
  constructor({ maxBytes = DEFAULT_TERRAIN_STRIP_BUDGET } = {}) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.entries = new Map();
    this.pins = new Set();
    this.tick = 0;
  }

  get size() { return this.entries.size; }
  has(key) { return this.entries.has(key); }

  setPins(keys) {
    this.pins = new Set([...keys].filter(Boolean));
    this._evict();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.used = ++this.tick;
    return entry.strips;
  }

  /** Make room before canvases are allocated, so the budget bounds peak
   * owned raster memory rather than only the post-insertion steady state. */
  reserve(bytes, extraPins = new Set()) {
    const wanted = Math.max(0, Number(bytes) || 0);
    while (this.bytes + wanted > this.maxBytes) {
      let victim = null;
      for (const [key, entry] of this.entries) {
        if (this.pins.has(key) || extraPins.has(key)) continue;
        if (!victim || entry.used < victim[1].used) victim = [key, entry];
      }
      if (!victim) return false;
      this.delete(victim[0]);
    }
    return true;
  }

  set(key, strips) {
    this.delete(key);
    const bytes = stripSetBytes(strips);
    this.entries.set(key, { strips, bytes, used: ++this.tick });
    this.bytes += bytes;
    this._evict(new Set([key]));
    return this;
  }

  /** Drop an entry. The canvases are NOT zeroed: `get()` hands the strip set
   *  itself to callers, which hold it for the rest of the frame, and a draw
   *  function fetches a second set (re-pinning as it goes) before drawing the
   *  first. Releasing in place therefore destroyed a surface its holder was
   *  about to paint, turning an eviction into a corrupted frame instead of a
   *  rebuild. Dropping the reference is enough -- an unreferenced canvas is
   *  collected anyway; one still being drawn stays valid until it is not. */
  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    return true;
  }

  /** Teardown, not eviction: the caller is discarding the whole world, so
   *  nothing is mid-frame and the memory is worth reclaiming immediately
   *  rather than at the collector's convenience. */
  clear() {
    for (const [key, entry] of [...this.entries]) {
      this.delete(key);
      release(entry.strips);
    }
  }

  _evict(extraPins = new Set()) {
    while (this.bytes > this.maxBytes) {
      let victim = null;
      for (const [key, entry] of this.entries) {
        if (this.pins.has(key) || extraPins.has(key)) continue;
        if (!victim || entry.used < victim[1].used) victim = [key, entry];
      }
      if (!victim) break;
      this.delete(victim[0]);
    }
  }
}
