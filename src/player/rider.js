import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../core/ctx.js';

const LANTERN_PIVOT = [0, -0.035, -0.96];
const SHADOW_SIZE = 1024;
const SHADOW_EXTENT = 3.4; // half-width of the shadow box in metres
const STAND_HEIGHT = 2.05;
const STAND_CLIPS = { Idle: 'Idle', Walk: 'Walking_A', Run: 'Running_A', Jump: 'Jump_Idle', Ride: 'Sit_Chair_Idle' };

function makeBroom() {
  const parts = [];
  const part = (geometry, color, x, y, z, bristles = false, lantern = false) => {
    geometry.translate(x, y, z);
    const p = geometry.attributes.position, c = new THREE.Color(color);
    const colors = new Float32Array(p.count * 3), wind = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      c.toArray(colors, i * 3);
      wind[i * 4 + 1] = bristles ? THREE.MathUtils.clamp((p.getZ(i) - 0.75) / 0.65, 0, 1) : 0;
      wind[i * 4 + 3] = lantern ? 1 : 0;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('_wind', new THREE.BufferAttribute(wind, 4));
    parts.push(geometry);
  };
  const handle = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.01, 1.05), new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.05, -0.6), new THREE.Vector3(0, 0.27, -1.18),
  ]);
  part(new THREE.TubeGeometry(handle, 20, 0.038, 6, false), 0x77513b, 0, 0, 0);
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    const straw = new THREE.CylinderGeometry(0.035, 0.09, 0.75, 5).rotateX(-Math.PI / 2);
    straw.rotateY(Math.cos(a) * 0.16).rotateX(Math.sin(a) * 0.16);
    part(straw, i % 2 ? 0xc7994d : 0xdfb865, Math.cos(a) * 0.095, Math.sin(a) * 0.075, 1.12, true);
  }
  for (const z of [0.76, 0.83]) part(new THREE.TorusGeometry(0.115, 0.022, 5, 10), 0x5b385b, 0, 0, z);
  part(new THREE.TorusGeometry(0.053, 0.009, 5, 10), 0x936b37, 0, -0.087, -0.96, false, true);
  part(new THREE.CylinderGeometry(0.059, 0.065, 0.13, 6), 0xffd58b, 0, -0.21, -0.96, false, true);
  for (const y of [-0.135, -0.285]) part(new THREE.CylinderGeometry(0.077, 0.077, 0.026, 6), 0x936b37, 0, y, -0.96, false, true);
  const geometry = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const broom = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
  broom.name = 'Mage_Broom';
  return broom;
}

export class Rider {
  static load(renderer) {
    return new Rider(renderer);
  }

