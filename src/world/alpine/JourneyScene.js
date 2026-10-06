// A circular mountain world: steady sky, radial terrain and automatic travel.
// Land, water, forest roots and inhabitants share the same continuous field.
import { JOURNEY_VIEW, sampleJourneyState, journeyGroundHeight, journeySurface, journeyLakeShape } from './JourneyWorld.js';
import { JOURNEY_CAST_LAYOUT, sampleJourneyCast, journeyOrbitCast } from './JourneyCast.js';
import { JOURNEY_ORBIT, journeyOrbitPoint } from './JourneyOrbit.js';
import { journeyOrbitCamera } from './JourneyOrbitCamera.js';
import { journeyCore } from './JourneyCore.js';
import { journeyUniforms, journeyMaterial, journeyGrid, journeyForest, journeyWaterGeometry } from './JourneyMaterial.js';
import * as journeyMaterials from './JourneyMaterial.js';
import { sceneUniforms, setLinearFromHex, createMaterialTextures, applyMaterial } from './TerrainMaterial.js';
import { loadMaterialPack, materialGpuBytes } from './MaterialPackage.js';
import { sampleJourneySky } from './JourneySky.js';
import { CoveGL } from './CoveGL.js';
import { FirmamentGL } from './FirmamentGL.js';
import { mirrorTextureMatrix } from './WaterMirror.js';
import { scenicProjection } from './RangeFrame.js';
import { applyCameraMoves, rangeUserCamera, NEUTRAL_MOVE } from './RangeCamera.js';
import { cameraBasis } from '../terrain/SceneTravel.js';

let nextSceneId=0;
const GEOMETRY_BYTES=7*1024*1024, SHADOW_SIZE=1024;
// All path excursions plus articulated full silhouettes and companions.
// Fit these fixed bounds once per aspect/phrase, never sampled stride roots.
const CAST_BOUNDS=[
  // Broshi: grounded spikes/head/tail, all bank excursions and foot swings.
  [[-340,30],[-20,145],[-260,340]],
  // Midio: a low swimmer; its deepest silhouette never occupies the bank.
  [[-205,205],[-70,110],[-300,-150]],
  // Midasus and companions: high but farther back, with bounded full rolls.
  [[-10,335],[30,255],[-140,0]],
];
function fitCastEnvelope(rail,tanX,tanY,margin=.88){
  const {forward,right,up}=cameraBasis(rail);
  let retreat=0;
  for(const bounds of CAST_BOUNDS)for(const x of bounds[0])for(const y of bounds[1])for(const z of bounds[2]){
    const point=journeyOrbitPoint([x,y,z]);
    const v=point.map((value,i)=>value-rail.eyeM[i]);
    const dot=a=>v.reduce((n,value,i)=>n+value*a[i],0);
    const depth=dot(forward);
    retreat=Math.max(retreat,Math.abs(dot(right))/(tanX*margin)-depth,Math.abs(dot(up))/(tanY*margin)-depth);
  }
  return {...rail,eyeM:rail.eyeM.map((v,i)=>v-forward[i]*retreat)};
}
const unit=v=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;
const MATERIAL_URL=new URL('../../assets/range/v2/materials/wet-conifer.json',import.meta.url).href;
const refused=message=>Object.assign(new Error(message),{reason:'budget'});

