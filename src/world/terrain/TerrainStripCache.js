export const DEFAULT_TERRAIN_STRIP_BUDGET = 64 * 1024 * 1024;

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

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    release(entry.strips);
    return true;
  }

  clear() {
    for (const key of [...this.entries.keys()]) this.delete(key);
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
