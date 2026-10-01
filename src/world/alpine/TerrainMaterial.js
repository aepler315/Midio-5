import { hexToLinear, RULE_DEFAULTS, validateWaterRules } from './MaterialPackage.js';
import { GUST_FRONTS, GUST_IDLE_SEC } from './Gust.js';
import { RangeAssetError } from './RangeAssets.js';
// Range v2 production terrain material (GLSL3 via the local Three.js
// bundle). Task 8 ships the neutral-material pilot: real geometry, the
// surface texture's full-grid normals, the frame's resolved celestial light
// and sky ambient, the shared musical deformation, and one aerial
// perspective applied exactly once. Material packs (Task 9) extend the
// albedo/detail terms here rather than drawing a second terrain.

// GLSL twin of RangeFrame.sceneDeformation -- keep the two in step.
import { MIST_GLSL, MIST_SAMPLES } from './RangeAtmosphere.js';
import { GLACIER_GLSL } from './GlacierField.js';

export const DEFORM_GLSL = /* glsl */`
  ${GLACIER_GLSL}
  uniform vec2 uHeightRange;
  uniform vec2 uGridOrigin;
  uniform vec2 uGridExtent;
  uniform vec2 uTexel;
  uniform sampler2D uReceiver;
  uniform float uDeformAmp;
  uniform float uDeformKick;
  uniform float uDeformGesture;
  uniform float uDeformMelodic;
  uniform float uDeformStructural;
  uniform float uDeformK;
  uniform vec2 uDeformDir;
  uniform float uDeformPhase;
  uniform float uMelodyK;
  uniform vec2 uMelodyDir;
  uniform float uMelodyPhase;
  float deformField(float h, float along, float across) {
    return h * h * (uDeformAmp * sin(along * uDeformK - uDeformPhase)
      + uDeformKick + uDeformStructural + uDeformMelodic * sin(across * uMelodyK - uMelodyPhase)
      + h * h * uDeformGesture);
  }
  float deformAt(vec3 p) {
    vec2 uv = (p.xz - uGridOrigin) / uGridExtent;
    float receiver = texture(uReceiver, uv * (1.0 - uTexel) + 0.5 * uTexel).r;
    float h = clamp((p.y - uHeightRange.x) / max(1.0, uHeightRange.y - uHeightRange.x), 0.0, 1.0);
    return receiver * deformField(h, dot(p.xz, uDeformDir), dot(p.xz, uMelodyDir));
  }
  // Full field derivatives include the receiver shoulder and height lift.
  // The inverse Jacobian carries terrain normals through the same field.
  vec3 deformGrad(vec3 p) {
    float e = 1.0;
    return vec3(deformAt(p + vec3(e, 0.0, 0.0)) - deformAt(p - vec3(e, 0.0, 0.0)),
      deformAt(p + vec3(0.0, e, 0.0)) - deformAt(p - vec3(0.0, e, 0.0)),
      deformAt(p + vec3(0.0, 0.0, e)) - deformAt(p - vec3(0.0, 0.0, e))) / (2.0 * e);
  }
`;

/** The Forest Service map under the land. uTopo (0..1) is how much of it
 *  shows: patches surface across the valley and join up as it rises.
 *  Shared by the terrain (which draws the map) and the forest (which sinks
 *  into it), so a tree never stands on paper. */
export const TOPO_GLSL = /* glsl */`
  uniform float uTopo;
  float topoHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float topoNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(topoHash(i), topoHash(i + vec2(1.0, 0.0)), f.x), mix(topoHash(i + vec2(0.0, 1.0)), topoHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // 0 = land, 1 = map. Large patches with a broken edge; none at uTopo 0,
  // all of it at 1.
  float topoMask(vec2 xz) {
    if (uTopo <= 0.0) return 0.0;
    float n = topoNoise(xz / 2600.0) * 0.62 + topoNoise(xz / 700.0 + 17.0) * 0.38;
    float front = uTopo * 1.3 - 0.15;
    return smoothstep(n - 0.035, n + 0.035, front);
  }
`;

