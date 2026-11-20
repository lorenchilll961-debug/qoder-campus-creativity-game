import test from 'node:test';
import assert from 'node:assert/strict';
import { SeasonCycle, SEASONS, TRANSITION_SECONDS } from './cycle.js';

const EXPECTED = [
  { id: 'spring', name: '春', grass: [1.55, 1.8, 0.82], leaves: [1.5, 1.7, 0.78], bloom: 1, snow: 0, pastel: 1 },
  { id: 'summer', name: '夏', grass: [1, 1, 1], leaves: [1, 1, 1], bloom: 1, snow: 0, pastel: 0 },
  { id: 'autumn', name: '秋', grass: [2.3, 0.82, 0.48], leaves: [2.6, 0.72, 0.32], bloom: 0.18, snow: 0, pastel: 0 },
  { id: 'winter', name: '冬', grass: [0.82, 0.85, 0.96], leaves: [0.82, 0.87, 1.02], bloom: 0, snow: 0.84, pastel: 0 },
];

function stateOf({ grass, leaves, bloom, snow, pastel }) {
  return { grass: [...grass], leaves: [...leaves], bloom, snow, pastel };
}

function values(state) {
  return [...state.grass, ...state.leaves, state.bloom, state.snow, state.pastel];
}

function blended(start, end, amount) {
  const mix = (a, b) => a + (b - a) * amount;
  return {
    grass: start.grass.map((value, i) => mix(value, end.grass[i])),
    leaves: start.leaves.map((value, i) => mix(value, end.leaves[i])),
    bloom: mix(start.bloom, end.bloom),
    snow: mix(start.snow, end.snow),
    pastel: mix(start.pastel, end.pastel),
  };
}

function assertNear(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  const expectedValues = values(expected);
  values(actual).forEach((value, i) => {
    assert.ok(Number.isFinite(value));
    assert.ok(Math.abs(value - expectedValues[i]) <= 1e-12,
      `${value} != ${expectedValues[i]}`);
  });
}

function advance(cycle, fps, seconds) {
  for (let frame = 0; frame < fps * seconds; frame += 1) {
    cycle.update(1 / fps);
  }
}

test('默认夏日保留原貌，空闲更新不改变状态', () => {
  const cycle = new SeasonCycle();
  assert.equal(TRANSITION_SECONDS, 4);
  assert.equal(cycle.target, 'summer');
  assert.equal(cycle.progress, 1);
  assert.deepEqual(cycle.state, stateOf(EXPECTED[1]));
  assert.equal(cycle.select('summer'), false);
  cycle.update(100);
  assert.deepEqual(cycle.state, stateOf(EXPECTED[1]));
});

test('四季预设数值准确，中文文案明确夏日保留原景', () => {
  assert.equal(SEASONS.length, 4);
  SEASONS.forEach((season, i) => {
    const { description, ...preset } = season;
    assert.deepEqual(preset, EXPECTED[i]);
    assert.match(description, /[\u4e00-\u9fff]/);
    assert.ok(description.length <= 24);
    values(season).forEach((value) => assert.ok(Number.isFinite(value)));
    for (const value of [...season.grass, ...season.leaves]) {
      assert.ok(value >= 0 && value <= 2.6);
    }
    assert.ok(season.bloom >= 0 && season.bloom <= 1);
    assert.ok(season.snow >= 0 && season.snow <= 1);
    assert.ok(season.pastel >= 0 && season.pastel <= 1);
  });
  assert.equal(SEASONS[0].description, '嫩绿新芽，粉白春花。');
  assert.match(SEASONS[1].description, /夏日保留原景/);
});

test('渐变起点、中点、四分点符合四秒 smoothstep，终点精确', () => {
  const cycle = new SeasonCycle();
  const start = stateOf(cycle.state);
  const end = stateOf(EXPECTED[2]);
  const state = cycle.state;
  assert.equal(cycle.select('autumn'), true);
  assert.equal(cycle.target, 'autumn');
  assert.equal(cycle.progress, 0);
  assert.strictEqual(cycle.state, state);
  assert.deepEqual(cycle.state, start);
  cycle.update(0);
  assert.deepEqual(cycle.state, start);
  cycle.update(1);
  assert.equal(cycle.progress, 0.25);
  assertNear(cycle.state, blended(start, end, 0.15625));
  cycle.update(1);
  assert.equal(cycle.progress, 0.5);
  assertNear(cycle.state, blended(start, end, 0.5));
  cycle.update(1);
  assert.equal(cycle.progress, 0.75);
  assertNear(cycle.state, blended(start, end, 0.84375));
  cycle.update(1);
  assert.equal(cycle.progress, 1);
  assert.deepEqual(cycle.state, end);
  cycle.update(100);
  assert.deepEqual(cycle.state, end);
});

