import * as THREE from 'three';
import {
  STAGES, getBest, setBest,
} from './config.js';
import { clamp, damp, nextFrame, disposeObject } from './util.js';
import { UI } from './ui.js';
import { MenuPreview } from './menuPreview.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Track, getStageMetrics } from './track.js';
import { createCarModel } from './carModel.js';
import { CarPhysics } from './physics.js';
import { Cockpit } from './cockpit.js';
import { WeatherFX } from './weather.js';

const PHYS_STEP = 1 / 120;

const RANK_NOTES = {
  S: 'Untouchable. The trees will remember that one.',
  A: 'Clean and committed. A proper Group B run.',
  B: 'Tidy stage. There is more time hiding in the fast stuff.',
  C: 'You survived. Now go and find the grip.',
};

function severityWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);
}

function notePhrase(note) {
  if (!note) return '';
  if (note.kind === 'turn' || note.kind === 'hairpin') {
    const dir = note.dir > 0 ? 'left' : 'right';
    const core = note.kind === 'hairpin' ? `hairpin ${dir}` : `${dir} ${severityWord(note.severity)}`;
    return note.modifier ? `${core}, ${note.modifier.toLowerCase()}` : core;
  }
  if (note.kind === 'hazard') return note.text.toLowerCase();
  if (note.kind === 'crest') return 'crest';
  if (note.kind === 'jump') return 'jump';
  if (note.kind === 'straight') return 'straight';
  if (note.kind === 'finish') return 'finish, flat out';
  return note.text.toLowerCase();
}

