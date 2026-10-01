import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBrakeAssembly, createAnnularGeometry, normalizeGeometrySettings, layoutBrakeLabels, getGeometryRepresentation, fitBrakeCamera, highlightBrakePart } from '../src/scene.js';

function geometries(assembly) { const result=new Set();assembly.group.traverse(node=>{if(node.isMesh)result.add(node.geometry);});return [...result]; }
function triangles(geometry,callback) {
  const positions=geometry.attributes.position,indices=geometry.index,limit=indices?.count??positions.count;
  for(let i=0;i<limit;i+=3){const values=[0,1,2].map(offset=>new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(i+offset):i+offset));callback(...values);}
}
function assertSoundGeometry(geometry) {
  for(const name of ['position','normal','uv']){const attribute=geometry.attributes[name];assert.ok(attribute,`missing ${name}`);for(const value of attribute.array)assert.ok(Number.isFinite(value),`${name} is nonfinite`);}
  const normals=geometry.attributes.normal;for(let i=0;i<normals.count;i++){const length=new THREE.Vector3().fromBufferAttribute(normals,i).length();assert.ok(length>.90&&length<1.01,`normal length ${length}`);}
  triangles(geometry,(a,b,c)=>assert.ok(new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).lengthSq()>1e-22,'zero-area triangle'));
}
function signedVolume(geometry){let volume=0;triangles(geometry,(a,b,c)=>{volume+=a.dot(new THREE.Vector3().crossVectors(b,c))/6;});return volume;}
function assertClosed(geometry){
  const edges=new Map(),key=point=>point.toArray().map(value=>Math.round(value*1e8)).join(',');
  triangles(geometry,(...points)=>{for(let i=0;i<3;i++){const a=key(points[i]),b=key(points[(i+1)%3]),entry=a<b?`${a}|${b}`:`${b}|${a}`,value=edges.get(entry)??{count:0,direction:0};value.count++;value.direction+=a<b?1:-1;edges.set(entry,value);}});
  for(const edge of edges.values()){assert.equal(edge.count,2,'open or nonmanifold edge');assert.equal(edge.direction,0,'inconsistent surface winding');}
}
function triangleHits(group,origin,direction){
  const ray=new THREE.Ray(origin,direction),distances=[];group.updateMatrixWorld(true);
  group.traverse(node=>{if(!node.isMesh)return;triangles(node.geometry,(a,b,c)=>{a.applyMatrix4(node.matrixWorld);b.applyMatrix4(node.matrixWorld);c.applyMatrix4(node.matrixWorld);const hit=ray.intersectTriangle(a,b,c,false,new THREE.Vector3());if(hit){const distance=hit.distanceTo(origin);if(distance>1e-7)distances.push(distance);}});});
  return [...new Set(distances.map(value=>Math.round(value*1e8)/1e8))].sort((a,b)=>a-b);
}

test('SI aliases and each-side fixed piston diameters produce the intended topology',()=>{
  const normalized=normalizeGeometrySettings({caliper:'fixed',floatingPistonDiameterMm:54,fixedPistonDiametersMm:[38,42]});
  assert.equal(normalized.caliperType,'fixed');assert.equal(normalized.pistonDiameter,.054);assert.deepEqual(normalized.fixedPistonDiameters,[.038,.042]);
  const a=createBrakeAssembly({caliperType:'floating'}),b=createBrakeAssembly({caliperType:'fixed'});
  try{assert.equal(a.getDiagnostics().caliper.pistonCount,1);assert.equal(b.getDiagnostics().caliper.pistonCount,4);assert.ok(Math.abs(a.getDiagnostics().caliper.pistonAreaPerSide-b.getDiagnostics().caliper.pistonAreaPerSide)<1e-15);assert.equal(a.components.get('slide-pins').node.visible,true);assert.equal(b.components.get('slide-pins').node.visible,false);}finally{a.dispose();b.dispose();}
});

