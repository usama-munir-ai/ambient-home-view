// Holiday detection — Islamic (Hijri) + secular (US) calendar.
// Used by the curator to boost wallpaper selection for special days.

/**
 * Islamic holidays keyed by "month-day" in the Hijri calendar.
 * Month numbers: 1=Muharram … 12=Dhul Hijjah.
 * Some holidays span multiple days — we list the primary day.
 */
const ISLAMIC_HOLIDAYS = {
  "1-1":  { name: "Islamic New Year",   tags: ["sacred", "mosque", "night", "lantern", "contemplative"] },
  "1-10": { name: "Day of Ashura",      tags: ["sacred", "mosque", "contemplative", "reverent"] },
  "3-12": { name: "Mawlid an-Nabi",     tags: ["mawlid", "sacred", "mosque", "night", "lantern", "celebration"] },
  "7-27": { name: "Shab-e-Meraj",       tags: ["sacred", "mosque", "night", "stars", "celestial"] },
  "8-15": { name: "Shab-e-Barat",       tags: ["sacred", "mosque", "night", "lantern", "contemplative"] },
  "9-1":  { name: "Ramadan begins",     tags: ["ramadan", "sacred", "mosque", "night", "lantern", "crescent"] },
  "9-15": { name: "Mid-Ramadan",        tags: ["ramadan", "sacred", "mosque", "night", "lantern"] },
  "9-27": { name: "Laylat al-Qadr",     tags: ["ramadan", "sacred", "mosque", "night", "stars", "celestial", "reverent"] },
  "10-1": { name: "Eid al-Fitr",        tags: ["eid", "celebration", "mosque", "morning", "golden", "joy"] },
  "10-2": { name: "Eid al-Fitr Day 2",  tags: ["eid", "celebration", "mosque", "joy"] },
  "10-3": { name: "Eid al-Fitr Day 3",  tags: ["eid", "celebration", "joy"] },
  "12-8": { name: "Day of Tarwiyah",    tags: ["sacred", "mosque", "contemplative"] },
  "12-9": { name: "Day of Arafah",      tags: ["sacred", "mosque", "contemplative", "reverent"] },
  "12-10": { name: "Eid al-Adha",       tags: ["eid", "celebration", "mosque", "morning", "golden", "joy"] },
  "12-11": { name: "Eid al-Adha Day 2", tags: ["eid", "celebration", "joy"] },
  "12-12": { name: "Eid al-Adha Day 3", tags: ["eid", "celebration", "joy"] },
  "12-13": { name: "Eid al-Adha Day 4", tags: ["eid", "celebration"] },
};

// Also boost the entire month of Ramadan
const RAMADAN_MONTH = 9;

/**
 * US secular holidays keyed by "month-day".
 * Month numbers: 1=January … 12=December.
 */
const SECULAR_HOLIDAYS = {
  "1-1":   { name: "New Year's Day",       tags: ["newyear", "celebration", "night", "fireworks", "city"] },
  "2-14":  { name: "Valentine's Day",       tags: ["warm", "cozy", "soft"] },
  "3-17":  { name: "St. Patrick's Day",     tags: ["green", "nature", "celebration"] },
  "7-4":   { name: "Independence Day",      tags: ["independence-day", "fireworks", "city", "celebration"] },
  "10-31": { name: "Halloween",             tags: ["night", "autumn", "fog", "contemplative"] },
  "11-11": { name: "Veterans Day",          tags: ["grounded", "contemplative"] },
  "12-24": { name: "Christmas Eve",         tags: ["christmas", "cozy", "warm", "night", "lantern", "snow-light"] },
  "12-25": { name: "Christmas Day",         tags: ["christmas", "celebration", "cozy", "warm", "morning"] },
  "12-31": { name: "New Year's Eve",        tags: ["newyear", "celebration", "night", "fireworks", "city"] },
};

// Thanksgiving: 4th Thursday of November — computed dynamically
function thanksgivingDay(year) {
  const nov1 = new Date(year, 10, 1);
  const firstThursday = (11 - nov1.getDay()) % 7;
  return firstThursday + 22; // 4th Thursday
}

/**
 * Get the active Islamic holiday for a given Hijri date.
 * @param {number} hijriMonth - 1-based month
 * @param {number} hijriDay - 1-based day
 * @returns {{ name: string, tags: string[] } | null}
 */
export function getIslamicHoliday(hijriMonth, hijriDay) {
  const key = `${hijriMonth}-${hijriDay}`;
  return ISLAMIC_HOLIDAYS[key] || null;
}

/**
 * Check if we're in Ramadan (extra sacred mood for the whole month).
 * @param {number} hijriMonth
 * @returns {boolean}
 */
export function isRamadan(hijriMonth) {
  return hijriMonth === RAMADAN_MONTH;
}

/**
 * Get the active secular holiday for a given Gregorian date.
 * @param {Date} date
 * @returns {{ name: string, tags: string[] } | null}
 */
export function getSecularHoliday(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const key = `${m}-${d}`;
  if (SECULAR_HOLIDAYS[key]) return SECULAR_HOLIDAYS[key];

  // Thanksgiving
  if (m === 11 && d === thanksgivingDay(date.getFullYear())) {
    return { name: "Thanksgiving", tags: ["thanksgiving", "cozy", "warm", "autumn", "grounded"] };
  }
  return null;
}

/**
 * Unified holiday lookup.
 * @param {Date} date - Gregorian date
 * @param {{ month: number, day: number } | null} hijri - Optional Hijri date
 * @returns {{ name: string, tags: string[], source: string } | null}
 */
export function getActiveHoliday(date, hijri = null) {
  // Islamic holidays take priority
  if (hijri) {
    const islamic = getIslamicHoliday(hijri.month, hijri.day);
    if (islamic) return { ...islamic, source: "islamic" };
    if (isRamadan(hijri.month)) {
      return { name: "Ramadan", tags: ["ramadan", "sacred", "mosque", "night", "lantern", "crescent"], source: "islamic" };
    }
  }
  const secular = getSecularHoliday(date);
  if (secular) return { ...secular, source: "secular" };
  return null;
}

/**
 * Get wallpaper tag boost list for the current holiday context.
 * Returns empty array if no holiday is active.
 */
export function getHolidayTags(date, hijri = null) {
  const h = getActiveHoliday(date, hijri);
  return h ? h.tags : [];
}
