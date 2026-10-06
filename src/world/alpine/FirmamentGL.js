import { CONSTELLATION_ART } from './RangeFirmament.js';
export const FIRMAMENT_BYTES=36;
export function firmamentUniforms(THREE) {
  return {
    uFullSky:{value:0},uFirmamentTime:{value:0},uFirmamentSeed:{value:0},
    uFirmamentNight:{value:1},uFirmamentFlash:{value:1},
    uFirmamentBands:{value:new THREE.Vector3(.36,0,0)},
    uFirmamentMotion:{value:new THREE.Vector4()}, // rhythm, bass, melody, spatial motion enabled
    uFirmamentLayers:{value:new THREE.Vector3(1,1,1)},
    uFirmamentBody:{value:new THREE.Vector4(0,1,0,.015)},
    uFirmamentBodyColor:{value:new THREE.Vector3()},
    uFirmamentWeather:{value:new THREE.Vector2()},
    uSkyProjectionInverse:{value:new THREE.Matrix4()},uSkyCameraWorld:{value:new THREE.Matrix4()},
  };
}
const f=n=>Number(n).toFixed(6);
// Bounding each illustrated figure avoids running all of its line distances
// at every pixel. The same generated code executes in the lake and the sky.
const artCode=CONSTELLATION_ART.map((a,index)=>`
  q=(angles-vec2(${f(a.azimuth)},${f(a.altitude)}))/vec2(${f(a.width)},${f(a.height)});
  if(max(abs(q.x),abs(q.y))<0.58){
    float lineDistance=10.0,starDistance=10.0;
    ${a.edges.map(([i,j])=>`lineDistance=min(lineDistance,skySegment(q,vec2(${a.points[i].map(f)}),vec2(${a.points[j].map(f)})));`).join('\n')}
    ${a.points.map(p=>`starDistance=min(starDistance,length(q-vec2(${p.map(f)})));`).join('\n')}
    float line=1.0-smoothstep(0.002,0.002+aa/${f(Math.min(a.width,a.height))},lineDistance);
    float core=exp(-pow(starDistance/max(0.009,aa/${f(Math.min(a.width,a.height))}),2.0));
    float breath=1.0-uFirmamentFlash*(0.14-0.14*sin(uFirmamentTime*0.34+${f(index*1.7)}));
    float trace=uFirmamentFlash*uFirmamentMotion.z*(.5+.5*sin(q.x*6.0+q.y*5.0-uFirmamentTime*1.8+${f(index)}));
    art+=vec3(.22,.33,.49)*line*(.5+.5*breath+.4*trace)+vec3(.7,.83,1.0)*core;
  }`).join('\n');

