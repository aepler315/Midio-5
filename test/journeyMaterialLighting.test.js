import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit opt-in avoids a browser dependency for the ordinary Node suite.
test('actual Journey shaders preserve lighting, grazing reflection, unstamped habitat and opaque shore contact',
  {skip:!process.env.PLAYWRIGHT_CHROMIUM_PATH},async t=>{
    const root=fileURLToPath(new URL('..',import.meta.url));
    const server=createServer(async(req,res)=>{
      if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<canvas></canvas>');return;}
      const filename=path.join(root,new URL(req.url,'http://localhost').pathname);
      if(!filename.startsWith(path.join(root,'src')+path.sep)){res.writeHead(404);res.end();return;}
      try {res.setHeader('Content-Type','text/javascript');res.end(await readFile(filename));}
      catch {res.writeHead(404);res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const {chromium}=await import('playwright');
    let browser;
    try {
      browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH,
        args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
      const page=await browser.newPage();
      const errors=[];page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const pixels=await page.evaluate(async()=>{
        const THREE=await import('/src/vendor/range/three-range.module.js');
        const {journeyUniforms,journeyMaterial,journeyWaterGeometry,journeyGrid}=await import('/src/world/alpine/JourneyMaterial.js');
        const {sceneUniforms}=await import('/src/world/alpine/TerrainMaterial.js');
        const {journeyNearShore,journeyFarShore,journeyLakeShape,sampleJourneyState,JOURNEY_VIEW}=await import('/src/world/alpine/JourneyWorld.js');
        const u=sceneUniforms(THREE,journeyUniforms(THREE));
        const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas')});
        renderer.setSize(8,8);
        const target=new THREE.WebGLRenderTarget(8,8);
        const camera=new THREE.OrthographicCamera(-1,1,1,-1,1,2000);
        const scene=new THREE.Scene(),geometry=journeyWaterGeometry(THREE),material=journeyMaterial(THREE,u,'water');
        scene.add(new THREE.Mesh(geometry,material));
        const mirror=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);mirror.needsUpdate=true;
        const shadow=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);shadow.needsUpdate=true;
        u.uMirror.value=mirror;u.uJourneyShadow.value=shadow;
        u.uMirrorMatrix.value.set(0,0,0,.5,0,0,0,.5,0,0,0,0,0,0,0,1);
        u.uLightDir.value.set(0,1,0);
        u.uFirmamentLayers.value.set(0,0,0);u.uFirmamentBodyColor.value.set(0,0,0);
        const deep=journeyLakeShape().centerZ,shallow=journeyNearShore(0)-2;
        const results={};
        function sample(name,z,light,sky,grazing=false){
          camera.position.set(0,1000,z);camera.up.set(0,0,-1);camera.lookAt(0,0,z);camera.updateMatrixWorld();
          u.uCameraPos.value.set(0,grazing?10:1000,grazing?z+200:z);
          u.uLightColor.value.set(...light);u.uSkyHorizon.value.set(...sky);u.uSkyZenith.value.set(...sky);
          renderer.setRenderTarget(target);renderer.render(scene,camera);
          const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,4,4,1,1,pixel);
          results[name]=Array.from(pixel).slice(0,3);
        }
        for(const [name,z] of [['Deep',deep],['Shallow',shallow]]){
          sample('black'+name,z,[0,0,0],[0,0,0]);
          sample('moon'+name,z,[.018,.025,.042],[.001,.003,.007]);
          sample('day'+name,z,[.85,.8,.7],[.16,.23,.32]);
        }
        mirror.image.data.set([90,110,160,255]);mirror.needsUpdate=true;
        sample('grazingBlack',deep,[0,0,0],[0,0,0],true);
        sample('grazingDay',deep,[.85,.8,.7],[.16,.23,.32],true);
        const surface=journeyMaterial(THREE,u,'surface',1);
        // Isolate the shipped fragment shader from changing terrain macros.
        surface.vertexShader='out vec3 vWorld,vNormal;void main(){vWorld=vec3(position.x,40.0,position.z);vNormal=vec3(0,1,0);gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1);}';
        scene.children[0].material=surface;
        camera.position.set(0,1000,deep);camera.lookAt(0,40,deep);camera.updateMatrixWorld();
        u.uClipBelow.value=-100;u.uJourneyTravel.value=0;
        const rock=new THREE.DataTexture(new Uint8Array([128,128,128,128]),1,1);rock.needsUpdate=true;
        const black=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);black.needsUpdate=true;
        const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
        surface.uniforms.tRock.value=rock;surface.uniforms.tRockNear.value=rock;surface.uniforms.tSnow.value=rock;
        for(const [name,texture] of [['canopyBlack',black],['canopyWhite',white]]){
          surface.uniforms.tCanopy.value=texture;
          renderer.setRenderTarget(target);renderer.render(scene,camera);
          const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,4,4,1,1,pixel);
          results[name]=Array.from(pixel).slice(0,3);
        }
        // A multisampled terrain boundary and center-evaluated fragment
        // discard must cover every sample, so compositor sky cannot leak.
        const shoreTarget=new THREE.WebGLRenderTarget(960,540,{samples:4});
        const shoreScene=new THREE.Scene(),shoreCamera=new THREE.PerspectiveCamera(44,16/9,1,16000);
        shoreCamera.position.fromArray(JOURNEY_VIEW.camera.eyeStartM);
        shoreCamera.lookAt(...JOURNEY_VIEW.camera.targetStartM);shoreCamera.updateMatrixWorld();
        const state=sampleJourneyState({timeMs:28000,seed:2917029651});
        for(const [suffix,value] of Object.entries({Time:state.timeSec,Travel:state.travelM,Seed:state.seed}))u['uJourney'+suffix].value=value;
        const lake=journeyLakeShape(state);u.uJourneyLake.value.set(lake.centerX,lake.halfWidthM);
        const shoreMeshes=[];
        for(const layer of [1,0]){
          const g=layer?journeyGrid(THREE):journeyGrid(THREE,512,24,8400);
          const m=journeyMaterial(THREE,u,'surface',layer,layer?16000:8400);
          m.uniforms.tRock.value=rock;m.uniforms.tRockNear.value=rock;m.uniforms.tSnow.value=rock;m.uniforms.tCanopy.value=white;
          const mesh=new THREE.Mesh(g,m);mesh.frustumCulled=false;shoreScene.add(mesh);shoreMeshes.push(mesh);
        }
        renderer.setRenderTarget(shoreTarget);renderer.setClearColor(0,0);renderer.clear();renderer.render(shoreScene,shoreCamera);
        const landCoverage=new Uint8Array(960*540*4);renderer.readRenderTargetPixels(shoreTarget,0,0,960,540,landCoverage);
        const shoreWater=new THREE.Mesh(geometry,material);shoreWater.frustumCulled=false;shoreScene.add(shoreWater);
        renderer.setRenderTarget(null);renderer.setRenderTarget(shoreTarget);renderer.clear();renderer.render(shoreScene,shoreCamera);
        const coverage=new Uint8Array(960*540*4);renderer.readRenderTargetPixels(shoreTarget,0,0,960,540,coverage);
        let leaks=0,minimumAlpha=255,changedOpaqueLand=0;const changedExamples=[],leakExamples=[];
        for(let i=0;i<coverage.length;i+=4)if(landCoverage[i+3]===255&&
          [0,1,2].some(channel=>Math.abs(coverage[i+channel]-landCoverage[i+channel])>1)){
          changedOpaqueLand++;if(changedExamples.length<6)changedExamples.push({xy:[(i/4)%960,Math.floor(i/4/960)],land:Array.from(landCoverage.slice(i,i+4)),both:Array.from(coverage.slice(i,i+4))});
        }
        for(const shoreline of [journeyNearShore,journeyFarShore])for(let i=0;i<=800;i++){
          const x=lake.centerX+lake.halfWidthM*(-.995+1.99*i/800);
          const point=new THREE.Vector3(x,0,shoreline(x,state)).project(shoreCamera);
          const px=Math.round((point.x*.5+.5)*960),py=Math.round((point.y*.5+.5)*540);
          for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
            const alpha=coverage[((py+dy)*960+px+dx)*4+3];minimumAlpha=Math.min(minimumAlpha,alpha);if(alpha<254){leaks++;if(leakExamples.length<6)leakExamples.push([px+dx,py+dy,alpha]);}
          }
        }
        results.shoreCoverage={leaks,minimumAlpha,changedOpaqueLand,changedExamples,leakExamples};
        shoreMeshes.forEach(mesh=>{mesh.geometry.dispose();mesh.material.dispose();});shoreTarget.dispose();
        surface.dispose();rock.dispose();black.dispose();white.dispose();
        geometry.dispose();material.dispose();mirror.dispose();shadow.dispose();target.dispose();renderer.dispose();
        return results;
      });
      assert.deepEqual(errors,[],'the actual water shader compiles without browser errors');
      t.diagnostic(JSON.stringify(pixels));
      assert.deepEqual(pixels.canopyWhite,pixels.canopyBlack,'packed repeating crown stamps must not paint the hillside albedo');
      assert.equal(pixels.shoreCoverage.leaks,0,`terrain/water sample gaps expose compositor sky: ${JSON.stringify(pixels.shoreCoverage)}`);
      assert.equal(pixels.shoreCoverage.changedOpaqueLand,0,'support is hidden beneath the bank and does not paint over visible land');
      const brightness=rgb=>rgb.reduce((a,b)=>a+b,0)/3;
      for(const region of ['Deep','Shallow']){
        assert.ok(brightness(pixels['black'+region])<7,`${region} water must not emit its sediment/body color: ${pixels['black'+region]}`);
        assert.ok(brightness(pixels['day'+region])>brightness(pixels['moon'+region])*2,`${region} transmission responds to actual illumination`);
        assert.ok(brightness(pixels['moon'+region])>brightness(pixels['black'+region]),'moonlight remains visible');
      }
      assert.ok(brightness(pixels.grazingBlack)>90,'darkening transmission preserves the lit reflected field');
      assert.ok(Math.abs(brightness(pixels.grazingDay)-brightness(pixels.grazingBlack))<8,'grazing reflection remains dominant');
    } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
  });
