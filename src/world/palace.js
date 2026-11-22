import * as THREE from 'three';
import { U } from '../core/ctx.js';
import { makeWaveNormalTexture } from './water.js';
import { createPalaceLife } from './palace-life.js';
import { PALACE_LAYOUT } from '../../vendor/forbidden-city/src/scene/Layout.js';
import { buildSumeruBase } from '../../vendor/forbidden-city/src/scene/HallKit.js';
import { buildCornerTower, buildRoof, buildWallCap } from '../../vendor/forbidden-city/src/scene/RoofBuilder.js';
import { PALACE_SITE, MOAT_LEVEL, moatCutLocal } from './palace-site.js';
import { buildWumen } from '../../vendor/forbidden-city/src/scene/palace/gate.js';
import { applyBoxUV } from '../../vendor/forbidden-city/src/utils/GeometryUV.js';
import { mergeByMaterial } from '../../vendor/forbidden-city/src/utils/MergeUtils.js';
import { TextureLibrary } from '../../vendor/forbidden-city/src/utils/TextureLibrary.js';
import axis from '../../vendor/forbidden-city/data/zones/axis-courts.json' with { type: 'json' };
import garden from '../../vendor/forbidden-city/data/zones/garden.json' with { type: 'json' };
import east from '../../vendor/forbidden-city/data/zones/east-six.json' with { type: 'json' };
import west from '../../vendor/forbidden-city/data/zones/west-six.json' with { type: 'json' };

import ningshou from '../../vendor/forbidden-city/data/zones/ningshou.json' with { type: 'json' };
import outerEast from '../../vendor/forbidden-city/data/zones/outer-east.json' with { type: 'json' };
import outerWest from '../../vendor/forbidden-city/data/zones/outer-west.json' with { type: 'json' };

const { scale: SCALE, verticalScale: VERTICAL, moat: MOAT } = PALACE_SITE;
const ORIGIN = new THREE.Vector3(PALACE_SITE.x, PALACE_SITE.y, PALACE_SITE.z);
// The upstream model uses +Z for north and -X for east. The island uses the opposite axes.
const toIsland = new THREE.Matrix4().makeScale(-SCALE, VERTICAL, -SCALE).setPosition(ORIGIN);
const NONE = -1e9;
const SITE = { minX: MOAT.x0, maxX: MOAT.x1, minZ: -515, maxZ: MOAT.z1 };
const CITY_GATES = [outerEast, outerWest].flatMap(zone => zone.items.filter(item => item.kind === 'cityGate'));
// Game-specific auxiliary courtyards fill the wings while leaving the ceremonial axis open.
const EXTRA_COURTS = [
  { name: '外朝东配院', x: -274, z: -350 },
  { name: '外朝西配院', x: 208, z: -356 },
  { name: '东华内苑', x: -289, z: -132 },
  { name: '西华内苑', x: 315, z: -101 },
  { name: '西路配院', x: 322, z: 94 },
  { name: '东路配院', x: -185, z: 119 },
];
const CELL = 24;
const ROOF_FINISHES = { black: '#283639', gray: '#55595b', green: '#42664a' };
const rotations = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };
export const PALACE_ID = 'palace:forbidden-city';

function box(lib, material, w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(applyBoxUV(new THREE.BoxGeometry(w, h, d), lib.tileSize(material)), lib.material(material));
  mesh.position.set(x, y, z);
  return mesh;
}

function paintedTextures(lib) {
  for (const [key, background, line] of [
    ['lattice_doors', '#711d1b', '#a65c3d'],
    ['caihua_beam', '#234854', '#d8ab4e'],
    ['dougong_band', '#1d6257', '#9d7739'],
    ['wood_column', '#a94e38', '#853a2b'],
    ['rafters', '#458277', '#34665d'],
  ]) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = line;
    ctx.lineWidth = key === 'lattice_doors' ? 3 : 1.5;
    ctx.strokeRect(1, 3, 254, 58);
    for (let x = 8; x < 256; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, 58);
      if (key === 'lattice_doors') {
        ctx.moveTo(x - 8, 27); ctx.lineTo(x + 8, 27);
        ctx.moveTo(x - 8, 43); ctx.lineTo(x + 8, 43);
      } else {
        ctx.moveTo(x, 17); ctx.lineTo(x + 6, 30); ctx.lineTo(x, 42); ctx.lineTo(x - 6, 30); ctx.closePath();
      }
      ctx.stroke();
    }
    lib.colors.set(key, lib.configure(new THREE.CanvasTexture(canvas), key, 'color'));
  }
}

function palaceWindows() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#ffcf7b';
  ctx.fillRect(5, 5, 118, 54);
  ctx.strokeStyle = '#070301';
  ctx.lineWidth = 3;
  for (let x = 16; x < 128; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.lineTo(x, 62);
    ctx.moveTo(x - 8, 32);
    ctx.lineTo(x, 23);
    ctx.lineTo(x + 8, 32);
    ctx.lineTo(x, 41);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.fillStyle = '#070301';
  ctx.fillRect(0, 30, 128, 3);
  const lattice = new THREE.CanvasTexture(canvas);
  lattice.colorSpace = THREE.SRGBColorSpace;
  const pane = new THREE.MeshStandardMaterial({
    name: 'palace_window_lattice', color: 0x4c2c1e, map: lattice, roughness: .85,
    emissive: 0xffba62, emissiveMap: lattice, emissiveIntensity: 0,
  });
  const spill = new THREE.ShaderMaterial({
    name: 'palace_window_spill', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uDayNight: U.uDayNight },
    vertexShader: `
      varying vec2 vUV;
      void main() {
        vUV = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec4 uDayNight;
      varying vec2 vUV;
      void main() {
        float strength = clamp(max(uDayNight.y, uDayNight.z * .82), 0.0, 1.0);
        float shape = smoothstep(0.0, .24, vUV.x) * (1.0 - smoothstep(.76, 1.0, vUV.x));
        float falloff = pow(vUV.y, 2.2) * smoothstep(0.0, .95, vUV.y);
        gl_FragColor = vec4(vec3(.34, .112, .024), strength * shape * falloff * .7);
      }
    `,
  });
  return { pane, spill };
}

