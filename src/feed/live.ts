// The live feed: Server-Sent Events from the picture stream (VIDENS_SPEC.md section 6.10).
//
// This layer knows about connections and liveness only. It hands raw message text upward
// and never interprets it; validation and sequencing happen above it, so a recording can
// be fed through exactly the same path.

export type FeedStatus =
  | "connecting" // opened, nothing received yet on this connection
  | "live" // messages arriving
  | "stalled" // connected, but nothing for longer than the stall threshold
  | "reconnecting"; // connection lost; the browser or we are retrying

export interface FeedCallbacks {
  onMessage(raw: string): void;
  onStatus(status: FeedStatus, detail: string): void;
}

/** Heartbeats come at least every 2 s; missing more than two in a row is a stall. */
export const STALL_AFTER_MS = 5000;
const CHECK_EVERY_MS = 500;
const REOPEN_AFTER_MS = 2000;

export class LiveFeed {
  private source: EventSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reopenTimer: ReturnType<typeof setTimeout> | null = null;
  private status: FeedStatus = "connecting";
  private lastMessageAt: number | null = null;

  constructor(
    private readonly url: string,
    private readonly callbacks: FeedCallbacks,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.open();
    this.timer = setInterval(() => this.checkStall(), CHECK_EVERY_MS);
  }

  stop(): void {
    this.source?.close();
    this.source = null;
    if (this.timer) clearInterval(this.timer);
    if (this.reopenTimer) clearTimeout(this.reopenTimer);
  }

  /**
   * Start again from a fresh snapshot. A new EventSource sends no Last-Event-ID, so the
   * server opens with hello and snapshot rather than trying to resume.
   */
  resync(reason: string): void {
    this.source?.close();
    this.set("reconnecting", `resyncing: ${reason}`);
    this.open();
  }

  private open(): void {
    const source = new EventSource(this.url);
    this.source = source;
    this.set(this.lastMessageAt === null ? "connecting" : "reconnecting", `opening ${this.url}`);
    source.onmessage = (event: MessageEvent<string>) => {
      this.lastMessageAt = this.now();
      if (this.status !== "live") this.set("live", "receiving messages");
      this.callbacks.onMessage(event.data);
    };
    source.onerror = () => {
      if (source !== this.source) return;
      if (source.readyState === EventSource.CLOSED) {
        // The browser gives up after a non-stream response (an HTTP error from the proxy,
        // say). Keep trying ourselves; the reader sees "reconnecting", never silence.
        this.set("reconnecting", `connection to ${this.url} failed; retrying`);
        this.reopenTimer = setTimeout(() => this.open(), REOPEN_AFTER_MS);
      } else {
        this.set("reconnecting", `connection to ${this.url} lost; retrying`);
      }
    };
  }

  private checkStall(): void {
    if (this.status !== "live" || this.lastMessageAt === null) return;
    const silentMs = this.now() - this.lastMessageAt;
    if (silentMs > STALL_AFTER_MS) this.set("stalled", `no message for ${Math.round(silentMs / 1000)} s`);
  }

  private set(status: FeedStatus, detail: string): void {
    this.status = status;
    this.callbacks.onStatus(status, detail);
  }
}
