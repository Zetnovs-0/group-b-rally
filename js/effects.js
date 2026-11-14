import * as THREE from 'three';
import { clamp, damp } from './util.js';
import { makeSoftDotTexture } from './textures.js';

/* ============================================================
   Headlights — spot lamps, lamp glow, volumetric-ish cones.
   Attached to the car root so they follow pitch and roll.
   ============================================================ */
export class Headlights {
  constructor(carRoot, car, env) {
    this.env = env;
    this.level = 0;
    this.group = new THREE.Group();
    carRoot.add(this.group);
    const L = car.style.length;
    const W = car.style.width;
    this.lamps = [];
    this.glows = [];
    this.cones = [];
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffeccb,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    for (const side of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff2d2, 0, 110, 0.53, 0.7, 1.2);
      spot.position.set(side * W * 0.3, 0.66, L * 0.47);
      spot.target.position.set(side * W * 0.36, -0.2, L * 0.47 + 34);
      spot.castShadow = false;
      this.group.add(spot, spot.target);
      this.lamps.push(spot);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeSoftDotTexture(), color: 0xffe7b5, transparent: true,
        opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        fog: true,
      }));
      glow.position.set(side * W * 0.3, 0.68, L * 0.475);
      glow.scale.setScalar(0.7);
      this.group.add(glow);
      this.glows.push(glow);

      const coneGeo = new THREE.ConeGeometry(2.0, 30, 12, 1, true);
      coneGeo.rotateX(-Math.PI / 2);
      coneGeo.translate(0, 0, 15);
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(side * W * 0.3, 0.62, L * 0.47);
      cone.rotation.x = 0.04;
      cone.renderOrder = 2;
      this.group.add(cone);
      this.cones.push(cone);
    }

    // tail lamps
    this.tailGlows = [];
    for (const side of [-1, 1]) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeSoftDotTexture(), color: 0xff2f1c, transparent: true,
        opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        fog: true,
      }));
      glow.position.set(side * W * 0.34, 0.72, -L * 0.485);
      glow.scale.setScalar(0.65);
      this.group.add(glow);
      this.tailGlows.push(glow);
    }
    this.coneMat = coneMat;
    this.setLevel(env.headlights || 0);
  }

  setLevel(level) {
    this.level = clamp(level, 0, 1);
    this.apply();
  }

  apply() {
    const l = this.level;
    for (const spot of this.lamps) spot.intensity = l * 1200;
    for (const glow of this.glows) glow.material.opacity = l * 0.85;
    this.coneMat.opacity = l * 0.013;
    for (const tail of this.tailGlows) tail.material.opacity = l * 0.6;
  }

  update(dt, target) {
    const t = clamp(target, 0, 1);
    const next = damp(this.level, t, 5, dt);
    if (Math.abs(next - this.level) > 0.002) {
      this.level = next;
      this.apply();
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

/* ============================================================
   WindscreenFX — 2D rain droplets running on the glass.
   Drawn on a DOM canvas on top of the WebGL canvas so it costs
   nothing in the 3D scene.
   ============================================================ */
export class WindscreenFX {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.drops = [];
    this.mist = 0;
    this.w = 0;
    this.h = 0;
    this.rng = Math.random;
    this.isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      (navigator.maxTouchPoints || 0) > 0;
    this.maxDrops = this.isTouch ? 110 : 190;
    this.dropTex = this._makeDropTexture();
    this.resize();
  }

  _makeDropTexture() {
    const c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(19, 19, 1, 24, 24, 23);
    g.addColorStop(0, 'rgba(240,250,255,.95)');
    g.addColorStop(0.55, 'rgba(180,205,220,.55)');
    g.addColorStop(1, 'rgba(150,180,196,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(24, 24, 23, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }

  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _spawn(intensity, speed) {
    const w = this.w;
    const h = this.h;
    const r = 1.1 + this.rng() * 3.2;
    const fast = this.rng() < 0.35 + Math.min(0.4, speed / 260);
    this.drops.push({
      x: this.rng() * w,
      y: this.rng() * h * 0.85 - h * 0.1,
      r,
      vy: fast ? -(18 + this.rng() * 55) - speed * 0.09 : 6 + this.rng() * 40,
      vx: (this.rng() - 0.5) * 8,
      wob: this.rng() * Math.PI * 2,
      trail: 1 + this.rng() * 4,
      life: 1.6 + this.rng() * 4 * intensity,
      wet: 0.12 + this.rng() * 0.22,
    });
    if (this.drops.length > this.maxDrops) this.drops.shift();
  }

  update(dt, { rain = 0, intensity = 0, speedKph = 0, enabled = true, clip = true } = {}) {
    if (!this.canvas || !this.ctx) return;
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (!enabled || rain <= 0.01) {
      this.drops.length = 0;
      return;
    }
    const ctx = this.ctx;
    // full-screen rain haze (a clipped hard edge would give the mask away)
    const targetMist = clamp(rain * 0.055, 0, 0.075);
    this.mist = damp(this.mist, targetMist, 2, dt);
    if (this.mist > 0.002) {
      ctx.fillStyle = `rgba(178,200,210,${this.mist})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.save();
    if (clip) {
      // rough windscreen mask so droplets do not run over the dashboard
      const w = this.w;
      const h = this.h;
      ctx.beginPath();
      ctx.moveTo(w * 0.23, h * 0.36);
      ctx.lineTo(w * 0.77, h * 0.36);
      ctx.lineTo(w * 0.94, h * 0.63);
      ctx.lineTo(w * 0.06, h * 0.63);
      ctx.closePath();
      ctx.clip();
    }

    const spawnRate = 34 + rain * 90 + Math.min(40, speedKph * 0.25);
    this._acc = (this._acc || 0) + dt * spawnRate;
    while (this._acc > 1) {
      this._acc -= 1;
      this._spawn(rain, speedKph);
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      d.wob += dt * 2.4;
      d.x += (d.vx + Math.sin(d.wob) * 10) * dt;
      d.y += d.vy * dt;
      if (d.life <= 0 || d.y < -40 || d.y > this.h + 30) {
        this.drops.splice(i, 1);
        continue;
      }
      // tiny streak behind a fast-moving droplet
      if (Math.abs(d.vy) > 22) {
        const len = Math.min(90, Math.abs(d.vy) * 0.16 + d.trail * 5);
        ctx.strokeStyle = `rgba(196,220,232,${d.wet * 0.45})`;
        ctx.lineWidth = d.r * 0.7;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x, d.y - Math.sign(d.vy) * len);
        ctx.stroke();
      }
      const s = d.r * 2.7;
      ctx.globalAlpha = Math.min(1, d.wet + 0.4);
      ctx.drawImage(this.dropTex, d.x - s / 2, d.y - s / 2, s, s);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
