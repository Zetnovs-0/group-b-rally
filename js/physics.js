import * as THREE from 'three';
import { clamp, damp } from './util.js';

const G = 9.81;
const RHO = 1.225;
const WHEEL_RADIUS = 0.335;
const DRIVE_EFFICIENCY = 0.9;
// Longitudinal capacity is deliberately a little higher than the lateral
// capacity: braking and traction should feel positive instead of greasy.
const LONG_GRIP_GAIN = 2.05;
const BRAKE_ACCEL_G = 1.92;
const MAX_DRIVE_GRADE = 0.58;   // above ~30 degrees, engine torque fades
const MAX_CLIMB_GRADE = 0.72;   // above ~36 degrees the slope is a wall
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

/* ============================================================
   Four-wheel vehicle physics
   The car keeps a planar body state (u/v/yaw), but every tyre now
   has its own ground contact, load, longitudinal demand, spin/lock
   state and lateral slip force. Body attitude is fitted to the four
   actual contact patches, and the actual terrain gradient feeds
   gravity, so off-road hills have real resistance and a steep face
   cannot be driven up like a ladder.
   ============================================================ */
export class CarPhysics {
  constructor(car, track, opts = {}) {
    this.car = car;
    this.track = track;
    this.onImpact = opts.onImpact || null;
    this.onBreak = opts.onBreak || null;
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
    this.terrainGrade = 0;
    this.terrainSideGrade = 0;
    this.onSlopeWall = false;

    // Per-wheel state. The order matches carModel.wheels:
    // front-left(+x), front-right(-x), rear-left(+x), rear-right(-x).
    this.wheelGround = new Float32Array(4);
    this.wheelGrip = new Float32Array(4);
    this.wheelLoad = new Float32Array(4);
    this.wheelTravel = new Float32Array(4);
    this.wheelAngle = new Float32Array(4);
    this.wheelRate = new Float32Array(4);
    this.wheelSteer = new Float32Array(4);
    this.wheelSlip = new Float32Array(4);
    this.wheelLock = new Float32Array(4);
    this.wheelSpin = new Float32Array(4);
    this.wheelContact = new Uint8Array(4);
    this.wheelInfo = new Array(4).fill(null);
    this._wheelPos = new THREE.Vector3();
    this._probePos = new THREE.Vector3();

    this._initVehicle();
    this.reset(track, true);
  }

  /* Physical dimensions and drivetrain parameters. Kept here rather than in the
     per-frame path so the step only has to do arithmetic. */
  _initVehicle() {
    const st = this.car.style;
    this.mass = this.car.weight;
    this.wheelbase = st.length * 0.56;
    this.frontWeight = clamp(this.car.frontWeight ?? 0.55, 0.35, 0.68);
    this.lF = this.wheelbase * 0.5;
    this.lR = this.wheelbase * 0.5;
    this.halfTrack = st.width * 0.5 - 0.12;
    this.trackWidth = this.halfTrack * 2;
    this.cgHeight = 0.47;
    this.inertia = this.mass * (st.length * st.length + st.width * st.width) / 12 * 1.08;
    this.dragCdA = 0.72 + st.width * 0.1 + (st.wing === 'big' ? 0.08 : 0);
    this.liftCdA = 0.2 + (st.wing === 'big' ? 0.24 : 0.08);
    const topMs = this.car.topSpeed / 3.6;
    this.finalDrive = (7600 * Math.PI / 30) / (topMs / WHEEL_RADIUS) / GEAR_RATIOS[5];
    const peakPowerW = this.car.power * 745.7;
    const peakOmega = 6500 * Math.PI / 30;
    this.peakTorque = peakPowerW / peakOmega / this._torqueFactor(6500);
    this.wheels = [
      { x: this.halfTrack, z: this.lF, front: true },
      { x: -this.halfTrack, z: this.lF, front: true },
      { x: this.halfTrack, z: -this.lR, front: false },
      { x: -this.halfTrack, z: -this.lR, front: false },
    ];
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
    this.terrainGrade = 0;
    this.terrainSideGrade = 0;
    this.onSlopeWall = false;
    this.wheelGround.fill(this.pos.y);
    this.wheelGrip.fill(1);
    this.wheelLoad.fill(0);
    this.wheelTravel.fill(0);
    this.wheelAngle.fill(0);
    this.wheelRate.fill(0);
    this.wheelSteer.fill(0);
    this.wheelSlip.fill(0);
    this.wheelLock.fill(0);
    this.wheelSpin.fill(0);
    this.wheelContact.fill(1);
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
    if (offRoad) c *= 1.55;
    return c;
  }

