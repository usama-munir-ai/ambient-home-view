// Ambient Home View — entry module.
// Boots the app, wires runners, and reveals the surface.

import { DEBUG } from "./debug.js"; // first: query-param overrides + mock seeds
import { state } from "./state.js";
import { TICK_MS, FRAMES } from "./constants.js";
import { $, on } from "./util.js";
import { loadConfig } from "./config.js";
import { loadContent, applyVisitorLocation } from "./content.js";
import { startThemeRunner } from "./theme.js";
import { tickHome, renderHomeMeta } from "./home.js";

import { startWeatherRunner, loadCachedWeather } from "./weather.js";
import { startPrayerRunner } from "./prayer.js";
import { loadDailyAyah } from "./quran.js";
import { renderQuoteFrame } from "./quotes.js";
import { wisdomManual, tickWisdom, startWisdomRunner } from "./wisdom.js";
import {
  buildDock,
  wireDock,
  appBecameVisible,
  highlightCurrentFrame,
  pingDock,
} from "./dock.js";
import { wireFrameTriggers, navigateTo, startPageRotator } from "./nav.js";
import { applySplashFor, startSplashRotator, loadSplashManifest } from "./media/curator.js";
import { wireSettings } from "./settings.js";
import { format12hour, classifyTimeOfDay } from "./time.js";
import { startWeatherFx } from "./weather-fx.js";
import { adaptFromCurrentWallpaper } from "./typography.js";
import { startDisplayCare } from "./display-care.js";
import { startDriveRunner, stopDriveRunner } from "./drive.js";
import { getPrefs } from "./prefs.js";
import { stopWorldClocks } from "./world.js";
import { leavePhotosFrame } from "./photos.js";

let booted = false;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { void boot(); });
} else {
  void boot();
}

async function boot() {
  if (booted) return;
  booted = true;
  // Watchdog: no matter what happens below, the splash must fade within 3s
  // so a hung await can't lock the user out of the surface.
  const watchdog = setTimeout(() => reveal(), 3000);
  try {
    if (!state.bootedAt) state.bootedAt = Date.now();
    await Promise.allSettled([loadConfig(), loadContent(), loadSplashManifest()]);
    applyVisitorLocation();

    // Theme depends on home location
    startThemeRunner();

    // Apply Lite mode class before reveal
    const initialPrefs = getPrefs();
    document.documentElement.classList.toggle("lite-mode", !!initialPrefs.liteMode);
    $("app")?.classList.toggle("lite-mode", !!initialPrefs.liteMode);

    // Wire the dock and frame nav
    buildDock();
    wireDock();
    wireFrameTriggers();
    wireSettings();
    wireWisdomEdges();
    wireKeyboardNav();
    wireIdleCursor();
    wireFullscreen();
    wireFirstInteractionFullscreen();
    if (!DEBUG.mockHome) wireWakeLock();

    // Reveal immediately once the shell is wired to avoid splash lock-ups.
    clearTimeout(watchdog);
    reveal();

    // Boot data
    loadCachedWeather();
    startWeatherRunner();
    startPrayerRunner();
    loadDailyAyah();
    if (!DEBUG.mockHome && !initialPrefs.liteMode) startDriveRunner();

    // Render initial frames
    renderHomeMeta();
    if (!initialPrefs.liteMode) renderQuoteFrame();
    startWisdomRunner();

    // Start the heartbeat
    tickHome();
    setInterval(tickHome, TICK_MS);
    setInterval(updateDockClock, TICK_MS);
    updateDockClock();
    tickWisdom();
    setInterval(tickWisdom, TICK_MS);

    // Splash on home (may pick fallback gradient if manifest missing)
    void applySplashFor("home")
      .catch((err) => {
        console.warn("[boot] initial splash failed", err);
      })
      .finally(() => {
        // Re-sample text styling once the first wallpaper settles.
        setTimeout(adaptFromCurrentWallpaper, 500);
      });
    startSplashRotator();
    startPageRotator();

    // Boot weather FX and ambient overlays
    wireWeatherFx();
    applyAmbientFx();
    startDisplayCare();

    // Highlight home in dock
    highlightCurrentFrame("home");
  } catch (err) {
    console.error("[boot] fatal startup error", err);
    clearTimeout(watchdog);
    reveal();
  }
}

