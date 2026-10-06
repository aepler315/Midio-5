import { JOURNEY_SURFACE_GLSL } from './JourneyWorld.js';
import { FIRMAMENT_GLSL } from './FirmamentGL.js';
import { JOURNEY_WEATHER_GLSL } from './JourneyWeatherGL.js';
export { sampleJourneyCloud } from './JourneyWeatherGL.js';

export function journeyUniforms(THREE) {
  return {
    uJourneyTime: { value: 0 }, uJourneyTravel: { value: 0 }, uJourneySeed: { value: 0 },
    uJourneyEnergy: { value: 0 }, uJourneyBass: { value: 0 }, uJourneyMelody: { value: 0 },
    uJourneyPulse: { value: 0 }, uJourneyLake: { value: new THREE.Vector2() }, uJourneyBands: { value: new Float32Array(7) },
    uSwimmer: { value: new THREE.Vector4() }, uSwimDirection: { value: new THREE.Vector2(1, 0) },
    uJourneyShadow: { value: null }, uJourneyShadowMatrix: { value: new THREE.Matrix4() },
    uJourneyShadowTexel: { value: 1 / 1024 },
  };
}

// Both shoreline grids place exact vertices on the moving lake tips. The
// middle 5/8 of their columns sample the closed basin densely; outer columns
// fan out over dry land. This removes the moving holes caused by a fixed
// grid interpolating across the analytic shoreline's curved endpoints.
export function journeyGridX(unitX, lake, span=16000) {
  const p=unitX*2-1;
  if(Math.abs(p)<=.625)return lake.centerX+lake.halfWidthM*p/.625;
  const tip=lake.centerX+Math.sign(p)*lake.halfWidthM;
  const outer=(Math.abs(p)-.625)/.375;
  return tip+(Math.sign(p)*span*.5-tip)*outer*outer;
}
const GRID_POSITION = /* glsl */`
  uniform vec2 uJourneyLake;
  uniform float uGridHalfSpan;
  float journeyMeshX(float unitX){
    float p=unitX*2.0-1.0;
    if(abs(p)<=.625)return uJourneyLake.x+uJourneyLake.y*p/.625;
    float tip=uJourneyLake.x+sign(p)*uJourneyLake.y;
    float outer=(abs(p)-.625)/.375;
    return mix(tip,sign(p)*uGridHalfSpan,outer*outer);
  }
`;

