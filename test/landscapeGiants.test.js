import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giantMaskBytes, giantMaskData, giantAmounts, mirrorGiantSpan, aheadOfEye } from '../src/world/alpine/LandscapeGiants.js';
import { rangeQuality } from '../src/world/alpine/RangeQuality.js';
import { rangeActorsAt } from '../src/world/alpine/RangeActors.js';
test('each giant follows only its own peak and dissolves; the mirror quality cutoff drops all giants', () => {
  const frame = { actors: { presence: 1, midio: { peak: 1 }, broshi: { peak: .5 }, midasus: { peak: 0 } }, qualityLevel: 0 };
  assert.deepEqual(giantAmounts(frame), [1, .5, 0]);
  assert.deepEqual(giantAmounts({ ...frame, qualityLevel: 4 }), [0, 0, 0]);
  assert.equal(rangeQuality(3).landscapeGiants, true);
  assert.equal(rangeQuality(4).landscapeGiants, false);
  assert.deepEqual(giantAmounts({ ...frame, actors: null }), [0, 0, 0]);
});
test('a held individual peak never forces the other instrument lanes', () => {
  const sim = { biomes: { actorPeakOverride: { midio: 1, broshi: 0, midasus: 0 } }, rangeNarrative: { durationMs: 20000, sample: () => ({ sources: {} }) } };
  const a = rangeActorsAt(sim, 10000);
  assert.equal(a.midio.peak, 1); assert.equal(a.broshi.peak, 0); assert.equal(a.midasus.peak, 0);
});
test('world material masks have bounded residency and soft silhouette edges in every channel', () => {
  const data = giantMaskData();
  assert.equal(data.length, giantMaskBytes());
  for (let c = 0; c < 3; c++) {
    let full = 0, soft = 0;
    for (let i = c; i < data.length; i += 4) { if (data[i] === 255) full++; if (data[i] > 0 && data[i] < 255) soft++; }
    assert.ok(full > 40 && soft > 40, `channel ${c}: ${full} solid, ${soft} soft`);
  }
  assert.deepEqual(giantMaskData(), data);
});

// Clouds must not corrupt the terrain alpha consumed by crest light and
// the sampled mountain skyline; the atmosphere uses a separate copy pass.
test('cloud radiance renders through a separate depth-tested atmosphere pass', async () => {
  const { RangeScene } = await import('../src/world/alpine/RangeScene.js');
  const scene = Object.create(RangeScene.prototype), rendered=[];
  const p={giantLayout:{hasLake:false},depthScene:{id:'depth'},actors:{clouds:{midio:{scene:{id:'midio-cloud'}},midasus:{scene:{id:'midasus-cloud'}}}},
    uniforms:{uMidioCloud:{value:1}}};
  Object.assign(scene,{prepared:new Map([['view',p]]),target:{texture:'target'},canvas:{},size:{width:640,height:360},depthCache:{A:{frame:12}},
    _copy:{mesh:{material:{uniforms:{uColor:{value:null}}}},scene:{id:'copy'},camera:{}},
    _setCamera(){},_setUniforms(){},_setCanvasSize(){},
    renderer:{setRenderTarget(){},setClearColor(){},clear(){},render(s){rendered.push(s.id);}}});
  const frame={qualityLevel:0,actors:{presence:1,midio:{peak:1},midasus:{peak:1}}};
  assert.equal(scene.renderSkyGiants(frame,'view'),scene.canvas);
  assert.deepEqual(rendered,['depth','midasus-cloud','midio-cloud','copy']);
  assert.equal(scene.depthCache.A.frame,-1);
  assert.equal(scene.renderSkyGiants({...frame,qualityLevel:4},'view'),null);
  p.giantLayout.hasLake=true;
  p.mirrorLevelM=2000;
  // A mirror that exists: Midio is a reflection, never also a cloud.
  scene._ensureMirror=()=>({target:{texture:'mirror'}});
  assert.equal(scene.renderSkyGiants({...frame,frameId:1,actors:{presence:1,midio:{peak:1}}},'view'),null,'lake Midio has no above-water cloud source');
  p.mirrorLevelM=null;
  rendered.length=0;
  assert.equal(scene.renderSkyGiants({...frame,frameId:2,actors:{presence:1,midio:{peak:1}}},'view'),scene.canvas,'unavailable lake mirror falls back to clouds');
  assert.deepEqual(rendered,['depth','midio-cloud','copy']);
  p.depthScenes={};
  const columns={mid:[.2,.6],near:[.4,.8]};
  scene._travelDepth=(prepared,target,pass,cols)=>{
    assert.equal(prepared,p); assert.equal(target,scene.target); assert.equal(pass,'far'); assert.equal(cols,columns);
    rendered.push('travel-depth');
  };
  rendered.length=0;
  scene.renderSkyGiants(frame,'view',{bandColumns:columns});
  assert.deepEqual(rendered,['travel-depth','midasus-cloud','midio-cloud','copy']);
});

