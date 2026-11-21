import test from 'node:test';
import assert from 'node:assert/strict';
import { SeasonCycle, SEASONS, SOLAR_TERMS, CLIMATE_DEFAULTS, TRANSITION_SECONDS } from './cycle.js';

const EXPECTED = [
  { id: 'spring', name: '春', grass: [1.55, 1.8, 0.82], leaves: [1.5, 1.7, 0.78], bloom: 1, snow: 0, pastel: 1, bare: 0, snowfall: 0, wither: 0 },
  { id: 'summer', name: '夏', grass: [1, 1, 1], leaves: [1, 1, 1], bloom: 1, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0 },
  { id: 'autumn', name: '秋', grass: [2.3, 0.82, 0.48], leaves: [2.6, 0.72, 0.32], bloom: 0.18, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0.3 },
  { id: 'winter', name: '冬', grass: [1.8, 0.82, 0.52], leaves: [1.75, 0.8, 0.5], bloom: 0, snow: 1, pastel: 0, bare: 1, snowfall: 1, wither: 1 },
].map((season) => ({ ...season, climate: { ...CLIMATE_DEFAULTS } }));

const SCALARS = ['bloom', 'snow', 'pastel', 'bare', 'snowfall', 'wither'];
const CLIMATE_RANGES = {
  strength: [0, 1], temperature: [-50, 50], daylight: [0, 24],
  rain: [0, 1], cloud: [0, 1], fog: [0, 1], thunder: [0, 1], wetness: [0, 1], dew: [0, 1],
  frost: [0, 1], ice: [0, 1], frozenSoil: [0, 1], heat: [0, 1],
  windX: [-2, 2], windZ: [-2, 2], birds: [-1, 1],
  cropGrowth: [0, 1], cropRipeness: [0, 1], cropHarvest: [0, 1], goldBloom: [0, 1],
};
const CLIMATE_KEYS = Object.keys(CLIMATE_RANGES);
const TERM_TEXT_KEYS = ['name', 'description', 'phenology', 'farming', 'wind', 'marker'];
const EXPECTED_TERMS = [
  ['lichun', '立春'], ['yushui', '雨水'], ['jingzhe', '惊蛰'],
  ['chunfen', '春分'], ['qingming', '清明'], ['guyu', '谷雨'],
  ['lixia', '立夏'], ['xiaoman', '小满'], ['mangzhong', '芒种'],
  ['xiazhi', '夏至'], ['xiaoshu', '小暑'], ['dashu', '大暑'],
  ['liqiu', '立秋'], ['chushu', '处暑'], ['bailu', '白露'],
  ['qiufen', '秋分'], ['hanlu', '寒露'], ['shuangjiang', '霜降'],
  ['lidong', '立冬'], ['xiaoxue', '小雪'], ['daxue', '大雪'],
  ['dongzhi', '冬至'], ['xiaohan', '小寒'], ['dahan', '大寒'],
];

function stateOf({ grass, leaves, bloom, snow, pastel, bare, snowfall, wither, climate }) {
  return { grass: [...grass], leaves: [...leaves], bloom, snow, pastel, bare, snowfall, wither, climate: { ...climate } };
}

function values(state) {
  return [
    ...state.grass, ...state.leaves, ...SCALARS.map((key) => state[key]),
    ...CLIMATE_KEYS.map((key) => state.climate[key]),
  ];
}

function blended(start, end, amount) {
  const mix = (a, b) => a + (b - a) * amount;
  return {
    grass: start.grass.map((value, i) => mix(value, end.grass[i])),
    leaves: start.leaves.map((value, i) => mix(value, end.leaves[i])),
    ...Object.fromEntries(SCALARS.map((key) => [key, mix(start[key], end[key])])),
    climate: Object.fromEntries(CLIMATE_KEYS.map((key) => [key, mix(start.climate[key], end.climate[key])])),
  };
}

function assertRanges(state) {
  for (const key of ['grass', 'leaves']) {
    assert.ok(Array.isArray(state[key]));
    assert.equal(state[key].length, 3);
    for (const value of state[key]) {
      assert.ok(Number.isFinite(value));
      assert.ok(value >= 0 && value <= 2.6);
    }
  }
  for (const key of SCALARS) {
    assert.ok(Number.isFinite(state[key]), `${key} must be finite`);
    assert.ok(state[key] >= 0 && state[key] <= 1, `${key} must be in [0, 1]`);
  }
  assert.deepEqual(Object.keys(state.climate).sort(), [...CLIMATE_KEYS].sort());
  for (const [key, [min, max]] of Object.entries(CLIMATE_RANGES)) {
    const value = state.climate[key];
    assert.ok(Number.isFinite(value), `climate.${key} must be finite`);
    assert.ok(value >= min && value <= max, `climate.${key} must be in [${min}, ${max}]`);
  }
}

function snapshotOf(cycle) {
  return {
    target: cycle.target,
    preset: cycle.preset,
    progress: cycle.progress,
    state: stateOf(cycle.state),
    reference: cycle.state,
    grass: cycle.state.grass,
    leaves: cycle.state.leaves,
    climate: cycle.state.climate,
  };
}

function assertIdentity(cycle, snapshot) {
  assert.strictEqual(cycle.state, snapshot.reference);
  assert.strictEqual(cycle.state.grass, snapshot.grass);
  assert.strictEqual(cycle.state.leaves, snapshot.leaves);
  assert.strictEqual(cycle.state.climate, snapshot.climate);
}

function assertUnchanged(cycle, snapshot) {
  assert.equal(cycle.target, snapshot.target);
  assert.strictEqual(cycle.preset, snapshot.preset);
  assert.equal(cycle.progress, snapshot.progress);
  assert.deepEqual(cycle.state, snapshot.state);
  assertIdentity(cycle, snapshot);
}