function placeWindow(root, material, x, y, z, width, height, yaw) {
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  pane.position.set(x, y, z);
  pane.rotation.y = yaw;
  root.add(pane);
}

function roofLibrary(lib, finish) {
  if (!finish) return lib;
  const key = 'roof_' + finish;
  if (!lib.materials.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = ROOF_FINISHES[finish];
    ctx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 16) {
      ctx.fillStyle = '#ffffff31';
      ctx.fillRect(x + 2, 0, 3, 128);
      ctx.fillStyle = '#00000036';
      ctx.fillRect(x + 8, 0, 5, 128);
    }
    const texture = lib.configure(new THREE.CanvasTexture(canvas), 'roof_tile', 'color');
    lib.materials.set(key, new THREE.MeshStandardMaterial({ map: texture, roughness: .54 }));
  }
  return {
    material: name => name === 'roof_tile' ? lib.materials.get(key) : lib.material(name),
    tileSize: name => lib.tileSize(name),
    aspect: name => lib.aspect(name),
  };
}

function mergeDistrict(root, name, roofMaterials) {
  root.traverse(mesh => {
    if (!mesh.isMesh || !['roof_ridge_glaze', 'roof_finial_gold'].includes(mesh.material?.name)) return;
    const material = mesh.material;
    const key = material.name + ':' + material.color.getHexString();
    if (!roofMaterials.has(key)) roofMaterials.set(key, material);
    else if (material !== roofMaterials.get(key)) {
      mesh.material = roofMaterials.get(key);
      material.dispose();
    }
  });
  return mergeByMaterial(root, { name, castShadow: false, receiveShadow: false });
}

function plaque(name, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#102c53';
  ctx.fillRect(0, 0, 128, 192);
  ctx.strokeStyle = '#c68a35';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 116, 180);
  ctx.strokeStyle = '#f5cf75';
  ctx.lineWidth = 1;
  ctx.strokeRect(12, 12, 104, 168);
  ctx.fillStyle = '#edc263';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 43px serif';
  [...name].forEach((character, index) => ctx.fillText(character, 64, 96 + (index - (name.length - 1) / 2) * 47));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.7), new THREE.MeshStandardMaterial({ map: texture }));
  sign.rotation.y = Math.PI;
  sign.position.set(0, y, z);
  return sign;
}

function marbleRails(lib, building, w, d, h, layers) {
  for (let tier = 0; tier < layers; tier++) {
    const halfW = (w + 3 + (layers - 1 - tier) * 3) / 2 - 0.2;
    const halfD = (d + 3 + (layers - 1 - tier) * 3) / 2 - 0.2;
    const y = h * (tier + 1) / layers;
    for (const side of [-1, 1]) {
      building.add(box(lib, 'marble', .26, .2, halfD * 2, side * halfW, y + 1, 0));
      for (let z = -halfD; z <= halfD; z += 1.9) {
        building.add(box(lib, 'marble', .33, 1.05, .33, side * halfW, y + .525, z));
      }
      for (const wing of [-1, 1]) {
        const span = halfW - 3.2;
        const z = side * halfD;
        building.add(box(lib, 'marble', span, .2, .26, wing * (3.2 + span / 2), y + 1, z));
        for (let x = 3.2; x <= halfW; x += 1.9) {
          building.add(box(lib, 'marble', .33, 1.05, .33, wing * x, y + .525, z));
        }
      }
    }
  }
}

function facade(lib, w, d, h, bays, passage = false) {
  const body = new THREE.Group();
  const bay = w / bays, column = Math.min(.58, Math.max(.2, bay * .086));
  const columnGeo = new THREE.CylinderGeometry(column * .87, column, h - .35, 10);
  const red = lib.material('wood_column');
  const wallZ = d * .34;
  const wallWidth = w - column * 2;
  const panels = [];
  if (passage) {
    const wing = (wallWidth - bay) / 2;
    for (const side of [-1, 1]) panels.push(box(lib, 'wall_red', wing, h * .75, wallZ * 2, side * (bay + wing) / 2, h * .375, 0));
    panels.push(box(lib, 'wall_red', wallWidth, h * .17, wallZ * 2, 0, h * .765, 0));
  } else {
    panels.push(box(lib, 'wall_red', wallWidth, h * .75, wallZ * 2, 0, h * .375, 0));
  }
  body.add(...panels);
  body.userData.walkSolids = panels.slice();
  for (const side of [-1, 1]) {
    body.add(box(lib, 'caihua_beam', w + .36, h * .16, .68, 0, h * .89, side * d / 2));
    body.add(box(lib, 'dougong_band', w + .28, h * .07, .5, 0, h * .987, side * d / 2));
    body.add(box(lib, 'gold_trim', w + .37, .085, .11, 0, h * .825, side * (d / 2 + .355)));
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + i * bay;
      const columnMesh = new THREE.Mesh(columnGeo, red);
      columnMesh.position.set(x, h / 2 + .175, side * d / 2);
      body.add(columnMesh, box(lib, 'marble', column * 2.45, .35, column * 2.45, x, .175, side * d / 2));
      body.userData.walkSolids.push(columnMesh);
      if (i === bays || (passage && i === Math.floor(bays / 2))) continue;
      const middle = x + bay / 2;
      body.add(box(lib, 'lattice_doors', bay - .13, h * .69, .15, middle, h * .35, side * (wallZ + .09)));
      body.add(box(lib, 'wood_column', .12, h * .68, .19, middle, h * .35, side * (wallZ + .16)));
      const paneWidth = (bay - .23) * .79;
      placeWindow(body, lib.windows.pane, middle, h * .51, side * (wallZ + .195), paneWidth, h * .28,
        side === 1 ? 0 : Math.PI);
      const run = Math.min(6, Math.max(1.3, d * .24));
      const groundLight = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(bay, paneWidth * 1.12), run), lib.windows.spill);
      groundLight.rotation.set(-Math.PI / 2, 0, side === 1 ? 0 : Math.PI);
      groundLight.position.set(middle, .09, side * (wallZ + .22 + run / 2));
      body.add(groundLight);
    }
  }
  body.userData.topY = h;
  return body;
}

