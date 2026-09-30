// Live validation (VIDENS_SPEC.md 16.2 rule 7). Errors are what vigilans-hub would refuse to
// load: the scenario.v2 schema, and the contract's cross-reference checks
// (vigilans_contract.semantic.scenario_issues, scenario-spec.md 11) reproduced, each naming
// the object at fault. Warnings are scenarios that would load but probably not show what
// the author meant.

import * as validators from "../contract/generated/validators.js";
import { geodesicInverse } from "../geo/geodesic.ts";
import { DEFAULT_SOURCE_ID } from "./defaults.ts";
import { toLatLon } from "./frame.ts";
import { classFor, type Library } from "./library.ts";
import { isSwitchedOn, positionAt } from "./motion.ts";
import { marginDb } from "./propagation.ts";
import type { Emitter, Scenario, Sensor, Source } from "./types.ts";

export type ScenarioRef =
  | { kind: "scenario" }
  | { kind: "source"; id: string }
  | { kind: "sensor"; id: string }
  | { kind: "emitter"; id: string }
  | { kind: "net"; id: string }
  | { kind: "relation"; index: number };

export interface ScenarioIssue {
  severity: "error" | "warning";
  message: string;
  ref: ScenarioRef;
}

/** Distances beyond which the local frame's distortion stops being negligible (ADR-0006). */
const FAR_FROM_ORIGIN_M = 200_000;
const HEARING_SAMPLES = 24;

/** The kind of source a sensor reports through: an unlisted source is a bearing source. */
export function sourceKind(s: Scenario, sensor: Sensor): Source["kind"] {
  return s.sources?.find((x) => x.id === (sensor.source_id ?? DEFAULT_SOURCE_ID))?.kind ?? "bearing";
}

export function scenarioIssues(s: Scenario, library: Library | null): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const error = (message: string, ref: ScenarioRef = { kind: "scenario" }) => issues.push({ severity: "error", message, ref });
  const warn = (message: string, ref: ScenarioRef = { kind: "scenario" }) => issues.push({ severity: "warning", message, ref });

  if (!validators.scenario(s)) {
    for (const e of validators.scenario.errors ?? []) error(`${e.instancePath || "scenario"}: ${e.message ?? e.keyword}`, refForPath(s, e.instancePath));
  }
  if (!s.sensors.length) error("A scenario needs at least one sensor.");
  if (!s.emitters.length) error("A scenario needs at least one emitter.");

  const sources = s.sources ?? [];
  for (const [label, ids, kind] of [
    ["source", sources.map((x) => x.id), "source"],
    ["sensor", s.sensors.map((x) => x.id), "sensor"],
    ["emitter", s.emitters.map((x) => x.id), "emitter"],
    ["net", (s.nets ?? []).map((x) => x.id), "net"],
  ] as const) {
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) error(`Duplicate ${label} id "${id}".`, { kind, id });
  }

  const usedSources = new Set(s.sensors.map((x) => x.source_id ?? DEFAULT_SOURCE_ID));
  for (const source of sources) {
    if (!usedSources.has(source.id)) warn(`Source ${source.id} has no sensors, so it reports nothing.`, { kind: "source", id: source.id });
  }

  let bearingSensors = 0;
  for (const sensor of s.sensors) {
    const ref = { kind: "sensor", id: sensor.id } as const;
    const [lo, hi] = sensor.freq_range_hz ?? [20e6, 3e9];
    if (!(lo! < hi!)) error(`Sensor ${sensor.id}: the band's low edge must be below its high edge.`, ref);
    if (sensor.scan && sensor.scan.dwell_s > sensor.scan.revisit_s) error(`Sensor ${sensor.id}: scan dwell is longer than its revisit time.`, ref);
    const kind = sourceKind(s, sensor);
    if (kind === "bearing") {
      bearingSensors += 1;
      if (sensor.bearing_sigma_deg == null) error(`Sensor ${sensor.id} reports bearings (source ${sensor.source_id}), so it needs a bearing σ.`, ref);
    }
    if (kind === "position" && sensor.elevation_sigma_deg) {
      error(`Sensor ${sensor.id}: a position source's receiver reports positions, not angles; clear its elevation σ.`, ref);
    }
  }
  if (bearingSensors === 1 && s.sensors.length === 1) warn("Only one sensor: bearings alone cannot fix a position.");

  const nets = new Set((s.nets ?? []).map((n) => n.id));
  for (const net of s.nets ?? []) {
    const ref = { kind: "net", id: net.id } as const;
    const [a, b] = net.turnaround_s ?? [1, 3];
    if (a! > b!) error(`Net ${net.id}: turnaround minimum exceeds its maximum.`, ref);
    const members = s.emitters.filter((e) => e.activity?.type === "net" && e.activity.net_id === net.id);
    if (!members.length) warn(`Net ${net.id} has no members.`, ref);
    else if (!members.some((e) => e.activity?.hub)) warn(`Net ${net.id} has no hub, so nobody answers calls.`, ref);
  }

  for (const e of s.emitters) emitterIssues(s, e, nets, library, error, warn);

  const seen = new Set<string>();
  for (const d of s.operator?.declarations ?? []) {
    const known = sources.some((x) => x.id === d.source_id);
    const ref: ScenarioRef = known ? { kind: "source", id: d.source_id } : { kind: "scenario" };
    if (!usedSources.has(d.source_id)) error(`Declaration for source ${d.source_id}: no sensor reports as that source.`, ref);
    const assumes = d.assumed_bearing_sigma_deg != null || d.assumed_elevation_sigma_deg != null || d.assumed_position_sigma_m != null;
    if (assumes && !d.assumption_note) error(`Declaration for source ${d.source_id}: an assumed uncertainty needs a note saying why.`, ref);
    if (seen.has(d.source_id)) warn(`Source ${d.source_id} is declared more than once; the editor shows the first.`, ref);
    seen.add(d.source_id);
  }

  const emitterIds = new Set(s.emitters.map((e) => e.id));
  (s.truth_relations ?? []).forEach((r, index) => {
    const ref = { kind: "relation", index } as const;
    for (const m of r.members) if (!emitterIds.has(m.emitter_id)) error(`Relation ${index + 1}: no emitter "${m.emitter_id}".`, ref);
    const ids = r.members.map((m) => m.emitter_id);
    if (new Set(ids).size !== ids.length) warn(`Relation ${index + 1} lists an emitter twice.`, ref);
  });
  return issues;
}