test('春夏 pastel 四秒渐变、中断回切连续，最终精确恢复夏日', () => {
  const cycle = new SeasonCycle();
  const summer = stateOf(EXPECTED[1]);
  const spring = stateOf(EXPECTED[0]);
  assert.equal(cycle.state.pastel, 0);
  assert.equal(cycle.select('spring'), true);
  assert.deepEqual(cycle.state, summer);
  cycle.update(2);
  assert.equal(cycle.state.pastel, 0.5);
  assertNear(cycle.state, blended(summer, spring, 0.5));
  cycle.update(2);
  assert.equal(cycle.progress, 1);
  assert.equal(cycle.state.pastel, 1);
  assert.deepEqual(cycle.state, spring);

  assert.equal(cycle.select('summer'), true);
  assert.deepEqual(cycle.state, spring);
  cycle.update(2);
  assert.equal(cycle.progress, 0.5);
  assert.equal(cycle.state.pastel, 0.5);
  assertNear(cycle.state, blended(spring, summer, 0.5));
  const interrupted = stateOf(cycle.state);
  assert.equal(cycle.select('spring'), true);
  assert.equal(cycle.progress, 0);
  assert.deepEqual(cycle.state, interrupted);
  cycle.update(0);
  assert.deepEqual(cycle.state, interrupted);
  cycle.update(2);
  assert.equal(cycle.state.pastel, 0.75);
  assertNear(cycle.state, blended(interrupted, spring, 0.5));
  cycle.update(2);
  assert.equal(cycle.progress, 1);
  assert.deepEqual(cycle.state, spring);

  assert.equal(cycle.select('summer'), true);
  assert.deepEqual(cycle.state, spring);
  cycle.update(4);
  assert.equal(cycle.target, 'summer');
  assert.equal(cycle.progress, 1);
  assert.equal(cycle.state.pastel, 0);
  assert.deepEqual(cycle.state, summer);
  cycle.update(100);
  assert.deepEqual(cycle.state, summer);
});

test('任意四季切换中数值有限、进度单调且不越过端点', () => {
  for (const source of EXPECTED) {
    for (const destination of EXPECTED) {
      const cycle = new SeasonCycle();
      cycle.select(source.id);
      cycle.update(4);
      cycle.select(destination.id);
      const start = values(source);
      const end = values(destination);
      let previous = cycle.progress;
      for (let frame = 0; frame < 240; frame += 1) {
        cycle.update(1 / 60);
        assert.ok(cycle.progress >= previous && cycle.progress <= 1);
        previous = cycle.progress;
        values(cycle.state).forEach((value, i) => {
          assert.ok(Number.isFinite(value));
          assert.ok(value >= Math.min(start[i], end[i]));
          assert.ok(value <= Math.max(start[i], end[i]));
        });
      }
      assert.equal(cycle.progress, 1);
      assert.deepEqual(cycle.state, stateOf(destination));
    }
  }
});

test('快速重复中断切换保持连续，并从当前状态重新计时', () => {
  const cycle = new SeasonCycle();
  for (const [id, dt] of [
    ['autumn', 0.13], ['winter', 0.07], ['spring', 0.24],
    ['summer', 0.03], ['winter', 0.51], ['autumn', 0.08],
  ]) {
    const start = stateOf(cycle.state);
    assert.equal(cycle.select(id), true);
    assert.equal(cycle.progress, 0);
    assert.deepEqual(cycle.state, start);
    const destination = EXPECTED.find((season) => season.id === id);
    cycle.update(dt);
    const progress = dt / 4;
    assertNear(cycle.state, blended(start, destination, progress ** 2 * (3 - 2 * progress)));
  }
  cycle.update(4);
  assert.equal(cycle.progress, 1);
  assert.deepEqual(cycle.state, stateOf(EXPECTED[2]));
});

test('切换起点深拷贝，不受外部 state 数组修改影响', () => {
  const cycle = new SeasonCycle();
  cycle.select('winter');
  cycle.update(1);
  const start = stateOf(cycle.state);
  cycle.select('spring');
  cycle.state.grass[0] = 99;
  cycle.state.leaves[1] = 99;
  cycle.state.bloom = 99;
  cycle.state.snow = 99;
  cycle.state.pastel = 99;
  cycle.update(2);
  assertNear(cycle.state, blended(start, EXPECTED[0], 0.5));
});

test('同目标重选不会重置进行中的渐变或已完成状态', () => {
  const cycle = new SeasonCycle();
  cycle.select('winter');
  cycle.update(1.5);
  const snapshot = stateOf(cycle.state);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(cycle.select('winter'), false);
    assert.equal(cycle.progress, 0.375);
    assert.deepEqual(cycle.state, snapshot);
  }
  cycle.update(2.5);
  assert.equal(cycle.progress, 1);
  assert.deepEqual(cycle.state, stateOf(EXPECTED[3]));
  assert.equal(cycle.select('winter'), false);
  assert.equal(cycle.progress, 1);
});