function hall(lib, { name, x, z, w, d, y = 0, ph = 1.4, colH = 6, roof = 'xieshan', layers = 1,
  rot = 0, baseLayers = 1, detail = 'low', formal = false, bays, storeys = 1, finish }) {
  const building = new THREE.Group();
  building.name = name;
  building.position.set(x, y, z);
  building.rotation.y = rotations[rot] ?? rot;
  const plinth = buildSumeruBase(lib, { width: w + 3, depth: d + 3, height: ph, layers: baseLayers, balustrade: false });
  building.add(plinth);
  const frontage = name === '太和殿' ? 11 : name === '太和门' ? 9 : bays || Math.max(3, Math.round(w / 5.1) | 1);
  const h = colH * (storeys >= 3 ? 1.6 : storeys === 2 && colH < 9 ? 1.55 : 1);
  const body = facade(lib, w, d, h, frontage, name === '太和门');
  if (storeys >= 2) {
    body.add(box(lib, 'caihua_beam', w + .9, .52, d + .9, 0, h * .53, 0));
    body.add(box(lib, 'stone_slab', w + 1.55, .25, d + 1.55, 0, h * .49, 0));
  }
  body.position.y = ph;
  building.add(body);
  const taihe = name === '太和殿';
  const roofMaterial = roofLibrary(lib, finish);
  const canopy = buildRoof(roofMaterial, { type: roof, width: w + (taihe ? .6 : 2), depth: d + (taihe ? .6 : 2),
    baseY: ph + body.userData.topY, layers, detail, sides: 4, brackets: true, ...(taihe ? { walkingBeastProfile: 'taihe' } : {}) });
  if (name === '文渊阁') canopy.traverse(mesh => {
    if (mesh.material?.name === 'roof_ridge_glaze') mesh.material.color.setHex(0x4b693d);
  });
  building.add(canopy);
  if (storeys >= 3) {
    building.add(buildRoof(roofMaterial, { type: roof, width: w + 2.5, depth: d + 2.5, baseY: ph + h * .52,
      layers: 1, detail: 'low', brackets: true }));
  }
  if (formal) {
    marbleRails(lib, building, w, d, ph, baseLayers);
    building.add(plaque(name, ph + colH * .86, -d / 2 - .65));
  }
  const ramps = hallStairs(building, lib, d, ph, baseLayers, formal ? 9.2 : Math.min(6.2, w * .38),
    name === '太和门' ? [-1, 1] : [-1]);
  building.userData.terrace = { plinth, body, ramps };
  return building;
}

// Bring the stairs to the full terrace height before the projecting lower tiers.
function hallStairs(building, lib, depth, height, layers, width, sides) {
  const topEdge = (depth + 3) / 2;
  const tierEdge = topEdge + (layers - 1) * 1.5;
  const run = Math.max(4, height * 3.6);
  const count = Math.ceil(height / .20);
  const ramps = [];
  for (const side of sides) {
    const start = side * (tierEdge + run);
    const end = side * (tierEdge + 1.1);
    for (let i = 0; i < count; i++) {
      const top = height * (i + 1) / count;
      const z = start + (end - start) * ((i + .5) / count);
      building.add(box(lib, 'marble', width, top, run / count, 0, top / 2, z));
    }
    const landing = Math.abs(end) - topEdge;
    building.add(box(lib, 'marble', width, height, landing, 0, height / 2, end - side * landing / 2));
    ramps.push({ start, end, width, height });
    ramps.push({ start: end, end: side * topEdge, width, height, flat: true });
  }
  return ramps;
}

function placeHall(root, model, addSolid, collision) {
  const { plinth, body, ramps } = model.userData.terrace;
  model.updateMatrixWorld(true);
  const put = (box, start, end) => {
    box.applyMatrix4(toIsland);
    collision.addWalkSurface(box, start, end);
  };
  for (const tier of plinth.children) put(new THREE.Box3().setFromObject(tier));
  for (const { start, end, width, height, flat } of ramps) {
    const bottom = flat ? height : 0;
    const bounds = new THREE.Box3(new THREE.Vector3(-width / 2, bottom, Math.min(start, end)),
      new THREE.Vector3(width / 2, height, Math.max(start, end)));
    const world = new THREE.Matrix4().multiplyMatrices(toIsland, model.matrixWorld);
    const foot = new THREE.Vector3(0, bottom, start).applyMatrix4(world);
    const top = new THREE.Vector3(0, height, end).applyMatrix4(world);
    put(bounds.applyMatrix4(model.matrixWorld), flat ? undefined : foot, flat ? undefined : top);
  }
  const boxes = [...plinth.children, ...body.userData.walkSolids].map(mesh => new THREE.Box3().setFromObject(mesh));
  const roof = model.children.filter(child => child !== plinth && child !== body && child.isGroup)
    .map(child => new THREE.Box3().setFromObject(child));
  delete model.userData.terrace;
  addSolid(root, model, boxes, [...boxes, ...roof]);
}

function addWall(root, lib, x0, z0, x1, z1, h, thickness, addSolid) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.1) return;
  const wall = new THREE.Group();
  wall.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  wall.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  wall.add(box(lib, 'wall_red', len, h, thickness, 0, h / 2, 0));
  const cap = buildWallCap(lib, { length: len, thickness });
  cap.position.y = h;
  wall.add(cap);
  addSolid(root, wall);
}

function portalWidth(item) {
  if (item.kind === 'cityGate') return 38;
  if (item.style === 'hall') return item.w >= 14 ? item.w : item.gateKind === 'five-bay' ? 25 : 11;
  return Math.max(6, (item.w || 4) + 2.8);
}

