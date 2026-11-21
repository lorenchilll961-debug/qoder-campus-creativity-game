import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { U } from '../core/ctx.js';
import { loadTracked } from '../core/progress.js';

const SHADOW_SIZE = 1024;
const SHADOW_EXTENT = 3.4; // half-width of the shadow box in metres
const STAND_HEIGHT = 2.05;
const STAND_CLIPS = { Idle: 'Idle', Walk: 'Walking_A', Run: 'Running_A', Jump: 'Jump_Idle', Ride: 'Sit_Floor_Idle' };

export class Rider {
  static async load(renderer, base = './assets/models/vehicles') {
    const gltf = await loadTracked(new GLTFLoader(), `${base}/magic-carpet.glb`);
    return new Rider(renderer, gltf.scene);
  }

  constructor(renderer, model) {
    model.name = 'Magic_Carpet';
    const box = new THREE.Box3().setFromObject(model, true);
    const center = box.getCenter(new THREE.Vector3()), scale = 1.9 / (box.max.x - box.min.x);
    const heightScale = 0.36 / (box.max.y - box.min.y);
    this.cloth = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const geometry = o.geometry = o.geometry.clone();
      geometry.scale(scale, heightScale, scale).translate(-center.x * scale, 0, -center.z * scale);
      const p = geometry.attributes.position, edges = [];
      for (let i = 0; i < p.count; i++) {
        const edge = THREE.MathUtils.smoothstep(Math.max(Math.abs(p.getX(i)) / 0.63, Math.abs(p.getZ(i)) / 0.84), 0.75, 1.5);
        p.setY(i, p.getY(i) * (0.12 + 0.88 * edge));
        const wave = THREE.MathUtils.smoothstep(Math.abs(p.getZ(i)), 0.84, 1.42);
        if (wave > 0) edges.push([i, wave]);
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      p.setUsage(THREE.DynamicDrawUsage);
      this.cloth.push({ geometry, rest: p.array.slice(), edges });
      o.material = o.material.clone();
      o.material.side = THREE.DoubleSide;
    });
    this.renderer = renderer;
    this.group = new THREE.Group();      // world pose
    this.tilt = new THREE.Group();       // local bob / lean
    this.group.add(this.tilt);
    this.tilt.add(model);
    this.model = model;
    // Keep the landing and trick controllers' pose contract independent of the vehicle mesh.
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

  _animateCarpet(time, strength) {
    // Deform real vertices so the world depth pass and the lit carpet share the same silhouette.
    for (const { geometry, rest, edges } of this.cloth) {
      if (!edges.length) continue;
      const p = geometry.attributes.position;
      for (const [i, wave] of edges) {
        const x = rest[i * 3], z = rest[i * 3 + 2];
        p.setY(i, rest[i * 3 + 1] + Math.sin(z * 6 - time * 4.5 + x * 0.7) * wave * strength * 0.045);
      }
      p.needsUpdate = true;
      geometry.computeVertexNormals();
    }
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

  /** Height of the vehicle center that keeps its pitched outline above the floor. */
  restHeight(pitch) {
    const c = Math.cos(pitch), s = Math.sin(pitch), a = this._outline;
    let min = Infinity;
    for (let i = 0; i < a.length; i += 2) { const y = a[i] * c - a[i + 1] * s; if (y < min) min = y; }
    return -min;
  }

  async loadStand(base = './assets/models/characters') {
    const gltf = await loadTracked(new GLTFLoader(), `${base}/Mage.glb`);
    return this.setStand(gltf.scene, gltf.animations);
  }

  setStand(model, clips) {
    const root = new THREE.Group(), mixer = new THREE.AnimationMixer(model), actions = {};
    for (const [state, name] of Object.entries(STAND_CLIPS)) {
      let clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) throw new Error(`Mage animation missing: ${name}`);
      if (state === 'Ride') {
        clip = clip.clone();
        clip.name = 'Mage_Carpet_Seat';
        const spine = clip.tracks.find((track) => track.name === 'spine.quaternion');
        const lift = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35);
        const q = new THREE.Quaternion();
        for (let i = 0; i < spine.values.length; i += 4) q.fromArray(spine.values, i).premultiply(lift).toArray(spine.values, i);
        const cape = model.getObjectByName('Mage_Cape').quaternion.clone();
        cape.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.05));
        clip.tracks.push(new THREE.QuaternionKeyframeTrack('Mage_Cape.quaternion', [0, clip.duration], [...cape.toArray(), ...cape.toArray()]));
      }
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
    const hips = model.getObjectByName('hips').getWorldPosition(new THREE.Vector3());
    const contactMeshes = ['Mage_Body', 'Mage_LegLeft', 'Mage_LegRight'].map((name) => model.getObjectByName(name));
    const bottom = Math.min(...contactMeshes.map((mesh) => new THREE.Box3().setFromObject(mesh, true).min.y));
    const rideOffset = new THREE.Vector3(-hips.x, 0.025 - bottom, -hips.z);
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
    this.standing = { root, model, head: model.getObjectByName('head'), height: STAND_HEIGHT, mixer, actions, state: 'Idle',
      legs: ['Mage_LegLeft', 'Mage_LegRight'].map((name) => model.getObjectByName(name)),
      footBox: new THREE.Box3(), stride: { Walk: 0.74 * scale, Run: 4.4 * scale },
      rideOffset, ridePosition: new THREE.Vector3(), groundY: 0,
      contactMeshes, contactBox: new THREE.Box3(), contactMatrix: new THREE.Matrix4(), carpetInverse: new THREE.Matrix4() };
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
    this.model.position.y = 0;
    if (!o.on && ride < 1) {
      this.group.updateMatrixWorld(true);
      S.carpetInverse.copy(this.tilt.matrixWorld).invert();
      let bottom = Infinity;
      for (const mesh of S.contactMeshes) {
        mesh.computeBoundingBox();
        S.contactMatrix.multiplyMatrices(S.carpetInverse, mesh.matrixWorld);
        bottom = Math.min(bottom, S.contactBox.copy(mesh.boundingBox).applyMatrix4(S.contactMatrix).min.y);
      }
      this.model.position.y = Math.min(0, bottom - 0.025);
    }
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
    this.tilt.rotation.x = Math.sin(time * 1.1 + 1) * 0.016 * live - flight.pitchRate * 0.05 + Math.max(-0.12, Math.min(0.12, flight.bobV * 0.035)) - flight.boosting * 0.06 * live;
    this.tilt.rotation.y = -flight.turnRate * 0.07;
    // squash and stretch keep her volume: what she loses in height she gains in girth
    const wide = st.sy === 1 ? 1 : 1 / Math.sqrt(st.sy);
    this.tilt.scale.set(wide, st.sy, wide);

    if (this.standing) this._animateStand(dt, flight, terrain);
    else this.tilt.visible = true;

    if (this.tilt.visible) this._animateCarpet(time, live * (0.35 + 0.35 * sk + flight.boosting * 0.3));

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
    const visible = this.group.visible;
    this.group.visible = true;
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
    this.group.visible = visible;
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
