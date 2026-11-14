// GET /api/config — server-side flags the client reads at boot.
// All optional; the static site works without this function at all.

export async function onRequestGet({ env }) {
  const body = {
    mediaProvider: env.MEDIA_PROVIDER || "curated",
    mediaEnabled: env.MEDIA_ENABLED ? env.MEDIA_ENABLED !== "false" : true,
    mediaAttributionMode: env.MEDIA_ATTRIBUTION_MODE || "subtle",
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
