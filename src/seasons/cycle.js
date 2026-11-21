export const TRANSITION_SECONDS = 4;

export const CLIMATE_DEFAULTS = Object.freeze({
  strength: 0, temperature: 26, daylight: 14,
  rain: 0, cloud: 0, fog: 0, thunder: 0, wetness: 0, dew: 0,
  frost: 0, ice: 0, frozenSoil: 0, heat: 0,
  windX: 0, windZ: 0, birds: 0,
  cropGrowth: 0, cropRipeness: 0, cropHarvest: 0, goldBloom: 0,
});

function freezePreset(preset) {
  return Object.freeze({
    ...preset,
    grass: Object.freeze(preset.grass),
    leaves: Object.freeze(preset.leaves),
    climate: Object.freeze({ ...CLIMATE_DEFAULTS, ...preset.climate }),
  });
}

export const SEASONS = Object.freeze([
  { id: 'spring', name: '春', description: '嫩绿新芽，粉白春花。',
    grass: [1.55, 1.8, 0.82], leaves: [1.5, 1.7, 0.78], bloom: 1, snow: 0, pastel: 1, bare: 0, snowfall: 0, wither: 0 },
  { id: 'summer', name: '夏', description: '绿草繁花，夏日保留原景。',
    grass: [1, 1, 1], leaves: [1, 1, 1], bloom: 1, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0 },
  { id: 'autumn', name: '秋', description: '草木染橙，花影渐疏。',
    grass: [2.3, 0.82, 0.48], leaves: [2.6, 0.72, 0.32], bloom: 0.18, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0.3 },
  { id: 'winter', name: '冬', description: '漫天飞雪，枯草尽覆白雪。',
    grass: [1.8, 0.82, 0.52], leaves: [1.75, 0.8, 0.5], bloom: 0, snow: 1, pastel: 0, bare: 1, snowfall: 1, wither: 1 },
].map(freezePreset));

