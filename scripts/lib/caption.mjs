// Build a short human caption for a wallpaper at curation time — the "where /
// what" label the home frame shows. Best-effort: a place when the source names
// one (Wikimedia file titles, Met/Rijks work titles), otherwise the scene
// (Pexels alt text / slugs). Invented AI scenes get none.
//
// This is the canonical builder. The runtime carries an equivalent fallback
// (public/scripts/media/curator.js → splashCaption) for older manifest entries
// that predate this field; the client prefers a baked `caption` when present.

const MAX_LEN = 64;

// Canonical world-location atlas mapping place keywords to { place, country, tz }.
// Used at curation time (and for manifest enrichment) so every wide-angle Home
// wallpaper carries an accurate top-right live location clock.
export const LOCATION_ATLAS = [
  { match: /\b(istanbul|bosphorus|suleymaniye|süleymaniye|hagia sophia|galata)\b/i, place: "Istanbul", country: "Türkiye", tz: "Europe/Istanbul" },
  { match: /\b(cappadocia|goreme|göreme)\b/i, place: "Cappadocia", country: "Türkiye", tz: "Europe/Istanbul" },
  { match: /\b(lahore)\b/i, place: "Lahore", country: "Pakistan", tz: "Asia/Karachi" },
  { match: /\b(hunza|karakoram|k2|skardu)\b/i, place: "Hunza Valley", country: "Pakistan", tz: "Asia/Karachi" },
  { match: /\b(machu[\s_-]*picchu|cuzco|cusco)\b/i, place: "Machu Picchu", country: "Peru", tz: "America/Lima" },
  { match: /\b(lake[\s_-]*louise|banff|moraine[\s_-]*lake)\b/i, place: "Banff · Lake Louise", country: "Canada", tz: "America/Edmonton" },
  { match: /\b(jasper)\b/i, place: "Jasper", country: "Canada", tz: "America/Edmonton" },
  { match: /\b(quebec[\s_-]*city|ch[aâ]teau[\s_-]*frontenac)\b/i, place: "Québec City", country: "Canada", tz: "America/Toronto" },
  { match: /\b(toronto|torono)\b/i, place: "Toronto", country: "Canada", tz: "America/Toronto" },
  { match: /\b(tokyo|mount[\s_-]*fuji|mt[\s_-]*fuji|fujisan)\b/i, place: "Tokyo", country: "Japan", tz: "Asia/Tokyo" },
  { match: /\b(kyoto|arashiyama|fushimi)\b/i, place: "Kyoto", country: "Japan", tz: "Asia/Tokyo" },
  { match: /\b(nikko)\b/i, place: "Nikkō", country: "Japan", tz: "Asia/Tokyo" },
  { match: /\b(budapest|danube[\s_-]*parliament)\b/i, place: "Budapest", country: "Hungary", tz: "Europe/Budapest" },
  { match: /\b(cairo|giza|pyramids)\b/i, place: "Cairo", country: "Egypt", tz: "Africa/Cairo" },
  { match: /\b(dubai)\b/i, place: "Dubai", country: "UAE", tz: "Asia/Dubai" },
  { match: /\b(muscat|qalhat|oman)\b/i, place: "Muscat", country: "Oman", tz: "Asia/Muscat" },
  { match: /\b(petra|wadi[\s_-]*rum|jordan)\b/i, place: "Petra", country: "Jordan", tz: "Asia/Amman" },
  { match: /\b(hong[\s_-]*kong|victoria[\s_-]*harbour|hongkong|peak\s+by\s+ralfr)\b/i, place: "Hong Kong", country: "China", tz: "Asia/Hong_Kong" },
  { match: /\b(zhangjiajie|wulingyuan|tianzishan|huangshizhai)\b/i, place: "Zhangjiajie", country: "China", tz: "Asia/Shanghai" },
  { match: /\b(beijing|temple[\s_-]*of[\s_-]*heaven|great[\s_-]*wall)\b/i, place: "Beijing", country: "China", tz: "Asia/Shanghai" },
  { match: /\b(guilin|li[\s_-]*river|yangshuo)\b/i, place: "Guilin", country: "China", tz: "Asia/Shanghai" },
  { match: /\b(taipei)\b/i, place: "Taipei", country: "Taiwan", tz: "Asia/Taipei" },
  { match: /\b(singapore|marina[\s_-]*bay)\b/i, place: "Singapore", country: "Singapore", tz: "Asia/Singapore" },
  { match: /\b(luang[\s_-]*prabang|laos)\b/i, place: "Luang Prabang", country: "Laos", tz: "Asia/Vientiane" },
  { match: /(bangkok|พระที่นั่ง)/i, place: "Hua Hin · Sam Roi Yot", country: "Thailand", tz: "Asia/Bangkok" },
  { match: /\b(caraga|liloan|palawan|el[\s_-]*nido|philippines)\b/i, place: "Palawan", country: "Philippines", tz: "Asia/Manila" },
  { match: /\b(bali|ubud)\b/i, place: "Bali", country: "Indonesia", tz: "Asia/Makassar" },
  { match: /\b(agra|taj[\s_-]*mahal)\b/i, place: "Agra", country: "India", tz: "Asia/Kolkata" },
  { match: /\b(mumbai|marine[\s_-]*drive)\b/i, place: "Mumbai", country: "India", tz: "Asia/Kolkata" },
  { match: /\b(brihadeeswarar|thanjavur)\b/i, place: "Thanjavur", country: "India", tz: "Asia/Kolkata" },
  { match: /\b(sydney)\b/i, place: "Sydney", country: "Australia", tz: "Australia/Sydney" },
  { match: /\b(christchurch|milford[\s_-]*sound|queenstown|new[\s_-]*zealand)\b/i, place: "Christchurch", country: "New Zealand", tz: "Pacific/Auckland" },
  { match: /\b(london|canary[\s_-]*wharf|tate[\s_-]*modern|tower[\s_-]*bridge)\b/i, place: "London", country: "United Kingdom", tz: "Europe/London" },
  { match: /\b(yorkshire[\s_-]*dales|swaledale|ribblehead|cogden|fremington|washfold|askrigg)\b/i, place: "Yorkshire Dales", country: "United Kingdom", tz: "Europe/London" },
  { match: /\b(beinn[\s_-]*dorain|scotland|isle[\s_-]*of[\s_-]*skye|glencoe)\b/i, place: "Scottish Highlands", country: "United Kingdom", tz: "Europe/London" },
  { match: /\b(paris|eiffel|bir[\s_-]*hakeim|15th[\s_-]*arrondissement)\b/i, place: "Paris", country: "France", tz: "Europe/Paris" },
  { match: /\b(gorges[\s_-]*du[\s_-]*tarn|pyrenees|gavarnie|vallon[\s_-]*moy|chamonix|mont[\s_-]*blanc)\b/i, place: "Pyrénées", country: "France", tz: "Europe/Paris" },
  { match: /\b(corse|corsica|calanche[\s_-]*piana|ota[\s_-]*porto)\b/i, place: "Corsica", country: "France", tz: "Europe/Paris" },
  { match: /\b(toledo)\b/i, place: "Toledo", country: "Spain", tz: "Europe/Madrid" },
  { match: /\b(alhambra|granada|seville)\b/i, place: "Granada", country: "Spain", tz: "Europe/Madrid" },
  { match: /\b(basilica[\s_-]*sancti[\s_-]*petri|vatican|rome|colosseum)\b/i, place: "Rome", country: "Italy", tz: "Europe/Rome" },
  { match: /\b(dolomites|secoda|seceda|tre[\s_-]*cime|braies)\b/i, place: "Dolomites", country: "Italy", tz: "Europe/Rome" },
  { match: /\b(alicudi|stromboli|aeolian|amalfi|cinque[\s_-]*terre)\b/i, place: "Aeolian Islands", country: "Italy", tz: "Europe/Rome" },
  { match: /\b(zermatt|matterhorn|lauterbrunnen|grindelwald|interlaken|switzerland)\b/i, place: "Zermatt", country: "Switzerland", tz: "Europe/Zurich" },
  { match: /\b(frankfurt)\b/i, place: "Frankfurt", country: "Germany", tz: "Europe/Berlin" },
  { match: /\b(bodensee|lake[\s_-]*constance|pritzerbe|d[uü]lmen|m[uü]nster|bavaria|neuschwanstein)\b/i, place: "Lake Constance", country: "Germany", tz: "Europe/Berlin" },
  { match: /\b(almsee|kleinarl|j[aä]gersee|hallstatt|salzburg|tyrol|funkturm[\s_-]*arsenal|vienna)\b/i, place: "Salzkammergut", country: "Austria", tz: "Europe/Vienna" },
  { match: /\b(kotor)\b/i, place: "Kotor Bay", country: "Montenegro", tz: "Europe/Podgorica" },
  { match: /\b(xanthi|thrace|korfu|corfu|santorini|meteora|greece)\b/i, place: "Thrace", country: "Greece", tz: "Europe/Athens" },
  { match: /\b(zdiar|ždiar|vihorlat|tatras|slovakia)\b/i, place: "High Tatras", country: "Slovakia", tz: "Europe/Bratislava" },
  { match: /\b(synevyr|carpathian)\b/i, place: "Lake Synevyr", country: "Ukraine", tz: "Europe/Kyiv" },
  { match: /\b(lofoten|norway|r[oø]nna|kvannliaksa|geiranger|troms[oø]|bergen)\b/i, place: "Lofoten", country: "Norway", tz: "Europe/Oslo" },
  { match: /\b(tuntorp|lysekil|abisko|sweden)\b/i, place: "Lysekil", country: "Sweden", tz: "Europe/Stockholm" },
  { match: /\b(keminmaa|lapland|finland)\b/i, place: "Lapland", country: "Finland", tz: "Europe/Helsinki" },
  { match: /\b(maardu|virmalised|estonia)\b/i, place: "Tallinn · Maardu", country: "Estonia", tz: "Europe/Tallinn" },
  { match: /\b(m[yý]vatn|iceland|reynisfjara|kirkjufell|j[oö]kuls[aá]rl[oó]n|sk[oó]gafoss)\b/i, place: "Mývatn", country: "Iceland", tz: "Atlantic/Reykjavik" },
  { match: /\b(mylgval|caucasus)\b/i, place: "Caucasus", country: "Georgia", tz: "Asia/Tbilisi" },
  { match: /\b(nairobi|kenya|kilimanjaro|serengeti)\b/i, place: "Nairobi", country: "Kenya", tz: "Africa/Nairobi" },
  { match: /\b(sossusvlei|namib|namibia)\b/i, place: "Namib Desert", country: "Namibia", tz: "Africa/Windhoek" },
  { match: /\b(sahara|merzouga|morocco|marrakech)\b/i, place: "Sahara · Merzouga", country: "Morocco", tz: "Africa/Casablanca" },
  { match: /\b(rocinha|rio[\s_-]*de[\s_-]*janeiro|sugarloaf)\b/i, place: "Rio de Janeiro", country: "Brazil", tz: "America/Sao_Paulo" },
  { match: /\b(patagonia|torres[\s_-]*del[\s_-]*paine|fitz[\s_-]*roy|atacama)\b/i, place: "Patagonia", country: "Chile", tz: "America/Santiago" },
  { match: /\b(new[\s_-]*york|lower[\s_-]*manhattan|long[\s_-]*island[\s_-]*city|brooklyn[\s_-]*bridge)\b/i, place: "New York", country: "United States", tz: "America/New_York" },
  { match: /\b(boston|charles[\s_-]*river)\b/i, place: "Boston", country: "United States", tz: "America/New_York" },
  { match: /\b(washington)\b/i, place: "Washington, D.C.", country: "United States", tz: "America/New_York" },
  { match: /\b(reads[\s_-]*landing|minnesota)\b/i, place: "Mississippi Valley", country: "United States", tz: "America/Chicago" },
  { match: /\b(grand[\s_-]*canyon|monument[\s_-]*valley|sedona|arizona)\b/i, place: "Grand Canyon", country: "United States", tz: "America/Phoenix" },
  { match: /\b(aspen|rocky[\s_-]*mountain|colorado|teton|yellowstone)\b/i, place: "Rocky Mountains", country: "United States", tz: "America/Denver" },
  { match: /\b(san[\s_-]*francisco|civic[\s_-]*center[\s_-]*of[\s_-]*sf|bay[\s_-]*area)\b/i, place: "San Francisco", country: "United States", tz: "America/Los_Angeles" },
  { match: /\b(joshua[\s_-]*tree|yosemite|big[\s_-]*sur)\b/i, place: "Joshua Tree", country: "United States", tz: "America/Los_Angeles" },
  { match: /\b(los[\s_-]*angeles|hollywood)\b/i, place: "Los Angeles", country: "United States", tz: "America/Los_Angeles" },
  { match: /\b(oahu|hawaii|kauai|maui)\b/i, place: "Oʻahu", country: "United States", tz: "Pacific/Honolulu" },
];

