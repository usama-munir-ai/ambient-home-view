// Prayer times — Aladhan API + cache + render to prayer frame.

import { state } from "./state.js";
import { STORAGE, PRAYER_REFRESH_MS } from "./constants.js";
import { readLS, writeLS, todayKey, $ } from "./util.js";
import { format12hour, formatHms, parsePrayerTime } from "./time.js";
import { getActiveHoliday } from "./holidays.js";
import { renderHomeMeta } from "./home.js";
import { DEBUG } from "./debug.js";
import { getPrefs } from "./prefs.js";

/** Aladhan calculation methods — id, short label (menu), full authority. */
export const PRAYER_METHODS = Object.freeze([
  { id: "auto", label: "Auto · by region", full: "Regional default for your location" },
  { id: "3", label: "Muslim World League", full: "Muslim World League" },
  { id: "2", label: "ISNA · North America", full: "Islamic Society of North America" },
  { id: "5", label: "Egyptian Authority", full: "Egyptian General Authority of Survey" },
  { id: "4", label: "Umm al-Qura · Makkah", full: "Umm al-Qura University, Makkah" },
  { id: "1", label: "Karachi", full: "University of Islamic Sciences, Karachi" },
  { id: "15", label: "Moonsighting Committee", full: "Moonsighting Committee Worldwide" },
  { id: "13", label: "Diyanet · Türkiye", full: "Diyanet İşleri Başkanlığı, Türkiye" },
  { id: "8", label: "Gulf Region", full: "Gulf Region" },
  { id: "16", label: "Dubai", full: "Dubai" },
  { id: "9", label: "Kuwait", full: "Kuwait" },
  { id: "10", label: "Qatar", full: "Qatar" },
  { id: "23", label: "Jordan · Awqaf", full: "Ministry of Awqaf, Jordan" },
  { id: "12", label: "UOIF · France", full: "Union des Organisations Islamiques de France" },
  { id: "22", label: "Lisbon", full: "Comunidade Islâmica de Lisboa" },
  { id: "14", label: "Russia", full: "Spiritual Administration of Muslims of Russia" },
  { id: "11", label: "MUIS · Singapore", full: "Majlis Ugama Islam Singapura" },
  { id: "17", label: "JAKIM · Malaysia", full: "Jabatan Kemajuan Islam Malaysia" },
  { id: "20", label: "Kemenag · Indonesia", full: "Kementerian Agama Republik Indonesia" },
  { id: "21", label: "Morocco", full: "Morocco" },
  { id: "19", label: "Algeria", full: "Algeria" },
  { id: "18", label: "Tunisia", full: "Tunisia" },
  { id: "7", label: "Tehran · Geophysics", full: "Institute of Geophysics, University of Tehran" },
  { id: "0", label: "Shia Ithna-Ashari · Qum", full: "Leva Institute, Qum" },
]);

export const PRAYER_SCHOOLS = Object.freeze([
  { id: "0", label: "Standard · Shafi'i, Maliki, Hanbali" },
  { id: "1", label: "Hanafi · later Asr" },
]);

export const PRAYER_LATITUDE_RULES = Object.freeze([
  { id: "auto", label: "Auto" },
  { id: "3", label: "Angle-based" },
  { id: "1", label: "Middle of the night" },
  { id: "2", label: "One-seventh of the night" },
]);

/** Query-string fragment for the current calculation prefs (also the cache key). */
export function prayerParams(prefs = getPrefs()) {
  const parts = [];
  if (prefs.prayerMethod !== "auto") parts.push("method=" + encodeURIComponent(prefs.prayerMethod));
  if (prefs.prayerSchool !== "0") parts.push("school=" + encodeURIComponent(prefs.prayerSchool));
  if (prefs.prayerLatitude !== "auto") parts.push("latitudeAdjustmentMethod=" + encodeURIComponent(prefs.prayerLatitude));
  return parts.join("&");
}

/** Short label of the method the API actually used (resolves "auto"). */
export function resolvedMethodLabel() {
  const id = String(state.prayer.data?.meta?.method?.id ?? "");
  const found = PRAYER_METHODS.find((m) => m.id === id);
  return found ? found.label : (state.prayer.data?.meta?.method?.name || "");
}

const PRAYER_NAMES = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];

const PRAYER_ICONS = {
  Fajr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v1"/><path d="M5.6 7l.7.7"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m17.7 7.7.7-.7"/><path d="M17 12a5 5 0 0 0-10 0"/><path d="M3 17h18"/></svg>',
  Sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M5 9l1 1"/><path d="M19 9l-1 1"/><path d="M2 13h2"/><path d="M20 13h2"/><path d="M17 13a5 5 0 0 0-10 0"/><path d="M3 17h18"/></svg>',
  Dhuhr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M5 5l1.4 1.4"/><path d="M17.6 17.6 19 19"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M5 19l1.4-1.4"/><path d="M17.6 6.4 19 5"/></svg>',
  Asr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 4v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M5 5l1.4 1.4"/></svg>',
  Maghrib: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12V2"/><path d="M5.6 7l.7.7"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m17.7 7.7.7-.7"/><path d="M17 12a5 5 0 0 0-10 0"/><path d="M3 16h18"/><path d="M3 20h18"/></svg>',
  Isha: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7.5 7.5 0 0 0 9.8 9.8z"/></svg>',
};

let timer = null;
let lastPrayerRefresh = 0;

export function loadCachedPrayer() {
  const cached = readLS(STORAGE.prayer, null);
  if (!cached || !cached.data || cached.dateKey !== todayKey()) return false;
  if ((cached.params || "") !== prayerParams()) return false;
  state.prayer.data = cached.data;
  state.prayer.status = "cached";
  renderPrayerFrame();
  renderHomeMeta();
  return true;
}

