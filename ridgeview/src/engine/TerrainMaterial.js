// The terrain shader. One program draws every tile in every visual mode:
// natural materials (rock, scree, meadow, forest, snow, water) lit by the
// sun, moon and sky with terrain shadows and aerial perspective, or one of
// the stylized looks (topographic contours, engraving, hypsometric tint,
// hologram), with optional analysis overlays (slope angle, aspect,
// elevation bands). Per-pixel normals come from the tile texture; finer
// relief than the data is added procedurally and fades with distance.
import * as THREE from 'three';
import { NOISE, ATMOS, LOGDEPTH_VS } from './glsl.js';

export const STYLE = { natural: 0, contours: 1, ink: 2, hypsometric: 3, hologram: 4, pixel: 5 };
export const OVERLAY = { none: 0, slope: 1, aspect: 2, bands: 3 };

/** Uniforms shared by all tiles (one object; tiles reference its entries). */
export function createGlobals() {
  const v3 = () => ({ value: new THREE.Vector3() });
  const c = (hex) => ({ value: new THREE.Color(hex) });
  return {
    uLogDepthFC: { value: 2 / Math.log2(1e8 + 1) },
    uSunDir: v3(), uSunPower: { value: 22 }, uMoonDir: v3(), uMoonPower: { value: 0 },
    uCamKm: v3(), uMieMul: { value: 1 }, uRayMul: { value: 1 }, uAmbientTint: { value: new THREE.Vector3(0.02, 0.025, 0.035) },
    uSkyIrr: v3(), uSkyZenith: v3(), uSkyHorizon: v3(),
    uStyle: { value: 0 }, uOverlay: { value: 0 }, uOverlayMix: { value: 0 },
    uSnowShift: { value: 0 }, uTreeShift: { value: 0 }, uForestDensity: { value: 0.85 }, uForestFloor: { value: -1000 },
    uDryness: { value: 0.2 }, uAutumn: { value: 0 }, uWetness: { value: 0 }, uPlaya: { value: 0 },
    uForestCol: c('#1d3a24'), uGrassCol: c('#5d7a3a'), uDryCol: c('#9a8a5c'), uRockCol: c('#77726c'), uRockCol2: c('#5d5853'),
    uSoilCol: c('#6b5a48'), uSnowCol: c('#eef3fa'), uWaterCol: c('#1b4656'), uAutumnCol: c('#b0602a'),
    uCloudOn: { value: 0 }, uCloudTop: { value: 2200 }, uCloudThick: { value: 500 }, uCloudCol: v3(),
    uStormDark: { value: 0 },
    uTime: { value: 0 },
    uShadow0: { value: null }, uShadow1: { value: null }, uShadowM0: { value: new THREE.Matrix4() }, uShadowM1: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 }, uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) }, uShadowBias: { value: new THREE.Vector2(1e-4, 1e-4) },
    uMicro: { value: 1 },
  };
}

const VS = /* glsl */ `
attribute float aH;
uniform vec3 uTileCenter;   // tile centre ECEF (m), float precision is enough for directions
uniform mat4 uShadowM0, uShadowM1;
varying vec2 vUv;
varying float vH;
varying vec3 vRel;
varying vec3 vUp;
varying vec4 vS0;
varying vec4 vS1;
${LOGDEPTH_VS}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz;
  vUv = uv;
  vH = aH;
  vUp = normalize(uTileCenter + position);
  vS0 = uShadowM0 * wp;
  vS1 = uShadowM1 * wp;
  gl_Position = projectionMatrix * viewMatrix * wp;
  applyLogDepth();
}
`;

