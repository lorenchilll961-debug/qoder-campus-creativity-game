import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { GameModal } from './dialogue.js';
import { Input } from '../player/input.js';
import { AtlasState } from '../core/atlas-state.js';
import { SaveService } from '../core/save.js';

// Test only the shared modal's public contract, without requiring a browser or Three.js.
const mapURL = new URL('./world-map.js', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === './dialogue.js' && context.parentURL === mapURL) return {
    shortCircuit: true,
    url: `data:text/javascript,${encodeURIComponent(`export class GameModal {
      constructor(game, dialog, options) { this.game = game; this.dialog = dialog; this.options = options; }
      get isOpen() { return !!this.dialog.open; }
      show() {
        if (this.game.state !== 'play' || this.game.paused || this.game.modal || this.isOpen) return false;
        this.game.paused = true; this.game.modal = this; this.dialog.open = true; return true;
      }
      close() {
        this.dialog.open = false; this.game.paused = false; this.game.modal = null;
        this.dialog.fire('close', {});
      }
    }`)}`,
  };
  return next(specifier, context);
} });
const { WorldMap, boundView, panView, zoomView, fitView, mapPoint, unmapPoint } = await import(mapURL);
hooks.deregister();
const WORLD = 6144, w = 960, h = 640;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('projection is isotropic, with -z north and +x east', () => {
  const v = { x: 20, z: -40, span: 1600 };
  assert.deepEqual(mapPoint(v, v, w, h), { x: w / 2, y: h / 2 });
  near(mapPoint({ x: 120, z: -140 }, v, w, h).x - w / 2, 40);
  near(mapPoint({ x: 120, z: -140 }, v, w, h).y - h / 2, -40);
});
test('drag follows the pointer and never mutates the input view', () => {
  const v = Object.freeze({ x: 0, z: 0, span: 1600 });
  const next = panView(v, 80, -40, WORLD, w, h);
  assert.deepEqual(next, { x: -200, z: 100, span: 1600 });
  assert.deepEqual(mapPoint({ x: 0, z: 0 }, next, w, h), { x: w / 2 + 80, y: h / 2 - 40 });
});
test('wheel zoom anchors the cursor world point and reverses cleanly away from edges', () => {
  const v = { x: 80, z: -120, span: 2000 }, p = { x: 230, z: 150 };
  const screen = mapPoint(p, v, w, h), zoomed = zoomView(v, 0.5, screen.x, screen.y, WORLD, w, h);
  near(mapPoint(p, zoomed, w, h).x, screen.x); near(mapPoint(p, zoomed, w, h).y, screen.y);
  const original = zoomView(zoomed, 2, screen.x, screen.y, WORLD, w, h);
  near(original.x, v.x); near(original.z, v.z); near(original.span, v.span);
});
test('pan/zoom limits hold for landscape, portrait and extreme wheel input', () => {
  for (const [width, height] of [[960, 640], [320, 700], [1, 1]]) {
    const v = boundView({ x: 1e9, z: -1e9, span: 1 }, WORLD, width, height);
    assert.equal(v.span, WORLD / 24);
    near(v.x, Math.max(0, (WORLD - v.span * width / Math.min(width, height)) / 2));
    const full = zoomView(v, Infinity, 0, 0, WORLD, width, height);
    assert.deepEqual(full, { x: 0, z: 0, span: WORLD * 1.08 });
    assert.equal(zoomView(full, 0, 0, 0, WORLD, width, height).span, WORLD / 24);
  }
});
test('route fitting includes every point in either aspect ratio, and handles empty/single routes', () => {
  const points = [{ x: -2500, z: -2700 }, { x: 2200, z: 2600 }, { x: 0, z: 100 }];
  for (const [width, height] of [[960, 640], [360, 740]]) {
    const v = fitView([...points, null, { x: NaN, z: 0 }], WORLD, width, height);
    for (const p of points) {
      const q = mapPoint(p, v, width, height);
      assert.ok(q.x >= 0 && q.x <= width && q.y >= 0 && q.y <= height);
    }
  }
  assert.deepEqual(fitView([], WORLD, w, h), { x: 0, z: 0, span: WORLD * 1.08 });
  assert.ok(fitView([points[2]], WORLD, w, h).span >= WORLD / 24);
});
test('resizing re-bounds the view rather than stretching world geometry', () => {
  const next = boundView({ x: 2700, z: -2800, span: 800 }, WORLD, 320, 800);
  near(next.x, 2672); near(next.z, -2072);
  const a = mapPoint({ x: next.x + 100, z: next.z + 100 }, next, 320, 800);
  near(a.x - 160, a.y - 400);
});

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.value = ''; this.attributes = new Map(); this.nodes = [];
    this.handlers = new Map(); this.children = new Map(); this.dataset = {}; this.classes = new Set();
    this.classList = { add: x => this.classes.add(x), remove: x => this.classes.delete(x),
      toggle: (x, on) => on ? this.classes.add(x) : this.classes.delete(x) };
    this.calls = [];
    this.context = new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: text => ({ width: text.length * 8 }) },
      { get: (obj, key) => obj[key] ?? ((...args) => this.calls.push([key, ...args])) });
  }
  set textContent(value) { this.text = value; this.nodes = []; }
  get textContent() { return this.text || this.nodes.map(node => node.textContent).join(''); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  appendChild(node) { this.nodes.push(node); }
  append(...nodes) { this.nodes.push(...nodes); }
  replaceChildren(...nodes) { this.nodes = nodes; }
  getContext() { return this.context; }
  querySelector(key) {
    if (!this.children.has(key)) this.children.set(key, new Element(key === '#wm-pin-name' ? 'input' : key));
    return this.children.get(key);
  }
  addEventListener(event, cb, options) { const list = this.handlers.get(event) || []; list.push({ cb, options }); this.handlers.set(event, list); }
  fire(event, e) { for (const { cb } of this.handlers.get(event) || []) { cb(e); if (e.stopped) break; } }
  getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; }
  setPointerCapture(id) { this.pointer = id; }
  hasPointerCapture(id) { return this.pointer === id; }
  releasePointerCapture() { this.pointer = undefined; }
  matches(selector) { return selector.split(',').map(s => s.trim()).includes(this.tag); }
  closest() { return this; }
  focus() { this.focused = true; }
  select() { this.selectedText = true; }
}
function setup(t) {
  for (const key of ['document', 'window', 'ResizeObserver']) {
    const value = globalThis[key];
    t.after(() => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  }
  globalThis.document = new Element();
  document.createElement = tag => new Element(tag); document.body = new Element();
  globalThis.window = new Element(); window.devicePixelRatio = 2;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} };
  let samples = 0, first, last;
  const game = { state: 'play', paused: false, flight: { pos: { x: 0, y: 31, z: 0 }, yaw: 0 },
    terrain: { meta: { world: WORLD, towns: [{ name: '云雀港', x: 400, z: 500, r: 80 }], river: [[-120, -500, 8], [40, -180, 12], [60, 0, 14]] },
      heightAt: (x, z) => { samples++; first ??= { x, z }; last = { x, z }; return x / 20 + z / 30; } },
    town: { buildings: [{ pos: [100, 30, -80], top: 50 }] } };
  const courier = { target: { name: '测试屋顶', spot: '塔顶平台', pos: { x: 100, y: 81.25, z: -80 } },
    pickup: { pos: { x: -100, y: 5, z: 80 } }, quest: { status: 'active' }, opened: 0, mapOpened() { this.opened++; } };
  courier.destination = courier.target;
  const town = { id: 'town:port', name: '云雀港', kind: 'town', hidden: false, description: '沿海聚落', pos: { x: 400, y: 36.5, z: 500 }, radius: 80 };
  const landing = { id: 'pad:roof', name: courier.target.name, kind: 'landing', hidden: false, description: '真正的塔顶平台', pos: courier.target.pos, pad: courier.target, radius: 60 };
  const secret = { id: 'place:secret', name: '不可泄露的秘境', kind: 'place', hidden: true, description: '尚未发现', pos: { x: -900, y: 90, z: 900 }, radius: 80 };
  const atlas = game.atlas = new AtlasState(new SaveService(null), game.terrain, [town, landing, secret]);
  const map = new WorldMap(game, courier);
  return { map, game, courier, atlas, town, landing, secret, samples: () => samples, edges: () => [first, last] };
}
const keyEvent = (overrides = {}) => ({ code: 'KeyM', repeat: false, composedPath: () => [new Element()],
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides });

