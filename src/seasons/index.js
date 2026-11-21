import { U } from '../core/ctx.js';
import { SeasonCycle, SEASONS, SOLAR_TERMS } from './cycle.js';

const OVERCAST = [
  ['uSkyZenith', [0.18, 0.22, 0.29]],
  ['uSkyMid', [0.36, 0.42, 0.5]],
  ['uSkyHorizon', [0.6, 0.65, 0.7]],
];

export class Seasons {
  constructor(panel, game) {
    this.cycle = new SeasonCycle();
    this.game = game;
    this.environment = Object.fromEntries(['uSunColor', 'uSkyZenith', 'uSkyMid', 'uSkyHorizon', 'uSunHalo', 'uAmbSky', 'uAmbGround', 'uFog', 'uWind'].map((key) => [key, U[key].value.clone()]));
    this.termDetails = panel.querySelector('#termDetails');
    this.termMarker = panel.querySelector('#termMarker');
    this.termDate = panel.querySelector('#termDate');
    this.termClimate = panel.querySelector('#termClimate');
    this.termPhenology = panel.querySelector('#termPhenology');
    this.termFarming = panel.querySelector('#termFarming');
    this.termWind = panel.querySelector('#termWind');
    this.buttons = [...panel.querySelectorAll('[data-season]')];
    this.modes = [...panel.querySelectorAll('[data-season-mode]')];
    this.seasonOptions = panel.querySelector('.season-options');
    this.termControls = panel.querySelector('#termControls');
    this.termSelect = panel.querySelector('#solarTerm');
    this.termPosition = panel.querySelector('#termPosition');
    this.description = panel.querySelector('#seasonDescription');
    this.status = panel.querySelector('#seasonStatus');
    this.progress = panel.querySelector('#seasonProgress');
    for (const season of SEASONS) {
      const group = document.createElement('optgroup');
      group.label = `${season.name}季`;
      for (const term of SOLAR_TERMS.filter((item) => item.season === season.id)) {
        group.append(new Option(term.name, term.id));
      }
      this.termSelect.append(group);
    }
    for (const button of this.buttons) {
      button.addEventListener('click', (event) => {
        if (game.paused) return;
        this.select(button.dataset.season);
        if (event.detail > 0) button.blur();
      });
    }
    for (const button of this.modes) {
      button.addEventListener('click', (event) => {
        if (game.paused) return;
        const preset = this.cycle.preset;
        if (button.dataset.seasonMode === 'terms' && !preset.season) {
          this.select(SOLAR_TERMS.find((term) => term.season === preset.id).id);
        } else if (button.dataset.seasonMode === 'seasons' && preset.season) {
          this.select(preset.season);
        }
        if (event.detail > 0) button.blur();
      });
    }
    this.termSelect.addEventListener('change', () => {
      if (game.paused) { this.showSelection(); return; }
      this.select(this.termSelect.value);
    });
    for (const [id, direction] of [['previousTerm', -1], ['nextTerm', 1]]) {
      panel.querySelector(`#${id}`).addEventListener('click', (event) => {
        if (game.paused) return;
        if (this.cycle.stepTerm(direction)) this.showSelection();
        if (event.detail > 0) event.currentTarget.blur();
      });
    }
    this.showSelection();
    this.update(0);
  }

  select(id) {
    if (!this.cycle.select(id)) return;
    this.showSelection();
  }