const CITY_KEY_MAP = {
  istanbul: { place: "Istanbul", country: "Türkiye", tz: "Europe/Istanbul" },
  lahore: { place: "Lahore", country: "Pakistan", tz: "Asia/Karachi" },
  london: { place: "London", country: "United Kingdom", tz: "Europe/London" },
  "los-angeles": { place: "Los Angeles", country: "United States", tz: "America/Los_Angeles" },
  "new-york": { place: "New York", country: "United States", tz: "America/New_York" },
  washington: { place: "Washington, D.C.", country: "United States", tz: "America/New_York" },
  tokyo: { place: "Tokyo", country: "Japan", tz: "Asia/Tokyo" },
  dubai: { place: "Dubai", country: "UAE", tz: "Asia/Dubai" },
  paris: { place: "Paris", country: "France", tz: "Europe/Paris" },
  singapore: { place: "Singapore", country: "Singapore", tz: "Asia/Singapore" },
  sydney: { place: "Sydney", country: "Australia", tz: "Australia/Sydney" },
  mumbai: { place: "Mumbai", country: "India", tz: "Asia/Kolkata" },
  "hong-kong": { place: "Hong Kong", country: "China", tz: "Asia/Hong_Kong" },
  budapest: { place: "Budapest", country: "Hungary", tz: "Europe/Budapest" },
  cairo: { place: "Cairo", country: "Egypt", tz: "Africa/Cairo" },
  beijing: { place: "Beijing", country: "China", tz: "Asia/Shanghai" },
};

