// The mock feed as a function, so tests can start one on a free port and the container
// entry point (server.ts) is only environment parsing.
//
//   GET /picture/v0/hello     the current hello
//   GET /picture/v0/snapshot  a snapshot now
//   GET /picture/v0/stream    SSE. A fresh connection starts with hello + snapshot; a
//                             reconnect with Last-Event-ID resumes from the buffer, or
//                             starts over when it cannot.
//   GET /truth/v0/stream       SSE of truth.v0 frames: where the simulator put each emitter.
//                             A separate channel; the picture never carries truth.
//   GET /healthz

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { PictureMessage } from "../../src/contract/generated/picture.ts";
import { validateMessage, validateTruth } from "../../src/contract/validate.ts";
import { DemoScenario, type Fault } from "./scenario.ts";

export interface MockFeedOptions {
  port: number;
  seed: number;
  /** Picture seconds per wall second. */
  rate: number;
  faults: ReadonlySet<Fault>;
  heartbeatMs?: number;
  /** With the stall fault: how often a stall begins, and how long it lasts. */
  stallEveryMs?: number;
  stallForMs?: number;
  log?: (message: string) => void;
}

export interface MockFeed {
  port: number;
  close(): Promise<void>;
}

const BUFFER_LIMIT = 5000;
const STALL_EVERY_MS = 90_000;
const STALL_FOR_MS = 10_000;

export const FAULTS: readonly Fault[] = ["malformed", "gap", "stall"];

export function startMockFeed(options: MockFeedOptions): Promise<MockFeed> {
  const log = options.log ?? ((m: string) => console.log(`${new Date().toISOString()} mock-feed: ${m}`));
  const { seed, rate, faults } = options;
  // Unique per process start, so a restarted feed is visibly a new run.
  const instance = Date.now().toString(36);
  let runIndex = 0;
  let scenario = new DemoScenario({ seed, runIndex, faults, rate, instance });
  let buffer: { seq: number; frame: string }[] = [];
  const clients = new Set<ServerResponse>();
  const truthClients = new Set<ServerResponse>();
  let latestTruth: string | null = null;
  let stalledUntil = 0;

  const stamp = (message: PictureMessage): PictureMessage => ({ ...message, wall_t: new Date().toISOString() }) as PictureMessage;
  const frame = (message: PictureMessage): string => `id: ${message.run_id}:${message.seq}\ndata: ${JSON.stringify(message)}\n\n`;
  const opening = (): string => frame(stamp(scenario.hello())) + frame(stamp(scenario.snapshot()));

  function broadcast(message: PictureMessage): void {
    const stamped = stamp(message);
    // A mock that emits invalid messages by accident would make every diagnostic in the
    // viewer meaningless. Only the deliberate malformed fault may fail.
    const result = validateMessage(stamped);
    if (!result.ok && !faults.has("malformed")) {
      log(`BUG: emitted an invalid ${message.type} #${message.seq}: ${JSON.stringify(result.issues)}`);
    }
    const text = frame(stamped);
    buffer.push({ seq: stamped.seq, frame: text });
    if (buffer.length > BUFFER_LIMIT) buffer = buffer.slice(buffer.length - BUFFER_LIMIT);
    for (const client of clients) client.write(text);
  }

  function tick(): void {
    if (Date.now() < stalledUntil) return;
    if (scenario.finished) {
      runIndex += 1;
      scenario = new DemoScenario({ seed, runIndex, faults, rate, instance });
      buffer = [];
      log(`run finished; starting ${scenario.runId}`);
      const text = opening();
      for (const client of clients) client.write(text);
    }
    for (const message of scenario.step()) broadcast(message);
    const frame = scenario.truth();
    const check = validateTruth(frame);
    if (!check.ok) log(`BUG: emitted an invalid truth frame: ${JSON.stringify(check.issues)}`);
    latestTruth = `id: ${frame.run_id}:${frame.t}
data: ${JSON.stringify(frame)}

`;
    for (const client of truthClients) client.write(latestTruth);
  }

  function heartbeat(): void {
    if (Date.now() < stalledUntil) return;
    broadcast(scenario.heartbeat());
  }

  /** Replay what a reconnecting client missed, if this run's buffer still holds all of it. */
  function resume(res: ServerResponse, lastEventId: string): boolean {
    const [runId, seqText] = lastEventId.split(":");
    const seq = Number(seqText);
    if (runId !== scenario.runId || !Number.isInteger(seq) || seq > scenario.lastSeq) return false;
    const first = buffer[0]?.seq;
    if (seq < scenario.lastSeq && (first === undefined || first > seq + 1)) return false;
    for (const entry of buffer) if (entry.seq > seq) res.write(entry.frame);
    return true;
  }

  /** Truth frames: the newest at once, then each as the scenario steps. */
  function truthStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    if (latestTruth) res.write(latestTruth);
    truthClients.add(res);
    req.on("close", () => truthClients.delete(res));
  }

  function stream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    const lastEventId = req.headers["last-event-id"];
    const resumed = typeof lastEventId === "string" && resume(res, lastEventId);
    if (!resumed) res.write(opening());
    clients.add(res);
    log(`client connected (${clients.size} total)${resumed ? `, resumed after ${lastEventId}` : ""}`);
    req.on("close", () => {
      clients.delete(res);
      log(`client disconnected (${clients.size} total)`);
    });
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
    switch (path) {
      case "/picture/v0/stream":
        return stream(req, res);
      case "/picture/v0/hello":
        return json(res, 200, stamp(scenario.hello()));
      case "/picture/v0/snapshot":
        return json(res, 200, stamp(scenario.snapshot()));
      case "/truth/v0/stream":
        return truthStream(req, res);
      case "/healthz":
        return json(res, 200, { ok: true, run_id: scenario.runId, t_s: scenario.elapsedS, clients: clients.size });
      default:
        return json(res, 404, { error: `no such path ${path}` });
    }
  });

  const timers = [setInterval(tick, 1000 / rate), setInterval(heartbeat, options.heartbeatMs ?? 1000)];
  if (faults.has("stall")) {
    timers.push(
      setInterval(() => {
        stalledUntil = Date.now() + (options.stallForMs ?? STALL_FOR_MS);
        log(`stalling for ${(options.stallForMs ?? STALL_FOR_MS) / 1000} s (fault: stall)`);
      }, options.stallEveryMs ?? STALL_EVERY_MS),
    );
  }

  return new Promise((resolve) => {
    server.listen(options.port, () => {
      const port = (server.address() as AddressInfo).port;
      log(`listening on :${port}; scenario ${scenario.runId}; rate ${rate}x; faults ${[...faults].join(",") || "none"}`);
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const timer of timers) clearInterval(timer);
            for (const client of [...clients, ...truthClients]) client.end();
            server.close(() => done());
          }),
      });
    });
  });
}
