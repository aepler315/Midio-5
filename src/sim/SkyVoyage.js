// Midasus's deep-space excursion: she leaves the ensemble, climbs into the
// far sky, and traces genuinely mathematical figures out there -- Lissajous
// knots, an epicycle rosette, a superformula circuit, and (epic sections
// only) a live Thomas-attractor projection -- while a persistent trail
// sky-writes the geometry and completed figures freeze into fading
// constellations. Pure phase/position logic here; BiomeManager draws it
// (see drawDeepSky) behind the mountain silhouettes, and Midasus.js hides
// her normal glyph for the phases where she isn't "here."
import { mulberry32, clamp, lerp } from '../utils/math.js';
import { superformula, thomasDeriv, rk4Step3 } from '../render/oscillators.js';

export const VoyagePhase = Object.freeze({
  IDLE: 'IDLE', WINDUP: 'WINDUP', ASCENT: 'ASCENT', DEEP_SPACE: 'DEEP_SPACE', REENTRY: 'REENTRY',
});

const WINDUP_SEC = 0.55;
const ASCENT_SEC = 1.2;
const REENTRY_SEC = 1.0;
const FIGURE_SEC = 3.2;
const FIGURES_PER_VOYAGE = 3;
const FIGURE_MORPH_SEC = 0.4;
const FIGURE_RADIUS_PX = 130;
const TRAIL_SEC = 3.2;
const TRAIL_MAX_PTS = 400;
const CONSTELLATION_LIFE_SEC = 6;
const CONSTELLATION_MAX = 4;
// Default pairs per figure slot (no melody heard yet)...
const LISSAJOUS_FREQS = [[3, 2], [5, 4], [2, 3], [4, 3]];
// ...and the melody's own tuning: one coprime pair per pitch class, so a
// C melody knots differently than an F# one -- the figure is literally
// played by the notes.
const LISSAJOUS_BY_PITCH_CLASS = [
  [3, 2], [5, 4], [4, 3], [5, 2], [7, 4], [3, 1],
  [5, 3], [7, 5], [2, 1], [7, 3], [8, 3], [5, 1],
];
const LISS_MORPH_SEC = 0.45; // parametric cross-fade between old/new tuning
const KICK_TAU_SEC = 0.15;   // onset phase-kicks ease in, never teleport
const SPARKLES_MAX = 36;
const SPARKLE_LIFE_SEC = 0.6;
const SLASH_MAX = 6;
const SLASH_LIFE_SEC = 0.25;

export class SkyVoyage {
  constructor(seed = 1) {
    this.rand = mulberry32((seed ^ 0x5117) >>> 0 || 1);
    this.phase = VoyagePhase.IDLE;
    this.phaseStartMs = 0;
    this.p = { x: 0, y: 0 };
    this.hue = 200;
    this.trail = []; // {x, y, hue, tMs}
    this.constellations = []; // {points:[{x,y}], hue, bornMs}
    this._station = { x: 0, y: 0 };
    this._startPos = { x: 0, y: 0 };
    this._windUpFrom = { x: 0, y: 0 };
    this._diveTarget = { x: 0, y: 0 };

    this._figureOrder = [];
    this._figureCount = 0;
    this._figureIdx = 0;
    this._figureStartMs = 0;
    this._prevFigureEndOffset = { x: 0, y: 0 };
    this._attractor = { x: 0.12, y: 0, z: 0 };

    // Melody coupling: the current Lissajous tuning, the tuning it's
    // morphing away from, and a smoothed onset phase-kick (an eased burst
    // of extra curve-time so a hard note visibly accelerates her without
    // ever teleporting the position).
    this._liss = null;      // {a, b} or null -> figure-slot default
    this._lissPrev = null;
    this._lissMorphStartMs = -Infinity;
    this._kickSmooth = 0;   // seconds of accumulated eased curve-time
    this._kickTarget = 0;
    this.justLanded = false;

    this.sparkles = [];     // {x, y, vx, vy, hue, age}
    this.microSlashes = []; // {x, y, ang, hue, age}
  }

