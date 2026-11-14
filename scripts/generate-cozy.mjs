#!/usr/bin/env node
// Cozy AI scene generator — build-time only, never called from the device.
//
// Generates a matrix of cozy living-room interiors (a warm living room:
// dark chestnut wood, cream cushions, light-brown rattan) whose
// window shows the weather × time-of-day. Two free providers, in order:
//   1. Pollinations.ai — keyless GET, full 1600×1000 FLUX renders, but its
//      anonymous tier 402s when the egress IP's queue slot is taken.
//   2. AI Horde (aihorde.net) — anonymous key "0000000000", crowdsourced
//      GPUs. Anonymous jobs cap at ~704×448, so results are upscaled with
//      sharp; rogue workers sometimes return 512×512, which the source-dims
//      check below rejects (the attempt just retries).
// Images are committed as real JPEGs under public/splash/cozy/ and indexed in
// splash-manifest.json with full concrete weather/tod tag lists so the
// runtime scoring engine picks the matching scene with zero changes.
//
// Usage:
//   npm run curate:cozy                      # generate whatever is missing
//   npm run curate:cozy -- --dry             # plan only
//   npm run curate:cozy -- --max 10          # cap generation attempts this run
//   npm run curate:cozy -- --refresh-oldest 6  # regenerate the 6 oldest files
//
// Both providers are flaky: the workflow runs this with continue-on-error and
// a per-run --max budget; generation is idempotent (stable seeds, skip if the
// file exists), so the matrix fills up across daily runs.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { getBuffer, sleep } from "./lib/http.mjs";
import { vetBuffer } from "./lib/vet.mjs";
import { readManifest, writeManifest } from "./lib/manifest.mjs";

const OUT_DIR = path.join(process.cwd(), "public", "splash", "cozy");
const VARIANTS = 2;
const GEN_WIDTH = 1600;
const GEN_HEIGHT = 1000;
const REQUEST_GAP_MS = 4000;

// Weather groups → the concrete categories the runtime can ask for.
const WEATHER_GROUPS = {
  rain: {
    tags: ["rain-steady", "rain-torrential", "drizzle"],
    scene: "steady rain streaking down the window glass, a wet street below, soft grey sky",
  },
  thunderstorm: {
    tags: ["thunderstorm"],
    scene: "a dramatic thunderstorm outside, dark storm clouds and a distant flash of lightning",
  },
  snow: {
    tags: ["snow-light", "snow-heavy"],
    scene: "soft snow falling outside, snowy rooftops and a quiet white street",
  },
  fog: {
    tags: ["fog"],
    scene: "thick fog outside, trees and buildings fading into pale mist",
  },
  overcast: {
    tags: ["overcast", "partly-cloudy"],
    scene: "a moody overcast sky outside, soft grey clouds drifting",
  },
  clear: {
    tags: ["clear-warm", "heat"],
    scene: "a clear blue sky and warm sunshine outside",
  },
  "clear-cold": {
    tags: ["clear-cold"],
    scene: "a crisp clear cold day outside, pale winter sunlight",
  },
};

// Time-of-day buckets → the concrete tod tags + room lighting.
const TOD_BUCKETS = {
  morning: { tags: ["dawn", "morning"], light: "soft morning sunlight filling the room" },
  day: { tags: ["day"], light: "bright natural daylight" },
  golden: { tags: ["golden", "dusk"], light: "warm golden-hour glow and long soft shadows" },
  night: { tags: ["night", "lateNight"], light: "nighttime, the room lit only by warm table lamps" },
};

// Fireplace reads right on cold scenes and at night; out of place on a clear noon.
function wantsFireplace(group, tod) {
  return tod === "night" || group === "snow" || group === "clear-cold";
}

// At night a "clear blue sky" makes no sense — swap in a starry sky.
function sceneFor(group, tod) {
  if (tod === "night") {
    if (group === "clear") return "a deep blue night sky full of stars above distant city lights";
    if (group === "clear-cold") return "a cold starry winter night sky, moonlight on rooftops";
  }
  return WEATHER_GROUPS[group].scene;
}

function buildPrompt(group, tod) {
  const fireplace = wantsFireplace(group, tod) ? "a lit fireplace glowing softly, " : "";
  return (
    "cozy living room interior, dark chestnut wood furniture, cream cushions, " +
    "light brown rattan armchair, " + fireplace +
    "a huge floor-to-ceiling window on the right showing " + sceneFor(group, tod) + ", " +
    TOD_BUCKETS[tod].light + ", " +
    "photorealistic interior photography, inviting and warm, no people, no text"
  );
}

