// Range v2 forest instances on the GPU (Task 10): near conifers as small
// instanced meshes, the middle distance as instanced camera-facing
// silhouettes, and beyond that the canopy texture inside the terrain
// shader. Roots move with the shared musical deformation (DEFORM_GLSL);
// wind is a pure function of heard time and each tree's id, so pause holds
// and seeks reconstruct. Each kick also sends a gust front across the
// frame: crowns bend and catch light as it passes (gustAt). Light, sky
// fill and aerial perspective match the terrain so trees sit in the same
// air.
import { DEFORM_GLSL, gustUniforms } from './TerrainMaterial.js';
import { GUST_FRONTS, GUST_SWEEP_SEC } from './Gust.js';

import { MIST_GLSL } from './RangeAtmosphere.js';
import { ACTOR_GLSL, actorUniforms } from './ActorsGL.js';

const GUST_ATTACK_SEC = 0.7;
const GUST_DECAY_SEC = 2.4;
/** Crown lean at a full gust, as a fraction of tree height. */
const GUST_LEAN = 0.08;
/** Crown brightening at a full gust: needles turning their pale sides up. */
const GUST_SHEEN = 0.05;
const GUST_SHEEN_DECAY_SEC = 1.0;
/** Crown lean away from Broshi as he passes, as a fraction of height. */
const PARTING_LEAN = 0.2;

export const TREE_COMMON = /* glsl */`
  ${DEFORM_GLSL}
  uniform float uTime;
  // Gust fronts in flight: seconds since each front's kick, its strength,
  // and its way across the frame (+1 left to right, -1 right to left).
  uniform float uGustAge[${GUST_FRONTS}];
  uniform float uGustAmp[${GUST_FRONTS}];
  uniform float uGustDir[${GUST_FRONTS}];
  uniform float uForestKeep;
  uniform vec3 uCameraPos;
  // Broshi passing: xz, radius (m), amount. Crowns lean away and show
  // their pale sides, as in a gust.
  uniform vec4 uParting;
  in vec3 iPos;
  in vec2 iSize;   // height, width (metres)
  in vec2 iVar;    // variant, id 0..1
  out vec3 vWorld;
  out vec2 vLocal;  // x across (-.5...5), y up (0..1)
  out float vVar;
  out float vId;
  out float vGust;
  vec3 rootOf() { vec3 r = iPos; r.y += deformAt(iPos); return r; }
  bool hiddenByGlacier() {
    vec3 ice = glacierAt(iPos);
    return ice.x > 0.5 || iVar.y > ice.z;
  }
  // A gust front's envelope where it has reached: a quick rise, then a
  // settle over decay seconds (the shape of ridgeKickEnv).
  float gustEnv(float age, float decay) {
    if (age < 0.0) return 0.0;
    return age < ${GUST_ATTACK_SEC.toFixed(3)} ? age / ${GUST_ATTACK_SEC.toFixed(3)} : exp(-(age - ${GUST_ATTACK_SEC.toFixed(3)}) / decay);
  }
  // How the passing fronts press on this tree: x the signed lean (slow
  // settle, along each front's way), y the sheen (only the front itself,
  // so it reads as a moving band). A front sweeps across the frame in
  // GUST_SWEEP_SEC, so where a tree stands on screen, not how far away it
  // is, decides when it arrives.
  vec2 gustAt() {
    vec4 c = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
    float sx = clamp(c.x / max(c.w, 1e-3), -1.2, 1.2);
    float lean = 0.0, sheen = 0.0;
    for (int i = 0; i < ${GUST_FRONTS}; i++) {
      float age = uGustAge[i] - ((sx * uGustDir[i]) * 0.5 + 0.5) * ${GUST_SWEEP_SEC.toFixed(3)} - iVar.y * 0.06;
      lean += uGustDir[i] * gustEnv(age, ${GUST_DECAY_SEC.toFixed(3)}) * uGustAmp[i];
      sheen = max(sheen, gustEnv(age, ${GUST_SHEEN_DECAY_SEC.toFixed(3)}) * uGustAmp[i]);
    }
    return vec2(clamp(lean, -1.0, 1.0), sheen);
  }
  vec2 windAt(float y01) {
    float ph = iVar.y * 6.2831;
    float s = sin(uTime * 0.65 + ph) * 0.6 + sin(uTime * 1.45 + ph * 1.7) * 0.25;
    vec2 sway = vec2(s, s * 0.4) * 0.012;
    // The gust leans crowns the way the front travels (camera right in xz).
    vec2 gust = gustAt();
    vec2 away = iPos.xz - uParting.xy;
    float dAway = length(away);
    float part = uParting.w * (1.0 - smoothstep(uParting.z * 0.3, uParting.z, dAway));
    vGust = max(gust.y, part * 0.8);
    vec2 lean = normalize(vec2(viewMatrix[0][0], viewMatrix[2][0]) + 1e-5) * gust.x * ${GUST_LEAN.toFixed(3)};
    lean += away / max(dAway, 1.0) * part * ${PARTING_LEAN.toFixed(3)};
    return (sway + lean) * iSize.x * y01 * y01;
  }
`;

