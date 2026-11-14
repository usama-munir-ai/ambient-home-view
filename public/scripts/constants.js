// Application constants. No environment-dependent values here —
// secrets and provider config come from /api/config.
//
// This app holds NO Google credentials in the browser: family photos come
// from the server-side service-account endpoint (/api/photos).

export const APP_VERSION = "ambient-1.0";

export const STORAGE = Object.freeze({
  driveItems: "portal_drive_items_v1",
  prefs: "portal_prefs_v1",
  quranDay: "quran_day_v4",
  quranJson: "quran_json_v4",
  prayer: "portal_prayer_v1",
  weather: "portal_weather_v1",
  splashHistory: "portal_splash_history_v1",
});

export const FRAMES = [
  { key: "home", title: "Home", icon: "home" },
  { key: "prayer", title: "Prayer", icon: "prayer" },
  { key: "world", title: "World", icon: "world" },
  { key: "photos", title: "Photos", icon: "photos" },
];

// Cadences (ms)
export const TICK_MS = 1000;
export const SIDEBAR_DWELL_MS = 90 * 1000;        // 90s per wisdom mode rotation
export const SPLASH_ROTATE_MS = 10 * 60 * 1000;   // 10 minutes per splash image (default)
export const PRAYER_REFRESH_MS = 5 * 60 * 1000;
export const WEATHER_REFRESH_MS = 10 * 60 * 1000;

/**
 * Adaptive splash rotation cadence. Returns ms between wallpaper swaps.
 * Active weather → 3–5 min, transition periods → 5–7 min, stable → 8–12 min.
 */
export function getSplashRotateMs(weatherCategory, timeOfDay) {
  // Active weather — faster rotation to match dynamic conditions
  const activeWeather = ["rain-steady", "rain-torrential", "drizzle", "snow-light", "snow-heavy", "thunderstorm", "fog"];
  if (activeWeather.includes(weatherCategory)) {
    return (3 + Math.random() * 2) * 60 * 1000; // 3–5 min
  }
  // Transition periods — mood shifts fast
  const transitions = ["dawn", "golden", "dusk"];
  if (transitions.includes(timeOfDay)) {
    return (5 + Math.random() * 2) * 60 * 1000; // 5–7 min
  }
  // Stable conditions
  return (8 + Math.random() * 4) * 60 * 1000; // 8–12 min
}
export const PHOTO_SLIDE_MS = 12000;
export const DOCK_IDLE_MS = 6000;

// Ambient page rotation: Home briefly visits one secondary page and returns
export const PAGE_ROTATE_HOME_MS = 3 * 60 * 1000;        // 3 min on Home between peeks
export const PAGE_ROTATE_PEEK_MS = 24 * 1000;            // 24s brief visit to other page
export const PAGE_ROTATE_IDLE_RETURN_MS = 90 * 1000;     // 90s idle return after manual nav

// Family-photos sync cadence (client re-list of /api/photos)
export const DRIVE_REFRESH_MS = 45 * 60 * 1000;
