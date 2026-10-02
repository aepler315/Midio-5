// The cast's silhouettes become masks in world materials, never enlarged
// screen-space actors. One small RGBA texture per prepared view, charged to
// the view's GPU reservation and disposed with its actors.
import { MIDIO_BODY, BROSHI_BODY, BROSHI_HEAD, BROSHI_TAIL, MIDASUS_MESH } from '../../render/meshes.js';
import { cameraPoseAt, projectPoint } from '../terrain/SceneTravel.js';
const MASK_SIZE = 128;
export const giantMaskBytes = () => MASK_SIZE * MASK_SIZE * 4;
const clamp = x => Math.max(0, Math.min(1, x));
export function giantAmounts(frame) {
  if ((frame.qualityLevel ?? 0) >= 4 || !frame.actors) return [0, 0, 0];
  const presence = (frame.actors.presence ?? 0) * (frame.narrative?.materials ?? 1);
  return ['midio', 'broshi', 'midasus'].map(id => clamp(frame.actors[id]?.peak || 0) * presence);
}
function polygons(meshes) {
  return meshes.map(m => m.vertices.slice(1).map(v => [v.x, -v.y]));
}
function distanceToEdge(p, a, b) {
  const x = b[0] - a[0], y = b[1] - a[1];
  const t = clamp(((p[0] - a[0]) * x + (p[1] - a[1]) * y) / Math.max(1e-8, x*x + y*y));
  return Math.hypot(p[0] - a[0] - t*x, p[1] - a[1] - t*y);
}
function softPolygon(p, poly) {
  let inside = false, d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0]-a[0]) * (p[1]-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;
    d = Math.min(d, distanceToEdge(p, a, b));
  }
  return clamp(.5 + (inside ? d : -d) / .035);
}
export function giantMaskData() {
  const star = MIDASUS_MESH.vertices;
  const tail = BROSHI_TAIL.vertices;
  const groups = [polygons([MIDIO_BODY]), [...polygons([BROSHI_BODY, BROSHI_HEAD]), tail.map(v => [v.x, -v.y])],
    [star.slice(1,4).map(v => [v.x,-v.y]), star.slice(4,7).map(v => [v.x,-v.y])]];
  const normalized = groups.map(polys => {
    const pts = polys.flat(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.min(...xs)+Math.max(...xs))/2, cy = (Math.min(...ys)+Math.max(...ys))/2;
    const span = Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys)) / .84;
    return polys.map(poly => poly.map(p => [(p[0]-cx)/span, (p[1]-cy)/span]));
  });
  const out = new Uint8Array(giantMaskBytes());
  for (let y = 0; y < MASK_SIZE; y++) for (let x = 0; x < MASK_SIZE; x++) {
    const p = [(x+.5)/MASK_SIZE-.5, (y+.5)/MASK_SIZE-.5], i = (y*MASK_SIZE+x)*4;
    for (let c = 0; c < 3; c++) out[i+c] = Math.round(255 * Math.max(...normalized[c].map(poly => poly.length === 2
      ? clamp(1 - distanceToEdge(p, poly[0], poly[1]) / .028) : softPolygon(p,poly))));
    out[i+3] = 255;
  }
  return out;
}
export function giantUniforms(THREE) {
  return { uGiantMask: { value: null }, uGiantPeak: { value: [0,0,0] },
    uSkyGiantCenter: { value: Array.from({length:3}, () => new THREE.Vector3()) },
    uGiantCenter: { value: Array.from({length:3}, () => new THREE.Vector3()) }, uGiantSpan: { value: [5000,5000,8000] },
    uGiantRight: { value: new THREE.Vector3(1,0,0) }, uGiantForward: { value: new THREE.Vector3(0,0,1) },
    uShadowRay: { value: new THREE.Vector3(0,1,0) }, uMidioCloud: { value: 0 }, uGiantTime: { value: 0 } };
}
/** Anchors chosen from real samples visible at the reference rail station.
 * Metre sizes follow relief and viewing distance; resizing cannot move them. */
