import * as THREE from 'three';
import { createDragonRig } from './rig.js';
import { combineCollisions, createEstates, ESTATE_SITES } from './estates.js';
import { createBreath } from './breath.js';
import { flightPhase, planPatrol } from './patrol.js';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x,y,z);
const forward = v(0,0,1), up = v(0,1,0), zero = v();
const sizes = [1.6,1.6,2.05];

function pilot(game, plan, estates, index) {
  const { world, pipeline } = game;
  const rig = createDragonRig();
  rig.group.scale.multiplyScalar(sizes[index]);
  if (index) rig.group.name = index === 2 ? '赤脊巨龙 · 巨翼' : '赤脊巨龙 · 第二条';
  const breath = createBreath(world,pipeline.size);
  world.add(rig.group);
  const heading = v(), ahead = v(), mouth = v(), axis = v(), targetAxis = v(), before = v(), after = v();
  const orientation = new THREE.Quaternion(), bankRotation = new THREE.Quaternion(), basis = new THREE.Matrix4();
  const style = { effort:0.55, dive:0, bank:0, fire:0 };
  const controller = { rig, breath, heading, update, phase:'patrol', field:null, progress:0 };

  function update(clock,dt,wind) {
    const time = (clock + plan.duration * index / sizes.length) % plan.duration;
    const mission = plan.missions.findLast(m=>m.start <= time);
    const traveling = time >= mission.end;
    const path = traveling ? mission.bridge.path : mission.path;
    const duration = traveling ? mission.bridge.duration : mission.end-mission.start;
    const progress = (time-(traveling ? mission.end : mission.start))/duration;
    const field = estates[mission.index];
    const phase = traveling ? 'travel' : flightPhase(progress);
    Object.assign(controller,{ phase, field, progress });
    const firing = phase === 'fire';
    const wingClock = clock + index * 1.5;
    const position = rig.group.position;
    path.getPoint(progress,position);
    position.y += 0.45*Math.sin(wingClock*5.78)*style.effort;
    if (traveling) {
      position.y += index*24*Math.sin(Math.PI*progress)**2;
      const t = 0.002;
      path.getPoint(Math.max(0,progress-t),before);
      path.getPoint(Math.min(1,progress+t),after);
      before.y += index*24*Math.sin(Math.PI*Math.max(0,progress-t))**2;
      after.y += index*24*Math.sin(Math.PI*Math.min(1,progress+t))**2;
      heading.subVectors(after,before).normalize();
      path.getTangent(Math.min(1,progress+0.018),ahead);
    } else {
      path.getTangent(progress,heading);
      path.getTangent((progress+0.024)%1,ahead);
    }
    const turn = heading.z*ahead.x-heading.x*ahead.z;
    const damper = 1-Math.exp(-dt*5.2);
    const blend = THREE.MathUtils.lerp;
    style.bank = blend(style.bank,THREE.MathUtils.clamp(-turn*1.55,-0.64,0.64),damper);
    style.dive = blend(style.dive,phase==='dive' ? 0.92 : firing ? 0.45 : 0,damper);
    style.effort = blend(style.effort,phase==='climb' ? 1.17 : phase==='dive'||firing ? 0.1 : phase==='circle'||traveling ? 0.39 : 0.76,damper);
    style.fire = blend(style.fire,firing ? 1 : 0,damper);
    orientation.setFromRotationMatrix(basis.lookAt(heading,zero,up));
    const rotation = orientation.multiply(bankRotation.setFromAxisAngle(forward,style.bank));
    rig.group.quaternion.slerp(rotation,dt ? 1-Math.exp(-dt*8) : 1);
    rig.animate(wingClock,style.effort,style.dive,style.bank,style.fire);
    rig.group.updateMatrixWorld(true);
    rig.mouth.getWorldPosition(mouth);
    rig.aim.getWorldPosition(axis).sub(mouth).normalize();
    targetAxis.subVectors(field.damagePoint,mouth).normalize();
    const alignment = axis.dot(targetAxis);
    if (firing && alignment>0.36) axis.lerp(targetAxis,0.94).normalize();
    breath.update(dt,mouth,axis,firing&&alignment>0.36 ? field : null,wind);
  }
  return controller;
}

export function createIslandDragon(game, { randomStart = false } = {}) {
  const { world, terrain, U } = game;
  const estates = createEstates(terrain);
  const plan = planPatrol(terrain,ESTATE_SITES);
  const pilots = plan ? sizes.map((_,i)=>pilot(game,plan,estates,i)) : [];
  world.add(...estates.map(estate=>estate.root));
  const wind = v(), demoTarget=v(), demoCamera=v(), groundCamera=v(), strikeTarget=v(), side=v();
  let clock = randomStart && plan ? Math.random() * plan.duration : 0;

  function update(dt) {
    clock += dt;
    const w = U.uWind.value;
    wind.set(w.x,0,w.y);
    pilots.forEach(dragon=>dragon.update(clock,dt,wind));
    estates.forEach(estate=>estate.update(dt));
  }

  function show(camera, index = 0) {
    const dragon = pilots[index];
    if (!dragon) return;
    const position = dragon.rig.group.position;
    const t = dragon.progress;
    const smooth = THREE.MathUtils.smoothstep;
    const traveling = dragon.phase === 'travel';
    const focus = traveling ? 1-smooth(t,0.08,0.25) : smooth(t,0.38,0.55);
    const gap = dragon.field.damagePoint;
    side.crossVectors(dragon.heading,up).normalize();
    demoCamera.copy(position).addScaledVector(dragon.heading,31).addScaledVector(side,36.9*sizes[index]).y += 18;
    groundCamera.copy(gap).add(v(16,22,91));
    strikeTarget.copy(gap).lerp(position,traveling ? 0 : (1-smooth(t,0.69,0.77))*0.45);
    demoTarget.copy(position).lerp(strikeTarget,focus);
    demoCamera.lerp(groundCamera,focus);
    camera.position.copy(demoCamera);
    camera.lookAt(demoTarget);
    camera.updateMatrixWorld();
  }

  const landmarks = estates.map(estate=>({
    id:`place:${estate.id}`,name:estate.name,kind:'place',hidden:false,
    description:`三龙巡航区 · ${estate.houses.length} 间房屋、花园和小径 · 房屋损坏后会自行重建`,
    pos:estate.houses[0].root.position,radius:100,
  }));
  update(0);
  return { estates, pilots, landmarks, collision:combineCollisions(estates), duration:plan?.duration, update,show, get clock(){ return clock; } };
}
