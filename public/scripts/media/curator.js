// Splash Curator — autonomous engine that picks the right ambient image
// for the moment, with no Pixabay roulette and no Picsum blur.
//
// Inputs:
//   - frame key (home/prayer/quran/quotes/world/cal)
//   - state.weather.category
//   - solar time-of-day (dawn/morning/day/golden/dusk/night/lateNight)
//   - season
//   - quote mood
//   - 24h history of recently shown image ids
//
// Output:
//   - Picks max-score image not in last 24h, swaps it onto the frame's
//     dual-layer background, sets data-text-side to the image's quietSide,
//     records the pick in localStorage, refreshes credit pill.

import { state } from "../state.js";
import { STORAGE, getSplashRotateMs } from "../constants.js";
import { $, hashString, readLS, writeLS, todayKey } from "../util.js";
import { classifyTimeOfDay, classifySeason } from "../time.js";
import { currentQuote } from "../quotes.js";
import { getHolidayTags } from "../holidays.js";
import { adaptFromCurrentWallpaper } from "../typography.js";
import { getPrefs } from "../prefs.js";
import { renderHomeLocationClock } from "../home.js";
import { DEBUG } from "../debug.js";

let manifestPromise = null;
let rotateTimer = null;
let todWatchTimer = null;
let listenersWired = false;
let lastHomeWeather = null;
let lastHomeTod = null;

const SCORE_WEIGHTS = {
  tagMatch: 0.25,
  weatherMatch: 0.28,
  paletteHarmony: 0.13,
  novelty: 0.10,
  quietSideMatch: 0.08,
  seasonalBoost: 0.08,
  holidayBoost: 0.08,
};

const HISTORY_HORIZON_MS = 24 * 60 * 60 * 1000;
const HISTORY_MAX_ENTRIES = 300;

// Clock numerals (115px) and weather temp (52px) on the 512×300 Portal 10
// viewport are always luminous light (#FCF5E5..#F8F6F1, lum ~0.92), so the
// 48%×54% upper clock quadrant must stay ≤ 0.48 luminance and ≥ 0.36 negative
// space calmness to guarantee crisp contrast.
const HOME_MAX_QUIET_LUM = 0.48;

// The daily workflow rebuilds the manifest, but this wall display can sit on the
// same page for days. Caching it for the whole session means new wallpapers
// never reach the device without a manual reload — so re-pull it on a TTL.
const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000;

export async function loadSplashManifest() {
  const cached = state.splash.manifest;
  const fresh = cached && Date.now() - (state.splash.manifestAt || 0) < MANIFEST_TTL_MS;
  if (fresh) return cached;
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    try {
      const res = await fetch("/data/splash-manifest.json", { cache: "no-store" });
      if (!res.ok) throw new Error("manifest fetch failed");
      const payload = await res.json();
      // The manifest is refreshed by an unattended job; accept only local
      // files and https URLs that cannot break out of a CSS url('').
      const safeSrc = /^(\/splash\/|https:\/\/)[^\s'"()\\]+$/;
      const list = (Array.isArray(payload?.images) ? payload.images : [])
        .filter((img) => typeof img?.src === "string" && safeSrc.test(img.src));
      state.splash.manifest = list;
      state.splash.manifestAt = Date.now();
      return list;
    } catch (err) {
      console.warn("[curator] manifest unavailable, gradient fallback only", err);
      if (!state.splash.manifest) state.splash.manifest = [];
      return state.splash.manifest;
    } finally {
      manifestPromise = null; // let the next stale check re-pull
    }
  })();
  return manifestPromise;
}

function getContext(frame) {
  const loc = state.homeLocation;
  const now = new Date();
  const tod = (loc && classifyTimeOfDay(now, loc.lat, loc.lon)) || "day";
  const season = (loc && classifySeason(now, loc.lat)) || "spring";
  const weather = state.weather?.category || "clear-warm";
  let mood = "contemplative";
  try {
    const q = currentQuote();
    if (q?.mood) mood = q.mood;
  } catch { /* ignore */ }
  const holidayTags = getHolidayTags(now, state.hijriDate || null);
  return { frame, tod, season, weather, mood, holidayTags, dateKey: todayKey(now) };
}