test('M uses capture, only opens during unpaused play, and consumes only successful opens', (t) => {
  const { map, game, courier } = setup(t);
  assert.equal(window.handlers.get('keydown')[0].options, true);
  for (const overrides of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { code: 'KeyJ' },
    { composedPath: () => [{ matches: () => true }] }, { composedPath: () => [{ isContentEditable: true }] }]) {
    const event = keyEvent(overrides); window.fire('keydown', event); assert.equal(map.isOpen, false); assert.ok(!event.stopped);
  }
  for (const [field, value] of [['state', 'title'], ['paused', true], ['modal', {}]]) {
    const original = game[field]; game[field] = value;
    const event = keyEvent(); window.fire('keydown', event); assert.equal(map.isOpen, false); assert.ok(!event.prevented);
    game[field] = original;
  }
  const event = keyEvent(); window.fire('keydown', event);
  assert.ok(event.prevented && event.stopped && map.isOpen); assert.equal(courier.opened, 1);
  const again = keyEvent(); window.fire('keydown', again); assert.ok(!again.stopped); assert.equal(courier.opened, 1);
});
test('open renders current coordinates and exact roof height before notifying courier; reopen refreshes', (t) => {
  const { map, game, courier } = setup(t);
  courier.mapOpened = () => assert.match(map.dialog.querySelector('.wm-order').textContent, /81\.25/);
  assert.equal(map.open(), true);
  assert.match(map.dialog.querySelector('.wm-position').textContent, /50\.25/);
  assert.equal(map.open(), false);
  const view = { x: 100, z: 50, span: 800 }; map.setView(view); map.close();
  game.flight.pos.x = 123; courier.quest.status = 'completed';
  assert.equal(map.open(), true); assert.deepEqual(map.view, view);
  assert.match(map.dialog.querySelector('.wm-position').textContent, /玩家 X 123\.0/);
  assert.match(map.dialog.querySelector('.wm-order').textContent, /订单已完成/);
  map.close(); game.paused = true; assert.equal(map.open(), false);
});
test('thumbnail samples actual world coordinates once; closed renders/resizes do no work', (t) => {
  const { map, samples, edges } = setup(t);
  assert.equal(samples(), 0); map.render(); assert.equal(samples(), 0);
  map.open(); const cachedSamples = samples(), size = map.thumb.width;
  assert.equal(cachedSamples, size ** 2); assert.ok(size >= 256);
  const edge = WORLD / 2 - WORLD / size / 2;
  assert.deepEqual(edges(), [{ x: -edge, z: -edge }, { x: edge, z: edge }]);
  map.render(); map.observer.cb(); map.close(); map.observer.cb(); map.render(); map.open();
  assert.equal(samples(), cachedSamples);
});
test('buttons, pointer capture, wheel anchor, zoom limits and drag cancellation are wired', (t) => {
  const { map, courier } = setup(t); map.open();
  const click = action => map.dialog.fire('click', { target: { closest: () => ({ dataset: { action } }) } });
  click('route'); assert.ok(map.view.span < WORLD); click('player'); near(map.view.x, 0);
  map.canvas.fire('pointerdown', { pointerId: 7, button: 0, clientX: 0, clientY: 0, preventDefault() {} });
  assert.ok(map.canvas.hasPointerCapture(7));
  map.canvas.fire('pointermove', { pointerId: 7, clientX: 60, clientY: 30 }); assert.ok(map.view.x < 0 && map.view.z < 0);
  window.fire('blur', {}); assert.equal(map.drag, null); assert.equal(map.canvas.pointer, undefined);
  const before = map.view.span;
  map.canvas.fire('wheel', { deltaY: -100, deltaMode: 0, clientX: w / 2, clientY: h / 2, preventDefault() {} });
  assert.ok(map.view.span < before);
  for (let i = 0; i < 30; i++) click('in'); assert.ok(map.dialog.querySelector('[data-action="in"]').disabled);
  click('all'); assert.ok(map.dialog.querySelector('[data-action="out"]').disabled);
  courier.target = null; courier.pickup = null; courier.destination = null; map.render();
  assert.match(map.dialog.querySelector('.wm-order').textContent, /暂无当前目标/);
  click('close'); assert.equal(map.isOpen, false);
});

