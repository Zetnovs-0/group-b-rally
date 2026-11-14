import * as THREE from 'three';
import { createCarModel, disposeCarModel } from './carModel.js';
import { makeCanvasTexture } from './util.js';

export class MenuPreview {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(33, 1, 0.1, 200);
    this.camera.position.set(6.9, 2.5, 7.6);
    this.camera.lookAt(0, 0.78, 0);
    this.time = 0;
    this.car = null;
    this.carInfo = null;
    this.stage = null;
    this.accent = new THREE.Color(0xf2c43a);
    this._buildStudio();
  }

  _buildStudio() {
    const scene = this.scene;
    scene.fog = new THREE.FogExp2(0x111712, 0.028);

    // backdrop shell
    this.backdropMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x22352e) },
        horizonColor: { value: new THREE.Color(0x0c1210) },
        glowColor: { value: new THREE.Color(0x415d46) },
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
        uniform vec3 glowColor;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          vec3 col = mix(horizonColor, topColor, smoothstep(-0.05, 0.7, h));
          float halo = pow(max(0.0, 1.0 - length(vDir.xz) * 3.2), 3.0);
          col += glowColor * halo * 0.22;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 20), this.backdropMat);
    scene.add(sky);

    // floor
    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a211b, roughness: 0.55, metalness: 0.24,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(26, 64), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // turntable
    this.platformMat = new THREE.MeshStandardMaterial({
      color: 0x141a15, roughness: 0.32, metalness: 0.55,
    });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(3.35, 3.55, 0.2, 72), this.platformMat);
    platform.position.y = 0.0;
    platform.receiveShadow = true;
    scene.add(platform);
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.accent, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.38, 0.022, 6, 96), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.11;
    scene.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.012, 6, 80), new THREE.MeshBasicMaterial({
      color: 0x4b5947, toneMapped: false,
    }));
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.111;
    scene.add(ring2);

    // contact shadow
    const { canvas, ctx } = (() => {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 512;
      return { canvas: c, ctx: c.getContext('2d') };
    })();
    const grad = ctx.createRadialGradient(256, 256, 20, 256, 256, 250);
    grad.addColorStop(0, 'rgba(0,0,0,.62)');
    grad.addColorStop(0.45, 'rgba(0,0,0,.34)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    const shadowTex = makeCanvasTexture(canvas);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 5.6), new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9,
    }));
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.115;
    scene.add(contact);

    // lights
    this.hemi = new THREE.HemisphereLight(0xc6d8cf, 0x1a1f17, 1.0);
    scene.add(this.hemi);
    this.key = new THREE.SpotLight(0xfff3dd, 170, 34, 0.62, 0.55, 1.4);
    this.key.position.set(5.5, 7.2, 6.5);
    this.key.target.position.set(0, 0.8, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.001;
    this.key.shadow.normalBias = 0.03;
    scene.add(this.key, this.key.target);

    this.rim = new THREE.SpotLight(0xf2c43a, 220, 30, 0.7, 0.7, 1.5);
    this.rim.position.set(-6, 4.5, -5);
    this.rim.target.position.set(0, 0.7, 0);
    scene.add(this.rim, this.rim.target);

    this.fill = new THREE.SpotLight(0x8db6c4, 90, 30, 0.8, 0.8, 1.3);
    this.fill.position.set(-4.5, 2.4, 6.5);
    this.fill.target.position.set(0, 0.9, 0);
    scene.add(this.fill, this.fill.target);

    // light bars in the back
    const barMat = new THREE.MeshBasicMaterial({ color: 0x39473c, toneMapped: false });
    this.bars = [];
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.4, 0.06), barMat);
      bar.position.set(side * 7.5, 2.2, -7.5);
      bar.rotation.z = side * 0.28;
      scene.add(bar);
      this.bars.push(bar);
    }
    this.barMat = barMat;

    this.turntable = new THREE.Group();
    scene.add(this.turntable);
  }

  setCar(car) {
    if (this.carInfo) {
      this.turntable.remove(this.carInfo.group);
      disposeCarModel(this.carInfo);
      this.carInfo = null;
    }
    this.car = car;
    const info = createCarModel(car, { withInterior: false, menu: true });
    info.group.position.y = 0.125;
    info.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.turntable.add(info.group);
    this.carInfo = info;
    this.ringMat.color.setHex(car.accent);
    this.rim.color.setHex(car.accent);
    this.rim.intensity = 190;
    this.fill.color.setHex(car.accent2);
    this.fill.intensity = 70;
  }

  setStage(stage) {
    this.stage = stage;
    const env = stage.env;
    this.backdropMat.uniforms.topColor.value.setHex(env.skyTop).multiplyScalar(0.38);
    this.backdropMat.uniforms.horizonColor.value.setHex(0x080c09);
    this.backdropMat.uniforms.glowColor.value.setHex(env.hill).multiplyScalar(0.5);
    this.floorMat.color.setHex(env.groundDark).multiplyScalar(0.42);
    this.platformMat.color.setHex(env.ground).multiplyScalar(0.16);
    this.scene.fog.color.setHex(env.groundDark).multiplyScalar(0.3);
    this.hemi.color.setHex(env.hemiSky);
    this.hemi.groundColor.setHex(env.groundDark);
    this.key.color.setHex(0xfff3dd);
    this.barMat.color.setHex(env.hill).multiplyScalar(0.5);
    this.scene.background = null;
  }

  resize(w, h) {
    this.camera.aspect = Math.max(0.6, w / h);
    this.camera.updateProjectionMatrix();
    // adapt camera based on aspect
    const aspect = this.camera.aspect;
    if (aspect < 1.2) {
      this.camera.position.set(8.4, 3.2, 9.2);
    } else if (aspect < 1.7) {
      this.camera.position.set(7.9, 2.85, 8.7);
    } else {
      this.camera.position.set(6.9, 2.5, 7.6);
    }
    this.camera.lookAt(0, 0.78, 0);
  }

  update(dt) {
    this.time += dt;
    this.turntable.rotation.y = -0.45 + Math.sin(this.time * 0.16) * 0.22;
    this.turntable.position.y = Math.sin(this.time * 0.7) * 0.005;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.carInfo) {
      this.turntable.remove(this.carInfo.group);
      disposeCarModel(this.carInfo);
      this.carInfo = null;
    }
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach((m) => {
        if (!m) return;
        Object.keys(m).forEach((k) => { if (m[k] && m[k].isTexture) m[k].dispose(); });
        m.dispose();
      });
    });
  }
}