function addPortal(root, lib, item, addSolid) {
  const portal = new THREE.Group();
  portal.name = item.name;
  portal.position.set(item.x, 0, item.z);
  portal.rotation.y = rotations[item.rot] ?? item.rot ?? 0;
  const city = item.kind === 'cityGate';
  const hallGate = city || item.style === 'hall';
  const w = portalWidth(item), depth = city ? 16 : hallGate ? 6.5 : 2.5;
  const mouth = city ? 7.5 : Math.max(3.3, Math.min(w * .36, 7));
  const head = city ? 7.7 : hallGate ? 5.6 : 4.6;
  const wallTop = city ? 11 : head + 1.5;
  const masonry = [];
  const add = (material, width, height, x, y) => {
    const mesh = box(lib, material, width, height, depth, x, y, 0);
    portal.add(mesh);
    masonry.push(mesh);
  };
  for (const side of [-1, 1]) {
    add('wall_red', (w - mouth) / 2, head, side * (w + mouth) / 4, head / 2);
    const trim = box(lib, 'marble', .40, head, depth + .3, side * (mouth / 2 + .12), head / 2, 0);
    portal.add(trim);
  }
  add('wall_red', w, wallTop - head, 0, (wallTop + head) / 2);
  if (hallGate) {
    const body = facade(lib, w - 1, depth - .25, city ? 6.5 : 2.45, city ? 5 : 3);
    body.position.y = wallTop;
    portal.add(body, buildRoof(lib, { type: city ? 'xieshan' : item.roof || 'xieshan', width: w + .8, depth: depth + .8,
      baseY: wallTop + body.userData.topY, layers: city ? 2 : item.layers || 1, detail: city ? 'high' : 'low' }));
  } else {
    const cap = buildWallCap(lib, { length: w + .4, thickness: depth + .1 });
    cap.position.y = wallTop;
    portal.add(cap);
  }
  if (city || ['皇极门', '武英门', '文华门', '慈宁门', '神武门'].includes(item.name)) {
    const label = plaque(item.name, wallTop + (city ? 2.4 : -1.1), -depth / 2 - .36);
    label.scale.setScalar(.66);
    portal.add(label);
  }
  portal.updateMatrixWorld(true);
  addSolid(root, portal, masonry.map(mesh => new THREE.Box3().setFromObject(mesh)));
}

function outerWalls(root, lib, addSolid) {
  const outer = PALACE_LAYOUT.find(item => item.type === 'outer_wall');
  const { width, depth, wallHeight, wallThickness } = outer.dimensions;
  const x = (width + wallThickness) / 2, z = (depth + wallThickness) / 2;
  const north = outer.position.z + z, south = outer.position.z - z;
  const wall = (x0, z0, x1, z1) => addWall(root, lib, x0, z0, x1, z1, wallHeight, wallThickness, addSolid);
  for (const side of [-1, 1]) {
    const city = CITY_GATES.find(gate => Math.sign(gate.x) === side);
    wall(side * x, south, side * x, city.z - 17.6);
    wall(side * x, city.z + 17.6, side * x, north);
    addPortal(root, lib, { ...city, x: side * x }, addSolid);
    wall(side * 32, south, side * x, south);
    wall(side * 18.5, north, side * x, north);
    for (const end of [north, south]) {
      const tower = buildCornerTower(lib, { size: 16 });
      tower.position.set(side * x, wallHeight, end);
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        placeWindow(tower, lib.windows.pane, Math.sin(yaw) * 6.43, 3.15, Math.cos(yaw) * 6.43, 4.2, 1.9, yaw);
      }
      addSolid(root, tower);
    }
  }
}

function addCourtyardWalls(root, lib, zone, addSolid) {
  const gates = new Map(zone.items.filter(item => item.kind === 'gate').map(item => [item.name, item]));
  const wall = (from, to, h, t, gaps = []) => {
    const [x0, z0] = from, [x1, z1] = to;
    const alongX = z0 === z1;
    if (!alongX && x0 !== x1) {
      addWall(root, lib, x0, z0, x1, z1, h, t, addSolid);
      return;
    }
    const start = Math.min(alongX ? x0 : z0, alongX ? x1 : z1);
    const end = Math.max(alongX ? x0 : z0, alongX ? x1 : z1);
    const holes = gaps.map(gap => ({
      at: gap.at, half: Math.max(0, (gap.w ?? (gates.has(gap.gate) ? portalWidth(gates.get(gap.gate)) : 6.8)) / 2 - .18),
    })).sort((a, b) => a.at - b.at);
    let cursor = start;
    const segment = (a, b) => {
      if (b > a) addWall(root, lib, ...(alongX ? [a, z0, b, z0] : [x0, a, x0, b]), h, t, addSolid);
    };
    for (const { at, half } of holes) {
      segment(cursor, Math.min(end, at - half));
      cursor = Math.max(cursor, at + half);
    }
    segment(cursor, end);
  };
  for (const item of zone.items) {
    const h = item.h ?? 4.6, t = item.t ?? 1.0;
    if (item.kind === 'wall') wall(item.from, item.to, h, t, item.gaps);
    else if (item.kind === 'courtWalls') {
      const { x0, x1, z0, z1 } = item;
      for (const [side, from, to] of [
        ['s', [x0, z0], [x1, z0]], ['n', [x0, z1], [x1, z1]],
        ['xmin', [x0, z0], [x0, z1]], ['xmax', [x1, z0], [x1, z1]],
      ]) {
        if (item.omit?.includes(side)) continue;
        wall(from, to, h, t, item.gates?.filter(gate => gate.side === side));
      }
    } else if (item.kind === 'gate') addPortal(root, lib, item, addSolid);
  }
}

function addCorridor(root, lib, item, addSolid) {
  const [x0, z0] = item.from, [x1, z1] = item.to;
  const w = Math.hypot(x1 - x0, z1 - z0), d = item.depth ?? 3.7, h = item.colH ?? 3.5;
  if (w < 3) return;
  const corridor = new THREE.Group();
  corridor.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  corridor.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  corridor.add(facade(lib, w, d, h, Math.ceil(w / 4)), buildRoof(lib, {
    type: 'gable', width: w + .15, depth: d + 1, baseY: h, detail: 'low',
  }));
  addSolid(root, corridor);
}