function emitterIssues(
  s: Scenario,
  e: Emitter,
  nets: Set<string>,
  library: Library | null,
  error: (m: string, r: ScenarioRef) => void,
  warn: (m: string, r: ScenarioRef) => void,
): void {
  const ref = { kind: "emitter", id: e.id } as const;
  if (e.path_m.length > 1 && (e.speed_mps ?? 0) <= 0) error(`Emitter ${e.id}: a path with ${e.path_m.length} waypoints needs a speed.`, ref);

  const a = e.activity ?? { type: "continuous" };
  if (a.type === "periodic" && a.on_s != null && a.period_s != null && a.on_s > a.period_s) error(`Emitter ${e.id}: on time cannot exceed the period.`, ref);
  if (a.type === "periodic" && (a.offset_s ?? 0) >= s.duration_s) warn(`Emitter ${e.id} first transmits at ${a.offset_s} s, after the scenario ends.`, ref);
  if (a.type === "net" && !a.net_id) error(`Emitter ${e.id}: net activity needs a net.`, ref);
  if (a.type === "net" && a.net_id && !nets.has(a.net_id)) error(`Emitter ${e.id}: no net "${a.net_id}".`, ref);

  const windows = e.active_windows_s ?? [];
  windows.forEach(([start, stop], j) => {
    if (!(start! < stop!)) error(`Emitter ${e.id}: active window ${j + 1} must start before it stops.`, ref);
  });
  if (windows.length && windows.every(([start]) => start! >= s.duration_s)) warn(`Emitter ${e.id} is never switched on before the scenario ends at ${s.duration_s} s.`, ref);

  const cls = classFor(library ?? { classes: [], roles: [], problems: [] }, e.truth?.class_id);
  if (e.truth?.class_id && library && !cls) warn(`Emitter ${e.id}: class "${e.truth.class_id}" is not in the loaded library.`, ref);
  if (cls && (e.freq_hz < cls.freqHz[0] || e.freq_hz > cls.freqHz[1])) {
    warn(`Emitter ${e.id}: ${(e.freq_hz / 1e6).toFixed(4)} MHz is outside ${cls.label}'s band, so the library will not match it to that class.`, ref);
  }

  for (const p of e.path_m) {
    if (Math.hypot(p[0]!, p[1]!) > FAR_FROM_ORIGIN_M) {
      warn(`Emitter ${e.id} is over ${FAR_FROM_ORIGIN_M / 1000} km from the origin, where the local frame's distortion grows; move the origin closer.`, ref);
      break;
    }
  }

  const { bearing, position } = mostHearing(s, e);
  if (bearing === 0 && position === 0) warn(`No sensor can hear ${e.id} while it is switched on: out of band or out of range.`, ref);
  else if (bearing === 1 && position === 0) warn(`Only one bearing sensor can hear ${e.id} at a time, so it cannot be fixed from bearings.`, ref);
}

