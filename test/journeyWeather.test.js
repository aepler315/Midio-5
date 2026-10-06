import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { JourneyScene } from '../src/world/alpine/JourneyScene.js';
import { CoveGL } from '../src/world/alpine/CoveGL.js';
import { JOURNEY_CAST_LAYOUT, sampleJourneyCast } from '../src/world/alpine/JourneyCast.js';
import { sampleJourneyDirection } from '../src/world/alpine/JourneyDirection.js';
import { JOURNEY_VIEW } from '../src/world/alpine/JourneyWorld.js';
import { journeyUniforms } from '../src/world/alpine/JourneyMaterial.js';
import { sceneUniforms } from '../src/world/alpine/TerrainMaterial.js';

function sample({storm={},reducedFlash=false,reducedMotion=false,direction=null,realCast=false}={}){
  const scene=Object.create(JourneyScene.prototype);
  scene.THREE=THREE;scene.camera=new THREE.PerspectiveCamera();
  const uniforms=sceneUniforms(THREE,{...journeyUniforms(THREE),uJourneyWeatherEnable:{value:0},uJourneyClearing:{value:0}});
  const p={view:JOURNEY_VIEW,uniforms,cast:realCast?new CoveGL(THREE,uniforms,JOURNEY_CAST_LAYOUT):{update(pose){this.pose=pose;}}};
  const frame={frameId:1,timeMs:30000,durationMs:60000,seed:315,reducedFlash,reducedMotion,storm,journeyDirection:direction,
    scenicViewport:{logicalWidth:1280,logicalHeight:720,nominalHeight:720,overscanPx:0},
    light:{sky:{top:'#132030',horizon:'#778899'},celestial:{xFrac:.6,yFrac:.12,colorHex:'#c6d7ff',intensity:.6,visibility:1}}};
  scene._frame(frame,p);return {scene,p,frame};
}
test('one weather state reaches sky, reflections and receivers with reduced flash suppression',()=>{
  const storm={amount:.85,flash:.9,break01:.3,wet01:.7};
  const normal=sample({storm}),reduced=sample({storm,reducedFlash:true});
  assert.deepEqual(normal.p.uniforms.uStorm.value.toArray(),[.85,.9,.3,.7]);
  assert.deepEqual(normal.p.uniforms.uFirmamentWeather.value.toArray(),[.85,.9]);
  assert.equal(normal.p.uniforms.uJourneyWeatherEnable.value,1);
  assert.equal(normal.p.uniforms.uJourneyClearing.value,.3);
  assert.ok(normal.p.uniforms.uLightColor.value.r>reduced.p.uniforms.uLightColor.value.r,'cloud flash reaches character/receiver key light');
  assert.deepEqual(reduced.p.uniforms.uStorm.value.toArray(),[.85,0,.3,.7]);
  assert.deepEqual(reduced.p.uniforms.uFirmamentWeather.value.toArray(),[.85,0]);
  assert.deepEqual(normal.p.pose.actors.map(a=>a.positionM),reduced.p.pose.actors.map(a=>a.positionM),'flash policy leaves spatial performance intact');
  assert.deepEqual(normal.scene.camera.position.toArray(),reduced.scene.camera.position.toArray());
});
test('storm darkens key and fill, clearing opens light and held frames apply state once',()=>{
  const clear=sample(),storm=sample({storm:{amount:1,wet01:1}}),opening=sample({storm:{amount:.2,break01:1,wet01:1}});
  assert.ok(storm.p.uniforms.uLightColor.value.r<clear.p.uniforms.uLightColor.value.r);
  assert.ok(storm.p.uniforms.uAmbientScale.value<clear.p.uniforms.uAmbientScale.value);
  assert.ok(opening.p.uniforms.uLightColor.value.r>storm.p.uniforms.uLightColor.value.r);
  const held=storm.p.uniforms.uLightColor.value.clone();storm.scene._frame(storm.frame,storm.p);
  assert.deepEqual(storm.p.uniforms.uLightColor.value,held);
});
test('foreground focus reduces competing aurora and companions without changing stars',()=>{
  const base=sample(),focus=sample({direction:{phase:'sustain',intensity01:.7,accent01:.2,focusId:'midio',focusStrength01:.7,focusById:{midio:.7,broshi:0,midasus:0},cameraMove:{dolly:.02,yaw:0,crane:0,truck:0}}});
  assert.equal(base.p.uniforms.uFirmamentLayers.value.x,focus.p.uniforms.uFirmamentLayers.value.x);
  assert.equal(base.p.uniforms.uFirmamentLayers.value.y,focus.p.uniforms.uFirmamentLayers.value.y);
  assert.ok(focus.p.uniforms.uFirmamentLayers.value.z<base.p.uniforms.uFirmamentLayers.value.z);
  assert.equal(focus.p.pose.actors.find(a=>a.id==='midasus').babies.length,base.p.pose.actors.find(a=>a.id==='midasus').babies.length,'companions remain present through a continuous dimming envelope');
});

test('focus threshold crossing fades aurora and companion materials continuously',()=>{
  const at=pitchActivity=>sampleJourneyDirection({timeMs:30000,music:{energy01:.7,
    sources:{midio:{activity:.8,pitchActivity},midasus:{activity:.1,pitchActivity:.1}}}});
  const {scene,p,frame}=sample({direction:at(.35),realCast:true});
  let previous=null,crossed=false,initial=null,final=null;
  for(let pitchActivity=.35;pitchActivity<=.75;pitchActivity+=.001){
    const direction=at(pitchActivity);scene._frame({...frame,journeyDirection:direction},p);
    const current={aura:p.uniforms.uFirmamentLayers.value.z,focus:direction.focusId,
      body:p.cast.actors.midasus.babies[1].uniforms.uBodyColor.value.r,
      glow:p.cast.actors.midasus.babies[1].uniforms.uGlow.value};
    initial??=current;final=current;
    if(previous){
      if(previous.focus!==current.focus)crossed=true;
      assert.ok(Math.abs(current.aura-previous.aura)<.004,'aurora does not jump at semantic focus threshold');
      assert.ok(Math.abs(current.body-previous.body)<.004,'companion body fades continuously');
      assert.ok(Math.abs(current.glow-previous.glow)<.004,'companion emission fades continuously');
    }
    previous=current;
  }
  assert.ok(crossed,'fixture crosses semantic focus threshold');
  assert.ok(final.aura<initial.aura&&final.body<initial.body&&final.glow<initial.glow,'all competing appearance dims with sustained foreground evidence');
  scene._frame({...frame,journeyDirection:at(.35)},p);
  assert.equal(p.cast.actors.midasus.babies[1].uniforms.uBodyColor.value.r,initial.body,'seeking out of focus restores original material');
  p.cast.dispose();
});

test('actor focus articulation stays continuous as source evidence crosses semantic selection',()=>{
  let previous=null,crossed=false;
  for(let pitchActivity=.35;pitchActivity<=.75;pitchActivity+=.001){
    const music={energy01:.7,sources:{midio:{activity:.8,pitchActivity},midasus:{activity:.1,pitchActivity:.1}}};
    const direction=sampleJourneyDirection({timeMs:30000,music});
    const pose=sampleJourneyCast({timeMs:30000,music,direction});
    const stroke=pose.actors.find(a=>a.id==='midio').strokeAngle;
    if(previous){
      if(previous.focus!==direction.focusId)crossed=true;
      assert.ok(Math.abs(stroke-previous.stroke)<.0001,'focus contribution cannot jump at semantic selection');
    }
    previous={stroke,focus:direction.focusId};
  }
  assert.ok(crossed);
});
