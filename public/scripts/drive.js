// Family photos source — served by our own /api/photos endpoint, which holds
// a Google service account with read access to ONE shared Drive folder.
// No user OAuth, no Google scopes in the browser: photos saved to the folder
// from the phone (Google Photos → Share → Save to Drive) appear on the next
// sync. Only metadata is cached in localStorage; pixels come from each file's
// thumbnailLink (renders without auth), with /api/photos?img=<id> as the
// fresh-redirect fallback when a cached link expires.

import { STORAGE, DRIVE_REFRESH_MS } from "./constants.js";
import { readLS, writeLS } from "./util.js";

let runnerTimer = null;
let syncInFlight = null;
let lastSyncError = null; // { status, at } from the most recent failed sync

/** Most recent sync failure (null after a successful sync). */
export function getDriveSyncError() {
  return lastSyncError;
}

export function getDriveItems() {
  const stored = readLS(STORAGE.driveItems, null);
  if (!stored || !Array.isArray(stored.items)) return [];
  return stored.items.filter((i) => i?.id);
}

export function hasDrivePhotos() {
  return getDriveItems().length > 0;
}

/**
 * Display URL for a Drive image. thumbnailLink arrives sized "=s220"; rewrite
 * to the display size. Links without the suffix (e.g. mock items) pass
 * through unchanged.
 */
export function drivePhotoUrl(item, size = 3840) {
  const link = item?.thumbnailLink || "";
  if (!link) return "";
  if (/=s\d+(-c)?$/.test(link)) return link.replace(/=s\d+(-c)?$/, "=s" + size);
  return link;
}

/** Fallback URL: our API 302s to a freshly fetched thumbnail. */
export function driveFallbackUrl(item, size = 3840) {
  if (!item?.id || String(item.id).startsWith("mock-")) return "";
  return "/api/photos?img=" + encodeURIComponent(item.id) + "&sz=" + size;
}

/**
 * Re-list the folder via /api/photos and persist metadata (incl. fresh
 * thumbnailLinks). Returns the item list, or the cached one on failure.
 */
export async function syncDrivePhotos(force = false) {
  if (syncInFlight) return syncInFlight;

  const stored = readLS(STORAGE.driveItems, null);
  if (!force && stored?.syncedAt && Date.now() - stored.syncedAt < DRIVE_REFRESH_MS) {
    return getDriveItems();
  }

  syncInFlight = (async () => {
    const res = await fetch("/api/photos", { cache: "no-store" });
    if (!res.ok) {
      const err = new Error("photos api " + res.status);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const items = (Array.isArray(data?.items) ? data.items : [])
      .filter((f) => f?.id && f.thumbnailLink)
      .map((f) => ({
        id: f.id,
        name: f.name || "",
        mimeType: f.mimeType || "",
        thumbnailLink: f.thumbnailLink,
        createdTime: f.createdTime || "",
        imageMediaMetadata: f.imageMediaMetadata || null,
      }));
    writeLS(STORAGE.driveItems, { syncedAt: Date.now(), items });
    lastSyncError = null;
    return items;
  })()
    .catch((err) => {
      console.warn("[drive]", err);
      lastSyncError = { status: err?.status || 0, at: Date.now() };
      return getDriveItems();
    })
    .finally(() => { syncInFlight = null; });

  return syncInFlight;
}

/** Periodic re-list keeps thumbnailLinks fresh. Started from boot. */
export function startDriveRunner() {
  void syncDrivePhotos();
  if (runnerTimer) return;
  runnerTimer = setInterval(() => { void syncDrivePhotos(true); }, DRIVE_REFRESH_MS);
}

export function stopDriveRunner() {
  if (runnerTimer) {
    clearInterval(runnerTimer);
    runnerTimer = null;
  }
}