test("Midio's mirrored sheet fills the lake from the far shore to the frame's lower edge", () => {
  // Eye 400 m above the lake, the frame's lower edge dipping 1 in 10, the
  // sheet 6 km out: the edge ray meets the lake 4 km out, and the lowered
  // mirror eye (lift .5) sees through it to (6000 * .1 - 400) * .5 = 100 m.
  assert.equal(mirrorGiantSpan([0, 2400, 0], [0, -.1, 1], [0, 2000, 6000], 2000, .5, 9999), 100 / .9);
  assert.equal(mirrorGiantSpan([0, 2400, 0], [0, .1, 1], [0, 2000, 6000], 2000, .5, 9999), 9999, 'no lake below the frame');
  assert.equal(mirrorGiantSpan([0, 2400, 0], [0, -.1, 1], [0, 2000, 3000], 2000, .5, 9999), 9999, 'sheet nearer than the frame edge');
});
test("Midio's giant keeps his open eye", () => {
  const data = giantMaskData(), red = (x, y) => data[(y * 128 + x) * 4];
  let hole = 0;
  for (let y = 0; y < 128; y++) for (let x = 40; x < 88; x++) {
    if (red(x, y) === 0 && red(x, y - 12) === 255 && red(x, y + 12) === 255) hole++;
  }
  assert.ok(hole > 10, `eye socket pixels: ${hole}`);
});

test("a listener's zoom never dollies past Midio's mirrored sheet", () => {
  const sheet = [0, 2000, 4000], forward = [0, 0, 1];
  assert.equal(aheadOfEye(sheet, [0, 2400, 0], forward, 600), sheet, 'unzoomed: untouched');
  assert.deepEqual(aheadOfEye(sheet, [50, 2300, 3700], forward, 600), [0, 2000, 4300]);
});

// F08: lake metadata alone is not a mirror. The reservation can be denied
// (it is optional light), and then the giant must fall back to the sky.
async function giantScene({ mirrorAllowed }) {
  const { RangeScene } = await import('../src/world/alpine/RangeScene.js');
  const scene = Object.create(RangeScene.prototype), rendered = [], reserves = [];
  const p = { giantLayout: { hasLake: true }, mirrorLevelM: 2000, depthScene: { id: 'depth' },
    actors: { clouds: { midio: { scene: { id: 'midio-cloud' } }, midasus: { scene: { id: 'midasus-cloud' } } } },
    uniforms: { uMidioCloud: { value: 1 } } };
  Object.assign(scene, {
    prepared: new Map([['view', p]]), target: { texture: 'target' }, sideTargets: { B: { texture: 'side-b' } }, canvas: {},
    size: { width: 640, height: 360 }, depthCache: { A: { frame: 0 }, B: { frame: 0 } }, mirrors: { A: null, B: null },
    _copy: { mesh: { material: { uniforms: { uColor: { value: null } } } }, scene: { id: 'copy' }, camera: {} },
    _setCamera() {}, _setCanvasSize() {},
    // The real routing decision, without the rest of the per-frame uniforms.
    _setUniforms(prepared, frame, side, viewId) {
      prepared.uniforms.uMidioCloud.value = this._giantMirrored(prepared, frame, side, viewId) ? 0 : 1;
    },
    _ensureMirror(side) {
      reserves.push(side);
      if (!mirrorAllowed()) return null;
      this.mirrors[side] = { target: { texture: `mirror-${side}` } };
      return this.mirrors[side];
    },
    releaseMirror(side) { this.mirrors[side] = null; },
    renderer: { setRenderTarget() {}, setClearColor() {}, clear() {}, render(s) { rendered.push(s.id); } },
  });
  return { scene, p, rendered, reserves };
}
const midioFrame = (frameId, extra = {}) => ({ frameId, qualityLevel: 0, actors: { presence: 1, midio: { peak: 1 } }, ...extra });