function getHistory() {
  const raw = readLS(STORAGE.splashHistory, { entries: [] });
  if (!raw || !Array.isArray(raw.entries)) return [];
  const now = Date.now();
  return raw.entries.filter((e) => now - (e.t || 0) < HISTORY_HORIZON_MS);
}

function recordHistory(frame, image) {
  const entries = getHistory();
  entries.push({ t: Date.now(), id: image.id, frame });
  writeLS(STORAGE.splashHistory, { entries: entries.slice(-HISTORY_MAX_ENTRIES) });
}

function paletteHarmony(image, theme) {
  const warmth = image.palette?.warmth || "neutral";
  if (theme === "light") {
    if (warmth === "warm") return 0.85;
    if (warmth === "neutral") return 0.7;
    return 0.55;
  }
  if (theme === "golden") {
    if (warmth === "warm") return 1.0;
    if (warmth === "neutral") return 0.7;
    return 0.45;
  }
  // dark
  if (warmth === "cool") return 0.95;
  if (warmth === "neutral") return 0.75;
  return 0.65;
}

function tagMatchScore(image, ctx) {
  const tags = new Set(image.tags || []);
  const wants = [ctx.weather, ctx.tod, ctx.mood, ctx.season, ...ctx.holidayTags].filter(Boolean);
  let hits = 0;
  wants.forEach((w) => { if (tags.has(w)) hits += 1; });
  return wants.length ? hits / wants.length : 0;
}

function weatherMatchScore(image, ctx) {
  const tags = new Set(image.tags || []);
  // Direct weather category match is the strongest signal
  if (tags.has(ctx.weather)) return 1;
  // Related weather groups
  const groups = {
    "rain-steady": ["drizzle", "rain-torrential", "overcast"],
    "rain-torrential": ["rain-steady", "thunderstorm"],
    "drizzle": ["rain-steady", "overcast", "fog"],
    "snow-light": ["snow-heavy", "clear-cold"],
    "snow-heavy": ["snow-light", "clear-cold"],
    "thunderstorm": ["rain-torrential", "rain-steady"],
    "fog": ["drizzle", "overcast"],
    "clear-warm": ["heat", "partly-cloudy"],
    "clear-cold": ["snow-light"],
    "heat": ["clear-warm"],
    "overcast": ["fog", "drizzle", "partly-cloudy"],
    "partly-cloudy": ["overcast", "clear-warm"],
  };
  const related = groups[ctx.weather] || [];
  for (const r of related) {
    if (tags.has(r)) return 0.5;
  }
  return 0;
}

function holidayScore(image, ctx) {
  if (!ctx.holidayTags.length) return 0.5; // Neutral when no holiday
  const tags = new Set(image.tags || []);
  let hits = 0;
  ctx.holidayTags.forEach((t) => { if (tags.has(t)) hits += 1; });
  return ctx.holidayTags.length ? hits / ctx.holidayTags.length : 0.5;
}

function noveltyScore(image, history) {
  if (!history.length) return 1;
  const recent = history.find((e) => e.id === image.id);
  if (!recent) return 1;
  const ageMs = Date.now() - recent.t;
  const ratio = Math.min(1, ageMs / HISTORY_HORIZON_MS);
  return ratio; // 0 if just shown, 1 if outside the 24h window
}

function quietSideMatch(image, ctx) {
  const want = ctx.frame === "home" ? "left" : "left";
  if (!image.quietSide) return 0.5;
  return image.quietSide === want ? 1 : 0.4;
}

function seasonalBoost(image, ctx) {
  const tags = new Set(image.tags || []);
  return tags.has(ctx.season) ? 1 : 0.4;
}

