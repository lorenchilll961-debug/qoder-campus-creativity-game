import * as THREE from 'three';

const { Vector3, MathUtils } = THREE;
const point = (x, y, z) => new Vector3(x, y, z);
const material = (color, extra = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.67, ...extra,
});

function loft(profile, rings = 28, sides = 32) {
  const center = new THREE.CatmullRomCurve3(profile.map(([z, y]) => point(0, y, z)));
  const radius = new THREE.CatmullRomCurve3(profile.map(([, , w, h]) => point(w, h, 0)));
  const positions = [], colors = [], indices = [];
  const dark = new THREE.Color(0x55483f), warm = new THREE.Color(0x9b6647), color = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, c = center.getPoint(t), r = radius.getPoint(t);
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2, s = Math.sin(angle);
      const ridges = 1 + 0.027 * Math.sin(11 * angle + i * 0.8);
      positions.push(Math.cos(angle) * Math.max(0.008, r.x) * ridges, c.y + s * Math.max(0.008, r.y) * ridges, c.z);
      color.copy(dark).lerp(warm, MathUtils.smoothstep(-s, 0.04, 0.95) * 0.79);
      color.multiplyScalar(0.82 + 0.23 * Math.sin(i * 1.53 + j * 1.92) ** 2);
      colors.push(color.r, color.g, color.b);
      if (i && j) {
        const a = i * (sides + 1) + j, b = a - sides - 1;
        indices.push(b - 1, b, a, b - 1, a, a - 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rib(a, b, r, tip, mat, bend = point(0, 0, 0)) {
  const curve = new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.48).add(bend), b);
  const geometry = new THREE.TubeGeometry(curve, 10, 1, 9, false);
  const p = geometry.attributes.position;
  const v = point(0, 0, 0);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, center = curve.getPointAt(t), radius = MathUtils.lerp(r, tip, t ** 0.68);
    for (let j = 0; j <= 9; j++) {
      const k = i * 10 + j;
      v.fromBufferAttribute(p, k).sub(center).multiplyScalar(radius).add(center);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, mat);
}

function joint(parent, name, position) {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.copy(position);
  parent.add(bone);
  return bone;
}

function skin(parent, geometry, mat, bones, weights, root) {
  const joints = [], influence = [], p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const [a, b, mix] = weights(p.getX(i), p.getY(i), p.getZ(i));
    joints.push(a, b, 0, 0);
    influence.push(1 - mix, mix, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(influence, 4));
  const mesh = new THREE.SkinnedMesh(geometry, mat);
  parent.add(mesh);
  if (root) mesh.add(root);
  mesh.updateWorldMatrix(true, true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  return mesh;
}

function taperedChain(parent, name, profile, mat) {
  const nodes = profile.filter((_, i) => i % 2 === 0);
  const root = new THREE.Bone();
  root.name = name + '0';
  root.position.set(0, nodes[0][1], nodes[0][0]);
  const bones = [root];
  for (let i = 1; i < nodes.length; i++) {
    bones.push(joint(bones[i - 1], name + i, point(0, nodes[i][1] - nodes[i - 1][1], nodes[i][0] - nodes[i - 1][0])));
  }
  const direction = Math.sign(nodes[1][0] - nodes[0][0]);
  skin(parent, loft(profile), mat, bones, (_, __, z) => {
    const at = nodes.findIndex(([end], i) => i && (end - z) * direction >= 0);
    if (at < 0) return [bones.length - 1, bones.length - 1, 0];
    const start = nodes[at - 1][0];
    return [at - 1, at, MathUtils.clamp((z - start) / (nodes[at][0] - start), 0, 1)];
  }, root);
  return bones;
}

function wing(parent, side, scale, membrane, tendon) {
  const shoulderX = 0.84, elbowX = 2.66, wristX = 4.38;
  const shoulder = new THREE.Bone();
  shoulder.name = side > 0 ? 'wing.right.shoulder' : 'wing.left.shoulder';
  shoulder.position.set(side * shoulderX, 0.49, 0.68);
  const elbow = joint(shoulder, shoulder.name.replace('shoulder', 'elbow'), point(side * (elbowX - shoulderX), 0.26, -0.18));
  const wrist = joint(elbow, shoulder.name.replace('shoulder', 'wrist'), point(side * (wristX - elbowX), 0.01, 0.95));
  const hinge = point(wristX, 0.76, 1.45);
  const tips = [point(8.34, 0.16, 0.14), point(7.02, -0.23, -2.27), point(5.08, -0.41, -3.65),
    point(2.83, -0.51, -3.74), point(0.86, -0.46, -2.24)];
  const fingers = tips.map((tip, i) => joint(wrist, shoulder.name.replace('shoulder', 'digit.' + (i + 1)), point(0, 0, 0)));
  const bones = [shoulder, elbow, wrist, ...fingers];
  const positions = [], colors = [], indices = [], weights = [];
  const dark = new THREE.Color(0x522828), red = new THREE.Color(0xad523a), tint = new THREE.Color();
  const rows = 20, cols = 14;
  for (let panel = 0; panel < tips.length - 1; panel++) {
    const start = positions.length / 3;
    for (let i = 0; i <= rows; i++) {
      const t = Math.max(0.002, i / rows);
      for (let j = 0; j <= cols; j++) {
        const u = j / cols, scallop = Math.sin(Math.PI * u);
        const p = tips[panel].clone().lerp(tips[panel + 1], u).lerp(hinge, 1 - t);
        p.lerp(hinge, scallop * 0.115 * t ** 5);
        p.y -= scallop * Math.sin(Math.PI * t) * 0.31;
        positions.push(side * p.x, p.y, p.z);
        tint.copy(dark).lerp(red, scallop * (0.66 + 0.21 * Math.sin(t * 17 + u * 3)) * t);
        colors.push(tint.r, tint.g, tint.b);
        weights.push([panel + 3, panel + 4, u]);
        if (i && j) {
          const a = start + i * (cols + 1) + j, b = a - cols - 1;
          indices.push(b - 1, b, a, b - 1, a, a - 1);
        }
      }
    }
  }
  // Extend the inner membrane to the shoulder and upper arm so the sail remains attached when banking.
  const start = positions.length / 3;
  const inner = [
    [point(shoulderX, 0.49, 0.68), 0], [point(elbowX, 0.75, 0.50), 1],
    [hinge, 2], [tips.at(-1), 7], [point(0.79, 0.19, -1.52), 0],
  ];
  for (const [p, bone] of inner) {
    positions.push(side * p.x, p.y, p.z);
    colors.push(dark.r, dark.g, dark.b);
    weights.push([bone, bone, 0]);
  }
  indices.push(start, start+1, start+4, start+1, start+2, start+4, start+2, start+3, start+4);
  const membraneGeometry = new THREE.BufferGeometry();
  membraneGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  membraneGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  membraneGeometry.setIndex(indices);
  membraneGeometry.computeVertexNormals();
  let index = 0;
  skin(parent, membraneGeometry, membrane, bones, () => weights[index++], shoulder);
  shoulder.add(rib(point(0, 0, 0), elbow.position, 0.48, 0.29, scale, point(0, 0.32, -0.21)));
  elbow.add(rib(point(0, 0, 0), wrist.position, 0.31, 0.18, scale, point(0, 0.25, 0.12)));
  tips.forEach((tip, i) => {
    const end = tip.clone().sub(hinge);
    end.x *= side;
    fingers[i].add(rib(point(0, 0, 0), end, i ? 0.115 : 0.17, 0.021, tendon));
  });
  wrist.add(rib(point(0, 0, 0), point(side * 0.29, 0.28, 0.69), 0.14, 0.008, tendon));
  return { side, shoulder, elbow, wrist, fingers };
}

function ellipsoid(parent, mat, x, y, z, a, b, c) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(a, b, c);
  parent.add(mesh);
  return mesh;
}

export function createDragonRig() {
  const group = new THREE.Group();
  group.name = '赤脊巨龙';
  const model = new THREE.Group();
  group.add(model);
  const skinMat = material(0xffffff, { vertexColors: true, side: THREE.DoubleSide, emissive: 0x40271d, emissiveIntensity: 0.25 });
  const scale = material(0x61554e, { metalness: 0.13, emissive: 0x412720, emissiveIntensity: 0.2 });
  const armor = material(0x96806d, { metalness: 0.19, emissive: 0x3f281c, emissiveIntensity: 0.23 });
  const claw = material(0xb68c64);
  const eye = material(0xffb652, { emissive: 0xff7315, emissiveIntensity: 1.7 });
  const black = material(0x180f13);
  const membrane = material(0xffffff, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.88, emissive: 0x702718, emissiveIntensity: 0.26 });
  const cover = (parent, profile) => parent.add(new THREE.Mesh(loft(profile), skinMat));
  cover(model, [[-3,-0.02,0.22,0.26],[-2.4,0,0.61,0.72],[-1.42,0,1.15,1.06],[-0.35,0,1.27,1.17],
    [0.7,0.09,1.18,1.06],[1.63,0.23,0.79,0.74],[2.13,0.32,0.49,0.51]]);
  const tail = taperedChain(model, 'tail.', [[-2.25,0,0.65,0.69],[-3.12,-0.03,0.46,0.47],[-4.05,-0.14,0.33,0.32],[-4.96,-0.36,0.26,0.24],
    [-5.94,-0.47,0.20,0.17],[-6.91,-0.43,0.144,0.13],[-7.8,-0.27,0.105,0.09],[-8.47,-0.11,0.067,0.07],[-9.17,0.09,0.01,0.014]], skinMat);
  const neck = taperedChain(model, 'neck.', [[1.26,0.05,0.89,0.88],[1.84,0.49,0.68,0.7],[2.52,0.91,0.49,0.54],
    [3.05,1.04,0.43,0.45],[3.68,1,0.43,0.38]], skinMat);
  const skull = joint(neck.at(-1), 'skull', point(0, 0, 0));
  cover(skull, [[-0.22,0.02,0.33,0.33],[0.18,0.08,0.57,0.47],[0.61,0.01,0.51,0.38],[1.07,-0.07,0.38,0.26],
    [1.64,-0.12,0.32,0.182],[1.85,-0.13,0.22,0.135],[1.94,-0.13,0.012,0.013]]);
  const jaw = joint(skull, 'jaw', point(0, -0.19, 0.26));
  cover(jaw, [[-0.14,0,0.36,0.19],[0.26,-0.06,0.43,0.15],[0.86,-0.18,0.34,0.10],[1.48,-0.16,0.22,0.076],[1.63,-0.10,0.02,0.024]]);
  const mouth = joint(skull, 'breath.origin', point(0,-0.43,1.92));
  const aim = joint(mouth, 'breath.axis', point(0,0,1));

  for (const side of [-1, 1]) {
    ellipsoid(skull, black, side * 0.474, 0.18, 0.60, 0.095, 0.135, 0.19);
    ellipsoid(skull, eye, side * 0.531, 0.18, 0.635, 0.056, 0.081, 0.115);
    ellipsoid(skull, black, side * 0.577, 0.18, 0.659, 0.012, 0.072, 0.023);
    ellipsoid(skull, black, side * 0.306, -0.054, 1.65, 0.039, 0.065, 0.106);
    skull.add(rib(point(side * 0.48,0.25,0.87), point(side * 0.38,0.38,0.16), 0.07, 0.15, armor, point(0, 0.1, 0)));
    skull.add(rib(point(side * 0.37,0.32,0.16), point(side * 0.87,0.85,-1.33), 0.21, 0.008, claw, point(side * 0.24, 0.2, -0.2)));
    skull.add(rib(point(side * 0.45,-0.07,0.31), point(side * 0.77,-0.02,-0.52), 0.137, 0.009, armor));
    for (let i = 0; i < 5; i++) {
      const x = side * (0.39 - i * 0.033), z = 0.74 + i * 0.205;
      skull.add(rib(point(x,-0.25,z), point(x,-0.43+i*0.018,z+0.06), 0.052-i*0.006, 0.003, claw));
    }
  }

  const plate = new THREE.SphereGeometry(1, 8, 6);
  const rows = 15, columns = 13;
  const scales = new THREE.InstancedMesh(plate, armor, rows * columns);
  const o = new THREE.Object3D(), shade = new THREE.Color();
  for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
    const z = -2.35 + (i + (j % 2) * 0.43) * 0.257;
    const a = 0.16 + j * (Math.PI - 0.32) / (columns - 1);
    const w = 1.20 * Math.sqrt(Math.max(0.13, 1 - ((z + 0.39) / 2.46) ** 2));
    o.position.set(Math.cos(a) * w, Math.sin(a) * (w * 0.91) + 0.055, z);
    o.rotation.z = a - Math.PI / 2;
    o.scale.set(0.103 + w * 0.043, 0.075, 0.181);
    o.updateMatrix();
    const index = i * columns + j;
    scales.setMatrixAt(index, o.matrix);
    scales.setColorAt(index, shade.setRGB(0.54 + 0.32 * Math.sin(i + j * 7) ** 2, 0.53, 0.52));
  }
  model.add(scales);
  for (let i = 0; i < 10; i++) {
    const z = 1.56 - i * 0.41, y = 1.18 - (z + 0.2) ** 2 * 0.11;
    model.add(rib(point(0,y,z), point(0,y+0.47+0.11*Math.cos(i),z-0.44), 0.18, 0.011, armor, point(0, 0.19, 0)));
  }
  tail.slice(1).forEach((bone, i) => bone.add(rib(point(0,0.35-i*0.077,0.35), point(0,0.72-i*0.13,-0.48), 0.121-i*0.022, 0.008, armor)));

  const legs = [];
  for (const side of [-1, 1]) for (const fore of [true, false]) {
    const hip = joint(model, (fore ? 'foreleg' : 'hindleg') + side, point(side * 0.84, -0.39, fore ? 1.01 : -1.65));
    const knee = joint(hip, hip.name + '.knee', point(side * 0.49, -0.70, fore ? -0.53 : 0.34));
    hip.add(rib(point(0,0,0), knee.position, fore ? 0.38 : 0.57, 0.21, scale, point(side * 0.25, 0, 0.08)));
    const end = point(side*0.02,-0.23,-0.70);
    knee.add(rib(point(0,0,0), end, 0.23, 0.14, scale));
    for (let i = -1; i <= 1; i++) {
      const toe = end.clone().add(point(i*0.12,0,-0.04));
      knee.add(rib(toe, toe.clone().add(point(i*0.11,-0.23,-0.40)), 0.082, 0.008, claw, point(i*0.06, 0.025, -0.19)));
    }
    legs.push({ hip, knee, side, fore });
  }
  const wings = [-1, 1].map(side => wing(model, side, scale, membrane, armor));
  model.scale.setScalar(1.8);

  function animate(t, effort, dive, bank, fire) {
    const phase = t * Math.PI * 2 * 0.92;
    wings.forEach(({ side, shoulder, elbow, wrist, fingers }) => {
      shoulder.rotation.z = side * (0.18 + effort * 0.57 * Math.sin(phase) - dive * 0.32 + side * bank * 0.09);
      shoulder.rotation.y = side * (dive * 0.41 + effort * 0.088 * Math.cos(phase));
      elbow.rotation.z = side * (-0.13 + effort * 0.31 * Math.sin(phase - 0.9) - dive * 0.27);
      wrist.rotation.z = side * (-0.09 + effort * 0.22 * Math.sin(phase - 1.58));
      fingers.forEach((digit, i) => {
        digit.rotation.x = effort * 0.068 * Math.sin(phase - i * 0.29);
        digit.rotation.y = side * dive * i * 0.019;
      });
    });
    tail.forEach((bone, i) => {
      bone.rotation.y = Math.sin(t * 2.6 - i * 0.69) * (0.04 + i * 0.021) - bank * 0.16;
      bone.rotation.x = Math.cos(phase - i * 0.49) * effort * 0.063 - dive * 0.034;
    });
    neck.forEach((bone, i) => {
      bone.rotation.x = fire * (0.13 + i * 0.017) + Math.cos(phase - i * 0.3) * 0.029 * effort;
      bone.rotation.y = bank * (0.07 + i * 0.037);
    });
    skull.rotation.x = fire * 0.13 + dive * 0.08;
    jaw.rotation.x = 0.03 + fire * 0.58;
    legs.forEach(({ hip, knee, side, fore }) => {
      hip.rotation.x = 0.11 + dive * 0.39 + 0.064 * Math.cos(phase + (fore ? 0 : 0.36));
      hip.rotation.z = side * dive * 0.19;
      knee.rotation.x = -0.08 - dive * 0.3;
    });
  }
  return { group, mouth, aim, animate };
}
