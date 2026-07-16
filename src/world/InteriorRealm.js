// The Lens's payoff: what actually lives inside whatever biome you've
// zoomed into. Four seeded dioramas, each centered on its own subject --
// generated once per (kind, seed) and then just breathing with the music
// on every frame after. Pure geometry generation is exported and testable
// without a canvas; draw() is browser-only like every other render module.
import { mulberry32, clamp01, lerp } from '../utils/math.js';
import { superformula } from '../render/oscillators.js';
import { beamTrianglePoints } from './LightRig.js';
import { capFlashAlpha } from '../ui/Accessibility.js';
import { hexToRgb } from '../utils/color.js';

const KICK_PULSE_TAU_SEC = 0.35;
const BAND_SMOOTH_TAU_SEC = 0.18;

// --- Pure geometry generators (seeded, no canvas) -------------------------

/** Warren: a heart chamber with N tunnels branching off it as gentle cubic
 *  curves, root-veins threading between chamber and tunnel midpoints, and
 *  a burrower who loops one tunnel back and forth. */
export function generateWarren(seed) {
  const rand = mulberry32(seed);
  const tunnelCount = 4 + Math.floor(rand() * 3); // 4..6
  const tunnels = [];
  for (let i = 0; i < tunnelCount; i++) {
    const ang = (i / tunnelCount) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const len = 90 + rand() * 70;
    const bend = (rand() - 0.5) * 70;
    tunnels.push({
      ang, len,
      c1: { x: Math.cos(ang) * len * 0.4 + bend * Math.sin(ang), y: Math.sin(ang) * len * 0.4 - bend * Math.cos(ang) },
      c2: { x: Math.cos(ang) * len * 0.75 + bend * 0.5 * Math.sin(ang), y: Math.sin(ang) * len * 0.75 - bend * 0.5 * Math.cos(ang) },
      end: { x: Math.cos(ang) * len, y: Math.sin(ang) * len },
      width: 10 + rand() * 8,
    });
  }
  const veins = [];
  for (let i = 0; i < tunnels.length; i++) {
    const a = tunnels[i], b = tunnels[(i + 1) % tunnels.length];
    veins.push({ from: a.end, to: b.end, mid: { x: (a.end.x + b.end.x) / 2 + (rand() - 0.5) * 20, y: (a.end.y + b.end.y) / 2 + (rand() - 0.5) * 20 } });
  }
  const spores = Array.from({ length: 10 }, () => ({
    x: (rand() - 0.5) * 300, y: (rand() - 0.5) * 200, phase: rand() * Math.PI * 2, speed: 8 + rand() * 10,
  }));
  const burrowTunnel = Math.floor(rand() * tunnels.length);
  return { kind: 'warren', chamberR: 34 + rand() * 8, tunnels, veins, spores, burrowTunnel };
}

/** Temple: a colonnade of pillars in a shallow forced perspective around a
 *  central altar holding a miniature of the biome's own celestial shape. */
export function generateTemple(seed) {
  const rand = mulberry32(seed);
  const pillarCount = 5;
  const pillars = [];
  for (let i = 0; i < pillarCount; i++) {
    const t = i / (pillarCount - 1); // 0..1 across the row
    const side = t < 0.5 ? -1 : 1;
    const depth = Math.abs(t - 0.5) * 2; // 0 at center (no pillar there), 1 at the edges
    if (depth < 0.08) continue;
    pillars.push({
      x: side * (60 + depth * 210),
      scale: 0.55 + 0.55 * depth,
      h: 150 + depth * 90,
    });
  }
  const glyphs = Array.from({ length: 6 }, (_, i) => ({
    x: (rand() - 0.5) * 260, y: -120 - rand() * 60, sides: 3 + (i % 4), size: 6 + rand() * 5, phase: rand() * Math.PI * 2,
  }));
  const superM = 5 + Math.floor(rand() * 5);
  const superN = 0.6 + rand() * 2.4;
  return { kind: 'temple', pillars, glyphs, superM, superN1: superN, superN2: 1.2 + rand(), superN3: 1.2 + rand() };
}

/** Tomb: a hall of two converging walls (each a row of fresco slots keyed
 *  to the 7 energy bands) leading back to a sarcophagus with a guardian. */