export function resolveLocation(candidate = {}) {
  if (candidate.place && candidate.tz) {
    return {
      place: candidate.place,
      country: candidate.country || "",
      tz: candidate.tz,
    };
  }
  if (candidate.city && CITY_KEY_MAP[candidate.city]) {
    return { ...CITY_KEY_MAP[candidate.city] };
  }
  let haystack = [
    candidate.caption,
    candidate.alt,
    candidate.title,
    candidate.sourceUrl,
    candidate.src,
    candidate.credit,
  ]
    .filter(Boolean)
    .join(" ");
  try {
    haystack = decodeURIComponent(haystack);
  } catch { /* ignore malformed URI sequences */ }
  haystack = haystack.replace(/[_-]+/g, " ");

  for (const row of LOCATION_ATLAS) {
    if (row.match.test(haystack)) {
      return { place: row.place, country: row.country, tz: row.tz };
    }
  }
  return null;
}

export function buildCaption(candidate = {}) {
  const provider = candidate.provider || "";
  if (provider === "pollinations") return "";
  if ((candidate.suggestedTags || []).includes("ai-scene")) return "";

  // The richest signal is an explicit title/description the source handed us
  // (Pexels alt, Wikimedia title). Fall back to deriving from the source URL or
  // credit, mirroring the runtime.
  const raw = (candidate.caption || candidate.alt || candidate.title || "").trim();
  const url = candidate.sourceUrl || "";

  if (provider === "wikimedia") {
    return clamp(cleanWikiTitle(raw || wikiNameFromUrl(url)));
  }
  if (raw) return clamp(prettify(raw));

  if (provider === "pexels") {
    // …/photo/<descriptive-slug>-<id>/ → the slug reads as a caption
    const m = url.match(/\/photo\/(.+?)-\d+\/?$/i);
    if (m) return clamp(prettify(m[1].replace(/-/g, " ")));
  }
  // Met / Rijksmuseum fold the work's title into the credit.
  const credit = candidate.credit || "";
  const quoted = credit.match(/"([^"]+)"/);
  if (quoted) return clamp(prettify(quoted[1]));
  if (provider === "met") return clamp(prettify(credit.split("·")[0]));

  return "";
}

