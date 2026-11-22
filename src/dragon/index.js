import * as THREE from 'three';
import { createDragonRig } from './rig.js';
import { createWorkshop } from './workshop.js';
import { createBreath } from './breath.js';

const SITE = { x: 550, z: -750 };
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const route = [
  [-82, 66, -45], [-25, 73, -93], [57, 70, -82], [91, 62, -31], [77, 52, 14],
  [43, 35, 10], [20, 24, 4], [-8, 25, -4], [-39, 43, -12], [-79, 59, -14],
];
const CYCLE = 29, STAGGER = 0.5;
const forward = v(0, 0, 1), up = v(0, 1, 0), zero = v();

export function islandRoute(terrain, site = SITE, companion = false, random = null) {
  const floor = terrain.heightAt(site.x, site.z);
  const points = route.map(([x, y, z], i) => {
    if (companion) {
      z *= -1;
      y += [37, 39, 44, 41, 24, 0, 0, 0, 20, 34][i];
    }
    // Fix the loop seam and approach. Resampling the patrol bend will not snap the dragon or move its target.
    if (random && i >= 2 && i <= 4) {
      x += (random() - 0.5) * 49;
      z += (random() - 0.5) * 66;
      y += (random() - 0.5) * 17;
    }
    return v(site.x+x, floor+y, site.z+z);
  });
  const path = new THREE.CatmullRomCurve3(points, true);
  const legal = path.getPoints(720).every(p => {
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const ground = terrain.heightAt(p.x + 17*Math.cos(angle), p.z + 17*Math.sin(angle));
      if (ground <= Math.max(2, terrain.meta.sea ?? 0) || p.y - ground < 13) return false;
    }
    return true;
  });
  return legal ? path : null;
}

function separated(a, b) {
  const first = v(), second = v();
  for (let i = 0; i < 240; i++) {
    const t = i / 240;
    if (a.getPoint(t, first).distanceToSquared(b.getPoint((t + STAGGER) % 1, second)) < 35 ** 2) return false;
  }
  return true;
}

function pilot(game, field, path, offset) {
  const { world, pipeline } = game;
  const rig = createDragonRig();
  const breath = createBreath(world, pipeline.size, field);
  world.add(rig.group);
  const heading = v(), ahead = v(), mouth = v(), axis = v(), targetAxis = v();
  const orientation = new THREE.Quaternion(), bankRotation = new THREE.Quaternion(), basis = new THREE.Matrix4();
  const style = { effort: 0.55, dive: 0, bank: 0, fire: 0 };
  let phase = 'patrol';
  const controller = { rig, breath, heading, path, offset, update, get phase() { return phase; } };

  function update(clock, dt, wind) {
    const t = (clock / CYCLE + offset) % 1;
    const slot = t * route.length;
    phase = slot < 2.55 ? 'patrol' : slot < 4.45 ? 'circle' : slot < 5.65 ? 'dive'
      : slot < 6.43 ? 'fire' : slot < 8.15 ? 'climb' : 'retreat';
    const firing = phase === 'fire';
    const wingClock = clock + offset * 3;
    const path = controller.path;
    path.getPoint(t, rig.group.position);
    rig.group.position.y += 0.45 * Math.sin(wingClock * 5.78) * style.effort;
    path.getTangent(t, heading);
    path.getTangent((t + 0.024) % 1, ahead);
    const turn = heading.z * ahead.x - heading.x * ahead.z;
    const damper = 1 - Math.exp(-dt * 5.2);
    const blend = THREE.MathUtils.lerp;
    style.bank = blend(style.bank, THREE.MathUtils.clamp(-turn * 1.55, -0.64, 0.64), damper);
    style.dive = blend(style.dive, phase === 'dive' ? 0.92 : firing ? 0.45 : 0, damper);
    style.effort = blend(style.effort, phase === 'climb' ? 1.17 : phase === 'dive' || firing ? 0.1 : phase === 'circle' ? 0.39 : 0.76, damper);
    style.fire = blend(style.fire, firing ? 1 : 0, damper);
    orientation.setFromRotationMatrix(basis.lookAt(heading, zero, up));
    rig.group.quaternion.copy(orientation).multiply(bankRotation.setFromAxisAngle(forward, style.bank));
    rig.animate(wingClock, style.effort, style.dive, style.bank, style.fire);
    rig.group.updateMatrixWorld(true);
    rig.mouth.getWorldPosition(mouth);
    rig.aim.getWorldPosition(axis).sub(mouth).normalize();
    targetAxis.subVectors(field.damagePoint, mouth).normalize();
    const alignment = axis.dot(targetAxis);
    if (firing && alignment > 0.44) axis.lerp(targetAxis, 0.92).normalize();
    breath.update(dt, mouth, axis, firing && alignment > 0.44, wind);
  }
  return controller;
}

