import { hexToLinear, RULE_DEFAULTS, validateWaterRules } from './MaterialPackage.js';
import { GUST_FRONTS, GUST_IDLE_SEC, GUST_SWEEP_SEC } from './Gust.js';
import { RangeAssetError } from './RangeAssets.js';
import { MIRROR_LIFT } from './WaterMirror.js';
import { ACTOR_GLSL, WAKE_GLSL, actorUniforms } from './ActorsGL.js';
import { STORM_GLSL } from './RangeStorm.js';
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
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uAirColor;
  uniform float uAirDensity;
  uniform float uAirHeightFalloff;
  uniform vec3 uCameraPos;
  uniform float uDiag;
  uniform vec4 uStorm; // squall, cloud lightning, clearing, wet receivers
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
  // Lake mirror (WaterMirror.js): the ground seen from the camera reflected
  // about the water level, projected by uMirrorMatrix; uMirrorAmount 0 when
  // there is none. While that image is drawn, ground below uClipBelow is cut.
  uniform sampler2D uMirror;
  uniform mat4 uMirrorMatrix;
  uniform float uMirrorAmount;
  uniform float uMirrorLevel;
  uniform float uMirrorRipple;
  uniform float uClipBelow;
  uniform vec2 uViewportPx;
  // The 2D backdrop (sky, aurora, distant ranges) as the stage shows it,
  // and the camera's view-projection to find where a reflected ray meets it.
  uniform sampler2D uBackdrop;
  uniform float uBackdropAmount;
  uniform mat4 uViewProj;
  // Gust fronts (the forest's): on the water they are cat's paws, rough
  // patches that cross the frame with each front and break the mirror.
  uniform float uGustAge[${GUST_FRONTS}];
  uniform float uGustAmp[${GUST_FRONTS}];
  uniform float uGustDir[${GUST_FRONTS}];
  // The cast's lanterns (ActorsGL.js): their light, glints and Midio's wake.
  ${ACTOR_GLSL}
  ${WAKE_GLSL}
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
  ${STORM_GLSL}
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
  vec3 srgbToLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
  // How rough the water is here from the passing gust fronts: each front
  // reaches a screen column when the forest's does, rises fast and settles
  // over ~1.5 s, in drifting patches rather than a solid band.
  float catsPaw(vec2 xz) {
    float sx = clamp(gl_FragCoord.x / max(uViewportPx.x, 1.0) * 2.0 - 1.0, -1.2, 1.2);
    float paw = 0.0;
    for (int i = 0; i < ${GUST_FRONTS}; i++) {
      float age = uGustAge[i] - ((sx * uGustDir[i]) * 0.5 + 0.5) * ${GUST_SWEEP_SEC.toFixed(3)};
      float env = age < 0.0 ? 0.0 : (age < 0.35 ? age / 0.35 : exp(-(age - 0.35) / 1.5));
      paw = max(paw, env * uGustAmp[i]);
    }
    float patches = smoothstep(0.38, 0.72, vnoise12(xz / 160.0 + vec2(uTime * 0.05, -uTime * 0.03)));
    return paw * patches;
  }
  float waterGlint(float cosine, float gain, float keyEnergy) {
    if (keyEnergy < 1e-10 || gain <= 0.0) return 0.0;
    return pow(max(cosine, 0.0), 600.0) * gain;
  }

  void main() {
    if (vRenderedWorld.y < uClipBelow) discard;
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
    if (!water) { albedo *= 1.0 - uStorm.w * .18; rough *= 1.0 - uStorm.w * .4; }
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
    // The cast's lanterns light the ground around them.
    lit += albedo * actorLight(vRenderedWorld, nShade);
    // Broken cloud transmits the real solar key in broad moving swathes
    // across wet receivers; world coordinates keep them fixed to the land.
    // Between the swathes the last of the cloud still shades the land, and
    // wet rock and grass shine back toward the sun.
    float opening=stormOpening(vRenderedWorld);
    if (!water) lit *= 1.0 - uStorm.z*(1.0-opening)*.5;
    lit += albedo*uLightColor*key*uStorm.z*opening*.85;
    if (!water && uStorm.w > 0.0) {
      vec3 sheenH = normalize(uLightDir + normalize(uCameraPos - vRenderedWorld));
      lit += uLightColor * pow(max(dot(nShade, sheenH), 0.0), 48.0) * uStorm.w * (0.12 + 0.6*uStorm.z*opening) * (1.0 - 0.75*uStorm.y);
    }
    float giantShade = 0.0;
    if (!water && uGiantPeak[1] > 0.0) {
      giantShade = broshiShadow(vRenderedWorld);
      vec3 delta=vRenderedWorld-uGiantCenter[1];
      float lantern=1.0-smoothstep(uGiantSpan[1]*.45,uGiantSpan[1]*.85,length(vec2(dot(delta,uGiantRight),delta.y)));
      // A broad spill from Broshi's lantern gives his shadow contrast in
      // dark dawn. In daylight the scene's key remains dominant.
      lit += albedo * max(vec3(.3,.22,.16)-hemi*.08,vec3(0.0))*lantern*uGiantPeak[1];
      lit *= 1.0 - giantShade*.96;
    }
    if (uDebugMask == 3) { outColor = vec4(albedo * 4.0, 1.0); return; }
    if (uDebugMask == 4) { outColor = vec4(hemi * ao * 0.5, 1.0); return; }
    if (uDebugMask == 5) { outColor = vec4(vec3(key), 1.0); return; }
    vec3 V = normalize(uCameraPos - vRenderedWorld);
    float waterFres = 0.0, paw = 0.0, wake = 0.0;
    vec3 waterN = vec3(0.0, 1.0, 0.0);
    if (water && uHasMaterial > 0.5) {
      // Midio's wake roughens the water as a cat's paw does.
      wake = wakeAt(vWorld.xz);
      // Rain stipples the whole lake while the squall is over it.
      paw = max(max(catsPaw(vWorld.xz), wake), uStorm.x * 0.75);
      vec2 ripple = vec2(sin(vWorld.x * 0.012 + uTime * 0.45), cos(vWorld.z * 0.017 - uTime * 0.32)) * (0.025 + 0.05 * paw);
      vec3 waterNormal = normalize(vec3(ripple.x, 1.0, ripple.y));
      waterN = waterNormal;
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), V), 0.0), 5.0);
      // Rough water reflects less, so a cat's paw reads as a darker patch.
      fres *= 1.0 - 0.35 * paw;
      waterFres = fres;
      vec3 halfVector = uLightDir + V;
      vec3 H = halfVector / max(length(halfVector), 1e-10);
      float glint = waterGlint(dot(H, waterNormal), rWaterGlintGain, dot(uLightColor, uLightColor));
      // The lake mirrors the sky above the far shore, not only its pale
      // horizon band: an all-horizon mirror turned broad lakes into a
      // flat white sheet that outshone the mountains.
      vec3 skyReflect = mix(uSkyZenith, uSkyHorizon, 0.3) * 0.5;
      // With the backdrop to reflect, the sky arrives with the mirror below.
      float skyHere = fres * (1.0 - uBackdropAmount * uMirrorAmount);
      lit = mix(lit, skyReflect * rWaterSkyMix, skyHere) + uLightColor * glint;
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
    float mist = mistAmount(uCameraPos, vRenderedWorld) * uNarrative.y;
    color = mix(color, mistColorAt(uCameraPos, vRenderedWorld), mist);
    // Under a cloud sea the lake's mirror and glints are hidden with it.
    float clear = 1.0 - mist * uMistFill;
    color = mix(color, uAirColor, clamp(air, 0.0, 0.96) * uNarrative.y);
    // What reaches the eye from his shadow is dimmed too: the air and mist
    // in front of the slope lie in it, and the opening's neutral land must
    // not wash his outline out of the range.
    float veil = 1.0 - (1.0 - clamp(air, 0.0, 1.0)) * (1.0 - mist);
    color *= 1.0 - giantShade * (.5 + .3 * veil);
    color = mix(color, rainColor(), rainVeil(vRenderedWorld, dist) * 0.8 * uNarrative.y);
    // The lake mirrors the ground above it. The mirror image already holds
    // the air along its own (longer) path, so it replaces the water's colour
    // by the water's reflectance, as the sky reflection did in lit. Groove
    // and kicks shiver it in horizontal bands; a cat's paw breaks it up.
    if (water && uMirrorAmount > 0.0) {
      float band = gl_FragCoord.y / max(uViewportPx.y, 1.0) * 260.0 + vnoise12(vWorld.xz / 240.0) * 6.2832;
      vec2 shiver = vec2(0.3 * sin(band * 0.37 - uTime * 1.7), sin(band + uTime * 2.3)) * uMirrorRipple * (1.0 + 3.0 * paw);
      // The backdrop, met by the view ray reflected off flat water (it is far
      // enough away to treat as the sky), then the ground mirrored over it.
      // Seen from high above a lake, the true reflection of distant ranges
      // lies beyond its far shore; magical naturalism lowers the reflected
      // ray (MIRROR_LIFT, as the mirror camera does) so the water holds them.
      vec3 ray = normalize(vRenderedWorld - uCameraPos);
      vec3 up = vec3(ray.x, abs(ray.y) * ${MIRROR_LIFT.toFixed(3)}, ray.z);
      vec4 bc = uViewProj * vec4(uCameraPos + normalize(up) * 60000.0, 1.0);
      vec3 mirrored = srgbToLinear(texture(uBackdrop, clamp(bc.xy / bc.w * 0.5 + 0.5 + shiver, vec2(0.001), vec2(0.999))).rgb);
      float have = uBackdropAmount;
      vec4 mc = uMirrorMatrix * vec4(vRenderedWorld, 1.0);
      if (mc.w > 0.0 && abs(vWorld.y - uMirrorLevel) < 3.0) {
        vec4 m = texture(uMirror, clamp(mc.xy / mc.w + shiver, vec2(0.001), vec2(0.999)));
        if (m.a > 0.004) mirrored = mix(mirrored, srgbToLinear(m.rgb / m.a), have > 0.0 ? m.a : 1.0);
        have = max(have, m.a);
      }
      // Stiller and glossier than physical water: a lake seen from high
      // above still holds its shores (magical naturalism, like the lift).
      float reflectance = clamp(0.3 + 0.7 * waterFres, 0.0, 0.9) * (1.0 - 0.4 * paw);
      color = mix(color, mirrored * 0.9, reflectance * have * clear * uNarrative.z * uNarrative.w);
    }
    if (water) {
      // Lanterns over the water lay a path of glints; Midio's wake catches
      // his light. Over the mirror, through the air.
      vec3 glow = actorGlint(vRenderedWorld, V, waterN) * 0.6 + uActorColor[0] * wake * 0.12;
      // Rain on the lake breaks the path up, so it fades with the squall.
      color += glow * clear * uNarrative.z * (1.0 - 0.85 * clamp(air, 0.0, 1.0)) * (1.0 - 0.75 * uStorm.x);
    }
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
  uniform float uClipBelow;
  in vec3 vRenderedWorld;
  out vec4 outColor;
  void main() { if (vRenderedWorld.y < uClipBelow) discard; outColor = vec4(0.0); }
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
    ...actorUniforms(THREE),
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
    uMistSteps: { value: MIST_SAMPLES }, uMistTop: { value: 1e9 }, uMistFill: { value: 0 },
    uMistDrift: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    uMistColor: { value: new THREE.Color(0.4, 0.43, 0.48) },
    uCameraPos: { value: new THREE.Vector3() },
    uDiag: { value: 0 },
    uHasMaterial: { value: 0 },
    uStorm: { value: new THREE.Vector4() }, uRainShift: { value: 0 },
    uAmbientScale: { value: 2.5 },
    uDebugMask: { value: 0 },
    uTime: { value: 0 },
    // Gust fronts in flight: age (s), strength, and way across the frame.
    ...gustUniforms(),
    uForestKeep: { value: 1 },
    uExposure: { value: 2.0 },
    uNarrative: { value: new THREE.Vector4(1, 1, 1, 1) },
    uNarrativeInk: { value: 0 },
    // Lake mirror (WaterMirror.js), off until the scene draws one.
    uMirror: { value: null }, uMirrorMatrix: { value: new THREE.Matrix4() }, uMirrorAmount: { value: 0 },
    uMirrorLevel: { value: 0 }, uMirrorRipple: { value: 0 }, uClipBelow: { value: -1e9 },
    uViewportPx: { value: new THREE.Vector2(1, 1) },
    uBackdrop: { value: null }, uBackdropAmount: { value: 0 }, uViewProj: { value: new THREE.Matrix4() },
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
