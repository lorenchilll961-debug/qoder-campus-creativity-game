export class GameModal {
  constructor(game, element, { closeKey, onKey } = {}) {
    this.game = game;
    this.element = element;
    this.closeKey = closeKey;
    this.onKey = onKey;
    element.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    element.addEventListener('close', () => { if (!element.open) this._release(); });
    window.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;
      event.stopImmediatePropagation();
      if (event.repeat) { event.preventDefault(); return; }
      if (event.code === 'Escape' || event.code === this.closeKey) {
        event.preventDefault(); this.close();
      } else if (this.onKey?.(event.code)) event.preventDefault();
    }, true);
  }

  get isOpen() { return this.game.modal === this; }

  show() {
    const g = this.game;
    if (this.isOpen) return true;
    if (g.state !== 'play' || g.paused || g.modal) return false;
    this.wasEnabled = g.input.enabled;
    g.modal = this;
    g.paused = true;
    g.input.enabled = false;
    g.input.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.element.showModal();
    return true;
  }

  close() {
    if (!this.isOpen) return;
    this.element.close();
    this._release();
  }

  _release() {
    if (!this.isOpen) return;
    const g = this.game;
    g.modal = null;
    g.input.clear();
    g.input.enabled = this.wasEnabled;
    g.paused = false;
    // Returning focus to a HUD button would swallow subsequent flight shortcuts.
    g.input.canvas.tabIndex = -1;
    g.input.canvas.focus({ preventScroll: true });
  }
}

export class Dialogue {
  constructor(game) {
    this.element = document.createElement('dialog');
    this.element.className = 'delivery-dialog';
    this.element.setAttribute('aria-labelledby', 'deliverySpeaker');
    this.element.innerHTML = '<p class="delivery-eyebrow">云雀港 · 信使来信</p><h2 id="deliverySpeaker"></h2><p class="delivery-text"></p><div class="delivery-actions"></div><small>E 确认 · Esc 暂时收起 · 关闭后点击场景恢复鼠标转向</small>';
    document.body.append(this.element);
    this.modal = new GameModal(game, this.element, {
      onKey: (code) => {
        if (code !== 'KeyE') return false;
        this.element.querySelector('.delivery-actions button')?.click();
        return true;
      },
    });
  }

  show(speaker, text, actions = [{ label: '知道了' }]) {
    this.element.querySelector('h2').textContent = speaker;
    this.element.querySelector('.delivery-text').textContent = text;
    const row = this.element.querySelector('.delivery-actions');
    row.replaceChildren();
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', () => { this.modal.close(); action.run?.(); });
      row.append(button);
    }
    return this.modal.show();
  }
}
