#!/usr/bin/env node
// Build-time curator. The art direction lives in scripts/recipes.mjs;
// this file just orchestrates: gather candidates from sources, vet each
// with sharp, dedupe, append to public/data/splash-manifest.json.
//
// Usage:
//   npm run curate:splash                       # all frames
//   npm run curate:splash -- --frame prayer      # one frame
//   npm run curate:splash -- --frame all --max 200
//   npm run curate:splash -- --dry               # vet only, do not write
//
// Env (all optional):
//   NASA_API_KEY            - lifts APOD rate limit (DEMO_KEY otherwise)
//   SMITHSONIAN_API_KEY     - enables Smithsonian Open Access source
//   RIJKSMUSEUM_API_KEY     - enables Rijksmuseum source

import { RECIPES } from "./recipes.mjs";
import { vetImageUrl } from "./lib/vet.mjs";
import { buildCaption, resolveLocation } from "./lib/caption.mjs";
import { readManifest, writeManifest, mergeEntries, makeId, indexExisting } from "./lib/manifest.mjs";

import * as wikimedia from "./sources/wikimedia.mjs";
import * as met from "./sources/met.mjs";
import * as nasa from "./sources/nasa.mjs";
import * as smithsonian from "./sources/smithsonian.mjs";
import * as rijksmuseum from "./sources/rijksmuseum.mjs";
import * as pexels from "./sources/pexels.mjs";

const SOURCES = {
  wikimedia,
  met,
  nasa,
  smithsonian,
  rijksmuseum,
  pexels,
};

const NON_MASTERSHOT_RE =
  /\b(portrait|selfie|person|woman|man|girl|boy|child|couple|wedding|bride|groom|cat|dog|bird|insect|spider|macro|close[\s_-]*up|food|dish|plate|coffee|tea|room|bedroom|kitchen|bathroom|interior|indoors|painting|drawing|sketch|engraving|lithograph|stamp|coin|medal|statue|sculpture|bust|artifact|manuscript|diagram|map|chart|coat[\s_-]*of[\s_-]*arms|logo|flag|plaquette|poster|book)\b/i;

function isWideMasterShotCandidate(c) {
  const loc = resolveLocation(c);
  if (!loc?.place || !loc?.tz) return false;
  if (c.width && c.height && c.width / c.height < 1.45) return false;
  const text = [c.caption, c.alt, c.sourceKey, c.sourceUrl].filter(Boolean).join(" ");
  if (NON_MASTERSHOT_RE.test(text)) return false;
  return true;
}

const WORLD_CARD_ASSET_RE = /\/world clock_.*_01\.png$/i;

function sanitizeHomeManifest(manifest) {
  for (const img of manifest.images || []) {
    if (img.provider === "pexels" && typeof img.src === "string" && img.src.includes("images.pexels.com/photos/")) {
      const base = img.src.split("?")[0];
      img.src = `${base}?auto=compress&cs=tinysrgb&w=3840`;
    }
    if (WORLD_CARD_ASSET_RE.test(img.src || "")) {
      img.frames = ["world"];
    }
    if (!img.place || !img.tz) {
      const loc = resolveLocation(img);
      if (loc) {
        img.place = loc.place;
        img.country = loc.country;
        img.tz = loc.tz;
        img.caption = loc.country ? `${loc.place} · ${loc.country}` : loc.place;
      }
    }
    if (Array.isArray(img.frames) && img.frames.includes("home")) {
      const text = [img.caption, img.id, img.sourceUrl].filter(Boolean).join(" ");
      const badTags = (img.tags || []).some((t) =>
        ["painting", "manuscript", "calligraphy", "artwork", "folio", "interior", "ai-scene"].includes(t)
      );
      if (!img.place || !img.tz || badTags || NON_MASTERSHOT_RE.test(text)) {
        img.frames = img.frames.filter((f) => f !== "home");
      }
    }
  }
}
const args = parseArgs(process.argv.slice(2));
const onlyFrame = args.frame || "all";
const dryRun = !!args.dry;
const perFrameMax = args.max ? Number(args.max) : null;

