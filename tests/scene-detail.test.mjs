import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBrakeAssembly, fitBrakeCamera } from '../src/scene.js';
import { ENCODER_TEETH, hubBearingKinematics } from '../src/mechanical-detail.js';

const near=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const instances=assembly=>{const values=[];assembly.group.traverse(node=>{if(node.isInstancedMesh)values.push(node);});return values;};
const instanceState=assembly=>instances(assembly).map(node=>({role:node.userData.role,count:node.count,matrices:[...node.instanceMatrix.array.slice(0,node.count*16)]}));

test('bearing orbit and world spin satisfy no-slip velocities at both races in forward, reverse and stopped states',()=>{
  for(const wheelOmega of [-120,-1,0,1,120])for(const wheelAngle of [-77,0,31]){
    const k=hubBearingKinematics({wheelOmega,wheelAngle}),R=k.pitchRadius,r=k.ballRadius;
    near(k.cageRpm*R+k.ballWorldRpm*r,0);
    near(k.cageRpm*R-k.ballWorldRpm*r,k.innerRpm*(R-r));
    near(k.ballWorldAngle,k.cageAngle+k.ballRelativeAngle);
    near(k.cageAngle,wheelAngle*k.cageRatio);
    assert.equal(k.outerRpm,0);
  }
  assert.throws(()=>hubBearingKinematics({ballRadius:.04}),RangeError);
  assert.throws(()=>hubBearingKinematics({wheelOmega:NaN}),TypeError);
});

test('two ball rows and their visible stripe matrices follow absolute wheel phase without drift or new buffers',()=>{
  const assembly=createBrakeAssembly({}, {mode:'assembled'}),fresh=createBrakeAssembly({}, {mode:'assembled'});
  const final={wheelAngle:127.6,wheelOmega:71,pressure:4e6},initial=assembly.getDiagnostics();
  try{
    for(let step=0;step<100;step++)assembly.update({wheelAngle:final.wheelAngle*step/100,wheelOmega:71});
    assembly.update(final);fresh.update(final);
    assert.deepEqual(instanceState(assembly),instanceState(fresh));
    const before=instanceState(assembly);for(let i=0;i<20;i++)assembly.update(final);assert.deepEqual(instanceState(assembly),before);
    const detail=assembly.getDiagnostics().bearing;
    assert.equal(detail.rows.length,2);assert.ok(detail.rows.every(row=>row.visibleBalls===12));
    const balls=instances(assembly).filter(node=>node.userData.role==='bearing-balls');
    for(const [index,node] of balls.entries()){
      const matrix=new THREE.Matrix4();node.getMatrixAt(0,matrix);
      const position=new THREE.Vector3().setFromMatrixPosition(matrix);
      near(position.length(),detail.pitchRadius,2e-9);
      near(position.x,detail.rows[index].firstBallPosition[0],2e-9);near(position.y,detail.rows[index].firstBallPosition[1],2e-9);
      near(Math.atan2(matrix.elements[1],matrix.elements[0]),Math.atan2(Math.sin(detail.rows[index].firstBallSpin),Math.cos(detail.rows[index].firstBallSpin)),1e-7);
      assert.ok(node.geometry.attributes.color,'inspection stripe has a real per-vertex color attribute');
    }
    const after=assembly.getDiagnostics();for(const field of ['geometries','materials','textures','meshes'])assert.equal(after[field],initial[field]);
    assert.equal(after.encoder.teeth,ENCODER_TEETH);near(after.encoder.pulseHz,71*48/(2*Math.PI));
  }finally{assembly.dispose();fresh.dispose();}
});

