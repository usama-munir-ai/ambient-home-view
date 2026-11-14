// Home frame renderer — Option B3 (Swiss Grotesk).
// Top-left hero clock, top-right live wallpaper location clock,
// whisper strip (daily Ayah/quote + next prayer pill), and enlarged 3-column bottom deck.

import { $, escapeHtml } from "./util.js";
import { state } from "./state.js";
import { parsePrayerTime, format12hour } from "./time.js";

let lastMinuteKey = "";
let lastDateKey = "";

const PRAYER_SEQUENCE = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];

const DEFAULT_WALLPAPER_LOCATION = Object.freeze({
  place: "Istanbul",
  country: "Türkiye",
  tz: "Europe/Istanbul",
});

// Pure-white vector weather icons for the Swiss Grotesk bottom deck.
const HOME_WEATHER_ICONS = Object.freeze({
  sun: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="11" fill="#ffffff"/>
      <g stroke="#ffffff" stroke-linecap="round" stroke-width="4">
        <path d="M32 6v8"/><path d="M32 50v8"/>
        <path d="M6 32h8"/><path d="M50 32h8"/>
        <path d="M13 13l6 6"/><path d="M45 45l6 6"/>
        <path d="M13 51l6-6"/><path d="M45 19l6-6"/>
      </g>
    </svg>
  `,
  partly: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(0, 2)">
        <circle cx="40" cy="22" r="10" fill="rgba(255,255,255,0.78)"/>
        <g stroke="rgba(255,255,255,0.78)" stroke-linecap="round" stroke-width="3.6">
          <path d="M40 5v6"/><path d="M40 33v6"/>
          <path d="M23 22h6"/><path d="M51 22h6"/>
          <path d="M28.5 10.5l4.2 4.2"/><path d="M47.3 29.3l4.2 4.2"/>
        </g>
        <path d="M16 48h29a10 10 0 0 0 .6-20 15 15 0 0 0-28.2-4A10 10 0 0 0 16 48z" fill="#ffffff"/>
      </g>
    </svg>
  `,
  cloud: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(0, -6)">
        <path d="M16 48h31a10 10 0 0 0 .6-20 15 15 0 0 0-28.3-4A10 10 0 0 0 16 48z" fill="#ffffff"/>
      </g>
    </svg>
  `,
  drizzle: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(0, -6)">
        <path d="M16 43h31a10 10 0 0 0 .6-20 15 15 0 0 0-28.3-4A10 10 0 0 0 16 43z" fill="#ffffff"/>
        <g stroke="rgba(255,255,255,0.82)" stroke-width="2.6" stroke-linecap="round">
          <path d="M24 48l-1.5 4"/><path d="M32 48l-1.5 4"/><path d="M40 48l-1.5 4"/><path d="M48 48l-1.5 4"/>
        </g>
      </g>
    </svg>
  `,
  rain: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(0, -6)">
        <path d="M16 43h31a10 10 0 0 0 .6-20 15 15 0 0 0-28.3-4A10 10 0 0 0 16 43z" fill="#ffffff"/>
        <g stroke="rgba(255,255,255,0.85)" stroke-width="3.2" stroke-linecap="round">
          <path d="M26 48l-2 6"/><path d="M36 48l-2 6"/><path d="M46 48l-2 6"/>
        </g>
      </g>
    </svg>
  `,
  snow: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(0, -6)">
        <path d="M16 43h31a10 10 0 0 0 .6-20 15 15 0 0 0-28.3-4A10 10 0 0 0 16 43z" fill="#ffffff"/>
        <g fill="rgba(255,255,255,0.88)">
          <circle cx="24" cy="50" r="2.6"/>
          <circle cx="34" cy="54" r="2.6"/>
          <circle cx="44" cy="50" r="2.6"/>
        </g>
      </g>
    </svg>
  `,
  fog: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g stroke="#ffffff" stroke-width="4" stroke-linecap="round" fill="none">
        <path d="M12 22h40"/>
        <path d="M8 32h48"/>
        <path d="M16 42h36"/>
        <path d="M14 52h44" opacity="0.78"/>
      </g>
    </svg>
  `,
  thunder: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(0, -4)">
        <path d="M16 42h31a10 10 0 0 0 .6-20 15 15 0 0 0-28.3-4A10 10 0 0 0 16 42z" fill="#ffffff"/>
        <path d="M34 40l-9 14h7l-2 8 10-15h-6l2-7z" fill="#ffffff" stroke="#ffffff" stroke-linejoin="round" stroke-width="1.2"/>
      </g>
    </svg>
  `,
});