const SURFACE_VERT = /* glsl */`
  ${JOURNEY_SURFACE_GLSL}
  ${GRID_POSITION}
  uniform float uLayer;
  out vec3 vWorld;
  out vec3 vNormal;
  void main() {
    float x=uLayer>1.5?position.x:journeyMeshX(uv.x);
    vWorld = journeySurface(vec2(x, uv.y), uLayer);
    vec3 dx=journeySurface(vec2(x+8.0,uv.y),uLayer)-vWorld;
    vec3 dz=journeySurface(vec2(x,uv.y<.997?uv.y+.003:uv.y-.003),uLayer)-vWorld;
    vNormal=normalize(cross(dz,dx));
    if(vNormal.y<0.0)vNormal=-vNormal;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;
const WATER_F0=.0204, WATER_DEPTH_SCALE=.095, WATER_ABSORPTION=.36;
/** CPU optics twin uses the shader constants, for contact/depth verification. */
export function journeyWaterOptics(cosine,shoreDistance) {
  const mu=Math.max(0,Math.min(1,Number.isFinite(cosine)?cosine:0));
  const shore=Math.max(0,Number.isFinite(shoreDistance)?shoreDistance:0);
  const depthM=Math.min(14,.12+shore*WATER_DEPTH_SCALE);
  return {fresnel:WATER_F0+(1-WATER_F0)*(1-mu)**5,depthM,transmission:Math.exp(-depthM*WATER_ABSORPTION)};
}

const JOURNEY_SHADOW_GLSL=/* glsl */`
  uniform sampler2D uJourneyShadow;
  uniform mat4 uJourneyShadowMatrix;
  uniform float uJourneyShadowTexel;
  float journeyShadow(vec3 p,vec3 n){
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
`;
const JOURNEY_IRRADIANCE_GLSL=/* glsl */`
  vec3 journeyIrradiance(vec3 n,vec3 p,float cavity,vec3 ambientFloor){
    float cover=journeyCloudCover(uLightDir,uFirmamentTime,uFirmamentSeed,uStorm.x,uStorm.z);
    float key=max(0.0,dot(n,uLightDir))*journeyShadow(p,n)*(1.0-.7*cover);
    float skyFace=.28+.72*max(0.0,dot(n,normalize(vec3(-.45,.85,.3))));
    vec3 fill=ambientFloor+uSkyHorizon*.32+uSkyZenith*.3;
    vec3 irradiance=fill*skyFace*cavity*(1.0-.48*uStorm.x)+uLightColor*key*(.85+.3*uStorm.z);
    return irradiance+vec3(.48,.57,.75)*uStorm.y*(.45+.55*max(n.y,0.0));
  }
`;

const LIGHTING = /* glsl */`
  uniform vec3 uLightDir, uLightColor, uSkyZenith, uSkyHorizon, uCameraPos;
  uniform float uClipBelow;
  uniform vec4 uStorm;
  uniform float uFirmamentTime,uFirmamentSeed;
  ${JOURNEY_WEATHER_GLSL}
  ${JOURNEY_SHADOW_GLSL}
  ${JOURNEY_IRRADIANCE_GLSL}
  vec3 journeyLight(vec3 albedo, vec3 n, vec3 p, float cavity) {
    albedo*=1.0-uStorm.w*.22;
    vec3 lit=albedo*journeyIrradiance(n,p,cavity,vec3(.025,.043,.073));
    vec3 halfRay=normalize(normalize(uCameraPos-p)+uLightDir);
    float wetSheen=pow(max(0.0,dot(n,halfRay)),64.0)*uStorm.w;
    lit+=uLightColor*wetSheen*(.025+.09*uStorm.z)*journeyShadow(p,n);
    float distanceM = length(p-uCameraPos);
    float haze=(1.0-exp(-distanceM*.000055))*(.25+.75*exp(-p.y*.002));
    lit=mix(lit,uSkyHorizon*.20+vec3(.003,.007,.014),haze);
    return pow(clamp(lit,0.0,1.0),vec3(1.0/2.2));
  }
`;
const SURFACE_FRAG = /* glsl */`
  precision highp float;
  ${LIGHTING}
  uniform float uLayer, uJourneyTravel;
  uniform sampler2D tRock,tRockNear,tCanopy,tSnow;
  in vec3 vWorld, vNormal;
  out vec4 outColor;
  float rockHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float rockGrain(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(rockHash(i),rockHash(i+vec2(1,0)),f.x),
      mix(rockHash(i+vec2(0,1)),rockHash(i+vec2(1,1)),f.x),f.y);
  }
  float rockNoise(vec3 p) {
    vec2 q=p.xz+vec2(p.y*.8,p.y*.3);
    return .6*rockGrain(q*.012)+.28*rockGrain(q*.035)+.12*rockGrain(q*.09);
  }
  // The retained cliff pack carries normal, roughness and height evidence.
  // Stretch its side projections vertically into flutes and gullies, then
  // combine unrelated scales so the distant faces never read as tiles.
  vec4 cliffSample(sampler2D tex,vec3 p,vec3 n,float scale,float angle,float rib){
    vec3 w=pow(abs(n),vec3(4.0));w/=max(.001,w.x+w.y+w.z);
    mat2 r=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
    vec4 x=texture(tex,r*vec2(p.z,p.y*rib)/scale);
    vec4 y=texture(tex,r*p.xz/scale);
    vec4 z=texture(tex,r*vec2(p.x,p.y*rib)/scale);
    vec2 nx=x.rg*2.0-1.0,ny=y.rg*2.0-1.0,nz=z.rg*2.0-1.0;
    vec3 dn=w.x*vec3(0,nx.y,nx.x)+w.y*vec3(ny.x,0,ny.y)+w.z*vec3(nz.x,nz.y,0);
    return vec4(dn,w.x*x.a+w.y*y.a+w.z*z.a);
  }
  void main() {
    if(vWorld.y<uClipBelow) discard;
    vec3 n=normalize(vNormal);
    vec3 p=vWorld+vec3(uJourneyTravel,0.0,0.0);
    vec4 broad=cliffSample(tRock,p,n,210.0,.19,.44);
    vec4 fine=cliffSample(tRockNear,p,n,54.0,.67,.77);
    float detail=rockNoise(p),relief=.65*broad.a+.35*fine.a;
    vec3 detailNormal=normalize(n+(broad.xyz*.85+fine.xyz*.42)*(1.0-.45*n.y));
    float fracture=smoothstep(.3,.73,relief);
    vec3 rock=mix(vec3(.026,.038,.062),vec3(.24,.255,.29),fracture);
    rock*=.8+.2*detail;
    float green=smoothstep(.45,.88,n.y)*(1.0-smoothstep(160.0,480.0,p.y));
    // Ground cover is a broad warped field, not a tiled tree silhouette.
    vec2 coverQ=p.xz*.0031;
    vec2 warp=vec2(rockGrain(coverQ*.61+vec2(9.3,3.7)),rockGrain(coverQ*.73+vec2(1.9,8.1)))*2.4;
    float cover=.72*rockGrain(coverQ+warp)+.28*rockGrain(coverQ*2.17-warp);
    vec3 albedo=mix(rock,mix(vec3(.019,.039,.029),vec3(.034,.064,.045),cover),green);
    float snowLine=uLayer>1.5?650.0:480.0;
    float deposition=smoothstep(.08,.58,n.y+(.48-relief)*.7);
    float snow=smoothstep(snowLine-160.0,snowLine+380.0,p.y+(detail-.5)*190.0)*deposition;
    // Narrow remnants in high gullies suggest immense broken walls, with
    // bare ribs crossing snow instead of a smooth white cap.
    snow*=smoothstep(.29,.55,.72-relief*.72+fine.a*.28);
    vec4 frost=texture(tSnow,p.xz/48.0);
    albedo=mix(albedo,vec3(.70,.77,.84)*(.82+.18*frost.a),snow);
    float cavity=.32+.68*smoothstep(.15,.65,relief);
    detailNormal=normalize(mix(detailNormal,n,snow*.65));
    if(uLayer<.5) {
      albedo=mix(vec3(.045,.073,.068),vec3(.105,.14,.105),detail);
      // Low damp sediments are dark patches, without tracing a luminous ring.
      float damp=(1.0-smoothstep(.3,5.0,p.y))*(.45+.55*rockGrain(p.xz*.018));
      albedo=mix(albedo,vec3(.032,.043,.044),damp*.7);
      cavity=.62+.28*detail;
    }
    outColor=vec4(journeyLight(albedo,detailNormal,vWorld,cavity),1.0);
  }