export const SCENE_VERT = /* glsl */`
  invariant gl_Position;
  ${DEFORM_GLSL}
  out vec2 vUv;
  out vec3 vWorld;
  out vec3 vRenderedWorld;
  out float vViewDepth;
  void main() {
    vec3 p = position;
    vec3 ice = glacierAt(position);
    p.y += ice.x + deformAt(position) * (1.0 - ice.y);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = vec3(world.x, position.y, world.z); // source height for masks
    vRenderedWorld = world.xyz;
    vUv = (position.xz - uGridOrigin) / uGridExtent;
    vec4 view = viewMatrix * world;
    vViewDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

export const SCENE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uSurface;
  ${DEFORM_GLSL}
  ${TOPO_GLSL}
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
  uniform vec4 uNarrative; // relief, atmospheric depth, materials, feature materials
  uniform float uNarrativeInk;
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
  uniform float rForestFloor;
  uniform float rWaterSkyMix; uniform float rWaterGlintGain;
  uniform float uTime;
  in vec2 vUv;
  in vec3 vWorld;
  in vec3 vRenderedWorld;
  in float vViewDepth;
  out vec4 outColor;
  vec3 linearToSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
  // Filmic shoulder (Narkowicz ACES fit): snow and moonlit rock compress
  // instead of clipping; the dark blue-hour body keeps its separation.
  vec3 tonemap(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  ${MIST_GLSL}
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  // Smooth value noise: a per-cell hash alone steps at every cell edge,
  // which a threshold (snow line, tree line) turns into a visible grid.
  float vnoise12(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
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
  float waterGlint(float cosine, float gain, float keyEnergy) {
    if (keyEnergy < 1e-10 || gain <= 0.0) return 0.0;
    return pow(max(cosine, 0.0), 600.0) * gain;
  }

  void main() {
    vec2 uv = vUv * (1.0 - uTexel) + 0.5 * uTexel;
    vec4 s = texture(uSurface, uv);
    vec2 nxz = s.rg * 2.0 - 1.0;
    vec3 n = normalize(vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y));
    vec3 ice = glacierAt(vWorld);
    vec3 g = deformGrad(vWorld);
    float invY = 1.0 / max(0.2, 1.0 + g.y);
    n = normalize(vec3(n.x - g.x * n.y * invY, n.y * invY, n.z - g.z * n.y * invY));
    vec3 iceNormal = normalize(cross(dFdx(vRenderedWorld), dFdy(vRenderedWorld)));
    if (iceNormal.y < 0.0) iceNormal = -iceNormal;
    n = normalize(mix(n, iceNormal, ice.y));
    vec3 geologicalNormal = n; // Ink must not inherit material normal-map detail.
    float dist = length(vRenderedWorld - uCameraPos);
    float slopeDeg = degrees(acos(clamp(n.y, 0.0, 1.0)));
    float curv = (s.b - 0.5) * 2.0;            // + concave gully, - convex ridge
    float flow = s.a * 255.0;
    bool water = flow > 254.5 && ice.y < 0.01;
    float flowN = clamp(flow / 254.0, 0.0, 1.0);
    float h = vWorld.y;
    vec3 albedo;
    vec3 nShade = n;
    float rough = 0.85;
    float topoWood = 0.0, topoSnow = 0.0; // the map's woodland tint and white
    if (uHasMaterial < 0.5) {
      albedo = mix(vec3(0.34), vec3(0.24), clamp(curv * 3.0, 0.0, 1.0));
      if (water) albedo = vec3(0.10, 0.13, 0.16);
    } else {
      // Macro rock detail everywhere (two rotated scales break tiling); the
      // near CC0 scan fades in only where a texel can still be resolved.
      Tri macro = triplanarRib(tRock, vWorld, n, sRock, 0.0, 0.35);
      Tri macro2 = triplanarRib(tRock, vWorld, n, sRock * 0.37, 1.1, 0.5);
      float nearFade = 1.0 - smoothstep(600.0, 2200.0, dist);
      // Skipped where it cannot contribute (nearFade 0): three fetches saved
      // on every distant pixel, the result identical.
      Tri near = Tri(vec3(0.0), 0.0, 0.5);
      if (nearFade > 0.0) near = triplanar(tRockNear, vWorld, n, sRockNear, 0.4);
      float detailFade = 1.0 - smoothstep(9000.0, 30000.0, dist);
      vec3 dn = (macro.dn * 1.3 + macro2.dn * 0.8 * (1.0 - smoothstep(2500.0, 9000.0, dist))) * detailFade + near.dn * 0.7 * nearFade;
      float rh = mix(macro.h, macro2.h, 0.35);
      float breakup = vnoise12(vWorld.xz / 23.0) * 0.15 + rh;
      // Masks from the real surface.
      // Rock: cliffs (by slope, broken up by the rock's own relief and
      // pushed out of gullies), sharp convex crests, and bare ground above
      // the treeline. At 10-20 m DEM spacing, 35-45 degree slopes are still
      // mostly forested in wet mountain country, so the cliff band starts
      // near 47 degrees.
      float treeLine = rTreeline + (breakup - 0.5) * 220.0 + curv * 140.0;
      float alpine = smoothstep(treeLine - 50.0, treeLine + 350.0, h);
      // Edges kept ordered: a pack whose forest stops below 30 degrees
      // (tundra) would otherwise invert smoothstep and mark flats as rock.
      float cliff0 = max(40.0, rForestMaxSlope - 6.0);
      float rockMask = smoothstep(cliff0, max(cliff0 + 8.0, rForestMaxSlope + 10.0), slopeDeg + (rh - 0.5) * 16.0 - curv * 12.0);
      rockMask = max(rockMask, smoothstep(0.45, 0.9, -curv) * smoothstep(30.0, 44.0, slopeDeg) * 0.7);
      // Above the treeline, bare rock where it is steep or sharply convex;
      // gentle alpine ground stays meadow/tundra mat (a flat valley of
      // "rock" tiles its detail texture into a visible grid).
      rockMask = max(rockMask, alpine * smoothstep(20.0, 38.0, slopeDeg + (rh - 0.5) * 18.0 - curv * 10.0));
      float forest = (1.0 - smoothstep(treeLine - 90.0, treeLine + 60.0, h))
        * (1.0 - smoothstep(rForestMaxSlope - 6.0, rForestMaxSlope + 4.0, slopeDeg))
        * smoothstep(rForestFloor - 60.0, rForestFloor + 60.0, h + (breakup - 0.5) * 200.0)
        * rForestDensity * ice.z;
      float snowLine = rSnowline + (breakup - 0.5) * 260.0 - curv * 180.0;
      float snow = smoothstep(snowLine, max(snowLine + 1.0, snowLine + (rSnowFull - rSnowline)), h);
      snow *= 1.0 - smoothstep(rSnowMaxSlope - 10.0, rSnowMaxSlope + 6.0, slopeDeg - max(curv, 0.0) * 25.0);
      topoWood = forest / max(rForestDensity, 1e-3);
      topoSnow = snow;
      // Canopy: the third, farthest forest scale (instanced trees nearer).
      // Two rotated canopy samples at unrelated scales hide the tile grid.
      vec4 cn = mix(texture(tCanopy, vWorld.xz / sCanopy), texture(tCanopy, mat2(0.8, -0.6, 0.6, 0.8) * vWorld.xz / (sCanopy * 1.73)), 0.5);
      cn.b = smoothstep(0.35, 0.75, cn.b);
      float crowns = cn.b * forest;
      // Ground between: meadow on gentle open slopes, soil/scree steeper,
      // moss along wet drainage.
      vec3 ground = mix(pMeadow, pSoil, smoothstep(18.0, 34.0, slopeDeg));
      // Drainage moss only where water actually runs: on filled flats the
      // D8 flow routing is an artefact of straight diagonal channels.
      ground = mix(ground, pMoss, rMoss * smoothstep(0.35, 0.75, flowN) * smoothstep(1.5, 5.0, slopeDeg) * (1.0 - rockMask));
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
      // Two snow scales at unrelated sizes and angles: a single 60 m tile
      // repeats visibly as a grid across a wide snowy flat.
      Tri sn = triplanar(tSnow, vWorld, n, sSnow, 0.7);
      Tri sn2 = triplanar(tSnow, vWorld, n, sSnow * 3.7, 2.1);
      sn.h = mix(sn.h, sn2.h, 0.5);
      sn.dn = mix(sn.dn, sn2.dn, 0.5);
      vec3 snowCol = mix(pSnowShade, pSnow, 0.7 + 0.3 * sn.h);
      albedo = mix(albedo, snowCol, snow);
      // Detail normal: rock gets the full detail, forest the crowns, snow
      // its own ripples.
      vec3 cdn = vec3(cn.r * 2.0 - 1.0, 0.0, cn.g * 2.0 - 1.0) * 0.8;
      vec3 detail = mix(dn * mix(0.15, 1.0, rockMask), cdn, crowns);
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
    // Ice detail is fixed to the lobe. Longitudinal debris bands curve
    // gently, while transverse crevasses open across the flow. Neither
    // feature swims with the camera or expands on every drum hit.
    if (ice.y > 0.0) {
      vec2 axis = normalize(uGlacierEnd - uGlacierStart);
      vec2 rel = vWorld.xz - uGlacierStart;
      float along = dot(rel, axis), across = dot(rel, vec2(-axis.y, axis.x));
      float crackPhase = along / 105.0 + 0.75 * sin(across / 230.0) + 1.6 * vnoise12(vWorld.xz / 260.0);
      float crackEdge = abs(fract(crackPhase) - 0.5);
      float aa = max(0.008, fwidth(crackPhase));
      float crack = 1.0 - smoothstep(0.018, 0.018 + aa, crackEdge);
      // Once many fissures fall inside a pixel, preserve their mean area
      // instead of broadening each dark line into a distant zebra stripe.
      crack = mix(crack, 0.04, smoothstep(0.15, 0.5, aa));
      crack *= smoothstep(0.2, 0.55, vnoise12(vec2(across / 310.0, along / 650.0)));
      float debris = pow(0.5 + 0.5 * sin(across / 145.0 + sin(along / 1350.0)), 18.0);
      float grain = vnoise12(vWorld.xz / 55.0);
      vec3 iceColor = mix(vec3(0.42, 0.66, 0.78), vec3(0.84, 0.93, 0.98), grain * 0.5 + 0.5);
      iceColor = mix(iceColor, vec3(0.025, 0.09, 0.14), crack * 0.8);
      iceColor = mix(iceColor, vec3(0.10, 0.12, 0.12), debris * 0.38);
      albedo = mix(albedo, iceColor, ice.y);
      nShade = normalize(mix(nShade, iceNormal, ice.y));
      rough = mix(rough, 0.3, ice.y);
    } else if (uGlacierEnabled > 0.5 && ice.z < 1.0 && !water) {
      // Newly exposed ground stays dark and wet before its canopy returns.
      albedo = mix(albedo * 0.58, albedo, ice.z);
    }
    // The Forest Service map under the land: paper, woodland green, blue
    // water and streams, brown contours every 40 m (index every 200 m;
    // blue on snow and ice) and the red one-mile section grid, all fixed
    // to the source ground. Still lit by the scene, so it keeps the
    // valley's relief, time of day and haze. Derivatives are taken outside
    // the branch; lines fade out where they would crowd within a pixel.
    float topo = topoMask(vWorld.xz);
    float cv = h / 40.0, cfw = max(fwidth(cv), 1e-4);
    float iv = h / 200.0, ifw = max(fwidth(iv), 1e-4);
    vec2 sv = vWorld.xz / 1609.34, sfw = max(fwidth(sv), vec2(1e-4));
    if (topo > 0.0) {
      float minor = (1.0 - smoothstep(0.35, 1.0, abs(fract(cv + 0.5) - 0.5) / cfw)) * (1.0 - smoothstep(0.3, 0.7, cfw));
      float index = (1.0 - smoothstep(0.8, 1.5, abs(fract(iv + 0.5) - 0.5) / ifw)) * (1.0 - smoothstep(0.3, 0.7, ifw));
      vec2 sd = abs(fract(sv + 0.5) - 0.5) / sfw;
      float grid = (1.0 - smoothstep(0.4, 1.2, min(sd.x, sd.y))) * (1.0 - smoothstep(0.2, 0.5, max(sfw.x, sfw.y)));
      float stream = water ? 0.0 : smoothstep(0.62, 0.8, flowN) * smoothstep(1.5, 4.0, slopeDeg);
      float white = max(topoSnow, ice.y);
      vec3 map = mix(vec3(0.43, 0.40, 0.34), vec3(0.26, 0.36, 0.17), 0.75 * smoothstep(0.15, 0.45, topoWood));
      map = mix(map, vec3(0.62, 0.62, 0.60), white);
      if (water) map = vec3(0.20, 0.40, 0.60);
      map = mix(map, vec3(0.50, 0.05, 0.03), grid * 0.55);
      map = mix(map, mix(vec3(0.28, 0.13, 0.04), vec3(0.04, 0.16, 0.42), white), max(minor * 0.7, index) * (water ? 0.0 : 0.9));
      map = mix(map, vec3(0.04, 0.16, 0.42), stream * 0.8);
      // A thin inked edge where the map meets the land.
      map *= 1.0 - 0.35 * topo * (1.0 - topo) * 4.0;
      albedo = mix(albedo, map, topo);
      nShade = normalize(mix(nShade, n, topo));
      rough = mix(rough, 0.9, topo);
    }
    // Light: the celestial as a soft wrap-diffuse key, sky hemisphere fill,
    // occlusion from curvature and drainage (gullies sit in shade).
    float wrap = 0.18;
    float key = max((dot(nShade, uLightDir) + wrap) / (1.0 + wrap), 0.0);
    // The opening relief shares the physical key. A dormant direction
    // must not change even its neutral surface shading during a gap.
    key *= step(1e-10, dot(uLightColor, uLightColor));
    float ao = clamp(1.0 - max(curv, 0.0) * 0.55 - flowN * 0.12, 0.35, 1.0);
    // Sky radiance: the displayed sky colours are radiance, and a surface
    // integrates the hemisphere, hence the scale.
    vec3 hemi = mix(uSkyHorizon * 0.55, uSkyZenith, 0.5 + 0.5 * nShade.y) * uAmbientScale;
    vec3 lit = albedo * (hemi * ao + uLightColor * key * mix(0.85, 1.0, ao));
    if (uDebugMask == 3) { outColor = vec4(albedo * 4.0, 1.0); return; }
    if (uDebugMask == 4) { outColor = vec4(hemi * ao * 0.5, 1.0); return; }
    if (uDebugMask == 5) { outColor = vec4(vec3(key), 1.0); return; }
    vec3 V = normalize(uCameraPos - vRenderedWorld);
    if (water && uHasMaterial > 0.5) {
      vec2 ripple = vec2(sin(vWorld.x * 0.012 + uTime * 0.45), cos(vWorld.z * 0.017 - uTime * 0.32)) * 0.025;
      vec3 waterNormal = normalize(vec3(ripple.x, 1.0, ripple.y));
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), V), 0.0), 5.0);
      vec3 halfVector = uLightDir + V;
      vec3 H = halfVector / max(length(halfVector), 1e-10);
      float glint = waterGlint(dot(H, waterNormal), rWaterGlintGain, dot(uLightColor, uLightColor));
      // The lake mirrors the sky above the far shore, not only its pale
      // horizon band: an all-horizon mirror turned broad lakes into a
      // flat white sheet that outshone the mountains.
      vec3 skyReflect = mix(uSkyZenith, uSkyHorizon, 0.3) * 0.5;
      lit = mix(lit, skyReflect * rWaterSkyMix, fres * (1.0 - topo)) + uLightColor * glint * (1.0 - topo);
    }
    // Aerial perspective, applied once here and nowhere else.
    float heightTerm = exp(-max(0.0, vRenderedWorld.y - uCameraPos.y * 0.25) * uAirHeightFalloff);
    float air = 1.0 - exp(-dist * uAirDensity * (0.35 + 0.65 * heightTerm));
    // Air is the displayed sky colour; bring it into the exposed domain so
    // distant terrain converges on the sky the 2D painter draws behind it.
    // Valley mist first (it sits in the near and middle air), then the
    // distance air over everything, mist included.
    vec3 neutral = vec3(.42) * (.45 + .55 * key);
    vec3 physical = mix(neutral, tonemap(lit * uExposure), uNarrative.z);
    if (water || ice.y > .01) physical = mix(neutral, physical, uNarrative.w);
    vec3 color = mix(uSkyHorizon, physical, uNarrative.x);
    color = mix(color, uMistColor, mistAmount(uCameraPos, vRenderedWorld) * uNarrative.y);
    color = mix(color, uAirColor, clamp(air, 0.0, 0.96) * uNarrative.y);
    // A narrow physical silhouette supplies the main opening ink. Sparse
    // source-space hints are drawn separately against this same depth.
    float facing = abs(dot(geologicalNormal, V));
    float aa = max(.008, fwidth(facing));
    float edge = 1.0 - smoothstep(.02 - aa, .02 + aa, facing);
    color = mix(color, vec3(0.0), edge * uNarrativeInk);
    outColor = vec4(linearToSrgb(color), 1.0);
    if (uDiag > 0.5) outColor = vec4(1.0, 0.0, 1.0, 1.0);
  }
`;

