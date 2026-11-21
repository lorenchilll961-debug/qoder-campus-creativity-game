import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Resolve the same vendored three.js used by index.html, without installing dependencies or
// changing package.json/import maps. Everything below runs in Node, with no browser/WebGL.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('../../vendor/three/build/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL(`../../vendor/three/examples/jsm/${specifier.slice(13)}`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const THREE = await import('three');
const { Landing, LAND } = await import('./landing.js');
const { Gameplay } = await import('./index.js');
const { Flight } = await import('../player/flight.js');
const { ChaseCamera } = await import('../player/camera.js');
const { Rider, standLegWeight } = await import('../player/rider.js');
const { Input } = await import('../player/input.js');
const { groundAnchor } = await import('./ground.js');
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const idle = { turn: 0, pitch: 0, boost: false, brake: false, walkX: 0, walkZ: 0 };

globalThis.document = { getElementById: () => null, addEventListener() {} };
globalThis.location = { search: '', hostname: 'unit.test' };

function fixture(pads = []) {
  const terrain = { heightAt: () => 10, raycast: () => -1, normalAt: (x, z, out) => out.set(0, 1, 0) };
  const flight = new Flight(terrain);
  flight.pos.set(0, 30, 0); flight.vel.set(0, 0, -20); flight.speed = 20;
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 16, 6);
  const messages = [], pressed = new Set();
  const g = { state: 'play', terrain, flight, camera, chase: new ChaseCamera(camera, flight),
    rider: { standing: {}, seat: {}, off: {}, sunVis: 1, restHeight: () => 0.5 },
    fx: { sunTint: () => [1, 1, 1], sprites: { spawn() {} }, burst() {}, env: { surface: () => 10 } },
    world: new THREE.Group(), pipeline: { overlay: new THREE.Group() },
    town: { pads, heightAt: () => -1e9 }, input: { take: (key) => pressed.delete(key) }, toast: (s) => messages.push(s) };
  const gameplay = new Gameplay(g);
  g.gameplay = gameplay;
  return { g, L: gameplay.landing, gameplay, pressed, messages };
}
function tick(g, L, ctl = idle, dt = 1 / 60) {
  L.update(dt, ctl);
  g.flight.update(dt, ctl, 0);
}
function until(g, L, state) {
  let n = 0;
  while (L.state !== state && n++ < 6000) tick(g, L);
  assert.equal(L.state, state, `stuck in ${L.state}`);
}
function pad() {
  return Object.freeze({ id: 'delivery', name: '塔顶', pos: Object.freeze({ x: 0, y: 10, z: 0 }), radius: 2, yaw: 0, approach: 0, town: 'test', ground: true });
}

test('ordinary landing completes the existing approach, settle and dismount without delivery', () => {
  const { g, L, gameplay } = fixture([pad()]);
  const start = g.flight.pos.clone(); let arrivals = 0;
  gameplay.courier.arrive = () => arrivals++;
  assert.equal(g.landGround().ok, true);
  assert.equal(L.state, 'approach');
  assert.ok(g.flight.pos.equals(start), 'begin must not teleport');
  until(g, L, 'landed');
  assert.equal(arrivals, 0);
  assert.equal(L.pad.kind, 'ground');
  near(g.flight.pos.y, 10.82);
  assert.equal(g.rider.off.on, true);
  assert.equal(g.chase.walkView.on, true);
});

test('model, water, support, slope and overhead failures are structured, Chinese, and do not move flight', () => {
  for (const [code, setup] of [
    ['model', (g) => { g.rider.standing = null; }],
    ['water', (g) => { g.terrain.heightAt = () => -1; }],
    ['support', (g) => { g.terrain.heightAt = () => NaN; }],
    ['slope', (g) => { g.terrain.heightAt = (x) => 10 + x * 0.75; }],
    ['below', (g) => { g.flight.solid = { heightAt: () => 40 }; }],
    ['clearance', (g) => { g.flight.props = { collide: (p) => { p.y += 1; return false; } }; }],
  ]) {
    const { g, L, messages } = fixture(); const before = g.flight.pos.clone(); setup(g);
    const result = g.landGround();
    assert.equal(result.code, code);
    assert.equal(result.ok, false);
    assert.match(result.why, /[\u4e00-\u9fff]/);
    assert.equal(messages.at(-1), result.why);
    assert.equal(L.state, 'fly');
    assert.ok(g.flight.pos.equals(before));
  }
});

test('ground floor never takes the special-pad wall exemption', () => {
  const { g, L } = fixture(); g.flight.solid = { heightAt: () => 30 };
  const special = pad(), ground = groundAnchor(special.pos, 0);
  assert.equal(L._floor(special, 0, 0), 10);
  assert.equal(L._floor(ground, 0, 0), 30);
});

