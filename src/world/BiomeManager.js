// Orchestrates the 8-layer parallax contract (spec §4.1.1), biome
// scheduling via novelty-curve segmentation (§4.1.3), and gamma-correct
// profile crossfading (§4.1.4). Each biome is pure data (BiomeProfiles.js);
// this file is the one place that knows how to render the contract.
import { BIOMES } from './BiomeProfiles.js';
import { generateSilhouette, drawTiledStrip } from './SilhouetteGenerator.js';
import { ParticleField } from './ParticleField.js';
import { Mandala } from './Mandala.js';
import { CymaticField } from './CymaticField.js';
import { KuramotoSwarm } from './KuramotoSwarm.js';
import { ChaosRibbon } from './ChaosRibbon.js';
import { ReactionDiffusion } from './ReactionDiffusion.js';
import { decorateStrip } from './Landmarks.js';
import { castBiomes, classifyTransition, intensityBudget, dayArc } from './Dramaturgy.js';
import { LightningFX } from './Lightning.js';
import { PERSONALITY } from './BiomePersonality.js';
import { Murmuration } from './Murmuration.js';
import { superformula } from '../render/oscillators.js';
import { clamp01, smoothstep, mulberry32, hashSeed } from '../utils/math.js';
import { LerpCache } from '../utils/color.js';
import { Role } from '../core/NoteEvent.js';

const LAYER_RATIOS = { L1: 0.05, L2: 0.10, L3: 0.18, L4: 0.30, L5: 0.65, L6: 1.00, L7: 1.20 };
const LAYER_EQ_RATIO = 0.06; // between L1 (celestial) and L2 (far mountains)
const WORLD_SPEED_PX_S = 220;
const BAND_COUNT = 7;
const EQ_ATTACK_SEC = 0.08;
const EQ_RELEASE_SEC = 0.6;
const EQ_MAX_HEIGHT_FRAC = 0.4; // never exceed 40% of screen height, however excited the section is

export class BiomeManager {
  constructor({ conductor, energyCurves, durationMs, canvasWidth, canvasHeight, groundY, songSeed, groundField = null }) {
    this.conductor = conductor;
    this.energyCurves = energyCurves;
    this.durationMs = durationMs || 0;
    this.w = canvasWidth;
    this.h = canvasHeight;
    this.groundY = groundY;
    this.groundField = groundField;
    this._lastSectionIdx = null;
    this._cutFlash = 0;
    this._shutterStartMs = -Infinity;
    this._shutterBarMs = 500;
    this.cutFlashJustFired = false;
    this.budget = 1;
    this.hypeBoost = 1; // drop-surge multiplier from the HypeDirector
    this.mandalaScaleMul = 1; // swells while Midasus dances near the celestial
    this._progress = 0;
    this.lerpCache = new LerpCache();
    this.tSec = 0;
    this._starSeed = mulberry32(9001);
    this.stars = Array.from({ length: 40 }, () => ({
      x: this._starSeed() * this.w, y: this._starSeed() * this.h * 0.6, phase: this._starSeed() * Math.PI * 2,
    }));
    this._glitchTimer = 2 + this._starSeed() * 3;
    this._glitchActiveMs = 0;
    this._scanlineY = 0;
    this._pylonFlash = 0;
    this._eqSmoothed = new Float32Array(BAND_COUNT);

    this.strips = new Map(); // biomeName -> { L2, L3, L4, L5 }
    for (const b of BIOMES) {
      const seed = hashSeed(b.name);
      const strips = {
        L2: generateSilhouette({ seed: seed + 1, octaves: 1, amplitude: 0.20, baseline: 0.45, color: b.silhouette }),
        L3: generateSilhouette({ seed: seed + 2, octaves: 2, amplitude: 0.26, baseline: 0.55, color: b.silhouette }),
        L4: generateSilhouette({ seed: seed + 3, octaves: 3, amplitude: 0.34, baseline: 0.70, color: b.silhouette, edgeLight: b.edgeLight }),
        L5: generateSilhouette({ seed: seed + 4, octaves: 2, amplitude: 0.22, baseline: 0.85, color: b.silhouette, edgeLight: b.edgeLight }),
      };
      // Landmarks: per-song placements (songSeed), baked into the strips,
      // each rooted on the noise ridge at its own x.
      decorateStrip(strips.L4, b.name, hashSeed(`${songSeed}:${b.name}:L4`), b.silhouette, { count: 3, scale: 1 });
      decorateStrip(strips.L5, b.name, hashSeed(`${songSeed}:${b.name}:L5`), b.silhouette, { count: 2, scale: 1.9 });
      this.strips.set(b.name, strips);
    }

    this.fields = new Map(); // biomeName -> ParticleField
    for (const b of BIOMES) this.fields.set(b.name, new ParticleField(b.particles, canvasWidth, canvasHeight, hashSeed(b.name + 'p')));

    this._buildSchedule(conductor.barGrid, energyCurves, durationMs, songSeed);
    this.mandala = new Mandala(songSeed);
    this.cymatics = new CymaticField(songSeed);
    this.swarm = new KuramotoSwarm(songSeed);
    this.ribbon = new ChaosRibbon(songSeed);
    this.rd = new ReactionDiffusion(songSeed);
    this.lightning = new LightningFX(songSeed);
    this.murmuration = new Murmuration(canvasWidth, canvasHeight, songSeed);
    this._beatMs = 500; // EMA'd kick interval, feeding the swarm's natural frequency
    this._lastKickMs = null;

    conductor.onBar(() => { this._scanlineActive = true; this._scanlineY = 0; this.cymatics.onBar(); });
    conductor.on(Role.RHYTHM, (evt) => {
      if (!evt.kick) return;
      this._pylonFlash = 1;
      this.mandala.kick();
      this.swarm.kick(evt.vel);
      this.ribbon.kick();
      this.rd.onKick();
      if (evt.vel > 0.78) this.murmuration.startle(evt.vel);
      // Heavy kicks strike lightning, but only while a storm is blowing.
      const active = this.currentBlend ? this._profile(this.currentBlend.t > 0.5 ? this.currentBlend.to : this.currentBlend.from) : null;
      if (active && active.fx === 'lightning') this.lightning.maybeTrigger(evt.tMs, evt.vel, this.w, this.groundY);
      if (this._lastKickMs != null) {
        const delta = evt.tMs - this._lastKickMs;
        if (delta >= 240 && delta <= 1500) this._beatMs += 0.25 * (delta - this._beatMs);
      }
      this._lastKickMs = evt.tMs;
    });
  }

