// Smithsonian Open Access source.
//
// Filters with `cc0:true` so every result is public-domain dedicated.
// Free api.data.gov key required: set SMITHSONIAN_API_KEY (or the wider
// DATA_GOV_API_KEY). When the key is absent, this source is skipped — the
// rest of the curator continues unaffected.

import { getJson } from "../lib/http.mjs";

const API = "https://api.si.edu/openaccess/api/v1.0";

export async function fetchCandidates(recipe) {
  const apiKey = process.env.SMITHSONIAN_API_KEY || process.env.DATA_GOV_API_KEY || "";
  if (!apiKey) {
    console.warn("  [smithsonian] no SMITHSONIAN_API_KEY in env — skipping");
    return [];
  }
  const out = [];
  for (const q of recipe.queries || []) {
    try {
      const rows = await searchOpenAccess(apiKey, q, recipe.perQuery || 40);
      rows.forEach((row) => out.push(row));
    } catch (err) {
      console.warn(`  [smithsonian] query "${q}" failed:`, err.message);
    }
  }
  return out.map((row) => ({
    provider: "smithsonian",
    sourceKey: `si-${row.id}`,
    displayUrl: row.imageUrl,
    credit: `${row.title || "Smithsonian object"} · Smithsonian Open Access (CC0)`,
    license: "CC0 (Smithsonian Open Access)",
    sourceUrl: row.recordUrl || "https://www.si.edu/openaccess",
    suggestedTags: recipe.tagsBase || [],
    suggestedFrames: recipe.frames,
  }));
}

async function searchOpenAccess(apiKey, query, max) {
  const params = new URLSearchParams({
    api_key: apiKey,
    q: `${query} AND online_media_type:Images AND media_usage:CC0`,
    rows: String(Math.min(100, max)),
  });
  const data = await getJson(`${API}/search?${params.toString()}`);
  const rows = data?.response?.rows || [];
  return rows.map(extractRow).filter(Boolean);
}

function extractRow(row) {
  const id = row.id || row.objectId || "";
  const title = row.title || row.content?.descriptiveNonRepeating?.title?.content || "";
  const recordUrl = row.content?.descriptiveNonRepeating?.record_link || "";
  const media = row.content?.descriptiveNonRepeating?.online_media?.media || [];
  const img = media.find((m) => m && m.type === "Images" && (m.content || m.resources));
  if (!img) return null;
  let imageUrl = img.content || "";
  let thumbUrl = "";
  const resources = Array.isArray(img.resources) ? img.resources : [];
  for (const r of resources) {
    if (!r?.url) continue;
    if (/screen|large|2400|1200|hi/i.test(r.label || r.url)) imageUrl = r.url;
    if (/thumb|small|300|600/i.test(r.label || r.url)) thumbUrl = r.url;
  }
  if (!imageUrl) return null;
  return { id, title, recordUrl, imageUrl, thumbUrl };
}
