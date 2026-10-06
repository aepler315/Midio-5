// A compact 3D traveling valley: sky, one mirror, one color/depth scene.
// Land, water, forest roots and inhabitants share the same continuous field.
import { JOURNEY_VIEW, sampleJourneyState, journeyGroundHeight, journeySurface } from './JourneyWorld.js';
import { JOURNEY_CAST_LAYOUT, sampleJourneyCast } from './JourneyCast.js';
import { journeyUniforms, journeyMaterial, journeyGrid, journeyForest, journeyWaterGeometry } from './JourneyMaterial.js';
import { sceneUniforms, setLinearFromHex } from './TerrainMaterial.js';
import { CoveGL } from './CoveGL.js';
import { FirmamentGL } from './FirmamentGL.js';
import { mirrorCameraFor, mirrorTextureMatrix } from './WaterMirror.js';
import { scenicProjection } from './RangeFrame.js';
import { applyCameraMoves, rangeUserCamera, NEUTRAL_MOVE } from './RangeCamera.js';

const GPU_KEY='range:journey-geometry', TARGET_KEY='range:journey-targets';
const GPU_BYTES=4*1024*1024;
const refused=message=>Object.assign(new Error(message),{reason:'budget'});

export class JourneyScene {
  constructor({THREE,residency=null,budget='desktop'}={}) {
    this.THREE=THREE;this.residency=residency;this.budget=budget;
    this.canvas=document.createElement('canvas');
    this.canvas.width=this.canvas.height=2;
    const context=this.canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true});
    if(!context) throw new Error('WebGL2 unavailable');
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,context,alpha:true,antialias:false});
    this.renderer.autoClear=false;
    this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.camera=new THREE.PerspectiveCamera(44,1,1,9000);
    this.mirrorCamera=new THREE.PerspectiveCamera();
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
    const reservation=this.residency?.reserve({key:GPU_KEY,bytes:GPU_BYTES,owner:'range-journey',generation});
    if(this.residency&&!reservation) throw refused('no room for journey geometry');
    const THREE=this.THREE;
    const p={view,generation,gpuKey:GPU_KEY,meshes:[],disposed:false};
    const dispose=()=>{
      if(p.disposed) return;p.disposed=true;
      for(const mesh of p.meshes){mesh.geometry.dispose();mesh.material.dispose();}
      p.cast?.dispose();p.firmament?.dispose();p.scene?.clear();
      this.prepared.delete(view.id);
    };
    try {
      p.uniforms=sceneUniforms(THREE,{...journeyUniforms(THREE),uHeightRange:{value:new THREE.Vector2(0,1200)}});
      p.scene=new THREE.Scene();
      for(const layer of [2,1,0]) {
        const mesh=new THREE.Mesh(journeyGrid(THREE),journeyMaterial(THREE,p.uniforms,'surface',layer));
        mesh.frustumCulled=false;p.meshes.push(mesh);p.scene.add(mesh);
      }
      const waterGeometry=journeyWaterGeometry(THREE);
      p.water=new THREE.Mesh(waterGeometry,journeyMaterial(THREE,p.uniforms,'water'));
      p.water.frustumCulled=false;p.meshes.push(p.water);p.scene.add(p.water);
      const forest=journeyForest(THREE,p.uniforms);
      forest.frustumCulled=false;p.meshes.push(forest);p.scene.add(forest);
      p.cast=new CoveGL(THREE,p.uniforms,JOURNEY_CAST_LAYOUT);
      // This scene uses ordinary depth ownership instead of a separate
      // terrain/character depth prepass. The contact shadow remains blended.
      p.cast.group.traverse(node=>{
        if(node.material && !node.material.transparent) node.material.depthWrite=true;
      });
      p.scene.add(p.cast.group);
      p.firmament=new FirmamentGL(THREE,p.uniforms);
      p.dispose=dispose;
      if(reservation&&!this.residency.commit(reservation,p,dispose)) return;
      this.prepared.set(view.id,p);
    } catch(error) {
      dispose();if(reservation)this.residency.release(GPU_KEY);throw error;
    }
  }

  isReady(id){return !this.contextLost && !this.disposed && this.prepared.has(id);}
  pinView(ids,extraKeys=[]){
    this.residency?.pin([...(ids?[GPU_KEY]:[]),TARGET_KEY,...extraKeys]);
  }
  release(id){
    const p=this.prepared.get(id);if(!p)return;
    if(this.residency)this.residency.release(p.gpuKey);else p.dispose();
  }
  _releaseTargets(){
    if(this.residency)this.residency.release(TARGET_KEY);else this.mirror?.dispose();
    this.mirror=null;this.size={width:0,height:0};
  }
  resize({widthPx,heightPx,pixelRatio=1}){
    // Bound fragment work on high-DPI phones and exports. The compositor
    // scales this backing surface into its requested logical viewport.
    const maxPixels=this.budget==='mobile'?1280*720:1920*1080;
    const scale=Math.min(1,Math.sqrt(maxPixels/(widthPx*heightPx)));
    const width=Math.max(2,Math.round(widthPx*scale)),height=Math.max(2,Math.round(heightPx*scale));
    this.pixelRatio=pixelRatio;
    if(this.mirror&&width===this.size.width&&height===this.size.height)return;
    this._releaseTargets();
    const mw=Math.max(2,Math.ceil(width/2)),mh=Math.max(2,Math.ceil(height/2));
    const reservation=this.residency?.reserve({key:TARGET_KEY,bytes:width*height*8+mw*mh*8,owner:'range-journey-targets',protect:[GPU_KEY]});
    if(this.residency&&!reservation)throw refused('no room for journey render targets');
    try {
      const THREE=this.THREE;
      this.mirror=new THREE.WebGLRenderTarget(mw,mh,{depthBuffer:true,stencilBuffer:false,
        minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
      this.renderer.setSize(width,height,false);this.size={width,height};
      if(reservation)this.residency.commit(reservation,this.mirror,target=>{
        target.dispose();if(this.mirror===target)this.mirror=null;
      });
    } catch(error){this._releaseTargets();throw error;}
  }

  movedPose(view,frame){
    const c=view.camera;
    const rail={eyeM:c.eyeStartM,targetM:c.targetStartM,fovYDeg:c.fovYDeg,up:[0,1,0]};
    const vp=frame.scenicViewport,proj=scenicProjection(c.fovYDeg,vp),margin=vp.overscanPx||0;
    const width=Math.max(1,vp.logicalWidth-2*margin),height=Math.max(1,vp.logicalHeight-2*margin);
    const tanY=Math.tan(proj.fovYDeg*Math.PI/360)*height/vp.logicalHeight,tanX=tanY*width/height;
    const state=sampleJourneyState({timeMs:frame.timeMs,seed:frame.seed,music:frame.habitatMusic?.journey,reducedMotion:frame.reducedMotion});
    const heightAt=(x,z)=>{
      let y=journeyGroundHeight(x,z,state);
      for(const layer of [1,2]){
        const start=journeySurface(x,0,layer,state),end=journeySurface(x,1,layer,state);
        const v=(z-start[2])/(end[2]-start[2]);
        if(v>=0&&v<=1)y=Math.max(y,journeySurface(x,v,layer,state)[1]);
      }
      return y;
    };
    const pose=applyCameraMoves(rail,NEUTRAL_MOVE,frame.userCamera,{heightAt,waterLevelM:0,
      sampleStepM:24,cone:{tanX,tanY},heightRangeM:[0,1300]});
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
    const state=sampleJourneyState({timeMs:frame.timeMs,seed:frame.seed,music,reducedMotion:frame.reducedMotion});
    p.state=state;
    const u=p.uniforms;
    for(const [key,value] of Object.entries({Time:state.timeSec,Travel:state.travelM,Seed:state.seed,
      Energy:state.energy,Bass:state.bass,Melody:state.melody,Pulse:state.pulse}))u[`uJourney${key}`].value=value;
    u.uJourneyBands.value.set(state.bands);
    u.uCameraPos.value.copy(camera.position);u.uTime.value=state.timeSec;
    const sky=frame.light.sky;
    setLinearFromHex(u.uSkyZenith.value,sky.top);
    setLinearFromHex(u.uSkyHorizon.value,sky.horizon);
    setLinearFromHex(u.uAirColor.value,sky.air||sky.horizon);
    const celestial=frame.light.celestial;
    const direction=new this.THREE.Vector3(celestial.xFrac*2-1,1-celestial.yFrac*2,.5)
      .unproject(camera).sub(camera.position).normalize();
    u.uLightDir.value.copy(direction);
    setLinearFromHex(u.uLightColor.value,celestial.colorHex||'#c6d7ff').multiplyScalar(celestial.intensity??.5);
    u.uAmbientScale.value=3;u.uAirDensity.value=.00008;u.uExposure.value=2.3;
    u.uFullSky.value=1;u.uFirmamentTime.value=state.timeSec;
    u.uFirmamentSeed.value=state.seed*.01;u.uFirmamentNight.value=frame.light.night01;
    u.uFirmamentFlash.value=frame.reducedFlash?.18:1;
    u.uFirmamentBands.value.set(.45+.55*state.energy,state.melody,state.bass);
    u.uFirmamentMotion.value.set(state.pulse,state.bass,state.melody,frame.reducedMotion?0:1);
    u.uSkyProjectionInverse.value.copy(camera.projectionMatrixInverse);u.uSkyCameraWorld.value.copy(camera.matrixWorld);
    const radius=(celestial.radiusFrac||.0175)*camera.aspect*2*Math.tan(camera.fov*Math.PI/360);
    u.uFirmamentBody.value.set(direction.x,direction.y,direction.z,radius);
    const body=setLinearFromHex(u.uLightColor.value.clone(),celestial.colorHex||'#c6d7ff').multiplyScalar(.8*(celestial.visibility??1));
    u.uFirmamentBodyColor.value.set(body.r,body.g,body.b);
    p.pose=sampleJourneyCast({timeMs:frame.timeMs,state,music,reducedMotion:frame.reducedMotion,reducedFlash:frame.reducedFlash});
    p.cast.update(p.pose);
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
    const p=this.prepared.get(id);if(pass!=='far'||!p||!this.mirror||this.contextLost)return null;
    this._frame(frame,p);
    const r=this.renderer,u=p.uniforms;
    mirrorCameraFor(this.THREE,this.camera,0,this.mirrorCamera,1);
    mirrorTextureMatrix(this.THREE,this.mirrorCamera,u.uMirrorMatrix.value);
    p.water.visible=false;u.uClipBelow.value=.1;
    r.setRenderTarget(this.mirror);r.setClearColor(0,0);r.clear();
    this._render(p.scene,this.mirrorCamera);
    p.water.visible=true;u.uClipBelow.value=-1e9;u.uMirror.value=this.mirror.texture;
    r.setRenderTarget(null);r.setClearColor(0,0);r.clear();
    this._render(p.scene,this.camera);
    return this.canvas;
  }
  snapshot(){
    const p=this.prepared.get(JOURNEY_VIEW.id);
    return {kind:'journey',prepared:[...this.prepared.keys()],pending:[],contextLost:this.contextLost,
      size:{...this.size},stats:{...this.stats},travelM:p?.state?.travelM??0,cast:p?.pose??null};
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;
    this.canvas.removeEventListener('webglcontextlost',this._lost);
    this.canvas.removeEventListener('webglcontextrestored',this._restored);
    for(const id of [...this.prepared.keys()])this.release(id);
    this._releaseTargets();this.renderer.dispose();this.renderer.forceContextLoss?.();
  }
}