test('G, no-zone double Space and single Space takeoff work with zero open pads', () => {
  for (const key of ['KeyG', 'Space2']) {
    const { g, L, gameplay, pressed } = fixture();
    pressed.add(key); gameplay.update(1 / 60, idle);
    assert.equal(L.state, 'approach');
    // Rebinding an empty town must not abort a private ground anchor.
    gameplay._bind(); assert.equal(L.state, 'approach');
    until(g, L, 'landed');
    pressed.add('Space'); gameplay.update(1 / 60, idle);
    assert.equal(L.state, 'mount');
    until(g, L, 'fly');
    assert.equal(g.flight.auto, null);
  }
});

test('double Space keeps the authored pad and notifies arrival once without automatic delivery', () => {
  const special = pad(), { g, L, gameplay, pressed } = fixture([special]);
  let arrivals = 0;
  const arrive = gameplay.courier.arrive.bind(gameplay.courier);
  gameplay.courier.arrive = (p) => { arrivals++; return arrive(p); };
  pressed.add('Space2'); gameplay.update(1 / 60, idle);
  assert.equal(L.pad, special);
  assert.equal(arrivals, 0);
  until(g, L, 'dismount');
  while (L.t < LAND.T_TOUCH - 1 / 60) tick(g, L);
  assert.equal(arrivals, 0);
  until(g, L, 'landed');
  for (let i = 0; i < 120; i++) tick(g, L, { ...idle, walkX: 1 });
  assert.equal(arrivals, 1);
  assert.equal(gameplay.courier.count, 0);
  assert.equal(gameplay.courier.quest.status, 'available');
  assert.equal(special.pos.x, 0);
});

test('walking has stable camera-relative axes; departure mounts at current feet, never original pad', () => {
  const special = pad(), snapshot = JSON.stringify(special);
  const { g, L } = fixture([special]);
  assert.equal(L.begin(special), true); until(g, L, 'landed');
  for (let i = 0; i < 180; i++) tick(g, L, { ...idle, walkX: 1 });
  near(g.flight.pos.x, 6.6); near(g.flight.pos.z, 0); // facing changes, movement frame does not
  near(g.chase.walkView.yaw, 0);
  const before = g.flight.pos.clone();
  assert.equal(L.takeoff(), true);
  assert.equal(L.departPad.kind, 'ground');
  near(L.departPad.pos.x, before.x); near(L.departPad.pos.z, before.z);
  for (let i = 0; i < 30; i++) {
    tick(g, L);
    near(g.flight.pos.x, before.x); near(g.flight.pos.z, before.z);
  }
  until(g, L, 'launch');
  near(L.dep.x, before.x); near(L.dep.z, before.z);
  assert.equal(JSON.stringify(special), snapshot);
  assert.equal(L.pad, special);
});

test('takeoff revalidates standing support and new obstructions, leaving the rider landed', () => {
  const { g, L, messages } = fixture();
  assert.equal(L.beginGround().ok, true); until(g, L, 'landed');
  g.flight.props = { collide(p) { p.y += 0.1; return false; } };
  const before = g.flight.pos.clone();
  assert.equal(L.takeoff(), false);
  assert.equal(L.state, 'landed'); assert.ok(g.flight.pos.equals(before));
  assert.match(messages.at(-1), /净空/);
});

test('departure finds a different clear heading when a nearby prop blocks the facing direction', () => {
  const { g, L } = fixture();
  assert.equal(L.beginGround().ok, true); until(g, L, 'landed');
  // Beyond the standing capsule, but in the broom's forward sweep.
  g.flight.props = { collide(p, r) { if (Math.hypot(p.x, p.z + 2) < r + 0.3) { p.x += 1; return false; } return false; } };
  assert.equal(L.takeoff(), true);
  assert.ok(Math.abs(L.out) > 0.1);
});

test('mounting also reserves room for the hop above standing head height', () => {
  const { g, L } = fixture();
  assert.equal(L.beginGround().ok, true); until(g, L, 'landed');
  g.flight.props = { collide(p) { if (p.y > 12.15) p.y += 1; return false; } };
  assert.equal(L.takeoff(), false);
  assert.equal(L.state, 'landed');
  assert.equal(L.lastFailure.code, 'clearance');
});

test('newly streamed support or path obstacles cancel ordinary approach without teleporting', () => {
  for (const atTarget of [false, true]) {
    const { g, L } = fixture();
    assert.equal(L.beginGround().ok, true);
    const before = g.flight.pos.clone();
    if (atTarget) g.flight.solid = { heightAt: () => 40 };
    else g.flight.props = { collide(p) { if (p.y > 25) p.x += 2; return false; } };
    L.update(1 / 60, idle);
    if (L.busy) L._step(1 / 60, 0, g.flight);
    assert.equal(L.state, 'fly');
    assert.ok(g.flight.pos.equals(before));
    assert.ok(L.lastFailure);
  }
});

