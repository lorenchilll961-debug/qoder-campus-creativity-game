// Visual-only solar-term weather. No timers, scene/model edits, or collision registration.
import * as THREE from 'three';
import { U } from '../core/ctx.js';
import { ATMOSPHERE, TERRAIN_LOOKUP } from '../shaders/common.js';
import { SKY_UNIFORMS } from '../world/sky.js';

const RAIN_COUNT = 2200;
const COVER_SIZE = 96, COVER_EXTENT = 144, COVER_CELL = COVER_EXTENT / COVER_SIZE;
const FIELD_WIDTH = 10, FIELD_DEPTH = 7, BED_RISE = 1.32;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mod = (x, n) => ((x % n) + n) % n;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const attr = (data, n) => new THREE.Float32BufferAttribute(data, n);
const instAttr = (data, n) => new THREE.InstancedBufferAttribute(new Float32Array(data), n);
const pick = (uniforms, ...keys) => Object.fromEntries(keys.map((key) => [key, uniforms[key]]));

// The wet summer peak gets a 42-second shower, not a permanent downpour. Other terms
// keep their prescribed rain. The same function is used by the rain and thunder gates.
function shower(time, heat) {
  return 1 - smooth(0.82, 0.98, heat) * (1 - smooth(0.05, 0.7, Math.sin(time * Math.PI * 2 / 42 - 0.9)));
}

const SHOWER_GLSL = /* glsl */`
  float shower(float time, float heat) {
    float pulse = smoothstep(0.05, 0.7, sin(time * 0.14959965 - 0.9));
    return mix(1.0, pulse, smoothstep(0.82, 0.98, heat));
  }
`;

const RAIN_VERT = /* glsl */`
  attribute vec4 aRain;
  uniform float uTime;
  uniform vec4 uWind, uWeather, uClimate;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vFade, vViewZ;
  ${SHOWER_GLSL}
  void main() {
    float rain = clamp(uWeather.x, 0.0, 1.0) * shower(uTime, uClimate.w);
    float heavy = smoothstep(0.28, 0.85, rain);
    // Sparse drizzle selects the slow seeds; dense rain adds the fast ones. A shower
    // changes density, not time * instantaneousSpeed (which would teleport drops).
    float speed = mix(8.0, 29.0, aRain.w) * mix(0.90, 1.10, aRain.z);
    vec3 velocity = vec3(uWind.x * uWind.z * 2.2, -speed, uWind.y * uWind.z * 2.2);
    // All copies of the wrapping lattice have fixed world origins, not camera origins.
    vec3 extent = vec3(80.0, 56.0, 80.0);
    vec3 offset = mod(aRain.xyz * extent + velocity * uTime - cameraPosition + extent * 0.5, extent) - extent * 0.5;
    vec3 center = cameraPosition + offset;
    vec3 axis = normalize(velocity);
    vec3 across = cross(axis, normalize(cameraPosition - center));
    if (dot(across, across) < 0.001) across = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    across = normalize(across);
    float len = mix(0.32, 1.9, heavy) * mix(0.8, 1.25, aRain.y);
    float width = mix(0.014, 0.029, heavy);
    vec3 P = center + across * position.x * width + axis * position.y * len;
    vec4 mv = viewMatrix * vec4(P, 1.0);
    vec3 edge = abs(offset) / (extent * 0.5);
    vFade = (1.0 - smoothstep(0.68, 1.0, max(edge.x, max(edge.y, edge.z))))
          * smoothstep(1.2, 4.0, -mv.z) * clamp(uClimate.x, 0.0, 1.0);
    vFade *= smoothstep(aRain.w, aRain.w + 0.025, rain) * mix(0.23, 0.55, heavy);
    vUv = uv;
    vWorld = P;
    vViewZ = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const RAIN_FRAG = /* glsl */`
  uniform sampler2D tDepth, tCover;
  uniform vec3 uDepth;
  uniform vec2 uRes;
  uniform vec4 uCoverRect;
  uniform vec3 uAmbSky, uSunColor;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vFade, vViewZ;
  ${TERRAIN_LOOKUP}
  void main() {
    vec2 coverUV = (vWorld.xz - uCoverRect.xy) * uCoverRect.z;
    float roof = texture(tCover, coverUV).r;
    float floorY = max(max(terrainH(vWorld.xz), 0.0), roof);
    // Per-fragment clipping also cuts the lower half of a streak as it hits a roof.
    if (vWorld.y < floorY + 0.07) discard;
    float d = texture(tDepth, gl_FragCoord.xy / uRes).r;
    float scene = uDepth.z > 0.5 ? uDepth.x * uDepth.y / (uDepth.x + d * (uDepth.y - uDepth.x))
                                : uDepth.x * uDepth.y / (uDepth.y - d * (uDepth.y - uDepth.x));
    float soft = clamp((scene - vViewZ) / 0.38, 0.0, 1.0);
    float shape = (1.0 - smoothstep(0.25, 1.0, abs(vUv.x * 2.0 - 1.0)))
                * smoothstep(0.0, 0.13, vUv.y) * (1.0 - smoothstep(0.70, 1.0, vUv.y));
    float alpha = shape * vFade * soft * smoothstep(0.07, 0.25, vWorld.y - floorY);
    if (alpha < 0.002) discard;
    vec3 color = vec3(0.30, 0.39, 0.47) + uAmbSky * 0.72 + uSunColor * 0.09;
    gl_FragColor = vec4(color, alpha);
  }
