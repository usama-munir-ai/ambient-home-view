// Quote rotation. Builds a deterministic daily deck so the same quote shows
// for the same calendar day across devices/refreshes, and enriches with a
// fresh remote daily quote when online.

import { state } from "./state.js";
import { $, hashString, todayKey, escapeHtml } from "./util.js";

const DAILY_REMOTE_QUOTE_KEY = "portal_daily_remote_quote_v1";

function deckSeedText(item, index) {
  return [
    item.type || "",
    item.mood || "",
    item.text || "",
    item.en || "",
    item.ur || "",
    item.author || "",
    item.poetEn || "",
    item.source || "",
    index,
  ].join("|");
}

function getStoredRemoteQuote(dateKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_REMOTE_QUOTE_KEY) || "null");
    if (raw && raw.dateKey === dateKey && raw.quote?.text) {
      return raw.quote;
    }
  } catch { /* ignore */ }
  return null;
}

function buildDailyDeck(dateKey) {
  const base = (state.content.quoteLibrary || [])
    .map((item, index) => ({ item, index, sortKey: hashString(dateKey + "|" + deckSeedText(item, index)) }))
    .sort((a, b) => a.sortKey - a.sortKey || a.sortKey - b.sortKey || a.index - b.index)
    .map((entry) => entry.item);

  const remote = getStoredRemoteQuote(dateKey);
  if (remote && !base.some((q) => q.text === remote.text)) {
    return [remote, ...base];
  }
  return base;
}

export function ensureDeck() {
  const key = todayKey();
  if (state.quote.deckDate !== key || !state.quote.deck.length) {
    state.quote.deck = buildDailyDeck(key);
    state.quote.deckDate = key;
    state.quote.manualOffset = 0;
    void loadDailyRemoteQuote(key);
  }
}

export async function loadDailyRemoteQuote(forKey = todayKey()) {
  if (getStoredRemoteQuote(forKey)) return;
  try {
    const res = await fetch("https://dummyjson.com/quotes/random");
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.quote || String(data.quote).length > 165) return;
    const quote = {
      type: "text",
      mood: "contemplative",
      text: String(data.quote).trim(),
      author: String(data.author || "Unknown").trim(),
      dates: "",
      source: "Daily reflection",
    };
    try {
      localStorage.setItem(DAILY_REMOTE_QUOTE_KEY, JSON.stringify({ dateKey: forKey, quote }));
    } catch { /* ignore */ }
    state.quote.deck = buildDailyDeck(forKey);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("wisdom-data-updated"));
    }
  } catch {
    /* offline or blocked — local library continues seamlessly */
  }
}

export function currentQuote() {
  ensureDeck();
  if (!state.quote.deck.length) return null;
  // Rotate through the daily deck every 60s
  const slot = Math.floor(Date.now() / 60000);
  const idx = ((slot + state.quote.manualOffset) % state.quote.deck.length + state.quote.deck.length) % state.quote.deck.length;
  return state.quote.deck[idx];
}

export function quoteManual(direction) {
  ensureDeck();
  state.quote.manualOffset += direction;
  renderQuoteFrame();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("wisdom-data-updated"));
  }
}

export function renderQuoteFrame() {
  const item = currentQuote();
  const root = $("quoteContent");
  const frame = document.getElementById("frame-wisdom");
  if (!root || !frame) return;

  if (!item) {
    root.innerHTML = '<p class="quote-eyebrow"><span class="dot"></span><span>Today</span></p><p class="quote-translation">A pause, in itself, is a kind of devotion.</p>';
    return;
  }

  if (item.mood) frame.dataset.mood = item.mood;

  if (item.type === "urdu") {
    root.innerHTML = `
      <div class="quote-eyebrow"><span class="dot"></span><span>${escapeHtml(item.mood || "Today")} · Urdu</span></div>
      <p class="quote-urdu">${escapeHtml(item.ur)}</p>
      <p class="quote-roman">${escapeHtml(item.ro)}</p>
      <p class="quote-translation">"${escapeHtml(item.en)}"</p>
      ${item.source ? `<div class="quote-source">${escapeHtml(item.source)}</div>` : ""}
      <div class="quote-author">
        <span class="name">${escapeHtml(item.poetEn)}</span>
        ${item.poetDates ? `<span class="dates">${escapeHtml(item.poetDates)}</span>` : ""}
      </div>
    `;
  } else {
    root.innerHTML = `
      <div class="quote-eyebrow"><span class="dot"></span><span>${escapeHtml(item.mood || "Today")}</span></div>
      <p class="quote-english">"${escapeHtml(item.text)}"</p>
      ${item.source ? `<div class="quote-source">${escapeHtml(item.source)}</div>` : ""}
      <div class="quote-author">
        <span class="name">${escapeHtml(item.author || "—")}</span>
        ${item.dates ? `<span class="dates">${escapeHtml(item.dates)}</span>` : ""}
      </div>
    `;
  }
}
