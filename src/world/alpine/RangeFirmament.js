// The sky is a field of world directions, not a captured screen rectangle.
// Angles are radians; artwork is deliberately present above the view too.
import { rangeEnergy } from './RangeEnergy.js';
const unit = v => Number.isFinite(v) ? Math.max(0,Math.min(1,v)) : 0;
export function reflectedSkyDirection(ray) {
  const d=[ray[0],Math.abs(ray[1]),ray[2]],length=Math.hypot(...d)||1;
  return d.map(v=>v/length);
}

// Existing musical pressure already integrates 1.2 seconds. These causal
// taps spread its light over a phrase, with no render-frame accumulator.
export function sampleFirmamentMusic(history,timeMs=0) {
  let energy=0;
  const weights=[.28,.24,.2,.16,.12];
  weights.forEach((weight,i)=>{
    const at=timeMs-i*800;
    const s=at>=0?history?.sample(at):null;
    energy+=weight*unit(s?.pressureEnergy01);
  });
  // Preserve the sustained light, but never smear the curtain's movement
  // over those taps. All spatial accents share the residents' current read.
  const drive=rangeEnergy(history?.sample(timeMs));
  return Object.freeze({aurora01:.36+.64*energy,melody01:drive.melody,bass01:drive.bass,rhythm01:drive.rhythm});
}
const stag={points:[[-.49,-.15],[-.28,-.08],[-.11,-.11],[.08,-.07],[.23,.05],[.31,.25],[.4,.31],[.27,.33],[.3,.48],[.38,.43],[.2,.47],[.2,.34],[.16,.19],[-.02,.13],[-.26,.15],[-.38,.09],[-.3,-.38],[-.2,-.12],[.02,-.38],[.08,-.07]],edges:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[5,7],[7,8],[8,9],[7,10],[10,11],[5,12],[12,13],[13,14],[14,15],[15,0],[1,16],[16,17],[2,18],[18,19]]};
const swan={points:[[-.48,.1],[-.24,.21],[-.03,.02],[.19,.22],[.43,.28],[.28,.07],[.1,-.08],[-.02,-.22],[-.2,-.1],[-.03,.02],[.14,.08],[.18,.34],[.3,.42],[.39,.37]],edges:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,0],[2,10],[10,11],[11,12],[12,13]]};
const lyre={points:[[-.35,.43],[-.22,.27],[-.28,-.21],[-.1,-.4],[.12,-.4],[.3,-.21],[.22,.27],[.35,.43],[-.12,.25],[.12,.25],[-.12,-.25],[.12,-.25]],edges:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[1,6],[8,10],[9,11],[2,5]]};
const whale={points:[[-.49,0],[-.36,.2],[-.11,.3],[.17,.24],[.38,.05],[.5,.2],[.44,-.04],[.51,-.22],[.33,-.12],[.07,-.18],[-.13,-.25],[-.36,-.16],[-.03,-.42]],edges:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,0],[9,12],[12,10]]};
export const CONSTELLATION_ART=Object.freeze([
  {id:'stag',azimuth:.52,altitude:.115,width:.24,height:.075,...stag},
  {id:'swan',azimuth:.1,altitude:.10,width:.24,height:.09,...swan},
  {id:'lyre',azimuth:-.28,altitude:.105,width:.15,height:.08,...lyre},
  {id:'whale',azimuth:.48,altitude:.31,width:.27,height:.13,...whale},
  {id:'high-swan',azimuth:.02,altitude:.29,width:.25,height:.12,...swan},
  {id:'high-lyre',azimuth:-.3,altitude:.44,width:.2,height:.18,...lyre},
].map(a=>Object.freeze(a)));
