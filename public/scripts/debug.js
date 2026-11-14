// Debug/preview overrides, driven by URL query params. No-ops in normal use.
//
//   ?wx=thunderstorm   force weather category (any classifyWeather output)
//   ?tod=night         force time-of-day bucket (classifyTimeOfDay output)
//   ?season=autumn     force season
//   ?mock=photos       seed fake Drive photo items + treat Photos as authed
//   ?dim=off           disable night dimming
//   ?shift=off         disable pixel-shift
//
// Imported first by app.js so overrides are in place before any runner starts.

import { STORAGE } from "./constants.js";

const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");

export const DEBUG = Object.freeze({
  wx: params.get("wx") || "",
  tod: params.get("tod") || "",
  season: params.get("season") || "",
  splash: params.get("splash") || "",
  mockPhotos: params.get("mock") === "photos",
  mockHome: params.get("mock") === "home",
  dimOff: params.get("dim") === "off",
  shiftOff: params.get("shift") === "off",
});

export function isDebugActive() {
  return !!(DEBUG.wx || DEBUG.tod || DEBUG.season || DEBUG.splash || DEBUG.mockPhotos || DEBUG.mockHome || DEBUG.dimOff || DEBUG.shiftOff);
}

if (DEBUG.mockHome) {
  try {
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const baseHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
    const times = [];
    const temps = [10, 9, 9, 8, 7, 7, 6, 6];
    const codes = [3, 3, 2, 2, 1, 1, 0, 0];
    for (let i = 0; i < 8; i += 1) {
      const d = new Date(baseHour.getTime() + (i + 1) * 3600000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:00`;
      times.push(iso);
    }
    localStorage.setItem(STORAGE.weather, JSON.stringify({
      savedAt: Date.now(),
      timezone: "Europe/London",
      current: { temperature_2m: 11, weather_code: 3, cloud_cover: 88, is_day: 0 },
      daily: { temperature_2m_max: [17], temperature_2m_min: [6], weather_code: [3] },
      hourly: { time: times, temperature_2m: temps, weather_code: codes, precipitation_probability: [10, 10, 5, 5, 0, 0, 0, 0] },
    }));
    const in14 = new Date(now.getTime() + 14 * 60000);
    const ishaStr = `${String(in14.getHours()).padStart(2, "0")}:${String(in14.getMinutes()).padStart(2, "0")}`;
    localStorage.setItem(STORAGE.prayer, JSON.stringify({
      dateKey,
      data: {
        timings: {
          Fajr: "05:48",
          Sunrise: "07:08",
          Dhuhr: "12:04",
          Asr: "14:52",
          Maghrib: "17:20",
          Isha: ishaStr,
        },
        date: {
          hijri: {
            day: "21",
            year: "1448",
            month: { number: 5, en: "Jumādā al-Ūlā" },
          },
        },
      },
    }));
  } catch { /* ignore */ }
}

// Seed mock Drive items so the Photos frame and cinematics can be exercised
// without Google auth (picsum URLs lack the =sNNN suffix, which drivePhotoUrl
// tolerates by returning the link unchanged).
if (DEBUG.mockPhotos) {
  const items = [];
  for (let n = 1; n <= 8; n += 1) {
    const portrait = n >= 4; // 3 landscape + 5 portrait → pairs + one solo
    const w = portrait ? 800 : 1280;
    const h = portrait ? 1200 : 800;
    items.push({
      id: "mock-" + n,
      name: "mock-" + n + ".jpg",
      mimeType: "image/jpeg",
      thumbnailLink: `https://picsum.photos/seed/portal${n}/${w}/${h}`,
      createdTime: new Date(2024, n - 1, 10).toISOString(),
      imageMediaMetadata: { time: "2024:0" + Math.min(n, 9) + ":10 12:00:00", width: w, height: h },
    });
  }
  try {
    localStorage.setItem(STORAGE.driveItems, JSON.stringify({
      syncedAt: Date.now(),
      folderId: "mock-folder",
      items,
    }));
  } catch { /* ignore */ }
}
