import test from 'node:test';
import assert from 'node:assert/strict';
import { WALK, probeGround, moveGround, groundAnchor, walkVector, bodyClear, airClear } from './ground.js';

const flat = (y = 10) => ({ terrain: { heightAt: () => y } });
const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('safe land and a broad rooftop above water provide support', () => {
  assert.deepEqual(probeGround(flat(), 0, 0), { ok: true, pos: { x: 0, y: 10, z: 0 } });
  const env = { ...flat(-3), river: { levelAt: () => 2 }, solid: { heightAt: () => 8 } };
  assert.equal(probeGround(env, 0, 0).pos.y, 8);
});

test('sea, river and even one unsupported/wet foot sample are refused', () => {
  assert.equal(probeGround(flat(-1), 0, 0).code, 'water');
  assert.equal(probeGround({ ...flat(10), river: { levelAt: () => 11 } }, 0, 0).code, 'water');
  assert.equal(probeGround({ terrain: { heightAt: (x) => x > 0.3 ? -1 : 1 } }, 0, 0).code, 'water');
  assert.equal(probeGround(flat(NaN), 0, 0).code, 'support');
});

test('slope is measured over both axes and all support heights', () => {
  const slope = (s) => ({ terrain: { heightAt: (x, z) => 10 + (x + z) * s } });
  assert.equal(probeGround(slope(0.3), 0, 0).ok, true);
  assert.equal(probeGround(slope(0.5), 0, 0).ok, false); // diagonal slope > 0.65
  assert.equal(probeGround({ terrain: { heightAt: (x) => 10 + x * 0.75 } }, 0, 0).code, 'slope');
});

test('a low step is walkable, a high step/wall is not', () => {
  for (const [step, allowed] of [[0.22, true], [0.5, false], [15, false]]) {
    const env = { ...flat(), solid: { heightAt: (x) => x >= 1 ? 10 + step : -1e9 } };
    const m = moveGround(env, { x: 0, y: 10, z: 0 }, { x: 1 }, 0, 1);
    assert.equal(m.travelled > 2, allowed);
    if (allowed) near(m.pos.y, 10.22);
    else { assert.equal(m.blocked.code, 'step'); assert.ok(m.pos.x < 0.7); }
  }
});

test('substeps cannot tunnel through a thin wall even in a two-second frame', () => {
  const env = { ...flat(), solid: { heightAt: (x) => x > 0.9 && x < 1.1 ? 20 : -1e9 } };
  const m = moveGround(env, { x: 0, y: 10, z: 0 }, { x: 1 }, 0, 2, true);
  assert.ok(m.pos.x < 0.9);
  assert.ok(m.blocked);
});

test('roof edges and large drops stop the feet before falling to a lower layer', () => {
  const env = { ...flat(2), solid: { heightAt: (x) => x < 1 ? 10 : -1e9 } };
  const m = moveGround(env, { x: 0, y: 10, z: 0 }, { x: 1 }, 0, 2);
  assert.equal(m.blocked.code, 'edge');
  assert.ok(m.pos.x < 0.7);
  assert.equal(m.pos.y, 10);
});

test('a bridge/overhead roof is not a lower walkable floor or a teleport target', () => {
  const env = { ...flat(2), solid: { heightAt: () => 12 } };
  assert.equal(probeGround(env, 0, 0, { maxY: 8 }).code, 'below');
  assert.equal(probeGround(env, 0, 0, { referenceY: 2 }).code, 'step');
});

test('collision copies detect vertical pushes even when collide returns false', () => {
  let calls = 0;
  for (const field of ['props', 'solid']) {
    const env = { ...flat(), [field]: { heightAt: () => -1e9, collide(p) { calls++; p.y += 0.01; return false; } } };
    const pos = Object.freeze({ x: 0, y: 10, z: 0 });
    const m = moveGround(env, pos, { x: 1 }, 0, 0.1);
    assert.equal(m.blocked.code, 'clearance');
    assert.deepEqual(m.pos, pos);
  }
  assert.ok(calls > 0);
});

test('head-height props and horizontal pushes block the whole standing body', () => {
  const env = { ...flat(), props: { collide(p) { if (p.y > 11.4) p.x += 0.1; return false; } } };
  assert.equal(bodyClear(env, 0, 10, 0), false);
  assert.equal(probeGround(env, 0, 0).code, 'clearance');
});

test('diagonal input is normalized and the camera frame does not depend on rider yaw', () => {
  const diagonal = walkVector(1, -1, 0);
  near(Math.hypot(diagonal.x, diagonal.z), 1);
  assert.deepEqual(walkVector(0, -1, 0), { x: 0, z: -1 });
  const rotated = walkVector(0, -1, Math.PI / 2);
  near(rotated.x, 1); near(rotated.z, 0);
});

test('walk/fast speeds and diagonal distance are frame-rate independent', () => {
  for (const fast of [false, true]) for (const fps of [15, 30, 60, 144]) {
    let p = { x: 0, y: 10, z: 0 };
    for (let i = 0; i < fps * 3; i++) p = moveGround(flat(), p, { x: 1, z: -1 }, 0, 1 / fps, fast).pos;
    near(Math.hypot(p.x, p.z), 3 * (fast ? WALK.fast : WALK.speed));
  }
});

test('anchor copies current feet and has an unambiguous kind (not pad.ground)', () => {
  const feet = { x: 4, y: 5, z: 6 }, anchor = groundAnchor(feet, 1);
  anchor.pos.x++;
  assert.equal(feet.x, 4);
  assert.equal(anchor.kind, 'ground');
  assert.equal(anchor.ground, undefined);
});

test('takeoff requires clearance for both ends of the broom and props', () => {
  const p = { x: 0, y: 10.82, z: 0 };
  assert.equal(airClear(flat(), p, 0), true);
  const env = { ...flat(), solid: { heightAt: (x, z) => z < -1 ? 14 : -1e9 } };
  assert.equal(airClear(env, p, 0), false);
  assert.equal(airClear({ ...flat(), props: { collide(q) { q.y++; return false; } } }, p, 0), false);
});
