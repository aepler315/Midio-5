import { hexToLinear } from './MaterialPackage.js';
// Range v2 production terrain material (GLSL3 via the local Three.js
// bundle). Task 8 ships the neutral-material pilot: real geometry, the
// surface texture's full-grid normals, the frame's resolved celestial light
// and sky ambient, the shared musical deformation, and one aerial
// perspective applied exactly once. Material packs (Task 9) extend the
// albedo/detail terms here rather than drawing a second terrain.

// GLSL twin of RangeFrame.sceneDeformation -- keep the two in step.
export const DEFORM_GLSL = /* glsl */`
  uniform vec2 uHeightRange;
  uniform float uDeformAmp;
  uniform float uDeformKick;
  uniform float uDeformK;
  uniform vec2 uDeformDir;
  uniform float uDeformPhase;
  float deformLift(float y) {
    float h01 = clamp((y - uHeightRange.x) / max(1.0, uHeightRange.y - uHeightRange.x), 0.0, 1.0);
    return h01 * h01;
  }
  float deformAt(vec3 p) {
    float along = dot(p.xz, uDeformDir);
    return deformLift(p.y) * (uDeformAmp * sin(along * uDeformK - uDeformPhase) + uDeformKick);
  }
  // Horizontal gradient of the deformation (lift treated as locally flat).
  vec2 deformGrad(vec3 p) {
    float along = dot(p.xz, uDeformDir);
    return deformLift(p.y) * uDeformAmp * cos(along * uDeformK - uDeformPhase) * uDeformK * uDeformDir;
  }
`;

