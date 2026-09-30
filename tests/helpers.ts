import type { Entity, PictureMessage } from "../src/contract/generated/picture.ts";

export const T0 = "2026-01-01T00:00:00.000Z";

export function at(seconds: number): string {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString();
}

export function entity(id: string, overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: id,
    state: "confirmed",
    affiliation: { identity: "unknown", basis: "default", reasons: [] },
    symbol: { sidc: "SUGP-----------" },
    position: { lat: 50, lon: -105 },
    position_uncertainty: { basis: "measured", cov_en_m2: { ee: 100, en: 0, nn: 100 } },
    freq_hz: 400e6,
    bandwidth_hz: 12500,
    first_seen: T0,
    last_seen: T0,
    sources: [{ source_id: "SRC-A", observations: 1 }],
    classification: { status: "unclassified", reason: "Too few transmissions." },
    library: { available: true, name: "synthetic", version: "0.1.0" },
    ...overrides,
  };
}

export const hello = (run = "r1", seq = 0): PictureMessage => ({
  schema: "picture.v0",
  type: "hello",
  run_id: run,
  seq,
  engine: { name: "test", version: "0" },
  contracts: ["picture.v0"],
  library: { available: false },
  sources: [],
  clock: { mode: "sim", rate: 1 },
  origin: { lat: 50, lon: -105 },
  started_at: T0,
});

export const snapshot = (seq: number, entities: Entity[] = [], run = "r1"): PictureMessage => ({
  schema: "picture.v0",
  type: "snapshot",
  run_id: run,
  seq,
  t: at(seq),
  entities,
  groups: [],
  sensors: [],
  cot: [],
});

export const delta = (seq: number, body: Partial<Extract<PictureMessage, { type: "delta" }>> = {}, run = "r1"): PictureMessage => ({
  schema: "picture.v0",
  type: "delta",
  run_id: run,
  seq,
  t: at(seq),
  ...body,
});

export const heartbeat = (seq: number, run = "r1"): PictureMessage => ({
  schema: "picture.v0",
  type: "heartbeat",
  run_id: run,
  seq,
  t: at(seq),
  wall_t: at(seq),
});