run().catch((err) => {
  console.error("[curator] fatal:", err);
  process.exit(1);
});

async function run() {
  const manifest = await readManifest();
  sanitizeHomeManifest(manifest);
  const beforeCount = manifest.images.length;
  console.log(`[curator] starting with ${beforeCount} images in manifest`);

  const frames = onlyFrame === "all" ? Object.keys(RECIPES) : [onlyFrame];
  const newEntries = [];

  for (const frameKey of frames) {
    const recipe = RECIPES[frameKey];
    if (!recipe) {
      console.warn(`[curator] no recipe for "${frameKey}", skipping`);
      continue;
    }
    const target = perFrameMax || recipe.target || 60;
    console.log(`\n[curator] ─── ${frameKey} (target ${target}) ───`);

    // 1. Gather candidates from every source in the recipe
    const candidates = [];
    for (const sourceRecipe of recipe.sources || []) {
      const provider = SOURCES[sourceRecipe.type];
      if (!provider) {
        console.warn(`  [curator] unknown source "${sourceRecipe.type}"`);
        continue;
      }
      console.log(`  [${sourceRecipe.type}] gathering…`);
      try {
        const fromSource = await provider.fetchCandidates(sourceRecipe);
        console.log(`  [${sourceRecipe.type}] ${fromSource.length} candidates`);
        candidates.push(...fromSource);
      } catch (err) {
        console.warn(`  [${sourceRecipe.type}] failed: ${err.message}`);
      }
    }
    console.log(`  total candidates: ${candidates.length}`);

    // 2. Dedupe by displayUrl AND against the existing manifest
    const { byId, bySrc } = indexExisting(manifest);
    const seenUrls = new Set([...bySrc.keys()]);
    const seenIds = new Set([...byId.keys()]);
    // Also dedupe within new entries already accepted this run
    newEntries.forEach((e) => {
      seenIds.add(e.id);
      seenUrls.add(e.src);
    });
    const fresh = candidates.filter((c) => {
      if (!c.displayUrl || seenUrls.has(c.displayUrl)) return false;
      const homeBound = (c.suggestedFrames || []).includes("home") || frameKey === "home";
      if (homeBound && !isWideMasterShotCandidate(c)) return false;
      return true;
    });
    console.log(`  fresh (after URL dedupe vs manifest): ${fresh.length}`);

    // 3. Shuffle (deterministic) + cap to a reasonable vetting budget
    shuffleStable(fresh, frameKey);
    const budgetMult = Number(args.budget) || 6;
    const vettingBudget = Math.min(fresh.length, target * budgetMult);
    const toVet = fresh.slice(0, vettingBudget);
    const concurrency = Number(args.concurrency) || 5;
    console.log(`  vetting ${toVet.length} candidates (budget = target×${budgetMult}), concurrency ${concurrency}`);

    // 4. Vet each one. Stop when we hit the target. Concurrency keeps the
    //    network busy — vetting is the long pole of this whole pipeline.
    let accepted = 0;
    let rejected = 0;
    const rejectReasons = new Map();
    const queue = toVet.slice();
    let stopped = false;

    async function worker() {
      while (!stopped && queue.length) {
        const c = queue.shift();
        if (!c) break;
        if (accepted >= target) { stopped = true; break; }
        const id = makeId(c.provider, c.sourceKey, c.displayUrl);
        if (seenIds.has(id)) continue;
        // Home wallpapers must have real negative space (the clock/cards sit
        // on top), so vet them with the stricter quiet-area gate.
        const homeBound = (c.suggestedFrames || []).includes("home") || frameKey === "home";
        const vetted = await vetImageUrl(c.displayUrl, { strictQuiet: homeBound });
        if (accepted >= target) { stopped = true; break; }
        if (!vetted.ok) {
          rejected += 1;
          rejectReasons.set(vetted.reason, (rejectReasons.get(vetted.reason) || 0) + 1);
          if ((accepted + rejected) % 25 === 0) {
            process.stdout.write(`    progress: ${accepted} accepted / ${rejected} rejected\n`);
          }
          continue;
        }
        const entry = buildEntry({ candidate: c, vetted, frameKey, id });
        if (!entry.frames.length) {
          rejected += 1;
          rejectReasons.set("missing home location/tz", (rejectReasons.get("missing home location/tz") || 0) + 1);
          continue;
        }
        newEntries.push(entry);
        seenIds.add(id);
        seenUrls.add(c.displayUrl);
        accepted += 1;
        if (accepted % 10 === 0) {
          process.stdout.write(`    progress: ${accepted} accepted / ${rejected} rejected\n`);
        }
      }
    }

    // Concurrency 5 keeps Wikimedia's per-IP rate limit happy. Bump via
    // --concurrency once you've established a friendly baseline.
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    console.log(`  ✓ ${frameKey}: +${accepted} accepted, ${rejected} rejected`);
    if (rejectReasons.size) {
      const top = [...rejectReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      top.forEach(([why, n]) => console.log(`     · ${n}× ${why}`));
    }
  }

  // 5. Merge into manifest and write
  const result = mergeEntries(manifest, newEntries);
  console.log(`\n[curator] merge: +${result.added} new, ${result.skipped} skipped (dup)`);
  console.log(`[curator] manifest: ${beforeCount} → ${result.total}`);

  if (dryRun) {
    console.log("[curator] --dry: not writing manifest");
    return;
  }
  await writeManifest(manifest);
  console.log("[curator] wrote public/data/splash-manifest.json");
}

function buildEntry({ candidate, vetted, frameKey, id }) {
  // Compose the tag set: recipe base + palette warmth + frame implication
  const tags = new Set();
  (candidate.suggestedTags || []).forEach((t) => tags.add(t));
  tags.add(vetted.palette.warmth); // warm/cool/neutral
  if (vetted.palette.isLight) tags.add("light");
  // Sensible defaults — most editorial library / sacred scenes are mood-flexible
  if (frameKey === "home") {
    tags.add("expansive");
  }
  if (frameKey === "cal") {
    tags.add("grounded");
    tags.add("contemplative");
  }
  if (frameKey === "prayer" || frameKey === "quran") {
    tags.add("sacred");
    tags.add("reverent");
  }

  // Frames — use suggestedFrames if present, otherwise the source's frame
  const frames = Array.from(new Set([
    frameKey,
    ...(candidate.suggestedFrames || []),
  ]));

  const loc = resolveLocation(candidate);
  let finalFrames = frames;
  if (!loc?.tz && finalFrames.includes("home")) {
    finalFrames = finalFrames.filter((f) => f !== "home");
  }

  const entry = {
    id,
    src: candidate.displayUrl,
    credit: candidate.credit || "Curated library",
    palette: vetted.palette,
    quietSide: vetted.quietSide,
    // Negative-space placement hints (optional; consumed by the runtime
    // curator + adaptive layout). Older entries simply lack these.
    quietRegion: vetted.quietRegion,
    quietLum: vetted.quietLum,
    negSpace: vetted.negSpace,
    tags: Array.from(tags),
    frames: finalFrames,
    provider: candidate.provider,
    sourceUrl: candidate.sourceUrl || "",
    license: candidate.license || "",
  };
  if (loc) {
    entry.place = loc.place;
    entry.country = loc.country;
    entry.tz = loc.tz;
    entry.caption = loc.country ? `${loc.place} · ${loc.country}` : loc.place;
  } else {
    const caption = buildCaption(candidate);
    if (caption) entry.caption = caption;
  }
  return entry;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry") out.dry = true;
    else if (a === "--frame") out.frame = argv[++i];
    else if (a === "--max") out.max = argv[++i];
    else if (a === "--budget") out.budget = argv[++i];
    else if (a === "--concurrency") out.concurrency = argv[++i];
  }
  return out;
}

function shuffleStable(arr, seed) {
  // Tiny seeded shuffle — same input + seed, same order. Lets us re-run
  // with deterministic results.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h ^ seed.charCodeAt(i)) * 16777619;
  }
  for (let i = arr.length - 1; i > 0; i -= 1) {
    h = (h * 1664525 + 1013904223) | 0;
    const j = Math.abs(h) % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