export const DEPTH_FRAG = /* glsl */`
  precision highp float;
  out vec4 outColor;
  void main() { outColor = vec4(0.0); }
`;

export const FEATURE_FRAG = /* glsl */`
  precision highp float;
  uniform float uNarrativeInk;
  out vec4 outColor;
  void main() { if (uNarrativeInk < .005) discard; outColor = vec4(0.0, 0.0, 0.0, uNarrativeInk); }
`;

/** The forest's gust-front slots, all idle. */
export function gustUniforms() {
  return { uGustAge: { value: new Array(GUST_FRONTS).fill(GUST_IDLE_SEC) },
    uGustAmp: { value: new Array(GUST_FRONTS).fill(0) }, uGustDir: { value: new Array(GUST_FRONTS).fill(1) } };
}

/** Shared uniforms for the production terrain (values set per frame). */
export function sceneUniforms(THREE, base) {
  return {
    ...base,
    uGlacierEnabled: { value: 0 }, uGlacierStart: { value: new THREE.Vector2() }, uGlacierEnd: { value: new THREE.Vector2(0, -100) },
    uGlacierWidth: { value: 1 }, uGlacierSurface: { value: new THREE.Vector2() }, uGlacierMaxThickness: { value: 0 }, uGlacierRetreat: { value: 0 },
    uDeformAmp: { value: 0 }, uDeformKick: { value: 0 }, uDeformK: { value: 0 },
    uDeformGesture: { value: 0 }, uDeformMelodic: { value: 0 }, uDeformStructural: { value: 0 },
    uMelodyK: { value: 0 }, uMelodyDir: { value: new THREE.Vector2(1, 0) }, uMelodyPhase: { value: 0 },
    uDeformDir: { value: new THREE.Vector2(0.8, -0.6) }, uDeformPhase: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightColor: { value: new THREE.Color(1, 1, 1) },
    uSolarTransmission: { value: 0 },
    uSkyZenith: { value: new THREE.Color(0.1, 0.12, 0.2) },
    uSkyHorizon: { value: new THREE.Color(0.3, 0.35, 0.45) },
    uAirColor: { value: new THREE.Color(0.35, 0.4, 0.5) },
    uAirDensity: { value: 1 / 60000 },
    uAirHeightFalloff: { value: 1 / 2500 },
    // Valley mist (RangeAtmosphere): off until the scene sets it per frame.
    uMistDensity: { value: 0 }, uMistBase: { value: 0 }, uMistHeight: { value: 220 }, uMistTime: { value: 0 },
    uMistSteps: { value: MIST_SAMPLES },
    uMistColor: { value: new THREE.Color(0.4, 0.43, 0.48) },
    uCameraPos: { value: new THREE.Vector3() },
    uDiag: { value: 0 },
    uHasMaterial: { value: 0 },
    uAmbientScale: { value: 2.5 },
    uDebugMask: { value: 0 },
    uTime: { value: 0 },
    // Gust fronts in flight: age (s), strength, and way across the frame.
    ...gustUniforms(),
    uForestKeep: { value: 1 },
    uExposure: { value: 2.0 },
    uNarrative: { value: new THREE.Vector4(1, 1, 1, 1) },
    uNarrativeInk: { value: 0 },
    // How much of the map under the land shows (TopoReveal).
    uTopo: { value: 0 },
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
    rForestFloor: { value: RULE_DEFAULTS.forestFloorM },
    rWaterSkyMix: { value: RULE_DEFAULTS.waterSkyMix }, rWaterGlintGain: { value: RULE_DEFAULTS.waterGlintGain },
  };
}

