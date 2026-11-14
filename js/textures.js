import * as THREE from 'three';
import { mulberry32, makeCanvasTexture, canvas2D, clamp, lerp } from './util.js';

const hex = (n) => '#' + new THREE.Color(n).getHexString();
const rgb = (n) => {
  const c = new THREE.Color(n);
  return [c.r * 255, c.g * 255, c.b * 255];
};

/* ============================================================
   SURFACE TEXTURES
   ============================================================ */

function noiseFill(ctx, w, h, palette, rng, opacity = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const pick = palette[(rng() * palette.length) | 0];
    const v = 0.84 + rng() * 0.32;
    d[i] = clamp(pick[0] * v, 0, 255);
    d[i + 1] = clamp(pick[1] * v, 0, 255);
    d[i + 2] = clamp(pick[2] * v, 0, 255);
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (opacity < 1) {
    ctx.globalAlpha = opacity;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
}

function speckles(ctx, w, h, count, rng, colors, sizeMin = 0.5, sizeMax = 3, alpha = 1) {
  for (let i = 0; i < count; i++) {
    const c = colors[(rng() * colors.length) | 0];
    ctx.globalAlpha = alpha * (0.25 + rng() * 0.75);
    ctx.fillStyle = c;
    const s = sizeMin + rng() * (sizeMax - sizeMin);
    ctx.beginPath();
    ctx.ellipse(rng() * w, rng() * h, s, s * (0.45 + rng()), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function ruts(ctx, w, h, rng, color, alpha = 0.5) {
  for (const u of [0.255, 0.745]) {
    const cx = u * w;
    for (let i = 0; i < 7; i++) {
      ctx.globalAlpha = alpha * (0.2 + rng() * 0.25);
      ctx.fillStyle = color;
      const off = (rng() - 0.5) * 46;
      const ww = 9 + rng() * 30;
      ctx.fillRect(cx + off - ww / 2, 0, ww, h);
    }
    // tread bars
    for (let y = 0; y < h; y += 14 + rng() * 16) {
      ctx.globalAlpha = 0.05 + rng() * 0.09;
      ctx.fillStyle = '#000';
      ctx.fillRect(cx - 34 + rng() * 10, y, 62, 2 + rng() * 3);
    }
  }
  ctx.globalAlpha = 1;
}

function gravelTexture(rng) {
  const { canvas, ctx } = canvas2D(512, 1024);
  noiseFill(ctx, 512, 1024, [
    [105, 98, 82], [92, 86, 71], [122, 113, 94], [78, 73, 61], [140, 129, 108],
  ], rng);
  // large tonal bands
  for (let i = 0; i < 30; i++) {
    ctx.globalAlpha = 0.05 + rng() * 0.08;
    ctx.fillStyle = rng() > 0.5 ? '#c7b894' : '#4c4538';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 1024, 30 + rng() * 120, 80 + rng() * 260, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckles(ctx, 512, 1024, 9000, rng, ['#b5a886', '#5a5345', '#8d816a', '#d3c7a8', '#443e32'], 0.4, 2.6);
  ruts(ctx, 512, 1024, rng, '#3f3a30', 0.48);
  // centre ridge of loose stones
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#a99d82';
  ctx.fillRect(236, 0, 40, 1024);
  ctx.globalAlpha = 1;
  // dark edges
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(25,22,16,.55)');
  grad.addColorStop(0.12, 'rgba(25,22,16,0)');
  grad.addColorStop(0.88, 'rgba(25,22,16,0)');
  grad.addColorStop(1, 'rgba(25,22,16,.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);
  return { canvas, roughness: 0.93, bump: 0.075 };
}

function snowTexture(rng) {
  const { canvas, ctx } = canvas2D(512, 1024);
  noiseFill(ctx, 512, 1024, [[206, 217, 228], [193, 206, 219], [218, 228, 238], [180, 195, 209]], rng);
  for (let i = 0; i < 24; i++) {
    ctx.globalAlpha = 0.05 + rng() * 0.1;
    ctx.fillStyle = rng() > 0.55 ? '#ffffff' : '#9fb2c4';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 1024, 25 + rng() * 90, 70 + rng() * 240, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckles(ctx, 512, 1024, 2600, rng, ['#ffffff', '#c3d1df', '#f6fbff'], 0.5, 2, 0.7);
  ruts(ctx, 512, 1024, rng, '#778a9d', 0.58);
  // compacted ice sheen in ruts
  for (const u of [0.255, 0.745]) {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#6f8499';
    ctx.fillRect(u * 512 - 24, 0, 48, 1024);
  }
  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(244,250,255,.72)');
  grad.addColorStop(0.12, 'rgba(244,250,255,.05)');
  grad.addColorStop(0.88, 'rgba(244,250,255,.05)');
  grad.addColorStop(1, 'rgba(244,250,255,.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);
  return { canvas, roughness: 0.66, bump: 0.05 };
}

function mudTexture(rng) {
  const { canvas, ctx } = canvas2D(512, 1024);
  noiseFill(ctx, 512, 1024, [[77, 61, 39], [64, 51, 33], [92, 73, 46], [54, 43, 28], [106, 83, 52]], rng);
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.08 + rng() * 0.1;
    ctx.fillStyle = rng() > 0.5 ? '#191710' : '#8a7650';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 1024, 25 + rng() * 100, 90 + rng() * 260, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckles(ctx, 512, 1024, 4200, rng, ['#6d5c3d', '#3c3021', '#9d8b63', '#261f15'], 0.5, 3.2);
  ruts(ctx, 512, 1024, rng, '#251f16', 0.6);
  // wet reflective streaks
  for (let i = 0; i < 12; i++) {
    ctx.globalAlpha = 0.1 + rng() * 0.15;
    ctx.fillStyle = '#b5c7cc';
    ctx.beginPath();
    ctx.ellipse(80 + rng() * 350, rng() * 1024, 6 + rng() * 26, 25 + rng() * 70, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(20,25,12,.5)');
  grad.addColorStop(0.12, 'rgba(20,25,12,0)');
  grad.addColorStop(0.88, 'rgba(20,25,12,0)');
  grad.addColorStop(1, 'rgba(20,25,12,.5)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);
  return { canvas, roughness: 0.6, bump: 0.06 };
}

export function makeRoadTexture(type) {
  const rng = mulberry32(type === 'snow' ? 71 : type === 'mud' ? 177 : 311);
  const res = type === 'snow' ? snowTexture(rng) : type === 'mud' ? mudTexture(rng) : gravelTexture(rng);
  const tex = makeCanvasTexture(res.canvas, { repeat: true, anisotropy: 8 });
  // use luminance as bump map via same canvas (approximate)
  const bump = new THREE.CanvasTexture(res.canvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 4;
  bump.colorSpace = THREE.NoColorSpace;
  return { map: tex, bump, roughness: res.roughness, bumpScale: res.bump };
}

/* ============================================================
   GROUND TEXTURES
   ============================================================ */

export function makeGroundTexture(biome) {
  const rng = mulberry32(biome === 'snow' ? 999 : biome === 'jungle' ? 444 : 808);
  const { canvas, ctx } = canvas2D(512, 512);
  if (biome === 'snow') {
    noiseFill(ctx, 512, 512, [[221, 231, 240], [209, 221, 232], [233, 241, 249], [196, 209, 222]], rng);
    speckles(ctx, 512, 512, 1400, rng, ['#f9fdff', '#c2d2e0', '#a5b9ca'], 0.5, 1.8, 0.6);
    for (let i = 0; i < 10; i++) {
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#8fa4b6';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 40 + rng() * 100, 20 + rng() * 60, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'jungle') {
    noiseFill(ctx, 512, 512, [[45, 56, 30], [56, 66, 36], [37, 47, 24], [68, 72, 40]], rng);
    speckles(ctx, 512, 512, 5200, rng, ['#2e3d20', '#6d7343', '#3f4b27', '#7d6b3e', '#27331a'], 0.5, 3.4);
    for (let i = 0; i < 30; i++) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#79864b';
      ctx.lineWidth = 1;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 6, y - 14, x + (rng() - 0.5) * 18, y - 26);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    noiseFill(ctx, 512, 512, [[62, 72, 43], [52, 61, 35], [76, 83, 49], [44, 52, 30]], rng);
    speckles(ctx, 512, 512, 5600, rng, ['#3e4a2a', '#7b8354', '#5e5236', '#8c7246', '#2c3520', '#a0905d'], 0.5, 3.2);
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = rng() > 0.5 ? '#7d8c52' : '#a08b56';
      ctx.lineWidth = 1;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 5, y - 4 - rng() * 9);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
}

/* ============================================================
   SPRITES
   ============================================================ */

export function makeSoftDotTexture() {
  const { canvas, ctx } = canvas2D(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return makeCanvasTexture(canvas, { srgb: true });
}

export function makeRainTexture() {
  const { canvas, ctx } = canvas2D(16, 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(220,235,245,0)');
  g.addColorStop(0.5, 'rgba(220,235,245,.75)');
  g.addColorStop(1, 'rgba(220,235,245,0)');
  ctx.fillStyle = g;
  ctx.fillRect(6, 0, 4, 64);
  return makeCanvasTexture(canvas, { srgb: true });
}

export function makeSunTexture() {
  const { canvas, ctx } = canvas2D(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,252,235,1)');
  g.addColorStop(0.12, 'rgba(255,244,205,.95)');
  g.addColorStop(0.4, 'rgba(255,227,160,.25)');
  g.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return makeCanvasTexture(canvas);
}

export function makeGrimeTexture() {
  const { canvas, ctx } = canvas2D(512, 256);
  ctx.clearRect(0, 0, 512, 256);
  // dusty corners + faint wiper arcs
  const corners = [[0, 0, 1], [512, 0, -1], [0, 256, 1], [512, 256, -1]];
  for (const [x, y, dir] of corners) {
    const g = ctx.createRadialGradient(x, y, 10, x, y, 200);
    g.addColorStop(0, 'rgba(120,108,82,.55)');
    g.addColorStop(0.5, 'rgba(120,108,82,.18)');
    g.addColorStop(1, 'rgba(120,108,82,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
  }
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = '#6d6350';
  ctx.lineWidth = 5;
  for (let r = 70; r < 260; r += 26) {
    ctx.beginPath();
    ctx.arc(256, 300, r, Math.PI * 1.06, Math.PI * 1.94);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return makeCanvasTexture(canvas, { srgb: true });
}

/* ============================================================
   CAR DECALS
   ============================================================ */

function roundel(ctx, x, y, r, car) {
  ctx.fillStyle = '#f2efe4';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = r * 0.09;
  ctx.strokeStyle = hex(car.accent);
  ctx.stroke();
  ctx.fillStyle = '#1a1a18';
  ctx.font = `700 ${r * 1.18}px "Barlow Condensed", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(car.number), x, y + r * 0.06);
}

function drawStripePattern(ctx, w, h, car) {
  const a = hex(car.accent);
  const b = hex(car.accent2);
  ctx.save();
  ctx.translate(w * 0.5, h * 0.58);
  ctx.rotate(-0.11);
  if (car.livery === 'martini') {
    ctx.fillStyle = '#e9e6dc'; ctx.fillRect(-w * 0.62, -h * 0.06, w * 1.24, h * 0.055);
    ctx.fillStyle = b; ctx.fillRect(-w * 0.62, h * 0.0, w * 1.24, h * 0.06);
    ctx.fillStyle = a; ctx.fillRect(-w * 0.62, h * 0.065, w * 1.24, h * 0.04);
  } else if (car.livery === 'quattro') {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? a : b;
      ctx.fillRect(-w * 0.62 + i * 34, -h * 0.1, 20, h * 0.24);
    }
    ctx.fillStyle = a;
    ctx.fillRect(-w * 0.62, h * 0.03, w * 1.24, h * 0.055);
  } else if (car.livery === 'peugeot') {
    ctx.fillStyle = a;
    ctx.fillRect(-w * 0.62, -h * 0.02, w * 1.24, h * 0.055);
    ctx.fillStyle = b;
    ctx.fillRect(-w * 0.62, h * 0.05, w * 1.24, h * 0.025);
  } else if (car.livery === 'r5') {
    ctx.fillStyle = a;
    ctx.fillRect(-w * 0.62, -h * 0.08, w * 1.24, h * 0.08);
    ctx.fillStyle = b;
    ctx.fillRect(-w * 0.1, -h * 0.08, w * 0.09, h * 0.2);
  } else {
    ctx.fillStyle = a;
    ctx.fillRect(-w * 0.62, -h * 0.03, w * 1.24, h * 0.06);
    ctx.fillStyle = b;
    ctx.fillRect(-w * 0.62, h * 0.045, w * 1.24, h * 0.035);
  }
  ctx.restore();
}

export function makeSideDecal(car) {
  const { canvas, ctx } = canvas2D(1024, 384);
  ctx.clearRect(0, 0, 1024, 384);
  drawStripePattern(ctx, 1024, 384, car);
  roundel(ctx, 240, 200, 78, car);
  ctx.fillStyle = '#171714';
  ctx.font = '700 46px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(car.short, 340, 186);
  ctx.fillStyle = 'rgba(23,23,20,.75)';
  ctx.font = '600 22px "Barlow Condensed", sans-serif';
  ctx.fillText('RALLY LEGENDS · GROUP B', 342, 218);
  // small technical decals
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(25,25,22,.55)';
  ctx.font = '600 16px "Barlow", sans-serif';
  ctx.fillText('TURBO', 960, 88);
  ctx.fillText(car.engine, 960, 110);
  ctx.strokeStyle = 'rgba(30,30,25,.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(342, 154, 350, 82);
  return makeCanvasTexture(canvas);
}

export function makeHoodDecal(car) {
  const { canvas, ctx } = canvas2D(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  // stripes running front-to-back on hood
  const a = hex(car.accent);
  const b = hex(car.accent2);
  ctx.save();
  ctx.translate(256, 0);
  if (car.livery === 'martini') {
    ctx.fillStyle = b; ctx.fillRect(-90, 0, 45, 512);
    ctx.fillStyle = '#e9e6dc'; ctx.fillRect(-45, 0, 26, 512);
    ctx.fillStyle = a; ctx.fillRect(-19, 0, 38, 512);
  } else {
    ctx.fillStyle = a; ctx.fillRect(-54, 0, 32, 512);
    ctx.fillStyle = b; ctx.fillRect(-22, 0, 22, 512);
  }
  ctx.restore();
  ctx.globalAlpha = 0.9;
  roundel(ctx, 400, 310, 54, car);
  ctx.globalAlpha = 1;
  return makeCanvasTexture(canvas);
}

export function makeBannerTexture(stage, finish = false) {
  const { canvas, ctx } = canvas2D(1024, 192);
  ctx.fillStyle = finish ? '#161a16' : '#171b17';
  ctx.fillRect(0, 0, 1024, 192);
  if (finish) {
    const s = 48;
    for (let x = 0; x < 1024; x += s) {
      for (let y = 0; y < 192; y += s) {
        if (((x / s) + (y / s)) % 2 === 0) {
          ctx.fillStyle = '#e9e6d8'; ctx.fillRect(x, y, s, s);
        }
      }
    }
    ctx.fillStyle = 'rgba(15,18,14,.82)';
    ctx.fillRect(142, 30, 740, 132);
  }
  ctx.fillStyle = hex(stage.env.ground);
  ctx.fillRect(0, 0, 1024, 16);
  ctx.fillStyle = '#f2cf4a';
  ctx.fillRect(0, 16, 1024, 4);
  ctx.fillStyle = '#efece0';
  ctx.font = '700 82px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(finish ? 'FINISH' : `${stage.ss} · ${stage.name}`, 512, 88);
  ctx.font = '600 22px "Barlow", sans-serif';
  ctx.fillStyle = '#f2cf4a';
  ctx.fillText(finish ? 'GROUP B RALLY LEGENDS' : stage.subtitle, 512, 146);
  return makeCanvasTexture(canvas);
}

export function makeStartLightsTexture() {
  const { canvas, ctx } = canvas2D(512, 256);
  ctx.fillStyle = '#151715';
  ctx.fillRect(0, 0, 512, 256);
  const positions = [[146, 128], [256, 128], [366, 128]];
  for (const [x, y] of positions) {
    ctx.fillStyle = '#2c1414';
    ctx.beginPath(); ctx.arc(x, y, 52, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0b0c0b'; ctx.lineWidth = 7; ctx.stroke();
  }
  return makeCanvasTexture(canvas);
}

export function drawStartLights(texture, count) {
  const canvas = texture.image;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#151715';
  ctx.fillRect(0, 0, 512, 256);
  const positions = [[146, 128], [256, 128], [366, 128]];
  const green = count >= 4;
  positions.forEach(([x, y], i) => {
    const on = green || i < count;
    if (on) {
      const g = ctx.createRadialGradient(x, y, 2, x, y, 56);
      if (green) {
        g.addColorStop(0, '#f2ffd9');
        g.addColorStop(0.24, '#8dff6b');
        g.addColorStop(0.6, '#148a32');
        g.addColorStop(1, '#073d15');
      } else {
        g.addColorStop(0, '#fff6d8');
        g.addColorStop(0.24, '#ffca3a');
        g.addColorStop(0.6, '#c3261b');
        g.addColorStop(1, '#540d09');
      }
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = '#2c1414';
    }
    ctx.beginPath(); ctx.arc(x, y, 52, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0b0c0b'; ctx.lineWidth = 7; ctx.stroke();
  });
  texture.needsUpdate = true;
}

/* ============================================================
   FOLIAGE SPRITES
   ============================================================ */

export function makeFernTexture() {
  const { canvas, ctx } = canvas2D(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#5d7a3c';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(64, 126); ctx.quadraticCurveTo(68, 60, 64, 10); ctx.stroke();
  for (let i = 0; i < 11; i++) {
    const y = 112 - i * 9;
    const len = 12 + i * 4.6;
    ctx.strokeStyle = i % 3 === 0 ? '#6f8f48' : '#4b6732';
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(64, y); ctx.quadraticCurveTo(64 - len * 0.6, y - 5, 64 - len, y - 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(64, y); ctx.quadraticCurveTo(64 + len * 0.6, y - 5, 64 + len, y - 11); ctx.stroke();
  }
  return makeCanvasTexture(canvas, { srgb: true });
}

export function makeGrassTexture() {
  const { canvas, ctx } = canvas2D(64, 128);
  ctx.clearRect(0, 0, 64, 128);
  const rng = mulberry32(42);
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(${70 + rng() * 45},${95 + rng() * 55},${45 + rng() * 30},0.95)`;
    ctx.lineWidth = 1.5 + rng();
    const x = 6 + rng() * 52;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.quadraticCurveTo(x + (rng() - 0.5) * 22, 70, x + (rng() - 0.5) * 34, 8 + rng() * 30);
    ctx.stroke();
  }
  return makeCanvasTexture(canvas, { srgb: true });
}

export function makeCrowdShirt(i) {
  const colors = [0xd84a2a, 0x2f5fa8, 0xe0b52b, 0x3c7a3c, 0xcfcfc4, 0xa83242, 0x3c3c44];
  return colors[i % colors.length];
}
