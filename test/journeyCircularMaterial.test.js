import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { journeyGrid, journeyWaterGeometry, journeyForest, journeyDressing } from '../src/world/alpine/JourneyMaterial.js';
import { journeyOrbitPoint } from '../src/world/alpine/JourneyOrbit.js';

const circumference=3600*Math.PI;

test('circular water closes at every depth without visible straight chords',()=>{
  const geometry=journeyWaterGeometry(THREE,{circular:true});
  try {
    const positions=geometry.getAttribute('position');
    const rows=new Map();
    for(let i=0;i<positions.count;i++){
      const depth=positions.getZ(i),xs=rows.get(depth)||[];
      xs.push(positions.getX(i));rows.set(depth,xs);
    }
    assert.ok(rows.size>2,'depth subdivisions support curved shoreline rasterization');
    const depths=[...rows.keys()].sort((a,b)=>a-b);
    for(let i=1;i<depths.length;i++){
      const latitudeStep=(depths[i]-depths[i-1])*.30/1800;
      assert.ok(1800*(1-Math.cos(latitudeStep/2))<.02,
        'latitude chords must not sink the water away from surface contacts');
    }
    for(const [depth,xs] of rows){
      xs.sort((a,b)=>a-b);
      assert.ok(Math.abs(xs[0]+circumference/2)<.001);
      assert.ok(Math.abs(xs.at(-1)-circumference/2)<.001);
      const first=journeyOrbitPoint([xs[0],0,depth]),last=journeyOrbitPoint([xs.at(-1),0,depth]);
      assert.ok(Math.hypot(...first.map((v,i)=>v-last[i]))<.001,'matching longitude endpoints seal the water');
      for(let i=1;i<xs.length;i++){
        const angularStep=(xs[i]-xs[i-1])/1800;
        assert.ok(1800*(1-Math.cos(angularStep/2))<.02,'curvature error stays below two centimetres');
      }
    }
    assert.ok(geometry.index.count>10000,'water is a complete indexed curved surface');
  } finally {geometry.dispose();}
});

test('circular terrain grids sample longitude uniformly through a whole turn',()=>{
  const geometry=journeyGrid(THREE,64,4,16000,{circular:true});
  try {
    const positions=geometry.getAttribute('position');
    for(let x=0;x<=64;x++){
      assert.ok(Math.abs(positions.getX(x)-circumference*(x/64-.5))<.001);
    }
  } finally {geometry.dispose();}
});

for(const [name,create] of [['forest',journeyForest],['dressing',journeyDressing]]){
  test(`circular ${name} covers the complete route with deterministic inland stands`,()=>{
    const first=create(THREE,{}, {circular:true}),second=create(THREE,{}, {circular:true});
    try {
      const roots=first.geometry.getAttribute('aTree');
      assert.deepEqual(roots.array,second.geometry.getAttribute('aTree').array);
      const sectors=new Set();
      for(let i=0;i<roots.count;i++){
        const x=roots.getX(i);
        assert.ok(x>=-circumference/2&&x<circumference/2,'instance longitude is canonical');
        sectors.add(Math.floor((x/circumference+.5)*24));
        assert.ok(roots.getY(i)>0&&roots.getY(i)<.5,'roots stay inland of the shoreline');
      }
      assert.equal(sectors.size,24,'no quadrant disappears at a circumference crossing');
    } finally {
      for(const mesh of [first,second]){mesh.geometry.dispose();mesh.material.dispose();}
    }
  });
}
