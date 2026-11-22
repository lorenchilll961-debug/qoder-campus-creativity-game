import { twinkle, GOLD, PETAL } from './sparks.js';
import { FIRST_ORDER, DeliveryQuest, atCounter } from './quest.js';
import { Dialogue } from '../ui/dialogue.js';
import { DeliveryNPCs } from './npc.js';

export class Courier {
  constructor(game, store, hud) {
    this.game = game;
    this.hud = hud;
    this.quest = new DeliveryQuest(store);
    this.previousCount = Math.max(0, Number(store.get('deliveries.v1', 0)) || 0);
    this.pads = [];
    this.trackedStationId = null;
    this._acc = 0;
    this._moving = 0;
    this._flightStart = null;
  }

  get count() { return this.previousCount + this.quest.delivered; }
  get coins() { return this.quest.coins + (this.game.atlas?.coins || 0); }
  get stations() { return this.npcs ? this.npcs.stations : []; }
  get statusText() {
    if (this.quest.carrying) return `配送中 · 携带 ${this.quest.orders.length} 单`;
    return this.quest.firstDone ? '自由接单 · 任意站点可接' : '新手委托 · 等待接单';
  }
  get navigationTarget() { return this.game.atlas ? this.game.atlas.resolve(this.target) : this.target; }

