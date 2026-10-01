import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENCODER_TEETH, hubBearingKinematics } from './mechanical-detail.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const DEFAULT_VIEW = Object.freeze({ mode: 'cutaway', cutaway: .65, explode: .5, labels: true, selectedPart: null, quality: 'auto', camera: 'isometric' });
const PARTS = {
  rotor: ['통풍 로터', '두 마찰면 사이의 베인이 냉각 통로를 형성합니다. 허브와 함께 회전합니다.', '회주철', true],
  hub: ['휠 허브', '로터와 휠을 지지하고 베어링의 회전측과 함께 회전합니다.', '가공 강철', true],
  caliper: ['캘리퍼 몸체', '피스톤 보어와 유압실을 포함합니다. 플로팅형은 가이드 핀을 따라 이동하고 고정형은 브래킷에 고정됩니다.', '주철 / 알루미늄', false],
  pads: ['브레이크 패드', '안쪽·바깥쪽 마찰재와 금속 백플레이트입니다. 두 면에서 로터를 누릅니다.', '마찰재 · 강철', false],
  pistons: ['피스톤', '유압을 패드를 누르는 힘으로 바꿉니다. 플로팅형은 한쪽, 고정형은 양쪽에 있습니다.', '가공 강철', false],
  seals: ['피스톤 실', '보어 홈의 사각 단면 실입니다. 유압을 밀봉하고 제동 해제 때 피스톤 복귀를 돕습니다.', '고무', false],
  boots: ['더스트 부츠', '피스톤과 가이드 핀의 노출부를 먼지·수분으로부터 보호합니다.', '고무', false],
  bracket: ['고정 브래킷', '패드와 캘리퍼를 지지하고 너클에 고정됩니다.', '주조 강철', false],
  'slide-pins': ['슬라이드 핀', '플로팅형 몸체가 축 방향으로 이동하도록 안내합니다. 고정형에는 이 슬라이드 구조가 없습니다.', '강철', false],
  'pad-hardware': ['패드 고정 장치', '패드의 자리와 진동을 제어하는 클립·스프링·리테이너입니다. 몸체 슬라이드 핀과 구분됩니다.', '스프링 강철', false],
  bleeder: ['블리더', '유압실에 연결된 공기 배출 나사와 보호 캡입니다.', '강철 · 고무', false],
  hose: ['유압 호스', '유압모듈에서 캘리퍼로 브레이크액 압력을 전달합니다.', '고무 · 강철 연결부', false],
  bearing: ['허브 베어링', '두 줄의 볼과 홈이 있는 내외륜, 리테이너를 보여 줍니다. 외륜은 고정되고 볼의 공전·자전은 미끄럼 없는 접촉각 0° 대표 운동입니다. 실제 하중·예압·수명은 계산하지 않습니다.', '베어링 강철', false],
  knuckle: ['너클 지지부', '베어링 외륜과 브래킷이 고정되는 대표 지지 형상입니다.', '주조 강철', false],
  encoder: ['속도 인코더 링', '허브와 함께 회전하는 대표 톤 링입니다. 고정 센서가 비접촉으로 읽습니다.', '강철', true],
  sensor: ['휠속도 센서', '고정 지지부에 설치되어 인코더의 회전을 읽습니다. ABS 제어기로 속도 정보를 보냅니다.', '수지 · 금속', false],
  'hydraulic-unit': ['ABS 유압모듈', '캘리퍼 밖에 위치하는 대표 유압블록입니다. 공급·배출 밸브와 복귀 펌프를 보여 줍니다.', '알루미늄', false],
  valves: ['공급·배출 밸브', '계산된 밸브 상태에 따라 시트에서 플런저가 열리고 닫힙니다. 스프링·코일·유로는 대표 구조이며 이동량은 확대한 작동 표현입니다.', '강철 · 구리', false],
  pump: ['복귀 펌프', '감압 회로의 액을 복귀시키는 대표 펌프입니다. 계산된 가동 상태를 표시합니다.', '강철 · 알루미늄', false]
};

export function normalizeGeometrySettings(settings = {}) {
  const outer = clamp(finite(settings.discOuterRadius, .18), .10, .30);
  const inner = clamp(finite(settings.discInnerRadius, .055), .025, outer - .025);
  const type = (settings.caliperType ?? settings.caliper) === 'fixed' ? 'fixed' : 'floating';
  const supplied = settings.fixedPistonDiameters ?? settings.fixedPistonDiametersMm?.map(value => value / 1000);
  const fixed = Array.isArray(supplied) && supplied.length ? supplied.slice(0, 3).map(value => clamp(finite(value, .054 / Math.sqrt(2)), .020, .065)) : [.054 / Math.sqrt(2), .054 / Math.sqrt(2)];
  return {
    caliperType: type,
    pistonDiameter: clamp(finite(settings.pistonDiameter ?? (settings.floatingPistonDiameterMm == null ? undefined : settings.floatingPistonDiameterMm / 1000), .054), .028, .080),
    fixedPistonDiameters: fixed,
    discOuterRadius: outer,
    discInnerRadius: inner,
    discThickness: clamp(finite(settings.discThickness, .025), .008, .050),
    padMeanRadius: clamp(finite(settings.padMeanRadius, .133), inner + .015, outer - .015)
  };
}

export function getGeometryRepresentation(input = {}) {
  const rendered=normalizeGeometrySettings(input),changes=[];
  const compare=(field,requested,shown,label)=>{if(requested!=null&&Number.isFinite(Number(requested))&&Math.abs(Number(requested)-shown)>1e-9)changes.push({field,requested:Number(requested),rendered:shown,label});};
  compare('discOuterRadius',input.discOuterRadius,rendered.discOuterRadius,'로터 바깥 반경');
  compare('discInnerRadius',input.discInnerRadius,rendered.discInnerRadius,'로터 안쪽 반경');
  compare('discThickness',input.discThickness,rendered.discThickness,'로터 두께');
  compare('padMeanRadius',input.padMeanRadius,rendered.padMeanRadius,'패드 평균 반경');
  if(rendered.caliperType==='floating')compare('pistonDiameter',input.pistonDiameter??(input.floatingPistonDiameterMm==null?undefined:input.floatingPistonDiameterMm/1000),rendered.pistonDiameter,'플로팅 피스톤 지름');
  else {
    const requested=input.fixedPistonDiameters??input.fixedPistonDiametersMm?.map(value=>value/1000);
    if(Array.isArray(requested)){
      if(requested.length!==rendered.fixedPistonDiameters.length)changes.push({field:'fixedPistonCountPerSide',requested:requested.length,rendered:rendered.fixedPistonDiameters.length,label:'고정형 각측 피스톤 수'});
      for(let i=0;i<Math.min(requested.length,rendered.fixedPistonDiameters.length);i++)compare(`fixedPistonDiameters[${i}]`,requested[i],rendered.fixedPistonDiameters[i],`고정형 피스톤 ${i+1} 지름`);
    }
  }
  return {representative:changes.length>0,changes,rendered,calculationUnchanged:true};
}

export function fitBrakeCamera(camera,subject,{aspect=1,direction=new THREE.Vector3(.36,.23,.73),fill=.72}={}) {
  subject.updateMatrixWorld(true);
  const bounds=new THREE.Box3(),worldPoints=[];
  subject.traverseVisible(node=>{if(!node.isMesh)return;const position=node.geometry.attributes.position,count=node.isInstancedMesh?node.count:1,matrix=new THREE.Matrix4();for(let instance=0;instance<count;instance++){if(node.isInstancedMesh){node.getMatrixAt(instance,matrix);matrix.premultiply(node.matrixWorld);}else matrix.copy(node.matrixWorld);for(let i=0;i<position.count;i++){const point=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(matrix);bounds.expandByPoint(point);worldPoints.push(point);}}});
  const center=bounds.isEmpty()?new THREE.Vector3():bounds.getCenter(new THREE.Vector3()),axis=direction.clone().normalize();
  camera.aspect=aspect;camera.position.copy(center).add(axis);camera.lookAt(center);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),points=[];
  for(const point of worldPoints){const offset=point.sub(center);points.push([offset.dot(right),offset.dot(up),offset.dot(axis)]);}
  const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),measure=distance=>{
    let left=Infinity,rightEdge=-Infinity,bottom=Infinity,top=-Infinity;
    for(const [x,y,z] of points){const depth=distance-z,px=x/(depth*tangent*aspect),py=y/(depth*tangent);left=Math.min(left,px);rightEdge=Math.max(rightEdge,px);bottom=Math.min(bottom,py);top=Math.max(top,py);}
    return {width:(rightEdge-left)/2,height:(top-bottom)/2,left,right:rightEdge,bottom,top};
  };
  let low=points.reduce((largest,point)=>Math.max(largest,point[2]),.05)+.015,high=4;
  for(let step=0;step<24;step++){const middle=(low+high)/2,box=measure(middle);if(box.height>fill||box.width>.78||Math.max(Math.abs(box.left),Math.abs(box.right),Math.abs(box.bottom),Math.abs(box.top))>.91)low=middle;else high=middle;}
  camera.position.copy(center).addScaledVector(axis,high);camera.lookAt(center);camera.updateMatrixWorld(true);
  return {target:center,subjectFill:measure(high),distance:high};
}

