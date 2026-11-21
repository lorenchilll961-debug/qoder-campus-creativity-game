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
const { Rider } = await import('../player/rider.js');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { Input } = await import('../player/input.js');
const { groundAnchor, WALK, JUMP } = await import('./ground.js');
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
    rider: { standing: {}, seat: {}, off: {}, sunVis: 1, restHeight: () => 0.5, async loadStand() {} },
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

test('G or airborne Space2 lands; walking Space jumps, Space2 cannot take off, and G mounts after touchdown', () => {
  for (const key of ['KeyG', 'Space2']) {
    const { g, L, gameplay, pressed } = fixture();
    pressed.add(key); gameplay.update(1 / 60, idle);
    assert.equal(L.state, 'approach');
    // Rebinding an empty town must not abort a private ground anchor.
    gameplay._bind(); assert.equal(L.state, 'approach');
    until(g, L, 'landed');
    pressed.add('Space2'); gameplay.update(1 / 60, idle);
    assert.equal(L.state, 'landed');
    assert.equal(L.walk.jump.on, false);
    // Input may emit both events for the second tap; that is still a jump, not a mount.
    pressed.add('Space'); pressed.add('Space2'); gameplay.update(1 / 60, idle);
    assert.equal(L.state, 'landed');
    assert.equal(L.walk.jump.on, true);
    assert.equal(g.rider.airborne, true);
    let frames = 0;
    while (L.walk.jump.on && frames++ < 120) tick(g, L);
    assert.equal(L.walk.jump.on, false, 'jump must return to the floor');
    assert.equal(g.rider.airborne, false);
    pressed.add('KeyG'); gameplay.update(1 / 60, idle);
    assert.equal(L.state, 'mount');
    until(g, L, 'fly');
    assert.equal(g.flight.auto, null);
  }
});

test('double Space in a zone keeps the authored pad and delivers only once at touchdown', () => {
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
  assert.equal(gameplay.courier.count, 1);
  assert.equal(special.pos.x, 0);
});

test('walking has stable camera-relative axes; departure mounts at current feet, never original pad', () => {
  const special = pad(), snapshot = JSON.stringify(special);
  const { g, L } = fixture([special]);
  assert.equal(L.begin(special), true); until(g, L, 'landed');
  for (let i = 0; i < 180; i++) tick(g, L, { ...idle, walkX: 1 });
  assert.ok(g.flight.pos.x > 3 && g.flight.pos.x < 3.6, `three-second walk: ${g.flight.pos.x}m`);
  near(g.rider.walkSpeed, 1.2, 0.001);
  near(g.flight.pos.z, 0); // acceleration and facing change, but the camera's movement frame does not
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

test('Gameplay exposes standReady while the fixture loads no model over the network', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('headless fixture must not fetch assets'));
  const { gameplay } = fixture();
  assert.ok(gameplay.standReady instanceof Promise);
  assert.equal(await gameplay.standReady, undefined);
});

test('airborne jumps reject another jump and G takeoff without resetting height or velocity', () => {
  const { g, L, gameplay, pressed, messages } = fixture();
  assert.equal(L.jump(), false, 'flight is not a standing jump');
  assert.equal(L.beginGround().ok, true); until(g, L, 'landed');
  assert.equal(L.jump(), true);
  near(L.walk.jump.velocity, 5.2);
  tick(g, L, idle, 0.1);
  near(L.walk.jump.y, 10 + 5.2 * 0.1 - 16 * 0.1 ** 2 / 2);
  near(L.walk.jump.velocity, 5.2 - 16 * 0.1);
  const jump = { ...L.walk.jump }, pos = g.flight.pos.clone();
  assert.equal(L.jump(), false);
  assert.equal(L.takeoff(), false);
  assert.equal(L.lastFailure.code, 'airborne');
  assert.match(messages.at(-1), /落地/);
  for (const key of ['Space', 'Space2', 'KeyG']) {
    pressed.add(key); gameplay.update(1 / 60, idle);
    assert.equal(L.state, 'landed');
    assert.deepEqual(L.walk.jump, jump);
    assert.ok(g.flight.pos.equals(pos));
    assert.equal(g.rider.airborne, true);
    assert.equal(g.chase.walkView.on, true);
    assert.equal(g.input.walking, true);
  }
});

