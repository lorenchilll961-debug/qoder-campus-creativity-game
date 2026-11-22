import * as THREE from 'three';
import { PALACE_LAYOUT } from '../../vendor/forbidden-city/src/scene/Layout.js';
import { buildHallBody, buildSumeruBase } from '../../vendor/forbidden-city/src/scene/HallKit.js';
import { buildCornerTower, buildRoof, buildWallCap } from '../../vendor/forbidden-city/src/scene/RoofBuilder.js';
import { buildWumen } from '../../vendor/forbidden-city/src/scene/palace/gate.js';
import { applyBoxUV } from '../../vendor/forbidden-city/src/utils/GeometryUV.js';
import { mergeByMaterial } from '../../vendor/forbidden-city/src/utils/MergeUtils.js';
import { TextureLibrary } from '../../vendor/forbidden-city/src/utils/TextureLibrary.js';
import axis from '../../vendor/forbidden-city/data/zones/axis-courts.json' with { type: 'json' };
import garden from '../../vendor/forbidden-city/data/zones/garden.json' with { type: 'json' };
import east from '../../vendor/forbidden-city/data/zones/east-six.json' with { type: 'json' };
import west from '../../vendor/forbidden-city/data/zones/west-six.json' with { type: 'json' };

const SCALE = 0.4;
const ORIGIN = new THREE.Vector3(108, 132, -732);
// The upstream model uses +Z for north and -X for east. The island uses the opposite axes.
const toIsland = new THREE.Matrix4().makeScale(-SCALE, SCALE, -SCALE).setPosition(ORIGIN);
const NONE = -1e9;
const SITE = { minX: -385, maxX: 385, minZ: -500, maxZ: 555 };
const CELL = 24;
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

