// Midio exists only in the WaterMirror pass. This vertical world-space
// radiance sheet has no object in the normal scene to cast the reflection.
import { GIANT_GLSL } from './LandscapeGiants.js';
const VERT = /* glsl */`
  uniform vec3 uGiantCenter[3]; uniform float uGiantSpan[3]; uniform vec3 uGiantRight;
  out vec2 vUv; out vec3 vWorld;
  void main() {
    vUv=position.xy+.5;
    vWorld=uGiantCenter[0]+uGiantRight*position.x*uGiantSpan[0]+vec3(0.0,vUv.y*uGiantSpan[0],0.0);
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
  }
`;
const FRAG = /* glsl */`
  precision highp float;
  ${GIANT_GLSL}
  uniform vec3 uLightDir; uniform vec3 uLightColor; uniform vec3 uSkyHorizon;
  uniform vec3 uActorColor[3]; uniform float uAmbientScale;
  in vec2 vUv; in vec3 vWorld; out vec4 outColor;
  void main() {
    float shape=giantMask(vUv,0);
    float grain=.5+.5*sin(vWorld.x*.003+sin(vWorld.y*.004+uGiantTime*.1)*1.7);
    float wisps=.5+.5*sin(vWorld.y*.008+vWorld.x*.002+uGiantTime*.16);
    float dissolve=smoothstep((1.0-uGiantPeak[0])*.8,1.0,grain*.35+wisps*.35+.3);
    float a=shape*uGiantPeak[0]*dissolve*.82;
    if(a<.002) discard;
    vec3 normal=normalize(vec3(uGiantRight.z,.25,-uGiantRight.x));
    float key=.25+.75*abs(dot(normal,uLightDir));
    // The same sky and celestial light as the land; a lantern-lit floor
    // preserves the reflection's facets through dark dawn and sunset.
    vec3 light=max(uSkyHorizon*uAmbientScale*.5+uLightColor*key,vec3(.065,.09,.13));
    vec3 color=light*(.7+grain*.75)+uActorColor[0]*.035;
    color+=vec3(.14,.22,.25)*pow(wisps,14.0)*.4;
    outColor=vec4(pow(clamp(color,0.0,1.0),vec3(1.0/2.2)),a);
  }
`;
export class GiantReflectionGL {
  constructor(THREE, shared) {
    const g=this.geometry=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0]),3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0,1,2,0,2,3]),1));
    this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:VERT,fragmentShader:FRAG,uniforms:shared,
      transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide});
    this.mesh=new THREE.Mesh(g,this.material);this.mesh.frustumCulled=false;
    this.scene=new THREE.Scene();this.scene.add(this.mesh);
  }
  dispose(){this.geometry.dispose();this.material.dispose();this.scene.clear();}
}