export function generateTomb(seed) {
  const rand = mulberry32(seed);
  const slotCount = 7; // one per energy band -- the murals literally ARE the EQ
  const wallSlots = Array.from({ length: slotCount }, (_, i) => ({ u: i / (slotCount - 1) }));
  const motes = Array.from({ length: 14 }, () => ({
    x: (rand() - 0.5) * 320, y: (rand() - 0.5) * 200, phase: rand() * Math.PI * 2, speed: 4 + rand() * 6,
  }));
  return { kind: 'tomb', wallSlots, motes, guardianW: 70 + rand() * 20 };
}

/** Geode: a seed-crystal at the center surrounded by one radial spear per
 *  energy band, each flaring in length/brightness with its own band. */
export function generateGeode(seed) {
  const rand = mulberry32(seed);
  const spearCount = 7;
  const spears = Array.from({ length: spearCount }, (_, i) => ({
    band: i,
    ang: (i / spearCount) * Math.PI * 2 + (rand() - 0.5) * 0.25,
    baseLen: 40 + rand() * 18,
    width: 7 + rand() * 5,
    hueShift: (rand() - 0.5) * 40,
  }));
  return { kind: 'geode', spears, seedSpin: rand() * Math.PI * 2 };
}

const GENERATORS = { warren: generateWarren, temple: generateTemple, tomb: generateTomb, geode: generateGeode };

export class InteriorRealm {
  constructor(songSeed = 1) {
    this.songSeed = songSeed;
    this._built = null; // {kind, seed, geometry}
    this.kickPulse = 0;
    this._bandSmoothed = new Float32Array(7);
    this._t = 0;
  }

  onKick() {
    this.kickPulse = 1;
  }

  update(nowMs, dtSec, energyCurves) {
    this._t = nowMs / 1000;
    this.kickPulse = Math.max(0, this.kickPulse - dtSec / KICK_PULSE_TAU_SEC);
    const kBand = 1 - Math.exp(-dtSec / BAND_SMOOTH_TAU_SEC);
    for (let b = 0; b < 7; b++) {
      const raw = energyCurves ? clamp01(energyCurves.sample(b, nowMs)) : 0;
      this._bandSmoothed[b] += kBand * (raw - this._bandSmoothed[b]);
    }
  }

  _ensure(scene) {
    if (this._built && this._built.kind === scene.kind && this._built.seed === scene.seed) return this._built;
    const gen = GENERATORS[scene.kind] || GENERATORS.warren;
    this._built = { kind: scene.kind, seed: scene.seed, geo: gen(scene.seed) };
    return this._built;
  }

  draw(ctx, canvas, reveal, { scene, haloColor = '#ffdca0', particleMul = 1, reducedFlash = false } = {}) {
    if (!scene || reveal <= 0.01) return;
    const built = this._ensure(scene);
    const alpha = capFlashAlpha(reveal, reducedFlash);
    const { r, g, b } = hexToRgb(haloColor);
    const rgb = `${r},${g},${b}`;
    const cx = canvas.width / 2, cy = canvas.height * 0.46;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);

    switch (built.geo.kind) {
      case 'warren': this._drawWarren(ctx, built.geo, rgb, particleMul, reducedFlash); break;
      case 'temple': this._drawTemple(ctx, built.geo, rgb, particleMul, reducedFlash); break;
      case 'tomb': this._drawTomb(ctx, built.geo, rgb, particleMul, reducedFlash); break;
      case 'geode': this._drawGeode(ctx, built.geo, rgb, particleMul, reducedFlash); break;
      default: break;
    }