const ROLE_UNIFORM = { rockDetail: ['tRock', 'sRock'], rockNear: ['tRockNear', 'sRockNear'], canopy: ['tCanopy', 'sCanopy'],
  snow: ['tSnow', 'sSnow'], soil: ['tSoil', 'sSoil'] };
const PALETTE_UNIFORM = { rockLit: 'pRockLit', rockShade: 'pRockShade', rockWarm: 'pRockWarm', soil: 'pSoil', meadow: 'pMeadow',
  forestNear: 'pForestNear', forestFar: 'pForestFar', moss: 'pMoss', snow: 'pSnow', snowShade: 'pSnowShade',
  water: 'pWater', waterDeep: 'pWaterDeep', lichen: 'pLichen' };
const RULE_UNIFORM = { snowlineM: 'rSnowline', snowFullM: 'rSnowFull', snowMaxSlopeDeg: 'rSnowMaxSlope', treelineM: 'rTreeline',
  forestMaxSlopeDeg: 'rForestMaxSlope', forestDensity: 'rForestDensity', moss: 'rMoss', strata: 'rStrata',
  forestFloorM: 'rForestFloor', waterSkyMix: 'rWaterSkyMix', waterGlintGain: 'rWaterGlintGain' };

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
  const rules = { ...pack.manifest.rules, ...ruleOverrides };
  const check = validateWaterRules(rules);
  if (!check.ok) throw new RangeAssetError('manifest', `material rules rejected: ${check.errors.join('; ')}`);
  for (const [role, [tu, su]] of Object.entries(ROLE_UNIFORM)) {
    const r = textures.roles[role];
    if (!r) continue;
    uniforms[tu].value = r.texture;
    uniforms[su].value = r.metersPerTile;
  }
  for (const [k, u] of Object.entries(PALETTE_UNIFORM)) setLinearFromHex(uniforms[u].value, pack.manifest.palette[k]);
  for (const [k, u] of Object.entries(RULE_UNIFORM)) uniforms[u].value = rules[k] ?? RULE_DEFAULTS[k];
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
