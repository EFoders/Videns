// The moment on screen, described for the status bar and banner.

import { computed } from "@preact/signals";

import type { TimeView } from "../ui/status.ts";
import { activeTimeline, cursorT, liveRevision, shown, source } from "./state.ts";

export const timeView = computed<TimeView>(() => {
  const s = source.value;
  const t = cursorT.value;
  if (s.kind === "file") return { kind: "file", name: s.name, t: shown.value.t };
  if (t === null) return { kind: "live" };
  liveRevision.value;
  const end = activeTimeline().end ?? t;
  return { kind: "past", t: shown.value.t, behindMs: Math.max(0, end - t) };
});