export function tickHome() {
  const now = new Date();
  const tz = getHomeTimezone();

  const minuteKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  if (minuteKey !== lastMinuteKey) {
    lastMinuteKey = minuteKey;
    const timeParts = formatTimeParts(now, tz);
    const hourEl = $("homeTimeHour");
    const minuteEl = $("homeTimeMinute");
    const periodEl = $("homeTimePeriod");
    const timeEl = $("homeTimeMain");
    if (hourEl) hourEl.textContent = timeParts.hour;
    if (minuteEl) minuteEl.textContent = timeParts.minute;
    if (periodEl) periodEl.textContent = timeParts.period;
    if (timeEl) {
      timeEl.setAttribute("aria-label", `Current time ${timeParts.hour}:${timeParts.minute} ${timeParts.period}`);
    }
    renderHomeLocationClock(state.splash?.lastByFrame?.home, now);
    renderHomeNextPrayer(now);
  }

  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  if (dayKey !== lastDateKey) {
    lastDateKey = dayKey;
    const dateEl = $("homeDateFull");
    if (dateEl) dateEl.textContent = formatHomeDate(now, tz);
  }
}

export function renderHomeLocationClock(image = state.splash?.lastByFrame?.home, now = new Date()) {
  const placeEl = $("homeLocPlace");
  const timeEl = $("homeLocTime");
  const metaEl = $("homeLocMeta");
  if (!placeEl || !timeEl || !metaEl) return;

  const place = image?.place || DEFAULT_WALLPAPER_LOCATION.place;
  const country = image?.country || DEFAULT_WALLPAPER_LOCATION.country;
  const targetTz = image?.tz || DEFAULT_WALLPAPER_LOCATION.tz;
  const homeTz = getHomeTimezone();

  const parts = formatTimeParts(now, targetTz);
  placeEl.textContent = place;
  timeEl.innerHTML = `<span class="tabular">${parts.hour}:${parts.minute}</span><small>${parts.period}</small>`;

  const diffHours = computeTzDiffHours(now, homeTz, targetTz);
  if (Math.abs(diffHours) < 0.05) {
    metaEl.textContent = country ? `${country} · Same time as home` : "Same time as home";
  } else {
    const sign = diffHours > 0 ? "+" : "−";
    const abs = Math.abs(diffHours);
    const hrsNum = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace(/\.0$/, "");
    const unit = abs === 1 ? "hr" : "hrs";
    const weekday = formatShortWeekday(now, targetTz);
    metaEl.textContent = [country, weekday, `${sign}${hrsNum} ${unit}`].filter(Boolean).join(" · ");
  }
}

export function renderHomeNextPrayer(now = new Date()) {
  const pillEl = $("homeNextPrayer");
  if (!pillEl) return;

  const timings = state.prayer?.data?.timings;
  if (!timings) {
    pillEl.hidden = true;
    return;
  }

  const events = PRAYER_SEQUENCE
    .filter((k) => timings[k])
    .map((k) => ({ key: k, time: parsePrayerTime(timings[k], now) }));
  if (!events.length) {
    pillEl.hidden = true;
    return;
  }

  let next = events.find((e) => e.time > now);
  if (!next) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    next = { key: "Fajr", time: parsePrayerTime(timings.Fajr, tomorrow) };
  }

  const f = format12hour(next.time);
  const diffMin = Math.max(1, Math.round((next.time.getTime() - now.getTime()) / 60000));
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  const inLabel = hrs > 0
    ? (mins > 0 ? `${hrs}H ${mins}M` : `${hrs}H`)
    : `${mins}M`;

  pillEl.hidden = false;
  pillEl.textContent = `${next.key.toUpperCase()} ${f.h}:${f.m} ${f.period.toUpperCase()} · IN ${inLabel}`;
}

