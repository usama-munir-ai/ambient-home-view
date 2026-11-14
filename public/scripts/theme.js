// Solar-driven theme. No user toggle. No localStorage persistence.
// Reads home location from state and computes a theme key based on time-of-day.

import { state } from "./state.js";
import { classifyTimeOfDay } from "./time.js";

let lastApplied = null;
let timer = null;

export function startThemeRunner() {
  apply();
  // Re-evaluate every minute. Theme transitions are smoothed by CSS color-transition.
  if (timer) clearInterval(timer);
  timer = setInterval(apply, 60 * 1000);
}

function apply() {
  const loc = state.homeLocation;
  if (!loc) return;
  const tod = classifyTimeOfDay(new Date(), loc.lat, loc.lon);
  const theme = themeFromTimeOfDay(tod);
  if (theme === lastApplied) return;
  lastApplied = theme;
  document.documentElement.setAttribute("data-theme", theme);
}

function themeFromTimeOfDay(tod) {
  switch (tod) {
    case "morning":
    case "day":
      return "light";
    case "golden":
    case "dusk":
      return "golden";
    default:
      return "dark";
  }
}

export function currentTheme() {
  return lastApplied || document.documentElement.getAttribute("data-theme") || "dark";
}
