import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { FIRST_ORDER as ORDER, DeliveryQuest, atCounter } from './quest.js';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('../../vendor/three/build/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL(`../../vendor/three/examples/jsm/${specifier.slice(13)}`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { Courier } = await import('./courier.js');
const { Gameplay } = await import('./index.js');
const { Beacons } = await import('./beacons.js');
const { Hud } = await import('./hud.js');
const { AtlasState } = await import('../core/atlas-state.js');
const { SaveService } = await import('../core/save.js');

function store(initial = null) {
  let value = initial;
  return { get: (key, fallback) => key === 'first-delivery.v1' ? value : fallback, set: (key, next) => { value = structuredClone(next); } };
}
const pad = (id = ORDER.pickup, x = 0, y = 10) => ({ id, name: '回廊', spot: '露台', pos: { x, y, z: 0 } });
const landing = { landed: true, rest: 0.82, walk: { pos: { x: 0, y: 10, z: 0 } } };
const flight = { pos: { x: 0, y: 10.82, z: 0 } };

test('首单端点确实存在于云雀港，路线只绑定固定 ID', () => {
  const town = JSON.parse(readFileSync(new URL('../../assets/town/larkhaven.json', import.meta.url)));
  const from = town.pads.find(p => p.id === ORDER.pickup), to = town.pads.find(p => p.id === ORDER.destination);
  assert.ok(from && to);
  assert.ok(Math.hypot(from.pos[0] - to.pos[0], from.pos[2] - to.pos[2]) > 70);
});

test('明确接单、飞行、顾客交货后只结算一次，自动抵达不完成', () => {
  const s = store(), q = new DeliveryQuest(s);
  assert.equal(q.status, 'available');
  assert.equal(q.deliver(ORDER.destination, true), false);
  assert.equal(q.accept(ORDER.destination, true), false);
  assert.equal(q.accept(ORDER.pickup, false), false);
  assert.equal(q.accept(ORDER.pickup, true), true);
  assert.equal(q.accept(ORDER.pickup, true), false);
  assert.equal(q.carrying, true);
  assert.equal(q.deliver(ORDER.destination, true), false);
  q.learn('fly');
  assert.equal(q.deliver(ORDER.pickup, true), false);
  assert.equal(q.deliver(ORDER.destination, false), false);
  assert.equal(q.deliver(ORDER.destination, true), true);
  assert.equal(q.coins, 30);
  assert.equal(q.carrying, false);
  assert.equal(q.deliver(ORDER.destination, true), false);
  const restored = new DeliveryQuest(s);
  assert.equal(restored.status, 'completed');
  assert.equal(restored.coins, 30);
  assert.equal(restored.accept(ORDER.pickup, true), false);
});

test('进度恢复保留包裹与引导，完成状态与奖励用同一条存档', () => {
  const s = store(), q = new DeliveryQuest(s);
  q.learn('intro'); q.learn('map'); q.accept(ORDER.pickup, true); q.learn('fly');
  const restored = new DeliveryQuest(s);
  assert.equal(restored.status, 'active');
  assert.equal(restored.coins, 0);
  assert.deepEqual(restored.progress, q.progress);
  restored.deliver(ORDER.destination, true);
  assert.equal(s.get('first-delivery.v1').status, 'completed');
});

test('损坏或不兼容存档不会生成奖励或跳过新手步骤', () => {
  for (const saved of [null, [], 'completed', { version: 1, status: 'cheat' }, { version: 2, status: 'completed' }]) {
    const q = new DeliveryQuest(store(saved));
    assert.equal(q.status, 'available'); assert.equal(q.coins, 0);
  }
  const q = new DeliveryQuest(store({ version: 1, status: 'active', intro: 'true', fly: 1 }));
  assert.equal(q.progress.intro, false); assert.equal(q.progress.fly, false);
});

test('交互必须落稳、三米内且同一楼层，步行离开后不能远程交付', () => {
  assert.equal(atCounter(landing, flight, pad()), true);
  assert.equal(atCounter({ ...landing, landed: false }, flight, pad()), false);
  assert.equal(atCounter(landing, flight, pad(ORDER.pickup, 3)), false);
  assert.equal(atCounter(landing, flight, pad(ORDER.pickup, 0, 15)), false);
  assert.equal(atCounter({ ...landing, walk: { pos: { x: 9, y: 10, z: 0 } } }, flight, pad()), false);
  assert.equal(atCounter({ ...landing, walk: null }, flight, pad()), true);
  assert.equal(atCounter(landing, flight, null), false);
});

test('重复引导观测不会逐帧写入存档', () => {
  let writes = 0;
  const q = new DeliveryQuest({ get: () => null, set: () => writes++ });
  q.learn('map'); q.learn('map'); q.learn('__proto__');
  assert.equal(writes, 1);
});

function courierFixture() {
  const messages = [], cards = [], hud = { job() {}, jobAt() {}, order() {}, navigation() {}, card: (...a) => cards.push(a) };
  const game = { state: 'play', paused: false, gameplay: { landing: { ...landing, busy: true, walk: { pos: { x: 0, y: 10, z: 0 } } } },
    flight: { pos: { ...flight.pos }, yaw: 0, gust: 0 }, rider: { sunVis: 1 },
    toast: (s) => messages.push(s), fx: { sprites: { spawn() {} }, burst() {} } };
  const courier = new Courier(game, store(), hud);
  const pickup = pad(), destination = pad(ORDER.destination, 90);
  courier.setPads([pickup, destination]);
  return { courier, game, pickup, destination, messages, cards };
}

test('配送集成：接单后目标改变，落地回调不加币，飞抵顾客确认才结算', () => {
  const { courier: c, game: g, pickup, destination, messages } = courierFixture();
  assert.equal(c.target, pickup);
  c.arrive(pickup); assert.equal(c.quest.status, 'available');
  assert.equal(c.accept(pickup), true); assert.equal(c.target, destination);
  const L = g.gameplay.landing;
  L.busy = false; L.landed = false;
  c.update(0.1, { turn: 1, pitch: 0 });
  g.flight.pos.x = 10; c.update(0.6, { turn: 1, pitch: 0 });
  assert.equal(c.quest.progress.fly, true);
  assert.equal(c.deliver(destination), false);
  L.busy = true; L.landed = true; L.walk.pos.x = 90; g.flight.pos.x = 90;
  c.arrive(destination); assert.equal(c.quest.coins, 0); assert.match(messages.at(-1), /E/);
  assert.equal(c.deliver(destination), true); assert.equal(c.target, null);
  assert.equal(c.count, 1); assert.equal(c.quest.coins, 30); assert.equal(g.flight.gust, 1);
  assert.equal(c.deliver(destination), false); assert.equal(c.count, 1);
});

test('地图航点统一驱动导航，不能改写首单端点或生成可降落平台', () => {
  const { courier: c, game: g, pickup, destination } = courierFixture();
  const atlas = g.atlas = new AtlasState(new SaveService(null), { meta: { world: 6144 } }, [
    { id: 'pad:destination', kind: 'landing', name: destination.name, pos: destination.pos, pad: destination },
  ]);
  const nav = [], jobs = [];
  c.hud.navigation = (...args) => nav.push(args);
  c.hud.job = (...args) => jobs.push(args);
  const pin = atlas.addPin({ x: 1, y: 100, z: 1 }, '山顶');
  atlas.track('pin', pin.id);
  c.update(0.1, { turn: 0, pitch: 0 });
  assert.equal(c.target, pickup); assert.equal(c.navigationTarget, pin);
  assert.equal(nav.at(-1)[0], pin); assert.equal(nav.at(-1)[2], 'pin');
  assert.equal(jobs.at(-1)[0], '山顶');
  assert.match(c.objective(), /不会改变订单/);
  assert.equal(c.accept(pickup), true); assert.equal(c.target, destination);
  assert.equal(c.navigationTarget, pin);
  const gameplay = Object.assign(Object.create(Gameplay.prototype), {
    game: g, courier: c, landing: { busy: false }, hush: 0, zone: null, open: [],
  });
  assert.equal(gameplay._zone(), null);
  gameplay.open = [pickup, destination];
  g.flight.pos = { ...destination.pos };
  atlas.track('landmark', 'pad:destination');
  assert.equal(gameplay.navigationTarget, destination);
  assert.equal(gameplay._zone(), destination);
  atlas.track('quest');
  assert.equal(c.navigationTarget, destination);
  atlas.clearTracking();
  c.update(0.1, { turn: 0, pitch: 0 });
  assert.equal(nav.at(-1)[0], null);
  assert.equal(c.target, destination); assert.equal(c.quest.coins, 0);
});

test('HUD 保留真实平台高差，完成订单后仍可跟踪航点，停止时清空导航', () => {
  const hud = Object.create(Hud.prototype);
  hud.el = Object.fromEntries(['jobCompass', 'jobTracking', 'jobHeight', 'jobDist'].map((id) => [id, { textContent: '', hidden: false }]));
  hud.order('completed', 30, '');
  assert.equal(hud.el.jobCompass.hidden, true);
  hud.navigation({ pos: { y: 80 } }, { pos: { y: 30 } }, 'pin');
  assert.equal(hud.el.jobCompass.hidden, false);
  assert.equal(hud.el.jobHeight.textContent, '高差 +50.0 m');
  assert.match(hud.el.jobTracking.textContent, /地图航点/);
  hud.navigation({ pos: { y: 10 } }, { pos: { y: 30 } }, 'quest');
  assert.equal(hud.el.jobHeight.textContent, '高差 −20.0 m');
  hud.el.jobDist.textContent = '100 m';
  hud.navigation(null, { pos: { y: 30 } }, 'quest');
  assert.equal(hud.el.jobCompass.hidden, true);
  assert.equal(hud.el.jobHeight.textContent, ''); assert.equal(hud.el.jobDist.textContent, '');
});

test('普通图钉只有世界标记，真实平台仍有降落光圈，取消后标记隐藏', () => {
  const real = { ...pad(), radius: 3 }, beacons = new Beacons([real]);
  const player = { x: 0, y: 10, z: 0 }, pin = { pos: { x: 100, y: 90, z: 200 } };
  beacons.update(1, player, null, pin, null);
  assert.deepEqual(beacons.uMark.value.toArray(), [100, 90, 200, 1]);
  assert.equal(beacons.state[0].gold, 0); assert.equal(beacons.state[0].zone, 0);
  beacons.update(1, player, real, real, null);
  assert.ok(beacons.state[0].gold > 0); assert.ok(beacons.state[0].zone > 0);
  assert.deepEqual(beacons.uMark.value.toArray().slice(0, 3), [0, 10, 0]);
  beacons.update(1, player, null, null, null);
  assert.equal(beacons.uMark.value.w, 0);
  beacons.dispose();
});

test('缺少真实端点时不随机分单，暂停和空中不触发交谈', () => {
  const { courier: c, game: g, pickup } = courierFixture();
  c.setPads([pickup]); assert.equal(c.target, null);
  c.dialogue = { show() { throw new Error('不应触发'); } };
  g.paused = true; assert.equal(c.interact(), false);
  g.paused = false; g.gameplay.landing.landed = false; assert.equal(c.interact(), false);
});
