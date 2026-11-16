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

function tarmacTexture(rng) {
  const { canvas, ctx } = canvas2D(512, 1024);
  noiseFill(ctx, 512, 1024, [[58, 58, 56], [49, 50, 48], [68, 67, 64], [42, 43, 41], [77, 75, 70]], rng);
  for (let i = 0; i < 22; i++) {
    ctx.globalAlpha = 0.05 + rng() * 0.09;
    ctx.fillStyle = rng() > 0.5 ? '#9a9b92' : '#232523';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 1024, 25 + rng() * 95, 80 + rng() * 260, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckles(ctx, 512, 1024, 7800, rng, ['#8d8d84', '#373936', '#6f716b', '#a3a399', '#2d2f2d'], 0.4, 1.8);
  // polished tyre lines and a little surface cracking
  for (const u of [0.265, 0.735]) {
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#b0b2a8';
    ctx.fillRect(u * 512 - 30, 0, 60, 1024);
  }
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = '#252725';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 38; i++) {
    const x = rng() * 512;
    const y = rng() * 1024;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 36, y + 12 + rng() * 45);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(12,16,12,.42)');
  grad.addColorStop(0.1, 'rgba(12,16,12,0)');
  grad.addColorStop(0.9, 'rgba(12,16,12,0)');
  grad.addColorStop(1, 'rgba(12,16,12,.42)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);
  return { canvas, roughness: 0.79, bump: 0.024 };
}

function dirtTexture(rng) {
  const { canvas, ctx } = canvas2D(512, 1024);
  noiseFill(ctx, 512, 1024, [[132, 98, 61], [118, 86, 53], [151, 112, 70], [105, 77, 49], [163, 126, 83]], rng);
  for (let i = 0; i < 28; i++) {
    ctx.globalAlpha = 0.06 + rng() * 0.11;
    ctx.fillStyle = rng() > 0.5 ? '#d0a267' : '#5d4228';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 1024, 30 + rng() * 120, 80 + rng() * 270, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckles(ctx, 512, 1024, 8200, rng, ['#c79a60', '#6e4f31', '#9b7548', '#e0b87a', '#4d3924'], 0.5, 2.7);
  ruts(ctx, 512, 1024, rng, '#4e3822', 0.56);
  // dry straw and pebbles on the edges
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = rng() > 0.5 ? '#b99157' : '#7b5a36';
    ctx.lineWidth = 1;
    const x = rng() * 512;
    const y = rng() * 1024;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 14, y - 3 - rng() * 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(45,30,16,.5)');
  grad.addColorStop(0.12, 'rgba(45,30,16,0)');
  grad.addColorStop(0.88, 'rgba(45,30,16,0)');
  grad.addColorStop(1, 'rgba(45,30,16,.5)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);
  return { canvas, roughness: 0.9, bump: 0.065 };
}

function bumpCanvasFrom(rng, w, h, base, amp, coarse = 2.4) {
  const { canvas, ctx } = canvas2D(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = clamp(base + (rng() - 0.5) * amp, 0, 255);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function asphaltTexture(rng) {
  const { canvas, ctx } = canvas2D(512, 1024);
  noiseFill(ctx, 512, 1024, [
    [53, 55, 55], [45, 47, 47], [62, 63, 61], [38, 40, 40], [70, 71, 68],
  ], rng);
  // Repaired patches and sun bleaching.
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.04 + rng() * 0.09;
    ctx.fillStyle = rng() > 0.55 ? '#9a9d98' : '#202423';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 1024, 22 + rng() * 95, 60 + rng() * 230, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckles(ctx, 512, 1024, 12000, rng, ['#9c9e97', '#2f3332', '#797c76', '#b4b5ad', '#3d4140'], 0.35, 1.7);
  // Polished tyre lines.
  for (const u of [0.265, 0.735]) {
    const g = ctx.createLinearGradient(u * 512 - 42, 0, u * 512 + 42, 0);
    g.addColorStop(0, 'rgba(150,154,150,0)');
    g.addColorStop(0.5, 'rgba(170,174,168,.16)');
    g.addColorStop(1, 'rgba(150,154,150,0)');
    ctx.fillStyle = g;
    ctx.fillRect(u * 512 - 42, 0, 84, 1024);
  }
  // Cracks and aggregate seams.
  ctx.lineCap = 'round';
  for (let i = 0; i < 42; i++) {
    ctx.globalAlpha = 0.16 + rng() * 0.2;
    ctx.strokeStyle = '#1f2322';
    ctx.lineWidth = 0.7 + rng() * 1.8;
    let x = rng() * 512;
    let y = rng() * 1024;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 3 + Math.floor(rng() * 4); k++) {
      x += (rng() - 0.5) * 42;
      y += 8 + rng() * 34;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Painted road markings: continuous centre line and fragile edge lines.
  const paint = (x, w, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#e8e6da';
    ctx.fillRect(x - w / 2, 0, w, 1024);
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = alpha * (0.2 + rng() * 0.5);
      ctx.fillStyle = '#5d615c';
      ctx.fillRect(x - w / 2 + rng() * w, rng() * 1024, 0.6 + rng() * 1.4, 2 + rng() * 11);
    }
    ctx.globalAlpha = 1;
  };
  // White centre line down the crown, plus edge lines.
  paint(256, 6.5, 0.72);
  paint(37, 4.5, 0.55);
  paint(475, 4.5, 0.55);
  // Water film / damp sheen patches.
  for (let i = 0; i < 18; i++) {
    ctx.globalAlpha = 0.035 + rng() * 0.06;
    ctx.fillStyle = '#c5d3d6';
    ctx.beginPath();
    ctx.ellipse(40 + rng() * 432, rng() * 1024, 10 + rng() * 45, 22 + rng() * 110, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(27,30,24,.55)');
  grad.addColorStop(0.1, 'rgba(27,30,24,0)');
  grad.addColorStop(0.9, 'rgba(27,30,24,0)');
  grad.addColorStop(1, 'rgba(27,30,24,.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);
  const bumpCanvas = bumpCanvasFrom(rng, 512, 1024, 136, 38);
  return { canvas, roughness: 0.6, bump: 0.028, bumpCanvas };
}

function brokenAsphaltTexture(rng) {
  const { canvas, ctx } = canvas2D(512, 1024);
  noiseFill(ctx, 512, 1024, [
    [82, 81, 74], [70, 70, 65], [94, 91, 82], [60, 61, 57], [104, 98, 85],
  ], rng);
  // Large faded repairs, gravel breakthroughs and mossy shoulders.
  for (let i = 0; i < 22; i++) {
    ctx.globalAlpha = 0.06 + rng() * 0.11;
    ctx.fillStyle = rng() > 0.55 ? '#a99b82' : rng() > 0.4 ? '#30332e' : '#5b6247';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 1024, 18 + rng() * 110, 40 + rng() * 220, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckles(ctx, 512, 1024, 10500, rng, ['#aaa08b', '#3f413b', '#c0b696', '#5e6057', '#7d725d'], 0.5, 3.2);
  // Repaired asphalt slabs.
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = 0.14 + rng() * 0.12;
    ctx.fillStyle = rng() > 0.5 ? '#6e6d63' : '#8a8779';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 1024, 35 + rng() * 90, 60 + rng() * 180, rng() * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Broken edges and potholes.
  for (let i = 0; i < 25; i++) {
    const x = 20 + rng() * 472;
    const y = rng() * 1024;
    const r = 5 + rng() * 25;
    ctx.globalAlpha = 0.35 + rng() * 0.35;
    ctx.fillStyle = '#25251f';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.7), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#a18e68';
    ctx.beginPath();
    ctx.ellipse(x + (rng() - 0.5) * r * 2, y + (rng() - 0.5) * r * 2, r * 0.38, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Long wandering cracks.
  ctx.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    ctx.globalAlpha = 0.3 + rng() * 0.3;
    ctx.strokeStyle = '#1d201c';
    ctx.lineWidth = 1 + rng() * 2.2;
    let x = rng() * 512;
    let y = rng() * 1024;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4 + Math.floor(rng() * 5); k++) {
      x += (rng() - 0.5) * 38;
      y += 10 + rng() * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Moss creeping in from the shoulders.
  for (let i = 0; i < 55; i++) {
    const edge = rng() > 0.5;
    ctx.globalAlpha = 0.12 + rng() * 0.24;
    ctx.fillStyle = rng() > 0.5 ? '#687a3d' : '#48502d';
    ctx.beginPath();
    ctx.ellipse(edge ? rng() * 95 : 417 + rng() * 95, rng() * 1024, 5 + rng() * 32, 10 + rng() * 60, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Old, almost erased centre line.
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#dbd4bd';
  ctx.fillRect(252, 0, 5, 1024);
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = 0.25 + rng() * 0.45;
    ctx.fillStyle = '#6b6558';
    ctx.fillRect(250 + rng() * 9, rng() * 1024, 1 + rng() * 3, 6 + rng() * 34);
  }
  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(39,35,23,.62)');
  grad.addColorStop(0.14, 'rgba(39,35,23,0)');
  grad.addColorStop(0.86, 'rgba(39,35,23,0)');
  grad.addColorStop(1, 'rgba(39,35,23,.62)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);
  const bumpCanvas = bumpCanvasFrom(rng, 512, 1024, 124, 64);
  return { canvas, roughness: 0.82, bump: 0.05, bumpCanvas };
}

export function makeRoadTexture(type) {
  const rng = mulberry32(
    type === 'snow' ? 71
      : type === 'mud' ? 177
        : type === 'asphalt' ? 233
          : type === 'broken' ? 617
            : type === 'dirt' ? 419
              : type === 'tarmac' ? 233 : 311
  );
  const res = type === 'snow' ? snowTexture(rng)
    : type === 'mud' ? mudTexture(rng)
      : type === 'asphalt' ? asphaltTexture(rng)
        : type === 'broken' ? brokenAsphaltTexture(rng)
          : type === 'dirt' ? dirtTexture(rng)
            : gravelTexture(rng);
  const tex = makeCanvasTexture(res.canvas, { repeat: true, anisotropy: 8 });
  // A dedicated height map gives the road real surface relief instead of
  // reusing luminance from the colour map.
  const bumpCanvas = res.bumpCanvas || res.canvas;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 4;
  bump.colorSpace = THREE.NoColorSpace;
  return { map: tex, bump, roughness: res.roughness, bumpScale: res.bump };
}

/* ============================================================
   GROUND TEXTURES
   ============================================================ */

export function makeGroundTexture(biome) {
  const rng = mulberry32(
    biome === 'snow' ? 999
      : biome === 'jungle' ? 444
        : biome === 'japan' ? 1201
          : biome === 'russia' ? 1707
            : biome === 'safari' ? 2203 : 808
  );
  const { canvas, ctx } = canvas2D(512, 512);
  if (biome === 'snow') {
    noiseFill(ctx, 512, 512, [[226, 235, 243], [214, 226, 237], [238, 245, 251], [201, 215, 229]], rng);
    // wind-packed ripples
    for (let i = 0; i < 34; i++) {
      ctx.globalAlpha = 0.05 + rng() * 0.09;
      ctx.strokeStyle = rng() > 0.5 ? '#ffffff' : '#a6b9ca';
      ctx.lineWidth = 1 + rng() * 2.4;
      ctx.beginPath();
      const y = rng() * 512;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(150, y + (rng() - 0.5) * 34, 340, y + (rng() - 0.5) * 34, 512, y + (rng() - 0.5) * 20);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 2400, rng, ['#ffffff', '#dce8f3', '#b8cad9', '#f8fcff'], 0.4, 1.8, 0.8);
    // a few frozen grass tips and stones poking through
    for (let i = 0; i < 90; i++) {
      ctx.globalAlpha = 0.22 + rng() * 0.35;
      ctx.strokeStyle = rng() > 0.5 ? '#909b82' : '#b8b89a';
      ctx.lineWidth = 1;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 9, y - 4 - rng() * 13);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'jungle') {
    noiseFill(ctx, 512, 512, [[37, 49, 27], [49, 61, 33], [29, 40, 21], [63, 71, 39]], rng);
    for (let i = 0; i < 72; i++) {
      ctx.globalAlpha = 0.12 + rng() * 0.24;
      ctx.fillStyle = rng() > 0.45 ? '#5f7a35' : '#28391a';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 7 + rng() * 46, 4 + rng() * 20, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 6500, rng, ['#2e3d20', '#779542', '#415029', '#8d743d', '#1d2914'], 0.5, 3.6);
    // broad fallen leaves and leaf veins
    for (let i = 0; i < 55; i++) {
      const x = rng() * 512, y = rng() * 512, r = 4 + rng() * 11;
      ctx.globalAlpha = 0.35 + rng() * 0.35;
      ctx.fillStyle = rng() > 0.5 ? '#718b3c' : '#8b6b35';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.38, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha *= 0.5;
      ctx.strokeStyle = '#2b3518';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.8, y);
      ctx.lineTo(x + r * 0.8, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // thin exposed roots
    for (let i = 0; i < 26; i++) {
      ctx.globalAlpha = 0.25 + rng() * 0.25;
      ctx.strokeStyle = '#3a2c1a';
      ctx.lineWidth = 1 + rng() * 2;
      let x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (rng() - 0.5) * 40;
        y += 10 + rng() * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'japan') {
    noiseFill(ctx, 512, 512, [[48, 61, 37], [41, 52, 32], [60, 70, 43], [35, 45, 28]], rng);
    // fallen cedar needles form warm patches
    for (let i = 0; i < 58; i++) {
      ctx.globalAlpha = 0.08 + rng() * 0.2;
      ctx.fillStyle = rng() > 0.55 ? '#8d6d3b' : '#5b743f';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 10 + rng() * 55, 8 + rng() * 32, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 7400, rng, ['#334126', '#7d8d50', '#566436', '#9a7545', '#26331d', '#a99462'], 0.4, 3.0);
    // moss and needle strokes
    for (let i = 0; i < 120; i++) {
      ctx.globalAlpha = 0.2 + rng() * 0.35;
      ctx.strokeStyle = rng() > 0.35 ? '#738f4b' : '#a8884f';
      ctx.lineWidth = 0.8 + rng() * 0.9;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 9, y - 4 - rng() * 13);
      ctx.stroke();
    }
    // wet stone highlights
    for (let i = 0; i < 22; i++) {
      ctx.globalAlpha = 0.15 + rng() * 0.3;
      ctx.fillStyle = '#6b7264';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 4 + rng() * 17, 3 + rng() * 10, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'russia') {
    noiseFill(ctx, 512, 512, [[81, 95, 48], [69, 82, 42], [102, 111, 61], [57, 69, 37]], rng);
    // bright meadow drifts and dark undergrowth
    for (let i = 0; i < 55; i++) {
      ctx.globalAlpha = 0.08 + rng() * 0.18;
      ctx.fillStyle = rng() > 0.5 ? '#b3b96a' : '#43522e';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 15 + rng() * 80, 8 + rng() * 44, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 7200, rng, ['#59693b', '#a9ae65', '#77653f', '#c2b578', '#3e4b2b'], 0.5, 3.4);
    // birch leaf litter
    for (let i = 0; i < 65; i++) {
      const x = rng() * 512, y = rng() * 512, r = 2 + rng() * 5;
      ctx.globalAlpha = 0.35 + rng() * 0.4;
      ctx.fillStyle = rng() > 0.5 ? '#cfbe63' : '#a58d43';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.5, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // taller grass blades
    for (let i = 0; i < 160; i++) {
      ctx.globalAlpha = 0.2 + rng() * 0.4;
      ctx.strokeStyle = rng() > 0.5 ? '#94a456' : '#71843d';
      ctx.lineWidth = 0.8 + rng() * 1.1;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 8, y - 5 - rng() * 16);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'safari') {
    noiseFill(ctx, 512, 512, [[156, 123, 69], [139, 106, 58], [174, 138, 81], [123, 92, 51]], rng);
    // cracked red earth and pale dust pans
    for (let i = 0; i < 48; i++) {
      ctx.globalAlpha = 0.06 + rng() * 0.16;
      ctx.fillStyle = rng() > 0.45 ? '#d2b47a' : '#8d5f31';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 18 + rng() * 95, 10 + rng() * 50, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 8300, rng, ['#b3925a', '#7d5d35', '#d0b27b', '#71512f', '#a6733e'], 0.5, 3.3);
    ctx.lineCap = 'round';
    for (let i = 0; i < 80; i++) {
      ctx.globalAlpha = 0.14 + rng() * 0.22;
      ctx.strokeStyle = '#75532e';
      ctx.lineWidth = 0.7 + rng() * 1.2;
      let x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (rng() - 0.5) * 26;
        y += 7 + rng() * 18;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // dry tufts and straw
    for (let i = 0; i < 150; i++) {
      ctx.globalAlpha = 0.25 + rng() * 0.45;
      ctx.strokeStyle = rng() > 0.5 ? '#c4a465' : '#8b7443';
      ctx.lineWidth = 0.7 + rng() * 1.0;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 11, y - 4 - rng() * 14);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'coast') {
    noiseFill(ctx, 512, 512, [[113, 108, 61], [98, 94, 53], [132, 124, 72], [88, 84, 48]], rng);
    for (let i = 0; i < 46; i++) {
      ctx.globalAlpha = 0.08 + rng() * 0.17;
      ctx.fillStyle = rng() > 0.45 ? '#b8a875' : '#6f6d3c';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 14 + rng() * 76, 8 + rng() * 38, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 7000, rng, ['#8d8a51', '#c2b57c', '#69653a', '#a99a63', '#56552f'], 0.45, 2.8);
    for (let i = 0; i < 150; i++) {
      ctx.globalAlpha = 0.22 + rng() * 0.35;
      ctx.strokeStyle = rng() > 0.5 ? '#a8a45f' : '#7b8043';
      ctx.lineWidth = 0.7 + rng() * 1.0;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 11, y - 4 - rng() * 15);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'alpine') {
    noiseFill(ctx, 512, 512, [[91, 108, 66], [78, 94, 56], [107, 121, 76], [68, 82, 49]], rng);
    for (let i = 0; i < 58; i++) {
      ctx.globalAlpha = 0.07 + rng() * 0.16;
      ctx.fillStyle = rng() > 0.5 ? '#bcc5a0' : '#4c5e3a';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 18 + rng() * 92, 10 + rng() * 46, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 6500, rng, ['#718353', '#aeb58d', '#5b6a45', '#c4c6a8', '#46563a'], 0.5, 3.2);
    // exposed limestone chips and tufted alpine grass
    for (let i = 0; i < 85; i++) {
      ctx.globalAlpha = 0.3 + rng() * 0.4;
      ctx.fillStyle = '#9c9d8e';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 1.5 + rng() * 5, 1 + rng() * 3.5, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 120; i++) {
      ctx.globalAlpha = 0.2 + rng() * 0.35;
      ctx.strokeStyle = rng() > 0.5 ? '#a7b478' : '#79894f';
      ctx.lineWidth = 0.8;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 8, y - 4 - rng() * 13);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'eifel') {
    noiseFill(ctx, 512, 512, [[61, 76, 43], [52, 66, 37], [74, 86, 50], [43, 56, 32]], rng);
    for (let i = 0; i < 55; i++) {
      ctx.globalAlpha = 0.07 + rng() * 0.16;
      ctx.fillStyle = rng() > 0.5 ? '#8a9657' : '#364528';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 15 + rng() * 82, 9 + rng() * 42, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 7200, rng, ['#4d5e34', '#8d9b5e', '#6c5b3d', '#a18e58', '#394a2a'], 0.5, 3.1);
    for (let i = 0; i < 62; i++) {
      const x = rng() * 512, y = rng() * 512, r = 2 + rng() * 6;
      ctx.globalAlpha = 0.3 + rng() * 0.4;
      ctx.fillStyle = rng() > 0.55 ? '#a37e45' : '#7c673c';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.45, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 150; i++) {
      ctx.globalAlpha = 0.22 + rng() * 0.4;
      ctx.strokeStyle = rng() > 0.5 ? '#95a35f' : '#6f7c43';
      ctx.lineWidth = 0.8 + rng() * 1.1;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 8, y - 4 - rng() * 15);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (biome === 'tuscany') {
    noiseFill(ctx, 512, 512, [[156, 143, 85], [139, 126, 73], [173, 158, 99], [122, 112, 65]], rng);
    for (let i = 0; i < 52; i++) {
      ctx.globalAlpha = 0.07 + rng() * 0.16;
      ctx.fillStyle = rng() > 0.45 ? '#c4b77c' : '#7d7a48';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 16 + rng() * 90, 9 + rng() * 46, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 7400, rng, ['#a39b5e', '#80743f', '#c1b276', '#6f6739', '#b8a465'], 0.5, 3.0);
    for (let i = 0; i < 150; i++) {
      ctx.globalAlpha = 0.24 + rng() * 0.4;
      ctx.strokeStyle = rng() > 0.5 ? '#b7ab6b' : '#8d8850';
      ctx.lineWidth = 0.7 + rng() * 1.0;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 11, y - 4 - rng() * 14);
      ctx.stroke();
    }
    // dry poppy/straw flecks
    for (let i = 0; i < 55; i++) {
      ctx.globalAlpha = 0.3 + rng() * 0.4;
      ctx.fillStyle = rng() > 0.7 ? '#b9583e' : '#d5c079';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 1 + rng() * 2.4, 1 + rng() * 2, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    noiseFill(ctx, 512, 512, [[66, 78, 44], [57, 68, 38], [79, 88, 50], [47, 57, 32]], rng);
    for (let i = 0; i < 64; i++) {
      ctx.globalAlpha = 0.08 + rng() * 0.17;
      ctx.fillStyle = rng() > 0.5 ? '#8c9a55' : '#3a4829';
      ctx.beginPath();
      ctx.ellipse(rng() * 512, rng() * 512, 12 + rng() * 76, 8 + rng() * 40, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    speckles(ctx, 512, 512, 6400, rng, ['#46552e', '#8f9c5d', '#6c5a39', '#a18a51', '#334024'], 0.5, 3.2);
    for (let i = 0; i < 130; i++) {
      ctx.globalAlpha = 0.22 + rng() * 0.4;
      ctx.strokeStyle = rng() > 0.45 ? '#869651' : '#b0945a';
      ctx.lineWidth = 0.8 + rng() * 1.1;
      const x = rng() * 512, y = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 8, y - 4 - rng() * 14);
      ctx.stroke();
    }
    // fallen leaves / twigs
    for (let i = 0; i < 48; i++) {
      ctx.globalAlpha = 0.25 + rng() * 0.35;
      ctx.fillStyle = rng() > 0.5 ? '#a37d42' : '#7b663b';
      ctx.save();
      ctx.translate(rng() * 512, rng() * 512);
      ctx.rotate(rng() * Math.PI);
      ctx.beginPath();
      ctx.ellipse(0, 0, 2 + rng() * 6, 1 + rng() * 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
}

export function makeGroundBumpTexture(biome) {
  const rng = mulberry32(
    biome === 'snow' ? 401
      : biome === 'jungle' ? 402
        : biome === 'japan' ? 403
          : biome === 'russia' ? 404
            : biome === 'safari' ? 405 : 406
  );
  const { canvas, ctx } = canvas2D(512, 512);
  const img = ctx.createImageData(512, 512);
  const d = img.data;
  const amp = biome === 'snow' ? 30 : biome === 'safari' ? 55 : 48;
  const base = biome === 'snow' ? 170 : 128;
  for (let i = 0; i < d.length; i += 4) {
    const v = clamp(base + (rng() - 0.5) * amp, 0, 255);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // pebbles / clods / ripples
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 180; i++) {
    ctx.fillStyle = rng() > 0.5 ? '#ffffff' : '#777777';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 512, 1 + rng() * 8, 1 + rng() * 5, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
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

/* Soft, lumpy cloud puff used by the sky dome. */
export function makeCloudTexture() {
  const { canvas, ctx } = canvas2D(256, 160);
  const puffs = [
    [78, 92, 62], [126, 78, 74], [178, 96, 56], [102, 112, 46], [156, 112, 44],
  ];
  for (const [x, y, r] of puffs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // flatten the base a little
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, 128, 0, 160);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 128, 256, 32);
  ctx.globalCompositeOperation = 'source-over';
  return makeCanvasTexture(canvas);
}

/* Tyre-mark blob (soft ellipse with a little tread grain). */
export function makeSkidTexture() {
  const { canvas, ctx } = canvas2D(64, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.18, 'rgba(255,255,255,.85)');
  g.addColorStop(0.82, 'rgba(255,255,255,.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(8, 0, 48, 128);
  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 10; x < 56; x += 8) {
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(x, 0, 3, 128);
  }
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
  ctx.fillText(`${car.series || 'GROUP B'} · RALLY LEGENDS`, 342, 218);
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
   BARK / CANOPY / FOREST FLOOR SPRITES
   ============================================================ */

export function makeBarkTexture(type = 'pine') {
  const rng = mulberry32(
    type === 'birch' ? 71 : type === 'cedar' ? 72 : type === 'palm' ? 73
      : type === 'acacia' ? 74 : type === 'baobab' ? 75 : type === 'oak' ? 76 : 77
  );
  const { canvas, ctx } = canvas2D(128, 512);
  if (type === 'birch') {
    noiseFill(ctx, 128, 512, [[219, 215, 200], [198, 194, 181], [230, 227, 214], [177, 174, 163]], rng);
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.35 + rng() * 0.55;
      ctx.fillStyle = rng() > 0.7 ? '#67625a' : '#2c2a27';
      ctx.beginPath();
      ctx.ellipse(rng() * 128, rng() * 512, 2 + rng() * 11, 0.6 + rng() * 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = '#8e8a80';
      ctx.fillRect(rng() * 128, rng() * 512, 2 + rng() * 6, 16 + rng() * 70);
    }
  } else if (type === 'palm') {
    noiseFill(ctx, 128, 512, [[111, 91, 62], [128, 106, 73], [97, 78, 52], [145, 120, 82]], rng);
    for (let y = 18; y < 512; y += 18 + rng() * 14) {
      ctx.globalAlpha = 0.35 + rng() * 0.4;
      ctx.strokeStyle = '#4e3c27';
      ctx.lineWidth = 2 + rng() * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y + (rng() - 0.5) * 5);
      ctx.stroke();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = '#c0a374';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 3);
      ctx.lineTo(128, y + 3);
      ctx.stroke();
    }
  } else if (type === 'cedar') {
    noiseFill(ctx, 128, 512, [[85, 57, 39], [100, 68, 45], [71, 48, 34], [116, 79, 52]], rng);
    for (let i = 0; i < 140; i++) {
      ctx.globalAlpha = 0.2 + rng() * 0.4;
      ctx.strokeStyle = rng() > 0.5 ? '#3b291d' : '#b08058';
      ctx.lineWidth = 0.7 + rng() * 1.7;
      const x = rng() * 128;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (rng() - 0.5) * 16, 160, x + (rng() - 0.5) * 16, 340, x + (rng() - 0.5) * 12, 512);
      ctx.stroke();
    }
  } else if (type === 'acacia' || type === 'baobab') {
    noiseFill(ctx, 128, 512, [[88, 76, 59], [75, 65, 51], [103, 90, 70], [65, 57, 45]], rng);
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.24 + rng() * 0.42;
      ctx.strokeStyle = rng() > 0.45 ? '#3e3528' : '#bcae93';
      ctx.lineWidth = 0.8 + rng() * 2.2;
      const x = rng() * 128;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (rng() - 0.5) * 24, 512);
      ctx.stroke();
    }
  } else if (type === 'oak') {
    noiseFill(ctx, 128, 512, [[72, 54, 37], [61, 45, 32], [88, 66, 45], [52, 39, 28]], rng);
    for (let i = 0; i < 80; i++) {
      ctx.globalAlpha = 0.22 + rng() * 0.4;
      ctx.strokeStyle = rng() > 0.5 ? '#2d2117' : '#aa8358';
      ctx.lineWidth = 0.8 + rng() * 2;
      const x = rng() * 128;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (rng() - 0.5) * 22, 180, x + (rng() - 0.5) * 22, 360, x + (rng() - 0.5) * 16, 512);
      ctx.stroke();
    }
  } else {
    // pine / spruce: dark base with red-brown plates
    noiseFill(ctx, 128, 512, [[69, 50, 34], [82, 59, 39], [55, 41, 29], [99, 71, 46]], rng);
    for (let i = 0; i < 75; i++) {
      ctx.globalAlpha = 0.25 + rng() * 0.4;
      ctx.fillStyle = rng() > 0.5 ? '#31251a' : '#b2774b';
      ctx.beginPath();
      ctx.ellipse(rng() * 128, rng() * 512, 3 + rng() * 12, 5 + rng() * 22, rng() * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
}

function canopyNeedles(ctx, rng, width, height, style, snowy) {
  const cx = width * 0.5;
  const top = height * 0.035;
  const bottom = height * 0.97;
  const layers = style === 'cedar' ? 22 : style === 'spruce' ? 20 : 16;
  // Dense, slightly ragged silhouette under the needle detail. This is what
  // makes the trees read as forest rather than a bundle of visible twigs.
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = top + (bottom - top) * t;
    const spread = (style === 'cedar' ? 0.46 : 0.53) * width * Math.pow(t, 0.72);
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 0.36 + rng() * 0.42;
      ctx.fillStyle = rng() > 0.55 ? '#223e23' : '#2d4d28';
      ctx.beginPath();
      ctx.ellipse(
        cx + (rng() - 0.5) * spread * 0.55,
        y + (rng() - 0.5) * 18,
        spread * (0.42 + rng() * 0.46),
        10 + rng() * 22,
        (rng() - 0.5) * 0.25, 0, Math.PI * 2
      );
      ctx.fill();
    }
  }
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = top + (bottom - top) * t;
    const spread = (style === 'cedar' ? 0.48 : 0.5) * width * Math.pow(t, 0.72) * (0.92 + rng() * 0.18);
    const droop = 7 + rng() * 22;
    const branches = style === 'cedar' ? 4 : 3;
    for (let b = 0; b < branches; b++) {
      const dir = b % 2 === 0 ? -1 : 1;
      const bx = cx + dir * spread * (0.24 + rng() * 0.75);
      const by = y + (rng() - 0.3) * 12;
      const len = 16 + rng() * 38 * (1 - t * 0.25);
      ctx.globalAlpha = 0.55 + rng() * 0.3;
      ctx.strokeStyle = rng() > 0.6 ? '#2e502b' : '#3d6730';
      ctx.lineWidth = 1.2 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(cx + (rng() - 0.5) * 8, y);
      ctx.quadraticCurveTo(cx + dir * spread * 0.6, y - droop * 0.4, bx, by + droop);
      ctx.stroke();
      // needle sprays along the branch
      for (let k = 0; k < 7; k++) {
        const kt = 0.25 + k / 8;
        const px = cx + (bx - cx) * kt + (rng() - 0.5) * 12;
        const py = y + (by + droop - y) * kt + (rng() - 0.5) * 12;
        ctx.strokeStyle = rng() > 0.55 ? '#4a7638' : '#284824';
        ctx.lineWidth = 0.8 + rng() * 1.0;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + (rng() - 0.5) * len, py + 2 + rng() * len * 0.8);
        ctx.stroke();
      }
      if (snowy) {
        ctx.globalAlpha = 0.55 + rng() * 0.35;
        ctx.fillStyle = rng() > 0.4 ? '#f3f8fc' : '#dbe8f2';
        ctx.beginPath();
        ctx.ellipse(bx, by + droop - 2, 5 + rng() * 12, 2 + rng() * 4, (rng() - 0.5) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // central tufts
    ctx.globalAlpha = 0.45 + rng() * 0.3;
    ctx.fillStyle = rng() > 0.5 ? '#3a5c2d' : '#264523';
    ctx.beginPath();
    ctx.ellipse(cx + (rng() - 0.5) * 14, y + 5, 8 + rng() * 22, 4 + rng() * 12, 0, 0, Math.PI * 2);
    ctx.fill();
    if (snowy) {
      ctx.globalAlpha = 0.4 + rng() * 0.4;
      ctx.fillStyle = '#eef6fc';
      ctx.beginPath();
      ctx.ellipse(cx + (rng() - 0.5) * 26, y, 6 + rng() * 20, 2 + rng() * 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Tip
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#3a5e2c';
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx - 12, height * 0.13);
  ctx.lineTo(cx + 12, height * 0.13);
  ctx.closePath();
  ctx.fill();
  if (snowy) {
    ctx.fillStyle = '#f5faff';
    ctx.beginPath();
    ctx.moveTo(cx, 2);
    ctx.lineTo(cx - 8, height * 0.1);
    ctx.lineTo(cx + 8, height * 0.1);
    ctx.closePath();
    ctx.fill();
  }
}

function canopyLeaves(ctx, rng, width, height, type, snowy) {
  const cx = width * 0.5;
  const palette = type === 'birch'
    ? ['#73933f', '#88a94b', '#a3bc5e', '#5f8039']
    : type === 'acacia'
      ? ['#516a2b', '#657f35', '#829b45', '#445c25']
      : type === 'baobab'
        ? ['#637d32', '#7c9840', '#95a94e', '#506a29']
        : ['#3f652b', '#527c37', '#6b9946', '#345523', '#7fa74d'];
  const top = height * (type === 'acacia' ? 0.12 : 0.08);
  const bottom = height * (type === 'birch' ? 0.78 : type === 'acacia' ? 0.58 : 0.82);
  // Solid leafy mass under the individual leaves.
  const fillCount = type === 'birch' ? 120 : type === 'acacia' ? 110 : type === 'baobab' ? 80 : 170;
  for (let i = 0; i < fillCount; i++) {
    const a = rng() * Math.PI * 2;
    const t = Math.pow(rng(), 0.5);
    const rx = width * (type === 'acacia' ? 0.43 : type === 'baobab' ? 0.3 : 0.35) * t;
    const ry = height * (type === 'acacia' ? 0.2 : type === 'baobab' ? 0.15 : 0.25) * t;
    ctx.globalAlpha = 0.32 + rng() * 0.4;
    ctx.fillStyle = palette[rng() > 0.5 ? 0 : 3];
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * rx, (top + bottom) * 0.5 + Math.sin(a) * ry,
      9 + rng() * 26, 7 + rng() * 20, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Branch detail. Birch twigs are pale and thin, so keep them subtle.
  ctx.globalAlpha = type === 'birch' ? 0.22 : 0.55;
  ctx.strokeStyle = type === 'birch' ? '#8b8677' : '#4a3523';
  ctx.lineWidth = type === 'birch' ? 1.2 : 2.4;
  for (let i = 0; i < (type === 'acacia' ? 8 : type === 'birch' ? 3 : 6); i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    const bx = cx + dir * width * (0.14 + rng() * 0.3);
    const by = top + (bottom - top) * (0.28 + rng() * 0.64);
    ctx.beginPath();
    ctx.moveTo(cx + (rng() - 0.5) * 18, height * 0.92);
    ctx.quadraticCurveTo(cx + dir * width * 0.12, by - 30, bx, by);
    ctx.stroke();
  }
  const blobs = type === 'birch' ? 420 : type === 'acacia' ? 300 : type === 'baobab' ? 190 : 460;
  for (let i = 0; i < blobs; i++) {
    const a = rng() * Math.PI * 2;
    const t = Math.pow(rng(), 0.55);
    const rx = width * (type === 'acacia' ? 0.42 : 0.36) * t;
    const ry = height * (type === 'acacia' ? 0.2 : 0.27) * t;
    const x = cx + Math.cos(a) * rx;
    const y = (top + bottom) * 0.5 + Math.sin(a) * ry;
    const rr = 2.4 + rng() * (type === 'birch' ? 5 : 8);
    ctx.globalAlpha = 0.42 + rng() * 0.54;
    ctx.fillStyle = palette[(rng() * palette.length) | 0];
    ctx.beginPath();
    ctx.ellipse(x, y, rr, rr * (0.45 + rng() * 0.65), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    if (snowy && rng() < 0.45) {
      ctx.globalAlpha = 0.3 + rng() * 0.5;
      ctx.fillStyle = '#eef6fc';
      ctx.beginPath();
      ctx.ellipse(x, y - rr * 0.5, rr * 0.8, rr * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // sunlit leaf highlights give the crown volume instead of a flat silhouette
  const highlight = type === 'birch' ? ['#a9c866', '#c2d677', '#8fae4e']
    : type === 'acacia' ? ['#879a4c', '#9da85a', '#73843f']
      : ['#8fb35f', '#a8c56e', '#6e9447'];
  for (let i = 0; i < (type === 'birch' ? 170 : 220); i++) {
    const a = rng() * Math.PI * 2;
    const t = Math.pow(rng(), 0.7);
    const rx = width * (type === 'acacia' ? 0.4 : 0.34) * t;
    const ry = height * (type === 'acacia' ? 0.19 : 0.26) * t;
    const x = cx + Math.cos(a) * rx - width * 0.03;
    const y = (top + bottom) * 0.5 + Math.sin(a) * ry - height * 0.025;
    ctx.globalAlpha = 0.18 + rng() * 0.34;
    ctx.fillStyle = highlight[(rng() * highlight.length) | 0];
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rng() * 7, 1.4 + rng() * 4, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function makeLeafSurfaceTexture(type = 'oak', snowy = false) {
  const rng = mulberry32(
    type === 'birch' ? 901 : type === 'cedar' ? 902 : type === 'acacia' ? 903
      : type === 'baobab' ? 904 : type === 'palm' ? 905 : type === 'banana' ? 906
        : type === 'pine' || type === 'spruce' ? 907 : 908
  );
  const { canvas, ctx } = canvas2D(256, 256);
  const palette = type === 'birch'
    ? [[108, 134, 64], [126, 154, 78], [142, 166, 88], [90, 116, 54]]
    : type === 'pine' || type === 'spruce' || type === 'cedar'
      ? [[61, 91, 48], [74, 108, 56], [48, 76, 40], [88, 122, 64]]
      : type === 'acacia' || type === 'baobab'
        ? [[88, 104, 48], [106, 122, 57], [72, 88, 40], [122, 132, 66]]
        : [[76, 112, 53], [92, 132, 61], [61, 95, 44], [110, 151, 76]];
  noiseFill(ctx, 256, 256, palette, rng);
  // dense leaf texture: overlapping ellipses and veins, no transparency
  for (let i = 0; i < 620; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    const r = 1.2 + rng() * 5.5;
    const p = palette[(rng() * palette.length) | 0];
    ctx.globalAlpha = 0.22 + rng() * 0.45;
    ctx.fillStyle = `rgb(${p[0] + (rng() - 0.5) * 18 | 0},${p[1] + (rng() - 0.5) * 18 | 0},${p[2] + (rng() - 0.5) * 12 | 0})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.35 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // fine leaf ribs / needle streaks
  ctx.lineCap = 'round';
  for (let i = 0; i < 280; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    ctx.globalAlpha = 0.16 + rng() * 0.28;
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(185,209,120,.55)' : 'rgba(27,46,22,.55)';
    ctx.lineWidth = 0.6 + rng() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 8, y + (rng() - 0.5) * 8);
    ctx.stroke();
  }
  if (snowy) {
    for (let i = 0; i < 220; i++) {
      ctx.globalAlpha = 0.12 + rng() * 0.3;
      ctx.fillStyle = rng() > 0.35 ? '#f1f7fc' : '#c6d9e8';
      ctx.beginPath();
      ctx.ellipse(rng() * 256, rng() * 256, 1 + rng() * 6, 0.7 + rng() * 2.5, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
}

export function makeCanopyTexture(type = 'pine', snowy = false) {
  const rng = mulberry32(
    type === 'birch' ? 811 : type === 'oak' ? 812 : type === 'cedar' ? 813
      : type === 'acacia' ? 814 : type === 'baobab' ? 815 : type === 'banana' ? 816
        : type === 'dead' ? 817 : 818
  );
  const { canvas, ctx } = canvas2D(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  if (type === 'pine' || type === 'spruce' || type === 'cedar') {
    canopyNeedles(ctx, rng, 512, 512, type, snowy);
  } else if (type === 'banana') {
    // large arching tropical leaves
    for (let i = 0; i < 11; i++) {
      const a = -Math.PI * 0.92 + (i / 10) * Math.PI * 0.84;
      const len = 190 + rng() * 90;
      ctx.save();
      ctx.translate(256, 470);
      ctx.rotate(a + Math.PI / 2);
      ctx.globalAlpha = 0.5 + rng() * 0.4;
      ctx.fillStyle = rng() > 0.45 ? '#2f5d22' : '#467a2a';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-34, -len * 0.55, 0, -len);
      ctx.quadraticCurveTo(34, -len * 0.55, 0, 0);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#a7c76c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(0, -len * 0.92);
      ctx.stroke();
      ctx.restore();
    }
    // central stalk crown
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#3c6324';
    ctx.beginPath();
    ctx.ellipse(256, 472, 20, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'dead') {
    ctx.strokeStyle = '#554738';
    ctx.lineCap = 'round';
    const branch = (x, y, len, ang, w) => {
      if (len < 6) return;
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      ctx.globalAlpha = 0.6 + rng() * 0.3;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      branch(nx, ny, len * (0.58 + rng() * 0.2), ang - 0.35 - rng() * 0.35, w * 0.65);
      branch(nx, ny, len * (0.58 + rng() * 0.2), ang + 0.35 + rng() * 0.35, w * 0.65);
    };
    branch(256, 500, 150, -Math.PI / 2, 9);
  } else {
    canopyLeaves(ctx, rng, 512, 512, type, snowy);
  }
  return makeCanvasTexture(canvas, { srgb: true, anisotropy: 4 });
}

export function makePalmFrondTexture() {
  const rng = mulberry32(1616);
  const { canvas, ctx } = canvas2D(256, 128);
  ctx.clearRect(0, 0, 256, 128);
  // rachis from the left edge to the tip
  ctx.strokeStyle = '#7f8f3f';
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, 64);
  ctx.quadraticCurveTo(130, 58, 250, 54);
  ctx.stroke();
  for (let i = 0; i < 22; i++) {
    const t = i / 21;
    const x = 8 + t * 236;
    const y = 64 - t * 9;
    const len = 30 + Math.sin(t * Math.PI) * 18;
    for (const dir of [-1, 1]) {
      ctx.globalAlpha = 0.5 + rng() * 0.45;
      ctx.strokeStyle = rng() > 0.45 ? '#3f6b25' : '#5e8f35';
      ctx.lineWidth = 1.6 + rng() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 4, y + dir * len * 0.55, x + 6 + rng() * 8, y + dir * len);
      ctx.stroke();
    }
  }
  return makeCanvasTexture(canvas, { srgb: true, anisotropy: 4 });
}

export function makeFlowerTexture() {
  const rng = mulberry32(515);
  const { canvas, ctx } = canvas2D(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 36; i++) {
    const x = 12 + rng() * 104;
    const y = 42 + rng() * 80;
    ctx.globalAlpha = 0.5 + rng() * 0.4;
    ctx.strokeStyle = '#5f7d3d';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.quadraticCurveTo(x + (rng() - 0.5) * 10, y + 20, x, y);
    ctx.stroke();
    const col = rng() > 0.55 ? '#e4cf61' : rng() > 0.4 ? '#e3e0c5' : '#b2a0d0';
    ctx.fillStyle = col;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + rng() * 0.2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.2, 3.2, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#c8a03d';
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
  }
  return makeCanvasTexture(canvas, { srgb: true, anisotropy: 4 });
}

export function makeReedTexture() {
  const rng = mulberry32(616);
  const { canvas, ctx } = canvas2D(128, 256);
  ctx.clearRect(0, 0, 128, 256);
  for (let i = 0; i < 26; i++) {
    const x = 8 + rng() * 112;
    const top = 18 + rng() * 60;
    ctx.globalAlpha = 0.4 + rng() * 0.4;
    ctx.strokeStyle = rng() > 0.4 ? '#7f8c4d' : '#a49a5e';
    ctx.lineWidth = 1.2 + rng() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.quadraticCurveTo(x + (rng() - 0.5) * 20, 130, x + (rng() - 0.5) * 28, top);
    ctx.stroke();
    if (rng() < 0.4) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#6f5636';
      ctx.beginPath();
      ctx.ellipse(x + (rng() - 0.5) * 28, top + 4, 2.2, 7 + rng() * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return makeCanvasTexture(canvas, { srgb: true, anisotropy: 4 });
}

export function makeRockTexture() {
  const rng = mulberry32(717);
  const { canvas, ctx } = canvas2D(256, 256);
  noiseFill(ctx, 256, 256, [[104, 106, 96], [88, 90, 82], [122, 121, 108], [72, 76, 70]], rng);
  speckles(ctx, 256, 256, 1600, rng, ['#d2d0c1', '#555c53', '#969b8b', '#3f463f'], 0.5, 2.4, 0.7);
  // lichen
  for (let i = 0; i < 30; i++) {
    ctx.globalAlpha = 0.12 + rng() * 0.22;
    ctx.fillStyle = rng() > 0.5 ? '#8b9f58' : '#6f7c48';
    ctx.beginPath();
    ctx.ellipse(rng() * 256, rng() * 256, 4 + rng() * 24, 3 + rng() * 16, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
}


/* ============================================================
   STRUCTURES / SET PIECES
   ============================================================ */

export function makeWoodTexture(kind = 'log') {
  const rng = mulberry32(kind === 'log' ? 913 : 914);
  const { canvas, ctx } = canvas2D(512, 512);
  if (kind === 'log') {
    ctx.fillStyle = '#4b3724';
    ctx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 42) {
      const shade = 0.82 + rng() * 0.32;
      ctx.fillStyle = `rgb(${Math.min(255, 118 * shade)},${Math.min(255, 88 * shade)},${Math.min(255, 58 * shade)})`;
      ctx.fillRect(0, y + 2, 512, 38);
      // rounded log edge and end grain
      const g = ctx.createLinearGradient(0, y, 0, y + 42);
      g.addColorStop(0, 'rgba(255,230,190,.18)');
      g.addColorStop(0.22, 'rgba(255,255,255,0)');
      g.addColorStop(0.8, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.28)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, 512, 42);
      ctx.strokeStyle = 'rgba(42,28,16,.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y + 41);
      for (let x = 0; x <= 512; x += 24) ctx.lineTo(x, y + 41 + Math.sin(x * 0.05 + y) * 1.4);
      ctx.stroke();
      for (let k = 0; k < 7; k++) {
        ctx.strokeStyle = `rgba(55,34,18,${0.12 + rng() * 0.2})`;
        ctx.lineWidth = 1 + rng();
        const yy = y + 7 + rng() * 26;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, yy + Math.sin(x * 0.012 + k) * 1.6);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(35,23,13,.5)';
      for (let k = 0; k < 3; k++) ctx.fillRect(rng() * 512, y + 8 + rng() * 26, 3 + rng() * 10, 2);
    }
  } else {
    ctx.fillStyle = '#573d26';
    ctx.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 64) {
      const shade = 0.8 + rng() * 0.36;
      ctx.fillStyle = `rgb(${Math.min(255, 126 * shade)},${Math.min(255, 94 * shade)},${Math.min(255, 60 * shade)})`;
      ctx.fillRect(x + 2, 0, 59, 512);
      ctx.fillStyle = 'rgba(30,19,11,.55)';
      ctx.fillRect(x, 0, 2, 512);
      for (let k = 0; k < 9; k++) {
        ctx.strokeStyle = `rgba(65,40,22,${0.1 + rng() * 0.2})`;
        ctx.lineWidth = 1 + rng();
        const xx = x + 8 + rng() * 48;
        ctx.beginPath();
        ctx.moveTo(xx, 0);
        for (let y = 0; y <= 512; y += 36) ctx.lineTo(xx + Math.sin(y * 0.02 + k) * 2, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,232,190,.1)';
      ctx.fillRect(x + 4, 0, 4, 512);
    }
  }
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
}

export function makeIceTexture() {
  const rng = mulberry32(911);
  const { canvas, ctx } = canvas2D(512, 512);
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, '#d9edf5');
  g.addColorStop(0.45, '#a9c8d8');
  g.addColorStop(1, '#d2e6ef');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 360; i++) {
    ctx.globalAlpha = 0.04 + rng() * 0.12;
    ctx.fillStyle = rng() > 0.5 ? '#ffffff' : '#7195a8';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 512, 2 + rng() * 30, 1 + rng() * 16, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // long cracks and frozen bubbles
  for (let i = 0; i < 24; i++) {
    let x = rng() * 512;
    let y = rng() * 512;
    ctx.strokeStyle = `rgba(240,252,255,${0.22 + rng() * 0.32})`;
    ctx.lineWidth = 0.7 + rng() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 2 + (rng() * 5) | 0;
    for (let s = 0; s < segs; s++) {
      x += (rng() - 0.5) * 90;
      y += (rng() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 50; i++) {
    ctx.globalAlpha = 0.12 + rng() * 0.25;
    ctx.fillStyle = '#f8feff';
    ctx.beginPath();
    ctx.arc(rng() * 512, rng() * 512, 0.8 + rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
}

export function makeWaterfallTexture() {
  const rng = mulberry32(915);
  const { canvas, ctx } = canvas2D(128, 512);
  ctx.clearRect(0, 0, 128, 512);
  for (let i = 0; i < 46; i++) {
    const x = 6 + rng() * 116;
    const w = 1 + rng() * 7;
    const top = rng() * 80;
    const g = ctx.createLinearGradient(0, top, 0, 512);
    g.addColorStop(0, `rgba(236,250,255,${0.15 + rng() * 0.25})`);
    g.addColorStop(0.5, `rgba(215,242,250,${0.35 + rng() * 0.4})`);
    g.addColorStop(1, `rgba(255,255,255,${0.7 + rng() * 0.25})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.bezierCurveTo(x + (rng() - 0.5) * 22, 160, x + (rng() - 0.5) * 28, 350, x + (rng() - 0.5) * 16, 512);
    ctx.lineTo(x + 16 + (rng() - 0.5) * 12, 512);
    ctx.bezierCurveTo(x + 20 + (rng() - 0.5) * 22, 350, x + 20 + (rng() - 0.5) * 28, 160, x + w, top);
    ctx.closePath();
    ctx.fill();
  }
  // Feather the sheet edges so it doesn't read as a hard rectangle.
  const fade = ctx.createLinearGradient(0, 0, 128, 0);
  fade.addColorStop(0, 'rgba(255,255,255,0)');
  fade.addColorStop(0.16, 'rgba(255,255,255,1)');
  fade.addColorStop(0.84, 'rgba(255,255,255,1)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 128, 512);
  ctx.globalCompositeOperation = 'source-over';
  // foam drops at the bottom
  for (let i = 0; i < 130; i++) {
    ctx.globalAlpha = 0.25 + rng() * 0.55;
    ctx.fillStyle = '#f3fdff';
    ctx.beginPath();
    ctx.arc(rng() * 128, 400 + rng() * 110, 1 + rng() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
}

export function makeAnimalTexture(kind = 'giraffe') {
  const rng = mulberry32(kind === 'giraffe' ? 921 : kind === 'zebra' ? 922 : 923);
  const { canvas, ctx } = canvas2D(256, 256);
  if (kind === 'giraffe') {
    ctx.fillStyle = '#c58d48';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 44; i++) {
      const x = rng() * 256;
      const y = rng() * 256;
      const r = 8 + rng() * 19;
      ctx.fillStyle = rng() > 0.25 ? '#7a4c22' : '#e1bf8b';
      ctx.globalAlpha = 0.7 + rng() * 0.3;
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      for (let k = 1; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.lineTo(x + Math.cos(a) * r * (0.55 + rng() * 0.6), y + Math.sin(a) * r * (0.55 + rng() * 0.6));
      }
      ctx.closePath();
      ctx.fill();
    }
  } else if (kind === 'zebra') {
    ctx.fillStyle = '#e9e4d4';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 34; i++) {
      ctx.strokeStyle = i % 4 === 0 ? '#3b372f' : '#141311';
      ctx.lineWidth = 4 + rng() * 10;
      const y = rng() * 256;
      ctx.beginPath();
      ctx.moveTo(-20, y);
      ctx.bezierCurveTo(60, y + (rng() - 0.5) * 30, 180, y + (rng() - 0.5) * 40, 276, y + (rng() - 0.5) * 30);
      ctx.stroke();
    }
  } else if (kind === 'reindeer') {
    ctx.fillStyle = '#6a4c32';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      ctx.globalAlpha = 0.12 + rng() * 0.25;
      ctx.strokeStyle = rng() > 0.45 ? '#3d2a1a' : '#aa8760';
      ctx.lineWidth = 1 + rng() * 2;
      const x = rng() * 256;
      const y = rng() * 256;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 12, y + 6 + rng() * 15);
      ctx.stroke();
    }
  } else {
    // sheep's wool
    ctx.fillStyle = '#e4ddcc';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      ctx.globalAlpha = 0.15 + rng() * 0.3;
      ctx.strokeStyle = rng() > 0.5 ? '#bdb5a2' : '#fcf7e9';
      ctx.lineWidth = 1 + rng() * 2.2;
      const x = rng() * 256;
      const y = rng() * 256;
      ctx.beginPath();
      ctx.arc(x, y, 2 + rng() * 5, rng() * 3, rng() * 3 + 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return makeCanvasTexture(canvas, { repeat: true, anisotropy: 4 });
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