function frameAllows(image, frame) {
  if (!image.frames || !image.frames.length) return true;
  if (image.frames.includes(frame)) return true;
  if (frame === "prayer" && image.frames.includes("quran")) return true;
  return false;
}

// Tags that read as "framed artwork" or interior rooms rather than a wide-angle
// real-world location photograph.
const PAINTING_TAGS = new Set(["painting", "manuscript", "calligraphy", "artwork", "folio", "interior", "ai-scene"]);

// Local 1080×720 world-clock card PNGs look crisp inside small cards on the
// World Clock frame, but are too low-res for full-screen 4K Home/Prayer splashes.
const WORLD_CARD_ASSET_RE = /\/world clock_.*_01\.png$/i;

function homeContrastAllows(image, frame) {
  if ((frame === "home" || frame === "prayer") && WORLD_CARD_ASSET_RE.test(image.src || "")) {
    return false;
  }
  if (frame !== "home") return true;
  if (!image.place || !image.tz) return false;
  if (image.provider === "met" || image.provider === "rijksmuseum" || image.provider === "pollinations" || image.provider === "lexica") return false;
  if ((image.tags || []).some((t) => PAINTING_TAGS.has(t))) return false;
  return true;
}

function timeOfDayAlignment(image, ctx) {
  const tags = new Set(image.tags || []);
  const isNightCtx = ctx.tod === "night" || ctx.tod === "lateNight";
  const hasNightTag = tags.has("night") || tags.has("lateNight");
  const hasDayTag = tags.has("day") || tags.has("morning");
  if (isNightCtx) {
    if (hasNightTag) return 0.12;
    if (tags.has("dusk")) return 0.04;
    if (image.palette?.isLight || (typeof image.quietLum === "number" && image.quietLum > 0.42)) return -0.18;
    if (hasDayTag) return -0.10;
    return 0;
  }
  if (ctx.tod === "day" || ctx.tod === "morning") {
    if (hasNightTag && !hasDayTag) return -0.18;
    if (tags.has(ctx.tod)) return 0.08;
    return 0;
  }
  if (tags.has(ctx.tod)) return 0.10;
  return 0;
}

function homeQualityBias(image, ctx) {
  if (ctx.frame !== "home") return 0;
  let bias = 0;
  if (image.provider === "pexels") bias += 0.04;
  if ((image.tags || []).some((t) => t === "wonder" || t === "travel" || t === "heritage")) bias += 0.04;
  // Reward genuine negative space when the build pass measured it.
  if (typeof image.negSpace === "number") bias += (image.negSpace - 0.5) * 0.16;
  // Clock numerals are always luminous light (#FCF5E5..#F8F6F1), so darker
  // quiet regions (0.08..0.45) yield the crispest WCAG contrast.
  if (typeof image.quietLum === "number") {
    const contrastHeadroom = Math.max(0, Math.min(1, (HOME_MAX_QUIET_LUM - image.quietLum) / 0.48));
    bias += (contrastHeadroom - 0.5) * 0.16;
  }
  return bias;
}

function scoreImage(image, ctx, history) {
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  const tagScore = tagMatchScore(image, ctx);
  const weatherScore = weatherMatchScore(image, ctx);
  const palette = paletteHarmony(image, theme);
  const novelty = noveltyScore(image, history);
  const quiet = quietSideMatch(image, ctx);
  const season = seasonalBoost(image, ctx);
  const holiday = holidayScore(image, ctx);

  return (
    tagScore * SCORE_WEIGHTS.tagMatch +
    weatherScore * SCORE_WEIGHTS.weatherMatch +
    palette * SCORE_WEIGHTS.paletteHarmony +
    novelty * SCORE_WEIGHTS.novelty +
    quiet * SCORE_WEIGHTS.quietSideMatch +
    season * SCORE_WEIGHTS.seasonalBoost +
    holiday * SCORE_WEIGHTS.holidayBoost +
    timeOfDayAlignment(image, ctx) +
    homeQualityBias(image, ctx)
  );
}

