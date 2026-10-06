// Heard-time phrase direction. Section energy is measured evidence, never a
// genre/solo label. Camera envelopes deliberately contain no beat clock.
import { hashSeed } from '../../utils/math.js';
import { NEUTRAL_MOVE } from './RangeCamera.js';

const unit=v=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;
const ease=v=>{const x=unit(v);return x*x*x*(x*(x*6-15)+10);};
const quiet=()=>({phase:'quiet',intensity01:0,accent01:0,focusId:null,focusStrength01:0,focusById:{midio:0,broshi:0,midasus:0},cameraMove:NEUTRAL_MOVE});
const PREPARE_MS=4500,ARRIVE_MS=3000,RECOVER_MS=6000;

export function sampleJourneyDirection({timeMs=0,sections=null,durationMs=0,music=null,reducedMotion=false}={}){
  if(reducedMotion)return quiet();
  const t=Math.max(0,Number.isFinite(timeMs)?timeMs:0);
  const list=(Array.isArray(sections)?sections:[]).filter(s=>s.provenance==='detected'&&Number.isFinite(s.startMs)
    &&Number.isFinite(s.endMs)&&s.endMs>s.startMs).slice().sort((a,b)=>a.startMs-b.startMs);
  let phrase=null,strongest=0,total=0,remaining=1,sideSum=0,energySum=0,phase='quiet';
  for(const s of list){
    const energy=unit(s.relEnergy01);
    if(energy<.58)continue;
    const end=durationMs>0?Math.min(s.endMs,durationMs):s.endMs;
    if(t<s.startMs-PREPARE_MS||t>end+RECOVER_MS)continue;
    const arrival=ease((t-s.startMs+PREPARE_MS)/(PREPARE_MS+ARRIVE_MS));
    const recovery=1-ease((t-end)/RECOVER_MS);
    const w=arrival*recovery;
    total+=w;remaining*=1-w;energySum+=energy*w;
    sideSum+=(hashSeed(String(s.motifId??s.label??'release'))/4294967296*2-1)*w;
    if(w<=strongest)continue;
    phrase=s;strongest=w;phase=t<s.startMs?'build':t<s.startMs+ARRIVE_MS?'arrival':t<=end?'sustain':'recovery';
  }
  const weight=1-remaining;
  const energy=unit(music?.energy01),sources=music?.sources||{};
  const candidates=['midio','broshi','midasus'].map(id=>({id,activity:unit(sources[id]?.activity),pitch:unit(sources[id]?.pitchActivity)}))
    .sort((a,b)=>b.pitch-a.pitch);
  const lead=candidates[0],dominance=lead.pitch-candidates[1].pitch;
  // Continuous dominance controls the push; focus itself is semantic only.
  const focusWeight=ease((lead.pitch-.35)/.4)*ease((dominance-.12)/.3)*ease((lead.activity-.3)/.4);
  const focusStrength01=focusWeight*(1-weight);
  const focusById=Object.fromEntries(['midio','broshi','midasus'].map(id=>[id,id===lead.id?focusStrength01:0]));
  const focusId=focusStrength01>.15?lead.id:null;
  const intensity01=phrase?energy+(energySum/total-energy)*weight:energy;
  const accent01=unit(music?.pulse01)*intensity01;
  if(phrase){
    const side=sideSum/total;
    return {phase,intensity01,accent01,focusId,focusStrength01,focusById,cameraMove:{dolly:.045*focusWeight*(1-weight)-.09*weight,yaw:.025*side*weight,
      crane:.012*weight,truck:0,kind:'pullback'}};
  }
  return {phase:focusId?'sustain':'quiet',intensity01,accent01,focusId,focusStrength01,focusById,
    cameraMove:{dolly:.045*focusWeight,yaw:0,crane:0,truck:0,kind:focusWeight>0?'push':'rest'}};
}