  constructor(renderer) {
    const model = makeBroom();
    this.renderer = renderer;
    this.group = new THREE.Group();      // world pose
    this.tilt = new THREE.Group();       // local bob / lean
    this.group.add(this.tilt);
    this.tilt.add(model);
    this.model = model;
    this.uniforms = {
      uRiderTime: { value: 0 },
      uRiderWind: { value: 1 },
      uLanternPivot: { value: new THREE.Vector3().fromArray(LANTERN_PIVOT) },
      uLantern: { value: new THREE.Vector2() },
    };
    this.lantern = { ax: 0, az: 0, vx: 0, vz: 0 };
    // seated model: lift (m), squash (1 = none), roll about the broom (rad), calm (1 stills the hover bob)
    this.seat = { hop: 0, sy: 1, flip: 0, calm: 0 };
    // dismounted: show the standing model with its feet at y (m, in the rider's frame), squashed by sy
    this.off = { on: false, y: 0, sy: 1 };
    this.standing = null;                // { root, model, height } once the standing model is in
    this.walkSpeed = 0;
    this.walkFast = false;
    this.airborne = false;
    this.meshes = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      this.meshes.push(o);
      o.frustumCulled = false;
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      m.envMapIntensity = 1.0;
      m.normalScale?.set(1, 1);
      if (m.map) m.map.anisotropy = 8;
      this._patch(m, !!o.geometry.attributes._wind);
    });
    this._outline = this._measure(model);

    // ---- lights for the sharp layer (three's units: irradiance, so pi x our radiance-style sun)
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.012;
    const sc = this.sun.shadow.camera;
    sc.left = -2.2; sc.right = 2.2; sc.top = 2.2; sc.bottom = -2.2; sc.near = 0.5; sc.far = 14;
    this.fill = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    this.lights = new THREE.Group();
    this.lights.add(this.sun, this.sun.target, this.fill);
    this.sunVis = 1;

    // ---- shadow map for the world shaders (depth from the sun's point of view)
    const depth = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE, THREE.FloatType);
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    this.shadowRT = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthTexture: depth, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.shadowCam = new THREE.OrthographicCamera(-SHADOW_EXTENT, SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, 1, 60);
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.shadowScene = new THREE.Scene();
    U.uShadowTex.value = depth;
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  _patch(mat, hasWind, u = this.uniforms) {
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      if (!hasWind) return;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`#include <common>
          attribute vec4 _wind;       // cape, bristles, hat, lantern
          uniform float uRiderTime;
          uniform float uRiderWind;
          uniform vec3 uLanternPivot;
          uniform vec2 uLantern;
        `)
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
          {
            float t = uRiderTime, sp = uRiderWind;
            // cape: ripples run down the cloth and the hem lifts into the slipstream
            float ph = position.z * 10.0 + position.x * 6.0 - t * 15.0;
            transformed += vec3(sin(ph * 0.83 + 1.3) * 0.022, sin(ph) * 0.034 + 0.030, 0.030 + 0.020 * sin(ph * 0.5)) * _wind.r * sp;
            // bristles: a fine shiver plus a slow sway of the whole head
            float bp = position.x * 43.0 + position.y * 37.0 - t * 33.0;
            transformed.xy += vec2(sin(bp), cos(bp * 1.31)) * 0.011 * _wind.g * sp;
            transformed.y += sin(t * 8.3 + position.z * 5.0) * 0.016 * _wind.g * sp;
            transformed.x += sin(t * 6.1 + position.z * 4.0) * 0.012 * _wind.g * sp;
            // hat: the crown is pushed back and its tip whips; the brim flutters
            transformed.z += (0.040 + sin(t * 11.0 + position.x * 9.0) * 0.012) * _wind.b * sp;
            transformed.x += sin(t * 7.3 + position.y * 6.0) * 0.018 * _wind.b * sp;
            transformed.y += sin(t * 13.0 + position.x * 14.0 + position.z * 9.0) * 0.010 * _wind.b * sp;
            // lantern: rigid pendulum on its hook
            vec3 lp = transformed - uLanternPivot;
            float cx = cos(uLantern.x), sx = sin(uLantern.x), cz = cos(uLantern.y), sz = sin(uLantern.y);
            lp = vec3(lp.x * cz - lp.y * sz, lp.x * sz + lp.y * cz, lp.z);
            lp = vec3(lp.x, lp.y * cx - lp.z * sx, lp.y * sx + lp.z * cx);
            transformed = mix(transformed, uLanternPivot + lp, _wind.a);
          }
        `);
    };
    mat.customProgramCacheKey = () => `rider-${hasWind}`;
    mat.needsUpdate = true;
  }

  /** A thinned-out copy of the model's points (y, z in the rider's frame), for restHeight(). */
  _measure(model) {
    model.updateMatrixWorld(true);
    const out = [], v = new THREE.Vector3();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(p.count / 24000));
      for (let i = 0; i < p.count; i += step) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        out.push(v.y, v.z);
      }
    });
    return new Float32Array(out);
  }

  /**
   * How high the middle of the broom is when it has been set down nose-up at `pitch` radians:
   * the height that puts the lowest part of rider and broom (boots, bristles) on the floor.
   */
  restHeight(pitch) {
    const c = Math.cos(pitch), s = Math.sin(pitch), a = this._outline;
    let min = Infinity;
    for (let i = 0; i < a.length; i += 2) { const y = a[i] * c - a[i + 1] * s; if (y < min) min = y; }
    return -min;
  }

  async loadStand(base = './assets/models/characters') {
    const gltf = await new GLTFLoader().loadAsync(`${base}/Mage.glb`);
    return this.setStand(gltf.scene, gltf.animations);
  }

  setStand(model, clips) {
    const root = new THREE.Group(), mixer = new THREE.AnimationMixer(model), actions = {};
    for (const [state, name] of Object.entries(STAND_CLIPS)) {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) throw new Error(`Mage animation missing: ${name}`);
      actions[state] = mixer.clipAction(clip);
    }
    for (const name of ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff']) model.getObjectByName(name)?.removeFromParent();
    actions.Idle.play();
    mixer.update(0);
    model.rotation.y = Math.PI;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const scale = STAND_HEIGHT / (box.max.y - box.min.y);
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
    root.add(model);
    actions.Idle.stop();
    actions.Ride.play();
    mixer.update(0);
    root.updateMatrixWorld(true);
    const rideOffset = new THREE.Vector3(0, 0.13, 0).sub(model.getObjectByName('hips').getWorldPosition(new THREE.Vector3()));
    actions.Ride.stop();
    actions.Idle.reset().play();
    mixer.update(0);
    root.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.castShadow = true;
      o.receiveShadow = true;
      o.material.envMapIntensity = 1;
      if (o.material.map) o.material.map.anisotropy = 8;
    });
    if (this.standing) {
      this.standing.mixer.stopAllAction();
      this.standing.mixer.uncacheRoot(this.standing.model);
      this.group.remove(this.standing.root);
    }
    this.group.add(root);
    // Planted-sole speeds measured from the bundled in-place clips, before scaling.
    this.standing = { root, model, height: STAND_HEIGHT, mixer, actions, state: 'Idle',
      legs: ['Mage_LegLeft', 'Mage_LegRight'].map((name) => model.getObjectByName(name)),
      footBox: new THREE.Box3(), stride: { Walk: 0.74 * scale, Run: 4.4 * scale },
      rideOffset, ridePosition: new THREE.Vector3(), groundY: 0 };
    return this.standing;
  }

  _animateStand(dt, flight, terrain) {
    const S = this.standing, o = this.off;
    this.tilt.visible = !o.on;
    const state = !o.on ? 'Ride' : this.airborne ? 'Jump' : this.walkSpeed < 0.04 ? 'Idle' : this.walkFast ? 'Run' : 'Walk';
    if (state !== S.state) {
      const previous = S.actions[S.state], next = S.actions[state];
      next.reset().setEffectiveWeight(1).play();
      previous.crossFadeTo(next, 0.18, false);
      S.state = state;
    }
    for (const name of ['Walk', 'Run']) S.actions[name].setEffectiveTimeScale(this.walkSpeed / S.stride[name]);
    S.mixer.update(dt);
    const ride = S.actions.Ride.isScheduled() ? S.actions.Ride.getEffectiveWeight() : 0;
    if (o.on) S.groundY = o.y;
    S.ridePosition.copy(S.rideOffset).multiply(this.tilt.scale).applyQuaternion(this.tilt.quaternion).add(this.tilt.position);
    S.root.position.set(0, S.groundY, 0).lerp(S.ridePosition, ride);
    S.root.quaternion.identity().slerp(this.tilt.quaternion, ride);
    const wide = 1 / Math.sqrt(o.sy);
    S.root.scale.set(wide, o.sy, wide).lerp(this.tilt.scale, ride);
    if (!o.on || ride > 0 || this.airborne || o.sy !== 1) return;
    this.group.updateMatrixWorld(true);
    let correction = -Infinity;
    for (const mesh of S.legs) {
      mesh.computeBoundingBox();
      const box = S.footBox.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
      for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
        const surface = Math.max(terrain.heightAt(x, z), flight.solid?.heightAt(x, z) ?? -Infinity);
        correction = Math.max(correction, surface - box.min.y);
      }
    }
    // Running has an authored aerial phase; only walking pins the lowest sole to the support.
    S.root.position.y += THREE.MathUtils.clamp(correction, state === 'Run' ? 0 : -0.06, 0.16);
  }

  /** @param flight Flight state. */
  update(dt, time, flight, terrain) {
    const g = this.group;
    g.position.copy(flight.pos);
    g.rotation.order = 'YXZ';
    g.rotation.set(flight.pitch, -flight.yaw, -flight.roll);
    // hover: a slow bob and a breath of sway, more nervous at speed
    const sk = Math.min(flight.speed / 33, 2);
    const st = this.seat, live = 1 - st.calm;
    this.tilt.position.y = (Math.sin(time * 1.9) * 0.05 + Math.sin(time * 5.3) * 0.012 * sk) * live + st.hop;
    this.tilt.rotation.z = (Math.sin(time * 1.3) * 0.022 + Math.sin(time * 7.1) * 0.006 * sk) * live + st.flip;
    // (and a nod with the landing bounce: nose down as she sinks into it, up as she springs back)
    this.tilt.rotation.x = Math.sin(time * 1.1 + 1) * 0.016 * live - flight.pitchRate * 0.05 + Math.max(-0.12, Math.min(0.12, flight.bobV * 0.035));
    this.tilt.rotation.y = -flight.turnRate * 0.07;
    // squash and stretch keep her volume: what she loses in height she gains in girth
    const wide = st.sy === 1 ? 1 : 1 / Math.sqrt(st.sy);
    this.tilt.scale.set(wide, st.sy, wide);

    if (this.standing) this._animateStand(dt, flight, terrain);
    else this.tilt.visible = true;

    this.uniforms.uRiderTime.value = time;
    this.uniforms.uRiderWind.value = 0.35 + 0.65 * sk + flight.boosting * 0.6;

    // ---- lantern pendulum in the rider's frame: gravity + inertial forces
    const L = this.lantern;
    const ax = flight.accel;
    // local accelerations (forward / right) felt by the lantern
    const fwdA = (ax.x * flight.fwd.x + ax.y * flight.fwd.y + ax.z * flight.fwd.z);
    const rightX = Math.cos(flight.yaw), rightZ = Math.sin(flight.yaw);
    const latA = ax.x * rightX + ax.z * rightZ + flight.turnRate * flight.speed * 0.25;
    const drag = flight.speed * 0.010; // the slipstream pushes it back
    const gx = 9.8 * Math.sin(flight.pitch) + fwdA * 0.25 - drag * 9.8;
    const gz = 9.8 * Math.sin(flight.roll) * 0.6 - latA * 0.12;
    const len = 0.22;
    L.vx += (-(9.8 / len) * Math.sin(L.ax) * 0.25 + gx * 1.6 - L.vx * 2.6) * dt;
    L.vz += (-(9.8 / len) * Math.sin(L.az) * 0.25 + gz * 1.6 - L.vz * 2.6) * dt;
    L.ax = THREE.MathUtils.clamp(L.ax + L.vx * dt, -1.1, 1.1);
    L.az = THREE.MathUtils.clamp(L.az + L.vz * dt, -0.9, 0.9);
    this.uniforms.uLantern.value.set(L.ax + Math.sin(time * 3.1) * 0.03, L.az + Math.sin(time * 2.3) * 0.03);

    // ---- sun: is the rider in the shade of the land?
    const s = U.uSunDir.value;
    const hit = terrain.raycast(flight.pos.x, flight.pos.y + 0.5, flight.pos.z, s.x, s.y, s.z, 900, 5);
    this.sunVis += ((hit < 0 ? 1 : 0.06) - this.sunVis) * Math.min(1, dt * 6);
    const sc = U.uSunColor.value;
    this.sun.color.setRGB(sc.x, sc.y, sc.z);
    this.sun.intensity = Math.PI * this.sunVis;
    this.sun.position.copy(flight.pos).addScaledVector(s, 7);
    this.sun.target.position.copy(flight.pos);
    const sky = U.uAmbSky.value, gr = U.uAmbGround.value;
    this.fill.color.setRGB(sky.x, sky.y, sky.z);
    this.fill.groundColor.setRGB(gr.x * 1.6, gr.y * 1.6, gr.z * 1.6);
    this.fill.intensity = Math.PI * 0.55;
  }

  /** Render the rider's depth from the sun and publish the matrix the world shaders use. */
  renderShadow(reversed) {
    const cam = this.shadowCam, s = U.uSunDir.value, p = this.group.position;
    cam.position.copy(p).addScaledVector(s, 30);
    cam.up.set(0, 1, 0);
    cam.lookAt(p);
    cam.updateMatrixWorld();
    const r = this.renderer;
    // draw only the rider, with a depth-only material
    const parent = this.group.parent;
    this.shadowScene.add(this.group);
    this.shadowScene.overrideMaterial = this.depthMat;
    const prev = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    r.setRenderTarget(this.shadowRT);
    r.render(this.shadowScene, cam);
    r.setRenderTarget(null);
    r.shadowMap.enabled = prev;
    this.shadowScene.overrideMaterial = null;
    if (parent) parent.add(this.group);
    // world -> shadow uv + standard depth (0 near .. 1 far), independent of the depth convention
    const view = cam.matrixWorldInverse;
    const e = SHADOW_EXTENT, n = cam.near, f = cam.far;
    const proj = this._m.set(
      0.5 / e, 0, 0, 0.5,
      0, 0.5 / e, 0, 0.5,
      0, 0, -1 / (f - n), -n / (f - n),
      0, 0, 0, 1,
    );
    U.uShadowMat.value.multiplyMatrices(proj, view);
    U.uShadowOn.value = reversed ? 2 : 1;
  }
}
