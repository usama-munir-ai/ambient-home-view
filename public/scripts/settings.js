// Settings sheet — photo folder scan, backgrounds, preference toggles, theme.

import { $, on } from "./util.js";
import { APP_VERSION } from "./constants.js";
import { state } from "./state.js";
import { syncPhotosUI } from "./photos.js";
import { syncDrivePhotos, getDriveSyncError } from "./drive.js";
import { getPrefs, setPref } from "./prefs.js";
import { currentTheme } from "./theme.js";
import { scheduleHide } from "./dock.js";
import {
  PRAYER_METHODS,
  PRAYER_SCHOOLS,
  PRAYER_LATITUDE_RULES,
  resolvedMethodLabel,
} from "./prayer.js";

let uptimeTimer = null;

function formatUptimeMs(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600) % 24;
  const d = Math.floor(s / 86400);
  if (d > 0) return `Running for ${d}d ${h}h ${m}m`;
  if (h > 0) return `Running for ${h}h ${m}m`;
  if (m > 0) return `Running for ${m}m ${s % 60}s`;
  return `Running for ${s}s`;
}

function updateUptimeLine() {
  const el = $("settingsUptime");
  if (!el) return;
  const t0 = state.bootedAt || Date.now();
  el.textContent = formatUptimeMs(Date.now() - t0);
}

function clearUptimeTimer() {
  if (uptimeTimer) {
    clearInterval(uptimeTimer);
    uptimeTimer = null;
  }
}

export function wireSettings() {
  const sheet = $("settingsSheet");
  on($("settingsBtn"), "click", () => openSettings());
  on($("settingsBackdrop"), "click", () => closeSettings());
  on($("settingsCloseBtn"), "click", () => closeSettings());

  on($("settingsScanBtn"), "click", () => {
    const desc = $("settingsPhotosDesc");
    if (desc) desc.textContent = "Scanning the photo folder…";
    syncDrivePhotos(true)
      .then((items) => {
        if (desc) desc.textContent = driveStatusLine(items.length);
        syncPhotosUI();
      })
      .catch(() => {
        if (desc) desc.textContent = driveStatusLine(0);
      });
  });

  // Preference toggle buttons (data-pref carries the prefs key).
  for (const id of [
    "settingsOverlayFxBtn",
    "settingsLiteModeBtn",
    "settingsPageRotateBtn",
    "settingsKenBurnsBtn",
    "settingsNightDimBtn",
  ]) {
    on($(id), "click", () => {
      const btn = $(id);
      const key = btn?.dataset.pref;
      if (!key) return;
      const next = !getPrefs()[key];
      setPref(key, next);
      btn.textContent = next ? "On" : "Off";
      btn.classList.toggle("muted", !next);
    });
  }

  wirePrayerSettings();

  // Close on escape (sub-view first, then the sheet)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !sheet.classList.contains("open")) return;
    if (sheet.dataset.view === "prayer") showSettingsView("main");
    else closeSettings();
  });
}

function fillSelect(el, options) {
  if (!el) return;
  el.innerHTML = options.map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
}

function wirePrayerSettings() {
  fillSelect($("prayerMethodSelect"), PRAYER_METHODS);
  fillSelect($("prayerSchoolSelect"), PRAYER_SCHOOLS);
  fillSelect($("prayerLatSelect"), PRAYER_LATITUDE_RULES);

  on($("settingsPrayerBtn"), "click", () => showSettingsView("prayer"));
  on($("settingsPrayerBackBtn"), "click", () => showSettingsView("main"));

  for (const [id, key] of [
    ["prayerMethodSelect", "prayerMethod"],
    ["prayerSchoolSelect", "prayerSchool"],
    ["prayerLatSelect", "prayerLatitude"],
  ]) {
    on($(id), "change", (e) => {
      setPref(key, e.target.value);
      syncPrayerSettings();
    });
  }
  window.addEventListener("prayer-change", syncPrayerSettings);
}