export function renderHomeMeta() {
  const hijriEl = $("homeHijriFull");
  const hijri = state.prayer?.data?.date?.hijri;
  if (hijriEl) {
    hijriEl.textContent = hijri ? formatCompactHijri(hijri) : "";
  }

  const wx = state.weather;
  const current = wx?.current;
  const daily = wx?.daily;

  let iconKey = "sun";
  let label;
  let temp = null;
  if (current) {
    const severeCode = mostSevereCodeToday(current, wx?.hourly, wx?.daily, wx?.alerts, getHomeTimezone());
    iconKey = iconVariantForCode(severeCode);
    label = conditionLabelForCode(severeCode);
    temp = asTemp(current.temperature_2m);
  } else {
    label = wx?.status === "unavailable" ? "Unavailable" : "Loading";
  }

  const todayHigh = asTemp(daily?.temperature_2m_max?.[0]);
  const todayLow = asTemp(daily?.temperature_2m_min?.[0]);

  renderNowCell(iconKey, label, temp, todayHigh, todayLow);
  renderHourlyPrecip(wx?.hourly, temp);

  const now = new Date();
  const tz = getHomeTimezone();
  const dateEl = $("homeDateFull");
  if (dateEl) dateEl.textContent = formatHomeDate(now, tz);
  lastMinuteKey = "";
  tickHome();
}

