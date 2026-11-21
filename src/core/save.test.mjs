import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveService } from './save.js';
import { DeliveryQuest, FIRST_ORDER } from '../game/quest.js';

const KEY = 'petalwake.save.v2';
const legacyKey = (key) => `petalwake.${key}`;
const envelope = (data) => JSON.stringify({ version: 2, data });
const quest = (status = 'completed') => ({ version: 1, status, intro: true, move: true, map: true, fly: true, walk: false });
const world = () => ({ version: 1, day: 8, hour: 13.5, running: true, season: 'spring', weather: 'clear' });

class Storage {
  constructor(entries = {}) {
    this.items = new Map(Object.entries(entries));
    this.reads = [];
    this.writes = [];
    this.attempts = 0;
    this.failRead = false;
    this.failWrite = false;
  }
  getItem(key) {
    this.reads.push(key);
    if (this.failRead === true || this.failRead === key) throw new Error('SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key, value) {
    this.attempts++;
    if (this.failWrite) throw new Error('QuotaExceededError');
    assert.equal(typeof value, 'string');
    this.writes.push({ key, value });
    this.items.set(key, value);
  }
}

function browserStorage(t, descriptor) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
  t.after(() => {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  });
}

function contents(storage) { return JSON.parse(storage.items.get(KEY)); }

test('新存档不凭空写入；缺失键返回独立 fallback', () => {
  const storage = new Storage();
  const save = new SaveService(storage);
  assert.equal(save.status, 'saved');
  assert.equal(save.flush(), true);
  assert.equal(save.get('missing'), undefined);
  const fallback = { nested: { ids: [] } };
  const result = save.get('missing', fallback);
  result.nested.ids.push('changed');
  assert.deepEqual(fallback, { nested: { ids: [] } });
  assert.deepEqual(save.get('missing', fallback), fallback);
  assert.equal(save.get('toString', 'fallback'), 'fallback');
  assert.equal(storage.writes.length, 0);
});

test('一次迁移四个 legacy key，保留原文，重复加载不重复写入或回退 legacy', () => {
  const originals = {
    [legacyKey('first-delivery.v1')]: JSON.stringify(quest()),
    [legacyKey('kickflip.v1')]: 'true',
    [legacyKey('deliveries.v1')]: '7',
    [legacyKey('treasures.v1')]: '["west:1","east:2"]',
  };
  const storage = new Storage(originals);
  const save = new SaveService(storage);
  assert.equal(save.status, 'saved');
  assert.deepEqual(contents(storage), { version: 2, data: {
    'first-delivery.v1': quest(), 'kickflip.v1': true, 'deliveries.v1': 7, 'treasures.v1': ['west:1', 'east:2'],
  } });
  assert.equal(storage.writes.length, 1);
  assert.ok(storage.writes.every((write) => write.key === KEY));
  for (const [key, raw] of Object.entries(originals)) assert.equal(storage.items.get(key), raw);
  storage.items.set(legacyKey('deliveries.v1'), '999');
  storage.reads.length = 0;
  const restored = new SaveService(storage);
  assert.equal(restored.get('deliveries.v1'), 7);
  assert.equal(restored.flush(), true);
  assert.deepEqual(storage.reads, [KEY]);
  assert.equal(storage.writes.length, 1);
});

test('旧 completed 仍只提供一份首单奖励，不增加历史配送数，也不能重新结算', () => {
  const storage = new Storage({
    [legacyKey('first-delivery.v1')]: JSON.stringify(quest()),
    [legacyKey('deliveries.v1')]: '4',
  });
  for (let i = 0; i < 3; i++) {
    const save = new SaveService(storage);
    const order = new DeliveryQuest(save);
    assert.equal(order.status, 'completed');
    assert.equal(order.coins, FIRST_ORDER.reward);
    assert.equal(order.accept(FIRST_ORDER.pickup, true), false);
    assert.equal(order.deliver(FIRST_ORDER.destination, true), false);
    order.learn('walk');
    assert.equal(save.get('deliveries.v1'), 4);
    assert.equal(save.get('coins', 0), 0);
  }
  assert.equal(storage.writes.length, 2); // migration, then the first walk observation
});

