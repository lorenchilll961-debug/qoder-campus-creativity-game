export const TRANSITION_SECONDS = 4;

export const SEASONS = Object.freeze([
  {
    id: 'spring',
    name: '春',
    description: '嫩绿新芽，粉白春花。',
    grass: [1.55, 1.8, 0.82],
    leaves: [1.5, 1.7, 0.78],
    bloom: 1,
    snow: 0,
    pastel: 1,
  },
  {
    id: 'summer',
    name: '夏',
    description: '绿草繁花，夏日保留原景。',
    grass: [1, 1, 1],
    leaves: [1, 1, 1],
    bloom: 1,
    snow: 0,
    pastel: 0,
  },
  {
    id: 'autumn',
    name: '秋',
    description: '草木染橙，花影渐疏。',
    grass: [2.3, 0.82, 0.48],
    leaves: [2.6, 0.72, 0.32],
    bloom: 0.18,
    snow: 0,
    pastel: 0,
  },
  {
    id: 'winter',
    name: '冬',
    description: '草叶冷淡，白雪覆地。',
    grass: [0.82, 0.85, 0.96],
    leaves: [0.82, 0.87, 1.02],
    bloom: 0,
    snow: 0.84,
    pastel: 0,
  },
].map((season) => Object.freeze({
  ...season,
  grass: Object.freeze(season.grass),
  leaves: Object.freeze(season.leaves),
})));

function copyState({ grass, leaves, bloom, snow, pastel }) {
  return { grass: [...grass], leaves: [...leaves], bloom, snow, pastel };
}

function lerp(start, end, amount) {
  return amount === 1 ? end : start + (end - start) * amount;
}

export class SeasonCycle {
  #destination = SEASONS[1];
  #start;
  #elapsed = TRANSITION_SECONDS;

  constructor() {
    this.state = copyState(this.#destination);
    this.#start = copyState(this.state);
  }

  get target() {
    return this.#destination.id;
  }

  get progress() {
    return this.#elapsed / TRANSITION_SECONDS;
  }

  select(id) {
    const destination = SEASONS.find((season) => season.id === id);
    if (!destination || destination === this.#destination) return false;

    this.#start = copyState(this.state);
    this.#destination = destination;
    this.#elapsed = 0;
    return true;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || this.progress === 1) {
      return this.state;
    }

    this.#elapsed = Math.min(TRANSITION_SECONDS, this.#elapsed + dt);
    // Frame deltas can sum to just under the endpoint.
    if (TRANSITION_SECONDS - this.#elapsed < 1e-9) this.#elapsed = TRANSITION_SECONDS;

    const progress = this.progress;
    const amount = progress * progress * (3 - 2 * progress);
    for (const key of ['grass', 'leaves']) {
      for (let channel = 0; channel < 3; channel += 1) {
        this.state[key][channel] = lerp(
          this.#start[key][channel],
          this.#destination[key][channel],
          amount,
        );
      }
    }
    for (const key of ['bloom', 'snow', 'pastel']) {
      this.state[key] = lerp(this.#start[key], this.#destination[key], amount);
    }
    return this.state;
  }
}
