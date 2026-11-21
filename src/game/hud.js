// The errand's corner of the HUD: where the parcel is going (top right, in the manner of the seed
// compass), the landing prompt, the card that comes up when a parcel is delivered, and the badge
// for the trick. The elements live in index.html; a missing one is simply skipped.
const $ = (id) => document.getElementById(id);

export const far = (m) => (m < 995 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

export class Hud {
  constructor() {
    this.el = {
      job: $('job'), jobName: $('jobName'), jobSpot: $('jobSpot'), jobDist: $('jobDist'), jobCount: $('jobCount'), jobArrow: $('jobCompass')?.firstElementChild,
      prompt: $('prompt'), card: $('card'), cardKicker: $('cardKicker'), cardName: $('cardName'), cardSub: $('cardSub'),
      trick: $('trick'), keys: $('keys'),
      jobStatus: $('jobStatus'), jobObjective: $('jobObjective'), jobCoins: $('jobCoins'), jobCompass: $('jobCompass'),
      jobHeight: $('jobHeight'), jobTracking: $('jobTracking'),
    };
    this._prompt = null;
    this._cardT = 0;
    this._queue = [];
    this._hints = new Set();
  }

  /** The parcel's destination (null hides the panel). */
  job(name, spot, count) {
    const e = this.el;
    if (!e.job) return;
    e.job.hidden = !name;
    if (!name) return;
    e.jobName.textContent = name;
    if (e.jobSpot) e.jobSpot.textContent = spot ? ` · ${spot}` : '';
    if (e.jobCount) e.jobCount.textContent = count;
    // a little flourish when it changes
    e.job.classList.remove('fresh');
    void e.job.offsetWidth;
    e.job.classList.add('fresh');
  }

  order(status, coins, objective) {
    const e = this.el;
    if (e.jobStatus) e.jobStatus.textContent = { available: '新手委托 · 等待接单', active: '配送中 · 携带新焙春茶', completed: '新手委托 · 已完成' }[status];
    if (e.jobObjective && e.jobObjective.textContent !== objective) e.jobObjective.textContent = objective;
    if (e.jobCoins) e.jobCoins.textContent = coins;
    if (e.jobCompass) e.jobCompass.hidden = status === 'completed';
  }

  navigation(target, flight, kind) {
    const e = this.el;
    if (e.jobCompass) e.jobCompass.hidden = !target;
    if (e.jobTracking) e.jobTracking.textContent = !target ? '未跟踪航点 · M 选择目标' : kind === 'quest' ? '正在跟踪订单' : '正在跟踪地图航点';
    if (e.jobHeight) {
      const delta = target ? target.pos.y - flight.pos.y : 0;
      e.jobHeight.textContent = target ? `高差 ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} m` : '';
    }
    if (!target && e.jobDist) e.jobDist.textContent = '';
  }

  /** Distance and bearing (radians, relative to the way she is heading) to where the parcel is going. */
  jobAt(dist, bearing) {
    const e = this.el;
    if (!e.job || e.job.hidden) return;
    if (e.jobArrow) e.jobArrow.style.transform = `rotate(${(bearing * 180) / Math.PI}deg)`;
    if (e.jobDist) e.jobDist.textContent = far(dist);
  }

  /** The line at the foot of the screen (html; null to clear it). */
  prompt(html) {
    const e = this.el.prompt;
    if (!e || html === this._prompt) return;
    this._prompt = html;
    if (html) { e.innerHTML = html; e.classList.add('show'); } else e.classList.remove('show');
  }

  /** A card in the middle of the sky: small capitals, a name, a line under it. One at a time. */
  card(kicker, name, sub = '', seconds = 4.2) {
    this._queue.push({ kicker, name, sub, seconds });
  }

  /** The trick's badge: '' hidden, 'ready', 'cool' (just used). */
  trick(state) {
    const e = this.el.trick;
    if (!e || e.dataset.state === state) return;
    e.dataset.state = state;
    e.hidden = !state;
    e.classList.toggle('cool', state === 'cool');
  }

  /** Add a line to the title screen's list of keys (once per key). */
  hint(key, html) {
    const e = this.el.keys;
    if (!e || this._hints.has(key)) return;
    this._hints.add(key);
    const d = document.createElement('div');
    d.innerHTML = html;
    e.appendChild(d);
  }

  update(dt) {
    const e = this.el;
    if (!e.card) return;
    if (this._cardT > 0) {
      this._cardT -= dt;
      if (this._cardT <= 0.9) e.card.classList.remove('show');        // (it takes most of a second to fade)
      return;
    }
    const c = this._queue.shift();
    if (!c) return;
    e.cardKicker.textContent = c.kicker;
    e.cardName.textContent = c.name;
    e.cardSub.textContent = c.sub;
    e.card.classList.add('show');
    this._cardT = c.seconds + 0.9;
  }
}