test('real modal owns pause, clears input, restores focus and survives delayed close after reopening', (t) => {
  const { game } = setup(t);
  const dialog = new Element();
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  let cleared = 0, focused = 0, unlocked = 0;
  game.input = { enabled: true, clear: () => cleared++, canvas: { focus: () => focused++ } };
  document.pointerLockElement = game.input.canvas;
  document.exitPointerLock = () => unlocked++;
  const modal = new GameModal(game, dialog, { closeKey: 'KeyM' });
  assert.ok(modal.show());
  assert.ok(game.paused && !game.input.enabled && dialog.open);
  assert.equal(cleared, 1); assert.equal(unlocked, 1);
  const other = new GameModal(game, new Element());
  assert.equal(other.show(), false);
  modal.close();
  assert.ok(!game.paused && game.input.enabled && !dialog.open);
  assert.equal(cleared, 2); assert.equal(focused, 1);
  assert.ok(modal.show());
  dialog.fire('close', {});
  assert.ok(modal.isOpen && game.paused && !game.input.enabled);
  modal.close();
  dialog.fire('close', {});
  assert.equal(focused, 2);
  game.paused = true;
  assert.equal(modal.show(), false);
});

test('real modal blocks gameplay keys, preserves native Tab and consumes M or Esc on close', (t) => {
  const { game } = setup(t);
  window.handlers.clear();
  const dialog = new Element();
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  game.input = { enabled: true, clear() {}, canvas: { focus() {} } };
  const modal = new GameModal(game, dialog, { closeKey: 'KeyM' });
  modal.show();
  for (const code of ['KeyW', 'KeyJ', 'Space', 'Tab']) {
    const event = keyEvent({ code }); window.fire('keydown', event);
    assert.ok(event.stopped); assert.ok(!event.prevented); assert.ok(modal.isOpen);
  }
  const repeat = keyEvent({ repeat: true }); window.fire('keydown', repeat);
  assert.ok(repeat.prevented && modal.isOpen);
  const close = keyEvent(); window.fire('keydown', close);
  assert.ok(close.prevented && close.stopped && !modal.isOpen);
  modal.show();
  const escape = keyEvent({ code: 'Escape' }); window.fire('keydown', escape);
  assert.ok(escape.prevented && !modal.isOpen && game.input.enabled);
});

