import {
  CARS, STAGES, getCar, getStage, loadSettings, saveSettings, getBest, clearBests,
  carDerived, BIOME_LABEL, WEATHER_MODES, TIME_MODES, CAMERA_MODES, DRIVING_MODES,
  resolveConditions, getEndlessBest,
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
  'Tip: You can leave the tarmac and cut through the trees — small ones break, big ones bite back.',
  'Tip: ENDLESS roads fork. Side roads wander away and often rejoin the main route.',
  'Tip: Not every impact is survivable. Above roughly 70 km/h a tree trunk will shatter.',
  'Tip: The map and timer are mounted in the car. Look down, not at a floating HUD.',
  'Tip: ENDLESS mode keeps generating road ahead. Your furthest distance is your record.',
  'Tip: Heavier cars carry momentum. Brake earlier, and let the weight work for you.',
  'Tip: Modern city cars have ABS and stability control. Stamp on the brakes, the car will stay straight.',
  'Tip: The new city cars are set up for comfort and control, not opposite lock. Smooth is quick.',
];

export class UI {
  constructor() {
    this.settings = loadSettings();
    const sel = this._loadSelection();
    this.selectedCarId = getCar(sel.car).id;
    this.selectedStageId = getStage(sel.stage).id;
    this.selectedMode = sel.mode === 'endless' ? 'endless' : 'stage';
    this.onStart = null;
    this.onRestart = null;
    this.onResume = null;
    this.onQuit = null;
    this.onNextStage = null;
    this.onCamera = null;
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
      stageMode: $('#stage-mode'),
      stageDetail: $('#stage-detail'),
      stageIntel: $('#stage-intel'),
      best: $('#best-display'),
      startBtn: $('#btn-start'),
      startLabel: $('.start-label'),
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
      menuWeather: $('#menu-weather'),
      menuTime: $('#menu-time'),
      menuPhysics: $('#menu-physics'),
      setWeather: $('#set-weather-mode'),
      setTime: $('#set-time-mode'),
      setPhysics: $('#set-physics'),
      setCamera: $('#set-camera'),
      conditionLine: $('#condition-line'),
    };
    this._renderConditionOptions();
    this._renderCarList();
    this._renderStageList();
    this._syncSelection();
    this._bindEvents();
    this._syncSettingsForm();
    this._updateSoundBtn();
  }

  get selectedCar() { return getCar(this.selectedCarId); }
  get selectedStage() { return getStage(this.selectedStageId); }
  get selectedEndless() { return this.selectedMode === 'endless'; }

  _loadSelection() {
    const fallback = { car: 'quattro', stage: 'kielder', mode: 'stage' };
    try {
      const raw = localStorage.getItem('gbr.selection.v1');
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
      return {
        car: typeof parsed.car === 'string' ? parsed.car : fallback.car,
        stage: typeof parsed.stage === 'string' ? parsed.stage : fallback.stage,
        mode: parsed.mode === 'endless' ? 'endless' : 'stage',
      };
    } catch {
      return fallback;
    }
  }

  _saveSelection() {
    try {
      localStorage.setItem('gbr.selection.v1', JSON.stringify({
        car: this.selectedCarId, stage: this.selectedStageId, mode: this.selectedMode,
      }));
    } catch { /* ignore */ }
  }

  /* ============================================================
     SVG ART
     ============================================================ */
  _carSVG(car) {
    if (car.interior === 'modern') return this._modernCarSVG(car);
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


  _modernCarSVG(car) {
    const body = hex(car.color);
    const accent = hex(car.accent);
    const accent2 = hex(car.accent2);
    const dark = '#14181b';
    const windowC = '#18272d';
    const suv = car.style?.body === 'suv';
    const roofY = suv ? 6 : 10;
    const beltY = suv ? 19 : 20;
    const seatY = suv ? 33 : 32;
    return `
      <svg viewBox="0 0 120 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="car-${car.id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${body}" stop-opacity=".98"/>
            <stop offset=".62" stop-color="${body}" stop-opacity=".8"/>
            <stop offset="1" stop-color="${body}" stop-opacity=".55"/>
          </linearGradient>
          <linearGradient id="glass-${car.id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#35515f"/><stop offset="1" stop-color="${windowC}"/>
          </linearGradient>
        </defs>
        <ellipse cx="61" cy="41.5" rx="50" ry="2.4" fill="#000" opacity=".34"/>
        <path d="M7 33 Q7 24 18 22 L35 20 L46 ${roofY + 1} Q49 ${roofY - 1} 55 ${roofY - 1}
          L79 ${roofY - 1} Q86 ${roofY + 1} 92 20 L104 21 Q113 23 113 30 L113 34 Q113 36 110 36
          L10 36 Q7 36 7 33 Z" fill="url(#car-${car.id})" stroke="rgba(255,255,255,.2)" stroke-width=".6"/>
        <path d="M47 ${roofY + 2} L53 ${roofY + 1} L77 ${roofY + 1} L84 20 L93 20 L92 ${beltY}
          L45 ${beltY} Z" fill="url(#glass-${car.id})" opacity=".95"/>
        <path d="M56 ${roofY + 1.4} L56 ${beltY - 1}" stroke="${dark}" stroke-width="2"/>
        <path d="M84 ${roofY + 1.2} L80 ${beltY - 1}" stroke="${dark}" stroke-width="1.7"/>
        <path d="M8 27 L18 25 L31 25 L31 26 L8 28 Z" fill="${dark}" opacity=".72"/>
        <path d="M12 24.4 L22 23.3 L22 24.3 L12 25.3 Z" fill="#e7f2fa" opacity=".92"/>
        <path d="M108 25.6 L112.6 26.8 L112.6 28.6 L107 27.4 Z" fill="#a61c1c" opacity=".9"/>
        <rect x="18" y="33" width="25" height="1.1" fill="${accent}" opacity=".65"/>
        <rect x="68" y="22.6" width="10" height=".9" fill="${accent}" opacity=".65"/>
        <path d="M96 23 L103 23" stroke="${accent}" stroke-width="1" opacity=".8"/>
        <path d="M87 27 L103 27" stroke="#0b0e10" stroke-width="1" opacity=".66"/>
        <g>
          <circle cx="29" cy="34" r="8.2" fill="#0b0d0d"/>
          <circle cx="29" cy="34" r="5" fill="${accent2}" opacity=".9"/>
          <circle cx="29" cy="34" r="2.1" fill="#d6d8d3"/>
          <circle cx="94" cy="34" r="8.2" fill="#0b0d0d"/>
          <circle cx="94" cy="34" r="5" fill="${accent2}" opacity=".9"/>
          <circle cx="94" cy="34" r="2.1" fill="#d6d8d3"/>
        </g>
        <path d="M16 22 Q22 20 30 20 L35 20" stroke="#d6d8d3" stroke-width=".7" fill="none" opacity=".55"/>
        <path d="M88 20 L96 20" stroke="#d6d8d3" stroke-width=".7" fill="none" opacity=".5"/>
      </svg>`;
  }

  _biomeArt(biome, stageId) {
    if (biome === 'city') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#2f4d68"/><stop offset=".6" stop-color="#b88f79"/><stop offset="1" stop-color="#e1b486"/>
          </linearGradient>
          <linearGradient id="glass-${stageId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#263d4d"/><stop offset="1" stop-color="#14232e"/>
          </linearGradient>
        </defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <circle cx="318" cy="20" r="11" fill="#ffe0ae" opacity=".55"/>
        <g fill="#42525d" opacity=".72">
          <rect x="0" y="39" width="30" height="51"/><rect x="34" y="28" width="28" height="62"/>
          <rect x="66" y="45" width="24" height="45"/><rect x="96" y="18" width="34" height="72"/>
          <rect x="136" y="36" width="26" height="54"/><rect x="166" y="24" width="38" height="66"/>
          <rect x="210" y="43" width="27" height="47"/><rect x="242" y="30" width="32" height="60"/>
          <rect x="280" y="14" width="38" height="76"/><rect x="324" y="38" width="28" height="52"/>
          <rect x="356" y="26" width="44" height="64"/>
        </g>
        <g fill="url(#glass-${stageId})" opacity=".86">
          <rect x="4" y="44" width="22" height="40"/><rect x="38" y="33" width="20" height="53"/>
          <rect x="70" y="50" width="16" height="36"/><rect x="101" y="23" width="24" height="61"/>
          <rect x="140" y="41" width="18" height="43"/><rect x="171" y="29" width="28" height="55"/>
          <rect x="214" y="48" width="19" height="36"/><rect x="247" y="35" width="22" height="49"/>
          <rect x="285" y="19" width="28" height="65"/><rect x="329" y="43" width="18" height="41"/>
          <rect x="361" y="31" width="34" height="53"/>
        </g>
        <g fill="#f0c57e" opacity=".7">
          <rect x="8" y="55" width="4" height="5"/><rect x="17" y="65" width="4" height="5"/>
          <rect x="42" y="48" width="4" height="5"/><rect x="51" y="66" width="4" height="5"/>
          <rect x="108" y="38" width="4" height="5"/><rect x="115" y="58" width="4" height="5"/>
          <rect x="179" y="48" width="4" height="5"/><rect x="189" y="64" width="4" height="5"/>
          <rect x="253" y="55" width="4" height="5"/><rect x="260" y="69" width="4" height="5"/>
          <rect x="295" y="38" width="5" height="6"/><rect x="304" y="55" width="5" height="6"/><rect x="298" y="70" width="5" height="6"/>
          <rect x="372" y="47" width="5" height="6"/><rect x="382" y="64" width="5" height="6"/>
        </g>
        <rect x="0" y="77" width="400" height="13" fill="#383e42"/>
        <path d="M0 82 L400 82" stroke="#e9e3cf" stroke-width="1.6" stroke-dasharray="22 16" opacity=".55"/>
        <g fill="#1d2327">
          <rect x="28" y="72" width="12" height="18"/><rect x="120" y="70" width="12" height="20"/>
          <rect x="232" y="72" width="12" height="18"/><rect x="342" y="70" width="12" height="20"/>
        </g>
        <g fill="#e9c25a" opacity=".55">
          <rect x="28" y="77" width="12" height="2"/><rect x="120" y="75" width="12" height="2"/>
          <rect x="232" y="77" width="12" height="2"/><rect x="342" y="75" width="12" height="2"/>
        </g>
        <rect x="288" y="84" width="34" height="2" fill="#f0ead8" opacity=".55"/>
        <rect x="294" y="87" width="4" height="2.4" fill="#f0ead8" opacity=".55"/>
        <rect x="304" y="87" width="4" height="2.4" fill="#f0ead8" opacity=".55"/>
        <rect x="314" y="87" width="4" height="2.4" fill="#f0ead8" opacity=".55"/>
      </svg>`;
    }
    if (biome === 'coast') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3f81ad"/><stop offset=".6" stop-color="#cfe4e4"/><stop offset="1" stop-color="#ead2a4"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <circle cx="318" cy="24" r="14" fill="#fff2c8" opacity=".75"/>
        <path d="M0 57 L120 54 L260 58 L400 50 L400 90 L0 90Z" fill="#4c8494" opacity=".85"/>
        <path d="M0 61 L80 59 L170 63 L280 60 L400 64" stroke="#d8ecec" stroke-width="1" opacity=".45" fill="none"/>
        <path d="M0 67 L48 60 L96 66 L150 58 L214 68 L276 61 L342 67 L400 60 L400 90 L0 90Z" fill="#596b42" opacity=".9"/>
        <g fill="#23381f">
          <path d="M52 88 L62 50 L72 88Z"/><path d="M70 88 L82 42 L94 88Z"/>
          <path d="M148 88 L158 46 L168 88Z"/><path d="M166 88 L178 38 L190 88Z"/>
          <path d="M318 88 L329 44 L340 88Z"/><path d="M338 88 L350 36 L362 88Z"/>
        </g>
        <path d="M228 90 L260 66 L302 66 L340 90Z" fill="#5b5144"/>
        <path d="M240 90 L268 68 L278 68 L252 90Z" fill="#3c352b" opacity=".75"/>
        <path d="M322 90 L296 68 L304 68 L332 90Z" fill="#3c352b" opacity=".75"/>
        <path d="M278 69 L287 69 L300 90 L288 90Z" fill="#ede3c6" opacity=".55"/>
        <rect y="84" width="400" height="6" fill="#2c3922"/>
      </svg>`;
    }
    if (biome === 'alpine') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3a6b9b"/><stop offset=".6" stop-color="#b8d2e4"/><stop offset="1" stop-color="#e7eef3"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <circle cx="78" cy="20" r="12" fill="#fff8e4" opacity=".55"/>
        <path d="M0 60 L52 31 L96 56 L150 20 L210 58 L266 30 L326 56 L374 34 L400 52 L400 90 L0 90Z" fill="#8da6b8" opacity=".8"/>
        <g fill="#edf5fa">
          <path d="M150 20 L139 38 L164 38Z"/><path d="M266 30 L254 48 L280 48Z"/><path d="M374 34 L363 50 L387 50Z"/>
        </g>
        <path d="M0 70 L70 57 L140 69 L210 54 L282 68 L350 58 L400 66 L400 90 L0 90Z" fill="#607b58"/>
        <g fill="#1e3a2a">
          <path d="M22 88 L32 56 L42 88Z"/><path d="M38 88 L50 48 L62 88Z"/>
          <path d="M104 88 L114 54 L124 88Z"/><path d="M118 88 L130 46 L142 88Z"/>
          <path d="M300 88 L310 52 L320 88Z"/><path d="M316 88 L328 44 L340 88Z"/>
        </g>
        <path d="M146 90 L188 63 L214 63 L254 90Z" fill="#66706b"/>
        <path d="M156 90 L192 65 L200 65 L174 90Z" fill="#4e5652" opacity=".8"/>
        <path d="M242 90 L214 65 L222 65 L250 90Z" fill="#4e5652" opacity=".8"/>
        <path d="M196 66 Q192 78 186 90 M206 66 Q210 78 216 90" stroke="#d7ded9" stroke-width="1" fill="none" opacity=".42"/>
        <rect y="84" width="400" height="6" fill="#33452f"/>
      </svg>`;
    }
    if (biome === 'eifel') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#607d8b"/><stop offset=".65" stop-color="#aebdb5"/><stop offset="1" stop-color="#6a7f63"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <g opacity=".32" fill="#e3e9e3"><ellipse cx="100" cy="18" rx="58" ry="9"/><ellipse cx="146" cy="15" rx="34" ry="6"/><ellipse cx="318" cy="22" rx="70" ry="10"/></g>
        <path d="M0 58 L58 44 L124 56 L186 40 L250 57 L318 45 L374 55 L400 50 L400 90 L0 90Z" fill="#40573e" opacity=".75"/>
        <path d="M0 69 L72 58 L138 68 L206 56 L276 68 L344 58 L400 66 L400 90 L0 90Z" fill="#293a27" opacity=".9"/>
        <g fill="#142617">
          <path d="M18 88 L30 44 L42 88Z"/><path d="M36 88 L50 36 L64 88Z"/><path d="M60 88 L71 50 L82 88Z"/>
          <path d="M108 88 L120 40 L132 88Z"/><path d="M128 88 L141 32 L154 88Z"/>
          <path d="M256 88 L268 42 L280 88Z"/><path d="M278 88 L291 34 L304 88Z"/>
          <path d="M330 88 L342 46 L354 88Z"/><path d="M350 88 L362 38 L374 88Z"/>
        </g>
        <path d="M150 90 L182 63 L218 63 L250 90Z" fill="#4b4a42"/>
        <path d="M160 90 L188 65 L196 65 L174 90Z" fill="#353733" opacity=".82"/>
        <path d="M240 90 L212 65 L220 65 L248 90Z" fill="#353733" opacity=".82"/>
        <path d="M200 65 L205 65 L204 83 L199 83Z" fill="#ddd8bd" opacity=".45"/>
        <path d="M191 70 Q197 78 193 90 M211 70 Q205 79 209 90" stroke="#9a9b8a" stroke-width=".8" fill="none" opacity=".38"/>
        <rect y="84" width="400" height="6" fill="#1d2b18"/>
      </svg>`;
    }
    if (biome === 'tuscany') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#6f9fc1"/><stop offset=".58" stop-color="#f0dcb8"/><stop offset="1" stop-color="#bfa06d"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <circle cx="312" cy="24" r="15" fill="#fff0bc" opacity=".8"/>
        <path d="M0 62 L64 45 L128 60 L198 42 L272 59 L338 47 L400 58 L400 90 L0 90Z" fill="#a58c56"/>
        <path d="M0 73 L76 60 L148 71 L220 58 L296 70 L362 61 L400 68 L400 90 L0 90Z" fill="#7e6d43"/>
        <g fill="#35442a">
          <path d="M26 88 L30 53 L34 88Z"/><ellipse cx="30" cy="54" rx="9" ry="17"/>
          <path d="M64 88 L68 48 L72 88Z"/><ellipse cx="68" cy="49" rx="10" ry="20"/>
          <path d="M226 88 L230 51 L234 88Z"/><ellipse cx="230" cy="52" rx="9" ry="18"/>
          <path d="M264 88 L268 45 L272 88Z"/><ellipse cx="268" cy="46" rx="10" ry="21"/>
          <path d="M300 88 L304 53 L308 88Z"/><ellipse cx="304" cy="54" rx="8" ry="16"/>
        </g>
        <g fill="#8a7442" opacity=".5">
          <path d="M0 80 Q90 68 190 78 Q290 88 400 76 L400 90 L0 90Z"/>
        </g>
        <path d="M146 90 L184 62 L216 62 L254 90Z" fill="#6d6050"/>
        <path d="M158 90 L188 64 L196 64 L172 90Z" fill="#4f4639" opacity=".8"/>
        <path d="M242 90 L212 64 L220 64 L250 90Z" fill="#4f4639" opacity=".8"/>
        <path d="M194 64 Q200 76 196 90 M208 64 Q204 76 210 90" stroke="#d8c48d" stroke-width=".8" fill="none" opacity=".38"/>
        <rect y="84" width="400" height="6" fill="#5a4b2f"/>
      </svg>`;
    }
    // New asphalt regions borrow the closest authored silhouette until they
    // get their own bespoke postcard art.
    biome = ({ coast: 'japan', alpine: 'snow', eifel: 'forest', tuscany: 'russia' })[biome] || biome;
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
        <g>
          <path d="M148 90 L182 63 L220 63 L254 90Z" fill="#5b4b34"/>
          <path d="M158 90 L187 65 L194 65 L170 90Z" fill="#3d3223" opacity=".7"/>
          <path d="M244 90 L214 65 L221 65 L252 90Z" fill="#3d3223" opacity=".7"/>
          <path d="M185 65 L215 65 L204 90 L196 90Z" fill="#6f7040" opacity=".55"/>
          <path d="M178 74 L194 78 M222 74 L208 78" stroke="#2a2318" stroke-width="1.2" opacity=".45"/>
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
        <g>
          <path d="M148 90 L184 64 L218 64 L252 90Z" fill="#6a4f2f"/>
          <path d="M158 90 L189 66 L198 66 L174 90Z" fill="#4a3521" opacity=".8"/>
          <path d="M242 90 L212 66 L221 66 L249 90Z" fill="#4a3521" opacity=".8"/>
          <ellipse cx="194" cy="84" rx="16" ry="4" fill="#67808a" opacity=".35"/>
          <ellipse cx="225" cy="76" rx="10" ry="2.5" fill="#67808a" opacity=".25"/>
          <path d="M190 70 Q198 78 193 86 M231 70 Q224 78 230 86" stroke="#342716" stroke-width="1" fill="none" opacity=".6"/>
        </g>
        <rect y="84" width="400" height="6" fill="#1b2615"/>
        <rect y="52" width="400" height="26" fill="#d7e2c5" opacity=".055"/>
      </svg>`;
    }
    if (biome === 'japan') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#335c75"/><stop offset=".62" stop-color="#8da6a0"/><stop offset="1" stop-color="#425a44"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <circle cx="318" cy="22" r="12" fill="#d9714f" opacity=".55"/>
        <path d="M0 57 L54 30 L94 53 L150 25 L214 55 L278 32 L338 54 L400 34 L400 90 L0 90Z" fill="#3f5f4d" opacity=".7"/>
        <path d="M0 68 L62 50 L126 66 L192 48 L260 68 L330 52 L400 66 L400 90 L0 90Z" fill="#223a2a" opacity=".88"/>
        <g fill="#0d2616">
          <path d="M16 90 L27 52 L38 90Z"/><path d="M34 90 L47 44 L60 90Z"/><path d="M60 90 L71 56 L82 90Z"/>
          <path d="M104 90 L116 46 L128 90Z"/><path d="M124 90 L138 38 L152 90Z"/><path d="M152 90 L164 54 L176 90Z"/>
          <path d="M206 90 L218 46 L230 90Z"/><path d="M228 90 L242 36 L256 90Z"/><path d="M258 90 L270 54 L282 90Z"/>
          <path d="M304 90 L316 45 L328 90Z"/><path d="M326 90 L340 38 L354 90Z"/><path d="M356 90 L368 52 L380 90Z"/>
        </g>
        <g fill="#a63b2b" opacity=".92">
          <rect x="284" y="55" width="34" height="3"/><rect x="290" y="50" width="4" height="14"/><rect x="308" y="50" width="4" height="14"/>
          <rect x="280" y="48" width="42" height="2.4"/>
        </g>
        <g>
          <path d="M146 90 L182 62 L218 62 L254 90Z" fill="#2b3132"/>
          <path d="M158 90 L186 64 L194 64 L170 90Z" fill="#202526" opacity=".8"/>
          <path d="M242 90 L214 64 L222 64 L250 90Z" fill="#202526" opacity=".8"/>
          <path d="M199 64 L203 64 L210 90 L205 90Z" fill="#d9d9c9" opacity=".7"/>
          <path d="M188 64 L192 64 L182 90 L176 90Z" fill="#d9d9c9" opacity=".55"/>
          <path d="M212 64 L216 64 L226 90 L220 90Z" fill="#d9d9c9" opacity=".55"/>
          <path d="M164 72 L187 70 M236 72 L213 70" stroke="#aeb8b2" stroke-width="1.2" opacity=".55"/>
          <path d="M150 74 L178 70 M250 74 L222 70" stroke="#8b928c" stroke-width="1" opacity=".6"/>
        </g>
        <rect y="84" width="400" height="6" fill="#1a241b"/>
        <rect y="43" width="400" height="34" fill="#dfe8e2" opacity=".07"/>
      </svg>`;
    }
    if (biome === 'russia') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#6d8494"/><stop offset=".64" stop-color="#b8c1bb"/><stop offset="1" stop-color="#7e8c7f"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <g opacity=".24" fill="#e4e9e6">
          <ellipse cx="98" cy="17" rx="55" ry="9"/><ellipse cx="142" cy="14" rx="34" ry="6"/>
          <ellipse cx="310" cy="22" rx="60" ry="8"/>
        </g>
        <path d="M0 58 L58 42 L118 56 L180 40 L244 57 L310 44 L366 55 L400 48 L400 90 L0 90Z" fill="#4a5a4a" opacity=".62"/>
        <path d="M0 70 L70 58 L136 68 L204 56 L272 68 L338 58 L400 66 L400 90 L0 90Z" fill="#33422f" opacity=".78"/>
        <g stroke="#d7d5c8" stroke-width="2.2">
          <path d="M22 90 L24 38"/><path d="M46 90 L47 44"/><path d="M74 90 L77 34"/><path d="M98 90 L96 48"/>
          <path d="M140 90 L142 40"/><path d="M164 90 L166 46"/><path d="M192 90 L190 35"/><path d="M216 90 L218 49"/>
          <path d="M258 90 L260 39"/><path d="M282 90 L284 45"/><path d="M310 90 L308 34"/><path d="M334 90 L336 47"/>
          <path d="M366 90 L368 41"/><path d="M388 90 L390 46"/>
        </g>
        <g fill="#2c422f" opacity=".92">
          <ellipse cx="24" cy="34" rx="15" ry="10"/><ellipse cx="77" cy="30" rx="17" ry="11"/>
          <ellipse cx="142" cy="36" rx="16" ry="10"/><ellipse cx="190" cy="31" rx="18" ry="11"/>
          <ellipse cx="260" cy="35" rx="15" ry="10"/><ellipse cx="308" cy="30" rx="18" ry="11"/>
          <ellipse cx="368" cy="37" rx="16" ry="10"/>
        </g>
        <g>
          <path d="M150 90 L185 64 L215 64 L250 90Z" fill="#4d4b43"/>
          <path d="M160 90 L190 66 L198 66 L176 90Z" fill="#393833" opacity=".8"/>
          <path d="M240 90 L210 66 L218 66 L248 90Z" fill="#393833" opacity=".8"/>
          <path d="M197 64 L203 64 L200 90 L195 90Z" fill="#c9c4ad" opacity=".16"/>
          <path d="M181 68 L186 76 L182 84 M218 67 L213 76 L217 87 M195 70 L201 80" stroke="#23231e" stroke-width="1" fill="none" opacity=".7"/>
          <path d="M170 90 L191 66 M230 90 L209 66" stroke="#7d6d4b" stroke-width="2" opacity=".22"/>
        </g>
        <rect y="84" width="400" height="6" fill="#202b1c"/>
        <rect y="50" width="400" height="30" fill="#dbe3d9" opacity=".07"/>
      </svg>`;
    }
    if (biome === 'safari') {
      return `
      <svg class="biome-art" viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="sky-${stageId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#88a5bd"/><stop offset=".58" stop-color="#d8c49c"/><stop offset="1" stop-color="#b09263"/>
        </linearGradient></defs>
        <rect width="400" height="90" fill="url(#sky-${stageId})"/>
        <circle cx="312" cy="24" r="15" fill="#ffe0a0" opacity=".72"/>
        <path d="M0 62 L48 48 L104 60 L170 46 L238 60 L300 50 L356 60 L400 54 L400 90 L0 90Z" fill="#8a7149" opacity=".58"/>
        <path d="M0 74 L66 64 L130 72 L198 62 L268 72 L334 64 L400 70 L400 90 L0 90Z" fill="#6f5b39" opacity=".72"/>
        <g fill="#26301c">
          <path d="M42 90 L46 54 L50 90Z"/><path d="M46 58 Q20 48 6 50 Q24 58 46 58Z"/><path d="M46 58 Q70 45 88 49 Q68 60 46 58Z"/>
          <path d="M46 55 Q36 42 40 34 Q48 45 46 55Z"/>
          <path d="M164 90 L168 57 L172 90Z"/><path d="M168 61 Q140 50 124 54 Q144 63 168 61Z"/><path d="M168 61 Q194 48 212 52 Q192 64 168 61Z"/>
          <path d="M300 90 L304 55 L308 90Z"/><path d="M304 59 Q278 48 262 52 Q282 61 304 59Z"/><path d="M304 59 Q330 46 348 50 Q328 62 304 59Z"/>
          <path d="M304 56 Q296 44 300 36 Q306 46 304 56Z"/>
        </g>
        <g stroke="#88703f" stroke-width="1" opacity=".55">
          <path d="M8 88 L10 78"/><path d="M30 89 L31 77"/><path d="M54 88 L56 79"/><path d="M80 89 L81 76"/><path d="M112 88 L114 78"/>
          <path d="M140 89 L141 77"/><path d="M182 88 L184 79"/><path d="M214 89 L216 76"/><path d="M248 88 L249 78"/><path d="M282 89 L284 77"/>
          <path d="M324 88 L326 79"/><path d="M356 89 L358 76"/><path d="M386 88 L388 78"/>
        </g>
        <g>
          <path d="M146 90 L183 64 L217 64 L254 90Z" fill="#b06c35"/>
          <path d="M156 90 L188 66 L196 66 L172 90Z" fill="#8a522b" opacity=".75"/>
          <path d="M244 90 L212 66 L220 66 L252 90Z" fill="#8a522b" opacity=".75"/>
          <path d="M199 64 L203 64 L210 90 L205 90Z" fill="#d6b074" opacity=".4"/>
          <path d="M172 76 L194 80 M228 76 L206 80" stroke="#6e4726" stroke-width="1.2" opacity=".5"/>
          <path d="M188 66 Q196 78 192 90 M214 66 Q206 78 210 90" stroke="#e0bd80" stroke-width="1" fill="none" opacity=".25"/>
        </g>
        <rect y="84" width="400" height="6" fill="#4a3a23"/>
        <rect y="60" width="400" height="22" fill="#f4d9a4" opacity=".06"/>
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
        <g>
          <path d="M150 90 L183 65 L217 65 L250 90Z" fill="#e8f1f7"/>
          <path d="M158 90 L188 67 L196 67 L172 90Z" fill="#b7c9d7" opacity=".55"/>
          <path d="M242 90 L212 67 L220 67 L248 90Z" fill="#b7c9d7" opacity=".55"/>
          <path d="M164 74 L190 78 M236 74 L210 78" stroke="#a6bbcc" stroke-width="1.2" opacity=".5"/>
          <path d="M148 90 L181 65 M252 90 L219 65" stroke="#f8fcff" stroke-width="2" opacity=".7"/>
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
          <span class="car-sub"><span class="layout">${car.layout}</span><i></i>${car.year}<i></i>${car.series || car.country}</span>
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
            <div class="stage-name">${stage.cardName || stage.name}</div>
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
    const endless = this.selectedEndless;
    $$('.car-card', this.dom.carList).forEach((el) => {
      el.classList.toggle('selected', el.dataset.car === car.id);
    });
    $$('.stage-card', this.dom.stageList).forEach((el) => {
      el.classList.toggle('selected', el.dataset.stage === stage.id);
      const len = el.querySelector('.stage-len');
      if (len) {
        len.textContent = endless
          ? '∞'
          : `${getStageMetrics(getStage(el.dataset.stage)).km} KM`;
      }
    });
    if (this.dom.stageMode) {
      $$('button', this.dom.stageMode).forEach((el) => {
        el.classList.toggle('active', el.dataset.mode === this.selectedMode);
      });
    }
    // Keep the current car/stage visible when the lists are scrollable.
    for (const list of [this.dom.carList, this.dom.stageList]) {
      const selected = list?.querySelector('.selected');
      if (!list || !selected) continue;
      const lr = list.getBoundingClientRect();
      const sr = selected.getBoundingClientRect();
      if (sr.top < lr.top) list.scrollTop -= (lr.top - sr.top + 2);
      else if (sr.bottom > lr.bottom) list.scrollTop += (sr.bottom - lr.bottom + 2);
    }

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
      <div><div class="dlabel">LENGTH</div><div class="dval">${endless ? '∞ ENDLESS' : metrics.km + ' KM'}</div></div>
      <div><div class="dlabel">TARGET</div><div class="dval">${endless ? 'FREE RUN' : formatTime(metrics.target)}</div></div>
      <div><div class="dlabel">SURFACE</div><div class="dval">${stage.env.surfaceName}</div></div>
      <div><div class="dlabel">DIFFICULTY</div><div class="dval">${stage.difficultyLabel}</div></div>
      <div class="dwide"><span class="dlabel">ROAD NOTE</span><span class="dval">${stage.env.hint}</span></div>`;

    const est0to100 = Math.max(2.7, 2.2 + (car.weight / 1000) * 1.5 - (car.power / 500) * 0.9);
    this.dom.carFoot.innerHTML = `
      <span>0—100 EST.</span><b>${est0to100.toFixed(1)} S</b>
      <span>GEARBOX</span><b>${car.gearbox || '6-SPEED'}</b>
      <span>${car.interior === 'modern' ? 'MODEL YEAR' : 'HOMOLOGATION'}</span><b>${car.year}</b>`;
    const cond = resolveConditions(stage, this.settings.weather, this.settings.timeOfDay);
    const hazardCount = endless ? 'RANDOM'
      : (stage.hazardCount || (stage.biome === 'jungle' ? 7 : 5));
    const rec = stage.tyre || (stage.biome === 'snow' ? 'STUDS'
      : stage.biome === 'jungle' || stage.biome === 'japan' ? 'WET'
        : stage.biome === 'safari' ? 'DIRT' : 'GRAVEL');
    this.dom.stageIntel.innerHTML = `
      <div><span>WEATHER</span><b id="intel-weather">${cond.weatherLabel} / ${cond.timeLabel}</b></div>
      <div><span>HAZARD ZONES</span><b>${hazardCount}</b></div>
      <div><span>TYRE CALL</span><b>${rec}</b></div>`;
    this.dom.startMeta.textContent = endless
      ? `∞ ENDLESS · ${stage.name} · ${biome}`
      : `${stage.ss} · ${stage.name} · ${biome}`;
    if (this.dom.startLabel) {
      this.dom.startLabel.textContent = endless ? 'ENDLESS RUN' : 'START STAGE';
    }
    this._refreshBest();
    this._saveSelection();
    this._updateConditionLine();
    this.onSelection?.(car, stage);
  }

  _refreshBest() {
    if (this.selectedEndless) {
      const best = getEndlessBest(this.selectedStageId, this.selectedCarId);
      this.dom.best.textContent = best ? `${(best / 1000).toFixed(2)} KM` : '-- KM';
      return;
    }
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

  selectMode(mode) {
    this.selectedMode = mode === 'endless' ? 'endless' : 'stage';
    this._syncSelection();
    this._refreshBest();
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  _click() { this.onUiSound?.(); }

  _renderConditionOptions() {
    const opts = (modes) => modes.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
    const weather = opts(WEATHER_MODES);
    const time = opts(TIME_MODES);
    const camera = opts(CAMERA_MODES);
    const driving = opts(DRIVING_MODES);
    for (const el of [this.dom.menuWeather, this.dom.setWeather]) {
      if (el) el.innerHTML = weather;
    }
    for (const el of [this.dom.menuTime, this.dom.setTime]) {
      if (el) el.innerHTML = time;
    }
    for (const el of [this.dom.menuPhysics, this.dom.setPhysics]) {
      if (el) el.innerHTML = driving;
    }
    if (this.dom.setCamera) this.dom.setCamera.innerHTML = camera;
  }

  _syncConditionUi() {
    const s = this.settings;
    for (const el of [this.dom.menuWeather, this.dom.setWeather]) {
      if (el && el.value !== s.weather) el.value = s.weather;
    }
    for (const el of [this.dom.menuTime, this.dom.setTime]) {
      if (el && el.value !== s.timeOfDay) el.value = s.timeOfDay;
    }
    for (const el of [this.dom.menuPhysics, this.dom.setPhysics]) {
      if (el && el.value !== s.drivingModel) el.value = s.drivingModel;
    }
    if (this.dom.setCamera && this.dom.setCamera.value !== s.camera) this.dom.setCamera.value = s.camera;
    this._updateConditionLine();
  }

  _updateConditionLine() {
    const el = this.dom.conditionLine;
    const cond = resolveConditions(this.selectedStage, this.settings.weather, this.settings.timeOfDay);
    const intel = document.getElementById('intel-weather');
    if (intel) intel.textContent = `${cond.weatherLabel} / ${cond.timeLabel}`;
    if (!el) return;
    const weather = WEATHER_MODES.find((m) => m.id === this.settings.weather)?.label || 'AUTO';
    const time = TIME_MODES.find((m) => m.id === this.settings.timeOfDay)?.label || 'AUTO';
    const driving = DRIVING_MODES.find((m) => m.id === this.settings.drivingModel)?.label || 'REALISTIC';
    const conditions = weather === 'AUTO' && time === 'AUTO' ? 'STAGE DEFAULT' : `${weather} · ${time}`;
    el.textContent = `${conditions} · ${driving}`;
    el.classList.toggle('auto', weather === 'AUTO' && time === 'AUTO');
  }

  setCameraValue(mode) {
    this.settings.camera = mode;
    if (this.dom.setCamera) this.dom.setCamera.value = mode;
  }

  commitSettings() {
    this._commitSettings();
  }

  _bindEvents() {
    $('#btn-settings').addEventListener('click', () => { this._click(); this.openSettings(false); });
    $('#btn-help').addEventListener('click', () => { this._click(); this.openHelp(); });
    this.dom.startBtn.addEventListener('click', () => {
      this._click();
      if (this.dom.startBtn.disabled) return;
      this.onStart?.(this.selectedCar, this.selectedStage, this.selectedEndless);
    });
    if (this.dom.stageMode) {
      this.dom.stageMode.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        this._click();
        this.selectMode(btn.dataset.mode);
      });
    }
    $('#btn-settings-close').addEventListener('click', () => this.closeSettings());
    $('#btn-settings-done').addEventListener('click', () => this.closeSettings());
    $('#btn-help-close').addEventListener('click', () => this.closeHelp());
    $('#btn-help-done').addEventListener('click', () => this.closeHelp());
    for (const id of ['#btn-resume', '#btn-restart', '#btn-pause-settings', '#btn-pause-camera', '#btn-quit']) {
      $(id).addEventListener('click', () => this._click());
    }
    $('#btn-resume').addEventListener('click', () => this.onResume?.());
    $('#btn-restart').addEventListener('click', () => this.onRestart?.());
    $('#btn-pause-settings').addEventListener('click', () => this.openSettings(true));
    $('#btn-pause-camera').addEventListener('click', () => this.onCamera?.());
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
    bind('#set-shaders', 'shaders');
    bind('#set-volume', 'volume', (el) => parseInt(el.value, 10) / 100);
    bind('#set-voice', 'voice', (el) => el.checked);
    bind('#set-weather', 'weatherFx', (el) => el.checked);
    bind('#set-shake', 'shake', (el) => el.checked);
    bind('#set-sensitivity', 'lookSensitivity', (el) => parseInt(el.value, 10) / 100);
    bind('#set-units', 'units');
    const bindCond = (el, key) => {
      if (!el) return;
      el.addEventListener('change', () => {
        this.settings[key] = el.value;
        this._commitSettings();
        this._syncConditionUi();
      });
    };
    bindCond(this.dom.menuWeather, 'weather');
    bindCond(this.dom.menuTime, 'timeOfDay');
    bindCond(this.dom.menuPhysics, 'drivingModel');
    bindCond(this.dom.setWeather, 'weather');
    bindCond(this.dom.setTime, 'timeOfDay');
    bindCond(this.dom.setPhysics, 'drivingModel');
    bindCond(this.dom.setCamera, 'camera');
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
    $('#set-shaders').value = ['vivid', 'cinematic'].includes(this.settings.shaders) ? this.settings.shaders : 'off';
    $('#set-volume').value = Math.round(this.settings.volume * 100);
    $('#set-voice').checked = !!this.settings.voice;
    $('#set-weather').checked = !!this.settings.weatherFx;
    $('#set-shake').checked = !!this.settings.shake;
    $('#set-sensitivity').value = Math.round(this.settings.lookSensitivity * 100);
    $('#set-units').value = this.settings.units;
    this._syncConditionUi();
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
    document.body.classList.remove('in-race');
    this._blur();
    this.dom.menu.classList.remove('hidden');
    this.dom.loading.classList.add('hidden');
    this.dom.pause.classList.add('hidden');
    this.dom.results.classList.add('hidden');
    this.dom.countdown.classList.add('hidden');
    this.dom.gameHint.classList.add('hidden');
    this.dom.startBtn.disabled = false;
    this._refreshBest();
    this._updateConditionLine();
  }

  hideMenu() { this._blur(); this.dom.menu.classList.add('hidden'); }

  showLoading(stage, car, conditions) {
    this.dom.menu.classList.add('hidden');
    this.dom.results.classList.add('hidden');
    this.dom.pause.classList.add('hidden');
    this.dom.countdown.classList.add('hidden');
    this.dom.loading.classList.remove('hidden');
    const tag = stage.endless ? '∞ ENDLESS' : stage.ss;
    this.dom.loadingKicker.textContent = `${tag} // ${stage.name} // ${BIOME_LABEL[stage.biome]}`;
    this.dom.loadingCar.textContent = conditions
      ? `${car.name} · ${car.layout} · ${conditions.weatherLabel} · ${conditions.timeLabel}`
      : `${car.name} · ${car.layout} · ${car.tyre}`;
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
      this.dom.countdownSs.textContent = stage.endless ? '∞ ENDLESS' : stage.ss;
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
      `${data.stage.ss} · ${BIOME_LABEL[data.stage.biome]} · ${(data.length / 1000).toFixed(2)} KM` +
      (data.conditions ? ` · ${data.conditions.weatherLabel} / ${data.conditions.timeLabel}` : '');
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
