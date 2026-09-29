// Range v2 rock stage on the GPU (Task 11). An orthographic camera mapped
// 1:1 onto the fixed-ground logical stage (y down), so the returned image
// composes under the ground transform exactly once. Geometry comes from
// RockStage.buildRockStage each frame (the support curve moves with the
// music); materials are the pack's stage data maps under its palette.
// Local light: the cast's own glows light the rock around them (up to 3
// emitters, in the same fixed-ground coordinates as their bodies).
import { setLinearFromHex } from './TerrainMaterial.js';

const VERT = /* glsl */`
  in float surface;
  in vec2 stageUv;
  out vec3 vN;
  out vec2 vUv;
  out vec2 vXY;
  out float vSurface;
  out float vDepth;
  void main() {
    vN = normal;
    vUv = stageUv;
    vXY = position.xy;
    vSurface = surface;
    vDepth = position.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(position.xy, position.z, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tStage;  uniform float sStage;
  uniform sampler2D tWet;    uniform float sWet;
  uniform sampler2D tSoil;   uniform float sSoil;
  uniform vec3 pRockLit; uniform vec3 pRockShade; uniform vec3 pWetRock; uniform vec3 pMoss; uniform vec3 pSoil; uniform vec3 pLichen;
  uniform vec3 uKeyDir; uniform vec3 uKeyColor; uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon;
  uniform float uAmbientScale; uniform float uExposure; uniform float uMoss;
  uniform vec4 uEmitters[3];      // x, y (logical px), radius px, intensity
  uniform vec3 uEmitterColor[3];  // linear
  uniform vec4 uPools[8];         // cx, cy, rx, ry  (logical px)
  uniform float uPoolAlpha[8];
  uniform float uDiag;
  in vec3 vN; in vec2 vUv; in vec2 vXY; in float vSurface; in float vDepth;
  out vec4 outColor;
  vec3 tonemap(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  void main() {
    bool riser = vSurface > 0.5;
    vec4 st = texture(tStage, vUv / sStage);
    vec4 so = texture(tSoil, vUv / sSoil);
    vec2 dn = (st.rg * 2.0 - 1.0);
    vec3 n = normalize(vN + (riser ? vec3(dn.x, dn.y, 0.0) : vec3(dn.x, 0.0, -dn.y)) * 0.9);
    // Moss gathers in low relief of the slab tops and along riser lips.
    float lip = riser ? 0.0 : smoothstep(0.72, 0.98, fract(vDepth * 7.0));
    float moss = uMoss * smoothstep(0.42, 0.2, st.a) * (riser ? 0.25 : 1.0);
    moss = clamp(moss + lip * 0.25 * uMoss + smoothstep(0.55, 0.8, so.a) * 0.2 * uMoss, 0.0, 1.0);
    // Damp ring around pools (the water itself is drawn separately).
    float damp = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 p = uPools[i];
      if (p.z <= 0.0) continue;
      vec2 q = (vXY - p.xy) / (p.zw * vec2(1.35, 2.2));
      damp = max(damp, uPoolAlpha[i] * (1.0 - smoothstep(0.7, 1.0, length(q))));
    }
    vec3 rock = mix(pRockShade, pRockLit, clamp(st.a * 1.15 - 0.05, 0.0, 1.0));
    rock = mix(rock, pLichen, 0.18 * smoothstep(0.6, 0.9, so.a));
    vec3 albedo = mix(rock, pMoss, moss);
    albedo = mix(albedo, pWetRock, damp * 0.8);
    if (riser) albedo *= 0.62;
    float rough = mix(st.b, 0.25, damp);
    float wrap = 0.2;
    float key = max((dot(n, uKeyDir) + wrap) / (1.0 + wrap), 0.0);
    vec3 hemi = mix(uSkyHorizon * 0.5, uSkyZenith, 0.5 + 0.5 * n.y) * uAmbientScale;
    vec3 lit = albedo * (hemi * (riser ? 0.55 : 1.0) + uKeyColor * key);
    // Local emitters: compact, material-dependent (wet rock returns more).
    for (int i = 0; i < 3; i++) {
      vec4 e = uEmitters[i];
      if (e.w <= 0.0) continue;
      vec2 d = vXY - e.xy;
      float fall = max(0.0, 1.0 - length(d) / e.z);
      fall *= fall;
      vec3 l = normalize(vec3(-d.x, max(8.0, e.z * 0.25), riser ? e.z * 0.3 : -d.y * 0.2));
      float face = max(dot(n, l), 0.0);
      lit += albedo * uEmitterColor[i] * e.w * fall * face * (1.0 + 1.5 * damp) * 3.0;
      lit += uEmitterColor[i] * e.w * fall * damp * 0.35 * pow(1.0 - rough, 2.0);
    }
    vec3 color = tonemap(lit * uExposure);
    outColor = vec4(pow(max(color, 0.0), vec3(1.0 / 2.2)), 1.0);
    if (uDiag > 0.5) outColor = vec4(0.0, 1.0, 1.0, 1.0);
  }
`;

