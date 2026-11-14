

/* ============================================================
   TouchControls — landscape on-screen driving controls.
   Buttons are plain DOM so they stay crisp and cheap to update.
   ============================================================ */
export class TouchControls {
  constructor(input, handlers = {}) {
    this.input = input;
    this.handlers = handlers;
    this.root = document.getElementById('touch-controls');
    this.rotate = document.getElementById('rotate-hint');
    this.pads = new Map();
    this.visible = false;
    this.isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      (navigator.maxTouchPoints || 0) > 0;
    if (!this.root) return;
    if (this.isTouch) document.body.classList.add('touch-mode');
    this._bind();
    this._bindSystem();
    this._syncOrientation();
    window.addEventListener('orientationchange', () => setTimeout(() => this._syncOrientation(), 120));
    window.addEventListener('resize', () => this._syncOrientation());
  }

  _bind() {
    const buttons = [...this.root.querySelectorAll('[data-touch]')];
    for (const btn of buttons) {
      const action = btn.dataset.touch;
      this.pads.set(btn, action);
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('active');
        try { btn.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
        this._set(action, 1);
      };
      const up = (e) => {
        if (e) e.stopPropagation();
        btn.classList.remove('active');
        this._set(action, 0);
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  _set(action, value) {
    const t = this.input.touch;
    if (action === 'left') t.left = value;
    else if (action === 'right') t.right = value;
    else if (action === 'throttle') t.throttle = value;
    else if (action === 'brake') t.brake = value;
    else if (action === 'handbrake') t.handbrake = value;
  }

  _bindSystem() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handlers.onUiSound?.();
        fn();
      });
    };
    on('touch-pause', () => this.handlers.onPause?.());
    on('touch-camera', () => this.handlers.onCamera?.());
    on('touch-recover', () => this.handlers.onRecover?.());
  }

  _syncOrientation() {
    if (!this.isTouch) return;
    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('portrait', portrait);
    if (this.rotate) this.rotate.classList.toggle('hidden', !portrait || !this.visible);
  }

  requestLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch { /* unsupported */ }
  }

  setVisible(visible) {
    this.visible = visible;
    if (!this.root) return;
    if (!this.isTouch) {
      this.root.classList.add('hidden');
      return;
    }
    this.root.classList.toggle('hidden', !visible);
    this._syncOrientation();
    if (!visible) {
      for (const action of ['left', 'right', 'throttle', 'brake', 'handbrake']) this._set(action, 0);
      for (const btn of this.pads.keys()) btn.classList.remove('active');
    }
  }

  setCameraLabel(label) {
    const el = document.getElementById('touch-camera');
    if (el) el.textContent = label || 'CAM';
  }
}
