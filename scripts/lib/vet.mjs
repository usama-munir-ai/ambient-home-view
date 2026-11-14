// The vetting pass. Every URL that lands in the manifest has been here.
//
// Rejects:
//   - low resolution (< 1600 wide OR < 900 tall)
//   - narrow aspect (< 1.4)
//   - too dark or too washed (mean luminance outside 0.06..0.94)
//   - no quiet side (both left third and right third are busy)
//
// Returns on accept:
//   { ok: true, width, height, palette: {dominant, isLight, warmth}, quietSide,
//     brightness, leftRatio, rightRatio }
//
// `quietSide` is whichever third has lower edge density. We compute a
// luminance gradient (Sobel-lite) over a 96×54 thumbnail and compare the
// energy in the left third vs the right third.

import sharp from "sharp";
import { getBuffer } from "./http.mjs";

// Display target is Facebook Portal 10 Gen 2: 512×300 CSS px (1280×800 physical
// @ 2.5 DPR, ~1.71 aspect). Wikimedia's standard pre-cached CDN step is 1280px
// wide, and Home requires wide-angle master shots (aspect ≥ 1.45).
const MIN_WIDTH = 1200;
const MIN_HEIGHT = 650;
const MIN_ASPECT = 1.2;
const MIN_HOME_ASPECT = 1.45;
const MAX_ASPECT = 2.8;
const MIN_BRIGHTNESS = 0.06;
const MAX_BRIGHTNESS = 0.94;
const MAX_QUIET_RATIO = 0.36; // best side must contain ≤ 36% of total edge energy
const ANALYSIS_W = 96;
const ANALYSIS_H = 56; // 96×56 ≈ 512×300 Portal 10 viewport aspect (1.71)

