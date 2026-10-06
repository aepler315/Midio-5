// The range shells cover the outside of a shallow planetoid. This closed
// rocky volume occludes its interior, including during full-circle shots.
import { JOURNEY_ORBIT } from './JourneyOrbit.js';
import { JOURNEY_WEATHER_GLSL } from './JourneyWeatherGL.js';

const RADIUS=JOURNEY_ORBIT.radiusM, CORE_RADIUS=RADIUS-8;
export const JOURNEY_CORE_BOUNDS=Object.freeze({
  nearZ:1200*JOURNEY_ORBIT.depthScale,farZ:-7700*JOURNEY_ORBIT.depthScale,frontBulgeM:1300,
});
const {nearZ:NEAR_Z,farZ:FAR_Z}=JOURNEY_CORE_BOUNDS;
const SECTORS=192, RINGS=24, DEPTH_ROWS=8;

// Reuse this vertex stage for the core's depth/shadow material. Rotating
// geometry and its material together keeps rock ridges fixed to the world.
export const JOURNEY_CORE_VERTEX=/* glsl */`
  uniform float uJourneyTravel;
  out vec3 vWorld,vNormal,vRock;
  void main(){
    float a=uJourneyTravel/${RADIUS.toFixed(1)},c=cos(a),s=sin(a);
    vec3 p=position+vec3(0.0,${RADIUS.toFixed(1)},0.0);
    vRock=p;
    vWorld=vec3(c*p.x-s*p.y,s*p.x+c*p.y-${RADIUS.toFixed(1)},p.z);
    vNormal=vec3(c*normal.x-s*normal.y,s*normal.x+c*normal.y,normal.z);
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
  }
`;

const FRAGMENT=/* glsl */`
  precision highp float;
  uniform sampler2D uJourneyShadow;
  uniform mat4 uJourneyShadowMatrix;
  uniform float uJourneyShadowTexel,uClipBelow,uFirmamentTime,uFirmamentSeed;
  uniform vec3 uLightDir,uLightColor,uSkyZenith,uSkyHorizon,uCameraPos;
  uniform vec4 uStorm;
  ${JOURNEY_WEATHER_GLSL}
  in vec3 vWorld,vNormal,vRock;
  out vec4 outColor;
  float shadowAt(vec3 p,vec3 n){
    vec4 projected=uJourneyShadowMatrix*vec4(p+n*4.0,1.0);
    vec3 q=projected.xyz/projected.w;
    if(min(min(q.x,q.y),q.z)<0.0||max(max(q.x,q.y),q.z)>1.0)return 1.0;
    float light=0.0;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      float depth=texture(uJourneyShadow,q.xy+vec2(float(x),float(y))*uJourneyShadowTexel).r;
      light+=smoothstep(q.z-.0008,q.z-.0002,depth);
    }
    return light/9.0;
  }
  // Analytic, crossed waves are continuous in the solid rock coordinates.
  // There are no tiled alpha/height samples or angular/polar texture seams.
  float coreNoise(vec3 p){
    return .52*sin(dot(p,vec3(.79,.41,.53)))
      +.31*sin(dot(p,vec3(1.63,-.87,1.19))+1.8)
      +.17*sin(dot(p,vec3(-2.71,1.31,.67))+4.1);
  }
  vec3 rockBump(vec3 n,float height){
    vec3 dx=dFdx(vWorld),dy=dFdy(vWorld);
    vec3 acrossX=cross(dy,n),acrossY=cross(n,dx);
    float determinant=dot(dx,acrossX);
    vec3 gradient=abs(determinant)>.000001
      ?(acrossX*dFdx(height)+acrossY*dFdy(height))/determinant:vec3(0.0);
    return normalize(n-gradient);
  }
  void main(){
    if(vWorld.y<uClipBelow)discard;
    vec3 n=normalize(vNormal);
    if(!gl_FrontFacing)n=-n;
    vec3 p=vRock+vec3(uFirmamentSeed*31.0,-uFirmamentSeed*19.0,0.0);
    vec3 warp=vec3(coreNoise(p*.0014+vec3(3.1,1.7,4.4)),
      coreNoise(p*.0017+vec3(8.3,2.1,1.9)),coreNoise(p*.0013+vec3(1.7,6.3,2.8)))*130.0;
    vec3 q=p+warp;
    float mass=coreNoise(q*.0032);
    float fold=coreNoise(q*.007+vec3(3.7,-2.3,.8));
    float branch=coreNoise(q*.016+vec3(fold*1.5,-fold*.8,fold*.7));
    float grain=.55*coreNoise(q*.041)+.3*coreNoise(q*.083)+.15*coreNoise(q*.179);
    // The broad dome supplies the form. Low-contrast mineral variation and
    // fine roughness avoid turning noise contours into outlined scales.
    n=rockBump(n,7.0*fold+2.0*branch+.7*grain);
    vec3 albedo=mix(vec3(.17,.185,.205),vec3(.275,.28,.29),clamp(.5+.27*mass+.12*grain,0.0,1.0));
    albedo*=.93+.07*fold;
    albedo*=1.0-.22*uStorm.w;
    float cavity=.9+.1*branch;
    float cover=journeyCloudCover(uLightDir,uFirmamentTime,uFirmamentSeed,uStorm.x,uStorm.z);
    float key=max(0.0,dot(n,uLightDir))*shadowAt(vWorld,n)*(1.0-.7*cover);
    // The moon may sit behind the planet. Broad reflected sky light still
    // reveals the facing cliff, without an emissive rim or painted outline.
    vec3 fill=vec3(.14,.18,.24)+uSkyHorizon*.45+uSkyZenith*.35;
    float facing=.55+.45*max(0.0,dot(n,normalize(vec3(-.5,.7,.75))));
    vec3 light=fill*facing*cavity*(1.0-.48*uStorm.x)
      +uLightColor*key*(.85+.3*uStorm.z)+vec3(.48,.57,.75)*uStorm.y*.45;
    vec3 color=albedo*light;
    vec3 halfRay=normalize(normalize(uCameraPos-vWorld)+uLightDir);
    color+=uLightColor*pow(max(0.0,dot(n,halfRay)),52.0)*uStorm.w*.025*key;
    outColor=vec4(pow(clamp(color,0.0,1.0),vec3(1.0/2.2)),1.0);
  }
`;

