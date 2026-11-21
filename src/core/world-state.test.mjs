import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldState, WEATHER, DAY_SECONDS, daylightAt } from './world-state.js';
import { SOLAR_TERMS, SEASONS } from '../seasons/cycle.js';

function fixture(saved) {
  const values = new Map(saved ? [['world.v1', saved]] : []);
  const store = { writes: 0, get: (key, fallback) => structuredClone(values.get(key) ?? fallback), set(key, value) { this.writes++; values.set(key, structuredClone(value)); return true; } };
  return { store, world: new WorldState(store) };
}

test('world starts in original summer afternoon without writing during construction', () => {
  const { world, store } = fixture();
  assert.equal(world.hour, 14);
  assert.equal(world.day, 1);
  assert.equal(world.cycle.target, 'summer');
  assert.deepEqual(world.climate, SEASONS[1].climate);
  assert.equal(store.writes, 0);
});

test('clock rolls over days, is frame-rate independent, and does not advance while paused', () => {
  for (const fps of [15, 60, 144]) {
    const { world } = fixture();
    for (let i = 0; i < fps * 60; i++) world.update(1 / fps);
    assert.ok(Math.abs(world.hour - 15) < 1e-8);
    const before = world.hour;
    world.update(5, false);
    assert.equal(world.hour, before);
    world.setRunning(false);
    world.update(10);
    assert.equal(world.hour, before);
  }
  const { world } = fixture();
  world.update(DAY_SECONDS * 2);
  assert.equal(world.day, 3);
  assert.equal(world.hour, 14);
});

test('manual time wraps by the shortest route, blends for three seconds and persists its target', () => {
  const { world, store } = fixture({ version: 1, hour: 23 });
  world.setRunning(false);
  world.setHour(1);
  assert.equal(world.hour, 23);
  assert.equal(store.get('world.v1').hour, 1);
  world.update(1.5);
  assert.equal(world.hour, 0);
  world.update(1.5);
  assert.equal(world.hour, 1);
  world.setHour(22);
  world.update(1);
  const start = world.hour;
  world.setHour(12);
  assert.equal(world.hour, start);
  world.update(3);
  assert.equal(world.hour, 12);
  assert.equal(world.day, 1);
});

test('all 24 terms and 9 weather overrides resolve to finite parameters and round-trip saves', () => {
  for (const term of SOLAR_TERMS) for (const weather of WEATHER) {
    const { world, store } = fixture();
    world.setSeason(term.id);
    world.setWeather(weather.id);
    world.update(4);
    for (const value of Object.values(world.climate)) assert.ok(Number.isFinite(value));
    assert.ok(world.snow >= 0 && world.snow <= 1);
    assert.ok(world.snowfall >= 0 && world.snowfall <= 1);
    if (weather.id === 'seasonal') assert.deepEqual(world.climate, term.climate);
    if (weather.id === 'snow') { assert.equal(world.climate.rain, 0); assert.ok(world.climate.temperature <= -2); }
    if (weather.id === 'clear') { assert.equal(world.climate.rain, 0); assert.equal(world.snowfall, 0); }
    world.save();
    const loaded = new WorldState(store);
    assert.equal(loaded.cycle.target, term.id);
    assert.equal(loaded.weather, weather.id);
    assert.deepEqual(loaded.climate, world.climate);
    assert.equal(loaded.hour, world.hour);
  }
});

test('rapid weather switches remain continuous and seasonal mode restores the source exactly', () => {
  const { world } = fixture();
  world.setSeason('jingzhe');
  world.update(4);
  const climate = world.climate;
  world.setWeather('snow');
  world.update(2);
  const halfway = { ...world.climate };
  world.setWeather('clear');
  world.update(0);
  assert.deepEqual(world.climate, halfway);
  world.update(4);
  assert.equal(world.climate.rain, 0);
  world.setWeather('seasonal');
  world.update(4);
  assert.deepEqual(world.climate, world.cycle.state.climate);
  assert.equal(world.climate, climate);
});

test('world validates save boundaries and rejects invalid selection without writes', () => {
  const { world, store } = fixture({ version: 1, hour: NaN, day: -8, season: '__proto__', weather: '__proto__', running: 'false' });
  assert.equal(world.hour, 14);
  assert.equal(world.day, 1);
  assert.equal(world.running, true);
  for (const id of ['__proto__', null, {}, 'missing']) {
    assert.equal(world.setSeason(id), false);
    assert.equal(world.setWeather(id), false);
  }
  for (const n of [NaN, Infinity, -1, 24, '12']) assert.equal(world.setHour(n), false);
  for (const dt of [NaN, Infinity, -1]) world.update(dt);
  assert.equal(world.setRunning(1), false);
  assert.equal(store.writes, 0);
  assert.equal(world.hour, 14);
});

test('autosave is throttled and previous/next term uses the shared persistent selection', () => {
  const { world, store } = fixture();
  for (let i = 0; i < 599; i++) world.update(1 / 60);
  assert.equal(store.writes, 0);
  world.update(0.1);
  assert.equal(store.writes, 1);
  world.setSeason('dahan');
  assert.equal(world.stepTerm(1), true);
  assert.equal(store.get('world.v1').season, 'lichun');
  assert.equal(world.stepTerm(0), false);
});

test('daylight follows seasonal length and remains continuous over midnight', () => {
  assert.ok(daylightAt(6, 15.5).light > daylightAt(6, 8.5).light);
  assert.equal(daylightAt(12).night, 0);
  assert.equal(daylightAt(0).night, 1);
  assert.equal(daylightAt(0, 8).night, 1);
  assert.equal(daylightAt(0, 8).light, 0);
  assert.ok(Math.abs(daylightAt(23.999).light - daylightAt(0.001).light) < 1e-8);
  for (const daylight of [8.5, 12, 15.5]) for (let h = 0; h < 24; h += 0.05) {
    const value = daylightAt(h, daylight);
    for (const key of ['light', 'night', 'dusk']) assert.ok(value[key] >= 0 && value[key] <= 1);
  }
});

test('six clock labels and seasonal weather labels are observable', () => {
  const { world } = fixture();
  world.setRunning(false);
  const labels = [];
  for (const h of [0, 5.5, 8, 12, 15, 18.5]) { world.setHour(h); world.update(3); labels.push(world.phase); }
  assert.equal(new Set(labels).size, 6);
  for (const weather of WEATHER.slice(1)) {
    world.setWeather(weather.id);
    world.update(4);
    assert.equal(world.weatherName, weather.name);
  }
});
