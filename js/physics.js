import * as THREE from 'three';
import { clamp, damp, lerp } from './util.js';

const G = 9.81;

export class CarPhysics {
  constructor(car, track, opts = {}) {
    this.car = car;
    this.track = track;
    this.onImpact = opts.onImpact || null;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.steerInput = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.boost = 0;
    this.gear = 1;
    this.rpm = 1000;
    this.speedKph = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.accelLong = 0;
    this.latAccel = 0;
    this.pitch = 0;
    this.roll = 0;
    this.impactCooldown = 0;
    this.reverseTimer = 0;
    this.info = null;
    this.shiftTimer = 0;
    this.odometer = 0;
    this.finished = false;
    this.wheelRotation = 0;
    this.visY = 0;
    this.timeSinceReset = 0;
    this.startIndex = 3;
    this.reset(track, true);
  }

  reset(track = this.track, initial = false) {
    const info = track.nearestGlobal(this.pos);
    const idx = initial ? this.startIndex : info.index;
    const s = track.samples[clamp(idx, 0, track.n - 1)];
    this.pos.set(s.pos.x, s.pos.y + track.roadYOffset + track.roadCrown(0), s.pos.z);
    this.vel.set(0, 0, 0);
    this.yaw = s.heading;
    this.yawRate = 0;
    this.steer = 0;
    this.steerInput = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.boost = 0;
    this.gear = 1;
    this.rpm = 1000;
    this.speedKph = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.accelLong = 0;
    this.latAccel = 0;
    this.pitch = 0;
    this.roll = 0;
    this.impactCooldown = 0;
    this.reverseTimer = 0;
    this.visY = this.pos.y;
    this.timeSinceReset = 0;
    this.finished = false;
    this.wheelRotation = 0;
    this.odometer = 0;
    this.track.lastIndexHint = idx;
    this.info = track.nearest(this.pos, idx);
  }

  get speedMs() {
    return Math.abs(this.forwardSpeed);
  }

  forwardVector() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  rightVector() {
    return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  step(dt, input, track) {
    if (!this.info) this.info = track.nearestGlobal(this.pos);
    let info = track.nearest(this.pos, track.lastIndexHint);
    this.info = info;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.timeSinceReset += dt;

    const throttle = clamp(input.throttle || 0, 0, 1);
    const brake = clamp(input.brake || 0, 0, 1);
    const handbrake = clamp(input.handbrake || 0, 0, 1);
    const steerTarget = clamp(input.steer || 0, -1, 1);
    this.throttle = throttle;
    this.brake = brake;
    this.handbrake = handbrake;

    // ---- surface ----
    const offRoad = info.offRoad;
    const offRoadFactor = offRoad ? 0.6 : 1.0;
    const surfaceGrip = Math.max(0.12, info.grip * offRoadFactor);
    const topSpeed = this.car.topSpeed / 3.6;

    // ---- steering ----
    const speedAbs = Math.abs(this.forwardSpeed);
    const weightRatio = this.car.weight / 950;
    const steerMax = THREE.MathUtils.degToRad(35) *
      (0.27 + 0.73 / (1 + speedAbs * 0.105)) / Math.pow(weightRatio, 0.12);
    const targetSteer = steerTarget * steerMax;
    const steerRate = (4.2 - Math.min(2.3, speedAbs * 0.04)) / Math.sqrt(weightRatio);
    const dSteer = clamp(targetSteer - this.steer, -steerRate * dt, steerRate * dt);
    this.steer += dSteer;
    this.steerInput = steerTarget;

    // ---- engine / boost ----
    const boostTarget = throttle > 0.05 ? 1 : 0;
    const spool = boostTarget > 0 ? 1.55 : 4.2;
    this.boost += (boostTarget - this.boost) * Math.min(1, dt * spool);
    const boostPower = 0.6 + 0.4 * this.boost;
    const powerFactor = (this.car.power / 480) * Math.pow(950 / this.car.weight, 0.62);
    const baseAccel = 10.8 * powerFactor;
    let engineAccel = 0;

    if (throttle > 0.01) {
      const speedRatio = clamp(this.forwardSpeed / topSpeed, 0, 1.1);
      engineAccel = throttle * baseAccel * boostPower *
        (1 - Math.min(0.88, speedRatio * speedRatio * 0.9));
      // traction from layout at launch
      if (speedAbs < 9) {
        const traction = this.car.layout === 'AWD' ? 1.0 :
          this.car.layout === 'RWD' ? 0.8 : 0.85;
        engineAccel *= traction;
      }
      if (this.forwardSpeed < 0) engineAccel *= 1.7;
    }

    // grade resistance
    const grade = info.tangent.y;
    let longAccel = engineAccel - G * grade * 0.58;

    // ---- braking / reverse ----
    const vF0 = this.forwardSpeed;
    if (brake > 0.01) {
      if (vF0 > 0.4) {
        longAccel -= brake * 12.8 * this.car.brake * Math.sqrt(950 / this.car.weight);
      } else if (vF0 > -7.5) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.12) {
          longAccel -= brake * 4.4;
          this.gear = 0;
        }
      }
    } else {
      this.reverseTimer = 0;
    }