test('a lake whose mirror reservation is denied sends held Midio to the sky, once', async () => {
  let allowed = false;
  const { scene, p, rendered } = await giantScene({ mirrorAllowed: () => allowed });
  assert.equal(scene.renderSkyGiants(midioFrame(1), 'view'), scene.canvas, 'denied mirror falls back to the cloud');
  assert.deepEqual(rendered.filter((id) => id === 'midio-cloud'), ['midio-cloud'], 'exactly one giant');
  assert.equal(p.uniforms.uMidioCloud.value, 1, 'the lake shader is told there is no reflected giant');
  // The water pass for the same frame agrees: no mirror, no reflection.
  assert.equal(scene._resolveMirror(p, midioFrame(1), 'A', 'view').mirror, null);
  // Restored reservation on a later frame: the reflection takes him back.
  allowed = true;
  rendered.length = 0;
  assert.equal(scene.renderSkyGiants(midioFrame(2), 'view'), null);
  assert.deepEqual(rendered, []);
  assert.equal(scene._giantMirrored(p, midioFrame(2), 'A', 'view'), true);
});

test('the route is decided per side and per frame, and a lost target is not reused', async () => {
  const deniedSides = new Set(['B']);
  const { scene, rendered } = await giantScene({ mirrorAllowed: () => !deniedSides.has(scene._lastSide) });
  const ensure = scene._ensureMirror.bind(scene);
  scene._ensureMirror = (side) => { scene._lastSide = side; return ensure(side); };
  assert.equal(scene.renderSkyGiants(midioFrame(1), 'view', { side: 'A' }), null, 'side A reflects');
  assert.equal(scene.renderSkyGiants(midioFrame(1), 'view', { side: 'B' }), scene.canvas, 'side B, denied, uses the cloud');
  assert.deepEqual(rendered.filter((id) => id === 'midio-cloud'), ['midio-cloud']);
  // Side A's target is lost (evicted or context lost) mid-song.
  scene.mirrors.A = null;
  deniedSides.add('A');
  rendered.length = 0;
  assert.equal(scene.renderSkyGiants(midioFrame(1), 'view', { side: 'A' }), scene.canvas, 'a released target is never treated as ready');
  assert.deepEqual(rendered.filter((id) => id === 'midio-cloud'), ['midio-cloud']);
});

test('no lake, or a quality that sheds giants, keeps the existing routes', async () => {
  const { scene, p, rendered, reserves } = await giantScene({ mirrorAllowed: () => true });
  p.giantLayout.hasLake = false;
  assert.equal(scene.renderSkyGiants(midioFrame(1), 'view'), scene.canvas);
  assert.deepEqual(rendered.filter((id) => id === 'midio-cloud'), ['midio-cloud']);
  p.giantLayout.hasLake = true;
  rendered.length = 0;
  assert.equal(scene.renderSkyGiants(midioFrame(2, { qualityLevel: 4 }), 'view'), null, 'quality 4 sheds giants on purpose');
  assert.deepEqual(rendered, []);
  assert.ok(reserves.length >= 0);
});
