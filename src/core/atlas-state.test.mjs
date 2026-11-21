import test from 'node:test';
import assert from 'node:assert/strict';
import { AtlasState, worldLandmarks } from './atlas-state.js';
import { SaveService } from './save.js';

const terrain = { meta: { world: 6144 }, heightAt: (x, z) => x / 10 + z / 20 };
const town = { id: 'town:port', name: '港口', kind: 'town', hidden: false, pos: { x: 0, y: 20, z: 0 }, radius: 150 };
const place = { id: 'place:grove', name: '隐秘林地', kind: 'place', hidden: true, pos: { x: 900, y: 60, z: 500 }, radius: 80 };
const pad = { id: 'real-pad', name: '屋顶', pos: { x: 15, y: 35, z: 15 } };
const platform = { id: 'pad:real-pad', name: '屋顶', kind: 'landing', hidden: false, pos: pad.pos, pad, radius: 60 };
const landmarks = [town, place, platform];
const setup = () => { const store = new SaveService(null); return { store, atlas: new AtlasState(store, terrain, landmarks) }; };

test('real landmarks retain original pad identities and exact XYZ, without exposing hidden places', () => {
  const game = {
    terrain: { ...terrain, meta: { ...terrain.meta, towns: [{ id: 'port', name: '港口', x: 100, z: 20, r: 300 }] } },
    gameplay: { open: [{ ...pad, spot: '高层露台', town: '港口' }] },
    places: { list: [{ id: 'grove', def: { name: '隐秘林地', hint: '树影里' }, pos: place.pos, radius: 45 }] },
  };
  const result = worldLandmarks(game);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0].pos, { x: 100, y: 11, z: 20 });
  assert.equal(result[0].radius, 250);
  assert.strictEqual(result[1].pad, game.gameplay.open[0]);
  assert.strictEqual(result[1].pos, pad.pos);
  assert.equal(result[2].hidden, true);
  assert.equal(result[2].radius, 80);
});

test('exploration reveals only a local disk and persists fog cells without duplicate rewards', () => {
  const { store, atlas } = setup();
  assert.equal(atlas.percent, 0);
  assert.equal(atlas.coins, 0);
  assert.equal(atlas.isKnown(place), false);
  assert.equal(atlas.isKnown(town), true);
  assert.deepEqual(atlas.update(0, town.pos), [town]);
  assert.equal(atlas.coins, 10);
  assert.ok(atlas.percent > 0 && atlas.percent < 1);
  assert.equal(atlas.cells[48 * 96 + 48], 1);
  assert.equal(atlas.cells[0], 0);
  assert.equal(atlas.discovered.has(platform.id), true);
  assert.deepEqual(atlas.update(1, town.pos), []);
  assert.equal(atlas.coins, 10);
  const restored = new AtlasState(store, terrain, landmarks);
  assert.deepEqual(restored.cells, atlas.cells);
  assert.equal(restored.coins, 10);
  assert.deepEqual(restored.update(0.25, town.pos), []);
  assert.equal(restored.isKnown(place), false);
});

test('hidden places require nearby real-world exploration; map tracking cannot reveal them', () => {
  const { store, atlas } = setup();
  assert.equal(atlas.track('landmark', place.id), false);
  assert.deepEqual(atlas.update(0.3, { ...place.pos, y: place.pos.y + 301 }), []);
  assert.equal(atlas.isKnown(place), false);
  assert.deepEqual(atlas.update(0.3, place.pos), [place]);
  assert.equal(atlas.isKnown(place), true);
  assert.equal(atlas.coins, 5);
  assert.equal(atlas.track('landmark', place.id), true);
  const restored = new AtlasState(store, terrain, landmarks);
  assert.equal(restored.isKnown(place), true);
  assert.strictEqual(restored.resolve(pad), place);
  assert.equal(restored.coins, 5);
});

test('invalid or outside-world exploration does not create rewards or fog data', () => {
  const { atlas } = setup();
  for (const pos of [null, {}, { x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: 3073, y: 20, z: 0 }]) {
    assert.deepEqual(atlas.update(1, pos), []);
  }
  assert.equal(atlas.percent, 0);
  assert.equal(atlas.coins, 0);
  assert.deepEqual(atlas.update(0.25, { x: 3072, y: 0, z: 3072 }), []);
  assert.equal(atlas.cells[96 * 96 - 1], 1);
});

test('exploration batches saves; explicit lifecycle save captures the last unsaved cells', () => {
  let writes = 0;
  const backing = new SaveService(null);
  const store = { get: (...args) => backing.get(...args), set: (...args) => { writes++; backing.set(...args); } };
  const atlas = new AtlasState(store, terrain, []);
  const pos = { x: 0, y: 20, z: 0 };
  for (let i = 0; i < 60; i++) atlas.update(1 / 60, pos);
  assert.equal(writes, 0);
  atlas.save();
  assert.equal(writes, 1);
  for (let i = 0; i < 600; i++) atlas.update(1 / 60, pos);
  assert.equal(writes, 1);
  atlas.update(0.25, { ...pos, x: 1000 });
  atlas.save();
  assert.equal(writes, 2);
  assert.deepEqual(new AtlasState(backing, terrain, []).cells, atlas.cells);
});