test('all assembly states have finite normals, UVs, nondegenerate physical geometry and bounded detail',()=>{
  for(const caliperType of ['floating','fixed'])for(const mode of ['assembled','cutaway','exploded'])for(const cutaway of mode==='cutaway'?[0,.2,.65,1]:[.65]){
    const a=createBrakeAssembly({caliperType},{mode,cutaway});
    try{for(const geometry of geometries(a))assertSoundGeometry(geometry);const d=a.getDiagnostics();assert.ok(d.triangles<200000);assert.ok(d.meshes<200);assert.equal(d.units,'m');assert.equal(d.axle,'+Z');}finally{a.dispose();}
  }
});

test('annular walls and real cut faces close the solid and retain outward winding',()=>{
  for(const inner of [0,.02])for(const length of [Math.PI*.8,Math.PI*1.6,Math.PI*2]){
    const geometry=createAnnularGeometry(inner,.04,-.01,.015,.23,length,96);
    try{assertSoundGeometry(geometry);assertClosed(geometry);const expected=length/2*(.04**2-inner**2)*.025;assert.ok(Math.abs(signedVolume(geometry)-expected)/expected<.002);}finally{geometry.dispose();}
  }
});

test('the vented rotor has two separated metal plates and a real open radial cooling passage',()=>{
  const a=createBrakeAssembly({}, {mode:'assembled'});
  try{
    const d=a.getDiagnostics();assert.equal(d.rotor.vanes,36);assert.ok(d.rotor.ventGap>.010);
    const rotor=a.components.get('rotor').node;
    assert.deepEqual(triangleHits(rotor,new THREE.Vector3(.13,0,0),new THREE.Vector3(1,0,0)),[]);
    const forward=triangleHits(rotor,new THREE.Vector3(.13,0,0),new THREE.Vector3(0,0,1));
    const backward=triangleHits(rotor,new THREE.Vector3(.13,0,0),new THREE.Vector3(0,0,-1));
    assert.ok(Math.abs(forward[0]-d.rotor.ventGap/2)<1e-8);assert.ok(Math.abs(backward[0]-d.rotor.ventGap/2)<1e-8);
    assert.ok(forward.some(value=>Math.abs(value-d.rotor.thickness/2)<1e-8));
  }finally{a.dispose();}
});

test('increasing the cut removes actual rotor metal while complete assembly has no painted fake cuts',()=>{
  const full=createBrakeAssembly({}, {mode:'assembled'}),small=createBrakeAssembly({}, {mode:'cutaway',cutaway:.2}),large=createBrakeAssembly({}, {mode:'cutaway',cutaway:.8});
  const rotorVolume=assembly=>{let total=0;assembly.components.get('rotor').node.traverse(node=>{if(node.isMesh)total+=signedVolume(node.geometry);});return total;};
  try{assert.equal(full.getDiagnostics().rotor.cutFaces,0);assert.ok(small.getDiagnostics().rotor.cutFaces>0);assert.ok(rotorVolume(full)>rotorVolume(small));assert.ok(rotorVolume(small)>rotorVolume(large));assert.ok(small.getDiagnostics().rotor.vanes>large.getDiagnostics().rotor.vanes);}finally{full.dispose();small.dispose();large.dispose();}
});

test('pressure illustration closes both pads at rotor surfaces and only floating body slides',()=>{
  for(const caliperType of ['floating','fixed']){
    const a=createBrakeAssembly({caliperType},{mode:'assembled'}),snapshot={pressure:8e6,wheelAngle:0,clampForce:4000,padNormalForce:{inboard:2000,outboard:2000},absPhase:'hold'},original=structuredClone(snapshot);
    try{
      a.update(snapshot);assert.deepEqual(snapshot,original);const pads=a.components.get('pads').node.children.filter(node=>node.isGroup);
      const inner=new THREE.Box3().setFromObject(pads[0]),outer=new THREE.Box3().setFromObject(pads[1]);
      assert.ok(Math.abs(inner.max.z+.0125)<1e-7);assert.ok(Math.abs(outer.min.z-.0125)<1e-7);
      assert.equal(a.components.get('caliper').node.position.z,caliperType==='floating'?-.0032:0);
      assert.deepEqual(a.getDiagnostics().snapshot.padNormalForce,{inboard:2000,outboard:2000});assert.equal(a.getDiagnostics().actuation.illustrative,true);
      a.update({pressure:0,wheelAngle:0});assert.equal(a.components.get('caliper').node.position.z,0);assert.ok(new THREE.Box3().setFromObject(pads[0]).max.z<-.0125);
      for(const geometry of geometries(a))assertSoundGeometry(geometry);
    }finally{a.dispose();}
  }
});