  /* Slip curve: rises steeply for the first few degrees, peaks, then falls
     away gently. The old linear rise made small steering inputs feel dead. */
  _tireLateral(alpha, maxForce, peakSlip) {
    const mag = Math.abs(alpha);
    if (mag < 1e-5) return 0;
    const x = mag / peakSlip;
    const shape = x <= 1 ? x * (2 - x) : 0.9 + 0.1 * Math.exp(-(x - 1) * 0.9);
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
    } else if (this.forwardSpeed < 0.22 && brake > 0.15 && throttle < 0.08) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.55) {
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

  /** Ackermann-ish front wheel angles. The inner wheel turns a little more
   *  than the rack angle, the outer a little less. */
  _frontWheelAngles(angle) {
    const mag = Math.abs(angle);
    if (mag < 1e-4) return [0, 0];
    const sign = Math.sign(angle);
    const radius = this.wheelbase / Math.max(0.05, Math.tan(mag));
    const innerR = Math.max(this.wheelbase * 0.8, radius - this.halfTrack);
    const outerR = Math.max(this.wheelbase * 0.9, radius + this.halfTrack);
    const inner = Math.atan(this.wheelbase / innerR);
    const outer = Math.atan(this.wheelbase / outerR);
    // Positive steer points left, so the +x (left) wheel is the inner one.
    // For a right turn both angles must be negative as well; the old helper
    // returned positive angles here, which made the car steer left when the
    // player asked for right lock.
    return sign > 0 ? [inner, outer] : [-outer, -inner];
  }

  step(dt, input, track) {
    if (!this.info) this.info = track.nearestGlobal(this.pos);
    let info = track.driveAt(this.pos, track.lastIndexHint);
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
    const surfaceGrip = Math.max(0.12, info.grip * (offRoad ? 0.82 : 1));
    const topSpeed = this.car.topSpeed / 3.6;
    const speedAbs = Math.abs(this.forwardSpeed);
    const weightRatio = this.car.weight / 950;

    // ---- steering ----
    // More lock and a faster rack than before, but still speed-sensitive so
    // the car does not become twitchy at 200 km/h.
    const authority = clamp(1 / (1 + speedAbs * 0.038), 0.30, 1);
    const steerLock = THREE.MathUtils.degToRad(36) * authority /
      Math.pow(weightRatio, 0.045);
    const targetSteer = steerTarget * steerLock;
    const steerRate = (7.2 - Math.min(2.4, speedAbs * 0.035)) /
      Math.pow(weightRatio, 0.04);
    const returnRate = Math.abs(steerTarget) < 0.02 ? steerRate * 1.5 : steerRate;
    const dSteer = clamp(targetSteer - this.steer, -returnRate * dt, returnRate * dt);
    this.steer += dSteer;
    this.steerInput = steerTarget;

    // ---- drivetrain ----
    this._updateDriveline(dt, throttle, brake);

    // ---- vehicle axes and previous-step load transfer ----
    const u0 = this.forwardSpeed;
    const v0 = this.vLat;
    const r0 = this.yawRate;
    let latGrip = Math.max(0.1, this.car.grip * surfaceGrip * 1.10);
    // A small mechanical grip floor stops the car feeling like it is on ice
    // even when the surface is loose.
    latGrip = Math.max(latGrip, 0.70);
    const longGrip = latGrip * LONG_GRIP_GAIN;
    const downforce = 0.5 * RHO * this.liftCdA * u0 * u0;
    this.downforce = downforce;

    const staticFront = this.mass * G * this.frontWeight + downforce * this.frontWeight;
    const staticRear = this.mass * G * (1 - this.frontWeight) + downforce * (1 - this.frontWeight);
    const transfer = this.loadTransfer;
    const FzFront = Math.max(this.mass * G * 0.03, staticFront - transfer);
    const FzRear = Math.max(this.mass * G * 0.03, staticRear + transfer);
    const latTransfer = clamp(
      this.mass * this.latAccel * this.cgHeight / Math.max(0.5, this.trackWidth),
      -this.mass * G * 0.30, this.mass * G * 0.30,
    );

    const wheelTravelDir = this.forwardSpeed < -0.15 ? -1 : 1;
    const moving = clamp(speedAbs / 1.2, 0, 1);

    // Longitudinal demands. In reverse the brake pedal becomes reverse
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

    // ---- per-wheel surface contacts ----
    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    const leftX = Math.cos(this.yaw);
    const leftZ = -Math.sin(this.yaw);
    const wheelHints = info.index;
    let frontH = 0;
    let rearH = 0;
    let leftH = 0;
    let rightH = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const wx = this.pos.x + leftX * w.x + fwdX * w.z;
      const wz = this.pos.z + leftZ * w.x + fwdZ * w.z;
      this._wheelPos.set(wx, this.pos.y, wz);
      let wi;
      try {
        wi = track.driveAt(this._wheelPos, wheelHints);
      } catch {
        wi = info;
      }
      this.wheelInfo[i] = wi;
      const h = wi.height;
      this.wheelGround[i] = h;
      this.wheelGrip[i] = Math.max(0.12, wi.grip * (wi.offRoad ? 0.82 : 1));
      if (w.front) frontH += h * 0.5;
      else rearH += h * 0.5;
      if (w.x >= 0) leftH += h * 0.5;
      else rightH += h * 0.5;
    }
    let grade = clamp((frontH - rearH) / Math.max(0.5, this.wheelbase), -1.5, 1.5);
    let sideGrade = clamp((leftH - rightH) / Math.max(0.5, this.trackWidth), -1.5, 1.5);
    this.terrainGrade = grade;
    this.terrainSideGrade = sideGrade;
    const slopeCos = 1 / Math.sqrt(1 + grade * grade + sideGrade * sideGrade);

    // Weight transfer under the previous step's acceleration. Front wheels lose
    // load under power, rear wheels lose it under braking.
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const axle = w.front ? FzFront : FzRear;
      let load = axle * 0.5 - latTransfer * (w.x >= 0 ? 1 : -1);
      load = Math.max(this.mass * G * 0.035, load) * slopeCos;
      this.wheelLoad[i] = load;
    }

    // ---- tyre forces ----
    const driveFrontShare = this.car.layout === 'AWD' ? 0.42 : this.car.layout === 'FWD' ? 1 : 0;
    const loadShare = FzFront / Math.max(1, FzFront + FzRear);
    const brakeBias = clamp(loadShare + 0.015, 0.52, 0.9);
    const brakeFrontReq = brakeMag * brakeBias;
    const brakeRearReq = brakeMag * (1 - brakeBias);
    const rearHandForce = handbrake * longGrip * FzRear * 1.18 *
      clamp(speedAbs / 0.8, 0, 1);
    // Power fades on very steep climbs; gravity does most of the work of
    // stopping an attempted cliff ascent.
    const powerScale = clamp(1 - Math.max(0, grade - MAX_DRIVE_GRADE) * 2.6, 0.08, 1);
    driveForce *= powerScale;
    engineBrakeForce *= powerScale;

    const steerAngles = this._frontWheelAngles(this.steer);
    const peakSlip = 0.105 + (1 - surfaceGrip) * 0.045;
    let FxBody = 0;
    let FzBody = 0;
    let yawMoment = 0;
    let spinDemand = 0;
    let lockDemand = 0;
    let rearSlipLoad = 0;

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const load = this.wheelLoad[i];
      // Grip is per contact patch: one wheel on the verge does not get the
      // same grip as the three still on the carriageway.
      const wheelLatGrip = Math.max(0.45, this.car.grip * this.wheelGrip[i] * 1.10);
      const wheelLongGrip = wheelLatGrip * LONG_GRIP_GAIN;
      const cap = Math.max(1, wheelLongGrip * load * 0.985);
      const axleDriveShare = w.front ? driveFrontShare : (1 - driveFrontShare);
      const wheelDrive = driveForce * axleDriveShare * 0.5;
      const wheelEngineBrake = engineBrakeForce * axleDriveShare * 0.5;
      const wheelBrake = (w.front ? brakeFrontReq : brakeRearReq) * 0.5;
      const wheelHand = !w.front ? rearHandForce * 0.5 : 0;
      const desired = wheelDrive + wheelEngineBrake -
        wheelTravelDir * (wheelBrake + wheelHand);
      const Fx = clamp(desired, -cap, cap);
      const fxi = clamp(Math.abs(Fx) / cap, 0, 0.999);
      const fxDemand = Math.abs(desired) / cap;
      spinDemand = Math.max(spinDemand, wheelDrive > 0 ? Math.max(0, fxDemand - 0.94) : 0);
      lockDemand = Math.max(lockDemand, Math.max(0, fxDemand - 0.94));

      let latCap = wheelLatGrip * (w.front ? 0.99 : 1.04) * load *
        Math.sqrt(1 - fxi * fxi);
      // A tyre cannot hold a car on a very steep side-slope. Let it slide.
      latCap *= clamp(1 - Math.max(0, Math.abs(sideGrade) - 0.38) * 1.15, 0.42, 1);
      if (!w.front) latCap *= 1 - 0.8 * handbrake;

      const vLongBody = u0 - r0 * w.x;
      const vLatBody = v0 + r0 * w.z;
      const delta = w.front ? steerAngles[i] : 0;
      const cosD = Math.cos(delta);
      const sinD = Math.sin(delta);
      const vLong = vLongBody * cosD + vLatBody * sinD;
      const vLatWheel = vLatBody * cosD - vLongBody * sinD;
      const slipDen = Math.max(Math.abs(vLong), 1.2);
      const alpha = clamp(Math.atan2(vLatWheel, slipDen), -1.35, 1.35);
      const forceScale = clamp(Math.hypot(vLong, vLatWheel) / 1.4, 0, 1);
      const Fy = this._tireLateral(alpha, latCap, peakSlip) * forceScale;
      this.wheelSlip[i] = Math.abs(alpha) / peakSlip;
      this.wheelLock[i] = clamp((fxDemand - 0.94) / 0.3, 0, 1);
      this.wheelSpin[i] = wheelDrive > 0 ? clamp((fxDemand - 0.94) / 0.3, 0, 1) : 0;
      if (!w.front) rearSlipLoad = Math.max(rearSlipLoad, this.wheelSlip[i]);

      // Body-frame force from this wheel.
      const fxBody = Fx * sinD + Fy * cosD;
      const fzBody = Fx * cosD - Fy * sinD;
      FxBody += fxBody;
      FzBody += fzBody;
      // Longitudinal drive/brake forces are treated as axle-symmetric.
      // Letting per-wheel clamping generate yaw torque made the car spin as
      // soon as an inside wheel unloaded; the lateral forces still provide
      // the real turn-in / rear-breakaway balance.
      yawMoment += w.z * fxBody;

      // Wheel spin / lock visual state.
      let targetRate = vLong / WHEEL_RADIUS;
      if (this.wheelLock[i] > 0.55 && Math.abs(wheelBrake + wheelHand) > 1) targetRate = 0;
      if (this.wheelSpin[i] > 0.25) targetRate = Math.max(targetRate, 8 + this.wheelSpin[i] * 34);
      this.wheelRate[i] = damp(this.wheelRate[i], targetRate, 16, dt);
      this.wheelAngle[i] += this.wheelRate[i] * dt;

      this.wheelSteer[i] = delta;
    }

    this.wheelspin = spinDemand;
    this.brakeLock = lockDemand;

    // ---- body forces and integration ----
    const rolling = -surfaceDistanceSign(u0) * this.mass * G *
      this._rollingCoefficient(info, offRoad) * clamp(Math.abs(u0) / 0.4, 0, 1);
    const drag = -0.5 * RHO * this.dragCdA * u0 * Math.abs(u0);
    const uphillLoss = grade > 0.5 ? G * (grade - 0.5) * 1.35 : 0;
    const downhillGain = grade < -0.5 ? G * (-grade - 0.5) * 0.25 : 0;

    let uDot = FzBody / this.mass + r0 * v0 + rolling / this.mass +
      drag / this.mass - G * grade - uphillLoss + downhillGain;
    let vDot = FxBody / this.mass - r0 * u0 - G * sideGrade;
    let rDot = yawMoment / this.inertia;

    // Tyre relaxation and aero damping. The per-wheel forces already provide
    // most of the self-centring, so this is much lighter than before.
    rDot -= r0 * (0.42 + 0.006 * speedAbs + 0.85 * clamp(rearSlipLoad - 0.85, 0, 1.2));

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

    this.vel.set(
      fwdX * u1 + leftX * v1,
      0,
      fwdZ * u1 + leftZ * v1,
    );
    const oldX = this.pos.x;
    const oldZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.odometer += Math.abs(u1) * dt;

    // ---- steep-face constraint ----
    // Sample the ground where the car is trying to move. If the rise over the
    // travelled distance is steeper than a climbable face, treat it as a wall.
    const stepDist = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);
    this.onSlopeWall = false;
    let probeInfo = null;
    let positionChanged = false;
    if (stepDist > 0.002) {
      this._probePos.set(this.pos.x, this.pos.y, this.pos.z);
      probeInfo = track.driveAt(this._probePos, info.index);
      const rise = probeInfo.height - info.height;
      // Use a minimum baseline so sub-centimetre numerical movement cannot
      // turn a gentle road crest into a fake vertical wall.
      const slopeDist = Math.max(stepDist, 0.05);
      const faceSlope = rise / slopeDist;
      if (faceSlope > MAX_CLIMB_GRADE && speedAbs > 0.4) {
        this.pos.x = oldX;
        this.pos.z = oldZ;
        this.vel.set(0, 0, 0);
        this.forwardSpeed = Math.min(0, u1 * 0.12);
        this.vLat *= 0.35;
        this.yawRate *= 0.6;
        this.onSlopeWall = true;
        probeInfo = null;
        if (this.impactCooldown <= 0 && speedAbs > 4) {
          this.impactCooldown = 0.55;
          if (this.onImpact) this.onImpact(Math.min(1, speedAbs / 24), 'slope');
        }
      }
    }

    // ---- solid start/finish gantry posts ----
    if (track.gateColliders) {
      for (const c of track.gateColliders) {
        const dx = this.pos.x - c.x;
        const dz = this.pos.z - c.z;
        const rr = c.r + 0.82;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          positionChanged = true;
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
          this.forwardSpeed = this.vel.x * fwdX + this.vel.z * fwdZ;
          this.vLat = this.vel.x * leftX + this.vel.z * leftZ;
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

    // ---- soft world edge (far outside the drivable corridor) ----
    const bound = track.worldBound || 240;
    const mainLat = info.mainLateral != null ? info.mainLateral : info.lateral;
    if (Math.abs(mainLat) > bound) {
      positionChanged = true;
      const side = Math.sign(mainLat) || 1;
      const center = info.mainCenter || info.center;
      const right = info.mainRight || info.right;
      this.pos.x = center.x + right.x * side * bound;
      this.pos.z = center.z + right.z * side * bound;
      const outward = this.vel.x * right.x + this.vel.z * right.z;
      if (outward * side > 0) {
        this.vel.x -= right.x * outward * 1.35;
        this.vel.z -= right.z * outward * 1.35;
      }
      this.vel.x *= 0.78;
      this.vel.z *= 0.78;
      this.yawRate *= 0.6;
      this._rebuildBodySpeeds();
    }

    // ---- solid / breakable scenery ----
    if (this._resolvePropCollisions(track)) positionChanged = true;

    // ---- ground follow and body attitude ----
    // The probe sample already describes the ground under the new position;
    // only pay for another query when a collision actually moved the car.
    if (positionChanged || !probeInfo) {
      probeInfo = track.driveAt(this.pos, track.lastIndexHint);
    }
    info = probeInfo;
    this.info = info;
    const targetGround = info.height;
    const maxRise = Math.max(0.02, Math.abs(this.forwardSpeed) * dt * MAX_CLIMB_GRADE + 0.07);
    if (targetGround > this.pos.y + maxRise) this.pos.y += maxRise;
    else this.pos.y = damp(this.pos.y, targetGround, 28, dt);
    this.visY = this.pos.y;

    const hFL = this.wheelGround[0], hFR = this.wheelGround[1];
    const hRL = this.wheelGround[2], hRR = this.wheelGround[3];
    const frontAvg = (hFL + hFR) * 0.5;
    const rearAvg = (hRL + hRR) * 0.5;
    const leftAvg = (hFL + hRL) * 0.5;
    const rightAvg = (hFR + hRR) * 0.5;
    const groundPitch = -Math.atan2(frontAvg - rearAvg, this.wheelbase);
    const groundRoll = Math.atan2(leftAvg - rightAvg, this.trackWidth);

    // Suspension articulation is the residual after removing the body's
    // fitted contact plane. On a simple slope this is zero (the body already
    // leans to follow it); on a diagonal bump the wheel travels a little.
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const planeY = this.pos.y +
        (frontAvg - rearAvg) / Math.max(0.5, this.wheelbase) * w.z +
        (leftAvg - rightAvg) / Math.max(0.5, this.trackWidth) * w.x;
      const residual = clamp(this.wheelGround[i] - planeY, -0.16, 0.16);
      this.wheelTravel[i] = damp(this.wheelTravel[i], residual, 18, dt);
    }

    this.accelLong = clamp((this.forwardSpeed - u0) / Math.max(dt, 1e-4), -30, 30);
    this.latAccel = damp(this.latAccel, FxBody / this.mass, 13, dt);
    this.lateralSpeed = -this.vLat;

    const transferCap = this.mass * G * 0.14;
    const transferTarget = clamp(
      this.mass * this.accelLong * this.cgHeight / Math.max(0.5, this.wheelbase),
      -transferCap, transferCap,
    );
    this.loadTransfer = damp(this.loadTransfer, transferTarget, 13, dt);

    const targetPitch = clamp(groundPitch - this.accelLong * 0.0032, -0.55, 0.55);
    const targetRoll = clamp(groundRoll +
      this.latAccel * 0.0058 * Math.min(1.1, weightRatio), -0.26, 0.26);
    this.pitch = damp(this.pitch, targetPitch, 11, dt);
    this.roll = damp(this.roll, targetRoll, 11, dt);

    this.speedKph = Math.abs(this.forwardSpeed) * 3.6;
    this.wheelRotation = (this.wheelAngle[0] + this.wheelAngle[1] +
      this.wheelAngle[2] + this.wheelAngle[3]) * 0.25;

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

  _rebuildBodySpeeds() {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const lx = Math.cos(this.yaw);
    const lz = -Math.sin(this.yaw);
    this.forwardSpeed = this.vel.x * fx + this.vel.z * fz;
    this.vLat = this.vel.x * lx + this.vel.z * lz;
    this.lateralSpeed = -this.vLat;
  }

  /** Circle-vs-prop resolution. Trees, rocks, logs and stumps can be knocked
   *  down above their break speed; below that they are solid and stop the car. */
  _resolvePropCollisions(track) {
    const carR = ((this.car.style?.width || 1.7) * 0.5) + 0.16;
    const near = track.collidersNear(this.pos.x, this.pos.z, carR + 3.4);
    if (!near.length) return false;
    let broke = 0;
    let hit = false;
    for (const c of near) {
      if (c.broken || c.removed) continue;
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const rr = c.r + carR;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr * rr) continue;
      let d = Math.sqrt(d2);
      let nx, nz;
      if (d < 1e-4) {
        nx = Math.sin(this.yaw + Math.PI);
        nz = Math.cos(this.yaw + Math.PI);
        d = 1e-4;
      } else {
        nx = dx / d;
        nz = dz / d;
      }
      const speed = Math.hypot(this.vel.x, this.vel.z);
      const vn = this.vel.x * nx + this.vel.z * nz;
      const approach = Math.max(0, -vn);
      const impactSpeed = Math.max(approach, speed * 0.3);
      hit = true;
      if (c.breakSpeed && speed > 1.5 && impactSpeed >= c.breakSpeed && track.breakCollider(c)) {
        // Breaking sheds speed but does not stop the car dead. A heavy tree
        // still takes a big bite out of your momentum.
        const loss = clamp(0.86 - impactSpeed * 0.003, 0.58, 0.86);
        this.vel.x *= loss;
        this.vel.z *= loss;
        this.yawRate += (Math.random() - 0.5) * 0.65 +
          (nx * Math.cos(this.yaw) - nz * Math.sin(this.yaw)) * 0.18;
        broke++;
        if (this.onBreak) this.onBreak(c, impactSpeed);
        continue;
      }
      // Solid: push out and bounce. A glancing hit scrubs speed, a square one
      // stops the car and throws it sideways.
      this.pos.x = c.x + nx * rr;
      this.pos.z = c.z + nz * rr;
      if (vn < 0) {
        this.vel.x -= nx * vn * 1.42;
        this.vel.z -= nz * vn * 1.42;
      }
      this.vel.x *= 0.48;
      this.vel.z *= 0.48;
      this.yawRate *= 0.42;
      this._rebuildBodySpeeds();
      if (this.impactCooldown <= 0 && impactSpeed > 1.6) {
        this.impactCooldown = 0.5;
        if (this.onImpact) this.onImpact(Math.min(1, impactSpeed / 21), c.type || 'tree');
      }
    }
    if (broke) {
      this._rebuildBodySpeeds();
      this.impactCooldown = Math.max(this.impactCooldown, 0.22);
    }
    return hit;
  }
}