    // handbrake drag
    if (handbrake > 0.01 && speedAbs > 0.6) {
      longAccel -= Math.sign(this.forwardSpeed) * handbrake * 4.2;
    }

    // rolling resistance, drag
    const rollRes = 0.72 + (offRoad ? 2.6 : 0) + (handbrake * 2.0);
    if (speedAbs > 0.02) longAccel -= Math.sign(this.forwardSpeed) * rollRes;
    const drag = 0.00034 * this.forwardSpeed * Math.abs(this.forwardSpeed) * (offRoad ? 1.65 : 1);
    longAccel -= drag;

    let vF = this.forwardSpeed + longAccel * dt;
    if (Math.abs(vF) < 0.05 && throttle < 0.05 && brake < 0.05) vF = 0;
    if (vF > topSpeed * 1.03) vF = topSpeed * 1.03;
    if (vF < -9) vF = -9;
    this.accelLong = (vF - vF0) / Math.max(dt, 1e-4);

    // ---- yaw ----
    const wheelbase = this.car.style.length * 0.56;
    const gripCap = G * this.car.grip * surfaceGrip *
      (1 + Math.min(speedAbs, 55) / 55 * 0.16) / Math.pow(weightRatio, 0.22);
    let omega = (vF / wheelbase) * Math.tan(this.steer);
    const omegaMax = gripCap / Math.max(3.2, speedAbs);
    omega = clamp(omega, -omegaMax, omegaMax);

    // drivetrain character
    const oversteer = this.car.layout === 'RWD' ? 0.6 :
      this.car.layout === 'AWD' ? 0.14 : -0.1;
    const speedFactor = clamp(speedAbs / 22, 0, 1);
    omega += oversteer * this.steerInput * throttle * speedFactor * surfaceGrip * 0.9;
    omega += this.steerInput * handbrake * clamp(speedAbs / 12, 0, 1) * 0.9;
    // off-road yaw is less controlled
    if (offRoad) omega *= 0.92;
    const yawDamp = 7.5 - (handbrake * 4.0) - (offRoad ? 2 : 0);
    this.yawRate += (omega - this.yawRate) * Math.min(1, dt * yawDamp);
    this.yawRate = clamp(this.yawRate, -2.6, 2.6);
    this.yaw += this.yawRate * dt;

    // ---- lateral velocity / grip ----
    const fwd = this.forwardVector();
    const right = this.rightVector();
    let vR = this.vel.x * right.x + this.vel.z * right.z;
    // newly created slip because heading rotated
    const latDamp = 7.2 * this.car.grip * surfaceGrip *
      (handbrake > 0.05 ? 0.3 : 1) * (offRoad ? 0.68 : 1);
    vR *= Math.exp(-latDamp * dt);
    // small lateral push from steering at very low speed (helps turn-in)
    if (speedAbs > 0.5) vR -= this.steer * Math.min(1, speedAbs / 7) * 0.08 * dt * speedAbs;
    vR = clamp(vR, -16, 16);
    this.lateralSpeed = vR;
    this.latAccel = this.yawRate * vF;

    // reconstruct velocity
    this.vel.x = fwd.x * vF + right.x * vR;
    this.vel.z = fwd.z * vF + right.z * vR;
    this.forwardSpeed = vF;

    // ---- integrate ----
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.odometer += Math.abs(vF) * dt;

