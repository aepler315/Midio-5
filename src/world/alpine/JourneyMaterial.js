import { JOURNEY_SURFACE_GLSL } from './JourneyWorld.js';
import { FIRMAMENT_GLSL } from './FirmamentGL.js';

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
const LIGHTING = /* glsl */`
  uniform vec3 uLightDir, uLightColor, uSkyZenith, uSkyHorizon, uCameraPos;
  uniform float uClipBelow;
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
  vec3 journeyLight(vec3 albedo, vec3 n, vec3 p, float cavity) {
    float key=max(0.0,dot(n,uLightDir))*journeyShadow(p,n);
    float skyFace=.28+.72*max(0.0,dot(n,normalize(vec3(-.45,.85,.3))));
    vec3 fill=vec3(.025,.043,.073)+uSkyHorizon*.32+uSkyZenith*.3;
    vec3 lit=albedo*(fill*skyFace*cavity+uLightColor*key*.85);
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
    vec4 crowns=texture(tCanopy,p.xz/42.0);
    vec3 albedo=mix(rock,vec3(.022,.052,.041)*(.45+.9*crowns.b),green);
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
      albedo*=.72+.28*smoothstep(0.0,8.0,p.y);
    }
    outColor=vec4(journeyLight(albedo,detailNormal,vWorld,cavity),1.0);
  }
`;

const TREE_VERT = /* glsl */`
  ${JOURNEY_SURFACE_GLSL}
  in vec3 aTree; // world x, normalized hillside depth, height
  in float aBank;
  out vec3 vWorld;
  out vec3 vNormal;
  out float vCrown;
  void main() {
    float x=mod(aTree.x-uJourneyTravel+4200.0,8400.0)-4200.0;
    vec3 root=journeySurface(vec2(x,aTree.y),aBank);
    vec3 p=position*aTree.z;
    // A quiet continuous breeze; the root and reflection use the same field.
    p.x+=sin(uJourneyTime*.8+aTree.x*.03)*position.y*position.y*1.1;
    vWorld=root+p;
    vNormal=normal;vCrown=position.y;
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
  }
`;
const TREE_FRAG = /* glsl */`
  precision highp float;
  ${LIGHTING}
  in vec3 vWorld, vNormal;
  in float vCrown;
  out vec4 outColor;
  void main(){
    if(vWorld.y<uClipBelow) discard;
    outColor=vec4(journeyLight(vec3(.027,.07,.064)*(.55+.45*vCrown),normalize(vNormal),vWorld,.8),1.0);
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
  uniform vec3 uCameraPos,uSkyZenith,uSkyHorizon;
  uniform vec4 uSwimmer;
  uniform vec2 uSwimDirection;
  in vec3 vWorld;
  out vec4 outColor;
  void main(){
    float shore=journeyLakeDistance(vWorld.xz);
    if(shore<=0.0)discard;
    float t=uJourneyTime;
    vec2 q=vWorld.xz;
    float ripple=sin(q.x*.044+q.y*.061-t*1.6)*sin(q.y*.105-t*.9);
    vec2 delta=q-uSwimmer.xy;
    float behind=-dot(delta,uSwimDirection);
    float across=abs(dot(delta,vec2(-uSwimDirection.y,uSwimDirection.x)));
    float wake=exp(-pow((across-behind*.23)/5.0,2.0))*smoothstep(0.0,14.0,behind)
      *(1.0-smoothstep(25.0,190.0,behind))*uSwimmer.z;
    float rings=sin(length(delta)*.25-t*3.5)*exp(-length(delta)*.024)*uSwimmer.z;
    float slope=.0035+.003*uJourneyBass;
    vec3 normal=normalize(vec3(slope*sin(q.x*.034+q.y*.082-t*1.3),1.0,
      slope*ripple+.003*(wake+rings)));
    vec3 ray=reflect(normalize(vWorld-uCameraPos),normal);
    vec3 sky=pow(clamp(firmamentRadiance(ray,uSkyZenith,uSkyHorizon,true),0.0,1.0),vec3(1.0/2.2));
    vec4 projected=uMirrorMatrix*vec4(vWorld,1.0);
    vec2 uv=projected.xy/projected.w;
    uv+=vec2(ripple,wake+rings)*.0012;
    float edge=min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y));
    vec4 mirrored=texture(uMirror,clamp(uv,0.0,1.0));
    float valid=smoothstep(0.0,.025,edge)*mirrored.a;
    vec3 reflection=mix(sky,mirrored.rgb/max(mirrored.a,.001),valid);
    float fresnel=.57+.36*pow(1.0-max(0.0,dot(normal,normalize(uCameraPos-vWorld))),3.0);
    vec3 color=mix(vec3(.036,.10,.135),reflection,fresnel);
    color+=vec3(.045,.115,.14)*(wake*.22+rings*.025);
    float shoal=exp(-shore*.04);
    color=mix(color,vec3(.047,.13,.135),shoal*.24);
    color+=vec3(.045,.075,.076)*exp(-shore*.15)*(.55+.45*sin(shore*.5-t*2.1+q.x*.04));
    outColor=vec4(color,1.0);
  }
`;

