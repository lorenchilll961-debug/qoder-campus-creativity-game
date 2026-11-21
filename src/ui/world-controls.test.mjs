import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldControls } from './world-controls.js';
import { WorldState } from '../core/world-state.js';
import { SaveService } from '../core/save.js';

const TIMES = [
  [5.5, '黎明', '05:30'],
  [8, '清晨', '08:00'],
  [12, '正午', '12:00'],
  [15, '午后', '15:00'],
  [18.5, '黄昏', '18:30'],
  [0, '深夜', '00:00'],
];

// Only the DOM surface used by WorldControls; record even redundant writes.
class Element {
  constructor(id, document, writes, initial = {}) {
    this.id = id;
    this.ownerDocument = document;
    this.writes = writes;
    this.dataset = {};
    this.attributes = new Map();
    this.handlers = new Map();
    this.blurCount = 0;
    for (const [key, value] of Object.entries({ textContent: '', value: '', disabled: false, hidden: false, ...initial })) {
      let current = value;
      Object.defineProperty(this, key, {
        get: () => current,
        set: next => { writes.push([id, key, next]); current = next; },
      });
    }
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) {
    this.writes.push([this.id, name, String(value)]);
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.writes.push([this.id, name, null]);
    this.attributes.delete(name);
  }
  addEventListener(type, callback) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(callback);
    this.handlers.set(type, handlers);
  }
  // Deliberately dispatch even when disabled, to exercise handler-side guards.
  fire(type, event = {}) {
    for (const callback of this.handlers.get(type) || []) callback(event);
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() {
    this.blurCount++;
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
  }
}

function setup({ save = new SaveService(null), worldState = new WorldState(save), paused = false } = {}) {
  const document = { activeElement: null }, writes = [];
  const ids = ['worldControls', 'worldDay', 'worldTime', 'worldPhase', 'worldWeatherName',
    'worldClockState', 'worldRunning', 'worldWeather', 'worldControlHint', 'worldSaveStatus'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element(id, document, writes, {
    disabled: id === 'worldRunning' || id === 'worldWeather',
  })]));
  const hours = TIMES.map(([hour, phase]) => {
    const button = new Element(`hour-${hour}`, document, writes, { disabled: true });
    button.dataset = { worldHour: String(hour), worldPhase: phase };
    return button;
  });
  const panel = {
    querySelector(selector) {
      assert.ok(selector.startsWith('#') && nodes[selector.slice(1)], `Unexpected selector: ${selector}`);
      return nodes[selector.slice(1)];
    },
    querySelectorAll(selector) { assert.equal(selector, '[data-world-hour]'); return hours; },
  };
  const game = { worldState, paused, save };
  const controls = new WorldControls(panel, game);
  return { controls, game, world: worldState, save, nodes, hours,
    inputs: [...hours, nodes.worldRunning, nodes.worldWeather], document, writes };
}

function assertClock(nodes, running, paused = false) {
  assert.equal(nodes.worldRunning.textContent, running ? '暂停时钟' : '继续时钟');
  assert.equal(nodes.worldRunning.getAttribute('aria-label'), running ? '暂停世界时钟' : '继续世界时钟');
  assert.equal(nodes.worldClockState.textContent, paused ? '游戏已暂停' : running ? '时钟流转中' : '时钟已暂停');
  assert.equal(nodes.worldControls.getAttribute('data-clock-running'), String(running && !paused));
}

function assertNoWrites(controls, writes) {
  writes.length = 0;
  controls.update();
  controls.update();
  assert.deepEqual(writes, []);
}

