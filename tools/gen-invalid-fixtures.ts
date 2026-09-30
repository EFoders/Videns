// Generate fixtures/invalid/*.json: messages that must be rejected, each with the reason
// it must be rejected for. They are written out as files, not built inside a test, so the
// Python validator can run the same set once it exists (VIDENS_SPEC.md section 10).
//
//   node tools/gen-invalid-fixtures.ts

import { mkdirSync, writeFileSync } from "node:fs";

const T = "2026-01-01T00:01:00.000Z";

const entity = (overrides: Record<string, unknown> = {}) => ({
  entity_id: "E9",
  state: "confirmed",
  affiliation: { identity: "unknown", basis: "default", reasons: [] },
  symbol: { sidc: "SUGP-----------" },
  position: { lat: 50.01, lon: -105.01 },
  position_uncertainty: { basis: "measured", cov_en_m2: { ee: 2500, en: 0, nn: 900 } },
  freq_hz: 400_000_000,
  bandwidth_hz: 12_500,
  first_seen: T,
  last_seen: T,
  sources: [{ source_id: "SRC-A", observations: 3 }],
  classification: { status: "unclassified", reason: "Not enough transmissions observed." },
  library: { available: true, name: "synthetic", version: "0.1.0" },
  ...overrides,
});

const delta = (entities: unknown[]) => ({ schema: "picture.v0", type: "delta", run_id: "fixture", seq: 5, t: T, upsert: { entities } });

const fixtures: Record<string, { reason: string; expect: string; message: unknown }> = {
  "unreported-with-ellipse": {
    reason: "An unreported uncertainty carrying an ellipse is an invented number.",
    expect: "/upsert/entities/0/position_uncertainty",
    message: delta([
      entity({
        position_uncertainty: { basis: "unreported", ellipse: { semi_major_m: 100, semi_minor_m: 100, orientation_deg: 0, confidence: 0.95 } },
      }),
    ]),
  },
  "measured-without-region": {
    reason: "A measured uncertainty must say what was measured.",
    expect: "/upsert/entities/0/position_uncertainty",
    message: delta([entity({ position_uncertainty: { basis: "measured" } })]),
  },
  "position-without-uncertainty": {
    reason: "A position always travels with its uncertainty, even when that is 'unreported'.",
    expect: "position_uncertainty",
    message: delta([entity({ position_uncertainty: undefined })]),
  },
  "assumed-without-assumption": {
    reason: "An assumed uncertainty must say who assumed it.",
    expect: "assumption",
    message: delta([
      entity({ position_uncertainty: { basis: "assumed", ellipse: { semi_major_m: 150, semi_minor_m: 150, orientation_deg: 0, confidence: 0.39 } } }),
    ]),
  },
  "ellipse-without-confidence": {
    reason: "Every ellipse states what probability it contains (rule 3).",
    expect: "confidence",
    message: delta([
      entity({ position_uncertainty: { basis: "measured", ellipse: { semi_major_m: 150, semi_minor_m: 100, orientation_deg: 10 } } }),
    ]),
  },
  "default-basis-hostile": {
    reason: "An affiliation nobody declared is Unknown, never anything else.",
    expect: "/upsert/entities/0/affiliation/identity",
    message: delta([entity({ affiliation: { identity: "hostile", basis: "default", reasons: [] }, symbol: { sidc: "SHGP-----------" } })]),
  },
  "declared-affiliation-without-reasons": {
    reason: "A declared affiliation carries its reasons.",
    expect: "/upsert/entities/0/affiliation/reasons",
    message: delta([entity({ affiliation: { identity: "hostile", basis: "library", reasons: [] }, symbol: { sidc: "SHGP-----------" } })]),
  },
  "symbol-contradicts-affiliation": {
    reason: "The symbol code and the stated affiliation must agree.",
    expect: "says Unknown but affiliation says Hostile",
    message: delta([entity({ affiliation: { identity: "hostile", basis: "library", reasons: ["Library class syn.bravo."] } })]),
  },
  "candidate-without-reasons": {
    reason: "An assessment cannot exist without at least one reason.",
    expect: "/upsert/entities/0/classification/candidates/0/reasons",
    message: delta([
      entity({
        classification: { status: "classified", candidates: [{ class: "syn.alpha", confidence: 0.5, wording: "Possible synthetic class Alpha emitter", reasons: [] }] },
      }),
    ]),
  },
  "local-time": {
    reason: "Times are UTC with a literal Z.",
    expect: "/t",
    message: { ...delta([entity()]), t: "2026-01-01T01:01:00+01:00" },
  },
  "radians-bearing": {
    reason: "Angles are degrees in [0, 360); a negative orientation is a convention error.",
    expect: "orientation_deg",
    message: delta([
      entity({ position_uncertainty: { basis: "measured", ellipse: { semi_major_m: 150, semi_minor_m: 100, orientation_deg: -1.2, confidence: 0.95 } } }),
    ]),
  },
  "group-over-bound": {
    reason: "A group cannot be more confident than its members' identities allow.",
    expect: "exceeds the member identity bound",
    message: {
      schema: "picture.v0",
      type: "snapshot",
      run_id: "fixture",
      seq: 0,
      t: T,
      entities: [],
      sensors: [],
      cot: [],
      groups: [
        {
          group_id: "G1",
          kind: "peer",
          members: [{ entity_id: "E1" }, { entity_id: "E2" }],
          confidence: 0.9,
          member_identity_bound: 0.6,
          evidence: [{ type: "temporal_coupling", summary: "E2 keys up within 2 s of E1 in 18 of 20 transmissions." }],
          state: "published",
        },
      ],
    },
  },
  "published-cot-without-destinations": {
    reason: "Published CoT says where it went.",
    expect: "destinations",
    message: {
      schema: "picture.v0",
      type: "cot",
      run_id: "fixture",
      seq: 6,
      t: T,
      record: {
        object: { kind: "entity", id: "E9" },
        built_t: T,
        events: [{ uid: "vigilans.E9", type: "a-u-G", xml: "<event/>" }],
        disposition: { status: "published" },
      },
    },
  },
  "unknown-type": {
    reason: "A message type the contract does not define.",
    expect: "unknown message type",
    message: { schema: "picture.v0", type: "tracks", run_id: "fixture", seq: 1 },
  },
  "wrong-schema": {
    reason: "A message for another contract version.",
    expect: "unsupported schema",
    message: { ...delta([entity()]), schema: "picture.v1" },
  },
};

mkdirSync("fixtures/invalid", { recursive: true });
for (const [name, fixture] of Object.entries(fixtures)) {
  writeFileSync(`fixtures/invalid/${name}.json`, `${JSON.stringify(fixture, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(fixtures).length} invalid fixtures to fixtures/invalid/`);
