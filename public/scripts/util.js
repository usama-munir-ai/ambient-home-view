// Tiny utilities. Keep this file dependency-free.

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(target, event, handler, opts) {
  if (!target) return;
  target.addEventListener(event, handler, opts);
}

// Escape text that came from a network response before it goes into innerHTML.
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

export function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function deterministicPick(list, seed) {
  if (!list || !list.length) return null;
  return list[hashString(String(seed)) % list.length];
}

export function todayKey(date) {
  const d = date || new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export function readSS(key) {
  try { return sessionStorage.getItem(key) || ""; } catch { return ""; }
}

export function writeSS(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
}

export function removeSS(key) {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

export function isCompactViewport() {
  return window.matchMedia("(max-width: 512px) and (max-height: 320px)").matches;
}

/** safe wrapper that swallows + logs errors so a broken runner can't kill the loop */
export function safeRun(label, fn) {
  try { fn(); } catch (err) {
    console.warn("[" + label + "]", err);
  }
}

/** Format a relative time like "in 2h", "in 35m", "now", "1h ago". */
export function relativeFromNow(target, now = new Date()) {
  const diff = target - now;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  if (m < 1) return diff >= 0 ? "now" : "just now";
  if (m < 60) return diff >= 0 ? `in ${m}m` : `${m}m ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) {
    if (rem === 0) return diff >= 0 ? `in ${h}h` : `${h}h ago`;
    return diff >= 0 ? `in ${h}h ${rem}m` : `${h}h ${rem}m ago`;
  }
  const d = Math.round(h / 24);
  return diff >= 0 ? `in ${d}d` : `${d}d ago`;
}