  get target() {
    const tracked = this.stationById(this.trackedStationId);
    if (tracked) return tracked;
    if (this.quest.orders.length) {
      const f = this.game.flight;
      let best = null, bd = Infinity;
      for (const order of this.quest.orders) {
        const s = this.stationById(order.to);
        if (!s) continue;
        const d = Math.hypot(s.pos.x - f.pos.x, s.pos.z - f.pos.z);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }
    return this.quest.firstDone ? null : this.stationById(FIRST_ORDER.pickup);
  }

  stationById(id) { return this.stations.find((s) => s.id === id) || null; }

  trackStation(id) {
    if (!this.stationById(id)) return false;
    this.trackedStationId = id;
    return true;
  }

  attachUi() {
    this.dialogue = new Dialogue(this.game);
    this.npcs = new DeliveryNPCs(this.game);
    this.npcs.setPads(this.pads);
    return this.npcs.ready;
  }

  setPads(pads) {
    this.pads = pads;
    this.npcs?.setPads(pads);
    this._show();
  }

  start() {
    if (this.quest.firstDone || this.quest.progress.intro || !this.dialogue || !this.target) return;
    if (this.dialogue.show('欢迎成为云雀港信使',
      '你的第一单，是帮商店老板阿岚，把新焙春茶送给露台茶馆门口的老林。\n\n魔毯会自动前进：A / D 转向，W 俯冲、S 爬升，按住空格减速，Shift 加速。\n按 M 看地图，循金光找到信使公会。靠近回廊后连按两次空格降落，按 E 与阿岚交谈。',
      [{ label: '开始第一单' }])) this.quest.learn('intro');
  }

  mapOpened() { this.quest.learn('map'); }

  near(point) { return this.npcs ? this.npcs.inReach(point) : atCounter(this.game.gameplay.landing, this.game.flight, point); }

  nearby() { return this.npcs ? this.npcs.nearby() : null; }

  interact() {
    const g = this.game, q = this.quest, station = this.nearby();
    if (g.state !== 'play' || g.paused || !station || !this.dialogue) return false;
    this.npcs?.facePlayer(station);
    const actor = this.npcs?.actorFor(station);
    if (actor?.spec.role === 'wizard') return this.dialogue.show(actor.spec.name,
      '风向会随节气转变，顺风起飞更省力。观星者之塔是我散步看云的地方。\n\n阿岚在信使公会的补给商店等人送茶，老林在露台茶馆门前收货。按 M 查看配送目标；落稳后走近居民，按 E 交谈。');
    const due = q.orders.filter((o) => o.to === station.id && (o.id !== FIRST_ORDER.id || q.progress.fly));
    const offer = this.offerFor(station);
    const actions = [], lines = [];
    if (due.length) {
      const coins = due.reduce((sum, o) => sum + o.reward, 0);
      lines.push(`有 ${due.length} 件是送到我这里的：${due.map((o) => o.parcel).join('、')}。`);
      actions.push({ label: due.length > 1 ? `交付 ${due.length} 单 · 领取 ${coins} 枚风铃币` : `交付 · 领取 ${coins} 枚风铃币`, run: () => this.deliver(station) });
    }
    if (offer) {
      const to = this.stationById(offer.to);
      if (offer.id === FIRST_ORDER.id) {
        lines.push(`茶馆的老林在等这包新茶。把它送到露台茶馆门前的老林手里，不要放到别处。\n\n报酬：${offer.reward} 枚风铃币，并补满风势。接单后按 G 坐上魔毯，再用 M 查看目标。`);
      } else {
        lines.push(`正好有一单：${offer.parcel}，要送去${to.name}。报酬：${offer.reward} 枚风铃币。`);
      }
      actions.push({ label: `接下这单 · 送往${to.name}`, run: () => this.accept(offer) });
    }
    if (q.orders.some((o) => o.to === station.id && o.id === FIRST_ORDER.id) && !q.progress.fly) {
      lines.push('春茶首单需要先骑魔毯飞一小段，再回来交付。其他订单可以照常接取和送达。');
    }
    lines.push(`当前携带 ${q.orders.length} 单，可反复交谈继续接单，没有接单数量上限。`);
    actions.push({ label: '稍后再来' });
    return this.dialogue.show(actor?.spec.name || station.name, lines.join('\n\n'), actions);
  }

  /** The errand this station offers right now; the guild's first one is the tea tutorial. */
  offerFor(station) {
    const ids = this.stations.map((s) => s.id);
    if (!station || !ids.includes(station.id) || !ids.some((id) => id !== station.id)) return null;
    if (!this.quest.firstDone && station.id === FIRST_ORDER.pickup && ids.includes(FIRST_ORDER.destination) && !this.quest.orders.some((o) => o.id === FIRST_ORDER.id)) {
      return { id: FIRST_ORDER.id, from: station.id, to: FIRST_ORDER.destination, parcel: FIRST_ORDER.parcel, reward: FIRST_ORDER.reward };
    }
    return this.quest.offer(station.id, ids);
  }

  accept(offer) {
    const from = offer && this.stationById(offer.from), to = offer && this.stationById(offer.to);
    if (this.game.state !== 'play' || this.game.paused || !from || !to || !this.near(from)) return false;
    if (!this.quest.accept(offer)) return false;
    if (this.trackedStationId === from.id) this.trackedStationId = null;
    this._flightStart = null;
    this._show();
    this.hud.card('已接单', offer.parcel, `送往${to.name} · 可同时携带多单 · M 查看目标`, 4);
    return true;
  }

  arrive(pad) {
    const t = this.target;
    if (pad === t?.pad) this.game.toast?.('已抵达，落稳后走近居民，按 E 交谈');
    else this.game.flight.gust = Math.min(1, this.game.flight.gust + 0.35);
    return false;
  }

  deliver(station) {
    if (this.game.state !== 'play' || this.game.paused || !station) return false;
    const settled = this.quest.deliver(station.id, this.near(station));
    if (!settled.length) return false;
    if (this.trackedStationId === station.id) this.trackedStationId = null;
    const g = this.game, pos = station.pos;
    g.flight.gust = 1;
    g.sound?.deliver?.(this.count);
    twinkle(g.fx, pos.x, pos.y + 1.6, pos.z, 46, GOLD, 4.2, 0, 1.2, 0, 1.3);
    twinkle(g.fx, pos.x, pos.y + 1.2, pos.z, 18, PETAL, 3, 0, 0.8, 0, 1.1);
    g.fx.burst(pos.x, pos.y + 1.4, pos.z, 46, 0.86, 0.3 + 0.7 * g.rider.sunVis, 4.5);
    this._show();
    const coins = settled.reduce((sum, o) => sum + o.reward, 0);
    this.hud.card(settled.length > 1 ? `交付 ${settled.length} 单` : '订单完成', `获得 ${coins} 枚风铃币`, '去任意站点再接新单 · 可同时携带多单', 5);
    return true;
  }

  _show() {
    const t = this.navigationTarget;
    const name = t?.name || (this.quest.carrying ? '配送中' : '未跟踪航点');
    const label = `${name}|${t?.spot || ''}|${this.count}`;
    if (this._navLabel !== label) {
      this._navLabel = label;
      this.hud.job(name, t?.spot || '', this.count);
    }
    if (this.game.gameplay) {
      this.hud.order(this.statusText, this.coins, this.objective());
      this.hud.navigation(t, this.game.flight, this.game.atlas?.tracking?.kind || 'quest');
    }
  }

  objective() {
    const q = this.quest, L = this.game.gameplay?.landing;
    if (this.game.atlas && this.game.atlas.tracking?.kind !== 'quest') return '地图航点仅提供方向，不会改变订单。按 M 可返回订单目标或切换地标；自定义图钉不保证可降落。';
    const target = this.target;
    if (target) {
      const due = q.orders.filter((o) => o.to === target.id).length;
      if (this.near(target)) return `已到${target.name}，按 E ${due ? `交付 ${due} 单或继续接单` : '接单'}。`;
      const arrival = target.street ? '到地面标记上方按 G 落地，或步行到居民身边' : '靠近屋顶平台后双击空格降落';
      if (q.carrying || this.trackedStationId) return `携带 ${q.orders.length} 单 · ${arrival}，按 E 交谈。M 可选择其他站点。`;
    }
    if (q.carrying) return '配送点暂不可用，仍可自由飞行与探索。';
    if (q.firstDone) return '空闲 · 去任意站点按 E 接单，可同时携带任意多单。M 查看地图。';
    if (this.near(this.target)) return '按 E 与阿岚交谈，确认接下第一单。';
    if (!q.progress.map) return '新手引导 · 按 M 查看地图，金色标记就是当前目标。';
    if (L.landed) return '落地后 WASD 步行，鼠标环顾；按 G 坐上魔毯，向金色目标飞去。';
    if (L.busy) return '正在安全降落，请稍候。落稳后走近居民，按 E 交谈。';
    if (!q.progress.move) return '飞行练习 · A / D 转向，W 俯冲、S 爬升，按住空格减速。';
    return '飞往信使公会。靠近金光后双击空格降落，再按 E 接单。';
  }

  update(dt, ctl) {
    const g = this.game, f = g.flight, L = g.gameplay.landing;
    this.npcs?.update(dt);
    if (g.state !== 'play') return;
    if (!L.busy && (Math.abs(ctl.turn) > 0.1 || Math.abs(ctl.pitch) > 0.1)) {
      this._moving += dt;
      if (this._moving > 0.5) this.quest.learn('move');
    }
    if (L.walk?.moved) this.quest.learn('walk');
    if (this.quest.carrying && !L.busy) {
      this._flightStart ||= { x: f.pos.x, z: f.pos.z };
      if (Math.hypot(f.pos.x - this._flightStart.x, f.pos.z - this._flightStart.z) > 8) this.quest.learn('fly');
    }
    this._acc += dt;
    if (this._acc < 0.1) return;
    this._acc = 0;
    this._show();
    const t = this.navigationTarget;
    if (t) {
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z;
      this.hud.jobAt(Math.hypot(dx, dz), Math.atan2(dx, -dz) - f.yaw);
    }
  }
}
