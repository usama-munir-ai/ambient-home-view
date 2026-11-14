// Time + solar utilities. Pure functions — no DOM dependencies
// (except the ?tod=/?season= debug overrides).

import { DEBUG } from "./debug.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Compute approximate sunrise/sunset (local time) for a date and lat/lon.
 * NOAA-style algorithm, simplified — accurate enough for theme decisions.
 * Returns { sunrise: Date, sunset: Date, dayLength: ms, solarNoon: Date }.
 */
export function solarTimes(date, lat, lon) {
  const d = new Date(date);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);

  const lngHour = lon / 15;
  const tRise = dayOfYear + (6 - lngHour) / 24;
  const tSet = dayOfYear + (18 - lngHour) / 24;

  const compute = (t) => {
    const M = (0.9856 * t) - 3.289;
    let L = M + (1.916 * Math.sin(rad(M))) + (0.020 * Math.sin(rad(2 * M))) + 282.634;
    L = norm(L, 360);
    let RA = Math.atan(0.91764 * Math.tan(rad(L))) * 180 / Math.PI;
    RA = norm(RA, 360);
    const Lq = Math.floor(L / 90) * 90;
    const RAq = Math.floor(RA / 90) * 90;
    RA = (RA + (Lq - RAq)) / 15;
    const sinDec = 0.39782 * Math.sin(rad(L));
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(rad(90.833)) - (sinDec * Math.sin(rad(lat)))) / (cosDec * Math.cos(rad(lat)));
    if (cosH > 1 || cosH < -1) return null;
    return { L, RA, sinDec, cosDec, cosH };
  };

  const riseData = compute(tRise);
  const setData = compute(tSet);
  if (!riseData || !setData) return null;

  const Hr = (360 - (Math.acos(riseData.cosH) * 180 / Math.PI)) / 15;
  const Hs = (Math.acos(setData.cosH) * 180 / Math.PI) / 15;
  const Tr = Hr + riseData.RA - (0.06571 * tRise) - 6.622;
  const Ts = Hs + setData.RA - (0.06571 * tSet) - 6.622;
  const UTrise = norm(Tr - lngHour, 24);
  const UTset = norm(Ts - lngHour, 24);

  const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const t = d.getTime();
  let sunriseMs = startOfDay + UTrise * HOUR_MS;
  let sunsetMs = startOfDay + UTset * HOUR_MS;
  // norm() wraps each time into the UTC day independently, so far from
  // Greenwich the sunset can land "before" the sunrise (US evenings) or both
  // can belong to the wrong solar day (east Asia mornings). Restore ordering,
  // then re-center the whole solar day on the query instant.
  if (sunsetMs < sunriseMs) sunsetMs += 24 * HOUR_MS;
  let noonMs = (sunriseMs + sunsetMs) / 2;
  const DAY_MS = 24 * HOUR_MS;
  if (t < noonMs - 12 * HOUR_MS) { sunriseMs -= DAY_MS; sunsetMs -= DAY_MS; noonMs -= DAY_MS; }
  else if (t > noonMs + 12 * HOUR_MS) { sunriseMs += DAY_MS; sunsetMs += DAY_MS; noonMs += DAY_MS; }

  return {
    sunrise: new Date(sunriseMs),
    sunset: new Date(sunsetMs),
    solarNoon: new Date(noonMs),
    dayLength: sunsetMs - sunriseMs,
  };
}

const rad = (deg) => deg * Math.PI / 180;
const norm = (v, m) => ((v % m) + m) % m;

/**
 * Classify time-of-day based on solar position.
 * Returns: 'lateNight' | 'dawn' | 'morning' | 'day' | 'golden' | 'dusk' | 'night'.
 */
export function classifyTimeOfDay(date, lat, lon) {
  if (DEBUG.tod) return DEBUG.tod;
  const solar = solarTimes(date, lat, lon);
  if (!solar) {
    const h = date.getHours();
    if (h < 5) return "lateNight";
    if (h < 7) return "dawn";
    if (h < 10) return "morning";
    if (h < 17) return "day";
    if (h < 19) return "golden";
    if (h < 21) return "dusk";
    return "night";
  }

  const t = date.getTime();
  const sr = solar.sunrise.getTime();
  const ss = solar.sunset.getTime();
  const noon = solar.solarNoon.getTime();
  const goldenWindow = 35 * 60 * 1000; // 35 min before sunset

  if (t < sr - 5 * HOUR_MS) return "night"; // late evening, before the small hours
  if (t < sr - 30 * 60 * 1000) return "lateNight";
  if (t < sr + 30 * 60 * 1000) return "dawn";
  if (t < sr + 2 * HOUR_MS) return "morning";
  if (t < ss - goldenWindow) return "day";
  if (t < ss) return "golden";
  if (t < ss + 60 * 60 * 1000) return "dusk";
  return "night";
}

export function classifySeason(date, lat) {
  if (DEBUG.season) return DEBUG.season;
  const m = date.getMonth();
  // Northern hemisphere default
  if (lat >= 0) {
    if (m >= 2 && m <= 4) return "spring";
    if (m >= 5 && m <= 7) return "summer";
    if (m >= 8 && m <= 10) return "autumn";
    return "winter";
  }
  // Southern hemisphere
  if (m >= 2 && m <= 4) return "autumn";
  if (m >= 5 && m <= 7) return "winter";
  if (m >= 8 && m <= 10) return "spring";
  return "summer";
}

const SYNODIC_DAYS = 29.530588853;
const MOON_PHASE_NAMES = [
  "New moon", "Waxing crescent", "First quarter", "Waxing gibbous",
  "Full moon", "Waning gibbous", "Last quarter", "Waning crescent",
];

/**
 * Compute the moon phase locally (no API): days since a known new moon
 * (2000-01-06 18:14 UTC) modulo the synodic month.
 * Returns { age, fraction 0..1, index 0..7, name, illumination 0..1 }.
 */
export function moonPhase(date = new Date()) {
  const epoch = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - epoch) / 86400000;
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  const fraction = age / SYNODIC_DAYS;
  const index = Math.round(fraction * 8) % 8;
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  return { age, fraction, index, name: MOON_PHASE_NAMES[index], illumination };
}

/** Format a Date as "h:mm" / "9:07" — no leading zero on hour. */
export function format12hour(date) {
  const h24 = date.getHours();
  const h = h24 % 12 || 12;
  const m = String(date.getMinutes()).padStart(2, "0");
  return { h: String(h), m, period: h24 >= 12 ? "pm" : "am" };
}

/** Parse Aladhan style "HH:MM (...)" into a Date relative to today. */
export function parsePrayerTime(value, baseDate = new Date()) {
  const clean = String(value || "").split(" ")[0];
  const parts = clean.split(":");
  const d = new Date(baseDate);
  d.setHours(Number(parts[0] || 0), Number(parts[1] || 0), 0, 0);
  return d;
}

/** Format milliseconds as "1h 23m", "2m 15s", "45s", or { now: true } at 0. */
export function formatHms(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  if (total === 0) return { h: 0, m: 0, s: 0, t: 0, now: true, label: "now" };
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return { h, m, s, t: total, now: false, label: `${h}h ${m}m` };
  if (m > 0) {
    if (s === 0) return { h, m, s, t: total, now: false, label: `${m}m` };
    return { h, m, s, t: total, now: false, label: `${m}m ${s}s` };
  }
  // Under 1 minute: show live seconds
  return { h: 0, m: 0, s, t: total, now: false, label: `${s}s`, secondsOnly: true };
}
