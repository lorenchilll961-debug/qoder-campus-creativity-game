import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('../../vendor/three/build/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL(`../../vendor/three/examples/jsm/${specifier.slice(13)}`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { clone } = await import('three/addons/utils/SkeletonUtils.js');
const { RESIDENTS, Resident, DeliveryNPCs, patrolRoute } = await import('./npc.js');
const { WALK, probeGround, moveGround } = await import('./ground.js');
const { Courier } = await import('./courier.js');
const { FIRST_ORDER } = await import('./quest.js');

const near = (a, b, eps = 1e-6, message = '') => assert.ok(Math.abs(a - b) <= eps, `${message}: ${a} != ${b}`);
const flat = (y = 10) => ({ terrain: { heightAt: () => y } });
const padAt = (id = RESIDENTS[0].padId, x = 0, y = 10, z = 0) => ({ id, name: id, pos: { x, y, z }, radius: 2, ground: true });
const playerAt = (x = 0, y = 10.82, z = 5) => new THREE.Vector3(x, y, z);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const sourceCache = new Map();
async function source(spec) {
  if (!sourceCache.has(spec.model)) {
    const url = new URL(`../../assets/models/npcs/${spec.model}`, import.meta.url);
    const bytes = readFileSync(url);
    // A Buffer can be a view into a larger allocation. Never pass bytes.buffer alone.
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    sourceCache.set(spec.model, new GLTFLoader().parseAsync(buffer, new URL('.', url).href));
  }
  return sourceCache.get(spec.model);
}
async function resident(spec = RESIDENTS[0]) {
  const gltf = await source(spec);
  return new Resident(spec, { scene: clone(gltf.scene), animations: gltf.animations });
}
function skinnedMeshes(actor) {
  const meshes = [];
  actor.model.traverse((node) => { if (node.isSkinnedMesh) meshes.push(node); });
  assert.ok(meshes.length > 0, 'real model must have skinned meshes');
  return meshes;
}
function refresh(actor) {
  actor.group.updateMatrixWorld(true);
  for (const mesh of skinnedMeshes(actor)) mesh.skeleton.update();
}
function vertexSnapshot(actor) {
  refresh(actor);
  const values = [], p = new THREE.Vector3();
  for (const mesh of skinnedMeshes(actor)) {
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      values.push(p.x, p.y, p.z);
    }
  }
  return values;
}
function deformation(a, b) {
  assert.equal(a.length, b.length);
  return a.reduce((largest, value, i) => Math.max(largest, Math.abs(value - b[i])), 0);
}
function feetHeight(actor) {
  refresh(actor);
  // Multi-material glTF nodes become Groups whose primitive mesh names are generic.
  const feet = skinnedMeshes(actor).filter((mesh) => /feet/i.test(mesh.name) || /feet/i.test(mesh.parent?.name));
  assert.ok(feet.length, 'test actual foot geometry, not bind-pose geometry bounds');
  let min = Infinity;
  const p = new THREE.Vector3();
  for (const mesh of feet) {
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      min = Math.min(min, p.y - actor.pos.y);
    }
  }
  return min;
}
function bound(actor, env = flat(), pad = padAt(actor.spec.padId)) {
  actor.bind(env, pad);
  assert.equal(actor.active, true, 'fixture route must be walkable');
  return { actor, env, pad };
}
function weight(actor, name) { return actor.actions[name].getEffectiveWeight(); }
function sweep(env, a, b) {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  return moveGround(env, a, { x: (b.x - a.x) / distance, z: (b.z - a.z) / distance }, 0, distance / WALK.speed);
}

function manager(actors = [], env = flat(), feet = new THREE.Vector3(0, 10, 0)) {
  const flight = { ...env, pos: feet.clone().add(new THREE.Vector3(0, 0.82, 0)), gust: 0, yaw: 0 };
  const landing = { landed: true, busy: true, rest: 0.82, walk: { pos: feet.clone() } };
  const game = { state: 'play', paused: false, flight, gameplay: { landing } };
  const npcs = Object.assign(Object.create(DeliveryNPCs.prototype), { actors, pads: actors.map((a) => a.pad), talking: null, game });
  return { npcs, game, flight, landing };
}
function actorStub(pad = padAt(), pos = new THREE.Vector3(2, 10, 0), role = 'shopkeeper') {
  const calls = { faces: [], transitions: [], time: 0, updates: [] };
  return { pad, pos, active: true, spec: { padId: pad.id, role, name: role }, calls,
    transition: (state) => calls.transitions.push(state), face: (point, dt) => calls.faces.push({ point, dt }),
    mixer: { update: (dt) => { calls.time += dt; } }, update: (...args) => calls.updates.push(args) };
}

