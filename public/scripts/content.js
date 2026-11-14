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

function countryName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

/**
 * Use the visitor's own city (state.config.geo, from /api/config) so every
 * household sees its local time, weather and prayer times. Set
 * `"autoLocate": false` on `home` in dashboard-content.json to pin the
 * configured location instead. Call after loadConfig() and loadContent().
 */
export function applyVisitorLocation() {
  const home = state.content.home;
  const geo = state.config?.geo;
  if (!home || home.autoLocate === false || !geo) return;
  const lat = Number(geo.lat);
  const lon = Number(geo.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) return;
  const country = typeof geo.country === "string" && /^[A-Z]{2}$/.test(geo.country) ? countryName(geo.country) : "";
  const name = String(geo.name || geo.region || country || "").slice(0, 40);
  if (!name) return;
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  state.homeLocation = { name, shortName: name, country, lat, lon, tz: String(geo.tz || browserTz || home.tz) };
}
