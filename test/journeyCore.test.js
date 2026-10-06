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

test('the opaque core follows a sphere eight metres below sea level within its memory budget',t=>{
  const mesh=coreFor(t),geometry=mesh.geometry;
  const position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
  const radius=JOURNEY_ORBIT.radiusM;
  let near=-Infinity,far=Infinity;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    const nx=normal.getX(i),ny=normal.getY(i),nz=normal.getZ(i);
    assert.ok([x,y,z,nx,ny,nz].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(nx,ny,nz)-1)<1e-5,
      'every shading normal must remain defined');
    const r=Math.hypot(x,y+radius,z);
    assert.ok(Math.abs(r-(radius-8))<.001,
      `the entire core must lie on the submerged sphere, got radius ${r}`);
    assert.ok(x*nx+(y+radius)*ny+z*nz>radius-9,'shading normals point away from the planet centre');
    near=Math.max(near,z);far=Math.min(far,z);
  }
  assert.equal(near,1792,'the front pole reaches the spherical radius');
  assert.equal(far,-1792,'the rear pole reaches the spherical radius');
  assert.equal(JOURNEY_CORE_BOUNDS.nearZ,near);
  assert.equal(JOURNEY_CORE_BOUNDS.farZ,far);
  assert.equal(JOURNEY_CORE_BOUNDS.frontBulgeM,0);
  assert.equal(mesh.material.transparent,false);
  assert.equal(mesh.material.depthTest,true);
  assert.equal(mesh.material.depthWrite,true,'the core must occlude stars and rear geometry');
  const bytes=Object.values(geometry.attributes).reduce((sum,attribute)=>sum+attribute.array.byteLength,0)
    +geometry.index.array.byteLength;
  assert.ok(bytes<1024*1024,`core GPU allocation ${bytes} bytes`);
});

test('every spherical core edge joins two outward faces without degenerate poles or an open longitude seam',t=>{
  const geometry=coreFor(t).geometry,position=geometry.getAttribute('position'),edges=new Map();
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const ab=new THREE.Vector3(),ac=new THREE.Vector3(),centroid=new THREE.Vector3();
  for(let i=0;i<geometry.index.count;i+=3){
    const ids=[geometry.index.getX(i),geometry.index.getX(i+1),geometry.index.getX(i+2)];
    a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);
    const face=ab.subVectors(b,a).cross(ac.subVectors(c,a));
    assert.ok(face.length()>1e-6,'a collapsed triangle can leave an uncovered seam');
    centroid.copy(a).add(b).add(c).multiplyScalar(1/3);centroid.y+=1800;
    assert.ok(face.dot(centroid)>0,'each triangle must face away from the planet centre');
    for(let edge=0;edge<3;edge++){
      const from=ids[edge],to=ids[(edge+1)%3],forward=from<to;
      const key=forward?`${from}|${to}`:`${to}|${from}`;
      const entry=edges.get(key)||{count:0,winding:0};
      entry.count++;entry.winding+=forward?1:-1;edges.set(key,entry);
    }
  }
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
  for(const z of [100,-500,-1300,1750,-1750]){
    assert.ok(rayIntersects(geometry,[2500,-1800,z],[-1,0,0]),`open sphere at depth ${z}`);
  }
  assert.equal(rayIntersects(geometry,[1750,-1800,1750],[-1,0,0]),true);
  assert.equal(rayIntersects(geometry,[1750,-1800,1800],[-1,0,0]),false,
    'the core must taper to the pole rather than extend a cylinder through the surrounding sky');
  assert.equal(rayIntersects(geometry,[2500,-50,1000],[-1,0,0]),false,
    'a ray outside the spherical limb must remain clear');
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
