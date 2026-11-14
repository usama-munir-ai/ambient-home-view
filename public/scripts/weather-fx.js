// Weather FX — canvas particle engine for rain, snow, fog, lightning, dust,
// clouds, sun rays, autumn leaves, fireflies, night skies, and heat haze.
// Reacts to the live weather category from state.weather.category; scenes are
// further keyed by time-of-day and season (re-evaluated every minute so dusk
// transitions happen without a weather change).
//
// Performance: object pools, requestAnimationFrame, visibility-aware pause,
// soft shapes pre-rendered to offscreen canvases (no per-frame gradients, no
// shadowBlur). Respects prefers-reduced-motion.

import { state } from "./state.js";
import { classifyTimeOfDay, classifySeason } from "./time.js";
import { getPrefs } from "./prefs.js";

// Base single-layer configs reused by scene definitions below.
const RAIN = {
  "rain-steady":     { type: "rain",  count: 180, opacity: 0.35, speed: [8, 14],  wind: 2, length: [10, 22] },
  "rain-torrential": { type: "rain",  count: 350, opacity: 0.45, speed: [12, 20], wind: 4, length: [14, 28] },
  "drizzle":         { type: "rain",  count: 90,  opacity: 0.25, speed: [4, 8],   wind: 1, length: [6, 14] },
  "storm":           { type: "rain",  count: 250, opacity: 0.45, speed: [14, 22], wind: 5, length: [16, 30], flashInterval: [4000, 12000] },
};

// Scene = ordered layers drawn back-to-front. `css` toggles a class on the
// home frame (heat shimmer). Particle counts are tuned for 512×300.
const SCENES = {
  "rain-steady":     { layers: [RAIN["rain-steady"]] },
  "rain-torrential": { layers: [RAIN["rain-torrential"]] },
  "drizzle":         { layers: [RAIN["drizzle"]] },
  "thunderstorm":    { layers: [RAIN["storm"]] },
  "snow-light":      { layers: [{ type: "snow", count: 120, opacity: 0.35, speed: [1, 3], wind: 0.5, size: [2, 5] }] },
  "snow-heavy":      { layers: [{ type: "snow", count: 250, opacity: 0.45, speed: [2, 5], wind: 1.5, size: [2, 6] }] },
  "fog":             { layers: [{ type: "fog", layers: 5 }] },
  "dust":            { layers: [{ type: "dust", count: 30, opacity: 0.15, speed: [0.2, 0.6], size: [1, 3] }] },
  "sparkle":         { layers: [{ type: "sparkle", count: 40, opacity: 0.25, speed: [0.1, 0.4], size: [1, 2] }] },
  "sunny":           { layers: [
    { type: "sunrays", rays: 4, opacity: 0.10 },
    { type: "dust", count: 22, opacity: 0.12, speed: [0.2, 0.5], size: [1, 3] },
  ] },
  "heat":            { css: "weather-heat", layers: [
    { type: "sunrays", rays: 3, opacity: 0.07 },
    { type: "haze", count: 6, opacity: 0.05 },
  ] },
  "fireflies":       { layers: [{ type: "fireflies", count: 16, glow: 6, opacity: 0.6 }] },
  "leaves-sun":      { layers: [
    { type: "sunrays", rays: 3, opacity: 0.08 },
    { type: "leaves", count: 14, opacity: 0.5 },
  ] },
  "leaves-clouds":   { layers: [
    { type: "clouds", count: 4, opacity: 0.10, dark: false },
    { type: "leaves", count: 16, opacity: 0.5 },
  ] },
  "clouds":          { layers: [{ type: "clouds", count: 5, opacity: 0.12, dark: false }] },
  "clouds-night":    { layers: [{ type: "clouds", count: 4, opacity: 0.10, dark: true }] },
  "clouds-heavy":    { layers: [{ type: "clouds", count: 7, opacity: 0.16, dark: true }] },
  "night-sky":       { layers: [
    { type: "stars", count: 60, opacity: 0.5 },
    { type: "shooting", interval: [20000, 45000] },
  ] },
  "night-sky-aurora": { layers: [
    { type: "aurora", ribbons: 2, opacity: 0.16 },
    { type: "stars", count: 60, opacity: 0.5 },
    { type: "shooting", interval: [20000, 45000] },
  ] },
};