test('resident roles use the three local Quaternius models and fixed delivery IDs', () => {
  assert.deepEqual(RESIDENTS.map(({ role, model }) => [role, model]), [
    ['shopkeeper', 'Formal.glb'], ['villager', 'Farmer.glb'], ['wizard', 'Witch.glb'],
  ]);
  assert.equal(RESIDENTS[0].padId, FIRST_ORDER.pickup);
  assert.equal(RESIDENTS[1].padId, FIRST_ORDER.destination);
  assert.equal(RESIDENTS[2].padId, 'larkhaven:c_observatory:0:0');
});

for (const spec of RESIDENTS) {
  test(`${spec.model}: embedded GLB has 24 clips, 62 joints, no images or external dependencies`, async () => {
    const bytes = readFileSync(new URL(`../../assets/models/npcs/${spec.model}`, import.meta.url));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.byteLength);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    assert.equal(doc.animations.length, 24);
    assert.deepEqual(doc.skins.map((skin) => skin.joints.length), [62]);
    assert.equal(doc.images?.length || 0, 0);
    assert.equal(doc.textures?.length || 0, 0);
    assert.equal(doc.buffers.length, 1);
    assert.ok(doc.buffers.every((buffer) => !buffer.uri));
    assert.equal(doc.extensionsRequired?.length || 0, 0);
    const gltf = await source(spec);
    assert.equal(gltf.animations.length, 24);
    for (const name of ['Idle', 'Walk']) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, name);
      assert.ok(clip && clip.duration > 0 && clip.tracks.length > 0);
    }
  });

  test(`${spec.model}: every clip binds to real bones without Three binding warnings`, async (t) => {
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
    t.mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));
    const gltf = await source(spec), root = clone(gltf.scene), mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      for (const track of clip.tracks) {
        const path = THREE.PropertyBinding.parseTrackName(track.name);
        const node = THREE.PropertyBinding.findNode(root, path.nodeName);
        assert.ok(node, `${clip.name}: unresolved ${track.name}`);
        assert.ok(node[path.propertyName], `${clip.name}: missing property ${track.name}`);
      }
      const action = mixer.clipAction(clip).play();
      mixer.update(0.137);
      action.stop();
    }
    mixer.uncacheRoot(root);
    assert.deepEqual(warnings, []);
  });

  for (const state of ['Idle', 'Walk']) {
    test(`${spec.model}: ${state} advances mixer, bones and skinned vertices without actor/root drift`, async () => {
      const actor = await resident(spec);
      bound(actor);
      actor.pos.set(7, 13, -9);
      actor.transition(state);
      actor.mixer.update(0.3);
      const root = actor.model.position.clone(), pos = actor.pos.clone(), rotation = actor.group.quaternion.clone();
      const time = actor.mixer.time, actionTime = actor.actions[state].time;
      const bones = skinnedMeshes(actor)[0].skeleton.bones;
      assert.equal(bones.length, 62);
      const before = vertexSnapshot(actor);
      const transforms = bones.map((bone) => bone.matrixWorld.clone());
      actor.mixer.update(0.137);
      const after = vertexSnapshot(actor);
      near(actor.mixer.time - time, 0.137);
      assert.notEqual(actor.actions[state].time, actionTime);
      assert.ok(bones.some((bone, i) => !bone.matrixWorld.equals(transforms[i])), 'bone matrices must change');
      assert.ok(deformation(before, after) > 1e-4, 'skinned vertices must deform, not just the group');
      // Sample the same animation phase twenty loops later: baked root motion must not accumulate.
      const phase = vertexSnapshot(actor);
      actor.mixer.update(actor.actions[state].getClip().duration * 20);
      assert.ok(deformation(phase, vertexSnapshot(actor)) < 1e-4, 'looping must not accumulate root displacement');
      assert.ok(actor.pos.equals(pos));
      assert.ok(actor.model.position.equals(root));
      assert.ok(actor.group.quaternion.equals(rotation));
      near(actor.model.position.y, 0.02);
    });

    test(`${spec.model}: animated ${state} feet stay about 0–5 cm above actor floor including runtime lift`, async (t) => {
      const actor = await resident(spec);
      bound(actor);
      actor.pos.set(3, 17, -4);
      actor.transition(state);
      actor.mixer.update(0.3);
      const duration = actor.actions[state].getClip().duration;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i <= 120; i++) {
        const height = feetHeight(actor);
        min = Math.min(min, height); max = Math.max(max, height);
        actor.mixer.update(duration / 120);
      }
      t.diagnostic(`${state} foot minima range: ${min.toFixed(5)}..${max.toFixed(5)} m`);
      assert.ok(min >= -0.001, `feet penetrate actor floor: ${min} m`);
      assert.ok(max <= 0.051, `feet float above actor floor: ${max} m`);
    });
  }

  test(`${spec.model}: Idle/Walk blends have intermediate and final weights over repeated toggles`, async () => {
    const actor = await resident(spec);
    for (let cycle = 0; cycle < 8; cycle++) {
      const from = actor.state, to = from === 'Idle' ? 'Walk' : 'Idle';
      actor.transition(to);
      actor.mixer.update(0.125);
      near(weight(actor, from), 0.5); near(weight(actor, to), 0.5);
      assert.equal(actor.state, to);
      actor.mixer.update(0.14);
      near(weight(actor, from), 0); near(weight(actor, to), 1);
      assert.equal(actor.actions[to].isRunning(), true);
      const time = actor.actions[to].time;
      actor.transition(to); // Idempotence must not restart an already playing action.
      actor.mixer.update(0.01);
      near(actor.actions[to].time, time + 0.01);
    }
  });

  test(`${spec.model}: skinned feet remain above the floor during repeated cross-fades`, async (t) => {
    const actor = await resident(spec);
    bound(actor);
    let min = Infinity, max = -Infinity;
    for (let toggle = 0; toggle < 12; toggle++) {
      actor.transition(toggle % 2 ? 'Idle' : 'Walk');
      for (let frame = 0; frame < 30; frame++) {
        actor.mixer.update(1 / 60);
        const height = feetHeight(actor);
        min = Math.min(min, height); max = Math.max(max, height);
      }
    }
    t.diagnostic(`Cross-fade foot minima range: ${min.toFixed(5)}..${max.toFixed(5)} m`);
    assert.ok(min >= -0.001 && max <= 0.051, `blended feet out of 0–5 cm range: ${min}..${max} m`);
  });

  test(`${spec.model}: interrupted toggles keep normalized finite weights and eventually settle`, async () => {
    const actor = await resident(spec);
    for (let i = 0; i < 20; i++) {
      actor.transition(i % 2 ? 'Idle' : 'Walk');
      actor.mixer.update(0.04);
      const weights = ['Idle', 'Walk'].map((name) => weight(actor, name));
      assert.ok(weights.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
      near(weights[0] + weights[1], 1);
    }
    actor.mixer.update(0.3);
    near(weight(actor, 'Idle'), 1); near(weight(actor, 'Walk'), 0);
  });
}

