// Ambient Wisdom & Ayah presenter — renders the Daily Ayah and rotating Quotes
// directly onto the Home clock screen (#homeWisdom) and Prayer screen (#prayerWisdom),
// and checks for daily midnight refreshes on 24/7 displays.

import { $, todayKey, deterministicPick, escapeHtml } from "./util.js";
import { state } from "./state.js";
import { currentAyah, ayahManual, checkDailyAyahRefresh } from "./quran.js";
import { currentQuote, quoteManual, ensureDeck } from "./quotes.js";

const HOME_ROTATE_MS = 45 * 1000;
const HOME_MAX_WHISPER_CHARS = 50;
let currentMode = "ayah";
let lastRotateAt = Date.now();

export function getWisdomMode() {
  return currentMode;
}

export function setWisdomMode(mode) {
  currentMode = mode === "quote" ? "quote" : "ayah";
  renderAmbientWisdom();
}

export function toggleWisdomMode() {
  currentMode = currentMode === "ayah" ? "quote" : "ayah";
  lastRotateAt = Date.now();
  renderAmbientWisdom();
}

export function wisdomManual(direction = 1) {
  // Cycle both mode and underlying deck so every tap reveals fresh wisdom
  if (currentMode === "ayah") {
    currentMode = "quote";
    quoteManual(direction);
  } else {
    currentMode = "ayah";
    ayahManual(direction);
  }
  lastRotateAt = Date.now();
  renderAmbientWisdom();
}

function pickConciseAyah(ayah) {
  if (ayah && String(ayah.translation || "").length <= HOME_MAX_WHISPER_CHARS) return ayah;
  const shortPool = (state.content?.ayahFallbacks || []).filter(
    (a) => String(a.translation || "").length > 0 && String(a.translation || "").length <= HOME_MAX_WHISPER_CHARS
  );
  if (!shortPool.length) return ayah;
  const base = deterministicPick(shortPool, "home-ayah|" + todayKey()) || shortPool[0];
  const offset = state.ayah?.manualOffset || 0;
  const idx = Math.max(0, shortPool.indexOf(base));
  return shortPool[((idx + offset) % shortPool.length + shortPool.length) % shortPool.length] || base;
}

function pickConciseQuote(item) {
  const raw = item?.type === "urdu" ? item?.en : item?.text;
  if (item && String(raw || "").length > 0 && String(raw || "").length <= HOME_MAX_WHISPER_CHARS) return item;
  const shortPool = (state.content?.quoteLibrary || []).filter((q) => {
    const t = q.type === "urdu" ? q.en : q.text;
    return String(t || "").length > 0 && String(t || "").length <= HOME_MAX_WHISPER_CHARS;
  });
  if (!shortPool.length) return item;
  const base = deterministicPick(shortPool, "home-quote|" + todayKey()) || shortPool[0];
  const offset = state.quotes?.index || 0;
  const idx = Math.max(0, shortPool.indexOf(base));
  return shortPool[((idx + offset) % shortPool.length + shortPool.length) % shortPool.length] || base;
}

function formatAyahForHome(ayah) {
  const chosen = pickConciseAyah(ayah);
  if (!chosen) return null;
  const surah = chosen.surah?.englishName || "Qur'an";
  const cite = chosen.numberInSurah ? `${surah} · ${chosen.numberInSurah}` : surah;
  return {
    text: `“${chosen.translation || ""}”`,
    cite,
  };
}

function formatQuoteForHome(item) {
  const chosen = pickConciseQuote(item);
  if (!chosen) return null;
  if (chosen.type === "urdu") {
    return {
      text: `“${chosen.en}”`,
      cite: chosen.poetEn || "Urdu",
    };
  }
  return {
    text: `“${chosen.text || ""}”`,
    cite: chosen.author || "",
  };
}

export function renderAmbientWisdom() {
  const ayah = currentAyah();
  const quote = currentQuote();

  // 1. Home screen whisper line (#homeWisdom): alternates between Ayah & Quote
  const homeEl = $("homeWisdom");
  if (homeEl) {
    const picked = currentMode === "ayah"
      ? (formatAyahForHome(ayah) || formatQuoteForHome(quote))
      : (formatQuoteForHome(quote) || formatAyahForHome(ayah));

    if (picked && picked.text) {
      homeEl.innerHTML = `
        <span class="home-wisdom-text">${escapeHtml(picked.text)}</span>
        ${picked.cite ? `<span class="home-wisdom-cite">${escapeHtml(picked.cite)}</span>` : ""}
      `;
    } else {
      homeEl.innerHTML = "";
    }
  }

  // 2. Prayer screen wisdom block (#prayerWisdom): highlights Today's Ayah (with Arabic)
  //    or the active quote when toggled
  const prayerEl = $("prayerWisdom");
  if (prayerEl) {
    if (ayah && (currentMode === "ayah" || !quote)) {
      const surah = ayah.surah?.englishName || "Qur'an";
      const cite = ayah.numberInSurah ? `${surah} · Ayah ${ayah.numberInSurah}` : surah;
      prayerEl.innerHTML = `
        ${ayah.text ? `<div class="prayer-wisdom-arabic">${escapeHtml(ayah.text)}</div>` : ""}
        <div class="prayer-wisdom-text">“${escapeHtml(ayah.translation || "")}”</div>
        <div class="prayer-wisdom-cite">${escapeHtml(cite)}</div>
      `;
    } else if (quote) {
      const q = formatQuoteForHome(quote);
      prayerEl.innerHTML = `
        <div class="prayer-wisdom-text">${escapeHtml(q.text)}</div>
        ${q.cite ? `<div class="prayer-wisdom-cite">— ${escapeHtml(q.cite)}</div>` : ""}
      `;
    } else {
      prayerEl.innerHTML = "";
    }
  }
}

export function tickWisdom() {
  checkDailyAyahRefresh();
  ensureDeck();
  if (Date.now() - lastRotateAt >= HOME_ROTATE_MS) {
    lastRotateAt = Date.now();
    currentMode = currentMode === "ayah" ? "quote" : "ayah";
    renderAmbientWisdom();
  }
}

let wired = false;
export function startWisdomRunner() {
  if (!wired && typeof window !== "undefined") {
    wired = true;
    window.addEventListener("wisdom-data-updated", () => {
      renderAmbientWisdom();
    });
  }
  renderAmbientWisdom();
}

export function stopWisdomRunner() {
  // No-op: wisdom now lives continuously on Home and Prayer.
}