test('constructor renders the real world and memory-only save immediately', () => {
  const { world, save, nodes, hours, inputs } = setup();
  assert.ok(world instanceof WorldState);
  assert.ok(save instanceof SaveService);
  assert.equal(save.status, 'memory');
  assert.equal(nodes.worldDay.textContent, '第1天');
  assert.equal(nodes.worldDay.getAttribute('title'), '第1天');
  assert.equal(nodes.worldTime.textContent, '14:00');
  assert.equal(nodes.worldTime.getAttribute('datetime'), '14:00');
  assert.equal(nodes.worldPhase.textContent, '午后');
  assert.equal(nodes.worldPhase.getAttribute('title'), '午后');
  assert.equal(nodes.worldWeatherName.textContent, world.weatherName);
  assert.equal(nodes.worldWeatherName.getAttribute('title'), world.weatherName);
  assert.equal(nodes.worldWeather.value, 'seasonal');
  assert.equal(nodes.worldControlHint.textContent, '');
  assert.equal(nodes.worldControlHint.hidden, true);
  assert.equal(nodes.worldSaveStatus.textContent, '仅本次有效 · 刷新后可能丢失');
  assert.equal(nodes.worldSaveStatus.getAttribute('data-level'), 'warning');
  assert.ok(inputs.every(input => !input.disabled));
  assert.deepEqual(hours.map(button => button.getAttribute('aria-pressed')), ['false', 'false', 'false', 'true', 'false', 'false']);
  assertClock(nodes, true);
});

for (const [index, [hour, phase, time]] of TIMES.entries()) {
  test(`${phase} button saves its target and renders the completed ${time} summary`, () => {
    const { controls, world, save, nodes, hours } = setup();
    world.setWeather('clear');
    hours[index].fire('click', { detail: 0 });
    assert.equal(save.get('world.v1').hour, hour);
    // Use the public transition API, not private fields or an immediate-hour assumption.
    world.update(3);
    controls.update();
    assert.equal(world.hour, hour);
    assert.equal(nodes.worldDay.textContent, '第1天');
    assert.equal(nodes.worldDay.getAttribute('title'), '第1天');
    assert.equal(nodes.worldTime.textContent, time);
    assert.equal(nodes.worldTime.getAttribute('datetime'), time);
    assert.equal(nodes.worldPhase.textContent, phase);
    assert.equal(nodes.worldPhase.getAttribute('title'), phase);
    assert.equal(nodes.worldWeatherName.textContent, '晴');
    assert.equal(nodes.worldWeatherName.getAttribute('title'), '晴');
    assert.equal(nodes.worldWeather.value, 'clear');
    assert.deepEqual(hours.map(button => button.getAttribute('aria-pressed')),
      TIMES.map((_, i) => String(i === index)));
    assertClock(nodes, true);
  });
}

test('running button pauses and resumes the real clock and persists both states', () => {
  const { controls, world, save, nodes } = setup();
  nodes.worldRunning.fire('click', { detail: 0 });
  assert.equal(world.running, false);
  assert.equal(save.get('world.v1').running, false);
  assertClock(nodes, false);
  world.update(60);
  controls.update();
  assert.equal(world.hour, 14);
  assert.equal(nodes.worldTime.textContent, '14:00');
  nodes.worldRunning.fire('click', { detail: 0 });
  assert.equal(world.running, true);
  assert.equal(save.get('world.v1').running, true);
  assertClock(nodes, true);
  world.update(60);
  controls.update();
  assert.equal(world.hour, 15);
  assert.equal(nodes.worldTime.textContent, '15:00');
});

test('weather changes update the real state, save and summary; refused changes restore selection', () => {
  const { controls, world, save, nodes } = setup();
  for (const [id, name] of [['rain', '雨'], ['snow', '雪'], ['clear', '晴']]) {
    nodes.worldWeather.value = id;
    nodes.worldWeather.fire('change');
    assert.equal(world.weather, id);
    assert.equal(save.get('world.v1').weather, id);
    assert.equal(nodes.worldWeather.value, id);
    assert.equal(nodes.worldWeatherName.textContent, name);
    assert.equal(nodes.worldWeatherName.getAttribute('title'), name);
  }
  const saved = save.get('world.v1');
  nodes.worldWeather.value = 'not-a-weather';
  nodes.worldWeather.fire('change');
  assert.equal(world.weather, 'clear');
  assert.equal(nodes.worldWeather.value, 'clear');
  assert.deepEqual(save.get('world.v1'), saved);
  nodes.worldWeather.value = 'seasonal';
  nodes.worldWeather.fire('change');
  world.update(4);
  controls.update();
  assert.equal(world.weather, 'seasonal');
  assert.equal(save.get('world.v1').weather, 'seasonal');
  assert.equal(nodes.worldWeather.value, 'seasonal');
  assert.equal(nodes.worldWeatherName.textContent, world.weatherName);
});