/** Times to sample an emitter at: spread across each stretch it is switched on. */
function switchedOnSamples(s: Scenario, e: Emitter): number[] {
  const windows = e.active_windows_s?.length ? e.active_windows_s : [[0, s.duration_s]];
  const times: number[] = [];
  for (const [start, stop] of windows) {
    const from = Math.max(start!, 0);
    const until = Math.min(stop!, s.duration_s);
    if (!(until > from)) continue;
    for (let k = 0; k < HEARING_SAMPLES; k++) times.push(from + ((until - from) * k) / HEARING_SAMPLES);
  }
  return times.filter((t) => isSwitchedOn(e, t));
}

/** The most bearing sensors, and position-source receivers, able to hear the emitter at once. */
export function mostHearing(s: Scenario, e: Emitter): { bearing: number; position: number } {
  let bearing = 0;
  let position = 0;
  for (const t of switchedOnSamples(s, e)) {
    const hearing = sensorsHearing(s, e, t).filter((h) => h.hears);
    bearing = Math.max(bearing, hearing.filter((h) => h.sourceKind === "bearing").length);
    position = Math.max(position, hearing.filter((h) => h.sourceKind === "position").length);
  }
  return { bearing, position };
}

export interface Hearing {
  sensorId: string;
  sourceKind: Source["kind"];
  inBand: boolean;
  distanceM: number;
  marginDb: number;
  hears: boolean;
}

/**
 * Each sensor's median margin above threshold for this emitter at time t: the hub's
 * detection rule without its shadowing draw, over the geodesic ground distance it uses.
 * A scanning sensor hears only while tuned; this is the margin when it is.
 */
export function sensorsHearing(s: Scenario, e: Emitter, t: number): Hearing[] {
  const origin = s.origin ?? { lat: 50, lon: -105 };
  const [ex, ey] = positionAt(e, t);
  const at = toLatLon(origin, ex, ey);
  const exponent = s.propagation?.exponent ?? 2.7;
  return s.sensors.map((sensor) => {
    const [lo, hi] = sensor.freq_range_hz ?? [20e6, 3e9];
    const inBand = e.freq_hz >= lo! && e.freq_hz <= hi!;
    const where = toLatLon(origin, sensor.pos_m[0]!, sensor.pos_m[1]!);
    const distanceM = geodesicInverse(where.lat, where.lon, at.lat, at.lon).distanceM;
    const margin = marginDb(
      { eirpDbm: e.eirp_dbm ?? 40, freqHz: e.freq_hz, exponent, noiseFloorDbm: sensor.noise_floor_dbm ?? -110, thresholdDb: sensor.threshold_db ?? 6 },
      distanceM,
    );
    return { sensorId: sensor.id, sourceKind: sourceKind(s, sensor), inBand, distanceM, marginDb: margin, hears: inBand && margin >= 0 };
  });
}

function refForPath(s: Scenario, path: string): ScenarioRef {
  const m = /^\/(sources|sensors|emitters|nets|truth_relations|operator\/declarations)\/(\d+)/.exec(path);
  if (!m) return { kind: "scenario" };
  const i = Number(m[2]);
  if (m[1] === "sources" && s.sources?.[i]) return { kind: "source", id: s.sources[i]!.id };
  if (m[1] === "sensors" && s.sensors[i]) return { kind: "sensor", id: s.sensors[i]!.id };
  if (m[1] === "emitters" && s.emitters[i]) return { kind: "emitter", id: s.emitters[i]!.id };
  if (m[1] === "nets" && s.nets?.[i]) return { kind: "net", id: s.nets[i]!.id };
  if (m[1] === "truth_relations" && s.truth_relations?.[i]) return { kind: "relation", index: i };
  const d = s.operator?.declarations?.[i];
  if (m[1] === "operator/declarations" && d && s.sources?.some((x) => x.id === d.source_id)) return { kind: "source", id: d.source_id };
  return { kind: "scenario" };
}
