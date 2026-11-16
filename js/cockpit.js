import { clamp, formatTime } from './util.js';

const AMBER = '#f2c43a';
const CREAM = '#efe9d7';
const MUTED = '#8d948b';
const RED = '#e14b33';
const TEAL = '#7fbcb0';
const DARK = '#0b100e';
const PANEL = '#111813';

function rr(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function crispText(ctx, text, x, y, size, color, weight = 600, align = 'left', family = 'Barlow Condensed') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "${family}", "Barlow Condensed", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function importantText(ctx, text, x, y, size, color, align = 'left') {
  crispText(ctx, text, x, y, size, color, 400, align, 'Share Tech Mono');
}

export class Cockpit {
  constructor({ track, stage, car, settings }) {
    this.track = track;
    this.stage = stage;
    this.car = car;
    this.settings = settings;
    this.modern = car.interior === 'modern' || car.style?.modern === true;
    this.model = null;
    this.acc = 0;
    this.frame = 0;
    this.speechPulse = 0;
    this.radioActive = false;
    this.wiperPhase = 0;
    this.lastNoteId = -1;
    this.lastHazard = '';
    this.timerAcc = 0;
    this.current = null;
    this.mapBase = this._buildMapBase();
    this.gaugeGlow = 0;
    this.nextUpPulse = 0;
    this.auxScreen = 0;
    this.speedUnit = settings.units === 'mph' ? 'MPH' : 'KM/H';
    this.acc = 1;
  }

  attach(model) {
    this.model = model;
    // hide map screens if interior disabled? assumed visible
    this._drawAll({
      speedKph: 0, rpm: 900, gear: 1, throttle: 0, brake: 0, steer: 0,
      time: 0, best: null, progress: 0, info: null, notes: [], next: null,
      hazardAhead: null, radio: false, heading: 0, pos: null, coDriverSpeaking: 0,
    });
  }

  _buildMapBase() {
    const modern = this.modern;
    const canvas = document.createElement('canvas');
    canvas.width = 760; canvas.height = 560;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = modern ? '#0a1117' : '#0c120f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // subtle grid
    ctx.strokeStyle = modern ? 'rgba(143,171,187,.06)' : 'rgba(120,140,115,.055)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 760; x += 38) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 560); ctx.stroke();
    }
    for (let y = 0; y < 560; y += 38) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(760, y); ctx.stroke();
    }
    const map = this.track.map;
    if (this.track.endless) return canvas;
    const px = (u) => 34 + u * 692;
    const py = (v) => 34 + v * 492;
    // hazard colored segments
    for (const h of this.track.hazardPatches) {
      ctx.strokeStyle = h.color;
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 23;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const a = this.track.samples[h.start].i;
      const b = this.track.samples[h.end].i;
      for (let i = a; i <= b; i += 2) {
        const [u, v] = map.pts[i];
        if (i === a) ctx.moveTo(px(u), py(v)); else ctx.lineTo(px(u), py(v));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // route shadow
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    map.pts.forEach(([u, v], i) => {
      if (i === 0) ctx.moveTo(px(u), py(v)); else ctx.lineTo(px(u), py(v));
    });
    ctx.stroke();
    ctx.strokeStyle = modern ? '#5b7d90' : '#78856f';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = modern ? 'rgba(212,228,238,.3)' : 'rgba(198,207,190,.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // start/finish
    const s0 = map.pts[0];
    const s1 = map.pts[map.pts.length - 1];
    ctx.fillStyle = '#e8e3d2';
    ctx.fillRect(px(s0[0]) - 8, py(s0[1]) - 8, 16, 16);
    ctx.fillStyle = '#0b100e';
    ctx.fillRect(px(s0[0]) - 4, py(s0[1]) - 4, 8, 8);
    ctx.save();
    ctx.translate(px(s1[0]), py(s1[1]));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#e8e3d2' : '#1c211b';
        ctx.fillRect(-10 + i * 5, -10 + j * 5, 5, 5);
      }
    }
    ctx.restore();
    // labels
    crispText(ctx, 'STAGE ROUTE', 34, 555, 16, 'rgba(160,172,150,.55)', 600);
    ctx.textAlign = 'right';
    crispyText(ctx, this.stage.ss, 726, 555, 18, 'rgba(160,172,150,.55)', 700, 'right');
    return canvas;
  }

  update(dt, state, model) {
    this.current = state;
    if (!model) return;
    this.model = model;
    const t = performance.now() / 1000;

    // high-rate cockpit animation
    const steer = state.steer || 0;
    model.steering.rotation.z = -steer * 2.35;
    const gear = state.gear || 1;
    model.gearLever.rotation.x = -0.06 + (Math.min(gear, 6) - 1) * 0.045;
    model.handbrake.rotation.x = -0.03 - (state.handbrake || 0) * 0.33;

    // co-driver life
    if (model.coDriver) {
      const bob = Math.sin(t * 11) * 0.0025 * (0.4 + (state.speedKph || 0) / 180);
      model.coDriver.position.y = 0.37 + bob;
      const speak = state.coDriverSpeaking || 0;
      model.coDriverHead.rotation.y = 0.55 + Math.sin(t * 0.7) * 0.06 + speak * 0.12;
      model.coDriverHead.rotation.x = -0.04 + Math.sin(t * 0.9) * 0.025 + speak * 0.06;
      model.coDriverHead.rotation.z = Math.sin(t * 1.2) * 0.02;
      if (model.coDriverNotebook) {
        model.coDriverNotebook.rotation.z = Math.sin(t * 0.6) * 0.02;
      }
    }
    // wipers when wet
    if (model.wipers) {
      const wet = this.stage.env.wipers ?? (this.stage.env.weather !== 'none');
      if (wet) {
        this.wiperPhase += dt * 2.0;
        const sweep = (Math.sin(this.wiperPhase) * 0.5 + 0.5);
        const active = this.wiperPhase % 6 < 3.8;
        for (const w of model.wipers) {
          w.pivot.rotation.z = w.side * (0.1 + (active ? sweep : 0) * 1.15);
        }
      }
    }

    this.acc += dt;
    if (this.acc >= 0.1) {
      this.acc = 0;
      // The trip-computer map stays at 10 Hz; the two smaller screens alternate
      // at 5 Hz. That halves texture uploads without making the dash feel dead.
      this._drawNav(state);
      if (this.auxScreen++ % 2 === 0) this._drawGauge(state);
      else this._drawPace(state);
    }
  }

  _drawAll(state) {
    if (!this.model) return;
    this._drawGauge(state);
    this._drawNav(state);
    this._drawPace(state);
  }

  _screenReady(s) {
    return s && s.ctx;
  }

  _accentHex() {
    const n = this.car.accent || 0xd9c9a3;
    return n > 0x777777 ? '#' + n.toString(16).padStart(6, '0') : '#d9c9a3';
  }

  /* ============================================================
     NAV / MAP SCREEN
     ============================================================ */
  _drawNav(state) {
    const s = this.model.screens.nav;
    if (!this._screenReady(s)) return;
    const c = s.canvas;
    const ctx = s.ctx;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    // background
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#0b110e');
    bgGrad.addColorStop(0.6, '#0e1511');
    bgGrad.addColorStop(1, '#0a0f0c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // header
    const accent = this.modern ? this._accentHex() : AMBER;
    ctx.fillStyle = this.modern ? '#0f171e' : '#141d16';
    ctx.fillRect(0, 0, W, 70);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 5, 70);
    crispText(ctx, this.modern
      ? `NAVIGATION  ·  ${this.stage.name}`
      : `${this.stage.endless ? '∞' : this.stage.ss}  ${this.stage.name}`,
    24, 46, 34, CREAM, 700);
    ctx.textAlign = 'right';
    const gearTxt = (state.gear === 0 ? 'R' : String(state.gear || 1));
    const speedTxt = String(Math.round(state.speedKph || 0));
    const spdUnit = this.settings.units === 'mph' ? 'MPH' : 'KM/H';
    crispText(ctx, 'GEAR / SPEED', 1000, 28, 13, MUTED, 600, 'right');
    importantText(ctx, `${gearTxt}  ·  ${speedTxt} ${spdUnit}`, 1000, 56, 27, TEAL, 'right');
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(200,210,190,.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 70); ctx.lineTo(W, 70); ctx.stroke();

    // map area
    const mapW = 660, mapH = 450;
    const progress = state.progress || 0;
    ctx.save();
    // route
    ctx.globalAlpha = 0.45;
    ctx.drawImage(this.mapBase, 20, 88, mapW, mapH);
    ctx.globalAlpha = 1;
    if (this.track.endless) {
      this._drawEndlessNav(ctx, state, 20, 88, mapW, mapH);
    } else {
      const map = this.track.map;
      const px = (u) => 20 + (34 + u * 692) / 760 * mapW;
      const py = (v) => 88 + (34 + v * 492) / 560 * mapH;

      // completed route overlay
      const n = this.track.samples.length;
      const carI = Math.floor(progress * (n - 1));
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = this.modern ? this._accentHex() : 'rgba(242,196,58,.9)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      for (let i = 0; i <= carI; i += 2) {
        const [u, v] = map.pts[i];
        if (i === 0) ctx.moveTo(px(u), py(v)); else ctx.lineTo(px(u), py(v));
      }
      ctx.stroke();
      // next note marker
      if (state.next) {
        const ns = this.track.samples[state.next.index];
        const [u, v] = map.pts[ns.i];
        const mx = px(u), my = py(v);
        this.nextUpPulse = (this.nextUpPulse + 0.15) % (Math.PI * 2);
        const pulse = 1 + Math.sin(this.nextUpPulse) * 0.12;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.PI / 4);
        const markerCol = this.modern ? this._accentHex() : AMBER;
        ctx.strokeStyle = markerCol;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-8 * pulse, -8 * pulse, 16 * pulse, 16 * pulse);
        ctx.restore();
        crispText(ctx, `${Math.max(0, Math.round(state.next.dist - (state.dist || 0)))}m`,
          mx + 14, my - 12, 17, markerCol, 600);
      }
      // car marker
      if (state.pos) {
        const [u, v] = this.track.mapTransform(state.pos.x, state.pos.z);
        const cx = px(u), cy = py(v);
        const hd = state.heading || 0;
        const dx = Math.sin(hd), dz = Math.cos(hd);
        const size = 14;
        const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 28);
        glow.addColorStop(0, 'rgba(242,196,58,.5)');
        glow.addColorStop(1, 'rgba(242,196,58,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = this.modern ? this._accentHex() : '#f2c43a';
        ctx.strokeStyle = '#10140f';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx + dx * size, cy + dz * size);
        ctx.lineTo(cx + dz * size * 0.58 - dx * size * 0.5, cy - dx * size * 0.58 - dz * size * 0.5);
        ctx.lineTo(cx - dz * size * 0.58 - dx * size * 0.5, cy + dx * size * 0.58 - dz * size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    // route labels
    crispText(ctx, this.track.endless ? 'ENDLESS ROUTE' : 'SS ROUTE', 36, 120, 16, 'rgba(170,182,160,.55)', 600);
    ctx.textAlign = 'right';
    crispText(ctx, this.track.endless
      ? `${((state.dist || 0) / 1000).toFixed(2)} KM RUN`
      : `${(this.track.length / 1000).toFixed(2)} KM`, 656, 120, 16, 'rgba(170,182,160,.55)', 600, 'right');
    ctx.textAlign = 'left';
    ctx.restore();

    // right info panel
    const px0 = 710, pw = 288;
    ctx.fillStyle = this.modern ? '#0e161d' : '#101812';
    rr(ctx, px0, 90, pw, 460, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,210,190,.14)';
    ctx.stroke();
    crispText(ctx, state.endless ? 'RUN TIME' : 'STAGE TIME', px0 + 20, 122, 15, MUTED, 600);
    importantText(ctx, formatTime(state.time || 0), px0 + 20, 178, 47, CREAM);
    // best / furthest
    if (state.endless) {
      crispText(ctx, 'FURTHEST', px0 + 20, 214, 14, MUTED, 600);
      importantText(ctx, state.bestDistance ? `${(state.bestDistance / 1000).toFixed(2)} KM` : '-- KM',
        px0 + 20, 242, 25, state.bestDistance ? TEAL : 'rgba(150,160,145,.4)');
    } else {
      crispText(ctx, 'BEST', px0 + 20, 214, 14, MUTED, 600);
      importantText(ctx, state.best ? formatTime(state.best) : '--:--.--', px0 + 20, 242, 25,
        state.best ? TEAL : 'rgba(150,160,145,.4)');
    }
    // progress bar
    const barY = 272;
    const barProgress = state.endless ? ((state.dist || 0) % 1000) / 1000 : progress;
    ctx.fillStyle = 'rgba(180,195,170,.13)';
    rr(ctx, px0 + 20, barY, pw - 40, 10, 5); ctx.fill();
    ctx.fillStyle = AMBER;
    rr(ctx, px0 + 20, barY, Math.max(4, (pw - 40) * clamp(barProgress, 0, 1)), 10, 5); ctx.fill();
    crispText(ctx, state.endless ? 'DISTANCE RUN' : 'DISTANCE', px0 + 20, 310, 14, MUTED, 600);
    importantText(ctx, state.endless
      ? `${((state.dist || 0) / 1000).toFixed(2)} KM`
      : `${((1 - progress) * this.track.length / 1000).toFixed(2)} KM`,
      px0 + 20, 336, 27, CREAM);
    // surface
    const offRoad = !!(state.info && state.info.offRoad);
    const surface = offRoad ? 'OFF STAGE' : state.info ? state.info.surfaceName : this.track.env.surfaceName;
    const grip = state.info ? state.info.grip * (offRoad ? 0.6 : 1) : this.track.stage.baseGrip;
    crispText(ctx, 'SURFACE / GRIP', px0 + 20, 376, 14, MUTED, 600);
    crispText(ctx, surface, px0 + 20, 400, 23,
      offRoad || (state.info && state.info.hazard) ? '#f0a84c' : CREAM, 700);
    // grip bars
    for (let i = 0; i < 10; i++) {
      const filled = i < Math.round(clamp(grip / 0.9, 0, 1) * 10);
      ctx.fillStyle = filled
        ? (grip > 0.65 ? '#9fbc70' : grip > 0.45 ? AMBER : RED)
        : 'rgba(180,195,170,.12)';
      ctx.fillRect(px0 + 20 + i * 25, 416, 19, 11);
    }
    // hazard
    crispText(ctx, 'ROAD STATUS', px0 + 20, 464, 14, MUTED, 600);
    let status = 'CLEAR';
    let statusColor = '#9fbc70';
    if (state.info && state.info.offRoad) { status = 'OFF STAGE'; statusColor = RED; }
    else if (state.hazardAhead) { status = `${state.hazardAhead.label} AHEAD`; statusColor = '#f0a84c'; }
    else if (state.info && state.info.hazard) { status = state.info.hazardLabel; statusColor = '#f0a84c'; }
    crispText(ctx, status, px0 + 20, 491, 20, statusColor, 700);
    if (state.hazardAhead) {
      crispText(ctx, `${Math.max(0, Math.round(state.hazardAhead.ahead))} m`, px0 + pw - 20, 491, 18, statusColor, 600, 'right');
    }
    // radio wave footer
    ctx.fillStyle = '#0a100c';
    rr(ctx, px0 + 20, 508, pw - 40, 28, 5); ctx.fill();
    ctx.fillStyle = state.radio ? RED : 'rgba(180,195,170,.3)';
    ctx.beginPath(); ctx.arc(px0 + 34, 522, 4, 0, Math.PI * 2); ctx.fill();
    crispText(ctx, state.radio ? 'RADIO OPEN' : 'RADIO STANDBY', px0 + 46, 528, 15,
      state.radio ? '#e7c9b8' : 'rgba(170,182,160,.5)', 600);
    if (state.radio) {
      for (let i = 0; i < 9; i++) {
        const h = 3 + Math.abs(Math.sin(performance.now() * 0.012 + i * 0.7)) * 9;
        ctx.fillStyle = AMBER;
        ctx.fillRect(px0 + pw - 108 + i * 8, 522 - h / 2, 4, h);
      }
    }

    // scanline sheen
    ctx.fillStyle = 'rgba(255,255,255,.015)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    // frame
    ctx.strokeStyle = 'rgba(220,230,210,.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    if (s.present) s.present(); else s.tex.needsUpdate = true;
  }

  _drawEndlessNav(ctx, state, x, y, w, h) {
    const track = this.track;
    if (!track.samples || !track.samples.length) return;
    const dist = state.dist || 0;
    const step = track.step || 1.7;
    const iC = clamp(Math.round(dist / step), 0, track.n - 1);
    const i0 = Math.max(0, iC - 100);
    const i1 = Math.min(track.n - 1, iC + 390);
    const idxs = [];
    for (let i = i0; i <= i1; i += 2) idxs.push(i);
    if (idxs[idxs.length - 1] !== i1) idxs.push(i1);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const i of idxs) {
      const p = track.samples[i].pos;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const spanX = Math.max(12, maxX - minX);
    const spanZ = Math.max(12, maxZ - minZ);
    const pad = 22;
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    const ox = x + (w - spanX * scale) / 2;
    const oy = y + (h - spanZ * scale) / 2;
    const proj = (px, pz) => [ox + (px - minX) * scale, oy + (pz - minZ) * scale];

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, y + 2, w - 4, h - 4);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // hazard sections visible on this local map
    for (const hazard of track.hazardPatches) {
      if (hazard.end < i0 || hazard.start > i1) continue;
      ctx.strokeStyle = hazard.color || AMBER;
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = 20;
      ctx.beginPath();
      let started = false;
      for (let i = Math.max(hazard.start, i0); i <= Math.min(hazard.end, i1); i += 2) {
        const p = track.samples[i].pos;
        const [mx, my] = proj(p.x, p.z);
        if (!started) { ctx.moveTo(mx, my); started = true; } else ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // route body
    ctx.strokeStyle = 'rgba(0,0,0,.58)';
    ctx.lineWidth = 15;
    ctx.beginPath();
    idxs.forEach((i, k) => {
      const p = track.samples[i].pos;
      const [mx, my] = proj(p.x, p.z);
      if (k === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
    });
    ctx.stroke();
    ctx.strokeStyle = '#78856f';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(198,207,190,.28)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // side-road forks on the local map
    if (track.roadNetwork) {
      ctx.strokeStyle = 'rgba(128,141,118,.72)';
      ctx.lineWidth = 3.4;
      for (const road of track.roadNetwork.roads) {
        if (road.dist1 < track.samples[i0].dist - 40 || road.dist0 > track.samples[i1].dist + 40) continue;
        ctx.beginPath();
        road.samples.forEach((smp, k) => {
          const [mx, my] = proj(smp.pos.x, smp.pos.z);
          if (k === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
        });
        ctx.stroke();
      }
    }

    // the part already driven
    ctx.strokeStyle = 'rgba(242,196,58,.85)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    let started = false;
    for (let i = i0; i <= iC; i += 2) {
      const p = track.samples[i].pos;
      const [mx, my] = proj(p.x, p.z);
      if (!started) { ctx.moveTo(mx, my); started = true; } else ctx.lineTo(mx, my);
    }
    ctx.stroke();

    // next pacenote marker
    if (state.next && state.next.index != null) {
      const ns = track.samples[clamp(state.next.index, 0, track.n - 1)];
      const [mx, my] = proj(ns.pos.x, ns.pos.z);
      this.nextUpPulse = (this.nextUpPulse + 0.15) % (Math.PI * 2);
      const pulse = 1 + Math.sin(this.nextUpPulse) * 0.12;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.PI / 4);
      const markerCol = this.modern ? this._accentHex() : AMBER;
      ctx.strokeStyle = markerCol;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-8 * pulse, -8 * pulse, 16 * pulse, 16 * pulse);
      ctx.restore();
      crispText(ctx, `${Math.max(0, Math.round(state.next.dist - dist))}m`,
        mx + 14, my - 12, 17, markerCol, 600);
    }

    // car marker
    if (state.pos) {
      const [cx, cy] = proj(state.pos.x, state.pos.z);
      const hd = state.heading || 0;
      const dx = Math.sin(hd), dz = Math.cos(hd);
      const size = 15;
      const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 30);
      glow.addColorStop(0, 'rgba(242,196,58,.5)');
      glow.addColorStop(1, 'rgba(242,196,58,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = this.modern ? this._accentHex() : '#f2c43a';
      ctx.strokeStyle = '#10140f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + dx * size, cy + dz * size);
      ctx.lineTo(cx + dz * size * 0.58 - dx * size * 0.5, cy - dx * size * 0.58 - dz * size * 0.5);
      ctx.lineTo(cx - dz * size * 0.58 - dx * size * 0.5, cy + dx * size * 0.58 - dz * size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(220,230,210,.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
  }

  /* ============================================================
     PACENOTE / RADIO SCREEN
     ============================================================ */
  _drawPace(state) {
    const s = this.model.screens.pace;
    if (!this._screenReady(s)) return;
    const c = s.canvas;
    const ctx = s.ctx;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b100d';
    ctx.fillRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, 'rgba(28,38,28,.75)');
    bg.addColorStop(1, 'rgba(8,12,9,.95)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // header
    ctx.fillStyle = '#182019';
    ctx.fillRect(0, 0, W, 68);
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, 7, 68);
    ctx.fillStyle = state.radio ? RED : '#374137';
    ctx.beginPath(); ctx.arc(28, 34, 7, 0, Math.PI * 2); ctx.fill();
    if (state.radio) {
      ctx.strokeStyle = 'rgba(225,75,51,.5)';
      ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.arc(28, 34, 8 + i * 5 + (performance.now() * 0.01 % 5), 0, Math.PI * 2); ctx.stroke();
      }
    }
    crispText(ctx, 'CO-DRIVER / RADIO', 48, 42, 25, CREAM, 700);
    ctx.textAlign = 'right';
    ctx.fillStyle = state.radio ? RED : 'rgba(170,182,160,.5)';
    ctx.font = '600 15px "Barlow", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(state.radio ? 'CHANNEL OPEN' : 'CHANNEL 1', W - 22, 40);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(200,210,190,.12)';
    ctx.beginPath(); ctx.moveTo(0, 68); ctx.lineTo(W, 68); ctx.stroke();

    const next = state.next;
    const dist = next ? Math.max(0, next.dist - (state.dist || 0)) : 0;

    // left icon zone
    const iconCX = 220;
    const iconCY = 320;
    ctx.save();
    // icon backdrop
    ctx.fillStyle = 'rgba(235,231,214,.035)';
    rr(ctx, 28, 100, 384, 372, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(235,231,214,.08)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (next) {
      if (next.kind === 'turn' || next.kind === 'hairpin') {
        this._drawTurnArrow(ctx, iconCX, iconCY, next.dir, next.severity, next.kind === 'hairpin');
      } else if (next.kind === 'hazard') {
        this._drawWarning(ctx, iconCX, iconCY);
      } else if (next.kind === 'crest' || next.kind === 'jump') {
        this._drawCrest(ctx, iconCX, iconCY, next.kind === 'jump');
      } else if (next.kind === 'finish') {
        this._drawFinish(ctx, iconCX, iconCY);
      } else {
        this._drawStraight(ctx, iconCX, iconCY);
      }
    }

    // severity badge or warning glyph
    if (next) {
      if (next.kind === 'turn' || next.kind === 'hairpin') {
        ctx.fillStyle = next.severity <= 2 ? RED : next.severity <= 4 ? AMBER : CREAM;
        ctx.beginPath();
        ctx.arc(356, 170, 46, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#11140f';
        ctx.font = '700 66px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(next.kind === 'hairpin' ? 'H' : String(next.severity), 356, 174);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
      }
    }

    // right text zone
    if (next) {
      const title = next.text || '';
      const titleSize = title.length > 12 ? 64 : 82;
      const distText = next.kind === 'finish' ? 'END OF STAGE' : `${Math.round(dist / 5) * 5} m`;
      importantText(ctx, distText, 452, 148, next.kind === 'finish' ? 34 : 44, TEAL);
      crispText(ctx, title, 452, 264, titleSize, CREAM, 700);
      if (next.modifier) {
        crispText(ctx, next.modifier, 452, 316, 38, AMBER, 700);
      }
      // secondary upcoming
      crispText(ctx, 'NEXT', 452, 388, 16, MUTED, 600);
      if (state.notes && state.notes[1]) {
        const n2 = state.notes[1];
        crispText(ctx, n2.text, 452, 423, 28, 'rgba(235,231,214,.75)', 600);
        ctx.textAlign = 'right';
        crispText(ctx, `${Math.round(n2.dist - (state.dist || 0))} m`, W - 28, 423, 22, 'rgba(160,175,150,.6)', 600, 'right');
        ctx.textAlign = 'left';
      } else {
        crispText(ctx, '—', 452, 423, 28, 'rgba(235,231,214,.3)', 400);
      }
    } else {
      crispText(ctx, 'STAGE CLEAR', 452, 250, 64, CREAM, 700);
    }

    // footer status
    ctx.fillStyle = '#101812';
    ctx.fillRect(0, 500, W, 140);
    ctx.fillStyle = 'rgba(200,210,190,.12)';
    ctx.fillRect(0, 500, W, 1);

    const offRoad = !!(state.info && state.info.offRoad);
    const surface = offRoad ? 'OFF STAGE' : state.info ? state.info.surfaceName : this.track.env.surfaceName;
    const grip = state.info ? state.info.grip * (offRoad ? 0.6 : 1) : this.track.stage.baseGrip;
    const gripPct = Math.round(clamp(grip / 0.9, 0, 1) * 100);
    crispText(ctx, 'ROAD', 34, 540, 16, MUTED, 600);
    crispText(ctx, surface, 34, 572, 30, offRoad ? RED : CREAM, 700);
    // grip meter
    ctx.fillStyle = 'rgba(180,195,170,.15)';
    rr(ctx, 34, 592, 300, 14, 7); ctx.fill();
    const gc = grip > 0.65 ? '#9fbc70' : grip > 0.45 ? AMBER : RED;
    ctx.fillStyle = gc;
    rr(ctx, 34, 592, Math.max(6, 300 * clamp(grip / 0.9, 0, 1)), 14, 7); ctx.fill();
    importantText(ctx, `${gripPct}%`, 350, 605, 22, gc);

    if (state.hazardAhead) {
      this._drawHazardChip(ctx, 470, 520, state.hazardAhead);
    } else if (state.info && state.info.hazard) {
      this._drawHazardChip(ctx, 470, 520, {
        label: state.info.hazardLabel, color: '#f0a84c', ahead: 0,
      });
    } else {
      crispText(ctx, 'NO HAZARDS REPORTED', 470, 556, 21, 'rgba(160,175,150,.55)', 600);
    }

    // scanlines and frame
    ctx.fillStyle = 'rgba(255,255,255,.015)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    ctx.strokeStyle = 'rgba(220,230,210,.09)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    if (s.present) s.present(); else s.tex.needsUpdate = true;
  }

  _drawHazardChip(ctx, x, y, h) {
    ctx.fillStyle = 'rgba(240,168,76,.12)';
    rr(ctx, x, y, 450, 108, 8); ctx.fill();
    ctx.strokeStyle = h.color || '#f0a84c';
    ctx.lineWidth = 2;
    rr(ctx, x, y, 450, 108, 8); ctx.stroke();
    ctx.fillStyle = h.color || '#f0a84c';
    ctx.beginPath();
    ctx.moveTo(x + 38, y + 28);
    ctx.lineTo(x + 62, y + 72);
    ctx.lineTo(x + 14, y + 72);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#13160f';
    ctx.font = '700 28px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', x + 38, y + 64);
    ctx.textAlign = 'left';
    crispText(ctx, h.label || 'HAZARD', x + 82, y + 50, 28, '#f4c99a', 700);
    if (h.ahead != null) {
      importantText(ctx, `${Math.max(0, Math.round(h.ahead))} m`, x + 82, y + 84, 23, TEAL);
    }
  }

  _drawTurnArrow(ctx, cx, cy, dir, severity, hairpin) {
    const color = severity <= 2 ? RED : severity <= 4 ? AMBER : CREAM;
    const mirror = dir > 0 ? -1 : 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(mirror, 1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 28;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const sharp = hairpin ? 1.55 : (6 - severity) * 0.2 + 0.22;
    ctx.beginPath();
    ctx.moveTo(0, 96);
    ctx.bezierCurveTo(4, 20, -70 * sharp, 0, -116 * sharp, -6);
    ctx.stroke();
    // arrow head
    ctx.save();
    ctx.translate(-116 * sharp, -6);
    ctx.rotate(-0.08);
    ctx.beginPath();
    ctx.moveTo(-38, -34);
    ctx.lineTo(8, 0);
    ctx.lineTo(-38, 34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (hairpin) {
      ctx.strokeStyle = 'rgba(225,75,51,.7)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(2, 42, 64, 0.2, 4.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawWarning(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(240,168,76,.12)';
    ctx.beginPath(); ctx.arc(0, 0, 130, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(0, -110);
    ctx.lineTo(120, 98);
    ctx.lineTo(-120, 98);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#11140f';
    ctx.font = '700 150px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 0, 72);
    ctx.restore();
  }

  _drawCrest(ctx, cx, cy, jump) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-150, 90);
    ctx.lineTo(-90, -10);
    ctx.quadraticCurveTo(-55, -62, -12, 20);
    ctx.quadraticCurveTo(35, 85, 95, 28);
    ctx.lineTo(155, -20);
    ctx.stroke();
    if (jump) {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.moveTo(-180, 112);
      ctx.quadraticCurveTo(0, -20, 180, 92);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = AMBER;
      ctx.font = '700 54px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AIR', 0, 158);
    }
    ctx.restore();
  }

  _drawStraight(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = CREAM;
    ctx.fillStyle = CREAM;
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 112); ctx.lineTo(0, -74); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -112); ctx.lineTo(-42, -54); ctx.lineTo(42, -54); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawFinish(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(-90, 100); ctx.lineTo(-90, -110);
    ctx.moveTo(90, 100); ctx.lineTo(90, -110);
    ctx.stroke();
    const s = 30;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 5; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#e9e4d3' : '#1b2019';
        ctx.fillRect(-90 + i * s, -110 + j * s, s, s);
      }
    }
    ctx.restore();
  }

  /* ============================================================
     GAUGES
     ============================================================ */
  _drawGauge(state) {
    if (this.modern) {
      this._drawModernGauge(state);
      return;
    }
    const s = this.model.screens.gauge;
    if (!this._screenReady(s)) return;
    const ctx = s.ctx;
    const W = s.canvas.width, H = s.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#090c0a';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(30,37,29,.9)');
    g.addColorStop(1, 'rgba(8,11,9,.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const speedMax = this.settings.units === 'mph' ? 165 : 260;
    const speed = this.settings.units === 'mph' ? (state.speedKph || 0) * 0.621371 : (state.speedKph || 0);
    this.speedUnit = this.settings.units === 'mph' ? 'MPH' : 'KM/H';
    const rpm = state.rpm || 900;
    const gear = state.gear || 1;

    this._dial(ctx, 250, 232, 150, rpm, 0, 9000, {
      redline: 7500, major: 1000, label: 'RPM', unit: 'x1000',
      valueText: (rpm / 1000).toFixed(1), needleColor: AMBER,
      ticks: 9,
    });
    this._dial(ctx, 774, 232, 150, speed, 0, speedMax, {
      redline: null, major: speedMax === 165 ? 20 : 20, label: 'SPEED', unit: this.speedUnit,
      valueText: String(Math.round(speed)), needleColor: CREAM,
      ticks: speedMax === 165 ? 8 : 13,
    });

    // center gear + boost
    ctx.fillStyle = 'rgba(235,231,214,.06)';
    rr(ctx, 452, 102, 120, 220, 10); ctx.fill();
    crispText(ctx, 'GEAR', 512, 130, 16, MUTED, 600, 'center');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2c43a';
    ctx.font = '700 120px "Barlow Condensed", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(gear === 0 ? 'R' : String(gear), 512, 220);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // boost
    crispText(ctx, 'BOOST', 476, 280, 13, MUTED, 600);
    ctx.fillStyle = 'rgba(180,195,170,.14)';
    rr(ctx, 476, 290, 72, 10, 5); ctx.fill();
    ctx.fillStyle = TEAL;
    rr(ctx, 476, 290, Math.max(4, 72 * clamp(state.boost || 0, 0, 1)), 10, 5); ctx.fill();
    // shift lights
    for (let i = 0; i < 8; i++) {
      const on = rpm > 6200 + i * 250;
      ctx.fillStyle = on ? (i < 5 ? '#9fbc70' : i < 7 ? AMBER : RED) : 'rgba(160,175,150,.12)';
      ctx.beginPath();
      ctx.arc(866 + i * 17, 48, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    crispText(ctx, 'GROUP B // RALLY LEGENDS', 32, 56, 22, 'rgba(235,231,214,.5)', 700);
    ctx.textAlign = 'right';
    crispText(ctx, this.car.short, 992, 56, 22, 'rgba(242,196,58,.7)', 700, 'right');
    ctx.textAlign = 'left';
    // unit labels
    crispText(ctx, speedMax === 165 ? 'MPH' : 'KM/H', 860, 370, 16, MUTED, 600);
    // warning if offroad
    if (state.info && state.info.offRoad) {
      crispText(ctx, 'OFF STAGE', 512, 372, 20, RED, 700, 'center');
    }
    ctx.strokeStyle = 'rgba(220,230,210,.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    if (s.present) s.present(); else s.tex.needsUpdate = true;
  }


  _drawModernGauge(state) {
    const s = this.model.screens.gauge;
    if (!this._screenReady(s)) return;
    const ctx = s.ctx;
    const W = s.canvas.width, H = s.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#090d12');
    bg.addColorStop(0.55, '#0d141b');
    bg.addColorStop(1, '#070a0e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const accentNum = this.car.accent || 0xd9c9a3;
    const accent = accentNum > 0x777777
      ? '#' + accentNum.toString(16).padStart(6, '0')
      : '#d9c9a3';
    const cream = '#eef2f5';
    const muted = '#7f8b94';
    const speedMax = this.settings.units === 'mph' ? 165 : 260;
    const speed = this.settings.units === 'mph'
      ? (state.speedKph || 0) * 0.621371
      : (state.speedKph || 0);
    const gear = state.gear || 1;
    const rpm = state.rpm || 900;
    const maxRpm = this.car.handling?.maxRpm || 7000;

    // Top status line
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    ctx.fillRect(0, 0, W, 74);
    crispText(ctx, (this.car.name || 'CITY CAR').split(' ')[0], 46, 47, 30, cream, 700);
    ctx.textAlign = 'center';
    crispText(ctx, 'COMFORT', 600, 42, 21, muted, 600, 'center');
    ctx.fillStyle = accent;
    rr(ctx, 556, 52, 88, 3, 1.5); ctx.fill();
    ctx.textAlign = 'right';
    crispText(ctx, '18°C  ·  06:42', 1154, 42, 20, muted, 600, 'right');
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(210,225,235,.13)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(42, 74); ctx.lineTo(W - 42, 74); ctx.stroke();

    // Speed (large, left)
    ctx.textAlign = 'left';
    ctx.fillStyle = cream;
    ctx.font = '400 150px "Share Tech Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(speed)), 46, 220);
    ctx.textBaseline = 'alphabetic';
    const speedW = ctx.measureText(String(Math.round(speed))).width;
    ctx.fillStyle = muted;
    ctx.font = '600 22px "Barlow Condensed", sans-serif';
    ctx.fillText(this.settings.units === 'mph' ? 'MPH' : 'KM/H', 52 + speedW, 258);
    // speed scale arc
    const arcNorm = clamp(speed / speedMax, 0, 1);
    ctx.strokeStyle = 'rgba(190,210,220,.13)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(246, 212, 150, Math.PI * 0.78, Math.PI * 2.22); ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(246, 212, 150, Math.PI * 0.78, Math.PI * (0.78 + 1.44 * arcNorm));
    ctx.stroke();

    // Gear / drive mode (centre)
    ctx.fillStyle = 'rgba(255,255,255,.03)';
    rr(ctx, 468, 104, 264, 238, 12); ctx.fill();
    crispText(ctx, 'GEAR', 600, 136, 19, muted, 600, 'center');
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = '700 132px "Barlow Condensed", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(gear === 0 ? 'R' : 'D', 600, 224);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = cream;
    ctx.font = '400 28px "Share Tech Mono", monospace';
    ctx.fillText(gear === 0 ? 'REVERSE' : `${gear}  ·  AUTO`, 600, 306);
    ctx.textAlign = 'left';

    // RPM / power bar (right)
    const barX = 806, barY = 116, barW = 340;
    crispText(ctx, 'REV', barX, 102, 18, muted, 600);
    ctx.textAlign = 'right';
    crispText(ctx, `${Math.round(rpm)} RPM`, barX + barW, 102, 18, muted, 600, 'right');
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(190,210,220,.12)';
    rr(ctx, barX, barY, barW, 18, 9); ctx.fill();
    const rpmNorm = clamp((rpm - 800) / (maxRpm - 800), 0, 1);
    const rpmCol = rpmNorm > 0.87 ? '#e7b36b' : accent;
    ctx.fillStyle = rpmCol;
    rr(ctx, barX, barY, Math.max(6, barW * rpmNorm), 18, 9); ctx.fill();
    for (let i = 1; i < 10; i++) {
      ctx.fillStyle = 'rgba(8,12,16,.7)';
      ctx.fillRect(barX + (barW / 10) * i, barY, 2, 18);
    }
    crispText(ctx, 'STABILITY', barX, 180, 17, muted, 600);
    crispText(ctx, 'ABS', barX + 150, 180, 17, muted, 600);
    crispText(ctx, 'TRACTION', barX + 236, 180, 17, muted, 600);
    ctx.fillStyle = '#8fb7a2';
    ctx.beginPath();
    ctx.arc(barX + 94, 175, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(barX + 316, 175, 4, 0, Math.PI * 2);
    ctx.fill();
    // throttle / brake usage
    const throttle = clamp(state.throttle || 0, 0, 1);
    const brake = clamp(state.brake || 0, 0, 1);
    crispText(ctx, 'POWER', barX, 238, 17, muted, 600);
    ctx.fillStyle = 'rgba(190,210,220,.12)';
    rr(ctx, barX, 252, 150, 10, 5); ctx.fill();
    ctx.fillStyle = accent;
    rr(ctx, barX, 252, Math.max(3, 150 * throttle), 10, 5); ctx.fill();
    crispText(ctx, 'BRAKE', barX + 184, 238, 17, muted, 600);
    ctx.fillStyle = 'rgba(190,210,220,.12)';
    rr(ctx, barX + 184, 252, 156, 10, 5); ctx.fill();
    ctx.fillStyle = brake > 0.02 ? '#e38b78' : 'rgba(190,210,220,.18)';
    rr(ctx, barX + 184, 252, Math.max(3, 156 * brake), 10, 5); ctx.fill();

    // Trip footer
    ctx.strokeStyle = 'rgba(210,225,235,.1)';
    ctx.beginPath(); ctx.moveTo(42, 328); ctx.lineTo(W - 42, 328); ctx.stroke();
    const distKm = ((state.dist || 0) / 1000).toFixed(2);
    crispText(ctx, 'TRIP', 46, 364, 18, muted, 600);
    ctx.fillStyle = cream;
    ctx.font = '400 27px "Share Tech Mono", monospace';
    ctx.fillText(`${distKm} KM`, 110, 365);
    crispText(ctx, 'RANGE', 346, 364, 18, muted, 600);
    ctx.fillStyle = accent;
    ctx.font = '400 27px "Share Tech Mono", monospace';
    ctx.fillText('642 KM', 424, 365);
    ctx.textAlign = 'right';
    crispText(ctx, this.car.short, W - 46, 364, 24, 'rgba(238,242,245,.65)', 700, 'right');
    ctx.textAlign = 'left';
    // Ambient accent line
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(42, H - 14, W - 84, 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(220,230,240,.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    if (s.present) s.present(); else s.tex.needsUpdate = true;
  }

  _dial(ctx, cx, cy, r, value, min, max, opts) {
    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;
    const range = end - start;
    const norm = clamp((value - min) / (max - min), 0, 1);
    // face
    const face = ctx.createRadialGradient(cx, cy - 20, 10, cx, cy, r);
    face.addColorStop(0, '#1a2118');
    face.addColorStop(1, '#0a0e0b');
    ctx.fillStyle = face;
    ctx.beginPath(); ctx.arc(cx, cy, r + 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(220,230,210,.16)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r + 16, 0, Math.PI * 2); ctx.stroke();
    // arc
    ctx.strokeStyle = 'rgba(200,210,190,.18)';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(cx, cy, r - 7, start, end); ctx.stroke();
    if (opts.redline != null) {
      const rn = (opts.redline - min) / (max - min);
      ctx.strokeStyle = 'rgba(225,75,51,.75)';
      ctx.beginPath(); ctx.arc(cx, cy, r - 7, start + range * rn, end); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(235,231,214,.85)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r - 7, start + range * norm - 0.01, start + range * norm + 0.01); ctx.stroke();
    // ticks
    const tickCount = opts.ticks || 9;
    for (let i = 0; i <= tickCount; i++) {
      const a = start + (i / tickCount) * range;
      const major = i % (tickCount > 9 ? 2 : 1) === 0;
      const r0 = r - 26, r1 = r - (major ? 46 : 38);
      ctx.strokeStyle = major ? 'rgba(235,231,214,.85)' : 'rgba(235,231,214,.3)';
      ctx.lineWidth = major ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
      if (major) {
        const val = min + (i / tickCount) * (max - min);
        const text = Math.abs(max - min) > 1000 ? (val / 1000).toFixed(0) : String(Math.round(val));
        ctx.fillStyle = 'rgba(235,231,214,.6)';
        ctx.font = '600 26px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cx + Math.cos(a) * (r - 70), cy + Math.sin(a) * (r - 70));
      }
    }
    // needle
    const a = start + range * norm;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillStyle = opts.needleColor;
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.lineTo(r - 30, 0);
    ctx.lineTo(-10, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#2b3029';
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = opts.needleColor;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    // labels
    ctx.fillStyle = 'rgba(235,231,214,.45)';
    ctx.font = '600 22px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.label, cx, cy + r - 50);
    ctx.fillStyle = opts.needleColor;
    ctx.font = '400 34px "Share Tech Mono", monospace';
    ctx.fillText(`${opts.valueText}`, cx, cy + 76);
    ctx.fillStyle = 'rgba(235,231,214,.36)';
    ctx.font = '600 18px "Barlow Condensed", sans-serif';
    ctx.fillText(opts.unit, cx, cy + 104);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

// small typo-safe alias
function crispyText(...args) {
  return crispText(...args);
}
