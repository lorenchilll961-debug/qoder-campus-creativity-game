import { GameModal } from './dialogue.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const side = (w, h) => Math.max(1, Math.min(w, h));
const valid = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.z);
const KINDS = { town: ['○', '城镇'], landing: ['■', '停靠平台'], place: ['◆', '探索地点'], pin: ['＋', '我的标记'] };
const COLORS = { palace: '#ffd282', player: '#f5faf5', target: '#ffc979', pickup: '#94d7be', destination: '#dfc391', town: '#a9dfd4', landing: '#94d7be', place: '#c5cfaa', pin: '#ffc979' };
const PIN_LIMIT = 12;
const signed = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const stationHeight = station => `${station.spot || (station.street ? '地面门口' : '屋顶露台')}｜${station.street ? '地面高度' : '平台高度'} ${station.pos.y.toFixed(2)} 米（世界 Y）`;
const groundArrival = '请到地面标记上方按 G 降落，步行到门口交接，勿前往屋顶。';

// span is metres across the viewport's SHORT axis; north is -z, east is +x.
export function boundView(view, world, w, h) {
  const span = clamp(view.span, world / 24, world * 1.08);
  const bx = Math.max(0, (world - span * w / side(w, h)) / 2);
  const bz = Math.max(0, (world - span * h / side(w, h)) / 2);
  return { x: clamp(view.x, -bx, bx), z: clamp(view.z, -bz, bz), span };
}
export function mapPoint(p, view, w, h) {
  const scale = side(w, h) / view.span;
  return { x: w / 2 + (p.x - view.x) * scale, y: h / 2 + (p.z - view.z) * scale };
}
export function unmapPoint(p, view, w, h) {
  const scale = view.span / side(w, h);
  return { x: view.x + (p.x - w / 2) * scale, z: view.z + (p.y - h / 2) * scale };
}
export function panView(view, dx, dy, world, w, h) {
  const scale = view.span / side(w, h);
  return boundView({ ...view, x: view.x - dx * scale, z: view.z - dy * scale }, world, w, h);
}
export function zoomView(view, factor, px, py, world, w, h) {
  const span = clamp(view.span * factor, world / 24, world * 1.08);
  const delta = (view.span - span) / side(w, h);
  return boundView({ x: view.x + (px - w / 2) * delta, z: view.z + (py - h / 2) * delta, span }, world, w, h);
}
export function fitView(points, world, w, h) {
  const ps = points.filter(valid);
  if (!ps.length) return { x: 0, z: 0, span: world * 1.08 };
  const xs = ps.map(p => p.x), zs = ps.map(p => p.z);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...zs), bottom = Math.max(...zs);
  return boundView({ x: (left + right) / 2, z: (top + bottom) / 2,
    span: Math.max(world / 12, (right - left) * side(w, h) / w, (bottom - top) * side(w, h) / h) * 1.3 }, world, w, h);
}