function pickBest(manifest, ctx, history) {
  // Manifest plus any images added to the session pool at runtime.
  const sessionPool = state.splash.sessionPool || [];
  const all = manifest.concat(sessionPool);
  const allowAi = getPrefs().aiScenes;
  let candidates = all.filter((img) =>
    frameAllows(img, ctx.frame)
    && homeContrastAllows(img, ctx.frame)
    && img.src
    && !failedSrc.has(img.src)
    && (allowAi || !(img.tags || []).includes("ai-scene")));
  if (!candidates.length) return null;

  if (DEBUG.splash) {
    const q = DEBUG.splash.toLowerCase();
    const forced = candidates.find((img) =>
      String(img.id || "").toLowerCase() === q
      || String(img.place || "").toLowerCase().includes(q));
    if (forced) return forced;
  }

  // Hard-exclude what this frame has shown inside the novelty window, as long as
  // a healthy pool remains. The soft novelty *weight* alone let the single
  // top-scorer cycle straight back — this is what actually stops the repeats.
  const recent = new Set(history.filter((e) => e.frame === ctx.frame).map((e) => e.id));
  const unseen = candidates.filter((img) => !recent.has(img.id));
  if (unseen.length >= 6) candidates = unseen;

  // Prefer direct weather matches first, then related weather matches.
  const directWx = candidates.filter((img) => weatherMatchScore(img, ctx) === 1);
  if (directWx.length >= 4) {
    candidates = directWx;
  } else {
    const relatedWx = candidates.filter((img) => weatherMatchScore(img, ctx) > 0);
    if (relatedWx.length >= 4) candidates = relatedWx;
  }

  // Filter out day/night mismatches when sufficient time-appropriate images exist.
  const isNightCtx = ctx.tod === "night" || ctx.tod === "lateNight";
  const todFiltered = candidates.filter((img) => {
    const tags = img.tags || [];
    const isNightImg = tags.includes("night") || tags.includes("lateNight");
    return isNightCtx ? (isNightImg || tags.includes("dusk")) : !isNightImg;
  });
  if (todFiltered.length >= 4) candidates = todFiltered;

  // Score, then weighted-random among the strongest handful rather than always
  // the single argmax — equally-good images all earn screen time, so the
  // rotation feels alive instead of parking on one "best" wallpaper.
  const scored = candidates
    .map((image) => ({
      image,
      score:
        scoreImage(image, ctx, history)
        + ((hashString(ctx.dateKey + "|" + ctx.frame + "|" + image.id) % 1000) / 1000) * 0.06,
    }))
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(14, scored.length));
  return weightedPick(top).image;
}

// Weighted random favouring higher scores but giving the whole shortlist a real
// chance — keeps quality high while breaking the deterministic repeat.
function weightedPick(scored) {
  if (scored.length === 1) return scored[0];
  const lo = scored[scored.length - 1].score;
  const weights = scored.map((s) => (s.score - lo) + 0.04);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < scored.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return scored[i];
  }
  return scored[0];
}

const FRAME_BG_IDS = {
  home: ["homeBgA", "homeBgB"],
  prayer: ["prayerBgA", "prayerBgB"],
};

const useBLayer = {};

// Images that failed to preload this session — excluded from re-picks so a
// dead URL can't keep winning the scoring round.
const failedSrc = new Set();

function encodeSafeUrl(src) {
  if (!src) return "";
  return src.includes("%") ? src : encodeURI(src);
}

