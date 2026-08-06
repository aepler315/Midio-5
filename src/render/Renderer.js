// Canvas 2D compositor. Draws sky -> parallax biome layers -> ground ->
// telegraph glints -> world FX -> companions -> Midio -> foreground veil ->
// cracks/shatter -> HUD. Layers are added incrementally as later stages land;
// each stage guards on the subsystem's presence so this file grows additively.
import { MIDIO_MESH, MIDIO_BODY, MIDIO_EYE, MIDIO_APOTHEOSIS_FOLDED, MIDIO_APOTHEOSIS_UNFOLDED } from './meshes.js';
import { computeRestLengths, drawMeshPart, displaceMeshRadial, meltMesh, lerpMesh, applyTransform, drawGlowHalo } from './MeshDrawer.js';
import { spectralHue, easeHueDeg } from './stellar.js';
import { EpicycleShow } from './EpicycleShow.js';
import { ComposerStrip } from './ComposerStrip.js';
import { RainbowBrush } from './RainbowBrush.js';
import { GOLD_AFTERIMAGE_LIFE_MS } from '../sim/MidioPerformer.js';
import { contactShadow } from '../world/ContactShadow.js';
import { clamp01 } from '../utils/math.js';
import { capFlashAlpha } from '../ui/Accessibility.js';
import { LerpCache, hexToRgb } from '../utils/color.js';
import { nearestPaletteColor, pixelGridWidth, pixelGridHeight, SCANLINE_ALPHA, SCANLINE_PERIOD_PX } from './RetroFilter.js';
import { hypeFrameStyle } from '../sim/HypeDirector.js';
import { isRendered, styleDials } from './VisualStyle.js';

const MIDIO_BASE_HUE = 42; // warm gold, matching his original color
const MIDIO_EYE_CY = -31; // MIDIO_EYE's local center, for blink scaling around its own middle
const MIDIO_DRAW_SCALE = 1.8; // the stage got bigger: render-only, physics untouched

// Fever aura: a screen-edge glow that only shows up once the player's earned
// it -- silent below the threshold so it never competes with the vignette
// or hype frame on an ordinary section.
const FEVER_AURA_THRESHOLD = 0.55;
const FEVER_AURA_MAX_ALPHA = 0.22;

// Drop impact pack: a brief chromatic-split shock + radial speed-lines,
// fired once per HypeDirector drop (see Simulation's dropCount edge-detect).
const DROP_IMPACT_LIFE_MS = 320;
const SHOCK_MAX_OFFSET_PX = 8;
const SHOCK_MAX_ALPHA = 0.5;
const SPEED_LINE_COUNT = 24;
const SPEED_LINE_MAX_ALPHA = 0.35;

// Bloom: a final light-bleed pass over the fully composed frame -- the
// additive glow language used everywhere (character underlays, kick
// ignition, the celestial, aurora, drop shockwaves) currently stops hard
// at each source's own edges instead of bleeding into the frame the way a
// real luminous source does. Downsampled (cheap blur for free) + a
// self-multiply threshold (keeps near-white sources, crushes midtones) +
// a real blur, added back additively at a strength driven by the music.
const BLOOM_DOWNSCALE = 3;       // offscreen buffers render at 1/3 resolution
const BLOOM_BLUR_PX = 7;         // blur radius AT that downsampled scale
const BLOOM_THRESHOLD_PASSES = 2; // self-multiply passes: c^(2^passes)
export const BLOOM_BASE = 0.322; // steady glow present even at rest -- never flash-capped (0.23 base * the house look's 1.4 bloomBaseMul, folded in now that there's only one style)
// Headroom above the base must clear FLASH_CAP (Accessibility.js) with
// margin, or reduced-flash's own cap on the reactive term would be masked
// by this ceiling clipping first -- the whole point of capping the
// reactive term separately is that it still visibly tames the swell.
const BLOOM_MAX = 0.75;          // hard ceiling so a maxed drop+fever never blows out

