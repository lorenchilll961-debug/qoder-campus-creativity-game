const GRID_SIZE = 96;
const PIN_LIMIT = 12;
const KINDS = ['town', 'landing', 'place', 'pin'];
const point = (p) => p && ['x', 'y', 'z'].every((key) => Number.isFinite(p[key]));
const nameOf = (name) => typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) : '';
const reward = (landmark) => landmark.kind === 'town' ? 10 : landmark.kind === 'place' ? 5 : 0;

export function worldLandmarks(game) {
  return [
    ...(game.palace ? [game.palace.landmark] : []),
    ...(game.dragon ? [game.dragon.landmark] : []),
    ...(game.terrain.meta.towns || []).map((town) => ({
      id: `town:${town.id}`, name: town.name, kind: 'town', hidden: false,
      description: '已标注聚落 · 飞近发现可获得 10 枚风铃币',
      pos: { x: town.x, y: game.terrain.heightAt(town.x, town.z), z: town.z },
      radius: Math.min(town.r, 250),
    })),
    ...game.gameplay.open.map((pad) => ({
      id: `pad:${pad.id}`, name: pad.name, kind: 'landing', hidden: false,
      description: `${pad.town} · ${pad.spot || '停靠平台'} · 请按真实平台高度降落`,
      pos: pad.pos, radius: 60, pad,
    })),
    ...(game.places?.list || []).map((place) => ({
      id: `place:${place.id}`, name: place.def.name, kind: 'place', hidden: true,
      description: place.def.hint || '海岛秘境', pos: place.pos,
      radius: Math.max(80, place.radius),
    })),
  ];
}

export class AtlasState {
  constructor(store, terrain, landmarks) {
    this.store = store;
    this.world = terrain.meta.world;
    this.gridSize = GRID_SIZE;
    this.landmarks = landmarks;
    this.cells = new Uint8Array(GRID_SIZE * GRID_SIZE);
    this.discovered = new Set();
    this.pins = [];
    this.filters = Object.fromEntries(KINDS.map((kind) => [kind, true]));
    this.theme = 'dark';
    this.tracking = { kind: 'quest' };
    this.nextPin = 1;
    this._elapsed = 0;
    this._sample = 0.25;
    this._dirty = false;
    const saved = store.get('atlas.v1', null);
    if (saved?.version !== 1 || saved.world !== this.world || saved.gridSize !== GRID_SIZE) return;
    if (Array.isArray(saved.cells)) for (const cell of saved.cells) {
      if (Number.isInteger(cell) && cell >= 0 && cell < this.cells.length) this.cells[cell] = 1;
    }
    if (Array.isArray(saved.discovered)) for (const id of saved.discovered) {
      if (landmarks.some((landmark) => landmark.id === id)) this.discovered.add(id);
    }
    if (Array.isArray(saved.pins)) for (const pin of saved.pins.slice(0, PIN_LIMIT)) {
      if (!pin || !/^pin-[1-9]\d{0,8}$/.test(pin.id) || this.pins.some((p) => p.id === pin.id) ||
          !this.contains(pin.pos) || !nameOf(pin.name)) continue;
      this.pins.push(this._pin(pin.id, pin.pos, nameOf(pin.name)));
      this.nextPin = Math.max(this.nextPin, Number(pin.id.slice(4)) + 1);
    }
    if (Number.isSafeInteger(saved.nextPin) && saved.nextPin >= this.nextPin && saved.nextPin <= 1e9) this.nextPin = saved.nextPin;
    for (const kind of KINDS) if (typeof saved.filters?.[kind] === 'boolean') this.filters[kind] = saved.filters[kind];
    if (saved.theme === 'light') this.theme = 'light';
    if (saved.tracking === null) this.tracking = null;
    else if (this._canTrack(saved.tracking?.kind, saved.tracking?.id)) this.tracking = { ...saved.tracking };
  }

  get percent() { return this.cells.reduce((sum, cell) => sum + cell, 0) / this.cells.length * 100; }
  get coins() { return this.landmarks.reduce((sum, landmark) => sum + (this.discovered.has(landmark.id) ? reward(landmark) : 0), 0); }

  contains(pos) {
    return point(pos) && Math.abs(pos.x) <= this.world / 2 && Math.abs(pos.z) <= this.world / 2;
  }

  isKnown(landmark) { return !landmark.hidden || this.discovered.has(landmark.id); }

