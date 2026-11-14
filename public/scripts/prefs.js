// User preferences — persisted in localStorage, defaults applied on read.
// Consumers listen for the "prefs-change" CustomEvent to react live.

import { STORAGE } from "./constants.js";
import { readLS, writeLS } from "./util.js";

const DEFAULTS = Object.freeze({
  overlayFx: true,    // weather particles (rain, snow, leaves, etc.) + ambient overlays
  liteMode: false,    // Home-only mode with TV/Chromecast performance optimizations
  pageRotation: true, // briefly preview other pages from Home and return
  aiScenes: true,     // cozy AI-generated weather scenes in the splash pool
  nightDim: true,     // dim the display late at night
  kenBurns: true,     // slow pan/zoom on the photo slideshow
  prayerMethod: "auto",   // Aladhan method id, or "auto" = regional default
  prayerSchool: "0",      // Asr: "0" standard (Shafi'i/Maliki/Hanbali), "1" Hanafi
  prayerLatitude: "auto", // high-latitude rule: "auto" | "1" | "2" | "3"
});

export function getPrefs() {
  const stored = readLS(STORAGE.prefs, null);
  return { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
}

export function setPref(key, value) {
  const next = { ...getPrefs(), [key]: value };
  writeLS(STORAGE.prefs, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("prefs-change", { detail: { key, value, prefs: next } }));
  }
  return next;
}
