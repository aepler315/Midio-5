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
import { sceneUniforms, createSceneMaterial, createDepthMaterial, setLinearFromHex, createMaterialTextures, applyMaterial } from './TerrainMaterial.js';
import { loadMaterialPack, materialGpuBytes } from './MaterialPackage.js';
import { placeForest, forestKeepFraction } from './ForestCover.js';
import { hashSeed } from '../../utils/math.js';
import { createForest } from './ForestGL.js';
import { buildRockStage } from './RockStage.js';
import { RockStageGL } from './RockStageGL.js';
import { cameraPoseAt } from '../terrain/SceneTravel.js';
import { BANDS } from './TerrainMesh.js';
import { mistParams } from './RangeAtmosphere.js';

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
    this.pending = new Map(); // viewId -> Promise
    this.target = null;
    this.size = { width: 0, height: 0 };
    this.contextLost = false;
    this.lastDepthFrame = -1;
    this.stats = { depthPasses: 0, partitions: 0, lastPartitionMs: 0 };
    this._copy = this._createCopy();
    this.canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; });
    this.canvas.addEventListener?.('webglcontextrestored', () => { this.contextLost = false; this._restore(); });
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
    const key = 'range:render-target';
    this.residency?.release(key);
    this.target?.dispose();
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
    this.lastDepthFrame = -1;
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
  prepare(view, { signal = null, generation = 0, baseUrl, isCurrent = () => true } = {}) {
    if (this.prepared.has(view.id)) return Promise.resolve(this.prepared.get(view.id));
    if (this.pending.has(view.id)) return this.pending.get(view.id);
    const job = (async () => {
      const cpu = await prepareTerrainAssets(view, { baseUrl, residency: this.residency, generation, signal, isCurrent });
      if (signal?.aborted || !isCurrent(generation)) throw new RangeAssetError('stale', `stale ${view.id}`);
      const THREE = this.THREE;
      const est = cpu.manifest.estimatedBytes?.[this.budget];
      const gpuKey = `range:terrain-gpu:${view.id}:${this.budget}`;
      // The verified material pack comes first: its rules place the trees,
      // which are placed on the CPU (a stable lattice) so their instance
      // buffers are counted in the same GPU reservation.
      const mat = await this._acquireMaterial(view, { baseUrl, signal });
      if (signal?.aborted || !isCurrent(generation)) { this._releaseMaterial(view.id); throw new RangeAssetError('stale', `stale ${view.id}`); }
      const rules = { ...mat.pack.manifest.rules, ...(view.materialRules || {}) };
      const placed = placeForest(cpu.data, view, rules, { seed: hashSeed(view.id) });
      const forestBytes = placed.count * 7 * 4;
      const bytes = (est?.meshBytes || 0) + (est?.surfaceTextureBytes || 0) + forestBytes;
      const res = this.residency?.reserve({ key: gpuKey, bytes, owner: 'range-terrain-gpu', generation });
      if (this.residency && !res) { this._releaseMaterial(view.id); throw new RangeAssetError('budget', `no GPU room for ${view.id}`); }
      let surface, geos, material, forest, stageGL;
      try {
        surface = createSurfaceTexture(THREE, cpu.data);
        const base = terrainUniforms(THREE, cpu.data, surface);
        const uniforms = sceneUniforms(THREE, base);
        applyMaterial(uniforms, mat.pack, mat.textures, view.materialRules || {});
        material = createSceneMaterial(THREE, uniforms);
        const depthMaterial = createDepthMaterial(THREE, uniforms);
        geos = createBandGeometries(THREE, cpu.data, { budget: this.budget });
        const meshes = {}, depthMeshes = {}, scenes = {};
        const depthScene = new THREE.Scene();
        for (const band of BANDS) {
          meshes[band] = new THREE.Mesh(geos.geometries[band], material);
          meshes[band].frustumCulled = false;
          scenes[band] = new THREE.Scene();
          scenes[band].add(meshes[band]);
          depthMeshes[band] = new THREE.Mesh(geos.geometries[band], depthMaterial);
          depthMeshes[band].frustumCulled = false;
          depthScene.add(depthMeshes[band]);
        }
        material.depthFunc = THREE.LessEqualDepth;
        material.depthWrite = false;
        forest = createForest(THREE, placed, uniforms);
        stageGL = new RockStageGL(THREE, { textures: mat.textures, palette: mat.pack.manifest.palette, rules });
        for (const band of BANDS) for (const m of forest.byBand[band]) scenes[band].add(m);
        for (const d of forest.depth) depthScene.add(d);
        // Compile now, not in the first playing frame.
        this.renderer.compile(scenes.far, this.camera);
        this.renderer.compile(depthScene, this.camera);
        const prepared = {
          view, generation, manifest: cpu.manifest, data: cpu.data, identity: cpu.identity,
          surface, uniforms, material, depthMaterial, geometries: geos.geometries, scenes, depthScene,
          forest, stageGL, stats: { ...geos.stats, trees: forest.counts }, gpuKey, cpuKey: cpu.key,
          rules, waterLevelM: waterLevel(cpu.data),
        };
        if (signal?.aborted || !isCurrent(generation)) throw new RangeAssetError('stale', `stale ${view.id}`);
        if (res && !this.residency.commit(res, prepared, (p) => this._disposePrepared(p))) {
          throw new RangeAssetError('stale', `generation ${generation} cancelled during ${view.id}`);
        }
        this.prepared.set(view.id, prepared);
        return prepared;
      } catch (err) {
        if (res) this.residency.release(gpuKey);
        this._releaseMaterial(view.id);
        forest?.dispose();
        stageGL?.dispose();
        material?.dispose();
        surface?.texture?.dispose();
        for (const g of Object.values(geos?.geometries || {})) g.dispose();
        throw err;
      }
    })();
    this.pending.set(view.id, job);
    job.finally(() => this.pending.delete(view.id)).catch(() => {});
    return job;
  }

  /** One GPU copy per material pack, shared by the views that use it. */
  async _acquireMaterial(view, { baseUrl, signal }) {
    const url = new URL(view.materialManifestUrl, baseUrl).href;
    const hit = this.materials.get(url);
    if (hit) { hit.users.add(view.id); return hit; }
    const pack = await loadMaterialPack(url, { signal });
    const key = `range:material:${pack.manifest.id}`;
    const res = this.residency?.reserve({ key, bytes: materialGpuBytes(pack.manifest), owner: 'range-material', generation: 0 });
    if (this.residency && !res) {
      for (const img of pack.images.values()) img.close?.();
      throw new RangeAssetError('budget', `no room for material ${pack.manifest.id}`);
    }
    const textures = createMaterialTextures(this.THREE, pack);
    const entry = { url, pack, textures, key, users: new Set([view.id]) };
    if (res) this.residency.commit(res, entry, () => { textures.dispose(); for (const img of pack.images.values()) img.close?.(); });
    this.materials.set(url, entry);
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
    p.forest?.dispose();
    p.stageGL?.dispose();
    for (const g of Object.values(p.geometries || {})) g.dispose();
    p.surface?.texture?.dispose();
    p.material?.dispose();
    p.depthMaterial?.dispose();
  }

  /** Release one view's GPU and CPU ownership. */
  release(viewId) {
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
    const pose = cameraPoseAt(view, frame.progress01);
    const vp = frame.scenicViewport;
    const nominalH = vp.nominalHeight || 720;
    const cam = this.camera;
    const tanHalf = Math.tan((pose.fovYDeg * Math.PI) / 360) * (vp.logicalHeight / nominalH);
    cam.fov = (2 * Math.atan(tanHalf) * 180) / Math.PI;
    cam.aspect = vp.logicalWidth / vp.logicalHeight;
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
    const m = frame.music;
    u.uDeformAmp.value = m.amplitudeM;
    u.uDeformKick.value = m.kickM;
    u.uDeformK.value = m.waveK;
    u.uDeformDir.value.set(m.waveDir[0], m.waveDir[1]);
    u.uDeformPhase.value = m.phaseRad;
    u.uTime.value = frame.timeMs / 1000;
    u.uForestKeep.value = forestKeepFraction(frame.qualityLevel);
    const c = frame.light.celestial;
    // Unproject the celestial's stage position into a world direction.
    const ndcX = c.xFrac * 2 - 1, ndcY = 1 - c.yFrac * 2;
    const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    if (dir.y < 0.05) dir.y = 0.05;
    u.uLightDir.value.copy(dir.normalize());
    const night = frame.light.night01;
    const strength = (c.body === 'sun' ? 1.6 : 0.55) * Math.max(0.15, c.intensity) * (0.35 + 0.65 * Math.min(1, c.altitude01 * 3));
    hexToLinear(THREE, c.colorHex, u.uLightColor.value).multiplyScalar(strength);
    if (frame.light.sky) {
      hexToLinear(THREE, frame.light.sky.top, u.uSkyZenith.value).multiplyScalar(0.9);
      hexToLinear(THREE, frame.light.sky.horizon, u.uSkyHorizon.value).multiplyScalar(0.9);
      hexToLinear(THREE, frame.light.sky.air || frame.light.sky.horizon, u.uAirColor.value);
    }
    u.uAirDensity.value = (1 / 55000) * (1 + 0.6 * night);
    // Valley mist: anchored at the view's water level, thicker in calm.
    const mp = mistParams({ rules: p.rules, waterLevelM: p.waterLevelM, heightRange: [u.uHeightRange.value.x, u.uHeightRange.value.y],
      tSec: frame.timeMs / 1000, calm01: 1 - (frame.music?.groove ?? 0) });
    u.uMistDensity.value = frame.qualityLevel >= 5 ? mp.density * 0.6 : mp.density;
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
  renderPartition(frame, pass, viewId = frame.viewFromId) {
    const p = this.prepared.get(viewId);
    if (!p || this.contextLost || !this.target) return null;
    const t0 = performance.now();
    const r = this.renderer;
    if (this.lastDepthFrame !== frame.frameId || this.lastDepthView !== viewId) {
      this._setCamera(p.view, frame);
      this._setUniforms(p, frame);
      r.setRenderTarget(this.target);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(p.depthScene, this.camera);
      this.lastDepthFrame = frame.frameId;
      this.lastDepthView = viewId;
      this.stats.depthPasses++;
    }
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    p.uniforms.uDiag.value = this.diag === 'markers' && pass === 'far' ? 1 : 0;
    r.render(p.scenes[pass], this.camera);
    r.setRenderTarget(null);
    this._setCanvasSize(this.size.width, this.size.height);
    r.clear(true, true, false);
    this._copy.mesh.material.uniforms.uColor.value = this.target.texture;
    r.render(this._copy.scene, this._copy.camera);
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
    const p = this.prepared.get(viewId);
    if (!p || this.contextLost) return null;
    const vp = frame.groundViewport;
    const w = Math.max(2, Math.round(vp.backingWidth)), h = Math.max(2, Math.round(vp.backingHeight));
    if (!this.groundTarget || this.groundTarget.width !== w || this.groundTarget.height !== h) {
      const key = 'range:ground-target';
      this.residency?.release(key);
      this.groundTarget?.dispose();
      const res = this.residency?.reserve({ key, bytes: w * h * 8, owner: 'range-targets' });
      if (this.residency && !res) return null;
      const THREE = this.THREE;
      this.groundTarget = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      if (res) this.residency.commit(res, this.groundTarget, (t) => t.dispose());
    }
    const stage = buildRockStage({ bars: frame.groundBars, width: vp.logicalWidth, height: vp.logicalHeight,
      worldX: frame.worldX, originX: frame.originX, seed: frame.seed });
    const u = p.uniforms;
    // The scene's key light, re-expressed for the stage: from behind and
    // above, on the celestial's side of the frame.
    const THREE = this.THREE;
    const c = frame.light.celestial;
    const lightDir = new THREE.Vector3((0.5 - c.xFrac) * 1.4, 0.55 + 0.6 * c.altitude01, -0.45).normalize();
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

  _restore() {
    // Context restored: GPU objects are gone. Drop preparations so the
    // presentation re-prepares them; legacy draws meanwhile.
    for (const id of [...this.prepared.keys()]) this.release(id);
    this.size = { width: 0, height: 0 };
    this.target = null;
  }

  snapshot() {
    return {
      prepared: [...this.prepared.keys()], pending: [...this.pending.keys()], contextLost: this.contextLost,
      size: { ...this.size }, stats: { ...this.stats },
    };
  }

  dispose() {
    for (const id of [...this.prepared.keys()]) this.release(id);
    this.residency?.release('range:render-target');
    this.residency?.release('range:ground-target');
    this.target?.dispose();
    this.groundTarget?.dispose();
    this._copy.mesh.geometry.dispose();
    this._copy.mesh.material.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
