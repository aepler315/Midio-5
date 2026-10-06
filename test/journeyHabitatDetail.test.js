import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import * as journey from '../src/world/alpine/JourneyMaterial.js';
import { journeySurface, sampleJourneyState, journeyLakeDistance } from '../src/world/alpine/JourneyWorld.js';

test('forest packs varied crowns into deterministic compact stands in one draw call',()=>{
  const a=journey.journeyForest(THREE,{}),b=journey.journeyForest(THREE,{});
  try {
    const shapes=a.geometry.getAttribute('aShape'),clusters=a.geometry.getAttribute('aCluster');
    assert.ok(shapes&&clusters,'crown forms and stand membership are explicit');
    assert.ok(a.geometry.instanceCount<=1320);
    assert.deepEqual(a.geometry.getAttribute('aTree').array,b.geometry.getAttribute('aTree').array);
    assert.deepEqual(shapes.array,b.geometry.getAttribute('aShape').array);
    assert.ok(new Set(Array.from(shapes.array).filter((_,i)=>i%4===0).map(x=>x.toFixed(2))).size>20);
    const trees=a.geometry.getAttribute('aTree'),banks=a.geometry.getAttribute('aBank');
    const stands=new Map();
    for(let i=0;i<a.geometry.instanceCount;i++){
      const key=clusters.getX(i),points=stands.get(key)||[];
      points.push(trees.getX(i));stands.set(key,points);
      assert.ok(trees.getY(i)>0&&trees.getY(i)<.5);
      for(const timeMs of [0,32000,43200000]){
        const state=sampleJourneyState({timeMs,seed:73});
        const x=((trees.getX(i)-state.travelM+4200)%8400+8400)%8400-4200;
        const root=journeySurface(x,trees.getY(i),banks.getX(i),state);
        assert.ok(root.every(Number.isFinite));
        assert.ok(journeyLakeDistance(root[0],root[2],state)<0,'roots remain inland');
      }
    }
    assert.ok(stands.size>=24&&stands.size<=80);
    assert.ok([...stands.values()].every(xs=>Math.max(...xs)-Math.min(...xs)<380));
    assert.ok([...a.geometry.attributes.normal.array].every(Number.isFinite));
  } finally {[a,b].forEach(m=>{m.geometry.dispose();m.material.dispose();});}
});

test('sparse stones and reed clumps use one bounded mesh and the common dry bank field',()=>{
  assert.equal(typeof journey.journeyDressing,'function');
  const a=journey.journeyDressing(THREE,{}),b=journey.journeyDressing(THREE,{});
  try {
    const roots=a.geometry.getAttribute('aTree'),kinds=a.geometry.getAttribute('aKind'),banks=a.geometry.getAttribute('aBank');
    assert.ok(a.geometry.instanceCount>100&&a.geometry.instanceCount<650);
    assert.deepEqual(roots.array,b.geometry.getAttribute('aTree').array);
    assert.deepEqual(new Set(kinds.array),new Set([0,1]));
    for(let i=0;i<roots.count;i++){
      assert.ok(roots.getY(i)>0&&roots.getY(i)<.055);
      const root=journeySurface(roots.getX(i),roots.getY(i),banks.getX(i));
      assert.ok(root.every(Number.isFinite));
      assert.ok(journeyLakeDistance(root[0],root[2])<0);
    }
    assert.ok(a.geometry.attributes.position.count/3*a.geometry.instanceCount<22000);
    assert.ok([...a.geometry.attributes.position.array].every(Number.isFinite));
  } finally {[a,b].forEach(m=>{m.geometry.dispose();m.material.dispose();});}
});
