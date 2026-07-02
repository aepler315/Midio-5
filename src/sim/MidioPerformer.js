// Midio's stage presence (item 6). Reads jump state, combo, and calm level,
// then writes the previously-inert pose hooks (scaleX/scaleY/leanDeg) plus a
// poseExtras object used by the mesh drawer: spin, armFlare, strut, goldPulse,
// ghost-trail poses, etc. Designed to escalate with energy and combo streak.
import { Role } from '../core/NoteEvent.js';
import { clamp, mulberry32 } from '../utils/math.js';

const SPIN_PHASE = { launch: 0.0, apex: 0.35, fall: 0.65, land: 1.0 };
const GHOST_FRAMES = 4;
const MILESTONES = [5, 10, 20];

const easeInOutC1 = (t) => {
  // C1-eased cubic: smooth 0..1 with zero velocity at both ends.
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export class MidioPerformer {
  constructor({ seed = 1313 } = {}) {
    this.rand = mulberry32(seed);
    this._spin = null; // { startMs, D, dir, kind }
    this._lastKind = null;
    this._ghosts = []; // recent pose snapshots for trail
    this._strutT = 0;
    this._goldPulse = 0;
    this._milestoneReached = new Set();
    this._prevY = 0;
    this._midasus = null; // set by Simulation
    this._sparkled = false;
  }

  setMidasus(midasus) { this._midasus = midasus; }

  update(nowMs, dtSec, jump, comboSystem, calm, midio, conductor) {
    const beatPeriodMs = jump.beatPeriodMs || 500;
    const calmC = calm ? calm.C : 0;

    // --- idle / calm motion (also partially active during flight) ---
    const breath = Math.sin(nowMs * 0.00155) * 0.02 * (0.6 + 0.4 * calmC);
    const driftX = Math.sin(nowMs * 0.00031) * 2.5 * calmC;
    const driftY = Math.cos(nowMs * 0.00042) * 2.0 * calmC;
    const sway = Math.sin(nowMs * 0.002 * Math.PI) * 3 * calmC;
    const blink = (nowMs % 4200) < 120 ? 0.6 : 1; // occasional eye-ring squish

    // Grounded strut: tiny scaleY bob on each non-kick beat.
    let strut = 0;
    if (jump.state === 'GROUND') {
      const beatPhase = (nowMs % beatPeriodMs) / beatPeriodMs;
      const isKick = conductor.nearestEventMs(
        (e) => e.role === Role.RHYTHM && e.kick, nowMs, 40,
      );
      if (!isKick) strut = Math.sin(beatPhase * Math.PI) * 0.035 * (1 - calmC * 0.5);
    }

    // --- apex tricks: spin or backflip on high-velocity jump or combo ≥2 ---
    let spin = 0;
    if (jump.state === 'AIR' && (jump.lastVel > 0.8 || (comboSystem && comboSystem.M >= 2))) {
      if (!this._spin && jump.airborne) {
        // Trigger once per jump at launch.
        const kind = this._pickKind();
        this._spin = {
          startMs: jump.jumpStartMs,
          D: jump.D,
          kind,
          dir: this.rand() < 0.5 ? 1 : -1,
        };
      }
    }
    let apexSparkle = false;
    if (this._spin) {
      const u = clamp((nowMs - this._spin.startMs) / this._spin.D, 0, 1);
      const p = easeInOutC1(clamp((u - SPIN_PHASE.launch) / (SPIN_PHASE.land - SPIN_PHASE.launch), 0, 1));
      spin = p * (this._spin.kind === 'backflip' ? -Math.PI : Math.PI * 2) * this._spin.dir;
      // Apex sparkle at the top of the arc (u ~ A+B/2).
      if (!this._sparkled && u >= 0.45 && u <= 0.55) { apexSparkle = true; this._sparkled = true; }
      if (u >= 1) { this._spin = null; this._sparkled = false; }
    }
    if (this._midasus && apexSparkle) {
      this._midasus.burstAt(midio.screenX, midio.renderY - 30, 16, 60); // golden sparkle
    }

    // --- landing flourish: one-frame superhero pose on clean landing at M≥2 ---
    let armFlare = 0, crouch = 0;
    if (jump.pendingLanding && comboSystem && comboSystem.justClean && comboSystem.M >= 2) {
      armFlare = 1;
      crouch = -0.18;
    }

    // --- combo verbosity: gold edge-glow pulse + HUD mini-shatter at milestones ---
    let goldPulse = 0;
    for (const m of MILESTONES) {
      if (comboSystem && comboSystem.streak >= m && !this._milestoneReached.has(m)) {
        this._milestoneReached.add(m);
        this._goldPulse = 1;
        this._shatterComboReadout();
      }
    }
    if (this._goldPulse > 0) {
      goldPulse = this._goldPulse;
      this._goldPulse = Math.max(0, this._goldPulse - dtSec / 0.45);
    }

    // --- compose pose ---
    midio.scaleX = 1 + breath + driftX * 0.015 + strut * 0.5;
    midio.scaleY = 1 - breath + crouch + strut;
    midio.leanDeg = sway + (jump.state === 'AIR' ? jump.lastVel * 8 : 0);

    midio.poseExtras = {
      spin,
      armFlare,
      strut,
      goldPulse,
      driftX,
      driftY,
      blink,
    };

    // --- ghost trail: ring-buffer of recent live poses during launch/fall ---
    const speed = jump.state === 'AIR' ? Math.abs(jump.y - (this._prevY || 0)) / Math.max(dtSec, 1e-6) : 0;
    if (speed > 80) {
      this._ghosts.unshift({
        x: midio.screenX + driftX,
        y: midio.renderY + driftY,
        scaleX: midio.scaleX,
        scaleY: midio.scaleY,
        leanDeg: midio.leanDeg,
        spin,
        armFlare,
        alpha: clamp((speed - 80) / 600, 0, 0.55),
      });
      if (this._ghosts.length > GHOST_FRAMES) this._ghosts.length = GHOST_FRAMES;
    } else if (this._ghosts.length) {
      this._ghosts.pop();
    }
    this._prevY = jump.y;
  }

  _pickKind() {
    const kinds = ['spin', 'backflip'];
    let kind = kinds[Math.floor(this.rand() * kinds.length)];
    if (kind === this._lastKind) kind = kinds.find((k) => k !== kind);
    this._lastKind = kind;
    return kind;
  }

  _shatterComboReadout() {
    const el = document.getElementById('comboReadout');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('span');
      s.textContent = '×';
      s.style.position = 'fixed';
      s.style.left = rect.left + rect.width / 2 + 'px';
      s.style.top = rect.top + rect.height / 2 + 'px';
      s.style.fontSize = '14px';
      s.style.color = '#ffd76a';
      s.style.pointerEvents = 'none';
      s.style.transition = 'transform 0.7s ease-out, opacity 0.7s ease-out';
      document.body.appendChild(s);
      requestAnimationFrame(() => {
        const a = (i / 8) * Math.PI * 2;
        const d = 30 + this.rand() * 40;
        s.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) rotate(${this.rand() * 360}deg)`;
        s.style.opacity = '0';
      });
      setTimeout(() => s.remove(), 750);
    }
  }

  ghosts() { return this._ghosts; }
}