test('pause guards stale and disabled events without changing world or save, then re-enables controls', () => {
  const { controls, game, world, save, nodes, hours, inputs, writes } = setup();
  world.setWeather('clear');
  controls.update();
  const saved = save.get('world.v1');
  // Pause before the next HUD update: the first click still reaches an enabled button.
  game.paused = true;
  for (const button of [...hours, nodes.worldRunning]) {
    button.fire('click', { detail: 0 });
    assert.equal(world.hour, 14);
    assert.equal(world.running, true);
    assert.deepEqual(save.get('world.v1'), saved);
    assert.ok(inputs.every(input => input.disabled));
  }
  nodes.worldWeather.value = 'thunder';
  nodes.worldWeather.fire('change');
  assert.equal(world.weather, 'clear');
  assert.equal(nodes.worldWeather.value, 'clear');
  assert.deepEqual(save.get('world.v1'), saved);
  assert.equal(nodes.worldControlHint.textContent, '游戏暂停中 · 返回游戏后可调整');
  assert.equal(nodes.worldControlHint.hidden, false);
  assertClock(nodes, true, true);
  assertNoWrites(controls, writes);
  game.paused = false;
  controls.update();
  assert.ok(inputs.every(input => !input.disabled));
  assert.equal(nodes.worldControlHint.textContent, '');
  assert.equal(nodes.worldControlHint.hidden, true);
  assertClock(nodes, true);
  nodes.worldRunning.fire('click', { detail: 0 });
  assert.equal(world.running, false);
  assert.equal(save.get('world.v1').running, false);
});

test('a change arriving immediately after pause is refused and restores the real selection', () => {
  const { game, world, save, nodes, inputs } = setup();
  const saved = save.get('world.v1', null);
  game.paused = true;
  nodes.worldWeather.value = 'rain';
  nodes.worldWeather.fire('change');
  assert.equal(world.weather, 'seasonal');
  assert.equal(nodes.worldWeather.value, 'seasonal');
  assert.deepEqual(save.get('world.v1', null), saved);
  assert.ok(inputs.every(input => input.disabled));
});

