import * as THREE from 'three';
import {
  clamp, lerp, smoothstep, wrapAngle, sign, mulberry32, fbm, nextFrame,
  mergeGeometries, mergeColored, makeCanvasTexture, canvas2D, beamMesh,
} from './util.js';
import {
  makeRoadTexture, makeGroundTexture, makeGroundBumpTexture, makeSunTexture,
  makeBannerTexture, makeStartLightsTexture, drawStartLights, makeFernTexture,
  makeGrassTexture, makeCrowdShirt, makeCloudTexture, makeSkidTexture,
  makeBarkTexture, makeCanopyTexture, makePalmFrondTexture, makeFlowerTexture,
  makeReedTexture, makeRockTexture, makeLeafSurfaceTexture, makeWoodTexture,
  makeIceTexture, makeWaterfallTexture, makeAnimalTexture, makeSoftDotTexture,
} from './textures.js';
import { EndlessRoute } from './endlessRoute.js';

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Object3D();

function partBox(parts, color, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  parts.push({ geometry: g, color });
  return g;
}

function partCyl(parts, color, rTop, rBot, h, seg, x, y, z, rx = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  parts.push({ geometry: g, color });
  return g;
}

function partSphere(parts, color, r, x, y, z, sx = 1, sy = 1, sz = 1, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  parts.push({ geometry: g, color });
  return g;
}

function rngBridge(n) {
  const v = Math.sin(n * 91.73 + 14.17) * 43758.5453;
  return v - Math.floor(v);
}

/* ============================================================
   Stage metrics (shared with the menu)
   ============================================================ */
const metricsCache = new Map();
export function getStageMetrics(stage) {
  if (metricsCache.has(stage.id)) return metricsCache.get(stage.id);
  const pts = stage.route.map(([x, z, y]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
  curve.arcLengthDivisions = 1500;
  const length = curve.getLength();
  const target = length / stage.targetSpeed + 8;
  const map = projectRoute(stage.route);
  const res = { length, target, km: (length / 1000).toFixed(2), map };
  metricsCache.set(stage.id, res);
  return res;
}

function projectRoute(route) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of route) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const pad = 0.09;
  const sx = (1 - pad * 2) / Math.max(1, maxX - minX);
  const sz = (1 - pad * 2) / Math.max(1, maxZ - minZ);
  const s = Math.min(sx, sz);
  const ox = pad + ((1 - pad * 2) - (maxX - minX) * s) / 2;
  const oz = pad + ((1 - pad * 2) - (maxZ - minZ) * s) / 2;
  return route.map(([x, z]) => [ox + (x - minX) * s, oz + (z - minZ) * s]);
}

/* ============================================================
   Track
   ============================================================ */
export class Track {
  constructor(stage, quality = 'high') {
    this.stage = stage;
    this.quality = quality;
    this.env = stage.env;
    this.seed = stage.seed;
    this.endless = !!stage.endless;
    this.halfWidth = stage.width / 2;
    this.roadYOffset = 0.055;
    this.length = 0;
    this.lastIndexHint = 0;
    this.skyTime = 0;
    this.flash = 0;
    this.timeOfDay = this.env.defaultTime || 'day';
    this.chunks = [];
    this._scene = null;
    this._nextChunkSample = 0;
    this.chunkLength = 204;
    this.exclusionZones = [];
    this.windMaterials = [];
    this.windTime = 0;
    this.auroraStrength = 0;
    this.motes = null;
    this.moteCount = 0;
    this.featureMeshes = [];
    this.landmarks = {};

    this._buildSamples();
    this._buildHazards();
    this._buildPacenotes();
    this._buildMapProjection();
    this._buildGripProfiles();
  }

  /* ---------------- sampling ---------------- */
  _buildSamples() {
    if (this.endless) {
      this._buildEndlessSamples();
      return;
    }
    const stage = this.stage;
    const points = stage.route.map(([x, z, y]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
    curve.arcLengthDivisions = 2500;
    this.curve = curve;
    this.length = curve.getLength();
    this.step = 1.7;
    const n = Math.max(8, Math.ceil(this.length / this.step) + 1);
    const raw = curve.getSpacedPoints(n - 1);
    this.samples = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      const a = raw[Math.max(0, i - 1)];
      const b = raw[Math.min(raw.length - 1, i + 1)];
      const tangent = new THREE.Vector3().subVectors(b, a).normalize();
      const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const heading = Math.atan2(tangent.x, tangent.z);
      const dist = (i / (raw.length - 1)) * this.length;
      this.samples.push({
        i, pos: p.clone(), tangent, right, heading, dist,
        curvature: 0, curvatureSmooth: 0, grip: 1, hazard: null, hazardLabel: null,
        surfaceName: this.env.surfaceName, grade: tangent.y,
      });
    }
    this.n = this.samples.length;
    // curvature
    for (let i = 0; i < this.n; i++) {
      const a = this.samples[Math.max(0, i - 2)];
      const b = this.samples[Math.min(this.n - 1, i + 2)];
      const dh = wrapAngle(b.heading - a.heading);
      const ds = Math.max(0.2, b.dist - a.dist);
      this.samples[i].curvature = dh / ds;
    }
    // smooth curvature + grade
    for (let i = 0; i < this.n; i++) {
      let c = 0, g = 0, cnt = 0;
      for (let k = -3; k <= 3; k++) {
        const j = clamp(i + k, 0, this.n - 1);
        c += this.samples[j].curvature;
        g += this.samples[j].tangent.y;
        cnt++;
      }
      this.samples[i].curvatureSmooth = c / cnt;
      this.samples[i].grade = g / cnt;
    }
    // side terrain slope variation (smooth along stage)
    this.sideSlope = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const d = this.samples[i].dist;
      this.sideSlope[i] = Math.sin(d * 0.008 + this.seed * 0.01) * 0.85 +
        Math.sin(d * 0.0026 + 2.4) * 1.1 + Math.sin(d * 0.017 + 0.6) * 0.28;
    }
  }

  /* ============================================================
     ENDLESS ROUTE
     ============================================================ */
  _buildEndlessSamples() {
    this.samples = [];
    this.sideSlope = [];
    this.n = 0;
    this.length = 0;
    this.step = 1.7;
    this.hazardPatches = [];
    this.notes = [];
    this.path = new EndlessRoute(this.seed, this.stage.biome, this.step);
    this._hazardTable = this._hazardTableForBiome(this.stage.biome);
    this._hazardRng = mulberry32(this.seed * 7 + 13);
    this._nextHazardEnd = 250 + this._hazardRng() * 170;
    this._lastCrestDist = -200;
    this._noteState = {
      inCorner: false, start: 0, maxCurv: 0, minRadius: Infinity,
      prevCornerEndDist: 0,
    };
    this._extendEndlessSamples(1500);
  }

  _extendEndlessSamples(metres) {
    const first = this.samples.length;
    const target = (this.samples.length ? this.samples[this.samples.length - 1].dist : 0) + metres;
    const path = this.path;
    if (!this.samples.length) {
      this._pushEndlessSample(path.sample());
      path.advance();
    }
    while (path.dist <= target) {
      this._pushEndlessSample(path.sample());
      path.advance();
    }
    const n = this.samples.length;
    // local smoothing of curvature + grade keeps the streamed joins seamless
    for (let i = Math.max(0, first - 4); i < n; i++) {
      let c = 0, g = 0, cnt = 0;
      for (let k = -3; k <= 3; k++) {
        const j = clamp(i + k, 0, n - 1);
        c += this.samples[j].curvature;
        g += this.samples[j].tangent.y;
        cnt++;
      }
      this.samples[i].curvatureSmooth = c / cnt;
      this.samples[i].grade = g / cnt;
    }
    this.n = n;
    this.length = this.samples[n - 1].dist;
    this._scanEndlessNotes(first);
    this._addEndlessHazards(first);
    this._applyEndlessGrip(first);
    this._sortEndlessNotes();
    return this.length;
  }

  _pushEndlessSample(raw) {
    const i = this.samples.length;
    const cosPitch = Math.cos(raw.pitch);
    const tangent = new THREE.Vector3(
      Math.sin(raw.heading) * cosPitch,
      Math.sin(raw.pitch),
      Math.cos(raw.heading) * cosPitch
    ).normalize();
    const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const s = {
      i,
      pos: new THREE.Vector3(raw.x, raw.y, raw.z),
      tangent,
      right,
      heading: raw.heading,
      dist: raw.dist,
      curvature: raw.curvature,
      curvatureSmooth: raw.curvature,
      grip: 1,
      hazard: null,
      hazardLabel: null,
      surfaceName: this.env.surfaceName,
      grade: raw.grade,
    };
    this.samples.push(s);
    const d = raw.dist;
    this.sideSlope.push(
      Math.sin(d * 0.008 + this.seed * 0.01) * 0.85 +
      Math.sin(d * 0.0026 + 2.4) * 1.1 + Math.sin(d * 0.017 + 0.6) * 0.28
    );
    this.n = this.samples.length;
    this.length = d;
    return s;
  }

  _scanEndlessNotes(fromIndex) {
    const st = this._noteState;
    const n = this.n;
    const thresh = 0.009;
    const severityFor = (angleDeg) => {
      if (angleDeg < 25) return 6;
      if (angleDeg < 45) return 5;
      if (angleDeg < 70) return 4;
      if (angleDeg < 100) return 3;
      if (angleDeg < 135) return 2;
      return 1;
    };
    const dirName = (dir) => (dir > 0 ? 'LEFT' : 'RIGHT');

    for (let i = Math.max(2, fromIndex); i < n - 1; i++) {
      const c = this.samples[i].curvatureSmooth;
      const active = Math.abs(c) > thresh;
      if (active && !st.inCorner) {
        st.inCorner = true;
        st.start = i;
        st.maxCurv = 0;
        st.minRadius = Infinity;
      }
      if (!st.inCorner) continue;
      const abs = Math.abs(c);
      if (abs > st.maxCurv) st.maxCurv = abs;
      if (abs > 0.001) st.minRadius = Math.min(st.minRadius, 1 / abs);
      if (!active) {
        st.inCorner = false;
        const end = i;
        const start = st.start;
        const angle = Math.abs(wrapAngle(
          this.samples[end].heading - this.samples[start].heading
        ));
        const angleDeg = THREE.MathUtils.radToDeg(angle);
        if (angleDeg > 12) {
          const dir = sign(wrapAngle(
            this.samples[end].heading - this.samples[start].heading
          ));
          let severity = severityFor(angleDeg);
          if (st.minRadius < 10) severity = 1;
          else if (st.minRadius < 15) severity = Math.min(severity, 2);
          let text;
          let kind = 'turn';
          if ((angleDeg > 125 && st.minRadius < 20) || st.minRadius < 7.5) {
            text = `HAIRPIN ${dirName(dir)}`;
            kind = 'hairpin';
            severity = 1;
          } else {
            text = `${dirName(dir)} ${severity}`;
          }
          let modifier = '';
          const seg = end - start;
          if (seg > 10) {
            const first = Math.abs(this.samples[start + Math.floor(seg * 0.2)].curvatureSmooth);
            const last = Math.abs(this.samples[start + Math.floor(seg * 0.8)].curvatureSmooth);
            if (last > first * 1.28 && last > thresh * 1.1) modifier = 'TIGHTENS';
            else if (last < first * 0.72) modifier = 'OPENS';
          }
          const cornerDist = this.samples[start].dist;
          const gap = cornerDist - st.prevCornerEndDist;
          if (gap > 235) {
            this.notes.push({
              dist: st.prevCornerEndDist + 32, kind: 'straight', dir: 0, severity: 0,
              text: `STRAIGHT ${Math.round((gap - 50) / 10) * 10}`,
              modifier: '', index: start, priority: 1,
            });
          }
          this.notes.push({
            dist: cornerDist + 4, kind, dir, severity, text, modifier, angleDeg,
            index: start, priority: 3,
          });
          st.prevCornerEndDist = this.samples[end].dist;
        }
      }
    }

    // crests / jumps
    for (let i = Math.max(10, fromIndex); i < n - 4; i++) {
      const gPrev = this.samples[i - 1].grade;
      const g0 = this.samples[i].grade;
      const g1 = this.samples[i + 1].grade;
      const dist = this.samples[i].dist;
      if (dist - this._lastCrestDist < 55) continue;
      if (gPrev > 0.022 && g0 > 0.012 && g1 < 0.005) {
        const mag = Math.max(gPrev, g0);
        const nearTurn = this.notes.some((nt) => Math.abs(nt.dist - dist) < 26);
        if (!nearTurn) {
          this.notes.push({
            dist, kind: mag > 0.045 ? 'jump' : 'crest', dir: 0,
            severity: 0, text: mag > 0.045 ? 'JUMP' : 'CREST', modifier: '',
            index: i, priority: 2,
          });
          this._lastCrestDist = dist;
        }
      }
    }
  }

  _sortEndlessNotes() {
    this.notes.sort((a, b) => a.dist - b.dist);
    const dedup = [];
    for (const note of this.notes) {
      const prev = dedup[dedup.length - 1];
      if (prev && note.dist - prev.dist < 13) {
        if (note.priority > prev.priority) dedup[dedup.length - 1] = note;
      } else {
        dedup.push(note);
      }
    }
    dedup.forEach((note, i) => {
      note.id = i;
      if (note.announced === undefined) note.announced = false;
    });
    this.notes = dedup;
  }

  _addEndlessHazards(fromIndex) {
    const n = this.n;
    const step = this.step;
    const rng = this._hazardRng;
    const table = this._hazardTable;
    while (this._nextHazardEnd + 180 < this.length - 60) {
      const startDist = this._nextHazardEnd + 90 + rng() * 170;
      const len = 24 + rng() * 46;
      const endDist = startDist + len;
      if (endDist > this.length - 50) break;
      const start = clamp(Math.round(startDist / step), 5, n - 2);
      const end = clamp(Math.round(endDist / step), start + 4, n - 1);
      const h = table[Math.floor(rng() * table.length)];
      const patch = {
        start, end, type: h.type, label: h.label, mul: h.mul, color: h.color,
        startDist: this.samples[start].dist, endDist: this.samples[end].dist,
      };
      this.hazardPatches.push(patch);
      for (let i = start; i <= end; i++) {
        this.samples[i].hazard = h.type;
        this.samples[i].hazardLabel = h.label;
        this.samples[i].hazardMul = h.mul;
      }
      this.notes.push({
        dist: patch.startDist - 12, kind: 'hazard', dir: 0, severity: 0,
        text: h.label, modifier: '', index: start, priority: 4, hazardType: h.type,
      });
      this._nextHazardEnd = endDist + 170 + rng() * 240;
    }
  }

  _applyEndlessGrip(fromIndex) {
    const base = this.stage.baseGrip;
    for (let i = Math.max(0, fromIndex); i < this.n; i++) {
      const s = this.samples[i];
      s.grip = base * (s.hazard ? (s.hazardMul || 1) : 1);
      s.surfaceName = s.hazardLabel || this.env.surfaceName;
    }
  }

  /** Extend the route and stream geometry chunks around the car. */
  streamEndless(pos) {
    if (!this.endless || !pos) return;
    const info = this.nearest(pos, this.lastIndexHint);
    const dist = info.dist;
    // Keep roughly 1.1 km of generated road in front of the car.
    if (this.length < dist + 1100) {
      this._extendEndlessSamples(Math.max(700, dist + 1500 - this.length));
    }
    if (this._scene) this._buildEndlessChunks(false);
    const cutoff = dist - 520;
    while (this.chunks.length && this.chunks[0].dist1 < cutoff) {
      this._disposeChunk(this.chunks.shift());
    }
  }

  _hazardTableForBiome(biome) {
    return {
      forest: [
        { type: 'loose', label: 'LOOSE GRAVEL', mul: 0.72, color: '#d8b769' },
        { type: 'mud', label: 'MUD', mul: 0.62, color: '#8c6b3f' },
      ],
      jungle: [
        { type: 'water', label: 'WATER', mul: 0.6, color: '#679ba3' },
        { type: 'mud', label: 'DEEP MUD', mul: 0.52, color: '#7a5a30' },
        { type: 'roots', label: 'ROOTS', mul: 0.7, color: '#b08a55' },
      ],
      snow: [
        { type: 'ice', label: 'BLACK ICE', mul: 0.42, color: '#a4d7e8' },
        { type: 'snow', label: 'DEEP SNOW', mul: 0.64, color: '#e8f4ff' },
      ],
      japan: [
        { type: 'wet', label: 'WET TARMAC', mul: 0.74, color: '#7d9aa3' },
        { type: 'moss', label: 'MOSS', mul: 0.62, color: '#819b63' },
        { type: 'loose', label: 'LOOSE TARMAC', mul: 0.7, color: '#b4aa8d' },
      ],
      russia: [
        { type: 'ruts', label: 'DEEP RUTS', mul: 0.68, color: '#a58b60' },
        { type: 'mud', label: 'MUD', mul: 0.58, color: '#86643e' },
        { type: 'loose', label: 'LOOSE GRAVEL', mul: 0.72, color: '#cbb47f' },
      ],
      safari: [
        { type: 'sand', label: 'SAND', mul: 0.66, color: '#d3aa69' },
        { type: 'fesh', label: 'FESH-FESH', mul: 0.52, color: '#c1935d' },
        { type: 'rocks', label: 'ROCKS', mul: 0.7, color: '#9d896c' },
      ],
    }[biome] || [
      { type: 'loose', label: 'LOOSE GRAVEL', mul: 0.72, color: '#d8b769' },
    ];
  }

  /* ---------------- hazards ---------------- */
  _buildHazards() {
    if (this.endless) return;
    const rng = mulberry32(this.seed * 13 + 7);
    const table = this._hazardTableForBiome(this.stage.biome);
    this.hazardTable = table;
    const minI = 45, maxI = this.n - 60;
    const count = this.stage.hazardCount || (this.stage.biome === 'jungle' ? 7 : 5);
    const patches = [];
    let guard = 0;
    while (patches.length < count && guard++ < 200) {
      const start = minI + Math.floor(rng() * (maxI - minI));
      const lenI = 14 + Math.floor(rng() * 20);
      const end = Math.min(this.n - 2, start + lenI);
      if (patches.some((p) => Math.abs(p.start - start) < 70)) continue;
      const hazard = table[Math.floor(rng() * table.length)];
      patches.push({ start, end, hazard });
    }
    patches.sort((a, b) => a.start - b.start);
    this.hazardPatches = patches.map((p) => ({
      ...p,
      type: p.hazard.type,
      label: p.hazard.label,
      mul: p.hazard.mul,
      color: p.hazard.color,
      startDist: this.samples[p.start].dist,
      endDist: this.samples[p.end].dist,
    }));
    for (const p of this.hazardPatches) {
      for (let i = p.start; i <= p.end; i++) {
        this.samples[i].hazard = p.type;
        this.samples[i].hazardLabel = p.label;
        this.samples[i].hazardMul = p.mul;
      }
    }
  }

  _buildGripProfiles() {
    const base = this.stage.baseGrip;
    for (const s of this.samples) {
      s.grip = base * (s.hazard ? (s.hazardMul || 1) : 1);
      if (s.hazardLabel) s.surfaceName = s.hazardLabel;
      else s.surfaceName = this.env.surfaceName;
    }
  }

  /* ---------------- pacenotes ---------------- */
  _buildPacenotes() {
    if (this.endless) return;
    const notes = [];
    const n = this.n;
    const thresh = 0.009;
    let inCorner = false;
    let start = 0;
    let maxCurv = 0;
    let minRadius = Infinity;

    const dirName = (dir) => (dir > 0 ? 'LEFT' : 'RIGHT');
    const severityFor = (angleDeg) => {
      if (angleDeg < 25) return 6;
      if (angleDeg < 45) return 5;
      if (angleDeg < 70) return 4;
      if (angleDeg < 100) return 3;
      if (angleDeg < 135) return 2;
      return 1;
    };

    for (let i = 2; i < n - 2; i++) {
      const c = this.samples[i].curvatureSmooth;
      const active = Math.abs(c) > thresh;
      if (active && !inCorner) {
        inCorner = true; start = i; maxCurv = 0; minRadius = Infinity;
      }
      if (inCorner) {
        const abs = Math.abs(c);
        if (abs > maxCurv) maxCurv = abs;
        if (abs > 0.001) minRadius = Math.min(minRadius, 1 / abs);
      }
      if ((!active || i === n - 3) && inCorner) {
        inCorner = false;
        const end = i;
        const angle = Math.abs(wrapAngle(
          this.samples[end].heading - this.samples[start].heading
        ));
        const angleDeg = THREE.MathUtils.radToDeg(angle);
        if (angleDeg > 12) {
          const dir = sign(wrapAngle(
            this.samples[end].heading - this.samples[start].heading
          ));
          let severity = severityFor(angleDeg);
          if (minRadius < 10) severity = 1;
          else if (minRadius < 15) severity = Math.min(severity, 2);
          let text;
          let kind = 'turn';
          if ((angleDeg > 125 && minRadius < 20) || minRadius < 7.5) {
            text = `HAIRPIN ${dirName(dir)}`;
            kind = 'hairpin';
            severity = 1;
          } else {
            text = `${dirName(dir)} ${severity}`;
          }
          // tighten / opens
          let modifier = '';
          const seg = end - start;
          if (seg > 10) {
            const first = Math.abs(this.samples[start + Math.floor(seg * 0.2)].curvatureSmooth);
            const last = Math.abs(this.samples[start + Math.floor(seg * 0.8)].curvatureSmooth);
            if (last > first * 1.28 && last > thresh * 1.1) modifier = 'TIGHTENS';
            else if (last < first * 0.72) modifier = 'OPENS';
          }
          notes.push({
            dist: this.samples[start].dist + 4,
            kind, dir, severity, text, modifier, angleDeg,
            index: start,
            priority: 3,
          });
        }
        start = -1;
      }
    }

    // crests and jumps
    for (let i = 10; i < n - 10; i++) {
      const g0 = this.samples[i].grade;
      const g1 = this.samples[i + 1].grade;
      const gPrev = this.samples[i - 1].grade;
      if (gPrev > 0.022 && g0 > 0.012 && g1 < 0.005) {
        const mag = Math.max(gPrev, g0);
        const nearTurn = notes.some((nt) => Math.abs(nt.dist - this.samples[i].dist) < 26);
        if (!nearTurn) {
          notes.push({
            dist: this.samples[i].dist, kind: mag > 0.045 ? 'jump' : 'crest', dir: 0,
            severity: 0, text: mag > 0.045 ? 'JUMP' : 'CREST', modifier: '', index: i, priority: 2,
          });
        }
      }
    }

    // hazard notes
    for (const h of this.hazardPatches) {
      notes.push({
        dist: h.startDist - 12, kind: 'hazard', dir: 0, severity: 0,
        text: h.label, modifier: '', index: h.start, priority: 4, hazardType: h.type,
      });
    }

    // straights
    const turns = notes.filter((x) => x.kind === 'turn' || x.kind === 'hairpin').sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < turns.length - 1; i++) {
      const gap = turns[i + 1].dist - turns[i].dist;
      if (gap > 230) {
        notes.push({
          dist: turns[i].dist + 35, kind: 'straight', dir: 0, severity: 0,
          text: `STRAIGHT ${Math.round((gap - 50) / 10) * 10}`,
          modifier: '', index: turns[i].index, priority: 1,
        });
      }
    }

    // finish
    notes.push({
      dist: this.length - 14, kind: 'finish', dir: 0, severity: 0,
      text: 'FINISH', modifier: '', index: n - 10, priority: 6,
    });