    // ---- solid start/finish gantry posts ----
    if (track.gateColliders) {
      for (const c of track.gateColliders) {
        const dx = this.pos.x - c.x;
        const dz = this.pos.z - c.z;
        const rr = c.r + 0.82;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          this.pos.x = c.x + nx * rr;
          this.pos.z = c.z + nz * rr;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) {
            this.vel.x -= nx * vn * 1.5;
            this.vel.z -= nz * vn * 1.5;
          }
          this.vel.x *= 0.52;
          this.vel.z *= 0.52;
          this.forwardSpeed = this.vel.x * fwd.x + this.vel.z * fwd.z;
          this.yawRate *= 0.4;
          const impact = Math.abs(vn);
          if (this.impactCooldown <= 0 && impact > 3) {
            this.impactCooldown = 0.6;
            if (this.onImpact) this.onImpact(Math.min(1, impact / 24), 'gate');
          }
        }
      }
    }

    // ---- keep inside stage corridor ----
    const bound = track.halfWidth + 7.4;
    if (Math.abs(info.lateral) > bound) {
      const idx = track.nearest(this.pos, track.lastIndexHint);
      const side = Math.sign(idx.lateral) || 1;
      const center = idx.center;
      const r = idx.right;
      this.pos.x = center.x + r.x * side * bound;
      this.pos.z = center.z + r.z * side * bound;
      const impact = Math.abs(this.forwardSpeed);
      // remove outward velocity, lose speed, add shake
      const outward = this.vel.x * r.x + this.vel.z * r.z;
      if (outward * side > 0) {
        this.vel.x -= r.x * outward * 1.5;
        this.vel.z -= r.z * outward * 1.5;
      }
      this.vel.x *= 0.55;
      this.vel.z *= 0.55;
      this.forwardSpeed = this.vel.x * fwd.x + this.vel.z * fwd.z;
      this.yawRate *= 0.35;
      if (this.impactCooldown <= 0 && impact > 4) {
        this.impactCooldown = 0.6;
        if (this.onImpact) this.onImpact(Math.min(1, impact / 30), 'tree');
      }
    }

    // ---- ground follow ----
    info = track.nearest(this.pos, track.lastIndexHint);
    this.info = info;
    const targetY = info.height;
    this.pos.y = damp(this.pos.y, targetY, 20, dt);
    this.visY = this.pos.y;

    // visual pitch / roll
    const targetPitch = -Math.asin(clamp(info.tangent.y, -1, 1)) -
      clamp(this.accelLong, -15, 15) * 0.0045;
    const targetRoll = clamp(this.latAccel * 0.0095 * Math.min(1.2, weightRatio), -0.12, 0.12);
    this.pitch = damp(this.pitch, targetPitch, 7, dt);
    this.roll = damp(this.roll, targetRoll, 7, dt);

    // ---- drivetrain display ----
    this.speedKph = Math.abs(vF) * 3.6;
    this._updateGear(dt);

    // ---- finish ----
    const finishDist = track.finishGateIndex != null
      ? track.samples[track.finishGateIndex].dist - 1.5
      : track.length - 6;
    if (!this.finished && info.dist >= finishDist) {
      this.finished = true;
    }
    return info;
  }

  _updateGear(dt) {
    const top = this.car.topSpeed;
    const kph = this.speedKph;
    let gear;
    if (this.forwardSpeed < -0.4) {
      gear = 0;
    } else {
      const thresholds = [0, 0.18, 0.32, 0.47, 0.63, 0.8, 1.0].map((f) => f * top);
      gear = 1;
      for (let g = 1; g < 6; g++) {
        if (kph >= thresholds[g]) gear = g + 1;
      }
      gear = clamp(gear, 1, 6);
      if (gear < this.gear - 1 && this.shiftTimer > 0) gear = this.gear;
      if (gear !== this.gear) this.shiftTimer = 0.18;
    }
    this.gear = gear;
    let rpmTarget;
    if (gear === 0) {
      rpmTarget = 1000 + Math.abs(this.forwardSpeed) / 9 * 4000;
    } else {
      const lowers = [0, 0.18, 0.32, 0.47, 0.63, 0.8];
      const uppers = [0.18, 0.32, 0.47, 0.63, 0.8, 1.0];
      const lower = lowers[gear - 1] * top;
      const upper = uppers[gear - 1] * top;
      const frac = clamp((kph - lower) / Math.max(8, upper - lower), 0, 1);
      rpmTarget = 1100 + frac * 6200 + this.throttle * 350;
      if (this.speedKph < 2) rpmTarget = 950 + this.throttle * 2600;
    }
    if (this.shiftTimer > 0) rpmTarget *= 0.78;
    this.rpm = damp(this.rpm, clamp(rpmTarget, 850, 8200), 10, dt);
    this.wheelRotation += (this.forwardSpeed / 0.335) * dt;
  }

  resetToTrack(track) {
    this.reset(track, false);
    this.track.lastIndexHint = -1;
  }
}
