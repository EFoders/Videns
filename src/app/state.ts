// Application state and the one path every message takes:
//   raw text -> validate (contract) -> Timeline.append (store) -> signals -> map and panels.
// Rejections and sequencing problems become diagnostics; a gap triggers a resync.
//
// Two pictures exist at once: `picture`, the latest live state, and `shown`, the one on
// screen -- the same thing while following live, otherwise the state at the time the
// reader chose, from the live history or from a recording (VIDENS_SPEC.md 8.6).

import { batch, computed, signal } from "@preact/signals";

import { ConfigError, loadConfig, NO_BASEMAP, type BasemapOption, type ViewerConfig } from "../config.ts";
import type { ObjectRef, PictureMessage } from "../contract/generated/picture.ts";
import { parseMessage, type Issue } from "../contract/validate.ts";
import { LiveFeed, type FeedStatus } from "../feed/live.ts";
import { emptyPicture, type PictureState, type StoreIssueKind } from "../store/picture.ts";
import { Timeline } from "../store/timeline.ts";

export type DiagnosticKind = "rejected" | StoreIssueKind | "feed" | "recording";

export interface Diagnostic {
  at: number;
  kind: DiagnosticKind;
  summary: string;
  issues?: Issue[];
  raw?: string;
}

export interface Counters {
  received: number;
  rejected: number;
  gaps: number;
  duplicates: number;
  resyncs: number;
}

export type ViewStatus =
  | { kind: "config_error"; detail: string }
  | { kind: "loading" }
  | { kind: "no_feed" }
  | { kind: "feed"; status: FeedStatus; detail: string; since: number };

/** Where the picture on screen comes from. */
export type TimeSource = { kind: "live" } | { kind: "file"; name: string; timeline: Timeline; rejected: number };

const DIAGNOSTIC_LIMIT = 200;
const RAW_LIMIT = 4000;

export const config = signal<ViewerConfig | null>(null);
export const view = signal<ViewStatus>({ kind: "loading" });
/** The latest live state. */
export const picture = signal<PictureState>(emptyPicture());
export const lastMessageAt = signal<number | null>(null);
export const counters = signal<Counters>({ received: 0, rejected: 0, gaps: 0, duplicates: 0, resyncs: 0 });
export const diagnostics = signal<readonly Diagnostic[]>([]);
export const selection = signal<ObjectRef | null>(null);
export const ellipseConfidence = signal(0.95);
export const cursor = signal<{ lat: number; lon: number } | null>(null);
/** Why the chosen basemap is not showing, or null when it is (or none is chosen). */
export const basemapProblem = signal<string | null>(null);
/** The id of the basemap on screen, from config.basemaps. */
export const basemapId = signal<string>(NO_BASEMAP.id);
/** Wall clock, ticking, so ages on screen keep counting while nothing arrives. */
export const now = signal(Date.now());

// --- Layers the reader can switch ------------------------------------------------------

export const showTrails = signal(true);
/** Lines of bearing and reported positions: for the selection only, for everything, or off. */
export const evidenceMode = signal<"selected" | "all" | "off">("selected");
/** Groups below Vigilans' publication threshold are hidden unless asked for (spec 8.4). */
export const showHypotheses = signal(false);

// --- Time ------------------------------------------------------------------------------

const liveTimeline = new Timeline();
/** Bumped on every live message, so views of the live history recompute. */
export const liveRevision = signal(0);
export const source = signal<TimeSource>({ kind: "live" });
/** Picture time on screen, ms; null follows the newest message. */
export const cursorT = signal<number | null>(null);
export const playback = signal<{ playing: boolean; rate: number }>({ playing: false, rate: 1 });

export function activeTimeline(): Timeline {
  const s = source.value;
  return s.kind === "live" ? liveTimeline : s.timeline;
}

/** The picture on screen. */
export const shown = computed<PictureState>(() => {
  const s = source.value;
  const t = cursorT.value;
  if (s.kind === "live" && t === null) return picture.value;
  if (s.kind === "live") liveRevision.value; // the live history grows under a paused view
  const timeline = s.kind === "live" ? liveTimeline : s.timeline;
  return t === null ? timeline.latest : timeline.stateAt(t);
});