export async function refreshPrayer() {
  const loc = state.homeLocation;
  if (!loc) return;
  const now = new Date();
  const dateString = String(now.getDate()).padStart(2, "0") + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" + now.getFullYear();
  const params = prayerParams();
  const url = `https://api.aladhan.com/v1/timings/${dateString}?latitude=${loc.lat}&longitude=${loc.lon}` +
    (params ? "&" + params : "");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("prayer request failed");
    const payload = await res.json();
    if (!payload?.data?.timings) throw new Error("payload missing timings");
    state.prayer.data = payload.data;
    state.prayer.status = "ready";
    writeLS(STORAGE.prayer, { dateKey: todayKey(), params, data: payload.data });
    window.dispatchEvent(new CustomEvent("prayer-change"));
  } catch (err) {
    if (!state.prayer.data) state.prayer.status = "unavailable";
    console.warn("[prayer]", err);
  }
  renderPrayerFrame();
  extractHijriDate();
  renderHomeMeta();
}

export function renderPrayerFrame() {
  const data = state.prayer.data;
  const now = new Date();

  const nowEl = $("prayerNowTime");
  if (nowEl) {
    const f = format12hour(now);
    nowEl.innerHTML = `${f.h}:${f.m}<span class="prayer-now-period">${f.period}</span>`;
  }

  if (!data?.timings) {
    $("prayerNextName").textContent = "—";
    $("prayerCountdownText").textContent = "loading";
    const big = $("prayerCountdown");
    if (big) big.classList.remove("prayer-countdown-now");
    $("prayerGreg").textContent = "";
    $("prayerHijri").textContent = "";
    $("prayerList").innerHTML = "";
    return;
  }

  const entries = PRAYER_NAMES.map((n) => [n, data.timings[n]]).filter((row) => row[1]);
  let activeIdx = -1;
  let nextIdx = -1;
  entries.forEach(([_, t], i) => {
    if (parsePrayerTime(t) <= now) activeIdx = i;
  });
  nextIdx = entries.length ? (activeIdx + 1) % entries.length : -1;

  // Hero countdown (formatHms handles <60s as "45s" and 0 as "now")
  const el = $("prayerCountdownText");
  const big = $("prayerCountdown");
  if (nextIdx >= 0) {
    let target = parsePrayerTime(entries[nextIdx][1]);
    if (target < now) target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
    const diff = formatHms(target - now);
    $("prayerNextName").textContent = entries[nextIdx][0];
    if (big) big.classList.toggle("prayer-countdown-now", !!diff.now);
    if (el) {
      if (diff.now) {
        el.textContent = "now";
      } else if (diff.h > 0) {
        el.innerHTML = `${diff.h}<span class="unit">h</span>${diff.m}<span class="unit">m</span>`;
      } else if (diff.secondsOnly) {
        el.innerHTML = `${diff.s}<span class="unit">s</span>`;
      } else {
        el.innerHTML = `${diff.m}<span class="unit">m</span>${diff.s > 0 ? `${diff.s}<span class="unit">s</span>` : ""}`;
      }
    }
  } else {
    if (big) big.classList.remove("prayer-countdown-now");
  }

  // Date line
  const greg = data.date?.readable || now.toLocaleDateString();
  const hijri = data.date?.hijri ? `${data.date.hijri.day} ${data.date.hijri.month.en} ${data.date.hijri.year}` : "";
  $("prayerGreg").textContent = greg;
  $("prayerHijri").textContent = hijri;

  // List
  $("prayerList").innerHTML = entries.map(([name, raw], i) => {
    const t = parsePrayerTime(raw);
    const f = format12hour(t);
    const cls = i === activeIdx ? "active" : i === nextIdx ? "next" : "";
    return `
      <div class="prayer-row ${cls}">
        <span class="prayer-icon">${PRAYER_ICONS[name] || ""}</span>
        <span class="prayer-name">${name}</span>
        <span class="prayer-time tabular">${f.h}:${f.m} ${f.period}</span>
      </div>
    `;
  }).join("");
}

export function startPrayerRunner() {
  loadCachedPrayer();
  if (DEBUG.mockHome) return;
  // Calculation prefs changed in Settings → refetch at once.
  window.addEventListener("prefs-change", (e) => {
    if (String(e.detail?.key || "").startsWith("prayer")) {
      lastPrayerRefresh = Date.now();
      refreshPrayer();
    }
  });
  refreshPrayer();
  lastPrayerRefresh = Date.now();
  if (timer) clearInterval(timer);
  // Only tick the Prayer frame DOM when the Prayer frame is actually visible;
  // still refresh the API on cadence so Home's Next Prayer pill stays live.
  timer = setInterval(() => {
    if (state.currentFrame === "prayer") {
      renderPrayerFrame();
    }
    if (Date.now() - lastPrayerRefresh >= PRAYER_REFRESH_MS) {
      lastPrayerRefresh = Date.now();
      refreshPrayer();
    }
  }, 1000);
}

function extractHijriDate() {
  try {
    const hijri = state.prayer.data?.date?.hijri;
    if (!hijri) return;
    const month = Number(hijri.month?.number || 0);
    const day = Number(hijri.day || 0);
    if (month && day) {
      state.hijriDate = { month, day, year: Number(hijri.year || 0) };
      state.activeHoliday = getActiveHoliday(new Date(), state.hijriDate);
    }
  } catch {
    /* silent */
  }
}
