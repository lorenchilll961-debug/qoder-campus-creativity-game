import * as THREE from 'three';
import { meshOf, prism, slice } from './fracture.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = t => t * t * (3 - 2 * t);
const rectangular = (w, h) => [[-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]];
const WAIT = 8, REBUILD = 4;

function grain(kind) {
  const size = 128, texels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (x + y * size) * 4;
    const noise = 0.54 + 0.28 * Math.sin(x * 39.91 + y * 12.85) ** 2;
    const step = Math.floor(y / 16), row = y % 16;
    const mortar = kind === 'stone' && (row < 2 || ((x + step % 2 * 16) % 32 < 2));
    const seam = kind === 'tile' && ((x + (step % 2) * 4) % 12 < 2 || row < 2);
    const band = kind === 'wood' ? 0.8 + 0.18 * Math.sin(x * 0.7 + Math.sin(y * 0.08) * 2.1) : 1;
    texels[i] = texels[i + 1] = texels[i + 2] = (mortar ? 0.65 : seam ? 0.52 : noise * band) * 255;
    texels[i + 3] = 255;
  }
  const map = new THREE.DataTexture(texels, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

export function createWorkshop(terrain, x, z) {
  const root = new THREE.Group();
  root.name = '秋英坡守望工坊';
  root.position.set(x, terrain.heightAt(x, z) - 0.15, z);
  const make = (color, map) => new THREE.MeshStandardMaterial({ color, map, roughness: 0.88 });
  const stone = make(0xb5a086, grain('stone')), tile = make(0x496e7c, grain('tile'));
  const timber = make(0x815339, grain('wood')), plaster = make(0xc78e69, stone.map);
  const inner = make(0x4d3732, grain('wood'));
  const foundation = make(0x8c8a78, stone.map);
  const warm = new THREE.MeshStandardMaterial({ color: 0xffbd67, emissive: 0xf18832, emissiveIntensity: 0.7 });
  const parts = [], debris = [];
  const euler = new THREE.Euler(), q = new THREE.Quaternion(), aabb = new THREE.Box3();
  const damagePoint = root.position.clone().add(v(0, 7.3, 0));

  function piece(position, outline, depth, mat, roll = 0, yaw = 0, breakable = true) {
    const solid = prism(outline, depth / 2);
    const mesh = meshOf(solid, [mat, inner]);
    mesh.position.copy(position);
    mesh.rotation.set(0, yaw, roll, 'YXZ');
    mesh.updateMatrix();
    root.add(mesh);
    const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix).translate(root.position);
    if (breakable) parts.push({ solid, mesh, bounds });
    return mesh;
  }
  const box = (x, y, z, w, h, d, mat, roll = 0, yaw = 0, breakable = true) =>
    piece(v(x, y, z), rectangular(w, h), d, mat, roll, yaw, breakable);
  box(0, -0.14, 0, 17, 3.8, 13.5, foundation, 0, 0, false);
  box(0, 1.78, 0, 16.5, 0.28, 12.8, stone, 0, 0, false);
  const baseTop = root.position.y + 1.92;
  const baseBounds = new THREE.Box3(v(x-8.5, root.position.y-2.04, z-6.75), v(x+8.5, baseTop, z+6.75));

  for (const sign of [-1, 1]) {
    for (const side of [-1, 1]) {
      box(sign * 6.7, 2.6, side * 4.9, 0.52, 1.4, 0.52, stone, 0, 0, false);
      box(sign * 6.7, 5.15, side * 4.9, 0.55, 4.1, 0.55, timber);
    }
    box(sign * 6.65, 4.7, 0, 9.4, 5.8, 0.54, plaster, 0, Math.PI / 2);
    box(sign * 3.95, 4.8, 4.9, 5.23, 5.7, 0.48, plaster);
    box(sign * 4.4, 4.98, 5.17, 1.34, 2.06, 0.10, timber);
    box(sign * 4.4, 4.98, 5.24, 1.07, 1.77, 0.07, warm);
    box(sign * 4.4, 4.98, 5.31, 0.12, 1.83, 0.08, timber);
    box(sign * 4.4, 4.98, 5.31, 1.14, 0.12, 0.08, timber);
    box(0, 7.18, sign * 4.92, 13.8, 0.43, 0.51, timber);
    piece(v(0, 7.47, sign * 4.9), [[-6.45,0],[6.45,0],[0,3.27]], 0.35, timber);
    const angle = -sign * Math.atan2(3.48, 7.7);
    box(sign * 3.83, 8.95, 0, 8.53, 0.62, 12.3, tile, angle);
    for (const offset of [-5.97, 5.97]) box(sign * 3.83, 9.09, offset, 8.63, 0.26, 0.46, timber, angle);
  }
  box(0, 4.71, -4.9, 13, 5.7, 0.50, plaster);
  box(0, 6.17, 4.9, 2.77, 2.95, 0.55, timber);
  box(0, 10.72, 0, 0.58, 0.38, 12.64, tile);

  const scorchMaterial = new THREE.MeshBasicMaterial({
    color: 0x2c171a, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -1, depthWrite: false,
  });
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(5.8, 22), scorchMaterial);
  scorch.position.set(0.25, 1.935, 0.45);
  scorch.rotation.x = -Math.PI / 2;
  root.add(scorch);

  let age = Infinity, repairs = 0;
  function split(part, heat) {
    const center = part.mesh.worldToLocal(heat.clone());
    const centerBox = part.mesh.geometry.boundingBox;
    center.clamp(centerBox.min.clone().lerp(centerBox.max, 0.31), centerBox.max.clone().lerp(centerBox.min, 0.31));
    const normal = part.mesh.geometry.boundingBox.getSize(v(0,0,0));
    normal.set(normal.x > normal.z ? 1 : 0.43, 0.57, normal.x > normal.z ? 0.43 : 1).normalize();
    return slice(part.solid, normal, center).flatMap((chunk, i) =>
      slice(chunk, v(-0.41, 0.76, i ? -0.58 : 0.61).normalize(), center.clone().add(v(i ? 0.58 : -0.52, 0.22, 0))));
  }

  function destroy(hit, direction) {
    if (age < WAIT + REBUILD) return false;
    age = 0;
    for (const part of parts) {
      const { mesh } = part;
      mesh.visible = false;
      const fragments = split(part, hit);
      for (const solid of fragments) {
        const shard = meshOf(solid, mesh.material, true);
        shard.position.applyMatrix4(mesh.matrix);
        shard.quaternion.copy(mesh.quaternion);
        root.add(shard);
        const home = shard.position.clone(), orientation = shard.quaternion.clone();
        const outward = home.clone().sub(v(0, 7, 0)).normalize();
        const velocity = direction.clone().multiplyScalar(3.1 + Math.random()*2.2).addScaledVector(outward, 0.9 + Math.random()*3);
        velocity.y += 3.7 + Math.random()*6;
        debris.push({ shard, home, orientation, velocity, spin: v(Math.random()*3-1.5, Math.random()*2-1, Math.random()*3-1.5), settled: false });
      }
    }
    return true;
  }

  function update(dt) {
    if (!debris.length) return;
    age += dt;
    const restore = Math.max(0, (age - WAIT) / REBUILD);
    scorchMaterial.opacity = 0.69 * (1 - Math.min(1, restore));
    for (const d of debris) {
      const { shard, velocity, spin } = d;
      const p = shard.position;
      if (restore > 0) {
        d.rest ??= p.clone();
        d.restRotation ??= shard.quaternion.clone();
        const t = ease(Math.min(restore, 1));
        p.copy(d.rest).lerp(d.home, t);
        p.y += Math.sin(Math.PI * t) * (1.3 + d.home.y * 0.2);
        shard.quaternion.copy(d.restRotation).slerp(d.orientation, t);
      } else if (!d.settled) {
        velocity.y -= 13.5 * dt;
        p.addScaledVector(velocity, dt);
        const floor = Math.max(terrain.heightAt(p.x+x, p.z+z)-root.position.y,
          Math.abs(p.x) <= 8.5 && Math.abs(p.z) <= 6.75 ? 1.92 : -Infinity);
        q.setFromEuler(euler.set(spin.x*dt, spin.y*dt, spin.z*dt));
        shard.quaternion.multiply(q).normalize();
        shard.updateMatrix();
        const bottom = aabb.copy(shard.geometry.boundingBox).applyMatrix4(shard.matrix).min.y;
        if (bottom < floor) {
          p.y += floor - bottom;
          velocity.y = Math.abs(velocity.y) * 0.28;
          velocity.x *= 0.67; velocity.z *= 0.67; spin.multiplyScalar(0.62);
          if (velocity.y < 0.8 && Math.hypot(velocity.x, velocity.z) < 0.7) d.settled = true;
        }
      }
    }
    if (restore >= 1) {
      for (const { shard } of debris) { root.remove(shard); shard.geometry.dispose(); }
      debris.length = 0;
      for (const { mesh } of parts) mesh.visible = true;
      repairs++;
    }
  }

  const collision = {
    heightAt(px, pz) {
      let height = -Infinity;
      for (const b of boxes()) {
        if (px >= b.min.x && px <= b.max.x && pz >= b.min.z && pz <= b.max.z) height = Math.max(height, b.max.y);
      }
      return height;
    },
    groundHeightAt(px, pz) {
      return px >= baseBounds.min.x && px <= baseBounds.max.x && pz >= baseBounds.min.z && pz <= baseBounds.max.z ? baseTop : -Infinity;
    },
    collide(pos, radius, normal) {
      for (const b of boxes()) {
        const nearest = b.clampPoint(pos, v(0,0,0));
        if (nearest.distanceToSquared(pos) >= radius * radius) continue;
        const delta = nearest.sub(pos).negate();
        normal?.copy(delta.lengthSq() > 1e-8 ? delta.normalize() : v(0,1,0));
        return true;
      }
      return false;
    },
  };
  function* boxes() {
    yield baseBounds;
    for (const { bounds, mesh } of parts) if (mesh.visible) yield bounds;
  }

  return { root, damagePoint, collision, destroy, update,
    get intact() { return debris.length === 0; },
    get state() { return age < WAIT ? 'ruins' : debris.length ? 'rebuilding' : 'intact'; },
    get fragmentCount() { return debris.length; },
    get repairs() { return repairs; },
  };
}
