// scenario.v2's defaults (Vigilans 2.0 docs/scenario-spec.md, as vigilans-hub applies them),
// so the editor shows and saves what the simulator will actually use when a field is left
// out. A scenario is normalised on opening: every default made explicit, and every source a
// sensor names listed, so what is on screen is what will run.

import type { Activity, Emitter, Net, Scenario, Sensor, Source, Waypoint } from "./types.ts";

export const DEFAULT_ORIGIN = { lat: 50.0, lon: -105.0 };

/** The source a sensor reports as when it names none (scenario-spec.md 4). */
export const DEFAULT_SOURCE_ID = "SIM";

export const PROPAGATION_DEFAULTS = { model: "log_distance" as const, exponent: 2.7, shadowing_sigma_db: 4.0 };

export const SOURCE_DEFAULTS = { reports_uncertainty: true, freq_bias_hz: 0, clock_offset_s: 0, emits_coverage: false };
export const POSITION_SOURCE_DEFAULTS = { position_sigma_m: 150, region_confidence: 0.95 };

export const SENSOR_DEFAULTS = {
  source_id: DEFAULT_SOURCE_ID,
  alt_m: 0,
  elevation_sigma_deg: null,
  freq_range_hz: [20.0e6, 3.0e9],
  noise_floor_dbm: -110,
  threshold_db: 6,
  report_interval_s: 1,
  p_miss: 0,
  p_outlier: 0,
  false_alarm_rate_hz: 0,
};

export const NET_DEFAULTS = { mean_tx_s: 6, mean_gap_s: 20, hub_reply_prob: 0.8, turnaround_s: [1.0, 3.0] };

export const EMITTER_DEFAULTS = { alt_m: 0, speed_mps: 0, loop: false, eirp_dbm: 40 };

export const ACTIVITY_DEFAULTS: Activity = { type: "continuous", hub: false };

/** Id rule of scenario.v2: 1-64 of letters, digits and . _ : - */
export const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** Keys in a fixed order, so saved files read the same every time. */
function ordered<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const out: Partial<T> = {};
  for (const k of keys) if (value[k] !== undefined) out[k] = value[k];
  for (const k of Object.keys(value) as (keyof T)[]) if (!(k in out) && value[k] !== undefined) out[k] = value[k];
  return out as T;
}

const SOURCE_ORDER = ["id", "label", "kind", "reports_uncertainty", "position_sigma_m", "region_confidence", "freq_bias_hz", "clock_offset_s", "emits_coverage", "fault"] as const;
const SENSOR_ORDER = ["id", "label", "source_id", "pos_m", "alt_m", "bearing_sigma_deg", "elevation_sigma_deg", "freq_range_hz", "noise_floor_dbm", "threshold_db", "report_interval_s", "p_miss", "p_outlier", "false_alarm_rate_hz", "scan"] as const;
const NET_ORDER = ["id", "label", "mean_tx_s", "mean_gap_s", "hub_reply_prob", "turnaround_s"] as const;
const EMITTER_ORDER = ["id", "label", "truth", "path_m", "alt_m", "speed_mps", "loop", "freq_hz", "bandwidth_hz", "eirp_dbm", "activity", "active_windows_s", "source_claim"] as const;
const ACTIVITY_ORDER = ["type", "period_s", "on_s", "offset_s", "mean_on_s", "mean_off_s", "net_id", "hub"] as const;

export function normaliseSource(s: Source): Source {
  const kindDefaults = s.kind === "position" ? POSITION_SOURCE_DEFAULTS : {};
  return ordered({ ...SOURCE_DEFAULTS, ...kindDefaults, ...s }, SOURCE_ORDER);
}

/** A source for an id a sensor names but the list lacks: what the hub assumes (bearing). */
export function implicitSource(id: string): Source {
  return normaliseSource({ id, kind: "bearing" });
}

