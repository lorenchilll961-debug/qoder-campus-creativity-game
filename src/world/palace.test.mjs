import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { bodyClear, moveGround, probeGround } from '../game/ground.js';

test('故宫上游几何可构建，午门可步行通过，城墙实体与飞行净空有效', async () => {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const prefix = 'three/addons/';
      if (specifier === 'three') {
        return nextResolve(new URL('../../vendor/three/build/three.module.js', import.meta.url).href, context);
      }
      if (specifier.startsWith(prefix)) {
        return nextResolve(new URL('../../vendor/three/examples/jsm/' + specifier.slice(prefix.length), import.meta.url).href, context);
      }
      return nextResolve(specifier, context);
    },
  });
  globalThis.document = {
    createElement() {
      return {
        getContext() {
          const data = new Uint8ClampedArray(this.width * this.height * 4);
          const gradient = { addColorStop() {} };
          return new Proxy({}, { get: (_, name) => {
            if (name === 'getImageData') return () => ({ data });
            if (name.includes('Gradient')) return () => gradient;
            return () => {};
          } });
        },
      };
    },
  };
  try {
    const { createPalace } = await import('./palace.js');
    const { Flight } = await import('../player/flight.js');
    const { Landing } = await import('../game/landing.js');
    const terrain = { heightAt: () => 126 };
    const { group, collision, landmark, pads } = createPalace(terrain);
    let meshes = 0;
    group.traverse(node => {
      if (!node.isMesh) return;
      meshes++;
      assert(node.geometry.getAttribute('position').array.every(Number.isFinite));
    });
    assert(meshes > 50);
    assert(group.children.some(child => child.name.includes('御花园')));

    const { x, y, z } = landmark.pos;
    const env = { terrain, solid: collision };
    const gateZ = -564.16;
    assert.equal(collision.heightAt(x, z), y);
    assert.equal(probeGround(env, x, z).ok, true);
    const flight = new Flight(terrain);
    flight.solid = collision;
    flight.place(x, z - 0.55, y + 17 - terrain.heightAt(), 0);
    const landing = new Landing({ terrain, flight, rider: { standing: true } });
    assert.equal(landing.beginGround().ok, true);
    assert.equal(pads.length, 3);
    for (const pad of pads) {
      assert(pad.gold);
      const { x, y, z } = pad.pos;
      const foot = probeGround(env, x, z);
      assert(foot.ok);
      assert(Math.abs(foot.pos.y - y) < 1e-6);
      const carpet = new Flight(terrain);
      carpet.solid = collision;
      carpet.place(x, z, y + 17 - terrain.heightAt(), pad.yaw * 180 / Math.PI);
      assert(new Landing({ terrain, flight: carpet, rider: { standing: true } }).begin(pad), pad.name);
    }
    assert(pads.some(pad => pad.pos.y > y + 3));
    assert(collision.heightAt(x, gateZ) > y + 8);
    assert(bodyClear(env, x, y, gateZ));
    assert(!bodyClear(env, x + 4, y, gateZ));
    const move = start => moveGround(env, start, { z: -1 }, 0, 4, true);
    assert(move({ x, y, z: gateZ + 7 }).pos.z < gateZ - 5);
    assert(move({ x: x + 4, y, z: gateZ + 7 }).pos.z > gateZ);
    assert(!bodyClear(env, x, y, -732));
    assert(collision.heightAt(x + 500, z) < terrain.heightAt(x + 500, z));
  } finally {
    delete globalThis.document;
    hooks.deregister();
  }
});