const MESH_VERT = /* glsl */`
  invariant gl_Position;
  ${TREE_COMMON}
  out vec3 vNormal;
  void main() {
    vec3 root = rootOf();
    float y01 = position.y;
    vec2 w = windAt(y01);
    vec3 p = root + vec3(position.x * iSize.y + w.x, position.y * iSize.x, position.z * iSize.y + w.y);
    vWorld = p;
    vLocal = vec2(position.x, position.y);
    vVar = iVar.x; vId = iVar.y;
    vNormal = normalize(vec3(normal.x / iSize.y, normal.y / iSize.x, normal.z / iSize.y));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    // Quality thinning: a stable subset by each tree's own id.
    if (iVar.y > uForestKeep || hiddenByGlacier()) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const BOARD_VERT = /* glsl */`
  invariant gl_Position;
  ${TREE_COMMON}
  out vec3 vRight;
  out vec3 vToCam;
  void main() {
    vec3 root = rootOf();
    vec3 toCam = uCameraPos - root;
    toCam.y = 0.0;
    toCam = normalize(toCam);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    float y01 = position.y;
    vec2 w = windAt(y01);
    vec3 p = root + right * position.x * iSize.y + vec3(w.x, position.y * iSize.x, w.y);
    vWorld = p;
    vLocal = position.xy;
    vVar = iVar.x; vId = iVar.y;
    vRight = right; vToCam = toCam;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    if (iVar.y > uForestKeep || hiddenByGlacier()) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const SHADE = /* glsl */`
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uAirColor;
  uniform float uAirDensity;
  uniform float uAirHeightFalloff;
  uniform float uAmbientScale;
  uniform float uSolarTransmission;
  uniform float uExposure;
  uniform vec3 pForestNear;
  uniform vec3 pForestFar;
  uniform float uDiag;
  uniform vec4 uNarrative;
  in float vGust;
  ${MIST_GLSL}
  ${ACTOR_GLSL}
  vec3 tonemap(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  vec4 shadeTree(vec3 n, vec3 world, float core) {
    float dist = length(world - uCameraPos);
    vec3 base = mix(pForestNear, pForestFar, smoothstep(1500.0, 12000.0, dist));
    base *= 0.8 + 0.4 * fract(vVar * 0.37 + vId * 3.1) ;
    base *= mix(0.55, 1.0, core);
    // Tips catch the sky: crowns read against the forest behind them.
    base *= 1.0 + 0.5 * smoothstep(0.55, 0.95, vLocal.y);
    float wrap = 0.3;
    float key = max((dot(n, uLightDir) + wrap) / (1.0 + wrap), 0.0);
    vec3 hemi = mix(uSkyHorizon * 0.55, uSkyZenith, 0.5 + 0.5 * n.y) * uAmbientScale;
    vec3 lit = base * (hemi * (0.55 + 0.45 * core) + uLightColor * key);
    lit += base * actorLight(world, n);
    // Thin crown edges transmit a solar backlight. Both real conifers and
    // alpha-tested silhouettes use their own normal/core with this shared
    // response; key radiance already contains visibility exactly once.
    vec3 toViewer = normalize(uCameraPos - world);
    float backlight = pow(max(dot(-uLightDir, toViewer), 0.0), 2.0);
    float backface = max(-dot(n, uLightDir), 0.0);
    float crown = smoothstep(0.15, 0.8, vLocal.y);
    float thin = mix(0.35, 1.0, 1.0 - core);
    lit += base * uLightColor * (uSolarTransmission * backlight * backface * crown * thin);
    // A passing gust turns the crowns' pale sides up to the sky and key
    // light. Added rather than scaled, so it reads at night too.
    lit += (uSkyHorizon * uAmbientScale * 0.5 + uLightColor * 0.5) * (${GUST_SHEEN.toFixed(3)} * vGust * crown);
    float heightTerm = exp(-max(0.0, world.y - uCameraPos.y * 0.25) * uAirHeightFalloff);
    float air = 1.0 - exp(-dist * uAirDensity * (0.35 + 0.65 * heightTerm));
    vec3 color = mix(tonemap(lit * uExposure), mistColorAt(uCameraPos, world), mistAmount(uCameraPos, world));
    color = mix(color, uAirColor, clamp(air, 0.0, 0.96));
    if (uDiag > 0.5) return vec4(1.0, 0.0, 1.0, 1.0);
    color = mix(uSkyHorizon, color, uNarrative.z);
    return vec4(pow(max(color, 0.0), vec3(1.0 / 2.2)), 1.0);
  }
`;

const MESH_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uCameraPos;
  in vec3 vWorld; in vec2 vLocal; in float vVar; in float vId; in vec3 vNormal;
  out vec4 outColor;
  ${SHADE}
  void main() {
    float core = clamp(0.35 + vLocal.y * 0.8, 0.0, 1.0);
    outColor = shadeTree(normalize(vNormal), vWorld, core);
  }
`;

// A conifer silhouette drawn procedurally: tiered, ragged edges, a thin
// trunk at the foot. Alpha-tested, so it writes depth like geometry.
const SILHOUETTE = /* glsl */`
  float treeMask(vec2 l, float id, out float core) {
    float v = l.y;
    if (v < 0.07) { core = 0.2; return abs(l.x) < 0.04 ? 1.0 : 0.0; }
    float tiers = 5.0 + floor(id * 4.0);
    float t = fract(v * tiers + id * 7.0);
    float envelope = pow(max(0.0, 1.0 - v), 0.85) * 0.5;
    float tier = mix(0.72, 1.0, smoothstep(0.0, 0.85, t));
    float rag = 0.9 + 0.1 * sin(v * 80.0 + id * 40.0) * sin(l.x * 60.0 + id * 11.0);
    float w = envelope * tier * rag;
    core = 1.0 - abs(l.x) / max(w, 1e-3);
    return abs(l.x) < w ? 1.0 : 0.0;
  }
`;

const BOARD_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uCameraPos;
  in vec3 vWorld; in vec2 vLocal; in float vVar; in float vId; in vec3 vRight; in vec3 vToCam;
  out vec4 outColor;
  ${SHADE}
  ${SILHOUETTE}
  void main() {
    float core;
    if (treeMask(vLocal, vId, core) < 0.5) discard;
    // A cone's normal, reconstructed from the silhouette position.
    float side = vLocal.x / max(0.001, abs(vLocal.x) + 0.2);
    vec3 n = normalize(vRight * side * 0.9 + vec3(0.0, 0.45, 0.0) + vToCam * (0.4 + 0.6 * core));
    outColor = shadeTree(n, vWorld, core);
  }
`;

const BOARD_DEPTH_FRAG = /* glsl */`
  precision highp float;
  in vec3 vWorld; in vec2 vLocal; in float vVar; in float vId; in vec3 vRight; in vec3 vToCam;
  out vec4 outColor;
  ${SILHOUETTE}
  void main() { float core; if (treeMask(vLocal, vId, core) < 0.5) discard; outColor = vec4(0.0); }
`;
const MESH_DEPTH_FRAG = /* glsl */`
  precision highp float;
  out vec4 outColor;
  void main() { outColor = vec4(0.0); }
`;

/** Unit conifer: trunk plus stacked cones, height 1, base width 1. */
export function coniferGeometry(THREE, { sides = 7, tiers = 4 } = {}) {
  const pos = [], nor = [];
  const ring = (y, r) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  const tri = (a, b, c, na, nb, nc) => { pos.push(...a, ...b, ...c); nor.push(...na, ...nb, ...nc); };
  // Trunk.
  const t0 = ring(0, 0.05), t1 = ring(0.2, 0.04);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const n0 = [t0[i][0], 0, t0[i][2]], n1 = [t0[j][0], 0, t0[j][2]];
    tri(t0[i], t1[i], t1[j], n0, n0, n1); tri(t0[i], t1[j], t0[j], n0, n1, n1);
  }
  for (let k = 0; k < tiers; k++) {
    const y0 = 0.12 + k * (0.78 / tiers), y1 = Math.min(1, y0 + 0.42);
    const r = 0.5 * (1 - k / (tiers + 0.6));
    const base = ring(y0, r), apex = [0, y1, 0];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const n = (p) => { const l = Math.hypot(p[0], r * 0.6, p[2]); return [p[0] / l, (r * 0.6) / l, p[2] / l]; };
      tri(base[i], apex, base[j], n(base[i]), [0, 1, 0], n(base[j]));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

export function billboardGeometry(THREE) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  return geo;
}

/** Instanced geometry for a subset of placed trees. */
function instanced(THREE, base, instances, stride, indices) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  for (const [k, v] of Object.entries(base.attributes)) geo.setAttribute(k, v);
  const n = indices.length;
  const p = new Float32Array(n * 3), s = new Float32Array(n * 2), v = new Float32Array(n * 2);
  indices.forEach((i, k) => {
    const o = i * stride;
    p[k * 3] = instances[o]; p[k * 3 + 1] = instances[o + 1]; p[k * 3 + 2] = instances[o + 2];
    s[k * 2] = instances[o + 3]; s[k * 2 + 1] = instances[o + 4];
    v[k * 2] = instances[o + 5]; v[k * 2 + 1] = instances[o + 6];
  });
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(p, 3));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(s, 2));
  geo.setAttribute('iVar', new THREE.InstancedBufferAttribute(v, 2));
  geo.instanceCount = n;
  return { geo, bytes: p.byteLength + s.byteLength + v.byteLength };
}

