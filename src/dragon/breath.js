import * as THREE from 'three';

const v = () => new THREE.Vector3();
const vertex = /* glsl */`
  attribute vec4 aLife;
  varying vec4 vLife;
  uniform float uScale;
  void main() {
    vLife = aLife;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_PointSize = clamp(aLife.z * uScale * projectionMatrix[1][1] / max(1.0, -p.z), 1.0, 118.0);
  }
`;
const fragment = /* glsl */`
  varying vec4 vLife;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float a = vLife.x;
    float wobble = 0.09 * sin(p.x * 13.0 + p.y * 9.0 + vLife.w);
    wobble += 0.065 * cos(p.y * 17.0 - p.x * 8.0 - vLife.w);
    float body = 1.0 - smoothstep(0.18 + wobble, 0.93 + wobble, r);
    float fade = (1.0 - a) * smoothstep(-0.03, 0.10, a);
    vec3 color;
    float alpha;
    if (vLife.y < 0.5) {
      color = mix(vec3(0.095,0.074,0.067), vec3(0.29,0.26,0.24), a);
      alpha = body * fade * 0.49;
    } else if (vLife.y < 1.5) {
      color = mix(vec3(3.5,1.22,0.26), vec3(1.8,0.19,0.017), smoothstep(0.05,0.78,a));
      color += vec3(4.1,2.1,0.55) * (1.0-smoothstep(0.0,0.72,r)) * (1.0-a);
      alpha = body * fade * 0.82;
    } else {
      color = mix(vec3(3.4,1.56,0.48), vec3(1.0,0.11,0.018), a);
      alpha = (1.0 - smoothstep(0.22, 0.92, r)) * fade;
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createBreath(world, viewport) {
  const count = 680;
  const particles = Array.from({ length: count }, () => ({ position: v(), velocity: v(), age: 0, life: 0 }));
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const state = new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  geometry.setAttribute('aLife', state);
  geometry.setDrawRange(0, 0);
  const cloud = new THREE.Points(geometry, new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, uniforms: { uScale: { value: 440 } },
    transparent: true, depthWrite: false,
  }));
  cloud.frustumCulled = false;
  cloud.renderOrder = 700;
  world.add(cloud);

  const muzzleLight = new THREE.PointLight(0xff6532, 0, 36);
  const hitLight = new THREE.PointLight(0xff752d, 0, 31);
  const impact = v();
  world.add(muzzleLight, hitLight);
  let next = 0, emission = 0, smolder = 0, hit = 0;
  const old = v(), delta = v(), nearest = v();
  function emit(origin, velocity, kind, size, life, target = null) {
    const p = particles[next++ % count];
    p.position.copy(origin); p.velocity.copy(velocity);
    p.kind = kind; p.size = size; p.life = life; p.age = 0;
    p.phase = Math.random() * 6.28;
    p.target = target;
  }
  function burst(point) {
    impact.copy(point);
    hitLight.position.copy(impact).y -= 1.6;
    hit = 1;
    smolder = 6.8;
    for (let i = 0; i < 82; i++) {
      const offset = v().set((Math.random()-0.5)*12, Math.random()*4, (Math.random()-0.5)*8);
      const velocity = offset.clone().multiplyScalar(1.4).setY(2 + Math.random()*12);
      const kind = i % 4 ? 2 : 0;
      emit(impact.clone().add(offset), velocity, kind, kind ? 0.31 : 3.3, kind ? 0.7+Math.random() : 2.4+Math.random()*1.6);
    }
  }
  function update(dt, mouth, axis, target, wind) {
    cloud.material.uniforms.uScale.value = viewport.y * 0.54;
    muzzleLight.position.copy(mouth).addScaledVector(axis, 2);
    muzzleLight.intensity = target ? 160 + Math.random()*80 : 0;
    hit = Math.max(0, hit - dt * 0.66);
    hitLight.intensity = hit * (470 + Math.random()*150);
    emission += target ? dt * 188 : 0;
    while (emission >= 1) {
      emission--;
      const velocity = axis.clone().multiplyScalar(43 + Math.random()*16);
      velocity.add(v().set((Math.random()-0.5)*7, (Math.random()-0.5)*6, (Math.random()-0.5)*7));
      const kind = next % 7 ? 1 : 2;
      emit(mouth, velocity, kind, kind === 1 ? 0.9+Math.random()*0.70 : 0.19, 0.57+Math.random()*0.33, target);
      if (next % 6 === 0) emit(mouth, velocity.multiplyScalar(0.57), 0, 1.15, 1.65);
    }
    smolder = Math.max(0, smolder - dt);
    if (smolder && Math.random() < dt * 32) {
      const origin = impact.clone().add(v().set((Math.random()-0.5)*12, -3.7+Math.random()*4, (Math.random()-0.5)*9));
      emit(origin, v().set(wind.x*0.18, 2.2+Math.random()*2.2, wind.z*0.18), 0, 2.4, 2.5+Math.random()*1.7);
    }

    let n = 0;
    for (const p of particles) {
      if (p.age >= p.life) continue;
      p.age += dt;
      old.copy(p.position);
      p.position.addScaledVector(p.velocity, dt);
      const field = p.target;
      if (field?.intact) {
        const point = field.damagePoint;
        delta.subVectors(p.position, old);
        const at = THREE.MathUtils.clamp(nearest.subVectors(point, old).dot(delta) / Math.max(1e-8, delta.lengthSq()), 0, 1);
        nearest.copy(old).addScaledVector(delta, at);
        if (nearest.distanceToSquared(point) < 3.8 ** 2 && field.destroy(nearest, p.velocity.clone().normalize())) burst(point);
      }
      p.velocity.y += dt * (p.kind === 2 ? -7.4 : p.kind ? 2.5 : 1.15);
      if (!field) p.velocity.addScaledVector(wind, p.kind ? dt * 0.15 : dt * 0.12);
      const age = p.age / p.life;
      const size = p.size * (p.kind === 2 ? 1 - age * 0.25 : 0.62 + age * (p.kind === 1 ? 3 : 4.7));
      positions.setXYZ(n, p.position.x, p.position.y, p.position.z);
      state.setXYZW(n++, age, p.kind, size, p.phase + p.age * 3);
    }
    geometry.setDrawRange(0, n);
    positions.needsUpdate = state.needsUpdate = true;
  }
  return { update, muzzleLight, hitLight, get particleCount() { return geometry.drawRange.count; } };
}