test('input clearing removes held keys, taps, mouse impulses and walking motion', (t) => {
  setup(t); document.addEventListener = () => {};
  const input = new Input(new Element());
  input.keys.add('Space'); input.pressed.add('KeyE'); input.pressed.add('Space2');
  input.stickX = input.turn = input.walkZ = input._lookX = 1;
  input.brake = input.mouseBoost = input.walkFast = true; input._tap = 100;
  input.clear();
  assert.equal(input.keys.size, 0); assert.equal(input.pressed.size, 0);
  for (const key of ['stickX', 'turn', 'walkZ', '_lookX']) assert.equal(input[key], 0);
  for (const key of ['brake', 'mouseBoost', 'walkFast']) assert.equal(input[key], false);
  input._tapBrake(101); assert.equal(input.take('Space2'), false);
});

const click = (map, action) => map.dialog.fire('click', { target: { closest: () => ({ dataset: { action } }) } });
const filter = (map, kind) => map.dialog.fire('click', { target: { closest: () => ({ dataset: { filter: kind } }) } });
const pointer = (map, event, x, y, overrides = {}) => map.canvas.fire(event, {
  pointerId: 7, button: 0, clientX: x, clientY: y, preventDefault() {}, ...overrides,
});
const tap = (map, p) => { pointer(map, 'pointerdown', p.x, p.y); pointer(map, 'pointerup', p.x, p.y); };
const submitPin = map => map.dialog.querySelector('.wm-pin-editor').fire('submit', { preventDefault() {} });

test('inverse projection roundtrips arbitrary coordinates in landscape and portrait', () => {
  for (const [width, height] of [[1440, 900], [1024, 576], [360, 740], [1, 1]]) {
    for (const view of [{ x: 0, z: 0, span: WORLD * 1.08 }, { x: 1700, z: -800, span: 800 }]) {
      for (const p of [{ x: -3072, z: 3072 }, { x: 140.25, z: -80.5 }, { x: 0, z: 0 }]) {
        const result = unmapPoint(mapPoint(p, view, width, height), view, width, height);
        near(result.x, p.x); near(result.z, p.z);
      }
    }
  }
});

test('canvas selection and native button list share details, tracking and real platform Y', t => {
  const { map, atlas, town, landing, courier } = setup(t); map.open();
  assert.equal(map.dialog.querySelector('[data-action="track"]').disabled, true);
  tap(map, mapPoint(town.pos, map.view, w, h));
  assert.equal(map.selected(), town);
  assert.equal(map.dialog.querySelector('.wm-detail-name').textContent, town.name);
  assert.match(map.dialog.querySelector('.wm-detail-coordinates').textContent, /高差 \+5\.50/);
  click(map, 'track'); assert.deepEqual(atlas.tracking, { kind: 'landmark', id: town.id });
  assert.equal(map.dialog.querySelector('[data-action="track"]').disabled, true);
  assert.match(map.dialog.querySelector('.wm-order').textContent, /云雀港/);
  const row = map.rows.find(row => row.dataset.id === landing.id);
  assert.equal(row.tag, 'button'); assert.equal(row.type, 'button');
  map.dialog.fire('click', { target: row }); // Native Enter/Space activation emits this same click.
  assert.equal(map.selected(), landing);
  assert.equal(row.getAttribute('aria-pressed'), 'true');
  assert.match(map.dialog.querySelector('.wm-detail-coordinates').textContent, /平台高度 81\.25 米（世界 Y）/);
  click(map, 'track'); assert.equal(map.target(), courier.target);
  assert.match(map.dialog.querySelector('.wm-order').textContent, /平台高度 81\.25/);
  click(map, 'focus'); near(map.view.x, landing.pos.x); near(map.view.z, landing.pos.z);
  click(map, 'quest'); assert.deepEqual(atlas.tracking, { kind: 'quest' });
  assert.equal(map.dialog.querySelector('[data-action="quest"]').disabled, true);
  click(map, 'stop'); assert.equal(atlas.tracking, null);
  assert.equal(map.target(), null); assert.equal(map.dialog.querySelector('[data-action="stop"]').disabled, true);
  assert.equal(map.dialog.querySelector('[data-action="route"]').disabled, true);
  assert.equal(courier.destination, courier.target); assert.equal(courier.quest.status, 'active');
});

