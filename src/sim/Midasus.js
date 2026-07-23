// Midasus, the airborne fairy (spec §3.1). Obeys the score: absolute
// pitch-space coordinates, zero inertia tolerance. Sequential no-skip note
// tracking with a 70% trajectory snap on each trigger, a PD pursuit
// controller between triggers, and a Lissajous orbit during rests.
import { Role } from '../core/NoteEvent.js';
import { visualNow } from '../core/ChoreoClock.js';
import { ObjectPool } from '../utils/ObjectPool.js';
import { clamp, lerp, mulberry32 } from '../utils/math.js';
import { MIDASUS_MESH, MIDASUS_HEX_R } from '../render/meshes.js';
import { computeRestLengths, drawMeshPart, displaceMeshRadial, meltMesh, drawGlowHalo } from '../render/MeshDrawer.js';
import { ModalRing } from '../render/oscillators.js';
import { OrbitalDebris } from './OrbitalDebris.js';
import { SkyVoyage } from './SkyVoyage.js';
import { BabyStars } from './BabyStars.js';

const SILENCE_MS = 800;
const BLEND_SEC = 0.4;
const KP = 90, KD = 12;
const SNAP = 0.70;
const DRAW_SCALE = 1.8; // the stage got bigger: render-only
const BANK_GAIN = 0.0016, BANK_MAX = 0.6; // she rolls into her darts
const SLASH_LIFE_SEC = 0.18;
// Anticipation (ChoreoClock): she launches her dart this far BEFORE each
// note so she's arriving as it sounds -- the impact FX (burst/slash/pulse)
// wait for the note's own heard moment.
const ANTICIPATE_MS = 140;

export class Midasus {
  /**
   * @param {?Function} opts.noteFilter which timeline events are HER line
   *   -- set by Simulation from the casting lanes (clean melodies when a
   *   clean lane exists, every MELODY event otherwise).
   */
  constructor(timeline, midio, { groundY = 480, ceilingY = 40, seed = 777, stageW = 1280, stageH = 720, noteFilter = null } = {}) {
    this.midio = midio;
    this.yFloor = groundY;
    this.yCeiling = ceilingY;
    this.stageW = stageW;
    this.stageH = stageH;

    const filter = noteFilter || ((e) => e.role === Role.MELODY);
    this.q = timeline.filter(filter).sort((a, b) => a.tMs - b.tMs);
    this.i = 0;
    this._impacts = []; // scheduled note-impact FX, drained at each note's heard moment
    this.visualLagMs = 0; // output-latency compensation, set by Simulation each step

    let pMin = 48, pMax = 84;
    if (this.q.length) {
      const pitches = this.q.map((n) => n.pitch).sort((a, b) => a - b);
      pMin = pitches[Math.floor(0.05 * pitches.length)];
      pMax = pitches[Math.min(pitches.length - 1, Math.floor(0.95 * pitches.length))];
      if (pMax <= pMin) pMax = pMin + 12;
    }
    this.pMin = pMin;
    this.pMax = pMax;

    this.p = { x: midio.screenX + 90, y: groundY - 200 };
    this.v = { x: 0, y: 0 };
    this.lastNoteMs = -Infinity;
    this.hue = 200;
    this.rest = 0; // 0 = active/full color, 1 = resting/desaturated

    this.rand = mulberry32(seed);
    this.phi = 0;
    this.particles = new ObjectPool(() => ({}), (o, init) => Object.assign(o, init, { age: 0 }), 600);
    this._emitAccum = 0;

    this._meshRest = computeRestLengths(MIDASUS_MESH);
    this.pulse = 1;
    this.slashes = []; // short bright cuts along her velocity on note onsets
    // Her diamond core shivers on every melody onset -- quicker and lighter
    // than Midio's body (higher base frequency, faster ring-down).
    this.modal = new ModalRing({ modes: 3, baseHz: 11, decaySec: 0.4, seed: seed + 1 });
    // Gravitationally bound shards: they trail and slingshot as she darts.
    this.debris = new OrbitalDebris(seed + 2);
    // Occasional deep-sky excursion: BiomeManager draws it (see
    // drawDeepSky), far behind the world, while this is active.
    this.voyage = new SkyVoyage(seed + 3);
    // Three baby stars use her as their secure base: orbiting close,
    // exploring one at a time in calm stretches, rushing home when loud.
    this.babies = new BabyStars(seed + 4);

    // Rest-flight repertoire: each time she settles into a rest she picks a
    // fresh figure to trace (see _orbitAnchor), never the same one twice
    // running. Hard melody accents also spin her into a brief pirouette.
    this.orbitStyle = 'lissajous';
    this._wasResting = false;
    this.rollExtra = 0; // pirouette roll, added to her banking in draw()
    this._pirouetteStartMs = -Infinity;
  }

