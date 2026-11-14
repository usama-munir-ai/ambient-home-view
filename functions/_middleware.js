// Access gate — Cloudflare Pages middleware, enforced at the edge on every
// request (pages, scripts, styles, /api/*).
//
// Set ACCESS_CODE in the Pages project's environment variables to enable;
// when unset the site is open. Visiting without the cookie shows a minimal
// inline code prompt (no external assets, so nothing leaks past the gate).
// The form POSTs the code so it never lands in URLs, history or logs; a
// ?code= link still works for devices where typing is painful (TVs). A match
// sets a year-long HttpOnly cookie holding a SHA-256 of the code (never the
// code itself) and redirects.
//
// There is no attempt limiting (that needs storage), so pick a long code.

const COOKIE = "ambient_access";

const GATE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compare two equal-length hex digests without an early exit.
function sameDigest(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function submittedCode(request, url) {
  if (request.method === "POST") {
    const type = request.headers.get("content-type") || "";
    if (!type.includes("application/x-www-form-urlencoded")) return null;
    const form = await request.formData();
    const value = form.get("code");
    return typeof value === "string" ? value : null;
  }
  return url.searchParams.get("code");
}

export async function onRequest({ request, env, next }) {
  const code = env.ACCESS_CODE || "";
  if (!code) return next(); // gate disabled until configured

  const expected = await sha256Hex(COOKIE + "|" + code);
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([a-f0-9]{64})"));
  if (match && sameDigest(match[1], expected)) return next(); // authorized

  const url = new URL(request.url);
  const attempt = await submittedCode(request, url);
  if (attempt !== null && sameDigest(await sha256Hex(COOKIE + "|" + attempt), expected)) {
    url.searchParams.delete("code");
    // Collapse leading slashes so "//host" can never become the redirect target.
    const path = "/" + url.pathname.replace(/^\/+/, "");
    const query = url.searchParams.toString();
    return new Response(null, {
      status: 303,
      headers: {
        ...GATE_HEADERS,
        Location: path + (query ? "?" + query : ""),
        "Set-Cookie": `${COOKIE}=${expected}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax`,
      },
    });
  }

  return new Response(gateHtml(attempt !== null), {
    status: 401,
    headers: { ...GATE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

function gateHtml(wrongCode) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ambient Home View</title>
<style>
  html, body { margin: 0; height: 100%; background: #0b0f16; color: #e8edf5;
    font-family: Georgia, 'Times New Roman', serif; }
  .wrap { height: 100%; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 14px; text-align: center; padding: 16px; box-sizing: border-box; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #d8b46a; }
  h1 { margin: 0; font-size: 19px; font-weight: 500; font-style: italic; letter-spacing: 0.02em; }
  form { display: flex; gap: 8px; }
  input { width: 150px; padding: 8px 12px; border-radius: 999px; border: 1px solid #2c3648;
    background: #131927; color: #e8edf5; font-size: 15px; text-align: center; outline: none; }
  input:focus { border-color: #d8b46a; }
  button { padding: 8px 16px; border-radius: 999px; border: 1px solid #d8b46a;
    background: #d8b46a; color: #1a1208; font-size: 14px; font-weight: 600; cursor: pointer; }
  .err { margin: 0; font-size: 12px; color: #e2685c; min-height: 15px; font-family: system-ui, sans-serif; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="dot"></div>
    <h1>Ambient Home View</h1>
    <form method="post">
      <input type="password" name="code" placeholder="Access code" autofocus autocomplete="current-password">
      <button type="submit">Enter</button>
    </form>
    <p class="err">${wrongCode ? "That code didn't match — try again." : ""}</p>
  </div>
</body>
</html>`;
}