function reveal() {
  if (state.shown) return;
  state.shown = true;

  const splash = $("splash");
  const app = $("app");
  app.classList.add("shown");
  splash.classList.add("hidden");
  setTimeout(() => splash.remove(), 600);

  appBecameVisible();
}

function wireWisdomEdges() {
  on($("homeWisdom"), "click", () => { wisdomManual(1); });
  on($("prayerWisdom"), "click", () => { wisdomManual(1); });
}



/**
 * NoSleep-style canvas→video so stripped browsers (e.g. Facebook Portal) keep
 * the screen on. `navigator.wakeLock` is used when available.
 */
function makeNoSleepPlayer() {
  if (typeof document.createElement("canvas").getContext !== "function") {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx || typeof c.captureStream !== "function") return null;
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.setAttribute("aria-hidden", "true");
  video.setAttribute("id", "__nosleep");
  Object.assign(video.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "2px",
    height: "2px",
    opacity: "0.01",
    pointerEvents: "none",
    zIndex: "0",
  });
  document.body.appendChild(video);
  let f = 0;
  setInterval(() => {
    f ^= 1;
    ctx.fillStyle = f ? "rgb(0,0,0)" : "rgb(0,0,1)";
    ctx.fillRect(0, 0, 2, 2);
  }, 1000);
  const stream = c.captureStream(1);
  if (stream && "srcObject" in video) video.srcObject = stream;
  return () => video.play().catch(() => {});
}

function wireWakeLock() {
  const hasWake = "wakeLock" in navigator;
  // Avoid spinning up a continuous canvas.captureStream() video encode loop on
  // devices that support navigator.wakeLock or when running in Lite mode on TVs.
  const noSleepPlay = (!hasWake && !getPrefs().liteMode) ? makeNoSleepPlayer() : null;
  let lock = null;

  const playVideoFallback = () => {
    if (noSleepPlay && !getPrefs().liteMode) noSleepPlay();
  };

  const acquireWake = () => {
    if (!hasWake) return;
    navigator.wakeLock
      .request("screen")
      .then((x) => {
        lock = x;
        lock.addEventListener("release", () => { lock = null; });
      })
      .catch(() => { /* ignore */ });
  };

  const reapply = () => {
    if (document.visibilityState !== "visible") return;
    if (hasWake) acquireWake();
    playVideoFallback();
  };

  reapply();
  document.addEventListener("pointerdown", playVideoFallback, { capture: true, once: true });
  document.addEventListener("visibilitychange", reapply);
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function wireFullscreen() {
  const el = document.documentElement;
  const canRequest = !!(el.requestFullscreen || el.webkitRequestFullscreen);
  const enabled =
    document.fullscreenEnabled !== false
    && (document.webkitFullscreenEnabled !== false
      || typeof document.webkitFullscreenEnabled === "undefined");
  const can = canRequest && enabled;

  const btn = document.getElementById("fullscreenBtn");
  if (btn) btn.hidden = !can;
  if (!can || !btn) return;

  const setFsIcon = () => {
    if (!btn) return;
    const inFs = !!getFullscreenElement();
    btn.setAttribute("aria-label", inFs ? "Exit full screen" : "Full screen");
    const full = btn.querySelector(".icon-full");
    const exit = btn.querySelector(".icon-exit");
    if (full) full.toggleAttribute("hidden", inFs);
    if (exit) exit.toggleAttribute("hidden", !inFs);
  };

  setFsIcon();
  document.addEventListener("fullscreenchange", setFsIcon);
  document.addEventListener("webkitfullscreenchange", setFsIcon);

  const goFs = (enter) => {
    const d = document.documentElement;
    if (enter) {
      const p = d.requestFullscreen?.call(d) || d.webkitRequestFullscreen?.call(d);
      return p && typeof p.then === "function" ? p : Promise.resolve();
    }
    return (document.exitFullscreen?.() || document.webkitExitFullscreen?.() || Promise.resolve());
  };

  on(btn, "click", (e) => {
    e.preventDefault();
    goFs(!getFullscreenElement());
    pingDock();
  });
}

function wireFirstInteractionFullscreen() {
  const d = document.documentElement;
  const canRequest = !!(d.requestFullscreen || d.webkitRequestFullscreen);
  const enabled =
    document.fullscreenEnabled !== false
    && (document.webkitFullscreenEnabled !== false
      || typeof document.webkitFullscreenEnabled === "undefined");
  if (!canRequest || !enabled) return;
  const once = () => {
    if (getFullscreenElement()) return;
    d.requestFullscreen?.() || d.webkitRequestFullscreen?.();
  };
  document.addEventListener("pointerdown", once, { once: true, capture: true });
}

function wireIdleCursor() {
  const IDLE = 4000;
  let timer = 0;
  const wake = () => {
    document.documentElement.classList.remove("cursor-hidden");
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => {
      document.documentElement.classList.add("cursor-hidden");
    }, IDLE);
  };
  on(document, "pointermove", wake, { passive: true });
  on(document, "pointerdown", wake, { passive: true });
  on(document, "keydown", wake);
  wake();
}

