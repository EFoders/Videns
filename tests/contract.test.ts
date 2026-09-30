import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseMessage, validateMessage } from "../src/contract/validate.ts";
import { DemoScenario } from "../tools/mock-feed/scenario.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

describe("recorded fixtures", () => {
  const recordings = readdirSync(FIXTURES).filter((f) => f.endsWith(".picture.jsonl"));

  it("has at least one recording", () => {
    expect(recordings.length).toBeGreaterThan(0);
  });

  for (const file of recordings) {
    it(`${file}: every line is a valid picture.v0 message`, () => {
      const lines = readFileSync(join(FIXTURES, file), "utf8").trim().split("\n");
      const failures = lines
        .map((line, i) => ({ i, result: parseMessage(line) }))
        .filter(({ result }) => !result.ok)
        .map(({ i, result }) => `line ${i + 1}: ${JSON.stringify(result)}`);
      expect(failures).toEqual([]);
    });
  }
});

describe("invalid fixtures fail for the stated reason", () => {
  const dir = join(FIXTURES, "invalid");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as { reason: string; expect: string; message: unknown };
    it(`${file}: ${fixture.reason}`, () => {
      const result = validateMessage(fixture.message);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const text = result.issues.map((i) => `${i.path} ${i.message}`).join("\n");
      expect(text).toContain(fixture.expect);
    });
  }
});

describe("date-time format", () => {
  const heartbeat = (t: string) => ({ schema: "picture.v0", type: "heartbeat", run_id: "r", seq: 1, t, wall_t: "2026-01-01T00:00:00Z" });

  it("accepts real UTC instants, including a leap second", () => {
    for (const t of ["2026-01-01T00:00:00Z", "2024-02-29T12:00:00.125Z", "2016-12-31T23:59:60Z"]) {
      expect(validateMessage(heartbeat(t)).ok, t).toBe(true);
    }
  });

  it("rejects dates and times that do not exist", () => {
    for (const t of ["2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T12:00:60Z", "2026-13-01T00:00:00Z"]) {
      expect(validateMessage(heartbeat(t)).ok, t).toBe(false);
    }
  });
});

describe("the mock feed's scenario", () => {
  it("emits only valid messages across a whole run, for several seeds", () => {
    for (const seed of [1, 2, 7]) {
      const scenario = new DemoScenario({ seed, runIndex: 0 });
      const failures: string[] = [];
      const check = (m: unknown) => {
        const r = validateMessage(m);
        if (!r.ok) failures.push(JSON.stringify(r).slice(0, 400));
      };
      check(scenario.hello());
      check(scenario.snapshot());
      while (!scenario.finished) {
        scenario.step().forEach(check);
        check(scenario.heartbeat());
      }
      check(scenario.snapshot());
      expect(failures).toEqual([]);
    }
  });

  it("numbers messages consecutively", () => {
    const scenario = new DemoScenario({ seed: 1, runIndex: 0 });
    let last = scenario.snapshot().seq;
    while (!scenario.finished) {
      for (const m of scenario.step()) {
        expect(m.seq).toBe(last + 1);
        last = m.seq;
      }
    }
  });

  it("is deterministic for a seed", () => {
    const a = new DemoScenario({ seed: 5, runIndex: 0 });
    const b = new DemoScenario({ seed: 5, runIndex: 0 });
    for (let i = 0; i < 90; i++) expect(JSON.stringify(a.step())).toBe(JSON.stringify(b.step()));
  });

  it("injects its faults only when asked", () => {
    const faulty = new DemoScenario({ seed: 1, runIndex: 0, faults: new Set(["malformed", "gap"]) });
    let rejected = 0;
    let gaps = 0;
    let last = faulty.snapshot().seq;
    while (!faulty.finished) {
      for (const m of faulty.step()) {
        if (!validateMessage(m).ok) rejected += 1;
        if (m.seq > last + 1) gaps += 1;
        last = m.seq;
      }
    }
    expect(rejected).toBeGreaterThan(0);
    expect(gaps).toBeGreaterThan(0);
  });
});
