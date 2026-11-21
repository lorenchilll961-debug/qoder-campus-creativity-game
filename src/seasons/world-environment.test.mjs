import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Match the existing headless tests: use vendored Three.js, without DOM/WebGL or installs.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('../../vendor/three/build/three.module.js', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { U, ENV, applyEnv } = await import('../core/ctx.js');
const { Seasons } = await import('./index.js');
const { WorldState, DAY_SECONDS } = await import('../core/world-state.js');
const { SaveService } = await import('../core/save.js');
const { SOLAR_TERMS, TRANSITION_SECONDS } = await import('./cycle.js');

const ENV_KEYS = ['uSunColor', 'uSkyZenith', 'uSkyMid', 'uSkyHorizon', 'uSunHalo', 'uAmbSky', 'uAmbGround', 'uFog', 'uWind'];
const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) <= 1e-12, `${label}: ${actual} != ${expected}`);
function vector(key, expected) {
  const actual = U[key].value.toArray();
  assert.equal(actual.length, expected.length, key);
  actual.forEach((value, i) => near(value, expected[i], `${key}[${i}]`));
}
const environmentValues = () => Object.fromEntries(ENV_KEYS.map((key) => [key, U[key].value.toArray()]));

// Restore shared uniform identities and values even when an assertion fails.
let uniformsBefore;
beforeEach(() => {
  uniformsBefore = Object.entries(U).map(([key, uniform]) => ({
    key, uniform, value: uniform.value, snapshot: uniform.value?.clone?.() ?? uniform.value,
  }));
});
afterEach(() => {
  for (const { key, uniform, value, snapshot } of uniformsBefore) {
    U[key] = uniform;
    uniform.value = value;
    if (value?.copy) value.copy(snapshot);
  }
});

function fixture(t) {
  applyEnv('afternoon');
  const save = new SaveService(null);
  const world = new WorldState(save);
  const weather = {
    flash: 0, calls: [],
    update(dt) {
      this.calls.push({ dt, hour: world.hour, thunder: world.climate.thunder, weather: U.uWeather.value.toArray() });
      U.uWeather.value.w = this.flash;
    },
  };
  const game = { state: 'play', worldState: world, pipeline: { overlay: {} }, weather };
  // Only the DOM constructor is bypassed; update/atmosphere/clock remain real methods.
  const seasons = Object.create(Seasons.prototype);
  Object.assign(seasons, {
    game, cycle: world.cycle,
    environment: Object.fromEntries(ENV_KEYS.map((key) => [key, U[key].value.clone()])),
    progress: { value: world.cycle.progress }, showSelection: t.mock.fn(),
  });
  return { seasons, game, world, save, weather };
}

function assertWorldUniforms(world) {
  const state = world.cycle.state, c = world.climate;
  vector('uSeasonGrass', state.grass);
  vector('uSeasonLeaves', state.leaves);
  for (const [key, field] of [
    ['uSeasonBloom', 'bloom'], ['uSeasonPastel', 'pastel'],
    ['uSeasonBare', 'bare'], ['uSeasonWither', 'wither'],
  ]) near(U[key].value, state[field], key);
  near(U.uSeasonSnow.value, world.snow, 'snow');
  near(U.uSeasonSnowfall.value, world.snowfall, 'snowfall');
  vector('uClimate', [c.strength, c.temperature, c.daylight, c.heat]);
  vector('uWeather', [c.rain, c.cloud, c.fog, 0]);
  vector('uSurfaceWeather', [c.wetness, c.dew, c.frost, c.frozenSoil]);
  vector('uPhenology', [c.cropGrowth, c.cropRipeness, c.cropHarvest, c.birds]);
  near(U.uSeasonIce.value, c.ice, 'ice');
  near(U.uSeasonGoldBloom.value, c.goldBloom, 'gold bloom');
}

