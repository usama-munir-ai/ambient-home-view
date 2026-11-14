// Family photos via a Google service account — the only Google permission a
// self-hosted deployment holds is read access to ONE shared Drive folder.
//
//   GET /api/photos            → { items: [{ id, name, mimeType, thumbnailLink,
//                                  createdTime, imageMediaMetadata }] }
//   GET /api/photos?img=<id>   → 302 to a fresh thumbnail URL (&sz=1280 size)
//
// Env (Cloudflare Pages → Settings → Environment variables):
//   DRIVE_SA_JSON         full service-account key JSON (preferred), or:
//   DRIVE_SA_EMAIL        client_email
//   DRIVE_SA_PRIVATE_KEY  private_key PEM ("\n" escapes tolerated)
//   DRIVE_FOLDER_ID       the shared folder's id (required)
//   PHOTOS_ALLOW_PUBLIC   "true" to serve photos without ACCESS_CODE (only
//                         when something else, e.g. Cloudflare Access, gates
//                         the site). Otherwise photos need the access gate.
//
// No SDK: the JWT is signed with WebCrypto and exchanged at Google's token
// endpoint directly. Token + listing are cached in module scope while the
// isolate stays warm.

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const LIST_TTL_MS = 5 * 60 * 1000;

let cachedToken = null; // { token, exp }
let cachedList = null;  // { at, items }

function credentials(env) {
  const json = env.DRIVE_SA_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.client_email && parsed.private_key) {
        return { email: parsed.client_email, key: parsed.private_key };
      }
    } catch { /* fall through to split vars */ }
  }
  const email = env.DRIVE_SA_EMAIL || "";
  const key = (env.DRIVE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (email && key) return { email, key };
  return null;
}

const enc = new TextEncoder();
function b64url(input) {
  const bytes = typeof input === "string" ? enc.encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function getAccessToken(env) {
  if (cachedToken && Date.now() < cachedToken.exp - 60_000) return cachedToken.token;
  const creds = credentials(env);
  if (!creds) throw new Error("service account not configured");

  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss: creds.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const key = await importPrivateKey(creds.key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const jwt = unsigned + "." + b64url(signature);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") +
      "&assertion=" + encodeURIComponent(jwt),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new Error("token exchange failed (" + res.status + ") " + (body?.error_description || ""));
  }
  cachedToken = { token: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function driveGet(path, token) {
  const res = await fetch(DRIVE + path, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("drive " + res.status + " on " + path.split("?")[0]);
  return res.json();
}

async function listFolder(folderId, token) {
  if (cachedList && Date.now() - cachedList.at < LIST_TTL_MS) return cachedList.items;
  const items = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/' and trashed=false`);
    const fields = encodeURIComponent(
      "nextPageToken,files(id,name,mimeType,thumbnailLink,createdTime,imageMediaMetadata(time,width,height))"
    );
    const page = await driveGet(
      `/files?q=${q}&fields=${fields}&pageSize=200&orderBy=createdTime desc` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
      token
    );
    for (const f of page.files || []) {
      if (f.id && f.thumbnailLink) items.push(f);
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken && items.length < 500);
  cachedList = { at: Date.now(), items };
  return items;
}

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

export async function onRequestGet({ request, env }) {
  // Same-origin only: this endpoint exists for the page that ships with it.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return json(403, { error: "Forbidden" });

  const folderId = env.DRIVE_FOLDER_ID || "";
  if (!folderId || !/^[\w-]+$/.test(folderId)) return json(501, { error: "DRIVE_FOLDER_ID not configured" });

  // Private photos must never sit on an open URL: without the access gate the
  // listing would be readable by anyone who finds the site.
  if (!env.ACCESS_CODE && env.PHOTOS_ALLOW_PUBLIC !== "true") {
    return json(403, { error: "Photos need ACCESS_CODE set (or PHOTOS_ALLOW_PUBLIC=true)" });
  }

  try {
    const token = await getAccessToken(env);
    const url = new URL(request.url);
    const imgId = url.searchParams.get("img") || "";

    if (imgId) {
      // Fresh per-file thumbnail redirect — the client's fallback when a
      // cached thumbnailLink has expired.
      if (!/^[\w-]+$/.test(imgId)) return json(400, { error: "bad id" });
      const size = Math.min(2048, Math.max(64, Number(url.searchParams.get("sz")) || 1280));
      // Only files in the configured folder, whatever else the account can read.
      const known = await listFolder(folderId, token);
      if (!known.some((item) => item.id === imgId)) return json(404, { error: "not found" });
      const meta = await driveGet(`/files/${imgId}?fields=thumbnailLink`, token);
      const link = meta?.thumbnailLink;
      if (!link) return json(404, { error: "no thumbnail" });
      const sized = /=s\d+(-c)?$/.test(link) ? link.replace(/=s\d+(-c)?$/, "=s" + size) : link;
      return new Response(null, {
        status: 302,
        headers: { Location: sized, "Cache-Control": "private, max-age=300" },
      });
    }

    const items = await listFolder(folderId, token);
    return json(200, { items, syncedAt: Date.now() });
  } catch (err) {
    console.error("[api/photos]", err.message);
    // Details stay in the function log; upstream errors can name the account.
    const unconfigured = /not configured/.test(err.message);
    return json(unconfigured ? 501 : 502, { error: unconfigured ? "Photos not configured" : "Photo source unavailable" });
  }
}