export class Game {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.ui = new UI();
    this.settings = this.ui.settings;
    this.audio = new AudioEngine(this.settings);
    this.preview = new MenuPreview(renderer);
    this.input = new Input(canvas);
    this.state = 'menu';
    this.scene = null;
    this.camera = null;
    this.track = null;
    this.car = null;
    this.stage = null;
    this.carModel = null;
    this.physics = null;
    this.cockpit = null;
    this.weather = null;
    this.time = 0;
    this.bestTime = null;
    this.physAcc = 0;
    this.countdownTime = 0;
    this.countdownShown = 3;
    this.countdownHide = 0;
    this.startLightCount = -1;
    this.radioTimer = 0;
    this.announceCooldown = 0;
    this.shakeImpulse = 0;
    this.finishTimer = 0;
    this.resultsShown = false;
    this.finishTime = 0;
    this.pausedFrom = null;
    this.tmpVec = new THREE.Vector3();
    this.tmpWheels = [new THREE.Vector3(), new THREE.Vector3()];
    this.headBase = new THREE.Vector3();
    this.cameraBaseYaw = -0.03;
    this._hintTimer = null;
    this._countdownTimer = null;
    this._bindUI();
    this._bindInput();
    this._applySettings(true);
    this.preview.setCar(this.ui.selectedCar);
    this.preview.setStage(this.ui.selectedStage);
    this.preview.resize(window.innerWidth, window.innerHeight);
    window.__GAME = this;
  }

  _bindUI() {
    this.ui.onStart = (car, stage) => this.startStage(car, stage);
    this.ui.onSelection = (car, stage) => {
      this.preview.setCar(car);
      this.preview.setStage(stage);
    };
    this.ui.onSettingsChange = (settings) => this._onSettingsChanged(settings);
    this.ui.onResume = () => this.resume();
    this.ui.onRestart = () => this.restartStage();
    this.ui.onQuit = () => this.quitToMenu();
    this.ui.onNextStage = () => this.nextStage();
    this.ui.onUiSound = () => { this.audio.init(); this.audio.click(); };
    this.ui.settings.showHints = this.ui.settings.showHints !== false;
  }

  _bindInput() {
    this.input.onPause = () => this._pausePressed();
    this.input.onReset = () => this.recoverCar();
    this.input.onMute = () => this.toggleMute();
    this.input.onHelp = () => this._helpPressed();
  }

  /* ============================================================
     SETTINGS / STATE
     ============================================================ */
  _applySettings(initial = false) {
    this.input.lookSens = this.settings.lookSensitivity;
    this.audio.setSettings(this.settings);
    this._applyRendererQuality();
    if (this.weather) this.weather.setEnabled(this.settings.weatherFx);
    if (this.cockpit) {
      this.cockpit.settings = this.settings;
      this.cockpit.speedUnit = this.settings.units === 'mph' ? 'MPH' : 'KM/H';
    }
    if (!this.settings.shake) this.shakeImpulse = 0;
  }

  _applyRendererQuality() {
    const q = this.settings.quality;
    const cap = q === 'high' ? Math.min(window.devicePixelRatio || 1, 1.8)
      : q === 'medium' ? Math.min(window.devicePixelRatio || 1, 1.35) : 1;
    this.renderer.setPixelRatio(cap);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  _onSettingsChanged(settings) {
    this.settings = settings;
    this._applySettings(false);
    if (!settings.voice && this.audio) this.audio.hushVoice();
  }

  toggleMute() {
    const muted = this.ui.toggleMute();
    this.audio.setSettings(this.ui.settings);
    this.settings = this.ui.settings;
  }

  _pausePressed() {
    if (this.ui.hasModalOpen()) {
      this.ui.closeModals();
      return;
    }
    if (this.state === 'paused') {
      this.resume();
      return;
    }
    if (this.state === 'racing') {
      this.pause();
    }
  }

  _helpPressed() {
    if (this.state === 'menu' || this.state === 'finished') {
      this.ui.openHelp();
      return;
    }
    if (this.state === 'paused') {
      this.ui.openHelp();
      return;
    }
    if (this.state === 'racing') {
      this.pause();
      this.ui.openHelp();
    }
  }

  /* ============================================================
     STAGE LIFECYCLE
     ============================================================ */
  async startStage(car, stage) {
    if (this.state === 'loading') return;
    if (!car || !stage) return;
    this.ui.closeModals();
    this.ui.hideMenu();
    this.ui.hideResults();
    this.ui.hidePause();
    this.ui.hideCountdown();
    this.ui.showLoading(stage, car);
    this.ui.setStartEnabled(false);
    this.ui.showGameHints(false);
    this.audio.init();
    this.audio.setEngine(false);
    this.audio.hushVoice();
    this.state = 'loading';
    this._hintTimer && clearTimeout(this._hintTimer);
    try {
      await this._buildStage(car, stage);
      this.ui.setLoading(100, 'READY TO RUN');
      await nextFrame();
      this.ui.hideLoading();
      this._beginCountdown();
    } catch (err) {
      console.error('Stage build failed', err);
      this.ui.hideLoading();
      this.ui.showMenu();
      this.ui.setStartEnabled(true);
      this.state = 'menu';
      this.ui.toast('STAGE BUILD FAILED — SEE CONSOLE');
    }
  }

  async _buildStage(car, stage) {
    this._disposeStage();
    this.car = car;
    this.stage = stage;
    this.stageMetrics = getStageMetrics(stage);
    this.ui.setLoading(5, 'PLOTTING THE ROUTE');
    await nextFrame();
    this.scene = new THREE.Scene();
    const quality = this.settings.quality;
    this.track = new Track(stage, quality);
    this.ui.setLoading(12, 'RAISING THE SKY');
    await nextFrame();
    this.track.buildSky(this.scene);
    this.renderer.toneMappingExposure = stage.env.exposure || 1.04;
    this.ui.setLoading(20, 'SHAPING TERRAIN');
    await nextFrame();
    await this.track.buildTerrain(this.scene, quality);
    this.ui.setLoading(48, 'CUTTING THE ROAD');
    await nextFrame();
    this.track.buildRoad(this.scene);
    this.ui.setLoading(58, 'SETTING THE GATES');
    await nextFrame();
    this.track.buildProps(this.scene, quality);
    this.ui.setLoading(64, 'PLANTING THE CANOPY');
    await nextFrame();
    this.track.buildScenery(this.scene, quality);
    this.ui.setLoading(88, 'ROLLING OUT THE CAR');
    await nextFrame();

    this.carModel = createCarModel(car, { withInterior: true, menu: false });
    this.carRoot = new THREE.Group();
    this.carRoot.rotation.order = 'YXZ';
    this.carRoot.add(this.carModel.group);
    this.scene.add(this.carRoot);
    this.carModel.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    // wheels and fender flares sit outside the cockpit shell; hide them from the
    // interior view so they cannot poke through the open footwell.
    this.carModel.exteriorBits.forEach((o) => { o.visible = false; });

    this.physics = new CarPhysics(car, this.track, {
      onImpact: (strength) => {
        this.shakeImpulse = Math.min(1.3, this.shakeImpulse + strength * 1.1);
        this.audio.impact(strength);
      },
    });
    this.cockpit = new Cockpit({ track: this.track, stage, car, settings: this.settings });
    this.cockpit.attach(this.carModel);

    this.weather = new WeatherFX(stage, quality, this.settings.weatherFx);
    this.scene.add(this.weather.group);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.025, 1600);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0, Math.PI, 0);
    this.carModel.headRig.add(this.camera);
    this.headBase.copy(this.carModel.headRig.position);

    this.ui.setLoading(95, 'HEATING THE TYRES');
    await nextFrame();
    this._prepareRun();
    this.ui.setLoading(100, 'READY TO RUN');
  }

  _prepareRun() {
    this.physics.reset(this.track, true);
    this.bestTime = getBest(this.stage.id, this.car.id);
    this.track.notes.forEach((n) => { n.announced = false; });
    this.time = 0;
    this.radioTimer = 0;
    this.announceCooldown = 0;
    this.physAcc = 0;
    this.shakeImpulse = 0;
    this.finishTimer = 0;
    this.resultsShown = false;
    this.finishTime = 0;
    this.track.updateStartLights(0);
    this.startLightCount = 0;
    this._updateCarTransform(0, true);
    this.track.updateSun(this.physics.pos);
    this._updateCamera(0, true);
    this._updateCockpit(0, true);
  }

  _beginCountdown() {
    this.state = 'countdown';
    this.time = 0;
    this.countdownTime = 3.0;
    this.countdownShown = 3;
    this.countdownHide = 0;
    this.radioTimer = 0;
    this.announceCooldown = 0;
    this.shakeImpulse = 0;
    this.resultsShown = false;
    this.finishTimer = 0;
    this.physAcc = 0;
    this.input.reset();
    this.input.lookSens = this.settings.lookSensitivity;
    this.physics.reset(this.track, true);
    this.track.notes.forEach((n) => { n.announced = false; });
    this.track.updateStartLights(0);
    this.startLightCount = 0;
    this._updateCarTransform(0, true);
    this.track.updateSun(this.physics.pos);
    this.headBase.copy(this.carModel.headRig.position);
    this._updateCamera(0, true);
    this._updateCockpit(0, true);
    this.ui.hidePause();
    this.ui.hideResults();
    this.ui.showGameHints(false);
    this._countdownTimer && clearTimeout(this._countdownTimer);
    this.ui.showCountdown(3, this.stage);
    this.audio.init();
    this.audio.setEngine(true);
    this.audio.beep(660, 0.12, 0.08, 'square');
  }

  _go() {
    this.state = 'racing';
    this.time = 0;
    this.countdownHide = 0.9;
    this.radioTimer = 1.9;
    this.announceCooldown = 1.1;
    this.track.updateStartLights(4);
    this.startLightCount = 4;
    this.ui.showCountdown(0, this.stage);
    this.ui.showGameHints(true);
    this.audio.beep(1180, 0.5, 0.12, 'square');
    this.audio.speak('Go go go.');
    this._hintTimer && clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.ui.fadeGameHints(), 8000);
    this._countdownTimer && clearTimeout(this._countdownTimer);
    this._countdownTimer = setTimeout(() => this.ui.hideCountdown(), 900);
  }

  restartStage() {
    if (this.state === 'loading' || !this.track) return;
    this.ui.closeModals();
    this.ui.hidePause();
    this.ui.hideResults();
    this.audio.init();
    this.audio.hushVoice();
    this._beginCountdown();
  }

  nextStage() {
    if (!this.stage) return;
    const idx = STAGES.findIndex((s) => s.id === this.stage.id);
    const next = STAGES[(idx + 1) % STAGES.length];
    this.ui.selectStage(next.id);
    this.startStage(this.ui.selectedCar, next);
  }

  quitToMenu() {
    this.ui.hidePause();
    this.ui.hideResults();
    this.ui.hideCountdown();
    this._countdownTimer && clearTimeout(this._countdownTimer);
    this.ui.closeModals();
    this.ui.showMenu();
    this.ui.setStartEnabled(true);
    this.ui.showGameHints(false);
    this.audio.setEngine(false);
    this.audio.hushVoice();
    this.state = 'menu';
    this.pausedFrom = null;
    this._disposeStage();
    this.input.reset();
    this.renderer.toneMappingExposure = 1.04;
    this.preview.setCar(this.ui.selectedCar);
    this.preview.setStage(this.ui.selectedStage);
    this.ui.toast('BACK IN THE GARAGE');
  }

  pause() {
    if (this.state !== 'racing') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.input.reset();
    this.ui.showPause({
      stage: this.stage,
      car: this.car,
      time: this.time,
    });
    this.ui.showGameHints(false);
    this.ui.hideCountdown();
    this.audio.setEngine(false);
    this.audio.hushVoice();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hidePause();
    this.ui.closeModals();
    this.state = this.pausedFrom || 'racing';
    this.pausedFrom = null;
    this.input.reset();
    this.audio.init();
    this.audio.setEngine(true);
  }

  recoverCar() {
    if (this.state !== 'racing' || !this.physics) return;
    this.physics.resetToTrack(this.track);
    this.time += 3;
    this.physAcc = 0;
    this.shakeImpulse = 0;
    this._updateCarTransform(0, true);
    this._updateCamera(0, true);
    this.audio.beep(300, 0.18, 0.08, 'sine');
    this.ui.toast('RECOVERY · +3.0 S');
  }

  /* ============================================================
     UPDATE
     ============================================================ */
  update(dt) {
    dt = Math.min(0.05, Math.max(0, dt));
    switch (this.state) {
      case 'menu':
        this.input.update(dt);
        this.preview.update(dt);
        break;
      case 'loading':
        break;
      case 'countdown':
        this._updateCountdown(dt);
        break;
      case 'racing':
        this._updateRacing(dt);
        break;
      case 'paused':
        this.renderScene();
        break;
      case 'finishing':
        this._updateFinishing(dt);
        break;
      case 'finished':
        this.renderScene();
        break;
      default:
        break;
    }
  }

  _updateCountdown(dt) {
    this.countdownTime -= dt;
    this.input.update(dt);
    const display = Math.max(0, Math.ceil(this.countdownTime));
    if (display !== this.countdownShown && display > 0) {
      this.countdownShown = display;
      this.ui.showCountdown(display, this.stage);
      this.audio.beep(display === 1 ? 990 : 770, 0.12, 0.08, 'square');
    }
    const lights = this.countdownTime > 2 ? 1 : this.countdownTime > 1 ? 2 : this.countdownTime > 0 ? 3 : 4;
    if (lights !== this.startLightCount) {
      this.startLightCount = lights;
      this.track.updateStartLights(lights);
    }
    const virtual = this._virtualState();
    this._updateCarTransform(0);
    this._updateCamera(dt, false);
    this._updateCockpit(dt, false, virtual);
    this.track.updateSun(this.physics.pos);
    this._updateWeather(dt);
    this.audio.update(dt, this._audioState(virtual, true));
    this.renderScene();
    if (this.countdownTime <= 0) this._go();
  }

  _updateRacing(dt) {
    this.time += dt;
    if (this.countdownHide > 0) {
      this.countdownHide -= dt;
      if (this.countdownHide <= 0) this.ui.hideCountdown();
    }
    this.input.update(dt);
    this.input.lookSens = this.settings.lookSensitivity;

    this.physAcc += dt;
    let steps = 0;
    while (this.physAcc >= PHYS_STEP && steps < 12) {
      this.physics.step(PHYS_STEP, this.input.state(), this.track);
      this.physAcc -= PHYS_STEP;
      steps++;
    }
    if (steps === 12) this.physAcc = 0;

    this.radioTimer = Math.max(0, this.radioTimer - dt);
    this.announceCooldown = Math.max(0, this.announceCooldown - dt);
    this.shakeImpulse = Math.max(0, this.shakeImpulse - dt * 2.4);

    this._updateCarTransform(dt);
    this._updateCamera(dt, false);
    this._updateCockpit(dt, false);
    this._announceNotes(dt);
    this._updateWeather(dt);
    this.track.updateSun(this.physics.pos);
    this.audio.update(dt, this._audioState());
    this.renderScene();

    if (this.physics.finished && this.state === 'racing') {
      this._startFinish();
    }
  }

  _updateFinishing(dt) {
    this.input.update(dt);
    const finishInput = { throttle: 0, brake: 0.45, handbrake: 0, steer: this.input.steerTarget * 0.35 };
    this.physAcc += dt;
    let steps = 0;
    while (this.physAcc >= PHYS_STEP && steps < 10) {
      this.physics.step(PHYS_STEP, finishInput, this.track);
      this.physAcc -= PHYS_STEP;
      steps++;
    }
    this.radioTimer = Math.max(0, this.radioTimer - dt);
    this.finishTimer -= dt;
    this.shakeImpulse = Math.max(0, this.shakeImpulse - dt * 2.4);
    this._updateCarTransform(dt);
    this._updateCamera(dt, false);
    this._updateCockpit(dt, false);
    this._updateWeather(dt);
    this.audio.update(dt, this._audioState());
    this.track.updateSun(this.physics.pos);
    this.renderScene();
    if (this.finishTimer <= 0 && !this.resultsShown) {
      this._showResults();
    }
  }

  renderScene() {
    if (this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _updateCarTransform(dt, initial = false) {
    if (!this.physics || !this.carRoot) return;
    const p = this.physics;
    const speed = p.speedKph;
    const rough = p.info && p.info.offRoad ? 1 : 0;
    const bump = this.settings.shake
      ? Math.sin(p.odometer * 6.1) * 0.0045 * clamp(speed / 90, 0, 1) +
        Math.sin(p.odometer * 13.7) * 0.0015 * clamp(speed / 140, 0, 1) * (1 + rough * 2)
      : 0;
    this.carRoot.position.set(p.pos.x, p.pos.y + bump, p.pos.z);
    this.carRoot.rotation.order = 'YXZ';
    this.carRoot.rotation.set(p.pitch, p.yaw, p.roll);
    const spin = p.wheelRotation;
    for (const w of this.carModel.wheelSpin) w.rotation.x = spin;
    for (const piv of this.carModel.frontPivots) piv.rotation.y = p.steer;
    this.carRoot.updateMatrixWorld(true);
  }

  _updateCamera(dt, initial = false) {
    if (!this.camera || !this.carModel) return;
    const head = this.carModel.headRig;
    const p = this.physics;
    const speedRatio = clamp((p?.speedKph || 0) / 220, 0, 1);
    let amp = 0;
    if (this.settings.shake && !initial) {
      const rough = p?.info?.offRoad ? 1.8 : 0;
      amp = (0.0011 + speedRatio * 0.0022 + rough * 0.0045 + this.shakeImpulse * 0.017);
    }
    const t = performance.now() / 1000;
    const sx = (Math.sin(t * 39.1) + Math.sin(t * 61.7) * 0.5) * amp;
    const sy = (Math.sin(t * 47.3) + Math.sin(t * 88.1) * 0.35) * amp;
    const sz = Math.sin(t * 53.7) * amp * 0.5;
    head.position.set(this.headBase.x + sx, this.headBase.y + sy, this.headBase.z + sz);
    head.rotation.y = this.cameraBaseYaw + this.input.lookYaw;
    this.camera.rotation.x = this.input.lookPitch + sy * 0.28;
    this.camera.rotation.z = Math.sin(t * 31.3) * amp * 0.55;

    const targetFov = 75 + speedRatio * 6;
    const nf = damp(this.camera.fov, targetFov, 2.2, dt || 0.016);
    if (Math.abs(nf - this.camera.fov) > 0.01) {
      this.camera.fov = nf;
      this.camera.updateProjectionMatrix();
    }
  }

  _virtualState() {
    const info = this.physics?.info || this.track.nearestGlobal(this.physics?.pos || new THREE.Vector3());
    const steer = this.input ? this.input.steerTarget : 0;
    return {
      speedKph: 0,
      rpm: 950 + (this.input?.throttle || 0) * 3000,
      gear: 1,
      throttle: this.input?.throttle || 0,
      brake: this.input?.brake || 0,
      handbrake: this.input?.handbrake || 0,
      boost: (this.input?.throttle || 0) * 0.85,
      steer,
      time: 0,
      best: this.bestTime,
      progress: info.progress,
      dist: info.dist,
      info,
      notes: this.track.notesAhead(info.dist, 3),
      next: this.track.nextNote(info.dist),
      hazardAhead: this.track.hazardAhead(info.dist),
      radio: false,
      heading: info.heading,
      pos: info.center,
      coDriverSpeaking: 0,
      fixed: true,
    };
  }

  _updateCockpit(dt, initial = false, override = null) {
    if (!this.cockpit || !this.physics) return;
    let state = override;
    if (!state) {
      const p = this.physics;
      const info = p.info;
      const dist = info ? info.dist : 0;
      state = {
        speedKph: p.speedKph,
        rpm: p.rpm,
        gear: p.gear,
        throttle: p.throttle,
        brake: p.brake,
        handbrake: p.handbrake,
        boost: p.boost,
        steer: p.steer,
        time: this.time,
        best: this.bestTime,
        progress: info ? info.progress : 0,
        dist,
        info,
        notes: this.track.notesAhead(dist, 3),
        next: this.track.nextNote(dist),
        hazardAhead: this.track.hazardAhead(dist),
        radio: this.radioTimer > 0,
        heading: p.yaw,
        pos: p.pos,
        coDriverSpeaking: clamp(this.radioTimer / 2.0, 0, 1),
      };
    }
    this.cockpit.update(dt, state, this.carModel);
  }

  _updateWeather(dt) {
    if (!this.weather || !this.camera) return;
    this.camera.getWorldPosition(this.tmpVec);
    if (this.carRoot) {
      const wb = this.car.style.length * 0.56;
      const half = this.car.style.width / 2 - 0.1;
      this.tmpWheels[0].set(half, 0.06, -wb / 2);
      this.tmpWheels[1].set(-half, 0.06, -wb / 2);
      this.carRoot.localToWorld(this.tmpWheels[0]);
      this.carRoot.localToWorld(this.tmpWheels[1]);
    }
    const p = this.physics;
    this.weather.update(dt, this.tmpVec, p ? {
      speedKph: p.speedKph,
      offRoad: p.info?.offRoad,
      surface: this.stage.env.road,
    } : null, this.tmpWheels);
  }

  _announceNotes(dt) {
    if (!this.track || !this.physics) return;
    const info = this.physics.info;
    if (!info) return;
    const dist = info.dist;
    this.announceCooldown = Math.max(0, this.announceCooldown - dt);
    if (this.announceCooldown > 0) return;
    for (const note of this.track.notes) {
      if (note.announced) continue;
      const delta = note.dist - dist;
      const lead = note.kind === 'hazard' ? 150 : note.kind === 'finish' ? 120 : 118;
      if (delta < -7) {
        note.announced = true;
        continue;
      }
      if (delta > lead) break;
      if (delta <= lead) {
        note.announced = true;
        this._cueNote(note);
        return;
      }
    }
  }

  _cueNote(note) {
    const phrase = notePhrase(note);
    this.radioTimer = 1.9 + Math.min(1.1, phrase.length * 0.025);
    this.announceCooldown = note.kind === 'hazard' ? 0.75 : 1.05;
    this.audio.speak(phrase);
  }

  _audioState(virtual = null, countdown = false) {
    const p = this.physics;
    if (virtual) {
      return {
        rpm: virtual.rpm,
        throttle: virtual.throttle,
        boost: virtual.boost,
        speedKph: 0,
        surface: this.stage.env.road,
        offRoad: false,
        slip: 0,
        cylinders: this.car.audio.cylinders,
        audioF1: this.car.audio.f1,
        audioRasp: this.car.audio.rasp,
        audioTurbo: this.car.audio.turbo,
      };
    }
    const info = p?.info;
    let surface = this.stage.env.road;
    if (info?.hazard === 'ice') surface = 'ice';
    return {
      rpm: p?.rpm || 900,
      throttle: p?.throttle || 0,
      boost: p?.boost || 0,
      speedKph: p?.speedKph || 0,
      surface,
      offRoad: info?.offRoad,
      slip: clamp(Math.abs(p?.lateralSpeed || 0) / 6, 0, 1),
      cylinders: this.car.audio.cylinders,
      audioF1: this.car.audio.f1,
      audioRasp: this.car.audio.rasp,
      audioTurbo: this.car.audio.turbo,
    };
  }

  /* ============================================================
     FINISH
     ============================================================ */
  _startFinish() {
    this.state = 'finishing';
    this.finishTime = this.time;
    this.finishTimer = 1.45;
    this.resultsShown = false;
    this.ui.hideGameHints();
    this.audio.hushVoice();
    this.audio.speak('Finish. Stop the clock.');
    this.audio.beep(1320, 0.25, 0.08, 'triangle');
    this.radioTimer = 2.6;
  }

  _showResults() {
    this.resultsShown = true;
    this.state = 'finished';
    this.audio.setEngine(false);
    this.audio.hushVoice();
    const previousBest = getBest(this.stage.id, this.car.id);
    const isRecord = previousBest == null || this.finishTime < previousBest;
    if (isRecord) setBest(this.stage.id, this.car.id, this.finishTime);
    this.bestTime = isRecord ? this.finishTime : previousBest;
    const target = this.stageMetrics.target;
    const ratio = this.finishTime / target;
    const rank = ratio <= 1.03 ? 'S' : ratio <= 1.13 ? 'A' : ratio <= 1.26 ? 'B' : 'C';
    const delta = previousBest != null ? this.finishTime - previousBest : null;
    this.ui.showResults({
      stage: this.stage,
      car: this.car,
      length: this.track.length,
      time: this.finishTime,
      best: this.bestTime,
      delta,
      rank,
      isRecord,
      note: RANK_NOTES[rank],
    });
    this.ui.showGameHints(false);
    this._updateCockpit(0.016, false);
    this.renderScene();
  }

  /* ============================================================
     CLEANUP / RESIZE
     ============================================================ */
  _disposeStage() {
    this.audio.setEngine(false);
    this.audio.hushVoice();
    if (this.scene) {
      disposeObject(this.scene);
    }
    this.scene = null;
    this.camera = null;
    this.track = null;
    this.carModel = null;
    this.carRoot = null;
    this.physics = null;
    this.cockpit = null;
    this.weather = null;
    this.physAcc = 0;
    this.resultsShown = false;
    if (this.renderer) {
      this.renderer.renderLists.dispose();
    }
  }

  resize(w, h) {
    this.preview.resize(w, h);
    if (this.camera) {
      this.camera.aspect = Math.max(0.1, w / h);
      this.camera.updateProjectionMatrix();
    }
  }

  // debug/automation helpers
  debugState() {
    return {
      state: this.state,
      time: this.time,
      speedKph: this.physics?.speedKph,
      progress: this.physics?.info?.progress,
      car: this.car?.id,
      stage: this.stage?.id,
      gears: this.physics?.gear,
      rpm: this.physics?.rpm,
    };
  }
}
