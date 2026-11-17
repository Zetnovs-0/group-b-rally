/* ============================================================
   DESTRUCTION
   Small, self-contained debris bursts for trees, rocks, logs and
   stumps. Geometry is shared; each burst owns one instanced mesh
   and fades out before being removed from the scene.
   ============================================================ */

import * as THREE from 'three';
import { clamp, mulberry32 } from './util.js';
import { makeSoftDotTexture } from './textures.js';

const TMP = new THREE.Object3D();
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CHUNK = new THREE.IcosahedronGeometry(1, 0);

export class DestructionSystem {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.group = new THREE.Group();
    this.group.name = 'destruction';
    this.scene.add(this.group);
    this.bursts = [];
    this.dustTex = makeSoftDotTexture();
    this.seed = 1;
  }

  _palette(collider) {
    const base = collider.colors || {};
    const bark = base.bark ?? 0x5a4128;
    const leaf = base.leaf ?? 0x2d4527;
    if (collider.type === 'rock') {
      return [bark, new THREE.Color(bark).offsetHSL(0, 0, 0.12).getHex(), 0x6f6c5f];
    }
    return [bark, new THREE.Color(bark).offsetHSL(0, 0, 0.09).getHex(), leaf, leaf];
  }

  breakObject(collider, impact = 10, velocity = null) {
    if (!collider) return;
    const rng = mulberry32((this.seed++ * 2654435761) >>> 0);
    const tree = collider.type === 'tree';
    const rock = collider.type === 'rock';
    const count = tree ? 15 : rock ? 11 : 9;
    const palette = this._palette(collider);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: rock ? 0.96 : 0.9,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.InstancedMesh(rock ? CHUNK : BOX, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const pieces = [];
    const baseY = collider.y != null ? collider.y : this.track._groundHeightAt(collider.x, collider.z);
    const spreadY = tree ? 4.6 : rock ? 0.9 : 1.1;
    const carVel = velocity ? velocity.clone().multiplyScalar(0.55) : new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const px = collider.x + (rng() - 0.5) * (tree ? 1.2 : 2.2);
      const pz = collider.z + (rng() - 0.5) * (tree ? 1.2 : 2.2);
      const py = baseY + 0.35 + rng() * spreadY;
      const ang = rng() * Math.PI * 2;
      const out = 2.2 + rng() * (impact * 0.42 + 3.2);
      const piece = {
        x: px, y: py, z: pz,
        vx: Math.cos(ang) * out + carVel.x * (0.35 + rng() * 0.4),
        vy: 1.4 + rng() * (impact * 0.18 + 2.2),
        vz: Math.sin(ang) * out + carVel.z * (0.35 + rng() * 0.4),
        rx: rng() * Math.PI, ry: rng() * Math.PI, rz: rng() * Math.PI,
        spinX: (rng() - 0.5) * 8, spinY: (rng() - 0.5) * 8, spinZ: (rng() - 0.5) * 8,
        sx: tree ? 0.12 + rng() * 0.3 : 0.28 + rng() * 0.75,
        sy: tree ? 0.8 + rng() * 2.3 : 0.22 + rng() * 0.55,
        sz: tree ? 0.12 + rng() * 0.3 : 0.28 + rng() * 0.75,
        ground: baseY + 0.06,
        scale: 1,
      };
      pieces.push(piece);
      mesh.setColorAt(i, new THREE.Color(palette[Math.floor(rng() * palette.length)]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);

    // Dust / leaf puff.
    const dustCount = tree ? 16 : 10;
    const pos = new Float32Array(dustCount * 3);
    const dustVel = [];
    for (let i = 0; i < dustCount; i++) {
      pos[i * 3] = collider.x + (rng() - 0.5) * 2.2;
      pos[i * 3 + 1] = baseY + 0.4 + rng() * (tree ? 3.4 : 1.2);
      pos[i * 3 + 2] = collider.z + (rng() - 0.5) * 2.2;
      dustVel.push(new THREE.Vector3(
        (rng() - 0.5) * 2.2,
        0.5 + rng() * 1.8,
        (rng() - 0.5) * 2.2
      ));
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dustMat = new THREE.PointsMaterial({
      map: this.dustTex,
      color: rock ? 0xb9b2a0 : tree ? 0x99a45f : 0xa58b64,
      size: tree ? 1.4 : 0.9,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    dust.frustumCulled = false;
    this.group.add(dust);

    this.bursts.push({
      mesh, pieces, dust, dustVel, dustGeo, dustMat, material,
      life: 0, maxLife: tree ? 6.4 : 5.2, rng,
    });
    // Keep the debris budget bounded during long sessions.
    while (this.bursts.length > 18) this._retire(this.bursts.shift());
  }

  _retire(burst) {
    if (!burst) return;
    this.group.remove(burst.mesh);
    this.group.remove(burst.dust);
    burst.mesh.dispose();
    burst.dustGeo.dispose();
    burst.material.dispose();
    burst.dustMat.dispose();
  }

  update(dt, playerPos = null) {
    if (!this.bursts.length) return;
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b];
      burst.life += dt;
      const fade = clamp(1 - (burst.life - burst.maxLife * 0.55) / (burst.maxLife * 0.45), 0, 1);
      for (let i = 0; i < burst.pieces.length; i++) {
        const p = burst.pieces[i];
        p.vy -= 15.5 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.rx += p.spinX * dt;
        p.ry += p.spinY * dt;
        p.rz += p.spinZ * dt;
        if (p.y < p.ground) {
          p.y = p.ground;
          p.vy = Math.abs(p.vy) * 0.22;
          p.vx *= 0.72;
          p.vz *= 0.72;
          p.spinX *= 0.55;
          p.spinY *= 0.55;
          p.spinZ *= 0.55;
        }
        const scale = (0.4 + fade * 0.6) * (1 - clamp((burst.life - burst.maxLife * 0.7) / (burst.maxLife * 0.3), 0, 1));
        TMP.position.set(p.x, p.y, p.z);
        TMP.rotation.set(p.rx, p.ry, p.rz);
        TMP.scale.set(p.sx * scale, p.sy * scale, p.sz * scale);
        TMP.updateMatrix();
        burst.mesh.setMatrixAt(i, TMP.matrix);
      }
      burst.mesh.instanceMatrix.needsUpdate = true;
      burst.material.opacity = fade;
      // dust rises, drifts and fades
      const posAttr = burst.dustGeo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const v = burst.dustVel[i];
        posAttr.setXYZ(
          i,
          posAttr.getX(i) + v.x * dt,
          posAttr.getY(i) + v.y * dt,
          posAttr.getZ(i) + v.z * dt
        );
        v.multiplyScalar(1 - 0.85 * dt);
      }
      posAttr.needsUpdate = true;
      burst.dustMat.opacity = 0.38 * clamp(1 - burst.life / (burst.maxLife * 0.9), 0, 1);
      burst.dustMat.size = burst.dustMat.size * (1 + 0.22 * dt);
      if (burst.life >= burst.maxLife) {
        this._retire(burst);
        this.bursts.splice(b, 1);
      }
    }
  }

  dispose() {
    for (const b of this.bursts) this._retire(b);
    this.bursts.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.dustTex?.dispose();
    this.dustTex = null;
  }
}