test('tracking another real pad reports platform height rather than sampled terrain height', t => {
  const { map, atlas, landing } = setup(t);
  const pad = { id: 'other-pad', name: '另一处高台', spot: '高层露台', pos: { x: 900, y: 153.75, z: 300 } };
  atlas.landmarks.push({ ...landing, id: 'pad:other', name: pad.name, pos: pad.pos, pad });
  map.open(); map.select('landmark', 'pad:other'); click(map, 'track');
  assert.equal(map.target(), pad);
  assert.match(map.dialog.querySelector('.wm-order').textContent, /平台高度 153\.75/);
  assert.match(map.dialog.querySelector('.wm-position').textContent, /高差 \+122\.75/);
});

test('filters affect symbols, hit testing and accessible list without revealing hidden places', t => {
  const { map, atlas, town, secret } = setup(t); map.open();
  const cells = [...atlas.cells], discoveries = [...atlas.discovered];
  assert.equal(map.rows.length, 2); assert.equal(map.visibleItems().includes(secret), false);
  assert.equal(map.hitTest(mapPoint(secret.pos, map.view, w, h)), undefined);
  map.select('landmark', secret.id); assert.equal(map.selection, null);
  assert.ok(!map.canvas.calls.some(call => call[0] === 'fillText' && String(call[1]).includes(secret.name)));
  map.select('landmark', town.id); filter(map, 'town');
  assert.equal(atlas.filters.town, false); assert.equal(map.selection, null);
  assert.equal(map.dialog.querySelector('[data-filter="town"]').getAttribute('aria-pressed'), 'false');
  assert.equal(map.rows.some(row => row.dataset.id === town.id), false);
  assert.equal(map.hitTest(mapPoint(town.pos, map.view, w, h)), undefined);
  for (const kind of ['landing', 'place', 'pin']) filter(map, kind);
  assert.equal(map.rows.length, 0); assert.equal(map.dialog.querySelector('.wm-empty').hidden, false);
  assert.deepEqual([...atlas.cells], cells); assert.deepEqual([...atlas.discovered], discoveries);
  atlas.cells.fill(1); filter(map, 'place'); // Fog visibility alone must not disclose a hidden landmark.
  assert.equal(map.rows.some(row => row.dataset.id === secret.id), false);
  atlas.update(0.25, secret.pos); map.render();
  assert.equal(map.rows.some(row => row.dataset.id === secret.id), true);
  tap(map, mapPoint(secret.pos, map.view, w, h)); assert.equal(map.selected(), secret);
});

test('completed delivery removes its obsolete route and stop labels without hiding public landmarks', t => {
  const { map, courier, game, town } = setup(t);
  courier.quest.status = 'completed'; courier.target = null; map.open();
  assert.deepEqual(map.routePoints(), [game.flight.pos]);
  const painted = map.canvas.calls.filter(call => call[0] === 'fillText').map(call => call[1]);
  assert.ok(!painted.some(label => /取件点|收件点/.test(label)));
  assert.ok(painted.includes(town.name));
  assert.equal(map.rows.length, 2);
});

test('overview avoids platform label clutter while town labels and closer platform labels remain', t => {
  const { map, town, landing, atlas } = setup(t);
  atlas.clearTracking(); map.open();
  const painted = () => map.canvas.calls.filter(call => call[0] === 'fillText').map(call => call[1]);
  assert.ok(painted().includes(town.name));
  assert.ok(!painted().includes(landing.name));
  map.canvas.calls.length = 0;
  map.setView({ ...landing.pos, span: WORLD / 6 });
  assert.ok(painted().includes(landing.name));
});

