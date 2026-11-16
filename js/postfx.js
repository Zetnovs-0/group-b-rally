import * as THREE from 'three';

/* ============================================================
   VIVID SHADERS (off by default)
   A tiny self-contained post stack: bloom, colour grading,
   sun glow, vignette, chromatic edges and film grain.
   No EffectComposer dependency, just two ping-pong targets.
   ============================================================ */

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float soft = clamp((l - uThreshold + uKnee) / (2.0 * uKnee + 0.00001), 0.0, 1.0);
    soft = soft * soft * (3.0 - 2.0 * soft);
    float amount = max(l - uThreshold, 0.0) + soft * uKnee;
    vec3 bloom = c * (amount / max(l, 0.0001));
    gl_FragColor = vec4(bloom, 1.0);
  }
`;

const BLUR = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 d = uTexel;
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
    c += texture2D(tDiffuse, vUv + vec2(1.3846153846, 0.0) * d).rgb * 0.3162162162;
    c += texture2D(tDiffuse, vUv - vec2(1.3846153846, 0.0) * d).rgb * 0.3162162162;
    c += texture2D(tDiffuse, vUv + vec2(3.2307692308, 0.0) * d).rgb * 0.0702702703;
    c += texture2D(tDiffuse, vUv - vec2(3.2307692308, 0.0) * d).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const FINAL = /* glsl */`
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform vec2 uResolution;
  uniform vec2 uSunUV;
  uniform vec3 uSunColor;
  uniform float uBloom;
  uniform float uSun;
  uniform float uSaturation;
  uniform float uVibrance;
  uniform float uContrast;
  uniform float uCurve;
  uniform float uExposure;
  uniform float uSharpen;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uChroma;
  uniform float uWarmth;
  uniform float uTime;
  uniform float uTint;
  uniform float uLift;
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float luminance(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec2 uv = vUv;
    vec2 dir = uv - 0.5;
    float dist = length(dir);
    float ca = uChroma * 0.00115 * dist * dist;
    vec3 col;
    col.r = texture2D(tScene, uv + dir * ca).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - dir * ca).b;
    col = pow(max(col, 0.0), vec3(1.0 / 2.2));

    // A light unsharp pass makes the procedural gravel, bark and leaves read
    // much crisper without turning into a harsh digital sharpen.
    if (uSharpen > 0.001) {
      vec2 texel = 1.0 / max(uResolution, vec2(2.0));
      vec3 blur = texture2D(tScene, uv + vec2(texel.x, 0.0)).rgb;
      blur += texture2D(tScene, uv - vec2(texel.x, 0.0)).rgb;
      blur += texture2D(tScene, uv + vec2(0.0, texel.y)).rgb;
      blur += texture2D(tScene, uv - vec2(0.0, texel.y)).rgb;
      blur = pow(max(blur * 0.25, 0.0), vec3(1.0 / 2.2));
      col += (col - blur) * uSharpen;
    }

    vec3 bloom = pow(max(texture2D(tBloom, uv).rgb, 0.0), vec3(1.0 / 2.2));
    col += bloom * uBloom * 0.74;

    // subtle sun haze / anamorphic streak
    if (uSun > 0.001) {
      vec2 d = uv - uSunUV;
      float glow = exp(-dot(d, d) * 24.0);
      float core = exp(-dot(d, d) * 110.0);
      float streak = exp(-abs(d.y) * 52.0) * exp(-abs(d.x) * 2.2);
      col += uSunColor * (glow * 0.24 + core * 0.16 + streak * 0.13) * uSun;
    }

    // Film-style grade: a gentle S-curve, warm highlight / cool shadow split
    // and a tiny black lift keep the saturated blues and greens alive.
    col *= uExposure;
    col = mix(col, smoothstep(0.0, 1.0, col), uCurve);
    float l = luminance(col);
    col = mix(vec3(l), col, uSaturation);
    float mx = max(max(col.r, col.g), col.b);
    float mn = min(min(col.r, col.g), col.b);
    float sat = (mx - mn) / max(mx, 0.001);
    col = mix(vec3(l), col, 1.0 + uVibrance * (1.0 - l) * (1.0 - sat));
    col = (col - 0.5) * uContrast + 0.5;

    l = luminance(col);
    vec3 tint = mix(uShadowTint, uHighlightTint, smoothstep(0.1, 0.84, l));
    col = mix(col, col * tint, uTint);
    col += uShadowTint * uLift * (1.0 - smoothstep(0.0, 0.42, l));
    col.r *= 1.0 + uWarmth;
    col.b *= 1.0 - uWarmth;

    float vig = smoothstep(0.92, 0.2, dist);
    col *= mix(1.0, vig, uVignette);

    // fine grain, weighted away from the brightest highlights, plus dithering
    float g = hash(uv * uResolution + uTime) - 0.5;
    col += g * uGrain * (1.0 - smoothstep(0.55, 1.0, luminance(col)) * 0.7);
    col += (hash(uv * uResolution + uTime * 1.7) - 0.5) / 255.0;

    col = pow(max(col, vec3(0.0)), vec3(2.2));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const PRESETS = {
  vivid: {
    bloom: 0.98,
    sun: 0.88,
    saturation: 1.42,
    vibrance: 0.46,
    contrast: 1.055,
    curve: 0.13,
    exposure: 1.025,
    sharpen: 0.2,
    vignette: 0.27,
    grain: 0.011,
    chroma: 0.8,
    warmth: 0.028,
    tint: 0.34,
    lift: 0.008,
    shadowTint: [0.83, 0.98, 1.1],
    highlightTint: [1.1, 1.025, 0.88],
    threshold: 0.56,
    knee: 0.2,
  },
  cinematic: {
    bloom: 1.18,
    sun: 1.1,
    saturation: 1.24,
    vibrance: 0.22,
    contrast: 1.13,
    curve: 0.2,
    exposure: 1.0,
    sharpen: 0.12,
    vignette: 0.4,
    grain: 0.026,
    chroma: 1.2,
    warmth: -0.006,
    tint: 0.68,
    lift: 0.012,
    shadowTint: [0.76, 0.94, 1.14],
    highlightTint: [1.16, 1.03, 0.82],
    threshold: 0.5,
    knee: 0.24,
  },
};

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.mode = 'off';
    this.width = 1;
    this.height = 1;
    this.time = 0;
    this._sunVec = new THREE.Vector3();
    this._camDir = new THREE.Vector3();

    this.targetType = THREE.HalfFloatType;
    // Half-float is ideal but fall back cleanly on old mobile GL.
    const gl = renderer.getContext();
    if (!renderer.capabilities.isWebGL2) this.targetType = THREE.UnsignedByteType;
    if (gl && gl.getExtension && !gl.getExtension('EXT_color_buffer_half_float') &&
      !renderer.capabilities.isWebGL2) {
      this.targetType = THREE.UnsignedByteType;
    }

    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: this.targetType,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.bloomRT = new THREE.WebGLRenderTarget(1, 1, {
      type: this.targetType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.bloomRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.blurRT = this.bloomRT.clone();
    this.blurRT.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: 0.66 },
        uKnee: { value: 0.18 },
      },
      vertexShader: VERT,
      fragmentShader: BRIGHT,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1, 0) },
      },
      vertexShader: VERT,
      fragmentShader: BLUR,
      depthTest: false,
      depthWrite: false,
    });
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uSunUV: { value: new THREE.Vector2(-1, -1) },
        uSunColor: { value: new THREE.Color(0xffe6b0) },
        uBloom: { value: 0.8 },
        uSun: { value: 0 },
        uSaturation: { value: 1.4 },
        uVibrance: { value: 0.4 },
        uContrast: { value: 1.06 },
        uCurve: { value: 0.13 },
        uExposure: { value: 1.025 },
        uSharpen: { value: 0.2 },
        uVignette: { value: 0.28 },
        uGrain: { value: 0.011 },
        uChroma: { value: 0.8 },
        uWarmth: { value: 0.03 },
        uTime: { value: 0 },
        uTint: { value: 0.34 },
        uLift: { value: 0.008 },
        uShadowTint: { value: new THREE.Color(0xdcf0ff) },
        uHighlightTint: { value: new THREE.Color(0xfff1d8) },
      },
      vertexShader: VERT,
      fragmentShader: FINAL,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.setMode('off');
  }

  setMode(mode) {
    this.mode = PRESETS[mode] ? mode : 'off';
    const p = PRESETS[this.mode];
    if (!p) return;
    const u = this.finalMat.uniforms;
    u.uBloom.value = p.bloom;
    u.uSun.value = p.sun;
    u.uSaturation.value = p.saturation;
    u.uVibrance.value = p.vibrance;
    u.uContrast.value = p.contrast;
    u.uCurve.value = p.curve;
    u.uExposure.value = p.exposure;
    u.uSharpen.value = p.sharpen;
    u.uVignette.value = p.vignette;
    u.uGrain.value = p.grain;
    u.uChroma.value = p.chroma;
    u.uWarmth.value = p.warmth;
    u.uTint.value = p.tint;
    u.uLift.value = p.lift;
    u.uShadowTint.value.setRGB(...p.shadowTint);
    u.uHighlightTint.value.setRGB(...p.highlightTint);
    this.brightMat.uniforms.uThreshold.value = p.threshold;
    this.brightMat.uniforms.uKnee.value = p.knee;
  }

  setSize(width, height) {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.sceneRT.setSize(w, h);
    const bw = Math.max(1, Math.floor(w * 0.5));
    const bh = Math.max(1, Math.floor(h * 0.5));
    this.bloomRT.setSize(bw, bh);
    this.blurRT.setSize(bw, bh);
    this.finalMat.uniforms.uResolution.value.set(w, h);
    this.blurMat.uniforms.uTexel.value.set(1 / bw, 0);
  }

  _setQuad(material) {
    this.quad.material = material;
  }

  render(scene, camera, opts = {}) {
    if (this.mode === 'off') {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    const r = this.renderer;
    this.time += 0.016;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = true;

    // 1. scene -> linear HDR target
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2. bright pass
    this.brightMat.uniforms.tDiffuse.value = this.sceneRT.texture;
    this._setQuad(this.brightMat);
    r.setRenderTarget(this.bloomRT);
    r.clear();
    r.render(this.postScene, this.postCamera);

    // 3. separable blur, horizontal then vertical
    const texel = this.blurMat.uniforms.uTexel.value;
    this._setQuad(this.blurMat);
    this.blurMat.uniforms.tDiffuse.value = this.bloomRT.texture;
    texel.set(1 / this.bloomRT.width, 0);
    r.setRenderTarget(this.blurRT);
    r.clear();
    r.render(this.postScene, this.postCamera);

    this.blurMat.uniforms.tDiffuse.value = this.blurRT.texture;
    texel.set(0, 1 / this.bloomRT.height);
    r.setRenderTarget(this.bloomRT);
    r.clear();
    r.render(this.postScene, this.postCamera);

    // 4. final grade to the screen
    const u = this.finalMat.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.bloomRT.texture;
    u.uTime.value = (this.time * 0.7) % 1000;
    u.uResolution.value.set(this.width, this.height);
    u.uSunColor.value.copy(opts.sunColor || new THREE.Color(0xffe6b0));
    let sunStrength = 0;
    if (opts.sunDir && camera) {
      this._sunVec.copy(opts.sunDir).normalize();
      camera.getWorldDirection(this._camDir);
      const facing = this._camDir.dot(this._sunVec);
      if (facing > 0.02) {
        const world = new THREE.Vector3().copy(camera.position).addScaledVector(this._sunVec, 500);
        world.project(camera);
        if (world.z < 1) {
          u.uSunUV.value.set(world.x * 0.5 + 0.5, world.y * 0.5 + 0.5);
          sunStrength = Math.min(1, facing * 1.6) * (opts.sunStrength ?? 1);
        }
      }
    }
    u.uSun.value = (PRESETS[this.mode]?.sun || 0) * sunStrength;
    this._setQuad(this.finalMat);
    r.setRenderTarget(null);
    r.clear();
    r.render(this.postScene, this.postCamera);

    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
  }

  dispose() {
    this.sceneRT.dispose();
    this.bloomRT.dispose();
    this.blurRT.dispose();
    this.quad.geometry.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.finalMat.dispose();
  }
}
