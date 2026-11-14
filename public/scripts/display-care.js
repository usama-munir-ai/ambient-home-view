// Display care for an always-on wall screen:
//  - Night dimming via a black overlay (cheaper than filter: brightness() on
//    the whole tree, which old Portal Chromium composites badly).
//  - Pixel shift: ±1 CSS px drift of #app every 90s (2-3 physical px at
//    2.5 DPR) to spread static UI across pixels and resist burn-in.

import { $ } from "./util.js";
import { state } from "./state.js";
import { classifyTimeOfDay } from "./time.js";
import { getPrefs } from "./prefs.js";
import { DEBUG } from "./debug.js";

const DIM_LEVELS = Object.freeze({
  lateNight: 0.32,
  night: 0.18,
  dusk: 0.06,
  golden: 0.03,
});

const SHIFT_PATH = [
  [0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [-1, 0], [-1, -1], [0, -1],
];
const SHIFT_MS = 90 * 1000;

let shiftIndex = 0;

function applyDim() {
  const overlay = $("dimOverlay");
  if (!overlay) return;
  if (DEBUG.dimOff || !getPrefs().nightDim) {
    overlay.style.opacity = "0";
    return;
  }
  const loc = state.homeLocation;
  const tod = loc ? classifyTimeOfDay(new Date(), loc.lat, loc.lon) : classifyTimeOfDay(new Date(), 41, 0);
  overlay.style.opacity = String(DIM_LEVELS[tod] || 0);
}

function stepShift() {
  if (DEBUG.shiftOff || getPrefs().liteMode) return;
  // Don't move the surface mid-interaction.
  if ($("settingsSheet")?.classList.contains("open")) return;
  const content = document.querySelector(".frame.active .frame-content");
  if (!content) return;
  shiftIndex = (shiftIndex + 1) % SHIFT_PATH.length;
  const [x, y] = SHIFT_PATH[shiftIndex];
  content.style.transform = x === 0 && y === 0 ? "" : `translate(${x}px, ${y}px)`;
}

export function startDisplayCare() {
  applyDim();
  setInterval(applyDim, 60 * 1000);
  window.addEventListener("prefs-change", (e) => {
    if (e.detail?.key === "nightDim") applyDim();
    if (e.detail?.key === "liteMode" && e.detail.value) {
      document.querySelectorAll(".frame-content").forEach((el) => {
        el.style.transform = "";
      });
    }
  });

  setInterval(stepShift, SHIFT_MS);

  // Verification hook (preview testing without waiting 90s).
  if (typeof window !== "undefined") {
    window.__displayCare = { step: stepShift, dim: applyDim };
  }
}