function hall(lib, { name, x, z, w, d, y = 0, ph = 1.4, colH = 6, roof = 'xieshan', layers = 1,
  rot = 0, baseLayers = 1, detail = 'low', formal = false }) {
  const building = new THREE.Group();
  building.name = name;
  building.position.set(x, y, z);
  building.rotation.y = rotations[rot] ?? rot;
  const plinth = buildSumeruBase(lib, { width: w + 3, depth: d + 3, height: ph, layers: baseLayers, balustrade: false });
  building.add(plinth);
  const bays = name === '太和殿' ? 11 : name === '太和门' ? 9 : undefined;
  const body = buildHallBody(lib, { width: w, depth: d, height: colH, bays });
  body.position.y = ph;
  building.add(body);
  const taihe = name === '太和殿';
  building.add(buildRoof(lib, { type: roof, width: w + (taihe ? .6 : 2), depth: d + (taihe ? .6 : 2),
    baseY: ph + body.userData.topY, layers, detail, sides: 4, brackets: true, ...(taihe ? { walkingBeastProfile: 'taihe' } : {}) }));
  if (formal) {
    const physical = [body, ...plinth.children];
    const walkables = plinth.children.map(mesh => ({ mesh }));
    marbleRails(lib, building, w, d, ph, baseLayers);
    building.add(plaque(name, ph + colH * .86, -d / 2 - .65));
    const tierHeight = ph / baseLayers;
    const count = Math.ceil(tierHeight / .24), rise = tierHeight / count;
    const tierDepth = (d + 3 + (baseLayers - 1) * 3) / 2;
    for (const side of [-1, 1]) {
      const edge = side * ((d + 3) / 2);
      const run = side * (tierDepth + count * baseLayers * .44 + .5);
      for (let step = 1; step <= count * baseLayers; step++) {
        const inner = step === count * baseLayers ? edge : run + (edge - run) * step / (count * baseLayers);
        const outer = run + (edge - run) * (step - 1) / (count * baseLayers);
        building.add(box(lib, 'marble', 6.4, step * rise, Math.abs(outer - inner), 0, step * rise / 2, (inner + outer) / 2));
      }
      walkables.push({ run, edge, h: ph });
    }
    building.userData.terrace = { walkables, physical };
  }
  return building;
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

function outerWalls(root, lib, addSolid) {
  const outer = PALACE_LAYOUT.find(item => item.type === 'outer_wall');
  const { width, depth, wallHeight, wallThickness } = outer.dimensions;
  const x = (width + wallThickness) / 2, z = (depth + wallThickness) / 2;
  const north = outer.position.z + z, south = outer.position.z - z;
  const wall = (x0, z0, x1, z1) => addWall(root, lib, x0, z0, x1, z1, wallHeight, wallThickness, addSolid);
  for (const side of [-1, 1]) {
    wall(side * x, south, side * x, north);
    wall(side * 32, south, side * x, south);
    wall(side * 22, north, side * x, north);
    for (const end of [north, south]) {
      const tower = buildCornerTower(lib, { size: 15 });
      tower.position.set(side * x, wallHeight, end);
      addSolid(root, tower);
    }
  }
}

function addCourtyardWalls(root, lib, zone, addSolid) {
  const gates = new Map(zone.items.filter(item => item.kind === 'gate').map(item => [item.name, item]));
  for (const item of zone.items) {
    if (item.kind !== 'wall') continue;
    const [x0, z0] = item.from, [x1, z1] = item.to;
    const alongX = z0 === z1;
    if (!alongX && x0 !== x1) continue;
    const start = Math.min(alongX ? x0 : z0, alongX ? x1 : z1);
    const end = Math.max(alongX ? x0 : z0, alongX ? x1 : z1);
    const gaps = (item.gaps || []).map(gap => ({
      at: gap.at, half: (gap.w ?? ((gates.get(gap.gate)?.w ?? 4) + 2.8)) / 2,
    })).sort((a, b) => a.at - b.at);
    let cursor = start;
    const segment = (from, to) => {
      if (to <= from) return;
      const args = alongX ? [from, z0, to, z0] : [x0, from, x0, to];
      addWall(root, lib, ...args, item.h ?? 4, item.t ?? 0.8, addSolid);
    };
    for (const { at, half } of gaps) {
      segment(cursor, Math.min(end, at - half));
      cursor = Math.max(cursor, at + half);
    }
    segment(cursor, end);
  }
}

function addRiver(root, lib, addSolid) {
  const river = PALACE_LAYOUT.find(item => item.type === 'river');
  const { width, depth } = river.dimensions;
  const { z } = river.position;
  // Shallow ornamental channel on the island terrace. The bridges preserve the upstream spacing.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), lib.material('water', { roughness: 0.22 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.035, z);
  root.add(water);
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

function makeTerrace(terrain, lib) {
  const { minX, maxX, minZ, maxZ } = SITE;
  // Stone retaining wall follows the original height field at its foot.
  const terrace = new THREE.Group();
  const roof = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
  const uv = roof.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (maxX - minX) / 4, uv.getY(i) * (maxZ - minZ) / 4);
  const top = new THREE.Mesh(roof, lib.material('ground_brick'));
  top.rotation.x = -Math.PI / 2;
  top.position.set((maxX + minX) / 2, 0, (maxZ + minZ) / 2);
  terrace.add(top);
  const corners = [[minX, minZ], [minX, maxZ], [maxX, maxZ], [maxX, minZ]];
  const vertices = [], coords = [], indices = [];
  const point = new THREE.Vector3();
  for (let side = 0; side < corners.length; side++) {
    const [ax, az] = corners[side], [bx, bz] = corners[(side + 1) % corners.length];
    const length = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(length / 12);
    for (let i = 0; i <= n; i++) {
      const x = THREE.MathUtils.lerp(ax, bx, i / n), z = THREE.MathUtils.lerp(az, bz, i / n);
      point.set(x, 0, z).applyMatrix4(toIsland);
      const bottom = Math.min(-1, (terrain.heightAt(point.x, point.z) - ORIGIN.y - 1) / SCALE);
      const index = vertices.length / 3;
      vertices.push(x, 0, z, x, bottom, z);
      coords.push(length * i / n / 3, 0, length * i / n / 3, bottom / 3);
      if (i) indices.push(index - 2, index - 1, index, index - 1, index + 1, index);
    }
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  skirt.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  skirt.setIndex(indices);
  skirt.computeVertexNormals();
  terrace.add(new THREE.Mesh(skirt, lib.material('wall_brick', { side: THREE.DoubleSide })));
  return terrace;
}

class PalaceCollision {
  constructor() {
    this.bounds = new THREE.Box3(new THREE.Vector3(SITE.minX, 0, SITE.minZ), new THREE.Vector3(SITE.maxX, 0, SITE.maxZ))
      .applyMatrix4(toIsland);
    this.cells = new Map();
    this.bodies = new Map();
    this.walkSurfaces = [];
  }

  index(grid, local) {
    const b = local.clone().applyMatrix4(toIsland);
    for (let x = Math.floor(b.min.x / CELL); x <= Math.floor(b.max.x / CELL); x++) {
      for (let z = Math.floor(b.min.z / CELL); z <= Math.floor(b.max.z / CELL); z++) {
        const key = x * 4096 + z;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(b);
      }
    }
  }

  contains(x, z) {
    const { min, max } = this.bounds;
    return x >= min.x && x <= max.x && z >= min.z && z <= max.z;
  }

  groundHeightAt(x, z) {
    if (!this.contains(x, z)) return NONE;
    let y = ORIGIN.y;
    for (const { box, startZ, endZ } of this.walkSurfaces) {
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z) {
        const t = startZ === undefined ? 1 : THREE.MathUtils.clamp((z - startZ) / (endZ - startZ), 0, 1);
        y = Math.max(y, ORIGIN.y + (box.max.y - ORIGIN.y) * t);
      }
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

function observationDeck(root, lib, collision) {
  const x = -283, z = 40, width = 25, depth = 28, height = 9, run = 24, rampWidth = 10;
  const base = box(lib, 'wall_brick', width, height, depth, x, height / 2, z);
  root.add(base);
  collision.index(collision.bodies, new THREE.Box3().setFromObject(base));
  root.add(box(lib, 'stone_slab', width, .4, depth, x, height - .2, z));
  const edge = z - depth / 2;
  const ramp = new THREE.BufferGeometry();
  ramp.setAttribute('position', new THREE.Float32BufferAttribute([
    x - rampWidth / 2, .04, edge - run, x + rampWidth / 2, .04, edge - run,
    x - rampWidth / 2, height, edge, x + rampWidth / 2, height, edge,
  ], 3));
  ramp.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2.5, 0, 0, 6, 2.5, 6], 2));
  ramp.setIndex([0, 2, 1, 1, 2, 3]);
  ramp.computeVertexNormals();
  root.add(new THREE.Mesh(ramp, lib.material('stone_slab', { side: THREE.DoubleSide })));
  const local = (x0, x1, z0, z1) => new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, height, z1));
  const top = local(x - width / 2, x + width / 2, edge, z + depth / 2).applyMatrix4(toIsland);
  const slope = local(x - rampWidth / 2, x + rampWidth / 2, edge - run, edge).applyMatrix4(toIsland);
  collision.walkSurfaces.push({ box: top }, { box: slope, startZ: slope.max.z, endZ: slope.min.z });
  return new THREE.Vector3(x, height, z);
}

