// Phase 3 (evidence, truth) and Phase 4 (groups, lifecycle) gates, against the full demo
// recording and hand-built cases (VIDENS_SPEC.md 9).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compareWithTruth, truthAvailable } from "../src/app/truth.ts";
import type { Group, PictureMessage } from "../src/contract/generated/picture.ts";
import type { TruthFrame } from "../src/contract/generated/truth.ts";
import { parseMessage, parseTruth } from "../src/contract/validate.ts";
import { geodesicDirect } from "../src/geo/geodesic.ts";
import { evidenceFeatures, ghostFeatures, groupFeatures, groupVisible, pointFeatures } from "../src/map/features.ts";
import { applyMessage, emptyPicture } from "../src/store/picture.ts";
import { Timeline } from "../src/store/timeline.ts";
import { entity, hello, snapshot, T0 } from "./helpers.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

const demo = (() => {
  const timeline = new Timeline();
  for (const line of readFileSync(join(FIXTURES, "demo.picture.jsonl"), "utf8").trim().split("\n")) {
    const r = parseMessage(line);
    if (!r.ok) throw new Error(JSON.stringify(r));
    timeline.append(r.message);
  }
  return timeline;
})();
const atSecond = (s: number) => demo.stateAt(Date.parse(T0) + s * 1000);

describe("Phase 3: truth", () => {
  it("cannot be enabled for a wall-clock run, and says why", () => {
    expect(truthAvailable(true, "wall")).toEqual({ available: false, reason: expect.stringContaining("wall clock") });
    expect(truthAvailable(false, "sim").available).toBe(false);
    expect(truthAvailable(true, undefined).available).toBe(false);
    expect(truthAvailable(true, "sim").available).toBe(true);
  });

  it("every recorded truth frame is valid truth.v0 and belongs to the recording's run", () => {
    const frames = readFileSync(join(FIXTURES, "demo.truth.jsonl"), "utf8").trim().split("\n").map(parseTruth);
    expect(frames.every((f) => f.ok)).toBe(true);
    const runs = new Set(frames.map((f) => (f.ok ? f.frame.run_id : "")));
    expect([...runs]).toEqual([demo.runId]);
  });

  it("compares an entity with truth only through the association the truth states", () => {
    const e = entity("E1", { position: { lat: 50, lon: -105 }, position_uncertainty: { basis: "measured", cov_en_m2: { ee: 100 ** 2, en: 0, nn: 100 ** 2 } } });
    const near = geodesicDirect(50, -105, 90, 150);
    const far = geodesicDirect(50, -105, 90, 400);
    const frame = (p: { lat: number; lon: number }, entity_id?: string): TruthFrame => ({
      schema: "truth.v0",
      type: "truth",
      run_id: "r1",
      t: T0,
      emitters: [{ emitter_id: "X1", lat: p.lat, lon: p.lon, active: true, ...(entity_id ? { entity_id } : {}) }],
    });
    // 150 m at 1-sigma 100 m is inside the 95 % region (radius 245 m); 400 m is outside.
    expect(compareWithTruth(e, frame(near, "E1"), 0.95)).toMatchObject({ inside: true });
    expect(compareWithTruth(e, frame(far, "E1"), 0.95)).toMatchObject({ inside: false });
    expect(compareWithTruth(e, frame(near, "E1"), 0.95)!.distanceM).toBeCloseTo(150, 3);
    // Unassociated truth is never paired with an entity by proximity.
    expect(compareWithTruth(e, frame(near), 0.95)).toBeNull();
    // No region, nothing to be inside.
    expect(compareWithTruth({ ...e, position_uncertainty: { basis: "unreported" } }, frame(near, "E1"), 0.95)).toMatchObject({ inside: null });
  });
});

describe("Phase 3: evidence", () => {
  const state = atSecond(60);

  it("draws a line of bearing and a wedge per bearing for the selection only, by default", () => {
    const e1 = state.entities.get("E1")!;
    const f = evidenceFeatures(state, "selected", { kind: "entity", id: "E1" });
    expect(f.bearings.features).toHaveLength(e1.fix_evidence!.bearings!.length);
    expect(f.wedges.features).toHaveLength(e1.fix_evidence!.bearings!.length);
    expect(new Set(f.bearings.features.map((b) => b.properties.id))).toEqual(new Set(["E1"]));
    expect(evidenceFeatures(state, "selected", null).bearings.features).toHaveLength(0);
    expect(evidenceFeatures(state, "off", { kind: "entity", id: "E1" }).bearings.features).toHaveLength(0);
  });

  it("gives an unreported-sigma bearing a line but no wedge", () => {
    const e = entity("B", {
      fix_evidence: {
        bearings: [
          { observation_id: "o1", source_id: "S", sensor_position: { lat: 50.05, lon: -105 }, bearing_deg: 180, bearing_uncertainty: { basis: "unreported" }, t: T0, weight: 1 },
        ],
      },
    });
    let s = applyMessage(emptyPicture(), hello()).state;
    s = applyMessage(s, snapshot(0, [e])).state;
    const f = evidenceFeatures(s, "all", null);
    expect(f.bearings.features.map((b) => b.properties.basis)).toEqual(["unreported"]);
    expect(f.wedges.features).toHaveLength(0);
  });

  it("links a reported position to the entity built from it", () => {
    const f = evidenceFeatures(state, "all", null);
    expect(f.reported.features.some((p) => p.properties.id === "E3")).toBe(true);
    expect(f.links.features.some((l) => l.properties.id === "E3")).toBe(true);
  });
});

