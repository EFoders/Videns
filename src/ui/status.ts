// What the viewer is doing, in one place, so the status bar, the banner over the map and
// the stale styling cannot disagree. Every state reads differently (VIDENS_SPEC.md rule 10):
// an empty map never leaves a reader guessing whether they are connected, and a moment from
// the past is never mistaken for the present.

import type { ViewStatus } from "../app/state.ts";
import type { PictureState } from "../store/picture.ts";
import { age, clock } from "./format.ts";

export type Tone = "ok" | "warn" | "bad" | "idle";

export interface StatusSummary {
  tone: Tone;
  label: string;
  /** A sentence for the banner over the map, or null when the map speaks for itself. */
  banner: string | null;
  /** Whether what is drawn should be marked out of date. */
  stale: boolean;
}

/** Which moment is on screen. */
export type TimeView =
  | { kind: "live" }
  | { kind: "past"; t: string | undefined; behindMs: number }
  | { kind: "file"; name: string; t: string | undefined };

export function summarise(view: ViewStatus, picture: PictureState, lastMessageAt: number | null, now: number, time: TimeView = { kind: "live" }): StatusSummary {
  const feed = summariseFeed(view, picture, lastMessageAt, now);
  // A moment from the history is exactly what it was: not stale, but never taken for now.
  if (time.kind === "past") {
    return {
      ...feed,
      stale: false,
      banner: `Viewing the picture at ${clock(time.t)}, ${age(time.behindMs)} behind the newest message. The live feed continues; press Live to return.`,
    };
  }
  if (time.kind === "file") {
    return { ...feed, stale: false, banner: `Replaying the recording ${time.name}, at ${clock(time.t)}. This is not live.` };
  }
  return feed;
}

function summariseFeed(view: ViewStatus, picture: PictureState, lastMessageAt: number | null, now: number): StatusSummary {
  const since = lastMessageAt === null ? "" : ` Last message ${age(now - lastMessageAt)} ago.`;
  switch (view.kind) {
    case "loading":
      return { tone: "idle", label: "Starting", banner: "Loading configuration…", stale: true };
    case "config_error":
      return { tone: "bad", label: "Configuration error", banner: `Configuration error: ${view.detail}`, stale: true };
    case "no_feed":
      return { tone: "idle", label: "No feed", banner: "No feed is configured (feed: \"none\"). Open a recording to replay one.", stale: true };
    case "feed":
      break;
  }
  switch (view.status) {
    case "connecting":
      return { tone: "idle", label: "Connecting", banner: `Not connected yet: ${view.detail}.`, stale: true };
    case "reconnecting":
      return {
        tone: "bad",
        label: "Disconnected",
        banner: `Feed connection lost; reconnecting. What you see is out of date.${since}`,
        stale: true,
      };
    case "stalled":
      return {
        tone: "warn",
        label: "Stalled",
        banner: `Connected, but the feed has stalled: nothing received.${since} What you see is out of date.`,
        stale: true,
      };
    case "live":
      break;
  }
  if (picture.needsSnapshot) {
    return { tone: "warn", label: "Resyncing", banner: "Resyncing: waiting for a fresh snapshot from the feed.", stale: true };
  }
  if (picture.entities.size === 0) {
    return {
      tone: "ok",
      label: "Live",
      banner: `Connected to run ${picture.runId ?? "?"}: no entities in the picture yet.${since}`,
      stale: false,
    };
  }
  return { tone: "ok", label: "Live", banner: null, stale: false };
}