/**
 * Map weather category + time-of-day + season to a scene key.
 * Unknown categories fall back to a blank canvas (no scene).
 */
function resolveFxKey(category, tod, season) {
  const night = tod === "night" || tod === "lateNight";
  const daytime = tod === "morning" || tod === "day";
  switch (category) {
    case "clear-warm":
      if (night) return "fireflies";
      if (season === "autumn" && daytime) return "leaves-sun";
      if (daytime) return "sunny";
      return "dust"; // dawn / golden / dusk motes
    case "heat":
      return night ? "fireflies" : "heat";
    case "clear-cold":
      if (!night) return "sparkle";
      return season === "winter" ? "night-sky-aurora" : "night-sky";
    case "partly-cloudy":
      if (season === "autumn" && daytime) return "leaves-clouds";
      return night ? "clouds-night" : "clouds";
    case "overcast":
      return "clouds-heavy";
    default:
      return SCENES[category] ? category : null;
  }
}

let canvas = null;
let ctx = null;
let layers = [];           // [{ cfg, particles, sprite(s), extra }]
let animId = null;
let currentKey = null;     // active scene key
let lastCategory = null;   // last weather category passed in
let retimer = null;        // 60s tod/season re-evaluation
let canvasWidth = 512;
let canvasHeight = 300;
let flashTimer = null;
let flashAlpha = 0;
let lastFrameTime = 0;

function rand(min, max) { return min + Math.random() * (max - min); }

function currentTod() {
  const loc = state.homeLocation;
  return classifyTimeOfDay(new Date(), loc?.lat ?? 41, loc?.lon ?? 0);
}

function currentSeason() {
  return classifySeason(new Date(), state.homeLocation?.lat ?? 41);
}

// ─── Sprite pre-rendering (soft shapes built once per scene) ────────────────
function makeSprite(w, h, paint) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  paint(g, w, h);
  return c;
}