function addRiver(root, lib, addSolid) {
  const river = PALACE_LAYOUT.find(item => item.type === 'river');
  const { width, depth } = river.dimensions;
  const { z } = river.position;
  // Shallow ornamental channel on the island terrace. The bridges preserve the upstream spacing.
  root.add(waterSurface(lib.water, -width / 2, z - depth / 2, width / 2, z + depth / 2, .05));
  let left = -width / 2;
  for (const bridge of river.bridges) {
    const gap = bridge.dx - bridge.width / 2;
    const span = gap - left;
    root.add(box(lib, 'stone_slab', bridge.width, 0.12, bridge.length ?? 21, bridge.dx, 0.065, z));
    for (const side of [-1, 1]) {
      addSolid(root, box(lib, 'marble', span, 0.85, 0.65, left + span / 2, 0.425, z + side * depth / 2));
    }
    left = bridge.dx + bridge.width / 2;
  }
  for (const side of [-1, 1]) {
    addSolid(root, box(lib, 'marble', width / 2 - left, 0.85, 0.65, (left + width / 2) / 2, 0.425, z + side * depth / 2));
    addSolid(root, box(lib, 'marble', 0.65, 0.85, depth, side * width / 2, 0.425, z));
  }
}

function surface(lib, material, x0, z0, x1, z1, y, params) {
  const w = x1 - x0, d = z1 - z0;
  const geo = new THREE.PlaneGeometry(w, d);
  const uv = geo.getAttribute('uv'), textureSize = lib.tileSize(material);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / textureSize, uv.getY(i) * d / textureSize);
  const plane = new THREE.Mesh(geo, lib.material(material, params));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  return plane;
}