test('independent residents do not share animated bones or mixer state', async () => {
  const a = await resident(), b = await resident();
  const aBones = skinnedMeshes(a)[0].skeleton.bones, bBones = skinnedMeshes(b)[0].skeleton.bones;
  assert.ok(aBones.every((bone, i) => bone !== bBones[i]));
  const before = vertexSnapshot(b);
  a.transition('Walk'); a.mixer.update(0.6);
  assert.deepEqual(vertexSnapshot(b), before);
  near(b.mixer.time, 0);
});

for (const spec of RESIDENTS) {
  test(`${spec.role}: flat closed patrol uses authored offsets without mutating pad or world`, () => {
    const env = freeze(flat()), pad = freeze(padAt(spec.padId, 20, 10, -30)), before = JSON.stringify(pad);
    const offsets = freeze(spec.route.map((point) => [...point]));
    const route = patrolRoute(env, pad, offsets);
    assert.deepEqual(route, offsets.map(([x, z]) => ({ x: pad.pos.x + x, y: 10, z: pad.pos.z + z })));
    assert.equal(JSON.stringify(pad), before);
    assert.notEqual(route[0], pad.pos);
  });
}

test('patrol accepts a gentle slope and follows support height in both directions', async () => {
  const env = freeze({ terrain: { heightAt: (x) => 10 + x * 0.1 } });
  const spec = { ...RESIDENTS[0], route: [[-1, 0], [1, 0]] };
  const { actor } = bound(await resident(spec), env);
  near(actor.route[0].y, 9.9); near(actor.route[1].y, 10.1);
  actor.wait = 0;
  for (let i = 0; i < 500; i++) {
    actor.update(1 / 60, env, playerAt(), false);
    near(actor.pos.y, env.terrain.heightAt(actor.pos.x));
    assert.ok(actor.pos.x >= -1.000001 && actor.pos.x <= 1.000001);
  }
});

