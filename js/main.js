import * as THREE from 'three';
import { Game } from './game.js';

const canvas = document.getElementById('gl');
const params = new URLSearchParams(window.location.search);
// Automation hooks are opt-in only. Production players never get a mutable
// game object on `window`.
const debugEnabled = params.get('debug') === '1';
const isTouchDevice = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
  (navigator.maxTouchPoints || 0) > 0;
if (isTouchDevice) document.body.classList.add('touch-mode');

function buildOverlay(title, message, buttonLabel = null, onButton = null) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:#080b08;color:#ece7d7;' +
    'display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;' +
    'font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;letter-spacing:.04em;';
  const box = document.createElement('div');
  const brand = document.createElement('div');
  brand.textContent = title;
  brand.style.cssText = 'font-size:10px;letter-spacing:.3em;color:#f2c43a;margin-bottom:14px';
  const body = document.createElement('div');
  body.textContent = message;
  box.appendChild(brand);
  box.appendChild(body);
  if (buttonLabel && onButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = buttonLabel;
    button.style.cssText = 'margin-top:22px;padding:10px 20px;border:1px solid #f2c43a;' +
      'background:transparent;color:#f2c43a;font:inherit;letter-spacing:.12em;cursor:pointer';
    button.addEventListener('click', onButton);
    box.appendChild(button);
  }
  overlay.appendChild(box);
  return overlay;
}

function fail(message) {
  const overlay = buildOverlay('GROUP B — RALLY LEGENDS', message, 'RELOAD', () => location.reload());
  document.body.appendChild(overlay);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isTouchDevice,
    powerPreference: 'high-performance',
    stencil: false,
  });
} catch (err) {
  console.error(err);
  fail('WebGL could not start. Please enable hardware acceleration or use a modern browser.');
  throw err;
}

renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x070b08, 1);

let game;
try {
  game = new Game(canvas, renderer);
} catch (err) {
  console.error(err);
  fail('The rally computer failed to initialise. Check the browser console for details.');
  throw err;
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  game.resize(w, h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => {
  setTimeout(resize, 180);
  setTimeout(resize, 520);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (Math.abs(window.visualViewport.width - window.innerWidth) < 120) resize();
  });
}
resize();

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'racing') game.pause();
});

/* ============================================================
   WEBGL CONTEXT LOSS
   A lost GPU context is recoverable: pause the run, tell the player
   what happened, and let Three.js re-upload resources on restore.
   ============================================================ */
let contextLost = false;
let contextOverlay = null;

function showContextLoss() {
  if (contextOverlay) return;
  contextOverlay = buildOverlay(
    'GRAPHICS CONTEXT LOST',
    'The GPU or browser reset the WebGL context. If a run was active it has ' +
    'been paused. Rendering resumes when the browser restores the context; ' +
    'use Resume to continue the run.',
    'RELOAD',
    () => location.reload()
  );
  document.body.appendChild(contextOverlay);
}

function hideContextLoss() {
  contextOverlay?.remove();
  contextOverlay = null;
}

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  if (game.state === 'racing') game.pause();
  showContextLoss();
}, false);

canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  hideContextLoss();
}, false);

/* ============================================================
   FRAME LOOP
   A repeated update failure is fatal rather than an infinite log
   stream: stop scheduling frames and show one recovery screen.
   ============================================================ */
let last = performance.now();
let frames = 0;
let fpsTime = 0;
let errorStreak = 0;
let lastErrorLog = 0;
let loopStopped = false;

function stopForFatalError(err) {
  if (loopStopped) return;
  loopStopped = true;
  console.error('Game loop stopped after repeated update failures', err);
  try { game.audio?.setEngine?.(false); } catch { /* ignore */ }
  try { game.audio?.hushVoice?.(); } catch { /* ignore */ }
  const overlay = buildOverlay(
    'GROUP B — RALLY LEGENDS',
    'The rally computer hit an unrecoverable error. Reload to restart the game. ' +
    'Details are available in the browser console.',
    'RELOAD',
    () => location.reload()
  );
  document.body.appendChild(overlay);
}

function loop(now) {
  if (loopStopped) return;
  requestAnimationFrame(loop);
  if (contextLost) {
    last = now;
    return;
  }
  const rawDt = Math.max(0, (now - last) / 1000);
  last = now;
  const dt = Math.min(0.05, rawDt);
  try {
    game.update(dt, rawDt);
    errorStreak = 0;
  } catch (err) {
    errorStreak++;
    if (errorStreak <= 2 || now - lastErrorLog > 3000) {
      console.error('Game update failed', err);
      lastErrorLog = now;
    }
    if (errorStreak >= 3) {
      stopForFatalError(err);
      return;
    }
  }
  frames++;
  fpsTime += dt;
  if (fpsTime > 2) {
    game.fps = Math.round(frames / fpsTime);
    frames = 0;
    fpsTime = 0;
  }
}

requestAnimationFrame(loop);

// Minimal, opt-in surface for automated checks. It deliberately does not
// expose the mutable Game instance.
if (debugEnabled) {
  window.__RALLY = Object.freeze({
    start(carId = 'quattro', stageId = 'kielder', endless = false) {
      return game.startStageById(carId, stageId, !!endless);
    },
    state() { return game.debugState(); },
    pause() { game.pause(); },
    resume() { game.resume(); },
    quit() { game.quitToMenu(); },
    camera(mode) { game.setCameraMode(mode); },
  });
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection', event.reason);
});