export function journeyMaterial(THREE,uniforms,kind,layer=0,span=16000) {
  const shaders={surface:[SURFACE_VERT,SURFACE_FRAG],trees:[TREE_VERT,TREE_FRAG],water:[WATER_VERT,WATER_FRAG],
    shadow:[`${JOURNEY_SURFACE_GLSL}\n${GRID_POSITION}\nuniform float uLayer;void main(){float x=uLayer>1.5?position.x:journeyMeshX(uv.x);gl_Position=projectionMatrix*viewMatrix*vec4(journeySurface(vec2(x,uv.y),uLayer),1.0);}`,
      'precision highp float;out vec4 outColor;void main(){outColor=vec4(1.0);}']};
  const [vertexShader,fragmentShader]=shaders[kind];
  return new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,
    uniforms:{...uniforms,uLayer:{value:layer},uGridHalfSpan:{value:span*.5}},vertexShader,fragmentShader,
    side:THREE.DoubleSide,depthTest:true,depthWrite:true});
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

/** Forests share one draw call. Their roots use the same field as the shore. */
export function journeyForest(THREE,uniforms) {
  const geometry=new THREE.InstancedBufferGeometry();
  const positions=[],normals=[];
  for(const [radius,bottom,top] of [[.29,.04,.52],[.25,.19,.67],[.21,.35,.78],
    [.16,.51,.87],[.11,.67,.95],[.065,.82,1]]){
    for(let i=0;i<7;i++){
      const a=i*Math.PI*2/7,b=(i+1)*Math.PI*2/7;
      const edge=angle=>radius*(.88+.16*Math.sin(angle*3+bottom*19));
      positions.push(edge(a)*Math.cos(a),bottom+.025*Math.sin(a*2),edge(a)*Math.sin(a),
        0,top,0,edge(b)*Math.cos(b),bottom+.025*Math.sin(b*2),edge(b)*Math.sin(b));
      const middle=(a+b)/2,n=new THREE.Vector3(Math.cos(middle),radius/(top-bottom),Math.sin(middle)).normalize();
      for(let k=0;k<3;k++)normals.push(n.x,n.y,n.z);
    }
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  const count=1560, trees=new Float32Array(count*3), banks=new Float32Array(count);
  const random=i=>{const n=Math.sin(i*127.1+31.7)*43758.5453;return n-Math.floor(n);};
  for(let i=0;i<count;i++){
    const bank=i<1320?1:0;
    trees.set([(random(i)-.5)*8400,bank? .008+random(i+700)*.18 : .10+random(i+700)*.45,
      (bank?14:15)+random(i+1400)*(bank?21:27)],i*3);
    banks[i]=bank;
  }
  geometry.setAttribute('aTree',new THREE.InstancedBufferAttribute(trees,3));
  geometry.setAttribute('aBank',new THREE.InstancedBufferAttribute(banks,1));
  geometry.instanceCount=count;
  return new THREE.Mesh(geometry,journeyMaterial(THREE,uniforms,'trees'));
}
