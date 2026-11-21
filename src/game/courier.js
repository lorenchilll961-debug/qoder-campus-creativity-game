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
    this.pickup = null;
    this.destination = null;
    this._acc = 0;
    this._moving = 0;
    this._flightStart = null;
  }

  get count() { return this.previousCount + (this.quest.status === 'completed' ? 1 : 0); }
  get target() {
    if (!this.pickup || !this.destination || this.quest.status === 'completed') return null;
    return this.quest.carrying ? this.destination : this.pickup;
  }

  attachUi() {
    this.dialogue = new Dialogue(this.game);
    this.npcs = new DeliveryNPCs(this.game.pipeline.overlay);
    this.npcs.setPads(this.pickup, this.destination);
  }

  setPads(pads) {
    this.pickup = pads.find((p) => p.id === FIRST_ORDER.pickup) || null;
    this.destination = pads.find((p) => p.id === FIRST_ORDER.destination) || null;
    this.npcs?.setPads(this.pickup, this.destination);
    this._show();
  }

  start() {
    if (this.quest.progress.intro || !this.dialogue || !this.target) return;
    if (this.dialogue.show('欢迎成为云雀港信使',
      '你的第一单，是把公会的新焙春茶送到露台茶馆。\n\n扫帚会自动前进：A / D 转向，W 俯冲、S 爬升，按住空格减速，Shift 加速。\n按 M 看地图，循金光找到信使公会。靠近回廊后连按两次空格降落，按 E 与阿岚交谈。',
      [{ label: '开始第一单' }])) this.quest.learn('intro');
  }

  mapOpened() { this.quest.learn('map'); }

  near(pad) { return atCounter(this.game.gameplay.landing, this.game.flight, pad); }

  nearby() {
    return [this.pickup, this.destination].find((pad) => this.near(pad)) || null;
  }

  interact() {
    const g = this.game, q = this.quest, pad = this.nearby();
    if (g.state !== 'play' || g.paused || !pad || !this.dialogue) return false;
    if (pad === this.pickup) {
      if (q.status === 'available') {
        if (!this.destination) return false;
        return this.dialogue.show(FIRST_ORDER.sender,
          `茶馆的林婆婆在等这包新茶。请把它送到露台茶馆的屋顶露台，不是楼下街道。\n\n报酬：${FIRST_ORDER.reward} 枚风铃币，并补满风势。接单后按空格骑上扫帚，再用 M 查看目标。`,
          [{ label: '接下春茶订单', run: () => this.accept(pad) }, { label: '稍后再来' }]);
      }
      return this.dialogue.show(FIRST_ORDER.sender, q.carrying
        ? '包裹已经交给你了。屋顶露台就在港口西侧，金色箭头会为你指路。按空格起飞，先把这一单送好。'
        : '第一单完成得很好！今天的委托已经送完，去岛上自在飞一会儿吧。');
    }
    if (q.status === 'completed') return this.dialogue.show(FIRST_ORDER.recipient, '新茶已经收到了，谢谢你！报酬已经记入风铃币，不会重复结算。');
    if (!q.carrying) return this.dialogue.show(FIRST_ORDER.recipient, '我在等公会的新茶。先去信使公会找阿岚接单，再带着包裹过来吧。');
    if (!q.progress.fly) return this.dialogue.show(FIRST_ORDER.recipient, '这一单也是你的扫帚练习。请先骑上扫帚飞一小段，再回来交货。');
    return this.dialogue.show(FIRST_ORDER.recipient,
      `风里都是新茶的香气！是公会托你送来的吧？\n\n交付：${FIRST_ORDER.parcel}\n报酬：${FIRST_ORDER.reward} 枚风铃币 · 风势补满`,
      [{ label: '交付春茶，领取报酬', run: () => this.deliver(pad) }, { label: '等一等' }]);
  }

  accept(pad) {
    if (!this.quest.accept(pad.id, this.near(pad))) return false;
    this._flightStart = null;
    this._show();
    this.hud.card('已接单', FIRST_ORDER.parcel, '空格起飞 · M 查看茶馆位置 · 降落后按 E 交货', 4);
    return true;
  }

  arrive(pad) {
    if (pad === this.target) this.game.toast?.('已抵达，请等落稳后按 E 交谈');
    else this.game.flight.gust = Math.min(1, this.game.flight.gust + 0.35);
    return false;
  }

  deliver(pad) {
    if (!this.quest.deliver(pad.id, this.near(pad))) return false;
    const g = this.game, pos = pad.pos;
    g.flight.gust = 1;
    g.sound?.deliver?.(this.count);
    twinkle(g.fx, pos.x, pos.y + 1.6, pos.z, 46, GOLD, 4.2, 0, 1.2, 0, 1.3);
    twinkle(g.fx, pos.x, pos.y + 1.2, pos.z, 18, PETAL, 3, 0, 0.8, 0, 1.1);
    g.fx.burst(pos.x, pos.y + 1.4, pos.z, 46, 0.86, 0.3 + 0.7 * g.rider.sunVis, 4.5);
    this._show();
    this.hud.card('第一单完成', `获得 ${FIRST_ORDER.reward} 枚风铃币`, '春茶已送达 · 风势已补满 · 现在可以自由探索海岛', 5);
    return true;
  }

  _show() {
    const t = this.target;
    this.hud.job(t?.name || (this.quest.status === 'completed' ? '春茶已送达' : null), t?.spot || '', this.count);
    this._acc = 1;
  }

  objective() {
    const q = this.quest, L = this.game.gameplay?.landing;
    if (q.status === 'completed') return '第一单完成！空格起飞，继续探索海岛。M 随时查看世界地图。';
    if (!this.target) return '配送点暂不可用，仍可自由飞行与探索。';
    if (this.near(this.target)) return q.carrying ? '已到屋顶露台，按 E 与林婆婆交谈并交付春茶。' : '按 E 与阿岚交谈，确认接下第一单。';
    if (!q.progress.map) return '新手引导 · 按 M 查看地图，金色标记就是当前目标。';
    if (L.landed) return '落地后 WASD 步行，鼠标环顾；按空格骑上扫帚，向金色目标飞去。';
    if (L.busy) return '正在安全降落，请稍候。落稳后按 E 与接待员交谈。';
    if (!q.progress.move) return '飞行练习 · A / D 转向，W 俯冲、S 爬升，按住空格减速。';
    return q.carrying
      ? '飞往露台茶馆。靠近金光后双击空格降落，落稳后 E 交货。'
      : '飞往信使公会。靠近金光后双击空格降落，再按 E 接单。';
  }

  update(dt, ctl) {
    const g = this.game, f = g.flight, L = g.gameplay.landing;
    this.npcs?.update(f.pos);
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
    const t = this.target;
    if (t) {
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z;
      this.hud.jobAt(Math.hypot(dx, dz), Math.atan2(dx, -dz) - f.yaw);
    }
    this.hud.order(this.quest.status, this.quest.coins, this.objective());
  }
}