const WATER_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon; uniform vec3 pWater; uniform vec3 pWaterDeep;
  uniform float uExposure; uniform float uTime;
  uniform float uAlpha;
  uniform vec4 uEmitters[3]; uniform vec3 uEmitterColor[3];
  in vec2 vXY;
  out vec4 outColor;
  vec3 tonemap(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  void main() {
    // Shallow water seen at a grazing angle: mostly sky, a little bed.
    float ripple = 0.5 + 0.5 * sin(vXY.x * 0.09 + uTime * 1.3) * sin(vXY.y * 0.4 - uTime * 0.9);
    vec3 sky = mix(uSkyHorizon, uSkyZenith, 0.35 + 0.1 * ripple);
    vec3 c = mix(pWaterDeep, sky * 1.4, 0.55);
    for (int i = 0; i < 3; i++) {
      vec4 e = uEmitters[i];
      if (e.w <= 0.0) continue;
      float fall = max(0.0, 1.0 - length(vXY - e.xy) / (e.z * 1.4));
      c += uEmitterColor[i] * e.w * fall * fall * 0.6;
    }
    vec3 color = tonemap(c * uExposure);
    outColor = vec4(pow(color, vec3(1.0 / 2.2)) * uAlpha, uAlpha);
  }
`;

const WATER_VERT = /* glsl */`
  out vec2 vXY;
  void main() { vXY = position.xy; gl_Position = projectionMatrix * viewMatrix * vec4(position.xy, 1.2, 1.0); }
`;

export function hueToLinear(h, s = 0.75, l = 0.6) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
}

export class RockStageGL {
  constructor(THREE, { textures, palette, rules }) {
    this.THREE = THREE;
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 20);
    this.camera.position.set(0, 0, 10);
    this.scene = new THREE.Scene();
    const col = (hex) => setLinearFromHex(new THREE.Color(), hex);
    const u = {
      tStage: { value: textures.roles.stage.texture }, sStage: { value: 150 },
      tWet: { value: textures.roles.stageWet.texture }, sWet: { value: 120 },
      tSoil: { value: textures.roles.soil.texture }, sSoil: { value: 110 },
      pRockLit: { value: col(palette.rockLit) }, pRockShade: { value: col(palette.rockShade) }, pWetRock: { value: col(palette.wetRock) },
      pMoss: { value: col(palette.moss) }, pSoil: { value: col(palette.soil) }, pLichen: { value: col(palette.lichen) },
      pWater: { value: col(palette.water) }, pWaterDeep: { value: col(palette.waterDeep) },
      uKeyDir: { value: new THREE.Vector3(-0.4, 0.8, -0.3).normalize() }, uKeyColor: { value: new THREE.Color(0.2, 0.22, 0.28) },
      uSkyZenith: { value: new THREE.Color() }, uSkyHorizon: { value: new THREE.Color() },
      uAmbientScale: { value: 2.5 }, uExposure: { value: 2.0 }, uMoss: { value: rules.moss ?? 0.5 },
      uEmitters: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uEmitterColor: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uPools: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uPoolAlpha: { value: new Array(8).fill(0) },
      uDiag: { value: 0 }, uTime: { value: 0 }, uAlpha: { value: 1 },
    };
    this.uniforms = u;
    this.material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: u });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.waterMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      uniforms: u, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true });
    this.waterGeometry = new THREE.BufferGeometry();
    this.water = new THREE.Mesh(this.waterGeometry, this.waterMaterial);
    this.water.frustumCulled = false;
    this.scene.add(this.water);
    this.bytes = 0;
  }

  /** Upload this frame's stage and per-frame uniforms. */
  update(stage, { width, height, frame, lightDir, skyZenith, skyHorizon }) {
    const THREE = this.THREE;
    const cam = this.camera;
    cam.left = 0; cam.right = width; cam.top = 0; cam.bottom = height;
    cam.updateProjectionMatrix();
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(stage.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(stage.normals, 3));
    g.setAttribute('surface', new THREE.BufferAttribute(stage.surfaces, 1));
    g.setAttribute('stageUv', new THREE.BufferAttribute(stage.uv, 2));
    g.setIndex(new THREE.BufferAttribute(stage.indices, 1));
    // Water: fans of the exact pool polygons.
    const wp = [];
    const u = this.uniforms;
    stage.pools.slice(0, 8).forEach((p, i) => {
      const c = p.polygon.reduce((a, q) => [a[0] + q.x / p.polygon.length, a[1] + q.y / p.polygon.length], [0, 0]);
      for (let k = 0; k < p.polygon.length; k++) {
        const a = p.polygon[k], b = p.polygon[(k + 1) % p.polygon.length];
        wp.push(c[0], c[1], 0, a.x, a.y, 0, b.x, b.y, 0);
      }
      const xs = p.polygon.map((q) => q.x), ys = p.polygon.map((q) => q.y);
      u.uPools.value[i].set(c[0], c[1], (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2);
      u.uPoolAlpha.value[i] = p.alpha;
    });
    for (let i = stage.pools.length; i < 8; i++) { u.uPools.value[i].set(0, 0, 0, 0); u.uPoolAlpha.value[i] = 0; }
    this.waterGeometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(wp), 3));
    this.water.visible = wp.length > 0;
    u.uAlpha.value = 1;
    const ems = (frame.emitters || []).filter((e) => e.visible).slice(0, 3);
    for (let i = 0; i < 3; i++) {
      const e = ems[i];
      if (!e) { u.uEmitters.value[i].set(0, 0, 1, 0); continue; }
      const lift = Math.min(1, (e.airborneM || 0) / 160);
      u.uEmitters.value[i].set(e.x, e.supportY ?? e.y, 150, (frame.reducedFlash ? 0.12 : 0.22) * (1 - 0.6 * lift));
      const [r, gg, b] = hueToLinear(e.hue ?? 180);
      u.uEmitterColor.value[i].set(r, gg, b);
    }
    if (lightDir) u.uKeyDir.value.copy(lightDir);
    if (skyZenith) u.uSkyZenith.value.copy(skyZenith);
    if (skyHorizon) u.uSkyHorizon.value.copy(skyHorizon);
    u.uTime.value = frame.timeMs / 1000;
    this.bytes = stage.positions.byteLength * 3 + stage.indices.byteLength + wp.length * 4;
  }

  dispose() {
    this.geometry.dispose();
    this.waterGeometry.dispose();
    this.material.dispose();
    this.waterMaterial.dispose();
  }
}