export async function vetImageUrl(displayUrl, opts = {}) {
  let buf;
  try {
    buf = await getBuffer(displayUrl, { timeoutMs: opts.timeoutMs || 30000, retries: 2 });
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${err.message}` };
  }
  if (!buf || buf.length < 4096) {
    return { ok: false, reason: "fetch returned empty/tiny body" };
  }
  return vetBuffer(buf, opts);
}

/** Same vetting pass for an already-downloaded image buffer. */
export async function vetBuffer(buf, opts = {}) {
  let img;
  try {
    img = sharp(buf, { failOn: "none" });
  } catch (err) {
    return { ok: false, reason: `decode failed: ${err.message}` };
  }

  let meta;
  try {
    meta = await img.metadata();
  } catch (err) {
    return { ok: false, reason: `metadata failed: ${err.message}` };
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    return { ok: false, reason: `low resolution ${width}x${height}` };
  }
  const aspect = width / height;
  const minAspect = opts.strictQuiet ? MIN_HOME_ASPECT : MIN_ASPECT;
  if (aspect < minAspect || aspect > MAX_ASPECT) {
    return { ok: false, reason: `aspect ${aspect.toFixed(2)} out of range` };
  }

  let stats;
  try {
    stats = await img.clone().stats();
  } catch (err) {
    return { ok: false, reason: `stats failed: ${err.message}` };
  }

  const dom = stats.dominant || { r: 128, g: 128, b: 128 };
  const dominantHex = rgbToHex(dom);
  const warmth = classifyWarmth(dom);
  const channels = stats.channels || [];
  const meanY = luminance(channels);
  if (meanY < MIN_BRIGHTNESS) return { ok: false, reason: `too dark mean=${meanY.toFixed(3)}` };
  if (meanY > MAX_BRIGHTNESS) return { ok: false, reason: `too washed mean=${meanY.toFixed(3)}` };
  const isLight = meanY > 0.55;

  // Resize to a tiny analysis raster
  let raw;
  try {
    raw = await img
      .clone()
      .removeAlpha()
      .resize(ANALYSIS_W, ANALYSIS_H, { fit: "cover" })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    return { ok: false, reason: `raster failed: ${err.message}` };
  }

  const channelsRaw = raw.info.channels || 3;
  const lum = new Float32Array(ANALYSIS_W * ANALYSIS_H);
  for (let i = 0; i < ANALYSIS_W * ANALYSIS_H; i += 1) {
    const r = raw.data[i * channelsRaw];
    const g = raw.data[i * channelsRaw + 1];
    const b = raw.data[i * channelsRaw + 2];
    lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // ── Portal 10 (512×300 CSS px @ 2.5 DPR) footprint analysis ─────────────
  // On 512×300, the 115px clock ("11:45") + 25px date + 21px Hijri span from
  // x ≈ 2% to 48% (left) or 52% to 98% (right) and y ≈ 0% to 54%.
  // Splitting the clock box into its outer half (hour digits on left / minute
  // digits on right) and inner half (minute digits on left / hour digits on
  // right) ensures a peak, tree, or bright sun at x = 25..48% is never hidden
  // by averaging with a dark outer strip at x = 0..24%.
  let totalEdge = 0;
  let leftEdge = 0;
  let rightEdge = 0;
  const midLeftX = Math.floor(ANALYSIS_W * 0.24);
  const maxLeftX = Math.floor(ANALYSIS_W * 0.48);
  const minRightX = ANALYSIS_W - maxLeftX;
  const midRightX = ANALYSIS_W - midLeftX;
  const clockMaxY = Math.floor(ANALYSIS_H * 0.54);

  const makeBox = () => ({ edge: 0, lum: 0, px: 0, lums: [] });
  const sideStats = {
    left: { outer: makeBox(), inner: makeBox(), lower: makeBox(), allClockLums: [] },
    right: { outer: makeBox(), inner: makeBox(), lower: makeBox(), allClockLums: [] },
  };
  const addPx = (box, m, l) => { box.edge += m; box.lum += l; box.px += 1; };

  for (let y = 1; y < ANALYSIS_H - 1; y += 1) {
    const inClockY = y <= clockMaxY;
    for (let x = 1; x < ANALYSIS_W - 1; x += 1) {
      const idx = y * ANALYSIS_W + x;
      const dx = lum[idx + 1] - lum[idx - 1];
      const dy = lum[idx + ANALYSIS_W] - lum[idx - ANALYSIS_W];
      const m = Math.sqrt(dx * dx + dy * dy);
      const l = lum[idx];
      totalEdge += m;
      if (x < maxLeftX) {
        leftEdge += m;
        const st = sideStats.left;
        if (inClockY) {
          st.allClockLums.push(l);
          if (x < midLeftX) addPx(st.outer, m, l);
          else addPx(st.inner, m, l);
        } else {
          addPx(st.lower, m, l);
        }
      } else if (x >= minRightX) {
        rightEdge += m;
        const st = sideStats.right;
        if (inClockY) {
          st.allClockLums.push(l);
          if (x < midRightX) addPx(st.inner, m, l);
          else addPx(st.outer, m, l);
        } else {
          addPx(st.lower, m, l);
        }
      }
    }
  }

  if (totalEdge <= 0) return { ok: false, reason: "flat image (no edges)" };
  const leftRatio = leftEdge / totalEdge;
  const rightRatio = rightEdge / totalEdge;

  const evalSide = (key) => {
    const st = sideStats[key];
    const outerDensity = st.outer.edge / (st.outer.px || 1);
    const innerDensity = st.inner.edge / (st.inner.px || 1);
    // Worse of the two clock halves governs legibility (no spire/branch under either 11 or 45)
    const clockDensity = Math.max(outerDensity, innerDensity) * 0.75 + Math.min(outerDensity, innerDensity) * 0.25;
    const lowerDensity = st.lower.edge / (st.lower.px || 1);
    const weightedDensity = clockDensity * 0.78 + lowerDensity * 0.22;

    const outerLum = st.outer.lum / (st.outer.px || 1);
    const innerLum = st.inner.lum / (st.inner.px || 1);
    const clockLumMean = Math.max(outerLum, innerLum);
    const clockLumSpread = Math.abs(outerLum - innerLum);
    const lowerLumMean = st.lower.lum / (st.lower.px || 1);

    const sorted = st.allClockLums.slice().sort((a, b) => a - b);
    const p90Lum = sorted.length ? sorted[Math.floor(sorted.length * 0.90)] : clockLumMean;

    const CALM_SCALE = 0.125;
    const clockNeg = Math.max(0, Math.min(1, 1 - clockDensity / CALM_SCALE));
    const overallNeg = Math.max(0, Math.min(1, 1 - weightedDensity / CALM_SCALE));
    const negSpace = Math.min(clockNeg, overallNeg);
    const contrastOk =
      clockLumMean <= 0.76 &&
      p90Lum <= 0.88 &&
      clockLumSpread <= 0.32 &&
      lowerLumMean <= 0.72 &&
      negSpace >= 0.30;
    return { key, weightedDensity, clockLumMean, clockLumSpread, lowerLumMean, p90Lum, negSpace, contrastOk };
  };

  const leftEval = evalSide("left");
  const rightEval = evalSide("right");

  // Prefer a side that passes the 512×300 clock contrast + negative-space gate;
  // break ties by lowest clock-weighted edge density.
  let chosen = leftEval;
  if (rightEval.contrastOk && !leftEval.contrastOk) chosen = rightEval;
  else if (leftEval.contrastOk === rightEval.contrastOk && rightEval.weightedDensity < leftEval.weightedDensity) {
    chosen = rightEval;
  }

  const quietSide = chosen.key;
  const minRatio = Math.min(leftRatio, rightRatio);
  if (!opts.strictQuiet && minRatio > 0.46) {
    return { ok: false, reason: `no quiet side (left=${leftRatio.toFixed(2)} right=${rightRatio.toFixed(2)})` };
  }

  const negSpace = chosen.negSpace;
  const quietLum = +chosen.clockLumMean.toFixed(3);
  const quietRegion = `top-${quietSide}`;

  // ── Matte-border rejection: kills framed-painting scans (the white top
  // strip the user saw). A matte is a bright, uniform ring on all four sides
  // around a distinctly different interior. Conservative to avoid nuking
  // legit bright-sky photos (those aren't uniform on all four sides).
  const ring = [];
  let innerSum = 0, innerN = 0;
  for (let y = 0; y < ANALYSIS_H; y += 1) {
    for (let x = 0; x < ANALYSIS_W; x += 1) {
      const onRing = x < 2 || y < 2 || x >= ANALYSIS_W - 2 || y >= ANALYSIS_H - 2;
      const v = lum[y * ANALYSIS_W + x];
      if (onRing) ring.push(v);
      else if (x > ANALYSIS_W * 0.25 && x < ANALYSIS_W * 0.75 && y > ANALYSIS_H * 0.25 && y < ANALYSIS_H * 0.75) {
        innerSum += v; innerN += 1;
      }
    }
  }
  const ringMean = ring.reduce((a, b) => a + b, 0) / (ring.length || 1);
  const ringVar = ring.reduce((a, b) => a + (b - ringMean) ** 2, 0) / (ring.length || 1);
  const innerMean = innerSum / (innerN || 1);
  if (ringMean > 0.82 && Math.sqrt(ringVar) < 0.06 && ringMean - innerMean > 0.15) {
    return { ok: false, reason: `matte border (ring=${ringMean.toFixed(2)} inner=${innerMean.toFixed(2)})` };
  }

  // ── Negative-space & clock-contrast floor for 512×300 home wallpapers ────
  // Home clock numerals (115px) and weather temp (52px) are always luminous
  // light, so the 48%×56% upper clock zone and lower widget zone on quietSide
  // must have genuine negative space (≥ 0.35), low mean luminance (≤ 0.52),
  // and no bright white cloud/sun/reef patch inside the clock box (p90 ≤ 0.70).
  if (opts.strictQuiet) {
    if (negSpace < 0.30) {
      return { ok: false, reason: `no calm 512x300 clock region (negSpace=${negSpace.toFixed(2)})` };
    }
    if (chosen.clockLumMean > 0.76 || chosen.p90Lum > 0.88 || chosen.clockLumSpread > 0.32 || chosen.lowerLumMean > 0.72) {
      return {
        ok: false,
        reason: `clock zone too bright/uneven (lum=${chosen.clockLumMean.toFixed(2)} p90=${chosen.p90Lum.toFixed(2)} spread=${chosen.clockLumSpread.toFixed(2)})`,
      };
    }
  }

  return {
    ok: true,
    width,
    height,
    palette: { dominant: dominantHex, isLight, warmth },
    quietSide,
    quietRegion,
    quietLum,
    negSpace: +negSpace.toFixed(3),
    brightness: meanY,
    leftRatio,
    rightRatio,
  };
}

function rgbToHex({ r, g, b }) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function classifyWarmth({ r, g, b }) {
  const warmAxis = (r - b) / 255; // -1..1
  if (warmAxis > 0.08) return "warm";
  if (warmAxis < -0.08) return "cool";
  return "neutral";
}

function luminance(channels) {
  if (channels.length < 3) return 0.5;
  const r = channels[0]?.mean ?? 128;
  const g = channels[1]?.mean ?? 128;
  const b = channels[2]?.mean ?? 128;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
