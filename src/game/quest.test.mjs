import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { FIRST_ORDER as ORDER, PARCELS, DeliveryQuest, atCounter } from './quest.js';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('../../vendor/three/build/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL(`../../vendor/three/examples/jsm/${specifier.slice(13)}`, import.meta.url).href, shortCircuit: true };
  return next(specifier);
} });
const { RESIDENTS } = await import('./npc.js');
const { Courier } = await import('./courier.js');
const { Gameplay } = await import('./index.js');
const { Beacons } = await import('./beacons.js');
const { Hud } = await import('./hud.js');
const { AtlasState } = await import('../core/atlas-state.js');
const { SaveService } = await import('../core/save.js');

function store(initial = null, legacy = null) {
  let value = initial;
  return {
    get: (key, fallback) => key === 'delivery.v2' ? value : key === 'first-delivery.v1' ? legacy : fallback,
    set: (key, next) => { value = structuredClone(next); },
  };
}
const landing = { landed: true, rest: 0.82, walk: { pos: { x: 0, y: 10, z: 0 } } };
const flight = { pos: { x: 0, y: 10.82, z: 0 } };

test('站点建在真实的云雀港平台上，首单两端距离够远', () => {
  const town = JSON.parse(readFileSync(new URL('../../assets/town/larkhaven.json', import.meta.url)));
  const pads = new Set(town.pads.map((p) => p.id));
  for (const spec of RESIDENTS) assert.ok(pads.has(spec.padId), `${spec.name} 的 ${spec.padId} 不在云雀港`);
  const guild = town.pads.find((p) => p.id === RESIDENTS[0].padId);
  const teahouse = town.pads.find((p) => p.id === RESIDENTS[1].padId);
  assert.ok(Math.hypot(guild.pos[0] - teahouse.pos[0], guild.pos[2] - teahouse.pos[2]) > 70);
});

const tea = () => ({ id: ORDER.id, from: ORDER.pickup, to: ORDER.destination, parcel: ORDER.parcel, reward: ORDER.reward });
const parcel = (id, to = 'customs', reward = 21) => ({ id, from: 'guild', to, parcel: PARCELS[0], reward });
const ledger = (changes = {}) => ({ version: 2, orders: [], coins: 0, delivered: 0, firstDone: false, ...changes });

test('多单可并行接取，逐站交付且每单只结算一次，教程单先飞一段', () => {
  const s = store(), q = new DeliveryQuest(s);
  assert.equal(q.carrying, false);
  assert.equal(q.firstDone, false);
  assert.deepEqual(q.deliver(ORDER.destination, true), [], '无单可交');
  const late = { ...parcel('errand-late'), from: 'oldkeep' };
  assert.equal(q.accept(late), true);
  assert.equal(q.accept(late), false, '重复 id 拒绝');
  assert.equal(q.accept({ id: 'broken' }), false, '残缺订单拒绝');
  assert.equal(q.accept(tea()), true);
  assert.equal(q.carrying, true);
  assert.deepEqual(q.deliver(ORDER.destination, true), [], '教程单要先飞一段才能交付');
  q.learn('fly');
  assert.deepEqual(q.deliver(ORDER.destination, false), [], '不在柜台不能交付');
  assert.deepEqual(q.deliver(ORDER.destination, true), [tea()]);
  assert.equal(q.coins, ORDER.reward); assert.equal(q.firstDone, true);
  assert.equal(q.carrying, true, '另一单还在手上');
  assert.deepEqual(q.deliver('customs', true), [late]);
  assert.equal(q.coins, ORDER.reward + 21); assert.equal(q.delivered, 2);
  assert.equal(q.carrying, false);
  for (const current of [q, new DeliveryQuest(s)]) {
    assert.equal(current.accept(tea()), false);
    assert.equal(current.accept(late), false, '已完成订单不能重新接取');
    assert.deepEqual(current.deliver('customs', true), [], '不重复结算');
    assert.deepEqual(current.deliver(ORDER.destination, true), []);
    assert.equal(current.coins, ORDER.reward + 21); assert.equal(current.delivered, 2);
  }
});

