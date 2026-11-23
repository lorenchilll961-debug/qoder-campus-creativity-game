import { SOLAR_TERMS } from '../seasons/cycle.js';
import { GameModal } from './dialogue.js';

export const SOLAR_CARDS = Object.freeze(SOLAR_TERMS.map((term, index) => Object.freeze({
  id: term.id,
  name: term.name,
  season: term.season,
  date: term.date,
  description: term.description,
  phenology: term.phenology,
  marker: term.marker,
  image: `./assets/solar-cards/${String(index + 1).padStart(2, '0')}.png`,
})));

const CARD_KEY = 'solar-cards.v1';
const SEASON_NAMES = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const byId = new Map(SOLAR_CARDS.map((card) => [card.id, card]));

const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export class SolarCards {
  constructor(store) {
    this.store = store;
    const saved = store.get(CARD_KEY, {});
    this.draws = safeCount(saved?.draws);
    this.owned = Object.create(null);
    if (saved?.owned && typeof saved.owned === 'object') {
      for (const card of SOLAR_CARDS) {
        const count = safeCount(saved.owned[card.id]);
        if (count) this.owned[card.id] = count;
      }
    }
  }

  get collected() { return Object.keys(this.owned).length; }
  get total() { return SOLAR_CARDS.length; }
  count(id) { return safeCount(this.owned[id]); }

  addDraws(count) {
    const amount = safeCount(count);
    if (!amount) return this.draws;
    this.draws += amount;
    this._save();
    return this.draws;
  }

  draw(random = Math.random) {
    if (!this.draws) return null;
    this.draws -= 1;
    const pool = SOLAR_CARDS.slice();
    const cards = [];
    while (cards.length < 3) {
      const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
      cards.push(pool.splice(index, 1)[0]);
    }
    const selected = Math.min(cards.length - 1, Math.floor(random() * cards.length));
    const reward = cards[selected];
    this.owned[reward.id] = this.count(reward.id) + 1;
    this._save();
    return { cards, selected, reward, duplicate: this.count(reward.id) > 1 };
  }

  _save() {
    this.store.set(CARD_KEY, { version: 1, draws: this.draws, owned: { ...this.owned } });
  }
}

const cardMarkup = (card, className = '') => `<article class="solar-card ${className}" data-card-id="${card?.id || ''}">
  <div class="solar-card-inner">
    <div class="solar-card-face solar-card-back" aria-hidden="true"><span>花信风</span><b>✦</b><small>二十四节气</small></div>
    <div class="solar-card-face solar-card-front" style="--solar-card-image: url('${card?.image || ''}')"><img class="solar-card-art" src="${card?.image || ''}" alt="${card?.name || ''}节气卡牌插画"><span class="solar-card-season">${SEASON_NAMES[card?.season] || ''} · ${card?.date || ''}</span><strong>${card?.name || ''}</strong><em>${card?.marker || ''}</em><small>${card?.description || ''}</small></div>
  </div>
</article>`;

export class SolarCardBook {
  constructor(game, store) {
    this.game = game;
    this.cards = new SolarCards(store);
    this.drawDialog = this._dialog('solar-draw-dialog', '节气抽卡');
    this.bookDialog = this._dialog('solar-book-dialog', '节气卡册');
    this._bindButtons();
    this.refresh();
  }

  addDraws(count) {
    const total = this.cards.addDraws(count);
    this.refresh();
    return total;
  }

  openDraw() {
    if (this.drawModal.isOpen) return true;
    if (!this.cards.draws) return false;
    this._renderDrawStart();
    return this.drawModal.show();
  }

  openBook() {
    this._renderBook();
    return this.bookModal.show();
  }

  refresh() {
    const drawButton = document.getElementById('openSolarDraw');
    const bookButton = document.getElementById('openSolarBook');
    const drawCount = document.getElementById('solarDrawCount');
    const bookCount = document.getElementById('solarBookCount');
    if (drawButton) drawButton.disabled = !this.cards.draws;
    if (drawCount) drawCount.textContent = this.cards.draws;
    if (bookCount) bookCount.textContent = `${this.cards.collected} / ${this.cards.total}`;
    if (drawButton) drawButton.setAttribute('aria-label', `抽取节气卡牌${this.cards.draws ? `，剩余 ${this.cards.draws} 次` : '，暂无机会'}`);
  }

