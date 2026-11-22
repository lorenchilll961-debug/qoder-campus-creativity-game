import * as THREE from 'three';

// Convex architectural parts are represented by outward-facing polygon loops.
// Each cut adds opposite faces to the two fragments and keeps the exterior material.
const EPS = 1e-6;
const v = (x, y, z) => new THREE.Vector3(x, y, z);

export function prism(outline, halfDepth) {
  const front = outline.map(([x, y]) => v(x, y, halfDepth));
  const back = outline.map(([x, y]) => v(x, y, -halfDepth));
  return [
    { points: front, interior: false },
    { points: [...back].reverse(), interior: false },
    ...front.map((p, i) => {
      const j = (i + 1) % front.length;
      return { points: [front[j], p, back[i], back[j]], interior: false };
    }),
  ];
}

function clip(solid, normal, offset, sign) {
  const faces = [], edge = [];
  const unique = (points, p) => {
    if (!points.some(q => p.distanceToSquared(q) < EPS * EPS)) points.push(p);
  };
  for (const face of solid) {
    const points = [];
    face.points.forEach((a, i) => {
      const b = face.points[(i + 1) % face.points.length];
      const da = sign * (normal.dot(a) - offset), db = sign * (normal.dot(b) - offset);
      if (da <= EPS) unique(points, a);
      if (Math.abs(da) <= EPS) unique(edge, a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const p = a.clone().lerp(b, da / (da - db));
        unique(points, p);
        unique(edge, p);
      }
    });
    if (points.length >= 3) faces.push({ points, interior: face.interior });
  }
  if (edge.length < 3) return faces;
  const center = centroid(edge);
  const outward = normal.clone().multiplyScalar(sign);
  const u = edge[0].clone().sub(center).normalize();
  const w = outward.clone().cross(u);
  const angle = p => {
    const d = p.clone().sub(center);
    return Math.atan2(d.dot(w), d.dot(u));
  };
  edge.sort((a, b) => angle(a) - angle(b));
  faces.push({ points: edge, interior: true });
  return faces;
}

function centroid(points) {
  return points.reduce((center, p) => center.add(p), v(0, 0, 0)).multiplyScalar(1 / points.length);
}

export function slice(solid, normal, point) {
  const offset = normal.dot(point);
  const distances = solid.flatMap(face => face.points.map(p => normal.dot(p) - offset));
  if (Math.min(...distances) >= -EPS || Math.max(...distances) <= EPS) return [solid];
  return [clip(solid, normal, offset, 1), clip(solid, normal, offset, -1)];
}

export function meshOf(solid, materials, centered = false) {
  const origin = centered ? centroid(solid.flatMap(face => face.points)) : v(0, 0, 0);
  const positions = [], uv = [];
  const geometry = new THREE.BufferGeometry();
  for (const face of solid) {
    const start = positions.length / 3;
    const [first, second, third] = face.points;
    const u = second.clone().sub(first).normalize();
    const w = second.clone().sub(first).cross(third.clone().sub(first)).normalize().cross(u);
    for (let i = 1; i < face.points.length - 1; i++) {
      for (const p of [first, face.points[i], face.points[i + 1]]) {
        const local = p.clone().sub(origin);
        positions.push(local.x, local.y, local.z);
        uv.push(p.dot(u) * 0.32, p.dot(w) * 0.32);
      }
    }
    geometry.addGroup(start, positions.length / 3 - start, Number(face.interior));
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  // Pack the two materials into at most two draws per fragment.
  const groups = geometry.groups;
  const index = [];
  geometry.clearGroups();
  for (let material = 0; material < 2; material++) {
    const start = index.length;
    for (const group of groups) {
      if (group.materialIndex === material) {
        for (let i = group.start; i < group.start + group.count; i++) index.push(i);
      }
    }
    if (index.length > start) geometry.addGroup(start, index.length - start, material);
  }
  geometry.setIndex(index);
  geometry.computeBoundingBox();
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.position.copy(origin);
  return mesh;
}
