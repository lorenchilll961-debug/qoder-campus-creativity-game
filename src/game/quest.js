export const FIRST_ORDER = Object.freeze({
  id: 'harbour-tea',
  title: '第一单 · 把春茶送进风里',
  parcel: '一包新焙春茶',
  pickup: 'guild',
  destination: 'teahouse',
  sender: '阿岚 · 商店老板',
  recipient: '老林 · 村民',
  reward: 30,
});

export const PARCELS = Object.freeze([
  '一坛桂花米酒', '一篮鲜无花果', '一匣羊毛披肩', '一袋海盐太妃糖',
  '一束信笺与火漆', '一罐蜂巢蜜', '一包晒干的昆布', '一顶待送的斗笠',
]);

export function atCounter(landing, flight, pad) {
  if (!pad || !landing?.landed || landing.walk?.jump?.on) return false;
  const feet = landing.walk?.pos || { x: flight.pos.x, y: flight.pos.y - landing.rest, z: flight.pos.z };
  return Math.hypot(feet.x - pad.pos.x, feet.z - pad.pos.z) < 3 && Math.abs(feet.y - pad.pos.y) < 1.2;
}

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const teaOrder = () => ({ id: FIRST_ORDER.id, from: FIRST_ORDER.pickup, to: FIRST_ORDER.destination,
  parcel: FIRST_ORDER.parcel, reward: FIRST_ORDER.reward });

function validOrder(order) {
  if (!record(order) || !['id', 'from', 'to', 'parcel'].every((key) => text(order[key]))
    || order.from === order.to || !count(order.reward)) return false;
  return order.id !== FIRST_ORDER.id || Object.entries(teaOrder()).every(([key, value]) => order[key] === value);
}

// Decimal strings keep the persisted sequence exact, without limiting the number of offers.
const sequence = (value) => count(value) ? BigInt(value)
  : typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? BigInt(value) : 0n;
const orderSequence = (id) => sequence(/^errand-([1-9]\d*)$/.exec(id)?.[1]);

export class DeliveryQuest {
  #sequence = 0n;
  #settledIds = new Set();

  constructor(store) {
    this.store = store;
    const saved = store.get('delivery.v2', null);
    const valid = record(saved) && saved.version === 2 && Array.isArray(saved.orders);
    this.orders = [];
    this.coins = valid && count(saved.coins) ? saved.coins : 0;
    this.delivered = valid && count(saved.delivered) ? saved.delivered : 0;
    this.firstDone = valid && saved.firstDone === true;
    let progress = valid ? saved : null;
    let migrated = false;
    if (valid) {
      this.#sequence = sequence(saved.sequence);
      this.#settledIds = new Set(Array.isArray(saved.settledIds) ? saved.settledIds.filter(text) : []);
      if (this.#settledIds.has(FIRST_ORDER.id)) this.firstDone = true;
      const seen = new Set(this.#settledIds);
      for (const order of saved.orders) {
        if (!validOrder(order) || seen.has(order.id) || (order.id === FIRST_ORDER.id && this.firstDone)) continue;
        seen.add(order.id);
        const { id, from, to, parcel, reward } = order;
        this.orders.push({ id, from, to, parcel, reward });
      }
      for (const id of seen) this.#reserve(id);
    } else if (saved === null) {
      const old = store.get('first-delivery.v1', null);
      if (record(old) && old.version === 1 && ['available', 'active', 'completed'].includes(old.status)) {
        progress = old;
        migrated = true;
        if (old.status === 'active') this.orders.push(teaOrder());
        if (old.status === 'completed') {
          this.firstDone = true;
          this.coins = FIRST_ORDER.reward;
          this.delivered = 1;
          this.#settledIds.add(FIRST_ORDER.id);
        }
      }
    }
    this.progress = {};
    for (const key of ['intro', 'move', 'map', 'fly', 'walk']) this.progress[key] = progress?.[key] === true;
    if (migrated) this.save();
  }

  #reserve(id) {
    const value = orderSequence(id);
    if (value > this.#sequence) this.#sequence = value;
  }

  get carrying() { return this.orders.length > 0; }

  save() {
    this.store.set('delivery.v2', { version: 2, orders: this.orders, coins: this.coins,
      delivered: this.delivered, firstDone: this.firstDone, sequence: this.#sequence.toString(),
      settledIds: [...this.#settledIds], ...this.progress });
  }

  learn(key) {
    if (!Object.hasOwn(this.progress, key) || this.progress[key]) return;
    this.progress[key] = true;
    this.save();
  }

  /** A fresh errand bound for one of the other stations; drawn from the parcels on the shelf. */
  offer(from, stationIds, rand = Math.random) {
    if (!text(from) || !Array.isArray(stationIds)) return null;
    const others = [...new Set(stationIds.filter((id) => text(id) && id !== from))];
    if (!others.length) return null;
    const draws = [rand(), rand(), rand()];
    if (!draws.every((value) => Number.isFinite(value) && value >= 0 && value < 1)) return null;
    const order = {
      id: `errand-${++this.#sequence}`,
      from, to: others[Math.floor(draws[0] * others.length)],
      parcel: PARCELS[Math.floor(draws[1] * PARCELS.length)],
      reward: 18 + Math.floor(draws[2] * 14),
    };
    this.save();
    return order;
  }

  accept(order) {
    if (!validOrder(order) || (order.id === FIRST_ORDER.id && this.firstDone)
      || this.#settledIds.has(order.id) || this.orders.some((o) => o.id === order.id)) return false;
    const { id, from, to, parcel, reward } = order;
    this.orders.push({ id, from, to, parcel, reward });
    this.#reserve(id);
    this.save();
    return true;
  }

  /** Hand in every errand bound for this station; the tutorial one still waits for a real flight. */
  deliver(stationId, inReach) {
    if (!inReach) return [];
    const ready = this.orders.filter((o) => o.to === stationId && (o.id !== FIRST_ORDER.id || this.progress.fly));
    if (!ready.length) return [];
    const coins = ready.reduce((sum, order) => sum + order.reward, this.coins);
    const delivered = this.delivered + ready.length;
    if (!count(coins) || !count(delivered)) return [];
    const ids = new Set(ready.map((order) => order.id));
    this.orders = this.orders.filter((order) => !ids.has(order.id));
    for (const id of ids) this.#settledIds.add(id);
    this.coins = coins;
    this.delivered = delivered;
    if (ids.has(FIRST_ORDER.id)) this.firstDone = true;
    this.save();
    return ready;
  }
}