test('jump follows the 5.2m/s, 16m/s² arc and keeps feet/off.y aligned through touchdown at 30/144fps', () => {
  near(JUMP.speed, 5.2); near(JUMP.gravity, 16);
  for (const fps of [30, 144]) {
    const { g, L } = fixture();
    assert.equal(L.beginGround().ok, true); until(g, L, 'landed');
    assert.equal(L.jump(), true);
    let peak = 10, sawFalling = false;
    for (let i = 1; i <= fps; i++) {
      tick(g, L, idle, 1 / fps);
      const j = L.walk.jump, feet = j.on ? j.y : L.walk.pos.y;
      peak = Math.max(peak, feet);
      sawFalling ||= j.velocity < 0;
      near(L.walk.pos.y, 10, 1e-7); // ground support is not overwritten by the jumping feet
      near(g.flight.pos.y + g.rider.off.y, feet);
      near(L.focus.y, feet + 1.15);
      near(L.spot.y, feet + L.rest);
      assert.equal(g.rider.airborne, j.on);
      assert.equal(g.rider.off.on, true);
      if (j.on) near(j.y, 10 + 5.2 * (i / fps) - 8 * (i / fps) ** 2, 1e-6);
    }
    assert.ok(peak > 10.83 && peak <= 10.846, `${fps}fps peak: ${peak}`);
    assert.ok(sawFalling);
    assert.deepEqual(L.walk.jump, { y: 10, velocity: 0, on: false });
    near(g.flight.pos.y + g.rider.off.y, 10);
    assert.equal(L.jump(), true, 'touchdown must permit the next jump');
  }
});

test('jump head sweep hits a low ceiling without tunnelling and returns to its original floor', () => {
  for (const fps of [30, 144]) {
    const { g, L } = fixture();
    assert.equal(L.beginGround().ok, true); until(g, L, 'landed');
    const ceiling = 12.45;
    let collisions = 0, peak = 10;
    // A thin ceiling is a prop, not a heightfield that would replace the standing support.
    g.flight.props = { collide(p, radius) {
      if (p.y + radius > ceiling) { collisions++; p.y = ceiling - radius; }
      return false; // displacement-only colliders must still block the head
    } };
    assert.equal(L.jump(), true);
    for (let i = 0; i < fps; i++) {
      tick(g, L, idle, 1 / fps);
      const feet = L.walk.jump.on ? L.walk.jump.y : L.walk.pos.y;
      peak = Math.max(peak, feet);
      assert.ok(feet + WALK.height <= ceiling + 1e-7, `${fps}fps head crossed ceiling: ${feet + WALK.height}`);
      near(g.flight.pos.y + g.rider.off.y, feet);
    }
    assert.ok(collisions > 0);
    assert.ok(peak > 10.2 && peak <= ceiling - WALK.height);
    assert.deepEqual(L.walk.jump, { y: 10, velocity: 0, on: false });
    assert.equal(g.rider.airborne, false);
  }
});

test('abort clears running, airborne, walking camera and off-broom pose state', () => {
  const { g, L } = fixture();
  assert.equal(L.beginGround().ok, true); until(g, L, 'landed');
  for (let i = 0; i < 60; i++) tick(g, L, { ...idle, walkZ: -1, walkFast: true });
  assert.equal(g.rider.walkFast, true);
  assert.equal(L.jump(), true); tick(g, L, { ...idle, walkZ: -1, walkFast: true });
  assert.equal(g.rider.airborne, true);
  assert.equal(g.input.walking, true);
  L.abort();
  assert.equal(L.state, 'fly');
  assert.equal(g.flight.auto, null);
  for (const name of ['walk', 'departPad', 'pad', 'path', 'dep']) assert.equal(L[name], null, name);
  assert.equal(g.rider.airborne, false); assert.equal(g.rider.walkFast, false);
  near(g.rider.walkSpeed, 0);
  assert.deepEqual(g.rider.off, { on: false, y: 0, sy: 1 });
  near(g.rider.seat.hop, 0); near(g.rider.seat.sy, 1); near(g.rider.seat.calm, 0);
  assert.equal(g.input.walking, false);
  assert.equal(g.chase.walkView.on, false);
  assert.equal(L.jump(), false);
});

