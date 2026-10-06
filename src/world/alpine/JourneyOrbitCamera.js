import { JOURNEY_ORBIT } from './JourneyOrbit.js';
const unit=v=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;
const ease=v=>{const t=unit(v);return t*t*t*(t*(t*6-15)+10);};
/** Translate along a fixed viewing direction: the planet can roll while the
 * stellar directions remain steady through every automatic pullback. */
export function journeyOrbitCamera({timeMs=0,tanX=.72,tanY=.404,direction=null,reducedMotion=false}={}){
  const intro=1-ease((timeMs-1200)/6800);
  const reveal01=reducedMotion?0:Math.max(intro,unit(direction?.orbitReveal01));
  const focus=reducedMotion?0:unit(direction?.focusStrength01);
  const targetM=[0,160+(-JOURNEY_ORBIT.radiusM-160)*reveal01,-200-380*reveal01];
  // Includes the mountain crown and depth foreshortening. Ordinary framing
  // is fitted separately against all cast excursions, never current feet.
  const wholeDistance=2700/Math.max(.05,Math.min(tanX,tanY))/.94+300;
  const distance=(1000-50*focus)*(1-reveal01)+wholeDistance*reveal01;
  return {eyeM:[targetM[0],targetM[1]+distance*.28,targetM[2]+distance],targetM,
    up:[0,1,0],fovYDeg:44,reveal01};
}
