// Photos frame — shared-folder slideshow.
//
// Single source: the shared Drive folder, synced through our own /api/photos
// service-account endpoint (drive.js). No Google sign-in anywhere in the app.
// Cinematics: shuffled no-repeat deck, slow Ken Burns pan/zoom, long
// crossfade, and a soft caption with the photo's month + the current time.

import { PHOTO_SLIDE_MS } from "./constants.js";
import { $, isCompactViewport } from "./util.js";
import { getDriveItems, drivePhotoUrl, driveFallbackUrl, syncDrivePhotos, getDriveSyncError } from "./drive.js";
import { getPrefs } from "./prefs.js";

let slideTimer = null;
let slideUsesPrimary = true;
let mounted = false;

// Shuffled play order over the active entry list.
let deck = [];
let deckPos = 0;
let deckSize = 0;
let lastShownIndex = -1;
let kbToggle = false;

export function showPhotosFrame() {
  ensureMount();
  syncPhotosUI();
}

export function leavePhotosFrame() {
  stopSlideshow();
}

function ensureMount() {
  if (mounted) return;
  const stage = $("photosStage");
  stage.innerHTML = `
    <div id="photosEmpty" class="photos-empty">
      <div class="photos-empty-card">
        <div class="photos-empty-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="10" r="1.6"/><path d="m21 16-5-5L5 21"/></svg>
        </div>
        <h2 id="photosEmptyTitle">Photo slideshow</h2>
        <p id="photosEmptyDesc"></p>
        <div class="photos-empty-actions">
          <button type="button" class="photos-action primary" id="photosPrimary" data-action="scan-drive">Scan now</button>
        </div>
        <span class="photos-status" id="photosStatus"></span>
      </div>
    </div>
    <div id="photosSlideshow" class="photo-slideshow">
      <div class="slide-layer visible" id="slideA"></div>
      <div class="slide-layer" id="slideB"></div>
      <div class="photo-caption" id="photoCaption"></div>
      <div class="photo-time" id="photoTime"></div>
    </div>
  `;

  $("photosEmpty").addEventListener("click", (e) => {
    const btn = e.target.closest(".photos-action");
    if (!btn || btn.dataset.action !== "scan-drive") return;
    renderState("scanning");
    syncDrivePhotos(true).then(() => syncPhotosUI()).catch(() => syncPhotosUI());
  });

  $("photosSlideshow").addEventListener("click", () => {
    if (slideTimer) stopSlideshow(); else startSlideshow();
  });

  mounted = true;
}

export function syncPhotosUI() {
  ensureMount();
  if (getActiveEntries().length) {
    renderState("ready");
    return;
  }
  renderState("drive-empty");
}

function renderState(stateName) {
  const empty = $("photosEmpty");
  const slideshow = $("photosSlideshow");
  const desc = $("photosEmptyDesc");
  const status = $("photosStatus");

  const showSlideshow = stateName === "ready" && getActiveEntries().length > 0;
  slideshow.classList.toggle("visible", showSlideshow);
  empty.classList.toggle("hidden", showSlideshow);

  if (showSlideshow) {
    status.classList.remove("visible");
    startSlideshow();
    return;
  }
  stopSlideshow();

  if (stateName === "scanning") {
    desc.textContent = "Checking the shared Drive folder for photos.";
    status.textContent = "Scanning…";
    status.classList.add("visible");
    return;
  }

  const err = getDriveSyncError();
  desc.textContent = err?.status === 501
    ? "The server isn't connected to the photo folder yet — add DRIVE_SA_JSON and DRIVE_FOLDER_ID in Cloudflare Pages and redeploy."
    : "From Google Photos on your phone: select pictures → Share → Save to Drive → the shared portal folder. They'll show up here on their own.";
  status.classList.remove("visible");
  status.textContent = "";
}

// ---------- Entries & slides ----------
/** Slideshow entries from the Drive cache: { url, label, item }. */
function getActiveEntries() {
  return getDriveItems().map((item) => ({
    url: drivePhotoUrl(item, isCompactViewport() ? 1280 : 3840),
    label: photoMonthLabel(item),
    item,
  })).filter((e) => e.url);
}

function isPortrait(item) {
  const m = item?.imageMediaMetadata;
  return !!m && Number(m.height) > Number(m.width);
}

/**
 * Build the slide list: landscape photos play solo (full-bleed), portrait
 * photos are paired side-by-side so the landscape screen fills with no
 * letterboxing; a leftover odd portrait plays over a blurred copy of itself.
 */