`;

const BIRD_VERT = /* glsl */`
  attribute vec4 aBird; // flock, side/rank, phase, size
  uniform float uTime, uBirdTravel;
  uniform vec4 uPhenology, uClimate;
  varying vec3 vWorld;
  varying float vAlpha;
  ${TERRAIN_LOOKUP}
  void main() {
    float flock = aBird.x;
    float direction = uPhenology.w >= 0.0 ? -1.0 : 1.0;
    float rank = abs(aBird.y);
    vec2 extent = vec2(420.0);
    vec2 home = vec2(sin(flock * 2.4 + 0.5), cos(flock * 2.4 + 0.5)) * 140.0;
    home.y += uBirdTravel;
    vec2 offset = mod(home - cameraPosition.xz + extent * 0.5, extent) - extent * 0.5;
    vec2 xz = cameraPosition.xz + offset + vec2(aBird.y * 2.6, -direction * rank * 2.1);
    float altitude = max(cameraPosition.y + 24.0 + flock * 8.0, terrainH(xz) + 36.0);
    vec3 p = position;
    float flap = sin(uTime * (5.8 + aBird.w * 0.35) + aBird.z) * 0.62 + 0.08;
    // The body and long neck stay rigid; only the outer wings rotate at the shoulder.
    float wing = max(abs(p.x) - 0.12, 0.0);
    p.x = sign(p.x) * (min(abs(p.x), 0.12) + wing * cos(flap));
    p.y += wing * sin(flap);
    p.z *= -direction;
    p *= aBird.w;
    vWorld = vec3(xz.x, altitude, xz.y) + p;
    float edge = max(abs(offset.x), abs(offset.y)) / 210.0;
    vAlpha = clamp(abs(uPhenology.w) * uClimate.x, 0.0, 1.0)
           * (1.0 - smoothstep(0.70, 1.0, edge)) * smoothstep(20.0, 48.0, length(offset));
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;
const BIRD_FRAG = /* glsl */`
  varying vec3 vWorld;
  varying float vAlpha;
  ${ATMOSPHERE}
  void main() {
    if (vAlpha < 0.003) discard;
    vec3 color = vec3(0.035, 0.041, 0.046) * (vec3(0.35) + uAmbSky);
    gl_FragColor = vec4(applyAtmosphere(color, vWorld), vAlpha);
  }
`;

// A five-draw-call budget at full activity: rain, birds, lightning, soil, crops.
export class SeasonWeather {
  constructor(game) {
    this.game = game;
    this.U = game.U || U;
    this.group = new THREE.Group();
    this.group.name = 'season-weather';
    this.group.visible = false;
    game.world.add(this.group);
    this._camera = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._coverCenter = new THREE.Vector2(Infinity, Infinity);
    this._simTime = Number.isFinite(game.time) ? game.time : this.U.uTime.value;
    this._birdTravel = { value: 0 };
    this._birdSpeed = 0;
    this._strike = -1;
    this._placedStrike = -1;
    this._flash = 0;
    this.fields = this._findFields();
    this._makeRain();
    this._makeBirds();
    this._makeLightning();
    this._makeFields();
    this.update(0);
  }

  _makeRain() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', attr([-1, -0.5, 0, 1, -0.5, 0, -1, 0.5, 0, 1, 0.5, 0], 3));
    g.setAttribute('uv', attr([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const seeds = [];
    for (let i = 0; i < RAIN_COUNT; i++) seeds.push(hash(i * 4), hash(i * 4 + 1), hash(i * 4 + 2), (i + 0.5) / RAIN_COUNT);
    g.setAttribute('aRain', instAttr(seeds, 4));
    g.instanceCount = RAIN_COUNT;
    this._coverData = new Float32Array(COVER_SIZE * COVER_SIZE);
    this.coverTexture = new THREE.DataTexture(this._coverData, COVER_SIZE, COVER_SIZE, THREE.RedFormat, THREE.FloatType);
    this.coverTexture.internalFormat = 'R32F';
    this.coverTexture.minFilter = this.coverTexture.magFilter = THREE.NearestFilter;
    this.coverTexture.generateMipmaps = false;
    this.coverTexture.needsUpdate = true;
    this.rainMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...pick(this.U, 'uTime', 'uWind', 'uClimate', 'uWeather', 'uAmbSky', 'uSunColor', 'uHeightTex', 'uWorld'),
        tDepth: this.game.pipeline.uDepth,
        tCover: { value: this.coverTexture },
        uCoverRect: { value: new THREE.Vector4(0, 0, 1 / COVER_EXTENT, COVER_CELL) },
        uDepth: { value: new THREE.Vector3(0.1, 6000, 0) },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.rain = new THREE.Mesh(g, this.rainMaterial);
    this.rain.name = 'season-rain-streaks';
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 42;
    this.rain.visible = false;
    this.game.pipeline.overlay.add(this.rain);
  }

  _makeBirds() {
    // Geese silhouettes: tapered body, long neck, beak, tail, articulated swept wings.
    const v = [];
    const tri = (a, b, c) => v.push(...a, ...b, ...c);
    tri([-0.12, 0, 0.30], [0.12, 0, 0.30], [0, 0.07, -0.48]);
    tri([-0.065, 0, -0.20], [0.065, 0, -0.20], [0.04, 0.04, -0.85]);
    tri([-0.045, 0, -0.20], [0.04, 0.04, -0.85], [-0.035, 0.04, -0.83]);
    tri([-0.035, 0.04, -0.83], [0.04, 0.04, -0.85], [0, 0.02, -1.02]);
    tri([-0.13, 0, 0.54], [0.13, 0, 0.54], [0, 0, 0.18]);
    for (const side of [-1, 1]) {
      tri([side * 0.08, 0, -0.18], [side * 0.75, 0, -0.02], [side * 0.40, 0, 0.25]);
      tri([side * 0.08, 0, -0.18], [side * 0.40, 0, 0.25], [side * 0.09, 0, 0.26]);
      tri([side * 0.75, 0, -0.02], [side * 1.22, 0, 0.33], [side * 0.40, 0, 0.25]);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', attr(v, 3));
    const birds = [];
    for (let flock = 0; flock < 4; flock++) for (let i = 0; i < 13; i++) {
      const rank = Math.ceil(i / 2) * (i % 2 ? -1 : 1);
      birds.push(flock, rank, hash(flock * 13 + i) * 6.28, 0.9 + hash(i + 30) * 0.25);
    }
    g.setAttribute('aBird', instAttr(birds, 4));
    g.instanceCount = birds.length / 4;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...pick(this.U, ...SKY_UNIFORMS, 'uTime', 'uPhenology', 'uClimate', 'uHeightTex', 'uWorld'), uBirdTravel: this._birdTravel },
      vertexShader: BIRD_VERT, fragmentShader: BIRD_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.birds = new THREE.Mesh(g, m);
    this.birds.name = 'season-migrating-geese';
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
  }

  _makeLightning() {
    const positions = [], ends = [], coords = [];
    const segment = (a, b, width) => {
      for (const [side, end] of [[-1, 0], [1, 0], [-1, 1], [-1, 1], [1, 0], [1, 1]]) {
        positions.push(...a); ends.push(...b); coords.push(side, end, width);
      }
    };
    const points = [];
    for (let i = 0; i < 15; i++) points.push([(hash(i + 401) - 0.5) * 18, 145 - i * 9, (hash(i + 601) - 0.5) * 5]);
    for (let i = 1; i < points.length; i++) segment(points[i - 1], points[i], 0.65);
    for (const j of [4, 8]) {
      let a = points[j];
      for (let i = 0; i < 5; i++) {
        const b = [a[0] + (j === 4 ? -1 : 1) * (6 + hash(i + j) * 8), a[1] - 6 - hash(i + 55) * 9, a[2] + 2];
        segment(a, b, 0.32); a = b;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attr(positions, 3));
    g.setAttribute('aEnd', attr(ends, 3));
    g.setAttribute('aLine', attr(coords, 3));
    this._boltOrigin = { value: new THREE.Vector3() };
    this._boltAngle = { value: 0 };
    this.lightning = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...pick(this.U, 'uWeather', ...SKY_UNIFORMS), uBoltOrigin: this._boltOrigin, uBoltAngle: this._boltAngle },
      vertexShader: /* glsl */`
        attribute vec3 aEnd, aLine;
        uniform vec3 uBoltOrigin;
        uniform float uBoltAngle;
        varying vec3 vWorld;
        varying float vAcross;
        void main() {
          float c = cos(uBoltAngle), s = sin(uBoltAngle);
          mat3 rot = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
          vec3 a = rot * position + uBoltOrigin, b = rot * aEnd + uBoltOrigin;
          vec3 P = mix(a, b, aLine.y);
          vec3 across = normalize(cross(normalize(b - a), normalize(cameraPosition - P)));
          vWorld = P + across * aLine.x * aLine.z;
          vAcross = aLine.x;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vWorld;
        varying float vAcross;
        ${ATMOSPHERE}
        void main() {
          float alpha = uWeather.w * 5.0 * (1.0 - smoothstep(0.15, 1.0, abs(vAcross)));
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(applyAtmosphere(vec3(2.4, 2.65, 3.0), vWorld), min(alpha, 0.85));
        }
      `,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.lightning.name = 'season-distant-lightning';
    this.lightning.visible = false;
    this.lightning.frustumCulled = false;
    this.group.add(this.lightning);
  }

  _findFields() {
    const buildings = this.game.town?.buildings || [];
    const patches = buildings.filter((b) => /veg_patch/.test(b.id)).sort((a, b) => a.pos[0] - b.pos[0]);
    const fields = [];
    const terrain = this.game.terrain;
    const solid = this.game.flight?.solid || this.game.town;
    // Raised beds hide existing grass without altering the meadow mask or old vegetable patches.
    for (const patch of patches) {
      if (fields.some((f) => Math.hypot(f.x - patch.pos[0], f.z - patch.pos[2]) < 95)) continue;
      const yaw = (patch.yaw || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
      let placed = false;
      for (const distance of [14, 22, 32, 44]) {
        for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]]) {
          const x = patch.pos[0] + (dx * c + dz * s) * distance;
          const z = patch.pos[2] + (-dx * s + dz * c) * distance;
          // Conservative clearance also avoids trees/vegetables not present in the solid grid.
          if (buildings.some((b) => Math.hypot(b.pos[0] - x, b.pos[2] - z) < (b.kind === 'prop' ? 10 : 19))) continue;
          let lo = Infinity, hi = -Infinity, safe = true;
          for (let iz = -1; iz <= 1; iz++) for (let ix = -1; ix <= 1; ix++) {
            const px = x + ix * 5.5 * c + iz * 4 * s, pz = z - ix * 5.5 * s + iz * 4 * c;
            const y = terrain.heightAt(px, pz);
            lo = Math.min(lo, y); hi = Math.max(hi, y);
            if (y < 2 || (solid?.heightAt(px, pz) ?? -1e9) > y + 0.25) safe = false;
          }
          if (!safe || hi - lo > 3.2) continue;
          fields.push({ x, z, y: terrain.heightAt(x, z) + BED_RISE, yaw, width: FIELD_WIDTH, depth: FIELD_DEPTH, source: patch.id, sourcePos: patch.pos.slice() });
          placed = true; break;
        }
        if (placed) break;
      }
      if (fields.length >= 3) break;
    }
    return fields;
  }

  _makeFields() {
    const soilPos = [], soilUv = [], soilKind = [];
    const roots = [], details = [];
    const terrain = this.game.terrain;
    for (let f = 0; f < this.fields.length; f++) {
      const field = this.fields[f], c = Math.cos(field.yaw), s = Math.sin(field.yaw);
      const point = (x, z, rise = BED_RISE) => {
        const wx = field.x + x * c + z * s, wz = field.z - x * s + z * c;
        return [wx, terrain.heightAt(wx, wz) + rise, wz];
      };
      const quad = (a, b, d, e, uv, kind) => {
        for (const i of [0, 2, 1, 1, 2, 3]) {
          soilPos.push(...[a, b, d, e][i]); soilUv.push(...uv[i]); soilKind.push(kind);
        }
      };
      // Subdivision follows the real slope instead of putting a floating flat slab over it.
      const nx = 20, nz = 14;
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        const x0 = x / nx * FIELD_WIDTH - FIELD_WIDTH / 2, x1 = x0 + FIELD_WIDTH / nx;
        const z0 = z / nz * FIELD_DEPTH - FIELD_DEPTH / 2, z1 = z0 + FIELD_DEPTH / nz;
        quad(point(x0, z0), point(x1, z0), point(x0, z1), point(x1, z1), [[x0, z0], [x1, z0], [x0, z1], [x1, z1]], 0);
      }
      for (const edge of [0, 1, 2, 3]) {
        const n = edge < 2 ? nx : nz;
        for (let i = 0; i < n; i++) {
          const a = edge < 2 ? [-5 + i / n * 10, edge ? 3.5 : -3.5] : [edge === 2 ? -5 : 5, -3.5 + i / n * 7];
          const b = edge < 2 ? [-5 + (i + 1) / n * 10, a[1]] : [a[0], -3.5 + (i + 1) / n * 7];
          quad(point(...a), point(...b), point(...a, -0.06), point(...b, -0.06), [[i, BED_RISE], [i + 1, BED_RISE], [i, 0], [i + 1, 0]], 1);
        }
      }
      // The central path makes the standing wheat / replanted side legible from a broom.
      for (let row = 0; row < 22; row++) for (let col = 0; col < 24; col++) {
        const seed = f * 528 + row * 24 + col;
        const x = -4.55 + row / 21 * 9.1;
        if (Math.abs(x) < 0.3) continue;
        const z = -3.12 + col / 23 * 6.24 + (hash(seed) - 0.5) * 0.09;
        const p = point(x, z, BED_RISE + 0.018);
        roots.push(...p, hash(seed + 83));
        details.push((x + 5) / 10, hash(seed + 151) * Math.PI * 2, row % 2);
      }
    }
    const soil = new THREE.BufferGeometry();
    soil.setAttribute('position', attr(soilPos, 3));
    soil.setAttribute('aSoilUv', attr(soilUv, 2));
    soil.setAttribute('aKind', attr(soilKind, 1));
    soil.computeVertexNormals();
    const uniforms = pick(this.U, ...SKY_UNIFORMS, 'uTime', 'uWind', 'uClimate', 'uPhenology', 'uSurfaceWeather', 'uSeasonSnow');
    this.soil = new THREE.Mesh(soil, new THREE.ShaderMaterial({
      uniforms, vertexShader: SOIL_VERT, fragmentShader: FIELD_FRAG, side: THREE.DoubleSide,
    }));
    this.soil.name = 'season-terraced-field-beds';
    this.group.add(this.soil);
    const crop = cropGeometry();
    crop.setAttribute('aRoot', instAttr(roots, 4));
    crop.setAttribute('aCrop', instAttr(details, 3));
    crop.instanceCount = roots.length / 4;
    this.crops = new THREE.Mesh(crop, new THREE.ShaderMaterial({
      uniforms, vertexShader: CROP_VERT, fragmentShader: FIELD_FRAG, side: THREE.DoubleSide,
    }));
    this.crops.name = 'season-wheat-and-seedlings';
    // Shader roots, not the small prototype geometry, determine the bounds.
    this.crops.frustumCulled = false;
    this.group.add(this.crops);
  }

  _refreshCover(x, z) {
    if (Math.abs(x - this._coverCenter.x) < 24 && Math.abs(z - this._coverCenter.y) < 24) return;
    const cx = Math.round(x / 24) * 24, cz = Math.round(z / 24) * 24;
    this._coverCenter.set(cx, cz);
    const x0 = cx - COVER_EXTENT / 2, z0 = cz - COVER_EXTENT / 2;
    const terrain = this.game.terrain, solid = this.game.flight?.solid || this.game.town;
    const data = this._coverData, cell = COVER_CELL, n = COVER_SIZE;
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const px = x0 + (ix + 0.5) * cell, pz = z0 + (iz + 0.5) * cell;
      let h = Math.max(0, terrain.heightAt(px, pz));
      // Fixed map samples, never a raycast or CPU update per raindrop.
      if (solid) for (let k = 0; k < 5; k++) {
        const dx = k === 4 ? 0 : (k & 1 ? 0.65 : -0.65);
        const dz = k === 4 ? 0 : (k & 2 ? 0.65 : -0.65);
        h = Math.max(h, solid.heightAt(px + dx, pz + dz));
      }
      data[iz * n + ix] = h;
    }
    // Conservative max rasterization preserves even thin roof tiles between the samples.
    for (const grid of this.game.town?.solids || []) {
      const sx0 = Math.max(0, Math.floor((x0 - grid.x0) / grid.cell));
      const sz0 = Math.max(0, Math.floor((z0 - grid.z0) / grid.cell));
      const sx1 = Math.min(grid.nx, Math.ceil((x0 + COVER_EXTENT - grid.x0) / grid.cell));
      const sz1 = Math.min(grid.nz, Math.ceil((z0 + COVER_EXTENT - grid.z0) / grid.cell));
      for (let sz = sz0; sz < sz1; sz++) for (let sx = sx0; sx < sx1; sx++) {
        const value = grid.grid[sz * grid.nx + sx];
        if (!value) continue;
        const h = grid.y0 + value * grid.step;
        const ax = clamp(Math.floor((grid.x0 + sx * grid.cell - x0) / cell), 0, n - 1);
        const az = clamp(Math.floor((grid.z0 + sz * grid.cell - z0) / cell), 0, n - 1);
        const bx = clamp(Math.floor((grid.x0 + (sx + 1) * grid.cell - x0) / cell), 0, n - 1);
        const bz = clamp(Math.floor((grid.z0 + (sz + 1) * grid.cell - z0) / cell), 0, n - 1);
        for (let j = az; j <= bz; j++) for (let i = ax; i <= bx; i++) data[j * n + i] = Math.max(data[j * n + i], h);
      }
    }
    this.rainMaterial.uniforms.uCoverRect.value.set(x0, z0, 1 / COVER_EXTENT, cell);
    this.coverTexture.needsUpdate = true;
  }

  update(dt) {
    const u = this.U, strength = clamp(u.uClimate.value.x);
    const active = strength > 0;
    this.group.visible = active;
    const rain = clamp(u.uWeather.value.x) * shower(u.uTime.value, u.uClimate.value.w);
    this.rain.visible = active && rain > 0.002;
    this.birds.visible = active && Math.abs(u.uPhenology.value.w) > 0.001;
    if (!active) {
      this._flash = 0;
      this._birdSpeed = 0;
      this.lightning.visible = false;
      u.uWeather.value.w = 0;
      return;
    }
    if (dt > 0) {
      this._simTime = Number.isFinite(this.game.time) ? this.game.time : u.uTime.value;
      const amount = clamp(u.uPhenology.value.w, -1, 1);
      const target = -amount * (6 + 8 * Math.abs(amount));
      this._birdSpeed += (target - this._birdSpeed) * (1 - Math.exp(-dt * 2));
      this._birdTravel.value = mod(this._birdTravel.value + this._birdSpeed * dt, 420);
    }
    const thunder = clamp(this.game.seasons?.cycle?.state?.climate?.thunder || 0);
    // Fixed 18-second slots: changing a preset cannot make the clock run faster.
    const slot = Math.floor(this._simTime / 18), age = mod(this._simTime, 18) - 2.5;
    const selected = mod(slot, 4) === 0 || thunder > 0.5;
    const envelope = age >= 0 && age < 4.2 ? smooth(0, 0.22, age) * Math.exp(-age / 1.2) * (1 - smooth(2.6, 4.2, age)) : 0;
    this._flash = selected ? envelope * thunder * strength * 0.22 * shower(this._simTime, u.uClimate.value.w) : 0;
    this._strike = slot;
    u.uWeather.value.w = this._flash;
    this.lightning.visible = this._flash > 0.001;
  }

  prepare(camera, size, reversed) {
    // Must be called after the render camera is positioned; this never advances simulation.
    const u = this.U, active = u.uClimate.value.x > 0;
    this.group.visible = active;
    this.rain.visible = active && u.uWeather.value.x * shower(u.uTime.value, u.uClimate.value.w) > 0.002;
    this.birds.visible = active && Math.abs(u.uPhenology.value.w) > 0.001;
    if (!active) {
      u.uWeather.value.w = 0;
      this.lightning.visible = false;
      return;
    }
    camera.getWorldPosition(this._camera);
    if (this.rain.visible) {
      this.rainMaterial.uniforms.uDepth.value.set(camera.near, camera.far, reversed ? 1 : 0);
      this.rainMaterial.uniforms.uRes.value.set(Math.max(1, size.x), Math.max(1, size.y));
      this._refreshCover(this._camera.x, this._camera.z);
    }
    if (this.lightning.visible && this._placedStrike !== this._strike) {
      camera.getWorldDirection(this._direction);
      this._direction.y = 0;
      if (this._direction.lengthSq() < 0.001) this._direction.set(0, 0, -1);
      this._direction.normalize();
      const side = (hash(this._strike + 911) - 0.5) * 170;
      const x = this._camera.x + this._direction.x * 480 - this._direction.z * side;
      const z = this._camera.z + this._direction.z * 480 + this._direction.x * side;
      const y = Math.max(this.game.terrain.heightAt(x, z), this._camera.y + 12);
      this._boltOrigin.value.set(x, y, z);
      this._boltAngle.value = Math.atan2(this._direction.x, this._direction.z);
      this._placedStrike = this._strike;
    }
  }
}