test('walking accelerates, slows for a smooth turn instead of snapping, and brakes gradually', () => {
  near(WALK.speed, 1.2); near(WALK.fast, 2.8);
  for (const fps of [30, 144]) {
    const { g, L } = fixture();
    assert.equal(L.beginGround().ok, true); until(g, L, 'landed');
    const forward = { ...idle, walkZ: -1 }, right = { ...idle, walkX: 1 };
    tick(g, L, forward, 1 / fps);
    assert.ok(g.rider.walkSpeed > 0 && g.rider.walkSpeed < 0.4, 'no instant full-speed start');
    for (let i = 1; i < fps; i++) tick(g, L, forward, 1 / fps);
    near(g.rider.walkSpeed, 1.2, 0.001);
    const before = g.rider.walkSpeed;
    tick(g, L, right, 1 / fps);
    assert.ok(L.yaw > 0 && L.yaw < Math.PI / 2 - 0.1, `first turn frame: ${L.yaw}`);
    assert.ok(g.rider.walkSpeed < before, 'a right-angle turn slows movement');
    near(g.flight.yaw, L.yaw); near(g.chase.walkView.yaw, 0);
    for (let i = 1; i < fps; i++) tick(g, L, right, 1 / fps);
    near(L.yaw, Math.PI / 2, 0.001);
    const position = g.flight.pos.clone(), movingSpeed = g.rider.walkSpeed;
    tick(g, L, idle, 1 / fps);
    assert.ok(g.flight.pos.distanceTo(position) > 0, 'releasing input must not freeze velocity instantly');
    assert.ok(g.rider.walkSpeed > 0 && g.rider.walkSpeed < movingSpeed);
    for (let i = 1; i < fps; i++) tick(g, L, idle, 1 / fps);
    assert.ok(g.rider.walkSpeed < 0.001);
    assert.equal(g.rider.walkFast, false);
  }
});