test('hover displays only known symbols and names, with native button focus semantics', t => {
  const { map, town, secret } = setup(t); map.open();
  const p = mapPoint(town.pos, map.view, w, h);
  pointer(map, 'pointermove', p.x, p.y);
  assert.equal(map.dialog.querySelector('.wm-hover').textContent, `○ ${town.name}`);
  assert.equal(map.dialog.querySelector('.wm-hover').hidden, false);
  assert.ok(map.canvas.classes.has('has-hit'));
  const hidden = mapPoint(secret.pos, map.view, w, h);
  pointer(map, 'pointermove', hidden.x, hidden.y);
  assert.equal(map.dialog.querySelector('.wm-hover').hidden, true);
  assert.equal(map.dialog.querySelector('.wm-hover').textContent, '');
  const row = map.rows.find(row => row.dataset.id === town.id); row.focus();
  map.dialog.fire('click', { target: row });
  assert.equal(map.rows.find(item => item.dataset.id === town.id), row); // Selection does not replace focused DOM.
  assert.ok(row.focused); assert.equal(row.getAttribute('aria-pressed'), 'true');
  map.canvas.fire('pointerleave', {}); assert.equal(map.dialog.querySelector('.wm-hover').hidden, true);
});

test('fog masks unknown grid runs, stays faintly topographic and never writes exploration', t => {
  const { map, atlas } = setup(t); map.open();
  const overlays = () => map.canvas.calls.filter(call => call[0] === 'drawImage' && call[1] === map.fogThumb);
  assert.equal(overlays().length, atlas.gridSize);
  const pixels = map.fogThumb.calls.find(call => call[0] === 'putImageData')[1].data;
  assert.equal(pixels[3], 255);
  assert.ok(pixels[0] > 0); assert.ok(pixels[0] < 80);
  assert.notDeepEqual([...pixels.slice(0, 4)], [...pixels.slice(-4)]);
  map.canvas.calls.length = 0; atlas.cells[48 * atlas.gridSize + 48] = 1; map.render();
  assert.equal(overlays().length, atlas.gridSize + 1); // One known cell splits an unknown row.
  assert.equal(atlas.cells.reduce((a, b) => a + b, 0), 1);
  assert.equal(atlas.discovered.size, 0);
  atlas.cells.fill(1); map.canvas.calls.length = 0; map.render(); assert.equal(overlays().length, 0);
});

test('river ribbon uses actual metadata coordinates and halfwidth, without road generation', t => {
  const { map, game } = setup(t); map.open(); map.canvas.calls.length = 0;
  map.drawRiver(p => ({ x: p.x, y: p.z }), 1);
  const moves = map.canvas.calls.filter(call => call[0] === 'moveTo');
  const lines = map.canvas.calls.filter(call => call[0] === 'lineTo');
  assert.equal(moves.length, game.terrain.meta.river.length - 1);
  const [x, z, halfwidth] = game.terrain.meta.river[0];
  near(Math.hypot(moves[0][1] - x, moves[0][2] - z), halfwidth);
  const [nextX, nextZ, nextWidth] = game.terrain.meta.river[1];
  near(Math.hypot(lines[0][1] - nextX, lines[0][2] - nextZ), nextWidth);
  game.terrain.meta.river = []; map.canvas.calls.length = 0; map.drawRiver(p => p, 1);
  assert.equal(map.canvas.calls.length, 0);
});

test('roads use loaded town polylines in world XZ, never a straight invented connection', t => {
  const { map, game } = setup(t); map.open(); map.canvas.calls.length = 0;
  game.town = { roads: [{ width: 8, pts: [[10, 20], [30, 60], [80, 60]] }] };
  map.drawRoads(p => ({ x: p.x * 2, y: p.z * 2 }), 2);
  assert.deepEqual(map.canvas.calls.filter(call => call[0] === 'moveTo'), [['moveTo', 20, 40]]);
  assert.deepEqual(map.canvas.calls.filter(call => call[0] === 'lineTo'), [['lineTo', 60, 120], ['lineTo', 160, 120]]);
  assert.equal(map.ctx.lineWidth, 16);
  game.town.roads = []; map.canvas.calls.length = 0; map.drawRoads(p => p, 1);
  assert.equal(map.canvas.calls.filter(call => call[0] === 'stroke').length, 0);
});