export const SCENE_VERT = /* glsl */`
  invariant gl_Position;
  uniform vec2 uGridOrigin;
  uniform vec2 uGridExtent;
  ${DEFORM_GLSL}
  out vec2 vUv;
  out vec3 vWorld;
  out float vViewDepth;
  void main() {
    vec3 p = position;
    p.y += deformAt(position);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = vec3(world.x, position.y, world.z); // source height for masks
    vUv = (position.xz - uGridOrigin) / uGridExtent;
    vec4 view = viewMatrix * world;
    vViewDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

export const SCENE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uSurface;
  uniform vec2 uTexel;
  ${DEFORM_GLSL}
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uAirColor;
  uniform float uAirDensity;
  uniform float uAirHeightFalloff;
  uniform vec3 uCameraPos;
  uniform float uDiag;
  uniform float uAmbientScale;
  uniform int uDebugMask;
  uniform float uExposure;
  // Material pack (MaterialPackage.js): data textures and scales.
  uniform sampler2D tRock;      uniform float sRock;
  uniform sampler2D tRockNear;  uniform float sRockNear;
  uniform sampler2D tCanopy;    uniform float sCanopy;
  uniform sampler2D tSnow;      uniform float sSnow;
  uniform sampler2D tSoil;      uniform float sSoil;
  uniform float uHasMaterial;
  // Palette (linear) and rules.
  uniform vec3 pRockLit; uniform vec3 pRockShade; uniform vec3 pRockWarm; uniform vec3 pSoil; uniform vec3 pMeadow;
  uniform vec3 pForestNear; uniform vec3 pForestFar; uniform vec3 pMoss; uniform vec3 pSnow; uniform vec3 pSnowShade;
  uniform vec3 pWater; uniform vec3 pWaterDeep; uniform vec3 pLichen;
  uniform float rSnowline; uniform float rSnowFull; uniform float rSnowMaxSlope; uniform float rTreeline;
  uniform float rForestMaxSlope; uniform float rForestDensity; uniform float rMoss; uniform float rStrata;
  in vec2 vUv;
  in vec3 vWorld;
  in float vViewDepth;
  out vec4 outColor;
  vec3 linearToSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
  // Filmic shoulder (Narkowicz ACES fit): snow and moonlit rock compress
  // instead of clipping; the dark blue-hour body keeps its separation.
  vec3 tonemap(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  // Triplanar sample of a data texture (RG normal, B, A height) around the
  // geometric normal; returns the world-space normal offset in .xyz via
  // whiteout blending and the blended B/A in .ba of the second output.
  struct Tri { vec3 dn; float b; float h; };
  // rib < 1 stretches side projections vertically: cliff faces get
  // fluting and gully ribs rather than isotropic blotches.
  Tri triplanarRib(sampler2D t, vec3 p, vec3 n, float scale, float rot, float rib) {
    vec3 w = pow(abs(n), vec3(4.0));
    w /= (w.x + w.y + w.z);
    float c = cos(rot), s = sin(rot);
    mat2 R = mat2(c, -s, s, c);
    vec4 tx = texture(t, R * (vec2(p.z, p.y * rib) / scale));
    vec4 ty = texture(t, R * (p.xz / scale));
    vec4 tz = texture(t, R * (vec2(p.x, p.y * rib) / scale));
    vec2 nx = tx.rg * 2.0 - 1.0, ny = ty.rg * 2.0 - 1.0, nz = tz.rg * 2.0 - 1.0;
    // Tangent offsets swizzled into world axes per projection.
    vec3 dn = w.x * vec3(0.0, nx.y, nx.x) + w.y * vec3(ny.x, 0.0, ny.y) + w.z * vec3(nz.x, nz.y, 0.0);
    Tri r;
    r.dn = dn;
    r.b = w.x * tx.b + w.y * ty.b + w.z * tz.b;
    r.h = w.x * tx.a + w.y * ty.a + w.z * tz.a;
    return r;
  }
  Tri triplanar(sampler2D t, vec3 p, vec3 n, float scale, float rot) { return triplanarRib(t, p, n, scale, rot, 1.0); }
  void main() {
    vec2 uv = vUv * (1.0 - uTexel) + 0.5 * uTexel;
    vec4 s = texture(uSurface, uv);
    vec2 nxz = s.rg * 2.0 - 1.0;
    vec3 n = normalize(vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y));
    vec2 g = deformGrad(vWorld);
    n = normalize(n + vec3(-g.x, 0.0, -g.y));
    float dist = length(vWorld - uCameraPos);
    float slopeDeg = degrees(acos(clamp(n.y, 0.0, 1.0)));
    float curv = (s.b - 0.5) * 2.0;            // + concave gully, - convex ridge
    float flow = s.a * 255.0;
    bool water = flow > 254.5;
    float flowN = clamp(flow / 254.0, 0.0, 1.0);
    float h = vWorld.y;
    vec3 albedo;
    vec3 nShade = n;
    float rough = 0.85;
    if (uHasMaterial < 0.5) {
      albedo = mix(vec3(0.34), vec3(0.24), clamp(curv * 3.0, 0.0, 1.0));
      if (water) albedo = vec3(0.10, 0.13, 0.16);
    } else {
      // Macro rock detail everywhere (two rotated scales break tiling); the
      // near CC0 scan fades in only where a texel can still be resolved.
      Tri macro = triplanarRib(tRock, vWorld, n, sRock, 0.0, 0.35);
      Tri macro2 = triplanarRib(tRock, vWorld, n, sRock * 0.37, 1.1, 0.5);
      float nearFade = 1.0 - smoothstep(600.0, 2200.0, dist);
      Tri near = triplanar(tRockNear, vWorld, n, sRockNear, 0.4);
      float detailFade = 1.0 - smoothstep(9000.0, 30000.0, dist);
      vec3 dn = (macro.dn * 1.3 + macro2.dn * 0.8 * (1.0 - smoothstep(2500.0, 9000.0, dist))) * detailFade + near.dn * 0.7 * nearFade;
      float rh = mix(macro.h, macro2.h, 0.35);
      float breakup = hash12(floor(vWorld.xz / 23.0)) * 0.15 + rh;
      // Masks from the real surface.
      // Rock: cliffs (by slope, broken up by the rock's own relief and
      // pushed out of gullies), sharp convex crests, and bare ground above
      // the treeline. At 10-20 m DEM spacing, 35-45 degree slopes are still
      // mostly forested in wet mountain country, so the cliff band starts
      // near 47 degrees.
      float treeLine = rTreeline + (breakup - 0.5) * 220.0 + curv * 140.0;
      float alpine = smoothstep(treeLine - 50.0, treeLine + 350.0, h);
      float rockMask = smoothstep(max(40.0, rForestMaxSlope - 6.0), rForestMaxSlope + 10.0, slopeDeg + (rh - 0.5) * 16.0 - curv * 12.0);
      rockMask = max(rockMask, smoothstep(0.45, 0.9, -curv) * smoothstep(30.0, 44.0, slopeDeg) * 0.7);
      rockMask = max(rockMask, alpine * smoothstep(0.25, 0.65, rh + slopeDeg / 90.0));
      float forest = (1.0 - smoothstep(treeLine - 90.0, treeLine + 60.0, h))
        * (1.0 - smoothstep(rForestMaxSlope - 6.0, rForestMaxSlope + 4.0, slopeDeg))
        * rForestDensity;
      float snowLine = rSnowline + (breakup - 0.5) * 260.0 - curv * 180.0;
      float snow = smoothstep(snowLine, max(snowLine + 1.0, snowLine + (rSnowFull - rSnowline)), h);
      snow *= 1.0 - smoothstep(rSnowMaxSlope - 10.0, rSnowMaxSlope + 6.0, slopeDeg - max(curv, 0.0) * 25.0);
      // Canopy: the third, farthest forest scale (instanced trees nearer).
      // Two rotated canopy samples at unrelated scales hide the tile grid.
      vec4 cn = mix(texture(tCanopy, vWorld.xz / sCanopy), texture(tCanopy, mat2(0.8, -0.6, 0.6, 0.8) * vWorld.xz / (sCanopy * 1.73)), 0.5);
      cn.b = smoothstep(0.35, 0.75, cn.b);
      float crowns = cn.b * forest;
      // Ground between: meadow on gentle open slopes, soil/scree steeper,
      // moss along wet drainage.
      vec3 ground = mix(pMeadow, pSoil, smoothstep(18.0, 34.0, slopeDeg));
      ground = mix(ground, pMoss, rMoss * smoothstep(0.35, 0.75, flowN) * (1.0 - rockMask));
      vec3 rockCol = mix(pRockShade, pRockLit, clamp(rh * 1.2 - 0.1 + curv * -0.25, 0.0, 1.0));
      rockCol = mix(rockCol, pRockWarm, rStrata * smoothstep(0.55, 0.9, macro2.h));
      rockCol = mix(rockCol, pLichen, 0.25 * (1.0 - rockMask) );
      // Water streaks: drainage darkens steep rock below where it gathers.
      rockCol *= 1.0 - 0.45 * smoothstep(0.25, 0.6, flowN) * smoothstep(35.0, 55.0, slopeDeg);
      // Rib shadows from the stretched detail height.
      rockCol *= 0.7 + 0.6 * macro.h;
      vec3 forestCol = mix(pForestNear, pForestFar, smoothstep(1500.0, 12000.0, dist));
      forestCol *= 0.65 + 0.7 * cn.a;
      albedo = mix(ground, forestCol, crowns);
      albedo = mix(albedo, ground * 0.9, forest * (1.0 - cn.b) * 0.5);
      albedo = mix(albedo, rockCol, rockMask * (1.0 - crowns * 0.6));
      Tri sn = triplanar(tSnow, vWorld, n, sSnow, 0.7);
      vec3 snowCol = mix(pSnowShade, pSnow, 0.55 + 0.45 * sn.h);
      albedo = mix(albedo, snowCol, snow);
      // Detail normal: rock gets the full detail, forest the crowns, snow
      // its own ripples.
      vec3 cdn = vec3(cn.r * 2.0 - 1.0, 0.0, cn.g * 2.0 - 1.0) * 0.8;
      vec3 detail = mix(dn * mix(0.35, 1.0, rockMask), cdn, crowns);
      detail = mix(detail, sn.dn * 0.4, snow);
      nShade = normalize(n + detail);
      rough = mix(mix(0.9, macro.b, rockMask), 0.6, snow);
      if (water) {
        albedo = pWaterDeep;
        rough = 0.08;
      }
      if (uDebugMask == 1) { outColor = vec4(rockMask, crowns, snow, 1.0); if (water) outColor = vec4(0.0, 0.6, 1.0, 1.0); return; }
      if (uDebugMask == 2) { outColor = vec4(vec3(slopeDeg / 90.0), 1.0); return; }
    }
    // Light: the celestial as a soft wrap-diffuse key, sky hemisphere fill,
    // occlusion from curvature and drainage (gullies sit in shade).
    float wrap = 0.18;
    float key = max((dot(nShade, uLightDir) + wrap) / (1.0 + wrap), 0.0);
    float ao = clamp(1.0 - max(curv, 0.0) * 0.55 - flowN * 0.12, 0.35, 1.0);
    // Sky radiance: the displayed sky colours are radiance, and a surface
    // integrates the hemisphere, hence the scale.
    vec3 hemi = mix(uSkyHorizon * 0.55, uSkyZenith, 0.5 + 0.5 * nShade.y) * uAmbientScale;
    vec3 lit = albedo * (hemi * ao + uLightColor * key * mix(0.85, 1.0, ao));
    if (uDebugMask == 3) { outColor = vec4(albedo * 4.0, 1.0); return; }
    if (uDebugMask == 4) { outColor = vec4(hemi * ao * 0.5, 1.0); return; }
    if (uDebugMask == 5) { outColor = vec4(vec3(key), 1.0); return; }
    vec3 V = normalize(uCameraPos - vWorld);
    if (water && uHasMaterial > 0.5) {
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), V), 0.0), 5.0);
      vec3 H = normalize(uLightDir + V);
      float glint = pow(max(H.y, 0.0), 600.0) * 3.0;
      lit = mix(lit, uSkyHorizon * 0.9, fres) + uLightColor * glint;
    }
    // Aerial perspective, applied once here and nowhere else.
    float heightTerm = exp(-max(0.0, vWorld.y - uCameraPos.y * 0.25) * uAirHeightFalloff);
    float air = 1.0 - exp(-dist * uAirDensity * (0.35 + 0.65 * heightTerm));
    // Air is the displayed sky colour; bring it into the exposed domain so
    // distant terrain converges on the sky the 2D painter draws behind it.
    vec3 color = mix(tonemap(lit * uExposure), uAirColor, clamp(air, 0.0, 0.96));
    outColor = vec4(linearToSrgb(color), 1.0);
    if (uDiag > 0.5) outColor = vec4(1.0, 0.0, 1.0, 1.0);
  }
`;

