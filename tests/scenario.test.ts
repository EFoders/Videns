// The scenario editor's core (VIDENS_SPEC.md 16.6): frame against the prototype's own code,
// motion against the prototype's and vigilans-hub's, files that meet scenario.v2 and
// round-trip, older files converted and exports made honestly, validation that reproduces
// the contract's checks, and edits that keep things where they are.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import * as validators from "../src/contract/generated/validators.js";
import { geodesicInverse } from "../src/geo/geodesic.ts";
import { blankScenario, normalise, normaliseEmitter } from "../src/scenario/defaults.ts";
import {
  addEmitter,
  addRelation,
  addSensor,
  addSource,
  appendWaypoint,
  declarationFor,
  deleteEmitter,
  deleteSource,
  renameEmitter,
  renameSource,
  setDeclaration,
  setHold,
  setOrigin,
  setWindows,
  updateEmitter,
  updateSensor,
} from "../src/scenario/editing.ts";
import { toLatLon, toLocal } from "../src/scenario/frame.ts";
import { exportPrototype, forSave, openScenario, saveScenario } from "../src/scenario/io.ts";
import { classDefaults, parseLibrary } from "../src/scenario/library.ts";
import { isSwitchedOn, passDuration, positionAt } from "../src/scenario/motion.ts";
import { marginDb, maxRangeM } from "../src/scenario/propagation.ts";
import type { Emitter, Scenario } from "../src/scenario/types.ts";
import { scenarioIssues } from "../src/scenario/validate.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8");
const vectors = JSON.parse(read("tests", "vectors", "scenario.json")) as {
  frames: { origin_lat: number; origin_lon: number; east_m: number; north_m: number; lat: number; lon: number }[];
  motion: { emitter: string; path_m: number[][]; speed_mps: number; loop: boolean; t_s: number; east_m: number; north_m: number }[];
};
const hub = JSON.parse(read("tests", "vectors", "hub-motion.json")) as {
  motion: { emitter: string; path_m: number[][]; speed_mps: number; loop: boolean; t_s: number; east_m: number; north_m: number }[];
  windows: { case: string; active_windows_s: number[][] | null; t_s: number; on: boolean }[];
};
const library = parseLibrary(read("config", "library", "signatures.yaml"), read("config", "library", "roles.yaml"));
const apart = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => geodesicInverse(a.lat, a.lon, b.lat, b.lon).distanceM;
const emitter = (extra: Partial<Emitter> & Pick<Emitter, "path_m">): Emitter => normaliseEmitter({ id: "W", freq_hz: 45e6, bandwidth_hz: 25e3, ...extra });
const errorsOf = (s: Scenario) => scenarioIssues(s, library).filter((i) => i.severity === "error").map((i) => i.message).join("\n");
const warningsOf = (s: Scenario) => scenarioIssues(s, library).filter((i) => i.severity === "warning").map((i) => i.message).join("\n");

describe("local frame, against the prototype's LocalFrame (pyproj AEQD)", () => {
  it("places local offsets where the prototype does, to a millimetre, up to 150 km out", () => {
    for (const v of vectors.frames) {
      const p = toLatLon({ lat: v.origin_lat, lon: v.origin_lon }, v.east_m, v.north_m);
      expect(apart(p, v), `${v.origin_lat},${v.origin_lon} +(${v.east_m},${v.north_m})`).toBeLessThan(0.001);
    }
  });

  it("reads positions back into the same offsets, to a millimetre", () => {
    for (const v of vectors.frames) {
      const [e, n] = toLocal({ lat: v.origin_lat, lon: v.origin_lon }, v.lat, v.lon);
      expect(Math.hypot(e - v.east_m, n - v.north_m)).toBeLessThan(0.001);
    }
  });
});