`;

const TREE_VERT = /* glsl */`
  ${JOURNEY_SURFACE_GLSL}
  uniform vec4 uStorm;
  in vec3 aTree; // world x, normalized hillside depth, height
  in float aBank;
  in vec4 aShape; // radial scale, crown fullness, lean, color variation
  in float aPart;
  out vec3 vWorld;
  out vec3 vNormal;
  out float vCrown;
  out float vTint;
  void main() {
    float x=mod(aTree.x-uJourneyTravel+4200.0,8400.0)-4200.0;
    vec3 root=journeySurface(vec2(x,aTree.y),aBank);
    float fullness=1.0+(aShape.y-1.0)*(1.0-position.y);
    vec3 p=position;
    p.xz*=aShape.x*fullness;
    p.x+=aShape.z*p.y*p.y;
    p*=aTree.z;
    float breeze=sin(uJourneyTime*.71+aTree.x*.03)+.35*sin(uJourneyTime*1.13+aTree.x*.017);
    p.x+=breeze*position.y*position.y*(.55+1.8*uStorm.x);
    vWorld=root+p;
    vNormal=normal;vCrown=aPart>0.5?position.y:-1.0;vTint=aShape.w;
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
  }
`;
const TREE_FRAG = /* glsl */`
  precision highp float;
  ${LIGHTING}
  in vec3 vWorld, vNormal;
  in float vCrown,vTint;
  out vec4 outColor;
  void main(){
    if(vWorld.y<uClipBelow) discard;
    // Actual deformed facet normals keep broad, narrow and leaning crowns lit correctly.
    vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
    if(dot(n,vNormal)<0.0)n=-n;
    vec3 canopy=mix(vec3(.020,.044,.031),vec3(.051,.085,.063),vTint);
    vec3 albedo=vCrown<0.0?vec3(.066,.049,.033):canopy*(.68+.32*vCrown);
    outColor=vec4(journeyLight(albedo,n,vWorld,.72),1.0);
  }
