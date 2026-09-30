import { describe, expect, it } from "vitest";

import type { PictureMessage } from "../src/contract/generated/picture.ts";
import { applyMessage, emptyPicture, LOG_LIMIT, type PictureState } from "../src/store/picture.ts";
import { DemoScenario } from "../tools/mock-feed/scenario.ts";
import { at, delta, entity, heartbeat, hello, snapshot } from "./helpers.ts";

function run(messages: PictureMessage[], start: PictureState = emptyPicture()) {
  let state = start;
  const issues: string[] = [];
  for (const message of messages) {
    const result = applyMessage(state, message);
    state = result.state;
    issues.push(...result.issues.map((i) => i.kind));
  }
  return { state, issues };
}

describe("sequencing", () => {
  it("applies deltas in order after a snapshot", () => {
    const { state, issues } = run([
      hello(),
      snapshot(0),
      delta(1, { upsert: { entities: [entity("E1")] } }),
      delta(2, { upsert: { entities: [entity("E2")] } }),
    ]);
    expect(issues).toEqual([]);
    expect([...state.entities.keys()]).toEqual(["E1", "E2"]);
    expect(state.lastSeq).toBe(2);
    expect(state.needsSnapshot).toBe(false);
  });

  it("drops everything until the run's snapshot arrives", () => {
    const { state, issues } = run([hello(), delta(1, { upsert: { entities: [entity("E1")] } })]);
    expect(issues).toEqual(["awaiting_snapshot"]);
    expect(state.entities.size).toBe(0);
  });

  it("ignores a duplicate", () => {
    const { state, issues } = run([hello(), snapshot(0), delta(1, { upsert: { entities: [entity("E1")] } }), heartbeat(1)]);
    expect(issues).toEqual(["duplicate"]);
    expect(state.lastSeq).toBe(1);
  });

  it("stops applying after a gap and asks for a snapshot, because a missed delta may have removed something", () => {
    const { state, issues } = run([
      hello(),
      snapshot(0, [entity("E1")]),
      // #1 is lost: it removed E1.
      delta(2, { upsert: { entities: [entity("E2")] } }),
      delta(3, { upsert: { entities: [entity("E3")] } }),
    ]);
    expect(issues).toEqual(["gap", "awaiting_snapshot"]);
    expect(state.needsSnapshot).toBe(true);
    expect([...state.entities.keys()]).toEqual(["E1"]);
  });

  it("recovers from a gap with a fresh snapshot", () => {
    const { state, issues } = run([hello(), snapshot(0, [entity("E1")]), delta(2), snapshot(2, [entity("E2")]), delta(3)]);
    expect(issues).toEqual(["gap"]);
    expect(state.needsSnapshot).toBe(false);
    expect([...state.entities.keys()]).toEqual(["E2"]);
    expect(state.lastSeq).toBe(3);
  });

  it("ignores messages from another run", () => {
    const { issues } = run([hello("r1"), snapshot(0), delta(1, {}, "r2")]);
    expect(issues).toEqual(["other_run"]);
  });

  it("clears the picture when the run changes", () => {
    const { state, issues } = run([hello("r1"), snapshot(0, [entity("E1")]), hello("r2"), snapshot(0, [], "r2")]);
    expect(issues).toEqual(["new_run"]);
    expect(state.runId).toBe("r2");
    expect(state.entities.size).toBe(0);
  });
});

describe("deltas", () => {
  it("replaces whole objects and removes with their CoT records", () => {
    const { state } = run([
      hello(),
      snapshot(0, [entity("E1")]),
      delta(1, { upsert: { entities: [entity("E1", { state: "coasting" })] } }),
      {
        schema: "picture.v0",
        type: "cot",
        run_id: "r1",
        seq: 2,
        t: at(2),
        record: {
          object: { kind: "entity", id: "E1" },
          built_t: at(2),
          events: [{ uid: "vigilans.E1", type: "a-u-G", xml: "<event/>" }],
          disposition: { status: "withheld", reason_code: "below_threshold", reason: "Tentative." },
        },
      },
    ]);
    expect(state.entities.get("E1")?.state).toBe("coasting");
    expect(state.cot.get("entity:E1")?.disposition.status).toBe("withheld");

    const after = run([delta(3, { remove: [{ kind: "entity", id: "E1", reason: "Retired." }] })], state).state;
    expect(after.entities.has("E1")).toBe(false);
    expect(after.cot.has("entity:E1")).toBe(false);
  });

  it("keeps a bounded log of events", () => {
    const messages: PictureMessage[] = [hello(), snapshot(0)];
    for (let i = 1; i <= LOG_LIMIT + 20; i++) {
      messages.push(delta(i, { events: [{ kind: "entity_created", t: at(i), objects: [{ kind: "entity", id: `E${i}` }], reason: "First fix." }] }));
    }
    const { state } = run(messages);
    expect(state.log).toHaveLength(LOG_LIMIT);
    expect(state.log.at(-1)?.seq).toBe(LOG_LIMIT + 20);
  });
});

describe("snapshot equivalence", () => {
  it("snapshot plus every delta equals a later snapshot, throughout the demo scenario", () => {
    const scenario = new DemoScenario({ seed: 3, runIndex: 0 });
    let state = run([scenario.hello(), scenario.snapshot()]).state;
    while (!scenario.finished) {
      for (const message of scenario.step()) {
        const result = applyMessage(state, message);
        expect(result.issues).toEqual([]);
        state = result.state;
      }
      if (scenario.elapsedS % 25 === 0) {
        const fresh = run([scenario.hello(), scenario.snapshot()]).state;
        expect(state.lastSeq).toBe(fresh.lastSeq);
        expect([...state.entities.entries()]).toEqual([...fresh.entities.entries()]);
        expect([...state.sensors.entries()]).toEqual([...fresh.sensors.entries()]);
        expect(new Map(state.cot)).toEqual(new Map(fresh.cot));
      }
    }
  });
});