// Film finish: breathing vignette + very-low-alpha color grade (see FilmFinish.js).
const FILM_GRADE_COOL = '#1a7a96';       // deeper ocean teal -- calm / space push
const FILM_GRADE_WARM = '#e88a55';       // muted amber -- hot/high-budget push
const FILM_GRADE_SPACE = '#2a2060';      // indigo space wash layered in rendered style
const FILM_GRADE_ALPHA_BASE = 0.05;      // floor alpha for the grade wash -- a finish, not a filter
const FILM_GRADE_ALPHA_RANGE = 0.03;     // extra alpha the further warmth sits from neutral
const VIGNETTE_MIN_ALPHA = 0.12;         // edge darkness at maximum openness (full hype/drop)
const VIGNETTE_MAX_ALPHA = 0.54;         // edge darkness at maximum depth (fully calm) -- deeper, moodier frame
const VIGNETTE_ONSET_MIN = 0.34;         // onset fraction (of corner radius) at max depth -- a deep iris
const VIGNETTE_ONSET_MAX = 0.62;         // onset fraction at min depth -- only the outer ring ever darkens

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._midioRestLengths = computeRestLengths(MIDIO_MESH);
    this._midioBodyRest = computeRestLengths(MIDIO_BODY);
    this._midioEyeRest = computeRestLengths(MIDIO_EYE);
    this._apoBodyRest = computeRestLengths(MIDIO_APOTHEOSIS_FOLDED);
    this.epicycles = new EpicycleShow();
    // Seeded from whatever the performer already holds, not from null.
    // `lastMilestone` persists for the whole Simulation, so a renderer rebuilt
    // mid-song (a restart, a resize path) would otherwise see a milestone from
    // minutes ago as "new" and replay it out of nowhere.
    this._lastMilestoneMs = null;
    this._milestoneSeeded = false;
    this.composer = null; // lazy: needs the conductor's timeline at first draw
    this.brush = new RainbowBrush();
    // Renderer-owned (not sim.biomes.lerpCache) so the film finish still
    // works if sim.biomes were ever null (the fallback-sky branch below).
    this._filmLerpCache = new LerpCache();
  }

  draw(sim, alpha) {
    const { ctx, canvas } = this;
    const fracture = sim.fracture || null;
    this._styleDials = styleDials(sim.visualStyle);

    // Logical stage (sim anchors) vs physical buffer (may be 720p–4K).
    // All world drawing uses logical dimensions; the transform scales into
    // the backing store so composition stays correct at every preset.
    const stageW = sim.stageW || sim.canvasWidth || 1280;
    const stageH = sim.stageH || sim.canvasHeight || 720;
    const stage = this._stageView || (this._stageView = { width: stageW, height: stageH });
    stage.width = stageW;
    stage.height = stageH;
    const sx = canvas.width / stageW;
    const sy = canvas.height / stageH;

    if (fracture && (fracture.isFrozen || fracture.isDone)) {
      // Shatter geometry is logical-stage space; scale into the physical buffer.
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      fracture.drawShatter(ctx, stage);
      return;
    }

    const pose = sim.lerpState(alpha);
    const camera = sim.camera;
    const biomeManager = sim.biomes || null;
    const perf = sim.perf || null;
    const particleMul = perf ? perf.particleMul : 1;
    // Shared by the ambient obstacles, so they tint themselves off the
    // same current biome as everything else.
    const haloColor = biomeManager && biomeManager.currentHaloColor ? biomeManager.currentHaloColor() : '#ffdca0';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);

    // Zoom has been removed entirely: the camera holds one fixed framing.
    // Only the damped impact roll and the screen shake move the frame now,
    // both pivoting on screen center so a shake/roll never scrolls the
    // world sideways.
    ctx.save();
    ctx.translate(stageW / 2, stageH / 2);
    ctx.rotate(camera.roll || 0); // damped impact roll, pivoting on screen center
    ctx.translate(-stageW / 2 + camera.shakeX, -stageH / 2 + camera.shakeY);

    if (biomeManager) {
      biomeManager.draw(ctx, stage, pose.worldX, pose.midioX, sim.midasus ? sim.midasus.voyage : null, particleMul, perf);
    } else {
      this._drawFallbackSky(ctx, stage);
      this._drawGround(ctx, stage, pose, sim.midio.groundY);
    }
    // Movement VII: the celestial body as a light, resolved once per frame
    // and shared by every contact shadow / rim light call below.
    const light = biomeManager ? biomeManager.currentLight() : null;
    const contactShadowsEnabled = perf ? perf.contactShadowsEnabled : true;
    const rimLightEnabled = perf ? perf.rimLightEnabled : true;

    // Broshi's underground excursion: drawn beneath the world -- literally
    // inside the earth, under everything that walks on it -- rather than
    // inside BiomeManager's sky/parallax stack.
    if (sim.broshi) sim.broshi.burrow.draw(ctx, pose.worldX, pose.midioX);

    // The Unraveling: a global desaturation overlay, drawn right here so it
    // only touches the world painted so far (sky/phenomena/silhouettes/
    // burrow) -- telegraph, obstacles, and every character draw afterward,
    // fully saturated, exactly per the hard rule.
    if (sim.coda) this._drawDesaturationOverlay(ctx, stage, sim.coda);

    if (sim.telegraph) sim.telegraph.draw(ctx, sim.midio.groundY);
    if (sim.obstacles) {
      sim.obstacles.draw(ctx, pose.worldX, pose.midioX, sim.midio.groundY, {
        nowMs: sim.timeMs, energyCurves: sim.energyCurves, haloColor,
        wind: sim.biomes ? sim.biomes.wind : { x: 0, y: 0 },
        particleMul, reducedFlash: !!sim.reducedFlash,
      });
    }
    if (sim.impactFX) sim.impactFX.draw(ctx, pose.worldX, pose.midioX);
    if (sim.rippleFX) sim.rippleFX.draw(ctx, pose.worldX, pose.midioX, sim.reducedFlash);
    if (sim.battle) this._drawBattleEnemies(ctx, sim);

    // Rainbow brush: paint Midio's jump arcs, world-locked behind him.
    this.brush.update(sim.timeMs, pose.airborne, pose.worldX, pose.midioY);
    this.brush.draw(ctx, pose.worldX, pose.midioX, sim.timeMs, sim.apotheosis && sim.apotheosis.active ? 2 : 1);

    // Contact shadows: grounds the trio to the terrain instead of letting
    // them read as floating. Drawn just before each character so the
    // shadow always sits directly underneath its owner in paint order.
    if (sim.broshi && sim.broshi.burrow.depth <= 0.02) {
      this._drawContactShadow(ctx, contactShadow(sim.broshi.renderX, sim.broshi.groundY, sim.broshi.hopY, sim.broshi.shadowWidthPx));
    }
    if (sim.broshi) sim.broshi.draw(ctx, pose);

    // Midio wears Midasus's pale spectral treatment now: his base hue tracks
    // the song's key (KeyDirector.tonic), eased so the color drifts between
    // keys rather than snapping. His silhouette/rig are untouched.
    const keyHue = spectralHue(sim.keyDirector ? sim.keyDirector.tonic : 0);
    this._midioHue = this._midioHue == null ? keyHue : easeHueDeg(this._midioHue, keyHue, 0.04);

    if (sim.performer) {
      this._drawMidioAfterimages(ctx, sim.performer, pose.midioDrawX, this._midioHue);
      this._drawGoldAfterimages(ctx, sim.performer, pose.midioDrawX, sim.timeMs);
    }
    const midioWidthPx = sim.midio.halfWidth * 2 * MIDIO_DRAW_SCALE * pose.scaleX;
    const midioHeightAbove = sim.midio.groundY - pose.midioY;
    this._drawContactShadow(ctx, contactShadow(pose.midioDrawX, sim.midio.groundY, midioHeightAbove, midioWidthPx));
    // Fever adds its own glow on top of the vibe's epic-ness -- a hot streak
    // makes Midio himself burn brighter, not just the world around him.
    const feverGlow = sim.fever ? 3.0 * sim.fever.level : 0;
    this._drawMidio(ctx, pose, sim.performer, sim.timeMs / 1000, (sim.vibe ? 2.5 + 4.5 * sim.vibe.epic : 0) + feverGlow, sim.apotheosis, sim.reducedFlash, this._midioHue, sim.ensemble);

    // Combo milestone: a Fourier epicycle machine draws the digit above Midio.
    const lm = sim.performer ? sim.performer.lastMilestone : null;
    if (!this._milestoneSeeded) {
      this._milestoneSeeded = true;
      this._lastMilestoneMs = lm ? lm.atMs : null; // adopt, don't replay
    } else if (lm && lm.atMs !== this._lastMilestoneMs) {
      this._lastMilestoneMs = lm.atMs;
      this.epicycles.trigger(lm.idx, pose.midioDrawX + 30, sim.midio.groundY - 245, sim.timeMs);
    }
    this.epicycles.draw(ctx, sim.timeMs);
    this._drawDropShockwave(ctx, stage, sim, pose);

    if (sim.midasus && sim.midasus.voyage.depth <= 0) {
      const heightAbove = sim.midasus.yFloor - sim.midasus.p.y;
      this._drawContactShadow(ctx, contactShadow(sim.midasus.p.x, sim.midasus.yFloor, heightAbove, sim.midasus.shadowWidthPx));
    }
    if (sim.midasus) sim.midasus.draw(ctx, particleMul);
    if (sim.battle) this._drawBattleFX(ctx, sim);
    if (sim.gnat) sim.gnat.draw(ctx, sim.timeMs);
    if (sim.fracture) sim.fracture.draw(ctx, stage, { glow: perf ? perf.crackGlowEnabled : true });
    if (biomeManager) biomeManager.drawForeground(ctx, stage, pose.worldX, perf ? perf.veilEnabled : true);
    if (sim.keyDirector) this._drawTranspositionWave(ctx, stage, sim.keyDirector);

    ctx.restore(); // camera transform

    if (sim.fever) this._drawFeverAura(ctx, stage, sim.fever.level, sim.biomes, sim.reducedFlash);
    if (sim.hype) this._drawHypeFrame(ctx, stage, sim);
    // Drop impact pack: a chromatic shock + radial speed-lines from Midio,
    // both keyed off the same window as the shockwave rings -- drawn last so
    // they shock the fully composed frame, hype border and highway included.
    if (sim.hype) this._drawDropImpact(ctx, stage, sim, pose);

    // Post FX that sample the pixel buffer need identity transform + full
    // physical canvas size (bloom / retro / freeze capture).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._drawBloom(ctx, canvas, sim);
    if (sim.filmFinish && (perf ? perf.heavyPostFx : true)) {
      // Film finish was authored in logical space; scale its fill rects.
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      this._drawFilmFinish(ctx, stage, sim);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Classic (SMW lineage) keeps the 8-bit retro finish. Rendered (DKC3
    // lineage) skips it so soft CGI shading and bloom stay cinematic.
    const dials = styleDials(sim.visualStyle);
    if (dials.retroFilter && (perf ? perf.heavyPostFx : true)) this._drawRetroFilter(ctx, canvas);

    // HUD seekbar AFTER post-FX so vignette/bloom never bury it. paramBus is
    // optional (lives on sim); never reference a free variable here — a
    // ReferenceError used to abort the draw and kill the strip entirely.
    if (sim.conductor) {
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      if (!this.composer) {
        const holds = sim.noteChart ? sim.noteChart.notes.filter((n) => n.type === 'hold') : [];
        const sections = sim.biomes?.sections || [];
        this.composer = new ComposerStrip(
          sim.conductor.timeline, sim.conductor.barGrid, sim.conductor.durationMs, holds, sections,
        );
      } else if (sim.biomes?.sections) {
        this.composer.setSections(sim.biomes.sections);
      }
      this.composer.draw(ctx, stage, sim.timeMs, {
        showLabels: !!(sim.showSectionLabels || sim.paramBus?.showSectionLabels),
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    if (fracture && fracture.isAboutToFreeze) fracture.captureFreeze(canvas, sim.timeMs);

    // The Reel: grab a highlight thumbnail of the fully-composed frame at
    // each of the song's five defining moments. notify() edge-triggers, so
    // each condition just describes "is this happening right now".
    if (sim.highlightReel) {
      const reel = sim.highlightReel, t = sim.timeMs;
      reel.notify('drop', Number.isFinite(sim.hype?.dropAtMs) && t - sim.hype.dropAtMs < 100, canvas, t, 'Drop');
      reel.notify('voyage', sim.midasus?.voyage?.phase === 'WINDUP', canvas, t, 'Sky Voyage');
      reel.notify('burrow', sim.broshi?.burrow?.phase === 'DIG_IN', canvas, t, 'Burrow');
      reel.notify('detonation', !!sim._atlasDetonated, canvas, t, 'Supernova');
      reel.notify('freeze', !!(fracture && fracture.isAboutToFreeze), canvas, t, 'Finale');
    }
  }

  /** The Key of the World: a kick-synced vertical chromatic wash, in the
   *  new tonic's hue, sweeping across the frame over a confirmed key change. */
  _drawTranspositionWave(ctx, canvas, keyDirector) {
    if (!keyDirector.transitionActive || !keyDirector.lastKeyChange) return;
    const hue = (((keyDirector.lastKeyChange.to % 12) + 12) % 12) * 30;
    const u = keyDirector.transitionProgress;
    const bandWidth = canvas.width * 0.55;
    const cx = -bandWidth + u * (canvas.width + bandWidth * 2);
    const alpha = Math.sin(Math.PI * u); // eases in and back out across the sweep
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(cx - bandWidth / 2, 0, cx + bandWidth / 2, 0);
    g.addColorStop(0, `hsla(${hue},80%,60%,0)`);
    g.addColorStop(0.5, `hsla(${hue},85%,65%,${(0.35 * alpha).toFixed(3)})`);
    g.addColorStop(1, `hsla(${hue},80%,60%,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** The Unraveling: a 'saturation' blend-mode rect pulls the whole world
   *  toward gray as the ending arc progresses. A fully desaturated (gray)
   *  fill under this blend mode desaturates the backdrop proportionally to
   *  globalAlpha -- no pixel readback needed. */
  _drawDesaturationOverlay(ctx, canvas, coda) {
    const amount = coda.desaturation;
    if (amount <= 0.001) return;
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = amount;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Drop shockwave: two expanding rings thrown from Midio on a detected drop. */
  _drawDropShockwave(ctx, canvas, sim, pose) {
    const hype = sim.hype;
    if (!hype) return;
    const u = hype.ringU(sim.timeMs);
    if (u == null) return;
    const cx = pose.midioDrawX, cy = sim.midio.groundY - 60;
    const maxR = Math.hypot(canvas.width, canvas.height) * 0.75;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [lag, alphaMul, lw] of [[0, 1, 3.5], [0.12, 0.5, 1.8]]) {
      const uu = u - lag;
      if (uu <= 0) continue;
      const r = maxR * (1 - (1 - uu) ** 2); // ease-out: it detonates, then coasts
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = (1 - uu) ** 2 * 0.55 * alphaMul;
      ctx.lineWidth = lw + 10 * (1 - uu);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Battle enemies: angular wireframe glyphs (flyers wobble in the air,
   *  crawlers hug the ground), screen-locked like the characters -- world
   *  scroll doesn't apply to them, they live where they're drawn. */
  _drawBattleEnemies(ctx, sim) {
    const battle = sim.battle;
    const tSec = sim.timeMs / 1000;
    const nowMs = sim.timeMs;
    const SCALE = 1.5; // "slightly bigger" -- fewer, tougher, more visible
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of battle.enemies.active) {
      const bob = e.kind === 'flyer' ? Math.sin(tSec * 5 + e.bobPhase) * 8 : 0;
      // A recent stagger reads as a hot white flash that cools back to the
      // menace hue -- visible proof the hit landed without killing it.
      const sinceStagger = nowMs - e.staggerMs;
      const hot = clamp01(1 - sinceStagger / 220);
      const hue = e.locked ? 350 : 5; // faint menace, brightens once locked/targeted
      const light = 65 + 25 * hot;
      ctx.save();
      ctx.translate(e.sx, e.sy + bob);
      ctx.scale(SCALE, SCALE);
      ctx.strokeStyle = `hsla(${hue}, 70%, ${light}%, ${capFlashAlpha(0.8, sim.reducedFlash).toFixed(3)})`;
      ctx.lineWidth = 2 / SCALE;
      ctx.beginPath();
      if (e.kind === 'flyer') {
        const wingFlap = Math.sin(tSec * 14 + e.bobPhase);
        ctx.moveTo(0, -10);
        ctx.lineTo(9, wingFlap * 4);
        ctx.lineTo(0, 10);
        ctx.lineTo(-9, wingFlap * 4);
        ctx.closePath();
        ctx.moveTo(-9, 0); ctx.lineTo(9, 0);
      } else {
        ctx.moveTo(-10, 0);
        ctx.lineTo(-4, -9);
        ctx.lineTo(4, -9);
        ctx.lineTo(10, 0);
        ctx.lineTo(6, 4);
        ctx.lineTo(-6, 4);
        ctx.closePath();
        const leg = Math.sin(tSec * 16 + e.bobPhase) * 3;
        ctx.moveTo(-6, 4); ctx.lineTo(-6 + leg, 9);
        ctx.moveTo(6, 4); ctx.lineTo(6 - leg, 9);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /** Battle FX: muzzle glints, the dots of light in flight, and the
   *  vaporize bursts when they arrive exactly on the 16th-note beat. Drawn
   *  over all three characters so every shot reads as fired from them. */
  _drawBattleFX(ctx, sim) {
    const battle = sim.battle;
    const vNow = sim.timeMs - (sim.visualLagMs || 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const bezier = (u, x0, y0, lx, ly, tx, ty) => {
      const omu = 1 - u;
      return [
        omu * omu * x0 + 2 * omu * u * lx + u * u * tx,
        omu * omu * y0 + 2 * omu * u * ly + u * u * ty,
      ];
    };
    for (const d of battle.dots.active) {
      const u = clamp01((vNow - d.departMs) / Math.max(1e-6, d.travelMs));
      const e = battle.enemies.active.find((en) => en.id === d.enemyId);
      const tx = e ? e.sx : d.x0, ty = e ? e.sy : d.y0;
      const liftX = (d.x0 + tx) / 2, liftY = Math.min(d.y0, ty) - 30;
      const [x, y] = bezier(u, d.x0, d.y0, liftX, liftY, tx, ty);
      // Muzzle glint at departure.
      if (u < 0.15) {
        ctx.fillStyle = `rgba(255,245,200,${capFlashAlpha(0.6 * (1 - u / 0.15), sim.reducedFlash).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(d.x0, d.y0, 6, 0, Math.PI * 2); ctx.fill();
      }
      const [tailX, tailY] = bezier(Math.max(0, u - 0.08), d.x0, d.y0, liftX, liftY, tx, ty);
      ctx.strokeStyle = `rgba(255,250,210,${capFlashAlpha(0.9, sim.reducedFlash).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,235,${capFlashAlpha(1, sim.reducedFlash).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }

    for (const b of battle.bursts.active) {
      const t = b.age / b.life;
      const alpha = capFlashAlpha((1 - t) ** 2, sim.reducedFlash);
      ctx.strokeStyle = `rgba(255,235,190,${alpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      for (const s of b.shards) {
        const r = s.speed * b.age;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + Math.cos(s.ang) * r, b.y + Math.sin(s.ang) * r);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(255,255,240,${alpha.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(b.x, b.y, 14 * (1 - t), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** Film finish: the last cinematography pass before the HUD. A soft-light
   *  color grade wash (warm push when hot/high-budget, cool push when
   *  calm) drawn first, then a radial-gradient vignette on top -- grade-
   *  then-vignette matches a real post pipeline, where the vignette is a
   *  neutral lens artifact applied after grading. Neither channel ever
   *  spikes upward on a kick/drop (edgeAlpha only ever opens on hype,
   *  gradeAlpha has no percussive term at all), so this deliberately never
   *  routes through capFlashAlpha. */
  _drawFilmFinish(ctx, canvas, sim) {
    const ff = sim.filmFinish;
    const dials = styleDials(sim.visualStyle);
    const gradeMul = dials.filmGradeMul;
    const vigMul = dials.vignetteDepthMul;

    const color = this._filmLerpCache.get(FILM_GRADE_COOL, FILM_GRADE_WARM, ff.warmth);
    const gradeAlpha = (FILM_GRADE_ALPHA_BASE + FILM_GRADE_ALPHA_RANGE * Math.abs(ff.warmth - 0.5) * 2) * gradeMul;
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(0.22, gradeAlpha);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Rendered: a whisper of indigo space grade so the whole frame reads
    // a little more orbital / deep-sea than pure warm daylight.
    if (dials.spaceWash) {
      ctx.globalAlpha = Math.min(0.12, 0.045 * gradeMul);
      ctx.fillStyle = FILM_GRADE_SPACE;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();

    const cx = canvas.width / 2, cy = canvas.height / 2;
    const outerR = Math.hypot(cx, cy);
    const depth = Math.min(1, ff.vignetteDepth * vigMul);
    const onset = VIGNETTE_ONSET_MAX - (VIGNETTE_ONSET_MAX - VIGNETTE_ONSET_MIN) * depth;
    const edgeAlpha = VIGNETTE_MIN_ALPHA + (VIGNETTE_MAX_ALPHA - VIGNETTE_MIN_ALPHA) * depth;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const vg = ctx.createRadialGradient(cx, cy, outerR * onset, cx, cy, outerR);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${edgeAlpha.toFixed(3)})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Fever aura: above the threshold, the screen edges glow inward -- an
   *  inverse vignette (bright at the rim, clear toward center) so a hot
   *  streak visibly ignites the whole frame, not just Midio and the
   *  highway. Silent below FEVER_AURA_THRESHOLD; ramps to FEVER_AURA_MAX_ALPHA
   *  at fever=1. Tinted toward the current biome halo color so it reads as
   *  part of the world rather than a generic UI glow. */
  _drawFeverAura(ctx, canvas, fever, biomeManager, reducedFlash) {
    if (fever <= FEVER_AURA_THRESHOLD) return;
    const u = (fever - FEVER_AURA_THRESHOLD) / (1 - FEVER_AURA_THRESHOLD);
    const alpha = capFlashAlpha(FEVER_AURA_MAX_ALPHA * u, reducedFlash);
    if (alpha <= 0.002) return;
    const haloHex = biomeManager && biomeManager.currentHaloColor ? biomeManager.currentHaloColor() : '#ffd76a';
    const { r, g, b } = hexToRgb(haloHex);
    const rgb = `${r},${g},${b}`;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const outerR = Math.hypot(cx, cy);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(cx, cy, outerR * 0.55, cx, cy, outerR);
    grad.addColorStop(0, `rgba(${rgb},0)`);
    grad.addColorStop(1, `rgba(${rgb},${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Drop impact pack: a brief RGB-split shock (two color-isolated copies of
   *  the already-composited frame, nudged apart on the 'lighter' blend --
   *  same self-blit family as the hype echo and the lake reflection) plus
   *  radial speed-lines thrown from Midio. Both live only for
   *  DROP_IMPACT_LIFE_MS after hype.dropAtMs, and both skip entirely once
   *  PerfGovernor has shed particle budget -- this is squarely a "budget
   *  allowing" flourish, not core feedback. */
  _drawDropImpact(ctx, canvas, sim, pose) {
    const hype = sim.hype;
    const s = dropImpactStrength(sim.timeMs, hype.dropAtMs);
    if (s <= 0) return;
    const perf = sim.perf;
    if (perf && perf.particleMul < 1) return;
    const reducedFlash = !!sim.reducedFlash;

    // Chromatic shock.
    if (!this._shockCanvas) {
      this._shockCanvas = document.createElement('canvas');
    }
    const off = this._shockCanvas;
    if (off.width !== canvas.width || off.height !== canvas.height) {
      off.width = canvas.width;
      off.height = canvas.height;
    }
    const offCtx = off.getContext('2d');
    // Reduced-flash halves the pixel split too -- what's left reads as
    // motion blur, not a flash, which is the whole point of the toggle.
    const offsetPx = (reducedFlash ? 0.5 : 1) * SHOCK_MAX_OFFSET_PX * s;
    const shockAlpha = capFlashAlpha(SHOCK_MAX_ALPHA * s, reducedFlash);
    for (const [color, dir] of [['rgba(255,60,60,1)', 1], ['rgba(60,220,255,1)', -1]]) {
      offCtx.globalCompositeOperation = 'copy';
      offCtx.drawImage(canvas, 0, 0);
      offCtx.globalCompositeOperation = 'multiply';
      offCtx.fillStyle = color;
      offCtx.fillRect(0, 0, off.width, off.height);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = shockAlpha;
      ctx.drawImage(off, dir * offsetPx, 0);
      ctx.restore();
    }

    // Radial speed-lines from Midio.
    const count = Math.max(6, Math.round(SPEED_LINE_COUNT * (perf ? perf.particleMul : 1)));
    const maxR = Math.hypot(canvas.width, canvas.height) * 0.42;
    const cx = pose.midioDrawX, cy = sim.midio.groundY - 60;
    const segs = speedLineSegments(cx, cy, count, s, hype.dropCount, maxR);
    const lineAlpha = capFlashAlpha(SPEED_LINE_MAX_ALPHA * s, reducedFlash);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,255,255,${lineAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const seg of segs) {
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(seg.x1, seg.y1);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Bloom: light-bleed over the whole composed frame. Downsample (a cheap
   *  blur for free and ~DOWNSCALE^2 less fill), crush to highlights via a
   *  self-multiply threshold (near-white sources survive, midtones/darks
   *  don't), blur, add back additively at a music-reactive strength -- the
   *  same self-blit + filter-blur + 'lighter' toolkit as the hype echo,
   *  chromatic shock, and lake reflection, just chained into one pipeline.
   *  Naturally tinted by whatever was bright: gold glow bleeds gold,
   *  aurora bleeds green. Sheds under PerfGovernor pressure like the drop
   *  impact pack (a budget-allowing flourish, not core feedback). */
  _drawBloom(ctx, canvas, sim) {
    const perf = sim.perf;
    if (perf && !perf.bloomEnabled) return;
    const strength = bloomStrength(sim.hype, sim.fever, !!sim.reducedFlash, sim.opening ? sim.opening.gain : 1);
    if (strength <= 0.005) return;

    const wSmall = Math.max(1, Math.round(canvas.width / BLOOM_DOWNSCALE));
    const hSmall = Math.max(1, Math.round(canvas.height / BLOOM_DOWNSCALE));
    if (!this._bloomA) this._bloomA = document.createElement('canvas');
    if (!this._bloomB) this._bloomB = document.createElement('canvas');
    const a = this._bloomA, b = this._bloomB;
    if (a.width !== wSmall || a.height !== hSmall) { a.width = wSmall; a.height = hSmall; }
    if (b.width !== wSmall || b.height !== hSmall) { b.width = wSmall; b.height = hSmall; }
    const actx = a.getContext('2d');
    const bctx = b.getContext('2d');

    // 1) Downsample the fully composed frame into the small buffer.
    actx.globalCompositeOperation = 'copy';
    actx.globalAlpha = 1;
    actx.drawImage(canvas, 0, 0, wSmall, hSmall);

    // 2) Highlight extraction: self-multiply squares every channel each
    // pass (0.9 -> 0.81 -> 0.66; 0.5 -> 0.25 -> 0.06; 0.2 -> 0.04 -> 0.002),
    // a cheap threshold with no per-pixel JS.
    actx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < BLOOM_THRESHOLD_PASSES; i++) actx.drawImage(a, 0, 0);

    // 3) Blur the highlights.
    bctx.clearRect(0, 0, wSmall, hSmall);
    bctx.globalCompositeOperation = 'copy';
    bctx.filter = `blur(${BLOOM_BLUR_PX}px)`;
    bctx.drawImage(a, 0, 0);
    bctx.filter = 'none';

    // 4) Add the blurred highlights back onto the real frame, upscaled --
    // the upscale itself softens the bloom further, which is the point.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = strength;
    ctx.drawImage(b, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Modernized 8-bit retro filter: downsamples the fully composed frame to
   *  a coarse pixel grid (nearest-neighbor, no smoothing -- the pixelation
   *  itself), quantizes every pixel to a limited retro palette (cheap,
   *  since it runs on the small downsampled buffer rather than the full-res
   *  frame -- coarser pixelation is CHEAPER, not more expensive, unlike
   *  bloom/blur passes), then draws it back upscaled with a faint scanline
   *  overlay for the CRT "nostalgia machine" read. Same offscreen-canvas
   *  pattern as _drawBloom above. */
  _drawRetroFilter(ctx, canvas) {
    const gridW = pixelGridWidth(canvas.width);
    const gridH = pixelGridHeight(canvas.width, canvas.height, gridW);
    if (!this._retroSmall) this._retroSmall = document.createElement('canvas');
    const small = this._retroSmall;
    if (small.width !== gridW || small.height !== gridH) { small.width = gridW; small.height = gridH; }
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.clearRect(0, 0, gridW, gridH);
    sctx.drawImage(canvas, 0, 0, gridW, gridH);

    const imgData = sctx.getImageData(0, 0, gridW, gridH);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const p = nearestPaletteColor(data[i], data[i + 1], data[i + 2]);
      data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2];
    }
    sctx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = SCANLINE_ALPHA;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < canvas.height; y += SCANLINE_PERIOD_PX) ctx.fillRect(0, y, canvas.width, Math.ceil(SCANLINE_PERIOD_PX / 2));
    ctx.restore();
  }

  /** The energy frame: a thin border that breathes with the track, slams on
   * kicks, and echoes the whole frame during a drop surge. Calm sections
   * nearly extinguish the idle rim and kick strobe (see hypeFrameStyle) so
   * quiet music doesn't flash the edges. */
  _drawHypeFrame(ctx, canvas, sim) {
    const hype = sim.hype;
    const color = sim.biomes && sim.biomes.currentHaloColor ? sim.biomes.currentHaloColor() : '#ffffff';
    const calmLevel = sim.calm ? sim.calm.level : 0;
    const style = hypeFrameStyle(hype, calmLevel);

    // Frame echo: on hard hits the previous frame ghosts outward once.
    // The Reel: reduced-flash disables it outright (a rapid self-blit
    // ghost is exactly the kind of flash the toggle exists to remove).
    // Calm also kills most of the echo via hypeFrameStyle.
    const echo = sim.reducedFlash ? 0 : style.echo;
    if (echo > 0.05 && (sim.perf ? sim.perf.heavyPostFx : true)) {
      const off = 3 + 5 * echo;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 * echo;
      ctx.drawImage(canvas, this._echoFlip ? off : -off, 0);
      ctx.restore();
      this._echoFlip = !this._echoFlip;
    }

    if (style.alpha < 0.02) return; // fully calm, no rim stroke
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.globalAlpha = style.alpha;
    ctx.lineWidth = style.lineWidth;
    const inset = style.inset;
    ctx.beginPath();
    ctx.roundRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, 14);
    ctx.stroke();
    ctx.restore();
  }

  _drawFallbackSky(ctx, canvas) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#1a1a3e');
    g.addColorStop(1, '#4a3b6b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _drawGround(ctx, canvas, pose, groundY) {
    ctx.fillStyle = '#2b2145';
    ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    const spacing = 60;
    const offset = ((pose.worldX % spacing) + spacing) % spacing;
    ctx.beginPath();
    for (let x = -offset; x < canvas.width; x += spacing) {
      ctx.moveTo(x, groundY);
      ctx.lineTo(x + 20, groundY);
    }
    ctx.stroke();
  }

  /** One contact-shadow ellipse. 'multiply' darkens whatever terrain color
   *  sits underneath instead of flattening it to a fixed gray. */
  _drawContactShadow(ctx, s) {
    if (s.alpha <= 0.002 || s.rx <= 0.5) return;
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#0a0a12';
    ctx.beginPath();
    ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawMidio(ctx, pose, performer, tSec = 0, melt = 0, apotheosis = null, reducedFlash = false, baseHue = MIDIO_BASE_HUE, ensemble = null) {
    const flash = performer ? performer.goldFlash : 0;
    const blink = performer ? performer.blinkScale : 1;
    const apoProgress = apotheosis ? apotheosis.progress : 0;
    // A slow ambient breath plus a quick kick-synced swell -- the same
    // "always slightly alive" pulse that makes Midasus's core read as an
    // instrument rather than a static glyph.
    const breatheBeatFlash = performer ? performer.beatFlash : 0;
    // Shared build-up swell (EnsembleDirector.swell): during a crescendo,
    // beat-phased with the same Kuramoto clock Broshi/Midasus read too, so
    // the trio visibly swells together rather than each pulsing in
    // isolation. 1 (no-op) outside a build-up.
    const swell = ensemble ? ensemble.swell(0) : 1;
    const breathe = (1 + 0.025 * Math.sin(tSec * 2.4) + 0.05 * breatheBeatFlash) * swell;
    const transform = {
      tx: pose.midioDrawX, ty: pose.midioY,
      rot: (pose.leanDeg * Math.PI) / 180,
      scaleX: pose.scaleX * MIDIO_DRAW_SCALE * breathe * (1 + 0.25 * apoProgress),
      scaleY: pose.scaleY * MIDIO_DRAW_SCALE * breathe * (1 + 0.25 * apoProgress),
      // Rare shared transition tumble (see EnsembleDirector.maybeTumble) --
      // 0 outside of a move, so this is a no-op almost all the time.
      rotX: ensemble ? ensemble.rotX(0) : 0,
      rotY: ensemble ? ensemble.rotY(0) : 0,
    };
    // Midasus style: he wears his eased spectral key-hue (baseHue); the
    // milestone gold flash still ignites him toward gold (48) on top of it.
    const hue = flash > 0 ? easeHueDeg(baseHue, 48, flash) : baseHue;
    // Pale, bright, wider spectral spread -- the same "pale, never candy"
    // treatment Midasus's core uses, not the old narrow near-white gold.
    // The Apotheosis widens the hue band further into a full rim sweep.
    const dials = this._styleDials || styleDials('classic');
    // Match Broshi's clean wireframe language — no soft hull fill (it turned
    // Midio into a smeared white blob over the glyph).
    const options = {
      satBase: 32 + flash * 40 + 18 * apoProgress,
      lightBase: 72 + flash * 12 + 8 * apoProgress,
      hueSpread: 28 + 46 * apoProgress,
      widthBase: dials.widthBase,
      widthGlow: dials.widthGlow,
      rimAmount: dials.rimAmount,
      softFill: false,
      softFillAlpha: 0,
    };
    const outlineOpts = { widthAdd: dials.outlineWidthAdd };

    // Modal vibration: rim vertices ride the performer's ring-down field.
    // Rest lengths stay the undisplaced ones, so the wobble reads as edge
    // deformation and lights up the glow automatically. Below the morph
    // threshold this stays on the original 9-rim MIDIO_BODY untouched;
    // the Apotheosis swaps in the 18-rim folded/unfolded blend, whose own
    // lengthening edges (relative to the FOLDED rest lengths) add the
    // unfolding glow on top of the modal one.
    const hub = MIDIO_BODY.vertices[0];
    const bodyBase = apoProgress > 0.001 ? lerpMesh(MIDIO_APOTHEOSIS_FOLDED, MIDIO_APOTHEOSIS_UNFOLDED, apoProgress) : MIDIO_BODY;
    const bodyRest = apoProgress > 0.001 ? this._apoBodyRest : this._midioBodyRest;
    const bodyMesh = meltMesh(
      displaceMeshRadial(bodyBase, hub.x, hub.y, performer ? performer.modal : null),
      hub.x, hub.y, tSec, melt, 1,
    );

    // Stellar under-glow (Midasus's own trick): a blurred, larger, additive
    // copy of the body drawn first so he reads like an instrument catching
    // light, not a flat outline -- brighter on fever and right on the beat.
    const excitement = clamp01(melt / 8); // vibe/fever/apotheosis "melt" doubles as how hard he's glowing
    const glowAlpha = capFlashAlpha(
      (0.14 + 0.22 * excitement + 0.28 * breatheBeatFlash) * dials.glowHaloMul,
      reducedFlash,
    );
    if (glowAlpha > 0.02) {
      const glowCenter = applyTransform(hub, transform);
      drawGlowHalo(
        ctx, glowCenter.x, glowCenter.y,
        24 * transform.scaleX, 30 * transform.scaleY,
        hue, glowAlpha, { sat: 38, light: 74 },
      );
    }
    // The crisp pass carries an ink contour underneath so his silhouette
    // stays razor-edged against his own under-glow (and soft sculpted fill).
    drawMeshPart(ctx, bodyMesh, bodyRest, transform, hue, { ...options, outline: outlineOpts });

    if (blink < 0.98) {
      const blinkEye = {
        vertices: MIDIO_EYE.vertices.map((v) => ({ x: v.x, y: MIDIO_EYE_CY + (v.y - MIDIO_EYE_CY) * blink })),
        edges: MIDIO_EYE.edges,
      };
      drawMeshPart(ctx, blinkEye, this._midioEyeRest, transform, hue, { ...options, outline: outlineOpts });
    } else {
      drawMeshPart(ctx, MIDIO_EYE, this._midioEyeRest, transform, hue, { ...options, outline: outlineOpts });
    }

    // Kick ignition: the sigil flashes additively right on the beat.
    const beatFlash = performer ? performer.beatFlash : 0;
    if (beatFlash > 0.03) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawMeshPart(ctx, bodyMesh, this._midioBodyRest, transform, hue, {
        alpha: capFlashAlpha(0.65 * beatFlash, reducedFlash), satBase: 70, lightBase: 74, widthBase: 2.4,
      });
      ctx.restore();
    }

    // Hold-slide charge: beatFlash's additive shape, but sustained — it
    // lights when a hold arms and brightens with every paid tick.
    const holdGlow = performer ? performer.holdGlow : 0;
    if (holdGlow > 0.03) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawMeshPart(ctx, bodyMesh, this._midioBodyRest, transform, hue, {
        alpha: capFlashAlpha(0.5 * holdGlow, reducedFlash), satBase: 80, lightBase: 70, widthBase: 2.0,
      });
      ctx.restore();
    }
  }

  /** Motion-streak ghosts trailing a fast jump (follow-up item 6). */
  _drawMidioAfterimages(ctx, performer, midioX, baseHue = MIDIO_BASE_HUE) {
    const frames = performer.afterimages;
    const n = frames.length;
    if (n === 0) return;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      const alpha = 0.28 * ((i + 1) / n);
      ctx.globalAlpha = alpha;
      drawMeshPart(ctx, MIDIO_MESH, this._midioRestLengths, {
        tx: midioX, ty: f.y, rot: (f.rot * Math.PI) / 180,
        scaleX: f.scaleX * MIDIO_DRAW_SCALE, scaleY: f.scaleY * MIDIO_DRAW_SCALE,
      }, baseHue, { alpha: 1, satBase: 22, lightBase: 64, hueSpread: 24 });
    }
    ctx.restore();
  }

  /** Apotheosis-only: gold, beat-quantized afterimages (captured on every
   * kick while transformed, independent of MidioPerformer's airborne-only
   * trick-jump streaks above). */
  _drawGoldAfterimages(ctx, performer, midioX, nowMs) {
    const frames = performer.goldAfterimages;
    if (!frames.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of frames) {
      const age = clamp01((nowMs - f.bornMs) / GOLD_AFTERIMAGE_LIFE_MS);
      const alpha = 0.4 * (1 - age);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      drawMeshPart(ctx, MIDIO_MESH, this._midioRestLengths, {
        tx: midioX, ty: f.y, rot: (f.rot * Math.PI) / 180,
        scaleX: f.scaleX * MIDIO_DRAW_SCALE, scaleY: f.scaleY * MIDIO_DRAW_SCALE,
      }, 46, { alpha: 1, satBase: 85, lightBase: 68, hueSpread: 10 });
    }
    ctx.restore();
  }
}

/**
 * Music-reactive bloom strength: a small steady base (a lit scene always
 * catches a little light, not a flash -- never capped by reduced-flash)
 * plus a reactive swell from the same signals that already throw the drop
 * shockwave and the fever aura (HypeDirector.slam/surge, FeverMeter.level).
 * Only the reactive term runs through capFlashAlpha, so reduced-flash tames
 * the pulsing on drops/kicks while the base glow stays intact. Clamped to
 * BLOOM_MAX so a maxed-out drop-during-fever never blows the frame out.
 */
export function bloomStrength(hype, fever, reducedFlash = false, openingGain = 1) {
  const slam = hype ? hype.slam : 0;
  const surge = hype ? hype.surge : 0;
  const feverLevel = fever ? fever.level : 0;
  const reactive = capFlashAlpha(0.45 * slam + 0.35 * surge + 0.3 * feverLevel, reducedFlash);
  // The base glow is unconditional, which meant a song fading in from silence
  // still opened on a fully bloomed frame -- the single loudest thing on
  // screen at t=0, and the one least justified by anything audible.
  // OpeningDirector's gain scales it until the song has actually started.
  return Math.min(BLOOM_MAX, BLOOM_BASE * openingGain + reactive);
}

/** Drop impact envelope: 1 right at the drop, easing to 0 over
 *  DROP_IMPACT_LIFE_MS. 0 before the drop or once it's long past --
 *  dropAtMs starts at -Infinity (HypeDirector), so "no drop yet" is 0 too. */
export function dropImpactStrength(nowMs, dropAtMs) {
  const age = nowMs - dropAtMs;
  if (!(age >= 0) || age >= DROP_IMPACT_LIFE_MS) return 0;
  const u = age / DROP_IMPACT_LIFE_MS;
  return (1 - u) * (1 - u); // ease-out: sharp at the hit, tapering fast
}

/** `count` line segments radiating from (cx, cy), angles fixed per `seed`
 *  (a drop's own dropCount, so repeat drops don't all fan out identically),
 *  each spanning [0.55, 0.75+0.25*s] of maxR -- pure and deterministic so
 *  it's cheaply testable without a canvas. */
export function speedLineSegments(cx, cy, count, s, seed, maxR) {
  const segs = [];
  const jitterBase = seed * 2.399963; // irrational-ish stride so lines don't repeat between drops
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + jitterBase;
    const rInner = 0.55 * maxR;
    const rOuter = (0.75 + 0.25 * s) * maxR;
    segs.push({
      x0: cx + Math.cos(a) * rInner, y0: cy + Math.sin(a) * rInner,
      x1: cx + Math.cos(a) * rOuter, y1: cy + Math.sin(a) * rOuter,
    });
  }
  return segs;
}
