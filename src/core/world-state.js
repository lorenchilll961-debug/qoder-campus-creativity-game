import { SeasonCycle, SEASONS, SOLAR_TERMS, TRANSITION_SECONDS } from '../seasons/cycle.js';

export const DAY_SECONDS = 24 * 60;
export const WEATHER = Object.freeze([
  { id: 'seasonal', name: '随节气' },
  { id: 'clear', name: '晴', rain: 0, cloud: 0, fog: 0, thunder: 0, wind: 0.45 },
  { id: 'cloudy', name: '多云', rain: 0, cloud: 0.4, fog: 0.05, thunder: 0, wind: 0.7 },
  { id: 'overcast', name: '阴', rain: 0, cloud: 0.9, fog: 0.15, thunder: 0, wind: 0.6 },
  { id: 'rain', name: '雨', rain: 0.45, cloud: 0.75, fog: 0.2, thunder: 0, wind: 0.8 },
  { id: 'downpour', name: '暴雨', rain: 1, cloud: 1, fog: 0.42, thunder: 0, wind: 1.4 },
  { id: 'thunder', name: '雷雨', rain: 0.85, cloud: 0.95, fog: 0.3, thunder: 1, wind: 1.6 },
  { id: 'fog', name: '雾', rain: 0, cloud: 0.6, fog: 1, thunder: 0, wind: 0.2 },
  { id: 'snow', name: '雪', rain: 0, cloud: 0.8, fog: 0.35, thunder: 0, wind: 0.85 },
  { id: 'wind', name: '强风', rain: 0, cloud: 0.35, fog: 0.08, thunder: 0, wind: 2.1 },
].map(Object.freeze));

const PRESETS = [...SEASONS, ...SOLAR_TERMS];
const wrap = (hour) => ((hour % 24) + 24) % 24;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function daylightAt(hour, daylight = 14) {
  const span = clamp(daylight, 8, 16);
  const noonDistance = Math.abs(wrap(hour) - 12);
  const altitude = Math.sin(clamp((span / 2 - noonDistance) * Math.PI / span, -Math.PI / 2, Math.PI / 2));
  return {
    altitude,
    light: smooth(-0.15, 0.32, altitude),
    night: 1 - smooth(-0.22, 0.08, altitude),
    dusk: smooth(-0.16, 0.04, altitude) * (1 - smooth(0.12, 0.5, altitude)),
  };
}

export class WorldState {
  constructor(store) {
    this.store = store;
    this.cycle = new SeasonCycle();
    const saved = store.get('world.v1', null);
    const valid = saved?.version === 1;
    this.day = valid && Number.isSafeInteger(saved.day) && saved.day > 0 ? saved.day : 1;
    this.hour = valid && Number.isFinite(saved.hour) && saved.hour >= 0 && saved.hour < 24 ? saved.hour : 14;
    this.running = valid && typeof saved.running === 'boolean' ? saved.running : true;
    this.weather = valid && WEATHER.some((w) => w.id === saved.weather) ? saved.weather : 'seasonal';
    if (valid && PRESETS.some((p) => p.id === saved.season)) this.cycle.select(saved.season);
    this.cycle.update(TRANSITION_SECONDS);
    this.climate = { ...this.cycle.state.climate };
    this.snow = this.cycle.state.snow;
    this.snowfall = this.cycle.state.snowfall;
    this._weatherElapsed = TRANSITION_SECONDS;
    this._weatherStart = null;
    this._timeTransition = null;
    this._saveElapsed = 0;
    this._resolveWeather(0);
  }

  get phase() {
    const h = this.hour;
    if (h < 4 || h >= 22) return '深夜';
    if (h < 7) return '黎明';
    if (h < 11) return '清晨';
    if (h < 14) return '正午';
    if (h < 17) return '午后';
    return '黄昏';
  }