`;

const DRESSING_VERT=/* glsl */`
  ${JOURNEY_SURFACE_GLSL}
  uniform vec4 uStorm;
  in vec3 aTree;
  in float aBank,aKind,aPart;
  in vec4 aShape;
  out vec3 vWorld,vNormal;
  out float vKind,vTint;
  void main(){
    float x=mod(aTree.x-uJourneyTravel+4200.0,8400.0)-4200.0;
    vec3 root=journeySurface(vec2(x,aTree.y),aBank);
    vec3 p=abs(aPart-aKind)<.5?position:vec3(0.0);
    p*=vec3(aShape.x,aShape.y,aShape.z)*aTree.z;
    if(aKind>.5)p.x+=sin(uJourneyTime*.9+aTree.x*.033)*position.y*position.y*(.06+.22*uStorm.x);
    float c=cos(aShape.w),s=sin(aShape.w);
    p.xz=mat2(c,-s,s,c)*p.xz;
    vWorld=root+p;vNormal=normal;vKind=aKind;vTint=fract(aShape.w*.7);
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
  }
`;
const DRESSING_FRAG=/* glsl */`
  precision highp float;
  ${LIGHTING}
  in vec3 vWorld,vNormal;
  in float vKind,vTint;
  out vec4 outColor;
  void main(){
    if(vWorld.y<uClipBelow)discard;
    vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
    if(!gl_FrontFacing)n=-n;
    vec3 stone=mix(vec3(.082,.088,.086),vec3(.19,.18,.155),vTint);
    vec3 reed=mix(vec3(.058,.077,.040),vec3(.16,.14,.072),vTint);
    outColor=vec4(journeyLight(mix(stone,reed,vKind),n,vWorld,.65),1.0);
  }
`;

const WATER_VERT = /* glsl */`
  out vec3 vWorld;
  void main(){vWorld=position;gl_Position=projectionMatrix*viewMatrix*vec4(position,1.0);}