test('the cut window stays fixed while all visible balls remain inside the retained race sector',()=>{
  for(const cutaway of [.2,.65,1]){
    const assembly=createBrakeAssembly({}, {mode:'cutaway',cutaway});
    try{
      const races=[];assembly.components.get('bearing').node.traverse(node=>{if(node.userData.role?.includes('race'))races.push(node);});
      assert.equal(races.length,4);const rotations=races.map(node=>node.quaternion.toArray());
      const start=Math.PI/2,length=Math.PI+(.5-cutaway)*.65;
      for(const wheelAngle of [0,.7,5,30,97,-13]){
        assembly.update({wheelAngle,wheelOmega:53});
        for(const node of instances(assembly).filter(node=>node.userData.role==='bearing-balls')){
          assert.ok(node.count>=4&&node.count<=7);
          const matrix=new THREE.Matrix4(),vertex=new THREE.Vector3(),position=node.geometry.attributes.position;
          for(let ball=0;ball<node.count;ball++){
            node.getMatrixAt(ball,matrix);
            for(let i=0;i<position.count;i++){
              vertex.fromBufferAttribute(position,i).applyMatrix4(matrix);
              const theta=((Math.atan2(vertex.y,vertex.x)-start)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
              assert.ok(theta>=0&&theta<=length+1e-7,'complete ball remains inside the static inspection sector');
            }
          }
        }
        assert.deepEqual(races.map(node=>node.quaternion.toArray()),rotations);
      }
    }finally{assembly.dispose();}
  }
});

test('grooved race solids have outward closed boundaries, including true cut end faces',()=>{
  for(const mode of ['assembled','cutaway']){
    const assembly=createBrakeAssembly({}, {mode});
    try{
      const geometries=[];assembly.components.get('bearing').node.traverse(node=>{if(node.geometry&&(node.geometry.userData.role?.includes('race')||node.geometry.userData.roles?.some(role=>role.includes('race'))))geometries.push(node.geometry);});
      assert.ok(geometries.length>0);
      for(const geometry of geometries){
        const position=geometry.attributes.position,index=geometry.index,edges=new Map(),key=v=>v.toArray().map(n=>Math.round(n*1e8)).join(':');let volume=0;
        for(let i=0;i<(index?.count??position.count);i+=3){
          const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j));
          volume+=vertices[0].dot(vertices[1].clone().cross(vertices[2]))/6;
          const keys=vertices.map(key);for(let j=0;j<3;j++){const a=keys[j],b=keys[(j+1)%3],forward=a<b,id=forward?`${a}|${b}`:`${b}|${a}`,edge=edges.get(id)??{count:0,direction:0};edge.count++;edge.direction+=forward?1:-1;edges.set(id,edge);}
        }
        assert.ok(volume>0,'outward normals enclose positive material volume');
        for(const edge of edges.values()){assert.equal(edge.count,2);assert.equal(edge.direction,0);}
      }
    }finally{assembly.dispose();}
  }
});

test('valve tips seat when closed and opening compresses a spring with its far end fixed',()=>{
  const assembly=createBrakeAssembly();
  try{
    const springs=[];assembly.components.get('valves').node.traverse(node=>{if(node.userData.role==='valve-return-spring')springs.push(node);});
    assert.equal(springs.length,2);
    for(const [inletOpen,outletOpen,pumpActive] of [[true,false,false],[false,false,false],[false,true,true]]){
      const snapshot={inletOpen,outletOpen,pumpActive,wheelAngle:8,wheelOmega:0};assembly.update(snapshot);
      const d=assembly.getDiagnostics();assert.equal(d.encoder.pulseHz,0);assert.equal(d.bearing.cageRpm,0);
      for(const [index,name] of ['inlet','outlet'].entries()){
        const value=d.hydraulics[name],open=index?outletOpen:inletOpen;
        assert.equal(value.open,open);near(value.tipZ-value.seatZ,value.lift);assert.equal(value.lift>0,open);
        near(springs[index].position.z+.014*springs[index].scale.z,.032);
      }
      assert.equal(d.hydraulics.pumpActive,pumpActive);assert.equal(d.hydraulics.pumpSpeedModeled,false);
      assert.deepEqual(snapshot,{inletOpen,outletOpen,pumpActive,wheelAngle:8,wheelOmega:0});
    }
  }finally{assembly.dispose();}
});

test('instance resources dispose exactly once and temporary visibility does not change structural part choices',()=>{
  const assembly=createBrakeAssembly({caliperType:'fixed'}),nodes=instances(assembly),counts=new Map();
  for(const node of nodes)node.addEventListener('dispose',()=>counts.set(node,(counts.get(node)??0)+1));
  const choices=assembly.getComponents();for(const part of assembly.components.values())part.node.visible=part.id==='bearing';
  assert.deepEqual(assembly.getComponents(),choices);assert.equal(choices.find(part=>part.id==='slide-pins').visible,false);
  const camera=new THREE.PerspectiveCamera(38,1,.005,12),fit=fitBrakeCamera(camera,assembly.group,{aspect:1,direction:new THREE.Vector3(.65,.18,1)});
  assert.ok(fit.distance<.3,'isolated camera fits only visible bearing geometry');assert.ok(fit.subjectFill.height>.65&&fit.subjectFill.height<.75);
  assembly.dispose();assembly.dispose();for(const node of nodes)assert.equal(counts.get(node),1);
});
