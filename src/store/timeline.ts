// A run's messages in order, and the picture at any moment of it (VIDENS_SPEC.md 8.6).
//
// Every message -- live or from a recording -- goes through append(), which applies it
// with the same pure store function; there is no second path for replay to drift along.
// Keyframes are the applied state at intervals, so stateAt(t) replays at most one interval
// of messages instead of the whole run.
//
// stateAt(t) is the state after every message whose picture time is at or before t. It
// never interpolates: between two messages the picture is what the earlier one left, which
// is exactly what a live viewer saw.

import type { LifecycleEvent, PictureMessage } from "../contract/generated/picture.ts";
import { applyMessage, emptyPicture, type ApplyResult, type PictureState } from "./picture.ts";

export interface TimelineMarker {
  t: number;
  kind: LifecycleEvent["kind"] | "notice";
  label: string;
}

export interface TimelineOptions {
  /** Picture time between keyframes. */
  keyframeEveryMs?: number;
  /** Messages kept; older ones are dropped a keyframe at a time. */
  limit?: number;
}

const DEFAULT_KEYFRAME_MS = 10_000;
const DEFAULT_LIMIT = 50_000;

export class Timeline {
  private messages: PictureMessage[] = [];
  /** Picture time of each message, ms, never decreasing. */
  private times: number[] = [];
  /** The state after messages[index]. */
  private keyframes: { index: number; state: PictureState }[] = [];
  /** The state before messages[0]: empty, or what trimming left behind. */
  private base: PictureState = emptyPicture();
  private current: PictureState = emptyPicture();
  private lastKeyframeT = Number.NEGATIVE_INFINITY;
  private readonly keyframeEveryMs: number;
  private readonly limit: number;

  constructor(options: TimelineOptions = {}) {
    this.keyframeEveryMs = options.keyframeEveryMs ?? DEFAULT_KEYFRAME_MS;
    this.limit = options.limit ?? DEFAULT_LIMIT;
  }

  get length(): number {
    return this.messages.length;
  }

  /** The state after the last message: what a live viewer sees. */
  get latest(): PictureState {
    return this.current;
  }

  get start(): number | undefined {
    return this.times[0];
  }

  get end(): number | undefined {
    return this.times.at(-1);
  }

  get runId(): string | undefined {
    return this.current.runId;
  }

  /** Every message, in order, as received. */
  all(): readonly PictureMessage[] {
    return this.messages;
  }

  append(message: PictureMessage): ApplyResult {
    // A new run starts a new history: its clock may begin again from the same instant.
    if (message.type === "hello" && this.current.runId !== undefined && message.run_id !== this.current.runId) this.clear();

    const result = applyMessage(this.current, message);
    this.current = result.state;
    const t = Math.max(timeOf(message, this.current) ?? this.times.at(-1) ?? 0, this.times.at(-1) ?? Number.NEGATIVE_INFINITY);
    this.messages.push(message);
    this.times.push(t);
    if (message.type === "snapshot" || t - this.lastKeyframeT >= this.keyframeEveryMs) {
      this.keyframes.push({ index: this.messages.length - 1, state: this.current });
      this.lastKeyframeT = t;
    }
    if (this.messages.length > this.limit) this.trim();
    return result;
  }

  /** The index of the last message at or before t, or -1 before the first. */
  indexAt(t: number): number {
    let lo = 0;
    let hi = this.times.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid]! <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  timeAt(index: number): number | undefined {
    return this.times[index];
  }

  /** The picture as it stood at picture time t. */
  stateAt(t: number): PictureState {
    return this.stateAfter(this.indexAt(t));
  }

  /** The picture after messages[index]; the base state for -1. */
  stateAfter(index: number): PictureState {
    if (index < 0) return this.base;
    if (index >= this.messages.length - 1) return this.current;
    let from = -1;
    let state = this.base;
    // Nearest keyframe at or before index.
    let lo = 0;
    let hi = this.keyframes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.keyframes[mid]!.index <= index) {
        from = this.keyframes[mid]!.index;
        state = this.keyframes[mid]!.state;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    for (let i = from + 1; i <= index; i++) state = applyMessage(state, this.messages[i]!).state;
    return state;
  }

  /** The times of the previous and next distinct message times around t, for stepping. */
  neighbours(t: number): { previous?: number; next?: number } {
    const i = this.indexAt(t);
    let p = i;
    while (p >= 0 && this.times[p]! >= t) p--;
    let n = i + 1;
    while (n < this.times.length && this.times[n]! <= t) n++;
    return { previous: p >= 0 ? this.times[p] : undefined, next: n < this.times.length ? this.times[n] : undefined };
  }

  /** Lifecycle events and notices with their times, for the timeline's markers. */
  markers(): TimelineMarker[] {
    const out: TimelineMarker[] = [];
    this.messages.forEach((m, i) => {
      const t = this.times[i]!;
      if (m.type === "delta") {
        for (const e of m.events ?? []) out.push({ t, kind: e.kind, label: `${e.kind.replace(/_/g, " ")}: ${e.objects.map((o) => o.id).join(", ")}` });
      } else if (m.type === "notice") {
        out.push({ t, kind: "notice", label: m.text });
      }
    });
    return out;
  }

  clear(): void {
    this.messages = [];
    this.times = [];
    this.keyframes = [];
    this.base = emptyPicture();
    this.current = emptyPicture();
    this.lastKeyframeT = Number.NEGATIVE_INFINITY;
  }

  /** Drop the oldest messages up to a keyframe, which becomes the new base state. */
  private trim(): void {
    const excess = this.messages.length - this.limit;
    const cut = this.keyframes.find((k) => k.index >= excess);
    if (!cut) return;
    const drop = cut.index + 1;
    this.base = cut.state;
    this.messages = this.messages.slice(drop);
    this.times = this.times.slice(drop);
    this.keyframes = this.keyframes.filter((k) => k.index >= drop).map((k) => ({ index: k.index - drop, state: k.state }));
  }
}

/** A message's picture time in ms; hello has none of its own and uses its start time. */
function timeOf(message: PictureMessage, state: PictureState): number | undefined {
  if (message.type === "hello") return state.t ? Date.parse(state.t) : Date.parse(message.started_at);
  return Date.parse(message.t);
}
