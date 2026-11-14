// Loads /data/dashboard-content.json and normalizes it into state.content.

import { state } from "./state.js";

let pending = null;

export async function loadContent() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch("/data/dashboard-content.json", { cache: "no-store" });
      if (!res.ok) throw new Error("content fetch failed");
      const payload = await res.json();
      const home = payload.home || { name: "Makkah", lat: 21.4225, lon: 39.8262, tz: "Asia/Riyadh" };
      state.content.home = home;
      state.homeLocation = home;
      state.content.worldCities = Array.isArray(payload.worldCities) ? payload.worldCities : [];
      state.content.quoteLibrary = Array.isArray(payload.quoteLibrary) ? payload.quoteLibrary : [];
      state.content.ayahFallbacks = Array.isArray(payload.ayahFallbacks) ? payload.ayahFallbacks : [];
      state.content.surahContext = payload.surahContext || {};
    } catch (err) {
      console.warn("[content] using minimal defaults", err);
      state.content.home = { name: "Makkah", lat: 21.4225, lon: 39.8262, tz: "Asia/Riyadh" };
      state.homeLocation = state.content.home;
    }
    return state.content;
  })();
  return pending;
}
