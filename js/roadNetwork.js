/* ============================================================
   PROCEDURAL SIDE-ROAD NETWORK
   The endless generator builds one main route. This module grows
   side roads from that route: forks that wander into the scenery,
   rejoin the main road later, or dead-end in a turnaround. Every
   road is a real drivable ribbon with its own surface query.
   ============================================================ */

import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32 } from './util.js';
import { makeRoadTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Object3D();
const SIDE_STEP = 2.2;

function wrapHeading(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* Find the main-road sample nearest a world position, searching only a
   window (branch generation is always anchored to known indices). */
function nearestMain(track, x, z, from, to) {
  let best = clamp(from, 0, track.n - 1);
  let bestD = Infinity;
  for (let i = clamp(from, 0, track.n - 1); i <= clamp(to, 0, track.n - 1); i++) {
    const s = track.samples[i];
    const dx = x - s.pos.x;
    const dz = z - s.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  const s = track.samples[best];
  const lateral = (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z;
  return { index: best, lateral };
}

function mainTerrainY(track, x, z, from, to) {
  const near = nearestMain(track, x, z, from, to);
  return track.heightAtSample(near.index, near.lateral);
}

class SideRoad {
  constructor(id, samples, halfWidth, surface, track, opts = {}) {
    this.id = id;
    this.samples = samples;
    this.halfWidth = halfWidth;
    this.surface = surface;
    this.joined = !!opts.joined;
    const dists = samples.map((s) => s.mainDist);
    this.dist0 = Math.min(...dists);
    this.dist1 = Math.max(...dists);
    this.built = false;
    this.group = null;
    this.material = null;
    this.ownsMaterial = false;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    this.grip = surface === 'asphalt'
      ? (track.stage.baseGrip || 0.9) * 1.01
      : (track.stage.baseGrip || 0.85) * 0.86;
    this.surfaceName = surface === 'asphalt'
      ? 'SIDE ROAD ASPHALT'
      : surface === 'snow' ? 'PACKED SNOW SIDE ROAD' : 'SIDE ROAD GRAVEL';
  }

  crown(lateral) {
    const u = clamp(Math.abs(lateral) / this.halfWidth, 0, 1);
    return 0.045 * (1 - u * u) + 0.008;
  }

  nearest(pos) {
    const b = this.bounds;
    if (pos.x < b.minX - 4 || pos.x > b.maxX + 4 ||
        pos.z < b.minZ - 4 || pos.z > b.maxZ + 4) {
      return null;
    }
    const samples = this.samples;
    let bestD = Infinity;
    let bestI = 0;
    let bestT = 0;
    // Coarse scan, then refine around the winner.
    for (let i = 0; i < samples.length - 1; i += 2) {
      const a = samples[i].pos;
      const c = samples[Math.min(samples.length - 1, i + 2)].pos;
      const ex = c.x - a.x, ez = c.z - a.z;
      const el2 = ex * ex + ez * ez || 1;
      const t = clamp(((pos.x - a.x) * ex + (pos.z - a.z) * ez) / el2, 0, 1);
      const px = a.x + ex * t, pz = a.z + ez * t;
      const dx = pos.x - px, dz = pos.z - pz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; bestT = t; }
    }
    for (let i = Math.max(0, bestI - 3); i <= Math.min(samples.length - 2, bestI + 4); i++) {
      const a = samples[i].pos;
      const c = samples[i + 1].pos;
      const ex = c.x - a.x, ez = c.z - a.z;
      const el2 = ex * ex + ez * ez || 1;
      const t = clamp(((pos.x - a.x) * ex + (pos.z - a.z) * ez) / el2, 0, 1);
      const px = a.x + ex * t, pz = a.z + ez * t;
      const dx = pos.x - px, dz = pos.z - pz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; bestT = t; }
    }
    const a = samples[bestI];
    const c = samples[Math.min(samples.length - 1, bestI + 1)];
    const center = new THREE.Vector3(
      a.pos.x + (c.pos.x - a.pos.x) * bestT,
      a.pos.y + (c.pos.y - a.pos.y) * bestT,
      a.pos.z + (c.pos.z - a.pos.z) * bestT
    );
    const tangent = new THREE.Vector3().lerpVectors(a.tangent, c.tangent, bestT).normalize();
    const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const lateral = (pos.x - center.x) * right.x + (pos.z - center.z) * right.z;
    const absLat = Math.abs(lateral);
    return {
      road: this, index: bestI, center, tangent, right, lateral, absLat,
      distance: Math.sqrt(bestD),
      height: center.y + this.crown(lateral),
      grip: this.grip * (absLat > this.halfWidth + 0.6 ? 0.66 : 1),
      surface: absLat > this.halfWidth + 0.6 ? 'offroad' : this.surface,
      surfaceName: absLat > this.halfWidth + 0.6 ? 'VERGE' : this.surfaceName,
      offRoad: absLat > this.halfWidth + 0.6,
      heading: Math.atan2(tangent.x, tangent.z),
      mainDist: a.mainDist + (c.mainDist - a.mainDist) * bestT,
    };
  }
}

export class RoadNetwork {
  constructor(track) {
    this.track = track;
    this.rng = mulberry32((track.seed >>> 0) + 0x51de);
    this.visualRng = mulberry32((track.seed >>> 0) + 0x9e37);
    this.roads = [];
    this.nextJunctionDist = 150 + this.rng() * 90;
    this.scene = null;
    this.materialCache = new Map();
    this.sharedGeos = new WeakSet();
    this.lastPlayerDist = 0;
    this._nextId = 1;
  }

  attach(scene) {
    if (!scene || scene === this.scene) return;
    this.scene = scene;
  }

  dispose() {
    if (!this.scene) return;
    for (const road of this.roads) this._disposeRoad(road);
    this.roads.length = 0;
    this.scene = null;
  }

  generateAvailable(maxDist) {
    const track = this.track;
    const limit = Math.min(maxDist, track.length - 30);
    let guard = 0;
    while (this.nextJunctionDist < limit && guard++ < 30) {
      const mainIdx = this._indexForDist(this.nextJunctionDist);
      if (mainIdx == null) break;
      this._growJunction(mainIdx);
      this.nextJunctionDist += 155 + this.rng() * 220;
    }
  }

  _indexForDist(dist) {
    const track = this.track;
    // The sample history is sorted, so a short local walk is enough.
    let lo = 0, hi = track.n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (track.samples[mid].dist < dist) lo = mid + 1;
      else hi = mid;
    }
    return clamp(lo, 12, track.n - 24);
  }

  _growJunction(mainIdx) {
    const track = this.track;
    const rng = this.rng;
    const twoWay = rng() < 0.34;
    const sides = twoWay ? [-1, 1] : [rng() < 0.5 ? -1 : 1];
    for (const side of sides) {
      // A couple of shapes are tried per side. Branches that would cut through
      // the main road, clip another side road, or fold back over themselves
      // are discarded instead of being drawn as overlapping ribbons.
      for (let attempt = 0; attempt < 3; attempt++) {
        const joined = rng() < 0.6;
        const spanM = joined ? 130 + rng() * 260 : 80 + rng() * 190;
        const endIdx = clamp(
          mainIdx + Math.round(spanM / track.step),
          mainIdx + 18,
          Math.min(track.n - 16, mainIdx + Math.round(430 / track.step))
        );
        const road = this._makeBranch(mainIdx, endIdx, side, joined, rng);
        if (road) {
          this.roads.push(road);
          break;
        }
      }
    }
  }

  _makeBranch(mainIdx, endIdx, side, joined, rng) {
    const track = this.track;
    const start = track.samples[mainIdx];
    const end = track.samples[endIdx];
    const halfWidth = 3.0 + rng() * 1.1;
    const surface = this._sideSurface();
    // Centre the branch so its inner edge overlaps the main carriageway by a
    // small amount. The junction apron below fills the flare between the two
    // surfaces, so the entry can stay shallow instead of cutting in at a hard
    // angle.
    const edgeOffset = track.halfWidth + halfWidth * 0.35;
    const startPoint = new THREE.Vector3(
      start.pos.x + start.right.x * side * edgeOffset,
      start.pos.y,
      start.pos.z + start.right.z * side * edgeOffset
    );
    const out = 24 + rng() * 54;
    const points = [startPoint];
    points.push(new THREE.Vector3(
      startPoint.x + start.right.x * side * (4 + rng() * 5) + start.tangent.x * (18 + rng() * 8),
      start.pos.y,
      startPoint.z + start.right.z * side * (4 + rng() * 5) + start.tangent.z * (18 + rng() * 8)
    ));
    const midX = (start.pos.x + end.pos.x) * 0.5 +
      start.right.x * side * out + start.tangent.x * (joined ? 0 : 20);
    const midZ = (start.pos.z + end.pos.z) * 0.5 +
      start.right.z * side * out + start.tangent.z * (joined ? 0 : 20);
    points.push(new THREE.Vector3(midX, (start.pos.y + end.pos.y) * 0.5, midZ));
    let endPoint = null;
    if (joined) {
      endPoint = new THREE.Vector3(
        end.pos.x + end.right.x * side * edgeOffset,
        end.pos.y,
        end.pos.z + end.right.z * side * edgeOffset
      );
      points.push(new THREE.Vector3(
        endPoint.x + end.right.x * side * (4 + rng() * 5) - end.tangent.x * (18 + rng() * 8),
        end.pos.y,
        endPoint.z + end.right.z * side * (4 + rng() * 5) - end.tangent.z * (18 + rng() * 8)
      ));
      points.push(endPoint);
    } else {
      const twist = (rng() - 0.5) * 0.9;
      points.push(new THREE.Vector3(
        midX + start.right.x * side * (12 + rng() * 28) + start.tangent.x * (26 + rng() * 40) - start.right.x * twist * 18,
        (start.pos.y + end.pos.y) * 0.5,
        midZ + start.right.z * side * (12 + rng() * 28) + start.tangent.z * (26 + rng() * 40) - start.right.z * twist * 18
      ));
      points.push(new THREE.Vector3(
        midX + start.right.x * side * (8 + rng() * 22) + start.tangent.x * (52 + rng() * 64),
        start.pos.y,
        midZ + start.right.z * side * (8 + rng() * 22) + start.tangent.z * (52 + rng() * 64)
      ));
    }
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.36);
    const length = curve.getLength();
    if (length < 55) return null;
    const count = Math.max(12, Math.ceil(length / SIDE_STEP));
    const raw = curve.getSpacedPoints(count - 1);
    const from = Math.max(0, mainIdx - 10);
    const to = Math.min(track.n - 1, endIdx + 10);
    const samples = [];
    let prevHeading = null;
    for (let k = 0; k < raw.length; k++) {
      const p = raw[k];
      const a = raw[Math.max(0, k - 1)];
      const b = raw[Math.min(raw.length - 1, k + 1)];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const heading = Math.atan2(tx, tz);
      const near = nearestMain(track, p.x, p.z, from, to);
      const y = mainTerrainY(track, p.x, p.z, from, to);
      samples.push({
        pos: new THREE.Vector3(p.x, y, p.z),
        heading,
        prevHeading,
        tangent: new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)),
        mainIndex: near.index,
        mainDist: track.samples[near.index].dist,
      });
      prevHeading = heading;
    }
    // Smooth the deck and keep it within a drivable grade.
    for (let pass = 0; pass < 4; pass++) {
      for (let k = 1; k < samples.length - 1; k++) {
        samples[k].pos.y = samples[k].pos.y * 0.5 +
          (samples[k - 1].pos.y + samples[k + 1].pos.y) * 0.25;
      }
    }
    const maxGrade = 0.19;
    let minY = samples[0].pos.y;
    for (let k = 1; k < samples.length; k++) {
      const step = samples[k].pos.distanceTo(samples[k - 1].pos) || SIDE_STEP;
      samples[k].pos.y = clamp(samples[k].pos.y, minY - step * maxGrade, minY + step * maxGrade);
      minY = samples[k].pos.y;
    }
    // Raise the deck above the terrain across its width.
    const w = halfWidth * 0.92;
    for (const s of samples) {
      const rx = Math.cos(s.heading);
      const rz = -Math.sin(s.heading);
      const yc = mainTerrainY(track, s.pos.x, s.pos.z, from, to);
      const yl = mainTerrainY(track, s.pos.x + rx * w, s.pos.z + rz * w, from, to);
      const yr = mainTerrainY(track, s.pos.x - rx * w, s.pos.z - rz * w, from, to);
      s.pos.y = Math.max(s.pos.y, yc, yl, yr) + 0.025;
    }
    // Blend both junctions into the main road surface.
    const startY = start.pos.y + track.roadYOffset + track.roadCrown(track.halfWidth);
    for (let k = 0; k < samples.length; k++) {
      const t = k / (samples.length - 1);
      const lipStart = 1 - smoothstep(0.0, 0.13, t);
      if (lipStart > 0.001) samples[k].pos.y = samples[k].pos.y * (1 - lipStart) + (startY + 0.01) * lipStart;
      if (endPoint) {
        const endY = end.pos.y + track.roadYOffset + track.roadCrown(track.halfWidth);
        const lipEnd = smoothstep(0.87, 1.0, t);
        if (lipEnd > 0.001) samples[k].pos.y = samples[k].pos.y * (1 - lipEnd) + (endY + 0.01) * lipEnd;
      }
    }
    if (!this._branchIsClear(samples, halfWidth, mainIdx, endIdx)) return null;
    return new SideRoad(this._nextId++, samples, halfWidth, surface, track, { joined });
  }

  /** Reject branches that run through the main road, through another side
   *  road, or fold back over themselves. Junction ends are exempt only for the
   *  short flare where the branch meets the main carriageway. */
  _branchIsClear(samples, halfWidth, mainIdx, endIdx) {
    const track = this.track;
    const n = samples.length;
    if (n < 14) return false;
    const entrySkip = Math.max(3, Math.ceil((track.halfWidth + halfWidth + 4) / SIDE_STEP));
    const from = Math.max(0, mainIdx - 10);
    const to = Math.min(track.n - 1, endIdx + Math.round(220 / track.step));
    for (let k = entrySkip; k < n - entrySkip; k++) {
      const p = samples[k].pos;
      const near = nearestMain(track, p.x, p.z, from, to);
      if (Math.abs(near.lateral) < track.halfWidth + halfWidth + 1.0) return false;
      for (const road of this.roads) {
        const b = road.bounds;
        if (p.x < b.minX - 8 || p.x > b.maxX + 8 ||
            p.z < b.minZ - 8 || p.z > b.maxZ + 8) continue;
        const hit = road.nearest(p);
        if (hit && hit.distance < road.halfWidth + halfWidth + 1.1) return false;
      }
      for (let j = k + 12; j < n; j++) {
        const dx = p.x - samples[j].pos.x;
        const dz = p.z - samples[j].pos.z;
        if (dx * dx + dz * dz < (halfWidth * 2 + 1.2) ** 2) return false;
      }
    }
    return true;
  }

  _sideSurface() {
    const road = this.track.stage.env.road;
    if (road === 'asphalt' || road === 'tarmac' || road === 'broken') return 'asphalt';
    if (road === 'snow') return 'snow';
    return 'gravel';
  }

  update(playerDist) {
    this.lastPlayerDist = playerDist;
    if (!this.scene) return;
    for (let i = this.roads.length - 1; i >= 0; i--) {
      const road = this.roads[i];
      const near = playerDist > road.dist0 - 260 && playerDist < road.dist1 + 300;
      if (near && !road.built) this._buildRoad(road);
      if (road.built && playerDist > road.dist1 + 340) this._disposeRoad(road);
      // Drop generated topology once it is far behind. The endless run can go
      // on forever without accumulating every side road ever created.
      if (playerDist > road.dist1 + 1400) this.roads.splice(i, 1);
    }
  }

  _material(surface) {
    if (this.materialCache.has(surface)) return this.materialCache.get(surface);
    const track = this.track;
    const mainRoad = track.stage.env.road;
    let mat;
    if (surface === 'snow') {
      const src = makeRoadTexture('snow');
      mat = new THREE.MeshStandardMaterial({ map: src.map, bumpMap: src.bump, bumpScale: src.bump, roughness: 0.9 });
    } else if (surface === 'asphalt' && track._assets?.roadMat) {
      // Reuse the main asphalt material: same trip, same texture, no extra memory.
      mat = track._assets.roadMat;
    } else if (surface === 'asphalt') {
      const src = makeRoadTexture(mainRoad === 'broken' ? 'broken' : 'asphalt');
      mat = new THREE.MeshStandardMaterial({ map: src.map, bumpMap: src.bump, bumpScale: src.bump, roughness: src.roughness, metalness: 0.02 });
    } else {
      const src = makeRoadTexture('gravel');
      mat = new THREE.MeshStandardMaterial({ map: src.map, bumpMap: src.bump, bumpScale: 0.08, roughness: 0.98 });
    }
    this.materialCache.set(surface, mat);
    return mat;
  }

  /** Work out which edge of a branch faces the main carriageway and which
   *  main-road sample it joins. Used by both the apron and the post layout. */
  _junctionEndInfo(road, atStart) {
    const track = this.track;
    const samples = road.samples;
    const s = samples[atStart ? 0 : samples.length - 1];
    const hint = s.mainIndex != null ? s.mainIndex : 0;
    const from = Math.max(0, hint - 32);
    const to = Math.min(track.n - 1, hint + 32);
    const near = nearestMain(track, s.pos.x, s.pos.z, from, to);
    const ms = track.samples[near.index];
    const side = Math.sign(near.lateral) || 1;
    // Direction from the branch centre back toward the main centreline.
    const inwardX = -ms.right.x * side;
    const inwardZ = -ms.right.z * side;
    const branchRightX = -s.tangent.z;
    const branchRightZ = s.tangent.x;
    const innerSign = (branchRightX * inwardX + branchRightZ * inwardZ) >= 0 ? 1 : -1;
    return { mainIndex: near.index, side, innerSign, sample: s };
  }

  /** A road-coloured apron that fills the flare between a branch and the main
   *  carriageway. The apron overlaps the main road by a couple of centimetres
   *  and tapers back to the branch width, so there is no open wedge or seam at
   *  the junction. */
  _buildJunction(road, group) {
    const track = this.track;
    const samples = road.samples;
    if (samples.length < 4) return;
    const rows = Math.min(samples.length, Math.ceil(24 / SIDE_STEP) + 2);
    const cols = 9;
    const ends = [{ atStart: true }];
    if (road.joined) ends.push({ atStart: false });
    for (const end of ends) {
      const info = this._junctionEndInfo(road, end.atStart);
      if (end.atStart) road.startInnerSign = info.innerSign;
      else road.endInnerSign = info.innerSign;
      const ms = info.sample;
      const mainFrom = Math.max(0, info.mainIndex - 36);
      const mainTo = Math.min(track.n - 1, info.mainIndex + 36);
      const positions = new Float32Array(rows * cols * 3);
      const colors = new Float32Array(rows * cols * 3);
      const uvs = new Float32Array(rows * cols * 2);
      const order = [];
      for (let r = 0; r < rows; r++) {
        const idx = end.atStart ? Math.min(samples.length - 1, r) : Math.max(0, samples.length - 1 - r);
        order.push(idx);
      }
      for (let r = 0; r < rows; r++) {
        const s = samples[order[r]];
        const junctionT = r / Math.max(1, rows - 1);
        const flare = 1 - smoothstep(0, 1, junctionT);
        const innerEdge = info.innerSign *
          (road.halfWidth + flare * (track.halfWidth + road.halfWidth + 3.5));
        const outerEdge = -info.innerSign * road.halfWidth;
        const right = new THREE.Vector3(-s.tangent.z, 0, s.tangent.x).normalize();
        for (let c = 0; c < cols; c++) {
          const u = c / (cols - 1);
          const lat = lerp(innerEdge, outerEdge, u);
          const x = s.pos.x + right.x * lat;
          const z = s.pos.z + right.z * lat;
          const baseY = s.pos.y + road.crown(lat);
          const nearMain = nearestMain(track, x, z, mainFrom, mainTo);
          const mainSample = track.samples[nearMain.index];
          const mainAbs = Math.abs(nearMain.lateral);
          let y = baseY;
          if (mainAbs < track.halfWidth + 1.0) {
            const mainY = mainSample.pos.y + track.roadYOffset +
              track.roadCrown(nearMain.lateral) + 0.018;
            // Keep the apron tied to the main crown where it overlaps the
            // carriageway, then blend back to the branch deck at the lip.
            const mainW = smoothstep(track.halfWidth + 0.8, track.halfWidth * 0.25, mainAbs);
            y = lerp(baseY, mainY, mainW);
          }
          y += 0.004;
          const vi = (r * cols + c) * 3;
          positions[vi] = x;
          positions[vi + 1] = y;
          positions[vi + 2] = z;
          colors[vi] = 1;
          colors[vi + 1] = 1;
          colors[vi + 2] = 1;
          const ui = (r * cols + c) * 2;
          uvs[ui] = u;
          uvs[ui + 1] = (s.mainDist || 0) / 8.5;
        }
      }
      const indices = [];
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          const b = a + 1;
          const d = a + cols;
          const e = d + 1;
          // End aprons are built from the junction backwards along the branch,
          // so their row direction is reversed. Flip the winding to keep the
          // surface facing up instead of disappearing as a backface.
          if (end.atStart) indices.push(a, b, d, b, e, d);
          else indices.push(a, d, b, b, d, e);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this._material(road.surface));
      mesh.name = 'junction-apron-' + road.id + (end.atStart ? '-start' : '-end');
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      group.add(mesh);
    }
  }

  _buildRoad(road) {
    const track = this.track;
    if (!this.scene) return;
    const group = new THREE.Group();
    group.name = 'side-road-' + road.id;
    const mat = this._material(road.surface);
    const samples = road.samples;
    const n = samples.length;
    const lanes = [-1, -0.5, 0, 0.5, 1];
    const pos = new Float32Array(n * lanes.length * 3);
    const uv = new Float32Array(n * lanes.length * 2);
    const col = new Float32Array(n * lanes.length * 3);
    const edgeCol = new THREE.Color(0x7b7160);
    const midCol = new THREE.Color(0xffffff);
    let travelled = 0;
    for (let j = 0; j < n; j++) {
      const s = samples[j];
      if (j > 0) travelled += s.pos.distanceTo(samples[j - 1].pos);
      const right = new THREE.Vector3(-s.tangent.z, 0, s.tangent.x).normalize();
      s.right = right;
      for (let l = 0; l < lanes.length; l++) {
        const idx = j * lanes.length + l;
        const lat = lanes[l] * road.halfWidth;
        pos[idx * 3] = s.pos.x + right.x * lat;
        pos[idx * 3 + 1] = s.pos.y + road.crown(lat);
        pos[idx * 3 + 2] = s.pos.z + right.z * lat;
        uv[idx * 2] = (lanes[l] + 1) * 0.5;
        uv[idx * 2 + 1] = travelled / 8.5;
        const c = midCol.clone().lerp(edgeCol, Math.pow(Math.abs(lanes[l]), 2) * 0.45);
        col[idx * 3] = c.r; col[idx * 3 + 1] = c.g; col[idx * 3 + 2] = c.b;
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
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);

    // Soft shoulders make the ribbon sit into the terrain instead of floating.
    for (const dir of [-1, 1]) {
      const lats = [0, 1.0, 2.2, 3.8];
      const sp = new Float32Array(n * lats.length * 3);
      const suv = new Float32Array(n * lats.length * 2);
      for (let j = 0; j < n; j++) {
        const s = samples[j];
        for (let l = 0; l < lats.length; l++) {
          const idx = j * lats.length + l;
          const lat = dir * (road.halfWidth + lats[l]);
          const x = s.pos.x + s.right.x * lat;
          const z = s.pos.z + s.right.z * lat;
          const edgeY = s.pos.y + road.crown(dir * road.halfWidth) - (l === 0 ? 0 : 0.035);
          let y = edgeY;
          if (l > 0) {
            const ms = track.samples[s.mainIndex];
            const latMain = (x - ms.pos.x) * ms.right.x + (z - ms.pos.z) * ms.right.z;
            const groundY = track.heightAtSample(s.mainIndex, latMain) + 0.015;
            const t = Math.pow(l / (lats.length - 1), 0.72);
            y = lerp(edgeY, groundY, t);
          }
          sp[idx * 3] = x;
          sp[idx * 3 + 1] = y;
          sp[idx * 3 + 2] = z;
          suv[idx * 2] = x * 0.14;
          suv[idx * 2 + 1] = z * 0.14;
        }
      }
      const si = [];
      for (let j = 0; j < n - 1; j++) {
        for (let l = 0; l < lats.length - 1; l++) {
          const a = j * lats.length + l;
          const b = a + 1;
          const c = a + lats.length;
          const d = c + 1;
          if (dir > 0) si.push(a, b, c, b, d, c);
          else si.push(a, c, b, b, c, d);
        }
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      sg.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
      sg.setIndex(si);
      sg.computeVertexNormals();
      const shoulder = new THREE.Mesh(sg, track._assets?.shoulderMat || mat);
      shoulder.receiveShadow = true;
      group.add(shoulder);
    }
    // Junction aprons close the wedge between the main carriageway and the
    // branch before the marker posts are placed.
    this._buildJunction(road, group);
    // Marker posts give side roads a legible edge at speed.
    const P = track._postAssets;
    if (P) {
      this.sharedGeos.add(P.postGeo);
      const items = [];
      const junctionSkip = Math.ceil(18 / SIDE_STEP);
      for (let j = 4; j < n - 4; j += 6) {
        const s = samples[j];
        for (const side of [-1, 1]) {
          // Do not plant the inner-side posts on the junction flare.
          if (road.startInnerSign && side === road.startInnerSign && j < junctionSkip) continue;
          if (road.endInnerSign && side === road.endInnerSign && n - 1 - j < junctionSkip) continue;
          if (this.visualRng() < 0.2) continue;
          const lat = side * (road.halfWidth + 0.9);
          items.push({
            x: s.pos.x + s.right.x * lat,
            y: s.pos.y + 0.4,
            z: s.pos.z + s.right.z * lat,
            rot: s.heading,
            scale: 0.8,
          });
        }
      }
      if (items.length) {
        const posts = new THREE.InstancedMesh(P.postGeo, P.postMat, items.length);
        items.forEach((t, i) => {
          TMP.position.set(t.x, t.y, t.z);
          TMP.rotation.set(0, t.rot, 0);
          TMP.scale.set(1, 0.8, 1);
          TMP.updateMatrix();
          posts.setMatrixAt(i, TMP.matrix);
        });
        posts.castShadow = false;
        group.add(posts);
      }
    }
    this.scene.add(group);
    road.group = group;
    road.material = mat;
    road.built = true;
  }

  _disposeRoad(road) {
    if (!road.built || !road.group) return;
    if (this.scene) this.scene.remove(road.group);
    road.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry &&
          !this.sharedGeos.has(obj.geometry) &&
          !(this.track._sharedGeos && this.track._sharedGeos.has(obj.geometry))) {
        obj.geometry.dispose();
      }
    });
    road.group = null;
    road.built = false;
    // Materials are shared by surface type and live until the stage ends.
  }

  nearest(pos) {
    let best = null;
    for (const road of this.roads) {
      if (pos.x < road.bounds.minX - 3 || pos.x > road.bounds.maxX + 3 ||
          pos.z < road.bounds.minZ - 3 || pos.z > road.bounds.maxZ + 3) continue;
      const hit = road.nearest(pos);
      if (!hit) continue;
      if (!best || hit.distance < best.distance) best = hit;
    }
    return best;
  }

  isNearRoad(x, z, pad = 4) {
    for (const road of this.roads) {
      if (x < road.bounds.minX - pad || x > road.bounds.maxX + pad ||
          z < road.bounds.minZ - pad || z > road.bounds.maxZ + pad) continue;
      const hit = road.nearest(new THREE.Vector3(x, 0, z));
      if (hit && hit.absLat <= road.halfWidth + pad) return true;
    }
    return false;
  }

  debug() {
    return {
      roads: this.roads.length,
      built: this.roads.filter((r) => r.built).length,
      nextJunction: this.nextJunctionDist,
    };
  }
}