  /** Test/debug hook: send her on a voyage right now regardless of natural
   * triggers. No-op if she's already away. */
  forceVoyage(nowMs) {
    return this.voyage.trigger(nowMs, { ...this.p }, this.stageW, this.stageH);
  }

  _target(n) {
    const norm = clamp((n.pitch - this.pMin) / (this.pMax - this.pMin), 0, 1);
    const y = lerp(this.yFloor - 120, this.yCeiling + 60, norm);
    const x = this.midio.screenX + 90 + 50 * n.vel;
    // The ensemble pulls her across the stage; pitch stays primary vertically.
    if (this._ens) {
      return {
        x: x * 0.35 + this._ens.x * 0.65,
        y: y + clamp(this._ens.y - y, -110, 110) * 0.35,
      };
    }
    return { x, y };
  }

  _orbitAnchor(nowMs, calmLevel) {
    const ax = this._ens ? this._ens.x : this.midio.screenX;
    const ay = this.midio.groundY - this.midio.y - 130;
    const t = nowMs / 1000;
    // Calm sections: the orbit widens and slows -- a lazier, dreamier drift
    // instead of the tighter, quicker figure she traces when energetic.
    const a = 1 + 0.6 * calmLevel;
    const r = 1 - 0.5 * calmLevel;
    switch (this.orbitStyle) {
      case 'figure8': // a sideways 8, crossing right over the anchor
        return {
          x: ax + 82 * a * Math.sin(1.6 * r * t + this.phi),
          y: ay + 48 * a * Math.sin(3.2 * r * t + 2 * this.phi),
        };
      case 'loop': // quick tight circles: loop-the-loops around the anchor
        return {
          x: ax + 55 * a * Math.cos(2.6 * r * t + this.phi),
          y: ay + 55 * a * Math.sin(2.6 * r * t + this.phi),
        };
      case 'petal': { // a three-petal rose, dipping through the center
        const th = 1.4 * r * t + this.phi;
        const rho = 67 * a * (0.55 + 0.45 * Math.cos(3 * th));
        return { x: ax + rho * Math.cos(th), y: ay + rho * Math.sin(th) * 0.7 };
      }
      default: // 'lissajous', the original drift
        return {
          x: ax + 72 * a * Math.sin(1.8 * r * t + this.phi),
          y: ay + 41 * a * Math.sin(1.2 * r * t),
        };
    }
  }

  _hueOf(pitch) { return (((pitch % 12) + 12) % 12) * 30; }

  _burst(n, hue) {
    for (let i = 0; i < n; i++) {
      const ang = this.rand() * Math.PI * 2;
      const speed = 40 + 80 * this.rand();
      this.particles.spawn({
        x: this.p.x, y: this.p.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        size: 4, hue, life: 0.3 + 0.2 * this.rand(),
      });
    }
  }

