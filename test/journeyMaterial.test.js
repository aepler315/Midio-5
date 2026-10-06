import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import * as journey from '../src/world/alpine/JourneyMaterial.js';
import { firmamentUniforms, FirmamentGL } from '../src/world/alpine/FirmamentGL.js';
import { sceneUniforms } from '../src/world/alpine/TerrainMaterial.js';

test('Journey weather is opt-in and sky, water and receivers retain shared mutable uniforms',()=>{
  const defaults=firmamentUniforms(THREE);
  assert.equal(defaults.uJourneyWeatherEnable?.value,0);
  assert.equal(defaults.uJourneyClearing?.value,0);
  const uniforms=sceneUniforms(THREE,journey.journeyUniforms(THREE));
  const sky=new FirmamentGL(THREE,uniforms);
  const materials=['water','surface','trees'].map(kind=>journey.journeyMaterial(THREE,uniforms,kind));
  try {
    uniforms.uStorm.value.set(.8,.3,.2,.7);
    uniforms.uJourneyWeatherEnable.value=1;
    uniforms.uJourneyClearing.value=.2;
    for(const material of materials){
      assert.equal(material.uniforms.uStorm,uniforms.uStorm);
      assert.equal(material.uniforms.uJourneyClearing,sky.mesh.material.uniforms.uJourneyClearing);
      assert.equal(material.uniforms.uFirmamentWeather,sky.mesh.material.uniforms.uFirmamentWeather);
    }
    assert.ok(materials[0].fragmentShader.includes('journeyCloudCover'));
    assert.ok(materials[1].fragmentShader.includes('uStorm'));
    assert.ok(materials[2].fragmentShader.includes('uStorm'));
  } finally {materials.forEach(m=>m.dispose());sky.dispose();}
});

test('directional clouds are bounded, coherent, deterministic and open with clearing',()=>{
  assert.equal(typeof journey.sampleJourneyCloud,'function');
  const params={timeSec:32,seed:73,amount:.85,clearing:0};
  const values=[];
  for(let i=0;i<80;i++){
    const direction=[Math.sin(i*.2),.1+.8*(i%9)/8,Math.cos(i*.2)];
    const cloudy=journey.sampleJourneyCloud(direction,params);
    const next=journey.sampleJourneyCloud(direction,{...params,timeSec:32+1/30});
    const clear=journey.sampleJourneyCloud(direction,{...params,clearing:1});
    assert.ok(cloudy>=0&&cloudy<=1);
    assert.ok(Math.abs(next-cloudy)<.015,'held-field drift is gradual');
    assert.ok(clear<cloudy*.25,'clearing opens the shared sky');
    assert.equal(journey.sampleJourneyCloud(direction,params),cloudy);
    assert.equal(journey.sampleJourneyCloud(direction,{...params,amount:0}),0);
    values.push(cloudy);
  }
  assert.ok(Math.max(...values)-Math.min(...values)>.15,'clouds have directional gaps');
});

test('water has low overhead reflectivity, strong grazing reflections and depth absorption',()=>{
  assert.equal(typeof journey.journeyWaterOptics,'function');
  const overhead=journey.journeyWaterOptics(1,200),grazing=journey.journeyWaterOptics(.05,200);
  assert.ok(overhead.fresnel<.03);
  assert.ok(grazing.fresnel>.75);
  const shallow=journey.journeyWaterOptics(.6,2),deep=journey.journeyWaterOptics(.6,200);
  assert.ok(shallow.transmission>deep.transmission+.5);
  assert.ok(deep.depthM>shallow.depthM);
  assert.ok([overhead,grazing,shallow,deep].every(x=>Object.values(x).every(Number.isFinite)));
});
