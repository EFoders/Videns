// The scenario model is scenario.v2, generated from the Vigilans contract package's schema
// (contract/scenario.v2.schema.json). These are the names the editor uses for its parts.

import type { Emitter } from "../contract/generated/scenario.ts";

export type {
  Activity,
  Emitter,
  Identity,
  Net,
  OperatorDeclaration,
  Scenario,
  Sensor,
  Source,
  TruthRelation,
  Waypoint,
} from "../contract/generated/scenario.ts";

/** An emitter's true side. scenario.v2 also allows null (not stated); the editor writes one. */
export type Side = NonNullable<NonNullable<Emitter["truth"]>["side"]>;

export type SourceClaim = NonNullable<Emitter["source_claim"]>;
