// NASA source.
//
// Two endpoints:
//   - APOD (Astronomy Picture of the Day): one image per day, public domain,
//     archival back to 1995. Excellent for cosmic ambient.
//   - Earth Observatory IOTD (Image of the Day): orbital Earth imagery, also
//     public domain. We use the EONET-adjacent feed (RSS) since the IOTD has
//     no JSON API; we parse the simple <item><media:content url=""/></item>
//     structure. Falls back gracefully when offline.
//
// API key: NASA accepts DEMO_KEY (rate-limited to 30/h, 50/day). Set
// NASA_API_KEY in the env to lift the limit.

import { getJson, getBuffer } from "../lib/http.mjs";

const APOD = "https://api.nasa.gov/planetary/apod";
const IOTD_RSS = "https://earthobservatory.nasa.gov/feeds/image-of-the-day.rss";

export async function fetchCandidates(recipe) {
  const out = [];
  if (recipe.modes?.includes("apod")) {
    try {
      const items = await fetchApodWindow(recipe.apodCount || 60);
      items.forEach((it) => out.push({
        provider: "nasa-apod",
        sourceKey: `apod-${it.date}`,
        // APOD `url` is the screen-sized version (~1000–2000 wide).
        // `hdurl` is often 4000+ — overkill for a 1280×800 device.
        displayUrl: it.url || it.hdurl,
        credit: `NASA APOD · ${it.copyright || it.title || it.date} (Public Domain)`,
        license: "Public Domain (NASA)",
        sourceUrl: `https://apod.nasa.gov/apod/ap${it.date.slice(2).replace(/-/g, "")}.html`,
        suggestedTags: recipe.tagsBase || [],
        suggestedFrames: recipe.frames,
      }));
    } catch (err) {
      console.warn("  [nasa] APOD failed:", err.message);
    }
  }
  if (recipe.modes?.includes("iotd")) {
    try {
      const items = await fetchIotdRecent(recipe.iotdCount || 30);
      items.forEach((it) => out.push({
        provider: "nasa-iotd",
        sourceKey: `iotd-${slug(it.title)}`,
        displayUrl: it.url,
        credit: `NASA Earth Observatory · ${it.title || "Image of the Day"} (Public Domain)`,
        license: "Public Domain (NASA Earth Observatory)",
        sourceUrl: it.link || "https://earthobservatory.nasa.gov/topic/image-of-the-day",
        suggestedTags: recipe.tagsBase || [],
        suggestedFrames: recipe.frames,
      }));
    } catch (err) {
      console.warn("  [nasa] IOTD failed:", err.message);
    }
  }
  return out;
}

async function fetchApodWindow(count) {
  const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - count);
  const params = new URLSearchParams({
    api_key: apiKey,
    start_date: ymd(start),
    end_date: ymd(today),
    thumbs: "true",
  });
  const data = await getJson(`${APOD}?${params.toString()}`);
  return (Array.isArray(data) ? data : [])
    .filter((d) => d.media_type === "image" && (d.url || d.hdurl));
}

async function fetchIotdRecent(count) {
  const buf = await getBuffer(IOTD_RSS, { accept: "application/rss+xml, application/xml" });
  const xml = buf.toString("utf8");
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRe.exec(xml)) !== null && items.length < count) {
    const block = match[1];
    const title = pluck(block, /<title>([\s\S]*?)<\/title>/);
    const link = pluck(block, /<link>([\s\S]*?)<\/link>/);
    let url = pluck(block, /<media:content[^>]*url="([^"]+)"/);
    if (!url) url = pluck(block, /<enclosure[^>]*url="([^"]+)"/);
    if (!url) continue;
    items.push({ title: cleanXml(title), link: cleanXml(link), url: cleanXml(url) });
  }
  return items;
}

function pluck(s, re) {
  const m = s.match(re);
  return m ? m[1] : "";
}

function cleanXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .trim();
}

function ymd(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function slug(s) {
  return String(s || "image")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
