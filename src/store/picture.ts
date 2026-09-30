// The picture as the client holds it: a pure function from (state, validated message) to
// a new state. No DOM, no network, no clock -- which is what lets a recording and a live
// feed of the same run produce the same state, and what lets the tests run in Node.
//
// Sequence discipline (VIDENS_SPEC.md section 6.3): a message is applied only when it is
// the next one after the last applied. Anything else is reported, and a gap marks the
// picture as needing a fresh snapshot, because a missed delta may have removed something
// this state still shows.

import type {
  CotRecord,
  Entity,
  Group,
  HelloMessage,
  LifecycleEvent,
  NoticeMessage,
  PictureMessage,
  Sensor,
} from "../contract/generated/picture.ts";

export type LogEntry =
  | { kind: "event"; seq: number; event: LifecycleEvent }
  | { kind: "notice"; seq: number; notice: NoticeMessage };

/**
 * An entity that left the picture recently, remembered so its departure is shown as an
 * event -- "merged into E8" -- rather than as a symbol silently vanishing (spec 8.6,
 * Vigilans 11.3). Display memory only: nothing here is inferred.
 */
export interface Departure {
  entity: Entity;
  /** Picture time it left. */
  t: string;
  reason: string;
  /** The entity it was merged into, when the same delta said so. */
  into?: string;
}

/** How long, in picture time, a departed entity stays on the map as a ghost. */
export const DEPARTED_FOR_MS = 60_000;

export interface PictureState {
  runId?: string;
  hello?: HelloMessage;
  /** Seq of the last message applied. */
  lastSeq?: number;
  /** Picture time of the last applied message. */
  t?: string;
  wallT?: string;
  entities: ReadonlyMap<string, Entity>;
  groups: ReadonlyMap<string, Group>;
  sensors: ReadonlyMap<string, Sensor>;
  /** Latest CoT record per object, keyed by cotKey(). */
  cot: ReadonlyMap<string, CotRecord>;
  /** Entities removed within the last DEPARTED_FOR_MS of picture time. */
  departed: ReadonlyMap<string, Departure>;
  /** Lifecycle events and notices, oldest first, bounded. */
  log: readonly LogEntry[];
  /** True until this run's snapshot arrives, and again after a gap. */
  needsSnapshot: boolean;
  /** Bumped on every applied change, so a renderer can skip identical states. */
  revision: number;
}

export type StoreIssueKind = "gap" | "duplicate" | "awaiting_snapshot" | "other_run" | "new_run";

export interface StoreIssue {
  kind: StoreIssueKind;
  message: string;
}

export interface ApplyResult {
  state: PictureState;
  issues: StoreIssue[];
}

export const LOG_LIMIT = 500;

export function emptyPicture(): PictureState {
  return {
    entities: new Map(),
    groups: new Map(),
    sensors: new Map(),
    cot: new Map(),
    departed: new Map(),
    log: [],
    needsSnapshot: true,
    revision: 0,
  };
}

export function cotKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export function applyMessage(state: PictureState, message: PictureMessage): ApplyResult {
  switch (message.type) {
    case "hello":
      return applyHello(state, message);
    case "snapshot":
      return applySnapshot(state, message);
    default:
      return applySequenced(state, message);
  }
}

function applyHello(state: PictureState, hello: HelloMessage): ApplyResult {
  if (hello.run_id !== state.runId) {
    const issues: StoreIssue[] = state.runId
      ? [{ kind: "new_run", message: `run changed from ${state.runId} to ${hello.run_id}; picture cleared` }]
      : [];
    return { state: { ...emptyPicture(), runId: hello.run_id, hello, revision: state.revision + 1 }, issues };
  }
  // Same run, new connection: keep the picture, take the header. The snapshot that follows
  // re-establishes the sequence.
  return { state: { ...state, hello, revision: state.revision + 1 }, issues: [] };
}

function applySnapshot(state: PictureState, snapshot: Extract<PictureMessage, { type: "snapshot" }>): ApplyResult {
  const issues: StoreIssue[] = [];
  const sameRun = snapshot.run_id === state.runId;
  if (!sameRun && state.runId) {
    issues.push({ kind: "new_run", message: `run changed from ${state.runId} to ${snapshot.run_id}; picture cleared` });
  }
  const cot = new Map<string, CotRecord>();
  for (const record of snapshot.cot) cot.set(cotKey(record.object.kind, record.object.id), record);
  const entities = new Map(snapshot.entities.map((e) => [e.entity_id, e]));
  // Keep recent departures across a resync, unless the entity is back.
  const departed = sameRun ? new Map([...state.departed].filter(([id]) => !entities.has(id))) : new Map<string, Departure>();
  return {
    state: {
      runId: snapshot.run_id,
      hello: sameRun ? state.hello : undefined,
      lastSeq: snapshot.seq,
      t: snapshot.t,
      wallT: snapshot.wall_t ?? state.wallT,
      entities,
      groups: new Map(snapshot.groups.map((g) => [g.group_id, g])),
      sensors: new Map(snapshot.sensors.map((s) => [s.sensor_id, s])),
      cot,
      departed,
      log: sameRun ? state.log : [],
      needsSnapshot: false,
      revision: state.revision + 1,
    },
    issues,
  };
}

