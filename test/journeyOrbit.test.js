import test from 'node:test';
import assert from 'node:assert/strict';
import * as orbit from '../src/world/alpine/JourneyOrbit.js';

const near=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
test('orbit closes with a continuous tangent and radial altitude',()=>{
  assert.equal(typeof orbit.journeyOrbitPoint,'function');
  const {radiusM:R,circumferenceM:C}=orbit.JOURNEY_ORBIT;
  for(const x of [-C/2,0,147,C/2,5*C+147]){
    const p=orbit.journeyOrbitPoint([x,70,-400]);
    near(Math.hypot(p[0],p[1]+R),R+70);
    const q=orbit.journeyOrbitPoint([x+C,70,-400]);
    p.forEach((v,i)=>near(v,q[i]));
    const b=orbit.journeyOrbitBasis(x), c=orbit.journeyOrbitBasis(x+C);
    b.right.forEach((v,i)=>near(v,c.right[i]));
    near(b.right.reduce((sum,v,i)=>sum+v*b.up[i],0),0);
    near(Math.hypot(...b.up),1);
  }
});
test('inverse recovers intrinsic height and depth on either side of the rim',()=>{
  for(const x of [-4000,-800,0,1300,4000]){
    const p=[x,137,-813],q=orbit.journeyOrbitInverse(orbit.journeyOrbitPoint(p));
    p.forEach((v,i)=>near(v,q[i]));
  }
});
test('actor local basis preserves limb dimensions and follows radial gravity',()=>{
  const v=[4,5,6];
  for(const x of [0,1000,4000]){
    const rotated=orbit.journeyOrbitVector(v,x);
    near(Math.hypot(...v),Math.hypot(...rotated));
    const up=orbit.journeyOrbitVector([0,1,0],x);
    orbit.journeyOrbitBasis(x).up.forEach((n,i)=>near(n,up[i]));
  }
});