  _emitStreak(speed) {
    const jitter = 25;
    // Calm sections get a longer, fainter ribbon instead of a short, punchy trail.
    const calmLevel = this._calmLevel || 0;
    this.particles.spawn({
      x: this.p.x, y: this.p.y,
      vx: this.v.x * 0.3 + (this.rand() * 2 - 1) * jitter,
      vy: this.v.y * 0.3 + (this.rand() * 2 - 1) * jitter,
      size: 3, hue: this.hue, life: ((260 + 160 * this.rand()) * (1 + 0.6 * calmLevel)) / 1000,
    });
  }

  update(nowMs, dtSec, calmLevel = 0, ensemble = null, particleMul = 1, wind = null) {
    this._calmLevel = calmLevel;
    this._ens = ensemble;
    this._nowMs = nowMs;
    // Apex-on-beat (ChoreoClock): the DART starts early -- cursor runs
    // ANTICIPATE_MS ahead, so the 70% trajectory snap and the PD pursuit
    // are already carrying her toward the perch as the note arrives...
    while (this.i < this.q.length && this.q[this.i].tMs <= nowMs + ANTICIPATE_MS) {
      const n = this.q[this.i++];
      const t = this._target(n);
      this.p.x += SNAP * (t.x - this.p.x);
      this.p.y += SNAP * (t.y - this.p.y);
      this.v.x *= 0.4;
      this.v.y *= 0.4;
      this.hue = this._hueOf(n.pitch);
      if (this.voyage.active) this.voyage.onMelodyOnset(n); // deep space hears the melody too
      this._impacts.push(n);
    }
    // ...while the IMPACT (burst, slash, pulse, core ring) waits for the
    // note's own heard moment: move early, hit exactly on time.
    const vNowMs = visualNow(nowMs, this.visualLagMs);
    while (this._impacts.length && this._impacts[0].tMs <= vNowMs) {
      const n = this._impacts.shift();
      // Stamped at the heard moment (not at dart time, which runs up to
      // ANTICIPATE_MS ahead) so the silence clock never reads the future.
      this.lastNoteMs = n.tMs;
      if (n.vel > 0.85) this._pirouetteStartMs = nowMs; // hard accents spin her right around
      // The impacting NOTE's own color -- this.hue has already darted ahead
      // to a newer note on dense passages, same reason the slash below
      // re-derives it from n.pitch.
      this._burst(8 + 24 * n.vel, this._hueOf(n.pitch));
      this.pulse = 1.7 + 0.5 * n.vel; // a brief mesh flash on each note onset
      this.modal.excite(1.2 + 3 * n.vel);
      if (n.vel > 0.75) this.debris.burst(n.vel); // hard notes fling the shards outward
      // A slash: a bright cut through her position along her motion.
      const sp = Math.hypot(this.v.x, this.v.y);
      const ang = sp > 20 ? Math.atan2(this.v.y, this.v.x) : this.rand() * Math.PI * 2;
      this.slashes.push({ x: this.p.x, y: this.p.y, ang, len: 26 + 60 * n.vel, age: 0, hue: this._hueOf(n.pitch) });
      if (this.slashes.length > 8) this.slashes.shift();
    }

    this.pulse += (1 - this.pulse) * Math.min(1, dtSec / 0.12);
    this.modal.update(dtSec);
    this.phi += 0.15 * dtSec;

    const nxt = this.q[this.i];
    const silence = nowMs - this.lastNoteMs >= SILENCE_MS || !nxt;
    const target = silence ? this._orbitAnchor(nowMs, calmLevel) : this._target(nxt);
    const restTarget = silence ? 1 : 0;
    this.rest += clamp((restTarget - this.rest) * (dtSec / BLEND_SEC), -1, 1);
    this.rest = clamp(this.rest, 0, 1);

    // Each time she settles into a rest she picks a fresh figure to trace —
    // figure-8s, loop-the-loops, a petaled rose — never the same twice
    // running, with a fresh phase so the entry point varies too.
    const resting = this.rest >= 0.5;
    if (resting && !this._wasResting) {
      const styles = ['lissajous', 'figure8', 'loop', 'petal'].filter((s) => s !== this.orbitStyle);
      this.orbitStyle = styles[Math.floor(this.rand() * styles.length)];
      this.phi = this.rand() * Math.PI * 2;
    }
    this._wasResting = resting;

    // Pirouette: a full roll, eased out, landing exactly back at her bank.
    const pirU = (nowMs - this._pirouetteStartMs) / 320;
    this.rollExtra = pirU >= 0 && pirU < 1 ? Math.PI * 2 * (1 - (1 - pirU) ** 3) : 0;

    this.v.x += (KP * (target.x - this.p.x) - KD * this.v.x) * dtSec;
    this.v.y += (KP * (target.y - this.p.y) - KD * this.v.y) * dtSec;
    this.p.x += this.v.x * dtSec;
    this.p.y += this.v.y * dtSec;

    const speed = Math.hypot(this.v.x, this.v.y);
    const rateMul = 0.15 + 0.85 * (1 - this.rest);
    const rate = (2 + 26 * Math.min(1, speed / 1400)) * rateMul * particleMul;
    this._emitAccum += rate * dtSec * 60;
    while (this._emitAccum >= 1) { this._emitAccum -= 1; this._emitStreak(speed); }

    // The settling stardust rides the same global wind everything else
    // does -- one sample for the whole trail, not per-mote.
    const windX = wind ? wind.x : 0, windY = wind ? wind.y : 0;
    this.particles.step(dtSec, (o, dt) => {
      o.x += (o.vx + windX) * dt; o.y += (o.vy + windY) * dt; o.age += dt;
      return o.age < o.life;
    });
    for (const s of this.slashes) s.age += dtSec;
    while (this.slashes.length && this.slashes[0].age >= SLASH_LIFE_SEC) this.slashes.shift();

    // Note pulses briefly raise her effective mass (orbits tighten);
    // calm sections lower it, so the shards drift into wider, lazier arcs.
    const massMul = (0.8 + 0.5 * (this.pulse - 1)) * (1 - 0.3 * calmLevel);
    this.debris.update(dtSec, this.p, Math.max(0.3, massMul));

    // Sky voyage: the note/PD logic above keeps running harmlessly
    // underneath (so a return never has to catch up on a backlog), but
    // once she's away the voyage fully owns where "she" is -- draw() skips
    // rendering her here and BiomeManager's deep-sky pass takes over.
    const anchorX = this._ens ? this._ens.x : this.midio.screenX + 90;
    const anchorY = this._ens ? this._ens.y : this.yFloor - 200;
    this.voyage.update(nowMs, dtSec, ensemble ? ensemble.epic || 0 : 0, { x: anchorX, y: anchorY });
    if (this.voyage.active) {
      this.p = { ...this.voyage.p };
      this.hue = this.voyage.hue;
    }
    // The babies track her wherever the frame puts her (ensemble, darts,
    // even voyage return points). They render at the mains' intensity (her
    // pulse + the song's epic-ness), are hyper curious about every point of
    // interest the sim hands over (Midio, Broshi, obstacles, the user's
    // cursor), and are aware of the user via that pointer.
    this.babies.update(nowMs, dtSec, this.p, calmLevel, {
      epic: this._ens ? (this._ens.epic || 0) : 0,
      melt: this._ens ? (this._ens.melt || 0) : 0,
      pulse: this.pulse,
      interests: (this._ens && this._ens.interests && this._ens.interests.length)
        ? this._ens.interests
        : [{ x: this.midio.screenX, y: this.midio.groundY - this.midio.y - 40 }],
      pointer: this._ens ? this._ens.pointer : null,
    });

    if (this.voyage.justLanded) {
      // Touchdown: her core rings hard, the shards fling, and a five-point
      // slash star marks the landing (drawn by her normal pass, which has
      // just resumed since depth is back to 0).
      this.modal.excite(6);
      this.debris.burst(1);
      for (let k = 0; k < 5; k++) {
        this.slashes.push({ x: this.p.x, y: this.p.y, ang: (k / 5) * Math.PI, len: 64, age: 0, hue: this.hue });
      }
      while (this.slashes.length > 8) this.slashes.shift();
    }
  }