export const DEPTH_FRAG = /* glsl */`
  precision highp float;
  out vec4 outColor;
  void main() { outColor = vec4(0.0); }
`;

/** Shared uniforms for the production terrain (values set per frame). */
export function sceneUniforms(THREE, base) {
  return {
    ...base,
    uDeformAmp: { value: 0 }, uDeformKick: { value: 0 }, uDeformK: { value: 0 },
    uDeformDir: { value: new THREE.Vector2(0.8, -0.6) }, uDeformPhase: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightColor: { value: new THREE.Color(1, 1, 1) },
    uSkyZenith: { value: new THREE.Color(0.1, 0.12, 0.2) },
    uSkyHorizon: { value: new THREE.Color(0.3, 0.35, 0.45) },
    uAirColor: { value: new THREE.Color(0.35, 0.4, 0.5) },
    uAirDensity: { value: 1 / 60000 },
    uAirHeightFalloff: { value: 1 / 2500 },
    uCameraPos: { value: new THREE.Vector3() },
    uDiag: { value: 0 },
    uHasMaterial: { value: 0 },
    uAmbientScale: { value: 2.5 },
    uDebugMask: { value: 0 },
    uTime: { value: 0 },
    uForestKeep: { value: 1 },
    uExposure: { value: 2.0 },
    tRock: { value: null }, sRock: { value: 150 }, tRockNear: { value: null }, sRockNear: { value: 6 },
    tCanopy: { value: null }, sCanopy: { value: 70 }, tSnow: { value: null }, sSnow: { value: 60 },
    tSoil: { value: null }, sSoil: { value: 3 },
    pRockLit: { value: new THREE.Color() }, pRockShade: { value: new THREE.Color() }, pRockWarm: { value: new THREE.Color() },
    pSoil: { value: new THREE.Color() }, pMeadow: { value: new THREE.Color() }, pForestNear: { value: new THREE.Color() },
    pForestFar: { value: new THREE.Color() }, pMoss: { value: new THREE.Color() }, pSnow: { value: new THREE.Color() },
    pSnowShade: { value: new THREE.Color() }, pWater: { value: new THREE.Color() }, pWaterDeep: { value: new THREE.Color() },
    pLichen: { value: new THREE.Color() },
    rSnowline: { value: 2000 }, rSnowFull: { value: 2400 }, rSnowMaxSlope: { value: 50 }, rTreeline: { value: 1700 },
    rForestMaxSlope: { value: 38 }, rForestDensity: { value: 0.8 }, rMoss: { value: 0.5 }, rStrata: { value: 0.2 },
  };
}

