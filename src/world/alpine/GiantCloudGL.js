// A world-space cloud/auroral radiance slice above the valley sea. Terrain's
// shared depth hides its lower banks. The silhouette modulates billows and
// transmitted scene light; there is no character geometry or screen mesh.
import { GIANT_GLSL } from './LandscapeGiants.js';
const VERT = /* glsl */`
  uniform vec3 uSkyGiantCenter[3]; uniform float uGiantSpan[3]; uniform vec3 uGiantRight; uniform int uCloudActor;
  out vec2 vUv; out vec3 vWorld;
  void main(){
    vUv=position.xy+.5;
    vWorld=uSkyGiantCenter[uCloudActor]+(uGiantRight*position.x+vec3(0.0,position.y,0.0))*uGiantSpan[uCloudActor];
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
  }
`;
const FRAG = /* glsl */`
  precision highp float;
  ${GIANT_GLSL}
  uniform int uCloudActor; uniform vec3 uLightColor; uniform vec3 uSkyHorizon; uniform float uAmbientScale;
  in vec2 vUv; in vec3 vWorld; out vec4 outColor;
  float cloudNoise(vec2 p){return .5+.25*sin(p.x+sin(p.y*1.3))+.25*cos(p.y*.7+sin(p.x*.8));}
  void main(){
    float peak=uGiantPeak[uCloudActor];
    float billow=cloudNoise(vWorld.xy*.002+vec2(uGiantTime*.09,-uGiantTime*.06));
    vec2 drift=vec2(sin(vWorld.y*.004+uGiantTime*.08),cos(vWorld.x*.003-uGiantTime*.05))*.018;
    float shape=giantMask(vUv+drift,uCloudActor);
    float veil=smoothstep((1.0-peak)*.85,1.0,billow*.65+.35);
    float a=shape*peak*veil*(.28+billow*.5);
    if(a<.003)discard;
    vec3 light=max(uSkyHorizon*uAmbientScale*.4+uLightColor*.3,vec3(.085,.11,.16));
    vec3 radiance=light*(.65+billow*.9)+vec3(.035,.065,.11)*pow(billow,5.0);
    outColor=vec4(pow(clamp(radiance,0.0,1.0),vec3(1.0/2.2)),a);
  }
`;
export class GiantCloudGL {
  constructor(THREE,shared,actor){
    this.geometry=new THREE.BufferGeometry();
    this.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0]),3));
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0,1,2,0,2,3]),1));
    this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:VERT,fragmentShader:FRAG,
      uniforms:{...shared,uCloudActor:{value:actor}},transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide});
    this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;
    this.scene=new THREE.Scene();this.scene.add(this.mesh);
  }
  dispose(){this.geometry.dispose();this.material.dispose();this.scene.clear();}
}
