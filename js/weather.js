import * as THREE from 'three';
import { clamp, mulberry32 } from './util.js';
import { makeSoftDotTexture, makeRainTexture } from './textures.js';

/* ============================================================
   WeatherFX — precipitation, spray, dust, fog banks, fireflies.
   The kind and strength come from the resolved condition set, so
   any biome can run clear, wet or white-out weather.
   ============================================================ */
export class WeatherFX {
  constructor(stage, quality, enabled = true) {
    this.stage = stage;
    this.env = stage.env;
    this.quality = quality;
    this.enabled = enabled;
    this.intensity = this.env.weatherIntensity ?? 1;
    this.wetness = this.env.wetness || 0;
    this.kind = this.env.weather || 'none';
    this.rain = this.kind === 'rain';
    this.snow = this.kind === 'snow';
    this.time = 0;
    this.flash = 0;
    this.flashTimer = 1.2 + Math.random() * 3;
    this.onLightning = null;
    this.rng = mulberry32(stage.seed + 81);
    this.group = new THREE.Group();
    this.group.visible = enabled;
    if (this.kind !== 'none') this._buildPrecipitation();
    this._buildSpray();
    this._buildDust();
    this._buildFogBanks();
    this._buildFireflies();
  }

  _buildPrecipitation() {
    const q = this.quality;
    const base = this.rain
      ? (q === 'high' ? 2200 : q === 'medium' ? 1200 : 520)
      : (q === 'high' ? 2800 : q === 'medium' ? 1500 : 700);
    const count = Math.round(base * clamp(this.intensity, 0.4, 1.6));
    const positions = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    const pScale = new Float32Array(count);
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng() - 0.5) * 90;
      positions[i * 3 + 1] = -5 + rng() * 45;
      positions[i * 3 + 2] = (rng() - 0.5) * 90;
      speed[i] = this.rain ? 18 + rng() * 14 : 0.8 + rng() * 1.8;
      phase[i] = rng() * Math.PI * 2;
      pScale[i] = 0.7 + rng() * 0.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(pScale, 1));
    const tex = this.rain ? makeRainTexture() : makeSoftDotTexture();
    const mat = new THREE.PointsMaterial({
      map: tex,
      color: this.rain ? 0xaec5cf : 0xffffff,
      size: this.rain ? 0.72 : 0.19,
      transparent: true,
      opacity: this.rain ? Math.min(0.75, 0.36 * this.intensity) : 0.92,
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
    this.count = count;
    this.group.add(this.precip);
  }

  _buildSpray() {
    this.sprayCount = this.quality === 'low' ? 140 : 260;
    const positions = new Float32Array(this.sprayCount * 3);
    const colors = new Float32Array(this.sprayCount * 3);
    positions.fill(-9999);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      map: makeSoftDotTexture(),
      size: 0.36,
      transparent: true,
      opacity: 0.55,
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
    this.sprayGrav = new Float32Array(this.sprayCount);
    this.sprayIdx = 0;
    this.sprayColor = new THREE.Color(
      this.snow ? 0xe9f2f8
        : this.stage.biome === 'jungle' ? 0x5b4a30
          : this.stage.biome === 'safari' ? 0xb07c4d
            : this.wetness > 0.35 ? 0x6d6455 : 0xa08d6b
    );
    this._sprayTimer = 0;
  }

  _buildDust() {
    if (this.rain || this.snow || this.wetness > 0.35) return;
    const count = this.quality === 'low' ? 50 : this.quality === 'medium' ? 100 : 170;
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rng() - 0.5) * 40;
      pos[i * 3 + 1] = 0.1 + rng() * 3.6;
      pos[i * 3 + 2] = (rng() - 0.5) * 40;
      phase[i] = rng() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: makeSoftDotTexture(),
      color: this.stage.biome === 'snow' ? 0xe6eef4
        : this.stage.biome === 'safari' ? 0xc79a63 : 0xc4ab7c,
      size: 0.075,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 2;
    this.dustPos = pos;
    this.dustPhase = phase;
    this.dustCount = count;
    this.group.add(this.dust);
  }

  _buildFogBanks() {
    const density = this.env.fogDensity || 0;
    if (!this.env.fogBanks && density < 0.018) return;
    const count = this.quality === 'low' ? 6 : this.quality === 'medium' ? 10 : 16;
    const rng = this.rng;
    const tex = makeSoftDotTexture();
    const col = new THREE.Color(this.env.fog).lerp(new THREE.Color(0xffffff), 0.25);
    this.fogBanks = [];
    this.fogGroup = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: col, transparent: true, opacity: 0.05 + rng() * 0.07,
        depthWrite: false, fog: false,
      });
      const spr = new THREE.Sprite(mat);
      const w = 28 + rng() * 46;
      spr.scale.set(w, w * (0.3 + rng() * 0.2), 1);
      spr.userData.offset = new THREE.Vector3(
        (rng() - 0.5) * 150, 1 + rng() * 7, (rng() - 0.5) * 150
      );
      spr.userData.drift = (rng() - 0.5) * 0.5;
      this.fogGroup.add(spr);
      this.fogBanks.push(spr);
    }
    this.group.add(this.fogGroup);
  }

  _buildFireflies() {
    if ((this.env.stars || 0) < 0.45 || this.stage.biome === 'snow') return;
    const count = this.quality === 'low' ? 40 : 110;
    const rng = this.rng;
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rng() - 0.5) * 44;
      pos[i * 3 + 1] = 0.4 + rng() * 3.2;
      pos[i * 3 + 2] = (rng() - 0.5) * 44;
      phase[i] = rng() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: makeSoftDotTexture(), color: 0xc9f27a, size: 0.16,
      transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, alphaTest: 0.01,
    });
    this.flies = new THREE.Points(geo, mat);
    this.flies.frustumCulled = false;
    this.flies.renderOrder = 5;
    this.fliesPos = pos;
    this.fliesPhase = phase;
    this.fliesCount = count;
    this.group.add(this.flies);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.group.visible = enabled;
  }

  emitSpray(pos, amount = 1, dust = false) {
    if (!this.enabled) return;
    const n = Math.min(8, Math.ceil(amount * 3));
    for (let k = 0; k < n; k++) {
      const i = this.sprayIdx;
      this.sprayIdx = (this.sprayIdx + 1) % this.sprayCount;
      this.sprayLife[i] = dust ? 0.7 + Math.random() * 0.9 : 0.4 + Math.random() * 0.5;
      this.sprayPositions[i * 3] = pos.x + (Math.random() - 0.5) * 0.35;
      this.sprayPositions[i * 3 + 1] = pos.y + 0.1 + Math.random() * 0.2;
      this.sprayPositions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.35;
      this.sprayVel[i * 3] = (Math.random() - 0.5) * (dust ? 3.4 : 2);
      this.sprayVel[i * 3 + 1] = (dust ? 0.5 : 0.8) + Math.random() * (dust ? 1.1 : 1.8);
      this.sprayVel[i * 3 + 2] = (Math.random() - 0.5) * (dust ? 3.4 : 2);
      this.sprayGrav[i] = dust ? 2.6 : 7.5;
      const c = this.sprayColor;
      const tint = 0.75 + Math.random() * 0.4;
      this.sprayColors[i * 3] = c.r * tint;
      this.sprayColors[i * 3 + 1] = c.g * tint;
      this.sprayColors[i * 3 + 2] = c.b * tint;
    }
  }

  update(dt, cameraPos, carState = null, wheelPositions = null, night = 0) {
    this.time += dt;
    if (!this.enabled) return;
    const cam = cameraPos;

    if (this.precip) {
      const attr = this.precip.geometry.attributes.position;
      const p = this.positions;
      const wind = (this.env.wind || 0.2) * 2.2;
      for (let i = 0; i < this.count; i++) {
        const i3 = i * 3;
        if (this.rain) {
          p[i3 + 1] -= this.speeds[i] * dt;
          p[i3] += (0.55 + wind + Math.sin(this.phases[i] + this.time * 0.2) * 0.7) * dt;
          p[i3 + 2] += 0.35 * dt;
        } else {
          p[i3 + 1] -= this.speeds[i] * dt;
          p[i3] += (Math.sin(this.phases[i] + this.time * 1.2) * 0.4 + wind * 0.35) * dt;
          p[i3 + 2] += Math.cos(this.phases[i] * 1.7 + this.time * 0.8) * 0.35 * dt;
        }
        const dx = p[i3] - cam.x;
        const dy = p[i3 + 1] - cam.y;
        const dz = p[i3 + 2] - cam.z;
        const near = dx * dx + dy * dy + dz * dz < 2.9;
        if (dy < -22 || near || dx * dx + dz * dz > 80 * 80) {
          p[i3] = cam.x + (Math.random() - 0.5) * 80;
          p[i3 + 2] = cam.z + (Math.random() - 0.5) * 80;
          p[i3 + 1] = cam.y + (this.rain ? 9 + Math.random() * 24 : 8 + Math.random() * 26);
        }
      }
      attr.needsUpdate = true;
    }

    if (this.dust) {
      const p = this.dustPos;
      for (let i = 0; i < this.dustCount; i++) {
        const i3 = i * 3;
        const ph = this.dustPhase[i];
        p[i3] += Math.sin(this.time * 0.32 + ph) * 0.16 * dt;
        p[i3 + 1] += Math.cos(this.time * 0.24 + ph * 1.7) * 0.1 * dt;
        p[i3 + 2] += Math.cos(this.time * 0.28 + ph) * 0.16 * dt;
        if (p[i3] - cam.x > 20) p[i3] -= 40;
        else if (p[i3] - cam.x < -20) p[i3] += 40;
        if (p[i3 + 1] - cam.y > 5) p[i3 + 1] -= 5;
        else if (p[i3 + 1] - cam.y < -1.2) p[i3 + 1] += 5;
        if (p[i3 + 2] - cam.z > 20) p[i3 + 2] -= 40;
        else if (p[i3 + 2] - cam.z < -20) p[i3 + 2] += 40;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }

    if (this.fogGroup) {
      for (const spr of this.fogBanks) {
        const o = spr.userData.offset;
        o.x += spr.userData.drift * dt;
        if (o.x > 80) o.x -= 160;
        else if (o.x < -80) o.x += 160;
        spr.position.set(cam.x + o.x, cam.y + o.y - 1.5, cam.z + o.z);
      }
    }

    if (this.flies) {
      const p = this.fliesPos;
      for (let i = 0; i < this.fliesCount; i++) {
        const i3 = i * 3;
        const ph = this.fliesPhase[i];
        p[i3] += Math.sin(this.time * 0.7 + ph) * 0.22 * dt;
        p[i3 + 1] += Math.sin(this.time * 0.9 + ph * 2.3) * 0.16 * dt;
        p[i3 + 2] += Math.cos(this.time * 0.6 + ph * 1.3) * 0.22 * dt;
        if (p[i3] - cam.x > 22) p[i3] -= 44; else if (p[i3] - cam.x < -22) p[i3] += 44;
        if (p[i3 + 2] - cam.z > 22) p[i3 + 2] -= 44; else if (p[i3 + 2] - cam.z < -22) p[i3 + 2] += 44;
        if (p[i3 + 1] - cam.y > 3.5) p[i3 + 1] -= 3.5; else if (p[i3 + 1] - cam.y < 0.2) p[i3 + 1] += 3.5;
      }
      this.flies.geometry.attributes.position.needsUpdate = true;
      this.flies.material.opacity = 0.55 + Math.sin(this.time * 1.3) * 0.25 + night * 0.2;
    }

    // spray
    const sp = this.sprayPositions;
    for (let i = 0; i < this.sprayCount; i++) {
      if (this.sprayLife[i] <= 0) continue;
      this.sprayLife[i] -= dt;
      this.sprayVel[i * 3 + 1] -= this.sprayGrav[i] * dt;
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

    if (carState && wheelPositions && carState.speedKph > 6) {
      const k = clamp(carState.speedKph / 130, 0, 1.2);
      const off = carState.offRoad ? 1.8 : 1;
      const dust = this.wetness < 0.3 && !this.rain && !this.snow;
      this._sprayTimer += dt;
      const interval = (dust ? 0.05 : carState.surface === 'snow' ? 0.035 : 0.06) / (0.5 + k);
      while (this._sprayTimer > interval) {
        this._sprayTimer -= interval;
        const w = wheelPositions[(Math.random() * wheelPositions.length) | 0];
        if (w) this.emitSpray(w, k * off, dust);
      }
    }

    if (this.env.lightning) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashTimer = 4 + Math.random() * 10;
        this.flash = 1;
        this.onLightning?.();
      }
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4.2);
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
