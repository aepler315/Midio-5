/** Share immutable DEM lanes when available; otherwise account for the clone. */
export async function shareTerrainLanes(data){
 if(typeof SharedArrayBuffer==='undefined')return false;
 let count=0;
 for(const tile of data.tiles.values()){
  for(const key of ['heightsM','flowBytes','validMask']){const a=tile[key];if(!a||a.buffer instanceof SharedArrayBuffer)continue;const next=new a.constructor(new SharedArrayBuffer(a.byteLength));next.set(a);tile[key]=next;}
  if(++count%32===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return true;
}
export class TerrainWindowWorker{
 constructor({data,tour,view,rules,seed=0}){
  this.worker=new Worker(new URL('./terrainWindowWorker.js',import.meta.url),{type:'module'});this.jobs=new Map();this.serial=0;
  this.worker.onmessage=e=>{const job=this.jobs.get(e.data.id);if(!job)return;this.jobs.delete(e.data.id);if(e.data.error)job.reject(new Error(e.data.error));else job.resolve(e.data);};
  this.worker.onerror=e=>{for(const job of this.jobs.values())job.reject(new Error(e.message));this.jobs.clear();};
  const frames={durationMs:tour.durationMs,eye:tour.eye,target:tour.target,fov:tour.fov,meta:tour.meta,previewPose:tour.durationMs?null:tour.poseAt(0)};
  const plainView={...view};delete plainView.tour;
  this.worker.postMessage({kind:'init',data,tour:frames,view:plainView,rules,seed});
 }
 setTour(tour){this.worker.postMessage({kind:'tour',tour:{durationMs:tour.durationMs,eye:tour.eye,target:tour.target,fov:tour.fov,meta:tour.meta}});}
 build(index,options){const id=++this.serial;return new Promise((resolve,reject)=>{this.jobs.set(id,{resolve,reject});this.worker.postMessage({id,index,options});});}
 dispose(){this.worker.terminate();for(const job of this.jobs.values())job.reject(new DOMException('Window generation cancelled','AbortError'));this.jobs.clear();}
}
