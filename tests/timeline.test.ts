// Phase 2 gate: the state at every moment of a recording equals what the live path had at
// that moment (VIDENS_SPEC.md 9).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { PictureMessage } from "../src/contract/generated/picture.ts";
import { parseMessage } from "../src/contract/validate.ts";
import { applyMessage, emptyPicture, type PictureState } from "../src/store/picture.ts";
import { Timeline } from "../src/store/timeline.ts";
import { DemoScenario } from "../tools/mock-feed/scenario.ts";
import { at, delta, entity, hello, snapshot } from "./helpers.ts";

function recording(): PictureMessage[] {
  const lines = readFileSync(join(import.meta.dirname, "..", "fixtures", "demo.picture.jsonl"), "utf8").trim().split("\n");
  return lines.map((line) => {
    const r = parseMessage(line);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.message;
  });
}

/** The live path: apply each message in turn, remembering the state after each. */
function livePath(messages: PictureMessage[]): PictureState[] {
  let state = emptyPicture();
  return messages.map((m) => (state = applyMessage(state, m).state));
}

const comparable = (s: PictureState) => ({
  runId: s.runId,
  lastSeq: s.lastSeq,
  t: s.t,
  entities: [...s.entities.entries()],
  groups: [...s.groups.entries()],
  sensors: [...s.sensors.entries()],
  cot: [...s.cot.entries()],
  log: s.log,
  needsSnapshot: s.needsSnapshot,
});

describe("Timeline", () => {
  it("gives, at every message time of the recording, the state the live path had after the last message at that time", () => {
    const messages = recording();
    const live = livePath(messages);
    const timeline = new Timeline({ keyframeEveryMs: 7_000 });
    messages.forEach((m) => timeline.append(m));

    const lastAtTime = new Map<number, number>();
    messages.forEach((m, i) => lastAtTime.set(timeline.timeAt(i)!, i));
    expect(lastAtTime.size).toBeGreaterThan(50);
    for (const [t, i] of lastAtTime) expect(comparable(timeline.stateAt(t)), `t=${new Date(t).toISOString()}`).toEqual(comparable(live[i]!));
  });

  it("holds the earlier state between messages and never interpolates", () => {
    const timeline = new Timeline();
    [hello(), snapshot(0, [entity("E1", { position: { lat: 50, lon: -105 } })]), delta(10, { upsert: { entities: [entity("E1", { position: { lat: 51, lon: -105 } })] } })]
      .map((m, i) => (i === 2 ? { ...m, seq: 1 } : m))
      .forEach((m) => timeline.append(m as PictureMessage));
    const halfway = (Date.parse(at(0)) + Date.parse(at(10))) / 2;
    expect(timeline.stateAt(halfway).entities.get("E1")?.position?.lat).toBe(50);
    expect(timeline.stateAt(Date.parse(at(10))).entities.get("E1")?.position?.lat).toBe(51);
  });

  it("is empty before the first message and the latest state after the last", () => {
    const timeline = new Timeline();
    recording().forEach((m) => timeline.append(m));
    expect(timeline.stateAt(timeline.start! - 1).entities.size).toBe(0);
    expect(timeline.stateAt(timeline.end! + 60_000)).toBe(timeline.latest);
  });

  it("starts a new history when the run changes", () => {
    const timeline = new Timeline();
    [hello("r1"), snapshot(0, [entity("E1")], "r1"), hello("r2"), snapshot(0, [], "r2")].forEach((m) => timeline.append(m));
    expect(timeline.length).toBe(2);
    expect(timeline.runId).toBe("r2");
  });

  it("keeps working after trimming old messages", () => {
    const scenario = new DemoScenario({ seed: 2, runIndex: 0 });
    const messages: PictureMessage[] = [scenario.hello(), scenario.snapshot()];
    while (!scenario.finished) messages.push(...scenario.step());
    const live = livePath(messages);
    const timeline = new Timeline({ keyframeEveryMs: 5_000, limit: 150 });
    messages.forEach((m) => timeline.append(m));
    expect(timeline.length).toBeLessThanOrEqual(150);
    const offset = messages.length - timeline.length;
    for (let i = 0; i < timeline.length; i += 7) {
      expect(comparable(timeline.stateAfter(i))).toEqual(comparable(live[i + offset]!));
    }
  });

  it("lists lifecycle events as markers, and steps between distinct message times", () => {
    const timeline = new Timeline();
    recording().forEach((m) => timeline.append(m));
    expect(timeline.markers().some((m) => m.kind === "entity_created")).toBe(true);
    const t = timeline.start! + 20_000;
    const { previous, next } = timeline.neighbours(t);
    expect(previous).toBeLessThan(t);
    expect(next).toBeGreaterThan(t);
  });
});