test('合法 available/active 首单状态及 false/0 也迁移，不补发奖励', () => {
  for (const status of ['available', 'active']) {
    const storage = new Storage({
      [legacyKey('first-delivery.v1')]: JSON.stringify(quest(status)),
      [legacyKey('kickflip.v1')]: 'false',
      [legacyKey('deliveries.v1')]: '0',
      [legacyKey('treasures.v1')]: '[]',
    });
    const save = new SaveService(storage);
    assert.deepEqual(save.get('first-delivery.v1'), quest(status));
    assert.equal(save.get('kickflip.v1', true), false);
    assert.equal(save.get('deliveries.v1', 10), 0);
    assert.deepEqual(save.get('treasures.v1'), []);
    assert.equal(new DeliveryQuest(save).coins, 0);
  }
});

test('legacy 只迁移合法部分，不把字符串/数字当作解锁或引导完成', () => {
  const storage = new Storage({
    [legacyKey('first-delivery.v1')]: JSON.stringify({ version: 1, status: 'active', intro: 'true', move: 1, map: true, fly: null }),
    [legacyKey('kickflip.v1')]: '"true"',
    [legacyKey('deliveries.v1')]: '"99"',
    [legacyKey('treasures.v1')]: '["west:1",42,null,"",{},"   ","west:1","east:2"]',
  });
  const save = new SaveService(storage);
  assert.deepEqual(save.get('first-delivery.v1'), { version: 1, status: 'active', intro: false, move: false, map: true, fly: false, walk: false });
  assert.equal(save.get('kickflip.v1', false), false);
  assert.equal(save.get('deliveries.v1', 0), 0);
  assert.deepEqual(save.get('treasures.v1'), ['west:1', 'east:2']);
  assert.equal(new DeliveryQuest(save).coins, 0);
  assert.equal(new DeliveryQuest(save).deliver(FIRST_ORDER.destination, true), false);
});

test('损坏 legacy 彼此隔离；不合法任务、计数或收藏不产生奖励', () => {
  const badQuests = ['{', 'null', '[]', '"completed"', '{"version":2,"status":"completed"}', '{"version":1,"status":"cheat"}'];
  const badCounts = ['-1', '1.5', '1e400', '9007199254740992', 'null', 'true'];
  for (let i = 0; i < badQuests.length; i++) {
    const save = new SaveService(new Storage({
      [legacyKey('first-delivery.v1')]: badQuests[i],
      [legacyKey('deliveries.v1')]: badCounts[i],
      [legacyKey('treasures.v1')]: '{"0":"fake"}',
      [legacyKey('kickflip.v1')]: 'true',
    }));
    assert.equal(save.get('first-delivery.v1', null), null);
    assert.equal(save.get('deliveries.v1', 0), 0);
    assert.deepEqual(save.get('treasures.v1', []), []);
    assert.equal(save.get('kickflip.v1'), true);
    assert.equal(new DeliveryQuest(save).coins, 0);
  }
});

test('多个系统合并到单一 envelope，world.v1 不做结构解释，重载完整还原', () => {
  const storage = new Storage();
  const save = new SaveService(storage);
  const systems = { 'first-delivery.v1': quest('active'), 'kickflip.v1': true, 'deliveries.v1': 9, 'treasures.v1': ['hidden'], 'world.v1': world() };
  for (const [key, value] of Object.entries(systems)) assert.equal(save.set(key, value), true);
  assert.deepEqual(contents(storage), { version: 2, data: systems });
  assert.equal(storage.items.size, 1);
  const restored = new SaveService(storage);
  for (const [key, value] of Object.entries(systems)) assert.deepEqual(restored.get(key), value);
  assert.equal(storage.writes.length, Object.keys(systems).length);
});

test('set 输入及 get 输出均深拷贝；null/false/0 不错误回退', () => {
  const save = new SaveService(new Storage());
  const value = { list: [{ nested: { value: 1 } }] };
  assert.equal(save.set('custom.v1', value), true);
  value.list[0].nested.value = 2;
  const read = save.get('custom.v1');
  assert.equal(read.list[0].nested.value, 1);
  read.list[0].nested.value = 3;
  read.list.push('new');
  assert.deepEqual(save.get('custom.v1'), { list: [{ nested: { value: 1 } }] });
  for (const value of [null, false, 0, '']) {
    assert.equal(save.set('value', value), true);
    assert.equal(save.get('value', 'fallback'), value);
  }
});

