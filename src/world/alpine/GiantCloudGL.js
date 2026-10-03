// A world-space cloud/auroral radiance slice above the valley sea. Terrain's
// shared depth hides its lower banks. The silhouette modulates billows and
// transmitted scene light; there is no character geometry or screen mesh.
import { GIANT_GLSL } from './LandscapeGiants.js';
const VERT = /* glsl */`
  uniform vec3 uSkyGiantCenter[3]; uniform float uGiantSpan[3]; uniform vec3 uGiantRight; uniform int uCloudActor; uniform float uSkyGiantSpan;
  out vec2 vUv; out vec3 vWorld;
  void main(){
    vUv=position.xy+.5;
    vWorld=uSkyGiantCenter[uCloudActor]+(uGiantRight*position.x+vec3(0.0,position.y,0.0))*uSkyGiantSpan;
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
  }
`;
const FRAG = /* glsl */`
  precision highp float;
  ${GIANT_GLSL}
  uniform int uCloudActor; uniform vec3 uLightColor; uniform vec3 uSkyHorizon; uniform float uAmbientScale; uniform vec3 uActorColor[3];
  in vec2 vUv; in vec3 vWorld; out vec4 outColor;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
  // Billows in the sheet's own coordinates, drifting slowly upward.
  float billows(vec2 p){float t=uGiantTime;
    return vnoise(p*5.0+vec2(t*.02,-t*.03))*.5+vnoise(p*11.0+vec2(-t*.03,-t*.05))*.3+vnoise(p*23.0-vec2(0.0,t*.08))*.2;}
  void main(){
    float peak=uGiantPeak[uCloudActor];
    float billow=billows(vUv);
    vec2 drift=(vec2(billows(vUv+3.1),billows(vUv+7.7))-.5)*.07;
    // A soft footprint, so the billows (not straight polygon edges) draw
    // the outline.
    vec2 q=vUv+drift; const float R=.035;
    float shape=(giantMask(q,uCloudActor)*2.0+giantMask(q+vec2(R,0.0),uCloudActor)+giantMask(q-vec2(R,0.0),uCloudActor)
      +giantMask(q+vec2(0.0,R),uCloudActor)+giantMask(q-vec2(0.0,R),uCloudActor))/6.0;
    // Cloud eats the figure from its edges inward as the peak passes; at
    // the peak only the frayed rim is open.
    float body=smoothstep(.3,.9,shape*(.3+1.1*billow)-(1.0-peak)*.6);
    // Thin, sky-showing cloud: dense only where the billows pile up, and
    // thinning into the haze where it rises from behind the range.
    float a=body*peak*(.12+.5*smoothstep(.35,.85,billow))*smoothstep(.05,.4,vUv.y);
    if(a<.003)discard;
    vec3 light=max(uSkyHorizon*uAmbientScale*.4+uLightColor*.3,vec3(.085,.11,.16));
    // Crowns catch the key; the undersides stay in the cloud's own shade.
    float crown=smoothstep(.2,1.0,vUv.y)*.35+billow*.75;
    vec3 radiance=light*(.35+crown*.85)+vec3(.035,.065,.11)*pow(billow,4.0);
    // Her own light glows inside the billows, which keeps the figure
    // readable against a dark dawn or dusk sky.
    vec3 own=uActorColor[uCloudActor];
    float ownMax=max(max(own.r,own.g),own.b);
    radiance+=own/max(ownMax,1e-4)*min(ownMax,1.0)*(.08+.2*billow)*shape;
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
