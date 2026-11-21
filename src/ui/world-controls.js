const SAVE_MESSAGES = {
  saved: '环境已保存',
  memory: '仅本次有效 · 刷新后可能丢失',
  corrupt: '存档损坏 · 无法恢复上次环境',
  future: '存档版本较新 · 请使用新版游戏',
};

function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function attribute(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function clockTime(hour) {
  if (!Number.isFinite(hour)) return '--:--';
  const minutes = Math.floor((((hour % 24) + 24) % 24) * 60 + 1e-7) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export class WorldControls {
  constructor(panel, game) {
    this.game = game;
    this.details = panel.querySelector('#worldControls');
    this.day = panel.querySelector('#worldDay');
    this.time = panel.querySelector('#worldTime');
    this.phase = panel.querySelector('#worldPhase');
    this.weatherName = panel.querySelector('#worldWeatherName');
    this.clockState = panel.querySelector('#worldClockState');
    this.running = panel.querySelector('#worldRunning');
    this.weather = panel.querySelector('#worldWeather');
    this.hint = panel.querySelector('#worldControlHint');
    this.saveStatus = panel.querySelector('#worldSaveStatus');
    this.hours = [...panel.querySelectorAll('[data-world-hour]')];
    this.inputs = [...this.hours, this.running, this.weather];

    for (const button of this.hours) {
      button.addEventListener('click', (event) => {
        if (!game.paused && game.worldState) {
          game.worldState.setHour(Number(button.dataset.worldHour));
        }
        this.update();
        if (event.detail > 0) button.blur();
      });
    }
    this.running.addEventListener('click', (event) => {
      const world = game.worldState;
      if (!game.paused && world) world.setRunning(!world.running);
      this.update();
      if (event.detail > 0) this.running.blur();
    });
    this.weather.addEventListener('change', () => {
      if (!game.paused && game.worldState) game.worldState.setWeather(this.weather.value);
      // Also restore the real selection if a modal opened or the intent was refused.
      this.update();
    });
    this.update();
  }

  update() {
    const world = this.game.worldState;
    const paused = Boolean(this.game.paused);
    const disabled = paused || !world;
    for (const input of this.inputs) {
      if (input.disabled !== disabled) input.disabled = disabled;
    }

    const hint = !world ? '等待世界状态' : paused ? '游戏暂停中 · 返回游戏后可调整' : '';
    text(this.hint, hint);
    if (this.hint.hidden !== !hint) this.hint.hidden = !hint;

    const time = clockTime(world?.hour);
    const day = Number.isFinite(world?.day) ? `第${Math.trunc(world.day)}天` : '第—天';
    const phase = world?.phase || '—';
    const weatherName = world?.weatherName || '—';
    text(this.day, day);
    attribute(this.day, 'title', day);
    text(this.time, time);
    if (time !== '--:--') attribute(this.time, 'datetime', time);
    else if (this.time.hasAttribute('datetime')) this.time.removeAttribute('datetime');
    text(this.phase, phase);
    attribute(this.phase, 'title', phase);
    text(this.weatherName, weatherName);
    attribute(this.weatherName, 'title', weatherName);
    text(this.clockState, !world ? '等待世界状态' : paused ? '游戏已暂停' : world.running ? '时钟流转中' : '时钟已暂停');
    attribute(this.details, 'data-clock-running', String(Boolean(world?.running && !paused)));

    const runningLabel = world?.running ? '暂停时钟' : '继续时钟';
    text(this.running, runningLabel);
    attribute(this.running, 'aria-label', world?.running ? '暂停世界时钟' : '继续世界时钟');
    for (const button of this.hours) {
      attribute(button, 'aria-pressed', String(button.dataset.worldPhase === phase));
    }
    // Native select retains keyboard focus and is only written when its value differs.
    const weather = world?.weather ?? '';
    if (this.weather.value !== weather) this.weather.value = weather;

    const status = this.game.save?.status;
    text(this.saveStatus, SAVE_MESSAGES[status] ?? '保存状态待确认');
    attribute(this.saveStatus, 'data-level', status === 'saved' ? 'saved' : 'warning');
  }
}
