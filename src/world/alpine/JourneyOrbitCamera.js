import { JOURNEY_ORBIT } from './JourneyOrbit.js';
const unit=v=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;
const ease=v=>{const t=unit(v);return t*t*t*(t*(t*6-15)+10);};
/** Translate along a fixed viewing direction: the planet can roll while the
 * stellar directions remain steady through every automatic pullback. */
export function journeyOrbitCamera({timeMs=0,tanX=.72,tanY=.404,direction=null,reducedMotion=false}={}){
  const intro=1-ease((timeMs-450)/3550);
  const reveal01=reducedMotion?0:intro;
  const arrival=reducedMotion?0:unit(direction?.orbitReveal01);
  const focus=reducedMotion?0:unit(direction?.focusStrength01);
  const targetM=[0,110+(-JOURNEY_ORBIT.radiusM-110)*reveal01,-110*(1-reveal01)];
  // Includes the mountain crown and depth foreshortening. Ordinary framing
  // is fitted separately against all cast excursions, never current feet.
  const wholeDistance=2700/Math.max(.05,Math.min(tanX,tanY))/.94+300;
  // A phrase opens the inhabited view slightly. Only the opening moves the
  // target toward the planet centre; doing so on every chorus exposes the
  // foreground hemisphere and makes the performers disappear again.
  const distance=(760-35*focus+120*arrival)*(1-reveal01)+wholeDistance*reveal01;
  return {eyeM:[targetM[0],targetM[1]+distance*.65,targetM[2]+distance],targetM,
    up:[0,1,0],fovYDeg:44,reveal01};
}