const rejectedRoutes = [
  ['sea', flat(-1)],
  ['river crossing with dry endpoints', { ...flat(), river: { levelAt: (x) => Math.abs(x) < 0.4 ? 11 : -Infinity } }],
  ['invalid support', { terrain: { heightAt: () => NaN } }],
  ['steep slope', { terrain: { heightAt: (x, z) => 10 + z * 0.75 } }],
  ['ledge/drop between valid endpoints', { terrain: { heightAt: (x) => Math.abs(x) < 0.4 ? 2 : 10 } }],
  ['thin solid wall', { ...flat(), solid: { heightAt: (x) => Math.abs(x) < 0.055 ? 20 : -Infinity } }],
  ['head-height prop that only displaces collision probes', { ...flat(), props: { collide(p, r) {
    if (Math.abs(p.x) < r + 0.05 && p.y > 11.5) p.y += 0.01;
    return false;
  } } }],
  ['higher overhead floor', { ...flat(), solid: { heightAt: () => 15 } }],
];
for (const [name, env] of rejectedRoutes) {
  test(`patrol refuses ${name} and keeps its resident inactive`, async () => {
    const spec = { ...RESIDENTS[0], route: [[-2, 0], [2, 0]] }, actor = await resident(spec), pad = freeze(padAt());
    freeze(env);
    assert.equal(patrolRoute(env, pad, spec.route), null);
    actor.bind(env, pad);
    assert.equal(actor.active, false); assert.equal(actor.group.visible, false);
    const pos = actor.pos.clone(), time = actor.mixer.time;
    actor.update(2, env, playerAt(), false);
    assert.ok(actor.pos.equals(pos)); near(actor.mixer.time, time);
  });
}

test('closed-route validation includes the last-to-first segment, not just consecutive points', () => {
  const env = { ...flat(), solid: { heightAt: (x, z) => Math.abs(x) < 0.12 && Math.abs(z) < 0.5 ? 20 : -Infinity } };
  const offsets = [[-2, -2], [2, -2], [2, 2]], points = offsets.map(([x, z]) => probeGround(env, x, z).pos);
  assert.ok(points.every(Boolean));
  assert.equal(sweep(env, points[0], points[1]).blocked, null);
  assert.equal(sweep(env, points[1], points[2]).blocked, null);
  assert.ok(sweep(env, points[2], points[0]).blocked);
  assert.equal(patrolRoute(env, padAt(), offsets), null);
});

for (const fps of [15, 60, 144]) {
  test(`resident walks at authored speed at ${fps} fps and never overshoots its route`, async () => {
    const { actor, env } = bound(await resident());
    actor.wait = 0;
    const start = actor.pos.clone(), player = freeze(playerAt());
    for (let i = 0; i < fps; i++) actor.update(1 / fps, env, player, false);
    near(actor.pos.x - start.x, actor.spec.speed); near(actor.pos.z, start.z);
    near(actor.mixer.time, 1); assert.equal(actor.state, 'Walk');
    actor.update(100, env, player, false);
    near(actor.pos.x, actor.route[1].x);
    actor.update(0.01, env, player, false);
    assert.equal(actor.state, 'Idle'); assert.equal(actor.next, 0); near(actor.wait, 1.2);
  });
}

for (const blocker of ['wall', 'head prop', 'water', 'ledge']) {
  for (const dt of [1 / 60, 2]) {
    test(`dynamic ${blocker} stops/reverses without tunneling (${dt === 2 ? '2-second' : '60-fps'} frames)`, async () => {
      let blocked = false;
      const env = {
        terrain: { heightAt: (x) => blocked && blocker === 'ledge' && Math.abs(x) < 0.4 ? 2 : 10 },
        solid: { heightAt: (x) => blocked && blocker === 'wall' && Math.abs(x) < 0.055 ? 20 : -Infinity },
        river: { levelAt: (x) => blocked && blocker === 'water' && Math.abs(x) < 0.4 ? 11 : -Infinity },
        props: { collide(p, r) {
          if (blocked && blocker === 'head prop' && Math.abs(p.x) < r + 0.05 && p.y > 11.5) p.x -= 0.01;
          return false;
        } },
      };
      const { actor, pad } = bound(await resident(), freeze(env), freeze(padAt()));
      const player = freeze(playerAt()), snapshot = JSON.stringify({ player, pad });
      actor.wait = 0;
      actor.update(0.2, env, player, false);
      assert.equal(actor.state, 'Walk');
      blocked = true;
      let sawReverse = false;
      for (let i = 0; i < Math.ceil(10 / dt); i++) {
        actor.update(dt, env, player, false);
        assert.ok(actor.pos.x < 0, `tunneled through ${blocker}: x=${actor.pos.x}`);
        near(actor.pos.y, 10);
        if (actor.next === 0) { sawReverse = true; break; }
      }
      assert.equal(sawReverse, true);
      assert.equal(actor.state, 'Idle'); near(actor.wait, 1.2);
      const stopped = actor.pos.clone();
      actor.update(0.4, env, player, false);
      assert.ok(actor.pos.equals(stopped), 'blocked patrol pauses before reversing');
      actor.update(0.81, env, player, false);
      actor.update(0.2, env, player, false);
      assert.ok(actor.pos.x < stopped.x, 'patrol must retreat, not repeatedly push into the blocker');
      assert.equal(JSON.stringify({ player, pad }), snapshot);
    });
  }
}

