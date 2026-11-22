import * as THREE from 'three';
import { createWorkshop, workshopMaterials } from './workshop.js';

export const ESTATE_SITES = [
  { id: 'dragon-workshop', name: '秋英坡守望工坊', x: 550, z: -750 },
  { id: 'east-estate', name: '东岭焙茶庄园', x: 1605, z: -400 },
  { id: 'south-estate', name: '南湾花圃庄园', x: 460, z: 690 },
  { id: 'grand-estate', name: '绿野大庄园', x: -520, z: 365, large: true },
  { id: 'west-estate', name: '西坡织造庄园', x: -1130, z: -70 },
  { id: 'north-estate', name: '北崖陶艺庄园', x: -930, z: -635 },
];

const small = [[0,0,1],[-18,15,0.75],[19,12,0.82]];
const large = [...small, [-21,-15,0.87],[22,-16,0.72],[0,31,0.79]];
const v = (x, y, z) => new THREE.Vector3(x, y, z);

function createGardenKit() {
  const make = color => new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  return {
    path: [new THREE.BoxGeometry(1,1,1), make(0x947355)],
    bed: [new THREE.BoxGeometry(1,1,1), make(0x604334)],
    leaf: [new THREE.IcosahedronGeometry(1,1), make(0x6a9c4c)],
    petal: [new THREE.IcosahedronGeometry(1,0), make(0xffffff)],
    wood: [new THREE.CylinderGeometry(0.7,1,1,6), make(0x74513b)],
    rail: [new THREE.BoxGeometry(1,1,1), make(0x99754e)],
  };
}

function garden(terrain, site, kit) {
  const group = new THREE.Group();
  group.name = '花圃、小径和果树';
  const items = {};
  const plant = (kind, x, z, y, sx, sy, sz, tint) => {
    const floor = terrain.heightAt(site.x + x, site.z + z);
    (items[kind] ??= []).push({ x, y: floor + y, z, sx, sy, sz, tint });
  };
  const tree = (x,z) => {
    plant('wood',x,z,1.05,0.27,2.1,0.27);
    plant('leaf',x,z,2.8,1.75,1.45,1.65);
    plant('leaf',x+0.8,z-0.7,2.75,1.05,1.06,1.08,0x9cbd67);
  };
  const flowers = [0xffbd65, 0xf187a3, 0xdec5fa, 0xf4edb5];
  const plots = site.large ? [[-40,1],[40,1],[-23,31],[23,31]] : [[-10,29],[10,29]];
  plots.forEach(([px,pz], i) => {
    for (let dx = -4; dx <= 4; dx += 2) {
      plant('bed',px+dx,pz,0.22,1.9,0.34,7);
      for(let dz=-2.6;dz<=2.6;dz+=1.3) {
        const stem = 0.37 + 0.13 * Math.cos(dx*13 + dz*3 + i);
        plant('leaf',px+dx,pz+dz,stem,0.61,0.56,0.58);
        plant('petal',px+dx+0.16,pz+dz,stem+0.47,0.31,0.28,0.32, flowers[(dx+20+i*3+Math.round(dz*3)) % flowers.length]);
      }
    }
    for (const side of [-1,1]) {
      tree(px + side * 7, pz + 5);
    }
  });
  for (let z = 7; z < (site.large ? 39 : 35); z += 2.2) {
    plant('path',0,z,0.1,2.4,0.24,2.25);
  }
  if (site.large) {
    for (let x = -8.8; x <= 9; x += 2.2) {
      if (Math.abs(x) < 1) continue;
      for (const z of [11.4,13.6,15.8,18,20.2]) {
        plant('path',x,z,0.1,2.24,0.24,2.25);
      }
    }
    for (const side of [-1,1]) {
      for (const x of [11,13.2,15.4,17.6,19.8,22,24.2,26.4]) {
        plant('path',x*side,23,0.1,2.24,0.24,2.25);
      }
      for (const x of [34,40]) {
        for (const z of [16,22,28]) tree(x*side,z);
      }
    }
  }
  for (let x = -(site.large ? 46 : 23); x <= (site.large ? 46 : 23); x+=2.4) {
    if (Math.abs(x) < 2.5) continue;
    const z = site.large ? 39 : 37;
    plant('wood',x,z,0.65,0.13,1.3,0.13);
    plant('rail',x+1.2,z,0.85,2.45,0.12,0.13);
  }
  const matrix = new THREE.Matrix4(), translation = v(0,0,0), scale = v(1,1,1), identity = new THREE.Quaternion();
  for (const [name, set] of Object.entries(items)) {
    const mesh = new THREE.InstancedMesh(...kit[name], set.length);
    set.forEach(({x,y,z,sx,sy,sz,tint},i) => {
      mesh.setMatrixAt(i,matrix.compose(translation.set(x,y,z),identity,scale.set(sx,sy,sz)));
      if (tint) mesh.setColorAt(i,new THREE.Color(tint));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  group.position.set(site.x, 0, site.z);
  return group;
}

export function createEstates(terrain) {
  const materials = workshopMaterials(), kit = createGardenKit();
  return ESTATE_SITES.map(site => {
    const root = new THREE.Group();
    root.name = site.name;
    const houses = (site.large ? large : small).map(([x,z,size], i) =>
      createWorkshop(terrain,site.x+x,site.z+z,{size, name: i ? `${site.name} · 附屋 ${i}` : `${site.name} · 主屋`,materials}));
    root.add(garden(terrain,site,kit), ...houses.map(h=>h.root));
    const damagePoint = houses[0].damagePoint;
    let pending = [], delay = 0;
    const estate = {
      ...site, root, houses, damagePoint,
      get intact() { return !pending.length && houses.every(h=>h.intact); },
      destroy(hit,direction) {
        if (!estate.intact || !houses[0].destroy(hit,direction)) return false;
        pending = houses.slice(1).map(h=>({ house:h, direction:direction.clone() }));
        delay = 0.32;
        return true;
      },
      update(dt) {
        houses.forEach(h=>h.update(dt));
        if (!pending.length) return;
        delay -= dt;
        while (pending.length && delay <= 0) {
          const {house,direction} = pending.shift();
          house.destroy(house.damagePoint,direction);
          delay += 0.32;
        }
      },
      collision: combineCollisions(houses),
    };
    return estate;
  });
}

export function combineCollisions(objects) {
  return {
    heightAt: (x,z) => objects.reduce((height,o)=>Math.max(height,o.collision.heightAt(x,z)),-Infinity),
    groundHeightAt: (x,z) => objects.reduce((height,o)=>Math.max(height,o.collision.groundHeightAt(x,z)),-Infinity),
    collide: (pos,radius,normal) => objects.some(o=>o.collision.collide(pos,radius,normal)),
  };
}
