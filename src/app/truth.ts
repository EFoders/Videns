// The simulation truth overlay (VIDENS_SPEC.md 8.7).
//
// Truth is a separate channel -- its own contract (truth.v0), its own stream or file, its
// own store -- and never touches the picture. It may be offered only when the viewer's
// configuration allows it, and switched on only for a run whose clock is simulated: real
// data has no truth, and a "truth" layer over it would be a fabrication.

import { computed, signal } from "@preact/signals";

import type { Entity } from "../contract/generated/picture.ts";
import type { TruthEmitter, TruthFrame } from "../contract/generated/truth.ts";
import { parseTruth } from "../contract/validate.ts";
import { insideRegion } from "../geo/ellipse.ts";
import { geodesicInverse } from "../geo/geodesic.ts";
import { config, shown, source } from "./state.ts";

export const TRUTH_STREAM = "/truth/v0/stream";
const LIVE_LIMIT = 3000;

export const truthOn = signal(false);
const liveFrames = signal<readonly TruthFrame[]>([]);
export const fileTruth = signal<{ name: string; frames: readonly TruthFrame[] } | null>(null);
let stream: EventSource | null = null;

export interface Availability {
  available: boolean;
  reason?: string;
}

/** Whether truth may be shown for this run, and if not, why. */
export function truthAvailable(allowedByConfig: boolean, clockMode: "sim" | "wall" | undefined): Availability {
  if (!allowedByConfig) return { available: false, reason: "this viewer's configuration does not offer the truth overlay" };
  if (clockMode === undefined) return { available: false, reason: "no run header yet, so it is not known whether this run is simulated" };
  if (clockMode === "wall") return { available: false, reason: "this run uses the wall clock: real data has no simulation truth" };
  return { available: true };
}

export const truthAvailability = computed(() => truthAvailable(config.value?.truthOverlay ?? false, shown.value.hello?.clock.mode));

export function setTruth(on: boolean): void {
  if (on && !truthAvailability.value.available) return;
  truthOn.value = on;
  if (on && source.value.kind === "live") connect();
  else disconnect();
}

function connect(): void {
  if (stream) return;
  stream = new EventSource(TRUTH_STREAM);
  stream.onmessage = (event: MessageEvent<string>) => {
    const result = parseTruth(event.data);
    if (!result.ok) return;
    const frames = liveFrames.value;
    // A new run starts a new history, as the picture's timeline does.
    const kept = frames.length && frames.at(-1)!.run_id !== result.frame.run_id ? [] : frames;
    const next = [...kept, result.frame];
    liveFrames.value = next.length > LIVE_LIMIT ? next.slice(next.length - LIVE_LIMIT) : next;
  };
}

function disconnect(): void {
  stream?.close();
  stream = null;
}

/** Load a .truth.jsonl file to go with a recording. Returns how many frames were rejected. */
export async function openTruth(file: File): Promise<{ accepted: number; rejected: number }> {
  const frames: TruthFrame[] = [];
  let rejected = 0;
  for (const line of (await file.text()).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const result = parseTruth(line);
    if (result.ok) frames.push(result.frame);
    else rejected += 1;
  }
  frames.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  fileTruth.value = { name: file.name, frames };
  return { accepted: frames.length, rejected };
}

/** The truth frame for the picture on screen: the newest at or before its time, same run. */
export const truthNow = computed<TruthFrame | null>(() => {
  if (!truthOn.value || !truthAvailability.value.available) return null;
  const picture = shown.value;
  if (!picture.t || !picture.runId) return null;
  const frames = source.value.kind === "file" ? (fileTruth.value?.frames ?? []) : liveFrames.value;
  const t = Date.parse(picture.t);
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]!;
    if (frame.run_id === picture.runId && Date.parse(frame.t) <= t) return frame;
  }
  return null;
});

export interface TruthComparison {
  emitter: TruthEmitter;
  distanceM: number;
  /** Whether truth lies inside the region drawn at `confidence`; null when there is none. */
  inside: boolean | null;
}

/**
 * How far the picture's entity is from the emitter the simulator associated with it.
 * Only an association the truth itself states is used: Videns never pairs truth with
 * entities on its own (rule 1). Display of a comparison, not scoring.
 */
export function compareWithTruth(entity: Entity, frame: TruthFrame | null, confidence: number): TruthComparison | null {
  const emitter = frame?.emitters.find((e) => e.entity_id === entity.entity_id);
  if (!emitter || !entity.position) return null;
  const { distanceM, azimuthDeg } = geodesicInverse(entity.position.lat, entity.position.lon, emitter.lat, emitter.lon);
  const rad = (azimuthDeg * Math.PI) / 180;
  const inside = entity.position_uncertainty
    ? insideRegion(entity.position_uncertainty, distanceM * Math.sin(rad), distanceM * Math.cos(rad), confidence)
    : null;
  return { emitter, distanceM, inside };
}
