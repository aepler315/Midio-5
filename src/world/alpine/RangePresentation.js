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

export class RangePresentation {
  constructor({ mode = 'legacy', forcedViewId = null, diag = null, residency = null, budget = 'desktop',
    loadRuntime = () => import(RUNTIME_URL), sceneFactory = null, catalog = SCENE_CATALOG, assetBase = ASSET_BASE } = {}) {
    this.mode = mode;
    this.forcedViewId = forcedViewId;
    this.diag = diag;
    this.residency = residency;
    this.budget = budget;
    this.catalog = catalog;
    this.assetBase = assetBase;
    this._loadRuntime = loadRuntime;
    this._sceneFactory = sceneFactory;
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
  }

  get enabled() { return this.mode === 'v2'; }

  /** A new song (or world): new generation, new assignments. Pending work
   *  of the previous generation is cancelled; its late results never land. */
  setSong({ terrain = null, generation = this.generation + 1 } = {}) {
    const previous = this.generation;
    this.generation = generation;
    this.sceneByBiome = terrain?.sceneByBiome || null;
    this.failures.clear();
    this.shown.clear();
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
    if (!ok) this.residency?.pin?.([]);
    return ok;
  }

  _beginScenic() {
    this.active = false;
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
    // Until transitions land (Task 14) a frame crossing between different
    // views stays legacy rather than cutting.
    // A destination without a view (partial catalog coverage) is legacy
    // scenery: the blend toward it, and the section after it, draw legacy.
    const t = blend.t ?? 1;
    if (t > 0 && t < 1 && to !== from && (!to?.view || to.view.id !== from.view.id)) { this.reason = 'transition-legacy'; return false; }
    if (t >= 1 && !to?.view) { this.reason = to?.fallbackReason || 'no-view-assigned'; return false; }
    const view = t >= 1 ? to.view : from.view;
    if (this.failures.has(view.id)) { this.reason = this.failures.get(view.id); return false; }
    if (!this.scene.isReady(view.id)) { this.reason = this.scene.contextLost ? 'context-lost' : 'preparing'; return false; }
    try {
      const vp = inputs.scenicViewport;
      this.scene.resize({ widthPx: vp.backingWidth, heightPx: vp.backingHeight, pixelRatio: vp.pixelRatio || 1 });
    } catch (err) {
      this.reason = `budget: ${err.message}`;
      return false;
    }
    // What this frame draws stays resident (never evicted mid-use).
    this.scene.pinView?.(view.id);
    this.frame = buildRangeFrame({
      frameId: ++this.frameId, generation: this.generation, sim: inputs.sim, pose: inputs.pose,
      scenicViewport: inputs.scenicViewport, groundViewport: inputs.groundViewport,
      sceneAssignments: this.sceneByBiome, forcedView: this.forced,
    });
    this.viewId = view.id;
    this.active = true;
    this.reason = null;
    if (!this.shown.has(view.id) && !this.forced && !inputs.sim.exportMode) {
      this.shown.add(view.id);
      noteViewShown(view);
    }
    return true;
  }

  /** Composite one partition into `ctx` over the scenic stage, under the
   *  transform currently in effect (applied exactly once). */
  drawPartition(ctx, pass, stage) {
    if (!this.active || !this.frame) return false;
    const t0 = performance.now();
    const img = this.scene.renderPartition(this.frame, pass, this.viewId);
    const t1 = performance.now();
    if (!img) return false;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, 0, 0, stage.width, stage.height);
    ctx.restore();
    this.timings.lastPartitionMs = t1 - t0;
    this.timings.lastCopyMs = performance.now() - t1;
    return true;
  }

  /** Composite the rock stage under the fixed-ground transform. */
  drawGround(ctx, stage) {
    if (!this.active || !this.frame) return false;
    const out = this.scene.renderGround(this.frame, this.viewId);
    if (!out) return false;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(out.canvas, 0, 0, stage.width, stage.height);
    ctx.restore();
    this.stage = out.stage;
    return true;
  }

  /** Wet receivers for GroundResponse / reflections: exact pool polygons
   *  in fixed-ground coordinates (no rectangles). */
  groundReceivers() {
    if (!this.active || !this.stage) return null;
    return { wetMasks: this.stage.wetMasks, litEdges: [], pools: this.stage.pools };
  }

  snapshot() {
    return {
      mode: this.mode, active: this.active, reason: this.reason, viewId: this.active ? this.viewId : null,
      forcedCandidate: !!this.forced?.forcedCandidate, forcedViewId: this.forcedViewId, diag: this.diag,
      generation: this.generation, runtime: this.runtimeState,
      failures: Object.fromEntries(this.failures), frameId: this.frameId, progress01: this.frame?.progress01 ?? null,
      scene: this.scene?.snapshot?.() || null, residency: this.residency?.snapshot?.() || null,
      timings: { ...this.timings }, catalogVersion: this.catalog.catalogVersion,
    };
  }

  dispose() {
    if (this.residency && this.generation) this.residency.cancelGeneration(this.generation);
    this.scene?.dispose();
    this.scene = null;
    this.runtimeState = this.enabled ? 'idle' : 'off';
  }
}

export { viewportState };