test('pins are bounded, capped, renamed and removed without aliasing caller positions', () => {
  const { store, atlas } = setup();
  for (const pos of [null, { x: 0, y: 0, z: NaN }, { x: 9999, y: 20, z: 0 }]) assert.equal(atlas.addPin(pos), null);
  assert.equal(atlas.addPin(pad.pos, '  '), null);
  const position = { ...pad.pos }, pin = atlas.addPin(position, '  海岸停靠  ');
  assert.equal(pin.name, '海岸停靠');
  position.x = 999;
  assert.equal(pin.pos.x, 15);
  assert.equal(atlas.renamePin(pin.id, '<img src=x onerror=alert(1)>'), true);
  assert.equal(atlas.renamePin(pin.id, '\n\t'), false);
  for (let i = 1; i < 12; i++) assert.ok(atlas.addPin(pad.pos));
  assert.equal(atlas.addPin(pad.pos), null);
  assert.equal(atlas.track('pin', pin.id), true);
  assert.equal(atlas.removePin(pin.id), true);
  assert.equal(atlas.tracking, null);
  assert.equal(atlas.resolve(pad), null);
  assert.equal(atlas.removePin(pin.id), false);
  const next = atlas.addPin(pad.pos);
  assert.equal(next.id, 'pin-13');
  const restored = new AtlasState(store, terrain, landmarks);
  assert.equal(restored.pins.length, 12);
  assert.equal(restored.tracking, null);
});

test('tracking switches consistently between live quest, real platform, pin and none', () => {
  const { store, atlas } = setup();
  assert.strictEqual(atlas.resolve(pad), pad);
  assert.strictEqual(atlas.resolve(town), town);
  const pin = atlas.addPin({ x: 40, y: 110, z: 70 }, '高崖');
  assert.equal(atlas.track('pin', pin.id), true);
  assert.strictEqual(atlas.resolve(pad), pin);
  assert.equal(atlas.track('landmark', platform.id), true);
  assert.strictEqual(atlas.resolve(null), pad);
  assert.equal(atlas.track('landmark', 'not-a-place'), false);
  assert.strictEqual(atlas.resolve(null), pad);
  assert.equal(atlas.track('quest'), true);
  assert.equal(atlas.resolve(null), null);
  assert.strictEqual(new AtlasState(store, terrain, landmarks).resolve(pad), pad);
  atlas.clearTracking();
  assert.equal(new AtlasState(store, terrain, landmarks).resolve(pad), null);
});

test('filters and theme persist but filtering never cancels the navigation target', () => {
  const { store, atlas } = setup();
  atlas.track('landmark', platform.id);
  assert.equal(atlas.setFilter('landing', false), true);
  assert.equal(atlas.setFilter('__proto__', false), false);
  assert.equal(atlas.setFilter('landing', 'yes'), false);
  assert.equal(atlas.setTheme('light'), true);
  assert.equal(atlas.setTheme('neon'), false);
  const restored = new AtlasState(store, terrain, landmarks);
  assert.equal(restored.filters.landing, false);
  assert.equal(restored.theme, 'light');
  assert.strictEqual(restored.resolve(null), pad);
});

test('corrupt individual atlas fields are sanitized without inventing discovered locations or rewards', () => {
  const store = new SaveService(null);
  store.set('atlas.v1', {
    version: 1, world: 6144, gridSize: 96,
    cells: [-1, 0, 0, 9215, 9216, 1.5, '2'], discovered: [town.id, town.id, 'nonexistent'],
    pins: [null, { id: 'pin-1', name: '有效', pos: pad.pos }, { id: 'pin-1', name: '重复', pos: pad.pos },
      { id: 'pin-2', name: '越界', pos: { x: 9999, y: 0, z: 0 } }],
    nextPin: -1, theme: 'other', filters: { town: false, place: 'yes' },
    tracking: { kind: 'landmark', id: place.id },
  });
  const atlas = new AtlasState(store, terrain, landmarks);
  assert.equal(atlas.cells.reduce((a, b) => a + b), 2);
  assert.equal(atlas.discovered.size, 1);
  assert.equal(atlas.coins, 10);
  assert.equal(atlas.pins.length, 1);
  assert.equal(atlas.nextPin, 2);
  assert.equal(atlas.theme, 'dark');
  assert.equal(atlas.filters.town, false);
  assert.equal(atlas.filters.place, true);
  assert.deepEqual(atlas.tracking, { kind: 'quest' });
});

test('fog is not replayed against an incompatible world size or schema', () => {
  for (const saved of [null, [], 'bad', { version: 2 }, { version: 1, world: 100, gridSize: 96 }, { version: 1, world: 6144, gridSize: 64 }]) {
    const store = new SaveService(null);
    store.set('atlas.v1', saved);
    const atlas = new AtlasState(store, terrain, landmarks);
    assert.equal(atlas.percent, 0);
    assert.equal(atlas.coins, 0);
    assert.equal(atlas.pins.length, 0);
  }
});

test('atlas writes preserve legacy first-order rewards and all other world data', () => {
  const { store, atlas } = setup();
  store.set('first-delivery.v1', { version: 1, status: 'completed', fly: true });
  store.set('world.v1', { version: 1, hour: 0, season: 'winter' });
  atlas.update(0, town.pos);
  atlas.addPin(pad.pos, '屋顶');
  assert.equal(store.get('first-delivery.v1').status, 'completed');
  assert.deepEqual(store.get('world.v1'), { version: 1, hour: 0, season: 'winter' });
});
