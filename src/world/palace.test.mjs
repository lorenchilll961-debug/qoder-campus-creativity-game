import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { bodyClear, moveGround, probeGround, WALK } from '../game/ground.js';
import { PALACE_SITE, palaceGradeAt } from './palace-site.js';

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
    const { U } = await import('../core/ctx.js');
    const { Flight } = await import('../player/flight.js');
    const { Landing } = await import('../game/landing.js');
    const terrain = { heightAt: (x, z) => palaceGradeAt(x, z, 126) };
    const { group, collision, landmark, pads, buildings, update } = createPalace(terrain);
    let meshes = 0;
    group.traverse(node => {
      if (!node.isMesh) return;
      meshes++;
      assert(node.geometry.getAttribute('position').array.every(Number.isFinite));
    });
    assert(meshes > 50);
    assert.equal(buildings, 150);
    for (const district of ['御花园', '宁寿宫', '外东路', '外西路', '外朝与东西路新增配殿']) {
      assert(group.children.some(child => child.name.includes(district)));
    }

    const materials = new Map();
    group.traverse(node => { if (node.isMesh) materials.set(node.material.name, node.material); });
    const water = materials.get('palace_water');
    const glass = materials.get('palace_window_lattice');
    const spill = materials.get('palace_window_spill');
    const lantern = materials.get('palace_lantern');
    assert(water.uniforms.uRipple.value.isDataTexture);
    assert.equal(water.uniforms.uTime, U.uTime);
    assert.equal(spill.uniforms.uDayNight, U.uDayNight);
    assert.equal(glass.emissiveIntensity, 0);
    const dusk = U.uDayNight.value.clone(), now = U.uTime.value;
    const ducks = group.children.find(child => child.name === '午门与东西岸市集')
      .children.filter(child => child.name === '护城河水鸭');
    const start = ducks[0].position.clone();
    try {
      U.uDayNight.value.set(.5, .1, .8, 18);
      U.uTime.value = 10;
      update();
      assert(glass.emissiveIntensity > .8);
      assert(lantern.emissiveIntensity > .8);
      assert.equal(ducks.length, 6);
      assert(ducks[0].position.distanceTo(start) > 3);
      U.uDayNight.value.set(1, 0, 0, 14);
      update();
      assert.equal(glass.emissiveIntensity, 0);
    } finally {
      U.uDayNight.value.copy(dusk);
      U.uTime.value = now;
    }

    const { x, y, z } = landmark.pos;
    const env = { terrain, solid: collision };
    const gateZ = PALACE_SITE.z + 419.6 * PALACE_SITE.scale;
    assert.equal(collision.heightAt(x, z), y);
    assert.equal(probeGround(env, x, z).ok, true);
    const flight = new Flight(terrain);
    flight.solid = collision;
    flight.place(x, z - 0.55, y + 17 - terrain.heightAt(x, z - .55), 0);
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
      carpet.place(x, z, y + 17 - terrain.heightAt(x, z), pad.yaw * 180 / Math.PI);
      assert(new Landing({ terrain, flight: carpet, rider: { standing: true } }).begin(pad), pad.name);
    }
    assert(pads.some(pad => pad.pos.y > y + 3));
    assert(collision.heightAt(x, gateZ) > y + 8);
    assert(bodyClear(env, x, y, gateZ));
    assert(!bodyClear(env, x + 7, y, gateZ));
    const move = start => moveGround(env, start, { z: -1 }, 0, 6, true);
    assert(move({ x, y, z: gateZ + 12 }).pos.z < gateZ - 5);
    assert(move({ x: x + 4, y, z: gateZ + 12 }).pos.z > gateZ);
    const point = (localX, localZ) => ({
      x: PALACE_SITE.x - localX * PALACE_SITE.scale,
      z: PALACE_SITE.z - localZ * PALACE_SITE.scale,
    });
    const routes = [
      ['太和门正中', [0, -238], [0, -190.5], 0],
      ['太和殿', [0, -55], [0, -17], 8],
      ['中和殿', [0, 26], [0, 53], 6],
      ['保和殿', [0, 82.1], [0, 111.8], 7],
      ['乾清宫', [0, 294], [0, 304.8], 2],
      ['交泰殿', [0, 334], [0, 345.6], 2],
      ['坤宁宫', [0, 366.5], [0, 377.2], 2],
      ['东观景台', [-397, -365], [-397, -326], 9],
    ];
    for (const [name, from, to, localRise] of routes) {
      const start = point(...from), end = point(...to);
      const foot = probeGround(env, start.x, start.z);
      assert(foot.ok, name);
      const dx = end.x - start.x, dz = end.z - start.z;
      const duration = Math.hypot(dx, dz) / WALK.fast;
      const up = moveGround(env, foot.pos, { x: dx, z: dz }, 0, duration, true);
      assert.equal(up.blocked, null, name);
      assert(Math.abs(up.pos.y - y - localRise * PALACE_SITE.verticalScale) < .02, name);
      const down = moveGround(env, up.pos, { x: -dx, z: -dz }, 0, duration, true);
      assert.equal(down.blocked, null, name);
      assert(Math.abs(down.pos.y - foot.pos.y) < .02, name);
    }
    assert(!bodyClear(env, x, y, PALACE_SITE.z));
    assert(collision.heightAt(x + 500, z) < terrain.heightAt(x + 500, z));
    assert.equal(terrain.heightAt(170, -1130), 126);
    const wetX = PALACE_SITE.x + 445 * PALACE_SITE.scale;
    assert(terrain.heightAt(wetX, PALACE_SITE.z) < y - 2);
    assert.equal(probeGround(env, wetX, PALACE_SITE.z).ok, false);
    for (let wz = -443; wz < -335; wz++) {
      assert(Math.abs(terrain.heightAt(x, wz + 1) - terrain.heightAt(x, wz)) < .65);
    }
  } finally {
    delete globalThis.document;
    hooks.deregister();
  }
});