    notes.sort((a, b) => a.dist - b.dist);
    const dedup = [];
    for (const note of notes) {
      const prev = dedup[dedup.length - 1];
      if (prev && note.dist - prev.dist < 13) {
        if (note.priority > prev.priority) dedup[dedup.length - 1] = note;
      } else {
        dedup.push(note);
      }
    }
    dedup.forEach((note, i) => {
      note.id = i;
      note.announced = false;
    });
    this.notes = dedup;
  }

  _buildMapProjection() {
    if (this.endless) {
      this.map = { endless: true, pts: [], minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
      this.mapTransform = () => [0.5, 0.5];
      return;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    const pad = 0.065;
    const sx = (1 - pad * 2) / Math.max(1, maxX - minX);
    const sz = (1 - pad * 2) / Math.max(1, maxZ - minZ);
    const sc = Math.min(sx, sz);
    const ox = pad + ((1 - pad * 2) - (maxX - minX) * sc) / 2;
    const oz = pad + ((1 - pad * 2) - (maxZ - minZ) * sc) / 2;
    this.map = {
      minX, maxX, minZ, maxZ, pad, scale: sc, ox, oz,
      pts: this.samples.map((s) => [
        ox + (s.pos.x - minX) * sc,
        oz + (s.pos.z - minZ) * sc,
      ]),
    };
    this.mapTransform = (x, z) => [
      ox + (x - minX) * sc,
      oz + (z - minZ) * sc,
    ];
  }

  /* ---------------- queries ---------------- */
  nearest(pos, hint = this.lastIndexHint) {
    const n = this.n;
    let from, to;
    if (hint < 0 || hint == null) {
      from = 0; to = n - 2;
    } else {
      from = Math.max(0, hint - 55);
      to = Math.min(n - 2, hint + 55);
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = from; i <= to; i++) {
      const a = this.samples[i].pos;
      const dx = pos.x - a.x, dz = pos.z - a.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    // if clamped to window edge, do a global search (teleport / reset safety)
    if (hint != null && hint >= 0 && (best <= from + 1 || best >= to - 1)) {
      for (let i = 0; i < n - 1; i++) {
        const a = this.samples[i].pos;
        const dx = pos.x - a.x, dz = pos.z - a.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best < 0) best = 0;
    const aS = this.samples[best];
    const bS = this.samples[Math.min(n - 1, best + 1)];
    const ax = aS.pos.x, az = aS.pos.z;
    const bx = bS.pos.x, bz = bS.pos.z;
    const ex = bx - ax, ez = bz - az;
    const el2 = ex * ex + ez * ez || 1;
    const t = clamp(((pos.x - ax) * ex + (pos.z - az) * ez) / el2, 0, 1);
    const center = new THREE.Vector3(
      lerp(aS.pos.x, bS.pos.x, t),
      lerp(aS.pos.y, bS.pos.y, t),
      lerp(aS.pos.z, bS.pos.z, t),
    );
    const tangent = new THREE.Vector3().lerpVectors(aS.tangent, bS.tangent, t).normalize();
    const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const dx = pos.x - center.x, dz = pos.z - center.z;
    const lateral = dx * right.x + dz * right.z;
    const absLat = Math.abs(lateral);
    const nearIdx = t > 0.5 ? Math.min(n - 1, best + 1) : best;
    const dist = lerp(aS.dist, bS.dist, t);
    const grip = lerp(aS.grip, bS.grip, t);
    const offRoad = absLat > this.halfWidth + 0.65;
    const surfaceName = (t > 0.5 ? bS : aS).surfaceName;
    const hazard = (t > 0.5 ? bS : aS).hazard;
    const hazardLabel = (t > 0.5 ? bS : aS).hazardLabel;
    if (!offRoad) this.lastIndexHint = best;
    return {
      index: best, nearIndex: nearIdx, t, center, tangent, right, lateral, absLat,
      dist, progress: clamp(dist / this.length, 0, 1), grip, offRoad, hazard, hazardLabel,
      surfaceName, heading: Math.atan2(tangent.x, tangent.z),
      height: this.surfaceHeight(nearIdx, lateral),
      sample: t > 0.5 ? bS : aS,
    };
  }

  nearestGlobal(pos) {
    return this.nearest(pos, -1);
  }

  roadCrown(lateral) {
    const u = clamp(Math.abs(lateral) / this.halfWidth, 0, 1);
    return 0.055 * (1 - u * u) + 0.012;
  }

  surfaceHeight(index, lateral) {
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const absLat = Math.abs(lateral);
    if (absLat <= this.halfWidth + 0.25) {
      return s.pos.y + this.roadYOffset + this.roadCrown(lateral);
    }
    return this.heightAtSample(index, lateral) + 0.015;
  }

  terrainProfile() {
    return this.env.terrain || {
      style: 'rolling', relief: 1, bank: 1.2, ditch: 0.18, edge: 6.5, cliff: 0, roughness: 1,
    };
  }

  /** Smooth, deterministic side bias used to give mountain passes an uphill
   *  wall and a valley side that swap gradually over the length of a stage. */
  mountainSideAt(dist) {
    const b = Math.sin(dist * 0.0042 + this.seed * 0.0011) * 0.9 +
      Math.sin(dist * 0.00135 + 2.15) * 0.42 +
      Math.sin(dist * 0.0105 + 0.7) * 0.16;
    return b >= 0 ? -1 : 1; // side that rises
  }

  heightAtSample(index, lateral) {
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const absLat = Math.abs(lateral);
    const d = Math.max(0, absLat - this.halfWidth);
    if (d < 0.45) return s.pos.y - 0.09;
    const t = this.terrainProfile();
    const wx = s.pos.x + s.right.x * lateral;
    const wz = s.pos.z + s.right.z * lateral;
    const rough = t.roughness ?? 1;
    const n1 = fbm(wx * 0.041, wz * 0.041, this.seed);
    const n2 = fbm(wx * 0.012, wz * 0.012, this.seed + 15);
    const n3 = fbm(wx * 0.115, wz * 0.115, this.seed + 31);
    const slope = this.sideSlope[s.i] || 0;
    const ditch = -t.ditch * smoothstep(0.45, 2.0, d) * (1 - smoothstep(2.2, 5.2, d));
    let y = s.pos.y - 0.15 + ditch;

    if (t.style === 'mountain') {
      const uphill = this.mountainSideAt(s.dist);
      const isUp = sign(lateral || 1) === uphill;
      if (isUp) {
        const rise = smoothstep(0.7, 3.6, d) * (0.28 * t.bank + Math.abs(slope) * 0.22) +
          smoothstep(2.2, 26, d) * (Math.pow(d / 23, 0.82) * (12.5 * t.bank) + n1 * 3.2 + n2 * 1.8) +
          smoothstep(28, 100, d) * (t.relief * 3.2 + n2 * 6.0 * rough);
        y += rise;
      } else {
        const drop = smoothstep(1.0, 7.5, d) * (0.35 + d * 0.14) +
          smoothstep(4, 30, d) * (Math.pow(d / 28, 0.9) * (10.5 * t.bank) + n1 * 2.0 + Math.abs(n2) * 3.4) +
          smoothstep(34, 130, d) * (t.relief * 4.2 + Math.abs(n2) * 8.0 * rough);
        y -= drop;
      }
      return y;
    }

    if (t.style === 'ridge') {
      const lift = smoothstep(1.1, 14, d) * (0.24 + n1 * 1.55 * t.bank + Math.abs(slope) * d * 0.075) +
        smoothstep(16, 70, d) * (n2 * 5.8 * t.relief + 1.4 * t.relief) +
        smoothstep(48, 130, d) * (n3 * 4.0 * rough);
      return y + Math.max(-0.5, lift);
    }

    if (t.style === 'plain') {
      const lift = smoothstep(1.6, 18, d) * (0.12 + n1 * 0.5 * t.bank + Math.abs(slope) * d * 0.018) +
        smoothstep(28, 110, d) * (n2 * 2.2 * t.relief + 0.5 * t.relief) +
        smoothstep(70, 170, d) * (n3 * 1.6 * rough);
      // Wide grass banks / wind-blown snow drifts tight against the road.
      const shoulder = smoothstep(0.8, 4.5, d) * (t.bank * 0.45 + Math.abs(n1) * 0.36 * t.bank);
      return y + lift + shoulder;
    }

    // rolling forest
    const lift = smoothstep(1.4, 16, d) * (0.3 + n1 * 1.4 * t.bank + Math.abs(slope) * d * 0.06) +
      smoothstep(20, 80, d) * (n2 * 4.2 * t.relief + 1.1 * t.relief) +
      smoothstep(55, 140, d) * (n3 * 3.3 * rough);
    return y + Math.max(-0.5, lift);
  }

  /** Bilinear sample of the (smoothed) rendered terrain height grid. */
  terrainHeightAt(x, z) {
    const g = this._terrainGrid;
    if (!g) return 0;
    const fx = clamp((x - g.minX) / g.step, 0, g.cols - 1.001);
    const fz = clamp((z - g.minZ) / g.step, 0, g.rows - 1.001);
    const c = Math.floor(fx), r = Math.floor(fz);
    const tx = fx - c, tz = fz - r;
    const i = r * g.cols + c;
    const h00 = g.heights[i], h10 = g.heights[i + 1];
    const h01 = g.heights[i + g.cols], h11 = g.heights[i + g.cols + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** smooth-ish terrain for car when off the road */
  offRoadHeight(pos, index) {
    return this.heightAtSample(index, this._lateralFromSample(pos, index));
  }

  _lateralFromSample(pos, index) {
    const s = this.samples[clamp(index, 0, this.n - 1)];
    return (pos.x - s.pos.x) * s.right.x + (pos.z - s.pos.z) * s.right.z;
  }

  notesAhead(dist, count = 3) {
    const out = [];
    for (let i = 0; i < this.notes.length; i++) {
      if (this.notes[i].dist >= dist - 2) {
        out.push(this.notes[i]);
        if (out.length >= count) break;
      }
    }
    return out;
  }

  nextNote(dist) {
    for (const note of this.notes) {
      if (note.dist >= dist - 3) return note;
    }
    return this.notes[this.notes.length - 1] || null;
  }

  hazardAhead(dist, lookahead = 160) {
    for (const h of this.hazardPatches) {
      if (h.startDist > dist - 4 && h.startDist < dist + lookahead) {
        return { ...h, ahead: h.startDist - dist };
      }
    }
    return null;
  }

  speedTarget() {
    return this.length / this.stage.targetSpeed;
  }

  /* ============================================================
     ATMOSPHERE / DISTANT LANDMARKS
     ============================================================ */

  /** Add a far-away silhouette to the sky group. Colours are pre-fogged so
   *  the icons stay readable even when they sit outside the fog range. */
  _addSkyline(skyGroup, parts, { angle = 0, dist = 1000, y = 0, opacity = 0.94, order = -6, blend = 0.58 } = {}) {
    if (!parts.length) return null;
    const fog = new THREE.Color(this.env.fog);
    const colored = parts.map((p) => ({
      geometry: p.geometry,
      color: new THREE.Color(p.color).lerp(fog, blend),
    }));
    const geo = mergeColored(colored);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity,
      depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(Math.cos(angle) * dist, y, Math.sin(angle) * dist);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    skyGroup.add(mesh);
    return mesh;
  }

  _addSkyIcons(skyGroup) {
    const biome = this.stage.biome;

    if (biome === 'japan') {
      // A Fuji-like cone above the cedar sea.
      const parts = [];
      const base = new THREE.ConeGeometry(410, 265, 7, 1);
      base.translate(0, 132, 0);
      parts.push({ geometry: base, color: 0x6c7f88 });
      const cap = new THREE.ConeGeometry(147, 93, 7, 1);
      cap.translate(0, 217, 0);
      parts.push({ geometry: cap, color: 0xeaf3f7 });
      this._addSkyline(skyGroup, parts, { angle: -2.28, dist: 1480, y: 18, opacity: 0.9, blend: 0.46 });

      // Five-storey pagoda on the far ridge.
      const pag = [];
      partBox(pag, 0x7a7c71, 34, 4, 27, 0, 2, 0);
      partBox(pag, 0x6e2d22, 22, 7, 17, 0, 7.5, 0);
      for (let i = 0; i < 5; i++) {
        const yy = 12 + i * 7.4;
        const w = 20 - i * 2.6;
        partBox(pag, 0x6e2d22, w * 0.72, 5.6, w * 0.58, 0, yy, 0);
        partCyl(pag, 0x32271f, w * 0.56, w * 0.79, 1.1, 4, 0, yy + 3.4, 0, 0, Math.PI / 4);
      }
      partCyl(pag, 0x8f7d4f, 0.65, 0.95, 12, 5, 0, 48, 0);
      this._addSkyline(skyGroup, pag, { angle: 1.12, dist: 820, y: 4, opacity: 0.86, blend: 0.62 });
    }

    if (biome === 'forest') {
      // A border pele tower on a wooded ridge.
      const parts = [];
      const hill = new THREE.SphereGeometry(175, 9, 4);
      hill.scale(1.6, 0.24, 1.1);
      hill.translate(0, -5, 0);
      parts.push({ geometry: hill, color: 0x4c5e3d });
      partBox(parts, 0x6e6b5d, 19, 37, 17, 0, 26, 0);
      partBox(parts, 0x7c7868, 21, 3, 19, 0, 45.5, 0);
      for (let k = -1; k <= 1; k++) {
        partBox(parts, 0x6e6b5d, 4.2, 4.2, 3, k * 7.4, 49, 0);
        partBox(parts, 0x6e6b5d, 4.2, 4.2, 3, k * 7.4, 49, -6.5);
      }
      partBox(parts, 0x3e3d34, 4.6, 7.5, 0.5, 0, 8.5, 8.7);
      this._addSkyline(skyGroup, parts, { angle: 0.72, dist: 720, y: -8, opacity: 0.85, blend: 0.66 });
    }

    if (biome === 'jungle') {
      const parts = [];
      const cone = new THREE.ConeGeometry(470, 310, 7, 1);
      cone.translate(0, 155, 0);
      parts.push({ geometry: cone, color: 0x314b39 });
      const cap = new THREE.ConeGeometry(185, 74, 7, 1);
      cap.translate(0, 292, 0);
      parts.push({ geometry: cap, color: 0x6b5142 });
      partCyl(parts, 0x241d18, 118, 138, 8, 9, 0, 315, 0);
      const volcano = this._addSkyline(skyGroup, parts, { angle: 2.3, dist: 1360, y: 0, opacity: 0.92, blend: 0.46 });
      if (volcano) {
        const smokeTex = makeSoftDotTexture();
        const top = new THREE.Vector3(Math.cos(2.3) * 1360, 330, Math.sin(2.3) * 1360);
        for (let i = 0; i < 4; i++) {
          const mat = new THREE.SpriteMaterial({
            map: smokeTex,
            color: new THREE.Color(0xb8c3b2).lerp(new THREE.Color(this.env.fog), 0.35),
            transparent: true, opacity: 0.12 + i * 0.025, depthWrite: false, fog: false,
          });
          const spr = new THREE.Sprite(mat);
          spr.position.copy(top).add(new THREE.Vector3((i - 1.5) * 60, 55 + i * 48, (i % 2) * 45));
          spr.scale.set(210 + i * 60, 100 + i * 25, 1);
          spr.renderOrder = -5;
          skyGroup.add(spr);
        }
      }
    }

    if (biome === 'snow') {
      // A high glaciated massif behind the fells.
      const parts = [];
      const peak = new THREE.ConeGeometry(390, 300, 6, 1);
      peak.translate(0, 150, 0);
      parts.push({ geometry: peak, color: 0x93aec1 });
      const cap = new THREE.ConeGeometry(154, 107, 6, 1);
      cap.translate(0, 246, 0);
      parts.push({ geometry: cap, color: 0xeaf4fb });
      const ridge = new THREE.ConeGeometry(500, 160, 6, 1);
      ridge.translate(-170, 80, 40);
      parts.push({ geometry: ridge, color: 0x839cae });
      this._addSkyline(skyGroup, parts, { angle: -1.18, dist: 1120, y: 0, opacity: 0.92, blend: 0.5 });
    }

    if (biome === 'russia') {
      // Orthodox church silhouette and a tall radio mast in the birch haze.
      const church = [];
      partBox(church, 0xded8c5, 30, 34, 22, 0, 17, 0);
      partBox(church, 0xc9c1aa, 13, 48, 13, 19, 24, 0);
      const dome = new THREE.SphereGeometry(9.5, 9, 7);
      dome.scale(1, 1.18, 1);
      dome.translate(19, 52, 0);
      church.push({ geometry: dome, color: 0xc9a444 });
      partCyl(church, 0xc9a444, 0.3, 0.8, 10, 5, 19, 63, 0);
      partBox(church, 0xc9a444, 5.5, 0.4, 0.4, 19, 65.5, 0);
      partBox(church, 0x5b5243, 30, 2.4, 24, 0, 35, 0);
      this._addSkyline(skyGroup, church, { angle: -0.92, dist: 980, y: 0, opacity: 0.82, blend: 0.7 });

      const mast = [];
      for (let i = 0; i < 5; i++) {
        const h = 24;
        const r = 3.1 - i * 0.55;
        partCyl(mast, i % 2 ? 0xcac6b5 : 0x92372d, r * 0.72, r, h, 5, 0, 12 + i * 23, 0);
      }
      partCyl(mast, 0x8d3b31, 0.5, 0.73, 15, 5, 0, 126, 0);
      this._addSkyline(skyGroup, mast, { angle: 1.68, dist: 890, y: 0, opacity: 0.74, blend: 0.72 });
    }

    if (biome === 'safari') {
      // The Rift escarpment: flat-topped terraced mesas.
      const parts = [];
      for (let k = 0; k < 4; k++) {
        const w = 330 - k * 54;
        const h = 26;
        partCyl(parts, [0x8e5634, 0xa2663d, 0x7d4e31, 0x8b5938][k], w, w + 15, h, 6, -k * 8, 10 + k * h, k * 6);
      }
      this._addSkyline(skyGroup, parts, { angle: 1.46, dist: 1180, y: -4, opacity: 0.9, blend: 0.62 });
      const far = [];
      partCyl(far, 0x82573b, 170, 220, 80, 5, 0, 40, 0);
      partCyl(far, 0x93684a, 205, 260, 20, 5, 0, 8, 0);
      this._addSkyline(skyGroup, far, { angle: -2.05, dist: 1560, y: 0, opacity: 0.72, blend: 0.76 });
    }

    // Endless mode gets a simple, biome-coloured skyline so the horizon never
    // feels like an empty ring of cones.
    if (this.endless) {
      const parts = [];
      const col = { forest: 0x53634a, jungle: 0x3f5842, snow: 0x9bb3c4, japan: 0x73848a, russia: 0x68795c, safari: 0x8f6843 }[biome] || 0x5d6a54;
      for (let i = 0; i < 5; i++) {
        const g = new THREE.ConeGeometry(210 + i * 29, 110 + (i % 3) * 54, 6, 1);
        g.translate(0, 40 + (i % 3) * 25, 0);
        parts.push({ geometry: g, color: col });
      }
      this._addSkyline(skyGroup, parts, { angle: 0.4, dist: 1250, y: -18, opacity: 0.72, blend: 0.68 });
    }
  }

  _buildMotes(scene) {
    const biome = this.stage.biome;
    const conf = {
      forest: { color: 0xffe7a6, size: 0.085, opacity: 0.36, count: 210, add: true },
      jungle: { color: 0xa7ffc1, size: 0.075, opacity: 0.3, count: 190, add: true },
      snow: { color: 0xe8f7ff, size: 0.07, opacity: 0.34, count: 180, add: true },
      japan: { color: 0xffd4a1, size: 0.065, opacity: 0.26, count: 170, add: true },
      russia: { color: 0xf1f1c4, size: 0.07, opacity: 0.3, count: 190, add: true },
      safari: { color: 0xffc37c, size: 0.095, opacity: 0.32, count: 220, add: true },
    }[biome];
    if (!conf) return;
    const qMul = this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.66 : 0.38;
    const count = Math.max(40, Math.round(conf.count * qMul));
    const rng = mulberry32(this.seed + 1801);
    const center = this.samples[Math.min(this.n - 1, 4)]?.pos || new THREE.Vector3();
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = center.x + (rng() - 0.5) * 100;
      pos[i * 3 + 1] = center.y + 0.4 + rng() * 8.5;
      pos[i * 3 + 2] = center.z + (rng() - 0.5) * 100;
      phase[i] = rng() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: makeSoftDotTexture(), color: conf.color, size: conf.size,
      transparent: true, opacity: conf.opacity, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, alphaTest: 0.01,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 2;
    this.moteCount = count;
    this.motePhase = phase;
    this.motePos = pos;
    scene.add(this.motes);
  }

  _updateMotes(playerPos, dt) {
    if (!this.motes || !playerPos) return;
    const p = this.motePos;
    const t = this.skyTime;
    const conf = this.stage.biome;
    const drift = conf === 'safari' ? 0.42 : conf === 'snow' ? 0.18 : 0.24;
    for (let i = 0; i < this.moteCount; i++) {
      const i3 = i * 3;
      const ph = this.motePhase[i];
      p[i3] += (Math.sin(t * 0.27 + ph) * drift + 0.08) * dt;
      p[i3 + 1] += (Math.sin(t * 0.53 + ph * 1.7) * 0.07 + 0.02) * dt;
      p[i3 + 2] += Math.cos(t * 0.23 + ph * 1.3) * drift * dt;
      if (p[i3] - playerPos.x > 55) p[i3] -= 110;
      else if (p[i3] - playerPos.x < -55) p[i3] += 110;
      if (p[i3 + 2] - playerPos.z > 55) p[i3 + 2] -= 110;
      else if (p[i3 + 2] - playerPos.z < -55) p[i3 + 2] += 110;
      if (p[i3 + 1] < playerPos.y - 1.5) p[i3 + 1] = playerPos.y + 1.2 + Math.random() * 7.5;
      else if (p[i3 + 1] > playerPos.y + 14) p[i3 + 1] = playerPos.y + 0.6 + Math.random() * 5;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
  }

  _windStrength() {
    return {
      forest: 0.9, jungle: 1.35, snow: 0.62, japan: 0.72, russia: 0.86, safari: 1.18,
    }[this.stage.biome] || 1;
  }

  _windify(mat, strength = 1) {
    if (!mat || mat.userData.windified) return mat;
    mat.userData.windified = true;
    const stash = { uWindTime: { value: 0 }, uWindStrength: { value: strength } };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = stash.uWindTime;
      shader.uniforms.uWindStrength = stash.uWindStrength;
      shader.vertexShader = `uniform float uWindTime;\nuniform float uWindStrength;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n
        #ifdef USE_INSTANCING\n          vec3 windPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);\n        #else\n          vec3 windPos = vec3(0.0);\n        #endif\n        float windMask = clamp(uv.y, 0.0, 1.0);\n        float windPhase = uWindTime * 1.22 + windPos.x * 0.055 + windPos.z * 0.041;\n        float windGust = sin(windPhase) * 0.72 + sin(windPhase * 2.63 + 1.7) * 0.28;\n        transformed.x += windGust * uWindStrength * windMask * 0.28;\n        transformed.z += windGust * uWindStrength * windMask * 0.17;\n        `
      );
      mat.userData.windShader = shader;
    };
    mat.customProgramCacheKey = () => `wind-${strength.toFixed(2)}`;
    this.windMaterials.push(mat);
    return mat;
  }

  /* ============================================================
     SCENE BUILDING
     ============================================================ */
  buildSky(scene) {
    const env = this.env;
    const skyGroup = new THREE.Group();
    skyGroup.name = 'sky';
    const skyGeo = new THREE.SphereGeometry(1800, 32, 18);
    const sunDir = new THREE.Vector3(...env.sunDir).normalize();
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(env.skyTop) },
        horizonColor: { value: new THREE.Color(env.skyHorizon) },
        bottomColor: { value: new THREE.Color(env.skyBottom) },
        glowColor: { value: new THREE.Color(env.glowColor || env.skyHorizon) },
        glowStrength: { value: env.horizonGlow || 0 },
        glowDir: { value: sunDir.clone() },
        flash: { value: 0 },
        uTime: { value: 0 },
        uAurora: { value: 0 },
        uAuroraA: { value: new THREE.Color(0x62ffc4) },
        uAuroraB: { value: new THREE.Color(0x9b7dff) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        uniform vec3 glowColor;
        uniform vec3 glowDir;
        uniform float glowStrength;
        uniform float flash;
        uniform float uTime;
        uniform float uAurora;
        uniform vec3 uAuroraA;
        uniform vec3 uAuroraB;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.55, h));
          col = mix(bottomColor, col, smoothstep(-0.18, 0.02, h));
          float glow = pow(max(dot(normalize(vDir), normalize(vec3(glowDir.x, 0.02, glowDir.z))), 0.0), 3.0);
          glow *= smoothstep(-0.03, 0.05, h) * (1.0 - smoothstep(0.02, 0.3, h));
          col += glowColor * glow * glowStrength * 0.55;

          // Slow aurora curtains for the Arctic stages. Two overlapping waves
          // keep the ribbons organic and stop them reading as a flat gradient.
          if (uAurora > 0.001) {
            float az = atan(vDir.z, vDir.x);
            float band = smoothstep(0.015, 0.12, h) * (1.0 - smoothstep(0.24, 0.55, h));
            float w1 = 0.5 + 0.5 * sin(az * 3.1 + sin(az * 5.7 + uTime * 0.11) * 1.2 + uTime * 0.05);
            float w2 = 0.5 + 0.5 * sin(az * 6.8 - uTime * 0.075 + 1.9 + sin(az * 2.3) * 0.8);
            float curtain = smoothstep(0.28, 0.94, w1 * 0.65 + w2 * 0.35);
            float rays = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(az * 78.0 + uTime * 0.7), 3.0);
            float veil = smoothstep(0.6, 0.99, 0.5 + 0.5 * sin(az * 4.3 + uTime * 0.06 + 1.3));
            vec3 auroraCol = mix(uAuroraA, uAuroraB, smoothstep(0.03, 0.28, h));
            col += auroraCol * (curtain * rays * 0.52 + veil * 0.1) * band * uAurora;
          }

          col += vec3(0.62, 0.68, 0.86) * flash * 1.1;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.skyMat = skyMat;
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    skyGroup.add(this.sky);

    /* ---- stars ---- */
    if (env.stars > 0.01) {
      const rng = mulberry32(this.seed + 606);
      const count = qualityStars(this.quality, this.env);
      const pos = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const y = 0.02 + rng() * 0.98;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        pos[i * 3] = Math.cos(a) * r * 1500;
        pos[i * 3 + 1] = y * 1500;
        pos[i * 3 + 2] = Math.sin(a) * r * 1500;
        sizes[i] = 0.6 + rng() * 1.6;
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      const starMat = new THREE.PointsMaterial({
        color: 0xdfe8ff, size: 2.4, sizeAttenuation: false,
        transparent: true, opacity: Math.min(1, env.stars), depthWrite: false,
        fog: false, blending: THREE.AdditiveBlending,
      });
      this.stars = new THREE.Points(starGeo, starMat);
      this.stars.frustumCulled = false;
      this.stars.renderOrder = -9;
      skyGroup.add(this.stars);

      const bright = new THREE.Points(starGeo, new THREE.PointsMaterial({
        color: 0xffffff, size: 4.2, sizeAttenuation: false, transparent: true,
        opacity: Math.min(0.9, env.stars * 0.5), depthWrite: false,
        fog: false, blending: THREE.AdditiveBlending,
        map: makeSunTexture(), alphaTest: 0.02,
      }));
      bright.frustumCulled = false;
      bright.renderOrder = -9;
      skyGroup.add(bright);
      this.starsBright = bright;
    }

    /* ---- sun / moon ---- */
    const sunTex = makeSunTexture();
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, color: new THREE.Color(env.sunColor), transparent: true,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      opacity: env.moon ? 0 : 0.9,
    }));
    this.sunSprite.position.copy(sunDir).multiplyScalar(1300);
    this.sunSprite.scale.setScalar(340 * (env.sunScale || 1));
    skyGroup.add(this.sunSprite);

    this.sunStreak = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, color: new THREE.Color(env.sunColor), transparent: true,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      opacity: env.moon ? 0 : 0.1,
    }));
    this.sunStreak.position.copy(this.sunSprite.position);
    this.sunStreak.scale.set(900, 90, 1);
    skyGroup.add(this.sunStreak);

    if (env.moon) {
      this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunTex, color: 0xdce8ff, transparent: true, depthWrite: false,
        fog: false, blending: THREE.AdditiveBlending, opacity: 0.95,
      }));
      this.moonSprite.position.copy(sunDir).multiplyScalar(1280);
      this.moonSprite.scale.setScalar(72);
      skyGroup.add(this.moonSprite);
      this.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunTex, color: 0xa9c6ff, transparent: true, depthWrite: false,
        fog: false, blending: THREE.AdditiveBlending, opacity: 0.18,
      }));
      this.moonGlow.position.copy(this.moonSprite.position);
      this.moonGlow.scale.setScalar(280);
      skyGroup.add(this.moonGlow);
    }

    /* ---- horizon glow ---- */
    if ((env.horizonGlow || 0) > 0.01) {
      this.horizon = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunTex, color: new THREE.Color(env.glowColor), transparent: true,
        depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        opacity: Math.min(0.36, env.horizonGlow * 0.12),
      }));
      this.horizon.position.set(sunDir.x * 1400, 6, sunDir.z * 1400);
      this.horizon.scale.set(1500, 300, 1);
      skyGroup.add(this.horizon);
    }

    /* ---- clouds ---- */
    if ((env.clouds || 0) > 0.02) {
      const cloudGroup = new THREE.Group();
      const cloudTex = makeCloudTexture();
      const rng = mulberry32(this.seed + 4242);
      const nightness = Math.min(1, env.stars || 0);
      const baseCol = new THREE.Color(env.skyHorizon).lerp(new THREE.Color(0xffffff), 0.32 - nightness * 0.18);
      const n = Math.round(6 + env.clouds * 14);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.4;
        const radius = 880 + rng() * 420;
        const mat = new THREE.SpriteMaterial({
          map: cloudTex,
          color: baseCol.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.12),
          transparent: true,
          opacity: (0.055 + rng() * 0.095) * (0.45 + env.clouds * 0.7) * (1 - nightness * 0.45),
          depthWrite: false,
          fog: false,
        });
        const spr = new THREE.Sprite(mat);
        spr.position.set(
          Math.cos(a) * radius,
          190 + rng() * 520,
          Math.sin(a) * radius
        );
        const w = 380 + rng() * 460;
        spr.scale.set(w, w * (0.34 + rng() * 0.2), 1);
        cloudGroup.add(spr);
      }
      this.cloudGroup = cloudGroup;
      skyGroup.add(cloudGroup);
    }

    if (this.endless) this._buildEndlessSkyRidges(skyGroup);
    this._addSkyIcons(skyGroup);

    const night = clamp(env.stars || 0, 0, 1);
    this.auroraStrength = this.env.aurora && night > 0.04
      ? Math.min(1, 0.3 + night * 1.8)
      : 0;
    skyMat.uniforms.uAurora.value = this.auroraStrength;

    scene.add(skyGroup);
    this.skyGroup = skyGroup;
    this.sunDir = sunDir;
    this._buildMotes(scene);

    this.hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiIntensity);
    scene.add(this.hemi);
    this.baseHemiIntensity = env.hemiIntensity;

    // A small ambient fill keeps foliage and shaded banks readable without
    // flattening the directional sunlight.
    this.ambient = new THREE.AmbientLight(env.hemiSky, 0.2 * (env.hemiIntensity || 1));
    this.baseAmbient = this.ambient.intensity;
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
    this.baseSunIntensity = env.sunIntensity;
    this.sun.castShadow = this.quality !== 'low';
    this.sun.shadow.mapSize.set(
      this.quality === 'high' ? 2048 : 1024,
      this.quality === 'high' ? 2048 : 1024
    );
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    const shadowSpan = this.quality === 'high' ? 62 : 48;
    this.sun.shadow.camera.left = -shadowSpan;
    this.sun.shadow.camera.right = shadowSpan;
    this.sun.shadow.camera.top = shadowSpan;
    this.sun.shadow.camera.bottom = -shadowSpan;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.updateProjectionMatrix();
    scene.add(this.sun);
    scene.add(this.sun.target);

    scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
    scene.background = new THREE.Color(env.skyHorizon);
  }

  setFlash(v) { this.flash = Math.max(0, v); }

  updateSun(playerPos, dt = 0.016) {
    const dir = this.sunDir;
    this.sun.position.set(
      playerPos.x + dir.x * 100,
      playerPos.y + dir.y * 100,
      playerPos.z + dir.z * 100
    );
    this.sun.target.position.copy(playerPos);
    this.sun.target.updateMatrixWorld();
    if (this.skyGroup) this.skyGroup.position.set(playerPos.x, playerPos.y, playerPos.z);

    this.skyTime += dt || 0;
    this.windTime += dt || 0;
    if (this.skyMat) {
      this.skyMat.uniforms.uTime.value = this.skyTime;
      if (this.auroraStrength > 0.001) {
        this.skyMat.uniforms.uAurora.value = this.auroraStrength *
          (0.82 + Math.sin(this.skyTime * 0.23) * 0.12 + Math.sin(this.skyTime * 0.11 + 1.4) * 0.06);
      }
    }
    for (const mat of this.windMaterials) {
      const shader = mat.userData && mat.userData.windShader;
      if (shader) shader.uniforms.uWindTime.value = this.windTime;
    }
    if (this.waterfallMats) {
      const dtf = dt || 0.016;
      this.waterfallMats[0].map.offset.y = (this.waterfallMats[0].map.offset.y - dtf * 0.9) % 1;
      this.waterfallMats[1].map.offset.y = (this.waterfallMats[1].map.offset.y - dtf * 1.45) % 1;
    }
    this._updateMotes(playerPos, dt || 0.016);
    if (this.balloon) {
      const t = this.skyTime;
      this.balloon.position.y += Math.sin(t * 0.37) * 0.006 * (dt || 0.016);
      this.balloon.rotation.y = t * 0.006;
    }
    if (this.cloudGroup) {
      this.cloudGroup.rotation.y = this.skyTime * 0.008;
    }
    if (this.stars) {
      this.stars.rotation.y = this.skyTime * 0.0016;
      if (this.starsBright) this.starsBright.rotation.y = this.stars.rotation.y;
    }

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.6);
    const flash = this.flash;
    if (this.skyMat) this.skyMat.uniforms.flash.value = flash * 0.4;
    if (this.hemi) this.hemi.intensity = this.baseHemiIntensity * (1 + flash * 2.4);
    if (this.ambient) this.ambient.intensity = this.baseAmbient * (1 + flash * 2.0);
    if (this.sun) this.sun.intensity = this.baseSunIntensity * (1 + flash * 2.0);
  }

  _nearestIndexFast(x, z) {
    if (!this._coarse) {
      this._coarse = [];
      const stride = 5;
      for (let i = 0; i < this.n; i += stride) this._coarse.push(i);
    }
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < this._coarse.length; k++) {
      const i = this._coarse[k];
      const p = this.samples[i].pos;
      const dx = x - p.x, dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    let fine = best;
    for (let i = Math.max(0, best - 7); i < Math.min(this.n, best + 8); i++) {
      const p = this.samples[i].pos;
      const dx = x - p.x, dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; fine = i; }
    }
    return { index: fine, distance: Math.sqrt(bestD) };
  }

  async buildTerrain(scene, quality) {
    if (this.endless) {
      this._scene = scene;
      this._initEndlessAssets(scene, quality);
      return;
    }
    const step = quality === 'high' ? 4.4 : quality === 'medium' ? 6.2 : 8.5;
    const pad = quality === 'high' ? 95 : quality === 'medium' ? 72 : 46;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
    this.bounds = { minX, maxX, minZ, maxZ, step };
    const cols = Math.ceil((maxX - minX) / step) + 1;
    const rows = Math.ceil((maxZ - minZ) / step) + 1;
    const count = cols * rows;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const farMask = new Uint8Array(count);
    const white = new THREE.Color(0xffffff);
    const dirt = new THREE.Color(this.env.dirt || 0x8a7c5e).lerp(white, 0.62);
    const dark = this.stage.biome === 'snow'
      ? new THREE.Color(0xccd8e6)
      : new THREE.Color(0xd2d6c4);
    const rock = new THREE.Color(this.env.rock || 0x6e7064).lerp(white, 0.48);
    const moss = new THREE.Color(this.env.moss || this.env.treeAlt || 0x6b7f3a).lerp(white, 0.5);
    const snowShade = new THREE.Color(0xc7d8e8);
    const tmpC = new THREE.Color();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const x = minX + c * step;
        const z = minZ + r * step;
        const near = this._nearestIndexFast(x, z);
        const s = this.samples[near.index];
        const lateral = (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z;
        let y = this.heightAtSample(near.index, lateral);
        const d = near.distance;
        // keep terrain safely below road
        if (d < this.halfWidth + 1.2) y = Math.min(y, s.pos.y - 0.09);
        farMask[idx] = d > this.halfWidth + 5.5 ? 1 : 0;
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = z;
        uvs[idx * 2] = x * 0.075;
        uvs[idx * 2 + 1] = z * 0.075;

        const nearRoad = 1 - smoothstep(this.halfWidth + 0.7, this.halfWidth + (this.env.terrain?.edge || 6), d);
        const n = fbm(x * 0.06, z * 0.06, this.seed) * 0.5 + 0.5;
        const nFine = fbm(x * 0.23, z * 0.23, this.seed + 9) * 0.5 + 0.5;
        tmpC.setRGB(1, 1, 1).lerp(dark, n * 0.5);
        const rel = y - s.pos.y;
        const rockMix = clamp(
          smoothstep(1.2, 7.5, Math.abs(rel)) * (0.35 + nFine * 0.45) +
          (this.env.terrain?.style === 'mountain' ? smoothstep(0.5, 5, Math.abs(rel)) * 0.18 : 0),
          0, 0.72
        );
        tmpC.lerp(rock, rockMix);
        const mossMix = (1 - rockMix) * smoothstep(0.42, 0.82, fbm(x * 0.17, z * 0.17, this.seed + 21) * 0.5 + 0.5) * 0.34;
        tmpC.lerp(moss, mossMix);
        tmpC.lerp(dirt, nearRoad * 0.4);
        if (this.stage.biome === 'snow') {
          tmpC.lerp(snowShade, smoothstep(0.1, 3.0, Math.abs(rel)) * 0.2 + nearRoad * 0.1);
        }
        const shade = 0.9 + fbm(x * 0.13, z * 0.13, this.seed + 2) * 0.16;
        tmpC.multiplyScalar(shade);
        colors[idx * 3] = tmpC.r;
        colors[idx * 3 + 1] = tmpC.g;
        colors[idx * 3 + 2] = tmpC.b;
      }
      if (r % 24 === 0) await nextFrame();
    }
    // Soften the medial-axis steps where the nearest road sample jumps between
    // switchback legs. Only off-road terrain is blurred so the road edges stay crisp.
    for (let pass = 0; pass < 6; pass++) {
      const src = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        src[i] = positions[i]; src[i + 1] = positions[i + 1]; src[i + 2] = positions[i + 2];
      }
      for (let r = 1; r < rows - 1; r++) {
        for (let c = 1; c < cols - 1; c++) {
          const i = r * cols + c;
          if (!farMask[i]) continue;
          const y0 = src[i * 3 + 1];
          const yl = src[(i - 1) * 3 + 1], yr = src[(i + 1) * 3 + 1];
          const yu = src[(i - cols) * 3 + 1], yd = src[(i + cols) * 3 + 1];
          positions[i * 3 + 1] = y0 * 0.5 + (yl + yr + yu + yd) * 0.125;
        }
      }
    }
    const heights = new Float32Array(count);
    for (let i = 0; i < count; i++) heights[i] = positions[i * 3 + 1];
    this._terrainGrid = { minX, minZ, step, cols, rows, heights };
    const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const cc = a + cols;
        const dd = cc + 1;
        indices[k++] = a; indices[k++] = cc; indices[k++] = b;
        indices[k++] = b; indices[k++] = cc; indices[k++] = dd;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    const tex = makeGroundTexture(this.stage.biome);
    const bumpTex = makeGroundBumpTexture(this.stage.biome);
    const wet = clamp(this.env.wetness || 0, 0, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, bumpMap: bumpTex, bumpScale: this.stage.biome === 'snow' ? 0.05 : 0.11,
      vertexColors: true,
      roughness: this.stage.biome === 'snow' ? 0.9 : 0.98 - wet * 0.18,
      metalness: this.stage.biome === 'snow' ? 0.02 : 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    scene.add(mesh);
    this.terrainMesh = mesh;

    // safety floor far below
    const floorGeo = new THREE.PlaneGeometry(4000, 4000);
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
      color: this.env.groundDark, roughness: 1,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((minX + maxX) / 2, Math.min(...this.samples.map((s) => s.pos.y)) - 12, (minZ + maxZ) / 2);
    scene.add(floor);
    this.floor = floor;
    await nextFrame();
  }

  buildRoad(scene) {
    if (this.endless) {
      this._buildSkidPool(scene);
      return;
    }
    const n = this.n;
    const lanes = [-1, -0.5, 0, 0.5, 1];
    const positions = new Float32Array(n * lanes.length * 3);
    const uvs = new Float32Array(n * lanes.length * 2);
    const colors = new Float32Array(n * lanes.length * 3);
    const edgeCol = new THREE.Color(0x786b54);
    const midCol = new THREE.Color(0xffffff);

    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      for (let l = 0; l < lanes.length; l++) {
        const idx = i * lanes.length + l;
        const lat = lanes[l] * this.halfWidth;
        const y = s.pos.y + this.roadYOffset + this.roadCrown(lat);
        positions[idx * 3] = s.pos.x + s.right.x * lat;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = s.pos.z + s.right.z * lat;
        uvs[idx * 2] = (lanes[l] + 1) / 2;
        uvs[idx * 2 + 1] = s.dist / 9.5;
        const c = midCol.clone().lerp(edgeCol, Math.pow(Math.abs(lanes[l]), 2) * 0.5);
        colors[idx * 3] = c.r; colors[idx * 3 + 1] = c.g; colors[idx * 3 + 2] = c.b;
      }
    }
    const indices = [];
    for (let i = 0; i < n - 1; i++) {
      for (let l = 0; l < lanes.length - 1; l++) {
        const a = i * lanes.length + l;
        const b = a + 1;
        const c = a + lanes.length;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const { map, bump, roughness, bumpScale } = makeRoadTexture(this.env.road);
    const wet = clamp(this.env.wetness || 0, 0, 1);
    const mat = new THREE.MeshStandardMaterial({
      map, bumpMap: bump, bumpScale, roughness, metalness: 0.02,
      vertexColors: true,
    });
    mat.roughness = Math.max(0.16, roughness * (1 - wet * 0.62));
    mat.metalness = 0.02 + wet * 0.26;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'road';
    scene.add(mesh);
    this.roadMesh = mesh;

    // snow banks (drawn before shoulders for depth)
    if (this.stage.biome === 'snow') {
      const bankMat = new THREE.MeshStandardMaterial({ color: 0xeef4f9, roughness: 0.94 });
      for (const dir of [-1, 1]) {
        const lats = [0.0, 0.45, 0.95, 1.55];
        const lifts = [0.0, 0.2, 0.32, 0.1];
        const bPos = new Float32Array(n * lats.length * 3);
        for (let i = 0; i < n; i++) {
          const ss = this.samples[i];
          for (let l = 0; l < lats.length; l++) {
            const idx = i * lats.length + l;
            const lat = dir * (this.halfWidth + lats[l]);
            bPos[idx * 3] = ss.pos.x + ss.right.x * lat;
            bPos[idx * 3 + 1] = ss.pos.y + this.roadYOffset + this.roadCrown(dir * this.halfWidth) + lifts[l];
            bPos[idx * 3 + 2] = ss.pos.z + ss.right.z * lat;
          }
        }
        const ind = [];
        for (let i = 0; i < n - 1; i++) {
          for (let l = 0; l < lats.length - 1; l++) {
            const a = i * lats.length + l;
            const b = a + 1;
            const c = a + lats.length;
            const d = c + 1;
            if (dir > 0) ind.push(a, b, c, b, d, c);
            else ind.push(a, c, b, b, c, d);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
        g.setIndex(ind);
        g.computeVertexNormals();
        const bank = new THREE.Mesh(g, bankMat);
        bank.receiveShadow = true;
        scene.add(bank);
      }
    }

    // shoulders
    const biomeForShoulder = this.stage.biome;
    const shoulderColor = biomeForShoulder === 'snow'
      ? new THREE.Color(0xe3edf6)
      : new THREE.Color(this.env.dirt).lerp(new THREE.Color(0xffffff), biomeForShoulder === 'forest' || biomeForShoulder === 'jungle' ? 0.35 : 0.55);
    const shoulderSource = biomeForShoulder === 'snow' ? makeRoadTexture('snow')
      : biomeForShoulder === 'safari' ? makeRoadTexture('dirt')
        : biomeForShoulder === 'japan' || biomeForShoulder === 'russia' ? makeRoadTexture('gravel')
          : makeRoadTexture('gravel');
    const shoulderMat = new THREE.MeshStandardMaterial({
      map: shoulderSource.map,
      bumpMap: shoulderSource.bump,
      bumpScale: biomeForShoulder === 'snow' ? 0.05 : 0.09,
      roughness: biomeForShoulder === 'snow' ? 0.92 : 0.98,
      color: shoulderColor,
    });
    for (const dir of [-1, 1]) {
      const lats = [0, 1.1, 2.6, 4.0];
      const posA = new Float32Array(n * lats.length * 3);
      const uvA = new Float32Array(n * lats.length * 2);
      for (let i = 0; i < n; i++) {
        const s = this.samples[i];
        for (let l = 0; l < lats.length; l++) {
          const idx = i * lats.length + l;
          const lat = dir * (this.halfWidth + lats[l]);
          const y = s.pos.y + this.roadYOffset - lats[l] * 0.09 +
            (l === 0 ? this.roadCrown(dir * this.halfWidth) : 0);
          posA[idx * 3] = s.pos.x + s.right.x * lat;
          posA[idx * 3 + 1] = y;
          posA[idx * 3 + 2] = s.pos.z + s.right.z * lat;
          uvA[idx * 2] = (s.pos.x + s.right.x * lat) * 0.16;
          uvA[idx * 2 + 1] = (s.pos.z + s.right.z * lat) * 0.16;
        }
      }
      const ind = [];
      for (let i = 0; i < n - 1; i++) {
        for (let l = 0; l < lats.length - 1; l++) {
          const a = i * lats.length + l;
          const b = a + 1;
          const c = a + lats.length;
          const d = c + 1;
          if (dir > 0) ind.push(a, b, c, b, d, c);
          else ind.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(posA, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
      g.setIndex(ind);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, shoulderMat);
      m.receiveShadow = true;
      scene.add(m);
    }
    // wet sheen patches / puddles on the racing line
    if (wet >= 0.3) {
      const rng = mulberry32(this.seed + 515);
      const puddleMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(this.env.skyHorizon).lerp(new THREE.Color(0xffffff), 0.28),
        transparent: true,
        opacity: 0.07 + wet * 0.14,
        depthWrite: false,
      });
      const pGeo = new THREE.CircleGeometry(1, 14);
      const puddles = new THREE.InstancedMesh(pGeo, puddleMat, 46);
      for (let i = 0; i < 46; i++) {
        const idx = 20 + Math.floor(rng() * (this.n - 40));
        const s = this.samples[idx];
        const lat = (rng() - 0.5) * this.halfWidth * 1.5;
        TMP.position.set(
          s.pos.x + s.right.x * lat,
          s.pos.y + this.roadYOffset + 0.069,
          s.pos.z + s.right.z * lat
        );
        TMP.rotation.set(-Math.PI / 2, 0, rng() * Math.PI);
        TMP.scale.set(0.8 + rng() * 2.6, 0.5 + rng() * 1.4, 1);
        TMP.updateMatrix();
        puddles.setMatrixAt(i, TMP.matrix);
      }
      puddles.frustumCulled = false;
      scene.add(puddles);
    }

    this._buildSkidPool(scene);
  }

  /* ---------------- skid marks ---------------- */
  _buildSkidPool(scene) {
    const count = this.quality === 'low' ? 260 : 620;
    const geo = new THREE.PlaneGeometry(0.24, 0.92);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: makeSkidTexture(),
      color: this.stage.biome === 'snow' ? 0x9aa7b4 : 0x1a1611,
      transparent: true,
      opacity: this.stage.biome === 'snow' ? 0.22 : 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.skidMesh = new THREE.InstancedMesh(geo, mat, count);
    this.skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 1;
    this.skidCount = count;
    this.skidIdx = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.skidMesh.setMatrixAt(i, zero);
    this.skidMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.skidMesh);
  }

  emitSkid(pos, yaw, lateral = 0.68) {
    if (!this.skidMesh) return;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    TMP.position.set(pos.x + rx * lateral, pos.y + 0.064, pos.z + rz * lateral);
    TMP.rotation.set(0, yaw, 0);
    TMP.scale.set(1, 1, 0.85 + Math.random() * 0.4);
    TMP.updateMatrix();
    this.skidMesh.setMatrixAt(this.skidIdx, TMP.matrix);
    this.skidIdx = (this.skidIdx + 1) % this.skidCount;
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- props ---------------- */
  buildProps(scene, quality) {
    if (this.endless) {
      this._buildEndlessProps(scene);
      return;
    }
    this.gateColliders = [];
    const gateStart = 9;
    const gateFinish = this.n - 22;
    this.startGateIndex = gateStart;
    this.finishGateIndex = gateFinish;
    this.startLightsTexture = makeStartLightsTexture();
    this._addGate(scene, gateStart, false);
    this._addGate(scene, gateFinish, true);
    this._addFinishLine(scene, gateStart, false);
    this._addFinishLine(scene, gateFinish, true);
    this._addHazards(scene);
    this._addPosts(scene, quality);
    this._addGuardrails(scene, quality);
    this._addStoneWalls(scene, quality);
    this._addChevrons(scene, quality);
    this._addUtilityPoles(scene, quality);
    this._addLandmarks(scene, quality);
    this._addCliffs(scene, quality);
    this._addCrowd(scene, quality);
    this._addRoadside(scene, quality);
    this._addBiomeProps(scene, quality);
    this._addRidges(scene);
  }

  _addGate(scene, index, finish) {
    const s = this.samples[index];
    const group = new THREE.Group();
    group.position.copy(s.pos);
    group.rotation.y = s.heading;
    const steel = new THREE.MeshStandardMaterial({ color: 0x3b3d3c, roughness: 0.6, metalness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({
      color: finish ? 0xe7e3d4 : 0xf2c51f, roughness: 0.6, metalness: 0.1,
    });
    const postGeo = new THREE.BoxGeometry(0.26, 4.0, 0.26);
    for (const side of [-1, 1]) {
      const postLat = side * (this.halfWidth + 1.6);
      this.gateColliders.push({
        x: s.pos.x + s.right.x * postLat,
        z: s.pos.z + s.right.z * postLat,
        r: 0.32,
      });
      const post = new THREE.Mesh(postGeo, steel);
      post.position.set(postLat, 2.0, 0);
      post.castShadow = true;
      group.add(post);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, 0.3), accent);
      stripe.position.set(side * (this.halfWidth + 1.6), 1.2, 0);
      group.add(stripe);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry((this.halfWidth + 1.85) * 2, 0.22, 0.3), steel);
    beam.position.set(0, 3.98, 0);
    beam.castShadow = true;
    group.add(beam);

    const tex = makeBannerTexture(this.stage, finish);
    const bannerMat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.8, side: THREE.FrontSide,
      emissive: 0x111111, emissiveIntensity: 0.3,
    });
    const bw = this.halfWidth * 2 + 1.4;
    const bannerBack = new THREE.Mesh(new THREE.PlaneGeometry(bw, 1.5), bannerMat);
    bannerBack.position.set(0, 3.27, 0.02);
    group.add(bannerBack);
    const bannerFront = new THREE.Mesh(new THREE.PlaneGeometry(bw, 1.5), bannerMat);
    bannerFront.position.set(0, 3.27, -0.02);
    bannerFront.rotation.y = Math.PI;
    group.add(bannerFront);

    if (!finish) {
      const lightsMat = new THREE.MeshBasicMaterial({ map: this.startLightsTexture, toneMapped: false });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.88), lightsMat);
      panel.position.set(0, 2.76, -0.18);
      panel.rotation.y = Math.PI;
      group.add(panel);
      const backing = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.1, 0.22), steel);
      backing.position.set(0, 2.76, -0.05);
      group.add(backing);
      this.startLightsPanel = panel;
    }
    scene.add(group);
  }

  _addFinishLine(scene, index, finish) {
    const s = this.samples[index];
    let map;
    if (finish) {
      const { canvas, ctx } = canvas2D(512, 128);
      const size = 32;
      for (let x = 0; x < 512; x += size) {
        for (let y = 0; y < 128; y += size) {
          ctx.fillStyle = ((x / size) + (y / size)) % 2 ? '#111' : '#eee';
          ctx.fillRect(x, y, size, size);
        }
      }
      map = makeCanvasTexture(canvas);
    } else {
      const { canvas, ctx } = canvas2D(64, 64);
      ctx.fillStyle = '#eee';
      ctx.fillRect(0, 0, 64, 64);
      map = makeCanvasTexture(canvas);
    }
    const mat = new THREE.MeshStandardMaterial({
      map, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const lineGroup = new THREE.Group();
    lineGroup.position.set(s.pos.x, s.pos.y + this.roadYOffset + 0.075, s.pos.z);
    lineGroup.rotation.y = s.heading;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(this.halfWidth * 2, finish ? 1.5 : 0.5), mat);
    line.rotation.x = -Math.PI / 2;
    lineGroup.add(line);
    scene.add(lineGroup);
  }

  _addHazards(scene) {
    for (const h of this.hazardPatches) {
      if (!['water', 'mud', 'ice', 'wet', 'moss', 'sand', 'fesh', 'ruts'].includes(h.type)) continue;
      const rng = mulberry32(this.seed + h.start);
      const s = this.samples[h.start];
      const isIce = h.type === 'ice';
      const glossy = isIce || h.type === 'wet' || h.type === 'moss';
      const colors = {
        water: 0x1d2c2b, mud: 0x1d2c2b, ice: 0xbfd8e4, wet: 0x27333a,
        moss: 0x35452b, sand: 0x9a7645, fesh: 0xa87b4a, ruts: 0x6e583a,
      };
      const mat = new THREE.MeshStandardMaterial({
        color: colors[h.type] || 0x2f3a34,
        roughness: glossy ? 0.15 : 0.3,
        metalness: isIce ? 0.05 : glossy ? 0.2 : 0.05,
        transparent: true,
        opacity: isIce ? 0.55 : glossy ? 0.42 : 0.55,
        depthWrite: false,
      });
      const geo = new THREE.CircleGeometry(1, 18);
      for (let k = 0; k < 4; k++) {
        const idx = clamp(h.start + Math.floor(rng() * (h.end - h.start)), 0, this.n - 1);
        const ss = this.samples[idx];
        const lat = (rng() - 0.5) * this.halfWidth * 1.25;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(1.2 + rng() * 2.4, 0.65 + rng() * 0.7, 1);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = ss.heading + rng();
        mesh.position.set(
          ss.pos.x + ss.right.x * lat,
          ss.pos.y + this.roadYOffset + 0.068,
          ss.pos.z + ss.right.z * lat
        );
        scene.add(mesh);
      }
    }
  }

  _addPosts(scene, quality) {
    const stride = quality === 'high' ? 8 : 11;
    const biome = this.stage.biome;
    const isSnow = biome === 'snow';
    const isJapan = biome === 'japan';
    const isSafari = biome === 'safari';
    const isJungle = biome === 'jungle';
    const isRussia = biome === 'russia';
    const transforms = [];
    const capTransforms = [];
    const bandTransforms = [];
    for (let i = 12; i < this.n - 12; i += stride) {
      const s = this.samples[i];
      for (const side of [-1, 1]) {
        const lat = side * (this.halfWidth + (isSafari ? 1.65 : 1.15));
        const y = this.surfaceHeight(i, lat);
        const h = isSnow ? 1.95 : isSafari ? 1.1 : isJapan ? 0.92 : 0.85;
        transforms.push({
          x: s.pos.x + s.right.x * lat,
          y: y + h / 2,
          z: s.pos.z + s.right.z * lat,
          ry: s.heading, sx: 1, sy: h, sz: 1,
        });
        capTransforms.push({
          x: s.pos.x + s.right.x * lat,
          y: y + h - 0.11,
          z: s.pos.z + s.right.z * lat,
          ry: s.heading, sx: 1, sy: 1, sz: 1,
        });
        if (!isSnow && !isSafari) {
          bandTransforms.push({
            x: s.pos.x + s.right.x * lat,
            y: y + h * 0.7,
            z: s.pos.z + s.right.z * lat,
            ry: s.heading, sx: isJapan ? 0.72 : 0.8, sy: 0.34, sz: isJapan ? 0.72 : 0.8,
          });
        }
      }
    }
    const postGeo = isSafari || isJungle
      ? new THREE.CylinderGeometry(0.055, 0.08, 1, 6)
      : new THREE.BoxGeometry(isJapan ? 0.065 : 0.075, 1, isJapan ? 0.065 : 0.075);
    const postMat = new THREE.MeshStandardMaterial({
      color: isSnow ? 0xf0f5fa : isSafari ? 0xb99a63 : isJungle ? 0x8a7446
        : isRussia ? 0xe6e2d2 : 0xe4e0d2,
      roughness: 0.82,
    });
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, transforms.length);
    transforms.forEach((t, i) => {
      TMP.position.set(t.x, t.y, t.z);
      TMP.rotation.set(0, t.ry, 0);
      TMP.scale.set(t.sx, t.sy, t.sz);
      TMP.updateMatrix();
      postMesh.setMatrixAt(i, TMP.matrix);
    });
    postMesh.castShadow = true;
    scene.add(postMesh);

    const capGeo = new THREE.BoxGeometry(0.085, isSnow ? 0.42 : isSafari ? 0.08 : 0.17, 0.085);
    const capMat = new THREE.MeshStandardMaterial({
      color: isSnow ? 0xd7432c : isJapan ? 0xf0a226 : isSafari ? 0xefe9d8 : 0xd8402e,
      roughness: isJapan ? 0.5 : 0.65,
      emissive: isJapan ? 0x6b3b00 : 0x000000,
      emissiveIntensity: isJapan ? 0.35 : 0,
    });
    const capMesh = new THREE.InstancedMesh(capGeo, capMat, capTransforms.length);
    capTransforms.forEach((t, i) => {
      TMP.position.set(t.x, t.y, t.z);
      TMP.rotation.set(0, t.ry, 0);
      TMP.scale.set(t.sx, t.sy, t.sz);
      TMP.updateMatrix();
      capMesh.setMatrixAt(i, TMP.matrix);
    });
    scene.add(capMesh);

    if (bandTransforms.length) {
      const bandGeo = new THREE.BoxGeometry(0.09, 0.1, 0.09);
      const bandMat = new THREE.MeshStandardMaterial({ color: 0xf2eee0, roughness: 0.6 });
      const bandMesh = new THREE.InstancedMesh(bandGeo, bandMat, bandTransforms.length);
      bandTransforms.forEach((t, i) => {
        TMP.position.set(t.x, t.y, t.z);
        TMP.rotation.set(0, t.ry, 0);
        TMP.scale.set(t.sx, t.sy, t.sz);
        TMP.updateMatrix();
        bandMesh.setMatrixAt(i, TMP.matrix);
      });
      scene.add(bandMesh);
    }
  }

  /* ---------------- Japan-style guardrail ---------------- */
  _addGuardrails(scene, quality) {
    if (this.stage.biome !== 'japan') return;
    const step = 2;
    const railSegs = [];
    const postPts = [];
    for (let i = 10; i < this.n - 12; i += step) {
      const s = this.samples[i];
      const side = -this.mountainSideAt(s.dist);
      const lat = side * (this.halfWidth + 1.55);
      const x = s.pos.x + s.right.x * lat;
      const z = s.pos.z + s.right.z * lat;
      const y = s.pos.y + this.roadYOffset + this.roadCrown(side * this.halfWidth) + 0.68;
      const s2 = this.samples[Math.min(this.n - 1, i + step)];
      const lat2 = side * (this.halfWidth + 1.55);
      const x2 = s2.pos.x + s2.right.x * lat2;
      const z2 = s2.pos.z + s2.right.z * lat2;
      const y2 = s2.pos.y + this.roadYOffset + this.roadCrown(side * this.halfWidth) + 0.68;
      const len = Math.hypot(x2 - x, z2 - z);
      if (len > 0.4) {
        railSegs.push({
          x: (x + x2) / 2, y: (y + y2) / 2, z: (z + z2) / 2,
          ry: Math.atan2(x2 - x, z2 - z), len,
        });
      }
      if (i % (step * 4) === 0) {
        postPts.push({ x, y: y - 0.46, z, ry: s.heading });
      }
    }
    if (railSegs.length) {
      const railGeo = new THREE.BoxGeometry(0.075, 0.26, 1);
      const railMat = new THREE.MeshStandardMaterial({ color: 0xaeb0a7, roughness: 0.42, metalness: 0.7 });
      const railMesh = new THREE.InstancedMesh(railGeo, railMat, railSegs.length * 2);
      railSegs.forEach((r, i) => {
        for (const k of [0, 1]) {
          TMP.position.set(r.x, r.y - k * 0.34, r.z);
          TMP.rotation.set(0, r.ry, 0);
          TMP.scale.set(1, 1, r.len);
          TMP.updateMatrix();
          railMesh.setMatrixAt(i * 2 + k, TMP.matrix);
        }
      });
      railMesh.castShadow = quality === 'high';
      scene.add(railMesh);
    }
    if (postPts.length) {
      const postGeo = new THREE.BoxGeometry(0.1, 0.78, 0.1);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x777b73, roughness: 0.6, metalness: 0.3 });
      const posts = new THREE.InstancedMesh(postGeo, postMat, postPts.length);
      postPts.forEach((p, i) => {
        TMP.position.set(p.x, p.y + 0.39, p.z);
        TMP.rotation.set(0, p.ry, 0);
        TMP.scale.setScalar(1);
        TMP.updateMatrix();
        posts.setMatrixAt(i, TMP.matrix);
      });
      posts.castShadow = quality === 'high';
      scene.add(posts);
    }
  }

  /* ---------------- retaining walls / dry stone walls ---------------- */
  _addStoneWalls(scene, quality) {
    const biome = this.stage.biome;
    if (biome !== 'japan' && biome !== 'forest') return;
    const sections = [];
    if (biome === 'japan') {
      sections.push({ i0: 14, i1: this.n - 20, side: null, hMax: 2.7, step: 2 });
    } else {
      // A few short Northumberland dry-stone walls along the verges.
      const rng = mulberry32(this.seed + 771);
      for (let s = 45; s < this.n - 70; s += 150 + rng() * 160) {
        const len = 40 + rng() * 60;
        sections.push({ i0: s, i1: Math.min(this.n - 15, s + len), side: rng() > 0.5 ? 1 : -1, hMax: 1.05, step: 3 });
      }
    }
    const wallMat = new THREE.MeshStandardMaterial({
      map: makeRockTexture(), color: biome === 'japan' ? 0xc3c4b6 : 0xc6bda6,
      roughness: 0.98, metalness: 0, side: THREE.DoubleSide,
    });
    for (const sec of sections) {
      const pos = [];
      const uv = [];
      const ind = [];
      let v = 0;
      let prev = null;
      let prevSide = null;
      const secStart = Math.floor(Math.max(8, sec.i0));
      const secEnd = Math.floor(Math.min(this.n - 8, sec.i1));
      const secStep = Math.max(1, Math.floor(sec.step));
      for (let i = secStart; i < secEnd; i += secStep) {
        const s = this.samples[i];
        const side = sec.side == null ? this.mountainSideAt(s.dist) : sec.side;
        const lat = side * (this.halfWidth + (biome === 'japan' ? 2.0 : 2.5));
        const x = s.pos.x + s.right.x * lat;
        const z = s.pos.z + s.right.z * lat;
        const base = s.pos.y + this.roadYOffset;
        const terrainY = this.heightAtSample(i, lat);
        let h = biome === 'japan'
          ? clamp(terrainY - base + 0.35, 0.55, sec.hMax)
          : sec.hMax;
        if (biome === 'japan' && h < 0.7) { prev = null; continue; }
        const cur = { x, z, base, h, dist: s.dist };
        if (prev && prevSide === side) {
          const p0 = pos.length / 3;
          pos.push(prev.x, prev.base, prev.z, cur.x, cur.base, cur.z,
            cur.x, cur.base + cur.h, cur.z, prev.x, prev.base + prev.h, prev.z);
          uv.push(prev.dist * 0.32, 0, cur.dist * 0.32, 0,
            cur.dist * 0.32, cur.h * 0.5, prev.dist * 0.32, prev.h * 0.5);
          ind.push(p0, p0 + 1, p0 + 2, p0, p0 + 2, p0 + 3);
          v++;
        }
        prev = cur;
        prevSide = side;
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(ind);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.receiveShadow = true;
        mesh.castShadow = quality === 'high';
        scene.add(mesh);
      }
    }
  }

  _chevronTexture() {
    const { canvas, ctx } = canvas2D(256, 128);
    ctx.fillStyle = '#151812';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#e8e3d0';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 120);
    ctx.fillStyle = '#f2c43a';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const x = 32 + i * 66;
      ctx.moveTo(x, 22);
      ctx.lineTo(x + 38, 64);
      ctx.lineTo(x, 106);
      ctx.lineTo(x + 22, 106);
      ctx.lineTo(x + 60, 64);
      ctx.lineTo(x + 22, 22);
      ctx.closePath();
      ctx.fill();
    }
    return makeCanvasTexture(canvas);
  }

  _addChevrons(scene, quality) {
    const biome = this.stage.biome;
    if (biome !== 'japan' && biome !== 'snow') return;
    const tex = this._chevronTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, side: THREE.DoubleSide, roughness: 0.7,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8b8d85, roughness: 0.8 });
    const rng = mulberry32(this.seed + 809);
    let placed = 0;
    for (let i = 30; i < this.n - 40 && placed < 18; i += 8) {
      const s = this.samples[i];
      if (Math.abs(s.curvatureSmooth) < 0.014) continue;
      const side = s.curvatureSmooth > 0 ? -1 : 1;
      const lat = side * (this.halfWidth + 2.1);
      const y = this.surfaceHeight(i, lat);
      const g = new THREE.Group();
      g.position.set(s.pos.x + s.right.x * lat, y, s.pos.z + s.right.z * lat);
      g.rotation.y = s.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), mat);
      board.position.y = 1.25;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), postMat);
      post.position.y = 0.55;
      g.add(post);
      scene.add(g);
      placed++;
      i += 12;
    }
  }

  _addUtilityPoles(scene, quality) {
    const biome = this.stage.biome;
    if (!['forest', 'russia', 'japan'].includes(biome)) return;
    const rng = mulberry32(this.seed + 431);
    const poles = [];
    let side = rng() < 0.5 ? 1 : -1;
    const stride = quality === 'high' ? (biome === 'japan' ? 26 : 32) : 40;
    for (let i = 30; i < this.n - 30; i += stride) {
      side *= -1;
      const s = this.samples[i];
      const lat = side * (this.halfWidth + 4.6 + rng() * 1.8);
      poles.push({
        x: s.pos.x + s.right.x * lat,
        y: this.heightAtSample(i, lat),
        z: s.pos.z + s.right.z * lat,
        rot: s.heading,
      });
    }
    if (!poles.length) return;
    const parts = [];
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.17, biome === 'japan' ? 8.5 : 7.4, 7);
    poleGeo.translate(0, 3.7, 0);
    parts.push(poleGeo);
    const bar = new THREE.BoxGeometry(1.6, 0.09, 0.1);
    bar.translate(0, 6.8, 0);
    parts.push(bar);
    for (const dx of [-0.62, 0.62]) {
      const ins = new THREE.CylinderGeometry(0.05, 0.07, 0.17, 5);
      ins.translate(dx, 6.94, 0);
      parts.push(ins);
    }
    const geo = mergeGeometries(parts);
    const mat = new THREE.MeshStandardMaterial({
      color: biome === 'japan' ? 0x6f6659 : 0x3a3128, roughness: 0.95,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, poles.length);
    poles.forEach((p, i) => {
      TMP.position.set(p.x, p.y, p.z);
      TMP.rotation.set(0, p.rot, 0);
      TMP.scale.setScalar(1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.castShadow = quality === 'high';
    scene.add(mesh);
    if (quality === 'high') {
      const wirePts = [];
      for (let i = 0; i < poles.length - 1; i++) {
        const a = poles[i], b = poles[i + 1];
        const off = 0.62 * (i % 2 ? 1 : -1);
        const ax = a.x + Math.cos(a.rot) * off;
        const az = a.z - Math.sin(a.rot) * off;
        const bx = b.x + Math.cos(b.rot) * off;
        const bz = b.z - Math.sin(b.rot) * off;
        const ay = a.y + 6.94;
        const by = b.y + 6.94;
        for (let k = 0; k < 7; k++) {
          const t = k / 7;
          const sag = Math.sin(t * Math.PI) * 0.7;
          wirePts.push(ax + (bx - ax) * t, ay + (by - ay) * t - sag, az + (bz - az) * t);
        }
      }
      const wireGeo = new THREE.BufferGeometry();
      wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
      const wire = new THREE.Line(wireGeo, new THREE.LineBasicMaterial({
        color: 0x1b1d1a, transparent: true, opacity: 0.55,
      }));
      wire.frustumCulled = false;
      scene.add(wire);
    }
  }

  _addCliffs(scene, quality) {
    const biome = this.stage.biome;
    if (biome !== 'japan' && biome !== 'jungle') return;
    const rng = mulberry32(this.seed + 612);
    const rocks = [];
    for (let i = 18; i < this.n - 20; i += 5) {
      if (rng() < 0.42) continue;
      let side;
      if (biome === 'japan') side = this.mountainSideAt(this.samples[i].dist);
      else side = rng() < 0.5 ? -1 : 1;
      const dist = biome === 'japan' ? 12.5 + rng() * 15 : 8 + rng() * 16;
      const lat = side * (this.halfWidth + dist);
      const rx = this.samples[i].pos.x + this.samples[i].right.x * lat;
      const rz = this.samples[i].pos.z + this.samples[i].right.z * lat;
      if (this._isExcluded(rx, rz)) continue;
      rocks.push({
        x: rx,
        y: (this._terrainGrid && Math.abs(lat) > this.halfWidth + 6
          ? this.terrainHeightAt(rx, rz)
          : this.heightAtSample(i, lat)) - 0.5,
        z: rz,
        scale: (biome === 'japan' ? 1.1 : 0.9) + Math.pow(rng(), 1.4) * (biome === 'japan' ? 3.2 : 3.0),
        rot: rng() * Math.PI * 2,
        tiltX: (rng() - 0.5) * 0.3,
        tiltZ: (rng() - 0.5) * 0.3,
      });
    }
    if (!rocks.length) return;
    const geo = new THREE.DodecahedronGeometry(1, 1);
    geo.scale(1.45, 0.92, 1.05);
    const mat = new THREE.MeshStandardMaterial({
      map: makeRockTexture(),
      color: 0xffffff,
      roughness: 0.97, flatShading: true,
    });
    const mesh = this._instanced(geo, mat, rocks, () => {
      const c = new THREE.Color(1, 1, 1).multiplyScalar(0.82 + rng() * 0.28);
      c.offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.08, 0);
      return c;
    });
    if (mesh) {
      mesh.castShadow = quality === 'high';
      scene.add(mesh);
    }
  }

  _addTorii(scene, index, side) {
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const lat = side * (this.halfWidth + 5.4);
    const y = this.heightAtSample(index, lat);
    const group = new THREE.Group();
    group.position.set(s.pos.x + s.right.x * lat, y, s.pos.z + s.right.z * lat);
    group.rotation.y = s.heading + (side > 0 ? 0.1 : -0.1);
    const red = new THREE.MeshStandardMaterial({ color: 0xb33928, roughness: 0.72 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2722, roughness: 0.8 });
    for (const px of [-1.45, 1.45]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.4, 8), red);
      post.position.set(px, 1.7, 0);
      post.castShadow = true;
      group.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.24, 0.34), red);
    top.position.y = 3.35;
    top.castShadow = true;
    group.add(top);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.16, 0.46), dark);
    cap.position.y = 3.55;
    group.add(cap);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.18, 0.24), red);
    tie.position.y = 2.55;
    group.add(tie);
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.09), dark);
    plaque.position.y = 2.95;
    group.add(plaque);
    scene.add(group);
  }

  _addBiomeProps(scene, quality) {
    const biome = this.stage.biome;
    const rng = mulberry32(this.seed + 551);
    if (biome === 'japan') {
      this._addTorii(scene, 16, -1);
      this._addTorii(scene, Math.floor(this.n * 0.58), 1);
    }
    if (biome === 'jungle') {
      const pts = [];
      for (let i = 18; i < this.n - 18; i += 7) {
        if (rng() < 0.42) {
          const side = rng() < 0.5 ? -1 : 1;
          const s = this.samples[i];
          const lat = side * (this.halfWidth + 2 + rng() * 5);
          pts.push({
            x: s.pos.x + s.right.x * lat,
            y: this.heightAtSample(i, lat),
            z: s.pos.z + s.right.z * lat,
            ry: s.heading + rng() * 0.4,
            h: 2.5 + rng() * 3.5,
          });
        }
      }
      if (pts.length) {
        const geo = new THREE.PlaneGeometry(0.22, 1);
        geo.translate(0, 0.5, 0);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x4f6f2d, roughness: 0.95, side: THREE.DoubleSide,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
        pts.forEach((p, i) => {
          TMP.position.set(p.x, p.y, p.z);
          TMP.rotation.set(0, p.ry, 0);
          TMP.scale.set(1, p.h, 1);
          TMP.updateMatrix();
          mesh.setMatrixAt(i, TMP.matrix);
        });
        scene.add(mesh);
      }
    }
    if (biome === 'safari') {
      // weathered fence posts along a few sections of the track
      const posts = [];
      for (let i = 60; i < this.n - 80; i += 18) {
        if (rng() < 0.55) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const s = this.samples[i];
        const lat = side * (this.halfWidth + 3.2 + rng() * 3);
        posts.push({
          x: s.pos.x + s.right.x * lat, y: this.heightAtSample(i, lat),
          z: s.pos.z + s.right.z * lat, ry: s.heading,
        });
      }
      if (posts.length) {
        const geo = new THREE.CylinderGeometry(0.07, 0.11, 1.6, 5);
        geo.translate(0, 0.8, 0);
        const mat = new THREE.MeshStandardMaterial({ color: 0x6b5437, roughness: 1 });
        const mesh = new THREE.InstancedMesh(geo, mat, posts.length);
        posts.forEach((p, i) => {
          TMP.position.set(p.x, p.y, p.z);
          TMP.rotation.set(0, p.ry, 0);
          TMP.updateMatrix();
          mesh.setMatrixAt(i, TMP.matrix);
        });
        scene.add(mesh);
      }
    }
  }


  /* ============================================================
     SIGNATURE SET PIECES
     Every biome gets its own landmark architecture and wildlife so
     the stages read as different places, not just different palettes.
     ============================================================ */

  _findFeatureIndex(frac, spread = 55) {
    const center = Math.round((this.n - 1) * frac);
    let best = center;
    let score = Infinity;
    for (let i = Math.max(12, center - spread); i < Math.min(this.n - 12, center + spread); i++) {
      const s = this.samples[i];
      const candidate = Math.abs(s.curvatureSmooth) * 90 + Math.abs(s.grade) * 2.2;
      if (candidate < score) { score = candidate; best = i; }
    }
    return best;
  }

  _markExclusion(x, z, r = 8) {
    this.exclusionZones.push({ x, z, r });
  }

  _isExcluded(x, z) {
    if (!this.exclusionZones.length) return false;
    for (const zone of this.exclusionZones) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      if (dx * dx + dz * dz < zone.r * zone.r) return true;
    }
    return false;
  }

  _markSightline(x0, z0, x1, z1, r = 7, steps = 7) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this._markExclusion(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r);
    }
  }

  _landmarkMats() {
    if (this._lmMats) return this._lmMats;
    const vc = (opts = {}) => new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, ...opts,
    });
    const ice = makeIceTexture();
    ice.repeat.set(3.2, 3.2);
    const water = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.env.skyHorizon).lerp(new THREE.Color(0x264b50), 0.42),
      roughness: 0.12, metalness: 0.22, transparent: true, opacity: 0.78,
      depthWrite: false,
    });
    this._lmMats = {
      stone: vc({ map: makeRockTexture(), roughness: 0.98 }),
      wood: vc({ map: makeWoodTexture('log'), roughness: 0.93 }),
      plank: vc({ map: makeWoodTexture('plank'), roughness: 0.9 }),
      roof: vc({ roughness: 0.85 }),
      cloth: vc({ roughness: 0.97 }),
      paint: vc({ roughness: 0.62 }),
      dark: vc({ roughness: 0.82 }),
      metal: vc({ roughness: 0.5, metalness: 0.5 }),
      hay: vc({ roughness: 0.98 }),
      tunnel: new THREE.MeshStandardMaterial({
        map: makeRockTexture(), color: 0x5a5b52, roughness: 0.94,
        metalness: 0, side: THREE.DoubleSide,
      }),
      ice: new THREE.MeshStandardMaterial({
        map: ice, color: 0xaed6ea, roughness: 0.08, metalness: 0.18,
        emissive: 0x1d3c52, emissiveIntensity: 0.35,
        transparent: true, opacity: 0.92, depthWrite: false,
      }),
      water,
      glow: new THREE.MeshBasicMaterial({ color: 0xffc777, toneMapped: false }),
      flame: new THREE.MeshBasicMaterial({
        color: 0xff8b2f, transparent: true, opacity: 0.82, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    };
    return this._lmMats;
  }

  _addColoredMesh(scene, parts, mat, opts = {}) {
    if (!parts || !parts.length) return null;
    const geo = mergeColored(parts);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
    mesh.rotation.y = opts.ry || 0;
    mesh.castShadow = opts.cast !== false && this.quality === 'high';
    mesh.receiveShadow = opts.receive !== false;
    if (opts.order != null) mesh.renderOrder = opts.order;
    scene.add(mesh);
    this.featureMeshes.push(mesh);
    return mesh;
  }

  _addGlowSprite(parent, x, y, z, color = 0xffc777, size = 2.2, opacity = 0.5) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeSoftDotTexture(), color, transparent: true,
      opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    }));
    spr.position.set(x, y, z);
    spr.scale.setScalar(size);
    spr.renderOrder = 3;
    parent.add(spr);
    return spr;
  }

  _addPointLight(parent, x, y, z, color = 0xffbd72, intensity = 26, distance = 22) {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    parent.add(light);
    return light;
  }

  _signTexture(main, sub = '', opts = {}) {
    const { canvas, ctx } = canvas2D(512, 192);
    const bg = opts.bg || '#172018';
    const fg = opts.fg || '#eae4d2';
    const accent = opts.accent || '#f2c51f';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 7;
    ctx.strokeRect(8, 8, 496, 176);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 68px "Barlow Condensed", sans-serif';
    ctx.fillText(main, 256, sub ? 76 : 96, 456);
    if (sub) {
      ctx.fillStyle = accent;
      ctx.font = '600 30px "Barlow Condensed", sans-serif';
      ctx.fillText(sub, 256, 138, 440);
    }
    return makeCanvasTexture(canvas);
  }

  _addRoadsideSign(scene, index, side, main, sub, opts = {}) {
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const lat = side * (this.halfWidth + (opts.lat || 3.0));
    const y = this.heightAtSample(index, lat);
    const group = new THREE.Group();
    group.position.set(s.pos.x + s.right.x * lat, y, s.pos.z + s.right.z * lat);
    group.rotation.y = s.heading + Math.PI;
    const tex = this._signTexture(main, sub, opts);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(opts.w || 3.2, opts.h || 1.2), new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.82, side: THREE.DoubleSide,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1,
    }));
    board.position.y = 2.15;
    group.add(board);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2d27, roughness: 0.55, metalness: 0.35 });
    for (const dx of [-1.25, 1.25]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.15, 0.1), postMat);
      post.position.set(dx, 1.07, -0.07);
      group.add(post);
    }
    scene.add(group);
    return group;
  }

  _addSheep(scene, spots) {
    if (!spots.length) return;
    const parts = [];
    partSphere(parts, 0xded8c4, 0.58, 0, 0.82, 0, 1.3, 0.95, 1.05);
    partSphere(parts, 0xe9e3d0, 0.48, -0.34, 0.9, 0.16, 0.92, 0.9, 0.9);
    partSphere(parts, 0x2d2a24, 0.22, 0.6, 1.02, 0.1, 1.1, 0.9, 0.8);
    partSphere(parts, 0x1e1c18, 0.13, 0.8, 1.06, 0.1);
    for (const [x, z] of [[-0.26, -0.26], [0.32, -0.3], [-0.26, 0.3], [0.32, 0.32]]) {
      partBox(parts, 0x38332a, 0.12, 0.55, 0.12, x, 0.26, z);
    }
    partBox(parts, 0x4c4438, 0.1, 0.28, 0.16, 0.14, 1.05, -0.76);
    const geo = mergeColored(parts);
    const mat = new THREE.MeshStandardMaterial({
      map: makeAnimalTexture('sheep'), vertexColors: true, roughness: 0.98,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((p, i) => {
      TMP.position.set(p.x, p.y, p.z);
      TMP.rotation.set(0, p.ry || 0, 0);
      TMP.scale.setScalar(p.scale || 1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.castShadow = this.quality === 'high';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  _addPhoneBox(scene, index, side) {
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const lat = side * (this.halfWidth + 2.6);
    const y = this.heightAtSample(index, lat);
    const red = this._landmarkMats().plank;
    const parts = [
      { geometry: new THREE.BoxGeometry(1.0, 2.45, 1.0).translate(0, 1.23, 0), color: 0xb83225 },
      { geometry: new THREE.BoxGeometry(1.12, 0.14, 1.12).translate(0, 2.52, 0), color: 0x7c2018 },
      { geometry: new THREE.BoxGeometry(0.82, 0.7, 0.05).translate(0, 1.72, 0.505), color: 0xe9e5d3 },
      { geometry: new THREE.BoxGeometry(0.82, 0.7, 0.05).translate(0, 1.72, -0.505), color: 0xe9e5d3 },
      { geometry: new THREE.BoxGeometry(0.32, 0.55, 0.08).translate(0, 1.15, 0.54), color: 0x31241f },
    ];
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.5, 0.5]) {
        parts.push({ geometry: new THREE.BoxGeometry(0.07, 2.4, 0.07).translate(x, 1.22, z), color: 0x7c2018 });
      }
    }
    const mesh = this._addColoredMesh(scene, parts, red, {
      x: s.pos.x + s.right.x * lat, y, z: s.pos.z + s.right.z * lat, ry: s.heading + 0.12,
    });
    if (mesh) {
      const sign = this._addGlowSprite(scene, s.pos.x + s.right.x * lat, y + 2.2, s.pos.z + s.right.z * lat, 0xffd9a0, 1.2, 0.16);
      if (sign) sign.visible = true;
    }
    this._markExclusion(s.pos.x + s.right.x * lat, s.pos.z + s.right.z * lat, 3);
  }

  _forestSet(scene, quality) {
    const mats = this._landmarkMats();
    const rng = mulberry32(this.seed + 4113);
    const index = this._findFeatureIndex(0.63, 60);
    const side = rng() < 0.5 ? -1 : 1;
    const s = this.samples[index];
    const lat = side * (this.halfWidth + 15.5);
    const bx = s.pos.x + s.right.x * lat;
    const bz = s.pos.z + s.right.z * lat;
    const by = this.heightAtSample(index, lat);
    const ry = s.heading + (rng() - 0.5) * 0.45;

    const walls = [];
    partBox(walls, 0xb9b09a, 8.6, 3.25, 5.4, 0, 1.62, 0);
    partBox(walls, 0x8f8877, 8.9, 0.35, 5.7, 0, 3.34, 0);
    partBox(walls, 0x2b2a25, 1.65, 2.15, 0.18, -1.6, 1.08, -2.76);
    partBox(walls, 0x312e27, 0.9, 0.8, 0.12, 1.9, 1.95, -2.76);
    partBox(walls, 0x312e27, 0.8, 0.75, 0.12, 2.75, 1.9, 2.76);
    partBox(walls, 0xc4bca8, 4.6, 0.7, 0.3, 0.1, 0.35, -2.8);
    const wallMesh = this._addColoredMesh(scene, walls, mats.stone, { x: bx, y: by, z: bz, ry });
    if (wallMesh) this._markExclusion(bx, bz, 22);
    this._markSightline(s.pos.x, s.pos.z, bx, bz, 8, 7);
    this.landmarks.farm = { x: bx, z: bz, y: by };

    const roofParts = [];
    partBox(roofParts, 0x4b4b44, 5.1, 0.25, 6.0, -2.15, 4.68, 0, 0, 0, 0.62);
    partBox(roofParts, 0x55554c, 5.1, 0.25, 6.0, 2.15, 4.68, 0, 0, 0, -0.62);
    partBox(roofParts, 0x44443d, 9.2, 0.18, 0.3, 0, 5.22, 0);
    this._addColoredMesh(scene, roofParts, mats.roof, { x: bx, y: by, z: bz, ry });

    // field fence along the barn's boundary
    const fence = [];
    for (let k = 0; k < 9; k++) {
      partBox(fence, 0x6f5131, 0.12, 1.1, 0.12, k * 3 - 12, 0.55, 0);
    }
    partBox(fence, 0x775632, 24.2, 0.11, 0.1, 0, 0.78, 0);
    partBox(fence, 0x6b4d2f, 24.2, 0.1, 0.1, 0, 0.4, 0);
    this._addColoredMesh(scene, fence, mats.plank, { x: bx, y: by, z: bz, ry });

    // hay bales in the field
    const hay = [];
    for (let k = 0; k < 5; k++) {
      const hx = -2 + rng() * 7;
      const hz = -4 + rng() * 7;
      partBox(hay, 0xc9ae66, 1.05, 0.62, 0.55, hx, 0.34, hz, rng() * 0.4);
    }
    this._addColoredMesh(scene, hay, mats.hay, { x: bx, y: by, z: bz, ry });

    const sheep = [];
    for (let k = 0; k < 10; k++) {
      const along = (rng() - 0.5) * 36;
      const si = clamp(index + Math.round(along / this.step), 4, this.n - 5);
      const ss = this.samples[si];
      const slat = side * (this.halfWidth + 9 + rng() * 18);
      const px = ss.pos.x + ss.right.x * slat + ss.tangent.x * (rng() - 0.5) * 6;
      const pz = ss.pos.z + ss.right.z * slat + ss.tangent.z * (rng() - 0.5) * 6;
      const near = this._nearestIndexFast(px, pz);
      const nearS = this.samples[near.index];
      const nlat = (px - nearS.pos.x) * nearS.right.x + (pz - nearS.pos.z) * nearS.right.z;
      sheep.push({
        x: px, z: pz, y: this.heightAtSample(near.index, nlat),
        ry: rng() * Math.PI * 2, scale: 0.78 + rng() * 0.3,
      });
    }
    this._addSheep(scene, sheep);

    this._addPhoneBox(scene, this._findFeatureIndex(0.24, 28), rng() < 0.5 ? -1 : 1);
    this._addRoadsideSign(scene, index + 6, -side, 'KIELDER', 'FOREST STAGE · SS01', { w: 2.1, h: 0.9, lat: 2.4 });
  }


  _jungleSet(scene, quality) {
    const mats = this._landmarkMats();
    const rng = mulberry32(this.seed + 5221);
    const index = this._findFeatureIndex(0.53, 52);
    const s = this.samples[index];
    const upSide = this.heightAtSample(index, this.halfWidth + 14) >
      this.heightAtSample(index, -(this.halfWidth + 14)) ? 1 : -1;
    const lat = upSide * (this.halfWidth + 8.6);
    const wx = s.pos.x + s.right.x * lat;
    const wz = s.pos.z + s.right.z * lat;
    const wy = this.heightAtSample(index, lat);
    const faceYaw = Math.atan2(s.pos.x - wx, s.pos.z - wz);

    // Rock shelf and wet boulders at the foot of the fall.
    const rocks = [];
    for (let k = 0; k < 11; k++) {
      const r = 1.0 + Math.pow(rng(), 1.4) * 2.6;
      const g = new THREE.DodecahedronGeometry(r, 1);
      g.scale(1.25, 0.9 + rng() * 0.5, 1.1);
      g.translate((rng() - 0.5) * 13, 0.4 + rng() * 5.8, -4.2 - rng() * 3.0);
      rocks.push({ geometry: g, color: new THREE.Color(0x5c665a).offsetHSL(0, 0, (rng() - 0.5) * 0.12) });
    }
    for (let k = 0; k < 8; k++) {
      const r = 2.6 + rng() * 2.2;
      const g = new THREE.DodecahedronGeometry(r, 0);
      g.scale(1.15 + rng() * 0.35, 2.2 + rng() * 1.4, 0.9 + rng() * 0.4);
      g.translate((rng() - 0.5) * 12, 6.5 + rng() * 5.2, -8.0 - rng() * 3.0);
      rocks.push({ geometry: g, color: new THREE.Color(0x4f5a4e).offsetHSL(0, 0, (rng() - 0.5) * 0.1) });
    }
    for (let k = 0; k < 6; k++) {
      const r = 1.9 + rng() * 1.8;
      const g = new THREE.DodecahedronGeometry(r, 0);
      g.scale(1.1 + rng() * 0.5, 2.0 + rng() * 1.8, 0.8 + rng() * 0.3);
      g.translate((rng() - 0.5) * 9, 5.0 + rng() * 8.0, -2.7 - rng() * 1.0);
      rocks.push({ geometry: g, color: new THREE.Color(0x465246).offsetHSL(0, 0, (rng() - 0.5) * 0.09) });
    }
    partBox(rocks, 0x4a5549, 14, 17, 2.2, 0, 8.2, -5.0);
    this._addColoredMesh(scene, rocks, mats.stone, { x: wx, y: wy - 1.1, z: wz, ry: faceYaw });

    // Scrolling waterfall sheets with a foam pool and drifting mist.
    const wfMat = new THREE.MeshBasicMaterial({
      map: makeWaterfallTexture(), transparent: true, opacity: 0.58,
      color: 0xaedce8, side: THREE.DoubleSide, depthWrite: false,
    });
    wfMat.map.repeat.set(1, 1.55);
    wfMat.map.wrapT = THREE.RepeatWrapping;
    const wf2Mat = wfMat.clone();
    wf2Mat.map = wfMat.map.clone();
    wf2Mat.map.needsUpdate = true;
    wf2Mat.map.repeat.set(1.4, 1.75);
    wf2Mat.opacity = 0.42;
    const fallGroup = new THREE.Group();
    fallGroup.position.set(wx, wy - 0.45, wz);
    fallGroup.rotation.y = faceYaw;
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 15.5), wfMat);
    fall.position.set(0, 7.7, 0.1);
    fallGroup.add(fall);
    const fall2 = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 14.0), wf2Mat);
    fall2.position.set(0.3, 6.8, -0.35);
    fallGroup.add(fall2);
    const lipMat = new THREE.MeshStandardMaterial({ color: 0x3e4a3f, roughness: 0.95 });
    for (const [lx, ly, lz, ls] of [[0, 15.15, 0.35, 1.5], [-2.35, 15.35, 0.1, 1.0], [2.4, 15.3, 0.15, 1.1]]) {
      const lg = new THREE.DodecahedronGeometry(1.6, 0);
      lg.scale(1.35 * ls, 0.42 * ls, 0.95 * ls);
      const lip = new THREE.Mesh(lg, lipMat);
      lip.position.set(lx, ly, lz);
      lip.rotation.z = (lx < 0 ? -1 : 1) * 0.08;
      fallGroup.add(lip);
    }
    const poolMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.env.skyHorizon).lerp(new THREE.Color(0x294f50), 0.5),
      roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.72, depthWrite: false,
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.0, 22), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.15, 1.0);
    fallGroup.add(pool);
    for (let i = 0; i < 12; i++) {
      const spr = this._addGlowSprite(fallGroup, (rng() - 0.5) * 7.0, 0.3 + rng() * 3.6,
        1.2 + rng() * 2.0, 0xd9f6ff, 2.4 + rng() * 3.4, 0.045 + rng() * 0.06);
      spr.material.blending = THREE.NormalBlending;
    }
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const foam = new THREE.Mesh(new THREE.CircleGeometry(0.8 + rng() * 1.1, 12), foamMat);
      foam.rotation.x = -Math.PI / 2;
      foam.position.set((rng() - 0.5) * 4.2, 0.18, 0.2 + rng() * 1.6);
      fallGroup.add(foam);
    }
    scene.add(fallGroup);
    this.featureMeshes.push(fallGroup);
    this.waterfallMats = [wfMat, wf2Mat];
    this._markExclusion(wx, wz, 20);
    this._markSightline(s.pos.x, s.pos.z, wx, wz, 8, 7);
    this.landmarks.waterfall = { x: wx, z: wz, y: wy };

    // Hanging rope bridge high above the road.
    const bridgeIndex = this._findFeatureIndex(0.76, 32);
    this._addRopeBridge(scene, bridgeIndex);

    // A moss-covered jungle shrine stone pile, with parrots on top.
    const ruinIndex = this._findFeatureIndex(0.3, 34);
    const rs = this.samples[ruinIndex];
    const rside = rng() < 0.5 ? -1 : 1;
    const rlat = rside * (this.halfWidth + 4.4 + rng() * 2.0);
    const rx = rs.pos.x + rs.right.x * rlat;
    const rz = rs.pos.z + rs.right.z * rlat;
    const ry = this.heightAtSample(ruinIndex, rlat);
    const ruin = [];
    partBox(ruin, 0x6f7762, 4.8, 0.6, 3.1, 0, 0.25, 0);
    partBox(ruin, 0x68705b, 3.8, 0.55, 2.4, 0.2, 0.82, 0.1, 0.1);
    partBox(ruin, 0x606a56, 2.6, 0.52, 1.7, 0.1, 1.38, 0.2, -0.12);
    partBox(ruin, 0x59634f, 1.7, 1.3, 1.3, -1.3, 0.9, -0.4, 0.4);
    partBox(ruin, 0x7c8468, 3.4, 0.35, 0.5, 0, 1.72, -0.8, 0.08);
    for (let k = 0; k < 6; k++) {
      partBox(ruin, 0x4d6c39, 0.12, 0.6 + rng() * 0.7, 0.12,
        -2 + rng() * 4, 1.65, -1.5 + rng() * 2.2, rng() * 3);
    }
    this._addColoredMesh(scene, ruin, mats.stone, { x: rx, y: ry, z: rz, ry: rs.heading + 0.2 });
    this._markExclusion(rx, rz, 12);
    this._markSightline(rs.pos.x, rs.pos.z, rx, rz, 5, 4);
    this.landmarks.ruin = { x: rx, z: rz, y: ry };
    this._addParrots(scene, [
      { x: rx + 0.4, y: ry + 2.2, z: rz - 0.2, ry: rs.heading + 0.4 },
      { x: rx - 1.2, y: ry + 1.9, z: rz + 0.5, ry: rs.heading - 0.8 },
      { x: rx + 1.4, y: ry + 2.0, z: rz + 0.6, ry: rs.heading + 1.9 },
    ]);

    this._addRoadsideSign(scene, index + 4, -upSide, 'KURU-KURU', 'JUNGLE PASS · SS02', {
      w: 2.2, h: 0.95, lat: 2.6, bg: '#122016', fg: '#e9e6d1', accent: '#9ebd5c',
    });
  }

  _addRopeBridge(scene, index) {
    const mats = this._landmarkMats();
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const span = this.halfWidth * 2 + 8.5;
    const parts = [];
    const sagAt = (x) => 1.25 - 0.65 * Math.cos((x / span) * Math.PI * 2);
    for (const tx of [-span / 2, span / 2]) {
      for (const tz of [-1.35, 1.35]) {
        partBox(parts, 0x6f5030, 0.26, 8.2, 0.26, tx, 4.1, tz);
      }
      partBox(parts, 0x7b5935, 0.42, 0.28, 4.2, tx, 7.9, 0);
      partBox(parts, 0x593f28, 0.32, 0.24, 4.5, tx, 7.1, 0);
    }
    const plankCount = 25;
    for (let i = 0; i < plankCount; i++) {
      const x = -span / 2 + (i / (plankCount - 1)) * span;
      const y = 6.4 + sagAt(x);
      partBox(parts, 0x8a6a43, span / plankCount + 0.08, 0.1, 2.3, x, y, 0, (i % 2 ? 0.02 : -0.02));
    }
    // hanging vines from the bridge cables
    for (let i = 0; i < 12; i++) {
      const x = -span / 2 + 0.6 + rngBridge(i) * (span - 1.2);
      const y = 6.4 + sagAt(x) - 0.2;
      partBox(parts, 0x4e6f35, 0.055, 0.7 + rngBridge(i + 9) * 1.8, 0.055, x, y - 0.4, (i % 2 ? 1.1 : -1.1));
    }
    this._addColoredMesh(scene, parts, mats.plank, {
      x: s.pos.x, y: s.pos.y, z: s.pos.z, ry: s.heading,
    });
    // Cables as two catenary lines.
    const cableMat = new THREE.LineBasicMaterial({ color: 0x3f3021, transparent: true, opacity: 0.85 });
    for (const z of [-1.3, 1.3]) {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const x = -span / 2 + (i / 24) * span;
        pts.push(new THREE.Vector3(x, 6.85 + sagAt(x) + 0.12, z));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat);
      line.position.set(s.pos.x, s.pos.y, s.pos.z);
      line.rotation.y = s.heading;
      scene.add(line);
      this.featureMeshes.push(line);
    }
    const lx = s.pos.x, lz = s.pos.z;
    this._markExclusion(lx + s.right.x * (span / 2 + 1), lz + s.right.z * (span / 2 + 1), 2.5);
    this._markExclusion(lx - s.right.x * (span / 2 + 1), lz - s.right.z * (span / 2 + 1), 2.5);
    this.landmarks.bridge = { x: lx, z: lz, y: s.pos.y };
  }

  _addParrots(scene, spots) {
    if (!spots.length) return;
    const parts = [];
    partSphere(parts, 0xd83b2d, 0.19, 0, 0.32, 0, 1.0, 1.4, 1.0);
    partSphere(parts, 0xe44532, 0.14, 0, 0.56, 0.12, 1, 0.9, 1);
    partBox(parts, 0x2c68b0, 0.42, 0.12, 0.3, -0.1, 0.34, -0.05, 0.2);
    partBox(parts, 0x2c68b0, 0.42, 0.12, 0.3, 0.1, 0.34, -0.05, -0.2);
    partBox(parts, 0xe9b53a, 0.12, 0.08, 0.2, 0, 0.54, 0.25);
    partBox(parts, 0x23508f, 0.1, 0.35, 0.12, 0, 0.18, -0.28, 0, 0.2);
    const geo = mergeColored(parts);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((p, i) => {
      TMP.position.set(p.x, p.y, p.z);
      TMP.rotation.set(0, p.ry || 0, 0);
      TMP.scale.setScalar(p.scale || 1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.castShadow = this.quality === 'high';
    scene.add(mesh);
  }

  _snowSet(scene, quality) {
    const mats = this._landmarkMats();
    const rng = mulberry32(this.seed + 6331);
    const index = this._findFeatureIndex(0.41, 58);
    const s = this.samples[index];
    const side = this.heightAtSample(index, -(this.halfWidth + 24)) <
      this.heightAtSample(index, this.halfWidth + 24) ? -1 : 1;
    const lat = side * (this.halfWidth + 33);
    const cx = s.pos.x + s.right.x * lat;
    const cz = s.pos.z + s.right.z * lat;
    const cy = this.heightAtSample(index, lat);
    this._markExclusion(cx, cz, 48);
    this._markSightline(s.pos.x, s.pos.z, cx, cz, 10, 8);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(28, 35, 48),
      new THREE.MeshStandardMaterial({ color: 0xe7f0f7, roughness: 0.92 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, cy + 0.05, cz);
    ring.receiveShadow = true;
    scene.add(ring);
    this.featureMeshes.push(ring);

    const lake = new THREE.Mesh(new THREE.CircleGeometry(29, 48), mats.ice);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(cx, cy + 0.1, cz);
    lake.receiveShadow = true;
    scene.add(lake);
    this.featureMeshes.push(lake);
    this.landmarks.lake = { x: cx, z: cz, y: cy };

    // Wooden ice-fishing hut, half on the shore.
    const hutX = cx + s.right.x * side * 13;
    const hutZ = cz + s.right.z * side * 13;
    const hutY = cy + 0.12;
    const hut = [];
    partBox(hut, 0x6e4d2e, 2.7, 2.1, 2.4, 0, 1.05, 0);
    partBox(hut, 0x3e352a, 3.4, 0.18, 3.1, 0, 2.25, 0, 0, 0.18);
    partBox(hut, 0x2a231b, 0.72, 1.45, 0.1, 0, 0.75, 1.25);
    partBox(hut, 0x6b4c2d, 0.45, 0.5, 0.08, 0.82, 1.25, 1.28);
    partBox(hut, 0xc48a45, 0.28, 0.2, 0.06, 0.82, 1.25, 1.33);
    const hutMesh = this._addColoredMesh(scene, hut, mats.wood, { x: hutX, y: hutY, z: hutZ, ry: s.heading + 0.35 });
    if (hutMesh) {
      const glow = this._addGlowSprite(scene, hutX, hutY + 1.35, hutZ + s.tangent.z * 1.0, 0xffc777, 1.3, 0.28);
      void glow;
    }
    this._addPointLight(scene, hutX, hutY + 1.4, hutZ, 0xffb768, 22, 15);
    this._addSmoke(scene, hutX, hutY + 2.5, hutZ, 3, 0xc7d4dc, 0.22);

    // Sami lavvu with a campfire.
    const lavIndex = this._findFeatureIndex(0.58, 26);
    const ls = this.samples[lavIndex];
    const llat = -side * (this.halfWidth + 15);
    const lx = ls.pos.x + ls.right.x * llat;
    const lz = ls.pos.z + ls.right.z * llat;
    const ly = this.heightAtSample(lavIndex, llat);
    const lav = [];
    partCyl(lav, 0x8a744e, 0.18, 3.2, 3.6, 10, 0, 1.8, 0);
    for (let k = 0; k < 5; k++) {
      partBox(lav, 0x5b472d, 0.11, 4.4, 0.11, Math.cos(k / 5 * Math.PI * 2) * 0.9, 2.1,
        Math.sin(k / 5 * Math.PI * 2) * 0.9, 0, 0.18, 0);
    }
    partBox(lav, 0x3b2c1c, 1.2, 1.9, 0.12, 0, 0.95, 2.95);
    partBox(lav, 0x4f5c50, 1.1, 0.06, 0.5, 0, 2.9, 0);
    this._addColoredMesh(scene, lav, mats.cloth, { x: lx, y: ly, z: lz, ry: ls.heading + 0.7 });
    this._markExclusion(lx, lz, 18);
    this._markSightline(s.pos.x, s.pos.z, lx, lz, 7, 5);
    this.landmarks.lavvu = { x: lx, z: lz, y: ly };
    const fire = [];
    partCyl(fire, 0x5f584d, 0.85, 1.0, 0.16, 8, 0, 0.08, 0);
    for (let k = 0; k < 4; k++) {
      partCyl(fire, 0x4a3320, 0.08, 0.11, 1.2, 5,
        Math.cos(k / 4 * Math.PI * 2) * 0.25, 0.2, Math.sin(k / 4 * Math.PI * 2) * 0.25, Math.PI / 2, 0);
    }
    this._addColoredMesh(scene, fire, mats.stone, {
      x: lx + s.right.x * side * 4, y: ly + 0.04, z: lz + s.right.z * side * 4,
    });
    const fx = lx + s.right.x * side * 4;
    const fz = lz + s.right.z * side * 4;
    this._addGlowSprite(scene, fx, ly + 0.9, fz, 0xff8c2f, 2.6, 0.7);
    this._addGlowSprite(scene, fx, ly + 0.55, fz, 0xffd07a, 1.3, 0.85);
    this._addPointLight(scene, fx, ly + 1.4, fz, 0xff9a42, 32, 18);
    this._addSmoke(scene, lx, ly + 4.2, lz, 4, 0xcfd8d9, 0.18);

    // Reindeer by the lake and a cheery snowman near the road.
    const deer = [];
    for (let k = 0; k < 5; k++) {
      const a = rng() * Math.PI * 2;
      const r = 10 + rng() * 22;
      const dx = cx + Math.cos(a) * r;
      const dz = cz + Math.sin(a) * r;
      const near = this._nearestIndexFast(dx, dz);
      const dlat = (dx - this.samples[near.index].pos.x) * this.samples[near.index].right.x +
        (dz - this.samples[near.index].pos.z) * this.samples[near.index].right.z;
      deer.push({
        x: dx, z: dz, y: r < 27 ? cy + 0.13 : this.heightAtSample(near.index, dlat),
        ry: rng() * Math.PI * 2, scale: 0.9 + rng() * 0.25,
      });
    }
    this._addReindeer(scene, deer);
    this._addSnowman(scene, this._findFeatureIndex(0.27, 20), rng() < 0.5 ? -1 : 1);
    this._addRoadsideSign(scene, index + 4, -side, 'ROVANIEMI', 'LAPLAND · SS03', {
      w: 2.0, h: 0.9, lat: 2.5, bg: '#172433', fg: '#edf4fa', accent: '#8bc7e6',
    });
  }

  _addReindeer(scene, spots) {
    if (!spots.length) return;
    const parts = [];
    partSphere(parts, 0x6b4d34, 0.52, 0, 0.88, 0, 1.25, 0.9, 1.0);
    partCyl(parts, 0x74553a, 0.18, 0.26, 1.15, 6, 0.58, 1.42, 0.22, 0.45);
    partSphere(parts, 0x7d5c3e, 0.25, 0.72, 1.95, 0.45, 1.0, 0.9, 1.05);
    partBox(parts, 0x3d2b1e, 0.18, 0.15, 0.28, 0.88, 1.98, 0.65);
    for (const [x, z] of [[-0.3, -0.24], [0.3, -0.28], [-0.3, 0.26], [0.3, 0.3]]) {
      partBox(parts, 0x4a3525, 0.11, 0.72, 0.11, x, 0.36, z);
    }
    for (const side of [-1, 1]) {
      partBox(parts, 0xcfc2a4, 0.07, 0.5, 0.07, 0.7, 2.25, 0.37 + side * 0.18);
      partBox(parts, 0xcfc2a4, 0.07, 0.34, 0.07, 0.55, 2.5, 0.52 + side * 0.25);
    }
    partBox(parts, 0x4a3525, 0.09, 0.35, 0.09, 0.72, 1.85, 0.12);
    const geo = mergeColored(parts);
    const mat = new THREE.MeshStandardMaterial({
      map: makeAnimalTexture('reindeer'), vertexColors: true, roughness: 0.95,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((p, i) => {
      TMP.position.set(p.x, p.y, p.z);
      TMP.rotation.set(0, p.ry || 0, 0);
      TMP.scale.setScalar(p.scale || 1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.castShadow = this.quality === 'high';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  _addSnowman(scene, index, side) {
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const lat = side * (this.halfWidth + 3.0);
    const x = s.pos.x + s.right.x * lat;
    const z = s.pos.z + s.right.z * lat;
    const y = this.heightAtSample(index, lat);
    const snow = new THREE.MeshStandardMaterial({ color: 0xf0f6fa, roughness: 0.92 });
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = s.heading + 0.5;
    const b1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), snow);
    b1.position.y = 0.68; b1.castShadow = true; group.add(b1);
    const b2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), snow);
    b2.position.y = 1.52; b2.castShadow = true; group.add(b2);
    const b3 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), snow);
    b3.position.y = 2.15; b3.castShadow = true; group.add(b3);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0xd56c25, roughness: 0.8 }));
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 2.15, 0.34); group.add(nose);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), new THREE.MeshBasicMaterial({ color: 0x191915 }));
      eye.position.set(sx * 0.11, 2.25, 0.3); group.add(eye);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.85, 4), new THREE.MeshStandardMaterial({ color: 0x5c4428, roughness: 1 }));
      arm.position.set(sx * 0.62, 1.62, 0); arm.rotation.z = sx * 1.0; group.add(arm);
    }
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.075, 5, 12), new THREE.MeshStandardMaterial({ color: 0xa43430, roughness: 0.85 }));
    scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.9; group.add(scarf);
    scene.add(group);
    this.featureMeshes.push(group);
    this._markExclusion(x, z, 3);
  }

  _addSmoke(scene, x, y, z, count = 3, color = 0xc9d1d3, opacity = 0.18) {
    const tex = makeSoftDotTexture();
    for (let i = count - 1; i >= 0; i--) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color, transparent: true, opacity: opacity * (1 - i * 0.18),
        depthWrite: false, fog: true,
      });
      const spr = new THREE.Sprite(mat);
      spr.position.set(x + (i % 2 ? 0.3 : -0.3) * i, y + i * 1.3, z + (i % 3 - 1) * 0.25);
      spr.scale.setScalar(1.2 + i * 0.9);
      spr.renderOrder = 4;
      scene.add(spr);
      this.featureMeshes.push(spr);
    }
  }


  _japanSet(scene, quality) {
    const mats = this._landmarkMats();
    const rng = mulberry32(this.seed + 7441);
    this._addRoadTorii(scene, this._findFeatureIndex(0.17, 26), 1.0);
    this._addRoadTorii(scene, this._findFeatureIndex(0.84, 26), 0.9);
    this._addTunnel(scene, 0.47);
    this._addShrine(scene, 0.64);

    const index = this._findFeatureIndex(0.1, 20);
    this._addRoadsideSign(scene, index, rng() < 0.5 ? -1 : 1, 'HONSHU TOUGE', 'KANTO · SS04 · 峠', {
      w: 2.3, h: 1.0, lat: 2.5, bg: '#161a17', fg: '#f2eee1', accent: '#d24a32',
    });
  }

  _addRoadTorii(scene, index, scale = 1) {
    const mats = this._landmarkMats();
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const H = 5.4 * scale;
    const R = this.halfWidth + 2.0;
    const parts = [];
    for (const side of [-1, 1]) {
      partCyl(parts, 0xb13a2b, 0.19 * scale, 0.24 * scale, H, 8, side * R, H * 0.5, 0);
      partCyl(parts, 0x2e2822, 0.23 * scale, 0.27 * scale, 0.34 * scale, 8, side * R, H * 0.94, 0);
      partBox(parts, 0x8d2e23, 0.4 * scale, 0.24 * scale, 0.4 * scale, side * R, 0.14, 0);
    }
    partBox(parts, 0xb13a2b, (R + 2.6) * 2, 0.3 * scale, 0.42 * scale, 0, H - 0.1, 0);
    partBox(parts, 0x9c3025, (R + 3.15) * 2, 0.2 * scale, 0.58 * scale, 0, H + 0.27, 0);
    partBox(parts, 0x2f2923, (R + 3.35) * 2, 0.18 * scale, 0.66 * scale, 0, H + 0.45, 0);
    partBox(parts, 0x9c3025, (R + 1.6) * 2, 0.22 * scale, 0.3 * scale, 0, H - 0.82, 0);
    partBox(parts, 0x2c2721, 0.75 * scale, 0.6 * scale, 0.12, 0, H - 0.55, 0);
    partBox(parts, 0xb13a2b, (R + 1.5) * 2, 0.16 * scale, 0.24, 0, H - 0.52, 0);
    this._addColoredMesh(scene, parts, mats.paint, {
      x: s.pos.x, y: s.pos.y + 0.02, z: s.pos.z, ry: s.heading,
    });
    for (const side of [-1, 1]) {
      const wx = s.pos.x + s.right.x * side * R;
      const wz = s.pos.z + s.right.z * side * R;
      this._addGlowSprite(scene, wx, s.pos.y + H - 0.55, wz, 0xffcf93, 1.1, 0.24);
    }
    this._addPointLight(scene, s.pos.x, s.pos.y + 3.2, s.pos.z, 0xffb877, 20, 13);
    return index;
  }

  _addTunnel(scene, frac) {
    const mats = this._landmarkMats();
    const center = this._findFeatureIndex(frac, 60);
    const i0 = clamp(center - 13, 18, this.n - 45);
    const i1 = clamp(i0 + 28, i0 + 8, this.n - 14);
    const R = this.halfWidth + 1.55;
    const SEG = 14;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = i0; i <= i1; i++) {
      const s = this.samples[i];
      for (let j = 0; j <= SEG; j++) {
        const th = (j / SEG) * Math.PI;
        const wibble = 1 + Math.sin(s.dist * 0.24 + j * 1.7) * 0.025;
        const lat = Math.cos(th) * R * wibble;
        const y = s.pos.y + 0.025 + Math.sin(th) * R * wibble;
        positions.push(s.pos.x + s.right.x * lat, y, s.pos.z + s.right.z * lat);
        uvs.push((j / SEG) * 3.4, s.dist * 0.07);
      }
    }
    for (let i = 0; i < (i1 - i0); i++) {
      for (let j = 0; j < SEG; j++) {
        const a = i * (SEG + 1) + j;
        const b = a + 1;
        const c = a + SEG + 1;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const tunnel = new THREE.Mesh(geo, mats.tunnel);
    tunnel.receiveShadow = true;
    tunnel.castShadow = this.quality === 'high';
    scene.add(tunnel);
    this.featureMeshes.push(tunnel);

    const addPortal = (idx, outward) => {
      const s = this.samples[idx];
      const group = new THREE.Group();
      group.position.copy(s.pos);
      group.rotation.y = s.heading;
      const ringParts = [];
      const ringVerts = [];
      const ringIndex = [];
      const outer = R + 2.1;
      for (let j = 0; j <= SEG; j++) {
        const th = (j / SEG) * Math.PI;
        ringVerts.push(Math.cos(th) * R, Math.sin(th) * R, 0,
          Math.cos(th) * outer, Math.sin(th) * outer, 0);
        uvs.push(0, 0);
      }
      for (let j = 0; j < SEG; j++) {
        const a = j * 2;
        ringIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const ringUvs = [];
      for (let j = 0; j <= SEG; j++) {
        ringUvs.push((j / SEG) * 3.0, 0, (j / SEG) * 3.0, 1.0);
      }
      const ringGeo = new THREE.BufferGeometry();
      ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringVerts, 3));
      ringGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ringUvs, 2));
      ringGeo.setIndex(ringIndex);
      ringGeo.computeVertexNormals();
      const ring = new THREE.Mesh(ringGeo, mats.tunnel);
      ring.castShadow = this.quality === 'high';
      ring.receiveShadow = true;
      group.add(ring);
      const wallH = R + 4.7;
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(2.4, wallH, 1.4), mats.tunnel);
        wall.position.set(side * (outer + 1.2), wallH * 0.5, 0);
        wall.castShadow = this.quality === 'high';
        wall.receiveShadow = true;
        group.add(wall);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry((outer + 2.3) * 2, 2.6, 1.4), mats.tunnel);
      lintel.position.set(0, R + 2.1 + 1.3, 0);
      lintel.castShadow = this.quality === 'high';
      group.add(lintel);
      const signTex = this._signTexture('HONSHU TUNNEL', 'SS04 · 隧道 · 峠', {
        bg: '#242622', fg: '#efe8d8', accent: '#d6a23c',
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.3), new THREE.MeshStandardMaterial({
        map: signTex, roughness: 0.8, side: THREE.DoubleSide,
        emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.18,
      }));
      sign.position.set(0, R + 3.15, outward * 0.73);
      sign.rotation.y = outward > 0 ? 0 : Math.PI;
      group.add(sign);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xf1d49a, emissive: 0xffc36b, emissiveIntensity: 0.9, roughness: 0.5 });
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), lampMat);
        lamp.position.set(side * (R + 0.9), R + 1.7, outward * 0.78);
        group.add(lamp);
      }
      scene.add(group);
      this.featureMeshes.push(group);
      this._markExclusion(s.pos.x, s.pos.z, 12);
    };
    addPortal(i0, -1);
    addPortal(i1, 1);
    this.landmarks.tunnel = { x: this.samples[center].pos.x, z: this.samples[center].pos.z, y: this.samples[center].pos.y };

    // Interior strip lights and a warm pool of light around the middle.
    const lampGeo = new THREE.BoxGeometry(0.62, 0.08, 0.2);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd89a, toneMapped: false });
    for (let i = i0 + 3; i < i1; i += 4) {
      const s = this.samples[i];
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(s.pos.x, s.pos.y + R * 0.94, s.pos.z);
      lamp.rotation.y = s.heading;
      scene.add(lamp);
      this.featureMeshes.push(lamp);
    }
    for (const k of [0.2, 0.5, 0.8]) {
      const s = this.samples[clamp(Math.round(i0 + (i1 - i0) * k), i0, i1)];
      this._addPointLight(scene, s.pos.x, s.pos.y + R * 0.75, s.pos.z, 0xffc887, 42, 18);
    }
    return { i0, i1 };
  }

  _addShrine(scene, frac) {
    const mats = this._landmarkMats();
    const index = this._findFeatureIndex(frac, 36);
    const s = this.samples[index];
    const side = -this.mountainSideAt(s.dist);
    const baseLat = side * (this.halfWidth + 5.0);
    const baseY = this.heightAtSample(index, baseLat);
    const group = new THREE.Group();
    group.position.set(s.pos.x, s.pos.y, s.pos.z);
    group.rotation.y = s.heading;
    const stepParts = [];
    for (let k = 0; k < 7; k++) {
      const lat = side * (this.halfWidth + 4.4 + k * 0.95);
      const gy = this.heightAtSample(index, lat) - s.pos.y;
      stepParts.push({
        geometry: new THREE.BoxGeometry(2.0, 0.24, 1.5).translate(-lat, gy + 0.12, 0),
        color: 0x9b998c,
      });
    }
    const stepMesh = this._addColoredMesh(scene, stepParts, mats.stone, {
      x: s.pos.x, y: s.pos.y, z: s.pos.z, ry: s.heading,
    });
    void stepMesh;

    // Torii at the foot of the steps.
    const R = this.halfWidth + 4.1;
    const tor = [];
    for (const sd of [-1, 1]) {
      partCyl(tor, 0xb13a2b, 0.15, 0.19, 3.4, 7, -side * (this.halfWidth + 3.0), 1.7, sd * 1.35);
      partCyl(tor, 0x312a23, 0.19, 0.2, 0.24, 7, -side * (this.halfWidth + 3.0), 3.3, sd * 1.35);
    }
    partBox(tor, 0xb13a2b, 0.29, 0.22, 3.7, -side * (this.halfWidth + 3.0), 3.18, 0);
    partBox(tor, 0x2f2922, 0.36, 0.14, 3.95, -side * (this.halfWidth + 3.0), 3.36, 0);
    partBox(tor, 0xb13a2b, 0.24, 0.18, 2.85, -side * (this.halfWidth + 3.0), 2.45, 0);
    this._addColoredMesh(scene, tor, mats.paint, {
      x: s.pos.x, y: s.pos.y, z: s.pos.z, ry: s.heading,
    });

    // Stone lanterns along the climb.
    const lanternParts = [];
    const lanternGlow = [];
    for (let k = 0; k < 3; k++) {
      const lat = side * (this.halfWidth + 6.2 + k * 1.7);
      const gy = this.heightAtSample(index, lat) - s.pos.y;
      const lx = -lat;
      partCyl(lanternParts, 0x8d8d80, 0.3, 0.38, 1.2, 6, lx, gy + 0.6, 2.0);
      partBox(lanternParts, 0x9b998c, 0.7, 0.16, 0.7, lx, gy + 1.28, 2.0);
      partBox(lanternParts, 0x8d8d80, 0.48, 0.45, 0.48, lx, gy + 1.56, 2.0);
      partCyl(lanternParts, 0x77776d, 0.05, 0.58, 0.22, 6, lx, gy + 1.9, 2.0);
      lanternGlow.push({ x: lx, y: gy + 1.58, z: 2.0 });
    }
    this._addColoredMesh(scene, lanternParts, mats.stone, {
      x: s.pos.x, y: s.pos.y, z: s.pos.z, ry: s.heading,
    });
    for (const g of lanternGlow) {
      const wx = s.pos.x + Math.cos(s.heading) * g.z + Math.sin(s.heading) * g.x;
      const wz = s.pos.z - Math.sin(s.heading) * g.z + Math.cos(s.heading) * g.x;
      this._addGlowSprite(scene, wx, s.pos.y + g.y, wz, 0xffb85e, 1.0, 0.65);
    }

    // Small shrine hall up the slope, with a pair of fox guardians.
    const shrineLat = side * (this.halfWidth + 9.0);
    const shrineY = this.heightAtSample(index, shrineLat) - s.pos.y;
    const shrineX = -shrineLat;
    const shrine = [];
    partBox(shrine, 0x8a8274, 5.0, 0.6, 4.2, shrineX, shrineY - 0.28, 0);
    partBox(shrine, 0x8a6240, 3.6, 0.5, 3.2, shrineX, shrineY + 0.25, 0);
    partBox(shrine, 0x65452c, 0.28, 2.5, 0.28, shrineX - 1.5, shrineY + 1.55, 1.3);
    partBox(shrine, 0x65452c, 0.28, 2.5, 0.28, shrineX + 1.5, shrineY + 1.55, 1.3);
    partBox(shrine, 0x65452c, 0.28, 2.5, 0.28, shrineX - 1.5, shrineY + 1.55, -1.3);
    partBox(shrine, 0x65452c, 0.28, 2.5, 0.28, shrineX + 1.5, shrineY + 1.55, -1.3);
    partBox(shrine, 0x2b2119, 3.0, 1.8, 2.4, shrineX, shrineY + 1.4, 0);
    partBox(shrine, 0x4b3522, 1.5, 1.55, 0.14, shrineX, shrineY + 1.3, 1.22);
    partBox(shrine, 0x32271f, 4.5, 0.25, 4.0, shrineX, shrineY + 2.55, 0, 0.08);
    partBox(shrine, 0x4a3422, 4.1, 0.3, 3.6, shrineX, shrineY + 2.8, 0, -0.08);
    partBox(shrine, 0xc9a444, 0.3, 0.5, 0.4, shrineX, shrineY + 3.15, 0);
    this._addColoredMesh(scene, shrine, mats.wood, {
      x: s.pos.x, y: s.pos.y, z: s.pos.z, ry: s.heading,
    });
    this._addGlowSprite(scene, s.pos.x + Math.sin(s.heading) * shrineX,
      s.pos.y + shrineY + 1.55, s.pos.z + Math.cos(s.heading) * shrineX, 0xffc06a, 1.6, 0.45);
    this._addPointLight(scene, s.pos.x + Math.sin(s.heading) * shrineX,
      s.pos.y + shrineY + 1.7, s.pos.z + Math.cos(s.heading) * shrineX, 0xffb467, 30, 16);

    const foxParts = [];
    for (const sd of [-1, 1]) {
      const fx = shrineX + sd * 2.2;
      partBox(foxParts, 0x8d8a7c, 0.9, 0.35, 0.9, fx, shrineY + 0.17, 2.5);
      partBox(foxParts, 0xbcb8a8, 0.35, 0.8, 0.35, fx, shrineY + 0.62, 2.5);
      partSphere(foxParts, 0xc6c1b0, 0.23, fx, shrineY + 1.08, 2.5, 1.0, 1.15, 1.0);
      partBox(foxParts, 0xc6c1b0, 0.07, 0.32, 0.18, fx - 0.15, shrineY + 1.32, 2.55);
      partBox(foxParts, 0xc6c1b0, 0.07, 0.32, 0.18, fx + 0.15, shrineY + 1.32, 2.55);
      partBox(foxParts, 0x8f866f, 0.08, 0.5, 0.08, fx, shrineY + 0.9, 2.28);
    }
    this._addColoredMesh(scene, foxParts, mats.stone, {
      x: s.pos.x, y: s.pos.y, z: s.pos.z, ry: s.heading,
    });

    const shrineWx = s.pos.x + s.right.x * side * 12;
    const shrineWz = s.pos.z + s.right.z * side * 12;
    this._markExclusion(shrineWx, shrineWz, 18);
    this._markSightline(s.pos.x, s.pos.z, shrineWx, shrineWz, 7, 5);
    this.landmarks.shrine = {
      x: shrineWx,
      z: shrineWz,
      y: s.pos.y + shrineY,
    };
    void baseY;
  }


  _russiaSet(scene, quality) {
    const mats = this._landmarkMats();
    const rng = mulberry32(this.seed + 8551);
    const index = this._findFeatureIndex(0.5, 65);
    const s = this.samples[index];
    const side = rng() < 0.5 ? -1 : 1;
    const lat = side * (this.halfWidth + 19);
    const bx = s.pos.x + s.right.x * lat;
    const bz = s.pos.z + s.right.z * lat;
    const by = this.heightAtSample(index, lat);
    const ry = s.heading;
    const walls = [];
    const roofs = [];
    const glow = [];
    const chimneys = [];
    const houses = [
      { z: -16, w: 8.4, h: 3.3, d: 5.6, tint: 0x8f6c48 },
      { z: 0.5, w: 7.2, h: 3.0, d: 5.0, tint: 0x99744d },
      { z: 16, w: 9.2, h: 3.6, d: 6.1, tint: 0x876541 },
    ];
    for (const [hi, house] of houses.entries()) {
      const hx = (hi - 1) * 2.0;
      const hz = house.z;
      partBox(walls, house.tint, house.w, house.h, house.d, hx, house.h * 0.5, hz);
      partBox(walls, 0x6d5034, house.w + 0.5, 0.25, house.d + 0.5, hx, 0.16, hz);
      // log ends give the izba silhouette
      for (let k = 0; k < 4; k++) {
        for (const sd of [-1, 1]) {
          partBox(walls, 0x5e432b, 0.24, 0.24, house.d + 0.3, hx + sd * (house.w / 2 + 0.08), 0.5 + k * 0.75, hz);
        }
      }
      const rl = house.d * 0.62;
      partBox(roofs, 0x4a4036, house.w + 1.1, 0.2, rl, hx, house.h + 0.75, hz - house.d * 0.23, 0, 0.55);
      partBox(roofs, 0x51463a, house.w + 1.1, 0.2, rl, hx, house.h + 0.75, hz + house.d * 0.23, 0, -0.55);
      partBox(roofs, 0x3d352c, house.w + 0.12, 0.22, 0.25, hx, house.h + 1.45, hz);
      partBox(walls, 0x7b5b3c, 1.9, 1.8, 0.12, hx, 0.95, hz + house.d / 2 + 0.02);
      partBox(walls, 0x382a1e, 0.82, 1.36, 0.06, hx - 2.2, 1.5, hz + house.d / 2 + 0.05);
      partBox(walls, 0x382a1e, 0.82, 1.36, 0.06, hx + 2.2, 1.5, hz + house.d / 2 + 0.05);
      partBox(walls, 0xd7d0bd, 0.92, 1.46, 0.08, hx - 2.2, 1.5, hz + house.d / 2 + 0.03);
      partBox(walls, 0xd7d0bd, 0.92, 1.46, 0.08, hx + 2.2, 1.5, hz + house.d / 2 + 0.03);
      partBox(glow, 0xffc57a, 0.6, 0.9, 0.05, hx - 2.2, 1.5, hz + house.d / 2 + 0.09);
      partBox(glow, 0xffc57a, 0.6, 0.9, 0.05, hx + 2.2, 1.5, hz + house.d / 2 + 0.09);
      partBox(chimneys, 0x6f685d, 0.6, 2.0, 0.6, hx + house.w * 0.28, house.h + 1.9, hz);
      this._addSmoke(scene, bx + Math.sin(ry) * hx + Math.cos(ry) * hz,
        by + house.h + 2.9, bz + Math.cos(ry) * hx - Math.sin(ry) * hz, 3, 0xbcc5c5, 0.15);
    }
    this._addColoredMesh(scene, walls, mats.wood, { x: bx, y: by, z: bz, ry });
    this._addColoredMesh(scene, roofs, mats.plank, { x: bx, y: by, z: bz, ry });
    this._addColoredMesh(scene, chimneys, mats.stone, { x: bx, y: by, z: bz, ry });
    const glowMesh = this._addColoredMesh(scene, glow, mats.glow, { x: bx, y: by, z: bz, ry });
    if (glowMesh) glowMesh.castShadow = false;
    this._addPointLight(scene, bx + s.tangent.x * 0.5, by + 1.7, bz + s.tangent.z * 0.5, 0xffb05a, 32, 22);

    // Wooden fence and a well in front of the village.
    const extras = [];
    for (let k = 0; k < 18; k++) {
      partBox(extras, 0x6e5334, 0.13, 1.15, 0.13, -14 + k * 1.7, 0.57, 7.8);
    }
    partBox(extras, 0x7b5b39, 30, 0.12, 0.1, -0.5, 0.82, 7.8);
    partBox(extras, 0x684a2f, 30, 0.11, 0.1, -0.5, 0.42, 7.8);
    partCyl(extras, 0x756b5a, 1.4, 1.55, 0.85, 10, side * 7.5, 0.42, 4.5);
    partCyl(extras, 0x51412d, 0.06, 0.06, 2.8, 5, side * 7.5, 1.8, 4.5, 0, 0.5);
    partBox(extras, 0x493a29, 0.8, 0.12, 0.12, side * 7.5 - 0.35, 2.7, 4.5, 0, 0, 0.3);
    partCyl(extras, 0x8b7b62, 1.7, 1.7, 0.16, 8, side * 7.5, 2.8, 4.5, 0, 0.22);
    this._addColoredMesh(scene, extras, mats.plank, { x: bx, y: by, z: bz, ry });

    // Woodpile and an old UAZ-style truck by the roadward side.
    const truck = [];
    partBox(truck, 0x4c5945, 1.8, 0.65, 3.8, 0, 0.7, 0);
    partBox(truck, 0x53614a, 1.6, 0.8, 1.3, 0, 1.33, -0.7);
    partBox(truck, 0x2c322c, 1.52, 0.35, 0.04, 0, 1.45, -1.37);
    partBox(truck, 0x1f241f, 1.82, 0.12, 1.1, 0, 1.08, 0.5);
    partBox(truck, 0x3a4236, 0.16, 0.3, 1.6, 0, 1.78, -0.5);
    for (const wx of [-0.82, 0.82]) {
      for (const wz of [-1.1, 1.05]) {
        partCyl(truck, 0x211f1b, 0.37, 0.37, 0.22, 10, wx, 0.4, wz, 0, Math.PI / 2);
        partCyl(truck, 0x8e8b7c, 0.18, 0.18, 0.24, 8, wx + Math.sign(wx) * 0.02, 0.4, wz, 0, Math.PI / 2);
      }
    }
    partBox(truck, 0xffd38b, 0.25, 0.2, 0.06, -0.58, 0.78, 1.91);
    partBox(truck, 0xffd38b, 0.25, 0.2, 0.06, 0.58, 0.78, 1.91);
    this._addColoredMesh(scene, truck, mats.metal, {
      x: bx + s.right.x * side * 6.0, y: by + 0.03, z: bz + s.right.z * side * 6.0, ry: s.heading + 0.35,
    });
    const wood = [];
    for (let k = 0; k < 14; k++) {
      partCyl(wood, 0x6e4d2c, 0.14, 0.17, 1.6, 6, (k % 4) * 0.32 - 0.5, 0.18 + Math.floor(k / 4) * 0.24, 0, 0, Math.PI / 2);
    }
    this._addColoredMesh(scene, wood, mats.wood, {
      x: bx + s.right.x * side * 9, y: by + 0.05, z: bz + s.right.z * side * 9, ry: s.heading + 0.4,
    });

    // Soviet-era concrete bus shelter at the roadside.
    const bi = this._findFeatureIndex(0.42, 26);
    const bs = this.samples[bi];
    const bside = -side;
    const blat = bside * (this.halfWidth + 4.0);
    const bx2 = bs.pos.x + bs.right.x * blat;
    const bz2 = bs.pos.z + bs.right.z * blat;
    const by2 = this.heightAtSample(bi, blat);
    const shelter = [];
    partBox(shelter, 0x9a9b8e, 3.2, 0.22, 2.2, 0, 2.25, 0, 0, 0, 0);
    partBox(shelter, 0x86877a, 0.18, 2.25, 2.1, -1.5, 1.12, 0);
    partBox(shelter, 0x86877a, 0.16, 1.0, 2.1, 1.5, 0.5, 0);
    partBox(shelter, 0x8d8e80, 1.5, 0.12, 0.5, 0, 0.52, 0.2);
    partBox(shelter, 0x2e332b, 1.8, 0.08, 0.08, 0, 1.4, -0.92);
    this._addColoredMesh(scene, shelter, mats.stone, { x: bx2, y: by2, z: bz2, ry: bs.heading + Math.PI / 2 });
    this._addRoadsideSign(scene, bi + 5, bside, 'УРАЛ · ТАЙГА', 'PERM KRAI · SS05', {
      w: 2.4, h: 1.0, lat: 2.5, bg: '#1b211c', fg: '#e7e1cf', accent: '#b54a32',
    });

    this._markExclusion(bx, bz, 22);
    this._markSightline(s.pos.x, s.pos.z, bx, bz, 8, 7);
    this._markExclusion(bx2, bz2, 6);
    this.landmarks.village = { x: bx, z: bz, y: by };
    this.landmarks.busstop = { x: bx2, z: bz2, y: by2 };
  }

  _safariSet(scene, quality) {
    const mats = this._landmarkMats();
    const rng = mulberry32(this.seed + 9661);
    const index = this._findFeatureIndex(0.32, 62);
    const s = this.samples[index];
    const side = rng() < 0.5 ? -1 : 1;
    const lat = side * (this.halfWidth + 16);
    const bx = s.pos.x + s.right.x * lat;
    const bz = s.pos.z + s.right.z * lat;
    const by = this.heightAtSample(index, lat);
    const ry = s.heading;
    const canvasParts = [];
    const darkParts = [];
    const wood = [];
    // Two canvas safari tents.
    const tent = (x, z, w, l, h, col) => {
      partBox(canvasParts, col, w, 0.22, l, x, h * 0.55, z, 0, 0, 0.72);
      partBox(canvasParts, col, w, 0.22, l, x, h * 0.55, z, 0, 0, -0.72);
      partBox(canvasParts, col * 0.76, w * 0.7, h * 0.8, 0.12, x, h * 0.4, z + l / 2);
      partBox(darkParts, 0x28251e, w * 0.44, h * 0.56, 0.08, x, h * 0.35, z + l / 2 + 0.09);
      partBox(canvasParts, col * 0.9, 0.22, 0.22, l + 0.4, x, h * 0.99, z);
      partBox(wood, 0x5c452c, 0.1, h, 0.1, x - w * 0.55, h * 0.48, z - l / 2);
      partBox(wood, 0x5c452c, 0.1, h, 0.1, x + w * 0.55, h * 0.48, z - l / 2);
    };
    tent(0, -7, 4.0, 5.2, 2.8, 0xb9a67d);
    tent(4.9, 3.2, 3.2, 4.2, 2.3, 0x9e8a65);
    this._addColoredMesh(scene, canvasParts, mats.cloth, { x: bx, y: by, z: bz, ry });
    this._addColoredMesh(scene, darkParts, mats.dark, { x: bx, y: by, z: bz, ry });
    this._addColoredMesh(scene, wood, mats.plank, { x: bx, y: by, z: bz, ry });

    // Land Rover.
    const car = [];
    partBox(car, 0x68715a, 1.85, 0.72, 4.1, 0, 0.78, 0);
    partBox(car, 0x59614d, 1.7, 0.85, 1.7, 0, 1.45, -0.7);
    partBox(car, 0x2e332b, 1.4, 0.32, 0.05, 0, 1.58, -1.57);
    partBox(car, 0x2e332b, 1.4, 0.32, 0.05, 0, 1.58, 0.16);
    partBox(car, 0x3c4038, 1.9, 0.12, 1.8, 0, 1.9, -0.25);
    partBox(car, 0x4a503f, 0.13, 0.4, 1.7, 0, 2.08, -0.25);
    partBox(car, 0x1b1f19, 2.0, 0.12, 0.9, 0, 0.66, 1.45);
    for (const wx of [-0.92, 0.92]) {
      for (const wz of [-1.15, 1.16]) {
        partCyl(car, 0x1b1916, 0.42, 0.42, 0.26, 10, wx, 0.42, wz, 0, Math.PI / 2);
        partCyl(car, 0x7f7b6d, 0.2, 0.2, 0.28, 8, wx + Math.sign(wx) * 0.02, 0.42, wz, 0, Math.PI / 2);
      }
    }
    partBox(car, 0xffd88a, 0.24, 0.2, 0.06, -0.58, 0.84, 2.06);
    partBox(car, 0xffd88a, 0.24, 0.2, 0.06, 0.58, 0.84, 2.06);
    this._addColoredMesh(scene, car, mats.paint, { x: bx + 2.2, y: by, z: bz + 2.0, ry: s.heading + 0.8 });

    // Campfire and kit.
    const fire = [];
    for (let k = 0; k < 8; k++) {
      partSphere(fire, 0x6d6a5e, 0.22 + rng() * 0.18,
        Math.cos(k / 8 * Math.PI * 2) * 0.8, 0.1, Math.sin(k / 8 * Math.PI * 2) * 0.8, 1, 0.5, 1);
    }
    for (let k = 0; k < 3; k++) {
      partCyl(fire, 0x4e3622, 0.08, 0.1, 1.0, 5, Math.cos(k * 2) * 0.2, 0.18, Math.sin(k * 2) * 0.2, Math.PI / 2, Math.PI / 2);
    }
    this._addColoredMesh(scene, fire, mats.stone, { x: bx - 3.5, y: by, z: bz + 4.0 });
    const fx = bx - 3.5, fz = bz + 4.0;
    this._addGlowSprite(scene, fx, by + 0.8, fz, 0xff8a2f, 2.6, 0.75);
    this._addGlowSprite(scene, fx, by + 0.45, fz, 0xffd08a, 1.2, 0.85);
    this._addPointLight(scene, fx, by + 1.2, fz, 0xff9342, 34, 20);
    const kit = [];
    for (let k = 0; k < 4; k++) {
      partBox(kit, 0x7b6140, 0.8, 0.55, 0.65, -5.8 + (k % 2) * 0.9, 0.28 + Math.floor(k / 2) * 0.55, -0.6 + (k % 2) * 0.2);
    }
    partBox(kit, 0x6d5134, 1.8, 0.09, 0.8, 0.5, 0.85, -1.4);
    partBox(kit, 0x5b432b, 0.1, 0.85, 0.1, -0.2, 0.42, -1.8);
    partBox(kit, 0x5b432b, 0.1, 0.85, 0.1, 1.2, 0.42, -1.8);
    this._addColoredMesh(scene, kit, mats.plank, { x: bx, y: by, z: bz, ry });
    this._addSmoke(scene, bx - 3.5, by + 1.2, bz + 4.0, 3, 0x9fa6a0, 0.1);
    this._addRoadsideSign(scene, index + 4, -side, 'RIFT SAFARI CAMP', 'GREAT RIFT · SS06', {
      w: 2.6, h: 1.05, lat: 2.6, bg: '#2c2115', fg: '#f1e4c6', accent: '#c88744',
    });
    this._markExclusion(bx, bz, 20);
    this._markSightline(s.pos.x, s.pos.z, bx, bz, 8, 6);
    this.landmarks.camp = { x: bx, z: bz, y: by };

    // A waterhole on the open side of the stage.
    const wi = this._findFeatureIndex(0.63, 48);
    const ws = this.samples[wi];
    const wside = -side;
    const wlat = wside * (this.halfWidth + 31);
    const wx = ws.pos.x + ws.right.x * wlat;
    const wz = ws.pos.z + ws.right.z * wlat;
    let wy = this.heightAtSample(wi, wlat);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = wx + Math.cos(a) * 15;
      const pz = wz + Math.sin(a) * 15;
      const near = this._nearestIndexFast(px, pz);
      const ns = this.samples[near.index];
      const lat = (px - ns.pos.x) * ns.right.x + (pz - ns.pos.z) * ns.right.z;
      wy = Math.max(wy, this.heightAtSample(near.index, lat));
    }
    wy += 0.28;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(14, 22, 36),
      new THREE.MeshStandardMaterial({ color: 0x5c3a22, roughness: 1 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(wx, wy + 0.04, wz);
    ring.receiveShadow = true;
    scene.add(ring);
    this.featureMeshes.push(ring);
    const safariWater = new THREE.MeshPhongMaterial({
      color: 0x3d7f8c, specular: 0xffd9a0, shininess: 90,
      emissive: 0x123238, emissiveIntensity: 0.55,
      transparent: true, opacity: 0.9, depthWrite: false,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(14.5, 36), safariWater);
    water.rotation.x = -Math.PI / 2;
    water.position.set(wx, wy + 0.09, wz);
    scene.add(water);
    this.featureMeshes.push(water);
    const reeds = [];
    for (let k = 0; k < 26; k++) {
      const a = rng() * Math.PI * 2;
      const r = 15.5 + rng() * 5;
      partBox(reeds, 0x7c7c42, 0.06, 0.8 + rng() * 1.4, 0.06,
        wx + Math.cos(a) * r, wy + 0.4 + rng() * 0.6, wz + Math.sin(a) * r, rng() * 2);
    }
    this._addColoredMesh(scene, reeds, mats.cloth, {});
    this._markExclusion(wx, wz, 34);
    this._markSightline(this.samples[wi].pos.x, this.samples[wi].pos.z, wx, wz, 9, 7);

    // Giraffes and zebras around the waterhole.
    const giraffes = [];
    const zebras = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.5 + rng() * 0.3;
      const r = 25 + rng() * 16;
      const gx = wx + Math.cos(a) * r;
      const gz = wz + Math.sin(a) * r;
      const near = this._nearestIndexFast(gx, gz);
      const glat = (gx - this.samples[near.index].pos.x) * this.samples[near.index].right.x +
        (gz - this.samples[near.index].pos.z) * this.samples[near.index].right.z;
      giraffes.push({ x: gx, z: gz, y: this.heightAtSample(near.index, glat), ry: rng() * Math.PI * 2, scale: 0.95 + rng() * 0.25 });
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 - 1.1 + rng() * 0.3;
      const r = 20 + rng() * 12;
      const zx = wx + Math.cos(a) * r;
      const zz = wz + Math.sin(a) * r;
      const near = this._nearestIndexFast(zx, zz);
      const zlat = (zx - this.samples[near.index].pos.x) * this.samples[near.index].right.x +
        (zz - this.samples[near.index].pos.z) * this.samples[near.index].right.z;
      zebras.push({ x: zx, z: zz, y: this.heightAtSample(near.index, zlat), ry: rng() * Math.PI * 2, scale: 0.9 + rng() * 0.2 });
    }
    this._addGiraffes(scene, giraffes);
    this._addZebras(scene, zebras);
    this.landmarks.waterhole = { x: wx, z: wz, y: wy };

    // A hot-air balloon drifting over the camp.
    const balloon = new THREE.Group();
    const { canvas, ctx } = canvas2D(256, 256);
    const cols = ['#b94232', '#e2bf55', '#2e5e91', '#d9d2bb', '#b94232', '#e2bf55', '#2e5e91'];
    for (let i = 0; i < cols.length; i++) {
      ctx.fillStyle = cols[i];
      ctx.fillRect((i / cols.length) * 256, 0, 256 / cols.length + 1, 256);
    }
    const balloonTex = makeCanvasTexture(canvas, { repeat: true });
    const balloonMat = new THREE.MeshStandardMaterial({ map: balloonTex, roughness: 0.8 });
    const envelope = new THREE.Mesh(new THREE.SphereGeometry(8.5, 22, 14), balloonMat);
    envelope.scale.set(1.0, 1.25, 1.0);
    envelope.position.y = 10;
    envelope.castShadow = false;
    balloon.add(envelope);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }));
    basket.position.y = -1.1;
    balloon.add(basket);
    for (const a of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.5, 4),
        new THREE.MeshStandardMaterial({ color: 0x3b3022, roughness: 0.9 }));
      rope.position.set(a[0] * 0.8, 1.0, a[1] * 0.8);
      balloon.add(rope);
    }
    balloon.position.set(bx + s.right.x * side * 40, by + 92, bz + s.right.z * side * 40);
    scene.add(balloon);
    this.balloon = balloon;
    this.featureMeshes.push(balloon);
  }

  _addGiraffes(scene, spots) {
    if (!spots.length) return;
    const parts = [];
    partBox(parts, 0xcaa06a, 1.25, 1.05, 2.5, 0, 2.0, 0);
    partCyl(parts, 0xd0aa75, 0.3, 0.48, 2.2, 7, 0, 3.0, 1.05, 0.35);
    partSphere(parts, 0xd8b47f, 0.44, 0, 4.22, 1.35, 1.2, 0.9, 1.1);
    partBox(parts, 0x745026, 0.55, 0.42, 0.4, 0, 4.2, 1.72);
    partBox(parts, 0x4a3520, 0.12, 0.38, 0.12, -0.22, 4.55, 1.35);
    partBox(parts, 0x4a3520, 0.12, 0.38, 0.12, 0.22, 4.55, 1.35);
    for (const [x, z] of [[-0.42, -0.9], [0.42, -0.9], [-0.42, 0.9], [0.42, 0.9]]) {
      partBox(parts, 0x9c7848, 0.18, 1.55, 0.18, x, 0.78, z);
    }
    partCyl(parts, 0x6b4a27, 0.035, 0.08, 1.0, 4, 0, 2.1, -1.38, 0.3);
    const geo = mergeColored(parts);
    const mat = new THREE.MeshStandardMaterial({
      map: makeAnimalTexture('giraffe'), vertexColors: true, roughness: 0.9,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((p, i) => {
      TMP.position.set(p.x, p.y, p.z);
      TMP.rotation.set(0, p.ry || 0, 0);
      TMP.scale.setScalar(p.scale || 1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.castShadow = this.quality === 'high';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  _addZebras(scene, spots) {
    if (!spots.length) return;
    const parts = [];
    partBox(parts, 0xe2ddcd, 0.9, 0.8, 1.9, 0, 1.35, 0);
    partCyl(parts, 0xf0ebdc, 0.22, 0.33, 1.1, 6, 0, 1.85, 0.8, 0.2);
    partBox(parts, 0xe2ddcd, 0.33, 0.3, 0.66, 0, 2.2, 1.2);
    partBox(parts, 0x171612, 0.04, 0.34, 0.2, 0, 2.3, 0.88);
    partBox(parts, 0x171612, 0.04, 0.34, 0.16, 0, 2.3, 1.55);
    for (const [x, z] of [[-0.3, -0.7], [0.3, -0.7], [-0.3, 0.7], [0.3, 0.7]]) {
      partBox(parts, 0xd8d3c4, 0.14, 1.0, 0.14, x, 0.5, z);
      partBox(parts, 0x1a1915, 0.15, 0.24, 0.15, x, 0.12, z);
    }
    partBox(parts, 0x1d1c18, 0.12, 0.9, 0.1, 0, 1.65, -0.86);
    const geo = mergeColored(parts);
    const mat = new THREE.MeshStandardMaterial({
      map: makeAnimalTexture('zebra'), vertexColors: true, roughness: 0.92,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((p, i) => {
      TMP.position.set(p.x, p.y, p.z);
      TMP.rotation.set(0, p.ry || 0, 0);
      TMP.scale.setScalar(p.scale || 1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.castShadow = this.quality === 'high';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  _addLandmarks(scene, quality) {
    const biome = this.stage.biome;
    if (biome === 'forest') this._forestSet(scene, quality);
    if (biome === 'jungle') this._jungleSet(scene, quality);
    if (biome === 'snow') this._snowSet(scene, quality);
    if (biome === 'japan') this._japanSet(scene, quality);
    if (biome === 'russia') this._russiaSet(scene, quality);
    if (biome === 'safari') this._safariSet(scene, quality);
  }

  /* ---------------- roadside dressing ---------------- */
  _addRoadside(scene, quality) {
    const rng = mulberry32(this.seed + 31337);
    const biome = this.stage.biome;
    const isHigh = quality === 'high';
    const stride = isHigh ? 3 : 5;

    /* tyre stacks + hay bales on the outside of the quicker corners */
    const tyres = [];
    const hays = [];
    let lastDecor = -999;
    for (let i = 20; i < this.n - 24; i += stride) {
      const s = this.samples[i];
      const c = Math.abs(s.curvatureSmooth);
      if (c < 0.011) continue;
      if (i - lastDecor < 34) continue;
      if (rng() > 0.18 + Math.min(0.45, c * 20)) continue;
      lastDecor = i;
      const side = s.curvatureSmooth > 0 ? -1 : 1;
      const lat = side * (this.halfWidth + 1.9 + rng() * 1.6);
      const y = this.heightAtSample(i, lat);
      const x = s.pos.x + s.right.x * lat;
      const z = s.pos.z + s.right.z * lat;
      const stack = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < stack; k++) {
        tyres.push({ x, y: y + 0.12 + k * 0.235, z, rot: rng() * Math.PI });
      }
      if (biome !== 'snow' && rng() < 0.45) {
        const n = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const hl = lat + side * (1.9 + k * 1.15);
          hays.push({
            x: s.pos.x + s.right.x * hl,
            y: this.heightAtSample(i, hl) + 0.3,
            z: s.pos.z + s.right.z * hl,
            rot: s.heading + Math.PI / 2 + (rng() - 0.5) * 0.2,
          });
        }
      }
    }
    if (tyres.length) {
      const geo = new THREE.TorusGeometry(0.33, 0.115, 6, 12);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.9 });
      const mesh = new THREE.InstancedMesh(geo, mat, tyres.length);
      tyres.forEach((t, i) => {
        TMP.position.set(t.x, t.y, t.z);
        TMP.rotation.set(0, t.rot, 0);
        TMP.scale.setScalar(1);
        TMP.updateMatrix();
        mesh.setMatrixAt(i, TMP.matrix);
      });
      mesh.castShadow = isHigh;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    if (hays.length) {
      const geo = new THREE.BoxGeometry(0.95, 0.62, 0.5);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 });
      const mesh = new THREE.InstancedMesh(geo, mat, hays.length);
      hays.forEach((h, i) => {
        TMP.position.set(h.x, h.y, h.z);
        TMP.rotation.set(0, h.rot, 0);
        TMP.scale.setScalar(1);
        TMP.updateMatrix();
        mesh.setMatrixAt(i, TMP.matrix);
        mesh.setColorAt(i, new THREE.Color(0xd8c47a).offsetHSL(0, 0, (rng() - 0.5) * 0.1));
      });
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = isHigh;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }


    /* sponsor boards */
    const boardSpots = [
      { i: this.startGateIndex + 26, side: 1 },
      { i: Math.floor(this.n * 0.22), side: -1 },
      { i: Math.floor(this.n * 0.46), side: 1 },
      { i: Math.floor(this.n * 0.68), side: -1 },
      { i: this.finishGateIndex - 34, side: 1 },
    ];
    const boards = [
      ['GROUP B', '#101a12', '#f2c43a'],
      ['RALLY LEGENDS', '#f2c43a', '#101a12'],
      [this.stage.name, '#1c2a1e', '#ece7d7'],
      ['SS ' + this.stage.ss.replace('SS', ''), '#8f2018', '#f3efe2'],
    ];
    boardSpots.forEach((spot, bi) => {
      const i = clamp(spot.i, 10, this.n - 12);
      const s = this.samples[i];
      const lat = spot.side * (this.halfWidth + 3.4);
      const y = this.heightAtSample(i, lat);
      const [label, bg, fg] = boards[bi % boards.length];
      const tex = this._boardTexture(label, bg, fg);
      const group = new THREE.Group();
      group.position.set(s.pos.x + s.right.x * lat, y, s.pos.z + s.right.z * lat);
      group.rotation.y = s.heading + Math.PI / 2;
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2d2a, roughness: 0.7, metalness: 0.3 });
      for (const dx of [-1.42, 1.42]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), frameMat);
        leg.position.set(dx, 1.1, -0.04);
        group.add(leg);
      }
      const mat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.8, side: THREE.DoubleSide,
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16,
      });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.05), mat);
      board.position.set(0, 2.1, 0);
      group.add(board);
      scene.add(group);
    });

    /* hazard warning boards */
    const warnTex = this._warningTexture();
    const warnMat = new THREE.MeshStandardMaterial({
      map: warnTex, transparent: true, alphaTest: 0.25, roughness: 0.8,
      side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: warnTex, emissiveIntensity: 0.22,
    });
    for (const h of this.hazardPatches) {
      for (const side of [-1, 1]) {
        if (rng() < 0.35) continue;
        const i = clamp(h.start - 2, 6, this.n - 8);
        const s = this.samples[i];
        const lat = side * (this.halfWidth + 1.9);
        const y = this.surfaceHeight(i, lat);
        const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), warnMat);
        warn.position.set(s.pos.x + s.right.x * lat, y + 0.9, s.pos.z + s.right.z * lat);
        warn.rotation.y = s.heading + Math.PI / 2;
        scene.add(warn);
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.9, 0.06),
          new THREE.MeshStandardMaterial({ color: 0x8e8a7c, roughness: 0.9 })
        );
        post.position.set(warn.position.x, y + 0.45, warn.position.z);
        scene.add(post);
      }
    }

    /* parked spectator cars */
    const cars = [];
    const palette = [0xb33a2c, 0x2d5c8a, 0xd8c24a, 0x3b6b45, 0xd8d6cc, 0x7a3a72];
    for (const idx of [this.startGateIndex + 16, this.finishGateIndex - 20, Math.floor(this.n * 0.35), Math.floor(this.n * 0.62)]) {
      const s = this.samples[clamp(idx, 12, this.n - 14)];
      const side = rng() < 0.5 ? 1 : -1;
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const lat = side * (this.halfWidth + 9.4 + k * 2.5 + rng() * 1.2);
        cars.push({
          x: s.pos.x + s.right.x * lat + (rng() - 0.5) * 3,
          y: this.heightAtSample(clamp(idx, 12, this.n - 14), lat),
          z: s.pos.z + s.right.z * lat + (rng() - 0.5) * 3,
          rot: s.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.35,
          color: palette[(rng() * palette.length) | 0],
        });
      }
    }
    if (cars.length) {
      const bodyGeo = new THREE.BoxGeometry(1.65, 0.62, 3.7);
      bodyGeo.translate(0, 0.52, 0);
      const cabinGeo = new THREE.BoxGeometry(1.42, 0.55, 1.9);
      cabinGeo.translate(0, 1.06, -0.15);
      const geo = mergeGeometries([bodyGeo, cabinGeo]);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.25 });
      const mesh = new THREE.InstancedMesh(geo, mat, cars.length);
      cars.forEach((c, i) => {
        TMP.position.set(c.x, c.y, c.z);
        TMP.rotation.set(0, c.rot, 0);
        TMP.scale.setScalar(1);
        TMP.updateMatrix();
        mesh.setMatrixAt(i, TMP.matrix);
        mesh.setColorAt(i, new THREE.Color(c.color));
      });
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = isHigh;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  _boardTexture(label, bg, fg) {
    const { canvas, ctx } = canvas2D(512, 168);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 168);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 7;
    ctx.strokeRect(9, 9, 494, 150);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 74px "Barlow Condensed", sans-serif';
    ctx.fillText(label, 256, 92, 452);
    return makeCanvasTexture(canvas);
  }

  _warningTexture() {
    const { canvas, ctx } = canvas2D(128, 128);
    ctx.clearRect(0, 0, 128, 128);
    ctx.beginPath();
    ctx.moveTo(64, 8);
    ctx.lineTo(120, 112);
    ctx.lineTo(8, 112);
    ctx.closePath();
    ctx.fillStyle = '#e8a21a';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#171a15';
    ctx.stroke();
    ctx.fillStyle = '#16180f';
    ctx.font = '700 68px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 64, 103);
    return makeCanvasTexture(canvas);
  }

  /* ---------------- distant ridges ---------------- */
  _addRidges(scene) {
    if (!this.bounds) return;
    const biome = this.stage.biome;
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const baseY = Math.min(...this.samples.map((s) => s.pos.y)) - 26;
    const diag = Math.hypot(maxX - minX, maxZ - minZ);
    const radius = diag * 0.62 + 560;
    const rng = mulberry32(this.seed + 90210);
    const style = {
      forest: { rings: 2, hMin: 24, hMax: 66, wMin: 150, wMax: 280, blend: 0.82, opacity: 0.5, snow: false, flat: 1 },
      jungle: { rings: 2, hMin: 34, hMax: 95, wMin: 180, wMax: 320, blend: 0.72, opacity: 0.64, snow: false, flat: 1 },
      snow: { rings: 2, hMin: 18, hMax: 48, wMin: 230, wMax: 420, blend: 0.55, opacity: 0.72, snow: true, flat: 1 },
      japan: { rings: 2, hMin: 60, hMax: 165, wMin: 160, wMax: 300, blend: 0.66, opacity: 0.74, snow: true, flat: 0.9 },
      russia: { rings: 2, hMin: 15, hMax: 38, wMin: 220, wMax: 400, blend: 0.8, opacity: 0.42, snow: false, flat: 1 },
      safari: { rings: 2, hMin: 38, hMax: 95, wMin: 240, wMax: 460, blend: 0.58, opacity: 0.52, snow: false, flat: 0.55 },
    }[biome] || { rings: 2, hMin: 30, hMax: 80, wMin: 180, wMax: 300, blend: 0.8, opacity: 0.55, snow: false, flat: 1 };

    for (let ring = 0; ring < style.rings; ring++) {
      const parts = [];
      const snowParts = [];
      const count = ring === 0 ? 34 : 28;
      const rr = radius * (ring === 0 ? 0.72 : 1.05);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * 0.14;
        const r = rr * (0.8 + rng() * 0.35);
        const h = style.hMin + rng() * (style.hMax - style.hMin) + Math.sin(i * 1.7) * 12;
        const w = style.wMin + rng() * (style.wMax - style.wMin);
        const g = new THREE.ConeGeometry(w, h * style.flat, 5 + (i % 3), 1);
        g.translate(0, h * style.flat * 0.5, 0);
        g.rotateY(rng() * Math.PI * 2);
        g.translate(cx + Math.cos(a) * r, baseY, cz + Math.sin(a) * r);
        parts.push(g);
        if (style.snow && h * style.flat > 68) {
          const capH = h * style.flat * 0.34;
          const cap = new THREE.ConeGeometry(w * 0.36, capH, 5 + (i % 3), 1);
          cap.translate(0, capH * 0.5, 0);
          cap.rotateY(rng() * Math.PI * 2);
          cap.translate(cx + Math.cos(a) * r, baseY + h * style.flat * 0.68, cz + Math.sin(a) * r);
          snowParts.push(cap);
        }
      }
      const geo = mergeGeometries(parts);
      const fog = new THREE.Color(this.env.fog);
      const col = new THREE.Color(this.env.hill).lerp(fog, ring === 0 ? style.blend : 0.92);
      const mat = new THREE.MeshBasicMaterial({
        color: col, fog: false, transparent: true,
        opacity: style.opacity * (ring === 0 ? 1 : 0.72),
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -8 - ring;
      scene.add(mesh);
      if (ring === 0) this.ridgeMesh = mesh;
      if (snowParts.length) {
        const snowGeo = mergeGeometries(snowParts);
        const snowMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xeaf4fb).lerp(fog, 0.32),
          fog: false, transparent: true, opacity: 0.6, depthWrite: false,
        });
        const snowMesh = new THREE.Mesh(snowGeo, snowMat);
        snowMesh.frustumCulled = false;
        snowMesh.renderOrder = -7;
        scene.add(snowMesh);
      }
    }
  }

  _addCrowd(scene, quality) {
    const rng = mulberry32(this.seed + 900);
    const spots = [this.startGateIndex + 8, this.finishGateIndex - 12,
      Math.floor(this.n * 0.26), Math.floor(this.n * 0.47), Math.floor(this.n * 0.7)];
    const people = [];
    for (const idx of spots) {
      for (const side of [-1, 1]) {
        if (rng() < 0.35) continue;
        const s = this.samples[clamp(Math.round(idx + (rng() - 0.5) * 12), 0, this.n - 1)];
        const count = 2 + Math.floor(rng() * 4);
        for (let k = 0; k < count; k++) {
          const lat = side * (this.halfWidth + 8.1 + rng() * 4.2);
          const latOffset = lat + (rng() - 0.5) * 2;
          const along = (rng() - 0.5) * 8;
          const x = s.pos.x + s.right.x * latOffset + s.tangent.x * along;
          const z = s.pos.z + s.right.z * latOffset + s.tangent.z * along;
          const near = this._nearestIndexFast(x, z);
          const yy = this.heightAtSample(near.index, latOffset);
          people.push({
            x, y: yy, z, ry: rng() * Math.PI * 2,
            color: new THREE.Color(makeCrowdShirt((rng() * 7) | 0)),
            scale: 0.88 + rng() * 0.25,
          });
        }
      }
    }
    if (!people.length) return;
    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.26, 0.95, 6);
    bodyGeo.translate(0, 0.75, 0);
    const headGeo = new THREE.SphereGeometry(0.15, 7, 6);
    headGeo.translate(0, 1.38, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xc8a084, roughness: 0.9 });
    const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, people.length);
    const headMesh = new THREE.InstancedMesh(headGeo, headMat, people.length);
    people.forEach((p, i) => {
      TMP.position.set(p.x, p.y, p.z);
      TMP.rotation.set(0, p.ry, 0);
      TMP.scale.setScalar(p.scale);
      TMP.updateMatrix();
      bodyMesh.setMatrixAt(i, TMP.matrix);
      headMesh.setMatrixAt(i, TMP.matrix);
      bodyMesh.setColorAt(i, p.color);
    });
    bodyMesh.instanceColor.needsUpdate = true;
    bodyMesh.castShadow = true;
    headMesh.castShadow = true;
    scene.add(bodyMesh, headMesh);
  }

  /* ---------------- vegetation ---------------- */
  buildScenery(scene, quality) {
    if (this.endless) {
      this._initEndlessScenery(scene, quality);
      return;
    }
    this._treeAssets = this._makeTreeAssets();
    const collected = this._collectScenery(0, this.n, quality, this.seed + 1991);
    this._buildTreeMeshes(scene, collected.trees, quality, this.seed + 78);
    this._buildUnderstory(scene, collected.under, quality);
    this._buildGroundDetail(scene, collected.detail, quality);
    this.treeCount = Object.values(collected.trees).reduce((n, a) => n + a.length, 0);
  }

  _scatterProfile() {
    const fallback = {
      mix: { pine: 0.6, birch: 0.4 }, density: 1, edge: 6.5, scale: 1,
      fern: 0.4, grass: 0.7, bush: 0.25, flower: 0.1, reed: 0,
    };
    return this.env.scatter || fallback;
  }

  _collectScenery(i0, i1, quality, seed) {
    const prof = this._scatterProfile();
    const biome = this.stage.biome;
    const rng = mulberry32(seed);
    const high = quality === 'high';
    const stride = high ? 2 : quality === 'medium' ? 3 : 5;
    const treeCap = high ? 4600 : quality === 'medium' ? 2600 : 1200;
    const underCap = high ? 4200 : quality === 'medium' ? 2600 : 1200;
    const mix = prof.mix || { pine: 0.6, birch: 0.4 };
    const keys = Object.keys(mix);
    const trees = {};
    for (const k of keys) trees[k] = [];
    const under = { fern: [], grass: [], bush: [], flower: [], reed: [] };
    const detail = { rock: [], log: [], stump: [], mound: [] };
    const spread = this.env.terrain && this.env.terrain.style === 'plain' ? 68 : 50;
    const density = prof.density || 1;
    const edge = prof.edge || 6.5;
    const pick = () => {
      let r = rng();
      for (const k of keys) {
        if (r < mix[k]) return k;
        r -= mix[k];
      }
      return keys[0];
    };
    const place = (index, lat, scale, rot) => {
      const idx = clamp(index, 0, this.n - 1);
      const s = this.samples[idx];
      const x = s.pos.x + s.right.x * lat;
      const z = s.pos.z + s.right.z * lat;
      const y = (this._terrainGrid && Math.abs(lat) > this.halfWidth + 6)
        ? this.terrainHeightAt(x, z)
        : this.heightAtSample(idx, lat);
      return { x, y, z, scale, rot, index: idx };
    };
    const underKind = () => {
      let r = rng();
      const weights = [
        ['fern', prof.fern || 0],
        ['grass', prof.grass || 0],
        ['bush', prof.bush || 0],
        ['flower', prof.flower || 0],
        ['reed', prof.reed || 0],
      ];
      for (const [k, w] of weights) {
        if (r < w) return k;
        r -= w;
      }
      return 'grass';
    };

    const span = Math.min(this.n - 6, i1);
    for (let i = Math.max(6, i0); i < span; i += stride) {
      for (const side of [-1, 1]) {
        // Main canopy layer. Close hero trees frame the road, the rest recede.
        if (rng() > 0.48 + density * 0.3) continue;
        const type = pick();
        const asset = this._treeAssets ? this._treeAssets[type] : null;
        const canopyHalf = Math.max(2.2, (asset?.width || 7) * 0.5);
        const minLat = this.halfWidth + canopyHalf * 0.95 + 1.2;
        const nearHero = rng() < 0.5;
        const baseLat = nearHero
          ? minLat + 1.0 + rng() * 4.5
          : Math.max(minLat + 1.0, this.halfWidth + edge + 1.2 + Math.pow(rng(), 1.02) * spread);
        const lat = side * baseLat;
        const scale = (prof.scale || 1) * (0.72 + rng() * 0.62) * (nearHero ? 0.88 + rng() * 0.18 : 1);
        const px = place(i + Math.floor(rng() * 3) - 1, lat, scale, rng() * Math.PI * 2);
        if (!this._isExcluded(px.x, px.z) && trees[type] && trees[type].length < treeCap) trees[type].push(px);
        // companion tree makes the canopy read as a wood, not a row of sticks
        if (rng() < 0.68) {
          const type2 = pick();
          const asset2 = this._treeAssets ? this._treeAssets[type2] : null;
          const canopyHalf2 = Math.max(2.2, (asset2?.width || 7) * 0.5);
          const minLat2 = this.halfWidth + canopyHalf2 * 0.95 + 1.2;
          const lat2 = side * Math.max(minLat2 + 1.0, baseLat + 1.6 + rng() * 8.5);
          const px2 = place(i + Math.floor(rng() * 5), lat2,
            (prof.scale || 1) * (0.6 + rng() * 0.55), rng() * Math.PI * 2);
          if (!this._isExcluded(px2.x, px2.z) && trees[type2] && trees[type2].length < treeCap) trees[type2].push(px2);
        }
        // A few trunks / logs / boulders in the undergrowth.
        if (rng() < 0.055 + (this.env.terrain?.cliff || 0) * 0.06 && detail.rock.length < (high ? 260 : 140)) {
          const rockSpot = place(i, side * (this.halfWidth + edge * 0.45 + rng() * (spread * 0.55)),
            0.35 + Math.pow(rng(), 1.7) * 1.8, rng() * Math.PI * 2);
          if (!this._isExcluded(rockSpot.x, rockSpot.z)) detail.rock.push(rockSpot);
        }
      }

      // Low understory: dense at the verge, thinning into the trees.
      const clumps = biome === 'jungle' ? 3 : biome === 'safari' ? 2 : 2;
      for (let k = 0; k < clumps; k++) {
        if (rng() > 0.5 + density * 0.34) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const kind = underKind();
        if (under[kind].length >= underCap) continue;
        const lat = side * (this.halfWidth + 1.4 + Math.pow(rng(), 1.4) * (edge * 0.7 + 8));
        const underSpot = place(i + Math.floor(rng() * 4) - 1, lat,
          0.45 + rng() * (kind === 'reed' ? 1.0 : 0.9), rng() * Math.PI * 2);
        if (!this._isExcluded(underSpot.x, underSpot.z)) under[kind].push(underSpot);
      }

      if (rng() < 0.014 && detail.log.length < (high ? 80 : 42)) {
        const side = rng() < 0.5 ? -1 : 1;
        const logSpot = place(i, side * (this.halfWidth + edge * 0.6 + rng() * 8),
          0.6 + rng() * 0.9, rng() * Math.PI * 2);
        if (!this._isExcluded(logSpot.x, logSpot.z)) detail.log.push(logSpot);
      }
      if (rng() < 0.008 && detail.stump.length < (high ? 40 : 24)) {
        const side = rng() < 0.5 ? -1 : 1;
        const stumpSpot = place(i, side * (this.halfWidth + edge * 0.55 + rng() * 7),
          0.5 + rng() * 0.8, rng() * Math.PI * 2);
        if (!this._isExcluded(stumpSpot.x, stumpSpot.z)) detail.stump.push(stumpSpot);
      }
    }

    if (biome === 'jungle') {
      // hanging-wall of ferns and broad leaves right at the road edge
      for (let i = Math.max(6, i0); i < span; i += 2) {
        if (rng() < 0.62) {
          const side = rng() < 0.5 ? -1 : 1;
          under.fern.push(place(i, side * (this.halfWidth + 1.6 + rng() * 8),
            0.7 + rng() * 1.3, rng() * Math.PI * 2));
        }
        if (rng() < 0.3) {
          const side = rng() < 0.5 ? -1 : 1;
          under.reed.push(place(i, side * (this.halfWidth + 1.5 + rng() * 3.2),
            0.65 + rng() * 0.8, rng() * Math.PI * 2));
        }
      }
    }
    if (biome === 'safari') {
      for (let i = Math.max(6, i0); i < span; i += 2) {
        if (rng() < 0.55) {
          const side = rng() < 0.5 ? -1 : 1;
          under.grass.push(place(i, side * (this.halfWidth + 1.5 + rng() * 10),
            0.7 + rng() * 1.2, rng() * Math.PI * 2));
        }
      }
      for (let d = 80; d < (span - i0) * this.step; d += 95 + rng() * 90) {
        const idx = clamp(i0 + Math.round(d / this.step), 6, this.n - 8);
        const side = rng() < 0.5 ? -1 : 1;
        detail.mound.push(place(idx, side * (this.halfWidth + 6 + rng() * 22),
          0.8 + rng() * 1.8, rng() * Math.PI * 2));
      }
    }
    if (biome === 'japan' || biome === 'russia') {
      // occasional dead fallen cedar / birch by the verge
      for (let i = Math.max(6, i0); i < span; i += 11) {
        if (rng() < 0.18 && detail.log.length < (high ? 90 : 50)) {
          const side = rng() < 0.5 ? -1 : 1;
          detail.log.push(place(i, side * (this.halfWidth + edge * 0.55 + rng() * 6),
            0.7 + rng() * 1.1, rng() * Math.PI * 2));
        }
      }
    }

    return { trees, under, detail };
  }

  _instanced(geo, mat, items, colorFn = null) {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((t, i) => {
      TMP.position.set(t.x, t.y, t.z);
      const yaw = t.rot || 0;
      const tilt = t.tilt || 0;
      TMP.rotation.set(t.tiltX || 0, yaw, t.tiltZ || tilt);
      TMP.scale.setScalar(t.scale || 1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
      if (colorFn) mesh.setColorAt(i, colorFn(i, t));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = this.quality === 'high';
    mesh.receiveShadow = true;
    return mesh;
  }

  _planeCross(width, height, count = 3, y = 0) {
    const parts = [];
    for (let i = 0; i < count; i++) {
      const g = new THREE.PlaneGeometry(width, height);
      g.rotateY((i / count) * Math.PI);
      g.translate(0, y + height * 0.5, 0);
      parts.push(g);
    }
    return mergeGeometries(parts);
  }

  _makePalmAssets() {
    const rng = mulberry32(this.seed + 451);
    const h = 11.5;
    const parts = [];
    const segs = 6;
    let last = new THREE.Vector3(0, 0, 0);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const next = new THREE.Vector3(Math.sin(t * 1.15) * 0.9, t * h, Math.cos(t * 1.15) * 0.3);
      const dir = new THREE.Vector3().subVectors(next, last);
      const g = new THREE.CylinderGeometry(0.14 * (1 - t * 0.32), 0.25 * (1 - t * 0.22), dir.length(), 7);
      g.translate(0, dir.length() / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
      g.translate(last.x, last.y, last.z);
      parts.push(g);
      last = next;
    }
    const trunkGeo = mergeGeometries(parts);
    const fronds = [];
    const crown = last.clone();
    const count = 11;
    for (let i = 0; i < count; i++) {
      const g = new THREE.PlaneGeometry(4.6 + rng() * 1.1, 1.15);
      g.rotateX(-Math.PI / 2);
      g.translate(2.3, 0, 0);
      g.rotateZ(-0.2 - rng() * 0.42);
      g.rotateY((i / count) * Math.PI * 2 + rng() * 0.32);
      g.translate(crown.x, crown.y + (rng() - 0.5) * 0.3, crown.z);
      fronds.push(g);
    }
    const leafGeo = mergeGeometries(fronds);
    const bark = makeBarkTexture('palm');
    const trunkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.98 });
    const frondTex = makePalmFrondTexture();
    const frondMat = new THREE.MeshStandardMaterial({
      map: frondTex, alphaTest: 0.34, side: THREE.DoubleSide,
      roughness: 0.94, metalness: 0,
      emissive: 0xffffff, emissiveMap: frondTex, emissiveIntensity: 0.16,
    });
    return { trunkGeo, leafGeo, trunkMat, leafMat: frondMat, height: h, width: 9.8 };
  }

  _solidCanopyGeometry(type, p, rng) {
    const parts = [];
    if (type === 'pine' || type === 'spruce' || type === 'cedar') {
      const layers = type === 'cedar' ? 6 : 5;
      for (let k = 0; k < layers; k++) {
        const t = k / (layers - 1);
        const y = p.h * (0.2 + t * 0.66);
        const r = p.w * (type === 'cedar' ? 0.24 : 0.3) * (1 - t * 0.48);
        const g = new THREE.IcosahedronGeometry(1, 1);
        g.scale(r * (0.72 + rng() * 0.42), p.h * 0.13 * (0.8 + rng() * 0.5), r * (0.72 + rng() * 0.42));
        g.translate((rng() - 0.5) * r * 0.8, y + (rng() - 0.5) * p.h * 0.035, (rng() - 0.5) * r * 0.8);
        parts.push(g);
      }
    } else if (type === 'acacia' || type === 'baobab') {
      const leafY = p.h * (p.canopyY || 0);
      const leafH = p.canopyH || (p.h - leafY);
      const cy = leafY + leafH * 0.45;
      const rw = (p.canopyW || p.w) * 0.26;
      for (let i = 0; i < (type === 'acacia' ? 4 : 3); i++) {
        const g = new THREE.IcosahedronGeometry(1, 1);
        g.scale(rw * (1.0 + rng() * 0.8), leafH * (0.18 + rng() * 0.14), rw * (1.0 + rng() * 0.8));
        g.translate((rng() - 0.5) * rw * 1.6, cy + (rng() - 0.5) * leafH * 0.4, (rng() - 0.5) * rw * 1.6);
        parts.push(g);
      }
    } else {
      const leafY = p.h * (p.canopyY || 0);
      const leafH = p.canopyH || (p.h - leafY);
      const cy = leafY + leafH * 0.47;
      const rw = (p.canopyW || p.w) * 0.3;
      const rh = leafH * 0.32;
      const count = type === 'birch' ? 3 : 5;
      for (let i = 0; i < count; i++) {
        const g = new THREE.IcosahedronGeometry(1, 1);
        g.scale(rw * (0.55 + rng() * 0.55), rh * (0.55 + rng() * 0.55), rw * (0.55 + rng() * 0.55));
        g.translate((rng() - 0.5) * rw * 1.55, cy + (rng() - 0.5) * rh * 1.5, (rng() - 0.5) * rw * 1.55);
        parts.push(g);
      }
    }
    return mergeGeometries(parts);
  }

  _makeTreeAssets() {
    const env = this.env;
    const rng = mulberry32(this.seed + 77);
    const biome = this.stage.biome;
    const snowy = biome === 'snow';
    const profiles = {
      pine: { h: 17, w: 9.2, trunkH: 15.5, bark: 'pine', tex: 'pine', planes: 3, trunkR: 0.21 },
      spruce: { h: 13.5, w: 7.4, trunkH: 12.2, bark: 'pine', tex: 'spruce', planes: 3, trunkR: 0.18 },
      cedar: { h: 20, w: 7.2, trunkH: 18.5, bark: 'cedar', tex: 'cedar', planes: 3, trunkR: 0.22 },
      birch: { h: 12.5, w: 8.4, trunkH: 11.5, bark: 'birch', tex: 'birch', planes: 3, trunkR: 0.11, canopyY: 0.18 },
      oak: { h: 12, w: 12.5, trunkH: 7.4, bark: 'oak', tex: 'oak', planes: 3, trunkR: 0.27, canopyY: 0.2 },
      broad: { h: 15, w: 15, trunkH: 9.5, bark: 'oak', tex: 'oak', planes: 3, trunkR: 0.34, canopyY: 0.18 },
      banana: { h: 5.2, w: 5.8, trunkH: 1.5, bark: 'palm', tex: 'banana', planes: 3, trunkR: 0.13, canopyY: 0 },
      acacia: { h: 9, w: 7.4, trunkH: 6.0, bark: 'acacia', tex: 'acacia', planes: 3, trunkR: 0.22, canopyY: 0.38, canopyW: 16, canopyH: 6.8 },
      baobab: { h: 10, w: 9.4, trunkH: 7.0, bark: 'baobab', tex: 'baobab', planes: 3, trunkR: 0.65, canopyY: 0.62, canopyW: 12, canopyH: 5.2 },
    };
    const out = {};
    const barkCache = {};
    for (const [type, p] of Object.entries(profiles)) {
      if (type === 'banana' && !['jungle'].includes(biome)) continue;
      if (type === 'baobab' && biome !== 'safari') continue;
      // palm / banana have custom frond geometry
      if (type === 'banana') {
        // banana uses a cross-plane leaf canopy with a short pseudostem
        const trunkGeo = new THREE.CylinderGeometry(0.1, 0.17, p.trunkH, 6);
        trunkGeo.translate(0, p.trunkH * 0.5, 0);
        const leafTex = makeCanopyTexture('banana', snowy);
        out[type] = {
          trunkGeo,
          leafGeo: this._planeCross(p.w, p.h, p.planes, 0.2),
          trunkMat: new THREE.MeshStandardMaterial({ map: makeBarkTexture('palm'), roughness: 1 }),
          leafMat: new THREE.MeshStandardMaterial({
            map: leafTex, alphaTest: 0.32, side: THREE.DoubleSide, roughness: 0.95,
            emissive: 0xffffff, emissiveMap: leafTex, emissiveIntensity: 0.18,
          }),
          height: p.h, width: p.w,
        };
        continue;
      }
      const trunkGeo = new THREE.CylinderGeometry(p.trunkR * 0.55, p.trunkR, p.trunkH, 7);
      trunkGeo.translate(0, p.trunkH * 0.5, 0);
      const leafY = p.h * (p.canopyY || 0);
      const leafW = p.canopyW || p.w;
      const leafH = p.canopyH || (p.h - leafY);
      const leafGeo = this._planeCross(leafW, leafH, p.planes, leafY);
      if (!barkCache[p.bark]) barkCache[p.bark] = makeBarkTexture(p.bark);
      const barkTex = barkCache[p.bark];
      const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1 });
      const leafTex = makeCanopyTexture(p.tex, snowy);
      const leafMat = new THREE.MeshStandardMaterial({
        map: leafTex,
        alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.93, metalness: 0,
        emissive: 0xffffff, emissiveMap: leafTex,
        emissiveIntensity: snowy ? 0.2 : 0.16,
      });
      let solidGeo = null;
      let solidMat = null;
      if (type !== 'dead') {
        solidGeo = this._solidCanopyGeometry(type, p, rng);
        const solidTex = makeLeafSurfaceTexture(p.tex, snowy);
        solidMat = new THREE.MeshStandardMaterial({
          map: solidTex, roughness: 0.97, metalness: 0,
          emissive: 0xffffff, emissiveMap: solidTex, emissiveIntensity: 0.1,
        });
      }
      out[type] = { trunkGeo, leafGeo, trunkMat, leafMat, solidGeo, solidMat, height: p.h, width: leafW };
    }
    out.palm = this._makePalmAssets();
    return out;
  }

  _addTreeSet(parent, items, type, rng, quality) {
    if (!items || !items.length) return;
    const A = this._treeAssets || (this._treeAssets = this._makeTreeAssets());
    const asset = A[type];
    if (!asset) return;
    const trunk = this._instanced(asset.trunkGeo, asset.trunkMat, items, () => {
      const c = new THREE.Color(1, 1, 1).multiplyScalar(0.82 + rng() * 0.28);
      c.offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.08, 0);
      return c;
    });
    const wind = this._windStrength();
    this._windify(asset.leafMat, wind * 1.05);
    if (asset.solidMat) this._windify(asset.solidMat, wind * 0.42);
    const leafTint = new THREE.Color(this.env.treeAlt || 0xffffff).lerp(new THREE.Color(0xffffff), 0.68);
    const solidTint = new THREE.Color(this.env.tree || 0xffffff).lerp(new THREE.Color(0xffffff), 0.62);
    const leaf = this._instanced(asset.leafGeo, asset.leafMat, items, () => {
      const c = leafTint.clone().multiplyScalar(0.92 + rng() * 0.25);
      c.offsetHSL((rng() - 0.5) * 0.035, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.05);
      return c;
    });
    if (trunk) {
      trunk.castShadow = quality === 'high';
      parent.add(trunk);
    }
    if (leaf) {
      leaf.castShadow = quality === 'high';
      leaf.receiveShadow = true;
      parent.add(leaf);
    }
    if (asset.solidGeo && asset.solidMat) {
      const solid = this._instanced(asset.solidGeo, asset.solidMat, items, () => {
        const c = solidTint.clone().multiplyScalar(0.95 + rng() * 0.22);
        c.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.04);
        return c;
      });
      if (solid) {
        solid.castShadow = quality === 'high';
        solid.receiveShadow = true;
        parent.add(solid);
      }
    }
  }

  _buildTreeMeshes(scene, spots, quality, seed) {
    const rng = mulberry32(seed || this.seed + 78);
    for (const [type, items] of Object.entries(spots)) {
      this._addTreeSet(scene, items, type, rng, quality);
    }
  }

  _underMaterial(tex, color, alphaTest = 0.28) {
    return this._windify(new THREE.MeshStandardMaterial({
      map: tex, color, alphaTest, side: THREE.DoubleSide, roughness: 0.95,
      metalness: 0, depthWrite: true,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1,
    }), this._windStrength() * 0.82);
  }

  _buildUnderstory(scene, under, quality) {
    const prof = this._scatterProfile();
    const fernTex = makeFernTexture();
    const grassTex = makeGrassTexture();
    const flowerTex = makeFlowerTexture();
    const reedTex = makeReedTexture();
    const bushTex = makeCanopyTexture('oak', this.stage.biome === 'snow');
    const mk = (items, tex, w, h, color, planes = 2) => {
      if (!items.length) return;
      const mat = this._underMaterial(tex, color, 0.3);
      const geo = this._planeCross(w, h, planes, 0);
      const mesh = this._instanced(geo, mat, items, () => {
        const c = new THREE.Color(1, 1, 1).multiplyScalar(0.72 + Math.random() * 0.45);
        c.offsetHSL((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08);
        return c;
      });
      if (!mesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      scene.add(mesh);
    };
    mk(under.fern, fernTex, 1.7, 1.3, prof.fernColor || 0x8fae54, 2);
    mk(under.grass, grassTex, 0.95, 1.05, prof.grassColor || 0x819b52, 2);
    mk(under.flower, flowerTex, 0.85, 0.95, 0xffffff, 2);
    mk(under.reed, reedTex, 1.25, 1.7, prof.grassColor || 0x8b9b5a, 2);
    if (under.bush.length) {
      const bushMat = this._windify(new THREE.MeshStandardMaterial({
        map: bushTex, color: prof.bushColor || 0x5a7444,
        alphaTest: 0.28, side: THREE.DoubleSide, roughness: 0.98,
        emissive: 0xffffff, emissiveMap: bushTex, emissiveIntensity: 0.1,
      }), this._windStrength() * 0.72);
      const bushGeo = this._planeCross(2.0, 1.3, 2, 0);
      const mesh = this._instanced(bushGeo, bushMat, under.bush, () => {
        const c = new THREE.Color(1, 1, 1).multiplyScalar(0.7 + Math.random() * 0.45);
        c.offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.1, 0);
        return c;
      });
      if (mesh) {
        mesh.castShadow = false;
        scene.add(mesh);
      }
    }
  }

  _buildGroundDetail(scene, detail, quality) {
    const prof = this._scatterProfile();
    const rng = mulberry32(this.seed + 311);
    const A = this._treeAssets || (this._treeAssets = this._makeTreeAssets());
    if (detail.rock.length) {
      const geo = new THREE.DodecahedronGeometry(1, 0);
      geo.scale(1.25, 0.7, 1.0);
      const rockTex = makeRockTexture();
      const mat = new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.96, flatShading: true });
      const mesh = this._instanced(geo, mat, detail.rock, () => {
        const base = new THREE.Color(prof.rockColor || this.env.rock || 0x6e7064).lerp(new THREE.Color(0xffffff), 0.45);
        const c = base.multiplyScalar(0.8 + rng() * 0.35);
        c.offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.08, 0);
        return c;
      });
      if (mesh) {
        mesh.castShadow = quality === 'high';
        scene.add(mesh);
      }
    }
    if (detail.log.length) {
      const parts = [];
      const log = new THREE.CylinderGeometry(0.16, 0.28, 3.6, 7);
      log.rotateZ(Math.PI / 2);
      parts.push(log);
      const branch = new THREE.CylinderGeometry(0.07, 0.12, 1.2, 5);
      branch.rotateZ(0.9);
      branch.translate(0.6, 0.2, 0);
      parts.push(branch);
      const geo = mergeGeometries(parts);
      const mat = new THREE.MeshStandardMaterial({ map: makeBarkTexture('oak'), roughness: 1 });
      const mesh = this._instanced(geo, mat, detail.log, () => new THREE.Color(0.72 + rng() * 0.3, 0.7 + rng() * 0.26, 0.62 + rng() * 0.22));
      if (mesh) {
        mesh.castShadow = quality === 'high';
        scene.add(mesh);
      }
    }
    if (detail.stump.length) {
      const geo = new THREE.CylinderGeometry(0.32, 0.5, 0.8, 6);
      geo.translate(0, 0.4, 0);
      const mat = new THREE.MeshStandardMaterial({ map: makeBarkTexture('oak'), roughness: 1 });
      const mesh = this._instanced(geo, mat, detail.stump);
      if (mesh) scene.add(mesh);
    }
    if (detail.mound.length) {
      const geo = new THREE.ConeGeometry(0.9, 2.4, 6, 2);
      geo.translate(0, 1.2, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0xb06632, roughness: 1, flatShading: true });
      const mesh = this._instanced(geo, mat, detail.mound, () => {
        const c = new THREE.Color(0xb06632).offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.12);
        return c;
      });
      if (mesh) {
        mesh.castShadow = quality === 'high';
        scene.add(mesh);
      }
    }
  }

  _buildRocks(scene, rocks) {
    if (!rocks.length) return;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    geo.scale(1.2, 0.75, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: makeRockTexture(), color: 0xffffff, roughness: 0.96, flatShading: true,
    });
    const mesh = this._instanced(geo, mat, rocks, () => {
      const g = this.stage.biome === 'snow' ? 0x9aabb9
        : this.stage.biome === 'safari' ? 0x9a8367
          : this.stage.biome === 'japan' ? 0x74796b : 0x6e6f64;
      return new THREE.Color(g).offsetHSL(0, 0, (Math.random() - 0.5) * 0.16);
    });
    scene.add(mesh);
  }

  /* ============================================================
     ENDLESS STREAMING GEOMETRY
     ============================================================ */
  _initEndlessAssets(scene, quality) {
    this._scene = scene;
    this._endlessQuality = quality;
    this._sharedGeos = new WeakSet();
    const wet = clamp(this.env.wetness || 0, 0, 1);
    const terrainWet = clamp(this.env.wetness || 0, 0, 1);
    const terrainMat = new THREE.MeshStandardMaterial({
      map: makeGroundTexture(this.stage.biome),
      bumpMap: makeGroundBumpTexture(this.stage.biome),
      bumpScale: this.stage.biome === 'snow' ? 0.05 : 0.11,
      vertexColors: true,
      roughness: this.stage.biome === 'snow' ? 0.9 : 0.98 - terrainWet * 0.18,
      metalness: this.stage.biome === 'snow' ? 0.02 : 0,
    });
    const { map, bump, roughness, bumpScale } = makeRoadTexture(this.env.road);
    const roadMat = new THREE.MeshStandardMaterial({
      map, bumpMap: bump, bumpScale, metalness: 0.02, vertexColors: true,
    });
    roadMat.roughness = Math.max(0.16, roughness * (1 - wet * 0.62));
    roadMat.metalness = 0.02 + wet * 0.26;
    const shoulderSource = this.stage.biome === 'snow' ? makeRoadTexture('snow')
      : this.stage.biome === 'safari' ? makeRoadTexture('dirt')
        : makeRoadTexture('gravel');
    const shoulderMat = new THREE.MeshStandardMaterial({
      map: shoulderSource.map,
      bumpMap: shoulderSource.bump,
      bumpScale: this.stage.biome === 'snow' ? 0.05 : 0.09,
      roughness: this.stage.biome === 'snow' ? 0.92 : 0.98,
      color: this.stage.biome === 'snow'
        ? new THREE.Color(0xe3edf6)
        : new THREE.Color(this.env.dirt).lerp(new THREE.Color(0xffffff), 0.55),
    });
    const puddleMat = wet >= 0.25 ? new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.env.skyHorizon).lerp(new THREE.Color(0xffffff), 0.28),
      transparent: true,
      opacity: 0.07 + wet * 0.14,
      depthWrite: false,
    }) : null;
    const puddleGeo = new THREE.CircleGeometry(1, 14);
    const hazardGeo = new THREE.CircleGeometry(1, 18);
    this._sharedGeos.add(puddleGeo);
    this._sharedGeos.add(hazardGeo);
    const hazardMats = {};
    const colors = {
      water: 0x1d2c2b, mud: 0x1d2c2b, ice: 0xbfd8e4, wet: 0x27333a,
      moss: 0x35452b, sand: 0x9a7645, fesh: 0xa87b4a, ruts: 0x6e583a,
    };
    for (const h of this._hazardTable) {
      const glossy = h.type === 'ice' || h.type === 'wet' || h.type === 'moss';
      hazardMats[h.type] = new THREE.MeshStandardMaterial({
        color: colors[h.type] || 0x2f3a34,
        roughness: glossy ? 0.15 : 0.3,
        metalness: glossy ? 0.18 : 0.05,
        transparent: true,
        opacity: h.type === 'ice' ? 0.55 : glossy ? 0.42 : 0.55,
        depthWrite: false,
      });
    }
    this._assets = {
      terrainMat, roadMat, shoulderMat, puddleMat, puddleGeo, hazardGeo, hazardMats,
      snowBankMat: this.stage.biome === 'snow'
        ? new THREE.MeshStandardMaterial({ color: 0xeef4f9, roughness: 0.94 })
        : null,
    };
  }

  _buildEndlessSkyRidges(skyGroup) {
    const rng = mulberry32(this.seed + 90210);
    const parts = [];
    const count = 42;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.1;
      const r = 880 + rng() * 380;
      const h = 38 + rng() * 90 + Math.sin(i * 1.7) * 20;
      const w = 150 + rng() * 230;
      const g = new THREE.ConeGeometry(w, h, 5, 1);
      g.translate(0, h / 2, 0);
      g.rotateY(rng() * Math.PI * 2);
      g.translate(Math.cos(a) * r, -34, Math.sin(a) * r);
      parts.push(g);
    }
    const geo = mergeGeometries(parts);
    const col = new THREE.Color(this.env.hill).lerp(new THREE.Color(this.env.fog), 0.55);
    const mat = new THREE.MeshBasicMaterial({
      color: col, fog: false, transparent: true, opacity: 0.42, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -8;
    skyGroup.add(mesh);
  }

  _buildEndlessProps(scene) {
    this._scene = scene;
    this.gateColliders = [];
    this.startGateIndex = 9;
    this.finishGateIndex = null;
    this.startLightsTexture = makeStartLightsTexture();
    this._addGate(scene, 9, false);
    this._addFinishLine(scene, 9, false);
    this._addEndlessStartCrowd(scene);
  }

  _addEndlessStartCrowd(scene) {
    const rng = mulberry32(this.seed + 900);
    const people = [];
    for (const idx of [16, 24, 36]) {
      for (const side of [-1, 1]) {
        if (rng() < 0.28) continue;
        const s = this.samples[clamp(idx + Math.floor(rng() * 5), 0, this.n - 1)];
        const count = 2 + Math.floor(rng() * 4);
        for (let k = 0; k < count; k++) {
          const lat = side * (this.halfWidth + 7.2 + rng() * 4.5);
          const along = (rng() - 0.5) * 7;
          people.push({
            x: s.pos.x + s.right.x * lat + s.tangent.x * along,
            y: this.heightAtSample(s.i, lat),
            z: s.pos.z + s.right.z * lat + s.tangent.z * along,
            ry: rng() * Math.PI * 2,
            color: new THREE.Color(makeCrowdShirt((rng() * 7) | 0)),
            scale: 0.88 + rng() * 0.25,
          });
        }
      }
    }
    if (people.length) {
      const bodyGeo = new THREE.CylinderGeometry(0.2, 0.26, 0.95, 6);
      bodyGeo.translate(0, 0.75, 0);
      const headGeo = new THREE.SphereGeometry(0.15, 7, 6);
      headGeo.translate(0, 1.38, 0);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      const headMat = new THREE.MeshStandardMaterial({ color: 0xc8a084, roughness: 0.9 });
      const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, people.length);
      const headMesh = new THREE.InstancedMesh(headGeo, headMat, people.length);
      people.forEach((p, i) => {
        TMP.position.set(p.x, p.y, p.z);
        TMP.rotation.set(0, p.ry, 0);
        TMP.scale.setScalar(p.scale);
        TMP.updateMatrix();
        bodyMesh.setMatrixAt(i, TMP.matrix);
        headMesh.setMatrixAt(i, TMP.matrix);
        bodyMesh.setColorAt(i, p.color);
      });
      bodyMesh.instanceColor.needsUpdate = true;
      bodyMesh.castShadow = true;
      headMesh.castShadow = true;
      scene.add(bodyMesh, headMesh);
    }
    // a few parked spectator cars near the start
    const cars = [];
    const palette = [0xb33a2c, 0x2d5c8a, 0xd8c24a, 0x3b6b45, 0xd8d6cc, 0x7a3a72];
    for (const idx of [20, 31]) {
      const side = rng() < 0.5 ? 1 : -1;
      const s = this.samples[clamp(idx, 12, this.n - 14)];
      const n = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) {
        const lat = side * (this.halfWidth + 9.4 + k * 2.5 + rng() * 1.2);
        cars.push({
          x: s.pos.x + s.right.x * lat + (rng() - 0.5) * 3,
          y: this.heightAtSample(s.i, lat),
          z: s.pos.z + s.right.z * lat + (rng() - 0.5) * 3,
          rot: s.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.35,
          color: palette[(rng() * palette.length) | 0],
        });
      }
    }
    if (cars.length) {
      const bodyGeo = new THREE.BoxGeometry(1.65, 0.62, 3.7);
      bodyGeo.translate(0, 0.52, 0);
      const cabinGeo = new THREE.BoxGeometry(1.42, 0.55, 1.9);
      cabinGeo.translate(0, 1.06, -0.15);
      const geo = mergeGeometries([bodyGeo, cabinGeo]);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.25 });
      const mesh = new THREE.InstancedMesh(geo, mat, cars.length);
      cars.forEach((c, i) => {
        TMP.position.set(c.x, c.y, c.z);
        TMP.rotation.set(0, c.rot, 0);
        TMP.scale.setScalar(1);
        TMP.updateMatrix();
        mesh.setMatrixAt(i, TMP.matrix);
        mesh.setColorAt(i, new THREE.Color(c.color));
      });
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = this.quality === 'high';
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  _initEndlessScenery(scene, quality) {
    this._scene = scene;
    this._endlessQuality = quality;
    if (!this._sharedGeos) this._sharedGeos = new WeakSet();
    this._treeAssets = this._makeTreeAssets();
    for (const asset of Object.values(this._treeAssets)) {
      for (const key of ['trunkGeo', 'leafGeo', 'solidGeo']) {
        if (asset[key]) this._sharedGeos.add(asset[key]);
      }
    }
    const prof = this._scatterProfile();
    const biome = this.stage.biome;
    const mkUnder = (tex, w, h, color, planes = 2, alphaTest = 0.3) => ({
      geo: this._planeCross(w, h, planes, 0),
      mat: this._underMaterial(tex, color, alphaTest),
    });
    const fern = mkUnder(makeFernTexture(), 1.7, 1.3, prof.fernColor || 0x8fae54);
    const grass = mkUnder(makeGrassTexture(), 0.95, 1.05, prof.grassColor || 0x819b52);
    const flower = mkUnder(makeFlowerTexture(), 0.85, 0.95, 0xffffff);
    const reed = mkUnder(makeReedTexture(), 1.25, 1.7, prof.grassColor || 0x8b9b5a);
    const bush = mkUnder(makeCanopyTexture('oak', biome === 'snow'), 2.0, 1.3,
      prof.bushColor || 0x5a7444, 2, 0.28);
    this._underAssets = { fern, grass, flower, reed, bush };
    for (const a of Object.values(this._underAssets)) this._sharedGeos.add(a.geo);

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockGeo.scale(1.25, 0.7, 1.0);
    const rockMat = new THREE.MeshStandardMaterial({
      map: makeRockTexture(), roughness: 0.96, flatShading: true,
    });
    const logParts = [];
    const log = new THREE.CylinderGeometry(0.16, 0.28, 3.6, 7);
    log.rotateZ(Math.PI / 2);
    logParts.push(log);
    const branch = new THREE.CylinderGeometry(0.07, 0.12, 1.2, 5);
    branch.rotateZ(0.9);
    branch.translate(0.6, 0.2, 0);
    logParts.push(branch);
    const logGeo = mergeGeometries(logParts);
    const logMat = new THREE.MeshStandardMaterial({ map: makeBarkTexture('oak'), roughness: 1 });
    const stumpGeo = new THREE.CylinderGeometry(0.32, 0.5, 0.8, 6);
    stumpGeo.translate(0, 0.4, 0);
    const stumpMat = new THREE.MeshStandardMaterial({ map: makeBarkTexture('oak'), roughness: 1 });
    const moundGeo = new THREE.ConeGeometry(0.9, 2.4, 6, 2);
    moundGeo.translate(0, 1.2, 0);
    const moundMat = new THREE.MeshStandardMaterial({ color: 0xb06632, roughness: 1, flatShading: true });
    this._detailAssets = {
      rock: { geo: rockGeo, mat: rockMat },
      log: { geo: logGeo, mat: logMat },
      stump: { geo: stumpGeo, mat: stumpMat },
      mound: { geo: moundGeo, mat: moundMat },
    };
    for (const a of Object.values(this._detailAssets)) this._sharedGeos.add(a.geo);

    const postGeo = new THREE.BoxGeometry(0.075, 1, 0.075);
    const postMat = new THREE.MeshStandardMaterial({
      color: biome === 'snow' ? 0xe9eef4 : 0xe4e0d2, roughness: 0.8,
    });
    const capGeo = new THREE.BoxGeometry(0.085, biome === 'snow' ? 0.36 : 0.17, 0.085);
    const capMat = new THREE.MeshStandardMaterial({
      color: biome === 'snow' ? 0xd7432c : 0xd8402e, roughness: 0.65,
    });
    const warnTex = this._warningTexture();
    const warnMat = new THREE.MeshStandardMaterial({
      map: warnTex, transparent: true, alphaTest: 0.25, roughness: 0.8,
      side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: warnTex, emissiveIntensity: 0.22,
    });
    for (const g of [postGeo, capGeo]) this._sharedGeos.add(g);
    this._postAssets = { postGeo, postMat, capGeo, capMat, warnMat };
    this._buildEndlessChunks(true);
  }

  _buildEndlessChunks(initial = false) {
    if (!this._scene || !this._assets || !this._underAssets) return;
    const chunkSamples = Math.max(40, Math.round(this.chunkLength / this.step));
    let built = 0;
    while (this._nextChunkSample < this.n - 2) {
      const i0 = this._nextChunkSample;
      const i1 = Math.min(this.n - 1, i0 + chunkSamples);
      if (i1 - i0 < 16) break;
      if (!initial && i1 >= this.n - 4) break;
      this._createEndlessChunk(i0, i1);
      this._nextChunkSample = i1;
      built++;
      if (!initial && built >= 2) break;
    }
  }

  _createEndlessChunk(i0, i1) {
    const group = new THREE.Group();
    group.name = 'endless-chunk';
    this._addChunkTerrain(group, i0, i1);
    this._addChunkRoad(group, i0, i1);
    this._addChunkScenery(group, i0, i1);
    this._addChunkProps(group, i0, i1);
    this._scene.add(group);
    this.chunks.push({
      group, i0, i1,
      dist0: this.samples[i0].dist,
      dist1: this.samples[i1].dist,
    });
  }

  _disposeChunk(chunk) {
    if (!this._scene || !chunk) return;
    this._scene.remove(chunk.group);
    chunk.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry && !this._sharedGeos.has(obj.geometry)) {
        obj.geometry.dispose();
      }
    });
  }

  _addChunkTerrain(group, i0, i1) {
    const q = this._endlessQuality;
    const stride = q === 'high' ? 2 : q === 'medium' ? 3 : 4;
    const latStep = q === 'high' ? 3.4 : q === 'medium' ? 4.6 : 6.4;
    const span = q === 'high' ? 56 : q === 'medium' ? 50 : 42;
    const halfCols = Math.ceil(span / latStep);
    const cols = halfCols * 2 + 1;
    const rows = Math.floor((i1 - i0) / stride) + 1;
    const count = rows * cols;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const white = new THREE.Color(0xffffff);
    const dirt = new THREE.Color(this.env.dirt || 0x8a7c5e).lerp(white, 0.62);
    const dark = this.stage.biome === 'snow'
      ? new THREE.Color(0xccd8e6)
      : new THREE.Color(0xd2d6c4);
    const rock = new THREE.Color(this.env.rock || 0x6e7064).lerp(white, 0.48);
    const moss = new THREE.Color(this.env.moss || this.env.treeAlt || 0x6b7f3a).lerp(white, 0.5);
    const snowShade = new THREE.Color(0xc7d8e8);
    const tmpC = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      const idx = i0 + Math.min(r * stride, i1 - i0);
      const s = this.samples[idx];
      for (let c = 0; c < cols; c++) {
        const ci = r * cols + c;
        const lat = (c - halfCols) * latStep;
        const x = s.pos.x + s.right.x * lat;
        const z = s.pos.z + s.right.z * lat;
        let y = this.heightAtSample(idx, lat);
        const d = Math.abs(lat);
        if (d < this.halfWidth + 1.2) y = Math.min(y, s.pos.y - 0.09);
        positions[ci * 3] = x;
        positions[ci * 3 + 1] = y;
        positions[ci * 3 + 2] = z;
        uvs[ci * 2] = x * 0.075;
        uvs[ci * 2 + 1] = z * 0.075;
        const nearRoad = 1 - smoothstep(this.halfWidth + 0.7, this.halfWidth + (this.env.terrain?.edge || 6), d);
        const n = fbm(x * 0.06, z * 0.06, this.seed) * 0.5 + 0.5;
        const nFine = fbm(x * 0.23, z * 0.23, this.seed + 9) * 0.5 + 0.5;
        tmpC.setRGB(1, 1, 1).lerp(dark, n * 0.5);
        const rel = y - s.pos.y;
        const rockMix = clamp(
          smoothstep(1.2, 7.5, Math.abs(rel)) * (0.35 + nFine * 0.45) +
          (this.env.terrain?.style === 'mountain' ? smoothstep(0.5, 5, Math.abs(rel)) * 0.18 : 0),
          0, 0.72
        );
        tmpC.lerp(rock, rockMix);
        const mossMix = (1 - rockMix) * smoothstep(0.42, 0.82, fbm(x * 0.17, z * 0.17, this.seed + 21) * 0.5 + 0.5) * 0.34;
        tmpC.lerp(moss, mossMix);
        tmpC.lerp(dirt, nearRoad * 0.4);
        if (this.stage.biome === 'snow') {
          tmpC.lerp(snowShade, smoothstep(0.1, 3.0, Math.abs(rel)) * 0.2 + nearRoad * 0.1);
        }
        const shade = 0.9 + fbm(x * 0.13, z * 0.13, this.seed + 2) * 0.16;
        tmpC.multiplyScalar(shade);
        colors[ci * 3] = tmpC.r;
        colors[ci * 3 + 1] = tmpC.g;
        colors[ci * 3 + 2] = tmpC.b;
      }
    }
    const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const cc = a + cols;
        const dd = cc + 1;
        indices[k++] = a; indices[k++] = b; indices[k++] = cc;
        indices[k++] = b; indices[k++] = dd; indices[k++] = cc;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this._assets.terrainMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  _addChunkRoad(group, i0, i1) {
    const n = i1 - i0 + 1;
    if (n < 3) return;
    const A = this._assets;
    const lanes = [-1, -0.5, 0, 0.5, 1];
    const positions = new Float32Array(n * lanes.length * 3);
    const uvs = new Float32Array(n * lanes.length * 2);
    const colors = new Float32Array(n * lanes.length * 3);
    const edgeCol = new THREE.Color(0x786b54);
    const midCol = new THREE.Color(0xffffff);
    for (let j = 0; j < n; j++) {
      const s = this.samples[i0 + j];
      for (let l = 0; l < lanes.length; l++) {
        const idx = j * lanes.length + l;
        const lat = lanes[l] * this.halfWidth;
        const y = s.pos.y + this.roadYOffset + this.roadCrown(lat);
        positions[idx * 3] = s.pos.x + s.right.x * lat;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = s.pos.z + s.right.z * lat;
        uvs[idx * 2] = (lanes[l] + 1) / 2;
        uvs[idx * 2 + 1] = s.dist / 9.5;
        const c = midCol.clone().lerp(edgeCol, Math.pow(Math.abs(lanes[l]), 2) * 0.5);
        colors[idx * 3] = c.r; colors[idx * 3 + 1] = c.g; colors[idx * 3 + 2] = c.b;
      }
    }
    const indices = [];
    for (let j = 0; j < n - 1; j++) {
      for (let l = 0; l < lanes.length - 1; l++) {
        const a = j * lanes.length + l;
        const b = a + 1;
        const c = a + lanes.length;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, A.roadMat);
    mesh.receiveShadow = true;
    group.add(mesh);

    // shoulders
    for (const dir of [-1, 1]) {
      const lats = [0, 1.1, 2.6, 4.0];
      const posA = new Float32Array(n * lats.length * 3);
      const uvA = new Float32Array(n * lats.length * 2);
      for (let j = 0; j < n; j++) {
        const s = this.samples[i0 + j];
        for (let l = 0; l < lats.length; l++) {
          const idx = j * lats.length + l;
          const lat = dir * (this.halfWidth + lats[l]);
          const y = s.pos.y + this.roadYOffset - lats[l] * 0.09 +
            (l === 0 ? this.roadCrown(dir * this.halfWidth) : 0);
          posA[idx * 3] = s.pos.x + s.right.x * lat;
          posA[idx * 3 + 1] = y;
          posA[idx * 3 + 2] = s.pos.z + s.right.z * lat;
          uvA[idx * 2] = (s.pos.x + s.right.x * lat) * 0.16;
          uvA[idx * 2 + 1] = (s.pos.z + s.right.z * lat) * 0.16;
        }
      }
      const ind = [];
      for (let j = 0; j < n - 1; j++) {
        for (let l = 0; l < lats.length - 1; l++) {
          const a = j * lats.length + l;
          const b = a + 1;
          const c = a + lats.length;
          const d = c + 1;
          if (dir > 0) ind.push(a, b, c, b, d, c);
          else ind.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(posA, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
      g.setIndex(ind);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, A.shoulderMat);
      m.receiveShadow = true;
      group.add(m);
    }

    // snow banks
    if (A.snowBankMat) {
      for (const dir of [-1, 1]) {
        const lats = [0.0, 0.45, 0.95, 1.55];
        const lifts = [0.0, 0.2, 0.32, 0.1];
        const bPos = new Float32Array(n * lats.length * 3);
        for (let j = 0; j < n; j++) {
          const s = this.samples[i0 + j];
          for (let l = 0; l < lats.length; l++) {
            const idx = j * lats.length + l;
            const lat = dir * (this.halfWidth + lats[l]);
            bPos[idx * 3] = s.pos.x + s.right.x * lat;
            bPos[idx * 3 + 1] = s.pos.y + this.roadYOffset +
              this.roadCrown(dir * this.halfWidth) + lifts[l];
            bPos[idx * 3 + 2] = s.pos.z + s.right.z * lat;
          }
        }
        const ind = [];
        for (let j = 0; j < n - 1; j++) {
          for (let l = 0; l < lats.length - 1; l++) {
            const a = j * lats.length + l;
            const b = a + 1;
            const c = a + lats.length;
            const d = c + 1;
            if (dir > 0) ind.push(a, b, c, b, d, c);
            else ind.push(a, c, b, b, c, d);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
        g.setIndex(ind);
        g.computeVertexNormals();
        const bank = new THREE.Mesh(g, A.snowBankMat);
        bank.receiveShadow = true;
        group.add(bank);
      }
    }

    const rng = mulberry32(this.seed + i0 * 31 + 17);
    // shallow wet patches
    if (A.puddleMat) {
      for (let k = 0; k < 4; k++) {
        const idx = i0 + Math.floor(rng() * Math.max(1, n - 1));
        const s = this.samples[idx];
        const lat = (rng() - 0.5) * this.halfWidth * 1.5;
        const mesh = new THREE.Mesh(A.puddleGeo, A.puddleMat);
        mesh.position.set(
          s.pos.x + s.right.x * lat,
          s.pos.y + this.roadYOffset + 0.069,
          s.pos.z + s.right.z * lat
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = rng() * Math.PI;
        mesh.scale.set(0.8 + rng() * 2.6, 0.5 + rng() * 1.4, 1);
        group.add(mesh);
      }
    }
    // hazard surface patches
    for (const h of this.hazardPatches) {
      if (h.end < i0 || h.start > i1) continue;
      const mat = A.hazardMats[h.type];
      if (!mat) continue;
      const a = Math.max(h.start, i0);
      const b = Math.min(h.end, i1);
      for (let k = 0; k < 3; k++) {
        const idx = clamp(a + Math.floor(rng() * Math.max(1, b - a)), 0, this.n - 1);
        const s = this.samples[idx];
        const lat = (rng() - 0.5) * this.halfWidth * 1.25;
        const mesh = new THREE.Mesh(A.hazardGeo, mat);
        mesh.position.set(
          s.pos.x + s.right.x * lat,
          s.pos.y + this.roadYOffset + 0.068,
          s.pos.z + s.right.z * lat
        );
        mesh.scale.set(1.2 + rng() * 2.4, 0.65 + rng() * 0.7, 1);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = rng() * Math.PI;
        group.add(mesh);
      }
    }
  }

  _addChunkScenery(group, i0, i1) {
    if (!this._treeAssets || !this._underAssets) return;
    const q = this._endlessQuality;
    const rng = mulberry32(this.seed + i0 * 7919 + 23);
    const collected = this._collectScenery(i0, i1, q, this.seed + i0 * 7919 + 23);
    for (const [type, items] of Object.entries(collected.trees)) {
      this._addTreeSet(group, items, type, rng, q);
    }
    for (const kind of Object.keys(this._underAssets)) {
      this._addUnderSet(group, collected.under[kind], this._underAssets[kind], rng);
    }
    const prof = this._scatterProfile();
    for (const [kind, items] of Object.entries(collected.detail)) {
      const asset = this._detailAssets[kind];
      if (!asset || !items.length) continue;
      const mesh = this._instanced(asset.geo, asset.mat, items, () => {
        let base = 0x8a8a82;
        if (kind === 'rock') base = new THREE.Color(prof.rockColor || this.env.rock || 0x6e7064).lerp(new THREE.Color(0xffffff), 0.45);
        else if (kind === 'log' || kind === 'stump') base = prof.litter || 0x6b4e2c;
        else if (kind === 'mound') base = 0xb06632;
        const c = new THREE.Color(base).multiplyScalar(0.72 + rng() * 0.45);
        c.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.1, 0);
        return c;
      });
      if (mesh) {
        mesh.castShadow = q === 'high';
        group.add(mesh);
      }
    }
  }

  _addUnderSet(parent, items, asset, rng) {
    if (!asset || !items || !items.length) return;
    const mesh = this._instanced(asset.geo, asset.mat, items, () => {
      const c = new THREE.Color(1, 1, 1).multiplyScalar(0.7 + rng() * 0.46);
      c.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1);
      return c;
    });
    if (!mesh) return;
    mesh.castShadow = false;
    parent.add(mesh);
  }

  _addChunkProps(group, i0, i1) {
    const q = this._endlessQuality;
    const P = this._postAssets;
    if (!P) return;
    const stride = q === 'high' ? 8 : 11;
    const isSnow = this.stage.biome === 'snow';
    const postTransforms = [];
    const capTransforms = [];
    for (let i = Math.max(12, i0 + 1); i < Math.min(this.n - 12, i1); i += stride) {
      const s = this.samples[i];
      for (const side of [-1, 1]) {
        const lat = side * (this.halfWidth + 1.15);
        const y = this.surfaceHeight(i, lat);
        const h = isSnow ? 1.65 : 0.85;
        postTransforms.push({
          x: s.pos.x + s.right.x * lat, y: y + h / 2, z: s.pos.z + s.right.z * lat,
          ry: s.heading, sy: h,
        });
        capTransforms.push({
          x: s.pos.x + s.right.x * lat, y: y + h - 0.1, z: s.pos.z + s.right.z * lat,
          ry: s.heading, sy: 1,
        });
        if (!isSnow) {
          capTransforms.push({
            x: s.pos.x + s.right.x * lat, y: y + h * 0.72, z: s.pos.z + s.right.z * lat,
            ry: s.heading, sy: 0.4, sxz: 0.8,
          });
        }
      }
    }
    if (postTransforms.length) {
      const mesh = new THREE.InstancedMesh(P.postGeo, P.postMat, postTransforms.length);
      postTransforms.forEach((t, i) => {
        TMP.position.set(t.x, t.y, t.z);
        TMP.rotation.set(0, t.ry, 0);
        TMP.scale.set(1, t.sy, 1);
        TMP.updateMatrix();
        mesh.setMatrixAt(i, TMP.matrix);
      });
      mesh.castShadow = q === 'high';
      group.add(mesh);
      const caps = new THREE.InstancedMesh(P.capGeo, P.capMat, capTransforms.length);
      capTransforms.forEach((t, i) => {
        TMP.position.set(t.x, t.y, t.z);
        TMP.rotation.set(0, t.ry, 0);
        TMP.scale.set(t.sxz || 1, t.sy, t.sxz || 1);
        TMP.updateMatrix();
        caps.setMatrixAt(i, TMP.matrix);
      });
      group.add(caps);
    }
    // warning boards at the start of each hazard section
    const rng = mulberry32(this.seed + i0 * 43 + 5);
    for (const h of this.hazardPatches) {
      if (h.start < i0 || h.start >= i1) continue;
      for (const side of [-1, 1]) {
        if (rng() < 0.32) continue;
        const i = clamp(h.start - 2, 6, this.n - 8);
        const s = this.samples[i];
        const lat = side * (this.halfWidth + 1.9);
        const y = this.surfaceHeight(i, lat);
        const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), P.warnMat);
        warn.position.set(s.pos.x + s.right.x * lat, y + 0.9, s.pos.z + s.right.z * lat);
        warn.rotation.y = s.heading + Math.PI / 2;
        group.add(warn);
      }
    }
  }

  updateStartLights(count) {
    if (!this.startLightsTexture) return;
    drawStartLights(this.startLightsTexture, count);
  }

  dispose(scene) {
    if (!scene) return;
    // scene children are disposed by the game
  }
}

function setSnowColor(mat, biome) {
  if (biome === 'snow') mat.color.setHex(0x71806f);
}

function qualityStars(quality) {
  return quality === 'high' ? 1500 : quality === 'medium' ? 900 : 520;
}