export const SOLAR_TERMS = Object.freeze([
  { id: 'lichun', name: '立春', season: 'spring', date: '2.3–2.5', description: '东风解冻，残冰未消。',
    phenology: '草木未展，冰面初松；候虫渐醒。', farming: '备耕、检修农具', wind: '偏东风', marker: '初融残冰 · 冬春交界',
    grass: [1.12, 1.16, 0.79], leaves: [1.22, 1.25, 0.82], bloom: 0, snow: 0.18, pastel: 0.4, bare: 0.95, snowfall: 0, wither: 0.4,
    climate: { strength: 1, temperature: 2, daylight: 10.5, cloud: 0.22, fog: 0.12, wetness: 0.25, ice: 0.65, frozenSoil: 0.65, windX: -0.65, windZ: 0.1, cropGrowth: 0.08 } },
  { id: 'yushui', name: '雨水', season: 'spring', date: '2.18–2.20', description: '雪转为雨，湿润萌芽。',
    phenology: '草木萌动，树仅抽芽；鸿雁北归。', farming: '育苗、小麦返青管护', wind: '湿润东南风', marker: '雪转雨 · 空气增湿',
    grass: [1.2, 1.55, 0.72], leaves: [1.28, 1.55, 0.74], bloom: 0, snow: 0, pastel: 0.5, bare: 0.82, snowfall: 0, wither: 0.1,
    climate: { strength: 1, temperature: 7, daylight: 11, rain: 0.38, cloud: 0.68, fog: 0.32, wetness: 0.8, ice: 0.22, frozenSoil: 0.25, windX: -0.5, windZ: -0.45, birds: 0.75, cropGrowth: 0.18 } },
  { id: 'jingzhe', name: '惊蛰', season: 'spring', date: '3.5–3.6', description: '春雷乍响，桃花初醒。',
    phenology: '桃始华，虫鸣鸟动。', farming: '备种、果树修剪', wind: '阵性偏南风', marker: '春雷始鸣 · 冷暖交锋',
    grass: [1.45, 1.72, 0.76], leaves: [1.4, 1.62, 0.76], bloom: 0.42, snow: 0, pastel: 1, bare: 0.32, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 12, daylight: 11.6, rain: 0.58, cloud: 0.9, fog: 0.12, thunder: 1, wetness: 0.7, windX: 0.75, windZ: -0.95, birds: 0.2, cropGrowth: 0.28 } },
  { id: 'chunfen', name: '春分', season: 'spring', date: '3.20–3.21', description: '昼夜均分，燕归花开。',
    phenology: '春燕北归，嫩叶舒展。', farming: '集中春播、小麦拔节', wind: '和缓东南风', marker: '昼夜各半 · 春燕北归',
    grass: [1.55, 1.8, 0.82], leaves: [1.5, 1.7, 0.78], bloom: 0.82, snow: 0, pastel: 1, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 16, daylight: 12, cloud: 0.16, wetness: 0.16, windX: -0.35, windZ: -0.35, birds: 1, cropGrowth: 0.4 } },
  { id: 'qingming', name: '清明', season: 'spring', date: '4.4–4.6', description: '细雨含雾，草木盛发。',
    phenology: '春花繁盛，细雨连绵。', farming: '采茶、植树、田间管理', wind: '微弱湿风', marker: '连阴细雨 · 低雾',
    grass: [1.35, 1.62, 0.85], leaves: [1.32, 1.65, 0.8], bloom: 1, snow: 0, pastel: 0.9, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 18, daylight: 12.7, rain: 0.3, cloud: 0.8, fog: 0.8, wetness: 0.95, windX: -0.16, windZ: -0.12, birds: 0.25, cropGrowth: 0.54 } },
  { id: 'guyu', name: '谷雨', season: 'spring', date: '4.19–4.21', description: '春雨丰沛，禾苗拔节。',
    phenology: '浮萍生，新苗成行。', farming: '播种杂粮、春播收尾', wind: '湿暖偏南风', marker: '春雨峰值 · 禾苗生长',
    grass: [1.1, 1.52, 0.78], leaves: [1.15, 1.5, 0.84], bloom: 0.65, snow: 0, pastel: 0.55, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 21, daylight: 13.3, rain: 0.82, cloud: 0.82, fog: 0.35, wetness: 1, windX: 0.25, windZ: -0.7, cropGrowth: 0.7 } },
  { id: 'lixia', name: '立夏', season: 'summer', date: '5.5–5.7', description: '暖光浓荫，万物旺长。',
    phenology: '草木旺盛，夏虫初鸣。', farming: '收油菜、插早稻', wind: '暖南风', marker: '初夏暖光 · 非酷暑',
    grass: [1.02, 1.4, 0.83], leaves: [0.95, 1.38, 0.78], bloom: 0.72, snow: 0, pastel: 0.28, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 24, daylight: 14, cloud: 0.15, wetness: 0.22, windX: 0.3, windZ: -0.5, cropGrowth: 0.84, cropRipeness: 0.25 } },
  { id: 'xiaoman', name: '小满', season: 'summer', date: '5.20–5.22', description: '湿热初起，青麦渐满。',
    phenology: '麦穗灌浆，尚未成熟。', farming: '灌浆管护、防干热风', wind: '湿热南风', marker: '青黄麦穗 · 将熟未熟',
    grass: [0.96, 1.28, 0.85], leaves: [0.9, 1.25, 0.78], bloom: 0.42, snow: 0, pastel: 0.12, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 27, daylight: 14.7, rain: 0.2, cloud: 0.52, fog: 0.2, wetness: 0.72, heat: 0.18, windX: 0.45, windZ: -0.5, cropGrowth: 1, cropRipeness: 0.48 } },
  { id: 'mangzhong', name: '芒种', season: 'summer', date: '6.5–6.7', description: '梅雨麦黄，忙收忙种。',
    phenology: '麦类成熟，新苗接续。', farming: '麦收与夏种同步', wind: '潮湿东南风', marker: '金麦与新苗 · 收种并行',
    grass: [1.15, 1.12, 0.7], leaves: [0.94, 1.2, 0.84], bloom: 0.28, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 29, daylight: 15.2, rain: 0.64, cloud: 0.82, fog: 0.4, wetness: 1, heat: 0.2, windX: -0.55, windZ: -0.6, cropGrowth: 1, cropRipeness: 1, cropHarvest: 0.72 } },
  { id: 'xiazhi', name: '夏至', season: 'summer', date: '6.21–6.22', description: '长昼强光，蝉鸣夏深。',
    phenology: '夏木繁茂，蝉声初盛。', farming: '灌溉、防旱', wind: '盛夏南风', marker: '白昼最长 · 强日照',
    grass: [0.98, 1.16, 0.88], leaves: [0.85, 1.16, 0.88], bloom: 0.48, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 30, daylight: 15.5, cloud: 0.06, heat: 0.32, windX: 0.3, windZ: -0.5, cropGrowth: 0.3 } },
  { id: 'xiaoshu', name: '小暑', season: 'summer', date: '7.6–7.8', description: '温风拂面，暑气初盛。',
    phenology: '草尖渐黄，浓荫仍在。', farming: '抗旱、蔬菜管护', wind: '偏南热风', marker: '初入高温 · 轻热浪',
    grass: [1.22, 1.06, 0.78], leaves: [1.02, 1.06, 0.8], bloom: 0.28, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 33, daylight: 15.2, cloud: 0.08, heat: 0.65, windX: 0.85, windZ: -0.6, cropGrowth: 0.48 } },
  { id: 'dashu', name: '大暑', season: 'summer', date: '7.22–7.24', description: '酷暑热浪，午后骤雨。',
    phenology: '暑热最盛，草色偏金。', farming: '抗旱、抢收早熟作物', wind: '强热风', marker: '高温峰值 · 热浪阵雨',
    grass: [1.65, 0.95, 0.6], leaves: [1.18, 1.02, 0.7], bloom: 0.12, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 36, daylight: 14.8, rain: 0.9, cloud: 0.45, thunder: 0.25, wetness: 0.65, heat: 1, windX: 1.15, windZ: -0.5, cropGrowth: 0.7 } },
  { id: 'liqiu', name: '立秋', season: 'autumn', date: '8.7–8.9', description: '秋意初起，暑色未退。',
    phenology: '叶色微转，寒蝉仍鸣。', farming: '早稻收割、玉米灌浆', wind: '偏东暖风', marker: '秋老虎 · 夏秋交界',
    grass: [1.5, 1.08, 0.72], leaves: [1.3, 1.08, 0.65], bloom: 0.2, snow: 0, pastel: 0, bare: 0, snowfall: 0, wither: 0,
    climate: { strength: 1, temperature: 31, daylight: 14.2, cloud: 0.1, heat: 0.55, windX: -0.5, windZ: 0.1, cropGrowth: 0.88, cropRipeness: 0.4 } },
  { id: 'chushu', name: '处暑', season: 'autumn', date: '8.22–8.24', description: '暑退天清，禾谷渐登。',
    phenology: '空气转爽，田野成熟。', farming: '秋收作物管护', wind: '干爽偏北风', marker: '暑气退场 · 干爽晴空',
    grass: [1.85, 0.98, 0.52], leaves: [1.8, 0.96, 0.5], bloom: 0.15, snow: 0, pastel: 0, bare: 0.04, snowfall: 0, wither: 0.06,
    climate: { strength: 1, temperature: 26, daylight: 13.5, cloud: 0.05, windX: 0.35, windZ: 0.65, cropGrowth: 1, cropRipeness: 0.85 } },
  { id: 'bailu', name: '白露', season: 'autumn', date: '9.7–9.9', description: '晨露晶莹，雁阵南归。',
    phenology: '露水为液态；鸿雁、燕群南迁。', farming: '采摘、杂粮成熟', wind: '清凉东北风', marker: '液态露珠 · 非白霜',
    grass: [1.95, 0.92, 0.56], leaves: [2.05, 0.9, 0.43], bloom: 0.12, snow: 0, pastel: 0, bare: 0.12, snowfall: 0, wither: 0.12,
    climate: { strength: 1, temperature: 21, daylight: 12.7, cloud: 0.1, fog: 0.2, wetness: 0.72, dew: 1, windX: -0.4, windZ: 0.5, birds: -1, cropGrowth: 1, cropRipeness: 1 } },
  { id: 'qiufen', name: '秋分', season: 'autumn', date: '9.22–9.24', description: '昼夜均分，金秋收获。',
    phenology: '秋叶转金，虫归蛰藏。', farming: '秋收、秋耕、秋种', wind: '清爽北风', marker: '昼夜各半 · 金秋收割',
    grass: [2.3, 0.82, 0.48], leaves: [2.6, 0.72, 0.32], bloom: 0.08, snow: 0, pastel: 0, bare: 0.32, snowfall: 0, wither: 0.35,
    climate: { strength: 1, temperature: 17, daylight: 12, cloud: 0.08, windX: 0.3, windZ: 0.75, birds: -0.4, cropGrowth: 1, cropRipeness: 1, cropHarvest: 0.85 } },
  { id: 'hanlu', name: '寒露', season: 'autumn', date: '10.8–10.9', description: '寒露凝珠，黄菊盛放。',
    phenology: '菊有黄华，雁群继续南行。', farming: '晚稻收割、冬麦播种', wind: '寒凉北风', marker: '寒露黄菊 · 尚非积雪',
    grass: [1.85, 0.8, 0.5], leaves: [2.2, 0.72, 0.34], bloom: 0.58, snow: 0, pastel: 0, bare: 0.62, snowfall: 0, wither: 0.55,
    climate: { strength: 1, temperature: 11, daylight: 11.3, cloud: 0.2, fog: 0.32, wetness: 0.65, dew: 0.8, windX: 0.4, windZ: 0.9, birds: -0.75, cropGrowth: 0.2, cropHarvest: 0.2, goldBloom: 1 } },
  { id: 'shuangjiang', name: '霜降', season: 'autumn', date: '10.23–10.24', description: '草尖覆霜，落叶归根。',
    phenology: '薄霜凝华，草木黄落。', farming: '收获收尾、防冻', wind: '冷北风', marker: '固态薄霜 · 无积雪',
    grass: [1.6, 0.82, 0.58], leaves: [1.9, 0.76, 0.48], bloom: 0.02, snow: 0, pastel: 0, bare: 0.88, snowfall: 0, wither: 0.8,
    climate: { strength: 1, temperature: 4, daylight: 10.7, cloud: 0.2, fog: 0.12, frost: 0.9, frozenSoil: 0.12, windX: 0.5, windZ: 1, cropGrowth: 0.1 } },
  { id: 'lidong', name: '立冬', season: 'winter', date: '11.7–11.8', description: '水初结冰，枯枝无雪。',
    phenology: '水始冰、地始冻，万物收藏。', farming: '田地休整、储粮', wind: '初冬北风', marker: '初冰冻土 · 不飘雪',
    grass: [1.95, 0.88, 0.52], leaves: [1.9, 0.85, 0.5], bloom: 0, snow: 0, pastel: 0, bare: 1, snowfall: 0, wither: 1,
    climate: { strength: 1, temperature: 1, daylight: 10, cloud: 0.35, frost: 0.3, ice: 0.42, frozenSoil: 0.55, windX: 0.5, windZ: 0.8, cropGrowth: 0.06 } },
  { id: 'xiaoxue', name: '小雪', season: 'winter', date: '11.22–11.23', description: '初雪轻落，随落随融。',
    phenology: '初雪难留，枝头仅有雪痕。', farming: '果树防冻、储菜', wind: '弱冷北风', marker: '初雪易融 · 不厚覆地',
    grass: [1.9, 0.86, 0.52], leaves: [1.85, 0.84, 0.5], bloom: 0, snow: 0.035, pastel: 0, bare: 1, snowfall: 0.28, wither: 1,
    climate: { strength: 1, temperature: -1, daylight: 9.3, cloud: 0.68, fog: 0.18, wetness: 0.55, ice: 0.58, frozenSoil: 0.65, windX: 0.35, windZ: 0.65, cropGrowth: 0.04 } },
  { id: 'daxue', name: '大雪', season: 'winter', date: '12.6–12.8', description: '密雪封野，积雪留存。',
    phenology: '稳定积雪，冻土加深。', farming: '冬修水利、农田封冻', wind: '强冷北风', marker: '稳定积雪 · 雪量增大',
    grass: [1.85, 0.84, 0.52], leaves: [1.8, 0.82, 0.5], bloom: 0, snow: 0.86, pastel: 0, bare: 1, snowfall: 0.85, wither: 1,
    climate: { strength: 1, temperature: -5, daylight: 8.8, cloud: 0.85, fog: 0.4, ice: 0.78, frozenSoil: 0.85, windX: 0.75, windZ: 1.2 } },
  { id: 'dongzhi', name: '冬至', season: 'winter', date: '12.21–12.23', description: '长夜短昼，冷光覆雪。',
    phenology: '白昼最短，草木深藏。', farming: '农闲、防冻保畜', wind: '冬日北风', marker: '白昼最短 · 低照度',
    grass: [1.8, 0.82, 0.52], leaves: [1.75, 0.8, 0.5], bloom: 0, snow: 0.94, pastel: 0, bare: 1, snowfall: 0.2, wither: 1,
    climate: { strength: 1, temperature: -7, daylight: 8.5, cloud: 0.45, fog: 0.12, ice: 0.88, frozenSoil: 0.9, windX: 0.45, windZ: 0.7 } },
  { id: 'xiaohan', name: '小寒', season: 'winter', date: '1.5–1.7', description: '严寒渐深，风雪常至。',
    phenology: '雁有北向之意，鹊始筑巢。', farming: '牲畜防寒、大棚管护', wind: '严寒北风', marker: '持续严寒 · 深冻',
    grass: [1.75, 0.8, 0.52], leaves: [1.7, 0.78, 0.5], bloom: 0, snow: 1, pastel: 0, bare: 1, snowfall: 0.65, wither: 1,
    climate: { strength: 1, temperature: -10, daylight: 8.8, cloud: 0.62, fog: 0.22, frost: 0.4, ice: 0.94, frozenSoil: 0.96, windX: 0.7, windZ: 1.05, birds: 0.16 } },
  { id: 'dahan', name: '大寒', season: 'winter', date: '1.20–1.21', description: '寒气至极，厚冰封水。',
    phenology: '水泽腹坚，冰层最厚。', farming: '农闲、备开春农具', wind: '强劲寒风', marker: '低温谷值 · 最厚冰层',
    grass: [1.7, 0.78, 0.52], leaves: [1.65, 0.76, 0.5], bloom: 0, snow: 1, pastel: 0, bare: 1, snowfall: 0.9, wither: 1,
    climate: { strength: 1, temperature: -14, daylight: 9.3, cloud: 0.72, fog: 0.35, frost: 0.65, ice: 1, frozenSoil: 1, windX: 1.0, windZ: 1.35 } },
].map(freezePreset));

