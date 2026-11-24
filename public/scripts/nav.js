// Frame navigation — toggles `.active` on .frame elements, syncs dock,
// and drives the ambient page rotator (Home → brief peek at secondary page → Home).

import { $$, $ } from "./util.js";
import { state, setFrame } from "./state.js";
import {
  PAGE_ROTATE_HOME_MS,
  PAGE_ROTATE_PEEK_MS,
  PAGE_ROTATE_IDLE_RETURN_MS,
} from "./constants.js";
import { highlightCurrentFrame, pingDock, flashFrameTitle } from "./dock.js";
import { onFrameEnter, onFrameLeave } from "./frame-hooks.js";
import { getPrefs } from "./prefs.js";
import { hasPhotosPicked } from "./photos.js";
import { photosEnabled } from "./config.js";

const PEEK_SEQUENCE = [
  { frame: "prayer" },
  { frame: "world" },
  { frame: "photos", requiresPhotos: true, dwellMs: 28000 },
];

let rotateTimer = null;
let peekIndex = 0;
let isPeeking = false;
let rotatorWired = false;

export function navigateTo(key, opts = {}) {
  const silent = !!opts.silent;

  if (getPrefs().liteMode && key !== "home") {
    return;
  }
  if (key === "photos" && !photosEnabled()) return;

  if (state.currentFrame === key) {
    if (!silent) {
      pingDock();
      resetPageRotator();
    }
    return;
  }

  const previous = state.currentFrame;
  setFrame(key);
  if (!silent) flashFrameTitle(key);

  $$(".frame").forEach((node) => {
    node.classList.toggle("active", node.dataset.frame === key);
  });

  highlightCurrentFrame(key);
  onFrameLeave(previous);
  onFrameEnter(key);

  if (!silent) {
    isPeeking = false;
    pingDock();
    resetPageRotator();
  }
}

export function wireFrameTriggers() {
  document.body.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-frame]");
    if (!trigger || !trigger.dataset.frame) return;
    navigateTo(trigger.dataset.frame);
  });
}

function nextPeekTarget() {
  const len = PEEK_SEQUENCE.length;
  for (let i = 0; i < len; i += 1) {
    const candidate = PEEK_SEQUENCE[peekIndex % len];
    peekIndex = (peekIndex + 1) % len;
    if (candidate.requiresPhotos && (!photosEnabled() || !hasPhotosPicked())) continue;
    return candidate;
  }
  return PEEK_SEQUENCE[0];
}

export function peekNextPage() {
  if (getPrefs().liteMode) return;
  if ($("settingsSheet")?.classList.contains("open")) {
    schedulePageRotator();
    return;
  }
  const target = nextPeekTarget();
  if (!target) return;

  isPeeking = true;
  navigateTo(target.frame, { silent: true });

  clearTimeout(rotateTimer);
  const dwell = target.dwellMs || PAGE_ROTATE_PEEK_MS;
  rotateTimer = setTimeout(() => {
    isPeeking = false;
    if ($("settingsSheet")?.classList.contains("open")) {
      schedulePageRotator();
      return;
    }
    navigateTo("home", { silent: true });
    schedulePageRotator();
  }, dwell);
}

function schedulePageRotator() {
  clearTimeout(rotateTimer);
  rotateTimer = null;

  const prefs = getPrefs();
  if (!prefs.pageRotation || prefs.liteMode) return;

  if ($("settingsSheet")?.classList.contains("open")) {
    rotateTimer = setTimeout(schedulePageRotator, 10000);
    return;
  }

  if (state.currentFrame === "home") {
    rotateTimer = setTimeout(peekNextPage, PAGE_ROTATE_HOME_MS);
  } else if (!isPeeking) {
    // User manually navigated to another frame; gently return to Home after idle.
    rotateTimer = setTimeout(() => {
      if ($("settingsSheet")?.classList.contains("open")) {
        schedulePageRotator();
        return;
      }
      navigateTo("home", { silent: true });
      schedulePageRotator();
    }, PAGE_ROTATE_IDLE_RETURN_MS);
  }
}

export function resetPageRotator() {
  isPeeking = false;
  schedulePageRotator();
}

export function startPageRotator() {
  if (!rotatorWired) {
    rotatorWired = true;
    ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
      document.addEventListener(evt, () => {
        resetPageRotator();
      }, { passive: true });
    });
    window.addEventListener("prefs-change", (e) => {
      if (e.detail?.key === "pageRotation") {
        if (!e.detail.value && isPeeking && state.currentFrame !== "home") {
          navigateTo("home", { silent: true });
        }
        resetPageRotator();
      } else if (e.detail?.key === "liteMode") {
        isPeeking = false;
        if (e.detail.value && state.currentFrame !== "home") {
          navigateTo("home", { silent: true });
        }
        resetPageRotator();
      }
    });
  }
  schedulePageRotator();

  if (typeof window !== "undefined") {
    window.__pageRotator = {
      peekNow: peekNextPage,
      returnHome: () => {
        isPeeking = false;
        navigateTo("home", { silent: true });
        schedulePageRotator();
      },
      reset: resetPageRotator,
    };
  }
}
