// SoundfontLibrary: manages a collection of loaded SoundFonts. Supports
// single buffer, multi-file (incl. .zip extraction), and File System Access
// directory loading + rescanning. Cycles through fonts with onChange callback.
//
// SynthRouter: drop-in replacement for SimpleSynth that routes noteOn to the
// active SF2 engine when a font is loaded, otherwise to the fallback synth.
import { parseSf2 } from './Sf2Parser.js';
import { Sf2Synth } from './Sf2Synth.js';
import { extractZip } from '../utils/zip.js';

export class SoundfontLibrary {
  constructor() {
    /** @type {{name:string, data:object}[]} */
    this.fonts = [];
    this.activeIndex = -1;
    this.onChange = null; // (activeFont | null) => void
    this._dirHandle = null;
  }

  get active() {
    return this.activeIndex >= 0 ? this.fonts[this.activeIndex] : null;
  }

  get count() {
    return this.fonts.length;
  }

  /** Parse an SF2 ArrayBuffer and add it to the library. auto-activates first. */
  async addBuffer(name, arrayBuffer) {
    const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const parsed = parseSf2(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), name);
    this.fonts.push({ name: parsed.name || name, data: parsed });
    if (this.activeIndex < 0) this.activeIndex = 0;
    this._notify();
    return parsed;
  }

  /** Handle <input> files: .sf2 single, multi-select, .zip extraction. */
  async addFiles(fileList) {
    for (const file of fileList) {
      const name = file.name.toLowerCase();
      const buf = await file.arrayBuffer();
      if (name.endsWith('.sf2')) {
        await this.addBuffer(file.name, buf);
      } else if (name.endsWith('.zip')) {
        await this._addZipContents(buf, file.name);
      }
    }
  }

  async _addZipContents(arrayBuffer, zipName) {
    const entries = await extractZip(arrayBuffer);
    for (const [fname, data] of entries) {
      if (fname.toLowerCase().endsWith('.sf2')) {
        await this.addBuffer(fname, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      }
    }
  }

  /**
   * Best-effort: fetch tools/serve.js's `/soundfonts/` manifest and load
   * every font it lists — the "I don't know where to put the .sf2 files"
   * fix. Silently loads nothing (never throws) when the endpoint is 404,
   * unreachable, or returns something unexpected, so it's always safe to
   * fire off at boot even when the app is served by a plain static host
   * that doesn't implement the manifest route.
   * @returns {Promise<number>} how many fonts were loaded
   */
  async autoLoadFromServer(baseUrl = '/soundfonts/') {
    let names;
    try {
      const res = await fetch(baseUrl);
      if (!res.ok) return 0;
      names = await res.json();
      if (!Array.isArray(names)) return 0;
    } catch {
      return 0;
    }

    let loaded = 0;
    for (const name of names) {
      try {
        const res = await fetch(baseUrl + encodeURIComponent(name));
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (name.toLowerCase().endsWith('.zip')) {
          await this._addZipContents(buf, name);
        } else {
          await this.addBuffer(name, buf);
        }
        loaded++;
      } catch {
        // Skip this one file and keep going — a single corrupt/unreadable
        // font shouldn't block the rest of the manifest from loading.
      }
    }
    return loaded;
  }

  /** File System Access API: load all .sf2/.zip from a directory handle. */
  async useDirectory(dirHandle) {
    this._dirHandle = dirHandle;
    await this._scanDirectory();
  }

  async _scanDirectory() {
    if (!this._dirHandle) return;
    for await (const entry of this._dirHandle.values()) {
      if (entry.kind !== 'file') continue;
      const name = entry.name.toLowerCase();
      if (!name.endsWith('.sf2') && !name.endsWith('.zip')) continue;
      const file = await entry.getFile();
      const buf = await file.arrayBuffer();
      const before = this.fonts.length;
      if (name.endsWith('.sf2')) {
        await this.addBuffer(entry.name, buf);
      } else if (name.endsWith('.zip')) {
        await this._addZipContents(buf, entry.name);
      }
      // Mark fonts added by this scan as directory-sourced
      for (let i = before; i < this.fonts.length; i++) {
        this.fonts[i]._dirSourced = true;
      }
    }
  }

  /** Re-scan the bound directory: clears dir-sourced fonts and re-scans. */
  async rescanDirectory() {
    this.fonts = this.fonts.filter((f) => !f._dirSourced);
    this.activeIndex = this.fonts.length > 0 ? Math.min(this.activeIndex, this.fonts.length - 1) : -1;
    await this._scanDirectory();
    this._notify();
  }

  /** Cycle to the next/prev font. dir=1 next, dir=-1 prev. */
  cycle(dir = 1) {
    if (this.fonts.length === 0) return;
    if (this.activeIndex < 0) {
      this.activeIndex = 0;
    } else {
      this.activeIndex = (this.activeIndex + dir + this.fonts.length) % this.fonts.length;
    }
    this._notify();
  }

  _notify() {
    if (this.onChange) this.onChange(this.active);
  }
}

/**
 * Routes noteOn to the SF2 engine when a font is loaded, else to the fallback.
 * Mirrors SimpleSynth's shape so main.js can use it as a drop-in `synth`.
 */
export class SynthRouter {
  constructor(fallback) {
    this.fallback = fallback;
    this.sf2 = null; // Sf2Synth instance (may have no loaded font)
  }

  setSf2Engine(sf2Engine) {
    this.sf2 = sf2Engine;
  }

  /** The active engine: SF2 synth if a font is loaded, else fallback. */
  get current() {
    return (this.sf2 && this.sf2.sf2) ? this.sf2 : this.fallback;
  }

  connectConductor(conductor) {
    return conductor.on('*', (evt) => this.noteOn(evt));
  }

  noteOn(evt) {
    const engine = this.current;
    if (engine) engine.noteOn(evt);
  }

  get enabled() { return this.current?.enabled ?? true; }
  set enabled(v) {
    if (this.fallback) this.fallback.enabled = v;
    if (this.sf2) this.sf2.enabled = v;
  }
}