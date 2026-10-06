import test from 'node:test';
import assert from 'node:assert/strict';
import * as orbit from '../src/world/alpine/JourneyOrbit.js';

const near=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
test('orbit closes with a continuous tangent and radial altitude',()=>{
  assert.equal(typeof orbit.journeyOrbitPoint,'function');
  const {radiusM:R,circumferenceM:C}=orbit.JOURNEY_ORBIT;
  for(const x of [-C/2,0,147,C/2,5*C+147])for(const z of [-7700,-400,0,6000]){
    const p=orbit.journeyOrbitPoint([x,70,z]);
    near(Math.hypot(p[0],p[1]+R,p[2]),R+70);
    const q=orbit.journeyOrbitPoint([x+C,70,z]);
    p.forEach((v,i)=>near(v,q[i]));
    const b=orbit.journeyOrbitBasis(x,z), c=orbit.journeyOrbitBasis(x+C,z);
    b.right.forEach((v,i)=>near(v,c.right[i]));
    near(b.right.reduce((sum,v,i)=>sum+v*b.up[i],0),0);
    near(Math.hypot(...b.up),1);
  }
});
test('inverse recovers intrinsic height and depth on either side of the rim',()=>{
  for(const x of [-4000,-800,0,1300,4000])for(const z of [-8000,-813,0,7000]){
    const p=[x,137,z],q=orbit.journeyOrbitInverse(orbit.journeyOrbitPoint(p));
    p.forEach((v,i)=>near(v,q[i]));
  }
});
test('actor local basis preserves limb dimensions and follows radial gravity',()=>{
  const v=[4,5,6];
  for(const x of [0,1000,4000])for(const z of [-7700,0,6000]){
    const rotated=orbit.journeyOrbitVector(v,x,z);
    near(Math.hypot(...v),Math.hypot(...rotated));
    const up=orbit.journeyOrbitVector([0,1,0],x,z);
    orbit.journeyOrbitBasis(x,z).up.forEach((n,i)=>near(n,up[i]));
    const point=orbit.journeyOrbitPoint([x,0,z]);
    [point[0],point[1]+orbit.JOURNEY_ORBIT.radiusM,point[2]].forEach((n,i)=>near(n/orbit.JOURNEY_ORBIT.radiusM,up[i]));
  }
});

test('latitude curves the depth axis into one sphere and all longitudes meet at each pole',()=>{
  const {radiusM:R,depthScale}=orbit.JOURNEY_ORBIT,pole=R*Math.PI/2/depthScale;
  for(const sign of [-1,1])for(const x of [-4000,0,2700]){
    const p=orbit.journeyOrbitPoint([x,0,sign*pole]);
    near(p[0],0);near(p[1],-R);near(p[2],sign*R);
  }
  const p=orbit.journeyOrbitPoint([0,0,3000]);
  assert.ok(p[1]<-150,'depth recedes around a curved surface instead of a straight tube');
});

test('spherical GLSL projection, vector transport and radial altitude agree with CPU geometry',()=>{
  const source=orbit.JOURNEY_ORBIT_GLSL.replace(/^\s*#.*$/gm,'').replace(/uniform float uJourneyOrbit;/,'')
    .replace(/\b(?:float|vec3)\s+(journey\w+)\s*\(([^)]*)\)/g,(_,name,args)=>
      `function ${name}(${args.replace(/\b(?:float|vec3)\s+/g,'')})`)
    .replace(/\bconst\s+float\s+/g,'const ').replace(/\b(?:float|vec3)\s+(\w+)/g,'let $1');
  const shader=new Function('uJourneyOrbit',`
    const {sin,cos,hypot}=Math;
    const vec3=(x,y,z)=>Object.assign([x,y,z],{x,y,z});
    const length=p=>hypot(p.x,p.y,p.z);
    const normalize=p=>{const n=length(p);return vec3(p.x/n,p.y/n,p.z/n);};
    ${source}
    return {point:journeyOrbitPoint,vector:journeyOrbitVector,up:journeyOrbitUp,altitude:journeyOrbitAltitude};
  `)(1);
  for(const x of [-5500,0,1270])for(const z of [-7700,0,6500]){
    const intrinsic={x,y:70,z},p=shader.point(intrinsic),cpu=orbit.journeyOrbitPoint([x,70,z]);
    cpu.forEach((value,i)=>near(value,p[i]));near(shader.altitude(p),70);
    shader.up(p).forEach((value,i)=>near(value,orbit.journeyOrbitBasis(x,z).up[i]));
    shader.vector({x:4,y:5,z:6},x,z).forEach((value,i)=>near(value,orbit.journeyOrbitVector([4,5,6],x,z)[i]));
  }
});