  /** A melody onset while she's away: retunes the Lissajous knot to the
   * note's pitch class (with a parametric morph, not a snap), kicks the
   * figure's phase along by an eased burst proportional to velocity, cuts
   * a micro-slash at her deep-sky position, and paints her the note's hue. */
  onMelodyOnset(evt) {
    if (this.phase !== VoyagePhase.DEEP_SPACE) return;
    const pc = ((Math.round(evt.pitch ?? 60) % 12) + 12) % 12;
    this.hue = pc * 30;
    const next = LISSAJOUS_BY_PITCH_CLASS[pc];
    const cur = this._currentLiss();
    if (next[0] !== cur[0] || next[1] !== cur[1]) {
      this._lissPrev = cur;
      this._liss = next;
      this._lissMorphStartMs = this._nowMs ?? this._figureStartMs;
    }
    this._kickTarget += 0.10 * (evt.vel ?? 0.7);
    const ang = this.rand() * Math.PI * 2;
    this.microSlashes.push({ x: this.p.x, y: this.p.y, ang, hue: this.hue, age: 0 });
    if (this.microSlashes.length > SLASH_MAX) this.microSlashes.shift();
  }

  /** A kick while she's away: a radial sparkle burst off her position. */
  onKick(vel = 0.8) {
    if (this.phase !== VoyagePhase.DEEP_SPACE) return;
    const n = 5 + Math.round(3 * vel);
    for (let i = 0; i < n; i++) {
      if (this.sparkles.length >= SPARKLES_MAX) this.sparkles.shift();
      const ang = (i / n) * Math.PI * 2 + this.rand() * 0.5;
      const speed = 40 + 60 * this.rand();
      this.sparkles.push({
        x: this.p.x, y: this.p.y,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        hue: this.hue, age: 0,
      });
    }
  }

  _currentLiss() {
    if (this._liss) return this._liss;
    return LISSAJOUS_FREQS[(this._figureIdx >= 0 ? this._figureIdx : 0) % LISSAJOUS_FREQS.length];
  }

  get active() { return this.phase !== VoyagePhase.IDLE; }

  /** 0 = fully present (still visually "here"), 1 = fully deep-sky. */
  get depth() {
    switch (this.phase) {
      case VoyagePhase.WINDUP: return 0;
      case VoyagePhase.ASCENT: return this._phaseU;
      case VoyagePhase.DEEP_SPACE: return 1;
      case VoyagePhase.REENTRY: return 1 - this._phaseU;
      default: return 0;
    }
  }

  trigger(nowMs, fromPos, stageW, stageH) {
    if (this.active) return false;
    this.phase = VoyagePhase.WINDUP;
    this.phaseStartMs = nowMs;
    this._startPos = { ...fromPos };
    this._windUpFrom = { ...fromPos };
    this.p = { ...fromPos };
    this._station = { x: stageW * (0.52 + this.rand() * 0.22), y: stageH * 0.16 };

    this._figureOrder = this._pickFigureOrder();
    this._figureCount = 0;
    this._figureIdx = -1; // advanced to 0 on entering DEEP_SPACE
    this._prevFigureEndOffset = { x: 0, y: 0 };
    return true;
  }

  /** Safety valve for the excursion scheduler: skip straight to REENTRY
   * (e.g. the song is ending and everyone needs to come home). No-op if idle. */
  forceEnd(nowMs) {
    if (!this.active || this.phase === VoyagePhase.REENTRY) return;
    this.phase = VoyagePhase.REENTRY;
    this.phaseStartMs = nowMs;
    this._diveTarget = { ...this._startPos };
  }

  _pickFigureOrder() {
    const kinds = ['lissajous', 'epicycle', 'superformula', 'thomas'];
    const order = [];
    for (let i = 0; i < FIGURES_PER_VOYAGE; i++) order.push(kinds[Math.floor(this.rand() * kinds.length)]);
    return order;
  }