export function highlightBrakePart(assembly,id) {
  const part=assembly.components.get(id),originals=new Map(),clones=new Map();
  if(part?.node.visible)part.node.traverse(node=>{
    if(!node.isMesh)return;originals.set(node,node.material);
    const values=Array.isArray(node.material)?node.material:[node.material];
    node.material=values.map(base=>{if(!clones.has(base))clones.set(base,base.clone());return clones.get(base);});
    if(!Array.isArray(originals.get(node)))node.material=node.material[0];
  });
  const refresh=()=>{for(const [base,clone] of clones){clone.copy(base);clone.emissive.add(new THREE.Color(.005,.025,.017));clone.emissiveIntensity=Math.max(.16,base.emissiveIntensity);}};
  refresh();let disposed=false;
  return {style:'subtle-material',box:false,meshCount:originals.size,materialCount:clones.size,refresh,dispose(){if(disposed)return;disposed=true;for(const [node,original] of originals)node.material=original;for(const clone of clones.values())clone.dispose();}};
}

function normalizeView(view = {}) {
  return { ...DEFAULT_VIEW, ...view, mode: ['assembled', 'cutaway', 'exploded'].includes(view.mode) ? view.mode : DEFAULT_VIEW.mode, camera:['isometric','front','rear','side','top'].includes(view.camera)?view.camera:DEFAULT_VIEW.camera,cutaway: clamp(finite(view.cutaway, .65), 0, 1), explode: clamp(finite(view.explode, .5), 0, 1) };
}

export function layoutBrakeLabels(candidates, width, height) {
  const labelWidth=Math.min(width<480?108:126,width*.28),top=62,bottom=Math.max(top,height-58),separation=30;
  const capacity=Math.max(1,Math.floor((bottom-top)/separation)+1),columns=[[],[]],placements=[];
  for(const candidate of candidates)columns[candidate.x<width*.48?0:1].push(candidate);
  for(const [side,entries] of columns.entries()){
    const retained=entries.sort((a,b)=>Number(b.selected)-Number(a.selected)||a.priority-b.priority).slice(0,capacity).sort((a,b)=>a.y-b.y);
    let previous=top-separation;
    for(let index=0;index<retained.length;index++){
      const entry=retained[index],remaining=retained.length-index-1,y=clamp(Math.max(entry.y,previous+separation),top,bottom-remaining*separation);previous=y;
      const left=side===0?10:width-labelWidth-10,edgeX=side===0?left+labelWidth:left;
      placements.push({...entry,left,top:y-12,width:labelWidth,height:25,y,edgeX,kneeX:edgeX+(side===0?12:-12),anchorX:clamp(entry.x,1,width-1),anchorY:clamp(entry.y,1,height-1)});
    }
  }
  return placements;
}

function triangleBuilder() {
  const buckets = [[], [], []];
  const add = (a, b, c, material = 0) => {
    const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a);
    if (ab.cross(ac).lengthSq() < 1e-24) return;
    buckets[material].push(...a.toArray(), ...b.toArray(), ...c.toArray());
  };
  const quad = (a, b, c, d, material = 0) => { add(a, b, c, material); add(a, c, d, material); };
  return { add, quad, finish() {
    const geometry = new THREE.BufferGeometry(), positions = [];
    for (let i = 0; i < buckets.length; i++) { const start = positions.length / 3; positions.push(...buckets[i]); if (buckets[i].length) geometry.addGroup(start, buckets[i].length / 3, i); }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const uv = []; for (let i = 0; i < positions.length; i += 3) uv.push(positions[i] * 10, positions[i + 1] * 10);
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return geometry;
  } };
}

// A partial ring has real radial end faces rather than an uncapped clipping plane.
export function createAnnularGeometry(inner, outer, back, front, start = 0, length = TAU, segments = 64) {
  const builder = triangleBuilder();
  const count = Math.max(3, Math.ceil(segments * length / TAU));
  const point = (r, angle, z) => new THREE.Vector3(r * Math.cos(angle), r * Math.sin(angle), z);
  for (let i = 0; i < count; i++) {
    const a = start + length * i / count, b = start + length * (i + 1) / count;
    builder.quad(point(outer,a,back),point(outer,b,back),point(outer,b,front),point(outer,a,front));
    if (inner > 0) {
      builder.quad(point(inner,a,back),point(inner,a,front),point(inner,b,front),point(inner,b,back),1);
      builder.quad(point(inner,a,front),point(outer,a,front),point(outer,b,front),point(inner,b,front),1);
      builder.quad(point(inner,a,back),point(inner,b,back),point(outer,b,back),point(outer,a,back),1);
    } else {
      builder.add(point(0,0,front),point(outer,a,front),point(outer,b,front),1);
      builder.add(point(0,0,back),point(outer,b,back),point(outer,a,back),1);
    }
  }
  if (length < TAU - 1e-8) {
    const end = start + length;
    builder.quad(point(inner,start,back),point(outer,start,back),point(outer,start,front),point(inner,start,front),2);
    builder.quad(point(inner,end,back),point(inner,end,front),point(outer,end,front),point(outer,end,back),2);
  }
  const geometry = builder.finish();
  const positions=geometry.attributes.position,uv=geometry.attributes.uv;
  for(let i=0;i<positions.count;i++)uv.setXY(i,positions.getX(i)/(outer*2)+.5,positions.getY(i)/(outer*2)+.5);
  geometry.userData = { kind: 'capped-annulus', innerRadius: inner, outerRadius: outer, back, front, start, length, cutFaces: length < TAU - 1e-8 ? 2 : 0 };
  return geometry;
}

function latheShell(profile, start = 0, length = TAU, segments = 64) {
  const builder = triangleBuilder(), count = Math.max(4, Math.ceil(segments * length / TAU));
  const point = ([radius, z], angle) => new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), z);
  for (let p = 0; p < profile.length; p++) {
    const next = (p + 1) % profile.length;
    for (let i = 0; i < count; i++) {
      const a = start + length * i / count, b = start + length * (i + 1) / count;
      builder.quad(point(profile[p],a),point(profile[p],b),point(profile[next],b),point(profile[next],a));
    }
  }
  if (length < TAU - 1e-8) {
    const shape = new THREE.Shape(profile.map(([r,z]) => new THREE.Vector2(r,z)));
    const faces = THREE.ShapeUtils.triangulateShape(shape.getPoints(), []);
    const points = shape.getPoints();
    for (const [a,b,c] of faces) {
      builder.add(point([points[a].x,points[a].y],start),point([points[b].x,points[b].y],start),point([points[c].x,points[c].y],start),2);
      builder.add(point([points[c].x,points[c].y],start+length),point([points[b].x,points[b].y],start+length),point([points[a].x,points[a].y],start+length),2);
    }
  }
  const geometry = builder.finish(); geometry.userData = { kind: 'closed-profile-shell', cutFaces: length < TAU - 1e-8 ? 2 : 0 }; return geometry;
}

function extrudedPolygon(points, depth, z, holes = []) {
  const shape = new THREE.Shape(points.map(([x,y]) => new THREE.Vector2(x,y)));
  for (const [x,y,radius] of holes) { const hole = new THREE.Path(); hole.absarc(x,y,radius,0,TAU,true); shape.holes.push(hole); }
  const geometry = new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:Math.min(.0013,depth/5),bevelThickness:Math.min(.0013,depth/5),curveSegments:32});
  geometry.translate(0,0,z); geometry.userData.kind = 'machined-extrusion'; return geometry;
}

function clipLeft(points) {
  const output=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],insideA=a[0]<=0,insideB=b[0]<=0;
    if(insideA)output.push(a);
    if(insideA!==insideB){const ratio=-a[0]/(b[0]-a[0]);output.push([0,a[1]+ratio*(b[1]-a[1])]);}
  }
  return output.filter((value,index)=>index===0||Math.hypot(value[0]-output[index-1][0],value[1]-output[index-1][1])>1e-8);
}