export function createPalace(terrain) {
  const lib = new TextureLibrary();
  paintedTextures(lib);
  const collision = new PalaceCollision();
  const group = new THREE.Group();
  group.name = '故宫';
  group.position.copy(ORIGIN);
  group.rotation.y = Math.PI;
  group.scale.setScalar(SCALE);
  group.add(makeTerrace(terrain, lib));
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
      const { group: gate, colliders, flightBounds } = buildWumen(lib, item);
      const offset = new THREE.Vector3(x, y, z);
      addSolid(axial, gate, colliders.map(b => b.clone().translate(offset)), flightBounds);
      const sign = plaque(name, 23.48, -10.86);
      sign.position.add(offset);
      axial.add(sign);
    } else if (type === 'gate' || type === 'palace') {
      const ph = d.baseHeight ?? 2.5;
      const building = hall(lib, { x, y, z, name, w: d.width, d: d.depth, ph, colH: (d.height - ph) * 0.48,
        roof: f.roofType, layers: f.roofLayers, baseLayers: d.baseLayers, detail: 'high',
        formal: name === '太和门' || name === '太和殿' });
      const terrace = building.userData.terrace;
      if (terrace) {
        building.updateMatrixWorld(true);
        const air = building.children.filter(child => !terrace.physical.includes(child)).map(child => new THREE.Box3().setFromObject(child));
        const bodies = terrace.physical.map(child => new THREE.Box3().setFromObject(child));
        for (const { mesh, run, edge, h } of terrace.walkables) {
          if (mesh) {
            collision.walkSurfaces.push({ box: new THREE.Box3().setFromObject(mesh).applyMatrix4(toIsland) });
          } else {
            const ramp = new THREE.Box3(new THREE.Vector3(x - 3.2, 0, z + Math.min(run, edge)),
              new THREE.Vector3(x + 3.2, y + h, z + Math.max(run, edge))).applyMatrix4(toIsland);
            collision.walkSurfaces.push({ box: ramp, startZ: ORIGIN.z - (z + run) * SCALE, endZ: ORIGIN.z - (z + edge) * SCALE });
          }
        }
        // Only the upper architecture blocks the carpet above a visitable plinth.
        delete building.userData.terrace;
        addSolid(axial, building, bodies, [...bodies, ...air]);
      } else {
        addSolid(axial, building);
      }
    }
  }
  group.add(mergeByMaterial(axial, { name: '故宫中轴', castShadow: false, receiveShadow: false }));
  for (const zone of [axis, garden, east, west]) {
    const district = new THREE.Group();
    for (const item of zone.items) {
      if (item.kind !== 'hall' || !item.name) continue;
      if (Number.isFinite(item.w) && Number.isFinite(item.d)) {
        addSolid(district, hall(lib, item));
      } else if (item.qinanProfile) {
        const gardenLayout = PALACE_LAYOUT.find(entry => entry.type === 'garden');
        const { dimensions: { width, depth, height } } = gardenLayout.elements.find(entry => entry.name === item.name);
        addSolid(district, hall(lib, { ...item, w: width, d: depth, colH: height * 0.45, roof: 'wudian' }));
      }
    }
    addCourtyardWalls(district, lib, zone, addSolid);
    group.add(mergeByMaterial(district, { name: zone.name, castShadow: false, receiveShadow: false }));
  }
  const entrance = new THREE.Vector3(0, 0, -467).applyMatrix4(toIsland);
  const landmark = { id: PALACE_ID, name: '故宫 · 午门广场', kind: 'place', hidden: false, radius: 70, pos: entrance,
    description: '秋英坡上的故宫。可骑魔毯飞到午门广场，按 G 降落后步行穿过午门。' };
  const pad = (id, name, pos, radius, spot, yaw = 0) => ({
    id: 'palace-' + id, name, pos, radius, spot, yaw, approach: yaw, town: '故宫',
    kind: 'ground', gold: true,
  });
  const pads = [
    pad('wumen', '午门广场', entrance.clone(), 4.3, '地面广场'),
    pad('taihemen', '太和门前广场', new THREE.Vector3(-26, 0, -261).applyMatrix4(toIsland), 4.2, '地面广场'),
    pad('east-deck', '东观景台', deck.applyMatrix4(toIsland), 3.7, '屋顶观景台', Math.PI / 2),
  ];
  const exit = new THREE.Vector3(0, 0, -590).applyMatrix4(toIsland);
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.2);
  const fill = new THREE.HemisphereLight(0xc9deff, 0xa28c71, 1.7);
  return { group, collision, landmark, pads, exit, sun, fill };
}