function copyState({ grass, leaves, bloom, snow, pastel, bare, snowfall, wither, climate }) {
  return { grass: [...grass], leaves: [...leaves], bloom, snow, pastel, bare, snowfall, wither, climate: { ...climate } };
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

  get target() { return this.#destination.id; }
  get preset() { return this.#destination; }
  get progress() { return this.#elapsed / TRANSITION_SECONDS; }

  stepTerm(direction) {
    if (direction !== -1 && direction !== 1) return false;
    const index = SOLAR_TERMS.indexOf(this.#destination);
    if (index < 0) return false;
    return this.select(SOLAR_TERMS[(index + direction + SOLAR_TERMS.length) % SOLAR_TERMS.length].id);
  }

  select(id) {
    const destination = SEASONS.find((season) => season.id === id)
      || SOLAR_TERMS.find((term) => term.id === id);
    if (!destination || destination === this.#destination) return false;
    this.#start = copyState(this.state);
    this.#destination = destination;
    this.#elapsed = 0;
    return true;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || this.progress === 1) return this.state;
    this.#elapsed = Math.min(TRANSITION_SECONDS, this.#elapsed + dt);
    // Frame deltas can sum to just under the endpoint.
    if (TRANSITION_SECONDS - this.#elapsed < 1e-9) this.#elapsed = TRANSITION_SECONDS;
    const progress = this.progress;
    const amount = progress * progress * (3 - 2 * progress);
    for (const key of ['grass', 'leaves']) {
      for (let channel = 0; channel < 3; channel += 1) {
        this.state[key][channel] = lerp(this.#start[key][channel], this.#destination[key][channel], amount);
      }
    }
    for (const key of ['bloom', 'snow', 'pastel', 'bare', 'snowfall', 'wither']) {
      this.state[key] = lerp(this.#start[key], this.#destination[key], amount);
    }
    for (const key of Object.keys(CLIMATE_DEFAULTS)) {
      this.state.climate[key] = lerp(this.#start.climate[key], this.#destination.climate[key], amount);
    }
    return this.state;
  }
}
