// The user's soundfont collection: loaded from single .sf2 files, a zip
// of them, a picked folder, or a persistent File System Access directory
// handle ("use this directory ongoing" -- re-scanned on demand). Cycling
// swaps the active font; the router hears about it via onChange.
import { parseSf2 } from './Sf2Parser.js';
import { listZipEntries, extractZipEntry } from '../utils/zip.js';

export class SoundfontLibrary {
  constructor() {
    this.fonts = []; // {name, parsed}
    this.activeIdx = -1;
    this.onChange = null; // (fontOrNull) => void
    this._dirHandle = null;
  }

  get active() { return this.fonts[this.activeIdx] || null; }

  _emit() { if (this.onChange) this.onChange(this.active); }

  _add(parsed) {
    this.fonts.push({ name: parsed.name, parsed });
    if (this.activeIdx < 0) this.activeIdx = 0;
  }

  async addBuffer(buffer, fallbackName) {
    const lower = (fallbackName || '').toLowerCase();
    if (lower.endsWith('.zip')) {
      for (const entry of listZipEntries(buffer)) {
        if (!entry.name.toLowerCase().endsWith('.sf2')) continue;
        const data = await extractZipEntry(buffer, entry);
        this._add(parseSf2(data, entry.name.replace(/^.*\//, '').replace(/\.sf2$/i, '')));
      }
    } else {
      this._add(parseSf2(buffer, (fallbackName || 'soundfont').replace(/\.sf2$/i, '')));
    }
    this._emit();
  }

  /** Files from an <input type=file> (single, multi, or webkitdirectory). */
  async addFiles(fileList) {
    for (const file of fileList) {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.sf2') && !lower.endsWith('.zip')) continue;
      try {
        await this.addBuffer(await file.arrayBuffer(), file.name);
      } catch (err) {
        console.warn(`soundfont: skipped ${file.name}:`, err.message);
      }
    }
  }

  /** Persistent directory (File System Access API). Re-scannable. */
  async useDirectory(handle) {
    this._dirHandle = handle;
    await this.rescanDirectory();
  }

  async rescanDirectory() {
    if (!this._dirHandle) return;
    const seen = new Set(this.fonts.map((f) => f.name));
    for await (const entry of this._dirHandle.values()) {
      if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.sf2')) continue;
      const name = entry.name.replace(/\.sf2$/i, '');
      if (seen.has(name)) continue;
      try {
        const file = await entry.getFile();
        this._add(parseSf2(await file.arrayBuffer(), name));
      } catch (err) {
        console.warn(`soundfont: skipped ${entry.name}:`, err.message);
      }
    }
    this._emit();
  }

  cycle(dir) {
    if (this.fonts.length === 0) return;
    this.activeIdx = ((this.activeIdx + dir) % this.fonts.length + this.fonts.length) % this.fonts.length;
    this._emit();
  }
}

/** Drop-in for SimpleSynth: routes each note to the active SF2 engine,
 * falling back to the oscillator synth when no font is loaded. */
export class SynthRouter {
  constructor(fallbackSynth) {
    this.fallback = fallbackSynth;
    this.sf2 = null;
    this.enabled = true;
  }

  connectConductor(conductor) {
    return conductor.on('*', (evt) => this.noteOn(evt));
  }

  noteOn(evt) {
    if (!this.enabled) return;
    (this.sf2 || this.fallback).noteOn(evt);
  }
}
