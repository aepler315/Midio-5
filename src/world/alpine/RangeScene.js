import { resolveRangeComposition, compositionBars } from './RangeComposition.js';
// Range v2 GPU scene (plan §6, §7.2). One reusable WebGL2 context, owned
// here, renders transparent terrain partitions that RangePresentation copies
// synchronously into the main stage canvas at the existing pass boundaries.
//
// Occlusion is exact across partitions: each frame starts with one depth
// pass of every band into a reusable render target; each partition then
// draws only its own band with depth-test LEQUAL against that full-scene
// depth, so a partition shows only surfaces that are frontmost. Composited
// in pass order with other painters between them, every pixel has exactly
// one terrain owner and nothing is drawn twice.
//
// Ownership: CPU packages come from RangeAssets under the shared
// GraphicsResidency; GPU meshes, the surface texture and render targets are
// reserved here before creation and released through dispose().
import { prepareTerrainAssets, RangeAssetError } from './RangeAssets.js';
import { createSurfaceTexture, terrainUniforms, createBandGeometries } from './TerrainGL.js';
import { sceneUniforms, createSceneMaterial, createDepthMaterial, setLinearFromHex, createMaterialTextures, applyMaterial, SCENE_VERT, FEATURE_FRAG } from './TerrainMaterial.js';
import { terrainFeatureSegments } from './TerrainFeatures.js';
import { loadMaterialPack, materialGpuBytes, RULE_DEFAULTS, validateWaterRules } from './MaterialPackage.js';
import { placeForestAsync } from './ForestCover.js';
import { SunShaftGL, SHAFT_KEY, shaftSize, shaftSource } from './SunShaftGL.js';
import { rangeQuality } from './RangeQuality.js';
import { hashSeed } from '../../utils/math.js';
import { createForest } from './ForestGL.js';
import { buildRockStage } from './RockStage.js';
import { RockStageGL } from './RockStageGL.js';
import { cameraPoseAt } from '../terrain/SceneTravel.js';
import { BANDS } from './TerrainMesh.js';
import { mistParams } from './RangeAtmosphere.js';
import { scenicProjection, calibrateRangeMusic } from './RangeFrame.js';
import { applyGlacierUniforms, glacierErrors } from './GlacierField.js';

const COPY_VERT = /* glsl */`
  out vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const COPY_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uColor;
  in vec2 vUv;
  out vec4 outColor;
  void main() { outColor = texture(uColor, vUv); }
`;

const hexToLinear = (THREE, hex, target) => setLinearFromHex(target, hex);

function yieldToMain() {
  return new Promise((res) => setTimeout(res, 0));
}

/** Median height of the package's hydro-flattened water samples (the
 *  valley floor the mist settles on); null when the view has no water. */
function waterLevel(data) {
  const hs = [];
  for (const t of data.tiles.values()) {
    if (!t.flowBytes) continue;
    for (let i = 0; i < t.flowBytes.length; i += 7) if (t.flowBytes[i] === 255 && Number.isFinite(t.heightsM[i])) hs.push(t.heightsM[i]);
  }
  if (!hs.length) return null;
  hs.sort((a, b) => a - b);
  return hs[hs.length >> 1];
}

