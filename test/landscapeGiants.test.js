import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giantMaskBytes, giantMaskData, giantAmounts } from '../src/world/alpine/LandscapeGiants.js';
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
  assert.equal(scene.renderSkyGiants({...frame,actors:{presence:1,midio:{peak:1}}},'view'),null,'lake Midio has no above-water cloud source');
  p.mirrorLevelM=null;
  rendered.length=0;
  assert.equal(scene.renderSkyGiants({...frame,actors:{presence:1,midio:{peak:1}}},'view'),scene.canvas,'unavailable lake mirror falls back to clouds');
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