  showSelection() {
    const preset = this.cycle.preset;
    const isTerm = Boolean(preset.season);
    for (const button of this.buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.season === preset.id));
    }
    for (const button of this.modes) {
      button.setAttribute('aria-pressed', String(button.dataset.seasonMode === (isTerm ? 'terms' : 'seasons')));
    }
    this.seasonOptions.hidden = isTerm;
    this.termControls.hidden = !isTerm;
    this.termSelect.value = isTerm ? preset.id : SOLAR_TERMS.find((term) => term.season === preset.id).id;
    this.termPosition.textContent = isTerm ? `${SOLAR_TERMS.indexOf(preset) + 1} / 24` : '';
    const name = isTerm ? preset.name : `${preset.name}季`;
    this.description.textContent = preset.description;
    this.termDetails.hidden = !isTerm;
    this.termMarker.hidden = !isTerm;
    if (isTerm) {
      this.termMarker.textContent = preset.marker;
      this.termDate.textContent = `常见日期 ${preset.date}`;
      this.termClimate.textContent = `示意气温 ${preset.climate.temperature}°C · 白昼 ${preset.climate.daylight} 小时`;
      this.termPhenology.textContent = preset.phenology;
      this.termFarming.textContent = preset.farming;
      this.termWind.textContent = preset.wind;
    }
    this.status.textContent = this.cycle.progress < 1
      ? `正在转入${name}……` : `${name} · 环境已就绪`;
    this.progress.value = this.cycle.progress;
  }

  applyAtmosphere(c) {
    const base = this.environment, strength = c.strength;
    const day = 0.55 + 0.6 * Math.max(0, Math.min(1, (c.daylight - 8.5) / 7));
    const warmth = Math.max(-1, Math.min(1, (c.temperature - 18) / 22));
    const flash = U.uWeather.value.w;
    const mix = (a, b) => a + (b - a) * strength;
    const sun = day * (1 - c.cloud * 0.76);
    U.uSunColor.value.set(
      base.uSunColor.x * mix(1, sun * (1 + warmth * 0.16)) + flash * 0.55,
      base.uSunColor.y * mix(1, sun) + flash * 0.65,
      base.uSunColor.z * mix(1, sun * (1 - warmth * 0.13)) + flash * 0.8,
    );
    for (const [key, overcast] of OVERCAST) {
      const original = base[key], value = U[key].value;
      const illumination = mix(1, 0.62 + day * 0.38);
      value.set(
        original.x + (overcast[0] - original.x) * c.cloud * 0.92,
        original.y + (overcast[1] - original.y) * c.cloud * 0.92,
        original.z + (overcast[2] - original.z) * c.cloud * 0.92,
      ).multiplyScalar(illumination).addScalar(flash * 0.22);
    }
    U.uSunHalo.value.copy(base.uSunHalo).multiplyScalar(mix(1, day * (1 - c.cloud * 0.85)));
    U.uAmbSky.value.copy(base.uAmbSky).multiplyScalar(mix(1, (0.62 + day * 0.32) * (1 - c.cloud * 0.2))).addScalar(flash * 0.18);
    U.uAmbGround.value.copy(base.uAmbGround).multiplyScalar(mix(1, 0.6 + day * 0.35));
    U.uFog.value.copy(base.uFog);
    U.uFog.value.x += c.fog * 0.0018 + c.rain * 0.00024;
    U.uFog.value.y = mix(base.uFog.y, 1 / (420 + c.fog * 250));
  }

  update(dt) {
    const wasTransitioning = this.cycle.progress < 1;
    const state = this.cycle.update(dt);
    U.uSeasonGrass.value.fromArray(state.grass);
    U.uSeasonLeaves.value.fromArray(state.leaves);
    U.uSeasonBloom.value = state.bloom;
    U.uSeasonSnow.value = state.snow;
    U.uSeasonPastel.value = state.pastel;
    U.uSeasonBare.value = state.bare;
    U.uSeasonWither.value = state.wither;
    U.uSeasonSnowfall.value = state.snowfall;
    const c = state.climate;
    U.uClimate.value.set(c.strength, c.temperature, c.daylight, c.heat);
    U.uWeather.value.set(c.rain, c.cloud, c.fog, 0);
    U.uSurfaceWeather.value.set(c.wetness, c.dew, c.frost, c.frozenSoil);
    U.uSeasonIce.value = c.ice;
    U.uSeasonGoldBloom.value = c.goldBloom;
    U.uPhenology.value.set(c.cropGrowth, c.cropRipeness, c.cropHarvest, c.birds);
    const baseWind = this.environment.uWind;
    const wx = baseWind.x * (1 - c.strength) + c.windX;
    const wz = baseWind.y * (1 - c.strength) + c.windZ;
    const speed = Math.hypot(wx, wz);
    U.uWind.value.set(speed > 0.001 ? wx / speed : baseWind.x, speed > 0.001 ? wz / speed : baseWind.y, speed, baseWind.w);
    if (c.strength === 0) U.uWind.value.copy(baseWind);
    this.game.weather?.update(dt);
    this.applyAtmosphere(c);
    if (wasTransitioning) {
      this.progress.value = this.cycle.progress;
      if (this.cycle.progress === 1) this.showSelection();
    }
  }
}
