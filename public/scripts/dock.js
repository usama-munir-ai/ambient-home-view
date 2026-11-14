// Dock — auto-show on activity; auto-hide after DOCK_IDLE_MS of inactivity.

import { $, $$, on } from "./util.js";
import { DOCK_IDLE_MS, FRAMES } from "./constants.js";
import { ICONS } from "./icons.js";
import { state } from "./state.js";
import { DEBUG } from "./debug.js";

let hideTimer = null;
let appShown = false;
let frameTitleFlashTimer = 0;

export function buildDock() {
  $("dockNav").innerHTML = FRAMES
    .filter((f) => f.key !== "home")
    .map((f) => `
      <button type="button" class="dock-nav-item" data-frame="${f.key}" aria-label="${f.title}">
        ${ICONS[f.icon]}
        <span>${f.title}</span>
      </button>
    `)
    .join("");
}

export function setDockVisible(visible) {
  document.getElementById("app").classList.toggle("dock-visible", visible);
}

export function pingDock() {
  if (!appShown) return;
  setDockVisible(true);
  scheduleHide();
}

export function scheduleHide() {
  clearTimeout(hideTimer);
  if ($("settingsSheet").classList.contains("open")) return;
  hideTimer = setTimeout(() => setDockVisible(false), DOCK_IDLE_MS);
}

export function appBecameVisible() {
  appShown = true;
  if (DEBUG.mockHome) {
    setDockVisible(false);
    return;
  }
  setDockVisible(true);
  scheduleHide();
}

export function highlightCurrentFrame(frameKey) {
  $$(".dock-nav-item").forEach((node) => {
    node.classList.toggle("active", node.dataset.frame === frameKey);
  });
  $$(".dock-button[data-frame]").forEach((node) => {
    node.classList.toggle("active", node.dataset.frame === frameKey);
  });
  const quoteActions = $("dockQuoteActions");
  if (quoteActions) quoteActions.classList.toggle("visible", frameKey === "wisdom");
}

export function wireDock() {
  // Activity that wakes the dock
  ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, pingDock, { passive: true });
  });

  document.addEventListener("pointermove", (event) => {
    if (event.clientY >= window.innerHeight - 36) pingDock();
  }, { passive: true });

  on($("bottomRevealZone"), "mouseenter", pingDock);
  on($("bottomRevealZone"), "click", pingDock);
  on($("portalDock"), "mouseenter", pingDock);
  on($("portalDock"), "mouseleave", scheduleHide);
}

export function frameTitle(key) {
  const f = FRAMES.find((x) => x.key === key);
  return f ? f.title : "Home View";
}

/**
 * Briefly show the frame name in the dock center for wayfinding.
 */
export function flashFrameTitle(key) {
  const el = document.getElementById("dockFrameTitle");
  if (!el) return;
  const title = frameTitle(key);
  el.textContent = title;
  el.setAttribute("aria-hidden", "false");
  el.classList.add("visible");
  if (frameTitleFlashTimer) clearTimeout(frameTitleFlashTimer);
  frameTitleFlashTimer = setTimeout(() => {
    el.classList.remove("visible");
    el.setAttribute("aria-hidden", "true");
  }, 1400);
}