/** One watertight indexed mesh; < 0.4 MiB of vertex/index storage. */
export function journeyCore(THREE,uniforms){
  const positions=[],indices=[];
  const point=(radius,angle,z)=>{
    const index=positions.length/3;
    positions.push(radius*Math.sin(angle),radius*Math.cos(angle)-RADIUS,z);
    return index;
  };
  const rockNoise=(x,y)=>.52*Math.sin(.79*x+.41*y)
    +.31*Math.sin(1.63*x-.87*y+1.8)+.17*Math.sin(-2.71*x+1.31*y+4.1);
  const capRelief=(x,y,q,near)=>{
    const macro=rockNoise(x*.0018,y*.0018);
    const fold=rockNoise(x*.0037+macro*.8,y*.0037-macro*.5);
    const ridge=1-Math.sqrt(fold*fold+.02);
    const eroded=rockNoise(x*.006+fold*.7,y*.006-macro*.6);
    // Every coefficient in rockNoise sums to one, so this front profile is
    // bounded by 1195*sqrt(1-q²), inside the exported 1300 m clearance dome.
    if(near)return Math.sqrt(Math.max(0,1-q*q))*(1100+60*macro+35*eroded);
    return (1-q*q)*(180+90*(1+macro)+90*ridge+55*eroded);
  };
  for(const near of [true,false]){
    const base=positions.length/3,edgeZ=near?NEAR_Z:FAR_Z,sign=near?1:-1;
    point(0,0,edgeZ+sign*capRelief(0,0,0,near));
    for(let ring=1;ring<=RINGS;ring++){
      // Uniform ellipse-angle steps retain smooth normals at the steep rim.
      const q=near?Math.sin(ring/RINGS*Math.PI*.5):ring/RINGS;
      for(let sector=0;sector<SECTORS;sector++){
        const angle=sector/SECTORS*Math.PI*2;
        const x=CORE_RADIUS*q*Math.sin(angle),y=CORE_RADIUS*q*Math.cos(angle);
        const relief=capRelief(x,y,q,near);
        point(CORE_RADIUS*q,angle,edgeZ+sign*relief);
      }
    }
    const triangle=(a,b,c)=>near?indices.push(a,c,b):indices.push(a,b,c);
    for(let sector=0;sector<SECTORS;sector++){
      const next=(sector+1)%SECTORS;
      triangle(base,base+1+sector,base+1+next);
      for(let ring=1;ring<RINGS;ring++){
        const a=base+1+(ring-1)*SECTORS+sector,b=base+1+(ring-1)*SECTORS+next;
        const c=a+SECTORS,d=b+SECTORS;
        triangle(a,c,b);triangle(b,c,d);
      }
    }
  }
  const side=positions.length/3;
  for(let row=0;row<=DEPTH_ROWS;row++)for(let sector=0;sector<SECTORS;sector++){
    point(CORE_RADIUS,sector/SECTORS*Math.PI*2,NEAR_Z+(FAR_Z-NEAR_Z)*row/DEPTH_ROWS);
  }
  for(let row=0;row<DEPTH_ROWS;row++)for(let sector=0;sector<SECTORS;sector++){
    const next=(sector+1)%SECTORS;
    const a=side+row*SECTORS+sector,b=side+row*SECTORS+next,c=a+SECTORS,d=b+SECTORS;
    indices.push(a,b,c,b,d,c);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,
    vertexShader:JOURNEY_CORE_VERTEX,fragmentShader:FRAGMENT,
    side:THREE.DoubleSide,depthTest:true,depthWrite:true});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.frustumCulled=false;
  return mesh;
}
