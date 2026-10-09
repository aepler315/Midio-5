import { cloudPuffs } from './CloudOcclusion.js';
import { applyLensFov } from '../../render/CameraLens.js';
import { giantLayout, giantAmounts, mirrorGiantSpan, aheadOfEye } from './LandscapeGiants.js';
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
import { planTerrainWindow, TourWindowCache } from './TerrainWindow.js';
import { TerrainWindowWorker, shareTerrainLanes } from './TerrainWindowWorker.js';
import { buildTerrainGeometry } from './TerrainMesh.js';
import { buildRockStage } from './RockStage.js';
import { RockStageGL } from './RockStageGL.js';
import { scenePoseAt } from '../terrain/SceneTravel.js';
import { applyCameraMoves, rangeUserCamera } from './RangeCamera.js';
import { BANDS, terrainFringeBytes, terrainHeightAt } from './TerrainMesh.js';
import { mistParams, mistDrift } from './RangeAtmosphere.js';
import { mirrorSize, mirrorLevelFor, mirrorCameraFor, mirrorTextureMatrix, MIRROR_CLIP_M, MIRROR_LIFT } from './WaterMirror.js';
import { scenicProjection, calibrateRangeMusic } from './RangeFrame.js';
import { applyGlacierUniforms, glacierErrors, glacierSample } from './GlacierField.js';
import { ActorsGL } from './ActorsGL.js';
import { ACTOR_IDS, ACTOR_HUES, ACTOR_LOOK, ACTOR_START, actorRoutes, routePosition } from './RangeActors.js';
// Storm light, linear: the deck's underside, the rain-dimmed horizon, the rain air.
// STORM_AIR meets the slate the sky paints at the horizon (drawStormSky) once displayed.
const STORM_ZENITH = { r: .02, g: .026, b: .036 }, STORM_HORIZON = { r: .03, g: .038, b: .05 }, STORM_AIR = { r: .028, g: .036, b: .048 };

const BACKDROP_KEY = 'range:water-backdrop';

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