`;
const WATER_FRAG = /* glsl */`
  precision highp float;
  ${JOURNEY_SURFACE_GLSL}
  ${FIRMAMENT_GLSL}
  uniform sampler2D uMirror;
  uniform mat4 uMirrorMatrix;
  uniform vec3 uCameraPos,uSkyZenith,uSkyHorizon,uLightDir,uLightColor;
  uniform vec4 uSwimmer;
  uniform vec2 uSwimDirection;
  uniform vec4 uStorm;
  ${JOURNEY_SHADOW_GLSL}
  ${JOURNEY_IRRADIANCE_GLSL}
  in vec3 vWorld;
  out vec4 outColor;
  void main(){
    float shore=journeyLakeDistance(vWorld.xz);
    // Terrain edges rasterize per MSAA sample, while this analytic mask is
    // evaluated at the fragment center. Cover the subpixel chord/AA gap
    // beneath the depth-writing bank so compositor sky cannot trace a rim.
    // This support never changes the CPU shoreline or visible land contact.
    // At a closed tip the outside shore derivative can flatten even though
    // the pixel footprint crosses the steep bank, so retain its x/z extent.
    vec2 footprint=fwidth(vWorld.xz);
    float support=.55+max(fwidth(shore),4.0*footprint.x+footprint.y);
    if(shore<-support)discard;
    shore=max(0.0,shore);
    float t=uJourneyTime;
    vec2 q=vWorld.xz;
    vec2 worldQ=q+vec2(uJourneyTravel,0.0);
    // Smooth irregular wind envelopes break up the mirror in patches.
    float wind=smoothstep(-.45,.6,journeyNoise(worldQ.x*.008+t*.018,q.y*.009-t*.013));
    wind=(.12+.88*wind)*(.65+.35*uStorm.x);
    float ripple=sin(q.x*.044+q.y*.061-t*1.6)*sin(q.y*.105-t*.9);
    float crossWave=sin(q.x*.073-q.y*.029-t*.83);
    vec2 delta=q-uSwimmer.xy;
    float behind=-dot(delta,uSwimDirection);
    float across=abs(dot(delta,vec2(-uSwimDirection.y,uSwimDirection.x)));
    float wake=exp(-pow((across-behind*.23)/5.0,2.0))*smoothstep(0.0,14.0,behind)
      *(1.0-smoothstep(25.0,190.0,behind))*uSwimmer.z;
    float rings=sin(length(delta)*.25-t*3.5)*exp(-length(delta)*.024)*uSwimmer.z;
    float slope=(.0011+.0045*wind+.002*uJourneyBass)*smoothstep(0.0,9.0,shore);
    vec3 normal=normalize(vec3(slope*(sin(q.x*.034+q.y*.082-t*1.3)+.35*crossWave),1.0,
      slope*ripple+.003*(wake+rings)));
    vec3 ray=reflect(normalize(vWorld-uCameraPos),normal);
    vec3 sky=clamp(firmamentRadiance(ray,uSkyZenith,uSkyHorizon,true),0.0,1.0);
    vec4 projected=uMirrorMatrix*vec4(vWorld,1.0);
    vec2 uv=projected.xy/projected.w;
    // Project a small world-space normal displacement; division by w scales
    // distortion with perspective rather than assigning a screen-space wave.
    vec4 displaced=uMirrorMatrix*vec4(vWorld+vec3(normal.x,0.0,normal.z)*24.0,1.0);
    uv=displaced.xy/max(displaced.w,.001);
    float edge=min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y));
    vec4 mirrored=texture(uMirror,clamp(uv,0.0,1.0));
    float valid=smoothstep(0.0,.025,edge)*mirrored.a*step(.001,projected.w);
    vec3 reflection=mix(sky,pow(mirrored.rgb/max(mirrored.a,.001),vec3(2.2)),valid);
    float mu=max(0.0,dot(normal,normalize(uCameraPos-vWorld)));
    float fresnel=${WATER_F0}+${1-WATER_F0}*pow(1.0-mu,5.0);
    float depthM=min(14.0,.12+shore*${WATER_DEPTH_SCALE});
    float transmission=exp(-depthM*${WATER_ABSORPTION});
    float sediment=.5+.5*journeyNoise(worldQ.x*.033,q.y*.027);
    vec3 bed=mix(vec3(.073,.090,.080),vec3(.12,.13,.103),sediment);
    vec3 body=mix(vec3(.009,.034,.045),bed,transmission);
    // Absorption coefficients describe material, not emitted light. The bed
    // and volume receive the bank's actual sky/key/cloud/shadow illumination.
    // Reflection is already incoming radiance and must stay unattenuated.
    vec3 waterLight=journeyIrradiance(vec3(0.0,1.0,0.0),vWorld,.82,vec3(0.0));
    body*=waterLight;
    vec3 color=mix(body,reflection,fresnel);
    color+=vec3(.027,.057,.061)*waterLight*wake*.13;
    outColor=vec4(pow(clamp(color,0.0,1.0),vec3(1.0/2.2)),1.0);
  }
