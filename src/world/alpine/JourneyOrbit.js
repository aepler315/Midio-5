// Shared presentation transform. Simulation remains in intrinsic metres;
// the top of the reference sphere is the old scene origin. Longitude follows
// travel while intrinsic depth curves around its latitude.
const radiusM=1800;
export const JOURNEY_ORBIT=Object.freeze({radiusM,circumferenceM:2*Math.PI*radiusM,depthScale:.30,reliefScale:.36});
const finite=v=>Number.isFinite(v)?v:0;
export function journeyOrbitPoint([x,h,z]){
  const a=finite(x)/radiusM,b=finite(z)*JOURNEY_ORBIT.depthScale/radiusM,r=radiusM+finite(h),c=Math.cos(b);
  return [r*c*Math.sin(a),r*c*Math.cos(a)-radiusM,r*Math.sin(b)];
}
export function journeyOrbitBasis(x,z=0){
  const a=finite(x)/radiusM,b=finite(z)*JOURNEY_ORBIT.depthScale/radiusM;
  const s=Math.sin(a),c=Math.cos(a),sb=Math.sin(b),cb=Math.cos(b);
  return {right:[c,-s,0],up:[cb*s,cb*c,sb],forward:[sb*s,sb*c,-cb]};
}
export function journeyOrbitVector([x,y,z],localX,localZ=0){
  const {right,up,forward}=journeyOrbitBasis(localX,localZ);
  return right.map((value,i)=>value*x+up[i]*y-forward[i]*z);
}
export function journeyOrbitInverse([x,y,z]){
  const r=Math.hypot(x,y+radiusM,z);
  return [Math.atan2(x,y+radiusM)*radiusM,r-radiusM,
    Math.asin(r>0?Math.max(-1,Math.min(1,z/r)):0)*radiusM/JOURNEY_ORBIT.depthScale];
}
export const JOURNEY_ORBIT_GLSL=/* glsl */`
  #ifndef JOURNEY_ORBIT_UNIFORM
  #define JOURNEY_ORBIT_UNIFORM
  uniform float uJourneyOrbit;
  #endif
  const float JOURNEY_RADIUS=${radiusM.toFixed(1)};
  const float JOURNEY_CIRCUMFERENCE=${JOURNEY_ORBIT.circumferenceM.toFixed(9)};
  const float JOURNEY_DEPTH_SCALE=${JOURNEY_ORBIT.depthScale.toFixed(4)};
  vec3 journeyOrbitPoint(vec3 p){
    if(uJourneyOrbit<.5)return p;
    float a=p.x/JOURNEY_RADIUS,b=p.z*JOURNEY_DEPTH_SCALE/JOURNEY_RADIUS;
    float r=JOURNEY_RADIUS+p.y,c=cos(b);
    return vec3(r*c*sin(a),r*c*cos(a)-JOURNEY_RADIUS,r*sin(b));
  }
  vec3 journeyOrbitVector(vec3 v,float x,float z){
    if(uJourneyOrbit<.5)return v;
    float a=x/JOURNEY_RADIUS,b=z*JOURNEY_DEPTH_SCALE/JOURNEY_RADIUS;
    float s=sin(a),c=cos(a),sb=sin(b),cb=cos(b);
    return vec3(c*v.x+cb*s*v.y-sb*s*v.z,-s*v.x+cb*c*v.y-sb*c*v.z,sb*v.y+cb*v.z);
  }
  vec3 journeyOrbitUp(vec3 p){
    if(uJourneyOrbit<.5)return vec3(0.0,1.0,0.0);
    return normalize(vec3(p.x,p.y+JOURNEY_RADIUS,p.z));
  }
  float journeyOrbitAltitude(vec3 p){
    return uJourneyOrbit<.5?p.y:length(vec3(p.x,p.y+JOURNEY_RADIUS,p.z))-JOURNEY_RADIUS;
  }
`;