function assertAfternoon() {
  const e = ENV.afternoon;
  for (const [key, field] of [
    ['uSunColor', 'sunColor'], ['uSkyZenith', 'zenith'], ['uSkyMid', 'mid'],
    ['uSkyHorizon', 'horizon'], ['uSunHalo', 'halo'], ['uAmbSky', 'ambSky'], ['uAmbGround', 'ambGround'],
  ]) vector(key, e[field]);
  vector('uFog', [...e.fog, 0, 0]);
}

test('title does not advance world time or transitions; play advances the real world once', (t) => {
  const { seasons, game, world, save, weather } = fixture(t);
  game.state = 'title';
  world.setSeason('winter');
  world.setWeather('rain');
  seasons.update(60);
  assert.equal(world.hour, 14);
  assert.equal(world.day, 1);
  assert.equal(world.cycle.progress, 0);
  assert.equal(world.climate.rain, 0);
  vector('uDayNight', [1, 0, 0, 14]);
  assertAfternoon();

  game.state = 'play';
  seasons.update(2);
  near(world.hour, 14 + 2 * 24 / DAY_SECONDS);
  assert.equal(world.cycle.progress, 0.5);
  assert.equal(seasons.progress.value, 0.5);
  near(U.uWeather.value.x, 0.225);
  seasons.update(58);
  near(world.hour, 15);
  assert.equal(world.cycle.progress, 1);
  assert.equal(seasons.showSelection.mock.callCount(), 1);
  assert.deepEqual(weather.calls.map(({ dt }) => dt), [60, 2, 58]);
  near(weather.calls.at(-1).hour, 15);
  assertWorldUniforms(world);
  assert.equal(save.status, 'memory');
  near(save.get('world.v1').hour, 15);
});

test('midnight and daylight write the clock palette, day/night uniform and overlay intensity', (t) => {
  const { seasons, game, world } = fixture(t);
  world.setRunning(false);
  world.setHour(0);
  seasons.update(3);
  vector('uDayNight', [0, 1, 0, 0]);
  vector('uSunColor', [0.2, 0.24, 0.34]);
  vector('uSkyZenith', [0.025, 0.042, 0.085]);
  vector('uSkyMid', [0.06, 0.09, 0.15]);
  vector('uSkyHorizon', [0.14, 0.18, 0.23]);
  vector('uAmbSky', [0.22, 0.28, 0.4]);
  vector('uAmbGround', [0.08, 0.1, 0.15]);
  vector('uSunHalo', [0, 0, 0]);
  near(game.pipeline.overlay.environmentIntensity, 0.12);

  world.setHour(12);
  seasons.update(3);
  vector('uDayNight', [1, 0, 0, 12]);
  near(game.pipeline.overlay.environmentIntensity, 1);
  assertAfternoon();
});

test('repeated dusk frames do not accumulate darkness and summer afternoon restores the original environment', (t) => {
  const { seasons, world } = fixture(t);
  const original = environmentValues();
  for (const key of ENV_KEYS) assert.notStrictEqual(seasons.environment[key], U[key].value);
  world.setRunning(false);
  world.setSeason('jingzhe');
  world.setWeather('downpour');
  world.setHour(17.5);
  seasons.update(TRANSITION_SECONDS);
  assert.ok(U.uDayNight.value.x > 0 && U.uDayNight.value.x < 1);
  assert.ok(U.uDayNight.value.z > 0);
  const dusk = environmentValues();
  assert.notDeepEqual(dusk, original);
  for (let frame = 0; frame < 180; frame++) {
    seasons.update(1 / 60);
    assert.deepEqual(environmentValues(), dusk, `dusk frame ${frame}`);
  }
  world.setSeason('summer');
  world.setWeather('seasonal');
  world.setHour(14);
  seasons.update(TRANSITION_SECONDS);
  for (let frame = 0; frame < 120; frame++) {
    seasons.update(1 / 60);
    assert.deepEqual(environmentValues(), original, `summer frame ${frame}`);
  }
  assertAfternoon();
  vector('uDayNight', [1, 0, 0, 14]);
  assertWorldUniforms(world);
  assert.deepEqual(Object.fromEntries(ENV_KEYS.map((key) => [key, seasons.environment[key].toArray()])), original);
});