// Upgrade 720p/1080p manifest thumbnail URLs to 4K UHD (3840px) with automatic
// fallback through native original / 1920px / 1280px when an upstream CDN size
// step does not exist for a given source file.
function resolveHighDefCandidates(image) {
  if (image.resolvedSrc) return [image.resolvedSrc];
  const raw = encodeSafeUrl(image.src);
  if (!raw) return [];
  const out = [];
  const push = (u) => { if (u && !out.includes(u)) out.push(u); };

  if (raw.includes("images.pexels.com/photos/")) {
    const base = raw.split("?")[0];
    push(`${base}?auto=compress&cs=tinysrgb&w=3840`);
    push(raw);
    return out;
  }

  const wm = raw.match(/^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/thumb\/([^/]+\/[^/]+\/([^/]+))\/(\d+)px-(.+)$/);
  if (wm) {
    const [, root, filePath, fileName, , tail] = wm;
    const thumbBase = `${root}/thumb/${filePath}`;
    push(`${thumbBase}/3840px-${tail}`);
    if (/\.(jpe?g|webp)$/i.test(fileName)) {
      // Wikimedia only 404s on 3840px- when the original is narrower than 3840px,
      // which guarantees the original JPEG/WebP itself is a safe 2K–3.8K master.
      push(`${root}/${filePath}`);
    }
    push(`${thumbBase}/2560px-${tail}`);
    push(`${thumbBase}/1920px-${tail}`);
    push(raw);
    return out;
  }

  push(raw);
  return out;
}

