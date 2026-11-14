import * as THREE from 'three';
import { Game } from './game.js';

const canvas = document.getElementById('gl');

function fail(message) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#080b08;color:#ece7d7;' +
    'display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;' +
    'font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;letter-spacing:.04em;';
  el.innerHTML = `<div><div style="font-size:10px;letter-spacing:.3em;color:#f2c43a;margin-bottom:14px">GROUP B — RALLY LEGENDS</div>${message}</div>`;
  document.body.appendChild(el);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
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
resize();

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'racing') game.pause();
});

let last = performance.now();
let frames = 0;
let fpsTime = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    game.update(dt);
  } catch (err) {
    console.error(err);
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

// expose a small test surface for automated checks
window.__RALLY = {
  game,
  start(carId = 'quattro', stageId = 'kielder') {
    const car = game.ui.selectedCar;
    const stage = game.ui.selectedStage;
    // import config lazily through module graph via game selections
    game.ui.selectCar(carId);
    game.ui.selectStage(stageId);
    game.startStage(game.ui.selectedCar, game.ui.selectedStage);
  },
};
