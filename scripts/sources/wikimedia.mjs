// Wikimedia Commons source.
//
// Two modes:
//   - category: walk a category's file members, recurse one level into subcats
//   - search:   full-text search the file namespace
//
// For every file we fetch `imageinfo` with iiurlwidth=1920 to get a
// vetting-grade thumbnail URL plus the original URL plus license metadata.
// Wikimedia files use a stable upload.wikimedia.org CDN URL we can put
// directly in the manifest.

import { getJson } from "../lib/http.mjs";

const API = "https://commons.wikimedia.org/w/api.php";

export async function fetchCandidates(recipe) {
  const all = [];
  if (recipe.categories) {
    for (const cat of recipe.categories) {
      try {
        const items = await walkCategory(cat, recipe.perCategory || 25, recipe.recurseSubcats !== false);
        items.forEach((item) => all.push(decorate(item, recipe)));
      } catch (err) {
        console.warn(`  [wikimedia] category "${cat}" failed:`, err.message);
      }
    }
  }
  if (recipe.searches) {
    for (const q of recipe.searches) {
      const term = typeof q === "string" ? q : q.q;
      const locMeta = typeof q === "object" && q ? { place: q.place, country: q.country, tz: q.tz } : {};
      try {
        const items = await searchFiles(term, recipe.perSearch || 20);
        items.forEach((item) => all.push(decorate(item, recipe, locMeta)));
      } catch (err) {
        console.warn(`  [wikimedia] search "${term}" failed:`, err.message);
      }
    }
  }
  return all;
}

function decorate(item, recipe, locMeta = {}) {
  // Use the 1920-wide thumb as the actual displayed asset. Wikimedia
  // originals can be 50MB PNGs — useless on a 1280×800 device. The thumb
  // is ~250KB jpeg/webp, exactly what we want.
  const url = item.thumbUrl || item.url;
  return {
    provider: "wikimedia",
    sourceKey: item.title.replace(/^File:/, "").replace(/\.[^.]+$/, "").slice(0, 60),
    displayUrl: url,
    credit: formatCredit(item),
    license: item.license || "see Wikimedia Commons",
    sourceUrl: item.descriptionUrl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(item.title)}`,
    // File titles often name the place — the caption builder mines them.
    caption: item.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
    ...locMeta,
    suggestedTags: recipe.tagsBase || [],
    suggestedFrames: recipe.frames,
    width: item.width,
    height: item.height,
  };
}

function formatCredit(item) {
  const artist = stripTags(item.artist || "Wikimedia contributor");
  const lic = item.license || "Wikimedia Commons";
  return `${artist} · Wikimedia Commons · ${lic}`;
}

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function dailyBucket(seed, buckets = 6) {
  const daySlot = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(daySlot + h) % buckets;
}

async function walkCategory(title, limit, recurseSubcats) {
  const cmtitle = title.startsWith("Category:") ? title : `Category:${title}`;
  const files = [];
  let cont = null;
  const fetchPool = Math.min(200, Math.max(50, limit * 6));
  while (files.length < limit) {
    const params = new URLSearchParams({
      action: "query",
      list: "categorymembers",
      cmtitle,
      cmtype: "file",
      cmlimit: String(fetchPool),
      format: "json",
      origin: "*",
    });
    if (cont) params.set("cmcontinue", cont);
    const data = await getJson(`${API}?${params.toString()}`);
    const members = data?.query?.categorymembers || [];
    const allTitles = members.map((m) => m.title);
    const sliceStart = allTitles.length > limit
      ? (dailyBucket(cmtitle, Math.ceil(allTitles.length / limit)) * limit) % Math.max(1, allTitles.length - limit + 1)
      : 0;
    const titles = allTitles.slice(sliceStart, sliceStart + limit);
    if (titles.length) {
      const infos = await imageInfoBatch(titles);
      infos.forEach((info) => { if (info) files.push(info); });
    }
    cont = data?.continue?.cmcontinue;
    if (!cont || allTitles.length >= limit) break;
  }
  if (recurseSubcats && files.length < limit) {
    // One level of subcategory recursion, capped
    const subs = await listSubcats(cmtitle, 6);
    for (const sub of subs) {
      if (files.length >= limit) break;
      try {
        const more = await walkCategory(sub, Math.max(6, Math.floor(limit / 4)), false);
        for (const m of more) {
          files.push(m);
          if (files.length >= limit) break;
        }
      } catch { /* ignore */ }
    }
  }
  return files;
}

async function listSubcats(cmtitle, limit) {
  const params = new URLSearchParams({
    action: "query",
    list: "categorymembers",
    cmtitle,
    cmtype: "subcat",
    cmlimit: String(limit),
    format: "json",
    origin: "*",
  });
  const data = await getJson(`${API}?${params.toString()}`);
  const members = data?.query?.categorymembers || [];
  return members.map((m) => m.title);
}

async function searchFiles(query, limit) {
  const step = Math.min(50, limit);
  const offset = dailyBucket(query, 6) * step;
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srnamespace: "6", // File:
    srlimit: String(step),
    sroffset: String(offset),
    format: "json",
    origin: "*",
  });
  const data = await getJson(`${API}?${params.toString()}`);
  const hits = data?.query?.search || [];
  const titles = hits.map((h) => h.title);
  if (!titles.length) return [];
  return imageInfoBatch(titles);
}

async function imageInfoBatch(titles) {
  // Wikimedia accepts up to 50 titles per query
  const out = [];
  for (let i = 0; i < titles.length; i += 25) {
    const slice = titles.slice(i, i + 25);
    const params = new URLSearchParams({
      action: "query",
      titles: slice.join("|"),
      prop: "imageinfo",
      iiprop: "url|size|extmetadata|mime",
      iiurlwidth: "3840",
      format: "json",
      origin: "*",
    });
    const data = await getJson(`${API}?${params.toString()}`);
    const pages = data?.query?.pages || {};
    for (const key of Object.keys(pages)) {
      const page = pages[key];
      const info = (page.imageinfo || [])[0];
      if (!info) continue;
      // Drop SVG/GIF — these fight the cinematic surface
      const mime = info.mime || "";
      if (!/^image\/(jpe?g|png|webp)$/i.test(mime)) continue;
      out.push({
        title: page.title || "",
        url: info.url,
        thumbUrl: info.thumburl || info.url,
        width: info.width || 0,
        height: info.height || 0,
        descriptionUrl: info.descriptionurl,
        artist: extMeta(info, "Artist"),
        license: extMeta(info, "LicenseShortName"),
      });
    }
  }
  return out;
}

function extMeta(info, key) {
  return info?.extmetadata?.[key]?.value || "";
}
