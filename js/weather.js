import * as THREE from 'three';
import { clamp, mulberry32 } from './util.js';
import { makeSoftDotTexture, makeRainTexture } from './textures.js';

export class WeatherFX {
  constructor(stage, quality, enabled = true) {
    this.stage = stage;
    this.quality = quality;
    this.enabled = enabled;
    this.kind = stage.env.weather;
    this.group = new THREE.Group();
    this.time = 0;
    this.rain = this.kind === 'rain';
    this.snow = this.kind === 'snow';
    if (this.kind === 'none') {
      this.count = 0;
    } else {
      this.count = this.rain
        ? (quality === 'high' ? 2200 : quality === 'medium' ? 1200 : 500)
        : (quality === 'high' ? 2800 : quality === 'medium' ? 1500 : 650);
      this._buildPrecipitation();
    }
    this._buildSpray();
    this.group.visible = enabled;
  }

  _buildPrecipitation() {
    const count = this.count;
    const positions = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    const rng = mulberry32(this.stage.seed + 81);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng() - 0.5) * 90;
      positions[i * 3 + 1] = -5 + rng() * 45;
      positions[i * 3 + 2] = (rng() - 0.5) * 90;
      speed[i] = this.rain ? 18 + rng() * 12 : 0.8 + rng() * 1.6;
      phase[i] = rng() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const tex = this.rain ? makeRainTexture() : makeSoftDotTexture();
    const mat = new THREE.PointsMaterial({
      map: tex,
      color: this.rain ? 0xaec5cf : 0xffffff,
      size: this.rain ? 0.9 : 0.17,
      transparent: true,
      opacity: this.rain ? 0.4 : 0.9,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.02,
      fog: true,
    });
    this.precip = new THREE.Points(geo, mat);
    this.precip.frustumCulled = false;
    this.precip.renderOrder = 4;
    this.positions = positions;
    this.speeds = speed;
    this.phases = phase;
    this.group.add(this.precip);
  }

  _buildSpray() {
    this.sprayCount = 240;
    const positions = new Float32Array(this.sprayCount * 3);
    const colors = new Float32Array(this.sprayCount * 3);
    positions.fill(-9999);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      map: makeSoftDotTexture(),
      size: 0.34,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
      alphaTest: 0.02,
    });
    this.spray = new THREE.Points(geo, mat);
    this.spray.frustumCulled = false;
    this.spray.renderOrder = 3;
    this.group.add(this.spray);
    this.sprayPositions = positions;
    this.sprayColors = colors;
    this.sprayLife = new Float32Array(this.sprayCount);
    this.sprayVel = new Float32Array(this.sprayCount * 3);
    this.sprayIdx = 0;
    this.sprayColor = new THREE.Color(
      this.snow ? 0xe9f2f8 : this.stage.biome === 'jungle' ? 0x5b4a30 : 0x8a7c5f
    );
    this._sprayTimer = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.group.visible = enabled;
  }

  emitSpray(pos, amount = 1) {
    if (!this.enabled) return;
    const n = Math.min(8, Math.ceil(amount * 3));
    for (let k = 0; k < n; k++) {
      const i = this.sprayIdx;
      this.sprayIdx = (this.sprayIdx + 1) % this.sprayCount;
      this.sprayLife[i] = 0.4 + Math.random() * 0.5;
      this.sprayPositions[i * 3] = pos.x + (Math.random() - 0.5) * 0.35;
      this.sprayPositions[i * 3 + 1] = pos.y + 0.1 + Math.random() * 0.2;
      this.sprayPositions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.35;
      this.sprayVel[i * 3] = (Math.random() - 0.5) * 2;
      this.sprayVel[i * 3 + 1] = 0.8 + Math.random() * 1.8;
      this.sprayVel[i * 3 + 2] = (Math.random() - 0.5) * 2;
      const c = this.sprayColor;
      const tint = 0.75 + Math.random() * 0.4;
      this.sprayColors[i * 3] = c.r * tint;
      this.sprayColors[i * 3 + 1] = c.g * tint;
      this.sprayColors[i * 3 + 2] = c.b * tint;
    }
  }

  update(dt, cameraPos, carState = null, wheelPositions = null) {
    if (!this.enabled || this.kind === 'none') return;
    this.time += dt;
    const posAttr = this.precip.geometry.attributes.position;
    const p = this.positions;
    const cam = cameraPos;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      if (this.rain) {
        p[i3 + 1] -= this.speeds[i] * dt;
        p[i3] += (0.7 + Math.sin(this.phases[i] + this.time * 0.2) * 0.8) * dt;
        p[i3 + 2] += 0.35 * dt;
      } else {
        p[i3 + 1] -= this.speeds[i] * dt;
        p[i3] += Math.sin(this.phases[i] + this.time * 1.2) * 0.4 * dt;
        p[i3 + 2] += Math.cos(this.phases[i] * 1.7 + this.time * 0.8) * 0.35 * dt;
      }
      const dx = p[i3] - cam.x;
      const dy = p[i3 + 1] - cam.y;
      const dz = p[i3 + 2] - cam.z;
      if (dy < -22 || dx * dx + dz * dz > 80 * 80) {
        p[i3] = cam.x + (Math.random() - 0.5) * 80;
        p[i3 + 2] = cam.z + (Math.random() - 0.5) * 80;
        p[i3 + 1] = cam.y + (this.rain ? 9 + Math.random() * 24 : 8 + Math.random() * 26);
      }
    }
    posAttr.needsUpdate = true;

    // spray
    const sp = this.sprayPositions;
    for (let i = 0; i < this.sprayCount; i++) {
      if (this.sprayLife[i] <= 0) continue;
      this.sprayLife[i] -= dt;
      this.sprayVel[i * 3 + 1] -= 7.5 * dt;
      sp[i * 3] += this.sprayVel[i * 3] * dt;
      sp[i * 3 + 1] += this.sprayVel[i * 3 + 1] * dt;
      sp[i * 3 + 2] += this.sprayVel[i * 3 + 2] * dt;
      if (this.sprayLife[i] <= 0) {
        sp[i * 3] = -9999;
        sp[i * 3 + 1] = -9999;
        sp[i * 3 + 2] = -9999;
      }
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
    this.spray.geometry.attributes.color.needsUpdate = true;

    if (carState && wheelPositions && carState.speedKph > 7) {
      const k = clamp(carState.speedKph / 140, 0, 1);
      const off = carState.offRoad ? 1.7 : 1;
      this._sprayTimer += dt;
      const interval = carState.surface === 'snow' ? 0.035 : 0.055;
      while (this._sprayTimer > interval) {
        this._sprayTimer -= interval;
        const w = wheelPositions[(Math.random() * wheelPositions.length) | 0];
        this.emitSpray(w, k * off);
      }
    }
  }

  dispose(scene) {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}