test('offer 只发给其他站点，字段完整；账本与进度同存一份存档', () => {
  const s = store(), q = new DeliveryQuest(s);
  const ids = ['guild', 'teahouse', 'customs'];
  const order = q.offer('guild', ids, () => 0.99);
  assert.equal(order.from, 'guild'); assert.equal(order.to, 'customs');
  assert.ok(PARCELS.includes(order.parcel)); assert.equal(order.reward, 31);
  assert.equal(q.offer('guild', ['guild']), null, '没有别的站点就没有单');
  q.learn('intro'); q.learn('map');
  assert.equal(q.accept(order), true);
  q.learn('fly');
  const restored = new DeliveryQuest(s);
  assert.deepEqual(restored.orders, q.orders);
  assert.equal(restored.carrying, true); assert.equal(restored.coins, 0);
  assert.deepEqual(restored.progress, q.progress);
});

test('160 单同时携带，来自不同站点；分站结算并重载后仍可无限续单', () => {
  const s = store(), ids = ['guild', 'teahouse', 'customs', 'oldkeep'];
  let q = new DeliveryQuest(s);
  const orders = Array.from({ length: 160 }, (_, i) => q.offer(ids[i % ids.length], ids, () => i % 2 ? 0.99 : 0));
  assert.deepEqual(orders.map((o) => o.id), orders.map((_, i) => `errand-${i + 1}`));
  for (const order of orders.toReversed()) {
    assert.notEqual(order.from, order.to);
    assert.equal(q.accept(order), true);
    assert.equal(q.accept(order), false);
  }
  assert.equal(q.orders.length, 160);
  q = new DeliveryQuest(s);
  assert.deepEqual(q.orders, orders.toReversed());
  assert.equal(q.progress.fly, false);
  assert.deepEqual(q.deliver('missing', true), []);
  assert.deepEqual(q.deliver('customs', false), []);
  let coins = 0, delivered = 0;
  for (const id of ids) {
    const expected = orders.toReversed().filter((order) => order.to === id);
    assert.deepEqual(q.deliver(id, true), expected);
    coins += expected.reduce((sum, order) => sum + order.reward, 0);
    delivered += expected.length;
    q = new DeliveryQuest(s);
    assert.equal(q.coins, coins); assert.equal(q.delivered, delivered);
    assert.deepEqual(q.deliver(id, true), []);
    for (const order of expected) assert.equal(q.accept(order), false);
  }
  assert.equal(q.carrying, false); assert.equal(q.delivered, 160);
  for (let i = 0; i < 120; i++) {
    const order = q.offer('guild', ids, () => 0);
    assert.equal(order.id, `errand-${161 + i}`);
    assert.equal(q.accept(order), true);
    assert.deepEqual(q.deliver(order.to, true), [order]);
    assert.equal(q.accept(order), false);
  }
  assert.equal(new DeliveryQuest(s).delivered, 280);
});

test('同目的地的普通包裹独立结算，不被待飞行的教程茶阻塞', () => {
  const s = store(), q = new DeliveryQuest(s);
  const first = parcel('same-a', ORDER.destination), second = parcel('same-b', ORDER.destination, 0);
  for (const order of [tea(), first, second]) assert.equal(q.accept(order), true);
  assert.deepEqual(q.deliver(ORDER.destination, true), [first, second]);
  assert.equal(q.coins, 21); assert.equal(q.delivered, 2); assert.equal(q.firstDone, false);
  assert.deepEqual(q.orders, [tea()]);
  const next = q.offer('guild', ['guild', ORDER.destination], () => 0);
  assert.equal(q.accept(next), true);
  assert.deepEqual(q.deliver(ORDER.destination, true), [next]);
  const restored = new DeliveryQuest(s);
  assert.deepEqual(restored.deliver(ORDER.destination, true), []);
  restored.learn('fly');
  assert.deepEqual(restored.deliver(ORDER.destination, true), [tea()]);
  assert.equal(restored.coins, 21 + next.reward + ORDER.reward);
  assert.equal(restored.delivered, 4);
  assert.equal(restored.accept(first), false);
  assert.equal(restored.accept(tea()), false);
});