  _dialog(className, title) {
    const element = document.createElement('dialog');
    element.className = className;
    element.setAttribute('aria-label', title);
    document.body.append(element);
    const modal = new GameModal(this.game, element, { closeKey: 'KeyB' });
    if (className === 'solar-draw-dialog') this.drawModal = modal;
    else this.bookModal = modal;
    return element;
  }

  _bindButtons() {
    document.getElementById('openSolarDraw')?.addEventListener('click', () => this.openDraw());
    document.getElementById('openSolarBook')?.addEventListener('click', () => this.openBook());
  }

  _renderDrawStart() {
    this.drawDialog.innerHTML = `<header class="solar-dialog-header"><div><p class="solar-eyebrow">云雀港 · 节气签</p><h2>抽取三张节气牌</h2></div><button type="button" data-action="close" aria-label="关闭抽卡">×</button></header>
      <p class="solar-draw-copy">牌面尚未揭开。三张牌中会有一张成为你的节气收藏。</p><div class="solar-draw-stage">${[1, 2, 3].map(() => '<div class="solar-card solar-card-placeholder"><div class="solar-card-inner"><div class="solar-card-face solar-card-back" aria-hidden="true"><span>花信风</span><b>✦</b><small>二十四节气</small></div></div></div>').join('')}</div>
      <div class="solar-dialog-actions"><button type="button" data-action="reveal">翻开三张牌</button><button type="button" data-action="close">暂时收起</button></div>`;
    this.drawDialog.querySelectorAll('[data-action="close"]').forEach((button) => button.addEventListener('click', () => this.drawModal.close()));
    this.drawDialog.querySelector('[data-action="reveal"]').addEventListener('click', () => this._reveal());
  }

  _reveal() {
    const result = this.cards.draw();
    if (!result) return;
    const stage = this.drawDialog.querySelector('.solar-draw-stage');
    stage.innerHTML = result.cards.map((card) => cardMarkup(card)).join('');
    stage.classList.add('is-revealed');
    stage.children[result.selected].classList.add('is-selected');
    this.drawDialog.querySelector('.solar-draw-copy').textContent = `获得 ${result.reward.name} · ${result.duplicate ? '重复收藏 +1' : '新卡收入卡册'}`;
    const actions = this.drawDialog.querySelector('.solar-dialog-actions');
    actions.innerHTML = '<button type="button" data-action="close">收入卡册</button>';
    actions.querySelector('button').addEventListener('click', () => this.drawModal.close());
    this.refresh();
  }

  _renderBook() {
    const entries = SOLAR_CARDS.map((card) => {
      const count = this.cards.count(card.id);
      return count ? `<article class="solar-book-entry is-owned"><img class="solar-book-art" loading="lazy" src="${card.image}" alt="${card.name}节气卡牌插画"><div class="solar-book-symbol">✦</div><strong>${card.name}</strong><small>${SEASON_NAMES[card.season]} · ${count > 1 ? `重复 ${count - 1}` : '已收藏'}</small><p>${card.description}</p></article>` : `<article class="solar-book-entry"><div class="solar-book-symbol">?</div><strong>未解锁</strong><small>${SEASON_NAMES[card.season]}</small><p>完成配送后抽取节气牌。</p></article>`;
    }).join('');
    this.bookDialog.innerHTML = `<header class="solar-dialog-header"><div><p class="solar-eyebrow">花信风 · 收藏</p><h2>二十四节气卡册</h2></div><button type="button" data-action="close" aria-label="关闭卡册">×</button></header><p class="solar-book-progress">已收藏 ${this.cards.collected} / ${this.cards.total} · 待抽 ${this.cards.draws} 次</p><section class="solar-book-grid" aria-label="二十四节气收藏列表">${entries}</section>`;
    this.bookDialog.querySelector('[data-action="close"]').addEventListener('click', () => this.bookModal.close());
  }
}

export function cardById(id) { return byId.get(id) || null; }