  update(nowMs, dtSec, epicMood, ensembleAnchor) {
    this._nowMs = nowMs;
    this.justLanded = false;
    // Constellations, sparkles, and slashes keep fading even once she's home.
    this.pruneConstellations(nowMs);
    for (const s of this.sparkles) { s.x += s.vx * dtSec; s.y += s.vy * dtSec; s.age += dtSec; }
    this.sparkles = this.sparkles.filter((s) => s.age < SPARKLE_LIFE_SEC);
    for (const s of this.microSlashes) s.age += dtSec;
    this.microSlashes = this.microSlashes.filter((s) => s.age < SLASH_LIFE_SEC);
    // Onset phase-kicks ease toward their target rather than jumping.
    this._kickSmooth += (1 - Math.exp(-dtSec / KICK_TAU_SEC)) * (this._kickTarget - this._kickSmooth);
    if (!this.active) return;
    const elapsed = (nowMs - this.phaseStartMs) / 1000;

    if (this.phase === VoyagePhase.WINDUP) {
      this._phaseU = clamp(elapsed / WINDUP_SEC, 0, 1);
      // Spiral in: orbit radius shrinks while angular rate ramps up --
      // conservation-of-angular-momentum read as "gathering power."
      const radius = lerp(60, 8, this._phaseU);
      const rate = lerp(1.8, 9, this._phaseU);
      const ang = this._phaseU * rate * 6;
      this.p = { x: this._windUpFrom.x + radius * Math.cos(ang), y: this._windUpFrom.y + radius * Math.sin(ang) };
      if (this._phaseU >= 1) { this.phase = VoyagePhase.ASCENT; this.phaseStartMs = nowMs; this._startPos = { ...this.p }; }
    } else if (this.phase === VoyagePhase.ASCENT) {
      this._phaseU = clamp(elapsed / ASCENT_SEC, 0, 1);
      const u = this._phaseU;
      const ease = u * u * (3 - 2 * u);
      // Cubic-ish climb: a control point above the start so the path arcs
      // upward rather than cutting a straight diagonal line.
      const ctrl = { x: (this._startPos.x + this._station.x) / 2, y: Math.min(this._startPos.y, this._station.y) - 80 };
      this.p = {
        x: (1 - ease) * (1 - ease) * this._startPos.x + 2 * (1 - ease) * ease * ctrl.x + ease * ease * this._station.x,
        y: (1 - ease) * (1 - ease) * this._startPos.y + 2 * (1 - ease) * ease * ctrl.y + ease * ease * this._station.y,
      };
      this._pushTrail(nowMs);
      if (this._phaseU >= 1) {
        this.phase = VoyagePhase.DEEP_SPACE;
        this.phaseStartMs = nowMs;
        this._figureIdx = 0;
        this._figureStartMs = nowMs;
        this._figureCount = 1;
      }
    } else if (this.phase === VoyagePhase.DEEP_SPACE) {
      // The Thomas attractor keeps integrating in the background regardless
      // of which figure is currently on screen, so selecting it mid-voyage
      // resumes a live chaotic system rather than a paused one. Matches
      // ChaosRibbon's "attractor-time per real second" integration scale.
      const b = lerp(0.32, 0.19, clamp(epicMood, 0, 1));
      const speed = 1.6;
      const substeps = 3;
      const h = (speed * dtSec) / substeps;
      for (let i = 0; i < substeps; i++) this._attractor = rk4Step3(thomasDeriv, this._attractor, h, b);

      const figElapsed = (nowMs - this._figureStartMs) / 1000;
      if (figElapsed >= FIGURE_SEC) {
        this._stampConstellation(nowMs);
        this._prevFigureEndOffset = this._figureOffset(this._figureOrder[this._figureIdx], FIGURE_SEC);
        this._figureIdx++;
        this._figureStartMs = nowMs;
        this._figureCount++;
        if (this._figureCount > FIGURES_PER_VOYAGE) {
          this.phase = VoyagePhase.REENTRY;
          this.phaseStartMs = nowMs;
          this._diveTarget = ensembleAnchor ? { ...ensembleAnchor } : { ...this._startPos };
        }
      }
      if (this.phase === VoyagePhase.DEEP_SPACE) {
        const kind = this._figureOrder[this._figureIdx];
        // Onset kicks add eased extra curve-time: hard notes visibly whip
        // her along the figure without a positional discontinuity.
        const localT = (nowMs - this._figureStartMs) / 1000 + this._kickSmooth;
        const raw = this._figureOffset(kind, localT);
        // Morph into the new figure from the previous one's exit point
        // instead of teleporting -- a brief parametric cross-fade.
        const morphU = clamp(((nowMs - this._figureStartMs) / 1000) / FIGURE_MORPH_SEC, 0, 1);
        const blended = {
          x: lerp(this._prevFigureEndOffset.x, raw.x, morphU),
          y: lerp(this._prevFigureEndOffset.y, raw.y, morphU),
        };
        this.p = { x: this._station.x + blended.x * FIGURE_RADIUS_PX, y: this._station.y + blended.y * FIGURE_RADIUS_PX };
        this._pushTrail(nowMs);
      }
    } else if (this.phase === VoyagePhase.REENTRY) {
      this._phaseU = clamp(elapsed / REENTRY_SEC, 0, 1);
      const u = this._phaseU;
      const ease = u * u * u; // a dive accelerates in
      this.p = {
        x: lerp(this._station.x, this._diveTarget.x, ease),
        y: lerp(this._station.y, this._diveTarget.y, ease),
      };
      this.hue = lerp(this.hue, 20, u); // blends toward re-entry orange
      this._pushTrail(nowMs);
      if (this._phaseU >= 1) {
        this.phase = VoyagePhase.IDLE;
        this.trail = [];
        this._liss = null;
        this._lissPrev = null;
        this._kickSmooth = 0;
        this._kickTarget = 0;
        this.justLanded = true; // one-frame flag: Midasus/Simulation fire landing FX off this
      }
    }
  }

