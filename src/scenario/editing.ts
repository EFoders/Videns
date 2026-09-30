// Scenario edits as pure functions: scenario in, new scenario out. The editor's undo and
// redo are a list of these results; tests call them directly.

import { DEFAULT_SOURCE_ID, holdOf, ID_PATTERN, NET_DEFAULTS, nextId, normaliseEmitter, normaliseSensor, normaliseSource, waypoint, withSources } from "./defaults.ts";
import { reframe, roundPoint, type Origin } from "./frame.ts";
import { classDefaults, type EmitterClass } from "./library.ts";
import type { Emitter, Net, OperatorDeclaration, Scenario, Sensor, Side, Source, TruthRelation } from "./types.ts";

type Point = [number, number];

const validId = (id: string) => ID_PATTERN.test(id);

// --- Sources ---------------------------------------------------------------------------

export function addSource(s: Scenario, kind: Source["kind"]): { scenario: Scenario; id: string } {
  const id = nextId(kind === "position" ? "POS" : "DF", (s.sources ?? []).map((x) => x.id));
  return { scenario: { ...s, sources: [...(s.sources ?? []), normaliseSource({ id, kind })] }, id };
}

export function updateSource(s: Scenario, id: string, patch: Partial<Source>): Scenario {
  return { ...s, sources: (s.sources ?? []).map((x) => (x.id === id ? normaliseSource({ ...x, ...patch }) : x)) };
}

/** Rename a source, carrying its sensors and its declaration along. */
export function renameSource(s: Scenario, id: string, newId: string): Scenario {
  if (!validId(newId) || id === newId || (s.sources ?? []).some((x) => x.id === newId)) return s;
  return {
    ...s,
    sources: (s.sources ?? []).map((x) => (x.id === id ? { ...x, id: newId } : x)),
    sensors: s.sensors.map((x) => (x.source_id === id ? { ...x, source_id: newId } : x)),
    operator: { declarations: declarations(s).map((d) => (d.source_id === id ? { ...d, source_id: newId } : d)) },
  };
}

/**
 * Remove a source. Its sensors move to the first source left (or a new default one), and
 * its declaration goes with it: nothing is left naming a source that is not there.
 */
export function deleteSource(s: Scenario, id: string): Scenario {
  const rest = (s.sources ?? []).filter((x) => x.id !== id);
  const fallback = rest[0]?.id ?? DEFAULT_SOURCE_ID;
  return withSources({
    ...s,
    sources: rest,
    sensors: s.sensors.map((x) => (x.source_id === id ? { ...x, source_id: fallback } : x)),
    operator: { declarations: declarations(s).filter((d) => d.source_id !== id) },
  });
}

// --- Sensors ---------------------------------------------------------------------------

export function addSensor(s: Scenario, at: Point, sourceId?: string): { scenario: Scenario; id: string } {
  const id = nextId("S", s.sensors.map((x) => x.id));
  const source_id = sourceId ?? s.sources?.find((x) => x.kind === "bearing")?.id ?? s.sources?.[0]?.id ?? DEFAULT_SOURCE_ID;
  const sensor = normaliseSensor({ id, source_id, pos_m: roundPoint(at), bearing_sigma_deg: 2.0 });
  return { scenario: withSources({ ...s, sensors: [...s.sensors, sensor] }), id };
}