test('reaching a resident stops patrol, faces the player, blends to Idle, then resumes after departure', async () => {
  const { actor, env, pad } = bound(await resident());
  const player = freeze(new THREE.Vector3(-4, 10.82, 0.35));
  const snapshot = JSON.stringify({ player, pad });
  actor.wait = 0;
  actor.update(0.5, env, player, false);
  assert.equal(actor.state, 'Walk');
  const stopped = actor.pos.clone();
  for (let i = 0; i < 30; i++) actor.update(1 / 60, env, player, true);
  assert.ok(actor.pos.equals(stopped)); assert.equal(actor.state, 'Idle');
  near(weight(actor, 'Idle'), 1); near(weight(actor, 'Walk'), 0);
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.group.quaternion);
  const toward = new THREE.Vector3(player.x - actor.pos.x, 0, player.z - actor.pos.z).normalize();
  assert.ok(facing.dot(toward) > 0.999);
  near(actor.wait, 0.8);
  actor.update(0.4, env, player, false); assert.ok(actor.pos.equals(stopped));
  actor.update(0.41, env, player, false); assert.ok(actor.pos.equals(stopped));
  actor.update(0.1, env, player, false);
  assert.ok(actor.pos.x > stopped.x); assert.equal(actor.state, 'Walk');
  assert.equal(JSON.stringify({ player, pad }), snapshot);
});

test('manager reach and dialogue drive a real resident, then patrol resumes beyond actual reach', async () => {
  const { actor, env } = bound(await resident());
  const { npcs, flight, landing } = manager([actor], env, new THREE.Vector3(-10, 10, 0.35));
  actor.wait = 0;
  npcs.update(0.4);
  assert.equal(actor.state, 'Walk');
  flight.pos.set(actor.pos.x - 1, 10.82, actor.pos.z);
  landing.walk.pos.set(flight.pos.x, 10, flight.pos.z);
  const stopped = actor.pos.clone();
  assert.equal(npcs.inReach(actor.pad), true);
  npcs.update(0.3);
  assert.ok(actor.pos.equals(stopped)); assert.equal(actor.state, 'Idle');
  npcs.facePlayer(actor.pad);
  const time = actor.mixer.time;
  npcs.animateDialogue(0.5);
  near(actor.mixer.time, time + 0.5); assert.ok(actor.pos.equals(stopped));
  near(weight(actor, 'Idle'), 1);
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.group.quaternion);
  near(facing.x, -1); near(facing.z, 0);
  flight.pos.x = -10; landing.walk.pos.x = -10;
  assert.equal(npcs.inReach(actor.pad), false);
  npcs.update(0.81); npcs.update(0.1);
  assert.equal(actor.state, 'Walk'); assert.ok(actor.pos.x > stopped.x);
});

test('face at coincident position is safe and turning is limited by dt', async () => {
  const actor = await resident(), initial = actor.group.quaternion.clone();
  actor.face(actor.pos, 1);
  assert.ok(actor.group.quaternion.equals(initial));
  actor.face(new THREE.Vector3(5, 0, 0), 0.01);
  near(initial.angleTo(actor.group.quaternion), 0.07);
});

test('missing pad disables and freezes an existing resident; rebinding restores patrol', async () => {
  const { actor, env } = bound(await resident());
  actor.wait = 0; actor.update(0.5, env, playerAt(), false);
  actor.bind(env, undefined);
  const before = actor.pos.clone(), time = actor.mixer.time;
  assert.equal(actor.active, false); assert.equal(actor.group.visible, false);
  actor.update(5, env, playerAt(), true);
  assert.ok(actor.pos.equals(before)); near(actor.mixer.time, time);
  bound(actor, env);
  assert.equal(actor.state, 'Idle'); near(actor.wait, 0.8);
  assert.deepEqual(actor.pos.toArray(), [actor.route[0].x, actor.route[0].y, actor.route[0].z]);
});

