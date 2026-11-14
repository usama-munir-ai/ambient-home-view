// Daily ayah — Alquran.cloud live daily fetch + expanded offline fallback pool.
// Automatically refreshes across midnight on always-on displays.

import { state } from "./state.js";
import { STORAGE } from "./constants.js";
import { $, todayKey, deterministicPick, readLS } from "./util.js";
import { DEBUG } from "./debug.js";

// 64 concise, deeply resonant Quranic verses (global ayah numbers 1..6236)
// so online devices get a rich year-round daily verse rotation from Alquran.cloud,
// while offline devices fall back to the 30 full verses in dashboard-content.json.
const CURATED_AYAH_NUMBERS = [
  159, 160, 193, 262, 293, 301, 432, 466, 483, 493,
  750, 910, 1156, 1206, 1329, 1560, 1735, 1757, 1998, 2019,
  2150, 2292, 2375, 2464, 2570, 2673, 2826, 2917, 3035, 3159,
  3339, 3408, 3430, 3518, 3695, 3765, 4111, 4198, 4248, 4315,
  4691, 4729, 4914, 4961, 5083, 5100, 5150, 5212, 5220, 5243,
  5503, 5591, 5999, 6082, 6084, 6095, 6096, 6106, 6177, 6222,
];

let loadedDayKey = "";

export function getDailyAyahFallback(key) {
  const list = state.content.ayahFallbacks || [];
  if (!list.length) return null;
  const base = deterministicPick(list, "ayah|" + key) || list[0];
  const offset = state.ayah.manualOffset || 0;
  if (!offset) return base;
  const idx = list.indexOf(base);
  const nextIdx = ((idx + offset) % list.length + list.length) % list.length;
  return list[nextIdx] || base;
}

function getTargetAyahNumber(key, fallback) {
  const offset = state.ayah.manualOffset || 0;
  if (!offset && fallback?.number) {
    // Mix between the expanded curated number pool and fallback pool by day key
    const pickedNum = deterministicPick(CURATED_AYAH_NUMBERS, "ayah-num|" + key);
    return pickedNum || fallback.number;
  }
  const baseNum = deterministicPick(CURATED_AYAH_NUMBERS, "ayah-num|" + key) || fallback?.number || 1735;
  const idx = Math.max(0, CURATED_AYAH_NUMBERS.indexOf(baseNum));
  const nextIdx = ((idx + offset) % CURATED_AYAH_NUMBERS.length + CURATED_AYAH_NUMBERS.length) % CURATED_AYAH_NUMBERS.length;
  return CURATED_AYAH_NUMBERS[nextIdx];
}

export function currentAyah() {
  return state.ayah.current || readLS(STORAGE.quranJson, null);
}

export function renderAyahFrame() {
  const ayah = currentAyah();
  const arabicEl = $("ayahArabic");
  const transEl = $("ayahTranslation");
  const capEl = $("ayahCap");
  const ctxEl = $("ayahContext");

  if (arabicEl || transEl || capEl || ctxEl) {
    if (!ayah) {
      if (arabicEl) arabicEl.textContent = "—";
      if (transEl) transEl.textContent = "—";
      if (capEl) capEl.textContent = "";
      if (ctxEl) ctxEl.textContent = "";
    } else {
      if (arabicEl) arabicEl.textContent = ayah.text || "";
      if (transEl) transEl.textContent = ayah.translation || "Translation unavailable.";
      const surah = ayah.surah?.englishName || "Quran";
      const cap = `${surah}${ayah.numberInSurah ? ` · Ayah ${ayah.numberInSurah}` : ""}`;
      if (capEl) capEl.textContent = cap;
      const ctx = state.content.surahContext?.[surah] || ayah.context || "";
      if (ctxEl) ctxEl.textContent = ctx;
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("wisdom-data-updated"));
  }
}

export async function loadDailyAyah(force = false) {
  const key = todayKey();
  loadedDayKey = key;
  const fallback = getDailyAyahFallback(key);
  const targetNumber = getTargetAyahNumber(key, fallback);

  if (!force && !state.ayah.manualOffset) {
    try {
      if (localStorage.getItem(STORAGE.quranDay) === key) {
        const cached = JSON.parse(localStorage.getItem(STORAGE.quranJson) || "null");
        if (cached && cached.number === targetNumber) {
          state.ayah.current = cached;
          renderAyahFrame();
          return;
        }
      }
    } catch { /* ignore */ }
  }

  if (!targetNumber || DEBUG.mockHome) {
    state.ayah.current = fallback || null;
    renderAyahFrame();
    return;
  }

  try {
    const [arabicRes, transRes] = await Promise.all([
      fetch(`https://api.alquran.cloud/v1/ayah/${targetNumber}/quran-uthmani`),
      fetch(`https://api.alquran.cloud/v1/ayah/${targetNumber}/en.sahih`),
    ]);
    if (!arabicRes.ok || !transRes.ok) throw new Error("ayah fetch failed");
    const [arabicJson, transJson] = await Promise.all([arabicRes.json(), transRes.json()]);
    const ayah = {
      number: arabicJson.data.number,
      numberInSurah: arabicJson.data.numberInSurah,
      surah: { englishName: arabicJson.data.surah?.englishName || fallback?.surah?.englishName || "Quran" },
      text: arabicJson.data.text || fallback?.text || "",
      translation: transJson.data.text || fallback?.translation || "Translation unavailable.",
      context: fallback?.context || "",
    };
    try {
      localStorage.setItem(STORAGE.quranDay, key);
      localStorage.setItem(STORAGE.quranJson, JSON.stringify(ayah));
    } catch { /* ignore */ }
    state.ayah.current = ayah;
  } catch (err) {
    console.warn("[quran] using fallback", err);
    const matchingFallback = (state.content.ayahFallbacks || []).find((a) => a.number === targetNumber) || fallback;
    state.ayah.current = matchingFallback;
    if (matchingFallback) {
      try {
        localStorage.setItem(STORAGE.quranDay, key);
        localStorage.setItem(STORAGE.quranJson, JSON.stringify(matchingFallback));
      } catch { /* ignore */ }
    }
  }
  renderAyahFrame();
}

export function checkDailyAyahRefresh() {
  const key = todayKey();
  if (key !== loadedDayKey) {
    state.ayah.manualOffset = 0;
    void loadDailyAyah();
  }
}

export function ayahManual(direction) {
  const list = state.content.ayahFallbacks || [];
  if (!list.length) return;
  state.ayah.manualOffset = (state.ayah.manualOffset || 0) + direction;
  const pick = getDailyAyahFallback(todayKey());
  if (pick) {
    state.ayah.current = pick;
    renderAyahFrame();
  }
  void loadDailyAyah(true);
}
