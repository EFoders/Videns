// Scenario files: open scenario.v2, the editor's older scenario.v1 or a prototype scenario;
// save scenario.v2, the Vigilans contract's format (contract/scenario.v2.schema.json), which
// vigilans-hub runs as it stands; export for the prototype (VIDENS_SPEC.md 16.1). Nothing is
// dropped silently: converting an older file or exporting for the prototype returns a
// sentence for each thing the format being written cannot express, and what was done instead.

import { Document, isMap, isScalar, isSeq, parse, visit } from "yaml";

import type { ScenarioEmitter as EmitterV1, ScenarioV1 } from "../contract/generated/scenario-v1.ts";
import * as validators from "../contract/generated/validators.js";
import { DEFAULT_ORIGIN, holdOf, normalise, waypoint } from "./defaults.ts";
import { sourceKind } from "./validate.ts";
import type { Emitter, Scenario, Sensor, Source } from "./types.ts";

export type Flavour = "v2" | "v1" | "prototype";

export interface Opened {
  scenario: Scenario | null;
  flavour: Flavour;
  /** Why the file did not open. */
  problems: string[];
  /** What changed in bringing an older file to scenario.v2. */
  notes: string[];
}

const schemaErrors = (errors: { instancePath: string; message?: string; keyword: string }[] | null | undefined) => [
  ...new Set((errors ?? []).map((e) => `${e.instancePath || "/"}: ${e.message ?? e.keyword}`)),
];

export function openScenario(text: string): Opened {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return { scenario: null, flavour: "prototype", problems: [`not valid YAML: ${(error as Error).message}`], notes: [] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { scenario: null, flavour: "prototype", problems: ["expected a mapping at the top level"], notes: [] };
  }
  const schema = (raw as { schema?: unknown }).schema;
  if (schema === "scenario.v2" || (schema === "scenario.v1" && validators.scenario(raw))) {
    // A scenario.v1 file that meets scenario.v2 means the same thing under it.
    if (!validators.scenario(raw)) return { scenario: null, flavour: "v2", problems: schemaErrors(validators.scenario.errors), notes: [] };
    return { scenario: normalise(raw as Scenario), flavour: schema === "scenario.v2" ? "v2" : "v1", problems: [], notes: [] };
  }
  if (schema !== undefined && schema !== "scenario.v1") {
    return { scenario: null, flavour: "prototype", problems: [`unknown schema ${JSON.stringify(schema)}: expected scenario.v2, scenario.v1 or a prototype scenario`], notes: [] };
  }
  const flavour: Flavour = schema === "scenario.v1" ? "v1" : "prototype";
  if (!validators.scenarioV1(raw)) return { scenario: null, flavour, problems: schemaErrors(validators.scenarioV1.errors), notes: [] };
  const { scenario, notes } = fromV1(raw as ScenarioV1);
  return { scenario, flavour, problems: [], notes };
}

/**
 * The editor's scenario.v1 (or a prototype file, which it contains) as scenario.v2. Per-leg
 * pauses become waypoint holds exactly; per-leg speeds, an active window's delayed start on
 * a loop, frequency-rule declarations and prototype-only sections have no scenario.v2 form
 * and are listed.
 */
export function fromV1(v1: ScenarioV1): { scenario: Scenario; notes: string[] } {
  const notes: string[] = [];
  if (!v1.origin) notes.push(`No origin: scenario.v2 needs one, so it is ${DEFAULT_ORIGIN.lat}, ${DEFAULT_ORIGIN.lon}, the prototype's default.`);
  if (v1.engine) notes.push("engine: engine settings are run configuration, not part of scenario.v2; not carried over.");
  if (v1.expect) notes.push("expect: the prototype's pass criteria are not part of scenario.v2; not carried over.");
  for (const d of v1.operator?.declarations ?? []) {
    notes.push(
      `Declaration ${d.id} (${d.identity} for ${(d.freq_hz[0]! / 1e6).toFixed(4)}–${(d.freq_hz[1]! / 1e6).toFixed(4)} MHz): scenario.v2 declares what the operator knows about a source, not a channel; not carried over.`,
    );
  }
  const sensors: Sensor[] = v1.sensors.map((x) => ({ ...x }));
  const emitters = v1.emitters.map((e) => emitterFromV1(e, v1.duration_s, notes));
  const scenario = normalise({
    schema: "scenario.v2",
    name: v1.name.slice(0, 64),
    description: v1.description,
    seed: v1.seed,
    duration_s: v1.duration_s,
    tick_s: v1.tick_s,
    origin: v1.origin ?? DEFAULT_ORIGIN,
    propagation: v1.propagation,
    sensors,
    nets: (v1.nets ?? []).map((n) => ({ ...n })),
    emitters,
    truth_relations: (v1.truth_relations ?? []).map(({ id: _id, ...r }) => ({ ...r, members: r.members.map((m) => ({ ...m })) })),
  });
  if (v1.name.length > 64) notes.push(`The name is cut to 64 characters, scenario.v2's limit.`);
  return { scenario, notes };
}