  _buildSchedule(barGrid, energyCurves, durationMs, songSeed) {
    let barTimes = barGrid.length >= 8 ? barGrid.map((b) => b.ms) : this._evenSplit(durationMs, 8);
    if (barTimes.length < 2) barTimes = [0, durationMs];

    const vectors = barTimes.map((ms) => (energyCurves ? energyCurves.sampleAll(ms) : new Array(7).fill(0)));
    const means = barTimes.map((_, i) => {
      const start = Math.max(0, i - 3);
      const slice = vectors.slice(start, i + 1);
      const avg = new Array(7).fill(0);
      for (const v of slice) for (let k = 0; k < 7; k++) avg[k] += v[k] / slice.length;
      return avg;
    });
    const novelty = barTimes.map((_, i) => {
      if (i < 4) return 0;
      let d = 0;
      for (let k = 0; k < 7; k++) d += (means[i][k] - means[i - 4][k]) ** 2;
      return Math.sqrt(d);
    });

    const minGap = 8;
    const peaks = [];
    const sorted = novelty.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    for (const [v, i] of sorted) {
      if (peaks.length >= 7) break;
      if (v <= 1e-6) continue;
      if (peaks.some((p) => Math.abs(p - i) < minGap)) continue;
      peaks.push(i);
    }
    peaks.sort((a, b) => a - b);

    const cuts = [0, ...peaks, barTimes.length - 1];

    this.sections = [];
    const meanEnergies = [];
    const maxNovelty = Math.max(...novelty, 1e-9);
    for (let i = 0; i < cuts.length - 1; i++) {
      if (cuts[i + 1] <= cuts[i]) continue;
      // Section's mean global energy, for dramaturgical casting.
      let e = 0, count = 0;
      for (let b = cuts[i]; b < cuts[i + 1]; b++, count++) {
        for (let k = 0; k < 7; k++) e += vectors[b][k] / 7;
      }
      meanEnergies.push(count > 0 ? e / count : 0);
      this.sections.push({
        startMs: barTimes[cuts[i]],
        endMs: i === cuts.length - 2 ? durationMs : barTimes[cuts[i + 1]],
        // Boundary sharpness picks the transition style into this section.
        transition: this.sections.length === 0 ? 'fade' : classifyTransition(novelty[cuts[i]], maxNovelty),
        barMs: (barTimes[Math.min(barTimes.length - 1, cuts[i] + 1)] - barTimes[cuts[i]]) || 500,
      });
    }
    if (this.sections.length === 0) {
      this.sections = [{ startMs: 0, endMs: durationMs, transition: 'fade', barMs: 500 }];
      meanEnergies.push(0.5);
    }
    // Cast the show: biomes matched to each section's energy temperament.
    const cast = castBiomes(meanEnergies, songSeed);
    this.sections.forEach((s, i) => { s.profile = cast[i]; });
  }