function castNoise() {
  const data = new Uint8Array(64 * 64 * 4); let seed = 310;
  for (let i = 0; i < data.length; i += 4) { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; const value = 110+(seed>>>24)%80; data[i]=data[i+1]=data[i+2]=value; data[i+3]=255; }
  const texture = new THREE.DataTexture(data,64,64); texture.wrapS=texture.wrapT=THREE.RepeatWrapping; texture.repeat.set(7,7); texture.needsUpdate=true; return texture;
}

function machinedRings() {
  const size=512,data=new Uint8Array(size*size*4),center=(size-1)/2;
  // Both radial frequencies stay below pi radians per texel. The old 17
  // rad/texel signal aliased into coarse irregular patterns on turned faces.
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4,r=Math.hypot(x-center,y-center),value=Math.round(155+18*Math.sin(r*1.45)+5*Math.sin(r*2.67));data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;}
  const texture=new THREE.DataTexture(data,size,size);texture.anisotropy=8;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}

export function createBrakeAssembly(input = {}, initialView = {}) {
  const settings = normalizeGeometrySettings(input), view = normalizeView(initialView), resources = { geometries:new Set(),materials:new Set(),textures:new Set(),instances:new Set() };
  const group = new THREE.Group(); group.name='generic-brake-assembly';
  const noise=castNoise(), rings=machinedRings(); resources.textures.add(noise);resources.textures.add(rings);
  const material = options => { const value = new THREE.MeshStandardMaterial(options);resources.materials.add(value);return value; };
  const materials = {
    iron:material({color:0x56616a,metalness:.88,roughness:.48,bumpMap:noise,bumpScale:.00038}),
    steel:material({color:0x9caeb9,metalness:.98,roughness:.22}),
    machined:material({color:0xabb8bf,metalness:.98,roughness:.25,bumpMap:rings,bumpScale:.00011}),
    cast:material({color:settings.caliperType==='floating'?0x465459:0x849ca5,metalness:.67,roughness:.64,bumpMap:noise,bumpScale:.00055,roughnessMap:noise}),
    structural:material({color:0x3b4c56,metalness:.61,roughness:.60,bumpMap:noise,bumpScale:.00045}),
    aluminum:material({color:0x91a2ac,metalness:.86,roughness:.36,bumpMap:noise,bumpScale:.00025}),
    black:material({color:0x182229,metalness:.08,roughness:.94}),
    friction:material({color:0x454a48,metalness:.12,roughness:.91,bumpMap:noise,bumpScale:.00018}),
    cut:material({color:0xc86945,metalness:.45,roughness:.56}),
    copper:material({color:0xa96b42,metalness:.83,roughness:.33}),
    fluid:material({color:0xdbac51,metalness:.15,roughness:.34,transparent:true,opacity:.65}),
    sensor:material({color:0x293d49,metalness:.08,roughness:.72}),
    inlet:material({color:0x478886,metalness:.50,roughness:.35}),
    outlet:material({color:0x78545e,metalness:.50,roughness:.35}),
    pump:material({color:0x4b606c,metalness:.85,roughness:.35})
  };
  materials.bearing=material({color:0xc8d3dc,metalness:.98,roughness:.16});
  materials.balls=material({color:0xffffff,metalness:.97,roughness:.14,vertexColors:true});
  materials.cage=material({color:0x978667,metalness:.78,roughness:.34});
  const components = new Map(), dynamics = [], spins=[], cuts=[];
  const makePart = (id, anchor, offset = [0,0,0]) => {
    const node=new THREE.Group();node.name=id;node.userData.componentId=id;group.add(node);
    const labelAnchor=new THREE.Object3D();labelAnchor.position.fromArray(anchor);node.add(labelAnchor);
    components.set(id,{id,node,anchor:labelAnchor,explode:new THREE.Vector3(...offset),...Object.fromEntries(['name','description','material','rotates'].map((key,index)=>[key,PARTS[id][index]]))});
    return node;
  };
  const mesh = (parent,geometry,base=materials.steel,{x=0,y=0,z=0,rotation=null}={}) => {
    resources.geometries.add(geometry); if(geometry.userData.cutFaces)cuts.push(geometry);
    const supplied=Array.isArray(base)?base:[base,base,geometry.userData.cutFaces?materials.cut:base],unique=[];
    for(const entry of geometry.groups){const value=supplied[entry.materialIndex]??supplied[0];if(!unique.includes(value))unique.push(value);entry.materialIndex=unique.indexOf(value);}
    if(!unique.length)unique.push(supplied[0]);
    const combined=[];for(const entry of geometry.groups){const previous=combined.at(-1);if(previous&&previous.materialIndex===entry.materialIndex&&previous.start+previous.count===entry.start)previous.count+=entry.count;else combined.push({...entry});}geometry.groups=combined;
    const node=new THREE.Mesh(geometry,unique.length===1?unique[0]:unique);node.position.set(x,y,z);if(rotation)node.rotation.set(...rotation);
    node.castShadow=true;node.receiveShadow=true;parent.add(node);return node;
  };
  const ring = (parent,inner,outer,back,front,base,position={},start=0,length=TAU,segments=64) => {
    const geometry=createAnnularGeometry(inner,outer,back,front,start,length,segments);
    geometry.userData.radialEndFaces=geometry.userData.cutFaces;
    if(!(section&&length>Math.PI*.80))geometry.userData.cutFaces=0;
    return mesh(parent,geometry,base,position);
  };
  const bolt = (parent,x,y,z,length=.016,radius=.0045) => {
    ring(parent,0,radius*.64,-length/2,length/2,materials.steel,{x,y,z},0,TAU,16);
    const geometry=new THREE.CylinderGeometry(radius,radius,.005,6);geometry.rotateX(Math.PI/2);mesh(parent,geometry,materials.steel,{x,y,z:z+length/2});
  };
  const section=view.mode==='cutaway'&&view.cutaway>0, extent=section?TAU-(.12+.30*view.cutaway)*TAU:TAU;
  const rotorStart=section?Math.PI/2+.10:0, shellStart=section?Math.PI/2:0, shellLength=section?Math.PI+(.5-view.cutaway)*.65:TAU;
  const R=settings.discOuterRadius, I=settings.discInnerRadius, T=settings.discThickness, padR=settings.padMeanRadius, scale=R/.18;
  const plate=Math.min(.0045,T*.24), ventGap=T-2*plate;
  const rotor=makePart('rotor',[R*.78,R*.35,T/2],[0,0,.11]); const rotorSpin=new THREE.Group();rotor.add(rotorSpin);spins.push(rotorSpin);
  ring(rotorSpin,I,R,-T/2,-T/2+plate,[materials.iron,materials.machined,materials.cut],{},rotorStart,extent,96);
  ring(rotorSpin,I,R,T/2-plate,T/2,[materials.iron,materials.machined,materials.cut],{},rotorStart,extent,96);
  let vaneCount=0;
  for(let i=0;i<36;i++) {
    const angle=rotorStart+TAU*(i+.5)/36;
    if(angle+.014>rotorStart+extent)continue;
    const vane=ring(rotorSpin,I+.003,R-.008,-T/2+plate,T/2-plate,materials.iron,{},angle-.013,.026,144);
    vane.userData.role='ventilation-vane';vaneCount++;
  }
  const hatOuter=I+.008,hatInner=Math.max(.022,I*.55),hatHeight=.037;
  mesh(rotorSpin,latheShell([[hatInner,T/2],[hatOuter,T/2-plate],[hatOuter,T/2],[hatInner+.007,hatHeight],[hatInner,hatHeight]],rotorStart,extent),materials.iron);

  const hub=makePart('hub',[.028,-.025,.060],[0,0,.21]);const hubSpin=new THREE.Group();hub.add(hubSpin);spins.push(hubSpin);
  const hubStem=Math.min(.024,hatInner*.8),hubFlange=Math.min(.052,hatOuter-.003);
  ring(hubSpin,0,hubStem,-.130,.046,materials.steel);
  ring(hubSpin,hubStem*.80,hubFlange,.030,.041,materials.machined);
  for(let i=0;i<5;i++){const angle=TAU*i/5;bolt(hubSpin,Math.cos(angle)*hubFlange*.78,Math.sin(angle)*hubFlange*.78,.049,.032,.004);}
  ring(hubSpin,0,.014,.046,.065,materials.steel,{},0,TAU,6);

  const caliper=makePart('caliper',[-.037,padR+.024,-T/2-.043],[.13,.045,.02]);
  const pistons=makePart('pistons',[0,padR,-T/2-.019],[.10,.018,-.14]);
  const seals=makePart('seals',[.028,padR,-T/2-.034],[.10,.02,-.20]);
  const boots=makePart('boots',[-.020,padR,-T/2-.022],[.10,.026,-.25]);
  const gap=.0032,frictionDepth=.009,backing=.004;
  const pads=makePart('pads',[-.020,padR,T/2+.009],[0,.022,.065]);
  const padInner=clamp(padR-.028,I+.003,R-.020),padOuter=clamp(padR+.032,padInner+.012,R-.003);
  const padAngle=Math.min(.79,.104/Math.max(.09,padR));
  for(const side of [-1,1]){
    const sideNode=new THREE.Group();pads.add(sideNode);
    const front=side<0?-T/2-gap:T/2+gap+frictionDepth,back=front-frictionDepth;
    ring(sideNode,padInner,padOuter,back,front,materials.friction,{},Math.PI/2-padAngle/2,padAngle,160);
    const plateZ=side<0?back-backing:front;
    ring(sideNode,padInner-.002,padOuter+.002,plateZ,plateZ+backing,materials.steel,{},Math.PI/2-padAngle/2,padAngle,160);
    dynamics.push({node:sideNode,base:sideNode.position.clone(),kind:'pad',side});
  }
  const diameters=settings.caliperType==='floating'?[settings.pistonDiameter]:settings.fixedPistonDiameters;
  const centers=diameters.length===1?[0]:diameters.length===2?[-.028,.028]:[-.043,0,.043];
  const sides=settings.caliperType==='floating'?[-1]:[-1,1];
  let pistonCount=0;
  for(const side of sides)for(let index=0;index<diameters.length;index++){
    const radius=diameters[index]/2,x=centers[index],cylinderFront=side*(T/2+gap+frictionDepth+backing+.010),cylinderBack=side*(T/2+gap+frictionDepth+backing+.045);
    ring(caliper,radius+.0007,radius+.009,Math.min(cylinderBack,cylinderFront),Math.max(cylinderBack,cylinderFront),[materials.cast,materials.machined,materials.cut],{x,y:padR},shellStart,shellLength,64);
    const closedEnd=side<0?cylinderBack-.005:cylinderBack;
    ring(caliper,0,radius+.009,closedEnd,closedEnd+.005,materials.cast,{x,y:padR},shellStart,shellLength,64);
    const pistonNode=new THREE.Group();pistons.add(pistonNode);
    const face=side*(T/2+gap+frictionDepth+backing),rear=face+side*.025;
    ring(pistonNode,Math.max(.006,radius-.004),radius,Math.min(rear,face),Math.max(rear,face),materials.steel,{x,y:padR},shellStart,shellLength,64);
    ring(pistonNode,0,radius,side<0?face-.004:face,side<0?face:face+.004,materials.machined,{x,y:padR},shellStart,shellLength,64);
    dynamics.push({node:pistonNode,base:pistonNode.position.clone(),kind:'piston',side});pistonCount++;
    const sealZ=cylinderFront+side*.005;
    ring(seals,radius-.00035,radius+.0023,sealZ-.0014,sealZ+.0014,materials.black,{x,y:padR},shellStart,shellLength,64);
    const bootEnd=face+side*.0005,bootStart=cylinderFront-side*.002;
    const low=Math.min(bootStart,bootEnd),high=Math.max(bootStart,bootEnd),profile=[];
    for(let step=0;step<=8;step++)profile.push([radius+.001+(step%2?.0033:0),low+(high-low)*step/8]);
    profile.push([radius+.0002,high],[radius+.0002,low]);
    const boot=mesh(boots,latheShell(profile,shellStart,shellLength,48),materials.black,{x,y:padR});
    dynamics.push({node:boot,base:boot.position.clone(),kind:'boot',side,low,high,original:boot.geometry.attributes.position.array.slice()});
  }
  const bridgeInner=padOuter+.003,bridgeOuter=R+.029*scale,bridgeBack=-T/2-.034,bridgeFront=T/2+.025;
  const bridgePoints=[[bridgeBack,padInner-.004],[bridgeBack-.013,bridgeOuter-.027],[bridgeBack-.005,bridgeOuter],[bridgeFront+.010,bridgeOuter],[bridgeFront+.013,padInner-.004],[bridgeFront-.005,padInner-.004],[bridgeFront-.005,bridgeInner],[bridgeBack+.006,bridgeInner],[bridgeBack+.006,padInner-.004]];
  const bridgeWidth=.014;
  for(const x of section?[-.050]:[-.050,.036]){
    const geometry=extrudedPolygon(bridgePoints.map(([z,y])=>[-z,y]),bridgeWidth,0);
    geometry.rotateY(Math.PI/2);geometry.translate(x,0,0);mesh(caliper,geometry,materials.cast);
  }
  const webPoints=[[-.061,bridgeOuter-.024],[-.041,bridgeOuter+.002],[.041,bridgeOuter+.002],[.061,bridgeOuter-.024],[.043,bridgeInner],[-.043,bridgeInner]];
  mesh(caliper,extrudedPolygon(section?clipLeft(webPoints):webPoints,.013,bridgeBack-.006),materials.cast);
  if(settings.caliperType==='fixed')mesh(caliper,extrudedPolygon(section?clipLeft(webPoints):webPoints,.013,bridgeFront-.006),materials.cast);
  for(const x of section?[-.040]:[-.040,.040]){
    const rib=[[-.004,padR+.025],[.004,padR+.025],[.006,bridgeOuter-.009],[-.006,bridgeOuter-.003]];
    mesh(caliper,extrudedPolygon(rib,.004,bridgeBack-.010),materials.cast,{x});
    bolt(caliper,x,bridgeOuter-.015,bridgeBack-.013,.007,.005);
  }

  const bracket=makePart('bracket',[-.064,padR-.041,-T/2-.024],[0,-.055,-.07]);
  const bracketShape=[[-.076,padR-.043],[-.078,padR+.035],[-.052,padR+.045],[-.043,padR+.006],[.043,padR+.006],[.052,padR+.045],[.078,padR+.035],[.076,padR-.043],[.053,padR-.055],[.044,padR-.015],[-.044,padR-.015],[-.053,padR-.055]];
  mesh(bracket,extrudedPolygon(bracketShape,.016,-T/2-.025,[[-.062,padR-.033,.005],[.062,padR-.033,.005]]),materials.structural);
  for(const x of [-.062,.062])bolt(bracket,x,padR-.033,-T/2-.047,.038,.007);
  const hardware=makePart('pad-hardware',[.046,padR+.041,T/2+.021],[0,.11,.025]);
  if(settings.caliperType==='fixed')for(const y of [padInner+.006,padOuter-.006]){
    ring(hardware,0,.0026,-T/2-.041,T/2+.041,materials.steel,{x:-.040,y},0,TAU,16);
    ring(hardware,0,.0026,-T/2-.041,T/2+.041,materials.steel,{x:.040,y},0,TAU,16);
  }
  else for(const x of [-.055,.055])mesh(hardware,extrudedPolygon([[x-.007,padR+.006],[x-.006,padR+.033],[x+.005,padR+.039],[x+.007,padR+.028],[x-.003,padR+.025],[x-.003,padR+.007]],.0011,-T/2-.014),materials.steel);
  const pinPart=makePart('slide-pins',[.064,padR+.023,-.038],[.10,.07,-.05]);pinPart.visible=settings.caliperType==='floating';
  if(pinPart.visible)for(const x of [-.064,.064]){
    ring(pinPart,0,.0052,-T/2-.067,T/2+.008,materials.machined,{x,y:padR+.022},0,TAU,24);
    ring(bracket,.0055,.010,-T/2-.035,-T/2-.011,materials.structural,{x,y:padR+.022},0,TAU,32);
    for(let step=0;step<4;step++)ring(boots,.0055,.0088,-T/2-.036-step*.003,-T/2-.034-step*.003,materials.black,{x,y:padR+.022},0,TAU,24);
    bolt(pinPart,x,padR+.022,-T/2-.068,.009,.0065);
  }

  const knuckle=makePart('knuckle',[-.042,.048,-.110],[0,0,-.17]);
  const knuckleShape=[[-.069,-.055],[-.054,.065],[-.068,padR-.043],[-.055,padR-.012],[-.028,.050],[.028,.050],[.055,padR-.012],[.068,padR-.043],[.054,.065],[.069,-.055],[.034,-.078],[-.034,-.078]];
  mesh(knuckle,extrudedPolygon(knuckleShape,.018,-.105,[[0,0,.041],[-.059,padR-.036,.005],[.059,padR-.036,.005]]),materials.structural);
  ring(knuckle,.0407,.055,-.124,-.064,materials.structural,{},shellStart,shellLength,64);
  const bearing=makePart('bearing',[.031,-.022,-.078],[0,0,-.11]);
  const bearingRows=[],bearingPitch=.0321,bearingBallRadius=.0048;
  const ballGeometry=new THREE.SphereGeometry(bearingBallRadius,20,14),ballColors=[];
  for(let i=0;i<ballGeometry.attributes.position.count;i++){const color=new THREE.Color(Math.abs(ballGeometry.attributes.position.getY(i))<bearingBallRadius*.10?0x61788a:0xd5dce2);ballColors.push(color.r,color.g,color.b);}
  ballGeometry.setAttribute('color',new THREE.Float32BufferAttribute(ballColors,3));resources.geometries.add(ballGeometry);
  const cageBarGeometry=new THREE.CylinderGeometry(.00055,.00055,.0102,8);cageBarGeometry.rotateX(Math.PI/2);resources.geometries.add(cageBarGeometry);
  const instance=(geometry,base,role,z)=>{const node=new THREE.InstancedMesh(geometry,base,12);node.position.z=z;node.userData.role=role;node.castShadow=true;node.receiveShadow=true;node.instanceMatrix.setUsage(THREE.DynamicDrawUsage);node.boundingSphere=new THREE.Sphere(new THREE.Vector3(),bearingPitch+.007);bearing.add(node);resources.instances.add(node);return node;};
  const bearingRace=(outer,z)=>{
    const groove=bearingBallRadius*1.07,half=.006,edge=.00045,span=.0033,sign=outer?1:-1;
    const center=bearingPitch-sign*(groove-bearingBallRadius),track=x=>center+sign*Math.sqrt(groove*groove-x*x)+sign*.000035;
    const backRadius=outer?.0405:hubStem+.0001,shoulder=track(span);
    const profile=[[shoulder+sign*edge,-half],[shoulder,-half+edge],[shoulder,-span]];
    for(let i=1;i<=20;i++){const axial=-span+2*span*i/20;profile.push([track(axial),axial]);}
    profile.push([shoulder,half-edge],[shoulder+sign*edge,half],[backRadius-sign*edge,half],[backRadius,half-edge],[backRadius,-half+edge],[backRadius-sign*edge,-half]);
    if(outer)profile.reverse();
    const geometry=latheShell(profile,shellStart,shellLength,128),p=geometry.attributes.position,n=geometry.attributes.normal;
    // Smooth only circumferential normals; profile edges and cut faces stay crisp.
    for(const group of geometry.groups)if(group.materialIndex!==2)for(let i=group.start;i<group.start+group.count;i++){
      const radius=Math.hypot(p.getX(i),p.getY(i)),radial=Math.hypot(n.getX(i),n.getY(i))*Math.sign(n.getX(i)*p.getX(i)+n.getY(i)*p.getY(i));
      if(radius>0)n.setXYZ(i,radial*p.getX(i)/radius,radial*p.getY(i)/radius,n.getZ(i));
    }
    geometry.userData.role=outer?'bearing-outer-race':'bearing-inner-race';geometry.userData.grooveRadius=groove;geometry.userData.contactRadius=bearingPitch+sign*bearingBallRadius;
    const node=mesh(bearing,geometry,materials.bearing,{z});node.userData.role=geometry.userData.role;return node;
  };
  for(const [row,z] of [-.106,-.071].entries()){
    bearingRace(true,z);bearingRace(false,z);
    const balls=instance(ballGeometry,materials.balls,'bearing-balls',z),bars=instance(cageBarGeometry,materials.cage,'bearing-cage-bars',z);
    for(const side of [-1,1])ring(bearing,bearingPitch-.0007,bearingPitch+.0007,z+side*.0057-.0004,z+side*.0057+.0004,materials.cage,{},shellStart,shellLength,96);
    bearingRows.push({z,offset:row*Math.PI/12,balls,bars,firstBallPosition:null,firstBallSpin:0});
    if(!section)ring(bearing,.0287,.0356,z+.0064,z+.0071,materials.black,{},0,TAU,64);
  }
  const encoder=makePart('encoder',[.041,-.025,-.132],[0,0,-.26]);const encoderSpin=new THREE.Group();encoder.add(encoderSpin);spins.push(encoderSpin);
  ring(encoderSpin,.025,.047,-.135,-.130,materials.steel);
  for(let i=0;i<ENCODER_TEETH;i++){const angle=TAU*i/ENCODER_TEETH;ring(encoderSpin,.045,.051,-.135,-.130,materials.steel,{},angle,.055,128);}
  const sensor=makePart('sensor',[.061,-.030,-.132],[.095,-.05,-.16]);
  mesh(sensor,extrudedPolygon([[.045,-.045],[.073,-.045],[.082,-.030],[.073,-.016],[.047,-.016]],.016,-.141,[[.073,-.030,.0025]]),materials.sensor);
  ring(sensor,0,.0044,-.133,-.123,materials.steel,{x:.053,y:-.030},0,TAU,24);
  const sensorCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(.072,-.032,-.136),new THREE.Vector3(.114,-.053,-.151),new THREE.Vector3(.116,-.100,-.161),new THREE.Vector3(.059,-.145,-.17)]);
  mesh(sensor,new THREE.TubeGeometry(sensorCurve,24,.0025,6,false),materials.black);

  const hcu=makePart('hydraulic-unit',[-.238,.106,-.019],[-.09,.02,0]),hcuCenter=new THREE.Vector3(-.239,.110,-.038);
  const hcuShape=[[-.039,-.027],[-.033,-.035],[.031,-.035],[.039,-.027],[.039,.026],[.031,.035],[-.031,.035],[-.039,.027]];
  mesh(hcu,extrudedPolygon(hcuShape,section?.023:.046,-.023,[[-.018,0,.009],[.018,0,.009]]),materials.aluminum,{x:hcuCenter.x,y:hcuCenter.y,z:hcuCenter.z});
  const valves=makePart('valves',[-.239,.108,-.005],[-.09,.085,.06]);
  const valveNodes=[];
  for(const [index,x] of [-.018,.018].entries()){
    const node=new THREE.Group();node.position.set(hcuCenter.x+x,hcuCenter.y,hcuCenter.z);valves.add(node);
    ring(node,.0052,.0088,-.021,.025,index?materials.outlet:materials.inlet,{},shellStart,shellLength,32);
    const seatZ=-.010,plunger=new THREE.Group();node.add(plunger);
    const seat=mesh(node,latheShell([[.0025,seatZ-.003],[.006,seatZ-.003],[.006,seatZ+.004],[.0044,seatZ+.004],[.0025,seatZ]],shellStart,shellLength,64),materials.machined);seat.userData.role='valve-seat';
    const cone=new THREE.CylinderGeometry(.0044,.0025,.004,32);cone.rotateX(Math.PI/2);
    mesh(plunger,cone,materials.bearing,{z:seatZ+.002});
    ring(plunger,0,.0044,seatZ+.004,.018,materials.steel,{},0,TAU,32);
    ring(plunger,0,.0023,.018,.032,materials.bearing,{},0,TAU,24);
    const helix=new THREE.CatmullRomCurve3(Array.from({length:97},(_,step)=>{const a=step/96*TAU*6;return new THREE.Vector3(Math.cos(a)*.0037,Math.sin(a)*.0037,step/96*.014);}));
    const spring=mesh(node,new THREE.TubeGeometry(helix,96,.0004,6,false),materials.steel,{z:.018});spring.userData.role='valve-return-spring';
    ring(node,.0025,.0048,.032,.033,materials.machined,{},shellStart,shellLength,32);
    ring(node,.0088,.012,.008,.027,materials.copper,{},shellStart,shellLength,48);
    for(const z of [.007,.027])ring(node,.0086,.0126,z,z+.0012,materials.black,{},shellStart,shellLength,48);
    valveNodes.push({plunger,spring,seatZ,openLift:.003,index});
  }
  const pump=makePart('pump',[-.239,.060,-.037],[-.09,-.065,0]);
  const pumpPosition={x:hcuCenter.x,y:hcuCenter.y-.054,z:hcuCenter.z};
  ring(pump,.015,.023,-.029,.028,materials.pump,pumpPosition,shellStart,shellLength,64);
  ring(pump,0,.006,-.033,.034,materials.bearing,pumpPosition,0,TAU,32);
  for(const z of [-.029,.024])ring(pump,.0062,.015,z,z+.004,materials.machined,pumpPosition,shellStart,shellLength,48);
  for(let i=0;i<8;i++){const a=TAU*i/8;if(section&&((a-shellStart+TAU)%TAU)>shellLength-.2)continue;ring(pump,.008,.0138,-.023,.022,materials.copper,pumpPosition,a,.48,64);}
  for(const x of [-.262,-.216])bolt(hcu,x,.110,-.058,.048,.0045);
  const hose=makePart('hose',[-.086,.222,-.053],[0,.14,.015]);
  const hoseEnd=new THREE.Vector3(-.012,bridgeOuter-.006,-T/2-.043);
  const hoseCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(hcuCenter.x+.039,hcuCenter.y+.018,hcuCenter.z),new THREE.Vector3(-.159,.223,-.069),new THREE.Vector3(-.043,.253,-.073),hoseEnd]);
  const hoseMesh=mesh(hose,new THREE.TubeGeometry(hoseCurve,40,.0038,8,false),materials.black);
  for(const endpoint of [new THREE.Vector3(hcuCenter.x+.039,hcuCenter.y+.018,hcuCenter.z),hoseEnd])ring(hose,0,.0062,-.008,.008,materials.steel,{x:endpoint.x,y:endpoint.y,z:endpoint.z},0,TAU,6);
  const bleeder=makePart('bleeder',[.022,padR+.035,-T/2-.043],[.08,.09,-.02]);
  ring(bleeder,0,.0042,-.010,.010,materials.steel,{x:.022,y:padR+.034,z:-T/2-.040},0,TAU,6);
  ring(bleeder,0,.0050,.010,.016,materials.black,{x:.022,y:padR+.034,z:-T/2-.040},0,TAU,24);
  const flowCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.257,.110,-.040),new THREE.Vector3(-.239,.110,-.028),new THREE.Vector3(-.221,.110,-.040)]);
  if(section)mesh(hcu,new THREE.TubeGeometry(flowCurve,16,.0022,6,false),materials.fluid);

  // Static repeated metal is packed; independently moving pistons, boots and valves stay separate.
  const movingNodes=new Set([...dynamics.map(entry=>entry.node),...valveNodes.flatMap(entry=>[entry.plunger,entry.spring]),hoseMesh]);
  group.traverse(parent=>{
    if(!parent.isGroup)return;
    const batches=new Map();
    for(const child of parent.children){if(!child.isMesh||child.isInstancedMesh||movingNodes.has(child)||Array.isArray(child.material))continue;const batch=batches.get(child.material)??[];batch.push(child);batches.set(child.material,batch);}
    for(const [base,nodes] of batches){
      if(nodes.length<2)continue;
      const temporary=nodes.map(node=>{node.updateMatrix();const geometry=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();geometry.applyMatrix4(node.matrix);return geometry;});
      const merged=mergeGeometries(temporary,false);for(const geometry of temporary)geometry.dispose();if(!merged)continue;
      merged.userData={kind:'packed-static-metal',sourceMeshes:nodes.length,roles:nodes.flatMap(node=>node.userData.role?[node.userData.role]:[])};
      for(const node of nodes){parent.remove(node);resources.geometries.delete(node.geometry);node.geometry.dispose();}
      const packed=mesh(parent,merged,base);packed.userData.packedCount=nodes.length;
    }
  });

  for(const part of components.values())part.structuralVisible=part.node.visible;
  let currentSnapshot={},currentView=view,disposed=false,lastWheelAngle=0,lastPressure=0;
  const update = (snapshot = {}, nextView = currentView) => {
    if(disposed)return;
    currentSnapshot={...snapshot};currentView=normalizeView({...currentView,...nextView});
    const exploded=currentView.mode==='exploded'?currentView.explode:0;
    for(const part of components.values())part.node.position.copy(part.explode).multiplyScalar(exploded);
    lastWheelAngle=finite(snapshot.wheelAngle,lastWheelAngle);lastPressure=Math.max(0,finite(snapshot.pressure,0));
    for(const spin of spins)spin.rotation.z=lastWheelAngle;
    const bearingMotion=hubBearingKinematics({wheelAngle:lastWheelAngle,wheelOmega:finite(snapshot.wheelOmega,0)}),instanceMatrix=new THREE.Matrix4();
    const retained=(angle,radius)=>!section||((angle-shellStart)%TAU+TAU)%TAU>=Math.asin(radius/bearingPitch)&&((angle-shellStart)%TAU+TAU)%TAU<=shellLength-Math.asin(radius/bearingPitch);
    for(const row of bearingRows){
      let balls=0,bars=0;row.firstBallPosition=null;
      for(let i=0;i<12;i++){
        const start=TAU*i/12+row.offset,angle=start+bearingMotion.cageAngle,x=bearingPitch*Math.cos(angle),y=bearingPitch*Math.sin(angle);
        if(retained(angle,bearingBallRadius)){instanceMatrix.makeRotationZ(start+bearingMotion.ballWorldAngle);instanceMatrix.setPosition(x,y,0);row.balls.setMatrixAt(balls++,instanceMatrix);if(!row.firstBallPosition){row.firstBallPosition=[x,y,row.z];row.firstBallSpin=start+bearingMotion.ballWorldAngle;}}
        const barAngle=angle+Math.PI/12;if(retained(barAngle,.00055)){instanceMatrix.makeTranslation(bearingPitch*Math.cos(barAngle),bearingPitch*Math.sin(barAngle),0);row.bars.setMatrixAt(bars++,instanceMatrix);}
      }
      row.balls.count=balls;row.bars.count=bars;row.balls.instanceMatrix.needsUpdate=true;row.bars.instanceMatrix.needsUpdate=true;
    }
    const activity=clamp(lastPressure/8e6,0,1),travel=gap*activity;
    if(settings.caliperType==='floating')for(const id of ['caliper','seals','boots','bleeder'])components.get(id).node.position.z-=travel;
    for(const entry of dynamics){
      entry.node.position.copy(entry.base);
      if(entry.kind!=='boot'){entry.node.position.z-=entry.side*travel;continue;}
      const buffer=entry.node.geometry.attributes.position,extension=travel*(settings.caliperType==='floating'?2:1);
      for(let i=0;i<buffer.count;i++){
        const z=entry.original[i*3+2],weight=entry.side<0?(z-entry.low)/(entry.high-entry.low):(entry.high-z)/(entry.high-entry.low);
        buffer.setZ(i,z-entry.side*extension*clamp(weight,0,1));
      }
      buffer.needsUpdate=true;entry.node.geometry.computeVertexNormals();entry.node.geometry.computeBoundingSphere();
    }
    // The flexible hose end follows the sliding body without creating new buffers each frame.
    const positions=hoseMesh.geometry.attributes.position,uv=hoseMesh.geometry.attributes.uv;
    if(!hoseMesh.userData.originalPositions)hoseMesh.userData.originalPositions=positions.array.slice();
    for(let i=0;i<positions.count;i++)positions.setZ(i,hoseMesh.userData.originalPositions[i*3+2]-(settings.caliperType==='floating'?travel:0)*clamp((uv.getX(i)-.72)/.28,0,1));
    positions.needsUpdate=true;hoseMesh.geometry.computeBoundingSphere();
    materials.inlet.emissive.setHex(snapshot.inletOpen===false?0x000000:0x1c7770);materials.inlet.emissiveIntensity=snapshot.inletOpen===false?0:.30;
    materials.outlet.emissive.setHex(snapshot.outletOpen?0xa23b40:0x000000);materials.outlet.emissiveIntensity=snapshot.outletOpen?.50:0;
    materials.pump.emissive.setHex(snapshot.pumpActive?0x4271a2:0x000000);materials.pump.emissiveIntensity=snapshot.pumpActive?.30:0;
    for(const valve of valveNodes){const open=valve.index?snapshot.outletOpen===true:snapshot.inletOpen!==false,lift=open?valve.openLift:0;valve.plunger.position.z=lift;valve.spring.position.z=.018+lift;valve.spring.scale.z=(.014-lift)/.014;}
    group.updateMatrixWorld(true);
  };
  const getComponents = () => [...components.values()].map(({id,name,description,material,rotates,structuralVisible})=>({id,name,label:name,description,material,rotates,visible:structuralVisible}));
  const getDiagnostics = () => {
    let triangles=0,meshes=0;group.traverse(node=>{if(node.isMesh){meshes++;triangles+=(node.geometry.index?.count??node.geometry.attributes.position.count)/3*(node.isInstancedMesh?node.count:1);}});
    const sideArea=diameters.reduce((area,diameter)=>area+Math.PI*(diameter/2)**2,0);
    return {units:'m',axle:'+Z',mode:currentView.mode,caliperType:settings.caliperType,disposed,triangles,meshes,geometries:disposed?0:resources.geometries.size,materials:disposed?0:resources.materials.size,textures:disposed?0:resources.textures.size,representation:getGeometryRepresentation(input),
      rotor:{outerRadius:R,innerRadius:I,thickness:T,plateThickness:plate,ventGap,vanes:vaneCount,cutFaces:cuts.length*2},
      caliper:{pistonCount,diametersPerSide:[...diameters],pistonAreaPerSide:sideArea,wallThickness:.009,floatingSlide:settings.caliperType==='floating'},
      actuation:{illustrative:true,expandedRestGap:gap,pressurePa:lastPressure,bodySlide:settings.caliperType==='floating'?-gap*clamp(lastPressure/8e6,0,1):0},
      rotation:{wheelAngle:lastWheelAngle,rotor:rotorSpin.rotation.z,hub:hubSpin.rotation.z,encoder:encoderSpin.rotation.z},
      bearing:{...hubBearingKinematics({wheelAngle:lastWheelAngle,wheelOmega:finite(currentSnapshot.wheelOmega,0)}),cutFrame:'stationary',rows:bearingRows.map(row=>({z:row.z,visibleBalls:row.balls.count,firstBallPosition:row.firstBallPosition?.slice()??null,firstBallSpin:row.firstBallSpin}))},
      encoder:{teeth:ENCODER_TEETH,pulseHz:Math.abs(finite(currentSnapshot.wheelOmega,0))*ENCODER_TEETH/TAU},
      hydraulics:{illustrativeTravel:true,inlet:{open:currentSnapshot.inletOpen!==false,lift:valveNodes[0].plunger.position.z,seatZ:valveNodes[0].seatZ,tipZ:valveNodes[0].seatZ+valveNodes[0].plunger.position.z},outlet:{open:currentSnapshot.outletOpen===true,lift:valveNodes[1].plunger.position.z,seatZ:valveNodes[1].seatZ,tipZ:valveNodes[1].seatZ+valveNodes[1].plunger.position.z},pumpActive:currentSnapshot.pumpActive===true,pumpSpeedModeled:false},
      snapshot:{pressure:finite(currentSnapshot.pressure,0),clampForce:finite(currentSnapshot.clampForce,0),padNormalForce:currentSnapshot.padNormalForce??null,absPhase:currentSnapshot.absPhase??'off',slip:currentSnapshot.slip??null},componentIds:[...components.keys()]};
  };
  const dispose = () => {if(disposed)return;disposed=true;for(const resource of [...resources.instances,...resources.geometries,...resources.materials,...resources.textures])resource.dispose();};
  update({},view);
  return {group,components,settings,view,update,getComponents,getDiagnostics,dispose};
}

