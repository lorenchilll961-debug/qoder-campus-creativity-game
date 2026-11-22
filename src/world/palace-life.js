import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadTracked } from '../core/progress.js';
import { mergeByMaterial } from '../../vendor/forbidden-city/src/utils/MergeUtils.js';
import { MOAT_LEVEL, PALACE_SITE, PALACE_WALKS } from './palace-site.js';

const { moat, scale, verticalScale } = PALACE_SITE;
const [{ at: promenadeZ }, { at: eastWalkX }, { at: westWalkX }] = PALACE_WALKS;
const STALLS = [
  ...[-148, -123, -98, -73, -48, 48, 73, 98, 123, 148].map(x => [x, promenadeZ - 12, 0]),
  ...[-130, -80, 80, 130].map(x => [x, promenadeZ + 13, Math.PI]),
  ...[-355, -322, -289, -222, -185].map(z => [eastWalkX - 13, z, Math.PI / 2]),
  ...[-355, -322, -296, -219, -178].map(z => [westWalkX + 13, z, -Math.PI / 2]),
];

function pathMesh(path, height, lib) {
  const { axis, start, end, at, half } = path;
  const segments = Math.ceil((end - start) / 2);
  const position = [], uv = [], index = [];
  for (let i = 0; i <= segments; i++) {
    const along = THREE.MathUtils.lerp(start, end, i / segments);
    for (const side of [-half, half]) {
      const x = axis === 'x' ? along : at + side;
      const z = axis === 'x' ? at + side : along;
      position.push(x, height(x, z) + .32, z);
      uv.push(x / 5, z / 5);
    }
    if (i) {
      const a = (i - 1) * 2;
      index.push(...(axis === 'x' ? [a, a + 1, a + 2, a + 2, a + 1, a + 3]
        : [a, a + 2, a + 1, a + 2, a + 3, a + 1]));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, lib.material('stone_slab', { color: 0xc8b18d }));
}

export function createPalaceLife(terrain, lib, addSolid) {
  const group = new THREE.Group();
  group.name = '午门与东西岸市集';
  const details = new THREE.Group();
  const height = (x, z) =>
    (terrain.heightAt(PALACE_SITE.x - x * scale, PALACE_SITE.z - z * scale) - PALACE_SITE.y) / verticalScale;
  const material = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: .87, ...extra });
  const wood = material(0x704331), blue = material(0x397674), cream = material(0xdfb683);
  const red = material(0xaa4938), jade = material(0x627f42), ochre = material(0xc88d39);
  const awnings = [blue, red, jade, ochre];
  const stone = material(0x9a9684), ceramic = material(0xa9573e), leaf = material(0x66814d);
  const lamp = material(0xe88c31, { name: 'palace_lantern', emissive: 0xff8227, emissiveIntensity: 0 });

  const box = (root, mat, w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  const at = (x, z, yaw = 0) => {
    const root = new THREE.Group();
    root.position.set(x, height(x, z) + .17, z);
    root.rotation.y = yaw;
    return root;
  };
  for (const walk of PALACE_WALKS) details.add(pathMesh(walk, height, lib));
  const vendorSpots = [];
  const awningWidth = 15.8, stallDepth = 9.5;
  STALLS.forEach(([x, z, yaw], index) => {
    const stall = at(x, z, yaw);
    const cloth = awnings[index % awnings.length];
    const footprint = [];
    box(stall, stone, awningWidth + .45, .24, stallDepth, 0, -.12, .1);
    for (const dx of [-7.1, 7.1]) for (const dz of [-3.45, 3.45]) {
      footprint.push(box(stall, wood, .33, 5.45, .34, dx, 2.72, dz));
    }
    const stripe = awningWidth / 9;
    for (let i = -4; i <= 4; i++) {
      const fabric = box(stall, i % 2 ? cream : cloth, stripe, .22, stallDepth, i * stripe, 5.41, 0);
      fabric.rotation.x = -.115;
      box(stall, i % 2 ? cream : cloth, stripe, .62, .14, i * stripe, 4.64, 4.64);
    }
    for (const side of [-1, 1]) {
      footprint.push(box(stall, wood, 5.8, 1.46, 1.65, side * 3.83, .73, 2.9));
      box(stall, cream, 6.15, .18, 1.95, side * 3.83, 1.51, 2.9);
      box(stall, lamp, .58, .77, .56, side * 6.48, 3.9, 3.8);
    }
    box(stall, wood, 4.7, .85, .18, 0, 4.33, 4.52);
    box(stall, ochre, 4.37, .11, .22, 0, 4.61, 4.54);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const itemX = side * (2.25 + i * 1.49);
      if (index % 3 === 0) {
        box(stall, cream, .96, .29 + i * .12, .78, itemX, 1.7, 2.9);
      } else {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(.34, .45, .69 - i * .08, 8),
          [ceramic, blue, jade][(index + i) % 3]);
        pot.position.set(itemX, 1.9 - i * .04, 2.9);
        stall.add(pot);
      }
    }
    stall.updateMatrixWorld(true);
    addSolid(details, stall, footprint.map(mesh => new THREE.Box3().setFromObject(mesh)));
    vendorSpots.push({ x, y: stall.position.y, z, yaw });
  });
  for (const [x, z, yaw] of [
    [-114, promenadeZ + 5, 0], [52, promenadeZ + 5, 0], [139, promenadeZ - 7, 0],
    [eastWalkX + 5, -327, Math.PI / 2], [eastWalkX + 5, -193, Math.PI / 2],
  ]) {
    const bench = at(x, z, yaw);
    box(bench, wood, 3.15, .22, .8, 0, .78, 0);
    box(bench, wood, 3.15, .55, .13, 0, 1.18, -.34);
    for (const side of [-1, 1]) box(bench, stone, .29, .68, .71, side * 1.13, .34, 0);
    addSolid(details, bench);
  }
  for (const [x, z] of [
    [-134, promenadeZ + 5], [-45, promenadeZ - 5], [45, promenadeZ - 5], [121, promenadeZ + 5],
    [eastWalkX + 5, -355], [eastWalkX + 5, -302], [eastWalkX + 5, -218], [eastWalkX + 5, -172],
  ]) {
    const pole = at(x, z);
    box(pole, stone, .8, .26, .8, 0, .13, 0);
    box(pole, wood, .24, 3.25, .24, 0, 1.7, 0);
    box(pole, wood, .9, .2, .24, .31, 3.27, 0);
    box(pole, lamp, .52, .67, .52, .59, 2.81, 0);
    box(pole, wood, .65, .11, .65, .59, 3.18, 0);
    details.add(pole);
  }
  const crown = new THREE.IcosahedronGeometry(.72, 1);
  for (const [x, z] of [[-76, promenadeZ - 8], [-58, promenadeZ - 8], [80, promenadeZ - 7],
    [98, promenadeZ - 7], [eastWalkX - 7, -240], [eastWalkX - 7, -222]]) {
    const planter = at(x, z);
    box(planter, ceramic, 1.4, .76, 1.4, 0, .36, 0);
    const shrub = new THREE.Mesh(crown, leaf);
    shrub.position.y = 1.18;
    planter.add(shrub);
    details.add(planter);
  }

  // Merge static street furniture together. Keep the two small flocks animated separately.
  group.add(mergeByMaterial(details, { name: '石径、茶摊、长凳与灯笼', castShadow: false, receiveShadow: false }));
  const ducks = [];
  const feathers = material(0xe6d7b9), head = material(0x3f7563), bill = material(0xeaa747);
  const sphere = new THREE.SphereGeometry(1, 8, 6);
  for (let i = 0; i < 6; i++) {
    const duck = new THREE.Group();
    duck.name = '护城河水鸭';
    const part = (mat, sx, sy, sz, y, z) => {
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(0, y, z);
      duck.add(mesh);
    };
    part(feathers, .47, .32, .76, .33, 0);
    part(i % 2 ? feathers : head, .28, .29, .31, .64, .42);
    part(bill, .18, .088, .24, .61, .71);
    group.add(duck);
    ducks.push(duck);
  }
  const vendors = [];
  const vendorRoot = new THREE.Group();
  vendorRoot.name = '宫外市集摊主';
  group.add(vendorRoot);
  const loadVendors = async () => {
    const loader = new GLTFLoader();
    const results = await Promise.allSettled(['Farmer.glb', 'Formal.glb'].map(name =>
      loadTracked(loader, './assets/models/npcs/' + name)));
    const models = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!models.length) throw results[0].reason;
    for (const [i, { x, y, z, yaw }] of vendorSpots.entries()) {
      const asset = models[i % models.length];
      const character = clone(asset.scene);
      character.position.set(x + Math.cos(yaw) * 2.35 - Math.sin(yaw) * .45, y,
        z - Math.sin(yaw) * 2.35 - Math.cos(yaw) * .45);
      character.rotation.y = yaw;
      character.scale.set(1 / scale, 1 / verticalScale, 1 / scale);
      character.visible = false;
      const mixer = new THREE.AnimationMixer(character);
      const clip = THREE.AnimationClip.findByName(asset.animations, 'Idle');
      if (clip) mixer.clipAction(clip).play();
      mixer.update(i * .17);
      vendorRoot.add(character);
      vendors.push({ character, mixer });
    }
  };
  const update = (time, glow, dt, camera) => {
    if (camera) for (const { character, mixer } of vendors) {
      const dx = PALACE_SITE.x - character.position.x * scale - camera.position.x;
      const dz = PALACE_SITE.z - character.position.z * scale - camera.position.z;
      character.visible = dx * dx + dz * dz < 145 ** 2;
      if (character.visible) mixer.update(dt);
    }
    lamp.emissiveIntensity = .16 + glow * 1.28;
    for (const [i, duck] of ducks.entries()) {
      const phase = time * .105 + (i % 3) * .12;
      const along = Math.sin(phase), across = Math.cos(phase);
      if (i < 3) {
        duck.position.set(105 + along * 34 + i * 2.6, MOAT_LEVEL + Math.sin(time * 2.6 + i) * .055,
          moat.z0 + 25 + across * 6 + i * 2.1);
        duck.rotation.y = Math.atan2(across * 34, -along * 6);
      } else {
        duck.position.set(moat.x0 + 24 + across * 7 + (i - 3) * 2.1,
          MOAT_LEVEL + Math.sin(time * 2.6 + i) * .055, -134 + along * 37 + (i - 3) * 2.7);
        duck.rotation.y = Math.atan2(-along * 7, across * 37);
      }
    }
  };
  update(0, 0);
  return { group, update, loadVendors };
}