const FS = /* glsl */ `
precision highp float;
${NOISE}
${ATMOS}
uniform sampler2D uTex;
uniform float uTexSize, uS;
uniform vec2 uTileOrigin;     // mercator metres of the NW corner, mod 2048
uniform float uTileSizeM;     // mercator metres across the tile
uniform float uCosLat;
uniform vec3 uSkyIrr, uSkyZenith, uSkyHorizon;
uniform int uStyle, uOverlay;
uniform float uOverlayMix;
uniform float uSnowShift, uTreeShift, uForestDensity, uForestFloor, uDryness, uAutumn, uWetness, uPlaya;
uniform vec3 uForestCol, uGrassCol, uDryCol, uRockCol, uRockCol2, uSoilCol, uSnowCol, uWaterCol, uAutumnCol;
uniform float uCloudOn, uCloudTop, uCloudThick;
uniform vec3 uCloudCol;
uniform float uStormDark, uTime, uMicro;
uniform sampler2D uShadow0, uShadow1;
uniform float uShadowOn;
uniform vec2 uShadowTexel;
uniform vec2 uShadowBias;
varying vec2 vUv;
varying float vH;
varying vec3 vRel;
varying vec3 vUp;
varying vec4 vS0;
varying vec4 vS1;

float table(float x, const float xs[10], const float ys[10]) {
  if (x <= xs[0]) return ys[0];
  for (int i = 1; i < 10; i++) if (x <= xs[i]) return mix(ys[i - 1], ys[i], (x - xs[i - 1]) / (xs[i] - xs[i - 1]));
  return ys[9];
}
const float LATS[10] = float[10](0.0, 20.0, 30.0, 37.0, 44.0, 50.0, 55.0, 60.0, 66.0, 75.0);
const float TREE[10] = float[10](3900.0, 3900.0, 3700.0, 3400.0, 3050.0, 2300.0, 1600.0, 1050.0, 600.0, 0.0);
const float SNOW[10] = float[10](4800.0, 4800.0, 4500.0, 3900.0, 3500.0, 2900.0, 2400.0, 1900.0, 1300.0, 500.0);

float shadowTap(sampler2D m, vec3 c, float bias) { return step(c.z - bias, texture(m, c.xy).r); }
float shadowPCF(sampler2D m, vec4 sc, float rad, float bias) {
  vec3 c = sc.xyz / sc.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return -1.0;
  float a = hash12(gl_FragCoord.xy) * 6.2831;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  float s = 0.0;
  const vec2 K[8] = vec2[8](vec2(-0.613, 0.617), vec2(0.170, -0.040), vec2(-0.299, -0.792), vec2(0.645, 0.493),
    vec2(-0.651, -0.110), vec2(0.421, -0.553), vec2(-0.085, 0.902), vec2(0.906, -0.122));
  for (int i = 0; i < 8; i++) s += shadowTap(m, vec3(c.xy + R * K[i] * uShadowTexel * rad, c.z), bias);
  return s / 8.0;
}
float terrainShadow() {
  if (uShadowOn < 0.5) return 1.0;
  float s = shadowPCF(uShadow0, vS0, 1.6, uShadowBias.x);
  if (s >= 0.0) return s;
  s = shadowPCF(uShadow1, vS1, 1.3, uShadowBias.y);
  return s >= 0.0 ? s : 1.0;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Lines every 'interval' metres of height, ~w px wide. 1 on the line.
float isoLine(float h, float interval, float w) {
  float fw = max(fwidth(h), 1e-4);
  float d = abs(fract(h / interval - 0.5) - 0.5) * interval / fw;
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, d);
}

// Contour set whose spacing follows the on-screen footprint: returns
// (minor, index) line coverage.
vec2 contours(float h, float footM) {
  float lvl = log2(max(footM * 7.0, 10.0) / 10.0);
  float i0 = floor(lvl), fr = lvl - i0;
  float I = 10.0 * exp2(i0);
  float minor = max(isoLine(h, 2.0 * I, 1.0), isoLine(h, I, 1.0) * (1.0 - fr));
  float index = isoLine(h, 8.0 * I, 2.0);
  return vec2(minor, index);
}

float fbm2(vec2 p, float per) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p, per); p *= 2.0; per *= 2.0; a *= 0.5; }
  return s;
}

void main() {
  vec2 tuv = (vec2(1.5) + vUv * uS) / uTexSize;
  vec4 tx = texture(uTex, tuv);
  vec3 up = normalize(vUp);
  vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), up));
  vec3 north = cross(up, east);
  float distM = length(vRel);
  vec3 V = -vRel / max(distM, 1e-3);
  float footM = max(length(fwidth(vRel)), 1e-3); // ground metres per pixel
  float near = smoothstep(12.0, 2.0, footM);       // 1 when individual metres are visible

  // Tile-local, world-locked coordinates (mercator metres, period 2048).
  vec2 gp = uTileOrigin + vUv * uTileSizeM;
  gp.y = -gp.y; // north-up
  float slope = length(tx.xy);
  float sdeg = degrees(atan(slope));
  float cvx = tx.w;
  float water = smoothstep(0.2, 0.32, tx.z);
  float sea = smoothstep(0.7, 0.8, tx.z);
  float lat = degrees(asin(clamp(up.z, -1.0, 1.0)));
  float alat = abs(lat);
  vec2 nh0 = vec2(-tx.x, -tx.y);
  // +1 on poleward-facing slopes (cooler, moister, holds snow)
  float poleward = (lat >= 0.0 ? -nh0.y : nh0.y) / max(length(nh0), 1e-3) * smoothstep(0.05, 0.3, slope);

  // Multi-scale, domain-warped variation (world-locked, periodic in 2048 m).
  vec2 warp = vec2(fbm2(gp / 256.0 + 3.7, 8.0), fbm2(gp / 256.0 + 9.2, 8.0));
  float fL = fbm2(gp / 512.0 + vec2(1.3, 7.1), 4.0);
  float fM = fbm2(gp / 128.0 + warp * 0.9, 16.0);
  float fS = fbm2(gp / 32.0 + warp * 2.5, 64.0);
  float nS = vnoise(gp / 8.0, 256.0);
  float nL = fL;

  // --- Land cover ----------------------------------------------------------
  float tl = table(alat, LATS, TREE) + uTreeShift + fL * 120.0;
  float sl = table(alat, LATS, SNOW) + uSnowShift + fL * 200.0 - poleward * 260.0 + cvx * 50.0;
  float steep = sdeg + fM * 6.0 + fS * 3.0;
  float alpine = smoothstep(tl - 50.0, tl + 450.0, vH + fM * 60.0);
  float rock = smoothstep(34.0, 44.0, steep);
  rock = max(rock, alpine * smoothstep(17.0, 31.0, steep - cvx * 5.0));
  rock = max(rock, smoothstep(0.6, 1.8, cvx) * smoothstep(18.0, 28.0, sdeg));
  rock *= 1.0 - water;
  float scree = (1.0 - rock) * smoothstep(-0.1, -0.9, cvx + fS * 0.4) * smoothstep(20.0, 30.0, sdeg) * smoothstep(tl - 700.0, tl - 100.0, vH);
  // Forest: elevation band, slope, moisture (poleward slopes and hollows are wetter).
  float band = smoothstep(tl + 40.0, tl - 380.0, vH + fM * 120.0) * smoothstep(uForestFloor - 120.0, uForestFloor + 160.0, vH + fM * 120.0);
  float moist = 0.55 + poleward * (0.15 + 0.35 * uDryness) - cvx * 0.12 - uDryness * 0.45;
  float pot = band * (1.0 - smoothstep(33.0, 45.0, sdeg)) * (1.0 - rock) * (1.0 - water);
  float cover = moist + fM * 0.45 + fS * 0.18 + (uForestDensity - 0.65) * 0.9 - (1.0 - band) * 0.5;
  float forest = smoothstep(0.38, 0.5, cover) * smoothstep(0.02, 0.25, pot);
  float snowLine = smoothstep(sl - 60.0, sl + 160.0, vH + fM * 90.0 + nS * 20.0);
  float snowHold = 1.0 - smoothstep(42.0, 58.0, sdeg + fS * 6.0);
  float snow = snowLine * snowHold;
  snow = max(snow, snowLine * 0.35 * smoothstep(52.0, 40.0, sdeg)); // dusting on rock
  snow *= 1.0 - water * (1.0 - smoothstep(-1500.0, -2500.0, uSnowShift)); // lakes freeze only in deep winter

  // --- Normals ---------------------------------------------------------------
  vec2 slopeEN = tx.xy;
  if (uMicro > 0.5) {
    // Relief finer than the data, faded in with the on-screen footprint.
    float texelM = uTileSizeM * uCosLat / uS;
    float rough = clamp((slope - 0.2) * 1.6, 0.0, 1.0) * (1.0 - water) * (1.0 - forest * 0.7);
    vec2 acc = vec2(0.0);
    float lam = 16.0;
    for (int o = 0; o < 4; o++) {
      float vis = smoothstep(2.0, 5.0, lam / (footM * 2.0)) * smoothstep(texelM * 3.0, texelM * 1.2, lam);
      if (vis > 0.0) {
        vec3 nd = noised(gp / lam + warp, 2048.0 / lam);
        acc += nd.yz * (0.05 + 0.3 * rough) * vis;
      }
      lam *= 0.5;
    }
    // Tree crowns: rounded bumps that catch the low sun.
    vec3 cr = noised(gp / 4.0, 512.0);
    acc += cr.yz * 0.55 * forest * (1.0 - snow * 0.5) * near;
    slopeEN += acc * uCosLat;
  }
  vec3 n = normalize(-slopeEN.x * east - slopeEN.y * north + up);
  vec2 nh = vec2(dot(n, east), dot(n, north));

  // --- Albedo ---------------------------------------------------------------
  vec3 meadow = mix(uGrassCol, uDryCol, clamp(uDryness * 0.7 + fS * 0.2 + (0.55 - moist) * 0.5 + alpine * 0.25, 0.0, 1.0));
  meadow *= 0.86 + 0.28 * nS * near;
  meadow = mix(meadow, uAutumnCol, uAutumn * smoothstep(0.0, 0.5, fS) * (1.0 - alpine) * 0.6);
  meadow = mix(meadow, vec3(0.16, 0.13, 0.08), alpine * 0.35); // tundra mat
  // Rock: tone by region, strata, crack network, lichen.
  float strata = sin(vH / 5.5 + fM * 3.0 + fS * 1.2) * 0.5 + 0.5;
  float crackN = vnoise(gp / 16.0 + warp * 3.0, 128.0);
  float crack = (1.0 - smoothstep(0.0, 0.07, abs(crackN))) * smoothstep(9.0, 3.0, footM);
  vec3 rockC = mix(uRockCol, uRockCol2, clamp(0.5 + 0.6 * fL + 0.25 * strata - 0.1, 0.0, 1.0));
  rockC *= (0.92 + 0.16 * strata) * (1.0 - 0.45 * crack) * (1.0 + 0.2 * nS * near) * (1.0 - 0.15 * smoothstep(0.0, -1.5, cvx));
  rockC = mix(rockC, vec3(0.11, 0.12, 0.07), 0.18 * smoothstep(0.15, 0.5, fS) * (1.0 - alpine * 0.6) * (1.0 - uDryness));
  vec3 screeC = mix(rockC * 1.12, uSoilCol, 0.25) * (0.92 + 0.16 * nS);
  // Forest canopy: dark, varied stands; crowns and gaps up close.
  vec3 forestC = uForestCol * (0.8 + 0.3 * fM + 0.2 * fS);
  forestC = mix(forestC, uAutumnCol * 0.7, uAutumn * smoothstep(0.1, 0.6, fS) * 0.45);
  float crown = smoothstep(-0.35, 0.45, noised(gp / 4.0, 512.0).x);
  forestC *= mix(1.0, 0.35 + 0.85 * crown, near);
  vec3 alb = meadow;
  alb = mix(alb, screeC, scree);
  alb = mix(alb, forestC, forest);
  alb = mix(alb, rockC, rock);
  vec3 snowC = uSnowCol * (0.93 + 0.07 * nS);
  float snowOnForest = snow * forest;
  alb = mix(alb, snowC, snow * (1.0 - forest * 0.8));
  alb = mix(alb, mix(forestC, snowC, 0.25 * (1.0 - crown)), snowOnForest * 0.5);
  alb *= 1.0 - uWetness * 0.35 * (1.0 - snow);
  vec3 playa = vec3(0.86, 0.82, 0.74) * (0.95 + 0.05 * nS);
  float isLake = water * (1.0 - sea);
  float lakeAsPlaya = isLake * uPlaya;
  alb = mix(alb, playa, lakeAsPlaya);
  float wet = water * (1.0 - lakeAsPlaya) * (1.0 - snow * 0.9);

  // --- Lighting -------------------------------------------------------------
  float hKm = max(vH, 0.0) / 1000.0;
  vec3 sunT = lightTransmittance(hKm, dot(up, uSunDir));
  vec3 moonT = lightTransmittance(hKm, dot(up, uMoonDir));
  float sh = terrainShadow();
  float ndl = dot(n, uSunDir);
  // Canopies scatter light around (wrap), meadows and rock are near-Lambertian.
  float diffuse = mix(max(ndl, 0.0), clamp((ndl + 0.3) / 1.3, 0.0, 1.0) * 0.85, forest * 0.7);
  vec3 sunE = uSunPower * sunT * sh * diffuse;
  vec3 moonE = uMoonPower * moonT * max(dot(n, uMoonDir), 0.0);
  float ao = clamp(1.0 + cvx * 0.22, 0.5, 1.0) * mix(1.0, 0.75, forest * near);
  vec3 skyE = uSkyIrr * (0.55 + 0.45 * dot(n, up)) * ao;
  vec3 bounce = uSunPower * sunT * max(dot(up, uSunDir), 0.0) * 0.05 * (1.0 - dot(n, up)) * alb;
  vec3 col = alb / PI * (sunE + moonE + skyE) + bounce / PI;
  vec3 H = normalize(uSunDir + V);
  col += snow * pow(max(dot(n, H), 0.0), 60.0) * sunT * sh * uSunPower * 0.02;
  col += rock * uWetness * pow(max(dot(n, H), 0.0), 40.0) * sunT * sh * uSunPower * 0.03;

  // Water: sky reflection with Fresnel, sun glitter on ripples, shallows at the shore.
  if (wet > 0.001) {
    vec2 wp = gp + vec2(uTime * 0.6, uTime * 0.25);
    vec3 r1 = noised(wp / 4.0, 512.0), r2 = noised(wp / 2.0 + 3.1, 1024.0);
    float calm = mix(0.35, 1.0, sea);
    vec3 nw = normalize(up - (r1.y * east + r1.z * north) * 0.03 * calm - (r2.y * east + r2.z * north) * 0.018 * calm);
    float cosV = max(dot(nw, V), 0.0);
    float fres = 0.025 + 0.975 * pow(1.0 - cosV, 5.0);
    vec3 R = reflect(-V, nw);
    float re = clamp(dot(R, up), 0.0, 1.0);
    vec3 refl = mix(uSkyHorizon, uSkyZenith, pow(re, 0.6));
    float shallow = isLake * (1.0 - smoothstep(0.3, 0.46, tx.z));
    vec3 waterC = mix(uWaterCol, vec3(0.06, 0.12, 0.10), shallow * 0.8);
    vec3 body = waterC / PI * (sunE * 0.35 + skyE * 1.2);
    vec3 glint = sunT * sh * uSunPower * pow(max(dot(R, uSunDir), 0.0), 700.0) * 8.0 + moonT * uMoonPower * pow(max(dot(R, uMoonDir), 0.0), 400.0) * 4.0;
    vec3 wcol = mix(body, refl, fres) + glint;
    col = mix(col, wcol, wet);
  }

  // Low cloud sea: ground under the cloud top dissolves into lit cloud.
  if (uCloudOn > 0.001) {
    float inCloud = smoothstep(uCloudTop + 30.0, uCloudTop - uCloudThick * 0.6, vH + fL * 60.0);
    col = mix(col, uCloudCol, inCloud * uCloudOn);
  }

  // --- Styles ------------------------------------------------------------
  if (uStyle == 1) {
    // Topographic map on paper.
    float shade = clamp(dot(n, normalize(-0.6 * east + 0.6 * north + 0.8 * up)), 0.0, 1.0);
    vec3 paper = vec3(0.93, 0.90, 0.82);
    vec3 tint = mix(vec3(0.80, 0.86, 0.70), vec3(0.93, 0.88, 0.76), smoothstep(1000.0, 3000.0, vH));
    tint = mix(tint, vec3(0.97), snow * 0.8);
    vec3 base = mix(paper, tint, 0.65) * (0.72 + 0.35 * shade);
    base = mix(base, vec3(0.62, 0.78, 0.86), water);
    base = mix(base, vec3(0.70, 0.80, 0.62), forest * 0.45);
    vec2 cl = contours(vH, footM);
    vec3 ink = vec3(0.55, 0.35, 0.20);
    base = mix(base, ink, cl.x * 0.55 * (1.0 - water));
    base = mix(base, ink * 0.8, cl.y * 0.85 * (1.0 - water));
    float shore = isoLine(tx.z, 0.25, 1.4) * smoothstep(0.0, 0.1, tx.z);
    base = mix(base, vec3(0.2, 0.45, 0.65), shore);
    col = base * 0.9;
  } else if (uStyle == 2) {
    // Copper engraving: hachures along the contours, thicker where darker.
    float lum = dot(alb / PI * (sunE + skyE), vec3(0.3, 0.5, 0.2)) / (uSunPower * 0.12 + 0.05);
    lum = clamp(lum, 0.0, 1.0);
    float I = 10.0 * exp2(floor(log2(max(footM * 4.0, 10.0) / 10.0)));
    float fw = max(fwidth(vH), 1e-4);
    float d = abs(fract(vH / I - 0.5) - 0.5) * I / fw;
    float w = mix(2.4, 0.0, smoothstep(0.15, 0.9, lum));
    float lines = 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.9, d);
    // cross-hatch in deep shadow
    vec2 sp = gl_FragCoord.xy;
    float ch = smoothstep(0.3, 0.1, lum) * (1.0 - smoothstep(0.6, 1.4, abs(fract((sp.x + sp.y) / 5.0) - 0.5) * 5.0));
    vec3 paper = vec3(0.95, 0.92, 0.85) * (0.97 + 0.03 * nS);
    vec3 inkC = vec3(0.12, 0.10, 0.09);
    vec3 c = mix(paper, inkC, max(lines, ch * 0.8) * (1.0 - water * 0.6));
    c = mix(c, vec3(0.80, 0.84, 0.86), water * 0.5);
    col = c * 0.9;
  } else if (uStyle == 3) {
    // Atlas hypsometric tint with hillshade.
    float e = vH;
    vec3 hc = e < 500.0 ? mix(vec3(0.33, 0.55, 0.36), vec3(0.55, 0.70, 0.42), e / 500.0)
            : e < 1500.0 ? mix(vec3(0.55, 0.70, 0.42), vec3(0.88, 0.82, 0.52), (e - 500.0) / 1000.0)
            : e < 2800.0 ? mix(vec3(0.88, 0.82, 0.52), vec3(0.66, 0.46, 0.30), (e - 1500.0) / 1300.0)
            : e < 4200.0 ? mix(vec3(0.66, 0.46, 0.30), vec3(0.62, 0.58, 0.58), (e - 2800.0) / 1400.0)
            : mix(vec3(0.62, 0.58, 0.58), vec3(0.97), clamp((e - 4200.0) / 1500.0, 0.0, 1.0));
    hc = mix(hc, vec3(0.45, 0.65, 0.85), water);
    float shade = clamp(dot(n, normalize(-0.6 * east + 0.6 * north + 0.8 * up)), 0.0, 1.0);
    vec3 lit = hc * (0.35 + 0.85 * shade);
    lit = mix(lit, lit * 0.85, isoLine(vH, 500.0, 1.0) * 0.6);
    // keep the real sky light's colour so time of day still reads
    vec3 key = (sunE + skyE + moonE) / max(uSunPower * 0.6, 1e-3);
    col = lit * mix(vec3(1.0), clamp(key, 0.0, 1.5), 0.35) * uSunPower * 0.08;
  } else if (uStyle == 4) {
    // Hologram: glowing contours and a world-locked grid over black glass.
    vec2 cl = contours(vH, footM);
    float gridI = 1000.0 * exp2(floor(log2(max(footM * 40.0, 1000.0) / 1000.0)));
    vec2 g = abs(fract(gp / gridI - 0.5) - 0.5) * gridI / max(fwidth(gp), vec2(1e-3));
    float grid = 1.0 - smoothstep(0.5, 1.5, min(g.x, g.y));
    float rim = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
    float hgt = smoothstep(500.0, 4500.0, vH);
    vec3 cyan = vec3(0.1, 0.9, 1.0), mag = vec3(1.0, 0.25, 0.85);
    vec3 glow = mix(cyan, mag, hgt);
    vec3 c = vec3(0.0, 0.015, 0.03) + glow * (cl.x * 0.6 + cl.y * 1.6) + cyan * grid * 0.35 + glow * rim * 0.5;
    c += glow * 0.05 * max(dot(n, uSunDir), 0.0);
    c = mix(c, vec3(0.0, 0.05, 0.1) + cyan * isoLine(tx.z, 0.25, 1.5) * 1.5, water * 0.85);
    col = c * 1.6;
  }

  // --- Overlays ----------------------------------------------------------
  if (uOverlay > 0 && uOverlayMix > 0.0) {
    vec3 oc = col;
    float a = 0.0;
    if (uOverlay == 1) {
      // Avalanche-terrain slope classes.
      oc = sdeg < 27.0 ? col : sdeg < 30.0 ? vec3(0.95, 0.95, 0.3) : sdeg < 35.0 ? vec3(1.0, 0.7, 0.15)
         : sdeg < 40.0 ? vec3(1.0, 0.35, 0.1) : sdeg < 45.0 ? vec3(0.85, 0.1, 0.25) : vec3(0.55, 0.15, 0.7);
      a = sdeg < 27.0 ? 0.0 : 0.6;
    } else if (uOverlay == 2) {
      float asp = atan(nh.x, nh.y); // 0 = north-facing
      oc = hsv2rgb(vec3(asp / 6.2831 + 0.5, 0.75, 0.95));
      a = 0.55 * smoothstep(0.03, 0.12, slope);
    } else if (uOverlay == 3) {
      float band = floor(vH / 250.0);
      oc = hsv2rgb(vec3(fract(0.62 - band * 0.045), 0.6, 0.95));
      a = 0.5;
      oc = mix(oc, vec3(0.05), isoLine(vH, 250.0, 1.2));
      a = max(a, isoLine(vH, 250.0, 1.2));
    }
    float lumc = max(dot(col, vec3(0.3, 0.5, 0.2)), 1e-4);
    vec3 shaded = oc * clamp(lumc * 6.0 / max(uSunPower * 0.1, 1e-3) + 0.15, 0.0, 1.2) * uSunPower * 0.08;
    if (uStyle != 0) shaded = oc * max(lumc, 0.4);
    col = mix(col, shaded, a * uOverlayMix * (1.0 - water));
  }

  // --- Air between us and the ground ------------------------------------
  if (uStyle == 0 || uStyle == 5 || uStyle == 3) {
    vec3 fragKm = uCamKm + vRel * 0.001;
    vec3 T, L;
    aerial(uCamKm, fragKm, -V, T, L);
    col = col * T + L;
    // storms: grey veil
    col = mix(col, uSkyHorizon * 0.9, uStormDark * (1.0 - exp(-distM / 9000.0)));
  } else if (uStyle == 1 || uStyle == 2) {
    col = mix(col, vec3(0.93, 0.90, 0.82) * 0.9, 1.0 - exp(-distM / 90000.0));
  } else {
    col *= exp(-distM / 160000.0);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrainMaterial(globals, tileUniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: { ...globals, ...tileUniforms },
    extensions: {},
  });
}

const DEPTH_VS = /* glsl */ `
void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;
const DEPTH_FS = /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`;
export function createDepthMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: DEPTH_VS, fragmentShader: DEPTH_FS, side: THREE.DoubleSide, colorWrite: false });
}
