// Open-Meteo client. Cache + classify + render.

import { state, locationKey } from "./state.js";
import { STORAGE, WEATHER_REFRESH_MS } from "./constants.js";
import { readLS, writeLS } from "./util.js";
import { renderHomeMeta } from "./home.js";
import { DEBUG } from "./debug.js";

let timer = null;

/** Category for the given conditions, honoring the ?wx= debug override. */
function resolveCategory(current) {
  return DEBUG.wx || classifyWeather(current);
}

// Note: Open-Meteo's grid model can miss short-lived localized thunderstorms;
// the heuristic below catches obviously convective conditions even when the
// upstream weather_code stays at plain rain. The authoritative US source for
// active storms is the NWS Alerts API — see refreshNwsAlerts() below.
export function classifyWeather(current) {
  if (!current) return "clear-warm";
  const code = Number(current.weather_code || 0);
  const temp = Number(current.temperature_2m || 0);
  const precip = Number(current.precipitation || 0);
  const rain = Number(current.rain || current.showers || 0);
  const snow = Number(current.snowfall || 0);
  const cloud = Number(current.cloud_cover || 0);
  const wind = Number(current.wind_speed_10m || 0);
  const gusts = Number(current.wind_gusts_10m || 0);

  if (code === 95 || code === 96 || code === 99) return "thunderstorm";
  // Heuristic safety net: heavy rain + strong gusts + nearly overcast → treat as thunderstorm.
  if (precip >= 4 && Math.max(gusts, wind) >= 35 && cloud >= 85) return "thunderstorm";
  if (snow >= 1.6 || code === 75 || code === 86) return "snow-heavy";
  if (snow > 0 || code === 71 || code === 73 || code === 77 || code === 85) return "snow-light";
  if (precip >= 8 || rain >= 7 || code === 82 || (code >= 61 && code <= 67 && wind >= 28)) return "rain-torrential";
  if (precip >= 1.2 || rain >= 1 || [61, 63, 65, 67, 80, 81].includes(code)) return "rain-steady";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (temp >= 33 && current.is_day) return "heat";
  if (cloud >= 82 || code === 3) return "overcast";
  if (cloud >= 35 || code === 2 || code === 1) return "partly-cloudy";
  if (temp <= 6) return "clear-cold";
  return "clear-warm";
}

export function loadCachedWeather() {
  const cached = readLS(STORAGE.weather, null);
  if (!cached || !cached.current) return false;
  if (Date.now() - (cached.savedAt || 0) > 6 * 60 * 60 * 1000) return false;
  if (cached.loc && cached.loc !== locationKey()) return false;

  state.weather.current = cached.current;
  state.weather.daily = cached.daily || null;
  state.weather.hourly = cached.hourly || null;
  state.weather.timezone = cached.timezone || state.homeLocation?.tz || "";
  state.weather.air = cached.air || null;
  state.weather.category = resolveCategory(cached.current);
  state.weather.status = "cached";

  renderHomeMeta();
  dispatchWeatherChange();
  return true;
}

// Active alert events from the NWS that we treat as a thunderstorm override.
// "Severe Thunderstorm Watch" is included because the watch state is itself
// strongly correlated with convective cells passing overhead.
const NWS_STORM_EVENTS = new Set([
  "Severe Thunderstorm Warning",
  "Severe Thunderstorm Watch",
  "Tornado Warning",
  "Tornado Watch",
  "Flash Flood Warning",
]);

// NWS only covers the United States; elsewhere the request would just send
// the home coordinates to a service that cannot answer.
function inNwsCoverage(loc) {
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  return lat >= 13 && lat <= 72 && (lon <= -64 || lon >= 144);
}

