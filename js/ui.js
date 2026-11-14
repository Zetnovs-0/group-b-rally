import {
  CARS, STAGES, getCar, getStage, loadSettings, saveSettings, getBest, clearBests,
  carDerived, BIOME_LABEL,
} from './config.js';
import { getStageMetrics } from './track.js';
import { formatTime, formatDelta } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const TIPS = [
  'Tip: The co-driver calls the road before you can see it. Trust the notes.',
  'Tip: Loose gravel sits on the racing line. Brake in a straight line, then turn.',
  'Tip: Snow tyres bite, but ice does not. Watch the grip meter on the trip computer.',
  'Tip: Group B cars make boost with lag. Stay on the throttle early to keep the turbo lit.',
  'Tip: Handbrake rotates the car on tight hairpins — but scrubs speed fast.',
  'Tip: You can drive onto the verge, but the tree line is hard and unforgiving.',
  'Tip: The map and timer are mounted in the car. Look down, not at a floating HUD.',
  'Tip: Heavier cars carry momentum. Brake earlier, and let the weight work for you.',
];

export class UI {
  constructor() {
    this.settings = loadSettings();
    const sel = this._loadSelection();
    this.selectedCarId = getCar(sel.car).id;
    this.selectedStageId = getStage(sel.stage).id;
    this.onStart = null;
    this.onRestart = null;
    this.onResume = null;
    this.onQuit = null;
    this.onNextStage = null;
    this.onSelection = null;
    this.onSettingsChange = null;
    this.onUiSound = null;
    this.settingsReturnPause = false;
    this.dom = {
      menu: $('#menu'),
      carList: $('#car-list'),
      stageList: $('#stage-list'),
      carSpec: $('#car-spec'),
      carFoot: $('#car-foot'),
      stageDetail: $('#stage-detail'),
      stageIntel: $('#stage-intel'),
      best: $('#best-display'),
      startBtn: $('#btn-start'),
      startMeta: $('.start-meta'),
      sceneIndex: $('#scene-index'),
      sceneBlurb: $('#scene-blurb'),
      sceneWatermark: $('#scene-watermark'),
      chips: [
        $('#scene-chip-1'), $('#scene-chip-2'), $('#scene-chip-3'), $('#scene-chip-4'),
      ],
      loading: $('#loading'),
      loadingFill: $('#loading-fill'),
      loadingLabel: $('#loading-label'),
      loadingPct: $('#loading-pct'),
      loadingKicker: $('#loading-kicker'),
      loadingCar: $('#loading-car'),
      loadingTip: $('#loading-tip'),
      countdown: $('#countdown'),
      countdownNum: $('#countdown-num'),
      countdownSub: $('#countdown-sub'),
      countdownSs: $('#countdown-ss'),
      countdownName: $('#countdown-name'),
      pause: $('#pause'),
      pauseStats: $('#pause-stats'),
      results: $('#results'),
      resultTitle: $('#result-title'),
      resultSub: $('#result-sub'),
      resultTime: $('#result-time'),
      resultBest: $('#result-best'),
      resultDelta: $('#result-delta'),
      resultRank: $('#result-rank'),
      resultRecord: $('#result-record'),
      resultNote: $('#result-note'),
      settingsModal: $('#settings-modal'),
      helpModal: $('#help-modal'),
      toast: $('#toast'),
      gameHint: $('#game-hint'),
      soundBtn: $('#btn-sound'),
    };
    this._renderCarList();
    this._renderStageList();
    this._syncSelection();
    this._bindEvents();
    this._syncSettingsForm();
    this._updateSoundBtn();
  }

  get selectedCar() { return getCar(this.selectedCarId); }
  get selectedStage() { return getStage(this.selectedStageId); }