test('walking camera smooths a separate focus without mutating the source and converges equally at 30/144fps', () => {
  const run = (fps) => {
    const { g, L } = fixture(), C = g.chase;
    const focus = L.focus.set(0, 11.15, 0), initial = focus.clone();
    C.startWalk(focus);
    assert.equal(C.cine.focus, focus);
    assert.notEqual(C.walkView.focus, focus);
    assert.ok(C.walkView.focus.equals(initial));
    focus.set(3, 12.4, -2);
    const target = focus.clone(), snapshots = [];
    let previousError = initial.distanceTo(target);
    for (let i = 1; i <= fps * 3; i++) {
      C.update(1 / fps, i / fps, () => 10);
      assert.ok(focus.equals(target), 'camera must never lerp into Landing.focus');
      const error = C.walkView.focus.distanceTo(target);
      assert.ok(error <= previousError + 1e-10);
      if (i === 1) assert.ok(error > 0 && error < previousError, 'focus eases rather than snaps');
      previousError = error;
      if (i === fps / 2 || i === fps || i === fps * 3) snapshots.push({
        focus: C.walkView.focus.clone(), position: g.camera.position.clone(), rotation: g.camera.quaternion.clone(),
      });
    }
    assert.ok(C.walkView.focus.distanceTo(target) < 1e-7);
    return snapshots;
  };
  const slow = run(30), fast = run(144);
  slow.forEach((sample, i) => {
    assert.ok(sample.focus.distanceTo(fast[i].focus) < 1e-7, 'focus depends on frame rate');
    assert.ok(sample.position.distanceTo(fast[i].position) < 1e-7, 'camera position depends on frame rate');
    assert.ok(sample.rotation.angleTo(fast[i].rotation) < 1e-6, 'camera aim depends on frame rate');
  });
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

// Only PNG decoding is stubbed; the scene, skins and clips come from the real GLB.
async function readMage() {
  const glb = readFileSync(new URL('../../assets/models/characters/Mage.glb', import.meta.url));
  const loader = new GLTFLoader().register(() => ({
    name: 'HeadlessTextures', loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  return loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}
function standFixture(gltf) {
  const context = fixture(), { g } = context;
  const rider = new Rider(null, new THREE.Group(), { lanternPivot: [0, 0, 0] });
  g.rider = rider;
  const S = rider.setStand(gltf.scene, gltf.animations);
  g.flight.pos.set(0, 10.82, 0); g.flight.vel.set(0, 0, 0); g.flight.speed = 0;
  rider.off.on = true; rider.off.y = -0.82;
  let time = 0;
  const advance = (dt = 1 / 60) => {
    time += dt;
    rider.update(dt, time, g.flight, g.terrain);
    rider.group.updateMatrixWorld(true);
  };
  return { ...context, rider, S, advance };
}

test('Mage GLB retains its real skeleton and clips, normalizes to 2.05m, faces -Z and removes held weapons', async () => {
  const gltf = await readMage();
  const weapons = ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff'].map((name) => {
    const weapon = gltf.scene.getObjectByName(name);
    assert.ok(weapon?.isMesh, `real GLB must contain ${name}`);
    return weapon;
  });
  const { rider, S } = standFixture(gltf);
  assert.equal(S.model, gltf.scene);
  assert.equal(S.root.parent, rider.group);
  assert.equal(S.model.parent, S.root);
  assert.equal(S.mixer.getRoot(), S.model);
  assert.equal(S.state, 'Idle');
  near(S.height, 2.05);
  const box = new THREE.Box3().setFromObject(S.model, true);
  near(box.max.y - box.min.y, 2.05); near(box.min.y, 0);
  near(S.model.scale.x, S.model.scale.y); near(S.model.scale.y, S.model.scale.z);
  near(S.model.rotation.y, Math.PI);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(S.model.quaternion);
  near(forward.x, 0); near(forward.y, 0); near(forward.z, -1);
  for (const weapon of weapons) {
    assert.equal(weapon.parent, null);
    assert.equal(S.model.getObjectByName(weapon.name), undefined);
  }
  assert.deepEqual(Object.keys(S.actions).sort(), ['Idle', 'Jump', 'Run', 'Walk']);
  for (const [state, name] of Object.entries({ Idle: 'Idle', Walk: 'Walking_A', Run: 'Running_A', Jump: 'Jump_Idle' })) {
    const clip = gltf.animations.find((c) => c.name === name);
    assert.ok(clip?.duration > 0 && clip.tracks.length > 0, name);
    assert.equal(S.actions[state].getClip(), clip, 'actions must use the actual GLB clips');
    assert.equal(S.actions[state].getMixer(), S.mixer);
    assert.ok(clip.tracks.some((track) => track.name === 'hips.quaternion'));
  }
  for (const name of ['Mage_LegLeft', 'Mage_LegRight']) {
    const mesh = S.model.getObjectByName(name);
    assert.ok(mesh.isSkinnedMesh);
    assert.ok(mesh.geometry.attributes.skinIndex && mesh.geometry.attributes.skinWeight);
    for (const bone of ['hips', 'upperlegl', 'footl', 'upperlegr', 'footr']) {
      assert.ok(mesh.skeleton.bones.some((b) => b.name === bone && b.isBone), bone);
    }
  }
  assert.equal(S.actions.Idle.isRunning(), true);
  near(S.stride.Walk, 0.74 * S.model.scale.y);
  near(S.stride.Run, 4.4 * S.model.scale.y);
});

test('Rider.update advances the real mixer and cross-fades Idle/Walk/Run/Jump weights over 0.18s', async (t) => {
  const { rider, S, advance } = standFixture(await readMage());
  for (const action of Object.values(S.actions)) t.mock.method(action, 'crossFadeTo');
  advance(0.05);
  near(S.mixer.time, 0.05); near(S.actions.Idle.getEffectiveWeight(), 1);
  for (const [state, speed, fast, airborne] of [
    ['Walk', 0.8, false, false], ['Run', 2.5, true, false], ['Jump', 2.5, true, true],
    ['Walk', 0.6, false, false], ['Idle', 0, false, false],
  ]) {
    const previous = S.actions[S.state], next = S.actions[state], before = S.mixer.time;
    rider.walkSpeed = speed; rider.walkFast = fast; rider.airborne = airborne;
    advance(0.09);
    assert.equal(S.state, state);
    assert.deepEqual(previous.crossFadeTo.mock.calls.at(-1).arguments, [next, 0.18, false]);
    near(S.mixer.time, before + 0.09);
    near(previous.getEffectiveWeight(), 0.5, 1e-6);
    near(next.getEffectiveWeight(), 0.5, 1e-6);
    assert.ok(next.time > 0, `${state} clip time must advance`);
    advance(0.10);
    near(previous.getEffectiveWeight(), 0);
    near(next.getEffectiveWeight(), 1);
    // Unplayed actions default to weight 1 but do not participate in the mixer's blend.
    near(Object.values(S.actions).filter((a) => a.isScheduled()).reduce((sum, a) => sum + a.getEffectiveWeight(), 0), 1);
  }
});

test('real Mage walking bones deform both skinned legs without rewriting the original geometry', async () => {
  const gltf = await readMage(), originals = [];
  gltf.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    originals.push({ mesh, geometry, attributes: Object.entries(geometry.attributes).map(([name, attribute]) =>
      ({ name, attribute, array: attribute.array, data: attribute.array.slice() })) });
  });
  const { rider, S, advance } = standFixture(gltf);
  rider.walkSpeed = 1.2;
  advance(0.2); // complete the Idle -> Walk blend before measuring authored motion
  const legs = ['Mage_LegLeft', 'Mage_LegRight'].map((name) => S.model.getObjectByName(name));
  const vertices = (mesh) => Array.from({ length: mesh.geometry.attributes.position.count },
    (_, i) => mesh.getVertexPosition(i, new THREE.Vector3()));
  const before = legs.map(vertices);
  const bones = ['upperlegl', 'upperlegr'].map((name) => S.model.getObjectByName(name));
  const rotations = bones.map((bone) => bone.quaternion.clone());
  const clipTime = S.actions.Walk.time;
  advance(0.12);
  near(S.actions.Walk.time, clipTime + 0.12 * rider.walkSpeed / S.stride.Walk);
  legs.forEach((mesh, i) => {
    const after = vertices(mesh);
    const moved = after.filter((v, j) => v.distanceTo(before[i][j]) > 0.001).length;
    assert.ok(moved > 100, `${mesh.name}: only ${moved} skinned vertices moved`);
    assert.ok(bones[i].quaternion.angleTo(rotations[i]) > 0.01, `${bones[i].name} must animate`);
  });
  rider.airborne = true; advance(0.2);
  rider.airborne = false; rider.walkSpeed = 0; advance(0.2);
  for (const { mesh, geometry, attributes } of originals) {
    assert.equal(mesh.geometry, geometry, mesh.name);
    for (const { name, attribute, array, data } of attributes) {
      assert.equal(geometry.attributes[name], attribute);
      assert.equal(attribute.array, array);
      assert.deepEqual(attribute.array, data, `${mesh.name}.${name} was rewritten`);
    }
  }
});

test('Mage walk/run playback rate follows measured movement speed, including acceleration and braking', async () => {
  const { g, L, rider, S, advance } = standFixture(await readMage());
  // Use the landing controller rather than substituting requested keyboard speed for actual motion.
  assert.equal(L.begin(pad()), true); until(g, L, 'landed');
  let sawWalk = false, sawRun = false;
  for (const [ctl, frames] of [[{ ...idle, walkZ: -1 }, 60], [{ ...idle, walkZ: -1, walkFast: true }, 90], [idle, 90]]) {
    for (let i = 0; i < frames; i++) {
      const before = g.flight.pos.clone();
      tick(g, L, ctl); advance();
      const actualSpeed = Math.hypot(g.flight.pos.x - before.x, g.flight.pos.z - before.z) * 60;
      near(rider.walkSpeed, actualSpeed);
      for (const name of ['Walk', 'Run']) near(S.actions[name].getEffectiveTimeScale(), actualSpeed / S.stride[name]);
      if (S.state === 'Walk') sawWalk = true;
      if (S.state === 'Run') sawRun = true;
    }
    if (ctl.walkFast) near(rider.walkSpeed, 2.8, 0.001);
    else if (ctl.walkZ) near(rider.walkSpeed, 1.2, 0.001);
  }
  assert.ok(sawWalk && sawRun);
  assert.equal(S.state, 'Idle');
  assert.ok(rider.walkSpeed < 0.001);
});

test('Mage sole correction uses both animated leg SkinnedMesh bounds, not bone origins', async (t) => {
  const { g, S, advance } = standFixture(await readMage());
  assert.deepEqual(S.legs, ['Mage_LegLeft', 'Mage_LegRight'].map((name) => S.model.getObjectByName(name)));
  for (const mesh of S.legs) t.mock.method(mesh, 'computeBoundingBox');
  const soleY = () => Math.min(...S.legs.map((mesh) => {
    assert.ok(mesh.computeBoundingBox.mock.callCount() > 0);
    return new THREE.Box3().copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld).min.y;
  }));
  advance(); near(soleY(), 10, 1e-5);
  g.terrain.heightAt = () => 10.08;
  advance(); near(soleY(), 10.08, 1e-5);
});

test('walking and jumping show Mage while hiding the seated broom; remounting restores the broom', async () => {
  const { rider, S, advance } = standFixture(await readMage());
  const visibleMeshes = () => {
    const meshes = [];
    rider.group.traverseVisible((o) => { if (o.isMesh) meshes.push(o); });
    return meshes;
  };
  // A visible child makes the seated branch's inherited visibility observable without WebGL.
  const broom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2), new THREE.MeshBasicMaterial());
  rider.model.add(broom);
  for (const airborne of [false, true]) {
    rider.airborne = airborne; advance();
    assert.equal(S.root.visible, true);
    assert.equal(rider.tilt.visible, false);
    assert.ok(visibleMeshes().some((mesh) => mesh.isSkinnedMesh));
    assert.ok(!visibleMeshes().includes(broom));
    assert.equal(S.state, airborne ? 'Jump' : 'Idle');
  }
  rider.off.on = false; advance();
  assert.equal(S.root.visible, false);
  assert.equal(rider.tilt.visible, true);
  assert.equal(S.state, 'Idle');
  assert.ok(visibleMeshes().includes(broom));
  assert.ok(!visibleMeshes().some((mesh) => mesh.isSkinnedMesh));
});