export function createBrakeScene(host, { onSelect = () => {} } = {}) {
  if(!host?.appendChild)throw new TypeError('A scene host element is required');
  host.classList.add('brake-scene');
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x17212b);
  const camera=new THREE.PerspectiveCamera(38,1,.005,12);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.domElement.setAttribute('aria-label','브레이크와 ABS 조립 구조 3D 관찰');host.appendChild(renderer.domElement);
  const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.035);scene.environment=environment.texture;scene.environmentIntensity=.90;room.dispose();pmrem.dispose();
  const hemisphere=new THREE.HemisphereLight(0xc7d9e8,0x1d2a31,.50);scene.add(hemisphere);
  const key=new THREE.DirectionalLight(0xffe9d0,2.2);key.position.set(-.25,.60,.65);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=key.shadow.camera.bottom=-.8;key.shadow.camera.right=key.shadow.camera.top=.8;key.shadow.camera.near=.1;key.shadow.camera.far=3;key.shadow.normalBias=.0008;scene.add(key);
  const fill=new THREE.DirectionalLight(0xa7c7df,.70);fill.position.set(.6,.18,-.45);scene.add(fill);
  const floorGeometry=new THREE.CircleGeometry(.48,96),floorMaterial=new THREE.MeshStandardMaterial({color:0x182630,metalness:.15,roughness:.84});
  const floor=new THREE.Mesh(floorGeometry,floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-.207;floor.receiveShadow=true;scene.add(floor);
  const grid=new THREE.GridHelper(.85,17,0x314650,0x263841);grid.position.y=-.2065;grid.material.transparent=true;grid.material.opacity=.12;scene.add(grid);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.12;controls.minDistance=.06;controls.maxDistance=2.6;controls.target.set(-.033,.035,0);
  const labels=document.createElement('div');labels.className='brake-scene-labels';host.appendChild(labels);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('brake-scene-leaders');svg.setAttribute('aria-hidden','true');host.appendChild(svg);
  const note=document.createElement('div');note.className='brake-scene-note';note.textContent='피스톤·캘리퍼 이동 간격은 확대한 작동 표현';host.appendChild(note);
  const stateBadge=document.createElement('div');stateBadge.className='brake-scene-state';host.appendChild(stateBadge);
  const rangeNote=document.createElement('div');rangeNote.className='brake-scene-range-note';rangeNote.setAttribute('role','status');rangeNote.hidden=true;host.appendChild(rangeNote);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),labelNodes=new Map();
  let settings={},snapshot={},view=normalizeView(),assembly=createBrakeAssembly(settings,view),disposed=false,width=1,height=1,raf=0,dirty=true,buildCount=1,renderCount=0,dragStart=null,signature='',selectionHighlight=null,highlightedId=null,autoFraming=true,needsFit=true,framing=null;
  let inspection=null;
  scene.add(assembly.group);
  const geometrySignature=()=>JSON.stringify([normalizeGeometrySettings(settings),view.mode==='cutaway',view.mode==='cutaway'?Math.round(view.cutaway*100)/100:0]);
  signature=geometrySignature();
  const cameras={isometric:[.36,.23,.73],front:[0,0,1],rear:[-.12,.14,-1],side:[1,.15,.015],top:[.01,1,.06]};
  function frameSubject(subject=assembly.group,direction=cameras[view.camera]){framing=fitBrakeCamera(camera,subject,{aspect:width/height,direction:new THREE.Vector3(...direction),fill:.72});controls.target.copy(framing.target);controls.update();dirty=true;}
  function setCamera(name='isometric'){view.camera=cameras[name]?name:'isometric';autoFraming=true;frameSubject();needsFit=false;}
  function applyInspection(){
    if(!inspection)return;
    const part=assembly.components.get(inspection.partId);if(!part?.structuralVisible){restoreInspection();return;}
    const visible=new Set([inspection.partId,...(inspection.partId==='valves'?['hydraulic-unit']:[])]);
    for(const item of assembly.components.values())item.node.visible=item.structuralVisible&&visible.has(item.id);
    floor.visible=false;grid.visible=false;
    note.textContent=inspection.partId==='bearing'?'접촉각 0° · 미끄럼 없는 대표 베어링 운동':inspection.partId==='valves'?'밸브 이동량은 확대한 작동 표현':inspection.partId==='pump'?'펌프는 계산된 가동 상태만 표시 · 회전수 미지정':'대표 부품 형상 · 제조용 CAD 아님';
  }
  function inspectPart(id){
    const part=assembly.components.get(id);if(disposed||!part?.structuralVisible)return false;
    if(!inspection)inspection={partId:id,position:camera.position.clone(),quaternion:camera.quaternion.clone(),target:controls.target.clone(),camera:view.camera,autoFraming,framing,visibility:new Map([...assembly.components].map(([key,value])=>[key,value.node.visible])),floor:floor.visible,grid:grid.visible};
    else inspection.partId=id;
    selectionHighlight?.dispose();selectionHighlight=null;highlightedId=null;view.selectedPart=id;
    applyInspection();autoFraming=true;frameSubject(assembly.group,id==='bearing'?[.65,.18,1]:id==='valves'?[.7,.15,1]:cameras[view.camera]);needsFit=false;updateSelection();dirty=true;return true;
  }
  function restoreInspection(){
    if(!inspection||disposed)return false;const saved=inspection;inspection=null;
    // A geometry rebuild can add formerly absent parts, such as slide pins
    // when switching from fixed to floating. Restore the current structure.
    for(const part of assembly.components.values())part.node.visible=part.structuralVisible;
    floor.visible=saved.floor;grid.visible=saved.grid;note.textContent='피스톤·캘리퍼 이동 간격은 확대한 작동 표현';const damping=controls.enableDamping;controls.enableDamping=false;controls.update();camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);controls.target.copy(saved.target);view.camera=saved.camera;autoFraming=saved.autoFraming;framing=saved.framing;needsFit=false;controls.update();controls.enableDamping=damping;camera.updateMatrixWorld(true);
    selectionHighlight?.dispose();selectionHighlight=null;highlightedId=null;updateSelection();dirty=true;return true;
  }
  function syncLabels(){
    for(const value of labelNodes.values()){value.button.remove();value.line.remove();}labelNodes.clear();
    for(const part of assembly.components.values()){
      const button=document.createElement('button');button.type='button';button.className='brake-part-label';button.dataset.partId=part.id;button.textContent=part.name;button.setAttribute('aria-label',`${part.name} 구조 선택`);
      button.addEventListener('click',()=>select(part.id));labels.appendChild(button);
      const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('fill','none');svg.appendChild(line);labelNodes.set(part.id,{button,line,part});
    }
  }
  function select(id){if(!assembly.components.has(id))return;view.selectedPart=id;updateSelection();dirty=true;onSelect(id);}
  function updateSelection(){
    if(highlightedId!==view.selectedPart){selectionHighlight?.dispose();selectionHighlight=highlightBrakePart(assembly,view.selectedPart);highlightedId=view.selectedPart;}
    selectionHighlight?.refresh();
    for(const [id,{button}] of labelNodes)button.setAttribute('aria-pressed',String(id===view.selectedPart));
  }
  function updateLabels(){
    labels.hidden=!view.labels;svg.style.display=view.labels?'':'none';if(!view.labels)return;
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const priority=['rotor','caliper','pads','pistons','hub','bearing','hydraulic-unit','sensor','seals','boots','slide-pins','hose','valves','pump','encoder','bleeder','bracket','pad-hardware','knuckle'];
    if(view.selectedPart){const index=priority.indexOf(view.selectedPart);if(index>=0)priority.splice(index,1);priority.unshift(view.selectedPart);}
    const max=width<480?6:8,candidates=[];
    for(const [id,entry] of labelNodes){
      const vector=entry.part.anchor.getWorldPosition(new THREE.Vector3()).project(camera),selected=view.selectedPart===id;
      const eligible=entry.part.node.visible&&vector.z>-1&&vector.z<1&&priority.indexOf(id)<max;
      entry.button.hidden=!eligible;entry.line.style.display=eligible?'':'none';if(!eligible)continue;
      const x=(vector.x*.5+.5)*width,y=(-vector.y*.5+.5)*height;
      candidates.push({...entry,id,x,y,selected,priority:priority.indexOf(id)});
    }
    const placements=layoutBrakeLabels(candidates,width,height),retained=new Set(placements.map(entry=>entry.id));
    for(const entry of candidates)if(!retained.has(entry.id)){entry.button.hidden=true;entry.line.style.display='none';}
    for(const entry of placements){
      entry.button.style.width=`${entry.width}px`;entry.button.style.left=`${entry.left}px`;entry.button.style.top=`${entry.top}px`;
      entry.line.setAttribute('points',`${entry.anchorX},${entry.anchorY} ${entry.kneeX},${entry.y} ${entry.edgeX},${entry.y}`);entry.line.classList.toggle('selected',entry.selected);
    }
    labels.dataset.visibleCount=String(placements.length);
  }
  function applyQuality(){const high=view.quality==='high',low=view.quality==='low';renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,low?1:high?1.75:1.35));renderer.shadowMap.enabled=!low;key.shadow.mapSize.set(high?2048:1024,high?2048:1024);}
  function rebuildIfNeeded(){const next=geometrySignature();if(next===signature)return;selectionHighlight?.dispose();selectionHighlight=null;highlightedId=null;const old=assembly;assembly=createBrakeAssembly(settings,view);scene.remove(old.group);old.dispose();scene.add(assembly.group);signature=next;buildCount++;syncLabels();applyInspection();needsFit=true;}
  function updateRangeNote(){const representation=getGeometryRepresentation(settings);rangeNote.hidden=!representation.representative;rangeNote.textContent='일부 치수는 대표 형상 · 계산값 유지';rangeNote.title=representation.changes.map(change=>`${change.label}: 계산 ${change.requested} → 그림 ${change.rendered}${change.field.includes('Count')?'개/측':' m'}`).join('\n');host.dataset.representativeGeometry=String(representation.representative);}
  function setState(nextSnapshot={},nextSettings=settings,nextView){if(disposed)return;const oldMode=view.mode;snapshot={...nextSnapshot};settings={...nextSettings};if(nextView)view=normalizeView({...view,...nextView});rebuildIfNeeded();assembly.update(snapshot,view);if((needsFit&&autoFraming)||oldMode!==view.mode)setCamera(view.camera);updateSelection();updateRangeNote();const phases={increase:'압력 증가',hold:'압력 유지',decrease:'감압',off:'ABS 꺼짐','low-speed':'정지 근처',stopped:'정지'};stateBadge.textContent=`${(Math.max(0,finite(snapshot.pressure,0))/1e5).toFixed(1)} bar · ${phases[snapshot.absPhase]??'대기'}`;dirty=true;}
  function setView(partial={}){if(disposed)return;const oldQuality=view.quality,oldMode=view.mode;view=normalizeView({...view,...partial});rebuildIfNeeded();assembly.update(snapshot,view);updateSelection();if(partial.camera||oldMode!==view.mode||needsFit&&autoFraming)setCamera(view.camera);if(view.quality!==oldQuality){applyQuality();resize();}dirty=true;}
  function resize(){if(disposed)return;width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);if(autoFraming)frameSubject();dirty=true;}
  function focus(id){const part=assembly.components.get(id);if(!part?.structuralVisible)return false;view.selectedPart=id;updateSelection();dirty=true;return true;}
  function render(){if(disposed)return;const changed=controls.update();if(dirty||changed){renderer.render(scene,camera);updateLabels();renderCount++;dirty=false;}raf=requestAnimationFrame(render);}
  function pointerDown(event){dragStart={x:event.clientX,y:event.clientY};}
  function pointerUp(event){if(!dragStart||Math.hypot(event.clientX-dragStart.x,event.clientY-dragStart.y)>5){dragStart=null;return;}dragStart=null;const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(assembly.group,true).find(value=>{for(let node=value.object;node;node=node.parent)if(!node.visible)return false;return value.object.isMesh;});if(!hit)return;let node=hit.object;while(node&&!node.userData.componentId)node=node.parent;if(node?.userData.componentId)select(node.userData.componentId);}
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;observer?.observe(host);
  controls.addEventListener('change',()=>{dirty=true;});controls.addEventListener('start',()=>{autoFraming=false;});syncLabels();applyQuality();resize();setCamera(view.camera);setState();render();
  const dispose=()=>{if(disposed)return;disposed=true;cancelAnimationFrame(raf);observer?.disconnect();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);controls.dispose();selectionHighlight?.dispose();assembly.dispose();floorGeometry.dispose();floorMaterial.dispose();grid.geometry.dispose();grid.material.dispose();environment.dispose();key.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();for(const element of [renderer.domElement,labels,svg,note,stateBadge,rangeNote])element.remove();};
  return {setState,setView,resize,dispose,focus,setCamera,inspectPart,restoreInspection,getComponents:()=>assembly.getComponents(),getDiagnostics:()=>({...assembly.getDiagnostics(),disposed,buildCount,renderCount,canvas:{width,height,pixelRatio:renderer.getPixelRatio()},camera:view.camera,cameraPose:{position:camera.position.toArray(),target:controls.target.toArray()},autoFraming,selectedPart:view.selectedPart,inspection:{active:!!inspection,partId:inspection?.partId??null},selection:{style:selectionHighlight?.style??'none',box:false},framing:framing?{distance:framing.distance,subjectFill:framing.subjectFill}:null,labels:{enabled:!!view.labels,visible:Number(labels.dataset.visibleCount??0)},renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures},webgl2:true})};
}