  _loadSelection() {
    try {
      const raw = localStorage.getItem('gbr.selection.v1');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { car: 'quattro', stage: 'kielder' };
  }

  _saveSelection() {
    try {
      localStorage.setItem('gbr.selection.v1', JSON.stringify({
        car: this.selectedCarId, stage: this.selectedStageId,
      }));
    } catch { /* ignore */ }
  }

  /* ============================================================
     SVG ART
     ============================================================ */
  _carSVG(car) {
    const body = hex(car.color);
    const accent = hex(car.accent);
    const accent2 = hex(car.accent2);
    const dark = '#121611';
    const windowC = '#17201f';
    const stripe = car.livery === 'martini'
      ? `<rect x="34" y="23" width="55" height="1.5" fill="${accent2}"/><rect x="34" y="25" width="55" height="1.3" fill="#e8e4d6"/><rect x="34" y="27" width="55" height="1.8" fill="${accent}"/>`
      : car.livery === 'quattro'
        ? `<rect x="34" y="24" width="55" height="1.6" fill="${accent}"/><rect x="34" y="27" width="55" height="3" fill="${accent2}"/>`
        : `<rect x="34" y="25" width="55" height="2.6" fill="${accent}"/>`;
    return `
      <svg viewBox="0 0 120 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="car-${car.id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${body}" stop-opacity=".95"/>
            <stop offset="1" stop-color="${body}" stop-opacity=".55"/>
          </linearGradient>
        </defs>
        <ellipse cx="62" cy="41" rx="49" ry="2.5" fill="#000" opacity=".38"/>
        <path d="M8 32 L8 25 Q8 21 14 20 L34 18 Q41 10 52 9 L76 9 Q85 10 92 18 L107 19 Q113 20 113 25 L113 32 Z" fill="url(#car-${car.id})" stroke="rgba(255,255,255,.17)" stroke-width=".7"/>
        <path d="M38 17.5 L48 11 L75 11 L82 17.5 Z" fill="${windowC}" stroke="rgba(220,235,225,.18)" stroke-width=".5"/>
        <path d="M85 17.5 L89 17.8 L94 20 L83 20 Z" fill="${windowC}" opacity=".7"/>
        ${stripe}
        <circle cx="57" cy="24.5" r="7.1" fill="#eee9d9" stroke="${accent}" stroke-width="1.1"/>
        <text x="57" y="28" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="9" fill="#171a15">${car.number}</text>
        <rect x="10" y="29" width="101" height="3" fill="#0d110d" opacity=".65"/>
        <g>
          <circle cx="28" cy="32" r="8.6" fill="#0b0d0c"/>
          <circle cx="28" cy="32" r="5.3" fill="#5f625c"/>
          <circle cx="28" cy="32" r="2.1" fill="#22251f"/>
          <circle cx="95" cy="32" r="8.6" fill="#0b0d0c"/>
          <circle cx="95" cy="32" r="5.3" fill="#5f625c"/>
          <circle cx="95" cy="32" r="2.1" fill="#22251f"/>
        </g>
        <path d="M8 27 L14 26 L20 27 L20 28 L8 28 Z" fill="${accent2}" opacity=".8"/>
        <path d="M10 22 L13 22 L13 23 L10 23 Z" fill="#f8edc9"/>
        <path d="M108 24 L112 25 L112 28 L107 27 Z" fill="#a8221a"/>
        <path d="M50 34 L50 37 L54 37 L54 34 Z" fill="#080a08"/>
        <path d="M89 24 L104 24 L104 25 L88 25" fill="${accent2}" opacity=".45"/>
      </svg>`;
  }

  _biomeArt(biome, stageId) {
    if (biome === 'forest') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#617f70"/><stop offset=".65" stop-color="#93a18b"/><stop offset="1" stop-color="#677056"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <circle cx="322" cy="20" r="13" fill="#e8dfbb" opacity=".18"/>
        <path d="M0 58 L52 40 L93 55 L144 35 L198 57 L256 39 L312 55 L360 43 L400 54 L400 90 L0 90Z" fill="#4a5a45" opacity=".55"/>
        <path d="M0 68 L64 56 L120 66 L182 52 L246 68 L316 56 L400 66 L400 90 L0 90Z" fill="#2e3f2b" opacity=".72"/>
        <g fill="#152417">
          <path d="M12 89 L27 47 L42 89Z"/><path d="M28 89 L45 39 L62 89Z"/><path d="M54 89 L68 55 L82 89Z"/>
          <path d="M102 89 L118 45 L134 89Z"/><path d="M122 89 L139 33 L156 89Z"/><path d="M150 89 L165 51 L180 89Z"/>
          <path d="M208 89 L224 46 L240 89Z"/><path d="M230 89 L248 35 L266 89Z"/><path d="M258 89 L273 52 L288 89Z"/>
          <path d="M306 89 L322 44 L338 89Z"/><path d="M330 89 L347 38 L364 89Z"/>
        </g>
        <g fill="#20351f" opacity=".85">
          <path d="M80 89 L90 61 L100 89Z"/><path d="M188 89 L198 58 L208 89Z"/><path d="M284 89 L294 62 L304 89Z"/>
          <path d="M370 89 L382 56 L394 89Z"/>
        </g>
        <rect y="82" width="400" height="8" fill="#202b19"/>
        <rect y="61" width="400" height="20" fill="#c7d1c0" opacity=".08"/>
      </svg>`;
    }
    if (biome === 'jungle') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#435e4b"/><stop offset=".6" stop-color="#72856a"/><stop offset="1" stop-color="#3d4c2d"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <g opacity=".24" fill="#d6e1c4">
          <ellipse cx="308" cy="18" rx="46" ry="10"/><ellipse cx="345" cy="15" rx="30" ry="6"/>
        </g>
        <g stroke="#1d2c1b" stroke-width="4" fill="none">
          <path d="M38 88 Q54 56 44 17"/><path d="M354 88 Q340 56 359 22"/>
        </g>
        <g fill="#22371f">
          <path d="M44 18 Q23 8 7 16 Q25 27 44 18Z"/><path d="M44 18 Q61 3 83 8 Q66 25 44 18Z"/>
          <path d="M44 18 Q30 30 12 27 Q26 38 44 18Z"/><path d="M44 18 Q63 31 84 29 Q69 41 44 18Z"/>
          <path d="M44 18 Q36 2 45 -6 Q52 6 44 18Z"/>
          <path d="M359 22 Q338 10 320 17 Q339 30 359 22Z"/><path d="M359 22 Q376 7 397 11 Q380 29 359 22Z"/>
          <path d="M359 22 Q342 34 325 31 Q340 42 359 22Z"/><path d="M359 22 Q376 34 398 33 Q382 45 359 22Z"/>
        </g>
        <g fill="#172716">
          <path d="M0 90 Q22 58 48 90Z"/><path d="M32 90 Q62 56 90 90Z"/><path d="M86 90 Q110 62 138 90Z"/>
          <path d="M130 90 Q162 52 192 90Z"/><path d="M186 90 Q212 60 238 90Z"/><path d="M232 90 Q264 54 294 90Z"/>
          <path d="M286 90 Q314 59 340 90Z"/><path d="M332 90 Q362 55 400 90Z"/>
        </g>
        <g fill="#2e4925" opacity=".8">
          <ellipse cx="105" cy="72" rx="35" ry="9"/><ellipse cx="268" cy="78" rx="42" ry="10"/>
        </g>
        <rect y="84" width="400" height="6" fill="#1b2615"/>
        <rect y="52" width="400" height="26" fill="#d7e2c5" opacity=".055"/>
      </svg>`;
    }
    return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#6f8fac"/><stop offset=".65" stop-color="#c4d3dd"/><stop offset="1" stop-color="#e3ebf1"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <circle cx="74" cy="20" r="14" fill="#fff8e2" opacity=".5"/>
        <path d="M0 63 L52 36 L98 56 L154 30 L210 58 L268 34 L326 58 L372 40 L400 53 L400 90 L0 90Z" fill="#aebfce" opacity=".72"/>
        <path d="M0 74 L60 52 L118 68 L180 48 L244 70 L306 50 L364 68 L400 60 L400 90 L0 90Z" fill="#d5e0e8"/>
        <g fill="#2d4233">
          <path d="M20 88 L33 49 L46 88Z"/><path d="M38 88 L54 39 L70 88Z"/>
          <path d="M138 88 L151 46 L164 88Z"/><path d="M156 88 L173 34 L190 88Z"/>
          <path d="M282 88 L296 43 L310 88Z"/><path d="M301 88 L319 38 L337 88Z"/>
          <path d="M340 88 L350 58 L360 88Z"/>
        </g>
        <g fill="#f2f7fa" opacity=".8">
          <path d="M33 49 L26 63 L40 63Z"/><path d="M54 39 L46 55 L62 55Z"/>
          <path d="M173 34 L164 51 L182 51Z"/><path d="M319 38 L310 55 L328 55Z"/>
        </g>
        <rect y="83" width="400" height="7" fill="#eef4f8"/>
        <g fill="#ffffff" opacity=".55">
          <circle cx="222" cy="18" r="1.3"/><circle cx="252" cy="29" r="1"/><circle cx="194" cy="34" r="1.2"/>
          <circle cx="361" cy="22" r="1.3"/><circle cx="128" cy="20" r="1"/><circle cx="303" cy="14" r="1.1"/>
        </g>
      </svg>`;
  }

  _mapMini(stage) {
    const m = getStageMetrics(stage).map;
    const pts = m.map(([u, v]) => `${(u * 100).toFixed(1)},${(v * 60).toFixed(1)}`).join(' ');
    const s = m[0];
    const e = m[m.length - 1];
    return `<svg class="map-mini" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <polyline points="${pts}"/>
      <circle class="start" cx="${(s[0] * 100).toFixed(1)}" cy="${(s[1] * 60).toFixed(1)}" r="2.2"/>
      <circle class="finish" cx="${(e[0] * 100).toFixed(1)}" cy="${(e[1] * 60).toFixed(1)}" r="1.8"/>
    </svg>`;
  }

  /* ============================================================
     MENU LIST RENDERING
     ============================================================ */
  _renderCarList() {
    this.dom.carList.innerHTML = CARS.map((car) => `
      <button class="car-card" data-car="${car.id}" title="${car.name}">
        <span class="car-thumb">${this._carSVG(car)}</span>
        <span class="car-meta">
          <span class="car-name">${car.short}</span>
          <span class="car-sub"><span class="layout">${car.layout}</span><i></i>${car.year}<i></i>${car.country}</span>
        </span>
        <span class="car-badge">#${String(car.number).padStart(2, '0')}</span>
      </button>`).join('');
    this.dom.carList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-car]');
      if (!btn) return;
      this._click();
      this.selectCar(btn.dataset.car);
    });
    $('#car-count').textContent = String(CARS.length).padStart(2, '0');
  }

  _renderStageList() {
    this.dom.stageList.innerHTML = STAGES.map((stage) => {
      const metrics = getStageMetrics(stage);
      const diffs = [1, 2, 3].map((n) => `<i class="${n <= stage.difficulty ? 'on' : ''}"></i>`).join('');
      return `<button class="stage-card" data-stage="${stage.id}" title="${stage.name}">
        <div class="stage-art">
          ${this._biomeArt(stage.biome, stage.id)}
          <span class="biome-tag"><i></i>${BIOME_LABEL[stage.biome]}</span>
          ${this._mapMini(stage)}
        </div>
        <div class="stage-body">
          <div>
            <div class="stage-name">${stage.name}</div>
            <div class="stage-sub">${stage.subtitle}</div>
          </div>
          <div class="stage-right">
            <div class="stage-len">${metrics.km} KM</div>
            <div class="diff">${diffs}</div>
          </div>
        </div>
      </button>`;
    }).join('');
    this.dom.stageList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-stage]');
      if (!btn) return;
      this._click();
      this.selectStage(btn.dataset.stage);
    });
  }

  _syncSelection() {
    const car = this.selectedCar;
    const stage = this.selectedStage;
    const metrics = getStageMetrics(stage);
    $$('.car-card', this.dom.carList).forEach((el) => {
      el.classList.toggle('selected', el.dataset.car === car.id);
    });
    $$('.stage-card', this.dom.stageList).forEach((el) => {
      el.classList.toggle('selected', el.dataset.stage === stage.id);
    });

    const d = carDerived(car);
    this.dom.carSpec.innerHTML = `
      <div class="stat">
        <div class="stat-label"><span>POWER</span><b>${car.power} HP</b></div>
        <div class="stat-bar"><i style="width:${d.powerPct}%"></i></div>
      </div>
      <div class="stat alt">
        <div class="stat-label"><span>WEIGHT</span><b>${car.weight} KG</b></div>
        <div class="stat-bar"><i style="width:${d.weightPct}%"></i></div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>GRIP</span><b>${Math.round(car.grip * 100)}</b></div>
        <div class="stat-bar"><i style="width:${d.gripPct}%"></i></div>
      </div>
      <div class="stat alt">
        <div class="stat-label"><span>AGILITY</span><b>${Math.round(d.agility)}</b></div>
        <div class="stat-bar"><i style="width:${d.agility}%"></i></div>
      </div>
      <div class="car-tyre">
        <span>TYRE <b>${car.tyre}</b></span>
        <span>${car.engine}</span>
      </div>`;

    this.dom.sceneIndex.textContent = `${car.year} // ${car.layout} // ${car.name}`;
    this.dom.sceneBlurb.textContent = car.blurb;
    this.dom.sceneWatermark.textContent = String(car.year);
    const chips = [
      ['LAYOUT', car.layout],
      ['POWER', `${car.power} HP`],
      ['WEIGHT', `${car.weight} KG`],
      ['TYRE', car.tyre.split(' ')[0]],
    ];
    this.dom.chips.forEach((ch, i) => {
      ch.querySelector('b').textContent = chips[i][1];
      ch.querySelector('span').textContent = chips[i][0];
    });

    const biome = BIOME_LABEL[stage.biome];
    this.dom.stageDetail.innerHTML = `
      <div><div class="dlabel">LENGTH</div><div class="dval">${metrics.km} KM</div></div>
      <div><div class="dlabel">TARGET</div><div class="dval">${formatTime(metrics.target)}</div></div>
      <div><div class="dlabel">SURFACE</div><div class="dval">${stage.env.surfaceName}</div></div>
      <div><div class="dlabel">DIFFICULTY</div><div class="dval">${stage.difficultyLabel}</div></div>
      <div class="dwide"><span class="dlabel">ROAD NOTE</span><span class="dval">${stage.env.hint}</span></div>`;

    const est0to100 = Math.max(2.7, 2.2 + (car.weight / 1000) * 1.5 - (car.power / 500) * 0.9);
    this.dom.carFoot.innerHTML = `
      <span>0—100 EST.</span><b>${est0to100.toFixed(1)} S</b>
      <span>GEARBOX</span><b>6-SPEED</b>
      <span>HOMOLOGATION</span><b>${car.year}</b>`;
    const weatherLabel = stage.env.weather === 'rain' ? 'LIGHT RAIN'
      : stage.env.weather === 'snow' ? 'SNOWFALL' : 'OVERCAST';
    const hazardCount = stage.biome === 'jungle' ? 7 : 5;
    const rec = stage.biome === 'snow' ? 'STUDS' : stage.biome === 'jungle' ? 'WET' : 'GRAVEL';
    this.dom.stageIntel.innerHTML = `
      <div><span>WEATHER</span><b>${weatherLabel}</b></div>
      <div><span>HAZARD ZONES</span><b>${hazardCount}</b></div>
      <div><span>TYRE CALL</span><b>${rec}</b></div>`;
    this.dom.startMeta.textContent = `${stage.ss} · ${stage.name} · ${biome}`;
    this._refreshBest();
    this._saveSelection();
    this.onSelection?.(car, stage);
  }