function stableSeed(group, tod, variant) {
  const h = crypto.createHash("sha1").update(`cozy|${group}|${tod}|${variant}`).digest();
  return h.readUInt32BE(0) % 1000000;
}

function pollinationsUrl(prompt, seed) {
  return "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
    `?width=${GEN_WIDTH}&height=${GEN_HEIGHT}&model=flux&nologo=true&seed=${seed}`;
}

async function fromPollinations(prompt, seed) {
  const buf = await getBuffer(pollinationsUrl(prompt, seed), { timeoutMs: 90000, retries: 1, accept: "image/*" });
  if (!buf || buf.length < 40000 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(`pollinations suspect payload (${buf ? buf.length : 0} bytes)`);
  }
  return buf;
}

// ── AI Horde (anonymous) ────────────────────────────────────────────────────
const HORDE_BASE = "https://aihorde.net/api/v2";
const HORDE_HEADERS = {
  apikey: "0000000000",
  "Content-Type": "application/json",
  "Client-Agent": "ambient-home-view-curator:1.0:github.com/usama-munir-ai/ambient-home-view",
};
const HORDE_W = 704;
const HORDE_H = 448;
const HORDE_POLL_MS = 12000;
const HORDE_POLL_MAX_MS = 5 * 60 * 1000;

async function hordeJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`horde ${res.status}: ${body?.message || ""}`);
  return body;
}

async function fromHorde(prompt, seed) {
  const submit = await hordeJson(`${HORDE_BASE}/generate/async`, {
    method: "POST",
    headers: HORDE_HEADERS,
    body: JSON.stringify({
      prompt,
      params: { width: HORDE_W, height: HORDE_H, steps: 20, n: 1, seed: String(seed) },
      nsfw: false,
    }),
  });
  if (!submit?.id) throw new Error("horde submit failed");

  const start = Date.now();
  for (;;) {
    if (Date.now() - start > HORDE_POLL_MAX_MS) throw new Error("horde timeout");
    await sleep(HORDE_POLL_MS);
    const check = await hordeJson(`${HORDE_BASE}/generate/check/${submit.id}`, { headers: HORDE_HEADERS });
    if (check?.faulted) throw new Error("horde job faulted");
    if (check?.done) break;
  }

  const status = await hordeJson(`${HORDE_BASE}/generate/status/${submit.id}`, { headers: HORDE_HEADERS });
  const img = status?.generations?.[0]?.img;
  if (!img) throw new Error("horde returned no image");
  const buf = await getBuffer(img, { timeoutMs: 60000, retries: 2, accept: "image/*" });
  if (!buf || buf.length < 8000) throw new Error("horde image download failed");
  return buf;
}

/**
 * Try providers in order, validate SOURCE dimensions before any upscale
 * (rejects rogue Horde workers that return 512×512 squares), and normalize
 * to a committed JPEG.
 */
async function generateScene(prompt, seed) {
  let raw = null;
  let provider = "";
  try {
    raw = await fromPollinations(prompt, seed);
    provider = "pollinations";
  } catch (err) {
    console.warn(`[cozy]   pollinations: ${String(err.message).slice(0, 120)}`);
    raw = await fromHorde(prompt, seed);
    provider = "aihorde";
  }

  const meta = await sharp(raw).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const aspect = h ? w / h : 0;
  if (w < 640 || aspect < 1.3 || aspect > 1.9) {
    throw new Error(`source dims unusable ${w}x${h} (${provider})`);
  }
  const jpeg = await sharp(raw)
    .resize(GEN_WIDTH, GEN_HEIGHT, { fit: "cover", kernel: "lanczos3" })
    .sharpen({ sigma: w < 1000 ? 0.8 : 0.4 })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { jpeg, provider };
}

function entryFor(group, tod, variant, vetted) {
  const file = `${group}-${tod}-${variant}.jpg`;
  const quietLum = typeof vetted?.quietLum === "number" ? vetted.quietLum : 0.3;
  const negSpace = typeof vetted?.negSpace === "number" ? vetted.negSpace : 0.45;
  const frames = quietLum <= 0.52 && negSpace >= 0.35 ? ["home", "wisdom", "cal"] : ["wisdom", "cal"];
  return {
    id: `cozy-${group}-${tod}-${variant}`,
    src: `/splash/cozy/${file}`,
    credit: "AI scene · Pollinations",
    palette: vetted?.palette || { dominant: "#6b5a48", isLight: false, warmth: "warm" },
    quietSide: vetted?.quietSide || "left",
    quietRegion: vetted?.quietRegion || "top-left",
    quietLum,
    negSpace,
    tags: [
      ...WEATHER_GROUPS[group].tags,
      ...TOD_BUCKETS[tod].tags,
      "cozy", "interior", "ai-scene",
    ],
    frames,
    provider: "pollinations",
    sourceUrl: "https://pollinations.ai",
    license: "AI-generated (FLUX via Pollinations)",
  };
}

