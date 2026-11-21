import { GameModal } from './dialogue.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const side = (w, h) => Math.max(1, Math.min(w, h));
const valid = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.z);
const COLORS = { player: '#fff8ec', target: '#ffd36b', pickup: '#a5dfba', destination: '#d5bd85' };

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

/** Owns only a 2D overlay; include world-map.css alongside the game's UI styles. */
export class WorldMap {
  constructor(game, courier) {
    this.game = game;
    this.courier = courier;
    this.world = game.terrain.meta.world;
    this.view = { x: 0, z: 0, span: this.world * 1.08 };
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'world-map';
    this.dialog.setAttribute('aria-label', '全岛航图');
    this.dialog.innerHTML = `<header class="wm-header"><div><p>驭风者的航行手记</p><h2>全岛航图</h2></div>
      <button type="button" data-action="close" autofocus aria-label="关闭地图，返回游戏">合上航图 <kbd>M</kbd></button></header>
      <p class="wm-order" aria-live="polite"></p>
      <div class="wm-surface"><canvas role="img" aria-label="全岛地图：上北下南，左西右东"></canvas>
        <span class="wm-north" aria-hidden="true">↑<br>北</span></div>
      <div class="wm-toolbar" role="group" aria-label="地图视图">
        <button type="button" data-action="all">全岛总览</button><button type="button" data-action="route">查看航线</button>
        <button type="button" data-action="player">回到玩家</button>
        <div class="wm-zoom"><button type="button" data-action="out" aria-label="缩小地图">−</button>
          <output aria-label="缩放倍数"></output><button type="button" data-action="in" aria-label="放大地图">+</button></div></div>
      <footer><div class="wm-legend"><span class="wm-player">▲ 玩家</span><span class="wm-target">◎ 当前目标</span>
        <span class="wm-pickup">■ 取件点</span><span class="wm-destination">◆ 收件点</span><span>· 城镇 / 建筑</span></div>
        <p class="wm-position"></p><p>拖动平移 · 滚轮缩放 · 航线仅供方向参考，请留意山体并降落在指定平台 · M / Esc 返回</p></footer>`;
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
    this.dialog.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'close') this.modal.close();
      else if (action === 'all') this.setView({ x: 0, z: 0, span: this.world * 1.08 });
      else if (action === 'route') this.setView(fitView(this.routePoints(), this.world, this.w, this.h));
      else if (action === 'player' && valid(game.flight.pos)) this.setView({ ...game.flight.pos, span: Math.min(this.view.span, this.world / 4) });
      else if (action === 'in' || action === 'out') this.zoom(action === 'in' ? 0.75 : 1 / 0.75, this.w / 2, this.h / 2);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.modal.isOpen || e.button !== 0 || this.drag) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.classList.add('dragging');
      e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      this.setView(panView(this.view, e.clientX - this.drag.x, e.clientY - this.drag.y, this.world, this.w, this.h));
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) this.canvas.addEventListener(event, (e) => {
      if (this.drag?.id === e.pointerId) this.endDrag();
    });
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.modal.isOpen) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1);
      this.zoom(Math.exp(clamp(delta * 0.0015, -0.7, 0.7)), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    this.dialog.addEventListener('close', () => this.endDrag());
    this.onBlur = () => this.endDrag();
    window.addEventListener('blur', this.onBlur);
    this.observer = new ResizeObserver(() => { if (this.modal.isOpen) this.render(); });
    this.observer.observe(this.canvas);
  }

  get isOpen() { return this.modal.isOpen; }
  open() {
    if (this.modal.isOpen || !this.modal.show()) return false;
    this.render(); // Fresh player/order data and layout, even on the very first open.
    this.courier.mapOpened?.();
    return true;
  }
  close() { this.modal.close(); }
  endDrag() {
    const id = this.drag?.id;
    this.drag = null;
    if (id !== undefined && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.canvas.classList.remove('dragging');
  }
  routePoints() {
    return [this.game.flight.pos, this.courier.pickup?.pos, this.courier.destination?.pos, this.courier.target?.pos].filter(valid);
  }
  setView(view) { this.view = boundView(view, this.world, this.w, this.h); this.render(); }
  zoom(factor, x, y) { this.setView(zoomView(this.view, factor, x, y, this.world, this.w, this.h)); }

  thumbnail() {
    const terrain = this.game.terrain;
    if (this.cachedTerrain === terrain && this.cachedWorld === this.world) return this.thumb;
    this.thumb = document.createElement('canvas');
    this.thumb.width = this.thumb.height = 256;
    const ctx = this.thumb.getContext('2d'), image = ctx.createImageData(256, 256), heights = new Float32Array(256 * 256);
    for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++)
      heights[z * 256 + x] = terrain.heightAt(((x + 0.5) / 256 - 0.5) * this.world, ((z + 0.5) / 256 - 0.5) * this.world);
    const sea = terrain.meta.sea ?? 0;
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i], elevation = clamp((h - sea) / 480, 0, 1);
      const shade = clamp((h - heights[Math.max(0, i - 256)]) * 0.6, -18, 18);
      const rgb = h <= sea ? [30, 59, 65] : [68 + elevation * 138 + shade, 94 + elevation * 101 + shade, 68 + elevation * 75 + shade];
      image.data.set([...rgb, 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
    this.cachedTerrain = terrain; this.cachedWorld = this.world;
    return this.thumb;
  }

  render() {
    if (!this.modal.isOpen) return; // Event-driven: no animation loop, including while closed.
    this.world = this.game.terrain.meta.world;
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width); this.h = Math.max(1, rect.height);
    this.view = boundView(this.view, this.world, this.w, this.h);
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    const c = this.ctx, w = this.w, h = this.h, v = this.view, scale = side(w, h) / v.span;
    const point = p => mapPoint(p, v, w, h), corner = point({ x: -this.world / 2, z: -this.world / 2 });
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#1e3b41'; c.fillRect(0, 0, w, h);
    c.drawImage(this.thumbnail(), corner.x, corner.y, this.world * scale, this.world * scale);
    c.strokeStyle = '#fff8ec19'; c.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      const p = point({ x: i * this.world / 4, z: i * this.world / 4 });
      c.beginPath(); c.moveTo(p.x, 0); c.lineTo(p.x, h); c.moveTo(0, p.y); c.lineTo(w, p.y); c.stroke();
    }
    for (const b of this.game.town?.buildings || []) {
      const p = point({ x: b.pos[0], z: b.pos[2] });
      c.fillStyle = '#dfd5b580'; c.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    const labels = [];
    const label = (text, x, y, color, anchor) => {
      c.font = '14px "LXGW WenKai", "PingFang SC", sans-serif';
      const original = text;
      while (text.length > 1 && c.measureText(text).width > Math.min(300, w - 30)) text = text.slice(0, -1);
      if (text !== original) text = text.slice(0, -1) + '…';
      const width = c.measureText(text).width;
      x = clamp(x, 8, Math.max(8, w - width - 8));
      const base = clamp(y, 18, h - 28);
      let found = false;
      for (let n = 0; n < 15; n++) {
        y = base + Math.ceil(n / 2) * (n % 2 ? -20 : 20);
        if (y < 18 || y > h - 28 || labels.some(b => x < b.x + b.w + 6 && x + width + 6 > b.x && Math.abs(y - b.y) < 19)) continue;
        found = true; break;
      }
      if (!found) return;
      if (anchor && Math.hypot(x - anchor.x, y - anchor.y) > 30) {
        c.beginPath(); c.strokeStyle = color; c.lineWidth = 1;
        c.moveTo(anchor.x, anchor.y); c.lineTo(clamp(anchor.x, x, x + width), y + 3); c.stroke();
      }
      labels.push({ x, y, w: width }); c.lineWidth = 4; c.strokeStyle = '#152e2c'; c.fillStyle = color;
      c.strokeText(text, x, y); c.fillText(text, x, y);
    };
    const line = (a, b, color) => {
      if (!valid(a) || !valid(b)) return;
      const p = point(a), q = point(b);
      c.beginPath(); c.setLineDash([7, 6]); c.strokeStyle = color; c.lineWidth = 2;
      c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke(); c.setLineDash([]);
    };
    const { pickup, destination, target, quest } = this.courier, player = this.game.flight.pos;
    line(pickup?.pos, destination?.pos, '#d5bd8580'); line(player, target?.pos, COLORS.target);
    const marker = (p, kind, text) => {
      if (!valid(p)) return;
      const raw = point(p), x = clamp(raw.x, 14, w - 14), y = clamp(raw.y, 14, h - 14);
      const off = x !== raw.x || y !== raw.y;
      c.save(); c.translate(x, y); c.fillStyle = COLORS[kind]; c.strokeStyle = '#152e2c'; c.lineWidth = 3; c.beginPath();
      if (kind === 'player') { c.rotate(this.game.flight.yaw || 0); c.moveTo(0, -11); c.lineTo(8, 8); c.lineTo(0, 4); c.lineTo(-8, 8); c.closePath(); }
      else if (kind === 'pickup') c.rect(-6, -6, 12, 12);
      else if (kind === 'destination') { c.moveTo(0, -8); c.lineTo(8, 0); c.lineTo(0, 8); c.lineTo(-8, 0); c.closePath(); }
      else { c.arc(0, 0, 11, 0, Math.PI * 2); c.stroke(); c.strokeStyle = COLORS.target; c.lineWidth = 3; c.stroke(); }
      if (kind !== 'target') { c.stroke(); c.fill(); }
      c.restore(); label(`${text}${off ? '（图外）' : ''}`, x + 16, y - 14, COLORS[kind], { x, y });
    };
    marker(target?.pos, 'target', `目标 · ${target?.name || '停靠点'}`);
    marker(player, 'player', '你在这里');
    if (pickup && pickup !== target) marker(pickup.pos, 'pickup', '取件点');
    if (destination && destination !== target) marker(destination.pos, 'destination', '收件点');
    for (const t of this.game.terrain.meta.towns || []) {
      const p = point(t);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      c.beginPath(); c.strokeStyle = '#fff8ec50'; c.lineWidth = 1; c.arc(p.x, p.y, Math.max(4, t.r * scale), 0, Math.PI * 2); c.stroke();
      label(t.name, p.x + 7, p.y + 22, '#f0e6cb');
    }
    const metres = 10 ** Math.floor(Math.log10(90 / scale)), length = metres * scale;
    c.strokeStyle = COLORS.player; c.lineWidth = 2; c.beginPath(); c.moveTo(16, h - 18); c.lineTo(16 + length, h - 18); c.stroke();
    c.font = '12px "PingFang SC", sans-serif'; c.fillStyle = COLORS.player; c.fillText(`${metres} 米`, 16, h - 25);
    const status = { available: '待取件', active: '配送中', completed: '订单已完成' }[quest?.status] || '自由航行';
    this.dialog.querySelector('.wm-order').textContent = target
      ? `${status} · 当前目标：${target.name} · ${target.spot || '停靠平台'}｜平台高度 ${target.pos.y.toFixed(2)} 米（世界 Y）；请对准平台，勿降至下方地面。`
      : `${status} · 暂无当前目标，自由探索全岛。`;
    this.dialog.querySelector('.wm-position').textContent = `玩家 X ${player.x.toFixed(1)} / Z ${player.z.toFixed(1)} · 高度 ${player.y.toFixed(2)} 米` +
      (target ? `｜目标 X ${target.pos.x.toFixed(1)} / Z ${target.pos.z.toFixed(1)} · 水平距离 ${Math.hypot(target.pos.x - player.x, target.pos.z - player.z).toFixed(0)} 米 · 高差 ${(target.pos.y - player.y).toFixed(2)} 米` : '');
    this.dialog.querySelector('output').textContent = `${(this.world * 1.08 / v.span).toFixed(1)}×`;
    this.dialog.querySelector('[data-action="in"]').disabled = v.span <= this.world / 24;
    this.dialog.querySelector('[data-action="out"]').disabled = v.span >= this.world * 1.08;
  }
}