  _refreshBest() {
    const best = getBest(this.selectedStageId, this.selectedCarId);
    this.dom.best.textContent = best ? formatTime(best) : '--:--.--';
  }

  selectCar(id) {
    if (!getCar(id)) return;
    this.selectedCarId = id;
    this._syncSelection();
  }

  selectStage(id) {
    if (!getStage(id)) return;
    this.selectedStageId = id;
    this._syncSelection();
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  _click() { this.onUiSound?.(); }

  _bindEvents() {
    $('#btn-settings').addEventListener('click', () => { this._click(); this.openSettings(false); });
    $('#btn-help').addEventListener('click', () => { this._click(); this.openHelp(); });
    this.dom.startBtn.addEventListener('click', () => {
      this._click();
      if (this.dom.startBtn.disabled) return;
      this.onStart?.(this.selectedCar, this.selectedStage);
    });
    $('#btn-settings-close').addEventListener('click', () => this.closeSettings());
    $('#btn-settings-done').addEventListener('click', () => this.closeSettings());
    $('#btn-help-close').addEventListener('click', () => this.closeHelp());
    $('#btn-help-done').addEventListener('click', () => this.closeHelp());
    for (const id of ['#btn-resume', '#btn-restart', '#btn-pause-settings', '#btn-quit']) {
      $(id).addEventListener('click', () => this._click());
    }
    $('#btn-resume').addEventListener('click', () => this.onResume?.());
    $('#btn-restart').addEventListener('click', () => this.onRestart?.());
    $('#btn-pause-settings').addEventListener('click', () => this.openSettings(true));
    $('#btn-quit').addEventListener('click', () => this.onQuit?.());
    $('#btn-next-stage').addEventListener('click', () => { this._click(); this.onNextStage?.(); });
    $('#btn-retry').addEventListener('click', () => { this._click(); this.onRestart?.(); });
    $('#btn-results-menu').addEventListener('click', () => { this._click(); this.onQuit?.(); });

    this.dom.soundBtn.addEventListener('click', () => {
      this.settings.muted = !this.settings.muted;
      this._commitSettings();
      this._updateSoundBtn();
      this._click();
    });
    $('#btn-fullscreen').addEventListener('click', () => {
      this._click();
      try {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.();
      } catch { /* ignore */ }
    });

    // settings bindings
    const bind = (id, key, transform) => {
      const el = $(id);
      el.addEventListener('input', () => {
        this.settings[key] = transform ? transform(el) : el.value;
        this._commitSettings();
        this._updateSettingLabels();
      });
      el.addEventListener('change', () => {
        this.settings[key] = transform ? transform(el) : el.value;
        this._commitSettings();
        this._updateSettingLabels();
      });
    };
    bind('#set-quality', 'quality');
    bind('#set-volume', 'volume', (el) => parseInt(el.value, 10) / 100);
    bind('#set-voice', 'voice', (el) => el.checked);
    bind('#set-weather', 'weatherFx', (el) => el.checked);
    bind('#set-shake', 'shake', (el) => el.checked);
    bind('#set-sensitivity', 'lookSensitivity', (el) => parseInt(el.value, 10) / 100);
    bind('#set-units', 'units');
    $('#btn-clear-records').addEventListener('click', () => {
      this._click();
      if (!window.confirm('Clear all stage records stored on this machine?')) return;
      clearBests();
      this._refreshBest();
      this.toast('STAGE RECORDS CLEARED');
    });

    for (const overlay of [this.dom.settingsModal, this.dom.helpModal]) {
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) {
          if (overlay === this.dom.settingsModal) this.closeSettings();
          else this.closeHelp();
        }
      });
    }
    window.addEventListener('fullscreenchange', () => { /* icon stays static */ });
  }

  _updateSoundBtn() {
    this.dom.soundBtn.classList.toggle('muted', this.settings.muted);
    this.dom.soundBtn.title = this.settings.muted ? 'Unmute' : 'Mute';
  }

  _commitSettings() {
    saveSettings(this.settings);
    this.onSettingsChange?.(this.settings);
  }

  _syncSettingsForm() {
    $('#set-quality').value = this.settings.quality;
    $('#set-volume').value = Math.round(this.settings.volume * 100);
    $('#set-voice').checked = !!this.settings.voice;
    $('#set-weather').checked = !!this.settings.weatherFx;
    $('#set-shake').checked = !!this.settings.shake;
    $('#set-sensitivity').value = Math.round(this.settings.lookSensitivity * 100);
    $('#set-units').value = this.settings.units;
    this._updateSettingLabels();
  }

  _updateSettingLabels() {
    $('#volume-label').textContent = `${Math.round(this.settings.volume * 100)}%`;
    $('#sens-label').textContent = `${Number(this.settings.lookSensitivity).toFixed(1)}×`;
  }

  /* ============================================================
     MODALS
     ============================================================ */
  openSettings(fromPause = false) {
    this.settingsReturnPause = fromPause;
    this._syncSettingsForm();
    this.dom.settingsModal.classList.remove('hidden');
  }

  closeSettings() {
    this.dom.settingsModal.classList.add('hidden');
    if (!this.dom.pause.classList.contains('hidden') && this.settingsReturnPause) {
      // pause remains beneath
    }
    this.settingsReturnPause = false;
    this._blur();
  }

  openHelp() { this.dom.helpModal.classList.remove('hidden'); }
  closeHelp() { this.dom.helpModal.classList.add('hidden'); this._blur(); }

  _blur() {
    const el = document.activeElement;
    if (el && el.blur) el.blur();
  }

  hasModalOpen() {
    return !this.dom.settingsModal.classList.contains('hidden') ||
      !this.dom.helpModal.classList.contains('hidden');
  }

  closeModals() {
    this.closeSettings();
    this.closeHelp();
  }

  /* ============================================================
     SCREEN STATE
     ============================================================ */
  showMenu() {
    this._blur();
    this.dom.menu.classList.remove('hidden');
    this.dom.loading.classList.add('hidden');
    this.dom.pause.classList.add('hidden');
    this.dom.results.classList.add('hidden');
    this.dom.countdown.classList.add('hidden');
    this.dom.gameHint.classList.add('hidden');
    this.dom.startBtn.disabled = false;
    this._refreshBest();
  }

  hideMenu() { this._blur(); this.dom.menu.classList.add('hidden'); }

  showLoading(stage, car) {
    this.dom.menu.classList.add('hidden');
    this.dom.results.classList.add('hidden');
    this.dom.pause.classList.add('hidden');
    this.dom.countdown.classList.add('hidden');
    this.dom.loading.classList.remove('hidden');
    this.dom.loadingKicker.textContent = `${stage.ss} // ${stage.name} // ${BIOME_LABEL[stage.biome]}`;
    this.dom.loadingCar.textContent = `${car.name} · ${car.layout} · ${car.tyre}`;
    this.dom.loadingTip.textContent = TIPS[(Math.random() * TIPS.length) | 0];
    this.setLoading(0, 'SURVEYING ROUTE');
  }

  setLoading(pct, label) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    this.dom.loadingFill.style.width = `${p}%`;
    this.dom.loadingPct.textContent = `${p}%`;
    if (label) this.dom.loadingLabel.textContent = label;
  }

  hideLoading() { this.dom.loading.classList.add('hidden'); }

  showCountdown(n, stage) {
    this.dom.countdown.classList.remove('hidden');
    if (stage) {
      this.dom.countdownSs.textContent = stage.ss;
      this.dom.countdownName.textContent = stage.name;
    }
    const num = this.dom.countdownNum;
    num.classList.remove('pulse');
    // restart css animation
    void num.offsetWidth;
    if (n > 0) {
      num.textContent = String(n);
      num.classList.remove('go');
      this.dom.countdownSub.textContent = 'HOLD THE REVS';
    } else {
      num.textContent = 'GO';
      num.classList.add('go');
      this.dom.countdownSub.textContent = 'FLAT OUT';
    }
    num.classList.add('pulse');
  }

  hideCountdown() { this.dom.countdown.classList.add('hidden'); }

  showPause(stats) {
    if (stats) {
      this.dom.pauseStats.innerHTML = `
        <div><label>STAGE</label><b>${stats.stage.ss} ${stats.stage.name}</b></div>
        <div><label>TIME</label><b>${formatTime(stats.time)}</b></div>
        <div><label>CAR</label><b>${stats.car.short}</b></div>`;
    }
    this.dom.pause.classList.remove('hidden');
    this.dom.results.classList.add('hidden');
  }

  hidePause() { this.dom.pause.classList.add('hidden'); }

  showResults(data) {
    this.dom.pause.classList.add('hidden');
    this.dom.results.classList.remove('hidden');
    this.dom.resultTitle.textContent = data.stage.name;
    this.dom.resultSub.textContent =
      `${data.stage.ss} · ${BIOME_LABEL[data.stage.biome]} · ${(data.length / 1000).toFixed(2)} KM`;
    this.dom.resultTime.textContent = formatTime(data.time);
    this.dom.resultBest.textContent = data.best ? formatTime(data.best) : '--:--.--';
    this.dom.resultDelta.textContent = data.delta != null ? formatDelta(data.delta) : '--';
    const rankEl = this.dom.resultRank;
    rankEl.className = 'rank-badge rank-' + data.rank;
    rankEl.textContent = data.rank;
    this.dom.resultRecord.classList.toggle('hidden', !data.isRecord);
    this.dom.resultNote.textContent = data.note;
    const idx = STAGES.findIndex((s) => s.id === data.stage.id);
    const next = STAGES[(idx + 1) % STAGES.length];
    $('#btn-next-stage').textContent = `NEXT: ${next.name} →`;
    this.dom.resultBest.textContent = data.best ? formatTime(data.best) : '--:--.--';
  }

  hideResults() { this.dom.results.classList.add('hidden'); }

  showGameHints(show) {
    if (show && this.settings.showHints !== false) {
      this.dom.gameHint.classList.remove('hidden');
      this.dom.gameHint.classList.remove('fade');
    } else {
      this.dom.gameHint.classList.add('hidden');
    }
  }

  fadeGameHints() {
    this.dom.gameHint.classList.add('fade');
    setTimeout(() => this.dom.gameHint.classList.add('hidden'), 900);
  }

  hideGameHints() {
    this.dom.gameHint.classList.add('hidden');
  }

  toast(text, ms = 1800) {
    this.dom.toast.textContent = text;
    this.dom.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.dom.toast.classList.remove('show'), ms);
  }

  setStartEnabled(enabled) {
    this.dom.startBtn.disabled = !enabled;
  }

  syncPreview() {
    this.onSelection?.(this.selectedCar, this.selectedStage);
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this._commitSettings();
    this._updateSoundBtn();
    this.toast(this.settings.muted ? 'SOUND OFF' : 'SOUND ON');
    return this.settings.muted;
  }
}