/** Midio's mirrored sheet keeps this far ahead of a zoomed-in eye. */
const MIDIO_MIN_AHEAD_M = 600;

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
    // Lake mirror image per side (optional, like the shafts), drawn once a frame.
    this.mirrors = { A: null, B: null };
    this.mirrorCamera = new THREE.PerspectiveCamera();
    // Moved camera poses per frame and view (see _setCamera).
    this._movedPoses = new WeakMap();
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
    this.releaseMirror('A');
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
    if (side !== 'B') return;
    this.releaseMirror('B');
    if (!this.sideTargets?.B) return;
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

  /** The side's mirror image target, reserved as optional light: it may
   *  not evict anything resident to fit, and anything may evict it. */
  _ensureMirror(side) {
    const { width, height } = mirrorSize(this.size.width, this.size.height);
    const identity = `${width}x${height}:${this.contextEpoch}`;
    const have = this.mirrors[side];
    if (have && have.identity === identity) return have;
    this.releaseMirror(side);
    const key = `range:water-mirror-${side}`;
    const protect = [...(this.residency?.entries.keys() || [])];
    // RGBA8 colour + 24/8 depth.
    const res = this.residency?.reserve({ key, bytes: width * height * 8, owner: 'range-mirror', protect });
    if (this.residency && !res) return null;
    const THREE = this.THREE;
    const target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const entry = { key, identity, target, frame: -1, view: null, matrix: new THREE.Matrix4() };
    const dispose = (e) => { e.target.dispose(); if (this.mirrors[side] === e) this.mirrors[side] = null; };
    if (res && !this.residency.commit(res, entry, dispose)) return null;
    this.mirrors[side] = entry;
    return entry;
  }

  releaseMirror(side) {
    const m = this.mirrors?.[side];
    if (!m) return;
    if (this.residency) this.residency.release(m.key);
    else m.target.dispose();
    this.mirrors[side] = null;
  }

  /**
   * What the stage holds before the middle distance is drawn (the 2D sky,
   * aurora and distant ranges, and the far partition) is the backdrop the
   * lake reflects: copy the stage area of `ctx` into a small texture the
   * water in the middle and near partitions samples along its (lowered)
   * reflected ray. Only while a prepared view mirrors; otherwise the copy
   * is released.
   */
  captureBackdrop(ctx, stage, frame) {
    const wanted = !this.contextLost && rangeQuality(frame?.qualityLevel).waterMirror
      && [...this.prepared.values()].some((p) => Number.isFinite(p.mirrorLevelM));
    if (!wanted || !ctx?.canvas || !(stage?.width > 0)) { this.releaseBackdrop(); return false; }
    const { width, height } = mirrorSize(this.size.width, this.size.height);
    let b = this.backdrop;
    if (!b || b.width !== width || b.height !== height || b.epoch !== this.contextEpoch) {
      this.releaseBackdrop();
      // The copy canvas and its texture.
      const res = this.residency?.reserve({ key: BACKDROP_KEY, bytes: width * height * 8, owner: 'range-mirror',
        protect: [...(this.residency?.entries.keys() || [])] });
      if (this.residency && !res) return false;
      const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
      const THREE = this.THREE;
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
      b = { width, height, epoch: this.contextEpoch, canvas, ctx: canvas.getContext('2d'), texture, frame: -1 };
      const dispose = (x) => { x.texture.dispose(); x.canvas.width = x.canvas.height = 0; if (this.backdrop === x) this.backdrop = null; };
      if (res && !this.residency.commit(res, b, dispose)) return false;
      this.backdrop = b;
    }
    // The stage's rectangle in the canvas: the painter's scale/translate.
    const T = ctx.getTransform?.() || { a: 1, d: 1, e: 0, f: 0 };
    b.ctx.clearRect(0, 0, width, height);
    b.ctx.drawImage(ctx.canvas, T.e, T.f, T.a * stage.width, T.d * stage.height, 0, 0, width, height);
    b.texture.needsUpdate = true;
    b.frame = frame?.frameId ?? -1;
    return true;
  }

  releaseBackdrop() {
    if (!this.backdrop) return;
    if (this.residency) this.residency.release(BACKDROP_KEY);
    else { this.backdrop.texture.dispose(); this.backdrop = null; }
    this.backdrop = null;
  }

  /**
   * Draw this side's lake mirror for `frame` (once per frame and view) and
   * point the water at it; without water near the view's level, at a
   * quality that sheds it, or without room, the water keeps its sky
   * reflection.
   */
  _prepareMirror(p, frame, side, viewId) {
    const u = p.uniforms;
    u.uViewportPx.value.set(this.size.width, this.size.height);
    const ripple = (m) => (frame.reducedMotion ? 0.001 : 0.0012 + 0.0025 * (m?.groove ?? 0) + 0.004 * (m?.kick01 ?? 0));
    const level = p.mirrorLevelM;
    const wanted = Number.isFinite(level) && rangeQuality(frame.qualityLevel).waterMirror
      && (frame.narrative?.materials ?? 1) > .01;
    const m = wanted ? this._ensureMirror(side) : null;
    if (!m) { u.uMirrorAmount.value = 0; u.uBackdropAmount.value = 0; if (!wanted) this.releaseMirror(side); return; }
    if (m.frame !== frame.frameId || m.view !== viewId) {
      const r = this.renderer;
      const THREE = this.THREE;
      mirrorCameraFor(THREE, this.camera, level, this.mirrorCamera, MIRROR_LIFT);
      mirrorTextureMatrix(THREE, this.mirrorCamera, m.matrix);
      for (const fm of p.fringeMeshes || []) fm.visible = false;
      u.uMirrorAmount.value = 0;
      // A disabled reflection still has an active sampler. Unbind the
      // previous image before drawing into it to avoid framebuffer feedback.
      u.uMirror.value = null;
      u.uClipBelow.value = level + MIRROR_CLIP_M;
      // Rain over the reflected land stands where the mirror camera sees it;
      // the main camera's matrix is restored below, before the partitions.
      this.mirrorCamera.updateMatrixWorld();
      u.uViewProj.value.multiplyMatrices(this.mirrorCamera.projectionMatrix, this.mirrorCamera.matrixWorldInverse);
      r.setRenderTarget(m.target);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(p.depthScene, this.mirrorCamera);
      for (const band of BANDS) r.render(p.scenes[band], this.mirrorCamera);
      if (u.uGiantPeak.value[0] > .001 && u.uMidioCloud.value < .5)
        r.render(p.actors.reflection.scene, this.mirrorCamera);
      u.uClipBelow.value = -1e9;
      m.frame = frame.frameId;
      m.view = viewId;
      this.stats.mirrorPasses = (this.stats.mirrorPasses || 0) + 1;
    }
    u.uMirror.value = m.target.texture;
    u.uMirrorMatrix.value.copy(m.matrix);
    const b = this.backdrop?.frame === frame.frameId ? this.backdrop : null;
    u.uBackdrop.value = b?.texture || null;
    u.uBackdropAmount.value = b ? 1 : 0;
    u.uViewProj.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    u.uMirrorLevel.value = level;
    u.uMirrorRipple.value = ripple(frame.music);
    u.uMirrorAmount.value = 1;
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

  replaceTour(view) {
    const p=this.prepared.get(view.id);if(!p?.windowCache)return;
    p.view=view;p.windowWorker.setTour(view.tour);p.windowCache.generation++;
    for(const [index,window]of p.windowCache.resident)if(window!==p.activeWindow){window.dispose();p.windowCache.resident.delete(index);}
    for(const entry of p.rawAhead?.values()||[])this.residency?.release(entry.key);
    p.rawAhead?.clear();p.prefetchAttempted=null;
    if(p.activeWindow)p.activeWindow.coarse=true;
  }

  _tourWindowResource(p, index, geos, forest, key, coarse = false) {
    let disposed = false;
    const resource = { index, geos, forest, key, coarse,
      destroy: () => {
        if (disposed) return; disposed = true;
        if (p.windowCache?.resident.get(index) === resource) p.windowCache.resident.delete(index);
        for (const g of Object.values(geos.geometries)) g.dispose();
        for (const g of Object.values(geos.fringes)) g.dispose();
        forest.dispose();
      },
      dispose: () => { if (this.residency && key) this.residency.release(key); else resource.destroy(); },
    };
    return resource;
  }

  async _buildTourWindow(p, index) {
    const generation=p.windowCache.generation;
    const ahead = p.rawAhead?.get(index);
    const raw = await (ahead?.job || p.windowWorker.build(index, p.windowOptions));
    if (p.windowCache.closed || generation!==p.windowCache.generation || !this.prepared.has(p.view.id)) {
      if (ahead) this.residency?.release(ahead.key);
      throw new RangeAssetError('stale', 'Tour window generation ended');
    }
    const key = `range:tour-window:${p.view.id}:${generation}:${index}`;
    const bytes = Object.values(raw.built.bands).reduce((n, b) => n + b.positions.byteLength + b.indices.byteLength + b.fringe.byteLength, 0) + raw.placed.count * 7 * 4;
    const reservation = this.residency?.reserve({ key, bytes, owner: 'range-tour-window', generation: p.generation,
      protect: [p.gpuKey, p.cpuKey, p.workerKey, p.activeWindow?.key].filter(Boolean) });
    if (this.residency && !reservation) throw new RangeAssetError('budget', `No room for tour window ${index}`);
    const geos = createBandGeometries(this.THREE, p.data, { built: raw.built }), forest = createForest(this.THREE, raw.placed, p.uniforms);
    const window = this._tourWindowResource(p, index, geos, forest, key);
    window.detail = raw.plan;
    if (reservation && !this.residency.commit(reservation, window, w => w.destroy())) throw new RangeAssetError('stale', 'Tour window cancelled');
    if (ahead) { this.residency?.release(ahead.key); p.rawAhead.delete(index); }
    return window;
  }

  _swapTourWindow(p, window) {
    if (p.windowIndex !== window.index || p.mistRouteCap === undefined) {
      let minimumEye = Infinity;
      for (let t = window.index * 8000; t <= Math.min(p.view.tour.durationMs, (window.index + 1) * 8000); t += 500) minimumEye = Math.min(minimumEye, p.view.tour.poseAt(t).eyeM[1]);
      p.mistRouteCap = minimumEye - 120;
    }
    if (p.activeWindow === window) return;
    const replacements = new Map();
    for (const band of BANDS) {
      replacements.set(p.geometries[band], window.geos.geometries[band]);
      if (p.fringes[band]) replacements.set(p.fringes[band], window.geos.fringes[band]);
      for (const m of p.forest.byBand[band]) p.scenes[band].remove(m);
      for (const m of window.forest.byBand[band]) p.scenes[band].add(m);
      for (const m of p.forest.depthByBand[band]) p.depthScenes[band].remove(m);
      for (const m of window.forest.depthByBand[band]) p.depthScenes[band].add(m);
    }
    for (const m of p.forest.depth) p.depthScene.remove(m);
    for (const m of window.forest.depth) p.depthScene.add(m);
    for (const scene of [...Object.values(p.scenes), p.depthScene, ...Object.values(p.depthScenes)]) {
      for (const object of scene.children) if (replacements.has(object.geometry)) object.geometry = replacements.get(object.geometry);
    }
    p.geometries = window.geos.geometries; p.fringes = window.geos.fringes; p.forest = window.forest;
    p.activeWindow = window; p.windowIndex = window.index;
    p.stats = { ...p.stats, ...window.geos.stats, trees: window.forest.counts, windowIndex: window.index, coarse: window.coarse, pixelLimit: window.detail?.pixelLimit, detailNote: window.detail?.detailNote };
  }

  _ensureTourWindow(p, timeMs) {
    if (!p?.windowCache) return;
    const index = Math.max(0, Math.floor(Math.min(timeMs, Math.max(0, p.view.tour.durationMs - 1)) / 8000));
    p.windowCache.current = index;
    let window = p.windowCache.resident.get(index);
    if (!window) {
      const plan = planTerrainWindow(p.data, p.view.tour, index, { ...p.windowOptions, bias: 2 });
      const key = `range:tour-window:${p.view.id}:${index}:coarse`, bytes = plan.triangles * 36 + 256 * 1024;
      const reservation = this.residency?.reserve({ key, bytes, owner: 'range-tour-window', generation: p.generation, protect: [p.gpuKey, p.cpuKey, p.workerKey, p.activeWindow?.key].filter(Boolean) });
      if (this.residency && !reservation) return;
      const built = buildTerrainGeometry(p.data, { strides: plan.strides });
      const geos = createBandGeometries(this.THREE, p.data, { built });
      const forest = createForest(this.THREE, { mesh: new Float32Array(), billboard: new Float32Array(), stride: 8, count: 0 }, p.uniforms);
      window = this._tourWindowResource(p, index, geos, forest, key, true);
      if (reservation && !this.residency.commit(reservation, window, w => w.destroy())) return;
      p.windowCache.resident.set(index, window);
    }
    this._swapTourWindow(p, window);
    p.windowCache.prune();
    const fail = error => { if (error?.reason !== 'stale' && error?.name !== 'AbortError') p.windowNote = error.message; };
    if (window.coarse) p.windowCache.request(index, { replace: true }).catch(fail);
    if ((index + 1) * 8000 < p.view.tour.durationMs) p.windowCache.request(index + 1).catch(fail);
    // The second-ahead result remains CPU data until it is needed on GPU.
    p.rawAhead ||= new Map();
    for (const [old, entry] of p.rawAhead) if (old < index || old > index + 2) { this.residency?.release(entry.key); p.rawAhead.delete(old); }
    const aheadIndex = index + 2;
    if (aheadIndex * 8000 < p.view.tour.durationMs && !p.rawAhead.has(aheadIndex) && p.prefetchAttempted !== aheadIndex) {
      p.prefetchAttempted = aheadIndex;
      const key = `range:tour-window-cpu:${p.view.id}:${aheadIndex}`;
      const reservation = this.residency?.reserve({ key, bytes: 64 * 1024 ** 2, owner: 'range-tour-window-cpu', generation: p.generation,
        protect: [p.gpuKey, p.cpuKey, p.workerKey, window.key] });
      if (!this.residency || reservation) {
        const job = p.windowWorker.build(aheadIndex, p.windowOptions).then(raw => {
          if (p.windowCache.closed || !p.rawAhead.has(aheadIndex)) { this.residency?.release(key); return raw; }
          if (reservation) this.residency.commit(reservation, raw);
          return raw;
        }).catch(error => { this.residency?.release(key); p.rawAhead.delete(aheadIndex); throw error; });
        job.catch(fail); p.rawAhead.set(aheadIndex, { key, job });
      }
    }
  }

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
      let surface, geos, material, depthMaterial, forest, stageGL, featureMaterial, actors;
      let windowWorker = null, initialWindow = null, workerKey = null, windowReservation = null;
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
        let rawWindow = null;
        const windowOptions = { budget: this.budget, heightPx: this.budget === 'mobile' ? 720 : 1080, aspect: 16 / 9 };
        if (view.tour) {
          const shared = await shareTerrainLanes(cpu.data);
          workerKey = `range:tour-worker:${view.id}`;
          const workerBytes = shared ? 1024 ** 2 : [...cpu.data.tiles.values()].reduce((n, t) => n + t.heightsM.byteLength + t.flowBytes.byteLength + (t.validMask?.byteLength || 0), 0);
          const workerReservation = this.residency?.reserve({ key: workerKey, bytes: workerBytes, owner: 'range-tour-worker', generation });
          if (this.residency && !workerReservation) throw new RangeAssetError('budget', 'No room for tour window worker');
          windowWorker = new TerrainWindowWorker({ data: cpu.data, tour: view.tour, view, rules, seed: hashSeed(view.terrainSourceId || view.id) });
          if (workerReservation && !this.residency.commit(workerReservation, windowWorker, w => w.dispose())) throw new RangeAssetError('stale', 'Tour worker cancelled');
          rawWindow = await windowWorker.build(0, windowOptions);
        }
        const placed = rawWindow?.placed || await placeForestAsync(cpu.data, view, rules, { seed: hashSeed(view.terrainSourceId || view.id), signal });
        if (stale()) throw new RangeAssetError('stale', `stale ${view.id}`);
        const forestBytes = placed.count * 7 * 4;
        // Building the surface texture needs temporary height and flow
        // arrays (6 B/px), its RGBA array (4 B/px) and dry receiver mask (1 B/px). The texture is
        // uploaded at once and drops its RGBA copy after the upload (see
        // createSurfaceTexture), so all eleven bytes are scratch, reserved
        // only while it is built: the view owns both GPU textures.
        const textureStride = view.tour ? (this.budget === 'mobile' ? 4 : 2) : 1;
        const gridPx = ((cpu.data.grid.width - 1) / textureStride + 1) * ((cpu.data.grid.height - 1) / textureStride + 1);
        const featureBudgetBytes = 3 * 768 * 6 * 4;
        // The bake's mesh estimate does not know the seam-fill index
        // buffers; their exact size is counted from the tile plan (no
        // geometry built), so the one reservation covers them and a view
        // that cannot fit is denied before the mesh is built.
        const fringeBytes = view.tour ? 0 : terrainFringeBytes(cpu.data, { budget: this.budget });
        const bytes = view.tour ? Math.ceil(gridPx * (4 * 4 / 3 + 1)) + featureBudgetBytes + ActorsGL.bytes()
          : (est?.meshBytes || 0) + fringeBytes + (est?.surfaceTextureBytes || 0) + gridPx + forestBytes + featureBudgetBytes + ActorsGL.bytes();
        res = this.residency?.reserve({ key: gpuKey, bytes, owner: 'range-terrain-gpu', generation }) || null;
        if (this.residency && !res) throw new RangeAssetError('budget', `no GPU room for ${view.id}`);
        if (rawWindow) {
          const windowBytes = Object.values(rawWindow.built.bands).reduce((n, b) => n + b.positions.byteLength + b.indices.byteLength + b.fringe.byteLength, 0) + forestBytes;
          windowReservation = this.residency?.reserve({ key: `range:tour-window:${view.id}:0`, bytes: windowBytes, owner: 'range-tour-window', generation, protect: [cpu.key, gpuKey, workerKey] });
          if (this.residency && !windowReservation) throw new RangeAssetError('budget', 'No room for initial tour window');
        }
        geos = createBandGeometries(THREE, cpu.data, { budget: this.budget, ...(rawWindow ? { built: rawWindow.built } : {}) });
        const scratchKey = `range:surface-scratch:${view.id}`;
        const scratch = this.residency?.reserve({ key: scratchKey, bytes: gridPx * 11, owner: 'range-scratch', generation }) || null;
        if (this.residency && !scratch) throw new RangeAssetError('budget', `no room to build ${view.id} surface`);
        try {
          surface = createSurfaceTexture(THREE, cpu.data, { stride: textureStride });
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
        depthMaterial = createDepthMaterial(THREE, uniforms);
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
        // During travel a side draws its nearer bands only in some columns,
        // so there the fill draws from its own scene under the same scissor.
        const fringeMeshes = [], fringeTravel = [];
        for (let b = 1; b < BANDS.length; b++) {
          const g = geos.fringes?.[BANDS[b]];
          if (!g) continue;
          const fm = new THREE.Mesh(g, material);
          fm.frustumCulled = false;
          scenes[BANDS[b - 1]].add(fm);
          fringeMeshes.push(fm);
          const travel = new THREE.Mesh(g, material);
          travel.frustumCulled = false;
          const scene = new THREE.Scene();
          scene.add(travel);
          fringeTravel.push({ band: BANDS[b], pass: BANDS[b - 1], scene });
        }
        material.depthFunc = THREE.LessEqualDepth;
        material.depthWrite = false;
        forest = createForest(THREE, placed, uniforms);
        if (resolveRangeComposition(view)?.foreground !== 'none') stageGL = new RockStageGL(THREE, { textures: mat.textures, palette: mat.pack.manifest.palette, rules });
        for (const band of BANDS) for (const m of forest.byBand[band]) scenes[band].add(m);
        for (const d of forest.depth) depthScene.add(d);
        // The cast: lanterns and swarms, moved between band scenes as they
        // travel (RangeActors.js picks their routes from what the rail sees).
        const waterLevelM = waterLevel(cpu.data);
        actors = new ActorsGL(THREE, uniforms);
        const routes = actorRoutes(cpu.data, view, { waterLevelM, seed: hashSeed(`${view.id}:cast`) });
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
        // Three's compile() creates programs but does not reject a failed
        // link. Check before publishing: otherwise trees draw over empty
        // terrain, while presentation incorrectly suppresses its fallback.
        const gl = this.renderer.getContext();
        for (const scene of [scenes.far, depthScene]) {
          const compiled = this.renderer.compile(scene, this.camera);
          for (const m of compiled) {
            for (const program of this.renderer.properties.get(m).programs.values()) {
              if (gl.getProgramParameter(program.program, gl.LINK_STATUS)) continue;
              if (gl.isContextLost()) throw new RangeAssetError('context-lost', `GPU context lost while compiling ${view.id}`);
              const log = (gl.getProgramInfoLog(program.program) || 'program link failed').trim().slice(0, 768);
              throw new RangeAssetError('shader', `${view.id}: ${log}`);
            }
          }
        }
        const prepared = {
          view, generation, manifest: cpu.manifest, data: cpu.data, identity: cpu.identity, tourCpuKey: opts.tourCpuKey,
          surface, uniforms, material, depthMaterial, geometries: geos.geometries, fringes: geos.fringes, fringeMeshes, fringeTravel, scenes, depthScene, depthScenes,
          forest, stageGL, featureGeometries, featureMaterial,
          stats: { ...geos.stats, trees: forest.counts, featureBytes: featureBudgetBytes }, gpuKey, cpuKey: cpu.key,
          giantLayout: giantLayout(cpu.data, view, [uniforms.uHeightRange.value.x, uniforms.uHeightRange.value.y], waterLevelM),
          rules, waterLevelM, mirrorLevelM: mirrorLevelFor(cpu.data, waterLevelM), materialKey: mat.key, actors, actorRoutes: routes,
        };
        if (windowWorker) {
          prepared.windowWorker = windowWorker;
          prepared.workerKey = workerKey;
          prepared.windowOptions = windowOptions;
          initialWindow = this._tourWindowResource(prepared, 0, geos, forest, windowReservation?.key);
          initialWindow.detail = rawWindow.plan;
          if (windowReservation && !this.residency.commit(windowReservation, initialWindow, w => w.destroy())) throw new RangeAssetError('stale', 'Initial window cancelled');
          prepared.windowCache = new TourWindowCache({ build: index => this._buildTourWindow(prepared, index) });
          prepared.windowCache.resident.set(0, initialWindow);
          prepared.windowIndex = 0;
          prepared.activeWindow = initialWindow;
        }
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
          if (windowReservation) this.residency?.release(windowReservation.key);
          if (workerKey) this.residency?.release(workerKey);
          if (!this.residency) windowWorker?.dispose();
          if (res) this.residency.release(res.key);
          if (mat) this._releaseMaterial(view.id);
          // The decoded terrain is only worth its ledger charge to a view
          // that publishes.
          this.residency?.release(cpu.key);
          if (!initialWindow) forest?.dispose();
          actors?.dispose();
          stageGL?.dispose();
          material?.dispose();
          depthMaterial?.dispose();
          featureMaterial?.dispose();
          for (const g of Object.values(featureGeometries)) g.dispose();
          surface?.texture?.dispose();
          surface?.receiverTexture?.dispose();
          if (!initialWindow) for (const g of Object.values(geos?.geometries || {})) g.dispose();
          if (!initialWindow) for (const g of Object.values(geos?.fringes || {})) g.dispose();
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

  /** A travel side's seam fill for one pass: each nearer band's border
   *  tiles, inside that band's own columns only. */
  _travelFringe(p, target, pass, bandColumns) {
    const r = this.renderer;
    const { width: W, height: H } = this.size;
    for (const f of p.fringeTravel || []) {
      const cols = f.pass === pass && bandColumns[f.band];
      if (!cols) continue;
      const x0 = Math.max(0, Math.floor(cols[0] * W)), x1 = Math.min(W, Math.ceil(cols[1] * W));
      if (!(x1 > x0)) continue;
      target.scissor.set(x0, 0, x1 - x0, H);
      target.scissorTest = true;
      r.setRenderTarget(target);
      r.render(f.scene, this.camera);
      target.scissorTest = false;
      r.setRenderTarget(target);
    }
  }

  /** Keep what the current frame draws resident: its view's GPU, CPU and
   *  material entries and the two render targets. */
  pinView(viewIds, extraKeys = []) {
    if (!this.residency) return;
    const keys = ['range:render-target', 'range:ground-target', 'range:render-target-B', ...extraKeys];
    for (const id of [].concat(viewIds)) {
      const p = this.prepared.get(id);
      if (p) keys.push(p.gpuKey, p.cpuKey, p.materialKey, p.workerKey, p.tourCpuKey, ...[...(p.windowCache?.resident.values() || [])].map(w => w.key));
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
    p.windowCache?.dispose();
    for (const entry of p.rawAhead?.values() || []) this.residency?.release(entry.key);
    if (p.workerKey && this.residency) this.residency.release(p.workerKey); else p.windowWorker?.dispose();
    if (!p.windowCache) p.forest?.dispose();
    p.actors?.dispose();
    p.stageGL?.dispose();
    if (!p.windowCache) for (const g of Object.values(p.geometries || {})) g.dispose();
    if (!p.windowCache) for (const g of Object.values(p.fringes || {})) g.dispose();
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
  /** Ground height the camera must clear: the DEM plus a glacier view's
   *  ice at this frame's retreat, as TerrainMaterial raises it. */
  _renderedGround(view, frame, data) {
    const ice = view.glacier, retreat01 = frame.glacier?.retreat01 ?? 0;
    return (x, z) => {
      const bed = terrainHeightAt(data, x, z);
      return ice ? glacierSample(ice, x, z, bed, retreat01).surfaceM : bed;
    };
  }

  /** This frame's camera for a view: the rail pose, the lens, and the pose
   *  after the section move and the listener's zoom, lifted clear of the
   *  rendered ground. Computed once per frame and view and shared by the
   *  partition passes and the sky (RangePresentation._skyPan). */
  movedPose(view, frame, p = this.prepared.get(view.id) || null) {
    this._ensureTourWindow(p, frame.timeMs);
    const baseRail = scenePoseAt(view, { progress01: view.glacier && !frame.reducedMotion ? (frame.glacier?.journey01 ?? frame.progress01) : frame.progress01, timeMs: frame.timeMs });
    const rail = { ...baseRail, fovYDeg: applyLensFov(baseRail.fovYDeg, frame.cameraEffects) };
    const proj = scenicProjection(rail.fovYDeg, frame.scenicViewport);
    // This view's VISIBLE frustum (the overscan margin excluded): the
    // pointer is normalised against the visible stage, and the zoom must
    // stay inside this view's own cone from its very first frame.
    const vp = frame.scenicViewport, m = vp.overscanPx || 0;
    const visW = Math.max(1, vp.logicalWidth - 2 * m), visH = Math.max(1, vp.logicalHeight - 2 * m);
    const tanY = Math.tan((proj.fovYDeg * Math.PI) / 360) * (visH / vp.logicalHeight), tanX = tanY * (visW / visH);
    // Cinematic section moves and the listener's zoom (RangeCamera.js),
    // computed once per frame and view: the partition passes reuse it.
    let poses = this._movedPoses.get(frame);
    if (!poses) this._movedPoses.set(frame, poses = new Map());
    let pose = poses.get(view.id);
    if (!pose) {
      pose = applyCameraMoves(rail, frame.cameraMove, frame.userCamera, {
        heightAt: p?.data ? this._renderedGround(view, frame, p.data) : null, waterLevelM: p?.waterLevelM,
        sampleStepM: p?.data?.grid?.cellSizeM, cone: { tanX, tanY },
        heightRangeM: p?.uniforms ? [p.uniforms.uHeightRange.value.x, p.uniforms.uHeightRange.value.y] : null });
      poses.set(view.id, pose);
    }
    return { rail, proj, pose, tanX, tanY };
  }

  _setCamera(view, frame, p = null) {
    const { proj, pose, tanX, tanY } = this.movedPose(view, frame, p);
    const cam = this.camera;
    if (frame.userCamera) rangeUserCamera.noteFrame({ tanX, tanY, userScale: pose.userScale, frameId: frame.frameId });
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
    m.gusts.forEach((g, i) => { u.uGustAge.value[i] = g.ageSec; u.uGustAmp.value[i] = g.amp01 * (1 + (frame.storm?.amount || 0) * .8); u.uGustDir.value[i] = g.dir; });
    u.uForestKeep.value = rangeQuality(frame.qualityLevel).forestKeep;
        for (const objects of Object.values(p.forest?.byBand || {})) for (const tree of objects) tree.visible = !n || n.materials > .01;
    for (const tree of p.forest?.depth || []) tree.visible = !n || n.materials > .01;
    for (const objects of Object.values(p.forest?.depthByBand || {})) for (const tree of objects) tree.visible = !n || n.materials > .01;
    const c = frame.light.celestial;
    // Unproject the celestial's stage position into a world direction.
    const ndcX = c.xFrac * 2 - 1, ndcY = 1 - c.yFrac * 2;
    const dir = c.worldDirection ? new THREE.Vector3(...c.worldDirection) : new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    u.uLightDir.value.copy(dir.normalize());
    const night = frame.light.night01;
    const storm = frame.storm || { amount: 0, flash: 0, wet01: 0, break01: 0 };
    const strength = c.body ? c.intensity : 0;
    hexToLinear(THREE, c.colorHex, u.uLightColor.value).multiplyScalar(strength);
    // Receiver fill fades once; sky radiance also feeds air and water's
    // reflection, so it keeps the frame's authored environment colors.
    u.uAmbientScale.value = 2.5 * (frame.light.ambientMultiplier ?? 1);
    u.uStorm.value.set(storm.amount, storm.flash, storm.break01, storm.wet01);
    // Under the squall the sun is gone behind the deck; the sky's own
    // (darkened, below) radiance is most of what lights the land.
    u.uLightColor.value.multiplyScalar(1 - storm.amount * .92);
    u.uLightColor.value.add(new THREE.Color(.65, .77, 1).multiplyScalar(storm.flash * 1.6));
    u.uAmbientScale.value *= 1 - storm.amount * .15;
    // Lightning lights the land from inside the deck, where the sky draws it.
    // The rain veil projects through the main camera on every view, mirror or not.
    u.uViewProj.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const skyPan = this.skyPan || { x: 0, y: 0 };
    u.uRainShift.value = (skyPan.x || 0) / 2;
    if (storm.flash > 0) {
      const fx = ((storm.flashU ?? .5) + u.uRainShift.value) * 2 - 1;
      const flashDir = new THREE.Vector3(fx, .7, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
      u.uLightDir.value.lerp(flashDir, Math.min(1, storm.flash * 3)).normalize();
    }
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
    if (storm.amount > 0 || storm.break01 > 0) {
      // Slate storm light in the sky, the air and the water's reflection;
      // thick rain air under the squall, then rain-washed clarity after it.
      const k = storm.amount * .95;
      u.uSkyZenith.value.lerp(STORM_ZENITH, k);
      u.uSkyHorizon.value.lerp(STORM_HORIZON, k);
      u.uAirColor.value.lerp(STORM_AIR, k).add(new THREE.Color(.65, .77, 1).multiplyScalar(storm.flash * .35));
      u.uAirDensity.value *= 1 + storm.amount * .6 - storm.break01 * .35;
    }
    const amounts = giantAmounts(frame);
    const layout = p.giantLayout;
    if (layout) {
      u.uGiantPeak.value = amounts;
      layout.centers.forEach((center, i) => u.uGiantCenter.value[i].set(...center));
      layout.skyCenters.forEach((center, i) => u.uSkyGiantCenter.value[i].set(...center));
      u.uGiantSpan.value = layout.spans;
      if (layout.hasLake) {
        const eye = this.camera.position.toArray();
        const center = aheadOfEye(layout.centers[0], eye, layout.forward, MIDIO_MIN_AHEAD_M);
        u.uGiantCenter.value[0].set(center[0], p.waterLevelM, center[2]);
        const bottom = new THREE.Vector3(0, -.92, .5).unproject(this.camera).sub(this.camera.position);
        u.uGiantSpan.value = [mirrorGiantSpan(eye, bottom.toArray(), center,
          p.waterLevelM, MIRROR_LIFT, layout.spans[0]), ...layout.spans.slice(1)];
      }
      u.uMirrorAspect.value = layout.hasLake ? 1 / MIRROR_LIFT : 1;
      u.uSkyGiantSpan.value = layout.skySpan;
      u.uGiantRight.value.set(...layout.right); u.uGiantForward.value.set(...layout.forward);
      // Broshi's lantern is carried just behind the viewer, so his shadow
      // lands on the range in his own proportions (a Brocken spectre).
      u.uShadowEye.value.copy(this.camera.position);
      u.uMidioCloud.value = layout.hasLake && Number.isFinite(p.mirrorLevelM) ? 0 : 1;
      u.uGiantTime.value = frame.reducedMotion ? 0 : frame.timeMs / 1000;
    }
    // Valley mist: anchored at the view's water level, thicker in calm.
    const mp = mistParams({ rules: p.rules, waterLevelM: p.waterLevelM, heightRange: [u.uHeightRange.value.x, u.uHeightRange.value.y],
      tSec: frame.reducedMotion ? 0 : frame.timeMs / 1000, calm01: 1 - (frame.music?.groove ?? 0),
      sea01: Math.max(frame.cloudSea01 ?? 0, amounts[2] * .3, u.uMidioCloud.value * amounts[0] * .3), cameraY: this.camera.position.y });
    const quality = rangeQuality(frame.qualityLevel);
    if (p.view.tour) {
      mp.topM = Math.min(mp.topM, this.camera.position.y - 120, p.mistRouteCap ?? Infinity);
      if (mp.topM - mp.baseM < 40) { mp.fill = 0; mp.density = 0; }
    }
    u.uMistDensity.value = mp.density * (n?.atmosphere ?? 1);
    u.uMistSteps.value = quality.mistSteps;
    u.uMistBase.value = mp.baseM;
    u.uMistHeight.value = mp.heightM;
    u.uMistTime.value = mp.tSec;
    mistDrift(mp.tSec).forEach((d, i) => u.uMistDrift.value[i].set(d[0], d[1]));
    u.uMistTop.value = mp.topM;
    u.uMistFill.value = mp.fill;
    // Lit mist: the air's colour lifted toward the key light (display domain).
    u.uMistColor.value.copy(u.uAirColor.value).multiplyScalar(1.2).add(u.uLightColor.value.clone().multiplyScalar(0.06));
    u.uMistColor.value.r = Math.min(0.9, u.uMistColor.value.r);
    u.uMistColor.value.g = Math.min(0.9, u.uMistColor.value.g);
    u.uMistColor.value.b = Math.min(0.9, u.uMistColor.value.b);
    u.uCameraPos.value.copy(this.camera.position);
    u.uTourEnabled.value = p.view.tour ? 1 : 0;
    u.uTourEye.value.copy(this.camera.position);
    this._setCloudUniforms(p, frame);
    this._setActors(p, frame);
  }

  _setCloudUniforms(p, frame) {
    const u = p.uniforms;
    if (!u.uCloudCount) return;
    u.uMoonClouds.value = frame.light?.celestial?.body === 'moon' ? 1 : 0;
    u.uCloudCount.value = 0;
    if (!this.skyClouds || !u.uMoonClouds.value) return;
    const e = this.camera.matrixWorld.elements;
    const right = [e[0], e[1], e[2]], up = [e[4], e[5], e[6]], forward = [-e[8], -e[9], -e[10]];
    const eyeM = this.camera.position.toArray();
    const pose = { eyeM, targetM: eyeM.map((v,k) => v + forward[k]), fovYDeg: this.camera.fov };
    const puffs = cloudPuffs(this.skyClouds.banks, { ...this.skyClouds.options, pose });
    u.uCloudRight.value.set(...right); u.uCloudUp.value.set(...up); u.uCloudForward.value.set(...forward);
    u.uCloudCount.value = puffs.length;
    puffs.forEach((puff,i) => {
      u.uCloudCenterRadius.value[i].set(...puff.centerM, puff.radiusXM);
      u.uCloudShape.value[i].set(puff.radiusYM, puff.opacity);
    });
  }

  /**
   * Place the cast for this frame: each actor's lantern and swarm on its
   * route (in the band scene that owns the ground under it), its light in
   * the shared uniforms, Midio's wake and Broshi's parting. Absent actors
   * (no route, no score yet, before the scene arrives) give no light.
   */
  _setActors(p, frame) {
    const THREE = this.THREE;
    const u = p.uniforms;
    const cast = frame.actors;
    const cam = this.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    // Metres per stage pixel (the looks are sized for a 720 px stage).
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    const materials = frame.narrative?.materials ?? 1;
    const tSec = frame.reducedMotion ? 0 : frame.timeMs / 1000;
    // The lights carry the dark: brightest before dawn and after sunset,
    // a soft shimmer at noon.
    const dark = Math.min(1, Math.max(0, frame.light?.night01 ?? 0));
    u.uWakeAmt.value = 0;
    u.uParting.value.w = 0;
    ACTOR_IDS.forEach((id, k) => {
      const group = p.actors?.groups[id];
      const route = p.actorRoutes?.[id];
      const s = cast?.[id];
      const look = ACTOR_LOOK[id];
      const presence = (cast?.presence ?? 0) * (materials > .01 ? materials : 0);
      const pos = route && s && presence > 0.001
        ? routePosition(route, s.travel + (ACTOR_START[id] || 0), { data: p.data, waterLevelM: p.waterLevelM, hoverM: look.hoverM, bobSec: tSec + k * 2.1 }) : null;
      u.uActorColor.value[k].set(0, 0, 0);
      if (!group) return;
      if (!pos) { group.visible = false; return; }
      const at = new THREE.Vector3(pos[0], pos[1], pos[2]);
      const dist = Math.max(1, at.distanceTo(cam.position));
      const peak = frame.reducedFlash ? s.peak * 0.7 : s.peak;
      const display = new THREE.Color().setHSL(ACTOR_HUES[id] / 360, 0.85, 0.62);
      // Light: linear, stronger as the lane plays and at its peak.
      const lin = display.clone().convertSRGBToLinear();
      const gain = look.lightGain * (0.35 + 0.65 * s.glow + 0.5 * peak) * presence * (0.45 + 1.15 * dark);
      u.uActorPos.value[k].copy(at);
      u.uActorColor.value[k].set(lin.r * gain, lin.g * gain, lin.b * gain);
      u.uActorRadius.value[k] = look.lightM;
      // The lantern and swarm draw a little toward the camera from the
      // light itself, so the ground it hovers over does not cut its halo.
      const mpp0 = (2 * dist * tanHalf) / 720;
      const push = Math.min(dist * 0.25, 3 * look.haloPx * mpp0);
      const toCam = cam.position.clone().sub(at).normalize();
      const v = p.actors.uniforms[id];
      v.uCenter.value.copy(at).addScaledVector(toCam, push);
      v.uRight.value.copy(right);
      v.uUp.value.copy(up);
      v.uMpp.value = mpp0 * (dist - push) / dist;
      v.uHaloPx.value = look.haloPx;
      v.uColor.value.copy(display);
      v.uGlow.value = s.glow;
      v.uPresence.value = presence * (0.55 + 0.45 * dark);
      v.uCohere.value = peak;
      v.uTime.value = tSec + k * 37;
      v.uWanderPx.value = look.wanderPx * (1 + 0.5 * s.glow);
      v.uShapePx.value = look.shapePx;
      v.uShapeLift.value = route.kind === 'air' ? 0 : 0.6;
      // Companions trail along the same route, each a little behind and
      // weaving about it.
      (p.actors.companions[id] || []).forEach((c, j) => {
        const lag = routePosition(route, s.travel + (ACTOR_START[id] || 0) - (j + 1) * 0.5,
          { data: p.data, waterLevelM: p.waterLevelM, hoverM: look.hoverM, bobSec: tSec + j * 1.3 });
        const w = tSec * (0.7 + 0.2 * j) + j * 2.1;
        const cp = new THREE.Vector3(lag[0], lag[1], lag[2])
          .addScaledVector(right, Math.sin(w) * 18 * mpp0).addScaledVector(up, Math.cos(w * 1.3) * 10 * mpp0);
        const cd = Math.max(1, cp.distanceTo(cam.position));
        const cpush = Math.min(cd * 0.25, 30 * mpp0);
        c.uCenter.value.copy(cp).addScaledVector(cam.position.clone().sub(cp).normalize(), cpush);
        c.uMpp.value = mpp0 * (cd - cpush) / cd;
        c.uGlow.value = s.glow * 0.6;
      });
      group.visible = true;
      const tile = this._tileAt(p.data, pos[0], pos[2]);
      const band = BANDS.includes(tile?.band) ? tile.band : 'far';
      if (group.parent !== p.scenes[band]) p.scenes[band].add(group);
      if (id === 'midio' && route.kind === 'water' && Number.isFinite(cast.midio.trail)) {
        const tail = routePosition(route, cast.midio.trail, { data: p.data, waterLevelM: p.waterLevelM });
        u.uWake.value.set(pos[0], pos[2], tail[0], tail[2]);
        u.uWakeAmt.value = presence * (0.3 + 0.7 * s.glow);
      }
      if (id === 'broshi') u.uParting.value.set(pos[0], pos[2], 90, presence * (0.35 + 0.65 * s.glow));
    });
  }

  _tileAt(data, x, z) {
    const { grid, cells } = data;
    const ix = Math.floor((x - grid.originM[0]) / grid.cellSizeM / cells);
    const iz = Math.floor((z - grid.originM[1]) / grid.cellSizeM / cells);
    return data.byIndex.get(`${ix},${iz}`) || null;
  }

  // Atmosphere has its own copy boundary. It must never enter the terrain
  // alpha mask consumed by crest light and the sampled mountain skyline.
  renderSkyGiants() { return null; }

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
    this._setCamera(p.view, frame, p);
    this._setUniforms(p, frame);
    this._prepareMirror(p, frame, side, viewId);
    // The backdrop holds the far partition itself: far water reflecting it
    // would feed back into the next copy, so it keeps the ground mirror only.
    if (pass === 'far') p.uniforms.uBackdropAmount.value = 0;
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
    // During travel a side's nearer bands draw only in some columns: its
    // seam fill draws there too (below), never over ground the other side
    // owns.
    for (const fm of p.fringeMeshes || []) fm.visible = !bandColumns;
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    p.uniforms.uDiag.value = this.diag === 'markers' && pass === 'far' ? 1 : 0;
    r.render(p.scenes[pass], this.camera);
    if (bandColumns) this._travelFringe(p, target, pass, bandColumns);
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
    // A lightning flash lights the stage from its strike, as it does the land.
    const storm = frame.storm, strike = Math.min(1, (storm?.flash || 0) * 3);
    const key = strike > 0 ? { x: frame.light.ground.x + (((storm.flashU ?? .5) + (u.uRainShift?.value || 0)) * vp.logicalWidth - frame.light.ground.x) * strike,
      y: frame.light.ground.y + (vp.logicalHeight * .15 - frame.light.ground.y) * strike } : frame.light.ground;
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
    this.releaseBackdrop();
    this.releaseMirror('A');
    this.releaseMirror('B');
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
      windows: [...this.prepared.values()].filter(p=>p.windowCache).map(p=>({id:p.view.id,index:p.windowIndex,resident:[...p.windowCache.resident.keys()],detail:p.activeWindow?.detail,note:p.windowNote,stats:p.stats})),
      size: { ...this.size }, stats: { ...this.stats }, sideB: !!this.sideTargets.B,
    };
  }

  dispose() {
    this.releaseShafts();
    this.releaseBackdrop();
    this.releaseMirror('A');
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
