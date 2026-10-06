const clamp=value=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};

/** The same direction field wraps sky radiance and lights ground receivers.
 * Components rather than azimuth keep the +/-pi seam continuous. */
export function sampleJourneyCloud(direction,{timeSec=0,seed=0,amount=0,clearing=0}={}) {
  const length=Math.hypot(...direction)||1;
  const [x,y,z]=direction.map(v=>v/length);
  const t=Number.isFinite(timeSec)?timeSec:0,phase=(Number.isFinite(seed)?seed:0)*.013;
  const drift=t*.007;
  const broad=.5+.25*Math.sin(x*4.7+z*3.1+drift+phase)
    +.16*Math.sin(z*8.3-y*3.7-drift*.63+phase*.7)
    +.09*Math.sin(x*15.1+z*11.2+drift*.31);
  const body=smooth(.24,.77,broad);
  const altitude=smooth(-.08,.13,y);
  return clamp(amount)*altitude*(.12+.88*body)*(1-.92*clamp(clearing));
}

export const JOURNEY_WEATHER_GLSL=/* glsl */`
  float journeyCloudCover(vec3 direction,float time,float seed,float amount,float clearing){
    vec3 d=normalize(direction);
    float drift=time*.007,phase=seed*.013;
    float broad=.5+.25*sin(d.x*4.7+d.z*3.1+drift+phase)
      +.16*sin(d.z*8.3-d.y*3.7-drift*.63+phase*.7)
      +.09*sin(d.x*15.1+d.z*11.2+drift*.31);
    return clamp(amount,0.0,1.0)*smoothstep(-.08,.13,d.y)
      *(.12+.88*smoothstep(.24,.77,broad))*(1.0-.92*clamp(clearing,0.0,1.0));
  }
`;
