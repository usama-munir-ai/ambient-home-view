// Per-frame enter/leave hooks. Wired up by nav.js.
// Splits responsibility so modules don't import navigation directly.

import { startWorldClocks, stopWorldClocks, renderWorldFrame } from "./world.js";
import { showPhotosFrame, leavePhotosFrame } from "./photos.js";
import { renderPrayerFrame } from "./prayer.js";
import { ensureSplashFor } from "./media/curator.js";

export function onFrameEnter(key) {
  void ensureSplashFor(key);
  if (key === "prayer") {
    renderPrayerFrame();
  } else if (key === "world") {
    renderWorldFrame();
    startWorldClocks();
  } else if (key === "photos") {
    showPhotosFrame();
  }
}

export function onFrameLeave(key) {
  if (key === "world") stopWorldClocks();
  if (key === "photos") leavePhotosFrame();
}