test('恶意存档键在任意深度被过滤；不污染原型，不通过继承读取', () => {
  const raw = '{"version":2,"data":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{},"safe":{"__proto__":{"polluted":true},"constructor":{},"prototype":{},"list":[{"ok":1,"__proto__":{"polluted":true}}]}}}';
  const storage = new Storage({ [KEY]: raw });
  const save = new SaveService(storage);
  assert.equal(save.status, 'saved');
  for (const key of ['__proto__', 'constructor', 'prototype', '', null, {}, 7, Symbol('bad')]) {
    assert.equal(save.set(key, { polluted: true }), false);
    assert.equal(save.get(key, 'fallback'), 'fallback');
  }
  assert.equal(storage.items.get(KEY), raw); // no eager rewrite of a loaded snapshot
  assert.deepEqual(save.get('safe'), { list: [{ ok: 1 }] });
  assert.equal(save.set('incoming', JSON.parse('{"nested":{"constructor":{},"__proto__":{},"ok":2}}')), true);
  assert.deepEqual(save.get('incoming'), { nested: { ok: 2 } });
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(contents(storage).data, '__proto__'), false);
  assert.equal(save.get('hasOwnProperty', false), false);
});

test('普通未知 JSON 数据完整保留，更新已知系统不会丢失扩展字段', () => {
  const unknown = { version: 17, nested: { settings: [null, false, 0, '新数据'], toString: 'plain data' } };
  const storage = new Storage({ [KEY]: envelope({ 'plugin.v17': unknown, 'world.v1': { ...world(), extension: { cloud: 0.4 } } }) });
  const save = new SaveService(storage);
  assert.equal(save.set('kickflip.v1', true), true);
  assert.deepEqual(contents(storage).data['plugin.v17'], unknown);
  assert.deepEqual(new SaveService(storage).get('world.v1'), { ...world(), extension: { cloud: 0.4 } });
});

for (const raw of ['', '{', 'null', '[]', '42', '{}', '{"version":2}', '{"version":2,"data":null}', '{"version":2,"data":[]}', '{"version":2,"data":"bad"}', '{"version":1,"data":{}}', '{"version":"3","data":{}}', '{"version":2.5,"data":{}}']) {
  test(`损坏/未知版本 v2 原文保全且不回退奖励 legacy: ${raw || '(empty)'}`, () => {
    const storage = new Storage({ [KEY]: raw, [legacyKey('first-delivery.v1')]: JSON.stringify(quest()), [legacyKey('kickflip.v1')]: 'true' });
    const save = new SaveService(storage);
    assert.equal(save.status, 'corrupt');
    assert.deepEqual(storage.reads, [KEY]);
    assert.equal(new DeliveryQuest(save).coins, 0);
    assert.equal(save.get('kickflip.v1', false), false);
    assert.equal(save.set('world.v1', world()), false);
    assert.deepEqual(save.get('world.v1'), world());
    assert.equal(save.flush(), false);
    assert.equal(save.status, 'corrupt');
    assert.equal(storage.items.get(KEY), raw);
    assert.equal(storage.attempts, 0);
  });
}

test('未来版本包括未知结构都不加载、不迁移、不覆盖，告警保持到会话结束', () => {
  for (const raw of ['{"version":3,"data":{"kickflip.v1":true}}', '{"version":100,"newFormat":[1,2,3]}']) {
    const storage = new Storage({ [KEY]: raw, [legacyKey('kickflip.v1')]: 'true' });
    const save = new SaveService(storage);
    assert.equal(save.status, 'future');
    assert.equal(save.get('kickflip.v1', false), false);
    assert.equal(save.set('kickflip.v1', true), false);
    assert.equal(save.get('kickflip.v1'), true);
    assert.equal(save.set('kickflip.v1', true), false);
    assert.equal(save.flush(), false);
    assert.equal(save.status, 'future');
    assert.equal(storage.items.get(KEY), raw);
    assert.equal(storage.attempts, 0);
    assert.deepEqual(storage.reads, [KEY]);
  }
});

test('现有合法空 v2 也阻止 legacy 重放', () => {
  const storage = new Storage({ [KEY]: envelope({}), [legacyKey('first-delivery.v1')]: JSON.stringify(quest()) });
  const save = new SaveService(storage);
  assert.equal(save.get('first-delivery.v1', null), null);
  assert.equal(save.flush(), true);
  assert.equal(storage.attempts, 0);
  assert.deepEqual(storage.reads, [KEY]);
});

test('默认浏览器 storage 正常使用，显式 null 不访问浏览器 storage', (t) => {
  const storage = new Storage();
  let accesses = 0;
  browserStorage(t, { get() { accesses++; return storage; } });
  const save = new SaveService();
  assert.equal(save.set('world.v1', world()), true);
  assert.equal(accesses, 1);
  const memory = new SaveService(null);
  assert.equal(memory.set('world.v1', world()), false);
  assert.equal(memory.status, 'memory');
  assert.equal(accesses, 1);
  assert.deepEqual(memory.get('world.v1'), world());
});