/** True while the screen follows the live feed as it arrives. */
export const atLiveEdge = computed(() => source.value.kind === "live" && cursorT.value === null);

export function goLive(): void {
  batch(() => {
    source.value = { kind: "live" };
    cursorT.value = null;
    playback.value = { ...playback.value, playing: false };
  });
}

export function seek(t: number): void {
  const timeline = activeTimeline();
  if (timeline.start === undefined || timeline.end === undefined) return;
  const clamped = Math.min(Math.max(t, timeline.start), timeline.end);
  // Scrubbing to the newest message of the live feed is following it again.
  cursorT.value = source.value.kind === "live" && clamped >= timeline.end ? null : clamped;
}

export function step(direction: -1 | 1): void {
  const timeline = activeTimeline();
  const t = cursorT.value ?? timeline.end;
  if (t === undefined) return;
  const { previous, next } = timeline.neighbours(t);
  const destination = direction < 0 ? previous : next;
  if (destination !== undefined) {
    playback.value = { ...playback.value, playing: false };
    seek(destination);
  }
}

export function setPlaying(playing: boolean): void {
  const timeline = activeTimeline();
  if (playing && cursorT.value === null) {
    // Playing from the live edge means replaying the run from its start.
    if (timeline.start === undefined) return;
    cursorT.value = timeline.start;
  }
  playback.value = { ...playback.value, playing };
  if (playing) requestAnimationFrame(tickPlayback);
}

export function setRate(rate: number): void {
  playback.value = { ...playback.value, rate };
}

let lastTick = 0;
function tickPlayback(nowMs: number): void {
  if (!playback.value.playing) {
    lastTick = 0;
    return;
  }
  const dt = lastTick ? nowMs - lastTick : 0;
  lastTick = nowMs;
  const timeline = activeTimeline();
  const t = (cursorT.value ?? timeline.end ?? 0) + dt * playback.value.rate;
  if (timeline.end !== undefined && t >= timeline.end) {
    if (source.value.kind === "live") goLive();
    else {
      cursorT.value = timeline.end;
      playback.value = { ...playback.value, playing: false };
    }
    lastTick = 0;
    return;
  }
  cursorT.value = t;
  requestAnimationFrame(tickPlayback);
}

/** Load a .picture.jsonl recording and show it from its start (spec 6.11). */
export async function openRecording(file: File): Promise<void> {
  const text = await file.text();
  const timeline = new Timeline();
  let rejected = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const result = parseMessage(line);
    if (!result.ok) {
      rejected += 1;
      diagnose({ kind: "recording", summary: `${file.name} line ${i + 1} rejected by picture.v0`, issues: result.issues, raw: line.slice(0, RAW_LIMIT) });
      return;
    }
    timeline.append(result.message);
  });
  if (timeline.length === 0) {
    diagnose({ kind: "recording", summary: `${file.name} holds no valid picture.v0 messages; nothing to replay` });
    return;
  }
  batch(() => {
    source.value = { kind: "file", name: file.name, timeline, rejected };
    cursorT.value = timeline.start ?? null;
    playback.value = { ...playback.value, playing: false };
    selection.value = null;
  });
}

/** The live history as a .picture.jsonl file, for sharing or replaying later. */
export function recordingOfLive(): { name: string; text: string } | null {
  const messages = liveTimeline.all();
  if (messages.length === 0) return null;
  const run = liveTimeline.runId ?? "run";
  return { name: `${run}.picture.jsonl`, text: `${messages.map((m) => JSON.stringify(m)).join("\n")}\n` };
}

// --- Basemap ---------------------------------------------------------------------------

const BASEMAP_KEY = "videns.basemap";

/** The basemap option on screen. */
export function activeBasemap(): BasemapOption {
  return config.value?.basemaps.find((b) => b.id === basemapId.value) ?? NO_BASEMAP;
}

