// One shared, JSON-only store for runtime systems. No timers or per-frame writes.
const SAVE_KEY = 'petalwake.save.v2';
const LEGACY_KEYS = ['first-delivery.v1', 'kickflip.v1', 'deliveries.v1', 'treasures.v1'];
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const validKey = (key) => typeof key === 'string' && key.length > 0 && !UNSAFE_KEYS.has(key);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Reject lossy JSON values without invoking getters/toJSON or accepting prototype keys.
function copy(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Expected acyclic JSON data');
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (!array && proto !== Object.prototype && proto !== null) throw new TypeError('Expected plain data');
  ancestors.add(value);
  const result = array ? [] : {};
  const keys = array ? Array.from({ length: value.length }, (_, i) => String(i)) : Object.keys(value);
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) continue;
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !Object.hasOwn(property, 'value')) throw new TypeError('Expected data properties');
    Object.defineProperty(result, key, {
      value: copy(property.value, ancestors), enumerable: true, writable: true, configurable: true,
    });
  }
  ancestors.delete(value);
  return result;
}

function equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

function migrate(key, value) {
  if (key === 'first-delivery.v1') {
    if (!record(value) || value.version !== 1 || !['available', 'active', 'completed'].includes(value.status)) return undefined;
    const quest = { version: 1, status: value.status };
    for (const flag of ['intro', 'move', 'map', 'fly', 'walk']) quest[flag] = value[flag] === true;
    // Completion already represents the single reward; never mint coins or add deliveries.
    return quest;
  }
  if (key === 'kickflip.v1') return typeof value === 'boolean' ? value : undefined;
  if (key === 'deliveries.v1') return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (key === 'treasures.v1' && Array.isArray(value)) {
    return [...new Set(value.filter((id) => typeof id === 'string' && id.trim().length > 0))];
  }
  return undefined;
}

// null selects memory-only mode; omitted storage uses localStorage.
export class SaveService {
  #storage;
  #useDefault;
  #loaded = false;
  #data = Object.create(null);
  #savedData = null;
  #dirty = false;
  #status = 'memory';

  constructor(storage = undefined) {
    this.#storage = storage;
    this.#useDefault = storage === undefined;
    if (this.#load() && this.#dirty) this.flush();
  }

  get status() { return this.#status; }

  get(key, fallback) {
    const value = validKey(key) && Object.hasOwn(this.#data, key) ? this.#data[key] : fallback;
    if (value === undefined) return undefined;
    try { return copy(value); } catch { return undefined; }
  }

  set(key, value) {
    if (!validKey(key)) return false;
    let next;
    try { next = copy(value); } catch { return false; }
    // An unchanged value must not hammer disabled storage. Retry explicitly via flush().
    if (Object.hasOwn(this.#data, key) && equal(this.#data[key], next)) return this.#status === 'saved';
    this.#data = Object.assign(Object.create(null), this.#data, { [key]: next });
    this.#dirty = true;
    return this.flush();
  }

  flush() {
    if (this.#status === 'corrupt' || this.#status === 'future') return false;
    // A failed initial read never authorizes overwriting an unseen save. Re-read first.
    if (!this.#loaded && !this.#load()) return false;
    if (!this.#dirty) return this.#status === 'saved';
    if (this.#savedData !== null && equal(this.#data, this.#savedData)) {
      this.#dirty = false;
      this.#status = 'saved';
      return true;
    }
    try {
      const payload = JSON.stringify({ version: 2, data: this.#data });
      this.#storage.setItem(SAVE_KEY, payload);
      this.#savedData = this.#data;
      this.#dirty = false;
      this.#status = 'saved';
      return true;
    } catch {
      // The detached in-memory snapshot remains usable, including all other systems' keys.
      this.#status = 'memory';
      return false;
    }
  }

  #load() {
    let raw;
    try {
      // Access itself can throw SecurityError in private windows or sandboxed embeds.
      if (this.#useDefault) this.#storage = globalThis.localStorage;
      if (!this.#storage) return false;
      raw = this.#storage.getItem(SAVE_KEY);
    } catch { return false; }

    let loaded = Object.create(null);
    if (raw !== null) {
      try {
        const envelope = JSON.parse(raw);
        if (record(envelope) && Number.isInteger(envelope.version) && envelope.version > 2) {
          this.#status = 'future';
          return false;
        }
        if (!record(envelope) || envelope.version !== 2 || !record(envelope.data)) throw new TypeError('Invalid save envelope');
        loaded = copy(envelope.data);
      } catch {
        this.#status = 'corrupt';
        return false;
      }
      this.#savedData = loaded;
    } else {
      // An inaccessible legacy key must not finalize a partial migration.
      try {
        for (const key of LEGACY_KEYS) {
          const legacy = this.#storage.getItem(`petalwake.${key}`);
          if (legacy === null) continue;
          let value;
          try { value = migrate(key, JSON.parse(legacy)); } catch { continue; }
          if (value !== undefined) loaded[key] = value;
        }
      } catch { return false; }
    }
    // If initial access failed, preserve newer session edits over the recovered snapshot.
    this.#data = Object.assign(Object.create(null), loaded, this.#data);
    this.#loaded = true;
    this.#dirty = this.#savedData === null ? Object.keys(this.#data).length > 0 : !equal(this.#data, this.#savedData);
    this.#status = this.#dirty ? 'memory' : 'saved';
    return true;
  }
}
