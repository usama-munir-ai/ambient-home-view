// Tiny HTTP helper for the curator. Adds a polite User-Agent (Wikimedia and
// Met are happier when they can identify the caller), timeouts, and a retry
// for the kind of transient 5xx that always shows up on long crawls.

const DEFAULT_UA = "PortalDashboardCurator/1.0 (+https://github.com/) static-site curator";

export async function getJson(url, opts = {}) {
  const res = await getResponse(url, opts);
  if (!res.ok) {
    throw new Error(`GET ${redact(url)} → ${res.status}`);
  }
  return res.json();
}

export async function getBuffer(url, opts = {}) {
  const res = await getResponse(url, opts);
  if (!res.ok) {
    throw new Error(`GET ${redact(url)} → ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function getResponse(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 15000;
  const retries = opts.retries ?? 2;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": opts.userAgent || DEFAULT_UA,
          Accept: opts.accept || "application/json, image/*;q=0.9, */*;q=0.5",
          ...(opts.headers || {}),
        },
      });
      clearTimeout(timer);
      // Retry on 429 (rate-limited) and 5xx. Honor Retry-After when present.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const wait = retryAfter > 0 ? retryAfter * 1000 : 600 * (attempt + 1);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr || new Error(`GET ${redact(url)} failed`);
}

// Several sources take their API key as a query parameter.
function redact(url) {
  return String(url).split("?")[0];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
