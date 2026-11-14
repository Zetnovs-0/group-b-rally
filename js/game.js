import * as THREE from 'three';
import {
  STAGES, getBest, setBest, resolveConditions, CAMERA_MODES,
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
import { Headlights, WindscreenFX } from './effects.js';
import { TouchControls } from './touch.js';

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

function cameraAbbrev(mode) {
  return { cockpit: 'CPT', bonnet: 'BON', chase: 'CHS', bumper: 'BMP' }[mode] || 'CAM';
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
    this.headlights = null;
    this.glassFx = null;
    this.conditions = null;
    this.baseStage = null;
    this.cameraMode = CAMERA_MODES.some((m) => m.id === this.settings.camera)
      ? this.settings.camera
      : 'cockpit';
    this.settings.camera = this.cameraMode;
    this.cameraLook = new THREE.Vector3();
    this.cameraPos = new THREE.Vector3();
    this.chasePos = new THREE.Vector3();
    this.chaseReady = false;
    this.flashPulse = 0;
    this.touch = null;
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
    this.touch = new TouchControls(this.input, {
      onPause: () => this._pausePressed(),
      onCamera: () => this.cycleCamera(),
      onRecover: () => this.recoverCar(),
      onUiSound: () => { this.audio.init(); this.audio.click(); },
    });
    this.glassFx = new WindscreenFX(document.getElementById('glass-fx'));
    let mobileTuned = false;
    try { mobileTuned = !!localStorage.getItem('gbr.mobile.tuned'); } catch { /* ignore */ }
    if (this.touch.isTouch && !mobileTuned) {
      if (this.settings.quality === 'high') {
        this.settings.quality = 'medium';
        this.ui.settings.quality = 'medium';
        this.ui.commitSettings();
      }
      try { localStorage.setItem('gbr.mobile.tuned', '1'); } catch { /* ignore */ }
      this._applyRendererQuality();
    }
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
    this.ui.onCamera = () => this.cycleCamera();
    this.ui.onUiSound = () => { this.audio.init(); this.audio.click(); };
    this.ui.settings.showHints = this.ui.settings.showHints !== false;
  }

  _bindInput() {
    this.input.onPause = () => this._pausePressed();
    this.input.onReset = () => this.recoverCar();
    this.input.onMute = () => this.toggleMute();
    this.input.onHelp = () => this._helpPressed();
    this.input.onCamera = () => this.cycleCamera();
  }

  /* ============================================================
     SETTINGS / STATE
     ============================================================ */
  _applySettings(initial = false) {
    this.input.lookSens = this.settings.lookSensitivity;
    this.audio.setSettings(this.settings);
    this._applyRendererQuality();
    if (this.weather) this.weather.setEnabled(this.settings.weatherFx);
    const validCamera = CAMERA_MODES.some((m) => m.id === this.settings.camera)
      ? this.settings.camera
      : 'cockpit';
    if (this.settings.camera !== validCamera) this.settings.camera = validCamera;
    if (this.cameraMode !== validCamera) {
      this.cameraMode = validCamera;
      this._setCameraMode(validCamera, true);
    }
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
    if (this.touch?.isTouch) {
      try {
        if (!document.fullscreenElement) {
          const p = document.documentElement.requestFullscreen?.();
          if (p && p.catch) p.catch(() => {});
        }
      } catch { /* ignore */ }
      this.touch.requestLandscape();
    }
    this.ui.closeModals();
    this.ui.hideMenu();
    this.ui.hideResults();
    this.ui.hidePause();
    this.ui.hideCountdown();
    const conditions = resolveConditions(stage, this.settings.weather, this.settings.timeOfDay);
    this.ui.showLoading(stage, car, conditions);
    this.ui.setStartEnabled(false);
    this.ui.showGameHints(false);
    this.touch?.setVisible(false);
    this.audio.init();
    this.audio.setEngine(false);
    this.audio.hushVoice();
    this.state = 'loading';
    this._hintTimer && clearTimeout(this._hintTimer);
    try {
      await this._buildStage(car, stage, conditions);
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

  async _buildStage(car, stage, conditions) {
    this._disposeStage();
    this.car = car;
    this.baseStage = stage;
    this.conditions = conditions || resolveConditions(stage, this.settings.weather, this.settings.timeOfDay);
    // resolve the chosen time/weather into a run-local stage copy so the
    // shared config (and the menu art) stay untouched.
    this.stage = {
      ...stage,
      env: this.conditions.env,
      baseGrip: stage.baseGrip * this.conditions.gripMul,
      conditions: this.conditions,
    };
    this.stageMetrics = getStageMetrics(stage);
    this.ui.setLoading(5, 'PLOTTING THE ROUTE');
    await nextFrame();
    this.scene = new THREE.Scene();
    const quality = this.settings.quality;
    this.track = new Track(this.stage, quality);
    this.track.timeOfDay = this.conditions.time;
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

    this.weather = new WeatherFX(this.stage, quality, this.settings.weatherFx);
    this.weather.onLightning = () => this._lightning();
    this.scene.add(this.weather.group);

    this.headlights = new Headlights(this.carRoot, car, this.stage.env);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.025, 2800);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0, Math.PI, 0);
    this.headBase.copy(this.carModel.headRig.position);
    this._setCameraMode(this.cameraMode, true);
    this.cameraLook.set(0, 0, 0);

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
    this.track.updateSun(this.physics.pos, 0);
    this.chaseReady = false;
    this._updateHeadlights(0.016);
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
    this.chaseReady = false;
    this._updateHeadlights(0.016);
    this._updateCamera(0, true);
    this._updateCockpit(0, true);
    this.ui.hidePause();
    this.ui.hideResults();
    this.ui.showGameHints(false);
    this.ui.hideCountdown();
    this.touch?.setVisible(false);
    this.touch?.requestLandscape();
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
    if (!this.touch?.isTouch) this.ui.showGameHints(true);
    this.touch?.setVisible(true);
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
    this.touch?.setVisible(false);
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
    this.glassFx?.update(0.016, { rain: 0 });
    this.touch?.setVisible(false);
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
    this.touch?.setVisible(true);
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
    this.track.updateSun(this.physics.pos, dt);
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
    this._emitSkids(dt);
    this.track.updateSun(this.physics.pos, dt);
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
    this.track.updateSun(this.physics.pos, dt);
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

  /* ============================================================
     CAMERAS
     ============================================================ */
  cycleCamera() {
    const ids = CAMERA_MODES.map((m) => m.id);
    const i = ids.indexOf(this.cameraMode);
    this.setCameraMode(ids[(i + 1) % ids.length]);
  }

  setCameraMode(mode) {
    if (!CAMERA_MODES.some((m) => m.id === mode)) return;
    this.cameraMode = mode;
    this.settings.camera = mode;
    this.ui.settings.camera = mode;
    this.ui.commitSettings?.();
    this.ui.setCameraValue?.(mode);
    this.touch?.setCameraLabel(cameraAbbrev(mode));
    this._setCameraMode(mode, false);
    if (this.state === 'racing' || this.state === 'countdown' || this.state === 'finishing') {
      const label = CAMERA_MODES.find((m) => m.id === mode)?.label || mode.toUpperCase();
      this.ui.toast(`CAMERA · ${label}`, 1200);
    }
  }

  _setCameraMode(mode, initial = false) {
    if (!this.camera || !this.carModel) return;
    const m = this.carModel;
    const st = this.car.style;
    if (this.camera.parent) this.camera.parent.remove(this.camera);
    this.chaseReady = false;
    if (mode === 'cockpit') {
      m.headRig.add(this.camera);
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, Math.PI, 0);
      this.camera.near = 0.025;
    } else if (mode === 'bonnet') {
      m.group.add(this.camera);
      this.camera.position.set(0, 1.0, st.cabinFront + 0.44);
      this.camera.rotation.set(-0.06, Math.PI, 0);
      this.camera.near = 0.05;
    } else if (mode === 'bumper') {
      this.carRoot.add(this.camera);
      this.camera.position.set(0, 0.46, st.length / 2 + 0.34);
      this.camera.rotation.set(-0.045, Math.PI, 0);
      this.camera.near = 0.05;
    } else {
      this.scene.add(this.camera);
      this.camera.position.set(0, 3, -8);
      this.camera.rotation.set(0, 0, 0);
      this.camera.near = 0.08;
    }
    this.camera.updateProjectionMatrix();
    const exterior = mode !== 'cockpit';
    m.exteriorBits.forEach((o) => { o.visible = exterior; });
    if (mode === 'bonnet' && m.frontPivots) m.frontPivots.forEach((p) => { p.visible = false; });
    m.group.visible = mode !== 'bumper';
    if (mode !== 'cockpit') {
      m.headRig.position.copy(this.headBase);
      m.headRig.rotation.set(0, 0, 0);
    }
    if (this.ui) {
      this.ui.setCameraValue?.(mode);
      this.touch?.setCameraLabel(cameraAbbrev(mode));
    }
    if (!initial) this._updateCamera(0.016, true);
  }

  _cameraShake(speedRatio, mode) {
    if (!this.settings.shake) return { amp: 0, t: 0 };
    const p = this.physics;
    const rough = p?.info?.offRoad ? 1.8 : 0;
    const factor = mode === 'cockpit' ? 1 : mode === 'bonnet' ? 1.25 : mode === 'bumper' ? 1.4 : 0.75;
    const amp = (0.0011 + speedRatio * 0.0022 + rough * 0.0045 + this.shakeImpulse * 0.017) * factor;
    return { amp, t: performance.now() / 1000 };
  }

  _updateCamera(dt = 0.016, initial = false) {
    if (!this.camera || !this.carModel) return;
    const p = this.physics;
    const speedRatio = clamp((p?.speedKph || 0) / 220, 0, 1);
    const mode = this.cameraMode;
    const { amp, t } = initial ? { amp: 0, t: 0 } : this._cameraShake(speedRatio, mode);
    const sx = (Math.sin(t * 39.1) + Math.sin(t * 61.7) * 0.5) * amp;
    const sy = (Math.sin(t * 47.3) + Math.sin(t * 88.1) * 0.35) * amp;
    const roll = Math.sin(t * 31.3) * amp * 0.55;

    if (mode === 'chase') {
      this._updateChaseCamera(dt, initial, speedRatio, sx, sy, roll);
    } else {
      const head = this.carModel.headRig;
      if (mode === 'cockpit') {
        head.position.set(this.headBase.x + sx, this.headBase.y + sy, this.headBase.z + Math.sin(t * 53.7) * amp * 0.5);
        head.rotation.y = this.cameraBaseYaw + this.input.lookYaw;
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.set(
          this.input.lookPitch + sy * 0.35 + (p?.pitch || 0) * 0.12,
          Math.PI - this.input.lookYaw * 0.02,
          roll
        );
      } else {
        head.position.copy(this.headBase);
        head.rotation.y = 0;
        const baseY = mode === 'bonnet' ? 1.0 : 0.46;
        const baseZ = mode === 'bonnet' ? this.car.style.cabinFront + 0.44 : this.car.style.length / 2 + 0.34;
        const basePitch = mode === 'bonnet' ? -0.06 : -0.045;
        this.camera.position.set(
          sx + this.input.lookYaw * 0.08,
          baseY + sy,
          baseZ + Math.sin(t * 53.7) * amp * 0.6
        );
        this.camera.rotation.set(
          basePitch + this.input.lookPitch + sy * 0.4 + (p?.pitch || 0) * 0.35,
          Math.PI + this.input.lookYaw * 0.55,
          roll + (p?.roll || 0) * 0.25
        );
      }
    }

    const baseFov = (CAMERA_MODES.find((m) => m.id === mode) || CAMERA_MODES[0]).fov;
    const targetFov = baseFov + speedRatio * (mode === 'chase' ? 9 : mode === 'cockpit' ? 6 : 4.5);
    const nf = damp(this.camera.fov, targetFov, 2.2, dt || 0.016);
    if (Math.abs(nf - this.camera.fov) > 0.01) {
      this.camera.fov = nf;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  _updateChaseCamera(dt, initial, speedRatio, sx, sy, roll) {
    const p = this.physics;
    const carPos = this.carRoot.position;
    const yaw = p ? p.yaw : 0;
    const orbit = yaw + this.input.lookYaw * 0.85;
    const back = 6.0 + speedRatio * 2.4;
    const height = 2.25 + Math.abs(this.input.lookPitch) * 2.2;
    const dx = Math.sin(orbit) * back;
    const dz = Math.cos(orbit) * back;
    const desired = this.cameraPos.set(carPos.x - dx, carPos.y + height, carPos.z - dz);

    // keep the chase cam out of the ground
    if (this.track) {
      const info = this.track.nearestGlobal(desired);
      if (info) {
        const lat = (desired.x - info.center.x) * info.right.x + (desired.z - info.center.z) * info.right.z;
        const gh = this.track.heightAtSample(info.index, lat);
        if (desired.y < gh + 1.1) desired.y = gh + 1.1;
      }
    }

    if (initial || !this.chaseReady) {
      this.chasePos.copy(desired);
      this.chaseReady = true;
    } else {
      const k = 1 - Math.exp(-6.5 * Math.min(0.05, dt || 0.016));
      this.chasePos.lerp(desired, k);
    }
    this.camera.position.set(this.chasePos.x + sx, this.chasePos.y + sy, this.chasePos.z);
    this.cameraLook.set(
      carPos.x + Math.sin(yaw) * (8 + speedRatio * 6),
      carPos.y + 0.95 - this.input.lookPitch * 9,
      carPos.z + Math.cos(yaw) * (8 + speedRatio * 6)
    );
    this.camera.lookAt(this.cameraLook);
    this.camera.rotation.z += roll * 0.5;
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
    } : null, this.tmpWheels, this.stage.env.stars || 0);
    if (this.weather.flash > 0) this.track.setFlash(Math.max(this.track.flash, this.weather.flash));

    this._updateHeadlights(dt);

    if (this.glassFx) {
      const kind = this.stage.env.weather;
      const rain = kind === 'rain'
        ? (this.stage.env.weatherIntensity || 1)
        : kind === 'snow' ? 0.42 : (this.stage.env.wetness || 0) > 0.55 ? 0.35 : 0;
      this.glassFx.update(dt, {
        rain: this.settings.weatherFx ? rain : 0,
        intensity: this.stage.env.weatherIntensity || 1,
        speedKph: p?.speedKph || 0,
        enabled: this.cameraMode === 'cockpit' &&
          Math.abs(this.input.lookYaw) < 0.5 &&
          Math.abs(this.input.lookPitch) < 0.32,
        clip: true,
      });
    }
  }

  _updateHeadlights(dt) {
    if (!this.headlights) return;
    let level = this.stage?.env?.headlights || 0;
    if (this.settings.headlights === false) level = 0;
    this.headlights.update(dt, level);
  }

  _lightning() {
    if (this.track) this.track.setFlash(1);
    this.shakeImpulse = Math.min(1.3, this.shakeImpulse + 0.3);
    this.audio.thunder?.(0.65 + Math.random() * 0.5);
  }

  _emitSkids(dt) {
    const p = this.physics;
    if (!p || !this.track || !this.track.emitSkid) return;
    if (!p.info || p.info.offRoad) return;
    const speed = p.speedKph || 0;
    const slip = Math.abs(p.lateralSpeed || 0);
    const active = speed > 10 && (slip > 2.2 || (p.handbrake || 0) > 0.3);
    if (!active) {
      this.skidAccum = 0;
      return;
    }
    this.skidAccum = (this.skidAccum || 0) + Math.abs(p.forwardSpeed || 0) * dt;
    if (this.skidAccum < 0.55) return;
    this.skidAccum = 0;
    const back = (this.car.style.length * 0.56) / 2;
    const pos = {
      x: p.pos.x - Math.sin(p.yaw) * back,
      y: p.info.height,
      z: p.pos.z - Math.cos(p.yaw) * back,
    };
    this.track.emitSkid(pos, p.yaw, 0.68);
    this.track.emitSkid(pos, p.yaw, -0.68);
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
    this.glassFx?.update(0.016, { rain: 0 });
    this.touch?.setVisible(false);
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
      conditions: this.conditions,
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
    if (this.headlights) this.headlights.dispose();
    if (this.scene) {
      disposeObject(this.scene);
    }
    if (this.glassFx) this.glassFx.update(0.016, { rain: 0 });
    this.headlights = null;
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
    this.glassFx?.resize();
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