test('applyAtmosphere uses the saved afternoon palette for real Qingming fog, clouds and lightning', (t) => {
  const { seasons, world } = fixture(t);
  world.setRunning(false);
  world.setSeason('qingming');
  world.update(TRANSITION_SECONDS);
  const c = world.climate, e = ENV.afternoon;
  U.uWeather.value.set(c.rain, c.cloud, c.fog, 0.2);
  seasons.applyAtmosphere(c);
  // Qingming: daylight factor .91, neutral warmth, cloud .8, fog .8, rain .3.
  vector('uSunColor', e.sunColor.map((v, i) => v * 0.35672 + [0.11, 0.13, 0.16][i]));
  for (const [key, field, overcast] of [
    ['uSkyZenith', 'zenith', [0.18, 0.22, 0.29]],
    ['uSkyMid', 'mid', [0.36, 0.42, 0.5]],
    ['uSkyHorizon', 'horizon', [0.6, 0.65, 0.7]],
  ]) vector(key, e[field].map((v, i) => (v + (overcast[i] - v) * 0.736) * 0.9658 + 0.044));
  vector('uSunHalo', e.halo.map((v) => v * 0.2912));
  vector('uAmbSky', e.ambSky.map((v) => v * 0.765408 + 0.036));
  vector('uAmbGround', e.ambGround.map((v) => v * 0.9185));
  vector('uFog', [0.001647, 1 / 620, 0, 0]);
  const first = environmentValues();
  seasons.applyAtmosphere(c);
  assert.deepEqual(environmentValues(), first);
});

// Independent expected overrides, not values read back from the production WEATHER table.
const WEATHER_CASES = [
  ['clear', 0, 0, 0, 0, 0.45],
  ['cloudy', 0, 0.4, 0.05, 0, 0.7],
  ['overcast', 0, 0.9, 0.15, 0, 0.6],
  ['rain', 0.45, 0.75, 0.2, 0, 0.8],
  ['downpour', 1, 1, 0.42, 0, 1.4],
  ['thunder', 0.85, 0.95, 0.3, 1, 1.6],
  ['fog', 0, 0.6, 1, 0, 0.2],
  ['snow', 0, 0.8, 0.35, 0, 0.85],
  ['wind', 0, 0.35, 0.08, 0, 2.1],
];
for (const [id, rain, cloud, fog, thunder, wind] of WEATHER_CASES) {
  test(`${id} override reaches the shared uniforms before the weather update`, (t) => {
    const { seasons, world, save, weather } = fixture(t);
    world.setRunning(false);
    world.setSeason('hanlu');
    seasons.update(TRANSITION_SECONDS);
    assert.equal(world.setWeather(id), true);
    seasons.update(TRANSITION_SECONDS);
    vector('uWeather', [rain, cloud, fog, 0]);
    vector('uClimate', [1, id === 'snow' ? -2 : 11, 11.3, 0]);
    vector('uSurfaceWeather', [Math.max(0.48, rain), 0.8, 0, 0]);
    vector('uPhenology', [0.2, 0, 0.2, -0.75]);
    const length = Math.hypot(0.4, 0.9);
    vector('uWind', [0.4 / length, 0.9 / length, wind, seasons.environment.uWind.w]);
    near(U.uSeasonSnow.value, id === 'snow' ? 0.72 : 0);
    near(U.uSeasonSnowfall.value, id === 'snow' ? 0.8 : 0);
    assert.equal(U.uSeasonGoldBloom.value, 1);
    assertWorldUniforms(world);
    assert.deepEqual(weather.calls.at(-1), { dt: TRANSITION_SECONDS, hour: 14, thunder, weather: [rain, cloud, fog, 0] });
    assert.equal(save.get('world.v1').weather, id);
  });
}

