import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { GameModal } from './dialogue.js';
import { Input } from '../player/input.js';

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
const { WorldMap, boundView, panView, zoomView, fitView, mapPoint } = await import(mapURL);
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
  constructor() {
    this.handlers = new Map(); this.children = new Map(); this.dataset = {}; this.classes = new Set();
    this.classList = { add: x => this.classes.add(x), remove: x => this.classes.delete(x) };
    this.context = new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: text => ({ width: text.length * 8 }) },
      { get: (obj, key) => obj[key] ?? (() => {}) });
  }
  setAttribute() {}
  appendChild() {}
  getContext() { return this.context; }
  querySelector(key) { if (!this.children.has(key)) this.children.set(key, new Element()); return this.children.get(key); }
  addEventListener(event, cb, options) { const list = this.handlers.get(event) || []; list.push({ cb, options }); this.handlers.set(event, list); }
  fire(event, e) { for (const { cb } of this.handlers.get(event) || []) { cb(e); if (e.stopped) break; } }
  getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; }
  setPointerCapture(id) { this.pointer = id; }
  hasPointerCapture(id) { return this.pointer === id; }
  releasePointerCapture() { this.pointer = undefined; }
  matches() { return false; }
  closest() { return this; }
}
function setup(t) {
  for (const key of ['document', 'window', 'ResizeObserver']) {
    const value = globalThis[key];
    t.after(() => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  }
  globalThis.document = { createElement: () => new Element(), body: new Element() };
  globalThis.window = new Element(); window.devicePixelRatio = 2;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} };
  let samples = 0, first, last;
  const game = { state: 'play', paused: false, flight: { pos: { x: 0, y: 31, z: 0 }, yaw: 0 },
    terrain: { meta: { world: WORLD, towns: [{ name: '云雀港', x: 400, z: 500, r: 80 }] },
      heightAt: (x, z) => { samples++; first ??= { x, z }; last = { x, z }; return x / 20 + z / 30; } },
    town: { buildings: [{ pos: [100, 30, -80], top: 50 }] } };
  const courier = { target: { name: '测试屋顶', spot: '塔顶平台', pos: { x: 100, y: 81.25, z: -80 } },
    pickup: { pos: { x: -100, y: 5, z: 80 } }, quest: { status: 'active' }, opened: 0, mapOpened() { this.opened++; } };
  courier.destination = courier.target;
  const map = new WorldMap(game, courier);
  return { map, game, courier, samples: () => samples, edges: () => [first, last] };
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
  map.open(); assert.equal(samples(), 256 ** 2);
  assert.deepEqual(edges(), [{ x: -3060, z: -3060 }, { x: 3060, z: 3060 }]);
  map.render(); map.observer.cb(); map.close(); map.observer.cb(); map.render(); map.open();
  assert.equal(samples(), 256 ** 2);
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
