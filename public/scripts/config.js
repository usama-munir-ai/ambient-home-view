// Loads `/api/config` (server-side env config: media provider flags).

import { state } from "./state.js";
import { DEBUG } from "./debug.js";

/** True when this deployment offers the Photos page (set by /api/config). */
export function photosEnabled() {
  return DEBUG.mockPhotos || state.config.photosEnabled === true;
}

export async function loadConfig() {
  // 2s timeout so a hanging /api/config (e.g. under static `serve`) can't
  // block boot — splash needs to fade in even when the API is unreachable.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch("/api/config", { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error("config fetch failed");
    const payload = await res.json();
    Object.assign(state.config, payload || {});
  } catch (err) {
    console.warn("[config] fetch failed; using defaults", err);
  } finally {
    clearTimeout(timer);
  }
  return state.config;
}