test('未接取的报价也持久化单调序号，重复随机值和超大序号不会碰撞', () => {
  const s = store(), ids = ['guild', 'customs'];
  let q = new DeliveryQuest(s);
  const offers = Array.from({ length: 140 }, () => q.offer('guild', ids, () => 0));
  assert.equal(new Set(offers.map((o) => o.id)).size, 140);
  q = new DeliveryQuest(s);
  assert.equal(q.offer('guild', ids, () => 0).id, 'errand-141');
  assert.equal(q.accept(offers[0]), true, '旧的未接报价仍有效');
  assert.equal(q.accept(parcel('errand-200')), true);
  assert.equal(q.offer('guild', ids, () => 0).id, 'errand-201');
  for (const invalid of [-1, 1.5, Infinity, NaN, '1.5', '-2', {}, null]) {
    const recovered = new DeliveryQuest(store(ledger({ sequence: invalid, orders: [parcel('errand-10')], settledIds: ['errand-20'] })));
    assert.equal(recovered.offer('guild', ids, () => 0).id, 'errand-21');
    assert.equal(recovered.accept(parcel('errand-20')), false);
  }
  const large = store(ledger({ sequence: '9007199254740992' }));
  assert.equal(new DeliveryQuest(large).offer('guild', ids, () => 0).id, 'errand-9007199254740993');
  assert.equal(new DeliveryQuest(large).offer('guild', ids, () => 0).id, 'errand-9007199254740994');
});

test('旧 available/active/completed 保留全部教程标志，active 保留茶，completed 只算 30 币一次', () => {
  const keys = ['intro', 'move', 'map', 'fly', 'walk'];
  for (const status of ['available', 'active', 'completed']) {
    for (let mask = 0; mask < 32; mask++) {
      const progress = Object.fromEntries(keys.map((key, i) => [key, !!(mask & (1 << i))]));
      const s = store(null, { version: 1, status, ...progress });
      const q = new DeliveryQuest(s);
      assert.deepEqual(q.progress, progress);
      assert.equal(q.firstDone, status === 'completed');
      assert.equal(q.coins, status === 'completed' ? 30 : 0);
      assert.equal(q.delivered, status === 'completed' ? 1 : 0);
      assert.deepEqual(q.orders, status === 'active' ? [tea()] : []);
      assert.equal(s.get('delivery.v2').version, 2);
      const restored = new DeliveryQuest(s);
      assert.deepEqual(restored.progress, progress);
      assert.deepEqual(restored.orders, q.orders);
      if (status === 'completed') {
        assert.equal(restored.accept(tea()), false);
        assert.deepEqual(restored.deliver(ORDER.destination, true), []);
        assert.equal(restored.coins, 30); assert.equal(restored.delivered, 1);
      } else {
        if (status === 'available') assert.equal(restored.accept(tea()), true);
        if (!progress.fly) assert.deepEqual(restored.deliver(ORDER.destination, true), []);
        restored.learn('fly');
        assert.deepEqual(restored.deliver(ORDER.destination, true), [tea()]);
        assert.equal(restored.coins, 30); assert.equal(restored.delivered, 1);
        assert.equal(new DeliveryQuest(s).accept(tea()), false);
      }
    }
  }
});

test('坏旧档和已有 v2 不回退旧奖励，引导标志只接受 true', () => {
  for (const legacy of [null, { version: 1, status: 'invalid' }, { version: 2, status: 'completed' }, [], 'completed']) {
    const fresh = new DeliveryQuest(store(null, legacy));
    assert.equal(fresh.firstDone, false); assert.equal(fresh.coins, 0); assert.equal(fresh.delivered, 0);
    assert.deepEqual(fresh.orders, []);
  }
  for (const saved of [ledger(), {}, [], false, 'broken', { version: 2, orders: null }, { version: 3, orders: [] }]) {
    const q = new DeliveryQuest(store(saved, { version: 1, status: 'completed', fly: true }));
    assert.equal(q.coins, 0); assert.equal(q.delivered, 0); assert.equal(q.firstDone, false);
    assert.equal(q.progress.fly, false);
  }
  for (const s of [store(ledger({ intro: 'true', move: 1, map: true, fly: [], walk: {} })),
    store(null, { version: 1, status: 'active', intro: 'true', move: 1, map: true, fly: [], walk: {} })]) {
    assert.deepEqual(new DeliveryQuest(s).progress, { intro: false, move: false, map: true, fly: false, walk: false });
  }
});

