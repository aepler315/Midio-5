// Range v2 presentation boundary (plan §6.2, §7.4). Owns the choice between
// the GPU scene and the legacy painters for each frame, the song's scene
// assignments, the frame snapshot, and the synchronous copy of each GPU
// partition into the authoritative main canvas at its pass boundary. It
// never owns simulation.
//
// Modes: ?rangeRenderer=v2 opts in (legacy stays the default until rollout);
// ?rangeView=<id> forces one catalog view for every biome, candidates
// included, and marks the frame forcedCandidate. Any failure -- no WebGL2,
// context loss, 404, bad manifest, decode error, budget denial, stale
// generation -- takes the legacy path for that frame with a recorded
// reason; the cast and music never wait on the GPU.
import { travelSpans } from '../TravelSeam.js';
import { buildRangeFrame, viewportState } from './RangeFrame.js';
import { forcedSceneChoice } from '../terrain/SceneCatalog.js';
import SCENE_CATALOG from '../terrain/sceneCatalogData.js';
import { noteViewShown } from '../terrain/RangeHistory.js';

export const RANGE_RENDERER_MODES = Object.freeze(['legacy', 'v2']);
const ASSET_BASE = new URL('../../assets/range/v2/', import.meta.url).href;
const RUNTIME_URL = new URL('../../vendor/range/three-range.module.js', import.meta.url).href;

/** ?rangeRenderer=v2|legacy and ?rangeView=<id>. Default legacy. */
export function resolveRangeMode(search = (typeof location !== 'undefined' ? location.search : '')) {
  try {
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const raw = (q.get('rangeRenderer') || 'legacy').toLowerCase();
    const forcedViewId = q.get('rangeView') || null;
    const diag = q.get('rangeDiag') === 'markers' ? 'markers' : null;
    return { mode: RANGE_RENDERER_MODES.includes(raw) ? raw : 'legacy', forcedViewId, diag };
  } catch {
    return { mode: 'legacy', forcedViewId: null, diag: null };
  }
}

/** Which legacy range layer's travel timing each partition follows. */
const PASS_LAYER = { far: 'L2', mid: 'L4', near: 'L5' };

/** Heard seconds over which a view that finishes preparing after legacy
 *  scenery was already on screen fades in over it, instead of replacing the
 *  painted ranges in one frame. */
export const ARRIVAL_SEC = 1.2;

/** Residency key of the travel composition buffer (one stage-sized canvas
 *  the two sides are blended in before the single copy to the stage). */
export const TRAVEL_SCRATCH_KEY = 'range:travel-scratch';

const fade01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

function defaultCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export class RangePresentation {
  constructor({ mode = 'legacy', forcedViewId = null, diag = null, residency = null, budget = 'desktop',
    loadRuntime = () => import(RUNTIME_URL), sceneFactory = null, catalog = SCENE_CATALOG, assetBase = ASSET_BASE,
    makeCanvas = defaultCanvas } = {}) {
    this.mode = mode;
    this.forcedViewId = forcedViewId;
    this.diag = diag;
    this.residency = residency;
    this.budget = budget;
    this.catalog = catalog;
    this.assetBase = assetBase;
    this._loadRuntime = loadRuntime;
    this._sceneFactory = sceneFactory;
    this._makeCanvas = makeCanvas;
    this.exportMode = false;
    // Travel: the composition buffer and the incoming side's own fade-in
    // (a view that becomes ready after the travel has started).
    this._scratch = null;
    this._scratchBytes = 0;
    this._incomingJoin = null; // { id, tSec } | null
    this.incomingFade = 1;
    this._handoff = null; // { outgoing, incoming } views while a late join fades
    this._waitedFor = null; // incoming view id a travel frame drew without
    this.scene = null;
    this.runtimeState = mode === 'v2' ? 'idle' : 'off'; // idle | loading | ready | failed | off
    this.generation = 0;
    this.sceneByBiome = null;
    this.forced = forcedViewId ? forcedSceneChoice(catalog, forcedViewId) : null;
    this.frame = null;
    this.frameInputs = null;
    this.active = false;
    this.reason = mode === 'v2' ? 'not-started' : 'legacy-mode';
    this.failures = new Map(); // viewId -> reason (not retried this generation)
    this.shown = new Set();
    this.frameId = 0;
    this.timings = { lastCopyMs: 0, lastPartitionMs: 0 };
    // Arrival fade (ARRIVAL_SEC): 1 = the GPU scene fully replaces legacy.
    this.arrival = 1;
    this._legacyShown = false;
    this._arrivalStartSec = null;
  }

  /** True while the scene is fading in over legacy scenery that is still
   *  drawn underneath it. */
  get arriving() { return this.active && this.arrival < 1; }

  get enabled() { return this.mode === 'v2'; }

  /** A new song (or world): new generation, new assignments. Pending work
   *  of the previous generation is cancelled; its late results never land. */
  setSong({ terrain = null, generation = this.generation + 1, exportMode = false } = {}) {
    const previous = this.generation;
    this.generation = generation;
    // Export draws frames on request and waits for readiness: never fades,
    // never counts as the listener having seen a view.
    this.exportMode = !!exportMode;
    this._incomingJoin = null;
    this.incomingFade = 1;
    this._handoff = null;
    this._waitedFor = null;
    this.sceneByBiome = terrain?.sceneByBiome || null;
    this.failures.clear();
    this.shown.clear();
    this.arrival = 1;
    this._legacyShown = false;
    this._arrivalStartSec = null;
    // Views the new song still wants move to its generation before the old
    // one is cancelled; everything else of the old song is released.
    const keep = new Set(this._wantedViewIds());
    if (this.scene) {
      for (const [id, p] of [...this.scene.prepared]) {
        if (keep.has(id)) {
          p.generation = generation;
          this.residency?.retag(p.gpuKey, generation);
          this.residency?.retag(p.cpuKey, generation);
        } else this.scene.release(id);
      }
    }
    if (this.residency && previous && previous !== generation) this.residency.cancelGeneration(previous);
  }

  _choiceFor(biome) {
    if (this.forced) return this.forced;
    return this.sceneByBiome?.get?.(biome) || null;
  }

  /** The view a biome's caption should name, when v2 will draw it. */
  captionViewFor(biome) {
    if (!this.enabled || this.runtimeState === 'failed') return null;
    const v = this._choiceFor(biome)?.view;
    return v && !this.failures.has(v.id) ? v : null;
  }

  /** Whether v2 is expected to draw this biome's scenery, so the legacy
   *  strip set for it is only a fallback and need not be baked ahead. */
  coversBiome(biome) {
    return !!this.captionViewFor(biome);
  }

  _wantedViewIds() {
    if (this.forced?.view) return [this.forced.view.id];
    return [...(this.sceneByBiome?.values?.() || [])].map((c) => c?.view?.id).filter(Boolean);
  }

  async _ensureRuntime() {
    if (this.runtimeState !== 'idle') return;
    this.runtimeState = 'loading';
    try {
      if (this._sceneFactory) this.scene = await this._sceneFactory();
      else {
        const THREE = await this._loadRuntime();
        const { RangeScene } = await import('./RangeScene.js');
        this.scene = new RangeScene({ THREE, residency: this.residency, budget: this.budget, diag: this.diag });
      }
      this.runtimeState = 'ready';
    } catch (err) {
      this.runtimeState = 'failed';
      this.reason = `runtime-unavailable: ${err?.message || err}`;
      this._availabilityChanged();
      console.warn('[range v2] renderer unavailable; legacy Range continues', err);
    }
  }

  _prepare(view) {
    if (!this.scene || this.failures.has(view.id) || this.scene.isReady(view.id)) return;
    const gen = this.generation;
    this.scene.prepare(view, { generation: gen, baseUrl: this.assetBase, isCurrent: (g) => g === this.generation })
      .catch((err) => {
        if (gen !== this.generation) return; // stale: the new song decides again
        const reason = err?.reason ? `${err.reason}: ${err.message}` : String(err?.message || err);
        this.failures.set(view.id, reason);
        console.warn(`[range v2] ${view.id} unavailable; legacy Range for its sections`, err);
        this._availabilityChanged();
      });
  }

  /** A view (or the renderer) became unavailable: whoever named scenic
   *  views in captions rebuilds them, so a legacy fallback is never
   *  credited as the scenic location. */
  _availabilityChanged() {
    try { this.onAvailabilityChange?.(); } catch (err) { console.warn('[range v2] caption refresh failed', err); }
  }

  /** Resolves once every view this song needs is prepared or has failed
   *  (evidence/export use this; live playback never waits on it). */
  async whenReady({ timeoutMs = 60000 } = {}) {
    if (!this.enabled) return this.snapshot();
    if (this.runtimeState === 'idle') await this._ensureRuntime();
    else while (this.runtimeState === 'loading') await new Promise((r) => setTimeout(r, 20));
    if (this.runtimeState !== 'ready') return this.snapshot();
    const views = this.forced?.view ? [this.forced.view]
      : [...(this.sceneByBiome?.values?.() || [])].map((c) => c?.view).filter(Boolean);
    const unique = [...new Map(views.map((v) => [v.id, v])).values()];
    const deadline = Date.now() + timeoutMs;
    for (const v of unique) this._prepare(v);
    while (Date.now() < deadline && unique.some((v) => !this.scene.isReady(v.id) && !this.failures.has(v.id))) {
      await new Promise((r) => setTimeout(r, 25));
    }
    return this.snapshot();
  }

  /** Renderer: this frame's inputs, before BiomeManager.draw. */
  setFrameInputs({ sim, pose, scenicViewport, groundViewport }) {
    this.frameInputs = { sim, pose, scenicViewport, groundViewport };
  }

  /**
   * BiomeManager (alpine path), once light and air are resolved: decide
   * whether the GPU scene draws the scenic partitions this frame.
   */
  beginScenic() {
    const ok = this._beginScenic();
    // A legacy frame draws no view: release the previous frame's pins so a
    // destination (or a legacy strip fallback) may evict what is no longer
    // on screen.
    if (!ok) {
      this.residency?.pin?.([]);
      this.scene?.releaseSide?.('B');
      this._releaseScratch();
      this._handoff = null;
    }
    this._updateArrival(ok);
    return ok;
  }

  /**
   * Legacy -> GPU scene handoff mid-song (a view that finished preparing
   * after the opening, or a section after a legacy one): fade in over
   * ARRIVAL_SEC of heard time. Pure in heard time within one arrival --
   * pause holds it, a seek before its start completes it -- and an export
   * (which waits for readiness) never fades.
   */
  _updateArrival(ok) {
    const sim = this.frameInputs?.sim;
    const tSec = Number(sim?.biomes?.tSec);
    if (!ok) {
      this.arrival = 1;
      this._arrivalStartSec = null;
      // Only a frame that drew legacy scenery for an enabled v2 counts.
      if (this.enabled && sim?.biomes) this._legacyShown = true;
      return;
    }
    if (this.exportMode || sim?.exportMode || !Number.isFinite(tSec)) {
      this.arrival = 1;
      this._legacyShown = false;
      this._arrivalStartSec = null;
      return;
    }
    if (this._legacyShown) {
      this._legacyShown = false;
      this._arrivalStartSec = tSec;
    }
    if (this._arrivalStartSec == null) { this.arrival = 1; return; }
    const u = (tSec - this._arrivalStartSec) / ARRIVAL_SEC;
    if (u < 0 || u >= 1) {
      this.arrival = 1;
      this._arrivalStartSec = null;
      return;
    }
    this.arrival = u * u * (3 - 2 * u);
  }

  _beginScenic() {
    this.active = false;
    this.incomingViewId = null;
    this.frame = null;
    if (!this.enabled) { this.reason = 'legacy-mode'; return false; }
    if (this.runtimeState === 'idle') this._ensureRuntime();
    if (this.runtimeState !== 'ready') { this.reason = this.runtimeState === 'failed' ? this.reason : 'runtime-loading'; return false; }
    const inputs = this.frameInputs;
    if (!inputs?.sim?.biomes) { this.reason = 'no-frame-inputs'; return false; }
    const mgr = inputs.sim.biomes;
    const blend = mgr.currentBlend || {};
    const name = (p) => (typeof p === 'string' ? p : p?.name ?? null);
    const from = this._choiceFor(name(blend.from) ?? mgr.sections?.[0]?.profile?.name);
    const to = this._choiceFor(name(blend.to) ?? name(blend.from));
    for (const c of [from, to]) if (c?.view) this._prepare(c.view);
    if (!from?.view) { this.reason = from?.fallbackReason || 'no-view-assigned'; return false; }
    // A destination without a view (partial catalog coverage) is legacy
    // scenery: the blend toward it, and the section after it, draw legacy.
    const t = blend.t ?? 1;
    const blending = t > 0 && t < 1 && to !== from;
    if (blending && !to?.view) { this.reason = 'transition-legacy'; return false; }
    if (t >= 1 && !to?.view) { this.reason = to?.fallbackReason || 'no-view-assigned'; return false; }
    // View-to-view travel: the outgoing view stays valid for the whole
    // blend and the incoming one joins through the travel seam once it is
    // prepared -- a cancelled, failed or still-loading incoming view simply
    // leaves the outgoing one drawing, never a legacy flash.
    let view, incoming = null;
    if (blending && to.view.id !== from.view.id) {
      view = from.view;
      if (!this.failures.has(to.view.id) && this.scene.isReady(to.view.id)) incoming = to.view;
      // A frame of this travel drew the outgoing view alone: when the
      // incoming one does join, it joins late and fades in.
      else this._waitedFor = to.view.id;
    } else {
      view = t >= 1 ? to.view : from.view;
    }
    // A view that joined late and is still fading in when the travel ends
    // keeps the A/B handoff (seam fully across, B at its fade) until the fade
    // completes, instead of replacing A in one frame.
    let holding = false;
    const hold = this._handoff;
    const join = this._incomingJoin;
    const tNow = Number(inputs.sim.biomes.tSec);
    const fading = !!join && join.id === hold?.incoming.id && tNow >= join.tSec && tNow - join.tSec < ARRIVAL_SEC;
    if (!incoming && hold && fading && view.id === hold.incoming.id && hold.outgoing.id !== view.id
      && !this.failures.has(hold.outgoing.id) && this.scene.isReady(hold.outgoing.id)) {
      incoming = view;
      view = hold.outgoing;
      holding = true;
    }
    if (this.failures.has(view.id)) { this.reason = this.failures.get(view.id); return false; }
    if (!this.scene.isReady(view.id)) { this.reason = this.scene.contextLost ? 'context-lost' : 'preparing'; return false; }
    // What this frame draws stays resident (never evicted mid-use) -- pinned
    // before any reservation below, which may evict unpinned entries.
    const vp = inputs.scenicViewport;
    this.scene.pinView?.(incoming ? [view.id, incoming.id] : view.id, [TRAVEL_SCRATCH_KEY]);
    try {
      this.scene.resize({ widthPx: vp.backingWidth, heightPx: vp.backingHeight, pixelRatio: vp.pixelRatio || 1 });
    } catch (err) {
      this.reason = `budget: ${err.message}`;
      return false;
    }
    // The incoming side needs its own target and a composition buffer,
    // reserved before they exist; without room the outgoing view carries on
    // alone.
    if (incoming && !(this.scene.ensureSide?.('B') && this._ensureScratch(vp))) {
      // A frame drew the outgoing view alone: if room appears later in this
      // travel, the incoming view joins late and fades in.
      this._waitedFor = incoming.id;
      incoming = null;
    }
    if (!incoming) {
      this.scene.releaseSide?.('B');
      this._releaseScratch();
    }
    this.incomingViewId = incoming?.id ?? null;
    this.seamP = holding ? 1 : blend.travel ? (blend.travelP ?? t) : t;
    this._updateIncomingFade(incoming, inputs.sim);
    this._handoff = incoming && this.incomingFade < 1 ? { outgoing: view, incoming } : null;
    this.scene.pinView?.(incoming ? [view.id, incoming.id] : view.id, incoming ? [TRAVEL_SCRATCH_KEY] : []);
    this.frame = buildRangeFrame({
      frameId: ++this.frameId, generation: this.generation, sim: inputs.sim, pose: inputs.pose,
      scenicViewport: inputs.scenicViewport, groundViewport: inputs.groundViewport,
      sceneAssignments: this.sceneByBiome, forcedView: this.forced,
    });
    this.viewId = view.id;
    this.active = true;
    this.reason = null;
    if (!this.shown.has(view.id) && !this.forced && !this.exportMode && !inputs.sim.exportMode) {
      this.shown.add(view.id);
      noteViewShown(view);
    }
    return true;
  }

  /**
   * An incoming view that joins a travel already under way (it finished
   * preparing late) fades in over ARRIVAL_SEC of heard time instead of
   * appearing at the current seam in one frame. Joining before the seam has
   * entered the frame needs no fade; an export never fades.
   */
  _updateIncomingFade(incoming, sim) {
    const tSec = Number(sim?.biomes?.tSec);
    if (!incoming || this.exportMode || sim?.exportMode || !Number.isFinite(tSec)) {
      this._incomingJoin = null;
      this.incomingFade = 1;
      return;
    }
    if (this._incomingJoin?.id !== incoming.id) {
      const late = this._waitedFor === incoming.id && (this.seamP ?? 0) > 0.001;
      this._incomingJoin = late ? { id: incoming.id, tSec } : { id: incoming.id, tSec: -Infinity };
      this._waitedFor = null;
    }
    const u = (tSec - this._incomingJoin.tSec) / ARRIVAL_SEC;
    this.incomingFade = u < 0 ? 1 : fade01(u);
  }

  /** The travel composition buffer: one canvas at the scenic backing size,
   *  reserved before it exists. False when the budget refuses it. */
  _ensureScratch(vp) {
    const w = Math.max(2, Math.round(vp.backingWidth)), h = Math.max(2, Math.round(vp.backingHeight));
    const bytes = w * h * 4;
    // Both dimensions must fit: a same-area but taller viewport would
    // otherwise be squashed into the stale height.
    if (this._scratch && this._scratch.width >= w && this._scratch.height >= h) return true;
    this._releaseScratch();
    let res = null;
    if (this.residency) {
      res = this.residency.reserve({ key: TRAVEL_SCRATCH_KEY, bytes, owner: 'range-targets' });
      if (!res) return false;
    }
    const canvas = this._makeCanvas(w, h);
    this._scratch = canvas;
    this._scratchBytes = bytes;
    if (res) {
      this.residency.commit(res, canvas, (c) => {
        if (this._scratch === c) { this._scratch = null; this._scratchBytes = 0; }
        c.width = 0; c.height = 0;
      });
    }
    return true;
  }

  _releaseScratch() {
    if (!this._scratch) return;
    if (this.residency) this.residency.release(TRAVEL_SCRATCH_KEY);
    this._scratch = null;
    this._scratchBytes = 0;
  }

  /** Composite one partition into `ctx` over the scenic stage, under the
   *  transform currently in effect (applied exactly once). */
  drawPartition(ctx, pass, stage) {
    if (!this.active || !this.frame) return false;
    const t0 = performance.now();
    if (this.incomingViewId) {
      // Travel between two views: each side renders into its own target and
      // is composited through the shared travel seam (TravelSeam.js), the
      // nearest partition changing first, as the legacy ranges do.
      const layerKey = PASS_LAYER[pass] || 'L3';
      const drawn = this._compositeSides(ctx, stage, layerKey,
        () => this.scene.renderPartition(this.frame, pass, this.viewId, { side: 'A' }),
        () => this.scene.renderPartition(this.frame, pass, this.incomingViewId, { side: 'B' }));
      this.timings.lastPartitionMs = performance.now() - t0;
      return drawn;
    }
    const img = this.scene.renderPartition(this.frame, pass, this.viewId);
    const t1 = performance.now();
    if (!img) return false;
    ctx.save();
    ctx.globalAlpha = this.arrival;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, 0, 0, stage.width, stage.height);
    ctx.restore();
    this.timings.lastPartitionMs = t1 - t0;
    this.timings.lastCopyMs = performance.now() - t1;
    return true;
  }

  /**
   * Blend side A (left of the seam) and side B (right of it) in the
   * composition buffer, then copy it to the stage once. Each span of the
   * seam gives B a weight w (0 left of the feather, the band's weight inside
   * it, 1 right of it; all scaled by the incoming fade): A is drawn at 1 - w,
   * then B is ADDED at w ('lighter' on premultiplied pixels), so where both
   * sides are opaque the blend stays opaque -- a plain source-over pair would
   * leave the bands up to 25% see-through. Each render returns the shared
   * drawing buffer, so A is fully drawn before B is rendered.
   */
  _compositeSides(ctx, stage, layerKey, renderA, renderB) {
    const { lo, hi, bands } = travelSpans(stage.width, layerKey, this.seamP ?? 0);
    const fadeB = this.incomingFade ?? 1;
    const far = stage.width * 2;
    const spans = [{ x0: -far, x1: lo, w: 0 }, ...bands.map((b) => ({ x0: b.x0, x1: b.x1, w: b.weightB })), { x0: hi, x1: far, w: 1 }]
      .filter((sp) => sp.x1 > sp.x0)
      .map((sp) => ({ ...sp, w: sp.w * fadeB }));
    const out = this._scratch;
    const a = renderA();
    if (!out) return false;
    // Scenic and ground images differ in size: blend in the top-left W x H
    // of the buffer (reserved at the scenic backing size, which the ground
    // image -- same scale, smaller stage -- never exceeds), so the buffer is
    // not reallocated between the two composites of one frame.
    const W = Math.min(out.width, a?.width || out.width), H = Math.min(out.height, a?.height || out.height);
    const sctx = out.getContext('2d');
    const sx = W / stage.width;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, W, H);
    const put = (img, x0, x1, alpha, op) => {
      if (!img || !(alpha > 0.001)) return;
      const cx0 = Math.max(0, x0 * sx), cx1 = Math.min(W, x1 * sx);
      if (!(cx1 > cx0)) return;
      sctx.save();
      sctx.beginPath();
      sctx.rect(cx0, 0, cx1 - cx0, H);
      sctx.clip();
      sctx.globalAlpha = Math.min(1, alpha);
      sctx.globalCompositeOperation = op;
      sctx.drawImage(img, 0, 0, W, H);
      sctx.restore();
    };
    for (const sp of spans) put(a, sp.x0, sp.x1, 1 - sp.w, 'source-over');
    const b = renderB();
    for (const sp of spans) put(b, sp.x0, sp.x1, sp.w, 'lighter');
    if (!a && !b) return false;
    ctx.save();
    ctx.globalAlpha = this.arrival;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(out, 0, 0, W, H, 0, 0, stage.width, stage.height);
    ctx.restore();
    return true;
  }

  /** Composite the rock stage under the fixed-ground transform. */
  drawGround(ctx, stage) {
    if (!this.active || !this.frame) return false;
    if (this.incomingViewId) {
      // The rock stage wears each side's material through the nearest seam;
      // its receivers (pools) come from whichever side holds the centre.
      let outA = null, outB = null;
      const drawn = this._compositeSides(ctx, stage, 'L5',
        () => (outA = this.scene.renderGround(this.frame, this.viewId))?.canvas,
        () => (outB = this.scene.renderGround(this.frame, this.incomingViewId))?.canvas);
      // Receivers (pools, wet masks) follow the side that visibly holds the
      // centre: B's seam weight there, scaled by its late-join fade.
      const { lo, hi, bands } = travelSpans(stage.width, 'L5', this.seamP ?? 0);
      const cx = stage.width / 2;
      const seamW = cx < lo ? 0 : cx >= hi ? 1 : (bands.find((b) => cx >= b.x0 && cx < b.x1)?.weightB ?? 0.5);
      const bHolds = seamW * (this.incomingFade ?? 1) >= 0.5;
      this.stage = (bHolds ? outB : outA)?.stage || outA?.stage || outB?.stage || null;
      return drawn;
    }
    const out = this.scene.renderGround(this.frame, this.viewId);
    if (!out) return false;
    ctx.save();
    ctx.globalAlpha = this.arrival;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(out.canvas, 0, 0, stage.width, stage.height);
    ctx.restore();
    this.stage = out.stage;
    return true;
  }

  /** Wet receivers for GroundResponse / reflections: exact pool polygons
   *  in fixed-ground coordinates (no rectangles). */
  groundReceivers() {
    if (!this.active || !this.stage || this.arrival < 1) return null;
    return { wetMasks: this.stage.wetMasks, litEdges: [], pools: this.stage.pools };
  }

  snapshot() {
    return {
      mode: this.mode, active: this.active, reason: this.reason, viewId: this.active ? this.viewId : null,
      forcedCandidate: !!this.forced?.forcedCandidate, forcedViewId: this.forcedViewId, diag: this.diag,
      generation: this.generation, runtime: this.runtimeState, arrival: this.arrival, incomingFade: this.incomingFade, incomingViewId: this.active ? this.incomingViewId : null, seamP: this.seamP ?? null,
      failures: Object.fromEntries(this.failures), frameId: this.frameId, progress01: this.frame?.progress01 ?? null,
      scene: this.scene?.snapshot?.() || null, residency: this.residency?.snapshot?.() || null,
      timings: { ...this.timings }, catalogVersion: this.catalog.catalogVersion,
    };
  }

  dispose() {
    this._releaseScratch();
    if (this.residency && this.generation) this.residency.cancelGeneration(this.generation);
    this.scene?.dispose();
    this.scene = null;
    this.runtimeState = this.enabled ? 'idle' : 'off';
  }
}

export { viewportState };