function assertNear(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  assert.deepEqual(Object.keys(actual.climate).sort(), [...CLIMATE_KEYS].sort());
  assert.deepEqual(Object.keys(expected.climate).sort(), [...CLIMATE_KEYS].sort());
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
  assert.strictEqual(cycle.preset, SEASONS[1]);
  assert.ok(Object.isFrozen(cycle.preset));
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
    assertRanges(season);
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

test('切换起点深拷贝，不受外部 state 数组及 climate 修改影响', () => {
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
  cycle.state.bare = 99;
  cycle.state.snowfall = 99;
  for (const key of CLIMATE_KEYS) cycle.state.climate[key] = 99;
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

test('非法键包含 __proto__ 均无副作用，季节与节气渐变仍按原计划完成', () => {
  for (const preset of [SEASONS[2], ...SOLAR_TERMS]) {
    const cycle = new SeasonCycle();
    cycle.select(preset.id);
    cycle.update(1);
    const snapshot = snapshotOf(cycle);
    assert.equal(snapshot.progress, 0.25);
    for (const id of [
      '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'Summer',
      ' summer ', 'unknown', null, undefined, 0, NaN, true, {}, ['spring'],
      'Lichun', ' lichun ', '立春', ['lichun'], new String('lichun'), 1n,
      Symbol('winter'), { toString() { throw new Error('不应转换非法键'); } },
    ]) {
      assert.equal(cycle.select(id), false);
      assertUnchanged(cycle, snapshot);
    }
    cycle.update(3);
    assert.equal(cycle.progress, 1);
    assert.deepEqual(cycle.state, stateOf(preset));
  }
});

test('不同帧率相同时长一致，季节及节气全部参数四秒精确到达终点', () => {
  for (const destination of [EXPECTED[3], ...SOLAR_TERMS]) {
    for (const seconds of [1, 2, 3, 4]) {
      const reference = new SeasonCycle();
      reference.select(destination.id);
      reference.update(seconds);
      for (const fps of [24, 30, 60, 120, 144, 240]) {
        const cycle = new SeasonCycle();
        cycle.select(destination.id);
        advance(cycle, fps, seconds);
        assert.ok(Math.abs(cycle.progress - reference.progress) <= 1e-12);
        assertNear(cycle.state, reference.state);
        if (seconds === 4) {
          assert.equal(cycle.progress, 1);
          assert.deepEqual(cycle.state, stateOf(destination));
        }
      }
    }
  }
});

test('冬季积雪、落叶与飘雪达到全量，离开冬季后均归零', () => {
  const cycle = new SeasonCycle();
  cycle.select('winter');
  cycle.update(2);
  for (const key of ['snow', 'bare', 'snowfall']) assert.equal(cycle.state[key], 0.5);
  cycle.update(2);
  for (const key of ['snow', 'bare', 'snowfall']) assert.equal(cycle.state[key], 1);
  assert.equal(cycle.state.bloom, 0);
  assert.match(SEASONS[3].description, /飞雪.*白雪/);
  for (const season of ['spring', 'summer', 'autumn']) {
    cycle.select('winter');
    cycle.update(4);
    cycle.select(season);
    cycle.update(2);
    for (const key of ['snow', 'bare', 'snowfall']) assert.equal(cycle.state[key], 0.5);
    cycle.update(2);
    for (const key of ['snow', 'bare', 'snowfall']) assert.equal(cycle.state[key], 0);
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

test('非法时间步不影响季节与节气状态，超大时间步也不会越界', () => {
  for (const preset of [SEASONS[3], ...SOLAR_TERMS]) {
    const cycle = new SeasonCycle();
    cycle.select(preset.id);
    cycle.update(0.5);
    const snapshot = snapshotOf(cycle);
    assert.equal(snapshot.progress, 0.125);
    for (const dt of [
      0, -0, -1, -Infinity, Infinity, NaN, undefined, null, '1', {}, Symbol('dt'),
      true, false, [], [1], 1n, new Number(1),
      { valueOf() { throw new Error('不应转换非法时间步'); } },
    ]) {
      assert.strictEqual(cycle.update(dt), cycle.state);
      assertUnchanged(cycle, snapshot);
    }
    cycle.update(1.5);
    assert.equal(cycle.progress, 0.5);
    assertNear(cycle.state, blended(EXPECTED[1], preset, 0.5));
    cycle.update(Number.MAX_VALUE);
    assert.equal(cycle.progress, 1);
    assert.deepEqual(cycle.state, stateOf(preset));
    assertRanges(cycle.state);
  }
});

test('实例状态和数组互不污染', () => {
  const first = new SeasonCycle();
  const second = new SeasonCycle();
  assert.notStrictEqual(first.state, second.state);
  assert.notStrictEqual(first.state.grass, second.state.grass);
  assert.notStrictEqual(first.state.leaves, second.state.leaves);
  assert.notStrictEqual(first.state.climate, second.state.climate);
  assert.notStrictEqual(first.state.climate, CLIMATE_DEFAULTS);
  assert.notStrictEqual(first.state.climate, SEASONS[1].climate);
  first.select('winter');
  first.update(4);
  first.state.grass[0] = 99;
  first.state.leaves[0] = 99;
  first.state.bloom = 99;
  first.state.snow = 99;
  first.state.pastel = 99;
  first.state.bare = 99;
  first.state.snowfall = 99;
  for (const key of CLIMATE_KEYS) first.state.climate[key] = 99;
  assert.equal(second.target, 'summer');
  assert.equal(second.progress, 1);
  assert.deepEqual(second.state, stateOf(EXPECTED[1]));
  second.select('winter');
  second.update(4);
  assert.deepEqual(second.state, stateOf(EXPECTED[3]));
  assert.deepEqual(new SeasonCycle().state, stateOf(EXPECTED[1]));
});

test('四季与节气预设深度冻结，切换与实例修改永不污染预设', () => {
  for (const presets of [SEASONS, SOLAR_TERMS]) {
    const snapshot = structuredClone(presets);
    assert.ok(Object.isFrozen(presets));
    assert.throws(() => presets.push(presets[0]), TypeError);
    assert.throws(() => { presets[0] = presets[1]; }, TypeError);
    const cycle = new SeasonCycle();
    for (const preset of presets) {
      assert.ok(Object.isFrozen(preset));
      assert.ok(Object.isFrozen(preset.grass));
      assert.ok(Object.isFrozen(preset.leaves));
      assert.ok(Object.isFrozen(preset.climate));
      for (const key of CLIMATE_KEYS) {
        assert.throws(() => { preset.climate[key] = 99; }, TypeError);
        assert.throws(() => { delete preset.climate[key]; }, TypeError);
      }
      assert.throws(() => { preset.climate.extra = 1; }, TypeError);
      assert.throws(() => { preset.climate = {}; }, TypeError);
      assert.throws(() => { preset.grass[0] = 99; }, TypeError);
      assert.throws(() => { preset.leaves[0] = 99; }, TypeError);
      assert.throws(() => preset.grass.push(99), TypeError);
      assert.throws(() => preset.leaves.push(99), TypeError);
      for (const key of ['id', 'name', 'description', ...SCALARS]) {
        assert.throws(() => { preset[key] = 99; }, TypeError);
      }
      if (presets === SOLAR_TERMS) {
        for (const key of ['season', 'date', ...TERM_TEXT_KEYS]) {
          assert.throws(() => { preset[key] = 'changed'; }, TypeError);
        }
      }
      cycle.select(preset.id);
      assert.strictEqual(cycle.preset, preset);
      cycle.update(4);
      assert.deepEqual(cycle.state, stateOf(preset));
      assert.notStrictEqual(cycle.state.grass, preset.grass);
      assert.notStrictEqual(cycle.state.leaves, preset.leaves);
      assert.notStrictEqual(cycle.state.climate, preset.climate);
      assert.notStrictEqual(cycle.state.climate, CLIMATE_DEFAULTS);
      assert.equal(Object.isFrozen(cycle.state.climate), false);
      cycle.state.grass[0] = 99;
      cycle.state.leaves[0] = 99;
      for (const key of SCALARS) cycle.state[key] = 99;
      for (const key of CLIMATE_KEYS) cycle.state.climate[key] = 99;
    }
    assert.deepEqual(presets, snapshot);
  }
});

test('二十四节气规范顺序、中文名称、每季六个，id 与数值状态唯一且参数有限有界', () => {
  assert.equal(SOLAR_TERMS.length, 24);
  assert.deepEqual(SOLAR_TERMS.map(({ id, name }) => [id, name]), EXPECTED_TERMS);
  assert.equal(new Set([...SEASONS, ...SOLAR_TERMS].map(({ id }) => id)).size, 28);
  assert.equal(new Set(SOLAR_TERMS.map((term) => JSON.stringify(values(term)))).size, 24);
  for (const season of EXPECTED) {
    assert.equal(SOLAR_TERMS.filter((term) => term.season === season.id).length, 6);
  }
  SOLAR_TERMS.forEach((term, index) => {
    assert.deepEqual(Object.keys(term).sort(), [
      'id', 'name', 'season', 'date', 'description', 'phenology', 'farming', 'wind', 'marker',
      'grass', 'leaves', 'climate', ...SCALARS,
    ].sort());
    assert.equal(term.season, EXPECTED[Math.floor(index / 6)].id);
    assert.match(term.description, /[\u4e00-\u9fff]/);
    assert.ok(term.description.length <= 24);
    assertRanges(term);
  });
});

test('preset 始终返回冻结目标而非当前插值，季节与节气均可选且 getter 只读', () => {
  const cycle = new SeasonCycle();
  for (const preset of [...SEASONS, ...SOLAR_TERMS]) {
    const start = stateOf(cycle.state);
    assert.equal(cycle.select(preset.id), true);
    assert.equal(cycle.target, preset.id);
    assert.strictEqual(cycle.preset, preset);
    assert.ok(Object.isFrozen(cycle.preset));
    assert.deepEqual(cycle.state, start);
    assert.throws(() => { cycle.preset = SEASONS[1]; }, TypeError);
    cycle.update(1);
    assert.strictEqual(cycle.preset, preset);
    assertNear(cycle.state, blended(start, preset, 0.15625));
    cycle.update(3);
    assert.strictEqual(cycle.preset, preset);
    assert.deepEqual(cycle.state, stateOf(preset));
  }
});

test('stepTerm 严格按二十四节气双向循环，大寒与立春跨年且中断连续', () => {
  for (const direction of [-1, 1]) {
    const cycle = new SeasonCycle();
    const initialIndex = direction === 1 ? 23 : 0;
    cycle.select(SOLAR_TERMS[initialIndex].id);
    cycle.update(4);
    let index = initialIndex;
    for (let step = 0; step < 24; step += 1) {
      const start = stateOf(cycle.state);
      const reference = cycle.state;
      index = (index + direction + 24) % 24;
      const destination = SOLAR_TERMS[index];
      assert.equal(cycle.stepTerm(direction), true);
      assert.equal(cycle.target, EXPECTED_TERMS[index][0]);
      assert.strictEqual(cycle.preset, destination);
      assert.equal(cycle.progress, 0);
      assert.strictEqual(cycle.state, reference);
      assert.deepEqual(cycle.state, start);
      if (step === 0) {
        assert.equal(cycle.preset.name, direction === 1 ? '立春' : '大寒');
      }
      cycle.update(1);
      assert.equal(cycle.progress, 0.25);
      assertNear(cycle.state, blended(start, destination, 0.15625));
    }
    assert.equal(cycle.target, SOLAR_TERMS[initialIndex].id);
    cycle.update(3);
    assert.equal(cycle.progress, 1);
    assert.deepEqual(cycle.state, stateOf(SOLAR_TERMS[initialIndex]));
  }
});

test('quick 四季模式在进行中与完成后 stepTerm 均返回 false 且无副作用', () => {
  for (const season of SEASONS) {
    const cycle = new SeasonCycle();
    cycle.select('daxue');
    cycle.update(4);
    cycle.select(season.id);
    for (const dt of [1, 3]) {
      cycle.update(dt);
      const snapshot = snapshotOf(cycle);
      for (const direction of [-1, 1]) {
        assert.equal(cycle.stepTerm(direction), false);
        assertUnchanged(cycle, snapshot);
      }
    }
    assert.equal(cycle.progress, 1);
    assert.deepEqual(cycle.state, stateOf(season));
  }
  const idle = new SeasonCycle();
  const snapshot = snapshotOf(idle);
  assert.equal(idle.stepTerm(-1), false);
  assert.equal(idle.stepTerm(1), false);
  assertUnchanged(idle, snapshot);
});

test('stepTerm 拒绝非严格数字 ±1，所有节气中无副作用且不改变渐变计时', () => {
  const invalidDirections = [
    0, -0, 2, -2, 0.5, -0.5, Number.MIN_VALUE, Number.MAX_VALUE,
    NaN, Infinity, -Infinity, '1', '-1', '+1', '', true, false, null, undefined,
    [], [1], [-1], {}, new Number(1), new Number(-1), 1n, -1n, Symbol('direction'),
    { valueOf() { throw new Error('不应转换非法方向'); } },
    { [Symbol.toPrimitive]() { throw new Error('不应转换非法方向'); } },
  ];
  for (const term of SOLAR_TERMS) {
    const cycle = new SeasonCycle();
    cycle.select(term.id);
    for (const dt of [1, 3]) {
      cycle.update(dt);
      const snapshot = snapshotOf(cycle);
      for (const direction of invalidDirections) {
        assert.equal(cycle.stepTerm(direction), false);
        assertUnchanged(cycle, snapshot);
      }
    }
    assert.equal(cycle.progress, 1);
    assert.deepEqual(cycle.state, stateOf(term));
  }
});

test('全部 24 × 24 节气互切有限有界连续，四秒 smoothstep 与精确终点', () => {
  const frames = 64;
  for (const source of SOLAR_TERMS) {
    for (const destination of SOLAR_TERMS) {
      const cycle = new SeasonCycle();
      cycle.select(source.id);
      cycle.update(4);
      const identity = snapshotOf(cycle);
      const start = stateOf(cycle.state);
      const startValues = values(start);
      const endValues = values(destination);
      const changed = source !== destination;
      assert.equal(cycle.select(destination.id), changed);
      assert.equal(cycle.progress, changed ? 0 : 1);
      assert.equal(cycle.target, destination.id);
      assert.strictEqual(cycle.preset, destination);
      assert.deepEqual(cycle.state, start);
      assertIdentity(cycle, identity);
      let previousProgress = cycle.progress;
      let previousValues = startValues;
      for (let frame = 1; frame <= frames; frame += 1) {
        assert.strictEqual(cycle.update(4 / frames), identity.reference);
        assertIdentity(cycle, identity);
        const progress = frame / frames;
        assert.equal(cycle.progress, changed ? progress : 1);
        assert.ok(cycle.progress >= previousProgress && cycle.progress <= 1);
        assertNear(cycle.state, blended(start, destination, progress ** 2 * (3 - 2 * progress)));
        assertRanges(cycle.state);
        const currentValues = values(cycle.state);
        currentValues.forEach((value, i) => {
          assert.ok(value >= Math.min(startValues[i], endValues[i]));
          assert.ok(value <= Math.max(startValues[i], endValues[i]));
          const delta = endValues[i] - startValues[i];
          assert.ok((value - previousValues[i]) * delta >= -1e-12);
          // smoothstep 的最大斜率为 1.5，逐帧变化不能超过此连续性界限。
          assert.ok(Math.abs(value - previousValues[i]) <= 1.5 * Math.abs(delta) / frames + 1e-12);
        });
        previousProgress = cycle.progress;
        previousValues = currentValues;
      }
      assert.equal(cycle.progress, 1);
      assert.deepEqual(cycle.state, stateOf(destination));
      const snapshot = snapshotOf(cycle);
      cycle.update(100);
      assertUnchanged(cycle, snapshot);
    }
  }
});

test('每个节气重复选择不重置，连续中断均从当前值重新进行四秒渐变', () => {
  SOLAR_TERMS.forEach((term, index) => {
    const cycle = new SeasonCycle();
    cycle.select(term.id);
    cycle.update(1.5);
    const snapshot = snapshotOf(cycle);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal(cycle.select(term.id), false);
      assertUnchanged(cycle, snapshot);
    }
    cycle.update(2.5);
    assert.equal(cycle.progress, 1);
    assert.deepEqual(cycle.state, stateOf(term));
    const settled = snapshotOf(cycle);
    assert.equal(cycle.select(term.id), false);
    assertUnchanged(cycle, settled);

    for (const [offset, dt] of [[1, 0.13], [2, 0.07], [3, 0.51], [0, 1]]) {
      const destination = SOLAR_TERMS[(index + offset) % 24];
      const start = stateOf(cycle.state);
      assert.equal(cycle.select(destination.id), true);
      assert.equal(cycle.progress, 0);
      assert.strictEqual(cycle.preset, destination);
      assert.deepEqual(cycle.state, start);
      cycle.update(0);
      assert.deepEqual(cycle.state, start);
      cycle.update(dt);
      const progress = dt / 4;
      assert.equal(cycle.progress, progress);
      assertNear(cycle.state, blended(start, destination, progress ** 2 * (3 - 2 * progress)));
      const interrupted = snapshotOf(cycle);
      assert.equal(cycle.select(destination.id), false);
      assertUnchanged(cycle, interrupted);
    }
    cycle.update(3);
    assert.equal(cycle.progress, 1);
    assert.deepEqual(cycle.state, stateOf(term));
  });
});

test('每个节气与每个 quick 季节双向切换，夏日最终精确恢复全部参数', () => {
  for (const term of SOLAR_TERMS) {
    for (const season of SEASONS) {
      const cycle = new SeasonCycle();
      for (const destination of [term, season, term, SEASONS[1]]) {
        const start = stateOf(cycle.state);
        assert.equal(cycle.select(destination.id), true);
        assert.equal(cycle.progress, 0);
        assert.equal(cycle.target, destination.id);
        assert.strictEqual(cycle.preset, destination);
        assert.deepEqual(cycle.state, start);
        cycle.update(1);
        assertNear(cycle.state, blended(start, destination, 0.15625));
        cycle.update(1);
        assertNear(cycle.state, blended(start, destination, 0.5));
        cycle.update(2);
        assert.equal(cycle.progress, 1);
        assert.deepEqual(cycle.state, stateOf(destination));
      }
      assert.equal(cycle.target, 'summer');
      assert.deepEqual(cycle.state, stateOf(EXPECTED[1]));
      const snapshot = snapshotOf(cycle);
      cycle.update(100);
      assertUnchanged(cycle, snapshot);
    }
  }
});

test('节气与 quick 季节交错中断、重选保持连续并准确回到夏日', () => {
  const cycle = new SeasonCycle();
  for (const [id, dt] of [
    ['daxue', 0.7], ['spring', 0.2], ['shuangjiang', 0.3],
    ['winter', 0.6], ['lichun', 0.1], ['autumn', 0.4],
    ['xiaoxue', 0.8], ['summer', 0.9], ['lidong', 0.5],
  ]) {
    const start = stateOf(cycle.state);
    const destination = [...SEASONS, ...SOLAR_TERMS].find((preset) => preset.id === id);
    assert.equal(cycle.select(id), true);
    assert.deepEqual(cycle.state, start);
    assert.equal(cycle.progress, 0);
    assert.strictEqual(cycle.preset, destination);
    cycle.update(dt);
    const progress = dt / 4;
    assertNear(cycle.state, blended(start, destination, progress ** 2 * (3 - 2 * progress)));
    const snapshot = snapshotOf(cycle);
    assert.equal(cycle.select(id), false);
    assertUnchanged(cycle, snapshot);
  }
  const start = stateOf(cycle.state);
  cycle.select('summer');
  assert.deepEqual(cycle.state, start);
  cycle.update(2);
  assertNear(cycle.state, blended(start, EXPECTED[1], 0.5));
  cycle.update(2);
  assert.equal(cycle.progress, 1);
  assert.equal(cycle.target, 'summer');
  assert.deepEqual(cycle.state, stateOf(EXPECTED[1]));
});

test('节气霜冰与积雪、落叶、飘雪独立：霜降立冬无雪，小雪大雪强度不同', () => {
  const byId = (id) => SOLAR_TERMS.find((term) => term.id === id);
  const hanlu = byId('hanlu');
  const frost = byId('shuangjiang');
  const winter = byId('lidong');
  const light = byId('xiaoxue');
  const heavy = byId('daxue');
  const spring = byId('lichun');
  assert.ok(hanlu.bare > 0);
  assert.equal(hanlu.snow, 0);
  assert.equal(hanlu.snowfall, 0);
  for (const term of [frost, winter]) {
    assert.equal(term.snow, 0);
    assert.ok(term.bare > term.snow);
    assert.equal(term.snowfall, 0);
    assert.ok(term.climate.frost > 0);
    assert.ok(term.climate.frozenSoil > 0);
  }
  assert.ok(winter.climate.ice > 0);
  assert.ok(spring.snow > 0 && spring.snow < 1);
  assert.ok(spring.bare > spring.snow);
  assert.equal(spring.snowfall, 0);
  assert.ok(spring.climate.ice > 0);
  assert.ok(frost.bare < winter.bare);
  assert.equal(winter.bare, 1);
  assert.equal(light.bare, 1);
  assert.equal(heavy.bare, 1);
  assert.ok(light.snow > 0 && light.snow < 0.1);
  assert.ok(heavy.snow >= 0.8);
  assert.ok(light.snow > winter.snow && heavy.snow > light.snow);
  assert.ok(light.snowfall > 0 && heavy.snowfall > light.snowfall);
  assert.notEqual(light.snow, light.snowfall);
  assert.notEqual(heavy.snow, heavy.snowfall);

  const cycle = new SeasonCycle();
  for (const destination of [hanlu, frost, winter, light, heavy, spring]) {
    const start = stateOf(cycle.state);
    cycle.select(destination.id);
    assert.deepEqual(cycle.state, start);
    cycle.update(2);
    assertNear(cycle.state, blended(start, destination, 0.5));
    for (const key of ['snow', 'bare', 'snowfall']) {
      assert.ok(Math.abs(cycle.state[key] - (start[key] + destination[key]) / 2) <= 1e-12);
    }
    cycle.update(2);
    assert.deepEqual(cycle.state, stateOf(destination));
  }
});

test('所有节气的新参数与数组在实例间隔离，中断起点深拷贝且预设不受污染', () => {
  const presetsSnapshot = structuredClone(SOLAR_TERMS);
  SOLAR_TERMS.forEach((term, index) => {
    const first = new SeasonCycle();
    const second = new SeasonCycle();
    first.select(term.id);
    second.select(term.id);
    first.update(1);
    second.update(1);
    assert.notStrictEqual(first.state, second.state);
    assert.notStrictEqual(first.state.grass, second.state.grass);
    assert.notStrictEqual(first.state.leaves, second.state.leaves);
    assert.notStrictEqual(first.state.climate, second.state.climate);
    assert.notStrictEqual(first.state.grass, term.grass);
    assert.notStrictEqual(first.state.leaves, term.leaves);
    assert.notStrictEqual(first.state.climate, term.climate);
    assert.notStrictEqual(first.state.climate, CLIMATE_DEFAULTS);
    const firstSnapshot = snapshotOf(first);
    const secondSnapshot = snapshotOf(second);
    const start = stateOf(first.state);
    const destination = SOLAR_TERMS[(index + 1) % 24];
    first.select(destination.id);
    first.state.grass.fill(99);
    first.state.leaves.fill(99);
    for (const key of SCALARS) first.state[key] = 99;
    for (const key of CLIMATE_KEYS) first.state.climate[key] = 99;
    assertUnchanged(second, secondSnapshot);
    first.update(2);
    assertIdentity(first, firstSnapshot);
    assertNear(first.state, blended(start, destination, 0.5));
    assertUnchanged(second, secondSnapshot);
    first.update(2);
    assertIdentity(first, firstSnapshot);
    assert.deepEqual(first.state, stateOf(destination));
    second.update(3);
    assert.deepEqual(second.state, stateOf(term));
    assert.deepEqual(new SeasonCycle().state, stateOf(EXPECTED[1]));
  });
  assert.deepEqual(SOLAR_TERMS, presetsSnapshot);
});

function termOf(id) {
  const term = SOLAR_TERMS.find((preset) => preset.id === id);
  assert.ok(term, `缺少节气 ${id}`);
  return term;
}

test('CLIMATE_DEFAULTS 完整冻结，四季使用默认气候且所有预设 climate 对象独立', () => {
  const expected = {
    strength: 0, temperature: 26, daylight: 14,
    rain: 0, cloud: 0, fog: 0, thunder: 0, wetness: 0, dew: 0,
    frost: 0, ice: 0, frozenSoil: 0, heat: 0,
    windX: 0, windZ: 0, birds: 0,
    cropGrowth: 0, cropRipeness: 0, cropHarvest: 0, goldBloom: 0,
  };
  assert.deepEqual(CLIMATE_DEFAULTS, expected);
  assert.deepEqual(Object.keys(CLIMATE_DEFAULTS).sort(), [...CLIMATE_KEYS].sort());
  assert.ok(Object.isFrozen(CLIMATE_DEFAULTS));
  for (const key of CLIMATE_KEYS) {
    assert.throws(() => { CLIMATE_DEFAULTS[key] = 99; }, TypeError);
    assert.throws(() => { delete CLIMATE_DEFAULTS[key]; }, TypeError);
  }
  assert.throws(() => { CLIMATE_DEFAULTS.extra = 1; }, TypeError);
  const climates = [...SEASONS, ...SOLAR_TERMS].map((preset) => preset.climate);
  assert.equal(new Set([CLIMATE_DEFAULTS, ...climates]).size, 29);
  for (const season of SEASONS) assert.deepEqual(season.climate, expected);
  for (const term of SOLAR_TERMS) assert.equal(term.climate.strength, 1);
  assert.deepEqual(CLIMATE_DEFAULTS, expected);
});

test('二十四节气日期区间有效，物候农事风向与特征标识中文完整', () => {
  SOLAR_TERMS.forEach((term, index) => {
    for (const key of TERM_TEXT_KEYS) {
      assert.equal(typeof term[key], 'string', `${term.id}.${key}`);
      assert.equal(term[key], term[key].trim());
      assert.match(term[key], /[\u4e00-\u9fff]/, `${term.id}.${key} 缺少中文`);
      assert.doesNotMatch(term[key], /[A-Za-z\uFFFD]/);
      assert.ok(term[key].length > 0 && term[key].length <= 40);
    }
    assert.match(term.date, /^\d{1,2}\.\d{1,2}–\d{1,2}\.\d{1,2}$/);
    const [[startMonth, startDay], [endMonth, endDay]] = term.date
      .split('–').map((part) => part.split('.').map(Number));
    const expectedMonth = (Math.floor(index / 2) + 1) % 12 + 1;
    assert.equal(startMonth, expectedMonth);
    assert.equal(endMonth, expectedMonth);
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][startMonth - 1];
    assert.ok(startDay >= 1 && startDay <= endDay && endDay <= daysInMonth);
  });
});

test('state、色彩数组及 climate 引用在节气四季中断、步进与恢复时始终稳定', () => {
  const cycle = new SeasonCycle();
  const identity = snapshotOf(cycle);
  for (const destination of [...SOLAR_TERMS, ...SEASONS]) {
    const start = stateOf(cycle.state);
    assert.equal(cycle.select(destination.id), true);
    assert.deepEqual(cycle.state, start);
    assertIdentity(cycle, identity);
    assert.strictEqual(cycle.update(0), identity.reference);
    assertIdentity(cycle, identity);
    assert.strictEqual(cycle.update(0.75), identity.reference);
    assertIdentity(cycle, identity);
    const progress = 0.75 / 4;
    assertNear(cycle.state, blended(start, destination, progress ** 2 * (3 - 2 * progress)));
    const interrupted = snapshotOf(cycle);
    assert.equal(cycle.select(destination.id), false);
    assertUnchanged(cycle, interrupted);
    if (SOLAR_TERMS.includes(destination)) {
      assert.equal(cycle.stepTerm(-1), true);
      assert.equal(cycle.progress, 0);
      assert.deepEqual(cycle.state, interrupted.state);
      assertIdentity(cycle, identity);
      cycle.update(0.25);
      assertIdentity(cycle, identity);
      assertNear(cycle.state, blended(interrupted.state, cycle.preset,
        (0.25 / 4) ** 2 * (3 - 2 * (0.25 / 4))));
    }
  }
  for (const season of SEASONS) {
    cycle.select(season.id);
    assertIdentity(cycle, identity);
    assert.strictEqual(cycle.update(4), identity.reference);
    assertIdentity(cycle, identity);
    assert.deepEqual(cycle.state, stateOf(season));
    assert.deepEqual(cycle.state.climate, CLIMATE_DEFAULTS);
  }
});

test('立春残冰渐融，雨水转为液态降雨但树木仅萌芽而非开花', () => {
  const spring = termOf('lichun');
  const rain = termOf('yushui');
  assert.equal(spring.bloom, 0);
  assert.ok(spring.snow > 0 && spring.snow < 0.25);
  assert.equal(spring.snowfall, 0);
  assert.ok(spring.climate.ice > 0 && spring.climate.frozenSoil > 0);
  assert.equal(rain.bloom, 0);
  assert.equal(rain.snow, 0);
  assert.equal(rain.snowfall, 0);
  assert.ok(rain.bare > 0.5);
  assert.ok(rain.climate.rain > 0);
  assert.ok(rain.climate.wetness > spring.climate.wetness);
  assert.ok(rain.climate.temperature > spring.climate.temperature);
  assert.ok(rain.climate.ice > 0 && rain.climate.ice < spring.climate.ice);
  assert.ok(rain.climate.frozenSoil < spring.climate.frozenSoil);
  assert.ok(termOf('jingzhe').bloom > rain.bloom);
});

test('清明高雾细雨，谷雨低雾丰雨且达到春季雨量峰值', () => {
  const clear = termOf('qingming').climate;
  const grain = termOf('guyu').climate;
  assert.ok(clear.fog >= 0.7);
  assert.ok(clear.rain > 0 && clear.rain <= 0.4);
  assert.ok(grain.fog < clear.fog);
  assert.ok(grain.rain >= 0.7 && grain.rain > clear.rain);
  assert.ok(clear.wetness >= 0.9 && grain.wetness >= clear.wetness);
  for (const term of SOLAR_TERMS.filter((preset) => preset.season === 'spring' && preset.id !== 'guyu')) {
    assert.ok(grain.rain > term.climate.rain, term.name);
  }
});

test('惊蛰春雷独占最高强度，大暑骤雨带雷但弱于惊蛰', () => {
  const thunder = termOf('jingzhe').climate.thunder;
  assert.equal(thunder, 1);
  for (const term of SOLAR_TERMS.filter((preset) => preset.id !== 'jingzhe')) {
    assert.ok(term.climate.thunder < thunder, term.name);
  }
  assert.ok(termOf('jingzhe').climate.rain > 0);
  assert.ok(termOf('dashu').climate.thunder > 0);
  assert.ok(termOf('dashu').climate.rain > 0);
});

test('夏至白昼唯一最长、冬至唯一最短，春秋分均为十二小时', () => {
  const longest = termOf('xiazhi').climate.daylight;
  const shortest = termOf('dongzhi').climate.daylight;
  assert.ok(longest > 12 && longest < 24);
  assert.ok(shortest > 0 && shortest < 12);
  assert.equal(termOf('chunfen').climate.daylight, 12);
  assert.equal(termOf('qiufen').climate.daylight, 12);
  for (const term of SOLAR_TERMS) {
    if (term.id !== 'xiazhi') assert.ok(term.climate.daylight < longest, term.name);
    if (term.id !== 'dongzhi') assert.ok(term.climate.daylight > shortest, term.name);
  }
});

test('白露为液态露珠而非霜雪，霜降凝霜与立冬初冰分别表达', () => {
  const dew = termOf('bailu');
  assert.equal(dew.climate.dew, 1);
  assert.ok(dew.climate.wetness > 0 && dew.climate.temperature > 0);
  for (const key of ['frost', 'ice', 'frozenSoil']) assert.equal(dew.climate[key], 0);
  assert.equal(dew.snow, 0);
  assert.equal(dew.snowfall, 0);
  const frost = termOf('shuangjiang');
  const winter = termOf('lidong');
  assert.equal(frost.climate.dew, 0);
  assert.ok(frost.climate.frost >= 0.8);
  assert.ok(winter.climate.ice > frost.climate.ice);
  assert.ok(winter.climate.frozenSoil > frost.climate.frozenSoil);
  for (const term of [frost, winter]) {
    assert.equal(term.snow, 0);
    assert.equal(term.snowfall, 0);
  }
});

test('小雪易融覆盖低，大雪稳定积雪，大寒最冷且冰层唯一最厚', () => {
  const light = termOf('xiaoxue');
  const heavy = termOf('daxue');
  const coldest = termOf('dahan');
  assert.ok(light.snow > 0 && light.snow < 0.1);
  assert.ok(light.snowfall > light.snow);
  assert.ok(light.climate.wetness > 0);
  assert.ok(heavy.snow >= 0.8 && heavy.snowfall > light.snowfall);
  assert.ok(heavy.climate.ice > light.climate.ice);
  assert.ok(heavy.climate.frozenSoil > light.climate.frozenSoil);
  assert.equal(coldest.climate.ice, 1);
  assert.equal(coldest.climate.frozenSoil, 1);
  assert.equal(coldest.snow, 1);
  assert.ok(coldest.climate.temperature < 0);
  for (const term of SOLAR_TERMS.filter((preset) => preset.id !== 'dahan')) {
    assert.ok(term.climate.temperature > coldest.climate.temperature, term.name);
    assert.ok(term.climate.ice < coldest.climate.ice, term.name);
  }
  const winterTerms = ['lidong', 'xiaoxue', 'daxue', 'dongzhi', 'xiaohan', 'dahan'].map(termOf);
  for (let i = 1; i < winterTerms.length; i += 1) {
    assert.ok(winterTerms[i].climate.temperature < winterTerms[i - 1].climate.temperature);
    assert.ok(winterTerms[i].climate.ice > winterTerms[i - 1].climate.ice);
  }
});

test('立夏非酷暑，夏至至大小暑热量递增，大暑最热而处暑退热', () => {
  const summer = termOf('lixia').climate;
  const solstice = termOf('xiazhi').climate;
  const mild = termOf('xiaoshu').climate;
  const hot = termOf('dashu').climate;
  assert.equal(summer.heat, 0);
  assert.ok(solstice.heat > summer.heat);
  assert.ok(mild.heat > solstice.heat && hot.heat > mild.heat);
  assert.ok(mild.temperature > solstice.temperature && hot.temperature > mild.temperature);
  assert.equal(hot.heat, 1);
  for (const term of SOLAR_TERMS.filter((preset) => preset.id !== 'dashu')) {
    assert.ok(term.climate.heat < hot.heat, term.name);
    assert.ok(term.climate.temperature < hot.temperature, term.name);
  }
  assert.ok(termOf('liqiu').climate.heat > 0);
  assert.equal(termOf('chushu').climate.heat, 0);
  assert.ok(termOf('chushu').climate.temperature < termOf('liqiu').climate.temperature);
});

test('北归鸟群取正值、秋季南迁取负值，风向分量保留符号及超过一的风速', () => {
  for (const id of ['yushui', 'jingzhe', 'chunfen', 'qingming', 'xiaohan']) {
    assert.ok(termOf(id).climate.birds > 0, id);
  }
  for (const id of ['bailu', 'qiufen', 'hanlu']) {
    assert.ok(termOf(id).climate.birds < 0, id);
  }
  assert.equal(termOf('chunfen').climate.birds, 1);
  assert.equal(termOf('bailu').climate.birds, -1);
  for (const axis of ['windX', 'windZ']) {
    assert.ok(SOLAR_TERMS.some((term) => term.climate[axis] < 0), axis);
    assert.ok(SOLAR_TERMS.some((term) => term.climate[axis] > 1), axis);
  }
  assert.ok(termOf('yushui').climate.windX < 0 && termOf('yushui').climate.windZ < 0);
  assert.ok(termOf('dahan').climate.windZ > 1);
  assert.ok(termOf('dashu').climate.windX > 1);
});

test('寒露黄菊盛放独立于春花，仍有液态露水但无霜雪', () => {
  const coldDew = termOf('hanlu');
  assert.equal(coldDew.climate.goldBloom, 1);
  assert.ok(coldDew.bloom > termOf('qiufen').bloom);
  assert.equal(coldDew.pastel, 0);
  assert.ok(coldDew.climate.dew > 0);
  assert.equal(coldDew.climate.frost, 0);
  assert.equal(coldDew.snow, 0);
  assert.equal(coldDew.snowfall, 0);
  for (const term of SOLAR_TERMS.filter((preset) => preset.id !== 'hanlu')) {
    assert.equal(term.climate.goldBloom, 0, term.name);
  }
  assert.match(coldDew.phenology, /菊.*黄/);
});

test('小满将熟未熟，芒种成熟兼收播，秋分金秋收获且寒冬农田休整', () => {
  const growing = ['yushui', 'jingzhe', 'chunfen', 'qingming', 'guyu', 'lixia', 'xiaoman'].map(termOf);
  for (let i = 1; i < growing.length; i += 1) {
    assert.ok(growing[i].climate.cropGrowth > growing[i - 1].climate.cropGrowth);
  }
  const filling = termOf('xiaoman');
  const harvest = termOf('mangzhong');
  assert.equal(filling.climate.cropGrowth, 1);
  assert.ok(filling.climate.cropRipeness > 0 && filling.climate.cropRipeness < 1);
  assert.equal(filling.climate.cropHarvest, 0);
  assert.match(filling.phenology, /尚未成熟/);
  assert.match(filling.marker, /将熟未熟/);
  assert.equal(harvest.climate.cropGrowth, 1);
  assert.equal(harvest.climate.cropRipeness, 1);
  assert.ok(harvest.climate.cropHarvest > 0);
  assert.ok(harvest.climate.rain > filling.climate.rain);
  assert.match(harvest.phenology, /成熟.*新苗/);
  assert.match(harvest.farming, /收.*种/);
  const autumn = termOf('qiufen');
  assert.equal(autumn.climate.cropGrowth, 1);
  assert.equal(autumn.climate.cropRipeness, 1);
  assert.ok(autumn.climate.cropHarvest > termOf('bailu').climate.cropHarvest);
  assert.match(autumn.farming, /秋收.*秋耕.*秋种/);
  for (const id of ['daxue', 'dongzhi', 'xiaohan', 'dahan']) {
    for (const key of ['cropGrowth', 'cropRipeness', 'cropHarvest']) {
      assert.equal(termOf(id).climate[key], 0, `${id}.${key}`);
    }
  }
});