function emitterFromV1(e: EmitterV1, durationS: number, notes: string[]): Emitter {
  const { legs, active, activity, ...rest } = e;
  const holds = e.path_m.map((_, i) => legs?.[i]?.dwell_s ?? 0);
  let speed = e.speed_mps ?? 0;
  if (legs?.some((l) => l.speed_mps !== undefined && l.speed_mps !== e.speed_mps)) {
    speed = singleSpeed(e);
    notes.push(`${e.id}: per-leg speeds have no scenario.v2 form. It moves at one speed, ${speed.toFixed(2)} m/s, so a pass takes as long as before (pauses aside).`);
  }
  let windows: number[][] | undefined;
  const from = active?.from_s ?? 0;
  const until = active?.until_s;
  if (from > 0 || until !== undefined) {
    windows = [[from, until ?? Math.max(durationS, from + 1)]];
    if (from > 0 && !e.loop && e.path_m.length > 1) {
      holds[0] = (holds[0] ?? 0) + from;
      notes.push(`${e.id}: its active window becomes a switched-on window, and its ${from} s wait before setting off a hold at its first waypoint.`);
    } else if (from > 0 && e.path_m.length > 1) {
      notes.push(`${e.id}: its active window becomes a switched-on window. It now starts its loop at 0 s, not ${from} s: scenario.v2 windows switch the transmitter, not the platform.`);
    }
  }
  const out: Emitter = {
    ...rest,
    speed_mps: speed,
    path_m: e.path_m.map((p, i) => waypoint(p[0]!, p[1]!, holds[i] ?? 0)),
    ...(activity ? { activity: { ...prune(activity), type: activity.type ?? "continuous" } } : {}),
    ...(windows ? { active_windows_s: windows } : {}),
  };
  return out;
}

/** One speed standing in for per-leg speeds: path length over travelling time. */
function singleSpeed(e: EmitterV1): number {
  const path = e.path_m;
  const lengths: number[] = path.slice(1).map((p, i) => Math.hypot(p[0]! - path[i]![0]!, p[1]! - path[i]![1]!));
  if (e.loop) lengths.push(Math.hypot(path[0]![0]! - path.at(-1)![0]!, path[0]![1]! - path.at(-1)![1]!));
  let length = 0;
  let time = 0;
  lengths.forEach((len, i) => {
    const speed = e.legs?.[i]?.speed_mps ?? e.speed_mps ?? 0;
    if (len > 0 && speed > 0) {
      length += len;
      time += len / speed;
    }
  });
  return time > 0 ? length / time : (e.speed_mps ?? 0);
}

const HEADER_V2 = [
  " Vigilans scenario (scenario.v2), made with the Videns scenario editor.",
  " Run it with vigilans-hub; the format is Vigilans 2.0 docs/scenario-spec.md.",
  " Positions are east/north metres from `origin` (WGS84 azimuthal equidistant).",
  " truth.* and truth_relations are for the simulator and scorer only; the engine never",
  " sees them. operator.declarations is what the operator tells the engine about a source.",
].join("\n");

const HEADER_PROTOTYPE = [
  " Vigilans prototype scenario, exported by the Videns scenario editor from scenario.v2.",
  " Positions are east/north metres from `origin` (WGS84 azimuthal equidistant).",
].join("\n");

/**
 * The scenario as it will be saved: normalised, with settings that do not apply to an
 * object's kind left out (a position receiver's bearing sigma, a bearing source's
 * position settings), so the file says only what the simulator will use.
 */
export function forSave(input: Scenario): Scenario {
  const s = normalise(input);
  return {
    ...s,
    sources: (s.sources ?? []).map((x): Source => {
      if (x.kind === "position") return x;
      const { position_sigma_m: _p, region_confidence: _r, ...rest } = x;
      return rest;
    }),
    sensors: s.sensors.map((x): Sensor => {
      if (sourceKind(s, x) === "bearing") return x;
      const { bearing_sigma_deg: _b, ...rest } = x;
      return rest;
    }),
  };
}

export function saveScenario(s: Scenario): string {
  return render(forSave(s), HEADER_V2);
}

export interface Exported {
  text: string;
  /** One sentence per thing the prototype cannot express, and what was used instead. */
  dropped: string[];
}

