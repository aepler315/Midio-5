import { JOURNEY_SURFACE_GLSL } from './JourneyWorld.js';
import { FIRMAMENT_GLSL } from './FirmamentGL.js';

export function journeyUniforms(THREE) {
  return {
    uJourneyTime: { value: 0 }, uJourneyTravel: { value: 0 }, uJourneySeed: { value: 0 },
    uJourneyEnergy: { value: 0 }, uJourneyBass: { value: 0 }, uJourneyMelody: { value: 0 },
    uJourneyPulse: { value: 0 }, uJourneyBands: { value: new Float32Array(7) },
    uSwimmer: { value: new THREE.Vector4() }, uSwimDirection: { value: new THREE.Vector2(1, 0) },
  };
}

const SURFACE_VERT = /* glsl */`
  ${JOURNEY_SURFACE_GLSL}
  uniform float uLayer;
  out vec3 vWorld;
  out vec3 vNormal;
  void main() {
    vWorld = journeySurface(vec2(position.x, uv.y), uLayer);
    vec3 dx=journeySurface(vec2(position.x+8.0,uv.y),uLayer)-vWorld;
    vec3 dz=journeySurface(vec2(position.x,uv.y<.997?uv.y+.003:uv.y-.003),uLayer)-vWorld;
    vNormal=normalize(cross(dz,dx));
    if(vNormal.y<0.0)vNormal=-vNormal;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;
const LIGHTING = /* glsl */`
  uniform vec3 uLightDir, uLightColor, uSkyZenith, uSkyHorizon, uCameraPos;
  uniform float uClipBelow;
  vec3 journeyLight(vec3 albedo, vec3 n, vec3 p) {
    float key = max(0.0, dot(n, uLightDir));
    vec3 fill = vec3(.15,.21,.31) + uSkyHorizon*.55 + uSkyZenith*.55;
    vec3 lit = albedo*(fill*(.7+.3*n.y) + uLightColor*(.22+.78*key));
    float distanceM = length(p-uCameraPos);
    float haze = (1.0-exp(-distanceM*.00013)) * (.65+.35*exp(-p.y*.003));
    lit = mix(lit, uSkyHorizon*.62+vec3(.016,.023,.04), haze);
    return pow(clamp(lit,0.0,1.0),vec3(1.0/2.2));
  }
`;
const SURFACE_FRAG = /* glsl */`
  precision highp float;
  ${LIGHTING}
  uniform float uLayer, uJourneyTravel;
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
  void main() {
    if(vWorld.y<uClipBelow) discard;
    vec3 n=normalize(vNormal);
    vec3 p=vWorld+vec3(uJourneyTravel,0.0,0.0);
    float detail=rockNoise(p);
    float strata=.94+.06*sin(p.y*.065+p.x*.009+sin(p.z*.008));
    vec3 rock=mix(vec3(.095,.12,.17),vec3(.18,.215,.27),detail)*strata;
    float green=smoothstep(.55,.92,n.y)*(1.0-smoothstep(110.0,300.0,p.y));
    vec3 albedo=mix(rock,vec3(.05,.105,.093)*(.7+.5*detail),green);
    float snow=smoothstep(420.0,650.0,p.y+detail*95.0)*smoothstep(.12,.62,n.y);
    albedo=mix(albedo,vec3(.62,.73,.85)*(.85+.15*detail),snow);
    if(uLayer<.5) {
      albedo=mix(vec3(.045,.073,.068),vec3(.105,.14,.105),detail);
      albedo*=.72+.28*smoothstep(0.0,8.0,p.y);
    }
    outColor=vec4(journeyLight(albedo,n,vWorld),1.0);
  }
`;

const TREE_VERT = /* glsl */`
  ${JOURNEY_SURFACE_GLSL}
  in vec3 aTree; // world x, normalized hillside depth, height
  in float aBank;
  out vec3 vWorld;
  out vec3 vNormal;
  void main() {
    float x=mod(aTree.x-uJourneyTravel+4200.0,8400.0)-4200.0;
    vec3 root=journeySurface(vec2(x,aTree.y),aBank);
    vec3 p=position*aTree.z;
    // A quiet continuous breeze; the root and reflection use the same field.
    p.x+=sin(uJourneyTime*.8+aTree.x*.03)*position.y*position.y*1.1;
    vWorld=root+p;
    vNormal=normal;
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
  }
`;
const TREE_FRAG = /* glsl */`
  precision highp float;
  ${LIGHTING}
  in vec3 vWorld, vNormal;
  out vec4 outColor;
  void main(){
    if(vWorld.y<uClipBelow) discard;
    outColor=vec4(journeyLight(vec3(.027,.07,.064),normalize(vNormal),vWorld),1.0);
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
    float nearBank=journeyNearShore(vWorld.x),farBank=journeyFarShore(vWorld.x);
    if(vWorld.z>nearBank || vWorld.z<farBank) discard;
    float t=uJourneyTime;
    vec2 q=vWorld.xz;
    float ripple=sin(q.x*.044+q.y*.061-t*1.6)*sin(q.y*.105-t*.9);
    vec2 delta=q-uSwimmer.xy;
    float behind=-dot(delta,uSwimDirection);
    float across=abs(dot(delta,vec2(-uSwimDirection.y,uSwimDirection.x)));
    float wake=exp(-pow((across-behind*.23)/5.0,2.0))*smoothstep(0.0,14.0,behind)
      *(1.0-smoothstep(25.0,190.0,behind))*uSwimmer.z;
    float rings=sin(length(delta)*.25-t*3.5)*exp(-length(delta)*.024)*uSwimmer.z;
    float slope=.0025+.002*uJourneyBass;
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
    float shore=min(nearBank-vWorld.z,vWorld.z-farBank);
    color+=vec3(.045,.115,.14)*(wake*.22+rings*.025);
    color+=vec3(.035,.075,.086)*exp(-shore*.22)*(.7+.3*sin(q.x*.21-t));
    outColor=vec4(color,1.0);
  }
`;

export function journeyMaterial(THREE,uniforms,kind,layer=0) {
  const shaders={surface:[SURFACE_VERT,SURFACE_FRAG],trees:[TREE_VERT,TREE_FRAG],water:[WATER_VERT,WATER_FRAG]};
  const [vertexShader,fragmentShader]=shaders[kind];
  return new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,
    uniforms:{...uniforms,uLayer:{value:layer}},vertexShader,fragmentShader,
    side:THREE.DoubleSide,depthTest:true,depthWrite:true});
}

/** One indexed grid per range; the shader gives it depth and continuous travel. */
export function journeyGrid(THREE,columns=288,rows=40) {
  const g=new THREE.BufferGeometry(),positions=[],uv=[],indices=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
    positions.push((x/columns-.5)*8400,0,0);uv.push(x/columns,y/rows);
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
  for(const [radius,bottom,top] of [[.25,0,.7],[.19,.27,.9],[.12,.55,1]]){
    for(let i=0;i<5;i++){
      const a=i*Math.PI*2/5,b=(i+1)*Math.PI*2/5;
      positions.push(radius*Math.cos(a),bottom,radius*Math.sin(a),0,top,0,radius*Math.cos(b),bottom,radius*Math.sin(b));
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