export function updateSensor(s: Scenario, id: string, patch: Partial<Sensor>): Scenario {
  const next = { ...s, sensors: s.sensors.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
  return patch.source_id !== undefined ? withSources(next) : next;
}

export function renameSensor(s: Scenario, id: string, newId: string): Scenario {
  if (!validId(newId) || id === newId || s.sensors.some((x) => x.id === newId)) return s;
  return { ...s, sensors: s.sensors.map((x) => (x.id === id ? { ...x, id: newId } : x)) };
}

export function moveSensor(s: Scenario, id: string, to: Point): Scenario {
  return updateSensor(s, id, { pos_m: roundPoint(to) });
}

export function deleteSensor(s: Scenario, id: string): Scenario {
  return { ...s, sensors: s.sensors.filter((x) => x.id !== id) };
}

// --- Emitters --------------------------------------------------------------------------

export function addEmitter(s: Scenario, at: Point, cls: EmitterClass | null, side: Side = "unknown"): { scenario: Scenario; id: string } {
  const id = nextId("E", s.emitters.map((x) => x.id));
  const fromClass = cls ? classDefaults(cls) : { freq_hz: 45_000_000, bandwidth_hz: 25_000, activity: { type: "continuous" as const, hub: false }, alt_m: 0 };
  const emitter = normaliseEmitter({
    id,
    path_m: [roundPoint(at)],
    truth: { class_id: cls?.id ?? null, role_id: null, side },
    ...fromClass,
  });
  return { scenario: { ...s, emitters: [...s.emitters, emitter] }, id };
}

export function updateEmitter(s: Scenario, id: string, patch: Partial<Emitter>): Scenario {
  return { ...s, emitters: s.emitters.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

/** Rename an emitter, carrying every reference to it along. */
export function renameEmitter(s: Scenario, id: string, newId: string): Scenario {
  if (!validId(newId) || id === newId || s.emitters.some((e) => e.id === newId)) return s;
  return {
    ...s,
    emitters: s.emitters.map((e) => (e.id === id ? { ...e, id: newId } : e)),
    truth_relations: relations(s).map((r) => ({ ...r, members: r.members.map((m) => (m.emitter_id === id ? { ...m, emitter_id: newId } : m)) })),
  };
}

/** Move a whole emitter -- every waypoint by the same offset, holds kept. */
export function translateEmitter(s: Scenario, id: string, by: Point): Scenario {
  const e = s.emitters.find((x) => x.id === id);
  if (!e) return s;
  return updateEmitter(s, id, { path_m: e.path_m.map((p) => withHold(roundPoint([p[0]! + by[0], p[1]! + by[1]]), holdOf(p))) });
}

export function moveWaypoint(s: Scenario, id: string, index: number, to: Point): Scenario {
  const e = s.emitters.find((x) => x.id === id);
  if (!e || !e.path_m[index]) return s;
  return updateEmitter(s, id, { path_m: e.path_m.map((p, i) => (i === index ? withHold(roundPoint(to), holdOf(p)) : p)) });
}

/** How long the emitter waits at a waypoint before moving on; 0 or null for no wait. */
export function setHold(s: Scenario, id: string, index: number, hold: number | null): Scenario {
  const e = s.emitters.find((x) => x.id === id);
  if (!e || !e.path_m[index]) return s;
  return updateEmitter(s, id, { path_m: e.path_m.map((p, i) => (i === index ? waypoint(p[0]!, p[1]!, Math.max(hold ?? 0, 0)) : p)) });
}

/** Add a waypoint to the end of an emitter's path; a first leg gets a speed so it can move. */
export function appendWaypoint(s: Scenario, id: string, at: Point, defaultSpeed: number): Scenario {
  const e = s.emitters.find((x) => x.id === id);
  if (!e) return s;
  const speed = (e.speed_mps ?? 0) > 0 ? e.speed_mps : defaultSpeed;
  return updateEmitter(s, id, { path_m: [...e.path_m, roundPoint(at)], speed_mps: speed });
}

export function removeWaypoint(s: Scenario, id: string, index: number): Scenario {
  const e = s.emitters.find((x) => x.id === id);
  if (!e || e.path_m.length <= 1) return s;
  return updateEmitter(s, id, { path_m: e.path_m.filter((_, i) => i !== index) });
}

/** Replace the emitter's active windows; an empty list means switched on throughout. */
export function setWindows(s: Scenario, id: string, windows: number[][]): Scenario {
  return updateEmitter(s, id, { active_windows_s: windows.length ? windows.map((w) => [w[0]!, w[1]!]) : undefined });
}

export function deleteEmitter(s: Scenario, id: string): Scenario {
  return {
    ...s,
    emitters: s.emitters.filter((e) => e.id !== id),
    truth_relations: relations(s)
      .map((r) => ({ ...r, members: r.members.filter((m) => m.emitter_id !== id) }))
      .filter((r) => r.members.length >= 2),
  };
}

function withHold(p: Point, hold: number): number[] {
  return waypoint(p[0], p[1], hold);
}

// --- Frame -----------------------------------------------------------------------------

/** Move the origin: every object stays where it is on the ground, in the new frame. */
export function setOrigin(s: Scenario, origin: Origin): Scenario {
  const from = s.origin ?? { lat: 50, lon: -105 };
  const to = { lat: Math.round(origin.lat * 1e6) / 1e6, lon: Math.round(origin.lon * 1e6) / 1e6 };
  return {
    ...s,
    origin: to,
    sensors: s.sensors.map((x) => ({ ...x, pos_m: roundPoint(reframe(from, to, x.pos_m)) })),
    emitters: s.emitters.map((e) => ({ ...e, path_m: e.path_m.map((p) => withHold(roundPoint(reframe(from, to, p)), holdOf(p))) })),
  };
}

// --- Nets ------------------------------------------------------------------------------

export function addNet(s: Scenario): { scenario: Scenario; id: string } {
  const id = nextId("N", (s.nets ?? []).map((n) => n.id));
  return { scenario: { ...s, nets: [...(s.nets ?? []), { id, ...NET_DEFAULTS, turnaround_s: [...NET_DEFAULTS.turnaround_s] }] }, id };
}

export function updateNet(s: Scenario, id: string, patch: Partial<Net>): Scenario {
  return { ...s, nets: (s.nets ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function renameNet(s: Scenario, id: string, newId: string): Scenario {
  if (!validId(newId) || id === newId || (s.nets ?? []).some((n) => n.id === newId)) return s;
  return {
    ...s,
    nets: (s.nets ?? []).map((n) => (n.id === id ? { ...n, id: newId } : n)),
    emitters: s.emitters.map((e) => (e.activity?.type === "net" && e.activity.net_id === id ? { ...e, activity: { ...e.activity, net_id: newId } } : e)),
  };
}

export function deleteNet(s: Scenario, id: string): Scenario {
  return {
    ...s,
    nets: (s.nets ?? []).filter((n) => n.id !== id),
    // Members fall back to continuous rather than point at a net that no longer exists.
    emitters: s.emitters.map((e) => (e.activity?.net_id === id ? { ...e, activity: { type: "continuous", hub: false } } : e)),
  };
}

// --- Relations (by position in the list: scenario.v2 gives them no id) -------------------

const relations = (s: Scenario) => s.truth_relations ?? [];

export function addRelation(s: Scenario, kind: TruthRelation["kind"], members: TruthRelation["members"]): { scenario: Scenario; index: number } {
  const list = relations(s);
  return { scenario: { ...s, truth_relations: [...list, { kind, members }] }, index: list.length };
}

export function updateRelation(s: Scenario, index: number, patch: Partial<TruthRelation>): Scenario {
  return { ...s, truth_relations: relations(s).map((r, i) => (i === index ? { ...r, ...patch } : r)) };
}

export function deleteRelation(s: Scenario, index: number): Scenario {
  return { ...s, truth_relations: relations(s).filter((_, i) => i !== index) };
}

// --- Operator declarations: what the operator tells the engine about a source -------------

const declarations = (s: Scenario) => s.operator?.declarations ?? [];

export function declarationFor(s: Scenario, sourceId: string): OperatorDeclaration | undefined {
  return declarations(s).find((d) => d.source_id === sourceId);
}

/**
 * Set, change or withdraw the declaration for a source. A patch that leaves nothing
 * declared (no affiliation, no assumed uncertainty) withdraws it.
 */
export function setDeclaration(s: Scenario, sourceId: string, patch: Partial<OperatorDeclaration>): Scenario {
  const current = declarationFor(s, sourceId) ?? { source_id: sourceId };
  const next: OperatorDeclaration = { ...current, ...patch, source_id: sourceId };
  for (const key of Object.keys(next) as (keyof OperatorDeclaration)[]) {
    if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
  }
  const says = Object.keys(next).some((k) => k === "affiliation" || k.startsWith("assumed_"));
  const others = declarations(s).filter((d) => d.source_id !== sourceId);
  if (!says) return { ...s, operator: { declarations: others } };
  const at = declarations(s).findIndex((d) => d.source_id === sourceId);
  const list = [...others];
  list.splice(at < 0 ? list.length : at, 0, next);
  return { ...s, operator: { declarations: list } };
}