/**
 * Forest objects per band. `uniforms` are the terrain's (shared light,
 * air, deformation, palette); forest adds uTime (heard seconds, for wind),
 * uGustAge/uGustAmp/uGustDir (the kicks' gust fronts)
 * and uForestKeep (the quality rung's stable fraction, applied per id in
 * the vertex shader, so a rung change never rebuilds the forest).
 * Returns { byBand: { far: [...Mesh], mid, near }, depth: [...Mesh],
 * depthByBand: { far, mid, near } (depth meshes per band), bytes, counts, dispose }.
 */
export function createForest(THREE, placed, uniforms, { partitioned = true } = {}) {
  const u = { ...uniforms, uTime: uniforms.uTime || { value: 0 }, uForestKeep: uniforms.uForestKeep || { value: 1 },
    ...(uniforms.uGustAge ? {} : gustUniforms()), ...(uniforms.uActorPos ? {} : actorUniforms(THREE)) };
  const mat = (vert, frag, depth = false) => {
    const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vert, fragmentShader: frag, uniforms: u });
    if (depth) m.colorWrite = false;
    else if (partitioned) { m.depthFunc = THREE.LessEqualDepth; m.depthWrite = false; }
    return m;
  };
  const materials = {
    mesh: mat(MESH_VERT, MESH_FRAG), meshDepth: mat(MESH_VERT, MESH_DEPTH_FRAG, true),
    board: mat(BOARD_VERT, BOARD_FRAG), boardDepth: mat(BOARD_VERT, BOARD_DEPTH_FRAG, true),
  };
  materials.board.side = THREE.DoubleSide; materials.boardDepth.side = THREE.DoubleSide;
  const baseMesh = coniferGeometry(THREE), baseBoard = billboardGeometry(THREE);
  const byBand = { far: [], mid: [], near: [] }, depth = [], depthByBand = { far: [], mid: [], near: [] }, geos = [];
  const bandName = ['far', 'mid', 'near'];
  let bytes = 0;
  const counts = { mesh: 0, billboard: 0 };
  for (const [kind, data, base, colorMat, depthMat] of [
    ['mesh', placed.mesh, baseMesh, materials.mesh, materials.meshDepth],
    ['billboard', placed.billboard, baseBoard, materials.board, materials.boardDepth],
  ]) {
    const kept = Array.from({ length: data.length / placed.stride }, (_, i) => i);
    for (let b = 0; b < 3; b++) {
      const idx = kept.filter((i) => data[i * placed.stride + 7] === b);
      if (!idx.length) continue;
      const { geo, bytes: nb } = instanced(THREE, base, data, placed.stride, idx);
      geos.push(geo);
      bytes += nb;
      counts[kind] += idx.length;
      const m = new THREE.Mesh(geo, colorMat); m.frustumCulled = false;
      const d = new THREE.Mesh(geo, depthMat); d.frustumCulled = false;
      byBand[bandName[b]].push(m);
      depth.push(d);
      // A second depth mesh (same geometry and material) for the band's own
      // depth scene: a mesh has one parent scene.
      const db = new THREE.Mesh(geo, depthMat); db.frustumCulled = false;
      depthByBand[bandName[b]].push(db);
    }
  }
  return {
    byBand, depth, depthByBand, bytes, counts, uniforms: u,
    dispose: () => { for (const g of geos) g.dispose(); baseMesh.dispose(); baseBoard.dispose(); for (const m of Object.values(materials)) m.dispose(); },
  };
}
