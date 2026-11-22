import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadTracked } from '../core/progress.js';
import { atCounter } from './quest.js';
import { probeGround, moveGround, bodyClear, WALK } from './ground.js';

export const RESIDENTS = Object.freeze([
  { id: 'guild', padId: 'larkhaven:m_couriers:7:0', name: '阿岚 · 商店老板', model: 'Formal.glb', route: [[-2.4, 0.35], [2.4, 0.35]], speed: 0.85 },
  { id: 'teahouse', ground: [0, 5], padId: 'larkhaven:m_teahouse:48:0', name: '老林 · 村民', model: 'Farmer.glb', route: [[-1.6, -0.7], [1.6, -0.7]], speed: 1 },
  { id: 'harbourmaster', padId: 'larkhaven:h_harbourmaster:13:0', name: '港务长 · 白鹣', model: 'Formal.glb', route: [[-1.2, 0], [1.2, 0]], speed: 0.8 },
  { id: 'oldkeep', padId: 'larkhaven:c_oldkeep:87:0', name: '客栈掌柜 · 芦花', model: 'Farmer.glb', route: [[-0.8, 0], [0.8, 0]], speed: 0.9 },
  { id: 'library', padId: 'larkhaven:c_library:92:0', name: '学者 · 青简', model: 'Witch.glb', route: [[-0.4, 0], [0.4, 0]], speed: 0.75 },
  { id: 'customs', ground: [0, 7], padId: 'larkhaven:h_customs:20:0', name: '关员 · 严霜', model: 'Formal.glb', route: [[-1.6, 0.3], [1.6, 0.3]], speed: 0.85 },
  { id: 'dryingtower', ground: [3.5, -3.5], padId: 'larkhaven:k_dryingtower:74:0', name: '染匠 · 靛青', model: 'Farmer.glb', route: [[-1.5, 0.4], [1.5, 0.4]], speed: 0.9 },
  { id: 'belltower', ground: [10, 0], padId: 'larkhaven:m_belltower:11:0', name: '执事 · 檀香', model: 'Formal.glb', route: [[-1.5, 0.5], [1.5, 0.5]], speed: 0.8 },
  { role: 'wizard', station: false, padId: 'larkhaven:c_observatory:0:0', name: '白榆 · 魔法师', model: 'Witch.glb', route: [[-1.2, 0.6], [1.2, 0.6]], speed: 0.75 },
]);

export function stationFor(env, pad, spec) {
  if (!pad || spec.station === false) return null;
  const station = { id: spec.id, name: `${pad.name} · ${spec.name}`, town: pad.town,
    street: !!spec.ground, spot: spec.ground ? '地面门口' : '屋顶露台' };
  if (!spec.ground) return { ...station, pad, pos: pad.pos };
  const x = pad.pos.x + spec.ground[0], z = pad.pos.z + spec.ground[1];
  const spot = probeGround(env, x, z, { maxY: env.terrain.heightAt(x, z) + WALK.step });
  return spot.ok ? { ...station, pos: spot.pos } : null;
}

export function patrolRoute(env, pad, offsets) {
  const points = offsets.map(([x, z]) => probeGround(env, pad.pos.x + x, pad.pos.z + z, { referenceY: pad.pos.y, maxY: pad.pos.y + WALK.step }));
  if (points.some((p) => !p.ok)) return null;
  const route = points.map((p) => p.pos);
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (moveGround(env, a, { x: (b.x - a.x) / d, z: (b.z - a.z) / d }, 0, d / WALK.speed).blocked) return null;
  }
  return route;
}

