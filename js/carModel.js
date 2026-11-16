import * as THREE from 'three';
import { makeCanvasTexture, beamMesh, mergeGeometries } from './util.js';
import { makeSideDecal, makeHoodDecal, makeGrimeTexture } from './textures.js';

/* ============================================================
   Helpers
   ============================================================ */
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function sphere(parent, r, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  parent.add(m);
  return m;
}

function cylinder(parent, r1, r2, h, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function quad(points, mat, uvs = null) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(points.length * 3);
  points.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const uv = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
  const flat = [];
  uv.forEach(([u, v]) => flat.push(u, v));
  if (points.length === 4) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(
      [uv[0][0], uv[0][1], uv[1][0], uv[1][1], uv[2][0], uv[2][1],
       uv[0][0], uv[0][1], uv[2][0], uv[2][1], uv[3][0], uv[3][1]], 2
    ));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  return m;
}

function makeScreen(canvas, w, h, mountPos, tiltX = -0.34, bezel = true) {
  // Draw the trip computer at its native resolution, then upload a half-size
  // copy. The screen occupies a few centimetres of the cockpit; the full-size
  // texture upload was pure cost and caused visible render hitches.
  const display = document.createElement('canvas');
  display.width = Math.max(2, Math.round(canvas.width * 0.5));
  display.height = Math.max(2, Math.round(canvas.height * 0.5));
  const displayCtx = display.getContext('2d');
  displayCtx.imageSmoothingEnabled = true;
  const tex = new THREE.CanvasTexture(display);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const present = () => {
    displayCtx.clearRect(0, 0, display.width, display.height);
    displayCtx.drawImage(canvas, 0, 0, display.width, display.height);
    tex.needsUpdate = true;
  };
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mount = new THREE.Group();
  mount.position.copy(mountPos);
  mount.rotation.y = Math.PI;
  const tilt = new THREE.Group();
  tilt.rotation.x = tiltX;
  mount.add(tilt);
  if (bezel) {
    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0b, roughness: 0.45, metalness: 0.3 });
    box(tilt, w + 0.028, h + 0.028, 0.018, bezelMat, 0, 0, -0.011);
  }
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  plane.position.z = 0.002;
  tilt.add(plane);
  // thin glass sheen
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0xbcd7e4, transparent: true, opacity: 0.045, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
  gl.position.z = 0.004;
  tilt.add(gl);
  return { mount, tilt, plane, tex, mat, canvas, display, present, w, h };
}

/* ============================================================
   Static mesh consolidation
   The car is assembled from hundreds of small box/cylinder meshes.
   They look right, but each one is a draw call (and another one in
   the shadow pass). Baking all non-animated parts into one mesh per
   material keeps the exact geometry while cutting the car from ~235
   draws down to a handful.
   ============================================================ */
