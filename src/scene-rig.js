import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function createDynoFixture(rotorRadius) {
  const group = new THREE.Group();
  group.name = 'brake-dyno-fixture';
  const deckY = -rotorRadius - .019;
  const deckZ = -.163;
  const floorY = deckY - .052;
  const batches = new Map();

  const finish = (color, metalness, roughness) => new THREE.MeshStandardMaterial({ color, metalness, roughness, fog: false });
  const frame = finish(0x334956, .52, .55);
  const steel = finish(0x778b98, .84, .38);
  const tread = finish(0x202b33, .23, .69);
  const housing = finish(0x435864, .61, .52);
  const zinc = finish(0xa7b1ad, .91, .32);

  function add(geometry, material, x, y, z) {
    geometry.translate(x, y, z);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
  }

  function box(width, height, depth, material, x, y, z) {
    add(new THREE.BoxGeometry(width, height, depth), material, x, y, z);
  }

  function disk(radius, depth, segments, material, x, y, z, axial = false) {
    const geometry = new THREE.CylinderGeometry(radius, radius, depth, segments);
    if (axial) geometry.rotateX(Math.PI / 2);
    add(geometry, material, x, y, z);
  }

  function brace(x, y, z, width, height, depth) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(depth, 0);
    shape.lineTo(0, height);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    geometry.rotateY(-Math.PI / 2);
    add(geometry, frame, x, y, z);
  }

  function mountingBolt(x, y, z) {
    disk(.0079, .0018, 16, steel, x, y + .001, z);
    disk(.0055, .0042, 6, zinc, x, y + .004, z);
  }

  // The base is low enough to clear the rotor even at the largest supported radius.
  box(.625, .015, .458, steel, -.038, deckY - .0075, deckZ);
  box(.602, .025, .436, frame, -.038, deckY - .0275, deckZ);
  for (const x of [-.288, .210]) for (const z of [-.335, .023]) {
    box(.064, .012, .059, tread, x, floorY + .006, z);
    mountingBolt(x, deckY, z);
  }
  for (const z of [-.294, -.188, -.082, .024]) {
    box(.582, .0012, .006, tread, -.038, deckY + .0002, z);
    box(.582, .0012, .0015, zinc, -.038, deckY + .0002, z + .004);
  }

  // Stationary pedestal and gussets hold the knuckle behind the speed pickup.
  const mountTop = -.050;
  box(.182, .012, .118, frame, 0, deckY + .006, -.185);
  box(.128, mountTop - deckY - .012, .060, housing, 0, (mountTop + deckY + .012) / 2, -.181);
  box(.131, .049, .026, steel, 0, -.051, -.136);
  for (const x of [-.068, .057]) {
    brace(x, deckY + .012, -.153, .011, mountTop - deckY - .025, .052);
    for (const z of [-.219, -.141]) mountingBolt(x, deckY + .012, z);
    disk(.006, .005, 6, zinc, x + .0055, -.063, -.133, true);
  }

  // Finned drive on a foot mount, coupled along the same axle as the rotor.
  const motorZ = -.287;
  const motorBottom = -.068;
  box(.178, .012, .162, frame, 0, deckY + .006, motorZ);
  const riserHeight = motorBottom - deckY - .012;
  for (const x of [-.047, .047]) {
    box(.032, riserHeight, .119, housing, x, deckY + .012 + riserHeight / 2, motorZ);
    box(.053, .011, .143, steel, x, motorBottom - .003, motorZ);
    for (const z of [motorZ - .052, motorZ + .052]) mountingBolt(x * 1.38, motorBottom + .003, z);
  }
  disk(.066, .131, 48, housing, 0, 0, motorZ, true);
  disk(.057, .022, 36, frame, 0, 0, motorZ - .072, true);
  disk(.063, .010, 36, steel, 0, 0, motorZ + .068, true);
  disk(.028, .020, 36, housing, 0, 0, motorZ + .080, true);
  disk(.020, .024, 36, steel, 0, 0, -.185, true);
  disk(.0135, .039, 32, zinc, 0, 0, -.168, true);
  disk(.0115, .027, 32, steel, 0, 0, -.140, true);
  for (let index = 0; index < 18; index++) {
    const angle = index * Math.PI / 9;
    const fin = new THREE.BoxGeometry(.0036, .013, .108);
    fin.rotateZ(angle);
    add(fin, housing, -.067 * Math.sin(angle), .067 * Math.cos(angle), motorZ);
  }
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3;
    disk(.005, .005, 6, zinc, .053 * Math.cos(angle), .053 * Math.sin(angle), motorZ + .075, true);
  }
  box(.068, .022, .065, frame, 0, .070, motorZ - .012);
  box(.074, .005, .070, steel, 0, .084, motorZ - .012);

  // The ABS block's rear rail leaves its pump, seats and lines visible from the front.
  const trayTop = .034;
  const railHeight = trayTop - deckY - .026;
  box(.106, .008, .105, frame, -.239, deckY + .004, -.112);
  box(.048, railHeight, .047, housing, -.239, deckY + .008 + railHeight / 2, -.102);
  box(.100, .009, .093, steel, -.239, trayTop - .0045, -.078);
  box(.078, .078, .012, frame, -.239, .069, -.092);
  for (const x of [-.278, -.200]) {
    mountingBolt(x, deckY + .008, -.119);
    disk(.0035, .005, 6, zinc, x, .067, -.084, true);
  }

  for (const [material, pieces] of batches) {
    const geometries = pieces.map(geometry => geometry.index ? geometry.toNonIndexed() : geometry);
    const geometry = mergeGeometries(geometries);
    for (const temporary of new Set([...pieces, ...geometries])) temporary.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group, floorY,
    dispose() {
      for (const mesh of group.children) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
  };
}
