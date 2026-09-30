// The mock feed over real HTTP: the stream opens with hello and snapshot, carries
// sequenced messages, and resumes from Last-Event-ID.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PictureMessage } from "../src/contract/generated/picture.ts";
import { validateMessage } from "../src/contract/validate.ts";
import { startMockFeed, type MockFeed } from "../tools/mock-feed/feed.ts";

let feed: MockFeed;
const base = () => `http://127.0.0.1:${feed.port}`;

beforeAll(async () => {
  feed = await startMockFeed({ port: 0, seed: 1, rate: 20, faults: new Set(), heartbeatMs: 200, log: () => {} });
});

afterAll(async () => {
  await feed.close();
});

interface Frame {
  id?: string;
  message: PictureMessage;
}

/** Read SSE frames until `count` messages have arrived. */
async function readFrames(count: number, headers: Record<string, string> = {}): Promise<Frame[]> {
  const controller = new AbortController();
  const response = await fetch(`${base()}/picture/v0/stream`, { headers, signal: controller.signal });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const frames: Frame[] = [];
  let buffer = "";
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      const id = block.split("\n").find((l) => l.startsWith("id: "))?.slice(4);
      frames.push({ id, message: JSON.parse(data.slice(6)) as PictureMessage });
    }
  }
  controller.abort();
  return frames;
}

describe("mock feed", () => {
  it("opens a fresh stream with hello then snapshot, then consecutive messages", async () => {
    const frames = await readFrames(12);
    expect(frames[0]!.message.type).toBe("hello");
    expect(frames[1]!.message.type).toBe("snapshot");
    let last = frames[1]!.message.seq;
    for (const f of frames.slice(2)) {
      expect(f.message.seq).toBe(last + 1);
      last = f.message.seq;
    }
    for (const f of frames) expect(validateMessage(f.message)).toMatchObject({ ok: true });
    expect(frames.every((f) => f.id === `${f.message.run_id}:${f.message.seq}`)).toBe(true);
  });

  it("stamps wall time on every message", async () => {
    const frames = await readFrames(4);
    expect(frames.every((f) => typeof f.message.wall_t === "string")).toBe(true);
  });

  it("resumes after Last-Event-ID without resending the opening", async () => {
    const first = await readFrames(6);
    const lastSeen = first.at(-1)!;
    const resumed = await readFrames(3, { "Last-Event-ID": lastSeen.id! });
    expect(resumed[0]!.message.type).not.toBe("hello");
    expect(resumed[0]!.message.seq).toBe(lastSeen.message.seq + 1);
  });

  it("starts over for an id from another run", async () => {
    const frames = await readFrames(2, { "Last-Event-ID": "some-other-run:12" });
    expect(frames.map((f) => f.message.type)).toEqual(["hello", "snapshot"]);
  });

  it("serves hello and snapshot as JSON", async () => {
    const hello = await (await fetch(`${base()}/picture/v0/hello`)).json();
    const snapshot = await (await fetch(`${base()}/picture/v0/snapshot`)).json();
    expect(validateMessage(hello)).toMatchObject({ ok: true });
    expect(validateMessage(snapshot)).toMatchObject({ ok: true });
  });
});