export const FIRMAMENT_GLSL=/* glsl */`
  uniform float uFullSky;
  uniform float uFirmamentTime;
  uniform float uFirmamentSeed;
  uniform float uFirmamentNight;
  uniform float uFirmamentFlash;
  uniform vec3 uFirmamentBands;
  uniform vec4 uFirmamentMotion;
  uniform vec3 uFirmamentLayers;
  uniform vec4 uFirmamentBody;
  uniform vec3 uFirmamentBodyColor;
  uniform vec2 uFirmamentWeather;
  float skyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+uFirmamentSeed)*43758.5453);}
  float skySegment(vec2 p,vec2 a,vec2 b){vec2 ab=b-a;return length(p-a-ab*clamp(dot(p-a,ab)/max(dot(ab,ab),.000001),0.0,1.0));}
  vec3 starLayer(vec2 angles,vec2 grid,float salt,float density){
    vec2 uv=vec2((angles.x+3.141592654)/6.283185307,(angles.y+1.570796327)/3.141592654)*grid;
    vec2 cell=floor(uv),q=fract(uv);
    float h=skyHash(cell+salt);
    vec2 center=.22+.56*vec2(skyHash(cell+salt+5.7),skyHash(cell+salt+17.3));
    vec2 pixel=max(fwidth(uv),vec2(.01));
    float distancePx=length((q-center)/pixel);
    float bright=pow(skyHash(cell+salt+29.1),9.0);
    float radius=.48+.43*bright;
    float core=exp(-pow(distancePx/radius,2.0)*1.3);
    float halo=exp(-distancePx*1.5)*bright*.22;
    float phase=6.283185307*skyHash(cell+salt+51.7);
    float twinkle=1.0-uFirmamentFlash*(.28+.18*sin(uFirmamentTime*(.8+h*1.6)+phase)*sin(uFirmamentTime*.43+phase));
    vec3 tint=mix(vec3(.58,.76,1.0),vec3(1.0,.83,.63),skyHash(cell+salt+63.1));
    return tint*(core*(.19+.9*bright)+halo)*twinkle*step(h,density);
  }
  vec3 firmamentStars(vec2 angles){
    return starLayer(angles,vec2(1056.0,600.0),2.0,.7)
      +starLayer(angles,vec2(1784.0,912.0),101.0,.46)*.46;
  }
  vec3 constellationArt(vec2 a,float aa){
    // Four illustrated regions surround the world. Neither camera position
    // nor the top of its viewport defines where an illustration ends.
    vec2 angles=vec2(mod(a.x+.65,1.570796327)-.65,a.y),q;
    vec3 art=vec3(0.0);
    ${artCode}
    return art;
  }
  vec3 auroraCurtains(vec2 angles){
    float t=uFirmamentTime;
    vec3 music=uFirmamentMotion.xyz*uFirmamentMotion.w;
    vec3 glow=vec3(0.0);
    for(int i=0;i<3;i++){
      float k=float(i);
      // Fold displacement, not a screen-wide flash: every hit pulls a
      // different part of the same curtain. The lake evaluates it too.
      float flow=angles.x+.022*music.y*sin(angles.x*5.0-t*.9+k)+.026*music.x;
      float hem=.028+k*.075+.028*sin(angles.x*6.0+t*.10+k*2.1)+.014*sin(angles.x*13.0-t*.13+k)
        +.025*music.x*(.5+.5*sin(angles.x*5.0+k))+.02*music.y*sin(angles.x*9.0-t*.85+k)
        +.014*music.z*sin(angles.x*7.0+t*1.1+k);
      float above=angles.y-hem;
      float height=.22+.035*sin(angles.x*4.0+t*.08+k)+.13*music.y+.06*music.z;
      float skirt=smoothstep(-.022,0.012,above);
      float curtain=skirt*exp(-max(0.0,above)/height*3.0);
      float folds=.18+.82*pow(.5+.5*sin(flow*54.0+t*.25+k+sin(flow*11.0-t*.12)),3.0);
      float base=.13+.26*uFirmamentBands.x*(.45+.55*uFirmamentFlash);
      vec3 shade=mix(vec3(.13,.85,.52),vec3(.46,.18,.73),clamp(above/height,0.0,1.0));
      glow+=shade*curtain*(.2+.8*folds)*base;
    }
    return glow;
  }
  vec3 firmamentRadiance(vec3 direction,vec3 zenith,vec3 horizon,bool celestial){
    vec3 d=normalize(direction);
    vec2 angles=vec2(atan(d.x,d.z),asin(clamp(d.y,-1.0,1.0)));
    float skyAbove=smoothstep(-.025,.025,d.y);
    float night=.32+.68*uFirmamentNight;
    vec3 base=mix(horizon,zenith,smoothstep(-.025,.22,d.y));
    float galaxy=exp(-pow((angles.y-.30-.09*sin(angles.x*2.0))/.10,2.0));
    base+=vec3(.004,.005,.009)*galaxy*night;
    float aa=max(.00035,length(fwidth(angles))*.5);
    vec3 stars=firmamentStars(angles)*uFirmamentLayers.x;
    vec3 art=constellationArt(angles,aa)*uFirmamentLayers.y;
    vec3 aurora=auroraCurtains(angles)*uFirmamentLayers.z;
    vec3 color=base+(stars+art+aurora)*night*skyAbove;
    if(celestial){
      float separation=acos(clamp(dot(d,uFirmamentBody.xyz),-1.0,1.0));
      float disc=1.0-smoothstep(uFirmamentBody.w*.92,uFirmamentBody.w*1.08,separation);
      float halo=exp(-separation/max(.001,uFirmamentBody.w)*1.5)*.1;
      color=mix(color,uFirmamentBodyColor,disc)+uFirmamentBodyColor*halo;
    }
    float cloudBand=exp(-pow((angles.y-.047)/.038,2.0));
    float cloud=cloudBand*(.14+.09*sin(angles.x*21.0+uFirmamentTime*.014))*(1.0+.5*sin(angles.x*49.0));
    color=mix(color,horizon*.8,clamp(cloud,0.0,.3));
    return color*(1.0-.6*uFirmamentWeather.x)+vec3(.08,.10,.15)*uFirmamentWeather.y;
  }
`;
const VERT=/* glsl */`
  out vec2 vUv;
  void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.0,1.0);}
`;
const FRAG=/* glsl */`
  precision highp float;
  uniform mat4 uSkyProjectionInverse;
  uniform mat4 uSkyCameraWorld;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  ${FIRMAMENT_GLSL}
  in vec2 vUv;
  out vec4 outColor;
  void main(){
    vec4 local=uSkyProjectionInverse*vec4(vUv*2.0-1.0,1.0,1.0);
    vec3 direction=normalize((uSkyCameraWorld*vec4(local.xyz,0.0)).xyz);
    vec3 radiance=firmamentRadiance(direction,uSkyZenith,uSkyHorizon,false);
    outColor=vec4(pow(clamp(radiance,0.0,1.0),vec3(1.0/2.2)),1.0);
  }
`;
export class FirmamentGL {
  constructor(THREE,uniforms){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,vertexShader:VERT,fragmentShader:FRAG,depthTest:false,depthWrite:false,blending:THREE.NoBlending});
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;
    this.scene=new THREE.Scene();this.scene.add(this.mesh);this.disposed=false;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.mesh.geometry.dispose();this.mesh.material.dispose();this.scene.clear();}
}