export function createIslandDragon(game, random = Math.random) {
  const { world, terrain, U } = game;
  const a = islandRoute(terrain), b = islandRoute(terrain, SITE, true);
  if (!a || !b || !separated(a, b)) return null;
  const field = createWorkshop(terrain, SITE.x, SITE.z);
  const first = pilot(game, field, a, 0), second = pilot(game, field, b, STAGGER);
  second.rig.group.name = '赤脊巨龙 · 第二条';
  world.add(field.root);
  const pilots = [first, second];
  const wind = v(), demoTarget = v(), demoCamera = v(), groundCamera = v(), strikeTarget = v(), side = v();
  const pairCenter = v(), gap = field.damagePoint;
  let clock = 0;

  function reroute(index) {
    const other = pilots[1 - index];
    for (let attempt = 0; attempt < 4; attempt++) {
      const candidate = islandRoute(terrain, SITE, index === 1, random);
      if (candidate && separated(candidate, other.path)) {
        pilots[index].path = candidate;
        return;
      }
    }
  }
  reroute(0);
  reroute(1);
  function update(dt) {
    const previous = clock;
    clock += dt;
    const w = U.uWind.value;
    wind.set(w.x, 0, w.y);
    pilots.forEach((dragon, i) => {
      if (Math.floor(previous/CYCLE + dragon.offset) < Math.floor(clock/CYCLE + dragon.offset)) reroute(i);
      dragon.update(clock, dt, wind);
    });
    field.update(dt);
  }

  function show(camera) {
    const elapsed = clock % CYCLE;
    const shotTime = elapsed < 3.4 && clock >= CYCLE ? elapsed + CYCLE : elapsed;
    const smooth = THREE.MathUtils.smoothstep;
    const focus = smooth(shotTime, 11, 15.9) * (1 - smooth(shotTime, 29.8, 32.3));
    const wide = (1 - smooth(elapsed, 7.5, 10.5)) * (1 - focus);
    const dragon = first.rig.group.position, other = second.rig.group.position;
    side.crossVectors(first.heading, up).normalize();
    demoCamera.copy(dragon).addScaledVector(first.heading, 22).addScaledVector(side, 37).y += 12;
    const turn = clock * 0.075;
    groundCamera.copy(gap).add(v(11 + Math.cos(turn)*7, 14, 62 + Math.sin(turn)*7));
    const inFrame = (1 - smooth(shotTime, 20, 23)) * 0.44;
    strikeTarget.copy(gap).lerp(dragon, inFrame);
    demoTarget.copy(dragon).lerp(strikeTarget, focus);
    demoCamera.lerp(groundCamera, focus);
    pairCenter.copy(dragon).lerp(other, 0.5);
    const span = dragon.distanceTo(other);
    demoTarget.lerp(pairCenter, wide);
    demoCamera.lerp(pairCenter.add(v(span * 0.38, 22 + span * 0.30, 23 + span * 1.05)), wide);
    camera.position.copy(demoCamera);
    camera.lookAt(demoTarget);
    camera.updateMatrixWorld();
  }

  const landmark = { id: 'place:dragon-workshop', name: field.root.name, kind: 'place',
    hidden: false, description: '赤脊巨龙巡航区 · 守望工坊受损后会自行重组', pos: field.root.position, radius: 100 };
  update(0);
  return { field, pilots, landmark, update, show, get clock() { return clock; } };
}