test('authored-pad landing/takeoff still works without the optional standing model', () => {
  const special = pad(), { g, L } = fixture([special]); g.rider.standing = null;
  assert.equal(L.begin(special), true); until(g, L, 'landed');
  assert.equal(L.stand, false); assert.equal(L.walk, null);
  assert.equal(L.takeoff(), true); until(g, L, 'fly');
  assert.equal(L.departPad, null);
});

test('walking camera changes only on look input and continues to call wall unblocking', () => {
  const { g } = fixture(); const C = g.chase, focus = new THREE.Vector3(0, 11.15, 0);
  C.startWalk(focus); const heading = C.walkView.yaw;
  let calls = 0; const unblock = C._unblock.bind(C);
  C._unblock = (...args) => { calls++; return unblock(...args); };
  for (let i = 0; i < 10; i++) { g.flight.yaw += 0.4; C.update(1 / 60, 0, () => 10); }
  near(C.walkView.yaw, heading);
  near(C.lookWalk(0.3, 0.2), heading + 0.3);
  assert.ok(calls >= 20);
});

test('walking keyboard/gamepad axes ignore flight inversion and mouse steering', () => {
  const handlers = new Map();
  globalThis.window = { addEventListener: (event, fn) => handlers.set(event, fn) };
  const input = new Input({ addEventListener() {} });
  input.enabled = true; input.walking = true; input.locked = true; input.invert = true;
  input.keys.add('KeyW'); input.keys.add('ShiftLeft');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });
  handlers.get('mousemove')({ movementX: 100, movementY: 80 });
  input.update(1 / 60);
  assert.equal(input.walkZ, -1); assert.equal(input.walkX, 0); assert.equal(input.walkFast, true);
  assert.ok(input.lookX > 0 && input.lookY > 0); assert.equal(input.stickX, 0);
  input.keys.clear();
  navigator.getGamepads = () => [{ connected: true, axes: [1, -1, 0, 0], buttons: [] }];
  input.update(1 / 60);
  assert.equal(input.walkX, 1); assert.equal(input.walkZ, -1); assert.equal(input.lookX, 0);
});

test('standing GLB leg masks are bilateral and exclude the held broom and upper body', () => {
  const info = JSON.parse(readFileSync(new URL('../../assets/models/rider_stand.json', import.meta.url)));
  const glb = readFileSync(new URL('../../assets/models/rider_stand.glb', import.meta.url));
  const jsonSize = glb.readUInt32LE(12), doc = JSON.parse(glb.toString('utf8', 20, 20 + jsonSize));
  assert.equal(doc.skins?.length || 0, 0);
  assert.equal(doc.meshes.length, 1);
  const a = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION], view = doc.bufferViews[a.bufferView];
  const base = 20 + jsonSize + 8 + (view.byteOffset || 0) + (a.byteOffset || 0), stride = view.byteStride || 12;
  let left = 0, right = 0;
  for (let i = 0; i < a.count; i++) {
    const x = glb.readFloatLE(base + i * stride), y = glb.readFloatLE(base + i * stride + 4), z = glb.readFloatLE(base + i * stride + 8);
    const w = standLegWeight(x, y, z, info);
    if (w < -0.1) left++;
    if (w > 0.1) right++;
    if (y > info.height * 0.35 || Math.hypot(x - info.broomBase[0], z - info.broomBase[2]) < 0.115 * info.height) assert.equal(Math.abs(w), 0);
  }
  assert.ok(left > 100 && right > 100, `${left}/${right} vertices`);
});

test('single-mesh leg vertices deform oppositely, held broom stays fixed, idle resets exactly', () => {
  const rider = new Rider(null, new THREE.Group(), { lanternPivot: [0, 0, 0] });
  const model = new THREE.Group(), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.116, 0.1, 0, 0.116, 0.1, 0, -0.3671, 0, -0.0217, 0, 1.6087, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); model.add(mesh);
  const info = { height: 1.6087, broomBase: [-0.3671, 0, -0.0217] };
  const S = rider.setStand(model, info), base = mesh.geometry.attributes.position.array.slice();
  rider._gait(S, 1, Math.PI / 2);
  const p = mesh.geometry.attributes.position.array;
  assert.ok(p[2] * p[5] < 0);
  assert.deepEqual([...p.slice(6)], [...base.slice(6)]);
  rider._gait(S, 0, 0);
  assert.deepEqual([...p], [...base]);
});