test('localStorage 属性抛出安全异常时保留内存，恢复访问后 flush 重试', (t) => {
  const storage = new Storage();
  let denied = true;
  browserStorage(t, { get() { if (denied) throw new Error('SecurityError'); return storage; } });
  const save = new SaveService();
  assert.equal(save.status, 'memory');
  assert.equal(save.set('world.v1', world()), false);
  const result = save.get('world.v1');
  result.day = 99;
  assert.deepEqual(save.get('world.v1'), world());
  assert.equal(save.flush(), false);
  denied = false;
  assert.equal(save.flush(), true);
  assert.equal(save.status, 'saved');
  assert.deepEqual(contents(storage).data['world.v1'], world());
});

test('没有 localStorage 的环境可直接导入、构造并在内存使用', (t) => {
  browserStorage(t, { value: undefined });
  const save = new SaveService();
  assert.equal(save.set('treasures.v1', ['one']), false);
  assert.deepEqual(save.get('treasures.v1'), ['one']);
  assert.equal(save.flush(), false);
  assert.equal(save.status, 'memory');
});

test('读取不可用时不覆盖未知 payload，恢复后合并未修改的系统数据', () => {
  const storage = new Storage({ [KEY]: envelope({ 'treasures.v1': ['old'], 'world.v1': { ...world(), day: 1 } }) });
  storage.failRead = true;
  const save = new SaveService(storage);
  assert.equal(save.set('world.v1', world()), false);
  assert.equal(storage.attempts, 0);
  storage.failRead = false;
  assert.equal(save.flush(), true);
  assert.deepEqual(contents(storage).data, { 'treasures.v1': ['old'], 'world.v1': world() });
});

test('首次读取失败后发现损坏/未来版本，仍保护原文并保留会话数据', () => {
  for (const [raw, status] of [['{', 'corrupt'], ['{"version":3}', 'future']]) {
    const storage = new Storage({ [KEY]: raw });
    storage.failRead = true;
    const save = new SaveService(storage);
    assert.equal(save.set('world.v1', world()), false);
    storage.failRead = false;
    assert.equal(save.flush(), false);
    assert.equal(save.status, status);
    assert.deepEqual(save.get('world.v1'), world());
    assert.equal(storage.items.get(KEY), raw);
    assert.equal(storage.attempts, 0);
  }
});

test('单个 legacy key 读取失败不提交半次迁移，flush 可恢复全部数据', () => {
  const storage = new Storage({ [legacyKey('kickflip.v1')]: 'true', [legacyKey('deliveries.v1')]: '6' });
  storage.failRead = legacyKey('deliveries.v1');
  const save = new SaveService(storage);
  assert.equal(save.status, 'memory');
  assert.equal(save.set('world.v1', world()), false);
  assert.equal(storage.attempts, 0);
  storage.failRead = false;
  assert.equal(save.flush(), true);
  assert.deepEqual(contents(storage).data, { 'kickflip.v1': true, 'deliveries.v1': 6, 'world.v1': world() });
});

test('quota 失败保留所有系统内存，重复值不连续重试，flush 只写一次合并快照', () => {
  const storage = new Storage();
  storage.failWrite = true;
  const save = new SaveService(storage);
  assert.equal(save.set('world.v1', world()), false);
  assert.equal(save.set('kickflip.v1', true), false);
  assert.equal(save.status, 'memory');
  const attempts = storage.attempts;
  for (let frame = 0; frame < 100; frame++) assert.equal(save.set('world.v1', world()), false);
  assert.equal(storage.attempts, attempts);
  assert.deepEqual(save.get('world.v1'), world());
  assert.equal(save.get('kickflip.v1'), true);
  assert.equal(save.flush(), false);
  storage.failWrite = false;
  assert.equal(save.flush(), true);
  assert.equal(save.status, 'saved');
  assert.deepEqual(contents(storage).data, { 'world.v1': world(), 'kickflip.v1': true });
  const writes = storage.attempts;
  assert.equal(save.flush(), true);
  assert.equal(save.set('kickflip.v1', true), true);
  assert.equal(storage.attempts, writes);
});

