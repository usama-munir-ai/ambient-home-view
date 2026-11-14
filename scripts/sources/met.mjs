// Met Museum Open Access source.
//
// Two-step: /search → list of objectIDs, then /objects/{id} to expand.
// The Met returns `primaryImage` (full-res, ~3000–6000 wide) and
// `primaryImageSmall` (~600 wide). We use the small for vetting and the
// large for display. CC0 only — guaranteed by `isPublicDomain=true` on
// search and verified on the object payload.

import { getJson, sleep } from "../lib/http.mjs";

const API = "https://collectionapi.metmuseum.org/public/collection/v1";

export async function fetchCandidates(recipe) {
  const all = [];
  const queries = recipe.queries || [];
  for (const q of queries) {
    try {
      const ids = await search(q, recipe.perQuery || 60);
      const sliced = ids.slice(0, recipe.perQuery || 60);
      for (let i = 0; i < sliced.length; i += 1) {
        const id = sliced[i];
        try {
          const obj = await getJson(`${API}/objects/${id}`);
          await sleep(80); // Be polite — the Met has no published rate limit but courtesy matters
          if (!obj?.primaryImage || !obj.isPublicDomain) continue;
          const w = Number(obj.measurements?.[0]?.elementMeasurements?.Width) || 0;
          const h = Number(obj.measurements?.[0]?.elementMeasurements?.Height) || 0;
          all.push({
            provider: "met",
            sourceKey: `met-${id}`,
            displayUrl: obj.primaryImage,
            credit: formatCredit(obj),
            license: "CC0 (Met Museum Open Access)",
            sourceUrl: obj.objectURL || `https://www.metmuseum.org/art/collection/search/${id}`,
            suggestedTags: recipe.tagsBase || [],
            suggestedFrames: recipe.frames,
          });
        } catch { /* skip object */ }
      }
    } catch (err) {
      console.warn(`  [met] query ${JSON.stringify(q)} failed:`, err.message);
    }
  }
  return all;
}

function formatCredit(obj) {
  const artist = (obj.artistDisplayName || "").trim();
  const title = (obj.title || "Met Museum object").trim();
  if (artist) return `${artist} · "${title}" · The Met (CC0)`;
  return `${title} · The Met (CC0)`;
}

async function search(query, max) {
  const params = new URLSearchParams({
    hasImages: "true",
    isPublicDomain: "true",
  });
  if (query.departmentId) params.set("departmentId", String(query.departmentId));
  if (query.medium) params.set("medium", query.medium);
  if (query.geoLocation) params.set("geoLocation", query.geoLocation);
  if (query.q) params.set("q", query.q);
  else params.set("q", query.term || "*");
  const data = await getJson(`${API}/search?${params.toString()}`);
  const ids = Array.isArray(data?.objectIDs) ? data.objectIDs : [];
  // Met returns ids in object number order — randomize lightly so we don't
  // always hit the same head of the list
  const shuffled = ids.slice(0, Math.min(ids.length, max * 3));
  return shuffled;
}
