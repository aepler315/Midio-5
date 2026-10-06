// Shared presentation transform. Simulation remains in intrinsic metres;
// the top of the reference circle is the old scene origin.
const radiusM=1800;
export const JOURNEY_ORBIT=Object.freeze({radiusM,circumferenceM:2*Math.PI*radiusM,depthScale:.18,reliefScale:.36});
const finite=v=>Number.isFinite(v)?v:0;
export function journeyOrbitPoint([x,h,z]){
  const a=finite(x)/radiusM,r=radiusM+finite(h);
  return [r*Math.sin(a),r*Math.cos(a)-radiusM,finite(z)*JOURNEY_ORBIT.depthScale];
}
export function journeyOrbitBasis(x){
  const a=finite(x)/radiusM,s=Math.sin(a),c=Math.cos(a);
  return {right:[c,-s,0],up:[s,c,0],forward:[0,0,-1]};
}
export function journeyOrbitVector([x,y,z],localX){
  const {right,up}=journeyOrbitBasis(localX);
  return [right[0]*x+up[0]*y,right[1]*x+up[1]*y,z];
}
export function journeyOrbitInverse([x,y,z]){
  return [Math.atan2(x,y+radiusM)*radiusM,Math.hypot(x,y+radiusM)-radiusM,z/JOURNEY_ORBIT.depthScale];
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
    float a=p.x/JOURNEY_RADIUS,r=JOURNEY_RADIUS+p.y;
    return vec3(r*sin(a),r*cos(a)-JOURNEY_RADIUS,p.z*JOURNEY_DEPTH_SCALE);
  }
  vec3 journeyOrbitVector(vec3 v,float x){
    if(uJourneyOrbit<.5)return v;
    float a=x/JOURNEY_RADIUS,s=sin(a),c=cos(a);
    return vec3(c*v.x+s*v.y,-s*v.x+c*v.y,v.z);
  }
  vec3 journeyOrbitUp(vec3 p){
    if(uJourneyOrbit<.5)return vec3(0.0,1.0,0.0);
    return normalize(vec3(p.x,p.y+JOURNEY_RADIUS,0.0));
  }
  float journeyOrbitAltitude(vec3 p){
    return uJourneyOrbit<.5?p.y:length(p.xy+vec2(0.0,JOURNEY_RADIUS))-JOURNEY_RADIUS;
  }
`;