  _figureOffset(kind, localT) {
    const RATE = 1.6;
    if (kind === 'lissajous') {
      const [a, b] = this._currentLiss();
      const cur = { x: Math.sin(a * RATE * localT), y: Math.sin(b * RATE * localT + Math.PI / 4) };
      // Mid-retune: evaluate BOTH tunings at the same parameter and blend --
      // the same morph trick used at figure switches, here for the melody's
      // pitch-class retargeting.
      if (this._lissPrev) {
        const u = clamp(((this._nowMs ?? 0) - this._lissMorphStartMs) / (LISS_MORPH_SEC * 1000), 0, 1);
        if (u >= 1) { this._lissPrev = null; return cur; }
        const [pa, pb] = this._lissPrev;
        const prev = { x: Math.sin(pa * RATE * localT), y: Math.sin(pb * RATE * localT + Math.PI / 4) };
        return { x: lerp(prev.x, cur.x, u), y: lerp(prev.y, cur.y, u) };
      }
      return cur;
    }
    if (kind === 'epicycle') {
      const terms = [{ r: 1.0, k: 1 }, { r: 0.48, k: 3 }, { r: 0.2, k: 7 }];
      const norm = terms.reduce((s, t) => s + t.r, 0);
      let x = 0, y = 0;
      for (const t of terms) {
        const ang = t.k * RATE * localT;
        x += t.r * Math.cos(ang);
        y += t.r * Math.sin(ang);
      }
      return { x: x / norm, y: y / norm };
    }
    if (kind === 'superformula') {
      const phi = localT * RATE;
      const r = clamp(superformula(phi, 6, 6, 10, 10), 0.05, 2.2);
      return { x: (r / 1.2) * Math.cos(phi), y: (r / 1.2) * Math.sin(phi) };
    }
    // 'thomas': read the persistent chaotic state -- update() integrates it
    // once per frame in the background regardless of which figure is shown.
    return { x: clamp(this._attractor.x / 4.2, -1.3, 1.3), y: clamp(this._attractor.y / 4.2, -1.3, 1.3) };
  }

  _pushTrail(nowMs) {
    this.trail.push({ x: this.p.x, y: this.p.y, hue: this.hue, tMs: nowMs });
    const cutoff = nowMs - TRAIL_SEC * 1000;
    while (this.trail.length && this.trail[0].tMs < cutoff) this.trail.shift();
    if (this.trail.length > TRAIL_MAX_PTS) this.trail.splice(0, this.trail.length - TRAIL_MAX_PTS);
  }

  _stampConstellation(nowMs) {
    const figStart = this._figureStartMs;
    const points = this.trail.filter((pt) => pt.tMs >= figStart).map((pt) => ({ x: pt.x, y: pt.y }));
    if (points.length < 3) return;
    // Keep it a legible constellation, not the whole dense trail: a sparse
    // sample of the figure's path.
    const sampled = [];
    const step = Math.max(1, Math.floor(points.length / 12));
    for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
    this.constellations.push({ points: sampled, hue: this.hue, bornMs: nowMs });
    if (this.constellations.length > CONSTELLATION_MAX) this.constellations.shift();
  }

  /** Drop constellations past their fade life. Call once per frame. */
  pruneConstellations(nowMs) {
    this.constellations = this.constellations.filter((c) => nowMs - c.bornMs < CONSTELLATION_LIFE_SEC * 1000);
  }
}