test('absolute wheel phase rotates metal while DOM anchor points remain stable, without time integration',()=>{
  const a=createBrakeAssembly({}, {mode:'assembled'});
  try{
    const anchors=['rotor','hub','encoder'].map(id=>a.components.get(id).anchor.getWorldPosition(new THREE.Vector3()));
    a.update({wheelAngle:11.25,pressure:0});assert.deepEqual(a.getDiagnostics().rotation,{wheelAngle:11.25,rotor:11.25,hub:11.25,encoder:11.25});
    for(let i=0;i<12;i++)a.update({wheelAngle:11.25,pressure:0});
    assert.equal(a.getDiagnostics().rotation.rotor,11.25);
    ['rotor','hub','encoder'].forEach((id,index)=>assert.ok(a.components.get(id).anchor.getWorldPosition(new THREE.Vector3()).distanceTo(anchors[index])<1e-15));
    assert.equal(a.components.get('caliper').node.rotation.z,0);assert.equal(a.components.get('sensor').node.rotation.z,0);
  }finally{a.dispose();}
});

test('explosion separates the physical groups and anchors without changing calculation snapshots',()=>{
  const a=createBrakeAssembly({}, {mode:'exploded',explode:0}),snapshot={pressure:0,wheelAngle:1,clampForce:0};
  try{
    const before=a.components.get('hub').anchor.getWorldPosition(new THREE.Vector3());a.update(snapshot,{mode:'exploded',explode:1});
    const after=a.components.get('hub').anchor.getWorldPosition(new THREE.Vector3());assert.ok(Math.abs(after.z-before.z-.21)<1e-8);
    assert.deepEqual(a.getDiagnostics().snapshot,{pressure:0,clampForce:0,padNormalForce:null,absPhase:'off',slip:null});
    const list=a.getComponents();assert.ok(list.some(part=>part.id==='seals'&&part.description.includes('사각')));list[0].name='edited';assert.notEqual(a.getComponents()[0].name,'edited');
  }finally{a.dispose();}
});

test('small label layouts keep names inside the canvas without overlaps and retain selected parts',()=>{
  for(const [width,height] of [[390,300],[390,500],[1000,420]]){
    const candidates=Array.from({length:19},(_,index)=>({id:String(index),x:index%2?width*.8:width*.2,y:index*21-90,priority:index,selected:index===18}));
    const placement=layoutBrakeLabels(candidates,width,height);assert.ok(placement.some(entry=>entry.id==='18'));
    for(const entry of placement){assert.ok(entry.left>=0&&entry.left+entry.width<=width);assert.ok(entry.top>=0&&entry.top+entry.height<=height);}
    for(let i=0;i<placement.length;i++)for(let j=i+1;j<placement.length;j++){const a=placement[i],b=placement[j];assert.ok(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top,'overlapping labels');}
  }
});