function wireKeyboardNav() {
  document.addEventListener("keydown", (e) => {
    if ($("settingsSheet")?.classList.contains("open")) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      navigateTo("home");
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (getPrefs().liteMode) return;
    const t = e.target;
    if (t && t.closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    const order = FRAMES.map((f) => f.key);
    const i = order.indexOf(state.currentFrame);
    if (i < 0) return;
    const n = e.key === "ArrowRight" ? (i + 1) % order.length : (i - 1 + order.length) % order.length;
    navigateTo(order[n]);
  });
}



function updateDockClock() {
  const now = new Date();
  const f = format12hour(now);
  const time = $("dockTime");
  if (time) time.textContent = `${f.h}:${f.m}`;
  const wxEl = $("dockWeather");
  const wx = state.weather;
  if (wxEl && wx?.current) {
    const t = Math.round(wx.current.temperature_2m || 0);
    wxEl.textContent = `${t}° · ${state.homeLocation?.shortName || state.homeLocation?.name || ""}`;
  } else if (wxEl) {
    wxEl.textContent = state.homeLocation?.shortName || state.homeLocation?.name || "";
  }
}

function wireWeatherFx() {
  // Start FX for the current weather state (if already loaded)
  const cat = state.weather?.category;
  if (cat) startWeatherFx(cat);

  // React to weather changes
  window.addEventListener("weather-change", (e) => {
    const category = e.detail?.category;
    if (category) {
      startWeatherFx(category);
      applyAmbientFx(); // Refresh ambient effects on weather change
    }
  });

  // React to overlay and Lite mode preference changes
  window.addEventListener("prefs-change", (e) => {
    const key = e.detail?.key;
    if (key === "overlayFx") {
      applyAmbientFx();
    } else if (key === "liteMode") {
      applyLiteMode(!!e.detail.value);
    }
  });
}

function applyLiteMode(lite) {
  document.documentElement.classList.toggle("lite-mode", lite);
  $("app")?.classList.toggle("lite-mode", lite);
  if (lite) {
    stopWorldClocks();
    leavePhotosFrame();
    stopDriveRunner();
    if (state.currentFrame !== "home") {
      navigateTo("home", { silent: true });
    }
  } else if (!DEBUG.mockHome) {
    startDriveRunner();
  }
  applyAmbientFx();
}

function applyAmbientFx() {
  const layer = $("ambientLayer");
  if (!layer) return;

  // Clear all FX classes
  layer.className = "ambient-layer";

  const prefs = getPrefs();
  if (!prefs.overlayFx) return;

  const loc = state.homeLocation;
  const now = new Date();
  const tod = loc ? classifyTimeOfDay(now, loc.lat, loc.lon) : "day";
  const weather = state.weather?.category || "clear-warm";

  // Vignette is always on when overlays are enabled (very subtle)
  layer.classList.add("fx-vignette");

  // Time-of-day based effects (skip heavy SVG feTurbulence grain in Lite mode)
  if (tod === "night" || tod === "lateNight") {
    layer.classList.add("fx-particles");
    if (!prefs.liteMode) layer.classList.add("fx-grain");
  } else if (tod === "golden" || tod === "dusk") {
    layer.classList.add("fx-bokeh");
  } else if (tod === "dawn" || tod === "morning") {
    layer.classList.add("fx-flare");
  }

  // Add grain for cozy/rainy weather at any time (full mode only)
  if (!prefs.liteMode && ["drizzle", "rain-steady", "fog"].includes(weather)) {
    layer.classList.add("fx-grain");
  }
}