function showSettingsView(view) {
  $("settingsSheet").dataset.view = view;
  scheduleHide();
}

/** Reflect prayer prefs + the method the API resolved, on both views. */
function syncPrayerSettings() {
  const prefs = getPrefs();
  const sel = (id, v) => { const el = $(id); if (el) el.value = String(v); };
  sel("prayerMethodSelect", prefs.prayerMethod);
  sel("prayerSchoolSelect", prefs.prayerSchool);
  sel("prayerLatSelect", prefs.prayerLatitude);

  const method = PRAYER_METHODS.find((m) => m.id === prefs.prayerMethod);
  const school = PRAYER_SCHOOLS.find((x) => x.id === prefs.prayerSchool);
  const resolved = resolvedMethodLabel();
  const methodText = prefs.prayerMethod === "auto"
    ? (resolved ? `Auto · ${resolved}` : "Auto · by region")
    : (method?.label || prefs.prayerMethod);
  const desc = $("settingsPrayerDesc");
  if (desc) desc.textContent = `${methodText} · ${prefs.prayerSchool === "1" ? "Hanafi Asr" : "Standard Asr"}`;

  const note = $("settingsPrayerResolved");
  if (note) {
    const full = PRAYER_METHODS.find((m) => m.id === String(state.prayer.data?.meta?.method?.id ?? ""))?.full;
    note.textContent = state.prayer.status === "unavailable"
      ? "Prayer service unreachable — showing last known times."
      : full ? `In use: ${full}${school ? " · " + school.label : ""}` : "";
  }
}

/** Human status for the photos row, folding in the last sync error. */
function driveStatusLine(count) {
  const err = getDriveSyncError();
  if (err) {
    if (err.status === 501) return "Server isn't connected to the photo folder yet (set DRIVE_SA_JSON and DRIVE_FOLDER_ID in Cloudflare Pages).";
    if (err.status === 502) return "Photo folder unreachable — Google Drive returned an error.";
    return "Could not reach the photo service.";
  }
  if (count > 0) return `${count} photo${count === 1 ? "" : "s"} in the family folder.`;
  return "Folder is empty — save photos to it from your phone.";
}

export function openSettings() {
  $("settingsSheet").dataset.view = "main";
  syncSettings();
  syncPrayerSettings();
  clearUptimeTimer();
  updateUptimeLine();
  uptimeTimer = setInterval(updateUptimeLine, 1000);
  $("settingsSheet").classList.add("open");
}

export function closeSettings() {
  clearUptimeTimer();
  $("settingsSheet").classList.remove("open");
  scheduleHide();
}

function syncSettings() {
  // Reflect persisted preference states on the toggle buttons.
  const prefs = getPrefs();
  for (const [id, key] of [
    ["settingsOverlayFxBtn", "overlayFx"],
    ["settingsLiteModeBtn", "liteMode"],
    ["settingsPageRotateBtn", "pageRotation"],
    ["settingsKenBurnsBtn", "kenBurns"],
    ["settingsNightDimBtn", "nightDim"],
  ]) {
    const btn = $(id);
    if (btn) {
      btn.textContent = prefs[key] ? "On" : "Off";
      btn.classList.toggle("muted", !prefs[key]);
    }
  }

  const img = state.splash?.lastByFrame?.[state.currentFrame] || state.splash?.lastByFrame?.home;
  const credit = $("settingsWallpaperDesc");
  if (credit) {
    credit.textContent = img?.credit
      ? `Wallpaper: ${img.credit}${img.license && !img.credit.includes(img.license) ? " · " + img.license : ""}`
      : "Wallpaper: curated gradient";
  }

  const theme = currentTheme();
  $("settingsThemeLabel").textContent = theme === "light" ? "Day · light"
    : theme === "golden" ? "Golden hour"
    : "Night · dark";

  const ver = $("settingsVersion");
  if (ver) {
    ver.textContent = `Ambient Home View · ${APP_VERSION}`;
  }
  updateUptimeLine();
}