    ctx.restore();
  }

  _drawWarren(ctx, geo, rgb, particleMul, reducedFlash) {
    // Earthen backdrop.
    ctx.fillStyle = '#1c1410';
    ctx.beginPath(); ctx.arc(0, 0, 260, 0, Math.PI * 2); ctx.fill();

    // Tunnels, bored outward from the chamber.
    ctx.strokeStyle = 'rgba(90,64,44,0.9)';
    for (const t of geo.tunnels) {
      ctx.lineWidth = t.width;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(t.c1.x, t.c1.y, t.c2.x, t.c2.y, t.end.x, t.end.y);
      ctx.stroke();
    }

    // Root-veins between tunnel mouths, pulsing with the beat.
    const veinAlpha = capFlashAlpha(0.35 + 0.5 * this.kickPulse, reducedFlash);
    ctx.strokeStyle = `rgba(${rgb},${veinAlpha})`;
    ctx.lineWidth = 1.4;
    for (const v of geo.veins) {
      ctx.beginPath();
      ctx.moveTo(v.from.x, v.from.y);
      ctx.quadraticCurveTo(v.mid.x, v.mid.y, v.to.x, v.to.y);
      ctx.stroke();
    }

    // The heart chamber itself.
    const chamberGlow = capFlashAlpha(0.55 + 0.35 * this.kickPulse, reducedFlash);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, geo.chamberR);
    grad.addColorStop(0, `rgba(${rgb},${chamberGlow})`);
    grad.addColorStop(1, 'rgba(60,40,26,0.9)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, geo.chamberR, 0, Math.PI * 2); ctx.fill();

    // The burrower, looping one tunnel out and back.
    const tunnel = geo.tunnels[geo.burrowTunnel % geo.tunnels.length];
    if (tunnel) {
      const u = (Math.sin(this._t * 0.6) + 1) / 2; // 0..1..0
      const bx = lerp(0, tunnel.end.x, u), by = lerp(0, tunnel.end.y, u);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.atan2(tunnel.end.y, tunnel.end.x));
      ctx.fillStyle = 'rgba(160,220,180,0.9)';
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(-10, -11); ctx.lineTo(-3, -6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(4, -5); ctx.lineTo(8, -12); ctx.lineTo(6, -5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // Drifting spores.
    const n = Math.max(1, Math.ceil(geo.spores.length * particleMul));
    ctx.fillStyle = `rgba(${rgb},0.5)`;
    for (let i = 0; i < n; i++) {
      const s = geo.spores[i];
      const sy = s.y - ((this._t * s.speed) % 240);
      ctx.beginPath();
      ctx.arc(s.x + Math.sin(this._t + s.phase) * 8, ((sy + 120) % 240) - 120, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawTemple(ctx, geo, rgb, particleMul, reducedFlash) {
    ctx.fillStyle = '#241a12';
    ctx.fillRect(-260, -180, 520, 360);

    // Pillars, back to front.
    const sorted = [...geo.pillars].sort((a, b) => a.scale - b.scale);
    for (const p of sorted) {
      const w = 20 * p.scale;
      ctx.fillStyle = `rgba(${rgb},${0.18 + 0.22 * p.scale})`;
      ctx.fillRect(p.x - w / 2, -p.h * 0.55, w, p.h);
      ctx.fillStyle = `rgba(${rgb},${0.3 + 0.3 * p.scale})`;
      ctx.fillRect(p.x - w / 2 - 2, -p.h * 0.55 - 6, w + 4, 8); // capital
    }

    // God-ray shafts from above, LightRig's own triangle math.
    const shaftAlpha = capFlashAlpha(0.16 + 0.14 * this.kickPulse, reducedFlash);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const theta of [-0.35, 0, 0.35]) {
      const { tip, left, right } = beamTrianglePoints(0, -175, theta, 0.13, 260);
      const grad = ctx.createLinearGradient(tip.x, tip.y, (left.x + right.x) / 2, (left.y + right.y) / 2);
      grad.addColorStop(0, `rgba(${rgb},${shaftAlpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y); ctx.lineTo(left.x, left.y); ctx.lineTo(right.x, right.y); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // The altar and its miniature celestial.
    ctx.fillStyle = `rgba(${rgb},0.5)`;
    ctx.fillRect(-28, 60, 56, 14);
    const spin = this._t * 0.4;
    const melody = this._bandSmoothed[3]; // MID band ~= melody
    ctx.save();
    ctx.translate(0, 40);
    ctx.rotate(spin);
    ctx.fillStyle = `rgba(${rgb},${0.6 + 0.4 * melody})`;
    ctx.beginPath();
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const phi = (i / steps) * Math.PI * 2;
      const r = (12 + 5 * melody) * superformula(phi, geo.superM, geo.superN1, geo.superN2, geo.superN3);
      const px = Math.cos(phi) * r, py = Math.sin(phi) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Floating glyphs, flickering with melody energy.
    const n = Math.max(1, Math.ceil(geo.glyphs.length * particleMul));
    for (let i = 0; i < n; i++) {
      const gl = geo.glyphs[i];
      const flicker = 0.4 + 0.6 * clamp01(Math.sin(this._t * 2 + gl.phase) * 0.5 + 0.5) * (0.4 + 0.6 * melody);
      ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.5 * flicker, reducedFlash)})`;
      ctx.save();
      ctx.translate(gl.x, gl.y + Math.sin(this._t * 0.7 + gl.phase) * 4);
      ctx.beginPath();
      for (let k = 0; k < gl.sides; k++) {
        const a = (k / gl.sides) * Math.PI * 2;
        const px = Math.cos(a) * gl.size, py = Math.sin(a) * gl.size;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  _drawTomb(ctx, geo, rgb, particleMul, reducedFlash) {
    ctx.fillStyle = '#0e0c14';
    ctx.fillRect(-260, -180, 520, 360);

    // Converging hall walls, murals as banded EQ-frescoes.
    for (const side of [-1, 1]) {
      for (const slot of geo.wallSlots) {
        const nearX = side * 220, farX = side * 70;
        const x = lerp(nearX, farX, slot.u);
        const y0 = lerp(150, -20, slot.u);
        const bandE = this._bandSmoothed[Math.round(slot.u * 6)];
        const h = lerp(30, 8, slot.u) * (0.4 + 0.8 * bandE);
        const glint = capFlashAlpha(0.28 + 0.4 * bandE + 0.3 * this.kickPulse, reducedFlash);
        ctx.fillStyle = `rgba(${rgb},${glint})`;
        ctx.fillRect(x - 3, y0 - h, 6, h);
      }
    }

    // The sarcophagus, at the vanishing point.
    ctx.fillStyle = `rgba(${rgb},0.35)`;
    ctx.beginPath();
    ctx.moveTo(-geo.guardianW / 2, 20);
    ctx.quadraticCurveTo(0, -14, geo.guardianW / 2, 20);
    ctx.lineTo(geo.guardianW / 2, 40);
    ctx.lineTo(-geo.guardianW / 2, 40);
    ctx.closePath();
    ctx.fill();

    // The guardian, breathing with bass.
    const bass = this._bandSmoothed[1];
    ctx.save();
    ctx.translate(0, 26);
    ctx.scale(1, 1 + 0.06 * bass);
    ctx.fillStyle = 'rgba(210,200,190,0.4)';
    ctx.beginPath(); ctx.ellipse(0, 0, geo.guardianW / 2 - 6, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Dust motes.
    const n = Math.max(1, Math.ceil(geo.motes.length * particleMul));
    ctx.fillStyle = 'rgba(220,215,200,0.25)';
    for (let i = 0; i < n; i++) {
      const m = geo.motes[i];
      ctx.beginPath();
      ctx.arc(m.x + Math.sin(this._t * 0.3 + m.phase) * 12, m.y + Math.cos(this._t * 0.2 + m.phase) * 8, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawGeode(ctx, geo, rgb, particleMul, reducedFlash) {
    ctx.fillStyle = '#0a1018';
    ctx.beginPath(); ctx.arc(0, 0, 260, 0, Math.PI * 2); ctx.fill();

    const n = Math.max(1, Math.ceil(geo.spears.length * particleMul));
    for (let i = 0; i < n; i++) {
      const s = geo.spears[i];
      const e = this._bandSmoothed[s.band];
      const len = s.baseLen * (0.7 + 1.1 * e);
      const tipX = Math.cos(s.ang) * len, tipY = Math.sin(s.ang) * len;
      const baseAng1 = s.ang + Math.PI / 2, baseAng2 = s.ang - Math.PI / 2;
      const bw = s.width * (0.6 + 0.6 * e);
      const b1x = Math.cos(baseAng1) * bw, b1y = Math.sin(baseAng1) * bw;
      const b2x = Math.cos(baseAng2) * bw, b2y = Math.sin(baseAng2) * bw;
      const flareAlpha = capFlashAlpha(0.3 + 0.5 * e + 0.3 * this.kickPulse, reducedFlash);
      ctx.fillStyle = `rgba(${rgb},${flareAlpha})`;
      ctx.beginPath();
      ctx.moveTo(b1x, b1y); ctx.lineTo(tipX, tipY); ctx.lineTo(b2x, b2y); ctx.closePath();
      ctx.fill();
    }

    // The seed-crystal at the center, slowly spinning.
    ctx.save();
    ctx.rotate(geo.seedSpin + this._t * 0.3);
    ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.7 + 0.3 * this.kickPulse, reducedFlash)})`;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = i % 2 === 0 ? 16 : 8;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
