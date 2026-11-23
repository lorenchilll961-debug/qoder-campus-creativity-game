import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveService } from '../core/save.js';
import { SOLAR_CARDS, SolarCards } from './solar-card-book.js';

test('节气卡池包含 24 张不同的现有节气卡', () => {
  assert.equal(SOLAR_CARDS.length, 24);
  assert.equal(new Set(SOLAR_CARDS.map((card) => card.id)).size, 24);
  assert.ok(SOLAR_CARDS.every((card) => card.name && card.description && card.phenology));
  assert.deepEqual(SOLAR_CARDS.map((card) => card.image), Array.from({ length: 24 }, (_, index) => `./assets/solar-cards/${String(index + 1).padStart(2, '0')}.png`));
});

test('配送奖励按单数累计并持久化待抽次数', () => {
  const save = new SaveService(null);
  const cards = new SolarCards(save);
  cards.addDraws(1);
  cards.addDraws(3);
  assert.equal(cards.draws, 4);
  assert.equal(new SolarCards(save).draws, 4);
  assert.equal(cards.addDraws(-1), 4);
  assert.equal(cards.addDraws(0), 4);
});

test('每次抽取使用三张不同牌，只收藏随机命中的一张', () => {
  const save = new SaveService(null);
  const cards = new SolarCards(save);
  cards.addDraws(1);
  const result = cards.draw(() => 0);
  assert.equal(result.cards.length, 3);
  assert.equal(new Set(result.cards.map((card) => card.id)).size, 3);
  assert.equal(result.selected, 0);
  assert.equal(result.reward.id, result.cards[0].id);
  assert.equal(cards.draws, 0);
  assert.equal(cards.collected, 1);
  assert.equal(cards.count(result.reward.id), 1);
  assert.equal(cards.draw(), null);
});

test('收藏、重复次数和抽卡机会刷新后恢复', () => {
  const save = new SaveService(null);
  const cards = new SolarCards(save);
  cards.addDraws(2);
  const first = cards.draw(() => 0);
  cards.addDraws(1);
  const duplicate = cards.draw(() => 0);
  assert.equal(duplicate.reward.id, first.reward.id);
  assert.equal(duplicate.duplicate, true);
  const restored = new SolarCards(save);
  assert.equal(restored.draws, 1);
  assert.equal(restored.collected, 1);
  assert.equal(restored.count(first.reward.id), 2);
});