function formatCompactHijri(hijri) {
  const day = hijri.day || "";
  const year = hijri.year || "";
  const rawMonth = String(hijri.month?.en || "").trim();
  const month = rawMonth
    .replace(/Jum[aā]d[aā]\s+al-[UŪ]l[aā]/i, "Jumādā I")
    .replace(/Jum[aā]d[aā]\s+al-Awwal/i, "Jumādā I")
    .replace(/Jum[aā]d[aā]\s+al-[AĀ]khirah/i, "Jumādā II")
    .replace(/Jum[aā]d[aā]\s+al-Th[aā]n[iī]/i, "Jumādā II")
    .replace(/Rab[iī][ʿ']?\s+al-Awwal/i, "Rabīʿ I")
    .replace(/Rab[iī][ʿ']?\s+al-Th[aā]n[iī]/i, "Rabīʿ II")
    .replace(/Rab[iī][ʿ']?\s+al-[AĀ]khir/i, "Rabīʿ II");
  return `${day} ${month} ${year}`.trim();
}

function renderNowCell(iconKey, label, temp, high, low) {
  const el = $("homeNowCell");
  if (!el) return;
  const icon = HOME_WEATHER_ICONS[iconKey] || HOME_WEATHER_ICONS.sun;
  const tempStr = temp == null ? "--" : String(temp);
  el.innerHTML = `
    <span class="home-now-cell-icon" aria-hidden="true">${icon}</span>
    <span class="home-now-cell-temp tabular">${tempStr}<span class="home-now-cell-deg" aria-hidden="true">°</span></span>
    <span class="home-now-cell-side">
      <span class="home-now-cell-place">${escapeHtml(state.homeLocation?.shortName || state.homeLocation?.name || "")}</span>
      <span class="home-now-cell-cond">${label || ""}</span>
      <span class="home-now-cell-hilo tabular">${formatHiLo(high, low)}</span>
    </span>
  `;
  el.setAttribute(
    "aria-label",
    temp == null
      ? "Current conditions unavailable"
      : `Now ${tempStr} degrees Celsius, ${label}. Today high ${high == null ? "--" : high}, low ${low == null ? "--" : low}`
  );
}

function renderHourlyPrecip(hourly, fallbackTemp = null) {
  const el = $("homeNowPrecip");
  if (!el) return;

  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const temps = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : [];
  if (!times.length) {
    el.innerHTML = "";
    return;
  }

  const startIdx = findNextHourIndex(times);
  const SLOTS = 5;
  const cells = [];
  for (let i = 0; i < SLOTS; i += 1) {
    const src = startIdx + i;
    if (src >= times.length) break;
    const rawTemp = src < temps.length ? asTemp(temps[src]) : null;
    const tVal = rawTemp != null
      ? rawTemp
      : (fallbackTemp != null ? fallbackTemp - Math.floor(i / 2) : "--");
    const hour = formatStripHour(times[src]);
    cells.push(`
      <div class="home-hour-cell">
        <span class="home-hour-temp tabular">${tVal}°</span>
        <span class="home-hour-label">${hour}</span>
      </div>
    `);
  }
  el.innerHTML = cells.join("");
}

function findNextHourIndex(times) {
  if (!Array.isArray(times) || times.length === 0) return 0;
  const now = Date.now();
  for (let i = 0; i < times.length; i += 1) {
    const t = Date.parse(times[i]);
    if (Number.isFinite(t) && t >= now - 30 * 60 * 1000) return i;
  }
  return 0;
}

function formatStripHour(isoLocal) {
  const m = typeof isoLocal === "string" ? isoLocal.match(/T(\d{2}):/) : null;
  if (!m) return "";
  const h = Number(m[1]);
  if (!Number.isFinite(h)) return "";
  const meridiem = h < 12 ? "A" : "P";
  const display = h === 0 ? 12 : h <= 12 ? h : h - 12;
  return `${display}${meridiem}`;
}

function getHomeTimezone() {
  return state.homeLocation?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatHomeDate(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
    }).formatToParts(date);
    const obj = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
    return `${obj.weekday || ""} ${obj.day || "--"} ${obj.month || ""}`.trim();
  } catch {
    return date.toDateString().slice(0, 10);
  }
}

function formatShortWeekday(date, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  } catch {
    return "";
  }
}

function formatTimeParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
    const obj = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
    const h = String(obj.hour || "--").replace(/^0/, "");
    const m = String(obj.minute || "--").padStart(2, "0");
    const period = String(obj.dayPeriod || "PM").toUpperCase();
    return { hour: h, minute: m, period };
  } catch {
    const f = format12hour(date);
    return { hour: f.h, minute: f.m, period: f.period.toUpperCase() };
  }
}

function getTzWallTimestamp(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const m = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  return Date.UTC(m.year, (m.month || 1) - 1, m.day || 1, m.hour || 0, m.minute || 0);
}

function computeTzDiffHours(date, homeTz, targetTz) {
  try {
    const homeWall = getTzWallTimestamp(date, homeTz);
    const targetWall = getTzWallTimestamp(date, targetTz);
    return Math.round(((targetWall - homeWall) / 3600000) * 2) / 2;
  } catch {
    return 0;
  }
}

function asTemp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function formatHiLo(high, low) {
  const hi = high == null ? "--" : String(high);
  const lo = low == null ? "--" : String(low);
  return `↑${hi}° ↓${lo}°`;
}

// WMO weather code severity ranking (higher = more severe).
const CODE_SEVERITY = Object.freeze({
  95: 100, 96: 100, 99: 100,             // thunderstorm
  75: 90, 86: 90,                         // heavy snow
  71: 80, 73: 80, 77: 80, 85: 80,        // snow / showers
  82: 75,                                 // violent rain showers
  65: 70, 67: 70,                         // heavy rain
  61: 60, 63: 60, 80: 60, 81: 60,        // rain / showers
  55: 50, 57: 50,                         // heavy drizzle
  51: 45, 53: 45, 56: 45,                 // light drizzle
  45: 35, 48: 35,                         // fog
  3: 25,                                  // overcast
  2: 15,                                  // partly cloudy
  1: 10,                                  // mainly clear
  0: 0,                                   // clear
});

function severityForCode(code) {
  const n = Number(code);
  return Number.isFinite(n) && CODE_SEVERITY[n] != null ? CODE_SEVERITY[n] : 0;
}

function mostSevereCodeToday(current, hourly, daily, alerts, tz) {
  if (alerts?.activeStorm) return 95;

  let bestCode = Number(current?.weather_code);
  if (!Number.isFinite(bestCode)) bestCode = 0;
  let bestSeverity = severityForCode(bestCode);

  const todayKey = localDateKey(new Date(), tz);

  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  for (let i = 0; i < Math.min(times.length, codes.length); i += 1) {
    if (!sameLocalDay(times[i], todayKey)) continue;
    const sev = severityForCode(codes[i]);
    if (sev > bestSeverity) {
      bestSeverity = sev;
      bestCode = Number(codes[i]);
    }
  }

  const dailyCode = Number(daily?.weather_code?.[0]);
  if (Number.isFinite(dailyCode)) {
    const sev = severityForCode(dailyCode);
    if (sev > bestSeverity) {
      bestSeverity = sev;
      bestCode = dailyCode;
    }
  }

  return bestCode;
}

function localDateKey(date, tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function sameLocalDay(isoLocal, todayKey) {
  if (typeof isoLocal !== "string" || isoLocal.length < 10) return false;
  return isoLocal.slice(0, 10) === todayKey;
}

function iconVariantForCode(code) {
  if ([95, 96, 99].includes(code)) return "thunder";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([45, 48].includes(code)) return "fog";
  if (code === 3) return "cloud";
  if ([1, 2].includes(code)) return "partly";
  return "sun";
}

function conditionLabelForCode(code) {
  if ([95, 96, 99].includes(code)) return "Storm";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([45, 48].includes(code)) return "Fog";
  if (code === 3) return "Overcast";
  if ([1, 2].includes(code)) return "Cloudy";
  return "Clear";
}