export class Resident {
  constructor(spec, gltf) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.group.name = spec.name;
    this.group.visible = false;
    this.model = gltf.scene;
    // The source walk cycles dip at most 1.6 cm below their authored floor.
    this.model.position.y = 0.02;
    this.group.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = Object.fromEntries(['Idle', 'Walk'].map((name) => {
      const clip = THREE.AnimationClip.findByName(gltf.animations, name);
      if (!clip) throw new Error(`${spec.model}: 缺少 ${name} 动画`);
      return [name, this.mixer.clipAction(clip)];
    }));
    this.state = 'Idle';
    this.actions.Idle.play();
    this.mixer.update(0);
    this.wait = 0.8;
    this.next = 1;
    this.active = false;
    this.facing = new THREE.Quaternion();
  }

  get pos() { return this.group.position; }

  bind(env, pad) {
    this.pad = pad;
    this.route = pad ? patrolRoute(env, pad, this.spec.route) : null;
    this.active = !!this.route;
    this.group.visible = this.active;
    if (!this.active) return;
    this.pos.copy(this.route[0]);
    this.wait = 0.8;
    this.next = 1;
    this.transition('Idle');
  }

  transition(state) {
    if (this.state === state) return;
    const previous = this.actions[this.state], next = this.actions[state];
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    previous.crossFadeTo(next, 0.25, false);
    this.state = state;
  }

  face(point, dt) {
    const dx = point.x - this.pos.x, dz = point.z - this.pos.z;
    if (Math.hypot(dx, dz) < 0.01) return;
    this.facing.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx, dz));
    this.group.quaternion.rotateTowards(this.facing, dt * 7);
  }

  update(dt, env, player, inReach) {
    if (!this.active) return;
    this.group.visible = this.pos.distanceToSquared(player) < 180 * 180;
    if (!this.group.visible) return;
    if (inReach) {
      this.transition('Idle');
      this.face(player, dt);
      this.wait = 0.8;
    } else if (this.wait > 0) {
      this.wait = Math.max(0, this.wait - dt);
      this.transition('Idle');
    } else {
      const target = this.route[this.next];
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z, distance = Math.hypot(dx, dz);
      if (distance < 0.03) {
        this.next = (this.next + 1) % this.route.length;
        this.wait = 1.2;
        this.transition('Idle');
      } else {
        this.face(target, dt);
        const moved = moveGround(env, this.pos, { x: dx / distance, z: dz / distance }, 0, Math.min(dt * this.spec.speed, distance) / WALK.speed);
        this.pos.copy(moved.pos);
        this.transition(moved.travelled > 0.001 ? 'Walk' : 'Idle');
        if (moved.blocked) {
          this.next = (this.next + 1) % this.route.length;
          this.wait = 1.2;
          this.transition('Idle');
        }
      }
    }
    this.mixer.update(dt);
  }
}

export class DeliveryNPCs {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = '云雀港居民';
    game.pipeline.overlay.add(this.group);
    this.actors = [];
    this.pads = [];
    this.stations = [];
    this.talking = null;
    const loader = new GLTFLoader();
    this.ready = Promise.all(RESIDENTS.map(async (spec) => {
      try {
        const actor = new Resident(spec, await loadTracked(loader, `./assets/models/npcs/${spec.model}`));
        this.addLabel(actor);
        this.group.add(actor.group);
        this.actors.push(actor);
      } catch (error) {
        console.error('居民模型加载失败', spec.model, error);
        game.toast?.('居民模型加载失败，请刷新后重试');
      }
    })).then(() => {
      this.actors.sort((a, b) => RESIDENTS.indexOf(a.spec) - RESIDENTS.indexOf(b.spec));
      this.setPads(this.pads);
    });
  }

  addLabel(actor) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#18362fe8'; ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = '#d4bc7b'; ctx.strokeRect(2, 2, 508, 92);
    ctx.fillStyle = '#fff8ec'; ctx.font = '30px "PingFang SC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(actor.spec.name, 256, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
    label.position.y = 2.3; label.scale.set(2.1, 0.39, 1);
    actor.group.add(label);
  }

  setPads(pads) {
    this.pads = pads;
    this.stations = [];
    this.talking = null;
    const env = this.game.flight;
    for (const actor of this.actors) {
      const pad = pads.find((p) => p.id === actor.spec.padId) || null;
      const anchor = actor.spec.station === false ? pad : stationFor(env, pad, actor.spec);
      actor.bind(env, anchor);
      if (actor.spec.station !== false && actor.active) this.stations.push(anchor);
    }
  }

  actorFor(pad) { return this.actors.find((a) => a.active && a.pad === pad); }

  inReach(pad) {
    const actor = this.actorFor(pad), g = this.game, L = g.gameplay.landing;
    if (!actor || !atCounter(L, g.flight, actor)) return false;
    const feet = L.walk?.pos || { x: g.flight.pos.x, y: g.flight.pos.y - L.rest, z: g.flight.pos.z };
    const steps = Math.max(1, Math.ceil(Math.hypot(feet.x - actor.pos.x, feet.z - actor.pos.z) / 0.2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = THREE.MathUtils.lerp(feet.x, actor.pos.x, t), z = THREE.MathUtils.lerp(feet.z, actor.pos.z, t);
      const y = THREE.MathUtils.lerp(feet.y, actor.pos.y, t);
      if ((g.flight.solid?.heightAt(x, z) ?? -Infinity) > y + 0.5 || !bodyClear(g.flight, x, y, z, WALK.height, 0.15)) return false;
    }
    return true;
  }

  nearby() {
    return this.actors.filter((a) => this.inReach(a.pad)).sort((a, b) => a.pos.distanceToSquared(this.game.flight.pos) - b.pos.distanceToSquared(this.game.flight.pos))[0]?.pad || null;
  }

  facePlayer(pad) {
    this.talking = this.actorFor(pad);
    if (!this.talking) return;
    this.talking.transition('Idle');
    this.talking.face(this.game.flight.pos, 1);
  }

  animateDialogue(dt) { this.talking?.mixer.update(dt); }

  update(dt) {
    const g = this.game;
    for (const actor of this.actors) actor.update(dt, g.flight, g.flight.pos, this.inReach(actor.pad));
  }
}