const ROLE_UNIFORM = { rockDetail: ['tRock', 'sRock'], rockNear: ['tRockNear', 'sRockNear'], canopy: ['tCanopy', 'sCanopy'],
  snow: ['tSnow', 'sSnow'], soil: ['tSoil', 'sSoil'] };
const PALETTE_UNIFORM = { rockLit: 'pRockLit', rockShade: 'pRockShade', rockWarm: 'pRockWarm', soil: 'pSoil', meadow: 'pMeadow',
  forestNear: 'pForestNear', forestFar: 'pForestFar', moss: 'pMoss', snow: 'pSnow', snowShade: 'pSnowShade',
  water: 'pWater', waterDeep: 'pWaterDeep', lichen: 'pLichen' };
const RULE_UNIFORM = { snowlineM: 'rSnowline', snowFullM: 'rSnowFull', snowMaxSlopeDeg: 'rSnowMaxSlope', treelineM: 'rTreeline',
  forestMaxSlopeDeg: 'rForestMaxSlope', forestDensity: 'rForestDensity', moss: 'rMoss', strata: 'rStrata' };

/** Set a THREE.Color to the linear value of an sRGB hex, exactly once.
 *  (Color.set(hex) already linearises under colour management; chaining
 *  convertSRGBToLinear() on top darkened everything about tenfold.) */