test('迁移写入失败仍保留 completed，flush 重试不重新奖励、不删除 legacy', () => {
  const raw = JSON.stringify(quest());
  const storage = new Storage({ [legacyKey('first-delivery.v1')]: raw });
  storage.failWrite = true;
  const save = new SaveService(storage);
  assert.equal(save.status, 'memory');
  assert.equal(new DeliveryQuest(save).coins, FIRST_ORDER.reward);
  storage.failWrite = false;
  assert.equal(save.flush(), true);
  assert.equal(storage.items.get(legacyKey('first-delivery.v1')), raw);
  assert.equal(new DeliveryQuest(new SaveService(storage)).coins, FIRST_ORDER.reward);
  assert.equal(storage.writes.length, 1);
});

test('深度相等去重与对象属性顺序无关，数组顺序变化仍会保存', () => {
  const storage = new Storage();
  const save = new SaveService(storage);
  assert.equal(save.set('custom', { a: 1, b: { x: 2, y: [3, 4] } }), true);
  for (let frame = 0; frame < 100; frame++) {
    assert.equal(save.set('custom', { b: { y: [3, 4], x: 2 }, a: 1 }), true);
    assert.equal(save.flush(), true);
  }
  assert.equal(storage.writes.length, 1);
  assert.equal(save.set('custom', { a: 1, b: { x: 2, y: [4, 3] } }), true);
  assert.equal(storage.writes.length, 2);
});

test('失败后改回已保存快照无需再写入', () => {
  const storage = new Storage({ [KEY]: envelope({ 'deliveries.v1': 1 }) });
  const save = new SaveService(storage);
  storage.failWrite = true;
  assert.equal(save.set('deliveries.v1', 2), false);
  assert.equal(storage.attempts, 1);
  assert.equal(save.set('deliveries.v1', 1), true);
  assert.equal(save.status, 'saved');
  assert.equal(save.flush(), true);
  assert.equal(storage.attempts, 1);
});

test('非法 JSON 输入被原子拒绝，getter/toJSON 不执行，不破坏已有存档', () => {
  const storage = new Storage();
  const save = new SaveService(storage);
  assert.equal(save.set('custom', { valid: true }), true);
  const raw = storage.items.get(KEY);
  const cycle = {}; cycle.self = cycle;
  let called = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { called++; throw new Error('getter'); } });
  const invalid = [cycle, 1n, NaN, Infinity, undefined, () => {}, Symbol('bad'), { missing: undefined }, accessor, { toJSON() { called++; throw new Error('toJSON'); } }, new Date(), Object.create({ inherited: true })];
  for (const value of invalid) {
    assert.equal(save.set('custom', value), false);
    assert.deepEqual(save.get('custom'), { valid: true });
    assert.equal(storage.items.get(KEY), raw);
  }
  assert.equal(called, 0);
  assert.equal(storage.writes.length, 1);
  assert.equal(save.set('other', 'still usable'), true);
});

test('JSON.stringify 异常保留旧 payload 和新内存数据，flush 可以恢复', (t) => {
  const storage = new Storage({ [KEY]: envelope({ 'deliveries.v1': 1 }) });
  const save = new SaveService(storage);
  const before = storage.items.get(KEY);
  t.mock.method(JSON, 'stringify', () => { throw new Error('JSON failure'); });
  assert.equal(save.set('world.v1', world()), false);
  assert.equal(save.status, 'memory');
  assert.deepEqual(save.get('world.v1'), world());
  assert.equal(save.get('deliveries.v1'), 1);
  assert.equal(storage.items.get(KEY), before);
  assert.equal(storage.attempts, 0);
  t.mock.restoreAll();
  assert.equal(save.flush(), true);
  assert.deepEqual(contents(storage).data, { 'deliveries.v1': 1, 'world.v1': world() });
});

test('不同实例无共享状态、脏标记或告警；共享 storage 也不会共享对象引用', () => {
  const first = new SaveService(null), second = new SaveService(null);
  first.set('world.v1', world());
  assert.equal(second.get('world.v1', null), null);
  second.set('world.v1', { ...world(), day: 100 });
  assert.equal(first.get('world.v1').day, 8);
  const bad = new SaveService(new Storage({ [KEY]: '{' }));
  assert.equal(bad.status, 'corrupt');
  assert.equal(first.status, 'memory');
  const storage = new Storage({ [KEY]: envelope({ 'world.v1': world() }) });
  const a = new SaveService(storage), b = new SaveService(storage);
  assert.equal(a.set('world.v1', { ...world(), day: 9 }), true);
  assert.equal(b.get('world.v1').day, 8);
  assert.equal(b.status, 'saved');
  assert.equal(b.flush(), true);
  assert.equal(contents(storage).data['world.v1'].day, 9);
});
