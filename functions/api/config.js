// GET /api/config — server-side flags the client reads at boot.
// All optional; the static site works without this function at all.

import { photosAllowed } from "../../edge-shared/public-host.js";

// City-level location Cloudflare derives from the visitor's IP at the edge.
// Nothing is stored or logged here; it only tells the page which city's
// weather and prayer times to show.
function visitorLocation(cf) {
  const lat = Number(cf?.latitude);
  const lon = Number(cf?.longitude);
  if (!cf || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    name: cf.city || "",
    region: cf.region || "",
    country: cf.country || "",
    tz: cf.timezone || "",
    lat,
    lon,
  };
}

export async function onRequestGet({ request, env }) {
  const body = {
    mediaProvider: env.MEDIA_PROVIDER || "curated",
    mediaEnabled: env.MEDIA_ENABLED ? env.MEDIA_ENABLED !== "false" : true,
    mediaAttributionMode: env.MEDIA_ATTRIBUTION_MODE || "subtle",
    geo: visitorLocation(request.cf),
    photosEnabled: photosAllowed(request, env),
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
