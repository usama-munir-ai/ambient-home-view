// Typography adapter — dynamically adjusts the hero clock's font, color,
// and text-shadow based on the current wallpaper palette, time-of-day, and mood.
//
// Two palette paths:
//   1. Pre-baked palette from splash-manifest.json (fast, always available)
//   2. Canvas pixel sampling (runtime, only for same-origin images)
//
// The font is always selected based on time-of-day and mood, regardless of
// whether palette extraction succeeds.

import { state } from "./state.js";
import { classifyTimeOfDay } from "./time.js";

// ─── Font Roster ────────────────────────────────────────────────────────────
// 6 display fonts mapped to time-of-day / mood contexts.
const FONT_ROSTER = [
  { family: '"Inter", sans-serif',              weight: 200, tod: ["day"],                      mood: [] },
  { family: '"Playfair Display", serif',        weight: 300, tod: ["golden", "dusk"],            mood: ["contemplative"] },
  { family: '"Space Grotesk", sans-serif',      weight: 300, tod: ["night"],                     mood: ["expansive"] },
  { family: '"Instrument Serif", serif',        weight: 400, tod: ["dawn", "morning"],           mood: ["hopeful", "sacred"] },
  { family: '"DM Serif Display", serif',        weight: 400, tod: [],                            mood: ["grounded", "resilient"], holiday: true },
  { family: '"Bodoni Moda", serif',             weight: 400, tod: ["lateNight"],                 mood: ["contemplative"], cozy: true },
];

// ─── Color Palette ──────────────────────────────────────────────────────────
// Curated luminous text color presets — always light, never dark/black ink.
// Each preset harmonizes with the wallpaper's hue and warmth while staying
// crisp and bright across the room.
const COLOR_PRESETS = [
  { name: "warm-cream",     hex: "#FCF5E5", hueRange: [20, 60],   warmth: "warm" },
  { name: "champagne-gold", hex: "#FAF0DC", hueRange: [30, 55],   warmth: "warm" },
  { name: "soft-rose",      hex: "#FAE8E6", hueRange: [345, 20],  warmth: "warm" },
  { name: "cool-silver",    hex: "#EFF4FA", hueRange: [195, 240], warmth: "cool" },
  { name: "ice-white",      hex: "#F4F8FF", hueRange: [205, 235], warmth: "cool" },
  { name: "midnight-pearl", hex: "#E8EEFA", hueRange: [230, 280], warmth: "cool" },
  { name: "forest-sage",    hex: "#EDF4EB", hueRange: [85, 165],  warmth: "neutral" },
  { name: "alabaster",      hex: "#F8F6F1", hueRange: [0, 360],   warmth: "neutral" },
];

// ─── Shadow Presets ─────────────────────────────────────────────────────────
const SHADOW_DARK   = "0 2px 22px rgba(0,0,0,0.58), 0 1px 2px rgba(0,0,0,0.34)";
const SHADOW_BRIGHT = "0 3px 28px rgba(0,0,0,0.76), 0 1px 4px rgba(0,0,0,0.52)";

let lastFontFamily = "";
let lastColorHex = "";

/**
 * Called whenever a new wallpaper is applied.
 * Uses pre-baked manifest palette if available, falls back to canvas sampling.
 */
export function adaptTypography(imageOrPalette) {
  const loc = state.homeLocation;
  const now = new Date();
  const tod = (loc && classifyTimeOfDay(now, loc.lat, loc.lon)) || "day";

  // Determine palette: either from pre-baked manifest or canvas extraction
  let palette;
  if (imageOrPalette && typeof imageOrPalette === "object" && imageOrPalette.dominant) {
    // Pre-baked palette from splash-manifest or sipped asset
    palette = normalizePalette(imageOrPalette);
  } else if (imageOrPalette instanceof HTMLImageElement) {
    palette = extractPaletteFromImage(imageOrPalette);
  } else {
    palette = { hue: 30, sat: 20, lum: 25, isLight: false, warmth: "warm" };
  }

  // Region luminance (0..1) where the text actually sits. Prefer the build
  // pass's measured quiet-region luminance. Fall back to isLight (mean-
  // luminance derived) — NOT the dominant colour's lightness, which on a dark
  // photo is often a mid-gray and misleads the contrast pick.
  const bgLum = typeof palette.quietLum === "number"
    ? palette.quietLum
    : (palette.isLight ? 0.80 : 0.15);

  const font = pickFont(tod);
  const scheme = buildColorScheme(bgLum, palette);
  applyHeroStyle(font, scheme);
}