/** Exactly the prototype's scenario format (Vigilans-prototype models/scenario.py). */
export function exportPrototype(input: Scenario): Exported {
  const s = normalise(input);
  const dropped: string[] = [];
  const sensorLabels = s.sensors.filter((x) => x.label).length;
  const emitterLabels = s.emitters.filter((x) => x.label).length;
  if (sensorLabels || emitterLabels) dropped.push(`Labels (${sensorLabels + emitterLabels}): the prototype has none; ids are kept.`);
  if (s.emitters.some((e) => e.truth?.side && e.truth.side !== "unknown")) {
    dropped.push("True sides: the prototype does not record them; its affiliations come from the library's defaults.");
  }

  for (const source of s.sources ?? []) {
    const settings = [
      source.reports_uncertainty === false && "reports no uncertainty",
      source.freq_bias_hz && `a ${source.freq_bias_hz} Hz frequency bias`,
      source.clock_offset_s && `a ${source.clock_offset_s} s clock offset`,
      source.emits_coverage && "coverage records",
      source.fault && `a deliberate ${source.fault.kind} fault`,
    ].filter(Boolean);
    if (source.kind === "bearing" && settings.length) {
      dropped.push(`Source ${source.id}: ${settings.join(", ")}. The prototype's sensors report honestly and exactly.`);
    }
  }
  const positionReceivers = s.sensors.filter((x) => sourceKind(s, x) === "position");
  if (positionReceivers.length) {
    dropped.push(`Position-source receivers (${positionReceivers.map((x) => x.id).join(", ")}): the prototype has only direction-finding sensors; left out.`);
  }
  const scanning = s.sensors.filter((x) => x.scan && sourceKind(s, x) === "bearing");
  if (scanning.length) dropped.push(`Scanning (${scanning.map((x) => x.id).join(", ")}): the prototype's sensors listen continuously.`);

  const declarations = s.operator?.declarations ?? [];
  if (declarations.length) dropped.push(`Operator declarations (${declarations.length}): the prototype has none.`);
  const relations = s.truth_relations ?? [];
  if (relations.length) dropped.push(`True relations (${relations.length}): the prototype does not score grouping against them.`);

  const sensors = s.sensors
    .filter((x) => sourceKind(s, x) === "bearing")
    .map(({ label: _l, source_id: _s, scan: _scan, ...rest }) => prune(rest));

  const emitters = s.emitters.map((e) => {
    const { label: _label, truth, active_windows_s: windows, source_claim: claim, activity, ...rest } = e;
    const holds = e.path_m.filter((p) => holdOf(p) > 0).length;
    if (holds) dropped.push(`${e.id}: ${holds} waypoint hold${holds > 1 ? "s" : ""}. The prototype moves it without pausing, so it arrives sooner.`);
    if (windows?.length) dropped.push(`${e.id}: switched on only in ${windows.map(([a, b]) => `${a}–${b} s`).join(", ")}. The prototype has it on for the whole run.`);
    if (claim) dropped.push(`${e.id}: its ${claim.scheme} self-identification. The prototype has no claims.`);
    const { offset_s: offset, ...prototypeActivity } = activity ?? { type: "continuous" };
    if (offset) dropped.push(`${e.id}: a ${offset} s periodic offset. The prototype starts every period at 0 s.`);
    return {
      ...rest,
      truth: { class_id: truth?.class_id ?? null, role_id: truth?.role_id ?? null },
      path_m: e.path_m.map((p) => [p[0]!, p[1]!]),
      activity: prune(prototypeActivity),
    };
  });

  const prototype: Record<string, unknown> = {
    name: s.name,
    description: s.description,
    seed: s.seed,
    duration_s: s.duration_s,
    tick_s: s.tick_s,
    origin: s.origin,
    propagation: s.propagation,
    sensors,
    ...(s.nets?.length ? { nets: s.nets.map(({ label: _l, ...n }) => n) } : {}),
    emitters,
  };
  return { text: render(prototype, HEADER_PROTOTYPE), dropped };
}

function prune(o: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * YAML laid out the way hand-written scenarios are: coordinate pairs and small scalar maps
 * inline, everything else in blocks.
 */
function render(data: unknown, header: string): string {
  const doc = new Document(data);
  doc.commentBefore = header;
  visit(doc, {
    Seq(_key, node) {
      const allScalar = node.items.every((i) => isScalar(i));
      const allTuples = node.items.length > 0 && node.items.every((i) => isSeq(i) && i.items.every((j) => isScalar(j)));
      if ((allScalar && node.items.length <= 4) || allTuples) node.flow = true;
    },
    Map(_key, node) {
      if (node.items.length <= 4 && node.items.every((p) => isScalar(p.value) || (isSeq(p.value) && p.value.items.every((j) => isScalar(j))))) {
        // Small maps of scalars read best on one line; top-level objects never are small.
        const keys = node.items.map((p) => (isScalar(p.key) ? String(p.key.value) : ""));
        if (!keys.includes("id") || keys.length <= 2) node.flow = true;
      }
    },
  });
  // Blank lines between top-level sections.
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items.slice(1)) {
      if (isScalar(pair.key) && ["origin", "propagation", "sources", "sensors", "nets", "emitters", "operator", "truth_relations"].includes(String(pair.key.value))) {
        pair.key.spaceBefore = true;
      }
    }
  }
  return doc.toString({ lineWidth: 100 });
}