test('explicit pin mode creates a named terrain/sea-level pin, safely renames, tracks and deletes it', t => {
  const { map, atlas, game } = setup(t); map.open();
  const p = mapPoint({ x: -300, z: -200 }, map.view, w, h);
  tap(map, p); assert.equal(atlas.pins.length, 0); assert.equal(map.draft, null);
  click(map, 'add-pin'); assert.equal(map.addingPin, true); tap(map, p);
  assert.equal(atlas.pins.length, 0); assert.equal(map.draft.name, '标记 1');
  const input = map.dialog.querySelector('#wm-pin-name');
  assert.equal(input.value, '标记 1'); assert.ok(input.focused && input.selectedText);
  submitPin(map); const pin = atlas.pins[0];
  near(pin.pos.x, -300); near(pin.pos.z, -200); assert.equal(pin.pos.y, 0);
  assert.equal(map.selected(), pin); assert.equal(map.addingPin, false);
  assert.match(map.dialog.querySelector('.wm-detail-warning').textContent, /不是停靠平台/);
  input.value = '<img src=x onerror=alert(1)>'; submitPin(map);
  assert.equal(pin.name, '<img src=x onerror=alert(1)>');
  assert.equal(map.dialog.querySelector('.wm-detail-name').textContent, pin.name);
  const row = map.rows.find(row => row.dataset.id === pin.id);
  assert.equal(row.nodes[1].textContent, pin.name); assert.equal(row.nodes[1].innerHTML, undefined);
  input.value = ' '; submitPin(map); assert.equal(pin.name, '<img src=x onerror=alert(1)>');
  assert.match(map.dialog.querySelector('.wm-pin-status').textContent, /请输入/);
  click(map, 'track'); assert.deepEqual(atlas.tracking, { kind: 'pin', id: pin.id });
  assert.equal(map.target(), pin);
  assert.match(map.dialog.querySelector('.wm-position').textContent, /高差 -31\.00/);
  click(map, 'delete-pin'); assert.equal(atlas.pins.length, 0); assert.equal(atlas.tracking, null);
  assert.equal(map.selection, null); assert.ok(map.dialog.querySelector('[data-action="add-pin"]').focused);
  game.terrain.meta.sea = 4;
  click(map, 'add-pin'); tap(map, mapPoint({ x: 1000, z: 300 }, map.view, w, h)); submitPin(map);
  near(atlas.pins[0].pos.y, 60); // Ground above sea, not player altitude.
});

test('drag threshold, pointer cancellations, lost capture, blur and visibility never create a pin', t => {
  const { map, atlas } = setup(t); map.open(); map.setView({ x: 0, z: 0, span: 1000 });
  click(map, 'add-pin');
  pointer(map, 'pointerdown', 400, 300); pointer(map, 'pointermove', 450, 330); pointer(map, 'pointermove', 400, 300); pointer(map, 'pointerup', 400, 300);
  assert.equal(map.draft, null); assert.equal(atlas.pins.length, 0);
  for (const cancel of ['pointercancel', 'lostpointercapture', 'blur', 'visibilitychange']) {
    if (!map.addingPin) click(map, 'add-pin');
    pointer(map, 'pointerdown', 400, 300);
    if (cancel === 'blur') window.fire('blur', {});
    else if (cancel === 'visibilitychange') { document.hidden = true; document.fire(cancel, {}); document.hidden = false; }
    else pointer(map, cancel, 400, 300);
    pointer(map, 'pointerup', 400, 300);
    assert.equal(map.drag, null); assert.equal(map.canvas.pointer, undefined);
    assert.equal(map.draft, null); assert.equal(atlas.pins.length, 0);
  }
  click(map, 'add-pin'); pointer(map, 'pointerdown', 400, 300); pointer(map, 'pointermove', 403, 301); pointer(map, 'pointerup', 403, 301);
  assert.ok(map.draft); // Small pointer jitter is still a deliberate click.
  click(map, 'cancel-pin'); assert.equal(map.draft, null); assert.equal(atlas.pins.length, 0);
});

test('pin limits, outside-world clicks and view edge controls are explicit disabled states', t => {
  const { map, atlas } = setup(t); map.open();
  click(map, 'add-pin'); tap(map, { x: 0, y: 0 });
  assert.equal(map.draft, null); assert.match(map.dialog.querySelector('.wm-pin-status').textContent, /边界内/);
  click(map, 'add-pin');
  for (let i = 0; i < 12; i++) assert.ok(atlas.addPin({ x: i * 10, y: 20, z: 0 }, `标记 ${i}`));
  map.render(); assert.equal(map.dialog.querySelector('[data-action="add-pin"]').disabled, true);
  assert.match(map.dialog.querySelector('.wm-pin-status').textContent, /12 \/ 12.*上限/);
  click(map, 'add-pin'); assert.equal(map.addingPin, false);
  map.select('pin', atlas.pins[0].id); click(map, 'delete-pin');
  assert.equal(map.dialog.querySelector('[data-action="add-pin"]').disabled, false);
  map.setView({ x: 0, z: 0, span: WORLD / 24 }); assert.equal(map.dialog.querySelector('[data-action="in"]').disabled, true);
  click(map, 'all'); assert.equal(map.dialog.querySelector('[data-action="out"]').disabled, true);
  click(map, 'add-pin'); tap(map, { x: w / 2, y: h / 2 });
  atlas.addPin({ x: 0, y: 20, z: 0 }, '外部标记'); map.render();
  assert.equal(map.dialog.querySelector('[data-action="save-pin"]').disabled, true);
  submitPin(map); assert.equal(atlas.pins.length, 12); assert.match(map.dialog.querySelector('.wm-pin-status').textContent, /最多保存 12/);
});

