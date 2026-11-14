import * as THREE from 'three';

export const PI2 = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function wrapAngle(a) {
  while (a > Math.PI) a -= PI2;
  while (a < -Math.PI) a += PI2;
  return a;
}
export function sign(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* deterministic 2D value noise */
export function hash2(x, y, seed = 0) {
  let h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
export function fbm(x, y, seed = 0) {
  return noise2(x, y, seed) * 0.62 + noise2(x * 2.03, y * 2.03, seed + 11) * 0.26 +
    noise2(x * 4.11, y * 4.11, seed + 23) * 0.12;
}

export function formatTime(sec, decimals = 2) {
  if (sec == null || !isFinite(sec)) return '--:--.--';
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(decimals).padStart(decimals + 3, '0')}`;
}

export function formatDelta(sec) {
  if (sec == null || !isFinite(sec)) return '--';
  const s = Math.abs(sec);
  const signChar = sec < 0 ? '−' : '+';
  return `${signChar}${s.toFixed(2)}`;
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/* merge indexed / non-indexed BufferGeometries, preserving position/normal/uv */
export function mergeGeometries(geos) {
  const prepped = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const attrs = {};
  for (const g of prepped) {
    for (const name of Object.keys(g.attributes)) {
      if (!attrs[name]) attrs[name] = [];
      attrs[name].push(g.attributes[name]);
    }
  }
  const merged = new THREE.BufferGeometry();
  for (const [name, list] of Object.entries(attrs)) {
    const itemSize = list[0].itemSize;
    let total = 0;
    for (const a of list) total += a.count * a.itemSize;
    const arr = new Float32Array(total);
    let off = 0;
    for (const a of list) {
      arr.set(a.array, off);
      off += a.array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  prepped.forEach((g, i) => { if (g !== geos[i]) g.dispose(); });
  return merged;
}

/* merge only with a color attribute (used for scenery) */
export function mergeColored(parts) {
  const geos = [];
  for (const { geometry, color } of parts) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
  }
  return mergeGeometries(geos);
}

export function disposeObject(root, disposeTextures = true) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
    for (const mat of mats) {
      if (!mat) continue;
      if (disposeTextures) {
        for (const key of Object.keys(mat)) {
          const v = mat[key];
          if (v && v.isTexture) v.dispose();
        }
        if (mat.map) mat.map.dispose();
      }
      mat.dispose();
    }
  });
}

export function makeCanvasTexture(canvas, { srgb = true, repeat = false, anisotropy = 4 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function canvas2D(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

/* beam / cylinder between two points (roll cage etc.) */
export function beamMesh(a, b, radius, material, radialSegments = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, radialSegments, 1);
  geo.translate(0, len / 2, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

export function seedRandom(seed) {
  return mulberry32(seed);
}
