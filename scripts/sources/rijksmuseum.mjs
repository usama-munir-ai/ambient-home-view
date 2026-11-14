// Rijksmuseum / Rijksstudio source.
//
// Free API key required (one-time signup at rijksmuseum.nl/en/api).
// Set RIJKSMUSEUM_API_KEY. When absent, this source is skipped.
//
// Returns paintings with `webImage.url` — typically 2500–4000 wide, plenty
// of resolution for the splash. Excellent for the contemplative + grounded
// quote moods (Dutch landscapes, still life, library interiors).

import { getJson } from "../lib/http.mjs";

const API = "https://www.rijksmuseum.nl/api/en/collection";

export async function fetchCandidates(recipe) {
  const apiKey = process.env.RIJKSMUSEUM_API_KEY || "";
  if (!apiKey) {
    console.warn("  [rijksmuseum] no RIJKSMUSEUM_API_KEY in env — skipping");
    return [];
  }
  const out = [];
  for (const q of recipe.queries || []) {
    try {
      const rows = await search(apiKey, q, recipe.perQuery || 40);
      rows.forEach((row) => out.push(row));
    } catch (err) {
      console.warn(`  [rijksmuseum] query ${JSON.stringify(q)} failed:`, err.message);
    }
  }
  return out.map((row) => ({
    provider: "rijksmuseum",
    sourceKey: `rks-${row.objectNumber}`,
    displayUrl: row.imageUrl,
    credit: `${row.principalOrFirstMaker || "Rijksmuseum"} · "${row.title}" · Rijksmuseum (CC0)`,
    license: "CC0 (Rijksmuseum)",
    sourceUrl: row.links?.web || `https://www.rijksmuseum.nl/en/collection/${row.objectNumber}`,
    suggestedTags: recipe.tagsBase || [],
    suggestedFrames: recipe.frames,
  }));
}

async function search(apiKey, query, max) {
  const params = new URLSearchParams({
    key: apiKey,
    imgonly: "True",
    toppieces: "True",
    ps: String(Math.min(100, max)),
    s: "relevance",
  });
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  if (query.material) params.set("material", query.material);
  const data = await getJson(`${API}?${params.toString()}`);
  const objs = data?.artObjects || [];
  return objs
    .filter((o) => o?.webImage?.url)
    .map((o) => ({
      objectNumber: o.objectNumber,
      title: (o.title || "").trim(),
      principalOrFirstMaker: (o.principalOrFirstMaker || "").trim(),
      imageUrl: o.webImage.url,
      links: o.links,
    }));
}