type Sequenced = Exclude<PictureMessage, { type: "hello" | "snapshot" }>;

function applySequenced(state: PictureState, message: Sequenced): ApplyResult {
  if (message.run_id !== state.runId) {
    return {
      state,
      issues: [{ kind: "other_run", message: `${message.type} #${message.seq} is for run ${message.run_id}, not ${state.runId ?? "(none)"}` }],
    };
  }
  if (state.needsSnapshot || state.lastSeq === undefined) {
    return { state, issues: [{ kind: "awaiting_snapshot", message: `${message.type} #${message.seq} dropped: waiting for a snapshot` }] };
  }
  if (message.seq <= state.lastSeq) {
    return { state, issues: [{ kind: "duplicate", message: `${message.type} #${message.seq} already applied (last #${state.lastSeq})` }] };
  }
  if (message.seq > state.lastSeq + 1) {
    return {
      state: { ...state, needsSnapshot: true, revision: state.revision + 1 },
      issues: [{ kind: "gap", message: `expected #${state.lastSeq + 1}, got #${message.seq}: ${message.seq - state.lastSeq - 1} message(s) missing` }],
    };
  }

  const next: PictureState = {
    ...state,
    lastSeq: message.seq,
    t: message.t,
    wallT: message.wall_t ?? state.wallT,
    revision: state.revision + 1,
  };

  switch (message.type) {
    case "heartbeat":
      return { state: next, issues: [] };
    case "notice":
      return { state: { ...next, log: appendLog(state.log, [{ kind: "notice", seq: message.seq, notice: message }]) }, issues: [] };
    case "cot": {
      const cot = new Map(state.cot);
      cot.set(cotKey(message.record.object.kind, message.record.object.id), message.record);
      return { state: { ...next, cot }, issues: [] };
    }
    case "delta":
      return { state: applyDelta(next, message), issues: [] };
  }
}

function applyDelta(state: PictureState, delta: Extract<PictureMessage, { type: "delta" }>): PictureState {
  const entities = new Map(state.entities);
  const groups = new Map(state.groups);
  const sensors = new Map(state.sensors);
  let cot: Map<string, CotRecord> | undefined;
  const now = Date.parse(delta.t);
  const departed = new Map([...state.departed].filter(([, d]) => now - Date.parse(d.t) < DEPARTED_FOR_MS));

  for (const entity of delta.upsert?.entities ?? []) {
    entities.set(entity.entity_id, entity);
    departed.delete(entity.entity_id);
  }
  for (const group of delta.upsert?.groups ?? []) groups.set(group.group_id, group);
  for (const sensor of delta.upsert?.sensors ?? []) sensors.set(sensor.sensor_id, sensor);

  for (const removal of delta.remove ?? []) {
    if (removal.kind === "entity") {
      const leaving = entities.get(removal.id);
      if (leaving) {
        const merge = delta.events?.find((e) => e.kind === "merged" && e.from?.includes(removal.id) && e.into?.length);
        const into = merge?.into?.find((id) => id !== removal.id);
        departed.set(removal.id, { entity: leaving, t: delta.t, reason: removal.reason, ...(into ? { into } : {}) });
      }
      entities.delete(removal.id);
    } else if (removal.kind === "group") groups.delete(removal.id);
    else sensors.delete(removal.id);
    const key = cotKey(removal.kind, removal.id);
    if (state.cot.has(key)) {
      cot ??= new Map(state.cot);
      cot.delete(key);
    }
  }

  const log = delta.events?.length
    ? appendLog(state.log, delta.events.map((event) => ({ kind: "event" as const, seq: delta.seq, event })))
    : state.log;

  return { ...state, entities, groups, sensors, cot: cot ?? state.cot, departed, log };
}

function appendLog(log: readonly LogEntry[], entries: LogEntry[]): readonly LogEntry[] {
  const combined = [...log, ...entries];
  return combined.length > LOG_LIMIT ? combined.slice(combined.length - LOG_LIMIT) : combined;
}