function buildSlides() {
  const landscape = [];
  const portraits = [];
  for (const e of getActiveEntries()) {
    (isPortrait(e.item) ? portraits : landscape).push(e);
  }
  // Shuffle portraits before pairing so the couples vary deck to deck.
  for (let i = portraits.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [portraits[i], portraits[j]] = [portraits[j], portraits[i]];
  }
  const slides = landscape.map((e) => ({ kind: "single", entries: [e] }));
  for (let i = 0; i + 1 < portraits.length; i += 2) {
    slides.push({ kind: "pair", entries: [portraits[i], portraits[i + 1]] });
  }
  if (portraits.length % 2 === 1) {
    slides.push({ kind: "solo", entries: [portraits[portraits.length - 1]] });
  }
  return slides;
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function photoMonthLabel(item) {
  // EXIF capture time first ("2024:06:11 18:03:22"), upload time second.
  const exif = item?.imageMediaMetadata?.time || "";
  const m = exif.match(/^(\d{4}):(\d{2})/);
  if (m) {
    const month = MONTHS[Number(m[2]) - 1];
    if (month) return `${month} ${m[1]}`;
  }
  const created = Date.parse(item?.createdTime || "");
  if (Number.isFinite(created)) {
    const d = new Date(created);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  return "";
}

// ---------- Slideshow ----------
function reshuffleDeck(count) {
  deck = Array.from({ length: count }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // Don't repeat the photo that just played across the shuffle boundary.
  if (deck.length > 1 && deck[0] === lastShownIndex) {
    [deck[0], deck[1]] = [deck[1], deck[0]];
  }
  deckPos = 0;
  deckSize = count;
}

function nextDeckIndex(count) {
  if (count <= 0) return -1;
  if (!deck.length || deckPos >= deck.length || deckSize !== count) reshuffleDeck(count);
  const idx = deck[deckPos];
  deckPos += 1;
  lastShownIndex = idx;
  return idx;
}

function applyKenBurns(img) {
  if (!getPrefs().kenBurns) return;
  kbToggle = !kbToggle;
  img.style.setProperty("--kb-ox", `${Math.round(20 + Math.random() * 60)}%`);
  img.style.setProperty("--kb-oy", `${Math.round(20 + Math.random() * 60)}%`);
  img.classList.add(kbToggle ? "kb-in" : "kb-out");
}

/** Build an <img> for one entry, with one fallback retry via the API. */
function slideImg(entry) {
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.loading = "eager";
  img.onerror = () => {
    if (img.dataset.retried) return;
    img.dataset.retried = "1";
    // Expired thumbnailLink: re-sync metadata in the background and retry
    // through the API's fresh-thumbnail redirect.
    void syncDrivePhotos(true);
    const fallback = driveFallbackUrl(entry.item);
    if (fallback) img.src = fallback;
  };
  img.src = entry.url;
  applyKenBurns(img);
  return img;
}

function showSlide(slide, primaryLayer) {
  const layerA = $("slideA");
  const layerB = $("slideB");
  if (!layerA || !layerB || !slide?.entries?.length) return;
  const layer = primaryLayer ? layerA : layerB;
  const other = primaryLayer ? layerB : layerA;

  layer.innerHTML = "";
  if (slide.kind === "pair") {
    const row = document.createElement("div");
    row.className = "slide-collage";
    for (const entry of slide.entries) {
      const cell = document.createElement("div");
      cell.className = "slide-cell";
      cell.appendChild(slideImg(entry));
      row.appendChild(cell);
    }
    layer.appendChild(row);
  } else if (slide.kind === "solo") {
    // Odd portrait: blurred copy of itself fills the frame behind it.
    const entry = slide.entries[0];
    const blur = document.createElement("img");
    blur.className = "slide-blur-backdrop";
    blur.alt = "";
    blur.src = entry.url;
    const fit = slideImg(entry);
    fit.className = "slide-fit";
    layer.appendChild(blur);
    layer.appendChild(fit);
  } else {
    layer.appendChild(slideImg(slide.entries[0]));
  }
  layer.classList.add("visible");
  other.classList.remove("visible");

  const captionEl = $("photoCaption");
  if (captionEl) {
    const labels = [...new Set(slide.entries.map((e) => e.label).filter(Boolean))];
    const caption = labels.join(" · ");
    captionEl.textContent = caption;
    captionEl.classList.toggle("visible", !!caption);
  }
  const timeEl = $("photoTime");
  if (timeEl) {
    timeEl.textContent = new Date().toLocaleString(undefined, {
      weekday: "short", hour: "numeric", minute: "2-digit",
    });
  }
}

let slides = [];

function advanceSlide() {
  if (!slides.length) { stopSlideshow(); return; }
  const idx = nextDeckIndex(slides.length);
  slideUsesPrimary = !slideUsesPrimary;
  showSlide(slides[idx], slideUsesPrimary);
  // Preload the next slide's photos.
  const peek = deckPos < deck.length ? deck[deckPos] : -1;
  if (peek >= 0 && slides[peek]) {
    for (const e of slides[peek].entries) { const pre = new Image(); pre.src = e.url; }
  }
}

function startSlideshow() {
  slides = buildSlides();
  if (!slides.length) return;
  stopSlideshow();
  reshuffleDeck(slides.length);
  slideUsesPrimary = false; // advanceSlide flips it to true for the first slide
  advanceSlide();
  slideTimer = setInterval(advanceSlide, PHOTO_SLIDE_MS);
}

function stopSlideshow() {
  if (slideTimer) clearInterval(slideTimer);
  slideTimer = null;
}

export function hasPhotosPicked() {
  return getActiveEntries().length > 0;
}