test('clear winter keeps accumulated snow but stops snowfall, independently of the cycle snowfall', (t) => {
  const { seasons, world } = fixture(t);
  world.setRunning(false);
  world.setSeason('winter');
  seasons.update(TRANSITION_SECONDS);
  assert.equal(U.uSeasonSnow.value, 1);
  assert.equal(U.uSeasonSnowfall.value, 1);
  world.setWeather('clear');
  seasons.update(TRANSITION_SECONDS / 2);
  assert.equal(U.uSeasonSnow.value, 1);
  near(U.uSeasonSnowfall.value, 0.5);
  seasons.update(TRANSITION_SECONDS / 2);
  assert.equal(world.cycle.state.snowfall, 1);
  assert.equal(U.uSeasonSnow.value, 1);
  assert.equal(U.uSeasonSnowfall.value, 0);
  vector('uWeather', [0, 0, 0, 0]);
  assertWorldUniforms(world);
});

test('nighttime lightning survives applyClock and brightens sun, sky and ambient without lingering', (t) => {
  const { seasons, world, weather } = fixture(t);
  world.setRunning(false);
  world.setWeather('thunder');
  world.setHour(0);
  seasons.update(TRANSITION_SECONDS);
  const dark = environmentValues();
  vector('uDayNight', [0, 1, 0, 0]);
  weather.flash = 0.2;
  seasons.update(1 / 60);
  vector('uWeather', [0.85, 0.95, 0.3, 0.2]);
  for (const [key, boost] of [
    ['uSunColor', [0.11, 0.13, 0.16]],
    ['uSkyZenith', [0.044, 0.044, 0.044]], ['uSkyMid', [0.044, 0.044, 0.044]],
    ['uSkyHorizon', [0.044, 0.044, 0.044]],
    ['uAmbSky', [0.036, 0.036, 0.036]], ['uAmbGround', [0.036, 0.036, 0.036]],
  ]) {
    vector(key, dark[key].map((v, i) => v + boost[i]));
    assert.ok(U[key].value.toArray().every((v, i) => v > dark[key][i]), key);
  }
  const lit = environmentValues();
  seasons.update(1 / 60);
  assert.deepEqual(environmentValues(), lit);
  assert.deepEqual(weather.calls.at(-1).weather, [0.85, 0.95, 0.3, 0], 'old flash is cleared before weather supplies this frame');
  weather.flash = 0;
  seasons.update(1 / 60);
  assert.deepEqual(environmentValues(), dark);
});

test('selection and updates retain the world-owned cycle and state, advancing it only once per frame', (t) => {
  const { seasons, world, save } = fixture(t);
  world.setRunning(false);
  const cycle = world.cycle, state = cycle.state, climate = world.climate;
  const update = t.mock.method(cycle, 'update'); // Call through to the real private-field cycle.
  for (const [index, id] of ['spring', 'hanlu', 'dahan', 'dashu', 'summer'].entries()) {
    seasons.select(id);
    assert.strictEqual(seasons.cycle, cycle);
    assert.strictEqual(world.cycle, cycle);
    assert.equal(cycle.target, id);
    assert.equal(save.get('world.v1').season, id);
    seasons.update(1);
    assert.equal(cycle.progress, 0.25);
    assert.equal(seasons.progress.value, 0.25);
    seasons.update(TRANSITION_SECONDS - 1);
    assert.equal(cycle.progress, 1);
    assert.equal(seasons.progress.value, 1);
    assert.strictEqual(seasons.cycle, cycle);
    assert.strictEqual(world.cycle, cycle);
    assert.strictEqual(cycle.state, state);
    assert.strictEqual(world.climate, climate);
    assert.equal(update.mock.callCount(), (index + 1) * 2);
    assert.equal(seasons.showSelection.mock.callCount(), (index + 1) * 2);
    const term = SOLAR_TERMS.find((preset) => preset.id === id);
    if (term) assert.deepEqual(world.climate, term.climate);
    assertWorldUniforms(world);
  }
});
