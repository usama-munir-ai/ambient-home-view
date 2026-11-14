// Read / merge / write public/data/splash-manifest.json.
// The 22 hand-curated entries are sacred — we never replace or reorder them,
// we only append. Dedup is by `id` (and also by `src` URL just in case).

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MANIFEST_PATH = path.join(process.cwd(), "public", "data", "splash-manifest.json");

export async function readManifest() {
  const raw = await fs.readFile(MANIFEST_PATH, "utf8");
  const json = JSON.parse(raw);
  if (!Array.isArray(json.images)) json.images = [];
  return json;
}

export async function writeManifest(manifest) {
  const text = JSON.stringify(manifest, null, 2) + "\n";
  await fs.writeFile(MANIFEST_PATH, text, "utf8");
}

export function indexExisting(manifest) {
  const byId = new Map();
  const bySrc = new Map();
  for (const img of manifest.images) {
    if (img.id) byId.set(img.id, img);
    if (img.src) bySrc.set(img.src, img);
  }
  return { byId, bySrc };
}

export function makeId(provider, sourceKey, src) {
  const seed = `${provider}|${sourceKey || ""}|${src || ""}`;
  const hash = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10);
  const slug = (sourceKey || provider).toString().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || provider;
  return `${slug}-${hash}`;
}

const SAFE_SRC = /^(\/splash\/|https:\/\/)[^\s'"()\\]+$/;
const SAFE_LINK = /^https:\/\/[^\s"<>]+$/;

// Entries come from third-party APIs and are committed unattended, so strip
// anything that could act as markup and drop entries with unusable URLs.
export function sanitizeEntry(entry) {
  if (!entry || typeof entry.src !== "string" || !SAFE_SRC.test(entry.src)) return null;
  const clean = { ...entry };
  for (const key of ["credit", "license", "place", "country", "caption"]) {
    if (typeof clean[key] === "string") clean[key] = clean[key].replace(/[<>\u0000-\u001f]/g, "").trim();
  }
  if (clean.sourceUrl && !SAFE_LINK.test(String(clean.sourceUrl))) delete clean.sourceUrl;
  return clean;
}

export function mergeEntries(manifest, newEntries) {
  const { byId, bySrc } = indexExisting(manifest);
  let added = 0;
  let skipped = 0;
  for (const raw of newEntries) {
    const entry = sanitizeEntry(raw);
    if (!entry || !entry.id) { skipped += 1; continue; }
    if (byId.has(entry.id) || bySrc.has(entry.src)) { skipped += 1; continue; }
    manifest.images.push(entry);
    byId.set(entry.id, entry);
    bySrc.set(entry.src, entry);
    added += 1;
  }
  return { added, skipped, total: manifest.images.length };
}