test('损坏订单不舍入或钳制奖励，去重 id 并阻止完成后的首单重接', () => {
  const badRewards = [-1, -0.1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '30', null, true, undefined];
  const bad = [null, [], 'order', {}, ...badRewards.map((reward, i) => ({ ...parcel(`bad-${i}`), reward })),
    ...['id', 'from', 'to', 'parcel'].flatMap((key) => ['', '   ', 42, null, {}].map((value) => ({ ...parcel('bad'), [key]: value }))),
    { ...parcel('same'), to: 'guild' }, { ...tea(), reward: 31 }, { ...tea(), to: 'customs' }, { ...tea(), parcel: '假茶' }];
  for (const order of bad) {
    const q = new DeliveryQuest(store(ledger({ orders: [order], fly: true })));
    assert.deepEqual(q.orders, [], JSON.stringify(order));
    assert.equal(q.accept(order), false);
    assert.deepEqual(q.deliver('customs', true), []);
    assert.equal(q.coins, 0); assert.equal(q.delivered, 0);
  }
  const good = parcel('duplicate');
  const q = new DeliveryQuest(store(ledger({ orders: [good, { ...good, reward: 999 }, tea(), tea()], fly: true })));
  assert.deepEqual(q.orders, [good, tea()]);
  assert.deepEqual(q.deliver('customs', true), [good]);
  assert.deepEqual(q.deliver(ORDER.destination, true), [tea()]);
  assert.equal(q.coins, 51); assert.equal(q.delivered, 2);
  const finished = new DeliveryQuest(store(ledger({ orders: [tea()], firstDone: true, coins: 30, delivered: 1 })));
  assert.deepEqual(finished.orders, []);
  assert.equal(finished.accept(tea()), false);
  finished.learn('fly');
  assert.deepEqual(finished.deliver(ORDER.destination, true), []);
  assert.equal(finished.coins, 30); assert.equal(finished.delivered, 1);
});

test('计数必须为安全非负整数，溢出不结算、不损失待送订单', () => {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '30', null, true, {}]) {
    const q = new DeliveryQuest(store(ledger({ coins: value, delivered: value })));
    assert.equal(q.coins, 0); assert.equal(q.delivered, 0);
  }
  for (const key of ['coins', 'delivered']) {
    const q = new DeliveryQuest(store(ledger({ [key]: Number.MAX_SAFE_INTEGER, orders: [parcel('overflow')] })));
    assert.deepEqual(q.deliver('customs', true), []);
    assert.deepEqual(q.orders, [parcel('overflow')]);
    assert.equal(q[key], Number.MAX_SAFE_INTEGER);
  }
  const original = parcel('copy');
  const q = new DeliveryQuest(store());
  assert.equal(q.accept(original), true);
  original.reward = 999;
  assert.equal(q.deliver('customs', true)[0].reward, 21);
  assert.equal(q.coins, 21);
});

test('非法站点或随机值不生成坏订单，也不消耗序号', () => {
  const q = new DeliveryQuest(store());
  for (const value of [-1, 1, NaN, Infinity, '0.5']) assert.equal(q.offer('guild', ['customs'], () => value), null);
  assert.equal(q.offer('', ['customs']), null);
  assert.equal(q.offer('guild', null), null);
  assert.equal(q.offer('guild', [null, '', 'guild']), null);
  assert.equal(q.offer('guild', ['customs'], () => 0).id, 'errand-1');
});

test('交互必须落稳、三米内且同一楼层，步行离开后不能远程交付', () => {
  const point = (x = 0, y = 10) => ({ pos: { x, y, z: 0 } });
  assert.equal(atCounter(landing, flight, point()), true);
  assert.equal(atCounter({ ...landing, landed: false }, flight, point()), false);
  assert.equal(atCounter(landing, flight, point(3)), false);
  assert.equal(atCounter(landing, flight, point(0, 15)), false);
  assert.equal(atCounter({ ...landing, walk: { pos: { x: 9, y: 10, z: 0 } } }, flight, point()), false);
  assert.equal(atCounter({ ...landing, walk: null }, flight, point()), true);
  assert.equal(atCounter(landing, flight, null), false);
});