/** Event-driven atlas overlay. AtlasState alone owns persistent exploration/navigation. */
export class WorldMap {
  constructor(game, courier) {
    this.game = game;
    this.courier = courier;
    this.atlas = game.atlas;
    this.world = this.atlas.world;
    this.view = { x: 0, z: 0, span: this.world * 1.08 };
    this.selection = null;
    this.addingPin = false;
    this.draft = null;
    this.rows = [];
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'world-map';
    this.dialog.setAttribute('aria-label', '全岛航图');
    this.dialog.innerHTML = `<header class="wm-header"><div class="wm-title"><span class="wm-eyebrow">花信风 / 航行手记</span><h2>全岛航图</h2></div>
      <div class="wm-header-actions"><button type="button" data-action="theme" aria-pressed="false">浅色航图</button>
      <button type="button" data-action="close" autofocus aria-label="关闭地图，返回游戏">返回飞行 <kbd>M / Esc</kbd></button></div></header>
      <section class="wm-navigation" aria-label="当前导航"><div><span class="wm-eyebrow">◎ 导航目标</span><p class="wm-order" aria-live="polite"></p></div>
        <div class="wm-nav-actions"><button type="button" data-action="quest">返回订单</button><button type="button" data-action="stop">停止追踪</button></div></section>
      <div class="wm-layout"><section class="wm-chart" aria-label="地形航图">
        <div class="wm-chart-controls">
          <div class="wm-palace-actions" role="group" aria-label="故宫 · 秋英坡">
            <button type="button" data-action="palace-focus">定位故宫</button>
            <button type="button" data-action="palace">飞往故宫</button>
          </div>
          <div class="wm-filters" role="group" aria-label="地图类别筛选">
            <button type="button" data-filter="town" aria-pressed="true">○ 城镇</button><button type="button" data-filter="landing" aria-pressed="true">■ 停靠平台</button>
            <button type="button" data-filter="place" aria-pressed="true">◆ 探索地点</button><button type="button" data-filter="pin" aria-pressed="true">＋ 我的标记</button>
          </div>
          <p class="wm-palace-status" role="status" hidden></p>
        </div>
        <div class="wm-surface"><canvas role="img" aria-label="真实地形航图，上北下南。可在右侧地点列表选择与追踪。"></canvas>
          <span class="wm-north" aria-hidden="true">↑<br>北 N</span><span class="wm-map-hint">暗色区域尚未探索</span><span class="wm-hover" hidden></span></div>
        <div class="wm-toolbar" role="group" aria-label="地图视图"><button type="button" data-action="all">全岛总览</button>
          <button type="button" data-action="route">查看航线</button><button type="button" data-action="player">回到玩家</button>
          <div class="wm-zoom"><button type="button" data-action="out" aria-label="缩小地图">−</button><output aria-label="缩放倍数"></output>
          <button type="button" data-action="in" aria-label="放大地图">+</button></div></div>
        <p class="wm-position"></p></section>
        <aside class="wm-sidebar" aria-label="地点与标记">
          <section class="wm-exploration"><div><h3>探索记录</h3><span class="wm-progress-text"></span></div><progress max="100" value="0" aria-label="全岛探索进度"></progress><p class="wm-discoveries"></p></section>
          <section class="wm-deliveries" aria-label="配送站点与随身订单">
            <h3>随身订单 <span class="wm-order-count wm-count"></span></h3><p class="wm-orders-empty">暂无随身订单，选择站点前往接单。</p>
            <div class="wm-orders" role="group" aria-label="全部随身订单，选择收件点"></div>
            <h3>配送站点 <span class="wm-station-count wm-count"></span></h3><p class="wm-delivery-hint">每站持续接单 · 点击切换导航</p>
            <div class="wm-stations" role="group" aria-label="全部配送站点，选择取件点"></div>
          </section>
          <section class="wm-details" aria-label="所选地点"><span class="wm-detail-kind wm-eyebrow">地点详情</span><h3 class="wm-detail-name">选择一处地点</h3>
            <p class="wm-detail-description">点击地图符号或下方地点列表，查看距离与高度。</p><p class="wm-detail-coordinates"></p><p class="wm-detail-warning"></p>
            <div class="wm-detail-actions"><button type="button" data-action="track" disabled>追踪地点</button><button type="button" data-action="focus" disabled>在图中定位</button></div>
            <form class="wm-pin-editor" hidden><label for="wm-pin-name">标记名称</label><input id="wm-pin-name" name="pinName" maxlength="32" autocomplete="off" placeholder="为这处标记命名">
              <div><button type="submit" data-action="save-pin">保存名称</button><button type="button" data-action="delete-pin">删除标记</button><button type="button" data-action="cancel-pin" hidden>取消</button></div></form>
          </section>
          <div class="wm-list-heading"><h3>地点索引 <span class="wm-count"></span></h3><button type="button" data-action="add-pin" aria-pressed="false">＋ 添加标记</button></div>
          <p class="wm-pin-status" role="status"></p><div class="wm-places" role="group" aria-label="可选择的已知地点"></div><p class="wm-empty" hidden>此类别暂无已知地点。继续探索，或开启其他类别。</p>
        </aside></div>
      <footer><div class="wm-legend"><span>▲ 玩家</span><span class="wm-target">◎ 当前目标</span><span class="wm-pickup">■ 取件点</span><span class="wm-destination">◆ 收件点</span></div>
        <p>拖动平移 · 滚轮缩放 · 虚线仅为方向参考，不是地面道路；屋顶请对准平台，地面请按 G 降落后步行交接。</p></footer>`;
    document.body.appendChild(this.dialog);
    this.canvas = this.dialog.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.modal = new GameModal(game, this.dialog, { closeKey: 'KeyM' });
    this.onKey = (e) => {
      if (e.code !== 'KeyM' || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || this.modal.isOpen ||
          game.state !== 'play' || game.paused || game.modal ||
          e.composedPath().some(el => el.isContentEditable || el.matches?.('input, textarea, select, button, summary, [role="textbox"]'))) return;
      if (this.open()) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', this.onKey, true);
    this.dialog.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button || button.disabled) return;
      if (button.dataset.filter) {
        const kind = button.dataset.filter;
        this.atlas.setFilter(kind, !this.atlas.filters[kind]); this.render();
      } else if (button.dataset.stationId) this.selectStation(button.dataset.stationId);
      else if (button.dataset.id) this.select(button.dataset.kind, button.dataset.id);
      else this.action(button.dataset.action);
    });
    this.dialog.querySelector('.wm-pin-editor').addEventListener('submit', e => { e.preventDefault(); this.savePin(); });
    // Preserve GameModal's pause/input capture; allow the letter M in a name field.
    this.dialog.addEventListener('focusin', e => { this.modal.closeKey = e.target.matches('input') ? undefined : 'KeyM'; });
    this.dialog.addEventListener('focusout', () => { this.modal.closeKey = 'KeyM'; });
    this.canvas.addEventListener('pointerdown', e => {
      if (!this.modal.isOpen || e.button !== 0 || this.drag) return;
      this.cancelZoom();
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
      this.canvas.setPointerCapture(e.pointerId); e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!this.modal.isOpen) return;
      if (!this.drag) { this.hover(e); return; }
      const d = this.drag;
      if (d.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) d.moved = true;
      if (d.moved) {
        this.canvas.classList.add('dragging');
        this.setView(panView(this.view, e.clientX - d.x, e.clientY - d.y, this.world, this.w, this.h));
        d.x = e.clientX; d.y = e.clientY;
      }
    });
    this.canvas.addEventListener('pointerup', e => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const click = !d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 5;
      this.endDrag();
      if (click && this.modal.isOpen) this.surfaceClick(this.localPoint(e));
    });
    for (const event of ['pointercancel', 'lostpointercapture']) this.canvas.addEventListener(event, e => {
      if (this.drag?.id === e.pointerId) this.endDrag();
    });
    this.canvas.addEventListener('pointerleave', () => this.clearHover());
    this.canvas.addEventListener('wheel', e => {
      if (!this.modal.isOpen || this.drag) return;
      e.preventDefault();
      const p = this.localPoint(e), delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1);
      this.zoom(Math.exp(clamp(delta * 0.0015, -0.7, 0.7)), p.x, p.y);
    }, { passive: false });
    this.dialog.addEventListener('close', () => { if (!this.modal.isOpen) this.cancelInteraction(); });
    this.onBlur = () => this.cancelInteraction();
    window.addEventListener('blur', this.onBlur);
    this.onVisibility = () => { if (document.hidden) this.cancelInteraction(); };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.observer = new ResizeObserver(() => { if (this.modal.isOpen) { this.cancelZoom(); this.render(); } });
    this.observer.observe(this.canvas);
  }

  get isOpen() { return this.modal.isOpen; }
  open() {
    if (this.modal.isOpen || !this.modal.show()) return false;
    this.dialog.querySelector('.wm-palace-status').hidden = true;
    this.render();
    this.courier.mapOpened?.();
    return true;
  }
  close() { this.cancelInteraction(); this.modal.close(); }
  cancelInteraction() {
    this.endDrag(); this.cancelZoom(); this.clearHover(); this.addingPin = false; this.draft = null;
    if (this.modal.isOpen) this.render();
  }
  endDrag() {
    const id = this.drag?.id;
    this.drag = null;
    if (id !== undefined && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.canvas.classList.remove('dragging');
  }
  target() {
    const target = this.atlas.resolve(this.courier.target);
    return target && (!target.hidden || this.atlas.isKnown(target)) ? target : null;
  }
  routePoints() {
    // The errand stations double as the route's waypoints: every one of them can hand out work.
    const stops = this.courier.stations || [];
    return [this.game.flight.pos, this.target()?.pos, ...stops.map(p => p.pos)].filter(valid);
  }
  knownItems() { return [...this.atlas.landmarks.filter(p => this.atlas.isKnown(p)), ...this.atlas.pins]; }
  visibleItems() {
    const palaceId = this.game.palace?.landmark.id;
    return this.knownItems().filter(p => p.id === palaceId || this.atlas.filters[p.kind]);
  }
  selected() {
    if (this.selection?.kind === 'station') return this.courier.stationById(this.selection.id);
    return this.visibleItems().find(p => p.id === this.selection?.id && (p.kind === 'pin' ? 'pin' : 'landmark') === this.selection.kind) || null;
  }
  destinationCounts() {
    const counts = new Map();
    for (const order of this.courier.quest?.orders || []) counts.set(order.to, (counts.get(order.to) || 0) + 1);
    return counts;
  }
  selectStation(id) {
    if (!this.courier.trackStation(id)) return;
    this.selection = { kind: 'station', id }; this.draft = null; this.addingPin = false;
    this.atlas.track('quest'); this.render();
  }
  select(kind, id) {
    this.selection = { kind, id }; this.draft = null; this.addingPin = false;
    this.render();
  }
  action(action) {
    if (action === 'close') this.close();
    else if (action === 'palace-focus' && this.game.palace) {
      const { collision, landmark } = this.game.palace;
      this.selection = { kind: 'landmark', id: landmark.id };
      this.draft = null;
      this.addingPin = false;
      this.setView(fitView([collision.bounds.min, collision.bounds.max], this.world, this.w, this.h));
    }
    else if (action === 'palace') {
      if (this.game.switchPalace?.()) this.close();
      else {
        const message = this.dialog.querySelector('.wm-palace-status');
        message.textContent = '请等当前起飞或降落结束，再试一次。';
        message.hidden = false;
      }
    }
    else if (action === 'all') this.setView({ x: 0, z: 0, span: this.world * 1.08 });
    else if (action === 'route') this.setView(fitView(this.routePoints(), this.world, this.w, this.h));
    else if (action === 'player' && valid(this.game.flight.pos)) this.setView({ ...this.game.flight.pos, span: Math.min(this.view.span, this.world / 4) });
    else if (action === 'in' || action === 'out') this.zoom(action === 'in' ? 0.75 : 1 / 0.75, this.w / 2, this.h / 2);
    else if (action === 'theme') { this.atlas.setTheme(this.atlas.theme === 'dark' ? 'light' : 'dark'); this.render(); }
    else if (action === 'quest') { this.atlas.track('quest'); this.render(); }
    else if (action === 'stop') { this.atlas.clearTracking(); this.render(); }
    else if (action === 'track' && this.selected()) {
      if (this.selection.kind === 'station') this.selectStation(this.selection.id);
      else { this.atlas.track(this.selection.kind, this.selection.id); this.render(); }
    }
    else if (action === 'focus' && this.selected()) this.setView({ ...this.selected().pos, span: this.world / 8 });
    else if (action === 'add-pin' && this.atlas.pins.length < PIN_LIMIT) {
      this.addingPin = !this.addingPin; this.draft = null; this.editorKey = null; this.render();
    } else if (action === 'cancel-pin') { this.draft = null; this.addingPin = false; this.render(); }
    else if (action === 'delete-pin' && this.selected()?.kind === 'pin') {
      this.atlas.removePin(this.selection.id); this.selection = null; this.render();
      this.dialog.querySelector('[data-action="add-pin"]').focus();
    }
    // save-pin is handled by the form's native submit (including Enter).
  }
  savePin() {
    const input = this.dialog.querySelector('#wm-pin-name');
    if (this.draft) {
      const pin = this.atlas.addPin(this.draft.pos, input.value.trim() || this.draft.name);
      if (!pin) { this.dialog.querySelector('.wm-pin-status').textContent = '无法添加：最多保存 12 个标记，请先删除一个。'; return; }
      this.atlas.setFilter('pin', true);
      this.selection = { kind: 'pin', id: pin.id }; this.draft = null; this.addingPin = false;
    } else if (this.selected()?.kind === 'pin') {
      if (!input.value.trim()) { this.dialog.querySelector('.wm-pin-status').textContent = '请输入标记名称。'; input.focus(); return; }
      this.atlas.renamePin(this.selection.id, input.value);
    } else return;
    this.editorKey = null; this.render();
    this.dialog.querySelector('.wm-pin-status').textContent = '标记已保存。仅用于导航，不是停靠平台。';
  }
  localPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * this.w / rect.width, y: (e.clientY - rect.top) * this.h / rect.height };
  }
  hitTest(p) {
    return [...(this.courier.stations || []), ...this.visibleItems()].filter(item => valid(item.pos))
      .map(item => ({ item, screen: mapPoint(item.pos, this.view, this.w, this.h) }))
      .filter(({ screen }) => screen.x >= 0 && screen.x <= this.w && screen.y >= 0 && screen.y <= this.h)
      .map(hit => ({ ...hit, distance: Math.hypot(p.x - hit.screen.x, p.y - hit.screen.y) }))
      .filter(hit => hit.distance <= 16).sort((a, b) => a.distance - b.distance)[0]?.item;
  }
  surfaceClick(p) {
    if (this.addingPin) {
      const pos = unmapPoint(p, this.view, this.w, this.h);
      if (Math.abs(pos.x) > this.world / 2 || Math.abs(pos.z) > this.world / 2) {
        this.dialog.querySelector('.wm-pin-status').textContent = '请在全岛边界内添加标记。'; return;
      }
      pos.y = Math.max(this.game.terrain.meta.sea ?? 0, this.game.terrain.heightAt(pos.x, pos.z));
      this.draft = { name: `标记 ${this.atlas.pins.length + 1}`, kind: 'pin', pos };
      this.editorKey = null; this.render();
      const input = this.dialog.querySelector('#wm-pin-name'); input.focus(); input.select();
      return;
    }
    const item = this.hitTest(p);
    if (item && this.courier.stations?.includes(item)) { this.selectStation(item.id); return; }
    this.selection = item ? { kind: item.kind === 'pin' ? 'pin' : 'landmark', id: item.id } : null;
    this.render();
  }
  hover(e) {
    const item = this.hitTest(this.localPoint(e));
    const tooltip = this.dialog.querySelector('.wm-hover');
    tooltip.hidden = !item || this.addingPin;
    const station = item && this.courier.stations?.includes(item), count = station ? this.destinationCounts().get(item.id) || 0 : 0;
    tooltip.textContent = station ? `${count ? `◆ 收件点 · ${count} 单` : '■ 取件点'} · ${item.name} · ${stationHeight(item)}` : item ? `${KINDS[item.kind][0]} ${item.name}` : '';
    this.canvas.classList.toggle('has-hit', !!item);
  }
  clearHover() { this.dialog.querySelector('.wm-hover').hidden = true; this.canvas.classList.remove('has-hit'); }
  setView(view) { this.cancelZoom(); this.clearHover(); this.view = boundView(view, this.world, this.w, this.h); this.render(); }
  cancelZoom() {
    if (this.zoomFrame != null) window.cancelAnimationFrame?.(this.zoomFrame);
    this.zoomFrame = null; this.zoomTarget = null;
  }
  zoom(factor, x, y) {
    const destination = zoomView(this.zoomTarget || this.view, factor, x, y, this.world, this.w, this.h);
    this.cancelZoom();
    if (!this.modal.isOpen) return;
    if (!window.requestAnimationFrame || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { this.setView(destination); return; }
    const start = { ...this.view };
    let began;
    this.zoomTarget = destination;
    const tick = time => {
      if (!this.modal.isOpen || this.zoomTarget !== destination) return;
      began ??= time;
      const t = Math.min(1, (time - began) / 150), ease = 1 - (1 - t) ** 3;
      this.view = boundView({ x: start.x + (destination.x - start.x) * ease, z: start.z + (destination.z - start.z) * ease,
        span: start.span + (destination.span - start.span) * ease }, this.world, this.w, this.h);
      this.draw(); this.renderZoom();
      if (t < 1) this.zoomFrame = window.requestAnimationFrame(tick);
      else { this.zoomFrame = null; this.zoomTarget = null; }
    };
    this.zoomFrame = window.requestAnimationFrame(tick);
  }

  thumbnail() {
    const terrain = this.game.terrain, size = 384;
    if (this.cachedTerrain !== terrain || this.cachedWorld !== this.world) {
      this.heights = new Float32Array(size * size);
      for (let z = 0; z < size; z++) for (let x = 0; x < size; x++)
        this.heights[z * size + x] = terrain.heightAt(((x + 0.5) / size - 0.5) * this.world, ((z + 0.5) / size - 0.5) * this.world);
      this.cachedTerrain = terrain; this.cachedWorld = this.world; this.cachedTheme = null;
    }
    if (this.cachedTheme === this.atlas.theme) return this.thumb;
    this.thumb = document.createElement('canvas'); this.fogThumb = document.createElement('canvas');
    this.thumb.width = this.thumb.height = this.fogThumb.width = this.fogThumb.height = size;
    const ctx = this.thumb.getContext('2d'), fog = this.fogThumb.getContext('2d');
    const image = ctx.createImageData(size, size), muted = fog.createImageData(size, size), sea = terrain.meta.sea ?? 0;
    const light = this.atlas.theme === 'light';
    for (let i = 0; i < this.heights.length; i++) {
      const h = this.heights[i], elevation = clamp((h - sea) / 480, 0, 1);
      const shade = clamp((h - this.heights[Math.max(0, i - size)]) * 0.6, -18, 18);
      const rgb = h <= sea ? (light ? [101, 155, 163] : [26, 63, 72]) :
        (light ? [116 + elevation * 96 + shade, 145 + elevation * 69 + shade, 114 + elevation * 72 + shade] :
          [62 + elevation * 126 + shade, 103 + elevation * 92 + shade, 82 + elevation * 72 + shade]);
      const grey = (rgb[0] * 0.3 + rgb[1] * 0.5 + rgb[2] * 0.2) * 0.42;
      image.data.set([...rgb, 255], i * 4); muted.data.set([grey, grey + 8, grey + 10, 255], i * 4);
    }
    ctx.putImageData(image, 0, 0); fog.putImageData(muted, 0, 0);
    this.cachedTheme = this.atlas.theme;
    return this.thumb;
  }
  drawRiver(point, scale) {
    const river = this.game.terrain.meta.river || [], c = this.ctx;
    c.fillStyle = this.atlas.theme === 'light' ? '#79bac2' : '#44888e';
    for (let i = 1; i < river.length; i++) {
      const a = river[i - 1], b = river[i];
      if (![...a, ...b].every(Number.isFinite)) continue;
      const p = point({ x: a[0], z: a[1] }), q = point({ x: b[0], z: b[1] });
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      if (!length) continue;
      const nx = -(q.y - p.y) / length, ny = (q.x - p.x) / length, aw = a[2] * scale, bw = b[2] * scale;
      c.beginPath(); c.moveTo(p.x + nx * aw, p.y + ny * aw); c.lineTo(q.x + nx * bw, q.y + ny * bw);
      c.lineTo(q.x - nx * bw, q.y - ny * bw); c.lineTo(p.x - nx * aw, p.y - ny * aw); c.closePath(); c.fill();
    }
  }
  drawRoads(point, scale) {
    const c = this.ctx;
    c.strokeStyle = this.atlas.theme === 'light' ? '#eadbc0' : '#a7aaa0';
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const road of this.game.town?.roads || []) {
      if (road.pts.length < 2) continue;
      c.lineWidth = Math.max(0.7, road.width * scale);
      c.beginPath();
      road.pts.forEach(([x, z], i) => {
        const p = point({ x, z });
        if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
      });
      c.stroke();
    }
  }
  drawFog(corner, scale) {
    const { gridSize: n, cells } = this.atlas, cell = this.world / n * scale, source = this.fogThumb.width / n;
    // Merge unknown horizontal runs. The UI only reads exploration cells, never reveals them.
    for (let z = 0; z < n; z++) for (let x = 0; x < n;) {
      if (cells[z * n + x]) { x++; continue; }
      const start = x;
      while (x < n && !cells[z * n + x]) x++;
      this.ctx.drawImage(this.fogThumb, start * source, z * source, (x - start) * source, source,
        corner.x + start * cell, corner.y + z * cell, (x - start) * cell + 0.4, cell + 0.4);
    }
  }
  render() {
    if (!this.modal.isOpen) return;
    this.world = this.atlas.world;
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width); this.h = Math.max(1, rect.height);
    this.view = boundView(this.view, this.world, this.w, this.h);
    if (!this.selected()) this.selection = null;
    this.renderUI(); this.draw();
  }
  draw() {
    if (!this.modal.isOpen) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), c = this.ctx, w = this.w, h = this.h, v = this.view, scale = side(w, h) / v.span;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    const point = p => mapPoint(p, v, w, h), corner = point({ x: -this.world / 2, z: -this.world / 2 });
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = this.atlas.theme === 'light' ? '#394143' : '#171f21'; c.fillRect(0, 0, w, h);
    c.drawImage(this.thumbnail(), corner.x, corner.y, this.world * scale, this.world * scale);
    this.drawRiver(point, scale); this.drawRoads(point, scale); this.drawFog(corner, scale);
    const palace = this.game.palace;
    if (palace) {
      const { min, max } = palace.collision.bounds;
      const a = point(min), b = point(max);
      c.fillStyle = '#b599683c';
      c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      c.strokeStyle = COLORS.palace;
      c.lineWidth = Math.max(1, scale * 4);
      c.beginPath();
      c.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      c.stroke();
    }
    c.strokeStyle = '#c0e5df18'; c.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      const p = point({ x: i * this.world / 4, z: i * this.world / 4 });
      c.beginPath(); c.moveTo(p.x, 0); c.lineTo(p.x, h); c.moveTo(0, p.y); c.lineTo(w, p.y); c.stroke();
    }
    const labels = [];
    const label = (text, x, y, color) => {
      text = String(text);
      c.font = '12px system-ui, "PingFang SC", sans-serif';
      const original = text;
      while (text.length > 1 && c.measureText(text).width > Math.min(220, w - 30)) text = text.slice(0, -1);
      if (text !== original) text = text.slice(0, -1) + '…';
      const width = c.measureText(text).width;
      x = clamp(x, 8, Math.max(8, w - width - 8));
      const base = clamp(y, 18, h - 36);
      let found = false;
      for (let n = 0; n < 7; n++) {
        y = base + Math.ceil(n / 2) * (n % 2 ? -18 : 18);
        if (y < 18 || y > h - 36 || labels.some(b => x < b.x + b.w + 6 && x + width + 6 > b.x && Math.abs(y - b.y) < 17)) continue;
        found = true; break;
      }
      if (!found) return;
      labels.push({ x, y, w: width }); c.lineWidth = 4; c.strokeStyle = '#172f34'; c.fillStyle = color;
      c.strokeText(text, x, y); c.fillText(text, x, y);
    };
    const line = (a, b, color) => {
      if (!valid(a) || !valid(b)) return;
      const p = point(a), q = point(b);
      c.beginPath(); c.setLineDash([6, 7]); c.strokeStyle = color; c.lineWidth = 1.5;
      c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke(); c.setLineDash([]);
    };
    const target = this.target(), player = this.game.flight.pos;
    line(player, target?.pos, COLORS.target);
    const marker = (p, kind, text, edge = false, selected = false, count = 0) => {
      if (!valid(p)) return;
      const raw = point(p);
      if (!edge && (raw.x < 0 || raw.x > w || raw.y < 0 || raw.y > h)) return;
      const x = clamp(raw.x, 14, w - 14), y = clamp(raw.y, 14, h - 14), off = x !== raw.x || y !== raw.y;
      c.save(); c.translate(x, y); c.fillStyle = COLORS[kind]; c.strokeStyle = '#172f34'; c.lineWidth = 3;
      if (selected) { c.beginPath(); c.strokeStyle = '#ffc979'; c.lineWidth = 2; c.arc(0, 0, 13, 0, Math.PI * 2); c.stroke(); c.strokeStyle = '#172f34'; }
      c.beginPath();
      if (kind === 'player') { c.rotate(this.game.flight.yaw || 0); c.moveTo(0, -10); c.lineTo(7, 7); c.lineTo(0, 3); c.lineTo(-7, 7); c.closePath(); }
      else if (kind === 'pickup' || kind === 'landing') c.rect(-5, -5, 10, 10);
      else if (kind === 'destination' || kind === 'place' || kind === 'palace') { c.moveTo(0, -7); c.lineTo(7, 0); c.lineTo(0, 7); c.lineTo(-7, 0); c.closePath(); }
      else if (kind === 'pin') { c.moveTo(-6, 0); c.lineTo(6, 0); c.moveTo(0, -6); c.lineTo(0, 6); }
      else c.arc(0, 0, kind === 'target' ? 11 : 5, 0, Math.PI * 2);
      c.stroke();
      if (kind === 'target' || kind === 'town' || kind === 'pin') { c.strokeStyle = COLORS[kind]; c.lineWidth = 2; c.stroke(); }
      else c.fill();
      c.restore();
      if (count) {
        c.font = 'bold 11px system-ui, sans-serif';
        const text = String(count), width = c.measureText(text).width, left = clamp(x + 8, 4, w - width - 8), top = clamp(y + 14, 14, h - 4);
        c.fillStyle = '#172f34'; c.fillRect(left - 3, top - 12, width + 6, 16);
        c.fillStyle = COLORS.destination; c.fillText(text, left, top);
      }
      if (text) label(`${text}${off && edge ? '（图外）' : ''}`, x + 14, y - 12, COLORS[kind]);
    };
    // Draw the palace label before nearby town and delivery labels can take its space.
    const palaceLandmark = palace?.landmark;
    if (palaceLandmark) marker(palaceLandmark.pos, 'palace', '故宫 · 秋英坡', false,
      this.selection?.kind === 'landmark' && this.selection.id === palaceLandmark.id);
    marker(target?.pos, 'target', palaceLandmark && target?.id === palaceLandmark.id ? '' : `目标 · ${target?.name || '停靠点'}`, true);
    marker(player, 'player', '你在这里', true);
    const counts = this.destinationCounts();
    for (const station of this.courier.stations || []) {
      const count = counts.get(station.id) || 0, selected = this.selection?.kind === 'station' && this.selection.id === station.id;
      marker(station.pos, 'pickup', count ? '' : `取件点 · ${station.name}`, true, selected);
      if (count) marker(station.pos, 'destination', `收件点 · ${count} 单 · ${station.name}`, true, false, count);
    }
    for (const item of this.visibleItems()) {
      if (item.id === palaceLandmark?.id || (palaceLandmark && item.pad &&
          item.pos.x === palaceLandmark.pos.x && item.pos.z === palaceLandmark.pos.z)) continue;
      const selected = this.selection?.kind !== 'station' && this.selection?.id === item.id;
      const labelVisible = item.kind !== 'landing' || v.span < this.world / 3 || selected;
      marker(item.pos, item.kind, labelVisible && target?.pos !== item.pos ? item.name : '', false, selected);
    }
    if (this.draft) marker(this.draft.pos, 'pin', this.draft.name, false, true);
    const metres = 10 ** Math.floor(Math.log10(90 / scale)), length = metres * scale;
    c.strokeStyle = COLORS.player; c.lineWidth = 2; c.beginPath(); c.moveTo(16, h - 17); c.lineTo(16 + length, h - 17); c.stroke();
    c.font = '12px system-ui, sans-serif'; c.fillStyle = COLORS.player; c.fillText(`${metres} 米`, 16, h - 25);
  }
  renderZoom() {
    const v = this.zoomTarget || this.view;
    this.dialog.querySelector('output').textContent = `${(this.world * 1.08 / this.view.span).toFixed(1)}×`;
    this.dialog.querySelector('[data-action="in"]').disabled = v.span <= this.world / 24;
    this.dialog.querySelector('[data-action="out"]').disabled = v.span >= this.world * 1.08;
  }
  renderUI() {
    const q = selector => this.dialog.querySelector(selector), atlas = this.atlas, player = this.game.flight.pos, target = this.target();
    this.dialog.dataset.theme = atlas.theme;
    q('[data-action="theme"]').textContent = atlas.theme === 'dark' ? '浅色航图' : '深色航图';
    q('[data-action="theme"]').setAttribute('aria-pressed', String(atlas.theme === 'light'));
    for (const kind of Object.keys(KINDS)) q(`[data-filter="${kind}"]`).setAttribute('aria-pressed', String(atlas.filters[kind]));
    const status = this.courier.statusText || '自由航行';
    const pad = target && !target.street && (target.pad || atlas.landmarks.some(item => item.pad === target && atlas.isKnown(item)));
    const height = target?.street ? `${target.spot || '地面门口'}｜地面高度` : pad ? `${target.spot || '停靠平台'}｜平台高度` : '导航高度';
    q('.wm-order').textContent = target ? `${status} · ${target.name} · ${height} ${target.pos.y.toFixed(2)} 米（世界 Y）；${target.street ? groundArrival : pad ? '请对准平台，勿降至下方地面。' : '仅作方向参考。'}` : `${status} · 暂无当前目标，自由探索全岛。`;
    q('[data-action="quest"]').disabled = !this.courier.target || atlas.tracking?.kind === 'quest';
    q('[data-action="stop"]').disabled = !atlas.tracking;
    q('[data-action="route"]').disabled = !target;
    const palace = this.game.palace, palaceButton = q('[data-action="palace"]');
    q('[data-action="palace-focus"]').disabled = !palace;
    palaceButton.disabled = !palace;
    palaceButton.textContent = palace?.collision.contains(player.x, player.z) ? '返回海岛航线' : '飞往故宫';
    if (!palace) {
      const message = q('.wm-palace-status');
      message.textContent = '故宫场景加载失败。请刷新游戏后重试。';
      message.hidden = false;
    }
    q('.wm-position').textContent = `玩家 X ${player.x.toFixed(1)} / Z ${player.z.toFixed(1)} · 高度 ${player.y.toFixed(2)} 米` +
      (target ? `｜目标 X ${target.pos.x.toFixed(1)} / Z ${target.pos.z.toFixed(1)} · 水平距离 ${Math.hypot(target.pos.x - player.x, target.pos.z - player.z).toFixed(0)} 米 · 高差 ${signed(target.pos.y - player.y)} 米` : '');
    q('.wm-progress-text').textContent = `${atlas.percent.toFixed(1)}%`;
    q('progress').value = atlas.percent;
    q('.wm-discoveries').textContent = `已发现 ${atlas.discovered.size} 处 · 探索奖励 ${atlas.coins} 风铃币`;
    const full = atlas.pins.length >= PIN_LIMIT;
    q('[data-action="add-pin"]').disabled = full;
    q('[data-action="add-pin"]').setAttribute('aria-pressed', String(this.addingPin));
    q('[data-action="add-pin"]').textContent = this.addingPin ? '取消添加' : '＋ 添加标记';
    q('.wm-pin-status').textContent = this.addingPin ? '点击地形选择位置；拖动只平移，不会添加标记。' : full ? '标记 12 / 12 · 已达上限，请先删除一个。' : `标记 ${atlas.pins.length} / 12 · 仅用于导航`;
    this.canvas.classList.toggle('adding-pin', this.addingPin);
    this.renderDeliveries(); this.renderDetails(); this.renderList(); this.renderZoom();
  }
  renderDetails() {
    const q = selector => this.dialog.querySelector(selector), item = this.draft || this.selected(), player = this.game.flight.pos;
    const station = item && !this.draft && this.selection?.kind === 'station', count = station ? this.destinationCounts().get(item.id) || 0 : 0;
    q('.wm-detail-kind').textContent = station ? `■ 配送站点${count ? ` / ◆ 待送 ${count} 单` : ''}` : item ? `${KINDS[item.kind][0]} ${KINDS[item.kind][1]}${this.draft ? ' / 新标记' : ''}` : '地点详情';
    q('.wm-detail-name').textContent = item?.name || '选择一处地点';
    q('.wm-detail-description').textContent = station ? `可持续接单${count ? `，携带 ${count} 单送往此处` : ''}。` : item?.description || (item ? '记录位置，规划下一段航行。' : '点击地图符号或下方地点列表，查看距离与高度。');
    q('.wm-detail-coordinates').textContent = item ? `X ${item.pos.x.toFixed(1)} / Z ${item.pos.z.toFixed(1)}\n${station ? stationHeight(item) : `${item.pad ? '平台高度' : '位置高度'} ${item.pos.y.toFixed(2)} 米（世界 Y）`}\n水平距离 ${Math.hypot(item.pos.x - player.x, item.pos.z - player.z).toFixed(0)} 米 · 高差 ${signed(item.pos.y - player.y)} 米` : '';
    q('.wm-detail-warning').textContent = station && item.street ? groundArrival : item?.kind === 'pin' ? '自定义标记仅用于导航，不是停靠平台；高度来自此处地形 / 海面。' : station || item?.pad ? '请对准真实平台高度，勿降至下方地面。' : '';
    const tracked = station ? this.atlas.tracking?.kind === 'quest' && this.courier.target?.id === item.id : item?.id && this.atlas.tracking?.id === item.id && this.atlas.tracking?.kind === this.selection?.kind;
    q('[data-action="track"]').disabled = !item || !!this.draft || !!tracked;
    q('[data-action="track"]').textContent = tracked ? '正在追踪' : '追踪地点';
    q('[data-action="focus"]').disabled = !item || !!this.draft;
    q('.wm-pin-editor').hidden = item?.kind !== 'pin';
    q('[data-action="delete-pin"]').hidden = !!this.draft;
    q('[data-action="cancel-pin"]').hidden = !this.draft;
    q('[data-action="save-pin"]').textContent = this.draft ? '保存标记' : '保存名称';
    q('[data-action="save-pin"]').disabled = !!this.draft && this.atlas.pins.length >= PIN_LIMIT;
    const key = item?.kind === 'pin' ? this.draft ? 'draft' : item.id : null;
    if (key !== this.editorKey) { q('#wm-pin-name').value = item?.name || ''; this.editorKey = key; }
  }
  renderDeliveries() {
    const q = selector => this.dialog.querySelector(selector), stations = this.courier.stations || [], orders = this.courier.quest?.orders || [], counts = this.destinationCounts();
    const orderItems = orders.map(order => {
      const from = this.courier.stationById(order.from), to = this.courier.stationById(order.to);
      return { stationId: order.to, disabled: !to, name: `${order.parcel} → ${to?.name || order.to}`,
        details: `订单 ${order.id} · 来自 ${from?.name || order.from}${from?.spot ? `（${from.spot}）` : ''} · ${order.reward} 风铃币\n${to ? stationHeight(to) : '收件站点不可用'}` };
    });
    const stationItems = stations.map(station => ({ stationId: station.id, name: `■ ${station.name}`,
      details: `${stationHeight(station)}\n可接单${counts.has(station.id) ? ` · ◆ 待送 ${counts.get(station.id)} 单` : ''}` }));
    const signature = JSON.stringify([orderItems, stationItems]);
    if (signature !== this.deliverySignature) {
      this.deliveryRows = [];
      for (const [selector, items] of [['.wm-orders', orderItems], ['.wm-stations', stationItems]]) {
        const list = q(selector); list.replaceChildren();
        for (const item of items) {
          const button = document.createElement('button'), name = document.createElement('span'), details = document.createElement('small');
          button.type = 'button'; button.className = 'wm-delivery'; button.dataset.stationId = item.stationId; button.disabled = !!item.disabled;
          name.textContent = item.name; details.textContent = item.details;
          button.append(name, details); list.appendChild(button); this.deliveryRows.push(button);
        }
      }
      this.deliverySignature = signature;
    }
    for (const row of this.deliveryRows) row.setAttribute('aria-pressed', String(this.atlas.tracking?.kind === 'quest' && row.dataset.stationId === this.courier.target?.id));
    q('.wm-order-count').textContent = `${orders.length} 单`;
    q('.wm-station-count').textContent = `${stations.length} 处`;
    q('.wm-orders-empty').hidden = orders.length !== 0;
  }
  renderList() {
    const list = this.dialog.querySelector('.wm-places'), items = this.visibleItems();
    const signature = JSON.stringify(items.map(p => [p.id, p.kind, p.name]));
    if (signature !== this.listSignature) {
      list.replaceChildren(); this.rows = [];
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'wm-place'; button.dataset.id = item.id;
        button.dataset.kind = item.kind === 'pin' ? 'pin' : 'landmark';
        const symbol = document.createElement('span'), name = document.createElement('span'), kind = document.createElement('small');
        symbol.className = `wm-symbol wm-symbol-${item.kind}`; symbol.textContent = KINDS[item.kind][0]; symbol.setAttribute('aria-hidden', 'true');
        name.textContent = item.name; kind.textContent = KINDS[item.kind][1]; button.append(symbol, name, kind); list.appendChild(button); this.rows.push(button);
      }
      this.listSignature = signature;
    }
    for (const row of this.rows) row.setAttribute('aria-pressed', String(row.dataset.id === this.selection?.id && row.dataset.kind === this.selection?.kind));
    this.dialog.querySelector('.wm-list-heading .wm-count').textContent = String(items.length);
    this.dialog.querySelector('.wm-empty').hidden = items.length !== 0;
  }
}