function cloudSprite(dark) {
  return makeSprite(280, 140, (g, w, h) => {
    const tint = dark ? "120, 130, 150" : "235, 240, 248";
    // Three overlapping soft blobs read as one cloud mass.
    const blobs = [[w * 0.35, h * 0.55, h * 0.5], [w * 0.58, h * 0.45, h * 0.55], [w * 0.75, h * 0.6, h * 0.4]];
    for (const [cx, cy, r] of blobs) {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${tint}, 0.55)`);
      grad.addColorStop(1, `rgba(${tint}, 0)`);
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  });
}

function glowSprite() {
  return makeSprite(24, 24, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, "rgba(255, 238, 160, 0.9)");
    grad.addColorStop(0.4, "rgba(255, 224, 120, 0.25)");
    grad.addColorStop(1, "rgba(255, 224, 120, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

function raysSprite(fromLeft, rays, w, h) {
  return makeSprite(w, h, (g) => {
    const ox = fromLeft ? -10 : w + 10;
    const oy = -20;
    for (let i = 0; i < rays; i++) {
      // Wedges fanning down across the frame from the sun corner.
      const base = fromLeft ? 0.35 + i * 0.28 : Math.PI - 0.35 - i * 0.28;
      const spread = 0.10 + (i % 2) * 0.04;
      const len = Math.hypot(w, h) * 1.2;
      const grad = g.createLinearGradient(ox, oy, ox + Math.cos(base) * len * 0.7, oy + Math.sin(base) * len * 0.7);
      grad.addColorStop(0, "rgba(255, 244, 214, 0.55)");
      grad.addColorStop(1, "rgba(255, 244, 214, 0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(base - spread) * len, oy + Math.sin(base - spread) * len);
      g.lineTo(ox + Math.cos(base + spread) * len, oy + Math.sin(base + spread) * len);
      g.closePath();
      g.fill();
    }
  });
}

function auroraSprite(w) {
  const h = 130;
  return makeSprite(w * 2, h, (g) => {
    for (let x = 0; x < w * 2; x += 4) {
      const wave = Math.sin(x * 0.012) * 22 + Math.sin(x * 0.004 + 1.7) * 14;
      const top = 18 + wave;
      const grad = g.createLinearGradient(0, top, 0, top + 90);
      grad.addColorStop(0, "rgba(110, 235, 180, 0)");
      grad.addColorStop(0.35, "rgba(110, 235, 180, 0.5)");
      grad.addColorStop(0.7, "rgba(90, 170, 220, 0.25)");
      grad.addColorStop(1, "rgba(90, 170, 220, 0)");
      g.fillStyle = grad;
      g.fillRect(x, top, 4, 90);
    }
  });
}

function hazeSprite(w) {
  return makeSprite(w, 26, (g, sw, sh) => {
    const grad = g.createLinearGradient(0, 0, 0, sh);
    grad.addColorStop(0, "rgba(255, 240, 220, 0)");
    grad.addColorStop(0.5, "rgba(255, 240, 220, 0.5)");
    grad.addColorStop(1, "rgba(255, 240, 220, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, sw, sh);
  });
}

function fogSprite() {
  return makeSprite(32, 64, (g, sw, sh) => {
    const grad = g.createLinearGradient(0, 0, 0, sh);
    grad.addColorStop(0, "rgba(180, 190, 200, 0)");
    grad.addColorStop(0.5, "rgba(180, 190, 200, 1)");
    grad.addColorStop(1, "rgba(180, 190, 200, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, sw, sh);
  });
}

// ─── Particle constructors ──────────────────────────────────────────────────
function makeRain(cfg) {
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * canvasHeight * -1,
    speed: rand(cfg.speed[0], cfg.speed[1]),
    length: rand(cfg.length[0], cfg.length[1]),
    wind: cfg.wind || 0,
  };
}

function makeSnow(cfg) {
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * canvasHeight * -0.5,
    speed: rand(cfg.speed[0], cfg.speed[1]),
    size: rand(cfg.size[0], cfg.size[1]),
    wind: cfg.wind || 0,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: rand(0.01, 0.04),
  };
}

function makeDust(cfg) {
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * canvasHeight,
    speed: rand(cfg.speed[0], cfg.speed[1]),
    size: rand(cfg.size[0], cfg.size[1]),
    alpha: rand(0.3, 1),
    drift: rand(-0.3, 0.3),
    phase: Math.random() * Math.PI * 2,
  };
}

function makeFogLayer(i, total) {
  return {
    y: (canvasHeight / total) * i + rand(-20, 20),
    speed: rand(0.1, 0.4) * (i % 2 === 0 ? 1 : -1),
    height: rand(30, 60),
    alpha: rand(0.04, 0.12),
    offset: rand(0, canvasWidth),
  };
}

function makeCloud(cfg, i, total) {
  const scale = rand(0.6, 1.5);
  return {
    x: (canvasWidth / total) * i + rand(-60, 60),
    y: rand(-10, canvasHeight * 0.45),
    scale,
    // Bigger clouds read closer → drift slightly faster (parallax).
    speed: rand(0.06, 0.16) * scale,
    alpha: rand(0.7, 1),
  };
}

const LEAF_COLORS = ["199, 123, 63", "169, 85, 46", "217, 164, 65", "150, 96, 38"];

function makeLeaf() {
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * canvasHeight * -0.6,
    speed: rand(0.5, 1.3),
    size: rand(3, 6),
    wind: rand(0.6, 1.4),
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: rand(0.015, 0.04),
    rot: Math.random() * Math.PI * 2,
    rotSpeed: rand(-0.03, 0.03),
    color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)],
  };
}

function makeFirefly(glowing) {
  return {
    ax: Math.random() * canvasWidth,
    ay: canvasHeight * (0.3 + Math.random() * 0.65),
    rx: rand(8, 30),
    ry: rand(5, 16),
    spx: rand(0.002, 0.007),
    spy: rand(0.003, 0.009),
    px: Math.random() * Math.PI * 2,
    py: Math.random() * Math.PI * 2,
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: rand(0.015, 0.045),
    glowing,
  };
}

function makeStar() {
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * canvasHeight * 0.8,
    size: rand(0.6, 1.8),
    phase: Math.random() * Math.PI * 2,
    speed: rand(0.004, 0.02),
    alpha: rand(0.4, 1),
  };
}

function makeHazeBand(i, total) {
  return {
    y: (canvasHeight / total) * i + rand(-10, 10),
    speed: rand(0.08, 0.22),
    alpha: rand(0.4, 1),
    phase: Math.random() * Math.PI * 2,
  };
}

// ─── Scene build ────────────────────────────────────────────────────────────
function buildScene(key) {
  layers = [];
  flashAlpha = 0;
  const scene = SCENES[key];
  if (!scene) return;

  const lite = !!getPrefs().liteMode;
  const scaleCount = (n) => (lite ? Math.max(4, Math.round(n * 0.68)) : n);

  for (const cfg of scene.layers) {
    const layer = { cfg, particles: [], extra: {} };
    const count = cfg.count ? scaleCount(cfg.count) : 0;
    switch (cfg.type) {
      case "rain":
        for (let i = 0; i < count; i++) layer.particles.push(makeRain(cfg));
        if (cfg.flashInterval) scheduleFlash(cfg, key);
        break;
      case "snow":
        for (let i = 0; i < count; i++) layer.particles.push(makeSnow(cfg));
        break;
      case "fog": {
        const fogCount = lite ? Math.min(3, cfg.layers || 5) : (cfg.layers || 5);
        layer.extra.sprite = fogSprite();
        for (let i = 0; i < fogCount; i++) layer.particles.push(makeFogLayer(i, fogCount));
        break;
      }
      case "dust":
      case "sparkle":
        for (let i = 0; i < count; i++) layer.particles.push(makeDust(cfg));
        break;
      case "clouds":
        layer.extra.sprite = cloudSprite(cfg.dark);
        for (let i = 0; i < count; i++) layer.particles.push(makeCloud(cfg, i, count));
        break;
      case "sunrays": {
        // Morning sun from the left, afternoon from the right.
        const tod = currentTod();
        layer.extra.sprite = raysSprite(tod === "morning" || tod === "dawn", cfg.rays, canvasWidth, canvasHeight);
        layer.extra.phase = 0;
        break;
      }
      case "leaves":
        for (let i = 0; i < count; i++) layer.particles.push(makeLeaf());
        break;
      case "fireflies": {
        const glowCount = lite ? Math.max(2, Math.round((cfg.glow || 0) * 0.68)) : (cfg.glow || 0);
        layer.extra.sprite = glowSprite();
        for (let i = 0; i < count; i++) layer.particles.push(makeFirefly(i < glowCount));
        break;
      }
      case "stars":
        for (let i = 0; i < count; i++) layer.particles.push(makeStar());
        break;
      case "shooting":
        layer.extra.nextAt = performance.now() + rand(cfg.interval[0], cfg.interval[1]);
        layer.extra.active = null;
        break;
      case "aurora":
        layer.extra.sprite = auroraSprite(canvasWidth);
        layer.extra.offsets = [];
        for (let i = 0; i < (cfg.ribbons || 2); i++) {
          layer.extra.offsets.push({ x: rand(0, canvasWidth), speed: rand(0.05, 0.12) * (i % 2 ? -1 : 1), phase: rand(0, Math.PI * 2) });
        }
        break;
      case "haze":
        layer.extra.sprite = hazeSprite(canvasWidth);
        for (let i = 0; i < count; i++) layer.particles.push(makeHazeBand(i, count));
        break;
      default:
        break;
    }
    layers.push(layer);
  }
}

function scheduleFlash(cfg, key) {
  if (flashTimer) clearTimeout(flashTimer);
  if (!cfg.flashInterval) return;
  const delay = rand(cfg.flashInterval[0], cfg.flashInterval[1]);
  flashTimer = setTimeout(() => {
    flashAlpha = 0.35;
    setTimeout(() => { flashAlpha = 0.12; }, 80);
    setTimeout(() => { flashAlpha = 0.25; }, 160);
    setTimeout(() => { flashAlpha = 0; }, 400);
    if (currentKey === key) scheduleFlash(cfg, key);
  }, delay);
}

// ─── Setup ──────────────────────────────────────────────────────────────────
function initCanvas() {
  canvas = document.getElementById("weatherCanvas");
  if (!canvas) return false;
  ctx = canvas.getContext("2d", { alpha: true, desynchronized: true }) || canvas.getContext("2d");
  if (!ctx) return false;
  resize();
  return true;
}

function resize() {
  if (!canvas || !ctx) return;
  const rect = canvas.parentElement?.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return;

  // Logical simulation space is always 512 units wide so particle sizes, speeds,
  // and sprite dimensions stay identical across 512×300 (Portal/phone) and 4K TVs.
  canvasWidth = 512;
  canvasHeight = Math.max(240, Math.round(512 * (rect.height / rect.width)));

  const lite = !!getPrefs().liteMode;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const physicalW = lite
    ? 640
    : Math.min(1280, Math.max(512, Math.round(rect.width * dpr)));
  const scale = physicalW / canvasWidth;
  const physicalH = Math.round(canvasHeight * scale);

  canvas.width = physicalW;
  canvas.height = physicalH;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

// ─── Layer draw functions ───────────────────────────────────────────────────
function drawRain(layer, step = 1) {
  const cfg = layer.cfg;
  ctx.strokeStyle = `rgba(200, 210, 230, ${cfg.opacity})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const p of layer.particles) {
    p.y += p.speed * step;
    p.x += p.wind * step;
    if (p.y > canvasHeight) {
      p.y = -p.length;
      p.x = Math.random() * canvasWidth;
    }
    if (p.x > canvasWidth) p.x = 0;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.wind * 0.5, p.y + p.length);
  }
  ctx.stroke();

  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(220, 230, 255, ${flashAlpha})`;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }
}

function drawSnow(layer, step = 1) {
  const cfg = layer.cfg;
  ctx.fillStyle = `rgba(255, 255, 255, ${cfg.opacity})`;
  ctx.beginPath();
  for (const p of layer.particles) {
    p.y += p.speed * step;
    p.wobble += p.wobbleSpeed * step;
    p.x += Math.sin(p.wobble) * p.wind * step;
    if (p.y > canvasHeight + p.size) {
      p.y = -p.size;
      p.x = Math.random() * canvasWidth;
    }
    if (p.x > canvasWidth) p.x = 0;
    if (p.x < 0) p.x = canvasWidth;
    const fx = Math.floor(p.x);
    const fy = Math.floor(p.y);
    ctx.moveTo(fx + p.size, fy);
    ctx.arc(fx, fy, p.size, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawFog(layer, step = 1) {
  const sprite = layer.extra.sprite;
  if (!sprite) return;
  for (const l of layer.particles) {
    l.offset += l.speed * step;
    if (l.offset > canvasWidth) l.offset -= canvasWidth * 2;
    if (l.offset < -canvasWidth) l.offset += canvasWidth * 2;
    ctx.globalAlpha = l.alpha;
    ctx.drawImage(sprite, l.offset, l.y, canvasWidth * 2, l.height);
  }
  ctx.globalAlpha = 1;
}

function drawDust(layer, step = 1) {
  const cfg = layer.cfg;
  for (const p of layer.particles) {
    p.y -= p.speed * step;
    p.x += p.drift * step;
    p.phase += 0.008 * step;
    const alpha = cfg.opacity * p.alpha * (0.5 + 0.5 * Math.sin(p.phase));
    if (p.y < -p.size) {
      p.y = canvasHeight + p.size;
      p.x = Math.random() * canvasWidth;
    }
    if (p.x > canvasWidth) p.x = 0;
    if (p.x < 0) p.x = canvasWidth;
    ctx.fillStyle = `rgba(255, 248, 220, ${alpha})`;
    ctx.beginPath();
    ctx.arc(Math.floor(p.x), Math.floor(p.y), p.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSparkle(layer, step = 1) {
  const cfg = layer.cfg;
  for (const p of layer.particles) {
    p.phase += 0.02 * step;
    p.y -= p.speed * 0.3 * step;
    p.x += p.drift * 0.5 * step;
    const alpha = cfg.opacity * p.alpha * Math.max(0, Math.sin(p.phase));
    if (p.y < -p.size) {
      p.y = canvasHeight + p.size;
      p.x = Math.random() * canvasWidth;
    }
    ctx.fillStyle = `rgba(220, 235, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(Math.floor(p.x), Math.floor(p.y), p.size * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawClouds(layer, step = 1) {
  const cfg = layer.cfg;
  const sprite = layer.extra.sprite;
  for (const p of layer.particles) {
    p.x += p.speed * step;
    const w = sprite.width * p.scale;
    const h = sprite.height * p.scale;
    if (p.x > canvasWidth + w * 0.5) p.x = -w;
    ctx.globalAlpha = cfg.opacity * p.alpha;
    ctx.drawImage(sprite, p.x, p.y, w, h);
  }
  ctx.globalAlpha = 1;
}

function drawSunrays(layer, step = 1) {
  const cfg = layer.cfg;
  layer.extra.phase += 0.004 * step;
  // Slow breathing between ~60% and 100% of the base opacity.
  ctx.globalAlpha = cfg.opacity * (0.8 + 0.2 * Math.sin(layer.extra.phase));
  ctx.drawImage(layer.extra.sprite, 0, 0, canvasWidth, canvasHeight);
  ctx.globalAlpha = 1;
}

function drawLeaves(layer, step = 1) {
  const cfg = layer.cfg;
  for (const p of layer.particles) {
    p.y += p.speed * step;
    p.wobble += p.wobbleSpeed * step;
    p.x += Math.sin(p.wobble) * p.wind * step;
    p.rot += p.rotSpeed * step;
    if (p.y > canvasHeight + p.size) {
      p.y = -p.size * 2;
      p.x = Math.random() * canvasWidth;
    }
    if (p.x > canvasWidth + p.size) p.x = -p.size;
    if (p.x < -p.size) p.x = canvasWidth + p.size;
    // Flutter: apparent width follows the wobble so leaves "tip" as they sway.
    const tilt = 0.3 + 0.7 * Math.abs(Math.sin(p.wobble * 0.7));
    ctx.fillStyle = `rgba(${p.color}, ${cfg.opacity})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.size, p.size * 0.45 * tilt, p.rot, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFireflies(layer, step = 1) {
  const cfg = layer.cfg;
  const sprite = layer.extra.sprite;
  for (const p of layer.particles) {
    p.px += p.spx * step;
    p.py += p.spy * step;
    p.pulse += p.pulseSpeed * step;
    const x = p.ax + Math.sin(p.px) * p.rx;
    const y = p.ay + Math.sin(p.py) * p.ry;
    const a = cfg.opacity * Math.max(0, Math.sin(p.pulse)) ** 2;
    if (a < 0.02) continue;
    if (p.glowing) {
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, x - 12, y - 12);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = `rgba(255, 236, 150, ${a})`;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
  }
}

function drawStars(layer, step = 1) {
  const cfg = layer.cfg;
  for (const p of layer.particles) {
    p.phase += p.speed * step;
    const a = cfg.opacity * p.alpha * (0.45 + 0.55 * Math.sin(p.phase) ** 2);
    ctx.fillStyle = `rgba(225, 235, 255, ${a})`;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
}

function drawShooting(layer, step = 1) {
  const now = performance.now();
  const ex = layer.extra;
  if (!ex.active && now >= ex.nextAt) {
    const fromLeft = Math.random() < 0.5;
    ex.active = {
      x: fromLeft ? rand(0, canvasWidth * 0.3) : rand(canvasWidth * 0.7, canvasWidth),
      y: rand(10, canvasHeight * 0.35),
      vx: (fromLeft ? 1 : -1) * rand(5, 8),
      vy: rand(1.5, 3),
      life: 1,
    };
  }
  const s = ex.active;
  if (!s) return;
  s.x += s.vx * step;
  s.y += s.vy * step;
  s.life -= 0.022 * step;
  if (s.life <= 0 || s.x < -40 || s.x > canvasWidth + 40 || s.y > canvasHeight) {
    ex.active = null;
    ex.nextAt = now + rand(layer.cfg.interval[0], layer.cfg.interval[1]);
    return;
  }
  const trail = 26;
  const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * trail * 0.4, s.y - s.vy * trail * 0.4);
  grad.addColorStop(0, `rgba(255, 255, 255, ${0.8 * s.life})`);
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x - s.vx * trail * 0.4, s.y - s.vy * trail * 0.4);
  ctx.stroke();
}

function drawAurora(layer, step = 1) {
  const cfg = layer.cfg;
  const sprite = layer.extra.sprite;
  for (const r of layer.extra.offsets) {
    r.x += r.speed * step;
    r.phase += 0.003 * step;
    if (r.x > canvasWidth) r.x -= canvasWidth;
    if (r.x < -canvasWidth) r.x += canvasWidth;
    ctx.globalAlpha = cfg.opacity * (0.7 + 0.3 * Math.sin(r.phase));
    ctx.drawImage(sprite, r.x - canvasWidth, -6);
  }
  ctx.globalAlpha = 1;
}

function drawHaze(layer, step = 1) {
  const cfg = layer.cfg;
  const sprite = layer.extra.sprite;
  for (const p of layer.particles) {
    p.y -= p.speed * step;
    p.phase += 0.006 * step;
    if (p.y < -sprite.height) p.y = canvasHeight;
    ctx.globalAlpha = cfg.opacity * p.alpha * (0.6 + 0.4 * Math.sin(p.phase));
    ctx.drawImage(sprite, 0, p.y);
  }
  ctx.globalAlpha = 1;
}

const DRAWERS = {
  rain: drawRain,
  snow: drawSnow,
  fog: drawFog,
  dust: drawDust,
  sparkle: drawSparkle,
  clouds: drawClouds,
  sunrays: drawSunrays,
  leaves: drawLeaves,
  fireflies: drawFireflies,
  stars: drawStars,
  shooting: drawShooting,
  aurora: drawAurora,
  haze: drawHaze,
};

function frame(now = performance.now()) {
  if (!ctx || !canvas) return;
  const lite = !!getPrefs().liteMode;
  const elapsed = lastFrameTime ? now - lastFrameTime : 16.67;

  // In Lite mode, pace the particle loop to ~30fps on TVs while compensating
  // particle step velocity so motion speed stays identical to 60fps.
  if (lite && lastFrameTime && elapsed < 31) {
    animId = requestAnimationFrame(frame);
    return;
  }
  lastFrameTime = now;
  const step = Math.min(2.4, Math.max(0.5, elapsed / 16.667));

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  for (const layer of layers) {
    const draw = DRAWERS[layer.cfg.type];
    if (draw) draw(layer, step);
  }
  animId = requestAnimationFrame(frame);
}

// ─── Public API ─────────────────────────────────────────────────────────────
export function startWeatherFx(category) {
  if (category) lastCategory = category;

  // Respect reduced motion
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  if (!canvas && !initCanvas()) return;

  // Re-evaluate tod/season every minute so scenes shift at dusk/dawn without
  // waiting for the next weather refresh.
  if (!retimer) {
    retimer = setInterval(() => {
      if (lastCategory && getPrefs().overlayFx) startWeatherFx(lastCategory);
    }, 60 * 1000);
  }

  const prefs = getPrefs();
  const homeFrame = document.getElementById("frame-home");

  if (!prefs.overlayFx) {
    stopParticles();
    currentKey = null;
    if (homeFrame) homeFrame.classList.remove("weather-heat");
    return;
  }

  const effectiveCat = lastCategory || state.weather?.category || "clear-warm";
  const key = resolveFxKey(effectiveCat, currentTod(), currentSeason());

  // CSS-side effects (heat shimmer) follow the scene, disabled in Lite mode to
  // avoid full-screen CSS filter blur on TV GPUs.
  if (homeFrame) {
    homeFrame.classList.toggle("weather-heat", !prefs.liteMode && SCENES[key]?.css === "weather-heat");
  }

  if (key === currentKey && animId) return;
  currentKey = key;

  if (!key) {
    stopParticles();
    return;
  }

  resize();
  buildScene(key);
  canvas.classList.add("active");

  if (!animId) {
    lastFrameTime = 0;
    animId = requestAnimationFrame(frame);
  }
}

export function stopWeatherFx() {
  stopParticles();
  currentKey = null;
  lastCategory = null;
  if (retimer) { clearInterval(retimer); retimer = null; }
  const homeFrame = document.getElementById("frame-home");
  if (homeFrame) homeFrame.classList.remove("weather-heat");
}

function stopParticles() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
  if (canvas) canvas.classList.remove("active");
  if (ctx && canvas) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  layers = [];
  lastFrameTime = 0;
}

// Pause when tab hidden + react to resize and preference changes
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (animId) { cancelAnimationFrame(animId); animId = null; }
    } else if (currentKey && layers.length && getPrefs().overlayFx) {
      if (!animId) {
        lastFrameTime = 0;
        animId = requestAnimationFrame(frame);
      }
    }
  });

  window.addEventListener("resize", () => {
    if (canvas && currentKey && getPrefs().overlayFx) {
      resize();
      buildScene(currentKey);
    }
  });

  window.addEventListener("prefs-change", (e) => {
    const key = e.detail?.key;
    if (key === "overlayFx") {
      if (e.detail.value) {
        currentKey = null;
        startWeatherFx(lastCategory || state.weather?.category || "clear-warm");
      } else {
        stopParticles();
        currentKey = null;
        document.getElementById("frame-home")?.classList.remove("weather-heat");
      }
    } else if (key === "liteMode") {
      const homeFrame = document.getElementById("frame-home");
      if (homeFrame) {
        homeFrame.classList.toggle("weather-heat", !e.detail.value && SCENES[currentKey]?.css === "weather-heat");
      }
      if (canvas && currentKey && getPrefs().overlayFx) {
        resize();
        buildScene(currentKey);
      }
    }
  });
}

// Debug hook
if (typeof window !== "undefined") {
  window.__weatherFx = {
    start: startWeatherFx,
    stop: stopWeatherFx,
    state: () => ({
      currentKey,
      lastCategory,
      active: !!animId,
      layerCount: layers.length,
      particleCount: layers.reduce((sum, l) => sum + (l.particles?.length || 0), 0),
      canvasWidth,
      canvasHeight,
      physicalWidth: canvas?.width || 0,
      physicalHeight: canvas?.height || 0,
    }),
  };
}