describe("motion", () => {
  it("matches the prototype's position_at where scenario.v2 adds nothing", () => {
    for (const v of vectors.motion) {
      const [east, north] = positionAt(emitter({ path_m: v.path_m, speed_mps: v.speed_mps, loop: v.loop }), v.t_s);
      expect(Math.hypot(east - v.east_m, north - v.north_m), `${v.emitter} at ${v.t_s} s`).toBeLessThan(1e-6);
    }
  });

  it("matches vigilans-hub's position_en with holds, loops and final holds", () => {
    expect(hub.motion.length).toBeGreaterThan(0);
    for (const v of hub.motion) {
      const [east, north] = positionAt(emitter({ path_m: v.path_m, speed_mps: v.speed_mps, loop: v.loop }), v.t_s);
      expect(Math.hypot(east - v.east_m, north - v.north_m), `${v.emitter} at ${v.t_s} s`).toBeLessThan(1e-6);
    }
  });

  it("switches the transmitter by active windows exactly as vigilans-hub does", () => {
    for (const v of hub.windows) {
      const e = emitter({ path_m: [[0, 0]], ...(v.active_windows_s ? { active_windows_s: v.active_windows_s } : {}) });
      expect(isSwitchedOn(e, v.t_s), `${v.case} at ${v.t_s} s`).toBe(v.on);
    }
  });

  it("keeps moving outside its windows: they switch the transmitter, not the platform", () => {
    const e = emitter({ path_m: [[0, 0], [1000, 0]], speed_mps: 10, active_windows_s: [[50, 60]] });
    expect(isSwitchedOn(e, 20)).toBe(false);
    expect(positionAt(e, 20)).toEqual([200, 0]);
  });

  it("times a pass with its holds", () => {
    expect(passDuration(emitter({ path_m: [[0, 0, 30], [1000, 0, 20]], speed_mps: 10 }))).toBe(150);
    expect(passDuration(emitter({ path_m: [[0, 0, 30], [1000, 0]], speed_mps: 10, loop: true }))).toBe(230);
    expect(passDuration(emitter({ path_m: [[0, 0]] }))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("propagation", () => {
  const link = { eirpDbm: 40, freqHz: 45.2e6, exponent: 2.7, noiseFloorDbm: -110, thresholdDb: 6 };

  it("reproduces the simulator's free-space-at-1-m, log-distance model", () => {
    // FSPL at 1 m and 45.2 MHz is 5.55 dB; at 10 km with n = 2.7 add 108 dB.
    expect(marginDb(link, 10_000)).toBeCloseTo(40 - (5.5474 + 108) + 110 - 6, 2);
  });

  it("gives the range where the median margin reaches zero", () => {
    const r = maxRangeM(link);
    expect(marginDb(link, r)).toBeCloseTo(0, 6);
    expect(marginDb(link, r * 1.1)).toBeLessThan(0);
  });
});

/** A small valid scenario built with the editor's own edits. */
function demo(): Scenario {
  let s = blankScenario();
  s = addSensor(s, [0, 0]).scenario;
  s = addSensor(s, [9000, 1500]).scenario;
  s = addSensor(s, [4000, -6000]).scenario;
  const vhf = library.classes.find((c) => c.id === "sig.vhf_net")!;
  s = addEmitter(s, [3000, 2000], vhf, "hostile").scenario;
  s = appendWaypoint(s, "E1", [6000, 2000], 12);
  s = appendWaypoint(s, "E1", [6000, 5000], 12);
  s = addEmitter(s, [5000, -2000], vhf, "friend").scenario;
  return s;
}

/** The demo with every scenario.v2 addition in use. */
function everything(): Scenario {
  let s = demo();
  const added = addSource(s, "position");
  s = updateSensor(addSensor(added.scenario, [1000, 1000], added.id).scenario, "S4", { p_miss: 0.3 });
  s = { ...s, sources: s.sources!.map((x) => (x.id === "SIM" ? { ...x, freq_bias_hz: 1500, clock_offset_s: 0.4, fault: { kind: "flat_sigma" as const, every: 40 } } : x)) };
  s = updateSensor(s, "S2", { scan: { dwell_s: 0.5, revisit_s: 5 } });
  s = setHold(s, "E1", 0, 120);
  s = setWindows(s, "E2", [[0, 100], [200, 400]]);
  s = updateEmitter(s, "E2", { activity: { type: "periodic", period_s: 30, on_s: 2, offset_s: 7, hub: false }, source_claim: { scheme: "remote_id", category: "uas", claimed_id: "RID-1" } });
  s = setDeclaration(s, "SIM", { affiliation: "friend", assumed_bearing_sigma_deg: 3, assumption_note: "Synthetic: characterised against known emitters." });
  s = addRelation(s, "controller/controlled", [{ emitter_id: "E1", role: "controller" }, { emitter_id: "E2", role: "controlled" }]).scenario;
  return s;
}

describe("the contract", () => {
  // The Vigilans contract package owns scenario.v2; Videns builds from a copy of it.
  const contractDir = process.env.VIGILANS_CONTRACT_DIR;
  it.skipIf(!contractDir)("keeps its copy of scenario.v2 identical to the contract package's (scripts/sync-contract.sh)", () => {
    const theirs = readFileSync(join(contractDir!, "scenario.v2.schema.json"), "utf8");
    expect(JSON.parse(read("contract", "scenario.v2.schema.json"))).toEqual(JSON.parse(theirs));
  });
});

describe("files", () => {
  const prototypes = readdirSync(join(ROOT, "fixtures", "scenarios")).filter((f) => f.endsWith(".yaml"));
  const hubExamples = readdirSync(join(ROOT, "fixtures", "scenarios-v2")).filter((f) => f.endsWith(".yaml"));

  it("saves scenario.v2 that the contract's schema accepts", () => {
    for (const s of [demo(), everything()]) {
      const raw = parse(saveScenario(s));
      expect(raw.schema).toBe("scenario.v2");
      expect(validators.scenario(raw), JSON.stringify(validators.scenario.errors)).toBe(true);
    }
    expect(errorsOf(everything())).toBe("");
  });

  it("opens vigilans-hub's own scenario.v2 examples, and saves them unchanged in meaning", () => {
    expect(hubExamples.length).toBeGreaterThan(0);
    for (const f of hubExamples) {
      const opened = openScenario(read("fixtures", "scenarios-v2", f));
      expect(opened.problems, f).toEqual([]);
      expect(opened.flavour).toBe("v2");
      expect(errorsOf(opened.scenario!), f).toBe("");
      expect(openScenario(saveScenario(opened.scenario!)).scenario, f).toEqual(opened.scenario);
    }
  });

  it("round-trips scenario.v2: open(save(s)) is s", () => {
    const s = normalise(everything());
    const again = openScenario(saveScenario(s));
    expect(again.flavour).toBe("v2");
    expect(again.scenario).toEqual(forSave(s));
    expect(openScenario(saveScenario(again.scenario!)).scenario).toEqual(again.scenario);
  });

  it("saves only what applies: a position receiver has no bearing σ, a bearing source no position settings", () => {
    const raw = parse(saveScenario(everything()));
    expect(raw.sensors.find((x: { id: string }) => x.id === "S4").bearing_sigma_deg).toBeUndefined();
    expect(raw.sources.find((x: { id: string }) => x.id === "SIM").position_sigma_m).toBeUndefined();
    expect(raw.sources.find((x: { kind: string }) => x.kind === "position").position_sigma_m).toBe(150);
  });

  it("opens the prototype's own scenarios, naming what scenario.v2 does not carry", () => {
    expect(prototypes.length).toBeGreaterThan(0);
    for (const f of prototypes) {
      const opened = openScenario(read("fixtures", "scenarios", f));
      expect(opened.problems, f).toEqual([]);
      expect(opened.flavour).toBe("prototype");
      expect(opened.scenario!.sensors.every((x) => x.source_id === "SIM")).toBe(true);
      expect(opened.scenario!.sources).toEqual([expect.objectContaining({ id: "SIM", kind: "bearing" })]);
      expect(validators.scenario(parse(saveScenario(opened.scenario!)))).toBe(true);
    }
    const notes = openScenario(read("fixtures", "scenarios", "static_net.yaml")).notes.join("\n");
    expect(notes).toContain("engine:");
    expect(notes).toContain("expect:");
  });

  it("brings the editor's scenario.v1 forward: pauses become holds, windows switch, the rest is named", () => {
    const v1 = [
      "schema: scenario.v1",
      "name: old",
      "duration_s: 900",
      "origin: {lat: 50, lon: -105}",
      "sensors: [{id: S1, pos_m: [0, 0], bearing_sigma_deg: 2}, {id: S2, pos_m: [9000, 0], bearing_sigma_deg: 2}]",
      "emitters:",
      "  - {id: A, path_m: [[0, 0], [1000, 0], [1000, 1000]], speed_mps: 10, legs: [{dwell_s: 30}, {dwell_s: 5}], freq_hz: 4.5e7, bandwidth_hz: 25000}",
      "  - {id: B, path_m: [[0, 0], [1000, 0]], speed_mps: 10, active: {from_s: 100, until_s: 400}, freq_hz: 4.5e7, bandwidth_hz: 25000}",
      "  - {id: C, path_m: [[0, 0], [1000, 0], [0, 500]], speed_mps: 10, legs: [{speed_mps: 20}, {speed_mps: 5}], freq_hz: 4.5e7, bandwidth_hz: 25000}",
      "operator: {declarations: [{id: D-A, identity: hostile, freq_hz: [44990000, 45010000], reason: Operator says so.}]}",
      "truth_relations: [{id: R1, kind: peer, members: [{emitter_id: A}, {emitter_id: B}]}]",
    ].join("\n");
    const opened = openScenario(v1);
    expect(opened.problems).toEqual([]);
    expect(opened.flavour).toBe("v1");
    const s = opened.scenario!;
    const byId = (id: string) => s.emitters.find((e) => e.id === id)!;
    expect(byId("A").path_m).toEqual([[0, 0, 30], [1000, 0, 5], [1000, 1000]]);
    // v1: B waited at its first waypoint until 100 s, then set off. Same in v2, by a hold.
    expect(byId("B").path_m[0]).toEqual([0, 0, 100]);
    expect(byId("B").active_windows_s).toEqual([[100, 400]]);
    expect(positionAt(byId("B"), 150)).toEqual([500, 0]);
    expect(s.truth_relations).toEqual([{ kind: "peer", members: [{ emitter_id: "A" }, { emitter_id: "B" }] }]);
    expect(s.operator?.declarations).toEqual([]);
    const notes = opened.notes.join("\n");
    expect(notes).toMatch(/C: per-leg speeds have no scenario.v2 form\. It moves at one speed, \d+\.\d\d m\/s/);
    expect(notes).toContain("Declaration D-A (hostile");
    expect(errorsOf(s)).toBe("");
  });

  it("opens a scenario.v1 file that already meets scenario.v2 as it stands", () => {
    const opened = openScenario(saveScenario(demo()).replace("schema: scenario.v2", "schema: scenario.v1"));
    expect(opened.flavour).toBe("v1");
    expect(opened.notes).toEqual([]);
    expect(opened.scenario).toEqual(forSave(demo()));
  });

  it("exports a prototype scenario back without dropping anything", () => {
    const s = openScenario(read("fixtures", "scenarios", "static_net.yaml")).scenario!;
    const exported = exportPrototype(s);
    expect(exported.dropped).toEqual([]);
    expect(exported.text).not.toContain("schema:");
    expect(openScenario(exported.text).scenario).toEqual(s);
  });

  it("names everything the prototype cannot express, and what it used instead", () => {
    const s = updateEmitter(everything(), "E1", { label: "Command post" });
    const { text, dropped } = exportPrototype(s);
    const all = dropped.join("\n");
    for (const phrase of [
      "Labels",
      "True sides",
      "Source SIM: a 1500 Hz frequency bias, a 0.4 s clock offset, a deliberate flat_sigma fault",
      "Position-source receivers (S4)",
      "Scanning (S2)",
      "Operator declarations (1)",
      "True relations (1)",
      "E1: 1 waypoint hold",
      "E2: switched on only in 0–100 s, 200–400 s",
      "E2: its remote_id self-identification",
      "E2: a 7 s periodic offset",
    ]) {
      expect(all).toContain(phrase);
    }
    for (const forbidden of ["label:", "side:", "sources:", "source_id:", "scan:", "active_windows_s:", "source_claim:", "offset_s:", "operator:", "truth_relations:", "schema:"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain("S4");
  });

  it("reports why a file will not open", () => {
    expect(openScenario("name: x\n").problems.join()).toContain("duration_s");
    expect(openScenario("[1, 2]").problems.join()).toContain("mapping");
    expect(openScenario("schema: scenario.v3\n").problems.join()).toContain("unknown schema");
    expect(openScenario("schema: scenario.v2\nname: x\nduration_s: 10\n").problems.join()).toContain("origin");
  });
});

describe("validation: the contract's checks", () => {
  it("accepts the demo scenario without errors", () => {
    expect(errorsOf(demo())).toBe("");
  });

  it("refuses what vigilans-hub would refuse, naming the object", () => {
    let s = demo();
    s = updateEmitter(s, "E1", { speed_mps: 0 });
    s = updateEmitter(s, "E2", { activity: { type: "net", net_id: "N9", hub: false }, active_windows_s: [[50, 50]] });
    s = { ...s, sensors: [...s.sensors, { ...s.sensors[0]!, freq_range_hz: [3e9, 20e6] }] };
    s = updateSensor(s, "S2", { bearing_sigma_deg: undefined, scan: { dwell_s: 9, revisit_s: 5 } });
    const errors = errorsOf(s);
    expect(errors).toContain("E1: a path with 3 waypoints needs a speed");
    expect(errors).toContain('E2: no net "N9"');
    expect(errors).toContain("E2: active window 1 must start before it stops");
    expect(errors).toContain('Duplicate sensor id "S1"');
    expect(errors).toContain("the band's low edge must be below its high edge");
    expect(errors).toContain("Sensor S2 reports bearings (source SIM), so it needs a bearing σ");
    expect(errors).toContain("Sensor S2: scan dwell is longer than its revisit time");
  });

  it("checks declarations and receivers as the contract does", () => {
    let s = everything();
    s = updateSensor(s, "S4", { elevation_sigma_deg: 2 });
    s = { ...s, operator: { declarations: [...s.operator!.declarations!, { source_id: "NOBODY" }, { source_id: "POS1", assumed_position_sigma_m: 50 }] } };
    const errors = errorsOf(s);
    expect(errors).toContain("Sensor S4: a position source's receiver reports positions, not angles");
    expect(errors).toContain("Declaration for source NOBODY: no sensor reports as that source");
    expect(errors).toContain("Declaration for source POS1: an assumed uncertainty needs a note");
  });

  it("refuses ids scenario.v2 does not allow", () => {
    const s = { ...demo(), emitters: demo().emitters.map((e) => (e.id === "E2" ? { ...e, id: "E 2" } : e)) };
    expect(errorsOf(s)).toContain("/emitters/1/id");
    expect(renameEmitter(demo(), "E1", "has space").emitters[0]!.id).toBe("E1");
  });

  it("warns when nobody can hear an emitter, or it is outside its class's band", () => {
    let s = demo();
    s = updateEmitter(s, "E2", { eirp_dbm: -40 });
    s = updateEmitter(s, "E1", { freq_hz: 150e6 });
    const warnings = warningsOf(s);
    expect(warnings).toContain("No sensor can hear E2");
    expect(warnings).toContain("outside VHF tactical net's band");
  });

  it("does not ask for a second bearing when a position system hears the emitter", () => {
    let s = blankScenario();
    const pos = addSource(s, "position");
    s = addSensor(pos.scenario, [0, 0], pos.id).scenario;
    s = addEmitter(s, [2000, 0], null).scenario;
    expect(warningsOf(s)).not.toContain("cannot be fixed");
  });
});

describe("edits", () => {
  it("moving the origin keeps every object, and every hold, where it was", () => {
    const s = setHold(demo(), "E1", 2, 45);
    const moved = setOrigin(s, { lat: 50.1, lon: -104.8 });
    const before = toLatLon(s.origin, ...(s.emitters[0]!.path_m[2]!.slice(0, 2) as [number, number]));
    const after = toLatLon(moved.origin, ...(moved.emitters[0]!.path_m[2]!.slice(0, 2) as [number, number]));
    expect(apart(before, after)).toBeLessThan(0.02); // positions are kept to the centimetre
    expect(moved.emitters[0]!.path_m[2]![2]).toBe(45);
  });

  it("a hold of zero is no hold", () => {
    const s = setHold(setHold(demo(), "E1", 1, 30), "E1", 1, 0);
    expect(s.emitters[0]!.path_m[1]).toHaveLength(2);
  });

  it("declares per source; an empty declaration is withdrawn", () => {
    let s = setDeclaration(demo(), "SIM", { affiliation: "friend" });
    expect(declarationFor(s, "SIM")).toEqual({ source_id: "SIM", affiliation: "friend" });
    s = setDeclaration(s, "SIM", { affiliation: undefined });
    expect(s.operator?.declarations).toEqual([]);
  });

  it("renaming and deleting a source carries its sensors and declaration along", () => {
    let s = setDeclaration(demo(), "SIM", { affiliation: "friend" });
    s = renameSource(s, "SIM", "DF-NET");
    expect(s.sensors.every((x) => x.source_id === "DF-NET")).toBe(true);
    expect(declarationFor(s, "DF-NET")).toBeDefined();
    const pos = addSource(s, "position");
    s = deleteSource(pos.scenario, "DF-NET");
    expect(s.sensors.every((x) => x.source_id === pos.id)).toBe(true);
    expect(s.operator?.declarations).toEqual([]);
  });

  it("renaming and deleting an emitter carries its relations along", () => {
    let s = addRelation(demo(), "peer", [{ emitter_id: "E1" }, { emitter_id: "E2" }]).scenario;
    s = renameEmitter(s, "E1", "HQ");
    expect(s.truth_relations![0]!.members[0]!.emitter_id).toBe("HQ");
    s = deleteEmitter(s, "HQ");
    expect(s.truth_relations).toEqual([]);
  });

  it("fills an emitter from its library class, inside the class's band", () => {
    for (const c of library.classes) {
      const d = classDefaults(c);
      expect(d.freq_hz).toBeGreaterThanOrEqual(c.freqHz[0]);
      expect(d.freq_hz).toBeLessThanOrEqual(c.freqHz[1]);
    }
    expect(library.problems).toEqual([]);
    expect(library.roles.length).toBeGreaterThan(0);
  });

  it("normalises a scenario so every default the simulator would use is visible, sources included", () => {
    const s = normalise({
      schema: "scenario.v2",
      name: "x",
      duration_s: 10,
      origin: { lat: 50, lon: -105 },
      sensors: [{ id: "S1", pos_m: [0, 0], bearing_sigma_deg: 2 }, { id: "S2", source_id: "OTHER", pos_m: [5, 0], bearing_sigma_deg: 2 }],
      emitters: [{ id: "E1", path_m: [[1, 1]], freq_hz: 1e8, bandwidth_hz: 1e4, activity: { type: "periodic", period_s: 10, on_s: 1 } }],
    });
    expect(s.sensors[0]).toMatchObject({ source_id: "SIM", noise_floor_dbm: -110, threshold_db: 6, freq_range_hz: [20e6, 3e9] });
    expect(s.sources!.map((x) => [x.id, x.kind, x.reports_uncertainty])).toEqual([
      ["SIM", "bearing", true],
      ["OTHER", "bearing", true],
    ]);
    expect(s.emitters[0]).toMatchObject({ eirp_dbm: 40, speed_mps: 0, loop: false, activity: { type: "periodic", offset_s: 0 } });
    expect(s.propagation).toEqual({ model: "log_distance", exponent: 2.7, shadowing_sigma_db: 4 });
  });
});