describe("Phase 4: groups", () => {
  it("hides hypotheses unless asked, never draws retired groups, and draws published ones", () => {
    const g = (state: Group["state"]) => ({ state }) as Group;
    expect(groupVisible(g("hypothesis"), false)).toBe(false);
    expect(groupVisible(g("hypothesis"), true)).toBe(true);
    expect(groupVisible(g("retired"), true)).toBe(false);
    expect(groupVisible(g("published"), false)).toBe(true);
    expect(groupVisible(g("decaying"), false)).toBe(true);
  });

  it("follows G1 through its life in the recording: hypothesis, published, decaying, retired", () => {
    expect(atSecond(100).groups.has("G1")).toBe(false);
    expect(atSecond(120).groups.get("G1")?.state).toBe("hypothesis");
    expect(groupFeatures(atSecond(120), false, null).links.features).toHaveLength(0);
    expect(atSecond(200).groups.get("G1")?.state).toBe("published");
    expect(atSecond(250).groups.get("G1")?.state).toBe("decaying");
    expect(atSecond(275).groups.has("G1")).toBe(false);
  });

  it("links the controller to the controlled, with confidence in the label as well as the width", () => {
    const f = groupFeatures(atSecond(200), false, null);
    expect(f.links.features).toHaveLength(1);
    expect(f.links.features[0]!.properties).toMatchObject({ id: "G1", relation: "controller/controlled", confidence: 0.55 });
    expect(f.labels.features[0]!.properties.icon).toContain("0.55");
  });

  it("negative control: E4 and E11 sit together all run and are never drawn as a group", () => {
    for (const s of [30, 120, 200, 290]) {
      const state = atSecond(s);
      const grouped = new Set([...state.groups.values()].flatMap((g) => g.members.map((m) => m.entity_id)));
      expect(grouped.has("E4") || grouped.has("E11")).toBe(false);
      const links = groupFeatures(state, true, null).links.features;
      expect(links.every((l) => l.properties.id === "G1")).toBe(true);
    }
  });

  it("draws no group from co-located entities when the picture has none: Videns never infers one", () => {
    let s = applyMessage(emptyPicture(), hello()).state;
    s = applyMessage(s, snapshot(0, [entity("A", { position: { lat: 50, lon: -105 } }), entity("B", { position: { lat: 50.0001, lon: -105 } })])).state;
    expect(groupFeatures(s, true, null).links.features).toHaveLength(0);
  });

  it("dims everything but a selected group's members", () => {
    const state = atSecond(200);
    const points = pointFeatures(state, { kind: "group", id: "G1" }).features;
    const opacity = (id: string) => points.find((p) => p.properties.id === id)!.properties.opacity;
    expect(opacity("E2")).toBe(1);
    expect(opacity("E4")).toBeLessThan(0.5);
  });
});

describe("Phase 4: lifecycle", () => {
  it("a merge leaves one symbol and a visible, clickable record of the other", () => {
    const state = atSecond(180);
    const ids = pointFeatures(state).features.map((p) => p.properties.id);
    expect(ids).toContain("E8");
    expect(ids).not.toContain("E9");
    expect(state.departed.get("E9")).toMatchObject({ into: "E8" });
    const ghosts = ghostFeatures(state);
    expect(ghosts.points.features.map((g) => g.properties)).toContainEqual(expect.objectContaining({ kind: "entity", id: "E9" }));
    expect(ghosts.links.features).toHaveLength(1);
    expect(state.entities.get("E8")?.lineage).toMatchObject({ merged_from: ["E9"] });
    expect(state.log.some((l) => l.kind === "event" && l.event.kind === "merged")).toBe(true);
  });

  it("an unmerge brings E9 back and clears the merge", () => {
    const state = atSecond(240);
    expect(state.entities.has("E9")).toBe(true);
    expect(state.departed.has("E9")).toBe(false);
    expect(state.entities.get("E8")?.lineage).toBeUndefined();
  });

  it("a split shows the new entity's lineage", () => {
    expect(atSecond(255).entities.get("E10")?.lineage).toEqual({ split_from: "E6" });
  });

  it("the departure ghost fades after a minute of picture time", () => {
    expect(atSecond(220).departed.has("E9")).toBe(true); // 45 s after the merge
    // E5 retired at 200 s; by 265 s it is gone from the map.
    expect(atSecond(210).departed.has("E5")).toBe(true);
    expect(atSecond(265).departed.has("E5")).toBe(false);
  });

  it("every group in the recording claims no more than its member identity bound", () => {
    const messages = demo.all() as PictureMessage[];
    for (const m of messages) {
      const groups = m.type === "delta" ? (m.upsert?.groups ?? []) : m.type === "snapshot" ? m.groups : [];
      for (const g of groups) expect(g.confidence).toBeLessThanOrEqual(g.member_identity_bound);
    }
  });
});