export function setLinearFromHex(color, hex) {
  const [r, g, b] = hexToLinear(hex);
  color.r = r; color.g = g; color.b = b;
  return color;
}

/** GPU data textures for a loaded pack: one Texture per unique image. */
export function createMaterialTextures(THREE, pack, { anisotropy = 4 } = {}) {
  const bySha = new Map();
  const roles = {};
  for (const [role, t] of Object.entries(pack.manifest.textures)) {
    let tex = bySha.get(t.sha256);
    if (!tex) {
      tex = new THREE.Texture(pack.images.get(t.sha256));
      tex.colorSpace = THREE.NoColorSpace; // data, not colour
      tex.premultiplyAlpha = false;
      tex.flipY = false;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = anisotropy;
      tex.needsUpdate = true;
      bySha.set(t.sha256, tex);
    }
    roles[role] = { texture: tex, metersPerTile: t.metersPerTile };
  }
  return { roles, textures: [...bySha.values()], dispose: () => { for (const t of bySha.values()) t.dispose(); } };
}

/** Bind a pack (textures, palette, rules; `ruleOverrides` from the view). */
export function applyMaterial(uniforms, pack, textures, ruleOverrides = {}) {
  for (const [role, [tu, su]] of Object.entries(ROLE_UNIFORM)) {
    const r = textures.roles[role];
    if (!r) continue;
    uniforms[tu].value = r.texture;
    uniforms[su].value = r.metersPerTile;
  }
  for (const [k, u] of Object.entries(PALETTE_UNIFORM)) setLinearFromHex(uniforms[u].value, pack.manifest.palette[k]);
  const rules = { ...pack.manifest.rules, ...ruleOverrides };
  for (const [k, u] of Object.entries(RULE_UNIFORM)) uniforms[u].value = rules[k];
  uniforms.uHasMaterial.value = 1;
}

export function createSceneMaterial(THREE, uniforms) {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SCENE_VERT, fragmentShader: SCENE_FRAG, uniforms });
}

/** Depth-only twin: identical vertex transform (invariant), no colour. */
export function createDepthMaterial(THREE, uniforms) {
  const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SCENE_VERT, fragmentShader: DEPTH_FRAG, uniforms });
  m.colorWrite = false;
  return m;
}
