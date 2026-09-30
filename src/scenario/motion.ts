// Where an emitter is at a moment of the scenario: vigilans-hub's motion model (Vigilans 2.0
// hub/src/vigilans_hub/world.py, _timeline and position_en), reproduced step for step.
// Straight legs in the local plane at one speed; a waypoint's hold is a wait there before
// moving on; a looping path returns to its first waypoint and starts again; a path that does
// not loop waits out its last hold and stays. Motion runs from time zero whatever the
// emitter's active windows say: they switch the transmitter, not the platform. With no
// holds this is the prototype's position_at, and is tested against it
// (tests/vectors/scenario.json).

import { holdOf } from "./defaults.ts";
import type { Emitter } from "./types.ts";

type Point = [number, number];

interface Segment {
  t0: number;
  t1: number;
  from: Point;
  to: Point;
}

/** One pass of the path as timed segments, holds as zero-length moves; and its period. */
function timeline(e: Emitter): { segments: Segment[]; period: number } {
  const points = e.path_m.map((p) => ({ at: [p[0]!, p[1]!] as Point, hold: holdOf(p) }));
  const speed = e.speed_mps ?? 0;
  const first = points[0]!;
  if (points.length === 1 || speed <= 0) {
    return { segments: [{ t0: 0, t1: Number.POSITIVE_INFINITY, from: first.at, to: first.at }], period: Number.POSITIVE_INFINITY };
  }
  if (e.loop) points.push({ at: first.at, hold: 0 });
  const segments: Segment[] = [];
  let t = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const { at: from, hold } = points[i]!;
    const to = points[i + 1]!.at;
    if (hold > 0) {
      segments.push({ t0: t, t1: t + hold, from, to: from });
      t += hold;
    }
    const duration = Math.hypot(to[0] - from[0], to[1] - from[1]) / speed;
    segments.push({ t0: t, t1: t + duration, from, to });
    t += duration;
  }
  if (e.loop) return { segments, period: t };
  const last = points.at(-1)!;
  if (last.hold > 0) {
    segments.push({ t0: t, t1: t + last.hold, from: last.at, to: last.at });
    t += last.hold;
  }
  segments.push({ t0: t, t1: Number.POSITIVE_INFINITY, from: last.at, to: last.at });
  return { segments, period: Number.POSITIVE_INFINITY };
}

/** Whether the emitter is switched on at scenario time t: inside an active window, if it has any. */
export function isSwitchedOn(e: Emitter, t: number): boolean {
  const windows = e.active_windows_s;
  return !windows?.length || windows.some(([start, stop]) => start! <= t && t < stop!);
}

/** The emitter's [east, north] at scenario time t, in local metres. */
export function positionAt(e: Emitter, t: number): Point {
  const { segments, period } = timeline(e);
  let clock = t;
  if (Number.isFinite(period) && period > 0) clock = ((clock % period) + period) % period;
  for (const s of segments) {
    if (clock <= s.t1) {
      const f = s.t1 === s.t0 || !Number.isFinite(s.t1) ? 0 : (clock - s.t0) / (s.t1 - s.t0);
      return [s.from[0] + (s.to[0] - s.from[0]) * f, s.from[1] + (s.to[1] - s.from[1]) * f];
    }
  }
  return segments.at(-1)!.to;
}

/** Every leg, densified in the local plane for drawing: what the simulator will follow. */
export function pathSamples(e: Emitter, spacingM = 250): { points: Point[]; closing: Point[] | null } {
  const path = e.path_m.map((p) => [p[0]!, p[1]!] as Point);
  const densify = (from: Point, to: Point): Point[] => {
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / spacingM));
    return Array.from({ length: steps }, (_, k) => {
      const f = (k + 1) / steps;
      return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f] as Point;
    });
  };
  const points: Point[] = [path[0]!];
  for (let i = 1; i < path.length; i++) points.push(...densify(path[i - 1]!, path[i]!));
  const first = path[0]!;
  const last = path.at(-1)!;
  const closes = Boolean(e.loop) && path.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) > 0;
  return { points, closing: closes ? [last, ...densify(last, first)] : null };
}

/**
 * How long one pass of the path takes, holds included, in seconds: the loop's period, or
 * the time a path that does not loop comes to rest. Infinity for a static emitter.
 */
export function passDuration(e: Emitter): number {
  const { segments, period } = timeline(e);
  if (Number.isFinite(period)) return period;
  const finite = segments.filter((s) => Number.isFinite(s.t1));
  return finite.length ? finite.at(-1)!.t1 : Number.POSITIVE_INFINITY;
}