const args = parseArgs(process.argv.slice(2));

run().catch((err) => {
  console.error("[cozy] fatal:", err);
  process.exit(1);
});

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const combos = [];
  for (const group of Object.keys(WEATHER_GROUPS)) {
    for (const tod of Object.keys(TOD_BUCKETS)) {
      for (let v = 1; v <= VARIANTS; v += 1) combos.push({ group, tod, variant: v });
    }
  }
  console.log(`[cozy] matrix: ${combos.length} scenes (${Object.keys(WEATHER_GROUPS).length} weather × ${Object.keys(TOD_BUCKETS).length} tod × ${VARIANTS})`);

  // --refresh-oldest N: delete the N oldest files so they regenerate below
  // with a bumped seed (date-salted) for variety.
  let refreshSalt = "";
  if (args["refresh-oldest"]) {
    const n = Number(args["refresh-oldest"]) || 0;
    const files = [];
    for (const c of combos) {
      const p = path.join(OUT_DIR, `${c.group}-${c.tod}-${c.variant}.jpg`);
      try {
        const st = await fs.stat(p);
        files.push({ p, mtime: st.mtimeMs });
      } catch { /* missing — will regenerate anyway */ }
    }
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files.slice(0, n)) {
      console.log(`[cozy] refresh: removing ${path.basename(f.p)}`);
      if (!args.dry) await fs.unlink(f.p);
    }
    refreshSalt = new Date().toISOString().slice(0, 10);
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let attempted = 0;
  const maxGen = args.max ? Number(args.max) : Infinity;
  const newEntries = [];

  for (const { group, tod, variant } of combos) {
    const file = `${group}-${tod}-${variant}.jpg`;
    const outPath = path.join(OUT_DIR, file);

    const exists = await fileExists(outPath);
    if (exists) {
      skipped += 1;
      let existingVet = null;
      try {
        existingVet = await vetBuffer(await fs.readFile(outPath));
      } catch { /* ignore */ }
      newEntries.push(entryFor(group, tod, variant, existingVet));
      continue;
    }
    if (attempted >= maxGen) continue;
    attempted += 1;

    const prompt = buildPrompt(group, tod);
    if (args.dry) {
      console.log(`[cozy] would generate ${file}\n        ${prompt}`);
      continue;
    }

    console.log(`[cozy] generating ${file}…`);
    let vetted = null;
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
      const seed = stableSeed(group + refreshSalt, tod, variant + attempt * 100);
      try {
        const { jpeg, provider } = await generateScene(prompt, seed);
        const vet = await vetBuffer(jpeg);
        if (!vet.ok && !vet.reason?.startsWith("no quiet side")) {
          // Busy-composition rejections are fine for interiors (text scrim
          // handles it); brightness problems mean a bad render.
          throw new Error(`vet rejected: ${vet.reason}`);
        }
        vetted = vet.ok ? vet : null;
        await fs.writeFile(outPath, jpeg);
        saved = true;
        generated += 1;
        console.log(`[cozy]   saved ${file} (${Math.round(jpeg.length / 1024)} KB, ${provider}, seed ${seed})`);
      } catch (err) {
        console.warn(`[cozy]   attempt ${attempt + 1} failed: ${err.message}`);
        await sleep(2500);
      }
    }
    if (saved) {
      newEntries.push(entryFor(group, tod, variant, vetted));
    } else {
      failed += 1;
    }
    await sleep(REQUEST_GAP_MS);
  }

  console.log(`\n[cozy] generated ${generated}, already present ${skipped}, failed ${failed}`);

  if (args.dry) return;

  // Upsert manifest entries: replace any stale cozy-* entry of the same id so
  // refreshed palettes/quietSides land, then append the rest.
  const manifest = await readManifest();
  const ids = new Set(newEntries.map((e) => e.id));
  const before = manifest.images.length;
  manifest.images = manifest.images.filter((img) => !ids.has(img.id));
  // Only index entries whose file actually exists.
  for (const entry of newEntries) {
    const onDisk = await fileExists(path.join(process.cwd(), "public", entry.src));
    if (onDisk) manifest.images.push(entry);
  }
  await writeManifest(manifest);
  console.log(`[cozy] manifest: ${before} → ${manifest.images.length} images`);
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}
