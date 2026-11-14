import * as THREE from 'three';
import {
  clamp, lerp, smoothstep, wrapAngle, sign, mulberry32, fbm, nextFrame,
  mergeGeometries, makeCanvasTexture, canvas2D, beamMesh,
} from './util.js';
import {
  makeRoadTexture, makeGroundTexture, makeSunTexture, makeBannerTexture,
  makeStartLightsTexture, drawStartLights, makeFernTexture, makeGrassTexture,
  makeCrowdShirt, makeCloudTexture, makeSkidTexture,
} from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Object3D();

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
    this.halfWidth = stage.width / 2;
    this.roadYOffset = 0.055;
    this.length = 0;
    this.lastIndexHint = 0;
    this.skyTime = 0;
    this.flash = 0;
    this.timeOfDay = this.env.defaultTime || 'day';

    this._buildSamples();
    this._buildHazards();
    this._buildPacenotes();
    this._buildMapProjection();
    this._buildGripProfiles();
  }

  /* ---------------- sampling ---------------- */
  _buildSamples() {
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

  /* ---------------- hazards ---------------- */
  _buildHazards() {
    const rng = mulberry32(this.seed * 13 + 7);
    const table = {
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
    }[this.stage.biome];
    this.hazardTable = table;
    const minI = 45, maxI = this.n - 60;
    const count = this.stage.biome === 'jungle' ? 7 : 5;
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

  heightAtSample(index, lateral) {
    const s = this.samples[clamp(index, 0, this.n - 1)];
    const absLat = Math.abs(lateral);
    const d = Math.max(0, absLat - this.halfWidth);
    if (d < 0.45) return s.pos.y - 0.09;
    const wx = s.pos.x + s.right.x * lateral;
    const wz = s.pos.z + s.right.z * lateral;
    const n1 = fbm(wx * 0.041, wz * 0.041, this.seed);
    const n2 = fbm(wx * 0.012, wz * 0.012, this.seed + 15);
    const slope = this.sideSlope[s.i];
    const dip = smoothstep(0.45, 2.0, d) * -0.16;
    const lift = smoothstep(1.4, 15, d) * (0.28 + n1 * 1.15 + Math.abs(slope) * d * 0.045);
    const far = smoothstep(20, 70, d) * (n2 * 3.2 + 0.9);
    return s.pos.y - 0.15 + dip + lift + far;
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
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.55, h));
          col = mix(bottomColor, col, smoothstep(-0.18, 0.02, h));
          float glow = pow(max(dot(normalize(vDir), normalize(vec3(glowDir.x, 0.02, glowDir.z))), 0.0), 3.0);
          glow *= smoothstep(-0.03, 0.05, h) * (1.0 - smoothstep(0.02, 0.3, h));
          col += glowColor * glow * glowStrength * 0.55;
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

    scene.add(skyGroup);
    this.skyGroup = skyGroup;
    this.sunDir = sunDir;

    this.hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiIntensity);
    scene.add(this.hemi);
    this.baseHemiIntensity = env.hemiIntensity;

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
    const dirt = new THREE.Color(this.env.dirt);
    const ground = new THREE.Color(this.env.ground);
    const dark = new THREE.Color(this.env.groundDark);
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
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = z;
        uvs[idx * 2] = x * 0.075;
        uvs[idx * 2 + 1] = z * 0.075;

        const nearRoad = 1 - smoothstep(this.halfWidth + 1, this.halfWidth + 7.5, d);
        const n = fbm(x * 0.06, z * 0.06, this.seed) * 0.5 + 0.5;
        tmpC.copy(ground).lerp(dark, n * 0.55);
        tmpC.lerp(dirt, nearRoad * 0.8);
        const shade = 0.82 + fbm(x * 0.13, z * 0.13, this.seed + 2) * 0.16;
        tmpC.multiplyScalar(shade);
        colors[idx * 3] = tmpC.r;
        colors[idx * 3 + 1] = tmpC.g;
        colors[idx * 3 + 2] = tmpC.b;
      }
      if (r % 24 === 0) await nextFrame();
    }
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
    const mat = new THREE.MeshStandardMaterial({
      map: tex, vertexColors: true, roughness: this.stage.biome === 'snow' ? 0.92 : 0.98,
      metalness: 0,
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
    const shoulderMat = new THREE.MeshStandardMaterial({
      map: makeGroundTexture(this.stage.biome), roughness: 1,
      color: this.stage.biome === 'snow' ? 0xdbe6ef : 0x8a7c5e,
    });
    for (const dir of [-1, 1]) {
      const lats = [0, 1, 2.2];
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
          uvA[idx * 2] = s.pos.x * 0.15 + s.pos.z * 0.15;
          uvA[idx * 2 + 1] = s.dist * 0.16;
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
    this._addCrowd(scene, quality);
    this._addRoadside(scene, quality);
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
      if (h.type !== 'water' && h.type !== 'mud' && h.type !== 'ice') continue;
      const rng = mulberry32(this.seed + h.start);
      const s = this.samples[h.start];
      const isIce = h.type === 'ice';
      const mat = new THREE.MeshStandardMaterial({
        color: isIce ? 0xbfd8e4 : 0x1d2c2b,
        roughness: isIce ? 0.15 : 0.07,
        metalness: isIce ? 0.05 : 0.25,
        transparent: true,
        opacity: isIce ? 0.55 : 0.78,
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
    const transforms = [];
    const capTransforms = [];
    const isSnow = this.stage.biome === 'snow';
    for (let i = 12; i < this.n - 12; i += stride) {
      const s = this.samples[i];
      for (const side of [-1, 1]) {
        const lat = side * (this.halfWidth + 1.15);
        const y = this.surfaceHeight(i, lat);
        const h = isSnow ? 1.65 : 0.85;
        transforms.push({
          x: s.pos.x + s.right.x * lat,
          y: y + h / 2,
          z: s.pos.z + s.right.z * lat,
          ry: s.heading,
          sx: 1, sy: h, sz: 1,
        });
        capTransforms.push({
          x: s.pos.x + s.right.x * lat,
          y: y + h - 0.1,
          z: s.pos.z + s.right.z * lat,
          ry: s.heading,
          sx: 1, sy: 1, sz: 1,
        });
        if (!isSnow) {
          // small reflector
          capTransforms.push({
            x: s.pos.x + s.right.x * lat,
            y: y + h * 0.72,
            z: s.pos.z + s.right.z * lat,
            ry: s.heading, sx: 0.8, sy: 0.4, sz: 0.8,
          });
        }
      }
    }
    const postGeo = new THREE.BoxGeometry(0.075, 1, 0.075);
    const postMat = new THREE.MeshStandardMaterial({
      color: isSnow ? 0xe9eef4 : 0xe4e0d2, roughness: 0.8,
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

    const capGeo = new THREE.BoxGeometry(0.085, isSnow ? 0.36 : 0.17, 0.085);
    const capMat = new THREE.MeshStandardMaterial({
      color: isSnow ? 0xd7432c : 0xd8402e, roughness: 0.65,
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

    /* telegraph poles + sagging wire (forest) */
    if (biome === 'forest') {
      const poles = [];
      let side = rng() < 0.5 ? 1 : -1;
      for (let i = 26; i < this.n - 30; i += isHigh ? 30 : 38) {
        side *= -1;
        const s = this.samples[i];
        const lat = side * (this.halfWidth + 4.6 + rng() * 1.4);
        poles.push({
          x: s.pos.x + s.right.x * lat,
          y: this.heightAtSample(i, lat),
          z: s.pos.z + s.right.z * lat,
          rot: s.heading,
        });
      }
      if (poles.length) {
        const parts = [];
        const poleGeo = new THREE.CylinderGeometry(0.1, 0.155, 7.0, 6);
        poleGeo.translate(0, 3.5, 0);
        parts.push(poleGeo);
        const bar = new THREE.BoxGeometry(1.45, 0.08, 0.09);
        bar.translate(0, 6.5, 0);
        parts.push(bar);
        for (const dx of [-0.55, 0.55]) {
          const ins = new THREE.CylinderGeometry(0.045, 0.06, 0.16, 5);
          ins.translate(dx, 6.62, 0);
          parts.push(ins);
        }
        const geo = mergeGeometries(parts);
        const mat = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.95 });
        const mesh = new THREE.InstancedMesh(geo, mat, poles.length);
        poles.forEach((p, i) => {
          TMP.position.set(p.x, p.y, p.z);
          TMP.rotation.set(0, p.rot, 0);
          TMP.scale.setScalar(1);
          TMP.updateMatrix();
          mesh.setMatrixAt(i, TMP.matrix);
        });
        mesh.castShadow = isHigh;
        scene.add(mesh);

        if (isHigh) {
          const wirePts = [];
          for (let i = 0; i < poles.length - 1; i++) {
            const a = poles[i];
            const b = poles[i + 1];
            const off = 0.55 * (i % 2 ? 1 : -1);
            const ax = a.x + Math.cos(a.rot) * off;
            const az = a.z - Math.sin(a.rot) * off;
            const bx = b.x + Math.cos(b.rot) * off;
            const bz = b.z - Math.sin(b.rot) * off;
            const ay = a.y + 6.62;
            const by = b.y + 6.62;
            for (let k = 0; k < 6; k++) {
              const t = k / 6;
              const sag = Math.sin(t * Math.PI) * 0.55;
              wirePts.push(
                ax + (bx - ax) * t,
                ay + (by - ay) * t - sag,
                az + (bz - az) * t
              );
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
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const baseY = Math.min(...this.samples.map((s) => s.pos.y)) - 26;
    const diag = Math.hypot(maxX - minX, maxZ - minZ);
    const radius = diag * 0.75 + 680;
    const rng = mulberry32(this.seed + 90210);
    const parts = [];
    const count = 40;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.12;
      const r = radius * (0.82 + rng() * 0.32);
      const h = 32 + rng() * 62 + Math.sin(i * 1.7) * 16;
      const w = 120 + rng() * 190;
      const g = new THREE.ConeGeometry(w, h, 5, 1);
      g.translate(0, h / 2, 0);
      g.rotateY(rng() * Math.PI * 2);
      g.translate(cx + Math.cos(a) * r, baseY, cz + Math.sin(a) * r);
      parts.push(g);
    }
    const geo = mergeGeometries(parts);
    const col = new THREE.Color(this.env.hill).lerp(new THREE.Color(this.env.fog), 0.9);
    const mat = new THREE.MeshBasicMaterial({ color: col, fog: false, transparent: true, opacity: 0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -8;
    this.ridgeMesh = mesh;
    scene.add(mesh);
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
    const biome = this.stage.biome;
    const rng = mulberry32(this.seed + 1991);
    const isHigh = quality === 'high';
    const stride = isHigh ? 2 : quality === 'medium' ? 3 : 5;
    const cap = isHigh ? 2400 : quality === 'medium' ? 1500 : 800;
    const spots = { pine: [], birch: [], palm: [], broad: [], rock: [] };
    const under = { fern: [], grass: [], bush: [] };

    const place = (index, lat, scale, rot) => {
      const s = this.samples[clamp(index, 0, this.n - 1)];
      const x = s.pos.x + s.right.x * lat;
      const z = s.pos.z + s.right.z * lat;
      const y = this.heightAtSample(index, lat);
      return { x, y, z, scale, rot, index };
    };

    for (let i = 6; i < this.n - 6; i += stride) {
      for (const side of [-1, 1]) {
        if (rng() < 0.23) continue;
        const lat = side * (this.halfWidth + 8.2 + Math.pow(rng(), 1.25) * 40);
        const scale = 0.75 + rng() * 0.85;
        const rot = rng() * Math.PI * 2;
        const p = place(i, lat, scale, rot);
        let type;
        if (biome === 'forest') type = rng() < 0.62 ? 'pine' : 'birch';
        else if (biome === 'jungle') type = rng() < 0.42 ? 'palm' : 'broad';
        else type = rng() < 0.68 ? 'pine' : 'birch';
        if (spots[type].length < cap) spots[type].push(p);
        // occasional companion
        if (rng() < 0.32 && spots[type].length < cap) {
          const lat2 = lat + side * (2.4 + rng() * 10) * (rng() > 0.5 ? 1 : -1);
          const p2 = place(i + ((rng() * 4) | 0), lat2, 0.65 + rng() * 0.9, rng() * Math.PI * 2);
          spots[type].push(p2);
        }
        if (rng() < 0.08 && spots.rock.length < 150) {
          const latR = side * (this.halfWidth + 4 + rng() * 26);
          const pR = place(i, latR, 0.4 + rng() * 1.5, rng() * Math.PI * 2);
          spots.rock.push(pR);
        }
      }
      // understory near edge
      if (rng() < 0.75) {
        const side = rng() < 0.5 ? -1 : 1;
        const lat = side * (this.halfWidth + 2.8 + rng() * 7.5);
        const p = place(i + ((rng() * 3) | 0), lat, 0.55 + rng() * 0.85, rng() * Math.PI * 2);
        if (biome === 'jungle') (rng() < 0.7 ? under.fern : under.grass).push(p);
        else if (biome === 'forest') (rng() < 0.5 ? under.fern : under.grass).push(p);
        else if (rng() < 0.35) under.bush.push(p);
      }
    }
    // reeds / dense ferns in jungle
    if (biome === 'jungle') {
      for (let i = 10; i < this.n - 10; i += 2) {
        if (rng() < 0.7) {
          const side = rng() < 0.5 ? -1 : 1;
          const p = place(i, side * (this.halfWidth + 3 + rng() * 9), 0.8 + rng() * 1.2, rng() * 6.28);
          under.fern.push(p);
        }
      }
    }

    this._buildTreeMeshes(scene, spots, quality);
    this._buildUnderstory(scene, under, quality);
    this._buildRocks(scene, spots.rock);
    this.treeCount = spots.pine.length + spots.birch.length + spots.palm.length + spots.broad.length;
  }

  _instanced(geo, mat, items, colorFn = null) {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((t, i) => {
      TMP.position.set(t.x, t.y, t.z);
      TMP.rotation.set(0, t.rot || 0, 0);
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

  _buildTreeMeshes(scene, spots, quality) {
    const env = this.env;
    const rng = mulberry32(this.seed + 77);
    const trunkMat = new THREE.MeshStandardMaterial({ color: env.trunk, roughness: 1, flatShading: true });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xf3f7fb, roughness: 0.82, flatShading: true });
    const birchTrunkMat = new THREE.MeshStandardMaterial({ color: 0xd6d1c4, roughness: 0.95, flatShading: true });

    // ---- pine geometry
    const trunkParts = [];
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.17, 2.7, 7);
    trunkGeo.translate(0, 1.35, 0);
    trunkParts.push(trunkGeo);
    const pineTrunk = mergeGeometries(trunkParts);
    const foliageParts = [];
    const layers = [
      { r: 1.55, h: 2.7, y: 2.5 },
      { r: 1.16, h: 2.35, y: 3.6 },
      { r: 0.72, h: 2.0, y: 4.55 },
    ];
    for (const L of layers) {
      const g = new THREE.ConeGeometry(L.r, L.h, 8, 1);
      g.translate(0, L.y + L.h * 0.5, 0);
      foliageParts.push(g);
    }
    const pineFoliage = mergeGeometries(foliageParts);
    const capParts = [];
    for (const L of layers) {
      const g = new THREE.ConeGeometry(L.r * 0.92, L.h * 0.34, 8, 1);
      g.translate(0, L.y + L.h * 0.52, 0);
      capParts.push(g);
    }
    const pineCaps = mergeGeometries(capParts);

    // ---- birch / broadleaf geometry
    const birchTrunkParts = [];
    const bt = new THREE.CylinderGeometry(0.07, 0.13, 3.6, 6);
    bt.translate(0, 1.8, 0);
    birchTrunkParts.push(bt);
    for (let i = 0; i < 2; i++) {
      const ang = i === 0 ? 0.7 : 3.6;
      const branch = new THREE.CylinderGeometry(0.03, 0.055, 1.5, 4);
      branch.rotateZ(0.55);
      branch.rotateY(ang);
      branch.translate(0.2, 3.0, 0);
      birchTrunkParts.push(branch);
    }
    const birchTrunk = mergeGeometries(birchTrunkParts);
    const leafParts = [];
    const blobs = [
      { r: 1.25, x: 0, y: 4.0, z: 0 },
      { r: 0.92, x: 0.75, y: 4.8, z: 0.25 },
      { r: 0.82, x: -0.65, y: 4.6, z: -0.3 },
      { r: 0.66, x: 0.1, y: 5.35, z: 0.5 },
    ];
    for (const b of blobs) {
      const g = new THREE.IcosahedronGeometry(b.r, 0);
      g.translate(b.x, b.y, b.z);
      leafParts.push(g);
    }
    const birchLeaves = mergeGeometries(leafParts);

    // ---- palm geometry
    const palmTrunkParts = [];
    const segs = 4;
    let last = new THREE.Vector3(0, 0, 0);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const next = new THREE.Vector3(Math.sin(t * 1.3) * 0.5, t * 4.9, Math.cos(t * 1.1) * 0.25);
      const dir = new THREE.Vector3().subVectors(next, last);
      const g = new THREE.CylinderGeometry(0.11 * (1 - t * 0.35), 0.15 * (1 - t * 0.3), dir.length(), 6);
      g.translate(0, dir.length() / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
      g.translate(last.x, last.y, last.z);
      palmTrunkParts.push(g);
      last = next;
    }
    const palmTrunk = mergeGeometries(palmTrunkParts);
    const frondParts = [];
    const frondCount = 10;
    for (let i = 0; i < frondCount; i++) {
      const g = new THREE.ConeGeometry(0.34, 3.2, 3, 1);
      g.scale(1, 1, 0.16);
      g.translate(0, 1.6, 0);
      g.rotateX(-1.05 + (i % 2) * 0.35);
      g.rotateY((i / frondCount) * Math.PI * 2 + rng() * 0.4);
      g.translate(last.x, last.y, last.z);
      frondParts.push(g);
    }
    const palmFronds = mergeGeometries(frondParts);

    // broadleaf larger blobs
    const broadTrunkParts = [];
    const btr = new THREE.CylinderGeometry(0.14, 0.24, 4.2, 7);
    btr.translate(0, 2.1, 0);
    broadTrunkParts.push(btr);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.CylinderGeometry(0.05, 0.09, 2.0, 4);
      g.rotateZ(0.85);
      g.rotateY(i * 2.1);
      g.translate(0, 4.0, 0);
      broadTrunkParts.push(g);
    }
    const broadTrunk = mergeGeometries(broadTrunkParts);
    const broadLeafParts = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.IcosahedronGeometry(1.2 + (i % 3) * 0.35, 0);
      g.scale(1.2, 0.7, 1.2);
      g.translate(
        (rng() - 0.5) * 3.2,
        4.6 + (rng() - 0.5) * 1.6,
        (rng() - 0.5) * 3.2
      );
      broadLeafParts.push(g);
    }
    const broadLeaves = mergeGeometries(broadLeafParts);

    const baseFoliageColor = new THREE.Color(env.tree);
    const altFoliageColor = new THREE.Color(env.treeAlt);
    const snow = this.stage.biome === 'snow';

    const addTreeSet = (items, trunkGeo, foliageGeo, trunkMat, optionalCaps = null) => {
      if (!items.length) return;
      const trunk = this._instanced(trunkGeo, trunkMat, items);
      const leaf = this._instanced(foliageGeo, foliageMat, items, () => {
        const c = baseFoliageColor.clone().lerp(altFoliageColor, 0.15 + rng() * 0.7);
        c.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.09);
        return c;
      });
      scene.add(trunk, leaf);
      if (optionalCaps && items.length) {
        const caps = this._instanced(optionalCaps, snowCapMat, items);
        scene.add(caps);
      }
    };

    addTreeSet(spots.pine, pineTrunk, pineFoliage, trunkMat,
      snow ? pineCaps : null);
    addTreeSet(spots.birch, birchTrunk,
      snow ? mergeGeometries([new THREE.IcosahedronGeometry(0.3, 0)]) : birchLeaves,
      snow ? birchTrunkMat : trunkMat);
    if (!snow) {
      addTreeSet(spots.palm, palmTrunk, palmFronds, trunkMat);
      addTreeSet(spots.broad, broadTrunk, broadLeaves, trunkMat);
    } else {
      // bare broadleaf in snow (trunk only)
      addTreeSet(spots.broad, broadTrunk, mergeGeometries([new THREE.IcosahedronGeometry(0.15, 0)]), birchTrunkMat);
    }
  }

  _buildUnderstory(scene, under, quality) {
    const fernTex = makeFernTexture();
    const grassTex = makeGrassTexture();
    const crossPlane = (w, h, count = 2) => {
      const parts = [];
      for (let i = 0; i < count; i++) {
        const g = new THREE.PlaneGeometry(w, h);
        g.rotateY((i / count) * Math.PI);
        g.translate(0, h / 2, 0);
        parts.push(g);
      }
      return mergeGeometries(parts);
    };
    const makeUnder = (items, tex, w, h, color) => {
      if (!items.length) return;
      const mat = new THREE.MeshStandardMaterial({
        map: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide,
        roughness: 0.95, color,
      });
      const geo = crossPlane(w, h, 2);
      const mesh = this._instanced(geo, mat, items, () => new THREE.Color().setHSL(
        0.25, 0.25, 0.4 + Math.random() * 0.2
      ));
      mesh.castShadow = false;
      scene.add(mesh);
    };
    makeUnder(under.fern, fernTex, 1.5, 1.1, this.stage.biome === 'jungle' ? 0x7ea257 : 0x7c9b58);
    makeUnder(under.grass, grassTex, 0.85, 0.85, this.stage.biome === 'snow' ? 0xb8c8c2 : 0x94a86a);
    if (under.bush.length) {
      const bushGeo = new THREE.IcosahedronGeometry(0.8, 0);
      bushGeo.scale(1.2, 0.6, 1.2);
      const bushMat = new THREE.MeshStandardMaterial({ color: 0x5f7550, roughness: 1, flatShading: true });
      const bush = this._instanced(bushGeo, bushMat, under.bush, () =>
        new THREE.Color(0x6e8460).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
      setSnowColor(bushMat, this.stage.biome);
      scene.add(bush);
    }
  }

  _buildRocks(scene, rocks) {
    if (!rocks.length) return;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    geo.scale(1.2, 0.75, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, flatShading: true });
    const mesh = this._instanced(geo, mat, rocks, () => {
      const g = this.stage.biome === 'snow' ? 0x9aabb9 : 0x6e6f64;
      return new THREE.Color(g).offsetHSL(0, 0, (Math.random() - 0.5) * 0.16);
    });
    scene.add(mesh);
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