function storageWith(raw) {
  const values = new Map(raw === null ? [] : [['petalwake.save.v2', raw]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('all four real save statuses have the Chinese message and severity, with an unknown fallback', () => {
  const { controls, game, nodes } = setup();
  for (const [save, status, message, level] of [
    [new SaveService(storageWith(null)), 'saved', '环境已保存', 'saved'],
    [new SaveService(null), 'memory', '仅本次有效 · 刷新后可能丢失', 'warning'],
    [new SaveService(storageWith('{')), 'corrupt', '存档损坏 · 无法恢复上次环境', 'warning'],
    [new SaveService(storageWith(JSON.stringify({ version: 3, data: {} }))), 'future', '存档版本较新 · 请使用新版游戏', 'warning'],
  ]) {
    assert.equal(save.status, status);
    game.save = save;
    controls.update();
    assert.equal(nodes.worldSaveStatus.textContent, message);
    assert.equal(nodes.worldSaveStatus.getAttribute('data-level'), level);
  }
  for (const save of [undefined, { status: 'unknown' }]) {
    game.save = save;
    controls.update();
    assert.equal(nodes.worldSaveStatus.textContent, '保存状态待确认');
    assert.equal(nodes.worldSaveStatus.getAttribute('data-level'), 'warning');
  }
});

test('missing world disables all inputs, rejects events and clears stale summary attributes', () => {
  const { controls, game, save, nodes, hours, inputs, writes } = setup({ worldState: null });
  const assertWaiting = () => {
    assert.ok(inputs.every(input => input.disabled));
    assert.equal(nodes.worldDay.textContent, '第—天');
    assert.equal(nodes.worldDay.getAttribute('title'), '第—天');
    assert.equal(nodes.worldTime.textContent, '--:--');
    assert.equal(nodes.worldTime.hasAttribute('datetime'), false);
    for (const node of [nodes.worldPhase, nodes.worldWeatherName]) {
      assert.equal(node.textContent, '—');
      assert.equal(node.getAttribute('title'), '—');
    }
    assert.equal(nodes.worldClockState.textContent, '等待世界状态');
    assert.equal(nodes.worldControls.getAttribute('data-clock-running'), 'false');
    assert.equal(nodes.worldRunning.textContent, '继续时钟');
    assert.equal(nodes.worldRunning.getAttribute('aria-label'), '继续世界时钟');
    assert.equal(nodes.worldWeather.value, '');
    assert.equal(nodes.worldControlHint.textContent, '等待世界状态');
    assert.equal(nodes.worldControlHint.hidden, false);
    assert.ok(hours.every(button => button.getAttribute('aria-pressed') === 'false'));
  };
  assertWaiting();
  for (const button of [...hours, nodes.worldRunning]) button.fire('click', { detail: 0 });
  nodes.worldWeather.value = 'rain';
  nodes.worldWeather.fire('change');
  assertWaiting();
  assert.equal(save.get('world.v1', null), null);
  assertNoWrites(controls, writes);
  game.worldState = new WorldState(save);
  controls.update();
  assert.ok(inputs.every(input => !input.disabled));
  assert.equal(nodes.worldTime.getAttribute('datetime'), '14:00');
  assert.equal(nodes.worldControlHint.hidden, true);
  delete game.worldState;
  game.paused = true;
  controls.update();
  assertWaiting();
  assertNoWrites(controls, writes);
});

test('HUD updates write only changed DOM values and do not disturb an open panel or select focus', () => {
  const { controls, world, nodes, document, writes } = setup();
  nodes.worldControls.open = true;
  nodes.worldWeather.focus();
  assertNoWrites(controls, writes);
  world.update(1);
  controls.update();
  assert.deepEqual(writes, [
    ['worldTime', 'textContent', '14:01'],
    ['worldTime', 'datetime', '14:01'],
  ]);
  assert.equal(document.activeElement, nodes.worldWeather);
  assertNoWrites(controls, writes);
  world.setWeather('rain');
  controls.update();
  assert.deepEqual(writes, [
    ['worldWeatherName', 'textContent', '雨'],
    ['worldWeatherName', 'title', '雨'],
    ['worldWeather', 'value', 'rain'],
  ]);
  assert.equal(document.activeElement, nodes.worldWeather);
  assert.equal(nodes.worldWeather.blurCount, 0);
  assert.equal(nodes.worldControls.open, true);
  assertNoWrites(controls, writes);
});

test('keyboard clicks and select changes retain focus, while mouse clicks blur every button', () => {
  const { controls, nodes, hours, document } = setup();
  for (const button of [...hours, nodes.worldRunning]) {
    button.focus();
    button.fire('click', { detail: 0 });
    controls.update();
    assert.equal(document.activeElement, button);
    assert.equal(button.blurCount, 0);
    button.fire('click', { detail: 1 });
    assert.equal(document.activeElement, null);
    assert.equal(button.blurCount, 1);
  }
  nodes.worldWeather.focus();
  nodes.worldWeather.value = 'rain';
  nodes.worldWeather.fire('change');
  controls.update();
  assert.equal(document.activeElement, nodes.worldWeather);
  assert.equal(nodes.worldWeather.blurCount, 0);
});
