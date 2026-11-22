import * as THREE from 'three';
import { applyBoxUV, applyBandUV, applyPlanarUV } from '../../utils/GeometryUV.js';
import { buildRoof } from '../RoofBuilder.js';
import { buildHallBody, buildSumeruBase, buildStuddedDoor } from '../HallKit.js';
import { mergeByMaterial } from '../../utils/MergeUtils.js';
import { worldBox } from './colliders.js';
import { buildGateAscent } from './gateAscent.js';
import { WUMEN_VERTICAL_PROFILE } from './special/WumenVerticalProfile.js';

/**
 * 午门：中央城台（红墙，三个拱券门洞）+ 重檐城楼 + 两侧雁翅楼
 * 
 * 回归测试要求（相对午门中心 p，P0c-1 起 p.z = LAYOUT.WUMEN_Z = −419.6）：
 * - (p.x + 15, p.z) 阻挡（侧墙实体）
 * - (p.x + 40, p.z − 14) 不阻挡（翼楼之间空地）
 * - 中轴 x=0, z ∈ [p.z − 18, p.z + 18] 可通行（中门洞贯通）
 */
export function buildWumen(lib, data, buildBody = buildHallBody) {
  const { position: p, dimensions: d, features } = data;
  const group = new THREE.Group();
  group.name = 'wumen';
  const colliders = [];
  const ownedMaterials = [];

  // 中央城台尺寸：宽 platformWidth（默认 78，x ∈ [-39, 39]），深 = d.depth，高 13m
  const platformW = d.platformWidth ?? 78;
  const platformD = d.platformNorth - d.platformSouth;
  const platformZ = (d.platformNorth + d.platformSouth) / 2;
  const platformH = d.platformHeight;
  
  // 城台主体（红墙，底部 1m 高灰石须弥座腰线）
  const baseH = 1;
  const wallH = platformH - baseH;
  

  // 红墙主体（三个门洞：中门 x ∈ [-4.5, 4.5]，左右掖门 x ∈ ±[15, 20]）
  const gateOpenings = [
    { x: 0, w: 9 },      // 中门
    { x: -17.5, w: 5 },  // 左掖门
    { x: 17.5, w: 5 }    // 右掖门
  ];
  
  // 墙段：门洞之间和两端的实体墙
  const wallSegments = [];
  let prevRight = -platformW / 2;
  gateOpenings.sort((a, b) => a.x - b.x).forEach(opening => {
    const left = opening.x - opening.w / 2;
    if (left > prevRight + 0.5) {
      wallSegments.push({ x: (prevRight + left) / 2, w: left - prevRight });
    }
    prevRight = opening.x + opening.w / 2;
  });
  if (prevRight < platformW / 2 - 0.5) {
    wallSegments.push({ x: (prevRight + platformW / 2) / 2, w: platformW / 2 - prevRight });
  }

  wallSegments.forEach(seg => {
    const wall = new THREE.Mesh(
      applyBoxUV(new THREE.BoxGeometry(seg.w, wallH, platformD), lib.tileSize('wall_red')),
      lib.material('wall_red')
    );
    wall.position.set(seg.x, baseH + wallH / 2, platformZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    const band = new THREE.Mesh(
      applyBandUV(new THREE.BoxGeometry(seg.w + 0.1, baseH, platformD + 0.2), lib.tileSize('sumeru_band')),
      lib.material('sumeru_band')
    );
    band.position.set(seg.x, baseH / 2, platformZ);
    band.receiveShadow = true;
    group.add(band);
    // 局部盒以 mesh 中心为原点：y 需减去中心高度，才能落在地面 0~3m（玩家身高范围）
    colliders.push(worldBox(wall, new THREE.Box3(
      new THREE.Vector3(-seg.w / 2, -wall.position.y, -platformD / 2),
      new THREE.Vector3(seg.w / 2, 3 - wall.position.y, platformD / 2)
    )));
  });

  // 门洞：与神武门同一做法 —— 洞壁就是两侧红墙的侧面，洞顶为砖砌顶板；
  // 门扇在距南面 2m 处向内打开，左右两扇分别平贴门洞东西两壁，不挡通道。
  gateOpenings.forEach(opening => {
    const tunnelH = opening.w >= 8 ? 8 : 6.5;
    const above = new THREE.Mesh(
      applyBoxUV(new THREE.BoxGeometry(opening.w, platformH - tunnelH, platformD), lib.tileSize('wall_red')),
      lib.material('wall_red')
    );
    above.position.set(opening.x, tunnelH + (platformH - tunnelH) / 2, platformZ);
    group.add(above);
    const ceil = new THREE.Mesh(
      applyBoxUV(new THREE.BoxGeometry(opening.w, 0.3, platformD - 0.2), lib.tileSize('wall_brick')),
      lib.material('wall_brick')
    );
    ceil.position.set(opening.x, tunnelH - 0.15, platformZ);
    group.add(ceil);
    const leafW = opening.w * 0.48;
    for (const s of [-1, 1]) {
      const door = buildStuddedDoor(lib, { width: leafW, height: tunnelH - 0.5 });
      door.position.set(opening.x + s * (opening.w / 2 - 0.15), 0, d.platformSouth + 2 + leafW / 2);
      door.rotation.y = Math.PI / 2;
      group.add(door);
    }
  });

  // 登城马道：城台北面（宫内一侧）东西两端各一条，沿城台端头向外下行到太和门广场；
  // 城台顶四周汉白玉栏杆（带碰撞），在马道到达处开口。顶面可行走，可绕城楼一圈远眺。
  const ascent = buildGateAscent(lib, group, {
    W: platformW, D: platformD, topY: platformH,
    band: [platformD / 2 - 6, platformD / 2], edge: 'rail',
  });
  colliders.push(...ascent.colliders);
  const walkables = ascent.walkables;

  // 城楼（重檐庑殿，建在城台顶部中央）
  const profile = WUMEN_VERTICAL_PROFILE;
  const towerBase = profile.retained.floorY;
  const hallBody = buildBody(lib, {
    width: d.width, depth: d.depth, height: profile.body.height, bays: 9, facade: 'lattice'
  });
  hallBody.position.y = towerBase;
  group.add(hallBody);
  hallBody.userData.colliders?.forEach(box => {
    const wb = box.clone();
    wb.min.add(new THREE.Vector3(0, towerBase, 0));
    wb.max.add(new THREE.Vector3(0, towerBase, 0));
    colliders.push(wb);
  });

  const roof = buildRoof(lib, {
    type: 'wudian', width: profile.retained.roofInputWidth, depth: profile.retained.roofInputDepth,
    baseY: towerBase + hallBody.userData.topY, layers: 2, brackets: true, height: 9,
    wumenVerticalProfile: profile
  });
  group.add(roof);
  if (roof.userData.ownedMaterials) ownedMaterials.push(...roof.userData.ownedMaterials);

  // 沿城台两翼布置长廊，四座重檐方亭分立南北两端。
  for (const side of [-1, 1]) {
    const wingW = d.wingHallWidth;
    const wingX = side * (d.wingInnerX + 0.6 + wingW / 2);
    const wingL = d.platformSouth - d.wingSouth;
    const wingZ = (d.platformSouth + d.wingSouth) / 2;
    const wingPlatform = new THREE.Mesh(
      applyBoxUV(new THREE.BoxGeometry(wingW + 4, platformH, wingL), lib.tileSize('wall_red')),
      lib.material('wall_red')
    );
    wingPlatform.position.set(wingX, platformH / 2, wingZ);
    group.add(wingPlatform);
    colliders.push(new THREE.Box3().setFromObject(wingPlatform));

    const pavilion = d.cornerPavilion;
    const south = d.wingSouth + pavilion / 2;
    const north = -pavilion / 2;
    const passage = north - south - pavilion;
    const wing = new THREE.Group();
    wing.position.set(wingX, towerBase, (south + north) / 2);
    wing.rotation.y = Math.PI / 2;
    const wingBody = buildBody(lib, { width: passage, depth: wingW, height: 6.5, bays: 13 });
    wing.add(wingBody, buildRoof(lib, { type: 'wudian', width: passage + 0.4, depth: wingW + 0.4,
      baseY: wingBody.userData.topY, brackets: true, detail: 'low' }));
    group.add(wing);
    for (const z of [south, north]) {
      const corner = new THREE.Group();
      corner.position.set(wingX, towerBase, z);
      const cornerBody = buildBody(lib, { width: pavilion, depth: pavilion, height: 7.5, bays: 3 });
      corner.add(cornerBody, buildRoof(lib, { type: 'pavilion', width: pavilion + 0.4, depth: pavilion + 0.4,
        baseY: cornerBody.userData.topY, layers: 2, brackets: true, detail: 'high' }));
      group.add(corner);
    }
  }

  group.position.set(p.x, p.y, p.z);
  group.updateMatrixWorld(true);

  // Preserve individual flight envelopes before merging the wings with the central tower.
  const flightBounds = [];
  group.traverse(mesh => {
    if (mesh.isMesh) flightBounds.push(new THREE.Box3().setFromObject(mesh));
  });
  return { group: mergeByMaterial(group), colliders, walkables, ownedMaterials, flightBounds };
}