  get weatherName() {
    if (this.weather !== 'seasonal') return WEATHER.find((w) => w.id === this.weather).name;
    const c = this.climate;
    if (this.snowfall > 0.1) return '雪';
    if (c.thunder > 0.4) return '雷雨';
    if (c.rain > 0.75) return '暴雨';
    if (c.rain > 0.1) return '雨';
    if (c.fog > 0.55) return '雾';
    if (c.cloud > 0.7) return '阴';
    if (Math.hypot(c.windX, c.windZ) > 1.5) return '强风';
    return c.cloud > 0.2 ? '多云' : '晴';
  }

  setSeason(id) {
    if (!this.cycle.select(id)) return false;
    this.save();
    return true;
  }

  stepTerm(direction) {
    if (!this.cycle.stepTerm(direction)) return false;
    this.save();
    return true;
  }

  setHour(hour) {
    if (!Number.isFinite(hour) || hour < 0 || hour >= 24) return false;
    this._timeTransition = { from: this.hour, delta: ((hour - this.hour + 36) % 24) - 12, target: hour, elapsed: 0 };
    this.save();
    return true;
  }

  setRunning(running) {
    if (typeof running !== 'boolean' || running === this.running) return false;
    this.running = running;
    this.save();
    return true;
  }

  setWeather(id) {
    if (!WEATHER.some((w) => w.id === id) || id === this.weather) return false;
    this._weatherStart = { ...this.climate, snow: this.snow, snowfall: this.snowfall };
    this.weather = id;
    this._weatherElapsed = 0;
    this.save();
    return true;
  }

  _resolveWeather(dt) {
    const state = this.cycle.state, preset = WEATHER.find((w) => w.id === this.weather);
    const c = this.climate;
    Object.assign(c, state.climate);
    let snow = state.snow, snowfall = state.snowfall;
    if (preset.id !== 'seasonal') {
      c.strength = 1;
      for (const key of ['rain', 'cloud', 'fog', 'thunder']) c[key] = preset[key];
      const windLength = Math.hypot(c.windX, c.windZ);
      c.windX = (windLength > 0.001 ? c.windX / windLength : 0.361) * preset.wind;
      c.windZ = (windLength > 0.001 ? c.windZ / windLength : 0.933) * preset.wind;
      c.wetness = Math.max(c.dew * 0.6, c.rain);
      c.heat = 0;
      snowfall = preset.id === 'snow' ? 0.8 : 0;
      if (preset.id === 'snow') { c.temperature = Math.min(c.temperature, -2); snow = Math.max(snow, 0.72); }
    }
    this._weatherElapsed = Math.min(TRANSITION_SECONDS, this._weatherElapsed + dt);
    if (this._weatherElapsed < TRANSITION_SECONDS && this._weatherStart) {
      const t = smooth(0, TRANSITION_SECONDS, this._weatherElapsed), from = this._weatherStart;
      for (const key of Object.keys(c)) c[key] = from[key] + (c[key] - from[key]) * t;
      snow = from.snow + (snow - from.snow) * t;
      snowfall = from.snowfall + (snowfall - from.snowfall) * t;
    }
    this.snow = snow;
    this.snowfall = snowfall;
  }

  update(dt, active = true) {
    if (!Number.isFinite(dt) || dt < 0 || !active) return;
    this.cycle.update(dt);
    this._resolveWeather(dt);
    if (this._timeTransition) {
      const t = this._timeTransition;
      t.elapsed = Math.min(3, t.elapsed + dt);
      this.hour = wrap(t.from + t.delta * smooth(0, 3, t.elapsed));
      if (t.elapsed === 3) { this.hour = t.target; this._timeTransition = null; }
    } else if (this.running) {
      const total = this.hour + dt * 24 / DAY_SECONDS;
      this.day += Math.floor(total / 24);
      this.hour = wrap(total);
    }
    this._saveElapsed += dt;
    if (this._saveElapsed >= 10) this.save();
  }

  save() {
    this._saveElapsed = 0;
    return this.store.set('world.v1', {
      version: 1, day: this.day, hour: this._timeTransition?.target ?? this.hour,
      running: this.running, season: this.cycle.target, weather: this.weather,
    });
  }
}