export class JourneyScene {
  constructor({THREE,residency=null,budget='desktop'}={}) {
    this.THREE=THREE;this.residency=residency;this.budget=budget;
    // An aborted image decode may finish after a replacement scene is ready.
    // Distinct ownership keeps that stale cleanup away from the new scene.
    const instance=++nextSceneId;
    this.gpuKey=`range:journey-geometry:${instance}`;
    this.targetKey=`range:journey-targets:${instance}`;
    this.canvas=document.createElement('canvas');
    this.canvas.width=this.canvas.height=2;
    const context=this.canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:true});
    if(!context) throw new Error('WebGL2 unavailable');
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,context,alpha:true,antialias:true});
    this.renderer.autoClear=false;
    this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.camera=new THREE.PerspectiveCamera(44,1,1,40000);
    this.mirrorCamera=new THREE.PerspectiveCamera();
    this.shadowCamera=new THREE.OrthographicCamera(-6200,6200,5100,-5100,1,23000);
    this.prepared=new Map();this.pending=new Map();
    this.size={width:0,height:0};this.contextLost=false;this.disposed=false;
    this.stats={submissions:0,drawCalls:0,triangles:0};
    this._lost=event=>{
      event.preventDefault();this.contextLost=true;
      this.release(JOURNEY_VIEW.id);this._releaseTargets();
    };
    this._restored=()=>{this.contextLost=false;};
    this.canvas.addEventListener('webglcontextlost',this._lost);
    this.canvas.addEventListener('webglcontextrestored',this._restored);
  }

  async prepare(view,{generation=0,isCurrent=()=>true}={}) {
    if(this.disposed || !isCurrent(generation)) return;
    if(this.contextLost) throw Object.assign(new Error('context lost'),{reason:'context-lost'});
    if(this.isReady(view.id)) return;
    const previous=this.pending.get(view.id);
    if(previous){
      if(previous.generation===generation&&!previous.controller.signal.aborted)return previous.promise;
      previous.controller.abort();
      await previous.promise.catch(()=>{});
      return this.prepare(view,{generation,isCurrent});
    }
    const task={generation,controller:new AbortController()};
    this.pending.set(view.id,task);
    task.promise=this._prepare(view,{generation,isCurrent,signal:task.controller.signal}).finally(()=>{
      if(this.pending.get(view.id)===task)this.pending.delete(view.id);
    });
    return task.promise;
  }
  async _prepare(view,{generation,isCurrent,signal}) {
    let reservation;
    const current=()=>!signal.aborted&&!this.disposed&&!this.contextLost&&isCurrent(generation);
    const THREE=this.THREE;
    const p={view,generation,gpuKey:this.gpuKey,meshes:[],depthMaterials:[],disposed:false};
    const dispose=()=>{
      if(p.disposed)return;p.disposed=true;
      for(const mesh of p.meshes){mesh.geometry.dispose();mesh.material.dispose();}
      for(const material of p.depthMaterials)material.dispose();
      p.textures?.dispose();
      for(const image of p.pack?.images.values()||[])image.close?.();
      p.cast?.dispose();p.firmament?.dispose();p.scene?.clear();p.shadowScene?.clear();
      if(this.prepared.get(view.id)===p)this.prepared.delete(view.id);
    };
    p.dispose=dispose;
    try {
      p.pack=await loadMaterialPack(MATERIAL_URL,{signal,onManifest:manifest=>{
        if(!current())throw Object.assign(new Error('stale journey'),{reason:'aborted'});
        // Retain decoded data for lazy upload and context restoration. Reserve
        // it together with mipmapped textures, mesh arrays and decode scratch.
        const unique=[...new Map(Object.values(manifest.textures).map(t=>[t.sha256,t])).values()];
        const decoded=unique.reduce((sum,t)=>sum+t.width*t.height*4,0);
        const scratch=Math.max(...unique.map(t=>t.bytes));
        reservation=this.residency?.reserve({key:this.gpuKey,bytes:GEOMETRY_BYTES+materialGpuBytes(manifest)+decoded+scratch,
          owner:'range-journey',generation});
        if(this.residency&&!reservation)throw refused('no room for journey materials');
      }});
      if(!current())throw Object.assign(new Error('stale journey'),{reason:'aborted'});
      p.uniforms=sceneUniforms(THREE,{...journeyUniforms(THREE),uHeightRange:{value:new THREE.Vector2(0,2300)}});
      p.textures=createMaterialTextures(THREE,p.pack);
      applyMaterial(p.uniforms,p.pack,p.textures);
      p.scene=new THREE.Scene();p.shadowScene=new THREE.Scene();
      p.uniforms.uJourneyOrbit.value=1;
      p.core=journeyCore(THREE,p.uniforms);
      p.core.frustumCulled=false;p.meshes.push(p.core);p.scene.add(p.core);
      const coreDepth=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,
        uniforms:p.core.material.uniforms,vertexShader:p.core.material.vertexShader,
        fragmentShader:'precision highp float;out vec4 outColor;void main(){outColor=vec4(1.0);}',side:THREE.DoubleSide});
      p.depthMaterials.push(coreDepth);
      const coreShadow=new THREE.Mesh(p.core.geometry,coreDepth);
      coreShadow.frustumCulled=false;p.shadowScene.add(coreShadow);
      for(const layer of [2,1,0]) {
        const span=JOURNEY_ORBIT.circumferenceM;
        const geometry=journeyGrid(THREE,768,layer===0?80:56,span,{circular:true});
        const mesh=new THREE.Mesh(geometry,journeyMaterial(THREE,p.uniforms,'surface',layer,span));
        mesh.frustumCulled=false;p.meshes.push(mesh);p.scene.add(mesh);
        const material=journeyMaterial(THREE,p.uniforms,'shadow',layer,span);
        p.depthMaterials.push(material);
        const depth=new THREE.Mesh(geometry,material);depth.frustumCulled=false;p.shadowScene.add(depth);
      }
      p.water=new THREE.Mesh(journeyWaterGeometry(THREE,{circular:true}),journeyMaterial(THREE,p.uniforms,'water'));
      p.water.frustumCulled=false;p.meshes.push(p.water);p.scene.add(p.water);
      const forest=journeyForest(THREE,p.uniforms,{circular:true});
      forest.frustumCulled=false;p.meshes.push(forest);p.scene.add(forest);
      if(journeyMaterials.journeyDressing){
        p.dressing=journeyMaterials.journeyDressing(THREE,p.uniforms,{circular:true});
        p.dressing.frustumCulled=false;p.meshes.push(p.dressing);p.scene.add(p.dressing);
      }
      p.cast=new CoveGL(THREE,p.uniforms,JOURNEY_CAST_LAYOUT);
      p.cast.group.traverse(node=>{
        if(node.material && !node.material.transparent)node.material.depthWrite=true;
      });
      p.scene.add(p.cast.group);p.shadowScene.add(p.cast.depthGroup);
      p.firmament=new FirmamentGL(THREE,p.uniforms);
      if(reservation&&!this.residency.commit(reservation,p,dispose))return;
      this.prepared.set(view.id,p);
    } catch(error) {
      dispose();if(reservation)this.residency.release(this.gpuKey);
      if(current())throw error;
    }
  }

  isReady(id){return !this.contextLost && !this.disposed && this.prepared.has(id);}
  pinView(ids,extraKeys=[]){
    this.residency?.pin([...(ids?[this.gpuKey]:[]),this.targetKey,...extraKeys]);
  }
  release(id){
    this.pending.get(id)?.controller.abort();
    const p=this.prepared.get(id);if(!p)return;
    if(this.residency)this.residency.release(p.gpuKey);else p.dispose();
  }
  _releaseTargets(){
    if(this.residency)this.residency.release(this.targetKey);else this.targets?.dispose();
    this.targets=null;this.mirror=null;this.shadow=null;this.size={width:0,height:0};
  }
  resize({widthPx,heightPx,pixelRatio=1}){
    const maxPixels=this.budget==='mobile'?1280*720:1920*1080;
    const scale=Math.min(1,Math.sqrt(maxPixels/(widthPx*heightPx)));
    const width=Math.max(2,Math.round(widthPx*scale)),height=Math.max(2,Math.round(heightPx*scale));
    this.pixelRatio=pixelRatio;
    if(this.mirror&&this.shadow&&width===this.size.width&&height===this.size.height)return;
    this._releaseTargets();
    const mw=Math.max(2,Math.ceil(width/2)),mh=Math.max(2,Math.ceil(height/2));
    // Multisample color/depth and resolved color, mirror color/depth, shadow
    // color/depth. Driver overhead is outside this ownership estimate.
    const samples=this.renderer.getContext().getParameter(this.renderer.getContext().SAMPLES)||1;
    const bytes=width*height*(8*samples+4)+mw*mh*8+SHADOW_SIZE*SHADOW_SIZE*8;
    const reservation=this.residency?.reserve({key:this.targetKey,bytes,owner:'range-journey-targets',protect:[this.gpuKey]});
    if(this.residency&&!reservation)throw refused('no room for journey render targets');
    const targets={dispose:()=>{
      targets.mirror?.dispose();targets.shadow?.dispose();targets.shadow?.depthTexture?.dispose();
      if(this.targets===targets){this.targets=null;this.mirror=null;this.shadow=null;}
    }};
    this.targets=targets;
    try {
      const THREE=this.THREE;
      targets.mirror=new THREE.WebGLRenderTarget(mw,mh,{depthBuffer:true,stencilBuffer:false,
        minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
      targets.shadow=new THREE.WebGLRenderTarget(SHADOW_SIZE,SHADOW_SIZE,{depthBuffer:true,stencilBuffer:false,
        minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
      targets.shadow.depthTexture=new THREE.DepthTexture(SHADOW_SIZE,SHADOW_SIZE,THREE.UnsignedIntType);
      this.mirror=targets.mirror;this.shadow=targets.shadow;
      this.renderer.setSize(width,height,false);this.size={width,height};
      if(reservation)this.residency.commit(reservation,targets,entry=>entry.dispose());
    } catch(error){targets.dispose();this._releaseTargets();throw error;}
  }

  movedPose(view,frame){
    const c=view.camera;
    const vp=frame.scenicViewport,proj=scenicProjection(c.fovYDeg,vp),margin=vp.overscanPx||0;
    const width=Math.max(1,vp.logicalWidth-2*margin),height=Math.max(1,vp.logicalHeight-2*margin);
    const tanY=Math.tan(proj.fovYDeg*Math.PI/360)*height/vp.logicalHeight,tanX=tanY*width/height;
    const state=sampleJourneyState({timeMs:frame.timeMs,seed:frame.seed,music:frame.habitatMusic?.journey,reducedMotion:frame.reducedMotion,circular:true});
    const authored=journeyOrbitCamera({timeMs:frame.timeMs,tanX,tanY,direction:frame.journeyDirection,reducedMotion:frame.reducedMotion});
    const heightAt=(x,z)=>{
      const {radiusM,depthScale}=JOURNEY_ORBIT;
      // Solve the upper surface along the camera's vertical ray. Latitude
      // changes with altitude on a sphere; the old cylinder's z/scale lookup
      // would allow the listener to move through the foreground hemisphere.
      let altitude=0,highest=-Infinity;
      for(let iteration=0;iteration<6;iteration++){
        const radius=radiusM+altitude,squared=radius*radius-x*x-z*z;
        if(squared<=0)return highest;
        const y=Math.sqrt(squared)-radiusM;
        const localX=Math.atan2(x,y+radiusM)*radiusM;
        const localZ=Math.asin(Math.max(-1,Math.min(1,z/radius)))*radiusM/depthScale;
        let next=Math.max(0,journeyGroundHeight(localX,localZ,state));
        for(const layer of [1,2]){
          const start=journeySurface(localX,0,layer,state),end=journeySurface(localX,1,layer,state);
          const v=(localZ-start[2])/(end[2]-start[2]);
          if(v>=0&&v<=1)next=Math.max(next,journeySurface(localX,v,layer,state)[1]);
        }
        highest=Math.max(highest,Math.sqrt(Math.max(0,(radiusM+next)**2-x*x-z*z))-radiusM);
        altitude=next;
      }
      return highest;
    };
    const rail=fitCastEnvelope(authored,tanX,tanY);
    const pose=applyCameraMoves(rail,NEUTRAL_MOVE,frame.userCamera,{heightAt,
      sampleStepM:24,cone:{tanX,tanY},heightRangeM:[-JOURNEY_ORBIT.radiusM,1000]});
    return {rail,pose,proj,tanX,tanY};
  }
  _frame(frame,p){
    if(p.frame===frame)return;
    p.frame=frame;this.stats={submissions:0,drawCalls:0,triangles:0};
    const {pose,proj,tanX,tanY}=this.movedPose(p.view,frame),camera=this.camera;
    if(frame.userCamera)rangeUserCamera.noteFrame({tanX,tanY,userScale:pose.userScale,frameId:frame.frameId});
    camera.position.fromArray(pose.eyeM);camera.up.set(0,1,0);camera.lookAt(...pose.targetM);
    camera.fov=proj.fovYDeg;camera.aspect=proj.aspect;camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const music=frame.habitatMusic?.journey;
    const state=sampleJourneyState({timeMs:frame.timeMs,seed:frame.seed,music,reducedMotion:frame.reducedMotion,circular:true});
    p.state=state;
    const u=p.uniforms;
    for(const [key,value] of Object.entries({Time:state.timeSec,Travel:state.travelM%JOURNEY_ORBIT.circumferenceM,Seed:state.seed,
      Energy:state.energy,Bass:state.bass,Melody:state.melody,Pulse:state.pulse}))u[`uJourney${key}`].value=value;
    u.uJourneyBands.value.set(state.bands);
    u.uJourneyOrbit.value=1;
    const lake=journeyLakeShape(state);u.uJourneyLake.value.set(lake.centerX,lake.halfWidthM);
    u.uCameraPos.value.copy(camera.position);u.uTime.value=state.timeSec;
    const storm={amount:unit(frame.storm?.amount),flash:frame.reducedFlash?0:unit(frame.storm?.flash),
      break01:unit(frame.storm?.break01),wet01:unit(frame.storm?.wet01)};
    u.uStorm.value.set(storm.amount,storm.flash,storm.break01,storm.wet01);
    u.uFirmamentWeather.value.set(storm.amount,storm.flash);
    if(u.uJourneyWeatherEnable)u.uJourneyWeatherEnable.value=1;
    if(u.uJourneyClearing)u.uJourneyClearing.value=storm.break01;
    const focus=frame.reducedMotion?0:unit(frame.journeyDirection?.focusStrength01);
    const sky=frame.light.sky;
    setLinearFromHex(u.uSkyZenith.value,sky.top);
    setLinearFromHex(u.uSkyHorizon.value,sky.horizon);
    setLinearFromHex(u.uAirColor.value,sky.air||sky.horizon);
    const celestial=frame.light.celestial;
    const direction=new this.THREE.Vector3(celestial.xFrac*2-1,1-celestial.yFrac*2,.5)
      .unproject(camera).sub(camera.position).normalize();
    u.uLightDir.value.copy(direction);
    setLinearFromHex(u.uLightColor.value,celestial.colorHex||'#c6d7ff').multiplyScalar((celestial.intensity??.5)*(1-.62*storm.amount+.18*storm.break01+.9*storm.flash));
    u.uAmbientScale.value=3*(1-.42*storm.amount+.08*storm.break01+.3*storm.flash);u.uAirDensity.value=.00008;u.uExposure.value=2.3;
    u.uFullSky.value=1;u.uFirmamentTime.value=state.timeSec;
    p.sky=sampleJourneySky({timeMs:frame.timeMs,durationMs:frame.durationMs,light:frame.light,reducedMotion:frame.reducedMotion});
    u.uFirmamentSeed.value=state.seed*.01;u.uFirmamentNight.value=p.sky.night01;
    u.uFirmamentLayers.value.set(p.sky.stars01,p.sky.constellations01,p.sky.aurora01*(1-.48*focus));
    u.uFirmamentFlash.value=frame.reducedFlash?.18:1;
    u.uFirmamentBands.value.set(.45+.55*state.energy,state.melody,state.bass);
    u.uFirmamentMotion.value.set(state.pulse,state.bass,state.melody,frame.reducedMotion?0:1);
    u.uSkyProjectionInverse.value.copy(camera.projectionMatrixInverse);u.uSkyCameraWorld.value.copy(camera.matrixWorld);
    const radius=(celestial.radiusFrac||.0175)*camera.aspect*2*Math.tan(camera.fov*Math.PI/360);
    u.uFirmamentBody.value.set(direction.x,direction.y,direction.z,radius);
    const body=setLinearFromHex(u.uLightColor.value.clone(),celestial.colorHex||'#c6d7ff').multiplyScalar(.8*(celestial.visibility??1));
    u.uFirmamentBodyColor.value.set(body.r,body.g,body.b);
    p.pose=journeyOrbitCast(sampleJourneyCast({timeMs:frame.timeMs,state,music,reducedMotion:frame.reducedMotion,reducedFlash:frame.reducedFlash,direction:frame.journeyDirection}));
    p.cast.update(p.pose);
    // Dim competing companions through the same continuous evidence as the
    // aurora. Keep every silhouette present and restore its authored colors
    // on each held/seek-reconstructed frame, so emphasis cannot accumulate.
    const babies=p.cast.actors?.midasus?.babies||[];
    if(!p.companionColors)p.companionColors=babies.map(baby=>({
      body:baby.uniforms.uBodyColor.value.clone(),edge:baby.uniforms.uEdgeColor.value.clone()}));
    const companionFocus=frame.reducedMotion?0:unit((frame.journeyDirection?.focusById?.midio||0)
      +(frame.journeyDirection?.focusById?.broshi||0));
    babies.forEach((baby,index)=>{
      const gain=1-companionFocus*(index===0?.25:.7),base=p.companionColors[index];
      baby.uniforms.uBodyColor.value.copy(base.body).multiplyScalar(gain);
      baby.uniforms.uEdgeColor.value.copy(base.edge).multiplyScalar(gain);
      baby.uniforms.uGlow.value*=gain;
    });
    const swimmer=p.pose.swimmer;
    if(swimmer){
      u.uSwimmer.value.set(swimmer.positionM[0],swimmer.positionM[2],swimmer.strength,swimmer.speedMps);
      u.uSwimDirection.value.fromArray(swimmer.directionXZ);
    }
  }
  _render(scene,camera){
    this.renderer.render(scene,camera);
    const info=this.renderer.info.render;
    this.stats.submissions++;this.stats.drawCalls+=info.calls;this.stats.triangles+=info.triangles;
  }
  renderFirmament(frame,id){
    const p=this.prepared.get(id);if(!p||this.contextLost)return null;
    this._frame(frame,p);
    this.renderer.setRenderTarget(null);this.renderer.setClearColor(0,0);this.renderer.clear();
    this._render(p.firmament.scene,this.camera);return this.canvas;
  }
  renderPartition(frame,pass,id){
    const p=this.prepared.get(id);if(pass!=='far'||!p||!this.mirror||!this.shadow||this.contextLost)return null;
    this._frame(frame,p);
    const r=this.renderer,u=p.uniforms;
    const lightTarget=new this.THREE.Vector3(0,-JOURNEY_ORBIT.radiusM,-500);
    this.shadowCamera.position.copy(lightTarget).addScaledVector(u.uLightDir.value,11000);
    this.shadowCamera.lookAt(lightTarget);this.shadowCamera.updateMatrixWorld();
    mirrorTextureMatrix(this.THREE,this.shadowCamera,u.uJourneyShadowMatrix.value);
    u.uJourneyShadow.value=this.shadow.depthTexture;
    r.setRenderTarget(this.shadow);r.setClearColor(0,0);r.clear();
    this._render(p.shadowScene,this.shadowCamera);
    // A spherical lake has no shared planar mirror. Its material reflects
    // the smooth sky radiance using the local radial normal.
    u.uClipBelow.value=-1e9;
    r.setRenderTarget(null);r.setClearColor(0,0);r.clear();
    this._render(p.scene,this.camera);
    return this.canvas;
  }
  snapshot(){
    const p=this.prepared.get(JOURNEY_VIEW.id);
    return {kind:'journey',prepared:[...this.prepared.keys()],pending:[...this.pending.keys()],contextLost:this.contextLost,
      size:{...this.size},stats:{...this.stats},travelM:p?.state?.travelM??0,orbit:JOURNEY_ORBIT,cast:p?.pose??null,sky:p?.sky??null,lake:p?.state?journeyLakeShape(p.state):null};
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;
    this.canvas.removeEventListener('webglcontextlost',this._lost);
    this.canvas.removeEventListener('webglcontextrestored',this._restored);
    for(const id of new Set([...this.prepared.keys(),...this.pending.keys()]))this.release(id);
    this._releaseTargets();this.renderer.dispose();this.renderer.forceContextLoss?.();
  }
}