  update(dt, pos) {
    this._elapsed += dt;
    this._sample += dt;
    const found = [];
    if (this._sample >= 0.25 && this.contains(pos)) {
      this._sample = 0;
      const cellSize = this.world / GRID_SIZE, radius = 190;
      const cx = (pos.x + this.world / 2) / cellSize, cz = (pos.z + this.world / 2) / cellSize;
      const r = radius / cellSize;
      for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(GRID_SIZE - 1, Math.floor(cz + r)); z++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(GRID_SIZE - 1, Math.floor(cx + r)); x++) {
          if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > r) continue;
          const i = z * GRID_SIZE + x;
          if (!this.cells[i]) { this.cells[i] = 1; this._dirty = true; }
        }
      }
      for (const landmark of this.landmarks) {
        if (this.discovered.has(landmark.id) || Math.abs(pos.y - landmark.pos.y) > 300 ||
            Math.hypot(pos.x - landmark.pos.x, pos.z - landmark.pos.z) > landmark.radius) continue;
        this.discovered.add(landmark.id);
        this._dirty = true;
        if (reward(landmark)) found.push(landmark);
      }
    }
    if (found.length || this._elapsed >= 5) this.save();
    return found;
  }

  _pin(id, pos, name) {
    return { id, name, kind: 'pin', description: '自定义航点 · 仅提供方向，不保证此处可降落', pos: { x: pos.x, y: pos.y, z: pos.z } };
  }

  addPin(pos, name = '我的图钉') {
    name = nameOf(name);
    if (!this.contains(pos) || !name || this.pins.length >= PIN_LIMIT || this.nextPin >= 1e9) return null;
    const pin = this._pin(`pin-${this.nextPin++}`, pos, name);
    this.pins.push(pin);
    this._dirty = true;
    this.save();
    return pin;
  }

  renamePin(id, name) {
    const pin = this.pins.find((item) => item.id === id);
    name = nameOf(name);
    if (!pin || !name || pin.name === name) return false;
    pin.name = name;
    this._dirty = true;
    this.save();
    return true;
  }

  removePin(id) {
    const index = this.pins.findIndex((pin) => pin.id === id);
    if (index < 0) return false;
    this.pins.splice(index, 1);
    if (this.tracking?.kind === 'pin' && this.tracking.id === id) this.tracking = null;
    this._dirty = true;
    this.save();
    return true;
  }

  _canTrack(kind, id) {
    if (kind === 'quest') return true;
    if (kind === 'pin') return this.pins.some((pin) => pin.id === id);
    return kind === 'landmark' && this.landmarks.some((landmark) => landmark.id === id && this.isKnown(landmark));
  }

  track(kind, id) {
    if (!this._canTrack(kind, id)) return false;
    this.tracking = kind === 'quest' ? { kind } : { kind, id };
    this._dirty = true;
    this.save();
    return true;
  }

  clearTracking() {
    this.tracking = null;
    this._dirty = true;
    this.save();
  }

  resolve(questTarget) {
    const tracking = this.tracking;
    if (tracking?.kind === 'quest') return questTarget;
    if (tracking?.kind === 'pin') return this.pins.find((pin) => pin.id === tracking.id) || null;
    if (tracking?.kind === 'landmark') {
      const landmark = this.landmarks.find((item) => item.id === tracking.id && this.isKnown(item));
      return landmark?.pad || landmark || null;
    }
    return null;
  }

  setFilter(kind, enabled) {
    if (!KINDS.includes(kind) || typeof enabled !== 'boolean' || this.filters[kind] === enabled) return false;
    this.filters[kind] = enabled;
    this._dirty = true;
    this.save();
    return true;
  }

  setTheme(theme) {
    if (!['dark', 'light'].includes(theme) || this.theme === theme) return false;
    this.theme = theme;
    this._dirty = true;
    this.save();
    return true;
  }

  save() {
    this._elapsed = 0;
    if (!this._dirty) return;
    const cells = [];
    this.cells.forEach((value, index) => { if (value) cells.push(index); });
    this.store.set('atlas.v1', {
      version: 1, world: this.world, gridSize: GRID_SIZE, cells,
      discovered: [...this.discovered], pins: this.pins, nextPin: this.nextPin,
      filters: this.filters, theme: this.theme, tracking: this.tracking,
    });
    this._dirty = false;
  }
}
