import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { journeyCore, JOURNEY_CORE_BOUNDS } from '../src/world/alpine/JourneyCore.js';
import { JOURNEY_ORBIT } from '../src/world/alpine/JourneyOrbit.js';
import { FirmamentGL } from '../src/world/alpine/FirmamentGL.js';
import { sceneUniforms } from '../src/world/alpine/TerrainMaterial.js';

function coreFor(t){
  const mesh=journeyCore(THREE,{});
  t.after(()=>{mesh.geometry.dispose();mesh.material.dispose();});
  return mesh;
}

test('the opaque core stays below sea level, closes the range depth and fits its memory budget',t=>{
  const mesh=coreFor(t),geometry=mesh.geometry;
  const position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
  const radius=JOURNEY_ORBIT.radiusM;
  let near=-Infinity,far=Infinity,maximumRadius=0;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    assert.ok([x,y,z,normal.getX(i),normal.getY(i),normal.getZ(i)].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-5,
      'every shading normal must remain defined');
    const r=Math.hypot(x,y+radius);
    assert.ok(r<radius,'the interior cannot protrude through the water surface');
    if(z>=JOURNEY_CORE_BOUNDS.nearZ){
      const ceiling=JOURNEY_CORE_BOUNDS.nearZ+JOURNEY_CORE_BOUNDS.frontBulgeM
        *Math.sqrt(Math.max(0,1-r*r/(radius*radius)));
      assert.ok(z<=ceiling+.001,'the visible dome must stay inside its listener clearance envelope');
    }
    maximumRadius=Math.max(maximumRadius,r);near=Math.max(near,z);far=Math.min(far,z);
  }
  assert.ok(maximumRadius>radius-15,'the core must reach the bases of the range shells');
  assert.ok(near>=1216&&near<1516,'the front rock face forms a deep dome inside the camera clearance bound');
  assert.ok(far<=-1586&&far>-1986,'the back cap has bounded depth relief and closes the rear range');
  assert.equal(mesh.material.transparent,false);
  assert.equal(mesh.material.depthTest,true);
  assert.equal(mesh.material.depthWrite,true,'the core must occlude stars and rear geometry');
  const bytes=Object.values(geometry.attributes).reduce((sum,attribute)=>sum+attribute.array.byteLength,0)
    +geometry.index.array.byteLength;
  assert.ok(bytes<1024*1024,`core GPU allocation ${bytes} bytes`);
});

test('every core edge joins two oppositely wound faces, including both caps and the angular seam',t=>{
  const geometry=coreFor(t).geometry,position=geometry.getAttribute('position'),edges=new Map();
  // Caps intentionally split normal vertices from their side walls. Weld
  // positions to submillimetre precision before checking the actual surface.
  const keys=Array.from({length:position.count},(_,i)=>
    [position.getX(i),position.getY(i),position.getZ(i)].map(v=>Math.round(v*1000)).join(','));
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const ab=new THREE.Vector3(),ac=new THREE.Vector3();
  let frontFaces=0,backFaces=0;
  for(let i=0;i<geometry.index.count;i+=3){
    const ids=[geometry.index.getX(i),geometry.index.getX(i+1),geometry.index.getX(i+2)];
    a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);
    const face=ab.subVectors(b,a).cross(ac.subVectors(c,a));
    assert.ok(face.length()>1e-6,'a collapsed triangle can leave an uncovered seam');
    if(ids.every(id=>position.getZ(id)>=216)){
      assert.ok(face.z>0,'front cap normals face the camera side');frontFaces++;
    }
    if(ids.every(id=>position.getZ(id)<=-1386)){
      assert.ok(face.z<0,'back cap normals face away from the front cap');backFaces++;
    }
    for(let edge=0;edge<3;edge++){
      const from=keys[ids[edge]],to=keys[ids[(edge+1)%3]],forward=from<to;
      const key=forward?`${from}|${to}`:`${to}|${from}`;
      const entry=edges.get(key)||{count:0,winding:0};
      entry.count++;entry.winding+=forward?1:-1;edges.set(key,entry);
    }
  }
  assert.ok(frontFaces>0&&backFaces>0,'both end caps must exist');
  for(const [edge,{count,winding}] of edges){
    assert.equal(count,2,`open or overlapping edge: ${edge}`);
    assert.equal(winding,0,`inconsistent winding at edge: ${edge}`);
  }
});

// Möller–Trumbore intersection against the real indexed triangles. The
// shipped compact Three runtime deliberately excludes Ray/Raycaster.
function rayIntersects(geometry,originValues,directionValues){
  const position=geometry.getAttribute('position');
  const origin=new THREE.Vector3(...originValues),direction=new THREE.Vector3(...directionValues);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const edge1=new THREE.Vector3(),edge2=new THREE.Vector3(),cross=new THREE.Vector3();
  const offset=new THREE.Vector3(),q=new THREE.Vector3();
  for(let i=0;i<geometry.index.count;i+=3){
    a.fromBufferAttribute(position,geometry.index.getX(i));
    b.fromBufferAttribute(position,geometry.index.getX(i+1));
    c.fromBufferAttribute(position,geometry.index.getX(i+2));
    edge1.subVectors(b,a);edge2.subVectors(c,a);cross.crossVectors(direction,edge2);
    const determinant=edge1.dot(cross);
    if(Math.abs(determinant)<1e-9)continue;
    offset.subVectors(origin,a);
    const u=offset.dot(cross)/determinant;
    if(u<0||u>1)continue;
    q.crossVectors(offset,edge1);
    const v=direction.dot(q)/determinant;
    if(v<0||u+v>1)continue;
    if(edge2.dot(q)/determinant>0)return true;
  }
  return false;
}

test('core triangles occlude the interior from front, rear and side without covering surrounding space',t=>{
  const geometry=coreFor(t).geometry;
  for(const radius of [0,500,1100,1750])for(const angle of [.03,.7,1.9,3.2,5.4]){
    const x=radius*Math.sin(angle),y=-1800+radius*Math.cos(angle);
    assert.ok(rayIntersects(geometry,[x,y,2500],[0,0,-1]),`front interior hole at ${radius}, ${angle}`);
    assert.ok(rayIntersects(geometry,[x,y,-2000],[0,0,1]),`rear interior hole at ${radius}, ${angle}`);
  }
  for(const z of [100,-500,-1300]){
    assert.ok(rayIntersects(geometry,[2500,-1800,z],[-1,0,0]),`open side wall at depth ${z}`);
  }
  assert.equal(rayIntersects(geometry,[1900,-1800,1000],[0,0,-1]),false);
  assert.equal(rayIntersects(geometry,[0,100,1000],[0,0,-1]),false);
});

test('ordinary range scenes keep the legacy sky horizon unless circular mode is explicitly enabled',t=>{
  const uniforms=sceneUniforms(THREE,{}),sky=new FirmamentGL(THREE,uniforms);
  t.after(()=>sky.dispose());
  assert.equal(sky.mesh.material.uniforms.uJourneyOrbit.value,0,
    'adding a circular Journey must not opt existing range scenes into a full surrounding starfield');
  uniforms.uJourneyOrbit.value=1;
  assert.equal(sky.mesh.material.uniforms.uJourneyOrbit.value,1,
    'Journey enables its sky through the same shared frame uniform');
});
