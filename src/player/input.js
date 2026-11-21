// Input: keyboard, pointer-lock mouse (sprung virtual stick), gamepad and touch, merged into one
// state. The brake doubles as the landing key: held it is the brake as ever, tapped twice inside
// DOUBLE_TAP ms it also posts 'Space2' to `pressed` (come in to land; see game/index.js).
const DOUBLE_TAP = 300;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.stickX = 0;   // mouse stick
    this.stickY = 0;
    this.touch = { x: 0, y: 0, boost: false, brake: false };   // virtual stick + buttons
    this.turn = 0;     // -1 left .. +1 right
    this.pitch = 0;    // -1 dive .. +1 climb
    this.boost = false;
    this.brake = false;
    this.invert = false;
    this.locked = false;
    this.enabled = false;
    this.pressed = new Set(); // edge-triggered keys, consumed by the game
    this.sens = 0.0021;
    this._tap = -1e9;         // when the brake was last tapped (ms)
    this._padBrake = false;   // gamepad buttons last step, for their edges
    this._padTrick = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'Space') this._tapBrake(e.timeStamp);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    canvas.addEventListener('click', () => { if (this.enabled && !this.locked) canvas.requestPointerLock?.()?.catch?.(() => {}); });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.stickX = Math.max(-1, Math.min(1, this.stickX + e.movementX * this.sens));
      this.stickY = Math.max(-1, Math.min(1, this.stickY + e.movementY * this.sens));
    });
    window.addEventListener('mousedown', (e) => { if (this.locked) { if (e.button === 0) this.mouseBoost = true; if (e.button === 2) { this.mouseBrake = true; this.pressed.add('Space'); this._tapBrake(e.timeStamp); } } });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseBoost = false; if (e.button === 2) this.mouseBrake = false; });
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    this._bindTouch();
  }

  /** The on-screen stick and buttons (shown only on touch screens; see main.js). */
  _bindTouch() {
    const $ = (id) => document.getElementById(id);
    const stick = $('stick'), nub = $('stickNub');
    if (!stick) return;
    let id = -1, cx = 0, cy = 0, R = 1;
    const centre = () => {
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2;
    };
    const move = (e) => {
      let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.touch.x = dx; this.touch.y = dy;
      nub.style.transform = `translate(${dx * R * 0.5}px, ${dy * R * 0.5}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId; stick.setPointerCapture(id); centre(); move(e); stick.classList.add('on');
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = -1; this.touch.x = 0; this.touch.y = 0;
      nub.style.transform = ''; stick.classList.remove('on');
    };
    stick.addEventListener('pointerup', up);
    stick.addEventListener('pointercancel', up);
    const hold = (el, set) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(true); el.classList.add('on'); });
      const off = () => { set(false); el.classList.remove('on'); };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };
    hold($('btnBoost'), (v) => { this.touch.boost = v; });
    // the brake button keeps the double-tap-to-land the keyboard has
    hold($('btnBrake'), (v) => {
      this.touch.brake = v;
      if (v) { this.pressed.add('Space'); this._tapBrake(performance.now()); }
    });
    $('btnCam').addEventListener('pointerdown', (e) => { e.preventDefault(); this.pressed.add('KeyC'); });
  }

  /** A tap of the brake at time t (ms): the second of two close together is a double tap. */
  _tapBrake(t) {
    if (t - this._tap < DOUBLE_TAP) { this.pressed.add('Space2'); this._tap = -1e9; } else this._tap = t;
  }

  take(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  update(dt) {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    // the mouse stick springs back to centre like a self-centring joystick
    const relax = Math.exp(-dt * 2.6);
    this.stickX *= relax; this.stickY *= relax;
    x += this.stickX * 1.6;
    y += -this.stickY * 1.6;
    // the touch stick reads straight off where the thumb sits
    x += this.touch.x * 1.35;
    y += -this.touch.y * 1.35;
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || !!this.mouseBoost || this.touch.boost;
    let brake = k.has('Space') || !!this.mouseBrake || this.touch.brake;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      x += dz(p.axes[0] || 0);
      y += -dz(p.axes[1] || 0);
      if (p.buttons[7]?.value > 0.3 || p.buttons[0]?.pressed) boost = true;
      const padBrake = p.buttons[6]?.value > 0.3 || !!p.buttons[1]?.pressed;
      if (padBrake) brake = true;
      // the same taps on a pad: brake twice to land (once to take off again), X or Y for the trick
      if (padBrake && !this._padBrake) { this.pressed.add('Space'); this._tapBrake(performance.now()); }
      this._padBrake = padBrake;
      const padTrick = !!(p.buttons[2]?.pressed || p.buttons[3]?.pressed);
      if (padTrick && !this._padTrick) this.pressed.add('KeyQ');
      this._padTrick = padTrick;
      break;
    }
    if (this.invert) y = -y;
    this.turn = Math.max(-1, Math.min(1, x));
    this.pitch = Math.max(-1, Math.min(1, y));
    this.boost = boost;
    this.brake = brake;
    if (!this.enabled) { this.turn = 0; this.pitch = 0; this.boost = false; this.brake = false; }
  }
}