test('residents at or beyond 180 m are hidden and completely frozen, then resume when near', async () => {
  const { actor, env } = bound(await resident());
  actor.wait = 0; actor.update(0.2, env, playerAt(), false);
  const pos = actor.pos.clone(), quat = actor.group.quaternion.clone(), time = actor.mixer.time, wait = actor.wait;
  for (const distance of [180, 181, 1000]) {
    actor.update(2, env, actor.pos.clone().add(new THREE.Vector3(distance, 0, 0)), false);
    assert.equal(actor.group.visible, false); assert.ok(actor.pos.equals(pos));
    assert.ok(actor.group.quaternion.equals(quat)); near(actor.mixer.time, time); near(actor.wait, wait);
  }
  actor.update(0.1, env, actor.pos.clone().add(new THREE.Vector3(179, 0, 0)), false);
  assert.equal(actor.group.visible, true); assert.ok(actor.pos.x > pos.x);
  near(actor.mixer.time, time + 0.1);
});

for (const missing of ['model', 'Idle', 'Walk']) {
  test(`missing ${missing} fails safely during manager loading with no interactive placeholder`, async (t) => {
    const gltf = await source(RESIDENTS[0]), errors = [], toasts = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => {
      if (missing === 'model') throw new Error('synthetic missing asset');
      return { scene: clone(gltf.scene), animations: gltf.animations.filter((clip) => clip.name !== missing) };
    });
    const game = { pipeline: { overlay: new THREE.Group() }, flight: flat(), gameplay: { landing: { landed: true } }, toast: (message) => toasts.push(message) };
    const npcs = new DeliveryNPCs(game);
    npcs.setPads(RESIDENTS.map((spec) => padAt(spec.padId)));
    await npcs.ready;
    assert.equal(errors.length, 3); assert.equal(toasts.length, 3);
    assert.equal(npcs.actors.length, 0); assert.equal(npcs.group.children.length, 0);
    assert.equal(npcs.nearby(), null);
    for (const pad of npcs.pads) {
      assert.equal(npcs.inReach(pad), false);
      npcs.facePlayer(pad); assert.ok(!npcs.talking);
    }
    assert.doesNotThrow(() => npcs.animateDialogue(1));
    if (missing !== 'model') assert.ok(errors.every((args) => args.at(-1).message.includes(missing)));
  });
}

test('reach uses the actual actor instead of a nearby stale pad, in either direction', () => {
  const pad = freeze(padAt()), actor = actorStub(pad, new THREE.Vector3(10, 10, 0));
  const { npcs, flight, landing } = manager([actor]);
  assert.equal(npcs.inReach(pad), false); assert.equal(npcs.nearby(), null);
  flight.pos.x = 9; landing.walk.pos.x = 9;
  assert.equal(npcs.inReach(pad), true); assert.equal(npcs.nearby(), pad);
  assert.equal(pad.pos.x, 0);
});

for (const [name, change] of [
  ['exactly 3 m away', ({ actor }) => { actor.pos.x = 3; }],
  ['different floor above', ({ actor }) => { actor.pos.y = 11.21; }],
  ['different floor below', ({ actor }) => { actor.pos.y = 8.79; }],
  ['airborne/unlanded', ({ landing }) => { landing.landed = false; }],
  ['inactive actor', ({ actor }) => { actor.active = false; }],
  ['unloaded actor', ({ npcs }) => { npcs.actors = []; }],
]) {
  test(`manager refuses ${name} through inReach and nearby`, () => {
    const actor = actorStub(), fixture = { ...manager([actor]), actor };
    assert.equal(fixture.npcs.inReach(actor.pad), true);
    change(fixture);
    assert.equal(fixture.npcs.inReach(actor.pad), false);
    assert.equal(fixture.npcs.nearby(), null);
  });
}

test('reach uses walked feet, with flight/rest fallback only when walking is absent', () => {
  const actor = actorStub(), { npcs, landing, flight } = manager([actor]);
  flight.pos.set(100, 110, 100);
  assert.equal(npcs.inReach(actor.pad), true);
  landing.walk = null;
  assert.equal(npcs.inReach(actor.pad), false);
  flight.pos.set(0, 10.82, 0);
  assert.equal(npcs.inReach(actor.pad), true);
  landing.landed = false;
  assert.equal(npcs.inReach(actor.pad), false);
});

