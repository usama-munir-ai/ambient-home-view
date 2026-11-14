// Centralized in-memory app state. Frame modules read/write here.
// Persistence lives in `localStorage`/`sessionStorage` and is mediated by
// individual feature modules (see prayer.js, quran.js, photos.js).

export const state = {
  /** Active frame key (matches FRAMES[].key). */
  currentFrame: "home",

  /** Loaded /api/config payload (media provider flags). */
  config: { mediaProvider: "curated", mediaEnabled: true },

  /** Loaded /data/dashboard-content.json. */
  content: {
    home: null,
    worldCities: [],
    quoteLibrary: [],
    ayahFallbacks: [],
    surahContext: {},
  },

  /** Home location: the visitor's city when detected, else content.home. */
  homeLocation: null,

  /** Prayer cache (from Aladhan). */
  prayer: { data: null, status: "loading" },

  /** Latest weather snapshot. */
  weather: {
    current: null,
    daily: null,
    hourly: null,
    category: "clear-warm",
    status: "loading",
    timezone: "",
    alerts: { activeStorm: false, items: [], status: "loading" },
  },

  /** Daily ayah. */
  ayah: { current: null, manualOffset: 0 },

  /** Quote rotation. */
  quote: { deck: [], deckDate: "", manualOffset: 0 },

  /** Hijri date (from Aladhan prayer API response). */
  hijriDate: null,

  /** Active holiday context (set by holidays.js). */
  activeHoliday: null,

  /** Curated splash manifest, keyed by frame: home/prayer/quran/quotes.
   *  `sessionPool` is an in-memory pool of "live sip" images fetched from
   *  /api/media/resolve at idle. It augments the floor manifest with novelty
   *  without ever blocking a paint. */
  splash: { manifest: null, lastByFrame: {}, sessionPool: [] },

  /** Whether we've shown the app yet. */
  shown: false,

  /** set on first successful boot (for settings uptime) */
  bootedAt: 0,
};

export function setFrame(key) {
  state.currentFrame = key;
}

// Cached weather and prayer data belong to one place; ~1 km precision is plenty.
export function locationKey(loc = state.homeLocation) {
  return loc ? `${Number(loc.lat).toFixed(2)},${Number(loc.lon).toFixed(2)}` : "";
}
