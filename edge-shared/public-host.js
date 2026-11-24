// Hostnames listed in PUBLIC_HOSTNAMES (comma-separated) are the open,
// shareable face of a deployment: no access code, and never any photos.
// Every other hostname keeps the private behaviour, so one Pages project can
// serve a public dashboard on a custom domain and a private family view on
// its pages.dev address. A request for a public host can only ever get less
// access, so a spoofed Host header gains nothing.
export function isPublicHost(request, env) {
  const host = new URL(request.url).hostname.toLowerCase();
  return String(env.PUBLIC_HOSTNAMES || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(host);
}

// Photos are only offered on private hosts, with a Drive folder configured,
// and behind the access gate (or an explicit opt-out when another gate exists).
export function photosAllowed(request, env) {
  if (isPublicHost(request, env)) return false;
  if (!/^[\w-]+$/.test(env.DRIVE_FOLDER_ID || "")) return false;
  return Boolean(env.ACCESS_CODE) || env.PHOTOS_ALLOW_PUBLIC === "true";
}