test('chart theme persists in AtlasState without resampling actual terrain', t => {
  const { map, atlas, game, samples } = setup(t); map.open();
  const before = samples(), dark = map.thumb.calls.find(call => call[0] === 'putImageData')[1].data[0];
  click(map, 'theme'); assert.equal(atlas.theme, 'light'); assert.equal(map.dialog.dataset.theme, 'light');
  assert.equal(map.dialog.querySelector('[data-action="theme"]').getAttribute('aria-pressed'), 'true');
  const light = map.thumb.calls.find(call => call[0] === 'putImageData')[1].data[0];
  assert.notEqual(light, dark); assert.equal(samples(), before);
  assert.equal(new AtlasState(atlas.store, game.terrain, atlas.landmarks).theme, 'light');
  click(map, 'theme'); assert.equal(atlas.theme, 'dark'); assert.equal(samples(), before);
});

function animationClock() {
  let id = 0;
  const callbacks = new Map();
  window.requestAnimationFrame = fn => { callbacks.set(++id, fn); return id; };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  return { callbacks, step(time) { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(fn => fn(time)); } };
}

test('zoom animation is short, cancellable, anchored and stops scheduling when idle or closed', t => {
  const { map } = setup(t); const clock = animationClock(); map.open();
  assert.equal(clock.callbacks.size, 0); map.setView({ x: 0, z: 0, span: 2000 });
  const p = { x: 350, z: -150 }, screen = mapPoint(p, map.view, w, h);
  map.zoom(0.5, screen.x, screen.y); assert.equal(clock.callbacks.size, 1); assert.equal(map.view.span, 2000);
  clock.step(0); clock.step(75);
  assert.ok(map.view.span > 1000 && map.view.span < 2000);
  near(mapPoint(p, map.view, w, h).x, screen.x); near(mapPoint(p, map.view, w, h).y, screen.y);
  clock.step(150); near(map.view.span, 1000); assert.equal(clock.callbacks.size, 0);
  map.zoom(0.75, w / 2, h / 2); const stale = [...clock.callbacks.values()][0];
  map.zoom(0.75, w / 2, h / 2); assert.equal(clock.callbacks.size, 1);
  clock.step(200); clock.step(350); near(map.view.span, 562.5); assert.equal(clock.callbacks.size, 0);
  stale(1000); near(map.view.span, 562.5); assert.equal(clock.callbacks.size, 0);
  map.zoom(2, w / 2, h / 2); window.fire('blur', {}); assert.equal(clock.callbacks.size, 0);
  map.zoom(2, w / 2, h / 2); pointer(map, 'pointerdown', 400, 300); assert.equal(clock.callbacks.size, 0);
  pointer(map, 'pointercancel', 400, 300);
  map.zoom(2, w / 2, h / 2); map.close(); assert.equal(clock.callbacks.size, 0);
  map.zoom(2, w / 2, h / 2); assert.equal(clock.callbacks.size, 0);
});

test('reduced motion skips zoom animation even when RAF exists', t => {
  const { map } = setup(t); const clock = animationClock();
  window.matchMedia = query => ({ matches: query === '(prefers-reduced-motion: reduce)' });
  map.open(); click(map, 'in');
  near(map.view.span, WORLD * 1.08 * 0.75); assert.equal(clock.callbacks.size, 0);
});

test('pin naming can type M without closing; Escape retains real GameModal pause/input release', t => {
  const { map, game } = setup(t); window.handlers.clear();
  game.input = { enabled: true, clear() {}, canvas: new Element('canvas') };
  map.dialog.showModal = () => { map.dialog.open = true; };
  map.dialog.close = () => { map.dialog.open = false; };
  map.modal = new GameModal(game, map.dialog, { closeKey: 'KeyM' });
  map.open(); const input = map.dialog.querySelector('#wm-pin-name');
  map.dialog.fire('focusin', { target: input });
  const typing = keyEvent(); window.fire('keydown', typing);
  assert.ok(typing.stopped && !typing.prevented && map.isOpen && game.paused);
  const escape = keyEvent({ code: 'Escape' }); window.fire('keydown', escape);
  assert.ok(escape.prevented && !map.isOpen && !game.paused && game.input.enabled);
  map.open(); map.dialog.fire('focusout', { target: input });
  const close = keyEvent(); window.fire('keydown', close); assert.ok(close.prevented && !map.isOpen);
});