export function normaliseSensor(s: Sensor): Sensor {
  return ordered({ ...SENSOR_DEFAULTS, ...s, freq_range_hz: [...(s.freq_range_hz ?? SENSOR_DEFAULTS.freq_range_hz)] }, SENSOR_ORDER);
}

export function normaliseNet(n: Net): Net {
  return ordered({ ...NET_DEFAULTS, ...n, turnaround_s: [...(n.turnaround_s ?? NET_DEFAULTS.turnaround_s)] }, NET_ORDER);
}

/** [east, north] or, with a hold, [east, north, hold_s]; a zero hold is no hold. */
export function waypoint(e: number, n: number, hold = 0): Waypoint {
  return hold > 0 ? [e, n, hold] : [e, n];
}

export const holdOf = (p: Waypoint): number => p[2] ?? 0;

export function normaliseActivity(a: Activity | undefined): Activity {
  const merged: Activity = { ...ACTIVITY_DEFAULTS, ...a };
  if (merged.type === "periodic") merged.offset_s ??= 0;
  if (merged.net_id === null || merged.net_id === "") delete merged.net_id;
  return ordered(merged, ACTIVITY_ORDER);
}

export function normaliseEmitter(e: Emitter): Emitter {
  return ordered(
    {
      ...EMITTER_DEFAULTS,
      ...e,
      truth: ordered({ class_id: null, role_id: null, side: "unknown" as const, ...e.truth }, ["class_id", "role_id", "side"]),
      activity: normaliseActivity(e.activity),
      path_m: e.path_m.map((p) => waypoint(p[0]!, p[1]!, holdOf(p))),
      ...(e.active_windows_s?.length ? { active_windows_s: e.active_windows_s.map((w) => [w[0]!, w[1]!]) } : { active_windows_s: undefined }),
    },
    EMITTER_ORDER,
  );
}

/** Every source listed and normalised, including those sensors name without listing. */
export function withSources(s: Scenario): Scenario {
  const listed = (s.sources ?? []).map(normaliseSource);
  const ids = new Set(listed.map((x) => x.id));
  for (const sensor of s.sensors) {
    const id = sensor.source_id ?? DEFAULT_SOURCE_ID;
    if (!ids.has(id)) {
      listed.push(implicitSource(id));
      ids.add(id);
    }
  }
  return { ...s, sources: listed };
}

/** Every default explicit: the scenario exactly as the simulator will read it. */
export function normalise(s: Scenario): Scenario {
  return withSources({
    schema: "scenario.v2",
    name: s.name,
    description: s.description ?? "",
    seed: s.seed ?? 42,
    duration_s: s.duration_s,
    tick_s: s.tick_s ?? 1,
    origin: { ...(s.origin ?? DEFAULT_ORIGIN) },
    propagation: { ...PROPAGATION_DEFAULTS, ...s.propagation },
    sources: s.sources ?? [],
    sensors: s.sensors.map(normaliseSensor),
    nets: (s.nets ?? []).map(normaliseNet),
    emitters: s.emitters.map(normaliseEmitter),
    operator: { declarations: (s.operator?.declarations ?? []).map((d) => ({ ...d })) },
    truth_relations: (s.truth_relations ?? []).map((r) => ({ ...r, members: r.members.map((m) => ({ ...m })) })),
  });
}

/** A new, empty scenario at an origin. It still needs a sensor and an emitter to be valid. */
export function blankScenario(origin = DEFAULT_ORIGIN): Scenario {
  return {
    schema: "scenario.v2",
    name: "untitled",
    description: "",
    seed: 42,
    duration_s: 600,
    tick_s: 1,
    origin: { ...origin },
    propagation: { ...PROPAGATION_DEFAULTS },
    sources: [implicitSource(DEFAULT_SOURCE_ID)],
    sensors: [],
    nets: [],
    emitters: [],
    operator: { declarations: [] },
    truth_relations: [],
  };
}

/** The next free id with a prefix: S1, S2 ... */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}