  _evenSplit(durationMs, n) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push((i / n) * durationMs);
    return out;
  }

  _sectionAt(nowMs) {
    let idx = this.sections.length - 1;
    for (let i = 0; i < this.sections.length; i++) {
      if (this.sections[i].startMs <= nowMs) idx = i; else break;
    }
    return idx;
  }

  _blend(nowMs) {
    const idx = this._sectionAt(nowMs);
    const sec = this.sections[idx];
    if (idx === 0) return { from: sec.profile, to: sec.profile, t: 1 };
    // Transition style sets the crossfade length: a hard cut lands in a
    // small fraction of a bar, a shutter wipes over one bar, a fade
    // breathes across four.
    const bars = sec.transition === 'cut' ? 0.08 : sec.transition === 'shutter' ? 1 : 4;
    const t = smoothstep(0, 1, (nowMs - sec.startMs) / (bars * sec.barMs));
    // Once the crossfade completes, retire the old biome entirely --
    // otherwise its taller peaks and particles ghost through forever.
    if (t >= 0.999) return { from: sec.profile, to: sec.profile, t: 1 };
    return { from: this.sections[idx - 1].profile, to: sec.profile, t };
  }

  _profile(name) { return BIOMES.find((b) => b.name === name); }

  /** The current blended halo color -- shared accent for HUD-level effects. */
  currentHaloColor() {
    if (!this.currentBlend) return '#ffffff';
    const { from, to, t } = this.currentBlend;
    return this.lerpCache.get(this._profile(from).celestial.haloColor, this._profile(to).celestial.haloColor, t);
  }

  update(nowMs, dtSec, energyCurves, calmLevel = 0) {
    this.tSec = nowMs / 1000;
    this.calmLevel = calmLevel;
    const { from, to, t } = this._blend(nowMs);
    this.currentBlend = { from, to, t };

    // Dramaturgy: detect section boundaries and fire their transition FX.
    const sectionIdx = this._sectionAt(nowMs);
    this.cutFlashJustFired = false;
    if (sectionIdx !== this._lastSectionIdx) {
      const sec = this.sections[sectionIdx];
      if (this._lastSectionIdx != null) {
        if (sec.transition === 'cut') { this._cutFlash = 1; this.cutFlashJustFired = true; }
        else if (sec.transition === 'shutter') { this._shutterStartMs = nowMs; this._shutterBarMs = sec.barMs; }
      }
      this._lastSectionIdx = sectionIdx;
    }
    this._cutFlash = Math.max(0, this._cutFlash - dtSec / 0.25);

    // Intensity budget: stage the show -- restrained intro, full finale.
    this._progress = this.durationMs > 0 ? clamp01(nowMs / this.durationMs) : 0.5;
    this.budget = intensityBudget(this._progress);
    const gain = this.budget * this.hypeBoost;
    this.mandala.intensity = gain;
    this.murmuration.intensity = gain;
    this.cymatics.intensity = gain;
    this.swarm.intensity = gain;
    this.ribbon.intensity = gain;
    this.rd.intensity = gain;

    // Biome personality: the dominant biome tunes the phenomena dials.
    const pers = PERSONALITY[t > 0.5 ? to : from] || {};
    this.cymatics.modePool = pers.cymaticModes || null;
    const [bandLo, bandHi] = pers.swarmBand || [0.18, 0.53];
    this.swarm.setBand(bandLo, bandHi);
    this.mandala.rateMul = pers.mandalaRate ?? 1;
    this.rd.bias = pers.rdBias ?? 0;
    this._ribbonScaleMul = pers.ribbonScale ?? 1;

    this.fields.get(from).update(dtSec, this.tSec, energyCurves, nowMs, calmLevel);
    if (to !== from) this.fields.get(to).update(dtSec, this.tSec, energyCurves, nowMs, calmLevel);

    // Horizon EQ (follow-up item 2): fast attack so hits register, slow
    // release so it breathes instead of flickering -- excited, never noisy.
    for (let b = 0; b < BAND_COUNT; b++) {
      const raw = energyCurves ? clamp01(energyCurves.sample(b, nowMs)) : 0;
      const tau = raw > this._eqSmoothed[b] ? EQ_ATTACK_SEC : EQ_RELEASE_SEC;
      this._eqSmoothed[b] += (1 - Math.exp(-dtSec / tau)) * (raw - this._eqSmoothed[b]);
    }

    this.mandala.update(nowMs, dtSec, energyCurves, calmLevel);
    this.cymatics.update(nowMs, dtSec, energyCurves, calmLevel);
    this.swarm.update(nowMs, dtSec, energyCurves, this._beatMs, calmLevel);
    this.ribbon.update(nowMs, dtSec, energyCurves, calmLevel);
    this.rd.update(nowMs, dtSec, energyCurves, calmLevel);
    this.lightning.update(dtSec);
    this.murmuration.update(nowMs, dtSec, energyCurves, calmLevel);

    if (this._scanlineActive) {
      this._scanlineY += dtSec * this.h * 2.2;
      if (this._scanlineY > this.h) this._scanlineActive = false;
    }
    this._pylonFlash = Math.max(0, this._pylonFlash - dtSec / 0.15);

    this._glitchActiveMs -= dtSec * 1000;
    this._glitchTimer -= dtSec;
    if (this._glitchTimer <= 0) { this._glitchActiveMs = 60; this._glitchTimer = 2.5 + this._starSeed() * 3.5; }
  }

  draw(ctx, canvas, worldX, originX = 0, skyVoyage = null) {
    const { from, to, t } = this.currentBlend || { from: this.sections[0].profile, to: this.sections[0].profile, t: 1 };
    const A = this._profile(from), B = this._profile(to);

    this._drawSky(ctx, canvas, A, B, t);

    // Day arc: dawn/dusk tint washes and the celestial's slow climb/descent.
    const arc = dayArc(this._progress);
    for (const wash of [arc.dawn, arc.dusk]) {
      if (wash.alpha > 0.005) {
        ctx.save();
        ctx.globalAlpha = wash.alpha;
        ctx.fillStyle = wash.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }

    this._drawCelestial(ctx, canvas, A, B, t, arc.celestialYFrac);
    // Spirograph resonance mandala, centered on the celestial body so it
    // reads as the sun/moon itself resonating with the track.
    const mandalaColor = this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t);
    this.mandala.draw(ctx, canvas.width * 0.78, canvas.height * arc.celestialYFrac, canvas.height * 0.30 * this.mandalaScaleMul, mandalaColor);
    // Phenomena layer, deep sky: cymatic dust settling into Chladni
    // figures, and the chaos ribbon opposite the celestial for balance.
    this.cymatics.draw(ctx, canvas, mandalaColor);
    this.ribbon.draw(ctx, canvas.width * 0.22, canvas.height * 0.30, canvas.height * 0.075 * (this._ribbonScaleMul || 1), mandalaColor);
    this.lightning.draw(ctx, canvas, this.tSec * 1000); // behind the ranges: bolts land beyond the hills
    this.drawDeepSky(ctx, skyVoyage); // Midasus's sky voyage, when she's away -- behind the mountains below
    this._drawHorizonEQ(ctx, canvas, worldX, A, B, t);

    const scrollX0 = worldX * LAYER_RATIOS.L2, scrollX1 = worldX * LAYER_RATIOS.L3;
    const scrollX2 = worldX * LAYER_RATIOS.L4, scrollX3 = worldX * LAYER_RATIOS.L5;
    const tint = this.lerpCache.get(A.silhouette, B.silhouette, t);

    this._drawLayer(ctx, canvas, 'L2', scrollX0, tint, t, A, B);
    this._drawLayer(ctx, canvas, 'L3', scrollX1, tint, t, A, B);

    // Ambient particle field lives roughly at mid-depth.
    this.fields.get(from).draw(ctx);
    if (to !== from && t > 0.02) { ctx.save(); ctx.globalAlpha = t; this.fields.get(to).draw(ctx); ctx.restore(); }
    // The Kuramoto swarm shares this depth: synchronized flashing motes,
    // with the murmuration wheeling among them.
    this.swarm.draw(ctx, canvas, mandalaColor);
    this.murmuration.draw(ctx, this.tSec * 1000, mandalaColor);

    this._drawLayer(ctx, canvas, 'L4', scrollX2, tint, t, A, B);
    this._drawLayer(ctx, canvas, 'L5', scrollX3, tint, t, A, B);

    this._drawGround(ctx, canvas, worldX, originX, A, B, t);
    this._drawTransitionOverlays(ctx, canvas, B);
  }

  /** Midasus's deep-space excursion: drawn here (behind the mountain
   * silhouettes drawn further down in draw()) so she genuinely reads as
   * "way in the distance" rather than just smaller. Renders her fading
   * constellations (completed figures frozen into the sky), the live
   * persistent trail sky-writing the current figure, and a small mote of
   * light at her current position. A no-op whenever she isn't away. */
  drawDeepSky(ctx, voyage) {
    if (!voyage) return;
    const nowMs = this.tSec * 1000;

    // The Star Atlas draws whether or not she's away: every crystallized
    // constellation stays in the sky for the rest of the song, twinkling
    // per-star and glinting with the beat (atlasPulse rides hype.slam).
    if (voyage.atlas.length) {
      const pulse = voyage.atlasPulse || 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const entry of voyage.atlas) {
        ctx.strokeStyle = `hsla(${entry.hue}, 35%, 82%, ${0.09 * (1 + 1.2 * pulse)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        entry.stars.forEach((s, i) => { if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
        ctx.stroke();
        for (const s of entry.stars) {
          const twinkle = 0.5 + 0.5 * Math.sin(nowMs * 0.0013 + s.phase);
          ctx.fillStyle = `hsla(${entry.hue}, 45%, 88%, ${(0.16 + 0.16 * twinkle) * (1 + 1.6 * pulse)})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 1.1 + 0.5 * twinkle, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    if (voyage.depth <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const c of voyage.constellations) {
      const life = 1 - clamp01((nowMs - c.bornMs) / 6000);
      if (life <= 0) continue;
      ctx.strokeStyle = `hsla(${c.hue}, 60%, 80%, ${0.5 * life})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      c.points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.stroke();
      ctx.fillStyle = `hsla(${c.hue}, 75%, 90%, ${0.9 * life})`;
      for (const p of c.points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Persistent trail: a soft wide glow pass underneath a bright thin
    // core, the way a comet's tail actually reads -- this is the geometry
    // she's sky-writing, so it needs to be legible, not a faint scratch.
    const trail = voyage.trail;
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const u = i / trail.length; // older points fade toward transparent
      ctx.strokeStyle = `hsla(${b.hue}, 65%, 78%, ${0.22 * u})`;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = `hsla(${b.hue}, 75%, 88%, ${0.85 * u})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Kick sparkles: radial bursts flung off her on every beat out there.
    for (const s of voyage.sparkles) {
      const life = 1 - s.age / 0.6;
      if (life <= 0) continue;
      ctx.fillStyle = `hsla(${s.hue}, 80%, 88%, ${0.85 * life})`;
      ctx.fillRect(s.x - 1, s.y - 1, 2.2, 2.2);
    }

    // Micro-slashes: each melody onset cuts a brief bright line at her
    // deep-sky position -- her note-slash vocabulary, miniaturized.
    ctx.lineCap = 'round';
    for (const s of voyage.microSlashes) {
      const u = s.age / 0.25;
      if (u >= 1) continue;
      const ext = 8 + 14 * u;
      ctx.strokeStyle = `hsla(${s.hue}, 75%, 85%, ${0.9 * (1 - u)})`;
      ctx.lineWidth = 1.6 * (1 - u * 0.5);
      ctx.beginPath();
      ctx.moveTo(s.x - Math.cos(s.ang) * ext, s.y - Math.sin(s.ang) * ext);
      ctx.lineTo(s.x + Math.cos(s.ang) * ext, s.y + Math.sin(s.ang) * ext);
      ctx.stroke();
    }

    // Her current position: fades in from nothing (still "here" at the
    // start of ascent) to a small glowing comet-head once fully away.
    const r = 2 + 3 * (1 - voyage.depth);
    ctx.fillStyle = `hsla(${voyage.hue}, 60%, 85%, ${0.28 * voyage.depth})`;
    ctx.beginPath();
    ctx.arc(voyage.p.x, voyage.p.y, r * 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsla(${voyage.hue}, 80%, 92%, ${0.6 + 0.4 * voyage.depth})`;
    ctx.beginPath();
    ctx.arc(voyage.p.x, voyage.p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** Cut flash + shutter wipe, fired by the Dramaturgy Director. */
  _drawTransitionOverlays(ctx, canvas, B) {
    const nowMs = this.tSec * 1000;
    const u = (nowMs - this._shutterStartMs) / this._shutterBarMs;
    if (u >= 0 && u <= 1) {
      // Vertical shutter columns closing then reopening over one bar,
      // phase-staggered so the wipe ripples instead of slamming.
      ctx.save();
      ctx.fillStyle = B.silhouette;
      const cols = 14;
      const colW = canvas.width / cols;
      for (let i = 0; i < cols; i++) {
        const stagger = 0.8 + 0.2 * Math.sin(i * 1.7);
        const h = canvas.height * 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.05)) * stagger;
        ctx.fillRect(i * colW, 0, colW + 1, h);
        ctx.fillRect(i * colW, canvas.height - h, colW + 1, h);
      }
      ctx.restore();
    }
    if (this._cutFlash > 0.01) {
      ctx.save();
      ctx.globalAlpha = 0.35 * this._cutFlash;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  drawForeground(ctx, canvas, worldX) {
    // L7: oversized, blurred, low-alpha foreground veil (spec §4.1.1).
    // Calm sections lift the veil alpha a little -- a small, cheap way to
    // keep this backmost layer visibly breathing when nothing else is loud.
    ctx.save();
    ctx.globalAlpha = 0.10 * (1 + 0.6 * (this.calmLevel || 0));
    ctx.filter = 'blur(6px)';
    const scrollX = worldX * LAYER_RATIOS.L7;
    for (let i = 0; i < 3; i++) {
      const x = ((i * 480 - scrollX) % (canvas.width + 400) + canvas.width + 400) % (canvas.width + 400) - 200;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, canvas.height * (0.3 + 0.2 * i), 160, 90, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawSky(ctx, canvas, A, B, t) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    for (let i = 0; i < 3; i++) g.addColorStop(i / 2, this.lerpCache.get(A.sky[i], B.sky[i], t));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (A.fx === 'starTwinkle' || B.fx === 'starTwinkle') {
      const alpha = (A.fx === 'starTwinkle' ? 1 - t : 0) + (B.fx === 'starTwinkle' ? t : 0);
      if (alpha > 0.02) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        // Calm sections twinkle faster -- a small, free source of motion
        // for a layer that otherwise barely changes frame to frame.
        const twinkleRate = 1.3 * (1 + 0.6 * (this.calmLevel || 0));
        for (const s of this.stars) {
          const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.tSec * twinkleRate + s.phase));
          ctx.globalAlpha = alpha * a;
          ctx.fillRect(s.x, s.y, 1.6, 1.6);
        }
        ctx.restore();
      }
    }
    if (A.fx === 'aurora' || B.fx === 'aurora') {
      const alpha = (A.fx === 'aurora' ? 1 - t : 0) + (B.fx === 'aurora' ? t : 0);
      if (alpha > 0.02) this._drawAurora(ctx, canvas, alpha);
    }
  }

  _drawAurora(ctx, canvas, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 3; band++) {
      const hue = 160 + ((this.tSec * 12 + band * 40) % 140);
      ctx.strokeStyle = `hsla(${hue},80%,60%,${0.16 * alpha})`;
      ctx.lineWidth = 18;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 16) {
        const y = 60 + band * 30 + Math.sin(x * 0.006 + this.tSec * 0.6 + band) * 26;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawCelestial(ctx, canvas, A, B, t, cyFrac = 0.22) {
    const cx = canvas.width * 0.78, cy = canvas.height * cyFrac;
    if (B === A) {
      this._drawOneCelestial(ctx, cx, cy, A.celestial, 1);
    } else {
      this._drawOneCelestial(ctx, cx, cy, A.celestial, 1 - t);
      this._drawOneCelestial(ctx, cx, cy, B.celestial, t);
    }

    const promAlpha = (A.fx === 'prominence' ? 1 - t : 0) + (B.fx === 'prominence' ? t : 0);
    if (promAlpha > 0.02) this._drawProminence(ctx, cx, cy, promAlpha);
  }

  /**
   * The spectrum as weather, not as bars: a continuous luminous ridge on
   * the horizon whose silhouette IS the 7-band spectrum -- cosine-
   * interpolated between bands so there is not a straight line in it,
   * slowly scrolling through the bands, with a traveling undulation riding
   * the crest. Filled glow below, a bright aurora crest line on top.
   */
  _drawHorizonEQ(ctx, canvas, worldX, A, B, t) {
    const color = this.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t);
    const baseline = canvas.height * 0.60;
    const maxH = canvas.height * EQ_MAX_HEIGHT_FRAC;
    const scroll = worldX * 0.0018;
    const tS = this.tSec;

    const N = 64;
    const pts = new Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      // Which pair of bands this column sits between (wrapping, scrolling).
      const p = ((u * BAND_COUNT + scroll) % BAND_COUNT + BAND_COUNT) % BAND_COUNT;
      const i0 = Math.floor(p) % BAND_COUNT, i1 = (i0 + 1) % BAND_COUNT;
      const f = p - Math.floor(p);
      const c = (1 - Math.cos(f * Math.PI)) / 2; // cosine ease: no corners
      const v = clamp01(this._eqSmoothed[i0] * (1 - c) + this._eqSmoothed[i1] * c);
      const wave = Math.sin(u * Math.PI * 7 + tS * 1.6) * 7 * (0.25 + v);
      pts[i] = { x: u * canvas.width, y: baseline - (v * maxH + wave) };
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Body: a soft filled glow from the crest down.
    const grad = ctx.createLinearGradient(0, baseline - maxH, 0, baseline + 30);
    grad.addColorStop(0, `${color}55`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.5 * this.budget;
    ctx.beginPath();
    ctx.moveTo(0, baseline + 30);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(canvas.width, baseline + 30);
    ctx.closePath();
    ctx.fill();

    // Crest: wide faint halo under a bright aurora line.
    for (const [lw, a] of [[7, 0.14], [2.2, 0.6]]) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = a * this.budget;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawOneCelestial(ctx, cx, cy, c, alpha) {
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, c.radius * (c.dominant ? 3.2 : 2.2));
    halo.addColorStop(0, c.haloColor);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, c.radius * (c.dominant ? 3.2 : 2.2), 0, Math.PI * 2);
    ctx.fill();

    if (c.wireframe) {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius, 0, Math.PI * 2);
      ctx.moveTo(cx - c.radius, cy); ctx.lineTo(cx + c.radius, cy);
      ctx.moveTo(cx, cy - c.radius); ctx.lineTo(cx, cy + c.radius);
      ctx.stroke();
    } else if (c.shape) {
      // Superformula silhouette: this biome's sun/moon is a Gielis curve,
      // slowly rotating, normalized so `radius` still means what it says.
      // Odd m only closes after 4*pi (the curve needs two revolutions),
      // even m closes after 2*pi.
      const { m, n1, n2, n3 } = c.shape;
      const span = (m % 2 === 1 ? 4 : 2) * Math.PI;
      const steps = m % 2 === 1 ? 192 : 96;
      let rMax = 0;
      const rs = new Array(steps + 1);
      for (let i = 0; i <= steps; i++) {
        rs[i] = superformula((i / steps) * span, m, n1, n2, n3);
        if (rs[i] > rMax) rMax = rs[i];
      }
      const rot = this.tSec * 0.05;
      ctx.fillStyle = c.color;
      ctx.globalAlpha = alpha * (c.veiled ? 0.6 : 1);
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const phi = (i / steps) * span;
        const r = (rs[i] / rMax) * c.radius;
        const x = cx + Math.cos(phi + rot) * r;
        const y = cy + Math.sin(phi + rot) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = c.color;
      ctx.globalAlpha = alpha * (c.veiled ? 0.6 : 1);
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (c.ring) {
      ctx.strokeStyle = c.haloColor;
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (c.shattered) {
      ctx.strokeStyle = '#05010d';
      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - c.radius * 0.3, cy - c.radius * 0.6);
      ctx.lineTo(cx + c.radius * 0.1, cy + c.radius * 0.4);
      ctx.moveTo(cx + c.radius * 0.4, cy - c.radius * 0.5);
      ctx.lineTo(cx - c.radius * 0.1, cy + c.radius * 0.2);
      ctx.stroke();
    }
    if (c.shafts) {
      ctx.globalAlpha = alpha * 0.10;
      ctx.fillStyle = c.color;
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((i - 2) * 0.22 + Math.sin(this.tSec * 0.2 + i) * 0.03);
        ctx.fillRect(-8, 0, 16, 600);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  _drawProminence(ctx, cx, cy, alpha) {
    const e0 = this.energyCurves ? this.energyCurves.sample(0, this.tSec * 1000) : 0.3;
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = '#ffcf6b';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + this.tSec * 0.15;
      const r1 = 80, r2 = 80 + 30 * (0.3 + e0);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.6);
      ctx.quadraticCurveTo(
        cx + Math.cos(ang) * (r1 + r2) * 0.7, cy + Math.sin(ang) * (r1 + r2) * 0.4 - 20,
        cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2 * 0.6,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawLayer(ctx, canvas, layerKey, scrollX, tint, t, A, B) {
    const stripsA = this.strips.get(A.name), stripsB = this.strips.get(B.name);
    // Lift the ranges so their ridges actually clear the ground band --
    // strip bottoms stay tucked safely beneath the ground fill.
    const yOff = this.groundY + 40 - canvas.height;
    ctx.save();
    if (A.fx === 'heatShimmer' || B.fx === 'heatShimmer') {
      const alpha = (A.fx === 'heatShimmer' ? 1 - t : 0) + (B.fx === 'heatShimmer' ? t : 0);
      if (alpha > 0.05 && layerKey !== 'L5') { this._drawShimmered(ctx, canvas, stripsA[layerKey], scrollX, yOff); }
      else drawTiledStrip(ctx, stripsA[layerKey], scrollX, canvas.width, canvas.height, yOff);
    } else {
      drawTiledStrip(ctx, stripsA[layerKey], scrollX, canvas.width, canvas.height, yOff);
    }
    if (B !== A && t > 0.02) {
      ctx.globalAlpha = t;
      drawTiledStrip(ctx, stripsB[layerKey], scrollX, canvas.width, canvas.height, yOff);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  _drawShimmered(ctx, canvas, strip, scrollX, yOff = 0) {
    const w = strip.width, h = strip.height;
    const baseY = canvas.height - h + yOff;
    let x0 = -(((scrollX % w) + w) % w);
    const step = 6;
    for (let sx = x0; sx < canvas.width; sx += w) {
      for (let row = 0; row < h; row += step) {
        const offset = 2 * Math.sin(row / 24 + this.tSec * 4);
        ctx.drawImage(strip, 0, row, w, step, sx + offset, baseY + row, w, step);
      }
    }
  }

  _drawGround(ctx, canvas, worldX, originX, A, B, t) {
    const groundColor = this.lerpCache.get(A.silhouette, B.silhouette, t);
    const localGroundY = this.groundField ? this.groundField.heightAt(worldX) : this.groundY;

    if (this.groundField) {
      // Ground as shifted EQ-bar-shaped slices (follow-up item 5): each bar
      // echoes the horizon EQ's own per-band reading, just offset by a few
      // columns, so the terrain visually rhymes with the music playing far
      // in the background.
      const bars = this.groundField.visibleBars(worldX, originX, canvas.width);
      ctx.fillStyle = groundColor;
      for (const bar of bars) ctx.fillRect(bar.x, bar.y, bar.width + 1, canvas.height - bar.y);

      // Gray-Scott texture living inside the ground: clip to the slice
      // silhouette so the pattern rides the terrain's vertical motion.
      let minTop = canvas.height;
      ctx.save();
      ctx.beginPath();
      for (const bar of bars) {
        ctx.rect(bar.x, bar.y, bar.width + 1, canvas.height - bar.y);
        if (bar.y < minTop) minTop = bar.y;
      }
      ctx.clip();
      this.rd.draw(ctx, canvas, worldX, minTop);
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        ctx.moveTo(bar.x, bar.y);
        ctx.lineTo(bar.x + bar.width, bar.y);
        if (i + 1 < bars.length) ctx.lineTo(bar.x + bar.width, bars[i + 1].y); // vertical connector at the seam
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = groundColor;
      ctx.fillRect(0, localGroundY, canvas.width, canvas.height - localGroundY);
    }

    const activeFx = t > 0.5 ? B.fx : A.fx;
    if (activeFx === 'neonGrid') this._drawNeonGrid(ctx, canvas, worldX, localGroundY);
    else if (activeFx === 'canopyDapple') this._drawCanopyDapple(ctx, canvas, localGroundY);
    else if (activeFx === 'glitchTear' && this._glitchActiveMs > 0) this._drawGlitchTear(ctx, canvas);
    else if (activeFx === 'petalPile') this._drawPetalPiles(ctx, canvas, worldX, localGroundY, t > 0.5 ? B : A);
  }

  /** SAKURA's dormant hook: soft petal drifts scrolling with the ground. */
  _drawPetalPiles(ctx, canvas, worldX, groundY, profile) {
    ctx.save();
    ctx.fillStyle = profile.particles.color;
    const spacing = 300;
    for (let i = 0; i < 6; i++) {
      const x = ((i * spacing - worldX) % (canvas.width + spacing) + canvas.width + spacing) % (canvas.width + spacing) - spacing / 2;
      const breathe = 0.8 + 0.2 * Math.sin(this.tSec * 0.5 + i * 2.1);
      ctx.globalAlpha = 0.22 * breathe;
      ctx.beginPath();
      ctx.ellipse(x, groundY + 3, 40 + (i % 3) * 16, 7 + (i % 2) * 3, 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawNeonGrid(ctx, canvas, worldX, groundY) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,208,0.35)';
    ctx.lineWidth = 1;
    const spacing = 48;
    const offset = worldX % spacing;
    for (let x = -offset; x < canvas.width; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = groundY; y < canvas.height; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    if (this._scanlineActive) {
      ctx.fillStyle = 'rgba(0,255,208,0.12)';
      ctx.fillRect(0, this._scanlineY, canvas.width, 6);
    }
    if (this._pylonFlash > 0.02) {
      ctx.globalAlpha = this._pylonFlash;
      ctx.fillStyle = '#00ffd0';
      for (let i = 0; i < 3; i++) {
        const x = ((i * 420 - worldX * 0.65) % (canvas.width + 200) + canvas.width + 200) % (canvas.width + 200) - 100;
        ctx.fillRect(x, groundY - 140, 6, 140);
      }
    }
    ctx.restore();
  }

  _drawCanopyDapple(ctx, canvas, groundY) {
    ctx.save();
    ctx.fillStyle = 'rgba(234,255,176,0.10)';
    for (let i = 0; i < 5; i++) {
      const flick = 0.6 + 0.4 * Math.sin(this.tSec * (0.8 + i * 0.3) + i);
      ctx.globalAlpha = 0.5 * flick;
      const x = ((i * 240) % canvas.width);
      ctx.beginPath();
      ctx.ellipse(x, groundY + 30, 60, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawGlitchTear(ctx, canvas) {
    const rowY = Math.floor((mulberry32(Math.floor(this.tSec * 4))() ) * (canvas.height - 100));
    const rowH = 18;
    const shift = 6 * (mulberry32(Math.floor(this.tSec * 4) + 1)() * 2 - 1);
    const snapshot = ctx.getImageData(0, rowY, canvas.width, rowH);
    ctx.putImageData(snapshot, shift, rowY);
  }
}