export class RangeScene {
  /** `THREE` is the local bundle; `residency` the shared ledger. */
  constructor({ THREE, residency, budget = 'desktop', canvas = null, contextAttributes = {}, diag = null }) {
    this.THREE = THREE;
    this.diag = diag;
    this.residency = residency;
    this.budget = budget;
    this.canvas = canvas || document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, alpha: true, premultipliedAlpha: true, antialias: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance', ...contextAttributes,
    });
    if (!this.renderer.capabilities.isWebGL2) throw new RangeAssetError('decode', 'WebGL2 unavailable');
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shaders encode sRGB themselves
    this.camera = new THREE.PerspectiveCamera(35, 16 / 9, 20, 150000);
    this.prepared = new Map(); // viewId -> PreparedView
    this.materials = new Map(); // manifest URL -> { pack, textures, key, users:Set }
    this.pending = new Map(); // viewId -> { generation, job }
    this.materialLoads = new Map(); // manifest URL -> in-flight acquisition
    this.target = null;
    this.sideTargets = { B: null };
    this.depthCache = { A: { frame: -1, view: null }, B: { frame: -1, view: null } };
    this.size = { width: 0, height: 0 };
    this.contextLost = false;
    this.stats = { depthPasses: 0, partitions: 0, lastPartitionMs: 0 };
    this._copy = this._createCopy();
    // Each loss and each restore starts a new context epoch: a preparation
    // that straddles either built GPU objects (and dropped the surface
    // texture's CPU pixels) in a context that is gone, so it must not publish.
    this.contextEpoch = 0;
    this.canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.contextEpoch++; this._invalidateContext(); });
    this.canvas.addEventListener?.('webglcontextrestored', () => { this.contextLost = false; this.contextEpoch++; });
  }

  _createCopy() {
    const THREE = this.THREE;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: COPY_VERT, fragmentShader: COPY_FRAG,
      uniforms: { uColor: { value: null } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    return { scene, mesh, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }

  /** Physical backing size of the partition images. `pixelRatio` is
   *  evidence/LOD context only; widthPx/heightPx are already physical. */
  resize({ widthPx, heightPx, pixelRatio = 1 }) {
    const w = Math.max(2, Math.round(widthPx)), h = Math.max(2, Math.round(heightPx));
    this.pixelRatio = pixelRatio;
    if (w === this.size.width && h === this.size.height && this.target) return;
    this.releaseShafts();
    const key = 'range:render-target';
    if (this.residency) this.residency.release(key);
    else this.target?.dispose();
    this.target = null;
    // Colour RGBA8 + 24/8 depth-stencil ~ 8 bytes per pixel, plus the
    // drawing buffer (4) -- reserved before creation.
    const bytes = w * h * 12;
    const res = this.residency?.reserve({ key, bytes, owner: 'range-targets' });
    if (this.residency && !res) throw new RangeAssetError('budget', `no room for a ${w}x${h} range target`);
    this.renderer.setPixelRatio(1);
    this._setCanvasSize(w, h);
    const THREE = this.THREE;
    this.target = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.size = { width: w, height: h };
    if (res) this.residency.commit(res, this.target, (t) => t.dispose());
    this.depthCache.A.frame = -1;
    // The incoming side's target follows the new size on its next use.
    this.releaseSide('B');
  }

  /** A second scenic target for the incoming side of a view-to-view
   *  travel, reserved before it exists. False when the budget refuses it
   *  (the outgoing view then keeps drawing alone). */
  ensureSide(side = 'B') {
    if (side !== 'B') return !!this.target;
    if (this.sideTargets.B) return true;
    if (!this.target) return false;
    this.releaseShafts();
    const { width: w, height: h } = this.size;
    const key = 'range:render-target-B';
    const res = this.residency?.reserve({ key, bytes: w * h * 8, owner: 'range-targets' });
    if (this.residency && !res) return false;
    const THREE = this.THREE;
    const t = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.sideTargets.B = t;
    if (res) this.residency.commit(res, t, (x) => { x.dispose(); if (this.sideTargets.B === x) this.sideTargets.B = null; });
    this.depthCache.B.frame = -1;
    return true;
  }

  /** Free the incoming side's target once no transition needs it. */
  releaseSide(side = 'B') {
    if (side !== 'B' || !this.sideTargets?.B) return;
    this.releaseShafts();
    const t = this.sideTargets.B;
    if (this.residency) this.residency.release('range:render-target-B');
    else t.dispose();
    this.sideTargets.B = null;
  }

  /** Optional attachments are admitted only after all active base targets,
   * views and travel scratch. No partial A/B bundle can be published. */
  prepareShafts(frame, viewIds) {
    if (this.contextLost || !rangeQuality(frame.qualityLevel).sunShafts || !shaftSource(frame) || !this.target) {
      this.releaseShafts(); return false;
    }
    const ids = [].concat(viewIds);
    const targets = ids.length > 1 && this.sideTargets.B ? { A: this.target, B: this.sideTargets.B } : { A: this.target };
    const identity = `${ids.join('|')}:${this.size.width}:${this.size.height}:${this.contextEpoch}`;
    if (this.shafts && this.shaftIdentity === identity) return true;
    this.releaseShafts();
    const { width, height } = shaftSize(this.size.width, this.size.height);
    const bytes = width * height * 4 * Object.keys(targets).length + 36;
    // Protect every currently resident essential range entry, including an
    // upcoming view. Optional light cannot evict a view to make itself fit.
    const protect = [...(this.residency?.entries.keys() || [])];
    const res = this.residency?.reserve({ key: SHAFT_KEY, bytes, owner: 'range-shafts', protect });
    if (this.residency && !res) return false;
    const shafts = new SunShaftGL(this.THREE, targets);
    const dispose = (effect) => {
      effect.dispose();
      if (this.shafts === effect) { this.shafts = null; this.shaftIdentity = null; }
      if (this.depthCache) this.depthCache.A.frame = this.depthCache.B.frame = -1;
    };
    if (res && !this.residency.commit(res, shafts, dispose)) return false;
    this.shafts = shafts; this.shaftIdentity = identity; this.shaftViews = ids;
    this.depthCache.A.frame = this.depthCache.B.frame = -1;
    return true;
  }

  releaseShafts() {
    if (!this.shafts) return;
    if (this.residency) this.residency.release(SHAFT_KEY);
    else { this.shafts.dispose(); this.shafts = null; }
    if (this.depthCache) this.depthCache.A.frame = this.depthCache.B.frame = -1;
    this.shaftIdentity = null;
  }

  /** The one drawing buffer is shared by scenic and ground images of
   *  different sizes; resize it only when the next copy needs another. */
  _setCanvasSize(w, h) {
    if (this.canvasSize?.width === w && this.canvasSize?.height === h) return;
    this.renderer.setSize(w, h, false);
    this.canvasSize = { width: w, height: h };
  }

  isReady(viewId) { return this.prepared.has(viewId) && !this.contextLost; }

  /**
   * Prepare one view (CPU package + GPU objects). Resolves PreparedView or
   * rejects with RangeAssetError; a stale generation never publishes.
   */
  prepare(view, opts = {}) {
    const iceErrors = glacierErrors(view.glacier);
    if (iceErrors.length) return Promise.reject(new RangeAssetError('decode', iceErrors.join('; ')));
    const { signal = null, generation = 0, baseUrl, isCurrent = () => true } = opts;
    if (this.prepared.has(view.id)) return Promise.resolve(this.prepared.get(view.id));
    const pend = this.pending.get(view.id);
    if (pend) {
      if (pend.generation === generation) return pend.job;
      // An earlier song's load of the same view: once it settles (it
      // publishes, or rejects as stale when its generation is cancelled),
      // prepare for this generation -- never inherit its stale rejection.
      return pend.job.catch(() => {}).then(() => this.prepare(view, opts));
    }
    if (this.contextLost) return Promise.reject(new RangeAssetError('context-lost', `GPU context lost; ${view.id} waits for restore`));
    const epoch = this.contextEpoch;
    const job = (async () => {
      const cpu = await prepareTerrainAssets(view, { baseUrl, residency: this.residency, generation, signal, isCurrent });
      let mat = null, res = null, published = false;
      let surface, geos, material, forest, stageGL, featureMaterial;
      const featureGeometries = {};
      const stale = () => {
        if (this.contextEpoch !== epoch) throw new RangeAssetError('context-lost', `GPU context changed while preparing ${view.id}`);
        return signal?.aborted || !isCurrent(generation);
      };
      try {
        if (stale()) throw new RangeAssetError('stale', `stale ${view.id}`);
        const THREE = this.THREE;
        const est = cpu.manifest.estimatedBytes?.[this.budget];
        const gpuKey = `range:terrain-gpu:${view.id}:${this.budget}`;
        // The verified material pack comes first: its rules place the trees,
        // which are placed on the CPU (a stable lattice) so their instance
        // buffers are counted in the same GPU reservation.
        mat = await this._acquireMaterial(view, { baseUrl, signal });
        if (stale()) throw new RangeAssetError('stale', `stale ${view.id}`);
        const rules = { ...mat.pack.manifest.rules, ...(view.materialRules || {}) };
        const waterCheck = validateWaterRules(rules);
        if (!waterCheck.ok) throw new RangeAssetError('manifest', `material rules rejected for ${view.id}: ${waterCheck.errors.join('; ')}`);
        // Placement yields to the event loop as it goes: a view prepared
        // during playback must not freeze frames while its forest is laid.
        const placed = await placeForestAsync(cpu.data, view, rules, { seed: hashSeed(view.terrainSourceId || view.id), signal });
        if (stale()) throw new RangeAssetError('stale', `stale ${view.id}`);
        const forestBytes = placed.count * 7 * 4;
        // Building the surface texture needs temporary height and flow
        // arrays (6 B/px), its RGBA array (4 B/px) and dry receiver mask (1 B/px). The texture is
        // uploaded at once and drops its RGBA copy after the upload (see
        // createSurfaceTexture), so all eleven bytes are scratch, reserved
        // only while it is built: the view owns both GPU textures.
        const gridPx = cpu.data.grid.width * cpu.data.grid.height;
        const featureBudgetBytes = 3 * 768 * 6 * 4;
        const bytes = (est?.meshBytes || 0) + (est?.surfaceTextureBytes || 0) + gridPx + forestBytes + featureBudgetBytes;
        res = this.residency?.reserve({ key: gpuKey, bytes, owner: 'range-terrain-gpu', generation }) || null;
        if (this.residency && !res) throw new RangeAssetError('budget', `no GPU room for ${view.id}`);
        const scratchKey = `range:surface-scratch:${view.id}`;
        const scratch = this.residency?.reserve({ key: scratchKey, bytes: gridPx * 11, owner: 'range-scratch', generation }) || null;
        if (this.residency && !scratch) throw new RangeAssetError('budget', `no room to build ${view.id} surface`);
        try {
          surface = createSurfaceTexture(THREE, cpu.data);
          this.renderer?.initTexture?.(surface.texture);
          this.renderer?.initTexture?.(surface.receiverTexture);
        } finally { if (scratch) this.residency.release(scratchKey); }
        await yieldToMain();
        const base = terrainUniforms(THREE, cpu.data, surface);
        const uniforms = sceneUniforms(THREE, base);
        applyMaterial(uniforms, mat.pack, mat.textures, view.materialRules || {});
        material = createSceneMaterial(THREE, uniforms);
        featureMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms,
          vertexShader: SCENE_VERT, fragmentShader: FEATURE_FRAG, transparent: true,
          depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth });
        const depthMaterial = createDepthMaterial(THREE, uniforms);
        geos = createBandGeometries(THREE, cpu.data, { budget: this.budget });
        await yieldToMain();
        if (stale()) throw new RangeAssetError('stale', `stale ${view.id}`);
        const meshes = {}, depthMeshes = {}, scenes = {};
        const depthScene = new THREE.Scene();
        for (const band of BANDS) {
          meshes[band] = new THREE.Mesh(geos.geometries[band], material);
          meshes[band].frustumCulled = false;
          scenes[band] = new THREE.Scene();
          scenes[band].add(meshes[band]);
          const hints = terrainFeatureSegments(geos.geometries[band].attributes.position.array,
            geos.geometries[band].index.array);
          const fg = new THREE.BufferGeometry();
          fg.setAttribute('position', new THREE.BufferAttribute(hints, 3));
          featureGeometries[band] = fg;
          const ink = new THREE.LineSegments(fg, featureMaterial);
          ink.frustumCulled = false; ink.renderOrder = 2;
          scenes[band].add(ink);
          depthMeshes[band] = new THREE.Mesh(geos.geometries[band], depthMaterial);
          depthMeshes[band].frustumCulled = false;
          depthScene.add(depthMeshes[band]);
        }
        // Seam fill: a nearer band's tiles that border a farther band also
        // draw in that farther pass (against the same depth pre-pass, so
        // only where they are the visible surface). The nearer pass covers
        // them; along the seam, where neither pass owned a pixel outright,
        // the farther partition is already the same ground instead of sky.
        const fringeMeshes = [];
        for (let b = 1; b < BANDS.length; b++) {
          const g = geos.fringes?.[BANDS[b]];
          if (!g) continue;
          const fm = new THREE.Mesh(g, material);
          fm.frustumCulled = false;
          scenes[BANDS[b - 1]].add(fm);
          fringeMeshes.push(fm);
        }
        material.depthFunc = THREE.LessEqualDepth;
        material.depthWrite = false;
        forest = createForest(THREE, placed, uniforms);
        if (resolveRangeComposition(view)?.foreground !== 'none') stageGL = new RockStageGL(THREE, { textures: mat.textures, palette: mat.pack.manifest.palette, rules });
        for (const band of BANDS) for (const m of forest.byBand[band]) scenes[band].add(m);
        for (const d of forest.depth) depthScene.add(d);
        // Per-band depth scenes for travel frames, where a side's nearer
        // bands are drawn only in some columns (same geometry and material;
        // a mesh has one parent, so these are separate mesh objects).
        const depthScenes = {};
        for (const band of BANDS) {
          depthScenes[band] = new THREE.Scene();
          const dm = new THREE.Mesh(geos.geometries[band], depthMaterial);
          dm.frustumCulled = false;
          depthScenes[band].add(dm);
          for (const d of forest.depthByBand?.[band] || []) depthScenes[band].add(d);
        }
        // Compile now, not in the first playing frame.
        this.renderer.compile(scenes.far, this.camera);
        this.renderer.compile(depthScene, this.camera);
        const prepared = {
          view, generation, manifest: cpu.manifest, data: cpu.data, identity: cpu.identity,
          surface, uniforms, material, depthMaterial, geometries: geos.geometries, fringes: geos.fringes, fringeMeshes, scenes, depthScene, depthScenes,
          forest, stageGL, featureGeometries, featureMaterial,
          stats: { ...geos.stats, trees: forest.counts, featureBytes: featureBudgetBytes }, gpuKey, cpuKey: cpu.key,
          rules, waterLevelM: waterLevel(cpu.data), materialKey: mat.key,
        };
        if (stale()) throw new RangeAssetError('stale', `stale ${view.id}`);
        // Eviction (or any release) of the GPU entry also retires the view
        // from the cache, so no frame can draw disposed resources.
        if (res && !this.residency.commit(res, prepared, (p) => this._retire(view.id, p))) {
          throw new RangeAssetError('stale', `generation ${generation} cancelled during ${view.id}`);
        }
        this.prepared.set(view.id, prepared);
        published = true;
        return prepared;
      } catch (err) {
        if (!published) {
          if (res) this.residency.release(res.key);
          if (mat) this._releaseMaterial(view.id);
          // The decoded terrain is only worth its ledger charge to a view
          // that publishes.
          this.residency?.release(cpu.key);
          forest?.dispose();
          stageGL?.dispose();
          material?.dispose();
          featureMaterial?.dispose();
          for (const g of Object.values(featureGeometries)) g.dispose();
          surface?.texture?.dispose();
          surface?.receiverTexture?.dispose();
          for (const g of Object.values(geos?.geometries || {})) g.dispose();
          for (const g of Object.values(geos?.fringes || {})) g.dispose();
        }
        throw err;
      }
    })();
    this.pending.set(view.id, { generation, job });
    job.finally(() => { if (this.pending.get(view.id)?.job === job) this.pending.delete(view.id); }).catch(() => {});
    return job;
  }

  /** A prepared view's GPU entry was released (evicted, cancelled or
   *  explicitly): drop it from the cache and free what it holds. */
  _retire(viewId, p) {
    if (this.shaftViews?.includes(viewId)) this.releaseShafts();
    if (this.prepared.get(viewId) === p) {
      this.prepared.delete(viewId);
      this.residency?.release(p.cpuKey);
      this._releaseMaterial(viewId);
    }
    this._disposePrepared(p);
  }

  /** Depth pre-pass for one pass of a travel side: the pass's band and the
   *  farther ones across the whole width, each nearer band only inside its
   *  [x0, x1] columns (fractions of the width), or not at all. */
  _travelDepth(p, target, pass, bandColumns) {
    const r = this.renderer;
    const at = BANDS.indexOf(pass);
    const { width: W, height: H } = this.size;
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    BANDS.forEach((band, i) => {
      if (i <= at) { r.render(p.depthScenes[band], this.camera); return; }
      const cols = bandColumns[band];
      if (!cols) return;
      const x0 = Math.max(0, Math.floor(cols[0] * W)), x1 = Math.min(W, Math.ceil(cols[1] * W));
      if (!(x1 > x0)) return;
      target.scissor.set(x0, 0, x1 - x0, H);
      target.scissorTest = true;
      r.setRenderTarget(target);
      r.render(p.depthScenes[band], this.camera);
      target.scissorTest = false;
      r.setRenderTarget(target);
    });
    this.stats.depthPasses++;
  }

  /** Keep what the current frame draws resident: its view's GPU, CPU and
   *  material entries and the two render targets. */
  pinView(viewIds, extraKeys = []) {
    if (!this.residency) return;
    const keys = ['range:render-target', 'range:ground-target', 'range:render-target-B', ...extraKeys];
    for (const id of [].concat(viewIds)) {
      const p = this.prepared.get(id);
      if (p) keys.push(p.gpuKey, p.cpuKey, p.materialKey);
    }
    this.residency.pin(keys);
  }

  /** One GPU copy per material pack, shared by the views that use it. Its
   *  declared footprint is reserved before any image is decoded, and views
   *  that ask for the same pack concurrently share one load. */
  async _acquireMaterial(view, { baseUrl, signal }) {
    const url = new URL(view.materialManifestUrl, baseUrl).href;
    const hit = this.materials.get(url);
    if (hit) { hit.users.add(view.id); return hit; }
    let inflight = this.materialLoads.get(url);
    if (!inflight) {
      inflight = (async () => {
        let res = null;
        const pack = await loadMaterialPack(url, {
          signal, expectSha256: view.materialManifestSha256 || null,
          onManifest: (manifest) => {
            res = this.residency?.reserve({ key: `range:material:${manifest.id}`, bytes: materialGpuBytes(manifest), owner: 'range-material', generation: 0 }) || null;
            if (this.residency && !res) throw new RangeAssetError('budget', `no room for material ${manifest.id}`);
          },
        }).catch((err) => { if (res) this.residency.release(res.key); throw err; });
        const textures = createMaterialTextures(this.THREE, pack);
        const entry = { url, pack, textures, key: `range:material:${pack.manifest.id}`, users: new Set() };
        const dispose = () => { textures.dispose(); for (const img of pack.images.values()) img.close?.(); };
        if (res && !this.residency.commit(res, entry, dispose)) throw new RangeAssetError('stale', `material ${pack.manifest.id} released while loading`);
        this.materials.set(url, entry);
        return entry;
      })();
      this.materialLoads.set(url, inflight);
      inflight.finally(() => this.materialLoads.delete(url)).catch(() => {});
    }
    const entry = await inflight;
    entry.users.add(view.id);
    return entry;
  }

  _releaseMaterial(viewId) {
    for (const [url, m] of this.materials) {
      m.users.delete(viewId);
      if (!m.users.size) {
        this.materials.delete(url);
        if (this.residency) this.residency.release(m.key);
        else m.textures.dispose();
      }
    }
  }

  _disposePrepared(p) {
    p.featureMaterial?.dispose();
    for (const g of Object.values(p.featureGeometries || {})) g.dispose();
    p.forest?.dispose();
    p.stageGL?.dispose();
    for (const g of Object.values(p.geometries || {})) g.dispose();
    for (const g of Object.values(p.fringes || {})) g.dispose();
    p.surface?.texture?.dispose();
    p.surface?.receiverTexture?.dispose();
    p.material?.dispose();
    p.depthMaterial?.dispose();
  }

  /** Release one view's GPU and CPU ownership. */
  release(viewId) {
    if (this.shaftViews?.includes(viewId)) this.releaseShafts();
    const p = this.prepared.get(viewId);
    if (!p) return;
    this.prepared.delete(viewId);
    this.residency?.release(p.gpuKey); // disposes via the committed dispose
    this.residency?.release(p.cpuKey);
    if (!this.residency) this._disposePrepared(p);
    this._releaseMaterial(viewId);
  }

  /** Camera for this frame: the view's rail pose, projected onto the whole
   *  padded scenic stage so the Canvas transform (zoom, shake, roll) applies
   *  once when the partition is composited. */
  _setCamera(view, frame) {
    const pose = cameraPoseAt(view, view.glacier && !frame.reducedMotion ? (frame.glacier?.journey01 ?? frame.progress01) : frame.progress01);
    const cam = this.camera;
    const proj = scenicProjection(pose.fovYDeg, frame.scenicViewport);
    cam.fov = proj.fovYDeg;
    cam.aspect = proj.aspect;
    cam.position.set(pose.eyeM[0], pose.eyeM[1], pose.eyeM[2]);
    cam.up.set(0, 1, 0);
    cam.lookAt(pose.targetM[0], pose.targetM[1], pose.targetM[2]);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return pose;
  }

  /** Per-frame uniforms: light from where the celestial is drawn, sky and
   *  air colours from the frame, the shared deformation. */
  _setUniforms(p, frame) {
    const THREE = this.THREE;
    const u = p.uniforms;
    const n = frame.narrative;
    u.uNarrative.value.set(n?.relief ?? 1, n?.atmosphere ?? 1, n?.materials ?? 1, n?.features ?? 1);
    u.uNarrativeInk.value = n ? (1 - n.materials) * (1 - n.skyDark) : 0;
    applyGlacierUniforms(u, p.view.glacier, frame.glacier);
    const m = calibrateRangeMusic(frame.music, { view: p.view, progress01: frame.progress01,
      heightRange: [u.uHeightRange.value.x, u.uHeightRange.value.y], nominalHeight: frame.scenicViewport?.nominalHeight || 720 });
    u.uDeformAmp.value = m.amplitudeM;
    u.uDeformKick.value = m.kickM;
    u.uDeformGesture.value = m.gestureM;
    u.uDeformMelodic.value = m.melodicM;
    u.uDeformStructural.value = m.structuralM;
    u.uMelodyK.value = m.melodyK;
    u.uMelodyDir.value.set(...m.melodyDir);
    u.uMelodyPhase.value = m.melodyPhaseRad;
    u.uDeformK.value = m.waveK;
    u.uDeformDir.value.set(m.waveDir[0], m.waveDir[1]);
    u.uDeformPhase.value = m.phaseRad;
    u.uTime.value = frame.reducedMotion ? 0 : frame.timeMs / 1000;
    m.gusts.forEach((g, i) => { u.uGustAge.value[i] = g.ageSec; u.uGustAmp.value[i] = g.amp01; u.uGustDir.value[i] = g.dir; });
    u.uForestKeep.value = rangeQuality(frame.qualityLevel).forestKeep;
    for (const objects of Object.values(p.forest?.byBand || {})) for (const tree of objects) tree.visible = !n || n.materials > .01;
    for (const tree of p.forest?.depth || []) tree.visible = !n || n.materials > .01;
    for (const objects of Object.values(p.forest?.depthByBand || {})) for (const tree of objects) tree.visible = !n || n.materials > .01;
    const c = frame.light.celestial;
    // Unproject the celestial's stage position into a world direction.
    const ndcX = c.xFrac * 2 - 1, ndcY = 1 - c.yFrac * 2;
    const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    u.uLightDir.value.copy(dir.normalize());
    const night = frame.light.night01;
    const strength = c.body ? c.intensity : 0;
    hexToLinear(THREE, c.colorHex, u.uLightColor.value).multiplyScalar(strength);
    // Receiver fill fades once; sky radiance also feeds air and water's
    // reflection, so it keeps the frame's authored environment colors.
    u.uAmbientScale.value = 2.5 * (frame.light.ambientMultiplier ?? 1);
    u.uSolarTransmission.value = c.body === 'sun' && strength > 0 ? .18 : 0;
    if (frame.light.sky) {
      hexToLinear(THREE, frame.light.sky.top, u.uSkyZenith.value).multiplyScalar(0.9);
      hexToLinear(THREE, frame.light.sky.horizon, u.uSkyHorizon.value).multiplyScalar(0.9);
      hexToLinear(THREE, frame.light.sky.air || frame.light.sky.horizon, u.uAirColor.value);
    }
    if (frame.motif) {
      // A restrained, steady colour recipe marks repeated verses/choruses.
      // Environment tint stays separate from the resolved physical body
      // color. Air, mist and reflected sky share the same recipe.
      const tone = new THREE.Color().setHSL(frame.motif.hueDeg / 360, .65, .65);
      const amount = frame.motif.intensity01 * (frame.reducedFlash ? .5 : 1);
      const tint = new THREE.Color(1, 1, 1).lerp(tone, amount);
      u.uSkyZenith.value.multiply(tint);
      u.uSkyHorizon.value.multiply(tint);
      u.uAirColor.value.multiply(tint);
    }
    u.uAirDensity.value = (1 / 55000) * (1 + 0.6 * night) * (p.rules?.airScale ?? RULE_DEFAULTS.airScale);
    // Valley mist: anchored at the view's water level, thicker in calm.
    const mp = mistParams({ rules: p.rules, waterLevelM: p.waterLevelM, heightRange: [u.uHeightRange.value.x, u.uHeightRange.value.y],
      tSec: frame.reducedMotion ? 0 : frame.timeMs / 1000, calm01: 1 - (frame.music?.groove ?? 0) });
    const quality = rangeQuality(frame.qualityLevel);
    u.uMistDensity.value = mp.density * (n?.atmosphere ?? 1);
    u.uMistSteps.value = quality.mistSteps;
    u.uMistBase.value = mp.baseM;
    u.uMistHeight.value = mp.heightM;
    u.uMistTime.value = mp.tSec;
    // Lit mist: the air's colour lifted toward the key light (display domain).
    u.uMistColor.value.copy(u.uAirColor.value).multiplyScalar(1.2).add(u.uLightColor.value.clone().multiplyScalar(0.06));
    u.uMistColor.value.r = Math.min(0.9, u.uMistColor.value.r);
    u.uMistColor.value.g = Math.min(0.9, u.uMistColor.value.g);
    u.uMistColor.value.b = Math.min(0.9, u.uMistColor.value.b);
    u.uCameraPos.value.copy(this.camera.position);
  }

  /**
   * Render one scenic partition ('far' | 'mid' | 'near') of `frame` and
   * return the canvas holding it (valid until the next render call; copy it
   * before calling again). Null when nothing can be drawn for this view.
   */
  renderPartition(frame, pass, viewId = frame.viewFromId, { side = 'A', bandColumns = null } = {}) {
    const p = this.prepared.get(viewId);
    const target = side === 'B' ? this.sideTargets.B : this.target;
    if (!p || this.contextLost || !target) return null;
    const t0 = performance.now();
    const r = this.renderer;
    // The camera is shared: set this side's pose for every pass, even when
    // its depth pre-pass (kept per side) is reused.
    this._setCamera(p.view, frame);
    this._setUniforms(p, frame);
    const depth = this.depthCache[side];
    if (bandColumns && p.depthScenes) {
      // Travel: this side draws its nearer bands only in some columns (the
      // other side supplies them elsewhere), so its depth pre-pass holds a
      // nearer band only where it is drawn -- otherwise this pass keeps
      // holes shaped like ridges the frame never shows.
      this._travelDepth(p, target, pass, bandColumns);
      depth.frame = -1;
    } else if (depth.frame !== frame.frameId || depth.view !== viewId) {
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(p.depthScene, this.camera);
      depth.frame = frame.frameId;
      depth.view = viewId;
      this.stats.depthPasses++;
    }
    // During travel a side's nearer bands draw only in some columns, so its
    // seam fill would paint ground the other side owns there.
    for (const fm of p.fringeMeshes || []) fm.visible = !bandColumns;
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    p.uniforms.uDiag.value = this.diag === 'markers' && pass === 'far' ? 1 : 0;
    r.render(p.scenes[pass], this.camera);
    // Far is the single solar boundary, before the inserted Dancing Ridge.
    // During travel its depth was just rebuilt with this side's real columns.
    const source = pass === 'far' && rangeQuality(frame.qualityLevel).sunShafts ? shaftSource(frame) : null;
    const scattering = source && this.shafts?.render(r, side, source, this.camera, frame.scenicViewport);
    r.setRenderTarget(null);
    this._setCanvasSize(this.size.width, this.size.height);
    r.clear(true, true, false);
    this._copy.mesh.material.uniforms.uColor.value = target.texture;
    r.render(this._copy.scene, this._copy.camera);
    if (scattering) this.shafts.compositeToScreen(r, side, source);
    // Whether translucent sky light now shares the returned image with the
    // terrain: an alpha mask taken from it must not trust faint pixels.
    this.lastShafted = !!scattering;
    this.stats.partitions++;
    this.stats.lastPartitionMs = performance.now() - t0;
    return this.canvas;
  }

  /**
   * Render the fixed-ground rock stage for `frame` at the ground backing
   * size and return { canvas, stage } -- the canvas valid until the next
   * render call, the stage carrying exact pool polygons (wet masks).
   */
  renderGround(frame, viewId = frame.viewFromId) {
    if (frame.compositions?.[viewId]?.foreground === 'none') return null;
    const p = this.prepared.get(viewId);
    if (!p || this.contextLost) return null;
    const composition = frame.compositions?.[viewId] ?? resolveRangeComposition(p.view);
    if (composition?.foreground === 'none') return null;
    const vp = frame.groundViewport;
    const w = Math.max(2, Math.round(vp.backingWidth)), h = Math.max(2, Math.round(vp.backingHeight));
    if (!this.groundTarget || this.groundTarget.width !== w || this.groundTarget.height !== h) {
      const key = 'range:ground-target';
      this.releaseShafts();
      this.releaseGroundTarget();
      const res = this.residency?.reserve({ key, bytes: w * h * 8, owner: 'range-targets' });
      if (this.residency && !res) return null;
      const THREE = this.THREE;
      this.groundTarget = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      if (res) this.residency.commit(res, this.groundTarget, (t) => { t.dispose(); if (this.groundTarget === t) this.groundTarget = null; });
    }
    const bars = compositionBars(frame.groundBars, vp, composition);
    const stage = buildRockStage({ bars, slabCount: composition ? 1 : undefined, width: vp.logicalWidth, height: vp.logicalHeight,
      worldX: frame.worldX, originX: frame.originX, seed: frame.seed });
    const u = p.uniforms;
    // The scene's key light, re-expressed for the stage: from behind and
    // above, on the celestial's side of the frame.
    const THREE = this.THREE;
    const key = frame.light.ground;
    // Stage normals use +Y upward; the recorded ground anchor is Canvas
    // +Y downward. Keep the existing shallow depth/rock calibration.
    const lightDir = new THREE.Vector3((key.x - vp.logicalWidth * .5) / vp.logicalHeight,
      (vp.logicalHeight - key.y) / vp.logicalHeight, -0.45).normalize();
    p.stageGL.update(stage, { width: vp.logicalWidth, height: vp.logicalHeight, frame, lightDir,
      skyZenith: u.uSkyZenith.value, skyHorizon: u.uSkyHorizon.value });
    // The celestial key, tempered for up-facing slab tops (see RockStageGL's
    // ambient note for the measured calibration).
    p.stageGL.uniforms.uKeyColor.value.copy(u.uLightColor.value).multiplyScalar(0.3);
    p.stageGL.uniforms.uDiag.value = this.diag === 'markers' ? 1 : 0;
    const r = this.renderer;
    this._setCanvasSize(w, h);
    r.setRenderTarget(this.groundTarget);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(p.stageGL.scene, p.stageGL.camera);
    r.setRenderTarget(null);
    r.clear(true, true, false);
    this._copy.mesh.material.uniforms.uColor.value = this.groundTarget.texture;
    r.render(this._copy.scene, this._copy.camera);
    return { canvas: this.canvas, stage };
  }

  releaseGroundTarget() {
    if (this.residency) this.residency.release('range:ground-target');
    else this.groundTarget?.dispose();
    this.groundTarget = null;
  }

  _invalidateContext() {
    this.releaseShafts();
    if (this.residency) this.residency.release('range:render-target');
    else this.target?.dispose();
    this.releaseGroundTarget();
    this._copy?.mesh.geometry.dispose();
    this._copy?.mesh.material.dispose();
    // Retire handles during the lost event, before Three creates the next
    // context epoch. Deleting old buffers/VAOs after restoration is an
    // INVALID_OPERATION on real drivers. Legacy draws while we re-prepare.
    for (const id of [...this.prepared.keys()]) this.release(id);
    this.size = { width: 0, height: 0 };
    this.target = null;
    this.releaseSide('B');
    this.depthCache.A.frame = this.depthCache.B.frame = -1;
  }

  snapshot() {
    return {
      prepared: [...this.prepared.keys()], pending: [...this.pending.keys()], contextLost: this.contextLost,
      size: { ...this.size }, stats: { ...this.stats }, sideB: !!this.sideTargets.B,
    };
  }

  dispose() {
    this.releaseShafts();
    for (const id of [...this.prepared.keys()]) this.release(id);
    this.releaseSide('B');
    this.residency?.release('range:render-target');
    this.releaseGroundTarget();
    if (!this.residency) this.target?.dispose();
    this._copy.mesh.geometry.dispose();
    this._copy.mesh.material.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