export function giantLayout(data, view, heightRange, waterLevelM) {
  const pose = cameraPoseAt(view, .5), d = pose.targetM.map((v,i) => v - pose.eyeM[i]);
  const l = Math.hypot(d[0], d[2]) || 1, forward = [d[0]/l,0,d[2]/l], right = [-forward[2],0,forward[0]];
  let mountain = null, water = null, best = Infinity, wetBest = Infinity;
  for (const tile of data.tiles.values()) {
    if (!tile.visible) continue;
    const n = tile.samples, step = Math.max(1, Math.floor(n/16));
    for (let y=0; y<n; y+=step) for (let x=0; x<n; x+=step) {
      const i=y*n+x, h=tile.heightsM[i]; if (!Number.isFinite(h)) continue;
      const p=[data.grid.originM[0]+(tile.ix*data.cells+x*tile.stride)*data.grid.cellSizeM,h,
        data.grid.originM[1]+(tile.iz*data.cells+y*tile.stride)*data.grid.cellSizeM];
      const q=projectPoint(pose,16/9,p);
      if (!q || q.depth < 1800 || Math.abs(q.x) > .8 || Math.abs(q.y) > .8) continue;
      if (tile.flowBytes?.[i] === 255 && Number.isFinite(waterLevelM)) {
        const score=q.x*q.x+(q.y+.4)**2;
        if (score<wetBest) { water=p; wetBest=score; }
      } else {
        const score=(q.x+.12)**2+(q.y-.02)**2;
        if (score<best) { mountain=p; best=score; }
      }
    }
  }
  mountain ||= [...pose.targetM];
  const relief = Math.max(800, heightRange[1]-heightRange[0]);
  const dist = Math.hypot(...mountain.map((v,i)=>v-pose.eyeM[i]));
  const span = Math.max(relief*2.4, dist*Math.tan(pose.fovYDeg*Math.PI/360)*1.45);
  const cloud = [pose.eyeM[0]+forward[0]*dist*.65, heightRange[0], pose.eyeM[2]+forward[2]*dist*.65];
  const skyCenter = [pose.eyeM[0]+forward[0]*dist, pose.eyeM[1]+d[1]/l*dist+dist*Math.tan(pose.fovYDeg*Math.PI/360)*.45, pose.eyeM[2]+forward[2]*dist];
  // The impossible reflection's virtual source is beyond the far shore,
  // where its full mountain-tall height can enter the lake's mirror rays.
  const reflection = water ? [water[0]+forward[0]*9000,waterLevelM,water[2]+forward[2]*9000] : cloud;
  return { centers: [reflection, mountain, cloud], skyCenters: [skyCenter, mountain, skyCenter], spans: [Math.max(relief*3,span*1.5), span, span*1.6], right, forward,
    hasLake: !!water && Number.isFinite(waterLevelM) };
}
export const GIANT_GLSL = /* glsl */`
  uniform sampler2D uGiantMask;
  uniform float uGiantPeak[3];
  uniform vec3 uGiantCenter[3];
  uniform float uGiantSpan[3];
  uniform vec3 uGiantRight;
  uniform vec3 uGiantForward;
  uniform vec3 uShadowRay;
  uniform float uMidioCloud;
  uniform float uGiantTime;
  float giantMask(vec2 uv, int actor) {
    if (any(lessThan(uv,vec2(0.0))) || any(greaterThan(uv,vec2(1.0)))) return 0.0;
    vec3 mask=texture(uGiantMask,uv).rgb;
    return actor == 0 ? mask.r : actor == 1 ? mask.g : mask.b;
  }
  // Orthographic shadow projection along the key/lantern direction, onto
  // a vertical caster plane. Every receiver uses its actual world position.
  float broshiShadow(vec3 p) {
    if (uGiantPeak[1] <= 0.0) return 0.0;
    vec3 d=p-uGiantCenter[1];
    float ray=dot(uShadowRay,uGiantForward);
    vec3 projected=d-uShadowRay*(dot(d,uGiantForward)/max(.25,abs(ray)))*sign(ray);
    vec2 uv=vec2(dot(projected,uGiantRight),projected.y)/uGiantSpan[1]+.5;
    return giantMask(uv,1)*uGiantPeak[1];
  }
  float giantCloud(vec3 p) {
    float mask=0.0;
    for (int i=0;i<3;i+=2) {
      if (uGiantPeak[i]<=0.0 || (i==0 && uMidioCloud<.5)) continue;
      vec3 d=p-uGiantCenter[i];
      vec2 uv=vec2(dot(d,uGiantRight),dot(d,uGiantForward))/uGiantSpan[i]+.5;
      // Slow advected wisps break the silhouette as it dissolves.
      uv+=vec2(sin(p.z*.003+uGiantTime*.11),cos(p.x*.002+uGiantTime*.09))*.009*(1.0-uGiantPeak[i]);
      mask=max(mask,giantMask(uv,i)*uGiantPeak[i]);
    }
    return mask;
  }
`;