for (const [name, obstruction] of [
  ['height-field wall', { solid: { heightAt: (x) => Math.abs(x - 1) < 0.11 ? 12 : -Infinity } }],
  ['thin body collider', { solid: { heightAt: () => -Infinity, collide: (p, r) => Math.abs(p.x - 1) < r + 0.01 } }],
  ['head-height prop', { props: { collide: (p, r) => Math.abs(p.x - 1) < r + 0.01 && p.y + r > 11.5 } }],
  ['vertical probe displacement with false return', { props: { collide(p) { if (Math.abs(p.x - 1) < 0.11) p.y += 0.01; return false; } } }],
]) {
  test(`interaction is blocked by ${name} without mutating world/player/pad`, () => {
    const actor = actorStub(freeze(padAt())), env = freeze({ ...flat(), ...obstruction });
    const { npcs, flight, landing } = manager([actor], env);
    freeze(flight); freeze(landing);
    const before = JSON.stringify({ flight, landing, pad: actor.pad, pos: actor.pos });
    assert.equal(npcs.inReach(actor.pad), false); assert.equal(npcs.nearby(), null);
    assert.equal(JSON.stringify({ flight, landing, pad: actor.pad, pos: actor.pos }), before);
  });
}

test('interaction whole-body clearance includes the top of the standing capsule', () => {
  const actor = actorStub();
  const env = { ...flat(), props: { collide: (p, r) => Math.abs(p.x - 1) < r + 0.01 && p.y + r > 11.85 } };
  assert.equal(probeGround(env, 1, 0).ok, false, 'obstacle blocks the actual standing body');
  const { npcs } = manager([actor], env);
  assert.equal(npcs.inReach(actor.pad), false, 'conversation must not pass a head-level whole-body blocker');
});

test('nearby sorts by actor distance rather than pad distance and skips blocked/inactive actors', () => {
  const far = actorStub(padAt('far', 0), new THREE.Vector3(2.5, 10, 0));
  const close = actorStub(padAt('close', 100), new THREE.Vector3(1, 10, 0));
  const inactive = actorStub(padAt('inactive'), new THREE.Vector3(0, 10, 0)); inactive.active = false;
  const actors = [far, close, inactive], originalOrder = [...actors], { npcs } = manager(actors);
  assert.equal(npcs.nearby(), close.pad);
  assert.deepEqual(npcs.actors, originalOrder, 'sorting nearby results must not reorder actors');
  close.active = false;
  assert.equal(npcs.nearby(), far.pad);
});

test('facePlayer and animateDialogue affect only the selected loaded actor', () => {
  const a = actorStub(), b = actorStub(padAt('other')), { npcs, flight } = manager([a, b]);
  npcs.facePlayer(a.pad); npcs.animateDialogue(0.2);
  assert.equal(npcs.talking, a); assert.deepEqual(a.calls.transitions, ['Idle']);
  assert.deepEqual(a.calls.faces, [{ point: flight.pos, dt: 1 }]);
  near(a.calls.time, 0.2); near(b.calls.time, 0);
  a.active = false;
  npcs.facePlayer(a.pad); npcs.animateDialogue(1);
  assert.ok(!npcs.talking); near(a.calls.time, 0.2);
  npcs.facePlayer(padAt('not-loaded')); npcs.animateDialogue(1);
  assert.ok(!npcs.talking); assert.equal(npcs.inReach(null), false);
});

test('manager update passes real reach to actors and setPads clears stale dialogue/bindings', async () => {
  const a = actorStub(), { npcs, flight } = manager([a]);
  npcs.update(0.1);
  assert.deepEqual(a.calls.updates, [[0.1, flight, flight.pos, true]]);
  const real = await resident();
  npcs.actors = [real]; npcs.talking = real;
  const pad = padAt(real.spec.padId, 20);
  npcs.setPads([pad]);
  assert.equal(npcs.talking, null); assert.equal(real.pad, pad); assert.equal(real.active, true);
  npcs.setPads([]);
  assert.equal(real.active, false); assert.equal(npcs.actorFor(pad), undefined); assert.equal(npcs.nearby(), null);
});