test('非法键包含 __proto__ 均无副作用，渐变仍按原计划完成', () => {
  const cycle = new SeasonCycle();
  cycle.select('autumn');
  cycle.update(1);
  const snapshot = stateOf(cycle.state);
  for (const id of [
    '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'Summer',
    ' summer ', 'unknown', null, undefined, 0, NaN, true, {}, ['spring'],
    Symbol('winter'), { toString() { throw new Error('不应转换非法键'); } },
  ]) {
    assert.equal(cycle.select(id), false);
    assert.equal(cycle.target, 'autumn');
    assert.equal(cycle.progress, 0.25);
    assert.deepEqual(cycle.state, snapshot);
  }
  cycle.update(3);
  assert.equal(cycle.progress, 1);
  assert.deepEqual(cycle.state, stateOf(EXPECTED[2]));
});

test('不同帧率相同时长一致，四秒精确到达终点', () => {
  for (const seconds of [1, 2, 3, 4]) {
    const reference = new SeasonCycle();
    reference.select('winter');
    reference.update(seconds);
    for (const fps of [24, 30, 60, 120, 144, 240]) {
      const cycle = new SeasonCycle();
      cycle.select('winter');
      advance(cycle, fps, seconds);
      assert.ok(Math.abs(cycle.progress - reference.progress) <= 1e-12);
      assertNear(cycle.state, reference.state);
      if (seconds === 4) {
        assert.equal(cycle.progress, 1);
        assert.deepEqual(cycle.state, stateOf(EXPECTED[3]));
      }
    }
  }
});

test('冬转夏精确恢复原景', () => {
  const cycle = new SeasonCycle();
  cycle.select('winter');
  advance(cycle, 60, 4);
  assert.deepEqual(cycle.state, stateOf(EXPECTED[3]));
  cycle.select('summer');
  advance(cycle, 144, 4);
  assert.equal(cycle.target, 'summer');
  assert.equal(cycle.progress, 1);
  assert.deepEqual(cycle.state, stateOf(EXPECTED[1]));
});

test('非法时间步不影响状态，超大时间步也不会越界', () => {
  const cycle = new SeasonCycle();
  cycle.select('winter');
  cycle.update(0.5);
  const snapshot = stateOf(cycle.state);
  for (const dt of [0, -1, -Infinity, Infinity, NaN, undefined, null, '1', {}, Symbol('dt')]) {
    cycle.update(dt);
    assert.equal(cycle.progress, 0.125);
    assert.deepEqual(cycle.state, snapshot);
  }
  cycle.update(Number.MAX_VALUE);
  assert.equal(cycle.progress, 1);
  assert.deepEqual(cycle.state, stateOf(EXPECTED[3]));
});

test('实例状态和数组互不污染', () => {
  const first = new SeasonCycle();
  const second = new SeasonCycle();
  assert.notStrictEqual(first.state, second.state);
  assert.notStrictEqual(first.state.grass, second.state.grass);
  assert.notStrictEqual(first.state.leaves, second.state.leaves);
  first.select('winter');
  first.update(4);
  first.state.grass[0] = 99;
  first.state.leaves[0] = 99;
  first.state.bloom = 99;
  first.state.snow = 99;
  first.state.pastel = 99;
  assert.equal(second.target, 'summer');
  assert.equal(second.progress, 1);
  assert.deepEqual(second.state, stateOf(EXPECTED[1]));
  second.select('winter');
  second.update(4);
  assert.deepEqual(second.state, stateOf(EXPECTED[3]));
  assert.deepEqual(new SeasonCycle().state, stateOf(EXPECTED[1]));
});

test('预设深度冻结，切换与实例修改永不污染预设', () => {
  const snapshot = structuredClone(SEASONS);
  assert.ok(Object.isFrozen(SEASONS));
  assert.throws(() => SEASONS.push(EXPECTED[0]), TypeError);
  const cycle = new SeasonCycle();
  for (const season of SEASONS) {
    assert.ok(Object.isFrozen(season));
    assert.ok(Object.isFrozen(season.grass));
    assert.ok(Object.isFrozen(season.leaves));
    assert.throws(() => { season.grass[0] = 99; }, TypeError);
    assert.throws(() => { season.leaves[0] = 99; }, TypeError);
    assert.throws(() => { season.bloom = 99; }, TypeError);
    assert.throws(() => { season.snow = 99; }, TypeError);
    assert.throws(() => { season.pastel = 99; }, TypeError);
    cycle.select(season.id);
    cycle.update(4);
    assert.notStrictEqual(cycle.state.grass, season.grass);
    assert.notStrictEqual(cycle.state.leaves, season.leaves);
    cycle.state.grass[0] = 99;
    cycle.state.leaves[0] = 99;
    cycle.state.bloom = 99;
    cycle.state.snow = 99;
    cycle.state.pastel = 99;
  }
  assert.deepEqual(SEASONS, snapshot);
});