  /** Current on-screen width in px -- pulses in sync with her core on note
   *  onsets (the same `pulse` value her mesh render uses), then settles. */
  get shadowWidthPx() {
    return 2 * MIDASUS_HEX_R * DRAW_SCALE * this.pulse;
  }

  draw(ctx, particleMul = 1) {
    if (this.voyage.depth > 0.02) return; // she's away; BiomeManager's deep-sky pass owns rendering
    const sat = Math.round(58 - 28 * this.rest); // spectral: pale, never candy
    this.debris.draw(ctx, this.hue, this.rest, particleMul); // behind her core and trail
    // Calm sections fade the ribbon rather than shortening it -- the longer
    // reach comes from _emitStreak's extended particle life, this is the
    // "fainter" half of that same trade.
    const calmFade = 1 - 0.4 * (this._calmLevel || 0);
    for (const p of this.particles.active) {
      const t = p.age / p.life;
      const size = p.size * (1 - t);
      if (size <= 0) continue;
      ctx.fillStyle = `hsla(${p.hue},${sat}%,65%,${(1 - t) * 0.9 * calmFade})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    // Note slashes: bright cuts along her velocity, gone in a blink.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const s of this.slashes) {
      const u = s.age / SLASH_LIFE_SEC;
      ctx.strokeStyle = `hsla(${s.hue},70%,78%,${0.85 * (1 - u)})`;
      ctx.lineWidth = 2.6 * (1 - u * 0.6);
      const ext = s.len * (0.4 + 0.6 * u); // the cut extends as it fades
      ctx.beginPath();
      ctx.moveTo(s.x - Math.cos(s.ang) * ext, s.y - Math.sin(s.ang) * ext);
      ctx.lineTo(s.x + Math.cos(s.ang) * ext, s.y + Math.sin(s.ang) * ext);
      ctx.stroke();
    }
    ctx.restore();

    const hub = MIDASUS_MESH.vertices[0];
    const coreMesh = meltMesh(
      displaceMeshRadial(MIDASUS_MESH, hub.x, hub.y, this.modal),
      hub.x, hub.y, (this._nowMs || 0) / 1000, (this._ens ? this._ens.melt : 0) * 0.7, 3,
    );
    // Banking: she rolls into her darts like something with mass, and her
    // pulse breathes on her ensemble phase -- in step when the trio locks.
    const bank = clamp(this.v.x * BANK_GAIN, -BANK_MAX, BANK_MAX)
      + (this._ens ? 0.08 * Math.sin(this._ens.phase) : 0);

    const rot = bank + this.rollExtra; // pirouette rides on top of the banking

    const coreGlowR = MIDASUS_HEX_R * 2.1 * this.pulse * DRAW_SCALE;
    drawGlowHalo(ctx, this.p.x, this.p.y, coreGlowR, coreGlowR, this.hue, 0.6, { sat, light: 78 });

    // Ink contour (outline) under the crisp pass: her diamond stays
    // knife-edged against the blurred halo drawn just above.
    drawMeshPart(ctx, coreMesh, this._meshRest, { tx: this.p.x, ty: this.p.y, rot, scaleX: this.pulse * DRAW_SCALE, scaleY: this.pulse * DRAW_SCALE }, this.hue, { satBase: sat, lightBase: 70, hueSpread: 26, outline: true });

    // The baby stars ride on top of her pass — small enough never to mask her.
    this.babies.draw(ctx, this.hue, this.rest);
  }
}
