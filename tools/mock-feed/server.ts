// Container entry point for the mock feed: plays the synthetic "demo" scenario live over
// picture.v0, standing in for Vigilans until it publishes for real (VIDENS_SPEC.md 5.2).
//
// Environment:
//   MOCK_PORT    default 8090
//   MOCK_SEED    default 1
//   MOCK_RATE    picture seconds per wall second, default 1
//   MOCK_FAULTS  comma list of malformed,gap,stall; default none
//   MOCK_STALL_EVERY_S, MOCK_STALL_FOR_S  stall schedule with the stall fault; default 90, 10

import type { Fault } from "./scenario.ts";
import { FAULTS, startMockFeed } from "./feed.ts";

const port = Number(process.env.MOCK_PORT ?? 8090);
const seed = Number(process.env.MOCK_SEED ?? 1);
const rate = Number(process.env.MOCK_RATE ?? 1);
const faults = new Set(
  (process.env.MOCK_FAULTS ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean),
);

for (const fault of faults) {
  if (!FAULTS.includes(fault as Fault)) throw new Error(`unknown fault "${fault}" in MOCK_FAULTS; expected any of ${FAULTS.join(", ")}`);
}
if (!(rate > 0)) throw new Error(`MOCK_RATE must be positive, got ${process.env.MOCK_RATE}`);
if (!Number.isInteger(seed)) throw new Error(`MOCK_SEED must be an integer, got ${process.env.MOCK_SEED}`);

const stallEveryMs = Number(process.env.MOCK_STALL_EVERY_S ?? 90) * 1000;
const stallForMs = Number(process.env.MOCK_STALL_FOR_S ?? 10) * 1000;
if (!(stallEveryMs > stallForMs && stallForMs > 0)) throw new Error("MOCK_STALL_EVERY_S must exceed MOCK_STALL_FOR_S, and both be positive");

const feed = await startMockFeed({ port, seed, rate, faults: faults as Set<Fault>, stallEveryMs, stallForMs });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`mock-feed: ${signal}; closing`);
    void feed.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