test('重复引导观测不会逐帧写入存档', () => {
  let writes = 0;
  const q = new DeliveryQuest({ get: () => null, set: () => writes++ });
  q.learn('map'); q.learn('map'); q.learn('__proto__');
  assert.equal(writes, 1);
});

function courierFixture(s = store()) {
  const messages = [], cards = [], hud = { job() {}, jobAt() {}, order() {}, navigation() {}, card: (...a) => cards.push(a) };
  const guild = { id: ORDER.pickup, name: '信使公会', pos: { x: 0, y: 10, z: 0 }, pad: { id: 'p1', name: '回廊', pos: { x: 0, y: 10, z: 0 } } };
  const teahouse = { id: ORDER.destination, name: '露台茶馆', pos: { x: 90, y: 10, z: 0 }, pad: { id: 'p2', name: '露台', pos: { x: 90, y: 10, z: 0 } } };
  const game = { state: 'play', paused: false, gameplay: { landing: { ...landing, busy: true, walk: { pos: { x: 0, y: 10, z: 0 } } } },
    flight: { pos: { ...flight.pos }, yaw: 0, gust: 0 }, rider: { sunVis: 1 },
    toast: (s) => messages.push(s), fx: { sprites: { spawn() {} }, burst() {} } };
  const courier = new Courier(game, s, hud);
  courier.npcs = { stations: [guild, teahouse], update() {},
    inReach: (p) => atCounter(game.gameplay.landing, game.flight, p),
    nearby: () => game.gameplay.landing.landed ? guild : null };
  return { courier, game, guild, teahouse, messages, cards };
}

test('配送集成：接单后目标改变，落地回调不加币，飞抵顾客确认才结算', () => {
  const { courier: c, game: g, guild, teahouse, messages } = courierFixture();
  assert.equal(c.target, guild, '新手引导指向阿岚');
  c.arrive(guild.pad); assert.equal(c.quest.carrying, false);
  const offer = c.offerFor(guild);
  assert.equal(offer.id, ORDER.id);
  assert.equal(c.accept(offer), true); assert.equal(c.target, teahouse);
  const L = g.gameplay.landing;
  L.busy = false; L.landed = false;
  c.update(0.1, { turn: 1, pitch: 0 });
  g.flight.pos.x = 10; c.update(0.6, { turn: 1, pitch: 0 });
  assert.equal(c.quest.progress.fly, true);
  assert.equal(c.deliver(teahouse), false);
  L.busy = true; L.landed = true; L.walk.pos.x = 90; g.flight.pos.x = 90;
  c.arrive(teahouse.pad); assert.equal(c.quest.coins, 0); assert.match(messages.at(-1), /E/);
  assert.equal(c.deliver(teahouse), true); assert.equal(c.target, null);
  assert.equal(c.count, 1); assert.equal(c.quest.coins, ORDER.reward); assert.equal(g.flight.gust, 1);
  assert.equal(c.deliver(teahouse), false); assert.equal(c.count, 1);
});

test('配送集成：旧配送数由 Courier 单独相加，迁移首单只结算一次', () => {
  for (const status of ['active', 'completed']) {
    const s = new SaveService(null);
    s.set('deliveries.v1', 7);
    s.set('first-delivery.v1', { version: 1, status, intro: true, move: true, map: true, fly: true, walk: true });
    const { courier: c, game: g, teahouse } = courierFixture(s);
    assert.equal(c.count, status === 'completed' ? 8 : 7);
    assert.equal(c.quest.delivered, status === 'completed' ? 1 : 0);
    assert.equal(c.quest.coins, status === 'completed' ? 30 : 0);
    g.gameplay.landing.walk.pos.x = 90;
    g.flight.pos.x = 90;
    assert.equal(c.deliver(teahouse), status === 'active');
    assert.equal(c.count, 8); assert.equal(c.quest.coins, 30); assert.equal(c.quest.delivered, 1);
    assert.equal(c.deliver(teahouse), false);
    assert.equal(c.quest.accept(tea()), false);
    const restored = courierFixture(s).courier;
    assert.equal(restored.count, 8); assert.equal(restored.quest.coins, 30);
    assert.equal(s.get('deliveries.v1'), 7);
  }
});