`;

export function journeyMaterial(THREE,uniforms,kind,layer=0,span=16000) {
  const shaders={surface:[SURFACE_VERT,SURFACE_FRAG],trees:[TREE_VERT,TREE_FRAG],dressing:[DRESSING_VERT,DRESSING_FRAG],water:[WATER_VERT,WATER_FRAG],
    shadow:[`${JOURNEY_SURFACE_GLSL}\n${GRID_POSITION}\nuniform float uLayer;void main(){float x=uLayer>1.5?position.x:journeyMeshX(uv.x);gl_Position=projectionMatrix*viewMatrix*vec4(journeySurface(vec2(x,uv.y),uLayer),1.0);}`,
      'precision highp float;out vec4 outColor;void main(){outColor=vec4(1.0);}']};
  const [vertexShader,fragmentShader]=shaders[kind];
  return new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,
    uniforms:{...uniforms,uLayer:{value:layer},uGridHalfSpan:{value:span*.5}},vertexShader,fragmentShader,
    side:THREE.DoubleSide,depthTest:true,depthWrite:true,
    // Resolve coplanar shoreline samples in favor of the bank's depth.
    polygonOffset:kind==='water',polygonOffsetFactor:1,polygonOffsetUnits:1});
}

/** One indexed grid per range; the shader gives it depth and continuous travel. */
export function journeyGrid(THREE,columns=416,rows=56,span=16000) {
  const g=new THREE.BufferGeometry(),positions=[],uv=[],indices=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
    const u=x/columns*2-1;
    positions.push(span*.5*(.4*u+.6*u*u*u),0,0);uv.push(x/columns,y/rows);
  }
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const a=y*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);
  return g;
}

export function journeyWaterGeometry(THREE){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-4200,0,800,4200,0,800,-4200,0,-1500,4200,0,-1500],3));
  g.setIndex([0,1,2,2,1,3]);return g;
}

const habitatRandom=i=>{const n=Math.sin(i*127.1+31.7)*43758.5453;return n-Math.floor(n);};

function habitatGeometry(THREE,triangles) {
  const geometry=new THREE.InstancedBufferGeometry(),positions=[],normals=[],parts=[];
  for(const {points,part} of triangles){
    const a=new THREE.Vector3(...points[0]),b=new THREE.Vector3(...points[1]),c=new THREE.Vector3(...points[2]);
    const n=b.sub(a).cross(c.sub(a)).normalize();
    for(const point of points){positions.push(...point);normals.push(n.x,n.y,n.z);parts.push(part);}
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('aPart',new THREE.Float32BufferAttribute(parts,1));
  return geometry;
}

/** Forty-eight compact stands, with open ground between, share one draw call. */
export function journeyForest(THREE,uniforms) {
  const triangles=[];
  for(const [radius,bottom,top] of [[.28,.10,.52],[.25,.25,.67],[.20,.42,.80],
    [.15,.58,.90],[.10,.72,.97],[.055,.86,1]]){
    for(let i=0;i<7;i++){
      const a=i*Math.PI*2/7,b=(i+1)*Math.PI*2/7;
      const edge=angle=>radius*(.88+.16*Math.sin(angle*3+bottom*19));
      triangles.push({part:1,points:[[edge(a)*Math.cos(a),bottom+.018*Math.sin(a*2),edge(a)*Math.sin(a)],
        [.012*Math.sin(bottom*18),top,0],[edge(b)*Math.cos(b),bottom+.018*Math.sin(b*2),edge(b)*Math.sin(b)]]});
    }
  }
  for(let i=0;i<5;i++){
    const a=i*Math.PI*2/5,b=(i+1)*Math.PI*2/5;
    const p=(angle,y)=>[.018*Math.cos(angle),y,.018*Math.sin(angle)];
    triangles.push({part:0,points:[p(a,0),p(a,.26),p(b,0)]},
      {part:0,points:[p(b,0),p(a,.26),p(b,.26)]});
  }
  const geometry=habitatGeometry(THREE,triangles);
  const count=1200,trees=new Float32Array(count*3),banks=new Float32Array(count),
    shapes=new Float32Array(count*4),clusters=new Float32Array(count);
  for(let i=0;i<count;i++){
    const cluster=Math.floor(i/25),bank=cluster<40?1:0;
    const centerX=-3970+7940*(cluster%(bank?40:8))/(bank?39:7);
    const centerDepth=bank?.045+habitatRandom(cluster+3600)*.095:.11+habitatRandom(cluster+3600)*.23;
    trees.set([centerX+(habitatRandom(i)-.5)*330,
      centerDepth+(habitatRandom(i+700)-.5)*(bank?.054:.1),
      (bank?12:15)+habitatRandom(i+1400)*(bank?24:25)],i*3);
    banks[i]=bank;clusters[i]=cluster;
    shapes.set([.62+habitatRandom(i+2100)*.74,.68+habitatRandom(i+2400)*.7,
      (habitatRandom(i+2800)-.5)*.17,habitatRandom(i+3200)],i*4);
  }
  geometry.setAttribute('aTree',new THREE.InstancedBufferAttribute(trees,3));
  geometry.setAttribute('aBank',new THREE.InstancedBufferAttribute(banks,1));
  geometry.setAttribute('aShape',new THREE.InstancedBufferAttribute(shapes,4));
  geometry.setAttribute('aCluster',new THREE.InstancedBufferAttribute(clusters,1));
  geometry.instanceCount=count;
  return new THREE.Mesh(geometry,journeyMaterial(THREE,uniforms,'trees'));
}

/** One bounded detail pass: dark shoreline stones and three-blade reed clumps. */
export function journeyDressing(THREE,uniforms) {
  const triangles=[];
  for(let i=0;i<7;i++){
    const a=i*Math.PI*2/7,b=(i+1)*Math.PI*2/7;
    const ring=angle=>[.65*Math.cos(angle),.14+.07*Math.sin(angle*3),.65*Math.sin(angle)];
    triangles.push({part:0,points:[ring(a),[.06,.62,-.07],ring(b)]},
      {part:0,points:[ring(b),[0,.02,0],ring(a)]});
  }
  for(let i=0;i<3;i++){
    const x=(i-1)*.15,z=.13*Math.sin(i*4),height=.72+.14*Math.sin(i*2);
    triangles.push({part:1,points:[[x-.025,0,z],[x+.025,0,z],[x+.07,height,z+.07]]},
      {part:1,points:[[x,0,z-.025],[x,0,z+.025],[x+.07,height,z+.07]]});
  }
  const geometry=habitatGeometry(THREE,triangles),count=416;
  const trees=new Float32Array(count*3),banks=new Float32Array(count),kinds=new Float32Array(count),shapes=new Float32Array(count*4);
  for(let i=0;i<count;i++){
    const cluster=Math.floor(i/8),bank=cluster<26?0:1;
    const center=-3980+(cluster%26)/25*7960;
    const kind=i%8<5?0:1;
    trees.set([center+(habitatRandom(i+4500)-.5)*125,.004+habitatRandom(cluster+4900)*.025+habitatRandom(i+5100)*.008,
      kind?2.4+habitatRandom(i+5300)*3.4:1.7+habitatRandom(i+5300)*4.8],i*3);
    banks[i]=bank;kinds[i]=kind;
    shapes.set([.75+habitatRandom(i+5700)*.8,.65+habitatRandom(i+5900)*.55,
      .65+habitatRandom(i+6100)*.65,habitatRandom(i+6300)*Math.PI*2],i*4);
  }
  geometry.setAttribute('aTree',new THREE.InstancedBufferAttribute(trees,3));
  geometry.setAttribute('aBank',new THREE.InstancedBufferAttribute(banks,1));
  geometry.setAttribute('aKind',new THREE.InstancedBufferAttribute(kinds,1));
  geometry.setAttribute('aShape',new THREE.InstancedBufferAttribute(shapes,4));
  geometry.instanceCount=count;
  return new THREE.Mesh(geometry,journeyMaterial(THREE,uniforms,'dressing'));
}
