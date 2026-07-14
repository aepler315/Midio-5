// The audition load screen's entertainment: a hyper-simplified rendition of
// THIS song's percussion — its kicks distilled to thumps on the pulse with
// the in-between hits demoted to soft hats — looping under a star glyph
// that flinches on every thump, while the font auditions grind through
// offline renders. buildPercussionPattern is pure and unit-tested; the
// LoadingShow class owns scheduling (Web Audio lookahead) and the canvas.
import { Role } from '../core/NoteEvent.js';
import { MIDASUS_MESH, BABY_STAR_MESH } from '../render/meshes.js';
import { computeRestLengths, drawMeshPart } from '../render/MeshDrawer.js';
import { kickEnv } from '../world/MountainChoreo.js';

export const PATTERN_SPAN_MS = 8000;
const THUMP_MIN_GAP_FRAC = 0.45; // of a beat: closer kicks become hats

/**
 * Distill a song's kick timeline into a loopable minimal percussion track.
 * @returns {{loopMs:number, hits:Array<{tMs:number, vel:number, kind:'thump'|'hat'}>}}
 */
export function buildPercussionPattern(timeline, bpm = 120, spanMs = PATTERN_SPAN_MS) {
  const beatMs = 60000 / (bpm || 120);
  const barMs = beatMs * 4;
  const kicks = (timeline || [])
    .filter((e) => e.role === Role.RHYTHM && e.kick && e.tMs < spanMs)
    .sort((a, b) => a.tMs - b.tMs);

  const hits = [];
  let lastThumpMs = -Infinity;
  for (const k of kicks) {
    if (k.tMs - lastThumpMs >= beatMs * THUMP_MIN_GAP_FRAC) {
      hits.push({ tMs: k.tMs, vel: k.vel, kind: 'thump' });
      lastThumpMs = k.tMs;
    } else {
      hits.push({ tMs: k.tMs, vel: k.vel * 0.5, kind: 'hat' });
    }
  }
  if (hits.length === 0) {
    // A kickless (or silent-open) song still deserves a pulse: four-on-the-floor.
    for (let b = 0; b < 16; b++) hits.push({ tMs: b * beatMs, vel: 0.7, kind: 'thump' });
  }
  const lastMs = hits[hits.length - 1].tMs;
  const loopMs = Math.max(barMs, Math.ceil((lastMs + 1) / barMs) * barMs);
  return { loopMs, hits };
}

export class LoadingShow {
  constructor({ canvasEl, textEl, barFillEl, audioEngine }) {
    this.canvas = canvasEl;
    this.textEl = textEl;
    this.barFillEl = barFillEl;
    this.ae = audioEngine;
    this._timer = null;
    this._raf = 0;
    this._session = 0;
    this._meshRest = computeRestLengths(MIDASUS_MESH);
    this._babyRest = computeRestLengths(BABY_STAR_MESH);
  }

  get active() { return this._timer !== null; }

  /** Begin the show for a song. Returns a session token for stop(). */
  start(timelineData) {
    this.stop(this._session);
    const session = ++this._session;
    const pattern = buildPercussionPattern(timelineData.timeline, timelineData.bpm || 120);
    const ctx = this.ae.ctx;
    const t0 = ctx.currentTime + 0.25;
    let cursor = 0; // absolute pattern time scheduled so far, ms
    this._thumps = []; // scheduled thump ctx-times, for the visual flinch
    this._hue = 200 + ((timelineData.timeline?.length || 0) % 120);

    const scheduleHit = (h, whenSec) => {
      if (h.kind === 'thump') this._thump(whenSec, h.vel);
      else this._hat(whenSec, h.vel);
      if (h.kind === 'thump') {
        this._thumps.push(whenSec);
        if (this._thumps.length > 64) this._thumps.splice(0, 32);
      }
    };

    this._timer = setInterval(() => {
      const horizonMs = (ctx.currentTime - t0) * 1000 + 400;
      while (cursor < horizonMs) {
        const loopBase = Math.floor(cursor / pattern.loopMs) * pattern.loopMs;
        const segEnd = Math.min(horizonMs, loopBase + pattern.loopMs);
        for (const h of pattern.hits) {
          const abs = loopBase + h.tMs;
          if (abs >= cursor && abs < segEnd) scheduleHit(h, t0 + abs / 1000);
        }
        cursor = segEnd;
      }
    }, 120);

    const draw = () => {
      if (session !== this._session) return;
      this._draw(ctx.currentTime);
      this._raf = requestAnimationFrame(draw);
    };
    this._raf = requestAnimationFrame(draw);
    return session;
  }

  setProgress(done, total, label) {
    if (this.textEl) {
      this.textEl.textContent = total > 0
        ? `Auditioning SoundFonts against this song… ${done}/${total}${label ? ` — ${label}` : ''}`
        : 'Preparing…';
    }
    if (this.barFillEl) {
      this.barFillEl.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '10%';
    }
  }

  /** Stops scheduling/drawing. Pass the token from start() so a stale
   *  finally-block can't kill a newer session. */
  stop(session = this._session) {
    if (session !== this._session) return;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    cancelAnimationFrame(this._raf);
  }

  _thump(t, vel) {
    const ctx = this.ae.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = ctx.createGain();
    const peak = 0.22 + 0.2 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g);
    g.connect(this.ae.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  _hat(t, vel) {
    const ctx = this.ae.ctx;
    const dur = 0.03;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = 0.1 + 0.12 * vel;
    src.connect(hp).connect(g);
    g.connect(this.ae.master);
    src.start(t);
  }

  _draw(nowSec) {
    const c = this.canvas;
    if (!c) return;
    const ctx2d = c.getContext('2d');
    ctx2d.clearRect(0, 0, c.width, c.height);
    // Flinch: envelope since the most recent scheduled thump at/behind now.
    let last = -Infinity;
    for (const t of this._thumps || []) if (t <= nowSec && t > last) last = t;
    const env = kickEnv((nowSec - last) * 1000);
    const cx = c.width / 2, cy = c.height / 2 + 6;
    const pulse = 1 + 0.55 * env;
    drawMeshPart(ctx2d, MIDASUS_MESH, this._meshRest, {
      tx: cx, ty: cy, rot: nowSec * 0.5, scaleX: 4.4 * pulse, scaleY: 4.4 * pulse,
    }, this._hue, { satBase: 55, lightBase: 70, hueSpread: 24, widthBase: 1.8 });
    // The three babies circle the show while the grown-ups audition.
    for (let i = 0; i < 3; i++) {
      const a = nowSec * (0.7 + 0.12 * i) + (i * Math.PI * 2) / 3;
      drawMeshPart(ctx2d, BABY_STAR_MESH, this._babyRest, {
        tx: cx + Math.cos(a) * (64 + 7 * i), ty: cy + Math.sin(a) * (34 + 5 * i),
        rot: -nowSec * (1 + 0.3 * i), scaleX: 1.6 + 0.4 * env, scaleY: 1.6 + 0.4 * env,
      }, (this._hue + 24 * (i - 1) + 360) % 360, { satBase: 50, lightBase: 74, alpha: 0.9, widthBase: 1.1 });
    }
  }
}
