import * as THREE from 'three';
import { clamp, damp } from './util.js';

const G = 9.81;
const RHO = 1.225;
const WHEEL_RADIUS = 0.335;
const DRIVE_EFFICIENCY = 0.9;
const LONG_GRIP_GAIN = 1.72;
const BRAKE_ACCEL_G = 1.55;
const GEAR_RATIOS = [3.35, 2.18, 1.62, 1.27, 1.03, 0.86];
const UPSHIFT_RPM = 7150;
const DOWNSHIFT_RPM = 2550;
const TORQUE_CURVE = [
  [1000, 0.42], [2000, 0.58], [3000, 0.74], [4000, 0.9],
  [5000, 1.0], [6000, 0.95], [7000, 0.84], [7900, 0.66],
];

function surfaceDistanceSign(v) {
  return v < 0 ? -1 : 1;
}

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
    this.vLat = 0;
    this.accelLong = 0;
    this.latAccel = 0;
    this.pitch = 0;
    this.roll = 0;
    this.impactCooldown = 0;
    this.reverseTimer = 0;
    this.reverse = false;
    this.info = null;
    this.shiftTimer = 0;
    this.odometer = 0;
    this.finished = false;
    this.wheelRotation = 0;
    this.visY = 0;
    this.timeSinceReset = 0;
    this.loadTransfer = 0;
    this.brakeLock = 0;
    this.wheelspin = 0;
    this.downforce = 0;
    this.startIndex = 3;
    this._initVehicle();
    this.reset(track, true);
  }

  /* Physical dimensions and drivetrain parameters. Kept here rather than in the
     per-frame path so the step only has to do arithmetic. */
  _initVehicle() {
    const st = this.car.style;
    this.mass = this.car.weight;
    this.wheelbase = st.length * 0.6;
    this.frontWeight = clamp(this.car.frontWeight ?? 0.55, 0.35, 0.68);
    this.lF = this.wheelbase * (1 - this.frontWeight);
    this.lR = this.wheelbase * this.frontWeight;
    this.cgHeight = 0.47;
    this.inertia = this.mass * (st.length * st.length + st.width * st.width) / 12 * 1.08;
    this.dragCdA = 0.72 + st.width * 0.1 + (st.wing === 'big' ? 0.08 : 0);
    this.liftCdA = 0.2 + (st.wing === 'big' ? 0.24 : 0.08);
    const topMs = this.car.topSpeed / 3.6;
    this.finalDrive = (7600 * Math.PI / 30) / (topMs / WHEEL_RADIUS) / GEAR_RATIOS[5];
    const peakPowerW = this.car.power * 745.7;
    const peakOmega = 6500 * Math.PI / 30;
    this.peakTorque = peakPowerW / peakOmega / this._torqueFactor(6500);
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
    this.vLat = 0;
    this.accelLong = 0;
    this.latAccel = 0;
    this.pitch = 0;
    this.roll = 0;
    this.impactCooldown = 0;
    this.reverseTimer = 0;
    this.reverse = false;
    this.visY = this.pos.y;
    this.timeSinceReset = 0;
    this.finished = false;
    this.wheelRotation = 0;
    this.odometer = 0;
    this.loadTransfer = 0;
    this.brakeLock = 0;
    this.wheelspin = 0;
    this.downforce = 0;
    this.shiftTimer = 0;
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

  /* Normalised engine torque curve, interpolated from the table above. */
  _torqueFactor(rpm) {
    const x = clamp(rpm, TORQUE_CURVE[0][0], TORQUE_CURVE[TORQUE_CURVE.length - 1][0]);
    for (let i = 1; i < TORQUE_CURVE.length; i++) {
      const [r1, t1] = TORQUE_CURVE[i];
      if (x <= r1) {
        const [r0, t0] = TORQUE_CURVE[i - 1];
        const u = (x - r0) / (r1 - r0);
        return t0 + (t1 - t0) * u;
      }
    }
    return TORQUE_CURVE[TORQUE_CURVE.length - 1][1];
  }

  _rollingCoefficient(info, offRoad) {
    const name = String(info.surfaceName || '').toUpperCase();
    let c = 0.022;
    if (name.includes('SNOW') || name.includes('ICE')) c = 0.03;
    else if (name.includes('MUD')) c = 0.055;
    else if (name.includes('SAND') || name.includes('DIRT')) c = 0.048;
    else if (name.includes('GRAVEL')) c = 0.034;
    else if (name.includes('BROKEN')) c = 0.026;
    else if (name.includes('ASPHALT') || name.includes('TARMAC')) c = 0.018;
    if (offRoad) c *= 1.9;
    return c;
  }

  /* Simplified Pacejka-style lateral curve. Force rises linearly to the peak
     slip angle, then falls away slightly to give a readable slide. */
  _tireLateral(alpha, maxForce, peakSlip) {
    const mag = Math.abs(alpha);
    if (mag < 1e-5) return 0;
    const x = mag / peakSlip;
    const shape = x <= 1 ? x : 0.88 + 0.12 * Math.exp(-(x - 1) * 1.2);
    return -Math.sign(alpha) * maxForce * shape;
  }

  _updateDriveline(dt, throttle, brake) {
    // Automatic clutch/gearbox. Holding the brake at rest selects reverse, as
    // it did before, but with a proper neutral pause and torque curve.
    if (this.reverse) {
      if (throttle > 0.12 || (brake < 0.05 && this.forwardSpeed > -0.3)) {
        this.reverse = false;
        this.reverseTimer = 0;
        this.gear = 1;
        this.shiftTimer = 0;
      }
    } else if (this.forwardSpeed < 0.45 && brake > 0.15 && throttle < 0.08) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.22) {
        this.reverse = true;
        this.reverseTimer = 0;
        this.gear = 0;
        this.shiftTimer = 0;
      }
    } else {
      this.reverseTimer = 0;
    }

    if (this.reverse) {
      const reverseSpeed = Math.max(0, -this.forwardSpeed);
      const target = 1000 + clamp(reverseSpeed / 8, 0, 1) * 3000 + brake * 700;
      this.rpm = damp(this.rpm, target, 8, dt);
      this.boost += (0 - this.boost) * Math.min(1, dt * 3.5);
      return;
    }

    const speed = Math.max(0, this.forwardSpeed);
    const wheelOmega = speed / WHEEL_RADIUS;
    let totalRatio = GEAR_RATIOS[this.gear - 1] * this.finalDrive;
    let wheelRpm = wheelOmega * totalRatio * 60 / (Math.PI * 2);

    if (this.shiftTimer <= 0) {
      if (wheelRpm > UPSHIFT_RPM && this.gear < 6) {
        this.gear += 1;
        this.shiftTimer = 0.18;
      } else if (wheelRpm < DOWNSHIFT_RPM && this.gear > 1) {
        this.gear -= 1;
        this.shiftTimer = 0.15;
      }
    }

    totalRatio = GEAR_RATIOS[this.gear - 1] * this.finalDrive;
    wheelRpm = wheelOmega * totalRatio * 60 / (Math.PI * 2);
    let targetRpm = Math.max(950, wheelRpm);
    // Slipping the clutch off the line lets the engine sit above idle.
    if (this.forwardSpeed < 2.0) targetRpm = Math.max(targetRpm, 1000 + throttle * 2600);
    targetRpm = clamp(targetRpm, 900, 7900);
    this.rpm = damp(this.rpm, targetRpm, this.shiftTimer > 0 ? 6 : 12, dt);

    const turbo = this.car.audio?.turbo ?? 1;
    const rpmBuild = clamp((this.rpm - 1500) / 2800, 0, 1);
    const boostTarget = throttle * (0.15 + 0.85 * rpmBuild);
    const spool = boostTarget > this.boost ? 0.85 + 2.0 * (1 - turbo) : 3.2;
    this.boost += (boostTarget - this.boost) * Math.min(1, dt * spool);
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
    const offRoad = !!info.offRoad;
    const surfaceGrip = Math.max(0.12, info.grip * (offRoad ? 0.68 : 1));
    const topSpeed = this.car.topSpeed / 3.6;
    const speedAbs = Math.abs(this.forwardSpeed);
    const weightRatio = this.car.weight / 950;

    // ---- steering ----
    // Speed-sensitive lock and a real steering rack rate. The car no longer
    // snaps to the requested angle in a single frame.
    const authority = clamp(1 / (1 + speedAbs * 0.055), 0.22, 1);
    const steerLock = THREE.MathUtils.degToRad(32) * authority /
      Math.pow(weightRatio, 0.05);
    const targetSteer = steerTarget * steerLock;
    const steerRate = (4.2 - Math.min(2.0, speedAbs * 0.03)) /
      Math.pow(weightRatio, 0.04);
    const returnRate = Math.abs(steerTarget) < 0.02 ? steerRate * 1.4 : steerRate;
    const dSteer = clamp(targetSteer - this.steer, -returnRate * dt, returnRate * dt);
    this.steer += dSteer;
    this.steerInput = steerTarget;

    // ---- drivetrain ----
    this._updateDriveline(dt, throttle, brake);

    // ---- vehicle axes and previous-step load transfer ----
    const u0 = this.forwardSpeed;
    const v0 = this.vLat;
    const r0 = this.yawRate;
    const latGrip = Math.max(0.1, this.car.grip * surfaceGrip);
    const longGrip = latGrip * LONG_GRIP_GAIN;
    const downforce = 0.5 * RHO * this.liftCdA * u0 * u0;
    this.downforce = downforce;

    const staticFront = this.mass * G * this.frontWeight + downforce * this.frontWeight;
    const staticRear = this.mass * G * (1 - this.frontWeight) + downforce * (1 - this.frontWeight);
    const transfer = this.loadTransfer;
    const FzFront = Math.max(this.mass * G * 0.05, staticFront - transfer);
    const FzRear = Math.max(this.mass * G * 0.05, staticRear + transfer);

    const wheelTravelDir = this.forwardSpeed < -0.15 ? -1 : 1;
    const moving = clamp(speedAbs / 1.2, 0, 1);

    // Longitudinal demands. In reverse the brake pedal becomes the reverse
    // throttle and the throttle pedal becomes the brake.
    let driveForce = 0;
    let engineBrakeForce = 0;
    let brakeMag = 0;
    const shifting = this.shiftTimer > 0;
    if (this.reverse) {
      if (brake > 0.01) driveForce = -brake * this.mass * G * 0.42;
      if (throttle > 0.01 && this.forwardSpeed < -0.15) {
        brakeMag = throttle * this.mass * G * BRAKE_ACCEL_G * this.car.brake * moving;
      }
    } else {
      if (!shifting && throttle > 0.01) {
        const totalRatio = GEAR_RATIOS[this.gear - 1] * this.finalDrive;
        const torque = this.peakTorque * this._torqueFactor(this.rpm) * throttle;
        const boostFactor = 0.6 + 0.4 * this.boost;
        driveForce = torque * totalRatio * DRIVE_EFFICIENCY / WHEEL_RADIUS * boostFactor;
        if (this.forwardSpeed > topSpeed * 0.995) driveForce = 0;
      }
      if (!shifting && throttle < 0.08 && this.forwardSpeed > 0.5) {
        const totalRatio = GEAR_RATIOS[this.gear - 1] * this.finalDrive;
        const dragTorque = this.peakTorque * this._torqueFactor(this.rpm) * 0.09 * (1 - throttle);
        engineBrakeForce = -dragTorque * totalRatio * DRIVE_EFFICIENCY / WHEEL_RADIUS;
      }
      if (this.forwardSpeed > 0.15 || this.forwardSpeed < -0.15) {
        brakeMag = brake * this.mass * G * BRAKE_ACCEL_G * this.car.brake * moving;
      }
    }

    const layout = this.car.layout;
    const driveFrontShare = layout === 'AWD' ? 0.42 : layout === 'FWD' ? 1 : 0;
    const handbrakeForce = handbrake * longGrip * FzRear * 1.15 *
      clamp(speedAbs / 0.8, 0, 1);

    // Load-proportional brake balance. Under heavy braking the front axle
    // carries more load and therefore does more of the stopping.
    const loadShare = FzFront / Math.max(1, FzFront + FzRear);
    const brakeBias = clamp(loadShare + 0.015, 0.52, 0.9);
    const brakeFrontReq = brakeMag * brakeBias;
    const brakeRearReq = brakeMag * (1 - brakeBias);

    const capFront = longGrip * FzFront * 0.97;
    const capRear = longGrip * FzRear * 0.97;
    const brakeDemand = brakeMag + handbrakeForce;
    this.brakeLock = clamp((brakeDemand / Math.max(1, capFront + capRear) - 0.92) / 0.32, 0, 1);

    const desiredFront = driveForce * driveFrontShare +
      engineBrakeForce * driveFrontShare - wheelTravelDir * brakeFrontReq;
    const desiredRear = driveForce * (1 - driveFrontShare) +
      engineBrakeForce * (1 - driveFrontShare) -
      wheelTravelDir * (brakeRearReq + handbrakeForce);

    const driveDemand = Math.abs(driveForce);
    const driveCapacity = driveFrontShare * capFront + (1 - driveFrontShare) * capRear;
    this.wheelspin = throttle > 0.1
      ? clamp((driveDemand / Math.max(1, driveCapacity) - 0.95) / 0.35, 0, 1)
      : 0;

    const FxFront = clamp(desiredFront, -capFront, capFront);
    const FxRear = clamp(desiredRear, -capRear, capRear);

    // Combined slip: longitudinal force eats into the lateral capacity.
    const fxF = clamp(Math.abs(FxFront) / Math.max(1, longGrip * FzFront), 0, 0.999);
    const fxR = clamp(Math.abs(FxRear) / Math.max(1, longGrip * FzRear), 0, 0.999);
    let latFront = latGrip * 0.92 * FzFront * Math.sqrt(1 - fxF * fxF);
    let latRear = latGrip * 1.08 * FzRear * Math.sqrt(1 - fxR * fxR);
    latRear *= 1 - 0.8 * handbrake;

    // ---- lateral tyre forces (bicycle model) ----
    const contactSpeed = Math.hypot(u0, v0);
    const forceScale = clamp(contactSpeed / 1.4, 0, 1);
    const peakSlip = 0.13 + (1 - surfaceGrip) * 0.07;
    const slipDen = Math.max(Math.abs(u0), 1.2);
    const travelSign = u0 < -0.05 ? -1 : 1;
    const alphaF = clamp(Math.atan2(v0 + r0 * this.lF, slipDen) -
      this.steer * travelSign, -1.35, 1.35);
    const alphaR = clamp(Math.atan2(v0 - r0 * this.lR, slipDen), -1.35, 1.35);
    const FyFront = this._tireLateral(alphaF, latFront, peakSlip) * forceScale;
    const FyRear = this._tireLateral(alphaR, latRear, peakSlip) * forceScale;

    // ---- body forces and integration ----
    const cosSteer = Math.cos(this.steer);
    const sinSteer = Math.sin(this.steer);
    const FxBody = FxFront * cosSteer - FyFront * sinSteer + FxRear;
    const FyBody = FxFront * sinSteer + FyFront * cosSteer + FyRear;
    let yawMoment = this.lF * (FxFront * sinSteer + FyFront * cosSteer) - this.lR * FyRear;
    // Tyre relaxation and aero give a small amount of yaw damping. Without it
    // a saturated bicycle model keeps rotating after the grip has gone.
    const rearSlipLoad = clamp(Math.abs(alphaR) / peakSlip - 0.8, 0, 1.2);
    yawMoment -= this.yawRate * this.mass *
      (0.7 + 0.01 * speedAbs + 2.4 * rearSlipLoad);

    const grade = info.tangent.y;
    const rolling = -surfaceDistanceSign(u0) * this.mass * G *
      this._rollingCoefficient(info, offRoad) * clamp(Math.abs(u0) / 0.4, 0, 1);
    const drag = -0.5 * RHO * this.dragCdA * u0 * Math.abs(u0);

    let uDot = FxBody / this.mass + this.yawRate * v0 + rolling / this.mass +
      drag / this.mass - G * grade;
    let vDot = FyBody / this.mass - this.yawRate * u0;
    let rDot = yawMoment / this.inertia;

    let u1 = u0 + uDot * dt;
    let v1 = v0 + vDot * dt;
    let r1 = r0 + rDot * dt;

    // Low-speed settling keeps the car from jittering when stationary.
    if (speedAbs < 0.35 && throttle < 0.02 && brake < 0.02) {
      v1 *= Math.exp(-7 * dt);
      r1 *= Math.exp(-7 * dt);
    }
    if (Math.abs(u1) < 0.04 && throttle < 0.02 && brake < 0.02) u1 = 0;
    if (u1 > topSpeed * 1.02) u1 = topSpeed * 1.02;
    if (u1 < -9) u1 = -9;
    r1 = clamp(r1, -3.2, 3.2);

    this.forwardSpeed = u1;
    this.vLat = v1;
    this.yawRate = r1;
    this.yaw += r1 * dt;

    const nfwdX = Math.sin(this.yaw);
    const nfwdZ = Math.cos(this.yaw);
    const nleftX = Math.cos(this.yaw);
    const nleftZ = -Math.sin(this.yaw);
    this.vel.set(
      nfwdX * u1 + nleftX * v1,
      0,
      nfwdZ * u1 + nleftZ * v1,
    );
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.odometer += Math.abs(u1) * dt;

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
          this.forwardSpeed = this.vel.x * nfwdX + this.vel.z * nfwdZ;
          this.vLat = this.vel.x * nleftX + this.vel.z * nleftZ;
          this.lateralSpeed = -this.vLat;
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
      const outward = this.vel.x * r.x + this.vel.z * r.z;
      if (outward * side > 0) {
        this.vel.x -= r.x * outward * 1.5;
        this.vel.z -= r.z * outward * 1.5;
      }
      this.vel.x *= 0.55;
      this.vel.z *= 0.55;
      this.forwardSpeed = this.vel.x * nfwdX + this.vel.z * nfwdZ;
      this.vLat = this.vel.x * nleftX + this.vel.z * nleftZ;
      this.lateralSpeed = -this.vLat;
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

    // Measured acceleration drives the visual attitude and the load transfer
    // used by the next physics step.
    this.accelLong = clamp((this.forwardSpeed - u0) / Math.max(dt, 1e-4), -30, 30);
    this.latAccel = FyBody / this.mass;
    this.lateralSpeed = -this.vLat;
    // Use the driveline/brake force rather than the post-slide acceleration.
    // Lateral scrub can otherwise dump all the weight on the front axle mid-
    // corner and spin the car even when the driver has not touched the brake.
    const transferCap = this.mass * G * 0.12;
    const longitudinalForce = FxFront + FxRear + rolling + drag;
    const transferAccel = longitudinalForce / this.mass - G * grade;
    const transferTarget = clamp(
      this.mass * clamp(transferAccel, -20, 20) * this.cgHeight / this.wheelbase,
      -transferCap, transferCap,
    );
    this.loadTransfer = damp(this.loadTransfer, transferTarget, 12, dt);

    const targetPitch = -Math.asin(clamp(info.tangent.y, -1, 1)) -
      clamp(this.accelLong, -18, 18) * 0.0052;
    const targetRoll = clamp(this.latAccel * 0.0095 * Math.min(1.15, weightRatio), -0.13, 0.13);
    this.pitch = damp(this.pitch, targetPitch, 8, dt);
    this.roll = damp(this.roll, targetRoll, 8, dt);

    this.speedKph = Math.abs(this.forwardSpeed) * 3.6;
    this.wheelRotation += (this.forwardSpeed / WHEEL_RADIUS) * dt;

    // ---- finish ----
    if (!track.endless) {
      const finishDist = track.finishGateIndex != null
        ? track.samples[track.finishGateIndex].dist - 1.5
        : track.length - 6;
      if (!this.finished && info.dist >= finishDist) {
        this.finished = true;
      }
    }
    return info;
  }

  resetToTrack(track) {
    this.reset(track, false);
    this.track.lastIndexHint = -1;
  }
}
