import { clamp, damp } from './util.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.touch = { left: 0, right: 0, throttle: 0, brake: 0, handbrake: 0 };
    this.touchLookId = null;
    this.touchLast = { x: 0, y: 0 };
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.steer = 0;
    this.steerTarget = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.mouseLook = false;
    this.lookSens = 1;
    this.onPause = null;
    this.onReset = null;
    this.onMute = null;
    this.onHelp = null;
    this.onCamera = null;
    this.gamepadIndex = null;
    this.prevButtons = [];
    this.hasGamepad = false;
    this.gamepadLookActive = false;
    this.keyboardLookActive = false;

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys.clear(); });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        if (this.touchLookId !== null) return;
        this.touchLookId = e.pointerId;
        this.touchLast.x = e.clientX;
        this.touchLast.y = e.clientY;
        try { canvas.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        return;
      }
      if (e.button === 2) {
        this.mouseLook = true;
        try { canvas.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        canvas.style.cursor = 'grabbing';
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' && e.pointerId === this.touchLookId) {
        this.touchLookId = null;
        return;
      }
      if (e.button === 2) {
        this.mouseLook = false;
        canvas.style.cursor = '';
      }
    });
    canvas.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch') this.touchLookId = null;
      this.mouseLook = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId !== this.touchLookId) return;
        const dx = e.clientX - this.touchLast.x;
        const dy = e.clientY - this.touchLast.y;
        this.touchLast.x = e.clientX;
        this.touchLast.y = e.clientY;
        this.lookYaw = clamp(this.lookYaw - dx * 0.0045 * this.lookSens, -1.6, 1.6);
        this.lookPitch = clamp(this.lookPitch - dy * 0.0032 * this.lookSens, -0.4, 0.45);
        return;
      }
      if (!this.mouseLook) return;
      this.lookYaw = clamp(this.lookYaw - e.movementX * 0.0028 * this.lookSens, -1.5, 1.5);
      this.lookPitch = clamp(this.lookPitch - e.movementY * 0.0022 * this.lookSens, -0.38, 0.42);
    });

    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this.hasGamepad = true;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
      this.hasGamepad = false;
    });
  }

  _key(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    const el = e.target;
    const visibleForm = el && /INPUT|SELECT|TEXTAREA/.test(tag) && el.getClientRects().length > 0;
    if (visibleForm && e.code !== 'Escape') {
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (down) {
      if (e.repeat) return;
      if (e.code === 'Escape') { this.onPause?.(); return; }
      if (e.code === 'KeyR') { this.onReset?.(); return; }
      if (e.code === 'KeyM') { this.onMute?.(); return; }
      if (e.code === 'KeyH') { this.onHelp?.(); return; }
      if (e.code === 'KeyC') { this.onCamera?.(); return; }
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
  }

  _pollGamepad(dt) {
    if (!navigator.getGamepads) return null;
    let pad = null;
    if (this.gamepadIndex != null) pad = navigator.getGamepads()[this.gamepadIndex];
    if (!pad) {
      const pads = navigator.getGamepads();
      for (const p of pads) { if (p && p.connected) { pad = p; this.gamepadIndex = p.index; break; } }
    }
    if (!pad) return null;
    this.hasGamepad = true;
    const b = pad.buttons;
    const pressed = (i) => !!(b[i] && b[i].pressed);
    const just = (i) => pressed(i) && !this.prevButtons[i];
    if (just(9)) this.onPause?.();
    if (just(3)) this.onReset?.();
    if (just(8)) this.onMute?.();
    if (just(4)) this.onCamera?.();
    this.prevButtons = b.map((x) => x && x.pressed);
    const ax = Math.abs(pad.axes[0] || 0) > 0.12 ? pad.axes[0] : 0;
    const ay = Math.abs(pad.axes[1] || 0) > 0.12 ? pad.axes[1] : 0;
    const rx = Math.abs(pad.axes[2] || 0) > 0.15 ? pad.axes[2] : 0;
    const ry = Math.abs(pad.axes[3] || 0) > 0.15 ? pad.axes[3] : 0;
    return {
      steer: -ax,
      throttle: b[7] ? b[7].value : (pressed(0) ? 1 : 0),
      brake: b[6] ? b[6].value : (pressed(1) ? 1 : 0),
      handbrake: pressed(2) ? 1 : 0,
      lookYaw: rx,
      lookPitch: ry,
    };
  }

  update(dt) {
    const k = this.keys;
    let steerTarget = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) steerTarget += 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steerTarget -= 1;
    let throttle = (k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0;
    let brake = (k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0;
    let handbrake = k.has('Space') ? 1 : 0;
    const touch = this.touch;
    if (touch.left || touch.right) steerTarget = (touch.left ? 1 : 0) - (touch.right ? 1 : 0);
    if (touch.throttle) throttle = Math.max(throttle, touch.throttle);
    if (touch.brake) brake = Math.max(brake, touch.brake);
    if (touch.handbrake) handbrake = Math.max(handbrake, touch.handbrake);

    const gp = this._pollGamepad(dt);
    if (gp) {
      steerTarget = Math.abs(gp.steer) > 0.06 ? gp.steer : steerTarget;
      if (gp.throttle > 0.04) throttle = Math.max(throttle, gp.throttle);
      if (gp.brake > 0.04) brake = Math.max(brake, gp.brake);
      handbrake = Math.max(handbrake, gp.handbrake);
      this.lookYaw = clamp(this.lookYaw - gp.lookYaw * dt * 1.9 * this.lookSens, -1.5, 1.5);
      this.lookPitch = clamp(this.lookPitch - gp.lookPitch * dt * 1.3 * this.lookSens, -0.38, 0.42);
      this.gamepadLookActive = Math.abs(gp.lookYaw) + Math.abs(gp.lookPitch) > 0.05;
    } else {
      this.gamepadLookActive = false;
    }

    const lookKey = (k.has('KeyQ') ? 1 : 0) + (k.has('KeyE') ? -1 : 0);
    if (lookKey !== 0) {
      this.lookYaw = clamp(this.lookYaw + lookKey * dt * 1.75 * this.lookSens, -1.5, 1.5);
      this.keyboardLookActive = true;
    } else {
      this.keyboardLookActive = false;
    }

    this.steerTarget = steerTarget;
    this.steer = damp(this.steer, steerTarget, 16, dt);
    this.throttle = damp(this.throttle, throttle, 18, dt);
    this.brake = damp(this.brake, brake, 20, dt);
    this.handbrake = damp(this.handbrake, handbrake, 16, dt);

    // spring back when neither the mouse, touch, gamepad nor key is holding the view
    if (!this.mouseLook && this.touchLookId === null && !this.gamepadLookActive && !this.keyboardLookActive) {
      this.lookYaw = damp(this.lookYaw, 0, 5.5, dt);
      this.lookPitch = damp(this.lookPitch, 0, 5.5, dt);
    }
  }

  state() {
    return {
      throttle: this.throttle,
      brake: this.brake,
      handbrake: this.handbrake,
      steer: this.steerTarget,
    };
  }

  reset() {
    this.keys.clear();
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.steer = 0;
    this.steerTarget = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.mouseLook = false;
    this.gamepadLookActive = false;
    this.keyboardLookActive = false;
    this.touchLookId = null;
    this.touch.left = 0;
    this.touch.right = 0;
    this.touch.throttle = 0;
    this.touch.brake = 0;
    this.touch.handbrake = 0;
  }
}
