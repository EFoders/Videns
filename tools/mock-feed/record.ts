// Write a scenario out as a .picture.jsonl recording (VIDENS_SPEC.md section 6.11), and its
// simulation truth beside it as .truth.jsonl (8.7): the same messages the live feed sends,
// in order, with a snapshot at least every 30 s of picture time so a reader can seek. No
// wall_t and no heartbeats: a recording is deterministic, byte for byte, for a given seed.
//
//   node tools/mock-feed/record.ts [seconds=120] [seed=1] [out=fixtures/demo.picture.jsonl]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DemoScenario } from "./scenario.ts";

const KEYFRAME_S = 30;

export function record(seconds: number, seed: number): { picture: string[]; truth: string[] } {
  const scenario = new DemoScenario({ seed, runIndex: 0 });
  const picture = [JSON.stringify(scenario.hello()), JSON.stringify(scenario.snapshot())];
  const truth: string[] = [];
  while (!scenario.finished && scenario.elapsedS < seconds) {
    for (const message of scenario.step()) picture.push(JSON.stringify(message));
    truth.push(JSON.stringify(scenario.truth()));
    if (scenario.elapsedS % KEYFRAME_S === 0) picture.push(JSON.stringify(scenario.snapshot()));
  }
  return { picture, truth };
}

if (import.meta.main) {
  const seconds = Number(process.argv[2] ?? 120);
  const seed = Number(process.argv[3] ?? 1);
  const out = process.argv[4] ?? "fixtures/demo.picture.jsonl";
  const truthOut = out.replace(/\.picture\.jsonl$/, ".truth.jsonl");
  const { picture, truth } = record(seconds, seed);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${picture.join("\n")}\n`);
  writeFileSync(truthOut, `${truth.join("\n")}\n`);
  console.log(`recorded ${picture.length} messages and ${truth.length} truth frames, ${seconds} s of picture time, seed ${seed}, to ${out} and ${truthOut}`);
}