function prettify(s) {
  const out = String(s || "")
    .replace(/\.[a-z0-9]{2,4}$/i, "") // trailing file extension
    .replace(/[_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : "";
}

// Wikimedia file names are often "<n> - <Place> - <date>.editN" — split on the
// dashes and keep the segment that reads like a name rather than a number/date.
function cleanWikiTitle(name) {
  const base = String(name || "")
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_]+/g, " ");
  const monthish = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|févr|mars|avril|mai|juin|juil|août|sept|déc)\w*\b/i;
  const parts = base.split(/\s*[-–]\s*/).map((p) => p.trim()).filter(Boolean);
  const meaty = parts.filter(
    (p) => /[a-zà-ÿ]{3,}/i.test(p) && !/^\d/.test(p) && !monthish.test(p) && !/\b\d{4}\b/.test(p)
  );
  const pick = (meaty.length ? meaty : parts).sort((a, b) => b.length - a.length)[0] || base;
  return prettify(pick.replace(/\bedit\d*\b/i, "").replace(/\b\d{4}\b/g, ""));
}

function wikiNameFromUrl(url) {
  const m = String(url || "").match(/File:(.+)$/i);
  return m ? decodeURIComponent(m[1]) : "";
}

// Soft length cap at a word boundary so a baked caption stays a label, not a
// paragraph (the home label also ellipsizes, but keep the manifest lean).
function clamp(s) {
  const str = String(s || "").trim();
  if (str.length <= MAX_LEN) return str;
  const cut = str.slice(0, MAX_LEN);
  const sp = cut.lastIndexOf(" ");
  return (sp > 24 ? cut.slice(0, sp) : cut).trim();
}
