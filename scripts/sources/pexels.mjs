// Pexels source — free, key-gated photography with lots of clean negative
// space (skies, minimal landscapes, calm seas). Great wallpaper material that
// the painting-heavy Wikimedia/Met pools lack.
//
// Recipe shape: { type: "pexels", queries: ["minimal sky", ...], perQuery: 20,
//                 tagsBase: [...], frames: [...] }
//
// No-op (returns []) unless PEXELS_API_KEY is set, mirroring the optional
// Smithsonian/Rijksmuseum sources. Get a free key at https://www.pexels.com/api/.

import { getJson, sleep } from "../lib/http.mjs";

const API = "https://api.pexels.com/v1/search";

function dailyPage(term, maxPage = 8) {
  const daySlot = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  let h = 0;
  for (let i = 0; i < term.length; i += 1) h = (h * 31 + term.charCodeAt(i)) | 0;
  return (Math.abs(daySlot + h) % maxPage) + 1;
}

export async function fetchCandidates(recipe) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    console.warn("  [pexels] PEXELS_API_KEY not set — skipping");
    return [];
  }

  const all = [];
  const queries = recipe.queries || [];
  for (const q of queries) {
    const term = typeof q === "string" ? q : q.q;
    const locMeta = typeof q === "object" && q ? { place: q.place, country: q.country, tz: q.tz } : {};
    try {
      const params = new URLSearchParams({
        query: term,
        orientation: "landscape",
        size: "large",
        per_page: String(recipe.perQuery || 20),
        page: String(dailyPage(term)),
      });
      const data = await getJson(`${API}?${params.toString()}`, {
        headers: { Authorization: key },
      });
      const photos = Array.isArray(data?.photos) ? data.photos : [];
      for (const p of photos) {
        if (p.width && p.height && p.width / p.height < 1.45) continue;
        // Request a 3840px (4K UHD) compressed JPEG from Pexels' Imgix CDN so
        // 4K TV displays stay razor-sharp while phones downscale cleanly.
        const rawOriginal = p?.src?.original || (p?.src?.large2x ? p.src.large2x.split("?")[0] : "");
        const displayUrl = rawOriginal
          ? `${rawOriginal.split("?")[0]}?auto=compress&cs=tinysrgb&w=3840`
          : (p?.src?.large2x || p?.src?.original);
        if (!displayUrl) continue;
        all.push({
          provider: "pexels",
          sourceKey: `pexels-${p.id}`,
          displayUrl,
          credit: `${(p.photographer || "Pexels").trim()} · Pexels`,
          license: "Pexels License (free use)",
          sourceUrl: p.url || "https://www.pexels.com",
          // Pexels alt text is a clean scene description — the best caption hint.
          alt: (p.alt || "").trim(),
          ...locMeta,
          suggestedTags: recipe.tagsBase || [],
          suggestedFrames: recipe.frames,
          width: p.width,
          height: p.height,
        });
      }
      await sleep(120); // courtesy; Pexels allows 200/hr, 20k/mo
    } catch (err) {
      console.warn(`  [pexels] query "${term}" failed:`, err.message);
    }
  }
  return all;
}
