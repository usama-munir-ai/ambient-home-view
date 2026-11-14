// World clocks frame. Live ticking grid of cities.

import { state } from "./state.js";
import { $, isCompactViewport, escapeHtml } from "./util.js";

let timer = null;

export function renderWorldFrame() {
  const cities = state.content.worldCities || [];
  const grid = $("worldGrid");
  if (!grid) return;
  // Limit to 4 in compact, 6 otherwise — more breathing room per card.
  const visible = isCompactViewport() ? cities.slice(0, 4) : cities.slice(0, 6);
  grid.innerHTML = visible.map((city) => `
    <article class="world-card" data-city="${escapeHtml(city.key)}">
      <div class="world-card-bg" id="worldBg-${escapeHtml(city.key)}" style="background-image:url('${escapeHtml(encodeURI(city.fallback || ""))}')"></div>
      <div class="world-card-scrim"></div>
      <div class="world-card-content">
        <div class="world-card-head">
          <span class="world-card-name">${escapeHtml(city.name)}</span>
          <span class="world-card-day" id="worldDay-${escapeHtml(city.key)}">today</span>
        </div>
        <div class="world-card-time tabular" id="worldTime-${escapeHtml(city.key)}">—</div>
        <div class="world-card-meta">
          <span class="world-card-offset" id="worldOff-${escapeHtml(city.key)}">—</span>
          <span class="world-card-pearl">${escapeHtml(city.pearl || "")}</span>
          ${city.fallbackCredit ? `<span class="world-card-credit">${escapeHtml(city.fallbackCredit)}</span>` : ""}
        </div>
      </div>
    </article>
  `).join("");
  tickWorld();
}

export function tickWorld() {
  const cities = state.content.worldCities || [];
  if (!cities.length) return;
  const now = new Date();
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localKey = new Intl.DateTimeFormat("en-CA", { timeZone: localTz }).format(now);

  cities.forEach((city) => {
    const tz = city.tz || localTz;
    const card = document.querySelector(`.world-card[data-city="${escapeHtml(city.key)}"]`);
    if (!card) return;

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(now);
    const obj = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
    const remoteKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

    const timeEl = $("worldTime-" + city.key);
    if (timeEl) {
      timeEl.innerHTML = `${obj.hour}:${obj.minute}<span class="ampm"> ${(obj.dayPeriod || "AM").toLowerCase()}</span>`;
    }

    const dayEl = $("worldDay-" + city.key);
    if (dayEl) {
      const cmp = remoteKey > localKey ? "ahead" : remoteKey < localKey ? "behind" : "today";
      dayEl.textContent = cmp === "today" ? "today" : cmp === "ahead" ? "tomorrow" : "yesterday";
      dayEl.classList.remove("ahead", "behind");
      if (cmp !== "today") dayEl.classList.add(cmp);
    }

    const offEl = $("worldOff-" + city.key);
    if (offEl) {
      const cityHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now), 10);
      const localHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: localTz, hour: "numeric", hourCycle: "h23" }).format(now), 10);
      let diff = cityHour - localHour;
      if (diff > 12) diff -= 24;
      if (diff < -12) diff += 24;
      offEl.textContent = diff === 0 ? "same as home" : (diff > 0 ? `+${diff}h` : `${diff}h`);
    }

    const bg = $("worldBg-" + city.key);
    if (bg) {
      const cityHour24 = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now), 10);
      const isNight = cityHour24 >= 19 || cityHour24 < 6;
      bg.style.filter = isNight ? "brightness(0.55) saturate(0.85)" : "brightness(0.85) saturate(1.05)";
    }
  });

  // Local clock label
  const labelEl = $("worldLocalLabel");
  if (labelEl) {
    const local = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(now);
    labelEl.textContent = "home · " + local.toLowerCase();
  }
}

export function startWorldClocks() {
  if (timer) clearInterval(timer);
  tickWorld();
  timer = setInterval(tickWorld, 1000);
}

export function stopWorldClocks() {
  if (timer) clearInterval(timer);
  timer = null;
}
