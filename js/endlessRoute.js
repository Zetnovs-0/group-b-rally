/* ============================================================
   ENDLESS ROUTE GENERATOR
   Builds one sample of rally road at a time. The track layer keeps
   the sample history and streams geometry chunks around the car.
   ============================================================ */

import { clamp, mulberry32 } from './util.js';

const PROFILES = {
  forest: {
    cornerMin: 20, cornerMax: 105, angleMin: 22, angleMax: 112,
    straightMin: 45, straightMax: 185, straightBias: 0.27,
    gradeAmp: 0.065, gradeShift: 95,
  },
  jungle: {
    cornerMin: 13, cornerMax: 66, angleMin: 30, angleMax: 138,
    straightMin: 16, straightMax: 88, straightBias: 0.17,
    gradeAmp: 0.072, gradeShift: 72,
  },
  snow: {
    cornerMin: 46, cornerMax: 185, angleMin: 18, angleMax: 90,
    straightMin: 105, straightMax: 270, straightBias: 0.36,
    gradeAmp: 0.036, gradeShift: 120,
  },
  japan: {
    cornerMin: 10, cornerMax: 54, angleMin: 36, angleMax: 165,
    straightMin: 16, straightMax: 92, straightBias: 0.14,
    gradeAmp: 0.078, gradeShift: 62,
  },
  russia: {
    cornerMin: 38, cornerMax: 150, angleMin: 18, angleMax: 104,
    straightMin: 115, straightMax: 310, straightBias: 0.33,
    gradeAmp: 0.058, gradeShift: 105,
  },
  safari: {
    cornerMin: 52, cornerMax: 210, angleMin: 16, angleMax: 98,
    straightMin: 135, straightMax: 350, straightBias: 0.35,
    gradeAmp: 0.068, gradeShift: 118,
  },
};

export function endlessProfile(biome) {
  return PROFILES[biome] || PROFILES.forest;
}

export class EndlessRoute {
  constructor(seed, biome, step = 1.7) {
    this.rng = mulberry32((seed >>> 0) + 0x5eed);
    this.profile = endlessProfile(biome);
    this.step = step;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.dist = 0;
    this.heading = 0;
    this.curvature = 0;
    this.targetCurvature = 0;
    this.grade = 0;
    this.targetGrade = 0;
    this.sectionRemaining = 78; // start straight
    this.sectionKind = 'straight';
    this.gradeRemaining = 140;
    this.nextSectionKind = 'corner';
    // The route stays inside a gently wandering heading envelope. This keeps
    // the road progressing forward and makes self-crossing impossible, which
    // matters because terrain chunks are corridor-shaped.
    this.headingPhase = this.rng() * Math.PI * 2;
    this.headingPhase2 = this.rng() * Math.PI * 2;
  }

  baseHeading() {
    return 0.24 * Math.sin(this.dist * 0.00062 + this.headingPhase) +
      0.10 * Math.sin(this.dist * 0.0017 + this.headingPhase2);
  }

  sample() {
    const pitch = Math.atan(this.grade);
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      dist: this.dist,
      heading: this.heading,
      grade: this.grade,
      pitch,
      curvature: this.curvature,
    };
  }

  advance() {
    this._advanceSection(this.step);
    // Keep curvature changes physical rather than snapping between corners.
    const k = 1 - Math.exp(-this.step / 5.4);
    this.curvature += (this.targetCurvature - this.curvature) * k;
    this.heading += this.curvature * this.step;
    // Absolute safety rail: the generated road always advances in +Z, so
    // streamed corridor geometry can never double back over the car.
    if (this.heading > 1.3) {
      this.heading = 1.3;
      this.curvature = Math.min(this.curvature, 0);
      this.targetCurvature = Math.min(this.targetCurvature, 0);
    } else if (this.heading < -1.3) {
      this.heading = -1.3;
      this.curvature = Math.max(this.curvature, 0);
      this.targetCurvature = Math.max(this.targetCurvature, 0);
    }
    this.grade += (this.targetGrade - this.grade) * (1 - Math.exp(-this.step / 15));
    if (Math.abs(this.y) > 38) {
      this.targetGrade = clamp(this.targetGrade - Math.sign(this.y) * 0.035, -0.13, 0.13);
    }
    const cosPitch = Math.cos(Math.atan(this.grade));
    this.x += Math.sin(this.heading) * this.step * cosPitch;
    this.z += Math.cos(this.heading) * this.step * cosPitch;
    this.y += this.grade * this.step;
    this.dist += this.step;
    this._advanceGrade(this.step);
    return this.sample();
  }

  _advanceSection(dt) {
    this.sectionRemaining -= dt;
    if (this.sectionRemaining > 0) return;
    const p = this.profile;
    const rng = this.rng;
    // Avoid three straights in a row on the fast profiles.
    let kind;
    if (this.sectionKind === 'straight' && this.nextSectionKind === 'straight') {
      kind = 'corner';
    } else {
      kind = rng() < p.straightBias ? 'straight' : 'corner';
    }
    if (this.sectionKind === 'corner' && rng() < 0.16) kind = 'corner';
    this.sectionKind = kind;
    if (kind === 'straight') {
      const len = p.straightMin + rng() * (p.straightMax - p.straightMin);
      this.targetCurvature = 0;
      this.sectionRemaining = len;
      this.nextSectionKind = 'corner';
    } else {
      const t = Math.pow(rng(), 1.35);
      const radius = p.cornerMin + t * (p.cornerMax - p.cornerMin);
      let angle = (p.angleMin + rng() * (p.angleMax - p.angleMin)) * Math.PI / 180;
      const rel = Math.atan2(Math.sin(this.heading - this.baseHeading()),
        Math.cos(this.heading - this.baseHeading()));
      // Prefer the direction that brings us back toward the envelope.
      let dir;
      if (rel > 0.24) dir = -1;
      else if (rel < -0.24) dir = 1;
      else dir = rng() < 0.5 ? -1 : 1;
      const allowed = Math.max(0.18, 0.7 - Math.abs(rel) * 0.6);
      angle = Math.min(angle, allowed);
      let length = radius * angle;
      let useRadius = radius;
      if (length < 22) {
        length = 22;
        useRadius = length / Math.max(angle, 0.2);
      }
      this.targetCurvature = dir / useRadius;
      this.sectionRemaining = length;
      this.nextSectionKind = rng() < 0.26 ? 'corner' : 'straight';
    }
  }

  _advanceGrade(dt) {
    this.gradeRemaining -= dt;
    if (this.gradeRemaining > 0) return;
    const p = this.profile;
    const rng = this.rng;
    let g = (rng() * 2 - 1) * p.gradeAmp;
    // occasional blind crest / compression
    if (rng() < 0.18) g *= 1.7;
    if (Math.abs(this.y) > 24) g = -Math.sign(this.y) * Math.abs(g) * 0.7;
    this.targetGrade = clamp(g, -0.14, 0.14);
    this.gradeRemaining = p.gradeShift * (0.55 + rng() * 0.9);
  }
}