function preloadImageUrl(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function preloadBestUrl(image) {
  const candidates = resolveHighDefCandidates(image);
  for (const candidate of candidates) {
    if (await preloadImageUrl(candidate)) {
      image.resolvedSrc = candidate;
      return candidate;
    }
  }
  return null;
}

async function applyImage(frame, image) {
  const ids = FRAME_BG_IDS[frame];
  if (!ids) return;
  const useB = !!useBLayer[frame];
  const layerA = $(ids[0]);
  const layerB = $(ids[1]);
  if (!layerA || !layerB) return;
  const target = useB ? layerB : layerA;
  const other = useB ? layerA : layerB;

  const url = await preloadBestUrl(image);
  if (!url) {
    // Broken/expired URL: keep the current wallpaper rather than fading to a
    // blank layer, and blacklist the URL for this session so the scorer
    // doesn't keep picking it.
    console.warn("[curator] splash preload failed, keeping current", image.id);
    failedSrc.add(image.src);
    recordHistory(frame, image);
    return;
  }
  const isFirstPaint = !layerA.classList.contains("visible") && !layerB.classList.contains("visible");
  if (isFirstPaint) {
    target.style.transition = "none";
  }
  target.style.backgroundImage = `url('${url}')`;
  target.classList.add("visible");
  other.classList.remove("visible");
  if (isFirstPaint) {
    void target.offsetWidth;
    target.style.transition = "";
  }
  useBLayer[frame] = !useB;

  const frameEl = document.getElementById("frame-" + frame);
  if (frameEl) {
    // Home is anchored top-left (hero clock) + top-right (location clock).
    frameEl.dataset.textSide = frame === "home" ? "left" : (image.quietSide || "left");
    delete frameEl.dataset.splashLight;
  }

  setCredit(image.credit, frame);
  if (!state.splash.lastByFrame) state.splash.lastByFrame = {};
  state.splash.lastByFrame[frame] = image;
  if (frame === "home") setHomeLocation(image);
  recordHistory(frame, image);

  // Adapt text/accent colors to the new wallpaper — but only when swapping the
  // frame the user is actually looking at, so a background rotation of another
  // frame can't overwrite the visible frame's palette tokens.
  if (frame === (state.currentFrame || "home")) {
    setTimeout(adaptFromCurrentWallpaper, 200);
  }
}

function setCredit(label, frame) {
  const el = $("frameCredit");
  if (!el) return;
  el.dataset.frame = frame || "";
  if (!label) { el.classList.remove("visible"); return; }
  el.textContent = label;
  el.classList.add("visible");
}

function setHomeLocation(image) {
  renderHomeLocationClock(image);
}

export async function ensureSplashFor(frame) {
  const supported = !!FRAME_BG_IDS[frame];
  if (!supported) {
    setCredit("");
    return;
  }
  const existing = state.splash?.lastByFrame?.[frame];
  if (existing) {
    setCredit(existing.credit, frame);
    if (frame === "home") setHomeLocation(existing);
    if (frame === (state.currentFrame || "home")) {
      adaptFromCurrentWallpaper();
    }
    return;
  }
  await applySplashFor(frame);
}

export async function applySplashFor(frame) {
  const supported = !!FRAME_BG_IDS[frame];
  if (!supported) {
    // World/photos don't use the dual-layer system
    setCredit("");
    return;
  }
  const manifest = await loadSplashManifest();
  if (!manifest.length) {
    // Fallback gradient — palette-aware
    fallbackGradient(frame);
    return;
  }
  const ctx = getContext(frame);
  if (frame === "home") {
    lastHomeWeather = ctx.weather;
    lastHomeTod = ctx.tod;
  }
  const history = getHistory();
  const image = pickBest(manifest, ctx, history);
  if (!image) { fallbackGradient(frame); return; }
  await applyImage(frame, image);
}

function fallbackGradient(frame) {
  const ids = FRAME_BG_IDS[frame];
  if (!ids) return;
  const layerA = $(ids[0]);
  if (!layerA) return;
  layerA.style.backgroundImage =
    "radial-gradient(ellipse at top, rgba(216,180,106,0.12), transparent 60%), " +
    "radial-gradient(ellipse at bottom right, rgba(110,167,199,0.10), transparent 60%), " +
    "var(--bg-base)";
  layerA.classList.add("visible");
  const layerB = $(ids[1]);
  if (layerB) layerB.classList.remove("visible");
  setCredit("");
}

function scheduleNextRotation() {
  if (rotateTimer) clearTimeout(rotateTimer);
  const weather = state.weather?.category || "clear-warm";
  const loc = state.homeLocation;
  const tod = loc ? classifyTimeOfDay(new Date(), loc.lat, loc.lon) : "day";
  rotateTimer = setTimeout(runScheduledRotation, getSplashRotateMs(weather, tod));
}

function runScheduledRotation() {
  applySplashFor("home").catch(() => { /* ignore */ });
  if (!getPrefs().liteMode) {
    const active = state.currentFrame;
    if (active && active !== "home" && FRAME_BG_IDS[active]) {
      applySplashFor(active).catch(() => { /* ignore */ });
    }
  }
  scheduleNextRotation();
}

export function startSplashRotator() {
  if (!listenersWired && typeof window !== "undefined") {
    listenersWired = true;
    window.addEventListener("weather-change", (e) => {
      const nextWx = e.detail?.category || state.weather?.category;
      if (nextWx && nextWx !== lastHomeWeather) {
        applySplashFor("home").catch(() => { /* ignore */ });
        scheduleNextRotation();
      }
    });
    window.addEventListener("prefs-change", (e) => {
      if (e.detail?.key === "aiScenes") {
        applySplashFor("home").catch(() => { /* ignore */ });
        scheduleNextRotation();
      }
    });
  }
  if (todWatchTimer) clearInterval(todWatchTimer);
  todWatchTimer = setInterval(() => {
    const loc = state.homeLocation;
    if (!loc) return;
    const tod = classifyTimeOfDay(new Date(), loc.lat, loc.lon);
    if (lastHomeTod && tod !== lastHomeTod) {
      applySplashFor("home").catch(() => { /* ignore */ });
      scheduleNextRotation();
    }
  }, 60 * 1000);
  scheduleNextRotation();
}

export function stopSplashRotator() {
  if (rotateTimer) clearTimeout(rotateTimer);
  rotateTimer = null;
  if (todWatchTimer) clearInterval(todWatchTimer);
  todWatchTimer = null;
}