// ─── Contrast-driven color engine (Luminous-only, WCAG-grounded) ──────────────
// Ambient clock & overlay text is ALWAYS luminous light — never dark or black
// ink (which looks harsh and dead over photography). Instead, text takes a
// subtle warm/cool/pastel tint from COLOR_PRESETS, and legibility over bright
// skies is guaranteed by scaling the dark atmospheric scrim + soft drop shadow.

const CONTRAST_TARGET = 4.5; // WCAG AA body; large clock numerals clear this easily

/** WCAG relative luminance of an sRGB hex. */
function wcagLum(hex) {
  const ch = [1, 3, 5].map((i) => {
    let c = (parseInt(hex.slice(i, i + 2), 16) || 0) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function buildColorScheme(bgLum, palette) {
  const preset = pickColor(palette);
  const textHex = preset.hex;

  // Always-dark atmospheric scrim: scales up smoothly when the quiet region is
  // bright so luminous text stays crisp without ever flipping to black ink.
  const textLum = wcagLum(textHex);
  const need = (textLum + 0.05) / CONTRAST_TARGET - 0.05; // want effective bg ≤ need
  const solve = need < bgLum ? (bgLum - need) / (bgLum + 1e-3) : 0;
  const baseline = 0.22 + bgLum * 0.34;
  const scrimAlpha = Math.min(0.62, Math.max(baseline, solve * 0.85));
  const scrimRGB = palette.warmth === "warm" ? "10, 8, 6" : "6, 8, 14";
  const peak = (a) => `rgba(${scrimRGB}, ${Math.min(0.74, a).toFixed(3)})`;

  // Effective background luminance after the dark scrim is applied
  const effBg = bgLum * (1 - scrimAlpha);

  return {
    textHex,
    useInk: false,
    shadow: bgLum > 0.42 ? SHADOW_BRIGHT : SHADOW_DARK,
    accent: contrastClamp(pickAccent(palette), effBg, 3.2),
    accent2: contrastClamp(pickAccent2(palette), effBg, 3.2),
    scrimColor: peak(scrimAlpha + 0.06),
    scrimSoft: peak(scrimAlpha * 0.44),
  };
}

/**
 * Primary accent (clock dots, temp highs): warm golden/amber or harmonious pop,
 * lightness always high (72%) so it glows against the dark scrim.
 */
function pickAccent(palette) {
  const hue = (((palette.hue || 35) + 150) % 360);
  return hslToHex(hue, 64, 72);
}

/** Secondary accent (temp lows): cool luminous companion. */
function pickAccent2(palette) {
  const hue = (((palette.hue || 35) + 200) % 360);
  return hslToHex(hue, 52, 76);
}

/**
 * Nudge an accent's lightness upward until it clears a minimum contrast vs the
 * dark-scrimmed background — so colored temps/dots never look dark or muddy.
 */
function contrastClamp(hex, bgLum, minRatio) {
  const [h, s, startL] = rgbToHsl(
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  );
  let l = Math.max(66, startL);
  hex = hslToHex(h, s, l);
  for (let i = 0; i < 12; i += 1) {
    if (contrastRatio(wcagLum(hex), bgLum) >= minRatio) break;
    l = Math.min(94, l + 5);
    hex = hslToHex(h, s, l);
  }
  return hex;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** "#rrggbb" + alpha (0..1) → "rgba(r, g, b, a)". */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Normalize a pre-baked manifest palette into our internal format.
 */
function normalizePalette(p) {
  const dominant = p.dominant || "#3a3020";
  const isLight = !!p.isLight;
  const warmth = p.warmth || "neutral";

  // Parse hex to get hue
  const r = parseInt(dominant.slice(1, 3), 16) || 0;
  const g = parseInt(dominant.slice(3, 5), 16) || 0;
  const b = parseInt(dominant.slice(5, 7), 16) || 0;
  const [h, s, l] = rgbToHsl(r, g, b);

  // quietLum (0..1) is measured on the entry, not the palette sub-object —
  // adaptFromCurrentWallpaper merges it in. It's the luminance of the region
  // the text sits over, the truest input for contrast.
  const quietLum = typeof p.quietLum === "number" ? p.quietLum : undefined;
  return { hue: h, sat: s, lum: l, isLight, warmth, dominant, quietLum };
}

/**
 * Extract palette via canvas pixel sampling (same-origin images only).
 */
function extractPaletteFromImage(img) {
  const fallback = { hue: 30, sat: 20, lum: 25, isLight: false, warmth: "warm" };
  try {
    const canvas = document.createElement("canvas");
    const size = 8;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    let rSum = 0, gSum = 0, bSum = 0;
    const pixels = size * size;
    for (let i = 0; i < data.length; i += 4) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }
    const r = Math.round(rSum / pixels);
    const g = Math.round(gSum / pixels);
    const b = Math.round(bSum / pixels);
    const [h, s, l] = rgbToHsl(r, g, b);
    const isLight = l > 55;
    const warmth = h >= 15 && h <= 65 ? "warm" : h >= 180 && h <= 260 ? "cool" : "neutral";

    return { hue: h, sat: s, lum: l, isLight, warmth };
  } catch {
    return fallback;
  }
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function pickFont(tod) {
  // Check for holiday — use DM Serif Display
  const holiday = state.activeHoliday;
  if (holiday) {
    const holidayFont = FONT_ROSTER.find((f) => f.holiday);
    if (holidayFont) return holidayFont;
  }

  // Match by time-of-day
  const todMatch = FONT_ROSTER.filter((f) => f.tod.includes(tod));
  if (todMatch.length) return todMatch[0];

  // Fallback to Inter
  return FONT_ROSTER[0];
}

function pickColor(palette) {
  const hue = typeof palette.hue === "number" ? palette.hue : 30;
  const warmth = palette.warmth || "neutral";

  // Prefer presets that match both hue range and warmth, then hue range alone
  const pool = COLOR_PRESETS.filter((c) => c.warmth === warmth);
  const candidates = pool.length ? pool : COLOR_PRESETS;

  let best = candidates[0];
  let bestDist = Infinity;

  for (const preset of candidates) {
    const [lo, hi] = preset.hueRange;
    let dist;
    if (lo <= hi) {
      dist = hue >= lo && hue <= hi ? 0 : Math.min(Math.abs(hue - lo), Math.abs(hue - hi));
    } else {
      dist = (hue >= lo || hue <= hi) ? 0 : Math.min(Math.abs(hue - lo), Math.abs(hue - hi));
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }
  return best;
}

function applyHeroStyle(font, scheme) {
  const root = document.documentElement;
  const c = "#ffffff";

  // Strictly pure white and luminous shades of white across all frames.
  root.style.setProperty("--splash-text", "#ffffff");
  root.style.setProperty("--splash-text-2", "rgba(255, 255, 255, 0.88)");
  root.style.setProperty("--splash-text-3", "rgba(255, 255, 255, 0.76)");
  root.style.setProperty("--splash-text-4", "rgba(255, 255, 255, 0.36)");
  root.style.setProperty("--splash-shadow", scheme.shadow);
  root.style.setProperty("--splash-accent", "#ffffff");
  root.style.setProperty("--splash-accent-2", "rgba(255, 255, 255, 0.84)");
  root.style.setProperty("--splash-scrim-color", scheme.scrimColor);
  root.style.setProperty("--splash-scrim-soft", scheme.scrimSoft);

  const fontChanged = font.family !== lastFontFamily;
  const colorChanged = c !== lastColorHex;
  if (!fontChanged && !colorChanged) return;
  lastFontFamily = font.family;
  lastColorHex = c;
  root.style.setProperty("--hero-font", font.family);
  root.style.setProperty("--hero-weight", String(font.weight));
  root.style.setProperty("--hero-color", "#ffffff");
  root.style.setProperty("--hero-shadow", scheme.shadow);
  root.style.setProperty("--hero-meta-color", "rgba(255, 255, 255, 0.84)");
}

/**
 * Called after each wallpaper swap by the curator.
 * Uses the pre-baked palette from the manifest image if available,
 * otherwise falls back to canvas pixel sampling.
 */
export function adaptFromCurrentWallpaper() {
  try {
    // Adapt to whichever frame is currently visible so its text/accent track
    // that wallpaper (home, prayer, wisdom all use the splash tokens).
    const frame = state.currentFrame || "home";
    const lastImage = state.splash?.lastByFrame?.[frame];
    if (lastImage?.palette) {
      // Merge the entry's quiet-region luminance into the palette so the
      // contrast engine targets the actual region the text sits over.
      adaptTypography({ ...lastImage.palette, quietLum: lastImage.quietLum });
      return;
    }

    // Second try: sample the visible bg-layer
    const layers = document.querySelectorAll("#frame-home .bg-layer.visible");
    if (!layers.length) {
      // No wallpaper loaded yet — just adapt font based on time-of-day
      adaptTypography(null);
      return;
    }
    const bgUrl = layers[0].style.backgroundImage.replace(/^url\(['"]?|['"]?\)$/g, "");
    if (!bgUrl || bgUrl.startsWith("http")) {
      // Cross-origin — can't sample, use time-of-day font only
      adaptTypography(null);
      return;
    }
    const img = new Image();
    img.onload = () => adaptTypography(img);
    img.onerror = () => adaptTypography(null);
    img.src = bgUrl;
  } catch {
    adaptTypography(null);
  }
}