function palaceWater(ripple) {
  return new THREE.ShaderMaterial({
    name: 'palace_water',
    uniforms: {
      uTime: U.uTime, uDayNight: U.uDayNight, uAmbSky: U.uAmbSky, uSkyHorizon: U.uSkyHorizon,
      uSkyZenith: U.uSkyZenith, uSunDir: U.uSunDir, uSunColor: U.uSunColor,
      uRipple: { value: ripple },
      uMoatBounds: { value: new THREE.Vector4(MOAT.x0, MOAT.z0, MOAT.x1, MOAT.z1) },
      uMoatWidth: { value: MOAT.width },
    },
    vertexShader: `
      varying vec3 vWorld, vLocal;
      void main() {
        vLocal = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime, uMoatWidth;
      uniform vec4 uDayNight, uMoatBounds;
      uniform vec3 uAmbSky, uSkyHorizon, uSkyZenith, uSunDir, uSunColor;
      uniform sampler2D uRipple;
      varying vec3 vWorld, vLocal;
      void main() {
        vec4 edges = vec4(vLocal.xz - uMoatBounds.xy, uMoatBounds.zw - vLocal.xz);
        float distanceToBank = min(min(edges.x, edges.y), min(edges.z, edges.w));
        vec4 weight = 1.0 - smoothstep(0.0, uMoatWidth * .64, edges - distanceToBank);
        vec2 moatDirection = normalize(vec2(weight.y - weight.w, weight.z - weight.x) + vec2(.0001));
        float isMoat = step(vLocal.y, -.5);
        vec2 flow = mix(vec2(-1.0, 0.0), moatDirection, isMoat);
        float center = 1.0 - abs(distanceToBank / (uMoatWidth * .5) - 1.0);
        float speed = mix(.92, mix(.24, .65, clamp(center, 0.0, 1.0)), isMoat);
        vec2 advected = vWorld.xz - flow * uTime * speed;
        vec4 broad = texture2D(uRipple, advected / 15.0);
        vec4 fine = texture2D(uRipple, (advected - flow * uTime * .17) / 6.4 + .37);
        vec2 slope = (broad.xy - .5) * .46 + (fine.xy - .5) * .24;
        vec3 normal = normalize(vec3(slope.x, 1.0, slope.y));
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 reflected = reflect(-view, normal);
        float fresnel = .045 + .955 * pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 5.0);
        vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(.0, .85, reflected.y));
        float daylight = .43 + .57 * uDayNight.x;
        vec3 deep = vec3(.032, .118, .133) * daylight;
        vec3 bank = vec3(.075, .136, .109) * daylight;
        vec3 body = mix(bank, deep, mix(.8, smoothstep(.0, 10.0, min(distanceToBank, uMoatWidth - distanceToBank)), isMoat));
        float glint = pow(max(0.0, dot(normal, normalize(uSunDir + view))), 115.0);
        vec3 reflection = max(sky * .64 + uAmbSky * .19, vec3(.032, .072, .085));
        vec3 color = mix(body, reflection, .20 + .67 * fresnel);
        color += uSunColor * glint * (.18 + .3 * fresnel) * uDayNight.x;
        color += vec3(.021, .041, .045) * (broad.b + fine.a - 1.0) * daylight;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function waterSurface(material, x0, z0, x1, z1, y) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  return mesh;
}

function palaceGround(lib) {
  const ground = new THREE.Group();
  const pale = { color: 0xbab8a8 };
  ground.add(
    surface(lib, 'ground_brick', -391, -433, 391, 439, .035),
    surface(lib, 'ground_brick', -391, 439, -60, 563, .035),
    surface(lib, 'ground_brick', 60, 439, 391, 563, .035),
    surface(lib, 'stone_slab', -24, -510, 24, -433, .035, pale),
    surface(lib, 'stone_slab', -10, -431, 10, 562, .074, pale),
    surface(lib, 'stone_slab', -60, 526, 60, 563, .035, pale),
  );
  const { x0, x1, z0, z1, width: w } = MOAT;
  for (const [left, south, right, north] of [
    [x0, z0, x1, z0 + w], [x0, z1 - w, x1, z1],
    [x0, z0 + w, x0 + w, z1 - w], [x1 - w, z0 + w, x1, z1 - w],
  ]) {
    ground.add(waterSurface(lib.water, left, south, right, north, MOAT_LEVEL));
  }
  for (const { axis, side, at, half } of PALACE_SITE.crossings) {
    const b = side === 'south' ? z0 : side === 'north' ? z1 - w : side === 'east' ? x0 : x1 - w;
    ground.add(axis === 'z'
      ? surface(lib, 'stone_slab', at - half, b, at + half, b + w, .065, pale)
      : surface(lib, 'stone_slab', b, at - half, b + w, at + half, .065, pale));
  }
  return mergeByMaterial(ground, { name: '宫城铺地与护城河', castShadow: false, receiveShadow: false });
}

class PalaceCollision {
  constructor() {
    this.bounds = new THREE.Box3(new THREE.Vector3(SITE.minX, 0, SITE.minZ), new THREE.Vector3(SITE.maxX, 0, SITE.maxZ))
      .applyMatrix4(toIsland);
    this.cells = new Map();
    this.bodies = new Map();
    this.walkSurfaces = new Map();
  }

  index(grid, local) {
    const box = local.clone().applyMatrix4(toIsland);
    this.addToCells(grid, box, box);
  }

  addWalkSurface(box, start, end) {
    this.addToCells(this.walkSurfaces, box, { box, start, end });
  }

  addToCells(grid, box, value) {
    for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++) {
      for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) {
        const key = x * 4096 + z;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(value);
      }
    }
  }

  contains(x, z) {
    const { min, max } = this.bounds;
    return x >= min.x && x <= max.x && z >= min.z && z <= max.z;
  }

  groundHeightAt(x, z) {
    if (!this.contains(x, z)) return NONE;
    const moatDepth = moatCutLocal((ORIGIN.x - x) / SCALE, (ORIGIN.z - z) / SCALE);
    let y = moatDepth < 0 ? NONE : ORIGIN.y;
    const supports = this.walkSurfaces.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
    for (const { box, start, end } of supports ?? []) {
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
      if (!start) {
        y = Math.max(y, box.max.y);
        continue;
      }
      const dx = end.x - start.x, dz = end.z - start.z;
      const along = ((x - start.x) * dx + (z - start.z) * dz) / (dx * dx + dz * dz);
      y = Math.max(y, THREE.MathUtils.lerp(start.y, end.y, THREE.MathUtils.clamp(along, 0, 1)));
    }
    return y;
  }

  heightAt(x, z) {
    let h = this.groundHeightAt(x, z);
    const boxes = this.cells.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
    if (boxes) for (const { min, max } of boxes) {
      if (x >= min.x && x <= max.x && z >= min.z && z <= max.z) h = Math.max(h, max.y);
    }
    return h;
  }

  collide(p, r) {
    const waterY = ORIGIN.y + MOAT_LEVEL * VERTICAL;
    if (p.y - r < waterY + .12 && moatCutLocal((ORIGIN.x - p.x) / SCALE, (ORIGIN.z - p.z) / SCALE) < MOAT_LEVEL) return true;
    // Only the walking probe uses these volume checks. Flight uses the shared height-envelope path.
    for (let x = Math.floor((p.x - r) / CELL); x <= Math.floor((p.x + r) / CELL); x++) {
      for (let z = Math.floor((p.z - r) / CELL); z <= Math.floor((p.z + r) / CELL); z++) {
        const boxes = this.bodies.get(x * 4096 + z);
        if (!boxes) continue;
        for (const { min, max } of boxes) {
          const dx = p.x - THREE.MathUtils.clamp(p.x, min.x, max.x);
          const dy = p.y - THREE.MathUtils.clamp(p.y, min.y, max.y);
          const dz = p.z - THREE.MathUtils.clamp(p.z, min.z, max.z);
          if (dx * dx + dy * dy + dz * dz < r * r - 1e-8) return true;
        }
      }
    }
    return false;
  }
}

function addAuxiliaryCourts(root, lib, addSolid, collision) {
  const courtPaving = { color: 0xb8aaa0 };
  const ivory = { color: 0xd3c3a4 };
  for (const { name, x, z } of EXTRA_COURTS) {
    root.add(
      surface(lib, 'ground_brick', x - 35, z - 23, x + 35, z + 52, .085, courtPaving),
      surface(lib, 'stone_slab', x - 3.2, z - 23, x + 3.2, z + 19, .11, ivory),
      surface(lib, 'stone_slab', x - 34, z - 20.7, x + 34, z - 19.5, .115, ivory),
    );
    const hallAt = (name, dx, dz, w, d, colH, options = {}) => placeHall(root,
      hall(lib, { name, x: x + dx, z: z + dz, w, d, colH, ...options }), addSolid, collision);
    hallAt(name, 0, 23, 32, 15, 8.8, { ph: 2.4, layers: 2 });
    hallAt(name + '东配殿', -22, 0, 17, 9, 5.6, { rot: 'east' });
    hallAt(name + '西配殿', 22, 0, 17, 9, 5.6, { rot: 'west' });
    hallAt(name + '后殿', 0, 44, 25, 10, 5.1);
    for (const side of [-1, 1]) {
      const pedestal = box(lib, 'marble', 3.2, .55, 3.2, x + side * 8, .275, z - 20);
      const post = box(lib, 'wood_column', .35, 3.35, .35, x + side * 8, 2.2, z - 20);
      const lamp = box(lib, 'gold_trim', .95, 1.3, .95, x + side * 8, 3.62, z - 20);
      addSolid(root, pedestal);
      root.add(post, lamp);
    }
  }
  return EXTRA_COURTS.length * 4;
}

function palacePlanting(terrain, lib) {
  const plantings = new THREE.Group(), points = [];
  const { x0, x1, z1, z0 } = MOAT;
  for (let z = -421; z < 614; z += 24) {
    if (Math.abs(z + 258) < 26 || Math.abs(z + 326) < 23) continue;
    points.push([x0 - 9, z, 3.9], [x1 + 9, z, 3.7]);
  }
  for (let x = -430; x <= 430; x += 23) {
    if (Math.abs(x) < 45) continue;
    points.push([x, z0 - 12, 3.7], [x, z1 + 4, 4.1]);
  }
  for (const side of [-1, 1]) {
    for (const d of [448, 466, 482, 506, 516]) points.push([side * (33 + ((d % 7) - 3) * 3), d, 3.9 + (d % 5) * .36]);
  }
  const trunk = new THREE.CylinderGeometry(.17, .27, 1, 6);
  const crown = new THREE.IcosahedronGeometry(1, 1);
  const bark = new THREE.MeshStandardMaterial({ color: 0x654d37, roughness: 1 });
  const leaves = [0x466643, 0x627449, 0x385b45].map(color => new THREE.MeshStandardMaterial({ color, roughness: .91 }));
  for (const [i, [x, z, h]] of points.entries()) {
    const wx = ORIGIN.x - x * SCALE, wz = ORIGIN.z - z * SCALE;
    const y = (terrain.heightAt(wx, wz) - ORIGIN.y) / VERTICAL;
    if (!Number.isFinite(y)) continue;
    const stem = new THREE.Mesh(trunk, bark);
    stem.scale.y = h;
    stem.position.set(x, y + h / 2, z);
    plantings.add(stem);
    for (let c = 0; c < 3; c++) {
      const tuft = new THREE.Mesh(crown, leaves[(i + c) % leaves.length]);
      tuft.position.set(x + Math.cos(i + c * 2.1) * 1.07, y + h + c * .28, z + Math.sin(i + c * 2.1) * .93);
      tuft.scale.set(1.75 + (i % 3) * .27, 1.52 + c * .15, 1.85);
      plantings.add(tuft);
    }
  }
  for (const x of [-48, 48]) {
    plantings.add(surface(lib, 'pebble_path', x - 2.1, 434, x + 2.1, 522, .09, { color: 0xb1b399 }));
  }
  return mergeByMaterial(plantings, { name: '御花园与宫城外围林带', castShadow: false, receiveShadow: false });
}

function observationDeck(root, lib, collision) {
  const x = -397, z = -326, width = 25, depth = 28, height = 9, run = 24, rampWidth = 10;
  const base = box(lib, 'wall_brick', width, height, depth, x, height / 2, z);
  root.add(base);
  collision.index(collision.bodies, new THREE.Box3().setFromObject(base));
  root.add(box(lib, 'stone_slab', width, .4, depth, x, height - .2, z));
  const edge = z - depth / 2;
  const rampEnd = edge - 1.1;
  const ramp = new THREE.BufferGeometry();
  ramp.setAttribute('position', new THREE.Float32BufferAttribute([
    x - rampWidth / 2, .04, edge - run, x + rampWidth / 2, .04, edge - run,
    x - rampWidth / 2, height, rampEnd, x + rampWidth / 2, height, rampEnd,
  ], 3));
  ramp.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2.5, 0, 0, 6, 2.5, 6], 2));
  ramp.setIndex([0, 2, 1, 1, 2, 3]);
  ramp.computeVertexNormals();
  root.add(new THREE.Mesh(ramp, lib.material('stone_slab', { side: THREE.DoubleSide })));
  const local = (x0, x1, z0, z1) => new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, height, z1));
  const top = local(x - width / 2, x + width / 2, edge, z + depth / 2).applyMatrix4(toIsland);
  root.add(box(lib, 'stone_slab', rampWidth, .30, edge - rampEnd, x, height - .15, (edge + rampEnd) / 2));
  const slope = local(x - rampWidth / 2, x + rampWidth / 2, edge - run, rampEnd).applyMatrix4(toIsland);
  const landing = local(x - rampWidth / 2, x + rampWidth / 2, rampEnd, edge).applyMatrix4(toIsland);
  const from = new THREE.Vector3(x, .04, edge - run).applyMatrix4(toIsland);
  const to = new THREE.Vector3(x, height, rampEnd).applyMatrix4(toIsland);
  collision.addWalkSurface(top);
  collision.addWalkSurface(landing);
  collision.addWalkSurface(slope, from, to);
  return new THREE.Vector3(x, height, z);
}

export function createPalace(terrain, ripple = makeWaveNormalTexture()) {
  const lib = new TextureLibrary();
  paintedTextures(lib);
  lib.materials.set('gold_trim|{}', new THREE.MeshStandardMaterial({
    name: 'palace_gilt_trim', color: 0xeab356, roughness: .34, metalness: .23,
  }));
  lib.windows = palaceWindows();
  lib.water = palaceWater(ripple);
  const collision = new PalaceCollision();
  const roofMaterials = new Map();
  const group = new THREE.Group();
  group.name = '故宫';
  group.position.copy(ORIGIN);
  group.rotation.y = Math.PI;
  group.scale.set(SCALE, VERTICAL, SCALE);
  group.add(palaceGround(lib));
  const addSolid = (root, model, walkBoxes, flightBoxes) => {
    const bounds = new THREE.Box3().setFromObject(model);
    for (const b of flightBoxes ?? [bounds]) collision.index(collision.cells, b);
    for (const b of walkBoxes ?? [bounds]) collision.index(collision.bodies, b);
    root.add(model);
  };
  const axial = new THREE.Group();
  outerWalls(axial, lib, addSolid);
  const deck = observationDeck(axial, lib, collision);
  addRiver(axial, lib, addSolid);
  for (const item of PALACE_LAYOUT) {
    const { name, type, position: { x, y, z }, dimensions: d, features: f } = item;
    if (name === '午门') {
      const { group: gate, colliders, flightBounds } = buildWumen(lib, item, (materials, { width, depth, height, bays }) => facade(materials, width, depth, height, bays));
      const offset = new THREE.Vector3(x, y, z);
      addSolid(axial, gate, colliders.map(b => b.clone().translate(offset)), flightBounds);
      const sign = plaque(name, 23.48, -10.86);
      sign.position.add(offset);
      axial.add(sign);
    } else if (name === '神武门') {
      addPortal(axial, lib, { kind: 'cityGate', x, z, name, rot: 'north' }, addSolid);
    } else if (name === '乾清门') {
      addPortal(axial, lib, { kind: 'gate', style: 'hall', x, z, name, w: d.width, roof: f.roofType }, addSolid);
    } else if (type === 'gate' || type === 'palace') {
      const ph = d.baseHeight ?? 2.5;
      const building = hall(lib, { x, y, z, name, w: d.width, d: d.depth, ph, colH: (d.height - ph) * (name === '太和殿' ? .57 : .54),
        roof: f.roofType, layers: f.roofLayers, baseLayers: d.baseLayers, detail: 'high',
        formal: name === '太和门' || name === '太和殿' });
      placeHall(axial, building, addSolid, collision);
    }
  }
  group.add(mergeDistrict(axial, '故宫中轴', roofMaterials));
  let buildings = 0;
  for (const zone of [axis, garden, east, west, ningshou, outerEast, outerWest]) {
    const district = new THREE.Group();
    for (const item of zone.items) {
      if (item.kind === 'corridor') {
        addCorridor(district, lib, item, addSolid);
        continue;
      }
      if (item.kind === 'nineDragonWall') {
        const wall = new THREE.Group();
        wall.position.set(item.x, 0, item.z);
        wall.add(box(lib, 'marble', item.length + 1, .8, 2, 0, .4, 0),
          box(lib, 'caihua_beam', item.length, item.height, 1.25, 0, .8 + item.height / 2, 0));
        const roof = buildWallCap(lib, { length: item.length + .3, thickness: 2 });
        roof.position.y = item.height + .8;
        wall.add(roof);
        addSolid(district, wall);
      }
      if (item.kind !== 'hall') continue;
      if (Number.isFinite(item.w) && Number.isFinite(item.d)) {
        placeHall(district, hall(lib, { ...item, name: item.name || '院落配殿',
          roof: item.name === '畅音阁' ? 'xieshan' : item.roof,
          layers: item.name === '畅音阁' ? 2 : item.layers,
          storeys: item.name === '畅音阁' ? 3 : item.name === '文渊阁' ? 2 : item.storeys || item.floors,
          bays: item.name === '文渊阁' ? 6 : item.bays,
          finish: item.name === '文渊阁' ? 'black' : ['古华轩', '畅音阁'].includes(item.name) ? 'green'
            : item.roof === 'gable' || !item.name ? 'gray' : undefined,
          detail: ['皇极殿', '宁寿宫', '慈宁宫', '武英殿', '文华殿', '畅音阁', '文渊阁'].includes(item.name) ? 'high' : 'low',
        }), addSolid, collision);
        buildings++;
      } else if (item.qinanProfile) {
        const gardenLayout = PALACE_LAYOUT.find(entry => entry.type === 'garden');
        const { dimensions: { width, depth, height } } = gardenLayout.elements.find(entry => entry.name === item.name);
        placeHall(district, hall(lib, { ...item, w: width, d: depth, colH: height * 0.55, roof: 'wudian' }), addSolid, collision);
        buildings++;
      }
    }
    addCourtyardWalls(district, lib, zone, addSolid);
    group.add(mergeDistrict(district, zone.name, roofMaterials));
  }
  const auxiliary = new THREE.Group();
  buildings += addAuxiliaryCourts(auxiliary, lib, addSolid, collision);
  group.add(mergeDistrict(auxiliary, '外朝与东西路新增配殿', roofMaterials));
  const life = terrain && createPalaceLife(terrain, lib, addSolid);
  if (life) group.add(palacePlanting(terrain, lib), life.group);
  // The island grades linear shadows aggressively. Keep the palace's painted surfaces
  // readable on the unlit side of the walls without applying bloom or a second sun.
  const bounceMaterials = new Set(), glazedMaterials = new Set();
  group.traverse(mesh => {
    const material = mesh.material;
    if (!material?.isMeshStandardMaterial || material.emissive.getHex() || bounceMaterials.has(material)) return;
    if (['roof_tile_material', 'roof_ridge_glaze', 'roof_finial_gold', 'palace_gilt_trim'].includes(material.name)) {
      glazedMaterials.add(material);
      material.roughness = material.name === 'roof_tile_material' ? .34 : .30;
    }
    material.emissive.copy(material.color);
    material.emissiveMap = material.map;
    bounceMaterials.add(material);
  });
  const setEnvironment = texture => {
    for (const material of glazedMaterials) {
      material.envMap = texture;
      material.envMapIntensity = material.name === 'roof_tile_material' ? .28 : .51;
      material.needsUpdate = true;
    }
  };
  const update = (dt = 0, camera) => {
    const { x: daylight, y: night, z: dusk } = U.uDayNight.value;
    const glow = Math.max(night, dusk * .82);
    lib.windows.pane.emissiveIntensity = 1.85 * glow;
    for (const material of bounceMaterials) material.emissiveIntensity = .14 + .24 * daylight;
    life?.update(U.uTime.value, glow, dt, camera);
  };
  update();
  const entrance = new THREE.Vector3(0, 0, -480).applyMatrix4(toIsland);
  const landmark = { id: PALACE_ID, name: '故宫 · 午门广场', kind: 'place', hidden: false, radius: 70, pos: entrance,
    description: '秋英坡上的故宫。可骑魔毯飞到午门广场，按 G 降落后步行穿过午门。' };
  const pad = (id, name, pos, radius, spot, yaw = 0) => ({
    id: 'palace-' + id, name, pos, radius, spot, yaw, approach: yaw, town: '故宫',
    kind: 'ground', gold: true,
  });
  const pads = [
    pad('wumen', '午门广场', entrance.clone(), 4.3, '地面广场'),
    pad('taihemen', '太和门前广场', new THREE.Vector3(-39, 0, -272).applyMatrix4(toIsland), 4.2, '地面广场'),
    pad('east-deck', '东观景台', deck.applyMatrix4(toIsland), 3.7, '屋顶观景台'),
  ];
  const exit = new THREE.Vector3(0, 0, -590).applyMatrix4(toIsland);
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.2);
  const fill = new THREE.HemisphereLight(0xc9deff, 0xa28c71, 1.7);
  return { group, collision, landmark, pads, exit, sun, fill, buildings, update, setEnvironment, loadVendors: life?.loadVendors };
}