test('地图航点统一驱动导航，不能改写订单端点或生成可降落平台', () => {
  const { courier: c, game: g, guild, teahouse } = courierFixture();
  const atlas = g.atlas = new AtlasState(new SaveService(null), { meta: { world: 6144 } }, [
    { id: 'pad:destination', kind: 'landing', name: teahouse.name, pos: teahouse.pos, pad: teahouse.pad },
  ]);
  const nav = [], jobs = [];
  c.hud.navigation = (...args) => nav.push(args);
  c.hud.job = (...args) => jobs.push(args);
  const pin = atlas.addPin({ x: 1, y: 100, z: 1 }, '山顶');
  atlas.track('pin', pin.id);
  c.update(0.1, { turn: 0, pitch: 0 });
  assert.equal(c.target, guild); assert.equal(c.navigationTarget, pin);
  assert.equal(nav.at(-1)[0], pin); assert.equal(nav.at(-1)[2], 'pin');
  assert.equal(jobs.at(-1)[0], '山顶');
  assert.match(c.objective(), /不会改变订单/);
  assert.equal(c.accept(c.offerFor(guild)), true); assert.equal(c.target, teahouse);
  assert.equal(c.navigationTarget, pin);
  const gameplay = Object.assign(Object.create(Gameplay.prototype), {
    game: g, courier: c, landing: { busy: false }, hush: 0, zone: null, open: [],
  });
  assert.equal(gameplay._zone(), null);
  gameplay.open = [guild.pad, teahouse.pad];
  g.flight.pos = { ...teahouse.pos };
  atlas.track('landmark', 'pad:destination');
  assert.equal(gameplay.navigationTarget, teahouse.pad);
  assert.equal(gameplay._zone(), teahouse.pad);
  atlas.track('quest');
  assert.equal(c.navigationTarget, teahouse);
  atlas.clearTracking();
  c.update(0.1, { turn: 0, pitch: 0 });
  assert.equal(nav.at(-1)[0], null);
  assert.equal(c.target, teahouse); assert.equal(c.quest.coins, 0);
});

test('地面订单附近不吸附屋顶，主动跟踪屋顶地标仍可正常降落', () => {
  const { courier: c, game: g, teahouse } = courierFixture();
  const roof = teahouse.pad;
  roof.pos.y = 30;
  delete teahouse.pad;
  teahouse.street = true;
  c.trackStation(teahouse.id);
  g.flight.pos = { ...teahouse.pos, y: 26 };
  const atlas = g.atlas = new AtlasState(new SaveService(null), { meta: { world: 6144 } }, [
    { id: 'pad:roof', kind: 'landing', name: roof.name, pos: roof.pos, pad: roof },
  ]);
  const gameplay = Object.assign(Object.create(Gameplay.prototype), {
    game: g, courier: c, landing: { busy: false }, hush: 0, zone: null, open: [roof],
  });
  atlas.track('quest');
  assert.equal(gameplay.navigationTarget, teahouse);
  assert.equal(gameplay._zone(), null);
  atlas.track('landmark', 'pad:roof');
  assert.equal(gameplay._zone(), roof);
  assert.equal(c.target, teahouse);
});

test('HUD 保留真实平台高差，完成订单后仍可跟踪航点，停止时清空导航', () => {
  const hud = Object.create(Hud.prototype);
  hud.el = Object.fromEntries(['jobCompass', 'jobTracking', 'jobHeight', 'jobDist'].map((id) => [id, { textContent: '', hidden: false }]));
  hud.order('自由接单 · 任意站点可接', 30, '');
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
  const real = { pos: { x: 0, y: 10, z: 0 }, radius: 3 }, beacons = new Beacons([real]);
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

test('缺少其他站点时不随机分单，暂停和空中不触发交谈', () => {
  const { courier: c, game: g, guild } = courierFixture();
  c.npcs.stations = [guild];
  assert.equal(c.target, guild);
  assert.equal(c.offerFor(guild), null);
  c.dialogue = { show() { throw new Error('不应触发'); } };
  g.paused = true; assert.equal(c.interact(), false);
  g.paused = false; g.gameplay.landing.landed = false; assert.equal(c.interact(), false);
});