function cropGeometry() {
  const positions = [], parts = [];
  const tri = (a, b, c, part) => { positions.push(...a, ...b, ...c); parts.push(part, part, part); };
  // Crossed narrow stalk ribbons retain a silhouette from every direction.
  for (let axis = 0; axis < 2; axis++) {
    const p = (x, y) => axis ? [0, y, x] : [x, y, 0];
    tri(p(-0.018, 0), p(0.018, 0), p(-0.011, 0.87), 0);
    tri(p(0.018, 0), p(0.011, 0.87), p(-0.011, 0.87), 0);
  }
  for (const side of [-1, 1]) for (const y of [0.23, 0.46]) {
    tri([0, y, 0], [side * 0.20, y + 0.15, 0.028], [side * 0.055, y + 0.09, -0.055], 1);
    tri([0, y + 0.1, 0], [0.026, y + 0.22, side * 0.17], [-0.04, y + 0.17, side * 0.05], 1);
  }
  for (let i = 0; i < 5; i++) for (const side of [-1, 1]) {
    const y = 0.72 + i * 0.052;
    tri([0, y, 0], [side * 0.064, y + 0.055, 0.014], [0, y + 0.09, 0.031], 2);
    tri([0, y, 0], [0.018, y + 0.055, side * 0.064], [-0.022, y + 0.09, 0], 2);
    tri([side * 0.045, y + 0.04, 0], [side * 0.05, y + 0.055, 0], [side * 0.092, y + 0.17, 0], 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', attr(positions, 3));
  g.setAttribute('aPart', attr(parts, 1));
  return g;
}

const SOIL_VERT = /* glsl */`
  attribute vec2 aSoilUv;
  attribute float aKind;
  varying vec3 vWorld, vTint;
  varying vec2 vSoilUv;
  varying float vKind, vShow;
  void main() {
    vWorld = position;
    vTint = vec3(1.0);
    vSoilUv = aSoilUv;
    vKind = aKind;
    vShow = 1.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;
const CROP_VERT = /* glsl */`
  attribute vec4 aRoot;
  attribute vec3 aCrop;
  attribute float aPart;
  uniform float uTime;
  uniform vec4 uPhenology, uWind;
  varying vec3 vWorld, vTint;
  varying vec2 vSoilUv;
  varying float vKind, vShow;
  void main() {
    float growth = clamp(uPhenology.x, 0.0, 1.0), ripe = clamp(uPhenology.y, 0.0, 1.0);
    float harvest = clamp(uPhenology.z, 0.0, 1.0);
    float cut = 1.0 - smoothstep(harvest - 0.025, harvest + 0.025, aCrop.x);
    // At .72: 28% standing gold, a broad adjoining seedling band and dry stubble.
    // At .85: mostly stubble, just 15% uncut wheat; not an equally lush second field.
    float replant = smoothstep(0.4, 0.65, harvest) * (1.0 - smoothstep(0.76, 0.84, harvest))
                  * (1.0 - smoothstep(0.38, 0.44, aCrop.x)) * smoothstep(0.08, 0.25, growth);
    float live = smoothstep(0.025, 0.16, growth);
    float height = mix(0.13, 1.30, growth);
    height = mix(height, mix(0.13, 0.27, replant), cut);
    float leaf = live * mix(1.0, replant, cut);
    float ear = smoothstep(0.66, 0.95, growth) * (1.0 - cut);
    vec3 p = position;
    p.y *= height * mix(0.85, 1.12, aRoot.w);
    p.xz *= mix(0.45, 1.0, growth) * mix(1.0, 0.65, cut);
    if (aPart > 1.5) p.xz *= ear;
    else if (aPart > 0.5) p.xz *= leaf;
    float c = cos(aCrop.y), s = sin(aCrop.y);
    p.xz = mat2(c, -s, s, c) * p.xz;
    float sway = sin(uTime * 2.4 + aRoot.x * 0.8 + aRoot.z * 0.3) * 0.035 + 0.025;
    p.xz += uWind.xy * uWind.z * sway * p.y * p.y;
    vWorld = aRoot.xyz + p;
    float gold = smoothstep(0.36, 0.98, ripe);
    vec3 green = mix(vec3(0.10, 0.32, 0.045), vec3(0.23, 0.38, 0.055), growth);
    vec3 wheat = mix(green, vec3(0.69, 0.43, 0.095), gold);
    wheat = mix(vec3(0.28, 0.19, 0.08), wheat, live);
    wheat = mix(wheat, mix(vec3(0.38, 0.25, 0.09), vec3(0.14, 0.40, 0.065), replant), cut);
    vTint = wheat * mix(0.84, 1.15, aRoot.w) * (aPart > 1.5 ? 1.18 : 1.0);
    vSoilUv = vec2(0.0);
    vKind = 2.0;
    vShow = aPart > 1.5 ? ear : (aPart > 0.5 ? leaf : 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;
const FIELD_FRAG = /* glsl */`
  uniform vec4 uSurfaceWeather;
  uniform float uSeasonSnow;
  varying vec3 vWorld, vTint;
  varying vec2 vSoilUv;
  varying float vKind, vShow;
  ${ATMOSPHERE}
  void main() {
    // Stable screen-door coverage avoids alpha-sorting whole fields during mode transitions.
    float dither = fract(dot(floor(gl_FragCoord.xy), vec2(0.75487766, 0.56984029)));
    if (dither > clamp(uClimate.x, 0.0, 1.0) * vShow || vShow < 0.002) discard;
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (N.y < 0.0) N = -N;
    vec3 albedo = vTint;
    if (vKind < 0.5) {
      float ridge = 0.5 + 0.5 * cos(vSoilUv.x * 14.51);
      float grit = fract(sin(dot(floor(vSoilUv * 60.0), vec2(12.9898, 78.233))) * 43758.54);
      albedo = vec3(0.22, 0.125, 0.060) * (0.76 + 0.20 * ridge + 0.10 * grit);
    } else if (vKind < 1.5) {
      float board = smoothstep(0.015, 0.045, abs(fract(vSoilUv.y * 4.0) - 0.5));
      albedo = vec3(0.24, 0.16, 0.09) * mix(0.50, 1.0, board);
    }
    albedo *= 1.0 - clamp(uSurfaceWeather.x, 0.0, 1.0) * (vKind > 1.5 ? 0.13 : 0.30);
    albedo = mix(albedo, vec3(0.36, 0.31, 0.25), uSurfaceWeather.w * 0.22);
    float snow = clamp(uSeasonSnow, 0.0, 1.0) * (vKind < 0.5 ? 1.0 : 0.65);
    float frost = uSurfaceWeather.z * 0.32;
    albedo = mix(albedo, vec3(0.82, 0.90, 0.95), clamp((snow + frost) * smoothstep(0.12, 0.7, N.y), 0.0, 1.0));
    float diffuse = max(dot(N, uSunDir), 0.0);
    vec3 ambient = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
    vec3 color = albedo * (ambient * 0.9 + uSunColor * (0.12 + 0.65 * diffuse));
    gl_FragColor = vec4(applyAtmosphere(color, vWorld), 1.0);
  }
`;