function courierFixture() {
  const pickup = padAt(FIRST_ORDER.pickup), destination = padAt(FIRST_ORDER.destination, 90), wizard = padAt(RESIDENTS[2].padId, 180);
  const actors = [actorStub(pickup, new THREE.Vector3(0, 10, 0)), actorStub(destination, new THREE.Vector3(90, 10, 0), 'villager'), actorStub(wizard, new THREE.Vector3(180, 10, 0), 'wizard')];
  const fixture = manager(actors), messages = [], writes = [], cards = [];
  const store = { get: (key, fallback) => fallback, set: (key, value) => writes.push({ key, value: structuredClone(value) }) };
  Object.assign(fixture.game, { fx: { sprites: { spawn() {} }, burst() {} }, rider: { sunVis: 1 } });
  const hud = { job() {}, jobAt() {}, order() {}, card: (...args) => cards.push(args) };
  const courier = new Courier(fixture.game, store, hud);
  courier.setPads([pickup, destination, wizard]);
  courier.npcs = fixture.npcs;
  courier.dialogue = { show: (...args) => { messages.push(args); return true; } };
  function movePlayer(x, y = 10) { fixture.landing.walk.pos.set(x, y, 0); fixture.flight.pos.set(x, y + 0.82, 0); }
  return { ...fixture, actors, courier, pickup, destination, wizard, messages, writes, cards, movePlayer };
}

test('wizard dialogue never offers/accepts/delivers an order or changes progress/rewards', () => {
  const { courier, wizard, movePlayer, messages, writes, actors, npcs } = courierFixture();
  movePlayer(180);
  for (const status of ['available', 'active', 'completed']) {
    courier.quest.status = status;
    const before = JSON.stringify({ status, progress: courier.quest.progress, coins: courier.quest.coins });
    assert.equal(courier.interact(), true);
    assert.equal(messages.at(-1)[0], actors[2].spec.name);
    assert.equal(messages.at(-1)[2], undefined, 'wizard must not offer an order action');
    assert.equal(courier.accept(wizard), false); assert.equal(courier.deliver(wizard), false);
    assert.equal(JSON.stringify({ status: courier.quest.status, progress: courier.quest.progress, coins: courier.quest.coins }), before);
    assert.equal(npcs.talking, actors[2]);
  }
  assert.deepEqual(writes, []);
});

test('Courier accepts near a moved shopkeeper, not its stale pad; missing actor cannot accept', () => {
  const { courier, pickup, actors, movePlayer } = courierFixture();
  actors[0].pos.x = 12;
  assert.equal(courier.accept(pickup), false);
  movePlayer(12); actors[0].active = false;
  assert.equal(courier.accept(pickup), false);
  actors[0].active = true;
  assert.equal(courier.interact(), true);
  assert.equal(courier.accept(pickup), true);
  assert.equal(courier.quest.status, 'active'); assert.equal(pickup.pos.x, 0);
});

test('Courier delivery and stale dialogue callbacks recheck the moved recipient distance', () => {
  const { courier, pickup, destination, actors, movePlayer, messages, flight } = courierFixture();
  assert.equal(courier.accept(pickup), true); courier.quest.learn('fly');
  actors[1].pos.x = 100;
  movePlayer(90);
  assert.equal(courier.deliver(destination), false);
  movePlayer(100);
  assert.equal(courier.interact(), true);
  const confirm = messages.at(-1)[2][0].run;
  actors[1].pos.x = 108;
  assert.equal(confirm(), false, 'NPC moving away while dialogue is open must invalidate delivery');
  assert.equal(courier.quest.coins, 0);
  movePlayer(108);
  assert.equal(confirm(), true); assert.equal(courier.quest.coins, FIRST_ORDER.reward);
  assert.equal(courier.count, 1); assert.equal(flight.gust, 1);
  assert.equal(confirm(), false); assert.equal(destination.pos.x, 90);
});

for (const reason of ['airborne', 'wrong floor', 'wall', 'unloaded', 'paused']) {
  test(`Courier blocks interaction when ${reason}`, () => {
    const f = courierFixture(), { courier, pickup, destination, movePlayer, landing, game, npcs } = f;
    assert.equal(courier.accept(pickup), true); courier.quest.learn('fly'); movePlayer(92);
    if (reason === 'airborne') landing.landed = false;
    if (reason === 'wrong floor') movePlayer(92, 6);
    if (reason === 'wall') game.flight.solid = { heightAt: (x) => Math.abs(x - 91) < 0.11 ? 20 : -Infinity };
    if (reason === 'unloaded') npcs.actors = [];
    if (reason === 'paused') game.paused = true;
    assert.equal(courier.interact(), false);
    if (reason !== 'paused') {
      assert.equal(courier.deliver(destination), false);
      assert.equal(courier.quest.coins, 0);
    }
  });
}