export async function refreshNwsAlerts() {
  const loc = state.homeLocation;
  if (!loc || !inNwsCoverage(loc)) return;

  const url = `https://api.weather.gov/alerts/active?point=${loc.lat},${loc.lon}`;
  try {
    const res = await fetch(url, {
      headers: {
        // NWS rejects requests without a User-Agent identifying the app.
        "User-Agent": "ambient-home-view (github.com/usama-munir-ai/ambient-home-view)",
        "Accept": "application/geo+json",
      },
    });
    if (!res.ok) throw new Error(`nws alerts ${res.status}`);
    const payload = await res.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const events = features
      .map((f) => f?.properties?.event)
      .filter((e) => typeof e === "string");
    const activeStorm = events.some((e) => NWS_STORM_EVENTS.has(e));

    state.weather.alerts = {
      activeStorm,
      items: features.map((f) => ({
        event: f?.properties?.event || "",
        severity: f?.properties?.severity || "",
        headline: f?.properties?.headline || "",
        expires: f?.properties?.expires || "",
      })),
      status: "ready",
    };
  } catch (err) {
    // Don't escalate: the Open-Meteo + heuristic path is still in play.
    state.weather.alerts = state.weather.alerts || { activeStorm: false, items: [] };
    state.weather.alerts.status = "unavailable";
    console.warn("[weather-alerts]", err);
  }
}

/**
 * Open-Meteo's free air-quality endpoint (keyless, separate host).
 * Updates state.weather.air and folds it into the cached weather payload.
 */
export async function refreshAirQuality() {
  const loc = state.homeLocation;
  if (!loc) return;

  const url = "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${loc.lat}&longitude=${loc.lon}` +
    "&current=us_aqi,pm2_5";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`air quality ${res.status}`);
    const payload = await res.json();
    const usAqi = Number(payload?.current?.us_aqi);
    const pm25 = Number(payload?.current?.pm2_5);
    if (!Number.isFinite(usAqi)) throw new Error("air quality payload empty");
    state.weather.air = { usAqi: Math.round(usAqi), pm25: Number.isFinite(pm25) ? pm25 : null, savedAt: Date.now() };
  } catch (err) {
    console.warn("[air-quality]", err);
  }
}

export async function refreshWeather() {
  const loc = state.homeLocation;
  if (!loc) return;

  const timezone = loc.tz || "auto";
  const url = "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${loc.lat}&longitude=${loc.lon}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,precipitation,rain,showers,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m,uv_index" +
    "&hourly=temperature_2m,precipitation,precipitation_probability,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max" +
    "&past_hours=3&forecast_hours=12" +
    "&temperature_unit=celsius&wind_speed_unit=kmh" +
    `&timezone=${encodeURIComponent(timezone)}`;

  // Fire NWS alerts + air quality in parallel — one failing must not abort the others.
  const alertsPromise = refreshNwsAlerts();
  const airPromise = refreshAirQuality();

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("weather request failed");
    const payload = await res.json();
    if (!payload?.current) throw new Error("weather payload empty");

    state.weather.current = payload.current;
    state.weather.daily = payload.daily || null;
    state.weather.hourly = payload.hourly || null;
    state.weather.timezone = payload.timezone || loc.tz || "";
    state.weather.category = resolveCategory(payload.current);
    state.weather.status = "ready";

    writeLS(STORAGE.weather, {
      savedAt: Date.now(),
      loc: locationKey(),
      current: payload.current,
      daily: payload.daily || null,
      hourly: payload.hourly || null,
      timezone: payload.timezone || loc.tz || "",
    });
  } catch (err) {
    if (!state.weather.current) state.weather.status = "unavailable";
    console.warn("[weather]", err);
  }

  // Debug override must hold even when the fetch failed and no cache exists.
  if (DEBUG.wx) state.weather.category = DEBUG.wx;

  await alertsPromise;
  await airPromise;

  // Fold air quality into the just-written cache (after, so a slow AQI fetch
  // can never clobber the fresh weather payload with a stale snapshot).
  if (state.weather.air) {
    const cached = readLS(STORAGE.weather, null);
    if (cached) {
      cached.air = state.weather.air;
      writeLS(STORAGE.weather, cached);
    }
  }
  renderHomeMeta();
  dispatchWeatherChange();
}

function dispatchWeatherChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("weather-change", {
      detail: {
        category: state.weather.category,
        current: state.weather.current,
        daily: state.weather.daily,
        timezone: state.weather.timezone,
      },
    }));
  }
}

export function startWeatherRunner() {
  if (DEBUG.mockHome) return;
  refreshWeather();
  if (timer) clearInterval(timer);
  timer = setInterval(refreshWeather, WEATHER_REFRESH_MS);
}