export function chooseBasemap(id: string): void {
  if (!config.value?.basemaps.some((b) => b.id === id)) return;
  batch(() => {
    basemapId.value = id;
    basemapProblem.value = null;
  });
  // A per-viewer convenience only; the viewer works the same without it.
  try {
    localStorage.setItem(BASEMAP_KEY, id);
  } catch {
    // storage unavailable (private window, blocked site data): nothing to remember
  }
}

function rememberedBasemap(): string | null {
  try {
    return localStorage.getItem(BASEMAP_KEY);
  } catch {
    return null;
  }
}

// --- Start and the live path -------------------------------------------------------------

let feed: LiveFeed | null = null;

export async function start(): Promise<void> {
  setInterval(() => (now.value = Date.now()), 500);
  let loaded: ViewerConfig;
  try {
    loaded = await loadConfig();
  } catch (error) {
    const detail = error instanceof ConfigError ? error.message : String(error);
    view.value = { kind: "config_error", detail };
    return;
  }
  adoptConfig(loaded);
  if (loaded.feed === null) {
    view.value = { kind: "no_feed" };
    return;
  }
  feed = new LiveFeed(`${loaded.feed}/stream`, {
    onMessage: receive,
    onStatus: (status, detail) => {
      view.value = { kind: "feed", status, detail, since: Date.now() };
      if (status === "reconnecting" || status === "stalled") diagnose({ kind: "feed", summary: `${status}: ${detail}` });
    },
  });
  feed.start();
}

/** Take a loaded configuration: basemaps, region level. Shared with the scenario editor. */
export function adoptConfig(loaded: ViewerConfig): void {
  const remembered = rememberedBasemap();
  batch(() => {
    config.value = loaded;
    ellipseConfidence.value = loaded.ellipseConfidence;
    basemapId.value = remembered && loaded.basemaps.some((b) => b.id === remembered) ? remembered : loaded.basemapDefault;
  });
}

export function receive(raw: string): void {
  lastMessageAt.value = Date.now();
  const result = parseMessage(raw);
  if (!result.ok) {
    const label = result.type ? `${result.type}${result.seq !== undefined ? ` #${result.seq}` : ""}` : "message";
    batch(() => {
      counters.value = { ...counters.value, received: counters.value.received + 1, rejected: counters.value.rejected + 1 };
      diagnose({ kind: "rejected", summary: `${label} rejected by picture.v0`, issues: result.issues, raw: raw.slice(0, RAW_LIMIT) });
    });
    return;
  }
  applyLive(result.message);
}

function applyLive(message: PictureMessage): void {
  const runBefore = liveTimeline.runId;
  const applied = liveTimeline.append(message);
  const gap = applied.issues.some((i) => i.kind === "gap");
  batch(() => {
    picture.value = applied.state;
    liveRevision.value += 1;
    // A new run replaces the history a paused view was looking at: follow live again.
    if (runBefore !== undefined && liveTimeline.runId !== runBefore && source.value.kind === "live") cursorT.value = null;
    let { received, gaps, duplicates, resyncs } = counters.value;
    received += 1;
    for (const issue of applied.issues) {
      if (issue.kind === "gap") gaps += 1;
      if (issue.kind === "duplicate") duplicates += 1;
      // Waiting for a snapshot is expected for a moment after a resync; not worth a line each.
      if (issue.kind !== "awaiting_snapshot") diagnose({ kind: issue.kind, summary: issue.message });
    }
    if (gap) resyncs += 1;
    counters.value = { ...counters.value, received, gaps, duplicates, resyncs };
  });
  if (gap) feed?.resync("sequence gap");
}

function diagnose(d: Omit<Diagnostic, "at">): void {
  const next = [...diagnostics.value, { ...d, at: Date.now() }];
  diagnostics.value = next.length > DIAGNOSTIC_LIMIT ? next.slice(next.length - DIAGNOSTIC_LIMIT) : next;
}

export function select(ref: ObjectRef | null): void {
  selection.value = ref;
}
