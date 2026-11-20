import { U } from '../core/ctx.js';
import { SeasonCycle, SEASONS } from './cycle.js';

export class Seasons {
  constructor(panel, game) {
    this.cycle = new SeasonCycle();
    this.buttons = [...panel.querySelectorAll('[data-season]')];
    this.description = panel.querySelector('#seasonDescription');
    this.status = panel.querySelector('#seasonStatus');
    this.progress = panel.querySelector('#seasonProgress');
    for (const button of this.buttons) {
      button.addEventListener('click', (event) => {
        if (game.paused) return;
        this.select(button.dataset.season);
        if (event.detail > 0) button.blur();
      });
    }
    // Focused controls must not send Space/Enter to the flight and landing input.
    panel.addEventListener('keydown', (event) => {
      if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
    });
    this.showSelection();
    this.update(0);
  }

  select(id) {
    if (!this.cycle.select(id)) return;
    this.showSelection();
  }

  showSelection() {
    const season = SEASONS.find((item) => item.id === this.cycle.target);
    for (const button of this.buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.season === season.id));
    }
    this.description.textContent = season.description;
    this.status.textContent = this.cycle.progress < 1 ? `正在转入${season.name}季……` : `${season.name}季 · 环境已就绪`;
    this.progress.value = this.cycle.progress;
  }

  update(dt) {
    const wasTransitioning = this.cycle.progress < 1;
    const state = this.cycle.update(dt);
    U.uSeasonGrass.value.fromArray(state.grass);
    U.uSeasonLeaves.value.fromArray(state.leaves);
    U.uSeasonBloom.value = state.bloom;
    U.uSeasonSnow.value = state.snow;
    U.uSeasonPastel.value = state.pastel;
    if (wasTransitioning) {
      this.progress.value = this.cycle.progress;
      if (this.cycle.progress === 1) this.showSelection();
    }
  }
}