test('every current buffer, material and texture is released once and per-frame pressure creates no resources',()=>{
  const a=createBrakeAssembly({caliperType:'fixed'}),initial=a.getDiagnostics(),tracked=new Set(geometries(a));
  a.group.traverse(node=>{if(!node.isMesh)return;for(const value of Array.isArray(node.material)?node.material:[node.material]){tracked.add(value);for(const key of ['map','bumpMap'])if(value[key])tracked.add(value[key]);}});
  for(let i=0;i<150;i++)a.update({pressure:(i%10)*1e6,wheelAngle:i*.3,inletOpen:i%2===0,outletOpen:i%3===0,pumpActive:i%3===0});
  const after=a.getDiagnostics();for(const field of ['geometries','materials','textures','meshes'])assert.equal(after[field],initial[field]);
  const disposed=new Map();for(const value of tracked)value.addEventListener('dispose',()=>disposed.set(value,(disposed.get(value)??0)+1));
  a.dispose();a.dispose();for(const value of tracked)assert.equal(disposed.get(value),1);assert.equal(a.getDiagnostics().disposed,true);assert.equal(a.getDiagnostics().geometries,0);
});

test('imported model dimensions outside the representative render range are explicit and preserve input values',()=>{
  const floating={caliperType:'floating',pistonDiameter:.120,padMeanRadius:.061,discInnerRadius:.055,discOuterRadius:.090};
  const copy=structuredClone(floating),f=getGeometryRepresentation(floating);
  assert.equal(f.representative,true);assert.equal(f.calculationUnchanged,true);assert.ok(f.changes.some(value=>value.field==='pistonDiameter'&&value.requested===.120&&value.rendered===.080));assert.deepEqual(floating,copy);
  const fixed={caliperType:'fixed',fixedPistonDiameters:Array(8).fill(.010)},g=getGeometryRepresentation(fixed);
  assert.ok(g.changes.some(value=>value.field==='fixedPistonCountPerSide'&&value.requested===8&&value.rendered===3));assert.equal(g.rendered.fixedPistonDiameters.length,3);
  assert.equal(getGeometryRepresentation({caliperType:'floating',pistonDiameter:.054,padMeanRadius:.125,discOuterRadius:.18,discInnerRadius:.055,discThickness:.025}).representative,false);
  const a=createBrakeAssembly(fixed);try{assert.equal(a.getDiagnostics().representation.representative,true);assert.deepEqual(a.getDiagnostics().representation.changes,g.changes);}finally{a.dispose();}
});

test('actual default assembly vertices fill 65–75 percent of the desktop frame without being clipped',()=>{
  for(const mode of ['assembled','cutaway']){
    const a=createBrakeAssembly({padMeanRadius:.125},{mode}),camera=new THREE.PerspectiveCamera(38,880/410,.005,12);
    try{const fit=fitBrakeCamera(camera,a.group,{aspect:880/410});assert.ok(fit.subjectFill.height>=.65&&fit.subjectFill.height<=.75,`${mode} height ${fit.subjectFill.height}`);assert.ok(fit.subjectFill.width<=.78);assert.ok(Math.abs(fit.subjectFill.top)<1&&Math.abs(fit.subjectFill.bottom)<1);assert.ok(Math.abs(fit.subjectFill.left)<1&&Math.abs(fit.subjectFill.right)<1);}finally{a.dispose();}
  }
});

test('selection highlights only the selected metal, restores shared originals and releases clones',()=>{
  const a=createBrakeAssembly(),original=new Map();a.group.traverse(node=>{if(node.isMesh)original.set(node,node.material);});
  const highlight=highlightBrakePart(a,'rotor');
  try{
    assert.equal(highlight.box,false);assert.equal(highlight.style,'subtle-material');assert.ok(highlight.meshCount>0);
    const rotorMeshes=new Set();a.components.get('rotor').node.traverse(node=>{if(node.isMesh)rotorMeshes.add(node);});
    for(const [node,base] of original)if(rotorMeshes.has(node))assert.notEqual(node.material,base);else assert.equal(node.material,base);
    const clones=new Set();for(const node of rotorMeshes)for(const value of Array.isArray(node.material)?node.material:[node.material])clones.add(value);
    for(let i=0;i<100;i++)highlight.refresh();let count=0;for(const clone of clones)clone.addEventListener('dispose',()=>count++);
    highlight.dispose();highlight.dispose();assert.equal(count,clones.size);for(const [node,base] of original)assert.equal(node.material,base);
  }finally{highlight.dispose();a.dispose();}
});
