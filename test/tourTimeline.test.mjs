import {test} from 'node:test';import assert from 'node:assert/strict';
import{tourFixture}from'./fixtures/tour-fixture.mjs';import{planTour}from'../src/world/terrain/TourPlanner.js';import{buildTourTimeline,replanTour}from'../src/world/terrain/TourTimeline.js';
const sections=[{startMs:0,endMs:30000,role:'drop',relEnergy01:.8},{startMs:30000,endMs:100000,role:'outro',relEnergy01:.3}];
const heading=p=>Math.atan2(p.targetM[0]-p.eyeM[0],-(p.targetM[2]-p.eyeM[2]))*180/Math.PI;
const delta=(a,b)=>((a-b+540)%360)-180;
test('timeline is finite, safe between frames, rate limited, random-access deterministic and locks feasible heroes',()=>{
 const d=tourFixture(),plan=planTour(d,{sections,durationMs:100000}),tour=buildTourTimeline(d,plan);
 let previous;for(let t=0;t<=100000;t+=50){const p=tour.poseAt(t);assert.ok([...p.eyeM,...p.targetM,p.fovYDeg].every(Number.isFinite));assert.ok(p.eyeM[1]>=105&&p.eyeM[1]<=2000);
 if(previous){assert.ok(Math.abs(p.eyeM[1]-previous.eyeM[1])<=30*.05+.01);assert.ok(Math.abs(delta(heading(p),heading(previous)))<=25*.05+.02);}previous=p;
 assert.deepEqual(tour.poseAt(t),p);}
 for(const h of tour.heroes.filter(h=>!h.passedAtRange)){const point=d.points.find(p=>p.id===h.pointId),pose=tour.poseAt(h.timeMs);assert.ok(Math.abs(delta(heading(pose),point.station.bestAim.headingDeg))<3);assert.ok(Math.abs(pose.eyeM[1]-point.station.yM)<.1);}
 assert.ok(tour.meanQualityRatio>=.8);
});
test('preview is stable, reduced motion obeys half climb limits, replan freezes every committed keyframe',()=>{
 const d=tourFixture(),preview=buildTourTimeline(d,planTour(d,{durationMs:0}));assert.deepEqual(preview.poseAt(0),preview.poseAt(99999));
 const plan=planTour(d,{sections,durationMs:100000}),tour=buildTourTimeline(d,plan,{reducedMotion:true});let prev=tour.poseAt(0);
 for(let t=100;t<=100000;t+=100){const p=tour.poseAt(t);assert.ok(Math.abs(p.eyeM[1]-prev.eyeM[1])<=15*.1+.01);assert.ok(Math.abs(delta(heading(p),heading(prev)))<=12*.1+.02);prev=p;}
 const replanned=replanTour(tour,d,plan,10000);for(let t=0;t<=13000;t+=100)assert.deepEqual(replanned.poseAt(t),tour.poseAt(t));
});

test('changed sections continue from the committed road without a position jump',async()=>{
 const {tourContinuation}=await import('../src/world/terrain/TourTimeline.js');
 const d=tourFixture(),oldPlan=planTour(d,{sections,durationMs:100000}),old=buildTourTimeline(d,oldPlan);
 const continuation=tourContinuation(old,d,10000);assert.ok(continuation);
 const changed=[{startMs:0,endMs:30000,role:'verse',relEnergy01:.5},{startMs:30000,endMs:100000,role:'chorus',relEnergy01:.8}];
 const plan=planTour(d,{sections:changed,durationMs:100000,startContinuation:continuation});
 assert.deepEqual(plan.routeAt(13000).posM.map(Math.round),[old.poseAt(13000).eyeM[0],old.poseAt(13000).eyeM[2]].map(Math.round));
 const next=replanTour(old,d,plan,10000);
 for(let t=0;t<=13000;t+=100)assert.deepEqual(next.poseAt(t),old.poseAt(t));
 const a=next.poseAt(13000),b=next.poseAt(13100);assert.ok(Math.hypot(b.eyeM[0]-a.eyeM[0],b.eyeM[2]-a.eyeM[2])<15);
 assert.ok(Math.abs(b.eyeM[1]-a.eyeM[1])<=3.01);assert.ok(Math.abs(delta(heading(b),heading(a)))<=2.51);
});