function mergeStaticCarMeshes(root, skipRoots) {
  if (!root) return;
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const skipped = (mesh) => {
    let p = mesh.parent;
    while (p && p !== root) {
      if (skipRoots.has(p)) return true;
      p = p.parent;
    }
    return false;
  };
  for (const mesh of meshes) {
    if (mesh === root || skipped(mesh)) continue;
    if (!mesh.geometry || !mesh.material || Array.isArray(mesh.material)) continue;
    const rel = new THREE.Matrix4().multiplyMatrices(invRoot, mesh.matrixWorld);
    let geo = mesh.geometry.clone();
    geo.applyMatrix4(rel);
    if (geo.index) geo = geo.toNonIndexed();
    const attrKey = Object.keys(geo.attributes).sort().join(',');
    const key = mesh.material.uuid + '|' + attrKey;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mesh.material, items: [] };
      buckets.set(key, bucket);
    }
    bucket.items.push({ mesh, geo });
  }
  for (const bucket of buckets.values()) {
    // Single-part buckets are cheaper left alone; merging one geometry just
    // creates a second copy for no draw-call saving.
    if (bucket.items.length < 2) {
      for (const item of bucket.items) item.geo.dispose();
      continue;
    }
    const merged = mergeGeometries(bucket.items.map((x) => x.geo));
    for (const item of bucket.items) {
      item.geo.dispose();
      if (item.mesh.parent) item.mesh.parent.remove(item.mesh);
    }
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = 'car-static';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

/* ============================================================
   Main factory
   ============================================================ */
export function createCarModel(car, options = {}) {
  const { withInterior = true, menu = false } = options;
  const group = new THREE.Group();
  group.name = 'car:' + car.id;
  const exteriorBits = [];
  const st = car.style;
  const L = st.length;
  const W = st.width;
  const roof = st.roof;
  const wheelbase = L * 0.56;
  const wheelR = 0.335;
  const wheelZ = wheelbase / 2;
  const archR = 0.455;
  const halfW = W / 2;

  /* ---------------- materials ---------------- */
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: car.color, metalness: 0.28, roughness: 0.3,
    clearcoat: 0.9, clearcoatRoughness: 0.16,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: car.accent, metalness: 0.18, roughness: 0.42,
  });
  const accent2Mat = new THREE.MeshStandardMaterial({
    color: car.accent2, metalness: 0.12, roughness: 0.5,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x151716, roughness: 0.62, metalness: 0.22 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0d, roughness: 0.86 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xb7b9b6, metalness: 0.9, roughness: 0.22 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x273437, metalness: 0.4, roughness: 0.06,
    transparent: true, opacity: 0.27, side: THREE.DoubleSide,
    depthWrite: false,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cf, emissive: 0xffe2a0, emissiveIntensity: 1.2, roughness: 0.2,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x9c1714, emissive: 0x8c110d, emissiveIntensity: 0.9, roughness: 0.35,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x101111, roughness: 0.94 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xa9aaa5, metalness: 0.8, roughness: 0.3 });
  const rimDark = new THREE.MeshStandardMaterial({ color: 0x303231, metalness: 0.4, roughness: 0.5 });

  /* ---------------- body shell ---------------- */
  const shape = new THREE.Shape();
  const bottomY = 0.34;
  shape.moveTo(-L / 2, bottomY);
  // rear wheel arch
  shape.lineTo(-wheelZ - archR, bottomY);
  for (let a = Math.PI; a >= 0; a -= Math.PI / 9) {
    shape.lineTo(-wheelZ + Math.cos(a) * archR, bottomY + Math.sin(a) * archR);
  }
  // front wheel arch
  shape.lineTo(wheelZ - archR, bottomY);
  for (let a = Math.PI; a >= 0; a -= Math.PI / 9) {
    shape.lineTo(wheelZ + Math.cos(a) * archR, bottomY + Math.sin(a) * archR);
  }
  shape.lineTo(L / 2 - 0.08, bottomY);
  shape.lineTo(L / 2, 0.56);
  shape.lineTo(L / 2 - 0.06, 0.7);
  shape.lineTo(L / 2 - 0.62, 0.82);
  shape.lineTo(st.cabinFront, 0.91);
  shape.lineTo(st.roofFront, roof);
  shape.lineTo(st.roofRear, roof);
  shape.lineTo(st.cabinRear, 0.93);
  shape.lineTo(-L / 2 + 0.16, 0.82);
  shape.lineTo(-L / 2 + 0.02, 0.6);
  shape.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth: W, bevelEnabled: true, bevelSegments: 2, steps: 1,
    bevelSize: 0.022, bevelThickness: 0.022, curveSegments: 10,
  });
  // shape X -> car Z, extrusion -> car X
  bodyGeo.rotateY(-Math.PI / 2);
  bodyGeo.translate(W / 2, 0, 0);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // roof livery stripes
  const roofStripeMat = car.livery === 'martini' ? accent2Mat : accentMat;
  const roofStripe1 = box(group, 0.11, 0.012, 1.22, accentMat, 0.21, roof + 0.019, -0.16);
  const roofStripe2 = box(group, 0.055, 0.013, 1.22, roofStripeMat, 0.33, roof + 0.021, -0.16);
  exteriorBits.push(roofStripe1, roofStripe2);

  /* ---------------- glass ---------------- */
  const glassGroup = new THREE.Group();
  group.add(glassGroup);
  const winBottom = 0.93;
  const winTop = roof - 0.055;
  const sideGlassX = halfW + 0.031;
  const sideGlassFront = quad([
    V(sideGlassX, winBottom, st.cabinRear + 0.1),
    V(sideGlassX, winBottom, st.cabinFront - 0.03),
    V(sideGlassX, winTop, st.roofFront - 0.02),
    V(sideGlassX, winTop, st.roofRear + 0.06),
  ], glassMat);
  glassGroup.add(sideGlassFront);
  const sideGlassRear = quad([
    V(-sideGlassX, winBottom, st.cabinRear + 0.1),
    V(-sideGlassX, winBottom, st.cabinFront - 0.03),
    V(-sideGlassX, winTop, st.roofFront - 0.02),
    V(-sideGlassX, winTop, st.roofRear + 0.06),
  ], glassMat);
  glassGroup.add(sideGlassRear);
  // front and rear windscreen
  const ws = quad([
    V(-W * 0.405, 0.94, st.cabinFront + 0.045),
    V(W * 0.405, 0.94, st.cabinFront + 0.045),
    V(W * 0.335, roof - 0.008, st.roofFront + 0.022),
    V(-W * 0.335, roof - 0.008, st.roofFront + 0.022),
  ], glassMat);
  glassGroup.add(ws);
  const rearGlass = quad([
    V(-W * 0.4, 0.945, st.cabinRear - 0.035),
    V(W * 0.4, 0.945, st.cabinRear - 0.035),
    V(W * 0.32, roof - 0.02, st.roofRear - 0.02),
    V(-W * 0.32, roof - 0.02, st.roofRear - 0.02),
  ], glassMat);
  glassGroup.add(rearGlass);

  // Opaque exterior glass tint. Single-sided: visible from outside, culled from inside.
  const tintMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f1719, metalness: 0.55, roughness: 0.07,
    clearcoat: 1.0, clearcoatRoughness: 0.06, side: THREE.FrontSide,
  });
  // +X side needs reversed winding so it faces outward
  const tintSidePlus = quad([
    V(sideGlassX + 0.001, winTop, st.roofRear + 0.06),
    V(sideGlassX + 0.001, winTop, st.roofFront - 0.02),
    V(sideGlassX + 0.001, winBottom, st.cabinFront - 0.03),
    V(sideGlassX + 0.001, winBottom, st.cabinRear + 0.1),
  ], tintMat);
  glassGroup.add(tintSidePlus);
  const tintSideMinus = quad([
    V(-sideGlassX + 0.001, winBottom, st.cabinRear + 0.1),
    V(-sideGlassX + 0.001, winBottom, st.cabinFront - 0.03),
    V(-sideGlassX + 0.001, winTop, st.roofFront - 0.02),
    V(-sideGlassX + 0.001, winTop, st.roofRear + 0.06),
  ], tintMat);
  glassGroup.add(tintSideMinus);
  const tintWS = quad([
    V(-W * 0.405, 0.94, st.cabinFront + 0.032),
    V(W * 0.405, 0.94, st.cabinFront + 0.032),
    V(W * 0.335, roof - 0.012, st.roofFront + 0.012),
    V(-W * 0.335, roof - 0.012, st.roofFront + 0.012),
  ], tintMat);
  glassGroup.add(tintWS);
  const tintRear = quad([
    V(-W * 0.4, 0.948, st.cabinRear - 0.024),
    V(W * 0.4, 0.948, st.cabinRear - 0.024),
    V(W * 0.32, roof - 0.025, st.roofRear - 0.012),
    V(-W * 0.32, roof - 0.025, st.roofRear - 0.012),
  ], tintMat);
  // reverse rear winding
  {
    const idx = tintRear.geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
    }
    tintRear.geometry.index.needsUpdate = true;
    tintRear.geometry.computeVertexNormals();
  }
  glassGroup.add(tintRear);

  // B-pillar trims
  for (const s of [-1, 1]) {
    box(group, 0.03, winTop - winBottom + 0.02, 0.075, trimMat,
      s * (halfW + 0.034), (winBottom + winTop) / 2, -0.18);
  }

  /* ---------------- livery decals ---------------- */
  const decalTex = makeSideDecal(car);
  const decalMat = new THREE.MeshBasicMaterial({
    map: decalTex, transparent: true, alphaTest: 0.01, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.58), decalMat);
    d.position.set(s * (halfW + 0.028), 0.61, -0.02);
    d.rotation.y = s * Math.PI / 2;
    group.add(d);
  }
  const hoodTex = makeHoodDecal(car);
  const hoodMat = new THREE.MeshBasicMaterial({
    map: hoodTex, transparent: true, alphaTest: 0.01, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  const hood = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.0), hoodMat);
  hood.rotation.x = -Math.PI / 2 + 0.13;
  hood.position.set(0, 0.9, 1.3);
  group.add(hood);

  /* ---------------- wheels ---------------- */
  const wheels = [];
  const frontPivots = [];
  const wheelSpin = [];
  const makeWheel = (x, z, front) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, wheelR, z);
    group.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.26, 22), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    spin.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.27, 18), rimMat);
    rim.rotation.z = Math.PI / 2;
    spin.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.29, 10), rimDark);
    hub.rotation.z = Math.PI / 2;
    spin.add(hub);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.285, 0.035, 0.36), rimDark);
      spoke.rotation.x = (i / 5) * Math.PI * 2;
      spoke.position.x = (x > 0 ? 1 : -1) * 0.002;
      spin.add(spoke);
    }
    // brake disc / caliper hint
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.31, 16),
      new THREE.MeshStandardMaterial({ color: 0x4a4b49, metalness: 0.6, roughness: 0.5 }));
    disc.rotation.z = Math.PI / 2;
    spin.add(disc);
    // arch flare
    const flare = new THREE.Mesh(new THREE.TorusGeometry(archR + 0.005, 0.055, 6, 18, Math.PI), bodyMat);
    flare.position.set(x, wheelR, z);
    flare.rotation.y = Math.PI / 2;
    flare.rotation.z = 0;
    group.add(flare);
    exteriorBits.push(flare);
    exteriorBits.push(pivot);
    wheels.push({ pivot, spin, front, x, z });
    wheelSpin.push(spin);
    if (front) frontPivots.push(pivot);
  };
  makeWheel(halfW - 0.12, wheelZ, true);
  makeWheel(-halfW + 0.12, wheelZ, true);
  makeWheel(halfW - 0.12, -wheelZ, false);
  makeWheel(-halfW + 0.12, -wheelZ, false);

  // mud flaps
  for (const s of [-1, 1]) {
    for (const z of [-wheelZ - 0.48, wheelZ - 0.48]) {
      box(group, 0.3, 0.24, 0.02, darkMat, s * (halfW - 0.25), 0.34, z);
    }
  }

  /* ---------------- front details ---------------- */
  box(group, W * 0.94, 0.22, 0.14, trimMat, 0, 0.47, L / 2 + 0.045);
  box(group, W * 0.98, 0.035, 0.28, darkMat, 0, 0.35, L / 2 + 0.1);
  box(group, 0.58, 0.16, 0.05, darkMat, 0, 0.69, L / 2 + 0.03);
  box(group, 0.3, 0.12, 0.03, chromeMat, 0, 0.69, L / 2 + 0.06);
  for (let i = -2; i <= 2; i++) {
    box(group, 0.018, 0.12, 0.012, darkMat, i * 0.12, 0.69, L / 2 + 0.081);
  }
  const headlightPositions = [
    [-0.55, 0.74], [0.55, 0.74],
    [-0.37, 0.56], [0.37, 0.56],
  ];
  for (let i = 0; i < st.lights; i++) {
    const [hx, hy] = headlightPositions[i] || [0, 0.7];
    cylinder(group, 0.115, 0.115, 0.09, trimMat, hx, hy, L / 2 + 0.03, Math.PI / 2, 0, 0, 18);
    cylinder(group, 0.093, 0.093, 0.045, headlightMat, hx, hy, L / 2 + 0.083, Math.PI / 2, 0, 0, 18);
  }
  if (st.lights > 2) {
    // rally light pod
    box(group, 1.12, 0.055, 0.03, chromeMat, 0, 0.51, L / 2 + 0.12);
    for (let i = 0; i < 2; i++) {
      cylinder(group, 0.075, 0.075, 0.035, darkMat, (i ? 1 : -1) * 0.72, 0.54, L / 2 + 0.13, Math.PI / 2, 0, 0, 14);
    }
  }
  // hood vents
  if (st.hoodVents) {
    for (const s of [-1, 1]) {
      box(group, 0.25, 0.012, 0.14, darkMat, s * 0.42, 0.847, 1.1, -0.03, 0, 0);
      for (let i = -1; i <= 1; i++) {
        box(group, 0.02, 0.016, 0.12, trimMat, s * 0.42 + i * 0.05, 0.853, 1.1, -0.03, 0, 0);
      }
    }
  }
  // mirrors
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 6), trimMat);
    arm.position.set(s * (halfW + 0.02), 0.99, 0.62);
    arm.rotation.z = Math.PI / 2;
    group.add(arm);
    const housing = box(group, 0.12, 0.09, 0.16, trimMat, s * (halfW + 0.12), 1.02, 0.62);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x556164, metalness: 0.8, roughness: 0.15 }));
    mirror.position.set(s * (halfW + 0.12), 1.02, 0.54);
    mirror.rotation.y = Math.PI;
    group.add(mirror);
  }

  /* ---------------- rear details ---------------- */
  box(group, W * 0.94, 0.24, 0.12, trimMat, 0, 0.45, -L / 2 - 0.025);
  for (const s of [-1, 1]) {
    box(group, 0.28, 0.15, 0.035, tailMat, s * 0.55, 0.77, -L / 2 - 0.012);
  }
  box(group, 0.5, 0.08, 0.03, darkMat, 0, 0.8, -L / 2 - 0.015);
  cylinder(group, 0.045, 0.05, 0.12, chromeMat, -0.55, 0.32, -L / 2 - 0.08, Math.PI / 2, 0, 0, 10);
  // rear wing
  if (st.wing === 'big') {
    const wingY = st.roof - 0.22;
    for (const s of [-1, 1]) {
      box(group, 0.035, 0.24, 0.07, trimMat, s * 0.52, wingY - 0.16, -L / 2 + 0.46, 0.22, 0, 0);
    }
    box(group, 1.46, 0.045, 0.3, trimMat, 0, wingY, -L / 2 + 0.42, -0.1, 0, 0);
    box(group, 1.46, 0.008, 0.065, accentMat, 0, wingY + 0.028, -L / 2 + 0.42, -0.1, 0, 0);
    for (const s of [-1, 1]) {
      box(group, 0.016, 0.13, 0.3, accentMat, s * 0.73, wingY + 0.015, -L / 2 + 0.42);
    }
  } else if (st.wing === 'ducktail') {
    box(group, W * 0.8, 0.09, 0.22, bodyMat, 0, 0.92, -L / 2 + 0.05, 0.15, 0, 0);
  }
  // rear number plate
  const plateCanvas = document.createElement('canvas');
  plateCanvas.width = 256; plateCanvas.height = 64;
  const pc = plateCanvas.getContext('2d');
  pc.fillStyle = '#e8e4d4'; pc.fillRect(0, 0, 256, 64);
  pc.fillStyle = '#1b1b18'; pc.font = '700 38px "Barlow Condensed", sans-serif';
  pc.textAlign = 'center'; pc.textBaseline = 'middle';
  pc.fillText(`GB · ${String(car.number).padStart(2, '0')}`, 128, 34);
  const plateMat = new THREE.MeshBasicMaterial({ map: makeCanvasTexture(plateCanvas) });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.08), plateMat);
  plate.position.set(0, 0.58, -L / 2 - 0.045);
  plate.rotation.y = Math.PI;
  group.add(plate);
  // roof scoop / antenna
  if (st.scoop) {
    box(group, 0.3, 0.09, 0.36, trimMat, 0, roof + 0.055, -0.55, -0.08, 0, 0);
    box(group, 0.23, 0.05, 0.1, darkMat, 0, roof + 0.055, -0.38, -0.08, 0, 0);
  }
  cylinder(group, 0.008, 0.004, 0.7, chromeMat, -0.55, roof + 0.35, -0.8, 0.08, 0, 0, 5);

  // headlight glow point
  const headGlow = new THREE.PointLight(0xffe2b0, menu ? 0 : 0.35, 12, 2);
  headGlow.position.set(0, 0.75, L / 2 + 0.6);
  group.add(headGlow);

  /* ============================================================
     INTERIOR
     ============================================================ */
  const interiorMat = new THREE.MeshStandardMaterial({
    color: 0x1a1c18, roughness: 0.9, emissive: 0x060705, emissiveIntensity: 0.5,
  });
  const alcantara = new THREE.MeshStandardMaterial({
    color: 0x141613, roughness: 0.98, emissive: 0x050604, emissiveIntensity: 0.45,
  });
  const carbon = new THREE.MeshStandardMaterial({
    color: 0x1d1f1e, roughness: 0.46, metalness: 0.32,
    emissive: 0x090a09, emissiveIntensity: 0.7,
  });
  const cageMat = new THREE.MeshStandardMaterial({ color: 0x9d9a8f, roughness: 0.5, metalness: 0.45 });
  const beltMat = new THREE.MeshStandardMaterial({ color: 0xa8201f, roughness: 0.86 });
  const suitMat = new THREE.MeshStandardMaterial({ color: 0x3f423d, roughness: 0.96 });
  const suitAccent = new THREE.MeshStandardMaterial({ color: car.accent2, roughness: 0.9 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x262825, roughness: 0.9 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xc9c3b6, roughness: 0.4, metalness: 0.06 });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x0d1518, roughness: 0.1, metalness: 0.85, transparent: true, opacity: 0.92,
  });
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x20211e, roughness: 0.95, emissive: 0x060705, emissiveIntensity: 0.45,
  });

  const interior = new THREE.Group();
  interior.name = 'interior';
  group.add(interior);
  interior.visible = withInterior;

  // floor / tunnel / door cards
  box(interior, W * 0.92, 0.04, 2.0, interiorMat, 0, 0.36, -0.1);
  // firewall and footwell shrouds hide the exterior wheel arches from inside
  box(interior, W * 0.86, 0.5, 0.06, interiorMat, 0, 0.6, 0.84);
  for (const s of [-1, 1]) {
    box(interior, 0.06, 0.46, 0.6, interiorMat, s * (halfW - 0.06), 0.58, 0.56);
    box(interior, 0.22, 0.34, 0.3, interiorMat, s * (halfW - 0.16), 0.52, 0.98);
  }
  box(interior, 0.28, 0.18, 1.6, interiorMat, 0.04, 0.48, -0.15);
  for (const s of [-1, 1]) {
    box(interior, 0.035, 0.62, 1.55, alcantara, s * (halfW - 0.045), 0.72, -0.22);
    box(interior, 0.06, 0.09, 0.55, alcantara, s * (halfW - 0.075), 0.78, -0.15);
    // red door strap
    box(interior, 0.04, 0.035, 0.22, beltMat, s * (halfW - 0.08), 0.84, 0.22, 0, 0, s * 0.3);
    // window sill
    box(interior, 0.08, 0.05, 1.45, trimMat, s * (halfW - 0.02), 0.95, -0.2);
  }
  // roof lining
  box(interior, W * 0.8, 0.025, 1.42, alcantara, 0, roof - 0.055, -0.45);
  // rear bulkhead
  box(interior, W * 0.82, 0.45, 0.06, alcantara, 0, 0.72, -1.05);

  // dashboard
  box(interior, W * 0.88, 0.1, 0.46, carbon, 0, 0.96, 0.66, -0.06, 0, 0);
  box(interior, W * 0.88, 0.2, 0.13, interiorMat, 0, 0.86, 0.86);
  box(interior, 0.42, 0.16, 0.22, carbon, 0.34, 1.0, 0.57, -0.08, 0, 0);
  box(interior, W * 0.84, 0.04, 0.26, alcantara, 0, 1.01, 0.57);
  // center stack
  box(interior, 0.36, 0.28, 0.17, carbon, -0.03, 0.9, 0.58, -0.08, 0, 0);
  // passenger dash section
  box(interior, 0.42, 0.12, 0.3, carbon, -0.47, 0.97, 0.63, -0.05, 0, 0);

  // roll cage
  const cagePts = [
    [[-0.74, 0.5, -0.78], [-0.74, 1.39, -0.62]],
    [[0.74, 0.5, -0.78], [0.74, 1.39, -0.62]],
    [[-0.74, 1.39, -0.62], [0.74, 1.39, -0.62]],
    [[-0.66, 1.38, -0.42], [0.66, 1.38, -0.42]],
    [[0.7, 0.98, 0.55], [0.62, 1.4, -0.1]],
    [[-0.7, 0.98, 0.55], [-0.62, 1.4, -0.1]],
    [[0.73, 0.72, -0.68], [0.73, 0.72, 0.35]],
    [[-0.73, 0.72, -0.68], [-0.73, 0.72, 0.35]],
  ];
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x181a17, roughness: 0.76, metalness: 0.2 });
  cagePts.forEach(([a, b], i) => {
    const mat = (i === 4 || i === 5) ? pillarMat : cageMat;
    interior.add(beamMesh(V(...a), V(...b), i === 4 || i === 5 ? 0.026 : 0.019, mat, 7));
  });
  interior.add(beamMesh(V(-0.74, 1.39, -0.62), V(0.0, 1.31, -1.0), 0.019, cageMat, 7));
  interior.add(beamMesh(V(0.74, 1.39, -0.62), V(0.0, 1.31, -1.0), 0.019, cageMat, 7));

  // seats
  const makeSeat = (x) => {
    const seat = new THREE.Group();
    seat.position.set(x, 0.37, -0.48);
    interior.add(seat);
    box(seat, 0.44, 0.1, 0.5, seatMat, 0, 0.02, 0.0);
    box(seat, 0.4, 0.58, 0.1, seatMat, 0, 0.33, -0.25, 0.16, 0, 0);
    box(seat, 0.13, 0.42, 0.08, seatMat, -0.18, 0.38, -0.22, 0.16, 0, -0.15);
    box(seat, 0.13, 0.42, 0.08, seatMat, 0.18, 0.38, -0.22, 0.16, 0, 0.15);
    box(seat, 0.3, 0.15, 0.12, seatMat, 0, 0.72, -0.28, 0.1, 0, 0);
    box(seat, 0.1, 0.25, 0.06, seatMat, -0.09, 0.39, 0.25, 0.2, 0, 0);
    box(seat, 0.1, 0.25, 0.06, seatMat, 0.09, 0.39, 0.25, 0.2, 0, 0);
    // harness
    box(seat, 0.05, 0.62, 0.016, beltMat, -0.11, 0.42, -0.16, 0.13, 0, -0.12);
    box(seat, 0.05, 0.62, 0.016, beltMat, 0.11, 0.42, -0.16, 0.13, 0, 0.12);
    box(seat, 0.05, 0.3, 0.016, beltMat, 0, 0.4, -0.07, 0.3, 0, 0);
    return seat;
  };
  makeSeat(0.33);
  makeSeat(-0.35);
  // harness bar
  box(interior, 1.0, 0.05, 0.05, cageMat, 0, 0.85, -0.82);

  // steering column + wheel
  const wheelMount = new THREE.Group();
  wheelMount.position.set(0.34, 1.0, 0.27);
  wheelMount.rotation.y = Math.PI;
  wheelMount.rotation.x = -0.38;
  interior.add(wheelMount);
  cylinder(wheelMount, 0.045, 0.055, 0.2, trimMat, 0, 0, -0.1, Math.PI / 2, 0, 0, 10);
  const wheelSpinGroup = new THREE.Group();
  wheelMount.add(wheelSpinGroup);
  const rimGeo = new THREE.TorusGeometry(0.165, 0.022, 8, 28);
  const rim = new THREE.Mesh(rimGeo, alcantara);
  wheelSpinGroup.add(rim);
  for (let i = 0; i < 3; i++) {
    box(wheelSpinGroup, 0.29, 0.022, 0.018, trimMat, 0, 0, 0, 0, 0, i * Math.PI / 3);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), carbon);
  hub.rotation.x = Math.PI / 2;
  wheelSpinGroup.add(hub);
  // accent center marker
  box(wheelSpinGroup, 0.02, 0.18, 0.005, accentMat, 0, 0.08, 0.005);
  // driver gloves
  for (const s of [-1, 1]) {
    const hand = sphere(wheelSpinGroup, 0.045, gloveMat, s * 0.145, -0.005, 0.025, 1, 0.75, 1.3);
    for (let f = 0; f < 3; f++) {
      sphere(wheelSpinGroup, 0.014, gloveMat, s * (0.135 + f * 0.012), 0.045, 0.02, 1, 1.7, 1);
    }
  }

  // gauge pod
  const gaugeCanvas = document.createElement('canvas');
  gaugeCanvas.width = 1024; gaugeCanvas.height = 384;
  const gauge = makeScreen(gaugeCanvas, 0.34, 0.13, V(0.34, 1.075, 0.665), -0.18, false);
  gauge.mount.rotation.x = 0.02;
  interior.add(gauge.mount);
  box(interior, 0.37, 0.15, 0.045, carbon, 0.34, 1.07, 0.645, 0.02, 0, 0);

  // nav screen (center)
  const navCanvas = document.createElement('canvas');
  navCanvas.width = 1024; navCanvas.height = 640;
  const nav = makeScreen(navCanvas, 0.385, 0.241, V(0.015, 1.06, 0.49), -0.33);
  interior.add(nav.mount);
  // pacenote screen (co-driver side)
  const paceCanvas = document.createElement('canvas');
  paceCanvas.width = 960; paceCanvas.height = 640;
  const pace = makeScreen(paceCanvas, 0.275, 0.183, V(-0.335, 1.045, 0.47), -0.34);
  interior.add(pace.mount);
  // small support stalks
  cylinder(interior, 0.012, 0.012, 0.1, trimMat, 0.015, 1.0, 0.53, 0.15, 0, 0, 6);
  cylinder(interior, 0.011, 0.011, 0.09, trimMat, -0.315, 0.99, 0.5, 0.15, 0, 0, 6);

  // dash detail: switches and labels
  for (let i = 0; i < 5; i++) {
    const sw = box(interior, 0.028, 0.014, 0.04, i === 2 ? accentMat : trimMat,
      0.07 + i * 0.045, 1.0, 0.79, -0.3, 0, 0);
    sw.rotation.x = -0.3;
  }
  box(interior, 0.17, 0.035, 0.012, darkMat, 0.16, 0.925, 0.86, -0.1, 0, 0);

  // fire extinguisher (passenger footwell)
  cylinder(interior, 0.055, 0.055, 0.3, new THREE.MeshStandardMaterial({ color: 0xb22c22, roughness: 0.5 }),
    -0.68, 0.5, -0.18, Math.PI / 2 + 0.3, 0, 0, 10);
  // co-driver notebook prop
  const notebookCanvas = document.createElement('canvas');
  notebookCanvas.width = 256; notebookCanvas.height = 256;
  const nctx = notebookCanvas.getContext('2d');
  nctx.fillStyle = '#eee9d9'; nctx.fillRect(0, 0, 256, 256);
  nctx.strokeStyle = 'rgba(50,50,45,.3)'; nctx.lineWidth = 2;
  for (let i = 1; i < 10; i++) { nctx.beginPath(); nctx.moveTo(16, i * 25); nctx.lineTo(240, i * 25); nctx.stroke(); }
  nctx.fillStyle = '#222'; nctx.font = '700 34px "Barlow Condensed"';
  nctx.fillText('L4 80', 22, 50); nctx.fillText('R2 !', 22, 100); nctx.fillText('CREST', 22, 150); nctx.fillText('ICE', 22, 200);
  const noteMat = new THREE.MeshBasicMaterial({ map: makeCanvasTexture(notebookCanvas) });
  const notebook = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), noteMat);
  notebook.position.set(-0.34, 0.93, 0.17);
  notebook.rotation.set(-0.9, 0.1, 0);
  interior.add(notebook);

  // wipers
  const wiperGroup = new THREE.Group();
  wiperGroup.position.set(0, 0.92, st.cabinFront - 0.03);
  wiperGroup.rotation.x = -0.62;
  interior.add(wiperGroup);
  const wipers = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.3, 0, 0);
    wiperGroup.add(pivot);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.018), darkMat);
    arm.position.set(-s * 0.2, 0, 0.01);
    pivot.add(arm);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.008), darkMat);
    blade.position.set(-s * 0.2, -0.012, 0.02);
    pivot.add(blade);
    pivot.rotation.z = s * 0.18;
    wipers.push({ pivot, side: s });
  }

  // rear view mirror
  box(interior, 0.19, 0.048, 0.03, trimMat, 0, 1.335, 0.06);
  const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.034),
    new THREE.MeshStandardMaterial({ color: 0x3c4a4c, metalness: 0.7, roughness: 0.2 }));
  mir.position.set(0, 1.335, 0.04);
  mir.rotation.y = Math.PI;
  interior.add(mir);
  interior.add(beamMesh(V(-0.07, 1.36, 0.05), V(0, 1.39, -0.08), 0.008, trimMat, 6));
  interior.add(beamMesh(V(0.07, 1.36, 0.05), V(0, 1.39, -0.08), 0.008, trimMat, 6));

  // windshield grime overlay (inside)
  const grimeTex = makeGrimeTexture();
  const grime = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.48), new THREE.MeshBasicMaterial({
    map: grimeTex, transparent: true, opacity: 0.42, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  }));
  grime.position.set(0, 1.12, 0.47);
  grime.rotation.x = -0.72;
  interior.add(grime);

  // gear lever
  const gearMount = new THREE.Group();
  gearMount.position.set(0.08, 0.48, 0.04);
  interior.add(gearMount);
  const gearArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.3, 6), chromeMat);
  gearArm.position.y = 0.15;
  gearArm.rotation.x = 0.25;
  gearMount.add(gearArm);
  sphere(gearMount, 0.045, darkMat, 0, 0.3, 0.07, 1, 0.8, 1);
  box(interior, 0.13, 0.02, 0.13, trimMat, 0.08, 0.485, 0.04);

  // handbrake
  const brakeMount = new THREE.Group();
  brakeMount.position.set(0.09, 0.47, -0.22);
  interior.add(brakeMount);
  const brakeArm = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.018, 0.38, 6), chromeMat);
  brakeArm.position.set(0, 0.08, 0.17);
  brakeArm.rotation.x = 1.15;
  brakeMount.add(brakeArm);
  const brakeGrip = box(brakeMount, 0.06, 0.06, 0.2, new THREE.MeshStandardMaterial({ color: 0xa32a20, roughness: 0.7 }),
    0, 0.24, 0.36, -0.2, 0, 0);
  interior.add(beamMesh(V(0.09, 0.47, -0.22), V(0.09, 0.72, -0.22), 0.008, chromeMat, 5));

  /* ---------------- co-driver ---------------- */
  const coDriver = new THREE.Group();
  coDriver.position.set(-0.35, 0.37, -0.52);
  coDriver.scale.setScalar(0.9);
  interior.add(coDriver);
  // torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.205, 0.33, 5, 10), suitMat);
  torso.position.set(0, 0.46, -0.02);
  torso.rotation.x = 0.06;
  coDriver.add(torso);
  // suit accent stripe + belts
  box(coDriver, 0.05, 0.42, 0.02, suitAccent, -0.17, 0.47, 0.13, 0.12, 0, -0.1);
  box(coDriver, 0.05, 0.42, 0.02, suitAccent, 0.17, 0.47, 0.13, 0.12, 0, 0.1);
  box(coDriver, 0.05, 0.56, 0.018, beltMat, -0.1, 0.44, 0.16, 0.12, 0, -0.15);
  box(coDriver, 0.05, 0.56, 0.018, beltMat, 0.1, 0.44, 0.16, 0.12, 0, 0.15);
  // head / helmet
  const head = new THREE.Group();
  head.position.set(0.02, 0.85, 0.03);
  coDriver.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.126, 22, 14), helmetMat);
  helmet.scale.set(1, 1.08, 1.05);
  head.add(helmet);
  // curved visor band across the face
  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.129, 0.131, 0.066, 24, 1, true, -0.95, 1.9),
    visorMat
  );
  visor.position.y = 0.015;
  head.add(visor);
  // chin guard below the visor
  const chin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.124, 0.122, 0.045, 18, 1, true, -0.65, 1.3),
    trimMat
  );
  chin.position.y = -0.062;
  head.add(chin);
  // helmet bottom rim
  const helmetRim = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.011, 5, 20), trimMat);
  helmetRim.rotation.x = Math.PI / 2;
  helmetRim.position.y = -0.098;
  head.add(helmetRim);
  // helmet crown stripe
  box(head, 0.028, 0.012, 0.21, suitAccent, 0, 0.128, -0.01, 0.04, 0, 0);
  // headset
  for (const s of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.026, 10), trimMat);
    cup.position.set(s * 0.131, 0.005, 0);
    cup.rotation.z = Math.PI / 2;
    head.add(cup);
  }
  const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 5), trimMat);
  mic.position.set(0.085, -0.02, 0.1);
  mic.rotation.z = 1.1;
  head.add(mic);
  // arms toward notebook
  const shoulderL = V(-0.2, 0.72, 0.05);
  const shoulderR = V(0.2, 0.72, 0.05);
  const elbowL = V(-0.24, 0.52, 0.2);
  const elbowR = V(0.18, 0.52, 0.2);
  const handL = V(-0.1, 0.46, 0.36);
  const handR = V(0.09, 0.46, 0.36);
  for (const [a, b] of [[shoulderL, elbowL], [shoulderR, elbowR]]) {
    const arm = beamMesh(a, b, 0.06, suitMat, 8);
    coDriver.add(arm);
  }
  for (const [a, b] of [[elbowL, handL], [elbowR, handR]]) {
    const arm = beamMesh(a, b, 0.05, suitMat, 8);
    coDriver.add(arm);
    sphere(coDriver, 0.055, gloveMat, b.x, b.y + 0.02, b.z, 1, 0.8, 1.1);
  }
  // legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x30322f, roughness: 0.95 });
  for (const s of [-1, 1]) {
    const thigh = beamMesh(V(s * 0.11, 0.1, 0.03), V(s * 0.15, 0.03, 0.44), 0.085, legMat, 8);
    coDriver.add(thigh);
    const shin = beamMesh(V(s * 0.15, 0.03, 0.44), V(s * 0.15, -0.02, 0.6), 0.07, legMat, 8);
    coDriver.add(shin);
  }

  // camera mount
  const headRig = new THREE.Group();
  const eyeY = Math.min(1.28, Math.max(1.12, roof - 0.17));
  headRig.position.set(0.24, eyeY, -0.55);
  interior.add(headRig);

  // interior ambient glow (screen spill + cool cabin fill)
  const dashLight = new THREE.PointLight(0xffc37a, 2.4, 1.7, 2);
  dashLight.position.set(0.02, 1.02, 0.48);
  interior.add(dashLight);
  const cabinFill = new THREE.PointLight(0xb7cdd8, 1.2, 2.4, 2);
  cabinFill.position.set(-0.1, 1.12, -0.18);
  interior.add(cabinFill);
  const floorFill = new THREE.PointLight(0xffd9a8, 0.9, 1.7, 2);
  floorFill.position.set(0.1, 0.55, -0.05);
  interior.add(floorFill);

  /* ---------------- assemble userData ---------------- */
  const screens = {
    nav: { ...nav, ctx: navCanvas.getContext('2d') },
    pace: { ...pace, ctx: paceCanvas.getContext('2d') },
    gauge: { ...gauge, ctx: gaugeCanvas.getContext('2d') },
  };

  // Keep animated / swap-visible pieces as separate objects. Everything else
  // is batched by material without changing a single triangle.
  const skipRoots = new Set([
    wheelSpinGroup, gearMount, brakeMount, coDriver, headRig, wiperGroup,
    ...wheels.map((w) => w.pivot),
    ...exteriorBits,
    ...Object.values(screens).map((s) => s.mount),
  ]);
  mergeStaticCarMeshes(group, skipRoots);
  // The animated assemblies still contain several static sub-parts each.
  // Merge those inside their own rigid pivot so wheel/steering/co-driver
  // animation is untouched while draw calls fall further.
  for (const w of wheels) {
    mergeStaticCarMeshes(w.pivot, new Set([w.spin]));
    mergeStaticCarMeshes(w.spin, new Set());
  }
  mergeStaticCarMeshes(wheelSpinGroup, new Set());
  mergeStaticCarMeshes(gearMount, new Set());
  mergeStaticCarMeshes(brakeMount, new Set());
  const headAndBook = new Set([head, notebook]);
  mergeStaticCarMeshes(coDriver, headAndBook);
  mergeStaticCarMeshes(head, new Set());
  mergeStaticCarMeshes(notebook, new Set());
  for (const w of wipers) mergeStaticCarMeshes(w.pivot, new Set());
  for (const s of Object.values(screens)) mergeStaticCarMeshes(s.mount, new Set());

  const info = {
    group, interior, body, screens,
    steering: wheelSpinGroup,
    gearLever: gearMount,
    handbrake: brakeMount,
    coDriver,
    coDriverHead: head,
    coDriverNotebook: notebook,
    headRig,
    wipers,
    glassGroup,
    wheels,
    wheelSpin,
    frontPivots,
    exteriorBits,
    bodyMat,
    seatMat,
    headlights: headlightMat,
    camera: null,
    wiperState: 0,
    coDriverBob: 0,
  };
  group.userData = info;
  return info;
}

export function disposeCarModel(info) {
  if (!info) return;
  info.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    mats.forEach((m) => {
      if (!m) return;
      Object.keys(m).forEach((k) => { if (m[k] && m[k].isTexture) m[k].dispose(); });
      m.dispose();
    });
  });
}
