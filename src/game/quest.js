export const FIRST_ORDER = Object.freeze({
  id: 'harbour-tea',
  title: '第一单 · 把春茶送进风里',
  parcel: '一包新焙春茶',
  pickup: 'larkhaven:m_couriers:7:0',
  destination: 'larkhaven:m_teahouse:48:0',
  sender: '阿岚 · 商店老板',
  recipient: '老林 · 村民',
  reward: 30,
});

export function atCounter(landing, flight, pad) {
  if (!pad || !landing?.landed) return false;
  const feet = landing.walk?.pos || { x: flight.pos.x, y: flight.pos.y - landing.rest, z: flight.pos.z };
  return Math.hypot(feet.x - pad.pos.x, feet.z - pad.pos.z) < 3 && Math.abs(feet.y - pad.pos.y) < 1.2;
}

export class DeliveryQuest {
  constructor(store) {
    this.store = store;
    const saved = store.get('first-delivery.v1', null);
    const valid = saved?.version === 1 && ['available', 'active', 'completed'].includes(saved.status);
    this.status = valid ? saved.status : 'available';
    this.progress = {};
    for (const key of ['intro', 'move', 'map', 'fly', 'walk']) this.progress[key] = valid && saved[key] === true;
  }

  get coins() { return this.status === 'completed' ? FIRST_ORDER.reward : 0; }
  get carrying() { return this.status === 'active'; }

  save() {
    this.store.set('first-delivery.v1', { version: 1, status: this.status, ...this.progress });
  }

  learn(key) {
    if (!Object.hasOwn(this.progress, key) || this.progress[key]) return;
    this.progress[key] = true;
    this.save();
  }

  accept(npcId, inReach) {
    if (this.status !== 'available' || npcId !== FIRST_ORDER.pickup || !inReach) return false;
    this.status = 'active';
    this.progress.fly = false;
    this.save();
    return true;
  }

  deliver(npcId, inReach) {
    if (!this.carrying || !this.progress.fly || npcId !== FIRST_ORDER.destination || !inReach) return false;
    this.status = 'completed';
    this.save();
    return true;
  }
}
