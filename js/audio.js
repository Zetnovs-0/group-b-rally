import { clamp } from './util.js';

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.engineOn = false;
    this.nodes = {};
    this.prevThrottle = 0;
    this.crackleCooldown = 0;
    this.voice = null;
    this._setupVoices();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.settings.muted ? 0 : this.settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.nodes.master = master;

    // reusable noise buffer
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    // engine
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 900;
    engineFilter.Q.value = 1.2;
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.16;
    const g3 = ctx.createGain(); g3.gain.value = 0.55;
    osc1.connect(g1).connect(engineFilter);
    osc2.connect(g2).connect(engineFilter);
    sub.connect(g3).connect(engineFilter);
    osc1.start(); osc2.start(); sub.start();

    // induction rasp
    const raspSource = ctx.createBufferSource();
    raspSource.buffer = buffer;
    raspSource.loop = true;
    const raspFilter = ctx.createBiquadFilter();
    raspFilter.type = 'bandpass';
    raspFilter.frequency.value = 1400;
    raspFilter.Q.value = 0.8;
    const raspGain = ctx.createGain();
    raspGain.gain.value = 0;
    raspSource.connect(raspFilter).connect(raspGain).connect(master);
    raspSource.start();

    // turbo whistle
    const turbo = ctx.createOscillator();
    turbo.type = 'sine';
    turbo.frequency.value = 4200;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turbo.connect(turboGain).connect(master);
    turbo.start();
    const turboNoise = ctx.createBufferSource();
    turboNoise.buffer = buffer;
    turboNoise.loop = true;
    const turboNoiseFilter = ctx.createBiquadFilter();
    turboNoiseFilter.type = 'highpass';
    turboNoiseFilter.frequency.value = 3200;
    const turboNoiseGain = ctx.createGain();
    turboNoiseGain.gain.value = 0;
    turboNoise.connect(turboNoiseFilter).connect(turboNoiseGain).connect(master);
    turboNoise.start();

    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();

    // surface / tyres
    const surface = ctx.createBufferSource();
    surface.buffer = buffer;
    surface.loop = true;
    const surfaceFilter = ctx.createBiquadFilter();
    surfaceFilter.type = 'bandpass';
    surfaceFilter.frequency.value = 900;
    surfaceFilter.Q.value = 0.8;
    const surfaceGain = ctx.createGain();
    surfaceGain.gain.value = 0;
    surface.connect(surfaceFilter).connect(surfaceGain).connect(master);
    surface.start();

    // slip / scrub
    const slip = ctx.createBufferSource();
    slip.buffer = buffer;
    slip.loop = true;
    const slipFilter = ctx.createBiquadFilter();
    slipFilter.type = 'bandpass';
    slipFilter.frequency.value = 2600;
    slipFilter.Q.value = 2.2;
    const slipGain = ctx.createGain();
    slipGain.gain.value = 0;
    slip.connect(slipFilter).connect(slipGain).connect(master);
    slip.start();

    this.nodes.engine = { gain: engineGain, filter: engineFilter, osc1, osc2, sub, raspGain, raspFilter };
    this.nodes.turbo = { gain: turboGain, osc: turbo, noiseGain: turboNoiseGain };
    this.nodes.wind = { gain: windGain, filter: windFilter };
    this.nodes.surface = { gain: surfaceGain, filter: surfaceFilter };
    this.nodes.slip = { gain: slipGain, filter: slipFilter };
    this.ready = true;
  }

  _setupVoices() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      const voices = speechSynthesis.getVoices();
      this.voice = voices.find((v) => /en[-_]GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) ||
        voices.find((v) => /en[-_]GB/i.test(v.lang)) ||
        voices.find((v) => /en/i.test(v.lang)) || null;
    };
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  setSettings(settings) {
    this.settings = settings;
    if (this.nodes.master) {
      this.nodes.master.gain.setTargetAtTime(
        settings.muted ? 0 : settings.volume,
        this.ctx.currentTime, 0.05
      );
    }
  }

  setEngine(on) {
    this.engineOn = on;
    if (!on && this.nodes.engine) {
      const t = this.ctx.currentTime;
      for (const n of [this.nodes.engine.gain, this.nodes.wind.gain, this.nodes.surface.gain, this.nodes.slip.gain, this.nodes.turbo.gain]) {
        n.gain.setTargetAtTime(0, t, 0.12);
      }
    }
  }

  update(dt, state) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this.nodes;
    const active = this.engineOn && !state.paused;
    const rpm = clamp(state.rpm || 900, 800, 8400);
    const rpmN = rpm / 8400;
    const throttle = clamp(state.throttle || 0, 0, 1);
    const boost = clamp(state.boost || 0, 0, 1);
    const speed = clamp((state.speedKph || 0) / 220, 0, 1.2);
    const load = active ? 0.4 + throttle * 0.6 : 0;
    const cylinders = state.cylinders || 4;
    const fire = clamp((rpm / 60) * (cylinders / 2), 26, 260);
    const f1 = state.audioF1 || 1;

    // engine
    n.engine.osc1.frequency.setTargetAtTime(fire * f1, t, 0.02);
    n.engine.osc2.frequency.setTargetAtTime(fire * 2.02 * f1, t, 0.02);
    n.engine.sub.frequency.setTargetAtTime(fire * 0.5, t, 0.03);
    n.engine.filter.frequency.setTargetAtTime(420 + rpmN * 2600 + throttle * 800, t, 0.03);
    n.engine.gain.gain.setTargetAtTime(
      active ? (0.016 + rpmN * 0.045 + throttle * 0.052) * (0.55 + (state.audioRasp || 0.7) * 0.5) : 0,
      t, 0.035
    );
    n.engine.raspGain.gain.setTargetAtTime(active ? (0.003 + throttle * 0.023) * (state.audioRasp || 0.7) : 0, t, 0.05);
    n.engine.raspFilter.frequency.setTargetAtTime(900 + rpmN * 2800, t, 0.04);

    // turbo
    const turboFreq = 2800 + rpmN * 4600 + boost * 1400;
    n.turbo.osc.frequency.setTargetAtTime(turboFreq, t, 0.05);
    n.turbo.gain.gain.setTargetAtTime(active ? boost * 0.012 * (state.audioTurbo || 1) : 0, t, 0.08);
    n.turbo.noiseGain.gain.setTargetAtTime(active ? boost * 0.008 * (state.audioTurbo || 1) : 0, t, 0.08);

    // wind / surface
    n.wind.gain.gain.setTargetAtTime(active ? speed * speed * 0.045 : 0, t, 0.08);
    n.wind.filter.frequency.setTargetAtTime(350 + speed * 900, t, 0.08);
    const surface = state.surface || 'gravel';
    const surfColor = surface === 'snow' ? 520 : surface === 'mud' ? 380 : surface === 'ice' ? 900 : 1050;
    n.surface.filter.frequency.setTargetAtTime(surfColor + speed * 900, t, 0.08);
    n.surface.gain.gain.setTargetAtTime(active ? speed * 0.09 * (state.offRoad ? 1.5 : 1) : 0, t, 0.06);
    const slip = clamp(state.slip || 0, 0, 1);
    n.slip.gain.gain.setTargetAtTime(active ? slip * 0.06 : 0, t, 0.04);

    // idle blip when stopped in gear
    if (active && (state.speedKph || 0) < 1) {
      n.engine.gain.gain.setTargetAtTime(0.013 + throttle * 0.06, t, 0.08);
    }

    // crackle on lift
    this.crackleCooldown = Math.max(0, this.crackleCooldown - dt);
    if (active && this.prevThrottle > 0.55 && throttle < 0.15 && boost > 0.35 && this.crackleCooldown <= 0) {
      this.crackleCooldown = 0.32 + Math.random() * 0.35;
      this._crackle(boost);
    }
    this.prevThrottle = throttle;
  }

  _crackle(intensity) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900 + Math.random() * 900;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, t);
    gain.gain.linearRampToValueAtTime(0.12 * intensity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(filter).connect(gain).connect(this.nodes.master);
    src.start(t, Math.random());
    src.stop(t + 0.14);
  }

  impact(strength = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.4 + Math.random() * 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380 + Math.random() * 300;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.32 * strength, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(filter).connect(gain).connect(this.nodes.master);
    src.start(t);
    src.stop(t + 0.4);
    // low thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(85, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.28 * strength, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g2).connect(this.nodes.master);
    osc.start(t);
    osc.stop(t + 0.28);
  }

  thunder(strength = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.22 + Math.random() * 0.16;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, t);
    filter.frequency.exponentialRampToValueAtTime(110, t + 2.2);
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.55 * strength, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    src.connect(filter).connect(gain).connect(this.nodes.master);
    src.start(t);
    src.stop(t + 2.8);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(48, t);
    osc.frequency.exponentialRampToValueAtTime(26, t + 1.4);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.22 * strength, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    osc.connect(g2).connect(this.nodes.master);
    osc.start(t);
    osc.stop(t + 1.7);
  }

  beep(freq = 880, duration = 0.12, volume = 0.08, type = 'square') {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.nodes.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  click() {
    this.beep(1400, 0.035, 0.025, 'triangle');
  }

  speak(text) {
    if (!this.settings.voice) return;
    if (!('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.lang = (this.voice && this.voice.lang) || 'en-GB';
      u.rate = 1.17;
      u.pitch = 0.92;
      u.volume = this.settings.muted ? 0 : Math.min(1, this.settings.volume + 0.1);
      speechSynthesis.speak(u);
    } catch { /* speech not available */ }
  }

  hushVoice() {
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }

  suspend() {
    this.setEngine(false);
    this.hushVoice();
  }
}
