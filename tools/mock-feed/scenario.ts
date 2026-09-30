// The "demo" scenario: a synthetic picture that exercises everything Phase 0 draws, played
// out over five minutes of picture time so it can be watched live.
//
// Deterministic: the same seed and run index give the same messages, byte for byte, with
// no dependence on the wall clock. The server stamps wall_t on the way out; recordings
// leave it off.
//
// Synthetic and unclassified (VIDENS_SPEC.md rule 16): the origin is the prototype's
// arbitrary neutral origin, classes are "syn.*", and the frequencies are arbitrary.
//
// What it exercises:
//   E1  static, bearing-located, measured covariance that shrinks as fixes accrue;
//       tentative (CoT withheld) then confirmed; unclassified then classified;
//       affiliation unknown/default, changed to suspect/library at t=120.
//   E2  moving on a circle, measured ellipse at 95 %, hostile/library, trail, velocity.
//   E3  position source that reports no uncertainty: basis unreported, nothing to draw.
//   E4  operator-assumed uncertainty, friend/operator.
//   E5  air, suspect/library, mixed uncertainty; created t=60, coasting t=150, retired t=200.
//   E6  neutral/operator, unclassified, far out to the east; split at t=250 into E6 and E10
//       once a second, co-channel emitter is resolved.
//   E7  the controller in group G1 with E2: hypothesis at t=110, published at 140,
//       decaying from 230 after E7 falls silent at 225, retired at 270.
//   E8/E9  one emitter reported by two sources, merged at t=175 -- wrongly -- and unmerged
//       at 235 when their frequencies diverge. Merging must be reversible.
//   E11 negative control: co-located with E4 for the whole run, unrelated, never grouped.
//   S1-S3 DF sensors; S3 goes quiet t=180-240 and fixes use two sensors meanwhile.
//
// Truth (truth.v0, a separate channel the picture never carries): X1..X11, where the
// simulator put each emitter, including X10 transmitting from t=200, fifty seconds before
// the picture resolves it.

import type {
  CotRecord,
  DeltaMessage,
  Entity,
  Group,
  HeartbeatMessage,
  HelloMessage,
  LifecycleEvent,
  NoticeMessage,
  PictureMessage,
  PositionUncertainty,
  Removal,
  Sensor,
  SnapshotMessage,
} from "../../src/contract/generated/picture.ts";
import type { TruthEmitter, TruthFrame } from "../../src/contract/generated/truth.ts";
import { ONE_SIGMA_2D } from "../../src/geo/ellipse.ts";
import { geodesicDirect, geodesicInverse, type GeoPoint } from "../../src/geo/geodesic.ts";
import { emitterEvents, sensorEvents } from "./cot.ts";
import { substream, type Rng } from "./rng.ts";

export type Fault = "malformed" | "gap" | "stall";

export interface ScenarioOptions {
  seed: number;
  runIndex: number;
  faults?: ReadonlySet<Fault>;
  /** Picture seconds per wall second, reported in hello. Does not change the messages. */
  rate?: number;
  /**
   * Distinguishes one feed process from the next. Without it a restarted feed reuses its
   * run ids, and a client cannot tell a new run from the old one resuming -- the same trap
   * as the prototype's reused TAK UIDs. Recordings leave it out so they stay reproducible.
   */
  instance?: string;
}

export const SCENARIO_NAME = "demo";
export const DURATION_S = 300;
export const ORIGIN: GeoPoint = { lat: 50.0, lon: -105.0 };
export const EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

const NAMESPACE = "mock";
const COT_REPUBLISH_S = 5;
const COT_STALE_S = 30;
const SENSOR_REFRESH_S = 10;
const TRAIL_LIMIT = 60;
const DESTINATIONS = [
  { name: "tak-lab (tcp)", outcome: "sent" as const },
  { name: "mesh-sa (udp)", outcome: "sent" as const },
];
const LIBRARY = { available: true, name: "synthetic", version: "0.1.0", private: false };

const at = (bearing: number, distance: number): GeoPoint => geodesicDirect(ORIGIN.lat, ORIGIN.lon, bearing, distance);

/** East/north offset in metres applied to a point, via the geodesic from that point. */
function offset(p: GeoPoint, east: number, north: number): GeoPoint {
  const d = Math.hypot(east, north);
  if (d === 0) return p;
  return geodesicDirect(p.lat, p.lon, (Math.atan2(east, north) * 180) / Math.PI, d);
}

/** Covariance of an ellipse with 1-sigma semi-axes a >= b, major axis at azimuth deg. */
function covariance(a: number, b: number, azimuthDeg: number) {
  const th = (azimuthDeg * Math.PI) / 180;
  const s = Math.sin(th);
  const c = Math.cos(th);
  return { ee: a * a * s * s + b * b * c * c, nn: a * a * c * c + b * b * s * s, en: (a * a - b * b) * s * c };
}

/** A sample from the 1-sigma ellipse (a, b, azimuth), as an east/north offset. */
function sampleOffset(rng: Rng, a: number, b: number, azimuthDeg: number): [number, number] {
  const th = (azimuthDeg * Math.PI) / 180;
  const along = rng.gauss() * a;
  const across = rng.gauss() * b;
  return [along * Math.sin(th) + across * Math.cos(th), along * Math.cos(th) - across * Math.sin(th)];
}

const round = (x: number, digits = 6): number => Number(x.toFixed(digits));
const pos = (p: GeoPoint) => ({ lat: round(p.lat, 7), lon: round(p.lon, 7) });
const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

interface SensorDef {
  id: string;
  point: GeoPoint;
}

const SENSORS: SensorDef[] = [
  { id: "S1", point: at(0, 7000) },
  { id: "S2", point: at(135, 7500) },
  { id: "S3", point: at(240, 7000) },
];

export class DemoScenario {
  readonly runId: string;
  readonly seed: number;
  private readonly faults: ReadonlySet<Fault>;
  private readonly rate: number;
  private tS = 0;
  private seq = 0;
  private readonly entities = new Map<string, Entity>();
  private readonly groups = new Map<string, Group>();
  private readonly sensors = new Map<string, Sensor>();
  private readonly cot = new Map<string, CotRecord>();
  private readonly fixCounts = new Map<string, number>();
  private readonly rngs = new Map<string, Rng>();

  constructor(options: ScenarioOptions) {
    this.seed = options.seed;
    const instance = options.instance ? `-${options.instance}` : "";
    this.runId = `mock-${SCENARIO_NAME}-s${options.seed}${instance}-r${options.runIndex}`;
    this.faults = options.faults ?? new Set();
    this.rate = options.rate ?? 1;
  }

  get elapsedS(): number {
    return this.tS;
  }

  get finished(): boolean {
    return this.tS >= DURATION_S;
  }

  get lastSeq(): number {
    return this.seq;
  }

  private time(tS = this.tS): string {
    return new Date(EPOCH_MS + tS * 1000).toISOString();
  }

  private rng(name: string): Rng {
    let r = this.rngs.get(name);
    if (!r) {
      r = substream(this.seed, name);
      this.rngs.set(name, r);
    }
    return r;
  }

  private envelope<T extends string>(type: T) {
    return { schema: "picture.v0" as const, type, run_id: this.runId, seq: ++this.seq };
  }

  hello(): HelloMessage {
    return {
      schema: "picture.v0",
      type: "hello",
      run_id: this.runId,
      seq: this.seq,
      engine: { name: "videns-mock-feed", version: "0.1.0" },
      contracts: ["picture.v0"],
      scenario: SCENARIO_NAME,
      library: LIBRARY,
      sources: [
        { source_id: "SRC-A", label: "DF network (synthetic)" },
        { source_id: "SRC-B", label: "Position source, no uncertainty (synthetic)" },
        { source_id: "SRC-C", label: "Position source, operator-assumed uncertainty (synthetic)" },
      ],
      clock: { mode: "sim", rate: this.rate },
      origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
      started_at: this.time(0),
      heartbeat_s: 1,
    };
  }

  /** The whole picture now. Its seq is that of the last message it reflects. */
  snapshot(): SnapshotMessage {
    return {
      schema: "picture.v0",
      type: "snapshot",
      run_id: this.runId,
      seq: this.seq,
      t: this.time(),
      entities: [...this.entities.values()],
      groups: [...this.groups.values()],
      sensors: [...this.sensors.values()],
      cot: [...this.cot.values()],
    };
  }

  heartbeat(): HeartbeatMessage {
    return { ...this.envelope("heartbeat"), t: this.time(), wall_t: new Date().toISOString() };
  }

  /** Advance one second of picture time. Returns the messages to broadcast, in order. */
  step(): PictureMessage[] {
    if (this.finished) return [];
    const messages: PictureMessage[] = [];
    if (this.tS === 0) messages.push(...this.start());
    this.tS += 1;
    const t = this.time();

    const upserts: Entity[] = [];
    const removals: Removal[] = [];
    const events: LifecycleEvent[] = [];
    const notices: NoticeMessage[] = [];
    const sensorUpserts: Sensor[] = [];

    // Sensor health and refresh.
    for (const def of SENSORS) {
      const before = this.sensors.get(def.id)!;
      const quiet = def.id === "S3" && this.tS >= 180 && this.tS < 240;
      const health = quiet ? "quiet" : "reporting";
      if (health !== before.health || this.tS % SENSOR_REFRESH_S === 0) {
        const next: Sensor = { ...before, health, ...(quiet ? {} : { last_heard: t }) };
        this.sensors.set(def.id, next);
        sensorUpserts.push(next);
      }
      if (health !== before.health) {
        notices.push({
          ...this.envelopeLater("notice"),
          t,
          severity: quiet ? "warning" : "info",
          code: quiet ? "sensor_quiet" : "sensor_reporting",
          text: quiet
            ? `Sensor ${def.id} has stopped reporting; bearing fixes now use two sensors.`
            : `Sensor ${def.id} is reporting again.`,
        });
      }
    }

    const updates = [
      this.e1(t), this.e2(t), this.e3(t), this.e4(t), this.e5(t), this.e6(t),
      this.e7(t), this.e8(t), this.e9(t), this.e10(t), this.e11(t),
    ];
    for (const update of updates) {
      if (!update) continue;
      if (update.remove) {
        this.entities.delete(update.id);
        this.cot.delete(`entity:${update.id}`);
        removals.push({ kind: "entity", id: update.id, reason: update.remove });
      } else if (update.entity) {
        const previous = this.entities.get(update.id);
        this.entities.set(update.id, update.entity);
        upserts.push(update.entity);
        // A split or an unmerge explains an entity's appearance itself.
        if (!previous && !update.explained) {
          events.push({ kind: "entity_created", t, objects: [{ kind: "entity", id: update.id }], reason: update.createdReason ?? "First fix." });
        }
      }
      events.push(...(update.events ?? []));
    }

    const group = this.g1(t);
    const groupUpserts: Group[] = [];
    if (group?.upsert) {
      this.groups.set(group.upsert.group_id, group.upsert);
      groupUpserts.push(group.upsert);
    }
    if (group?.remove) {
      this.groups.delete("G1");
      this.cot.delete("group:G1");
      removals.push({ kind: "group", id: "G1", reason: group.remove });
    }
    events.push(...(group?.events ?? []));

    if (upserts.length || removals.length || events.length || sensorUpserts.length || groupUpserts.length) {
      const delta: DeltaMessage = { ...this.envelope("delta"), t };
      if (upserts.length || sensorUpserts.length || groupUpserts.length) {
        delta.upsert = {};
        if (upserts.length) delta.upsert.entities = upserts;
        if (groupUpserts.length) delta.upsert.groups = groupUpserts;
        if (sensorUpserts.length) delta.upsert.sensors = sensorUpserts;
      }
      if (removals.length) delta.remove = removals;
      if (events.length) delta.events = events;
      messages.push(delta);
    }
    for (const notice of notices) messages.push({ ...notice, seq: ++this.seq });

    // CoT: rebuilt on every republish interval, and immediately when an entity first
    // becomes publishable.
    for (const entity of upserts) {
      const previous = this.cot.get(`entity:${entity.entity_id}`);
      const due = this.tS % COT_REPUBLISH_S === 0;
      const becamePublishable = entity.state === "confirmed" && previous?.disposition.status === "withheld";
      if (!previous || due || becamePublishable) messages.push(this.cotMessage(entity, t));
    }
    if (this.tS % 30 === 0) {
      for (const sensor of this.sensors.values()) messages.push(this.sensorCotMessage(sensor, t));
    }
    // Vigilans has not decided how a group looks in CoT (Vigilans 11.2), so it builds none
    // and says so, rather than inventing a representation.
    if (group?.events?.length && group.upsert) messages.push(this.groupCotMessage(group.upsert, t));

    // Deliberate faults, for exercising diagnostics and resync. Off unless asked for.
    if (this.faults.has("malformed") && this.tS % 40 === 20) messages.push(this.malformed(t));
    if (this.faults.has("gap") && this.tS % 50 === 35) this.seq += 1;

    return messages;
  }

  /** Messages at picture time zero: the opening notice and the sensors. */
  private start(): PictureMessage[] {
    const t = this.time(0);
    for (const def of SENSORS) {
      this.sensors.set(def.id, {
        sensor_id: def.id,
        source_id: "SRC-A",
        label: def.id,
        position: pos(def.point),
        last_heard: t,
        health: "reporting",
        affiliation: { identity: "friend", basis: "operator", reasons: ["Own sensor, declared in the operator configuration."] },
        symbol: { sidc: "SFGPES---------" },
      });
    }
    const messages: PictureMessage[] = [
      {
        ...this.envelope("notice"),
        t,
        severity: "info",
        code: "synthetic",
        text: `Synthetic scenario "${SCENARIO_NAME}" from the Videns mock feed. Simulated data, not a real picture.`,
      },
      { ...this.envelope("delta"), t, upsert: { sensors: [...this.sensors.values()] } },
    ];
    for (const sensor of this.sensors.values()) messages.push(this.sensorCotMessage(sensor, t));
    return messages;
  }

  /** A notice whose seq is assigned when it is emitted, after the delta it follows. */
  private envelopeLater(type: "notice") {
    return { schema: "picture.v0" as const, type, run_id: this.runId, seq: 0 };
  }

  private cotMessage(entity: Entity, t: string): PictureMessage {
    const events = emitterEvents(entity, t, NAMESPACE, COT_STALE_S);
    const record: CotRecord =
      entity.state === "tentative"
        ? {
            object: { kind: "entity", id: entity.entity_id },
            built_t: t,
            events,
            disposition: {
              status: "withheld",
              reason_code: "below_threshold",
              reason: "Tentative entities are not published until confirmed by further fixes.",
            },
          }
        : {
            object: { kind: "entity", id: entity.entity_id },
            built_t: t,
            events,
            disposition: { status: "published", destinations: DESTINATIONS },
          };
    this.cot.set(`entity:${entity.entity_id}`, record);
    return { ...this.envelope("cot"), t, record };
  }

  private sensorCotMessage(sensor: Sensor, t: string): PictureMessage {
    const record: CotRecord = {
      object: { kind: "sensor", id: sensor.sensor_id },
      built_t: t,
      events: sensorEvents(sensor, t, NAMESPACE, 120),
      disposition: { status: "published", destinations: DESTINATIONS },
    };
    this.cot.set(`sensor:${sensor.sensor_id}`, record);
    return { ...this.envelope("cot"), t, record };
  }

  private malformed(t: string): PictureMessage {
    // An unreported uncertainty that nonetheless carries an ellipse: exactly the kind of
    // invented number the contract exists to refuse.
    const bad = {
      ...this.envelope("delta"),
      t,
      upsert: {
        entities: [
          {
            ...(this.entities.get("E3") ?? this.entities.values().next().value),
            position_uncertainty: {
              basis: "unreported",
              ellipse: { semi_major_m: 100, semi_minor_m: 100, orientation_deg: 0, confidence: 0.95 },
            },
          },
        ],
      },
    };
    return bad as unknown as PictureMessage;
  }

  // --- Bearings ------------------------------------------------------------------------

  private bearings(entityId: string, truth: GeoPoint, sigmaDeg: number, t: string) {
    const rng = this.rng(`${entityId}.bearings`);
    const fix = this.fixCounts.get(entityId) ?? 0;
    return SENSORS.filter((s) => this.sensors.get(s.id)?.health === "reporting").map((s) => {
      const azimuth = geodesicInverse(s.point.lat, s.point.lon, truth.lat, truth.lon).azimuthDeg;
      return {
        observation_id: `${entityId}-${s.id}-${fix}`,
        source_id: "SRC-A",
        sensor_id: s.id,
        sensor_position: pos(s.point),
        bearing_deg: round(norm360(azimuth + rng.gauss() * sigmaDeg), 3),
        bearing_uncertainty: { basis: "measured" as const, sigma_deg: sigmaDeg },
        t,
        weight: round(1 / (sigmaDeg * sigmaDeg), 4),
      };
    });
  }

  private countFix(id: string): number {
    const n = (this.fixCounts.get(id) ?? 0) + 1;
    this.fixCounts.set(id, n);
    return n;
  }

  // --- Emitters ------------------------------------------------------------------------

  private e1(t: string): Update | undefined {
    const id = "E1";
    if (this.tS % 3 !== 0 && this.entities.has(id)) return undefined;
    const truth = at(30, 2500);
    const n = this.countFix(id);
    const a = 60 + 600 / Math.sqrt(n);
    const b = a * 0.45;
    const orientation = 20 + 10 * Math.sin(this.tS / 40);
    const [de, dn] = sampleOffset(this.rng(`${id}.fix`), a, b, orientation);
    const previous = this.entities.get(id);
    const suspect = this.tS >= 120;
    const events: LifecycleEvent[] = [];
    if (suspect && previous?.affiliation.identity === "unknown") {
      events.push({
        kind: "affiliation_changed",
        t,
        objects: [{ kind: "entity", id }],
        reason: "Classified as syn.alpha, which the synthetic library declares suspect.",
      });
    }
    const classified = this.tS >= 30;
    const entity: Entity = {
      entity_id: id,
      state: this.tS < 12 ? "tentative" : "confirmed",
      affiliation: suspect
        ? { identity: "suspect", basis: "library", reasons: ["Library class syn.alpha declares 'suspect' for this class."] }
        : { identity: "unknown", basis: "default", reasons: [] },
      symbol: { sidc: suspect ? "SSGP-----------" : "SUGP-----------" },
      position: pos(offset(truth, de, dn)),
      position_uncertainty: { basis: "measured", cov_en_m2: roundCov(covariance(a, b, orientation)) },
      freq_hz: 400_125_000,
      bandwidth_hz: 12_500,
      first_seen: previous?.first_seen ?? t,
      last_seen: t,
      sources: [{ source_id: "SRC-A", observations: n * 3 }],
      classification: classified
        ? {
            status: "classified",
            candidates: [
              {
                class: "syn.alpha",
                confidence: this.tS >= 90 ? 0.62 : 0.55,
                wording: "Possible synthetic class Alpha emitter",
                reasons: ["Channel and bandwidth consistent with synthetic class Alpha.", "Duty cycle 0.18, within the class range."],
              },
            ],
          }
        : { status: "unclassified", reason: "Fewer than five transmissions observed; not enough to compare with the library." },
      library: LIBRARY,
      fix_evidence: { bearings: this.bearings(id, truth, 2, t) },
    };
    return { id, entity, events, createdReason: "Bearings from three sensors intersect." };
  }

  private e2(t: string): Update | undefined {
    const id = "E2";
    if (this.tS < 5 || (this.tS % 2 !== 0 && this.entities.has(id))) return undefined;
    const omegaDegPerS = ((12 / 5000) * 180) / Math.PI;
    const around = 200 + omegaDegPerS * (this.tS - 5);
    const truth = at(around, 5000);
    const heading = norm360(around + 90);
    const n = this.countFix(id);
    const semiMajor = 220;
    const semiMinor = 80;
    const k = Math.sqrt(-2 * Math.log(1 - 0.95));
    const [de, dn] = sampleOffset(this.rng(`${id}.fix`), semiMajor / k, semiMinor / k, heading);
    const estimate = offset(truth, de, dn);
    const previous = this.entities.get(id);
    const trail = [...(previous?.trail ?? []), { t, ...pos(estimate) }].slice(-TRAIL_LIMIT);
    const rad = (heading * Math.PI) / 180;
    const entity: Entity = {
      entity_id: id,
      state: this.tS < 15 ? "tentative" : "confirmed",
      affiliation: { identity: "hostile", basis: "library", reasons: ["Library class syn.bravo declares 'hostile' for this class."] },
      symbol: { sidc: "SHGP-----------" },
      position: pos(estimate),
      position_uncertainty: {
        basis: "measured",
        ellipse: { semi_major_m: semiMajor, semi_minor_m: semiMinor, orientation_deg: round(heading % 180, 3), confidence: 0.95 },
      },
      velocity: { east_mps: round(12 * Math.sin(rad), 3), north_mps: round(12 * Math.cos(rad), 3) },
      freq_hz: 402_500_000,
      bandwidth_hz: 25_000,
      first_seen: previous?.first_seen ?? t,
      last_seen: t,
      sources: [{ source_id: "SRC-A", observations: n * 3 }],
      classification: {
        status: "classified",
        candidates: [
          {
            class: "syn.bravo",
            confidence: 0.7,
            wording: "Likely synthetic class Bravo emitter",
            reasons: ["Hop pattern consistent with synthetic class Bravo.", "Moving at about 12 m/s."],
          },
        ],
      },
      library: LIBRARY,
      fix_evidence: { bearings: this.bearings(id, truth, 3, t) },
      trail,
    };
    return { id, entity, createdReason: "Bearings from three sensors intersect; moving." };
  }

  private e3(t: string): Update | undefined {
    const id = "E3";
    if (this.tS < 20 || (this.tS % 5 !== 0 && this.entities.has(id))) return undefined;
    const truth = at(300, 6000);
    const rng = this.rng(`${id}.report`);
    const reported = offset(truth, rng.gauss() * 80, rng.gauss() * 80);
    const n = this.countFix(id);
    const previous = this.entities.get(id);
    const unreported: PositionUncertainty = { basis: "unreported" };
    const entity: Entity = {
      entity_id: id,
      state: this.tS < 25 ? "tentative" : "confirmed",
      affiliation: { identity: "unknown", basis: "default", reasons: [] },
      symbol: { sidc: "SUGP-----------" },
      position: pos(reported),
      position_uncertainty: unreported,
      freq_hz: 406_750_000,
      bandwidth_hz: 6_250,
      first_seen: previous?.first_seen ?? t,
      last_seen: t,
      sources: [{ source_id: "SRC-B", observations: n }],
      classification: { status: "unclassified", reason: "Source SRC-B reports no emission timing; not enough to classify." },
      library: LIBRARY,
      fix_evidence: {
        positions: [{ observation_id: `${id}-SRC-B-${n}`, source_id: "SRC-B", position: pos(reported), uncertainty: unreported, t }],
      },
    };
    return { id, entity, createdReason: "Position reported by SRC-B, which states no uncertainty." };
  }

  private e4(t: string): Update | undefined {
    const id = "E4";
    if (this.tS % 5 !== 0 && this.entities.has(id)) return undefined;
    const truth = at(120, 4000);
    const rng = this.rng(`${id}.report`);
    const reported = offset(truth, rng.gauss() * 150, rng.gauss() * 150);
    const n = this.countFix(id);
    const previous = this.entities.get(id);
    const uncertainty: PositionUncertainty = {
      basis: "assumed",
      ellipse: { semi_major_m: 150, semi_minor_m: 150, orientation_deg: 0, confidence: round(ONE_SIGMA_2D, 6) },
      assumption: {
        declared_by: "Operator configuration for source SRC-C",
        note: "SRC-C does not report uncertainty; 150 m 1-sigma is assumed for every SRC-C position.",
      },
    };
    const entity: Entity = {
      entity_id: id,
      state: "confirmed",
      affiliation: { identity: "friend", basis: "operator", reasons: ["Operator configuration declares this an own-force training emitter."] },
      symbol: { sidc: "SFGP-----------" },
      position: pos(reported),
      position_uncertainty: uncertainty,
      freq_hz: 409_000_000,
      bandwidth_hz: 12_500,
      first_seen: previous?.first_seen ?? t,
      last_seen: t,
      sources: [{ source_id: "SRC-C", observations: n }],
      classification: {
        status: "classified",
        candidates: [
          {
            class: "syn.charlie",
            confidence: 0.8,
            wording: "Likely synthetic class Charlie emitter",
            reasons: ["Channel matches the operator-declared synthetic class Charlie."],
          },
        ],
      },
      library: LIBRARY,
      fix_evidence: {
        positions: [{ observation_id: `${id}-SRC-C-${n}`, source_id: "SRC-C", position: pos(reported), uncertainty, t }],
      },
    };
    return { id, entity, createdReason: "Position reported by SRC-C with an operator-assumed uncertainty." };
  }

  private e5(t: string): Update | undefined {
    const id = "E5";
    if (this.tS < 60) return undefined;
    if (this.tS === 200) return { id, remove: "Not heard for 50 s; retired.", events: [{ kind: "entity_retired", t, objects: [{ kind: "entity", id }], reason: "Not heard for 50 s." }] };
    if (this.tS > 200) return undefined;
    const coasting = this.tS >= 150;
    if (!coasting && this.tS % 2 !== 0 && this.entities.has(id)) return undefined;
    if (coasting && this.tS % 5 !== 0) return undefined;
    const start = at(250, 9000);
    const heading = 60;
    const speed = 40;
    const truth = geodesicDirect(start.lat, start.lon, heading, speed * (this.tS - 60));
    const previous = this.entities.get(id);
    const n = coasting ? (this.fixCounts.get(id) ?? 0) : this.countFix(id);
    const lastHeard = coasting ? previous!.last_seen : t;
    const sinceHeard = coasting ? this.tS - 150 : 0;
    const a = 180 + speed * sinceHeard;
    const b = 120 + 0.3 * speed * sinceHeard;
    const [de, dn] = coasting ? [0, 0] : sampleOffset(this.rng(`${id}.fix`), a, b, heading);
    const position = coasting ? geodesicDirect(previous!.position!.lat, previous!.position!.lon, heading, speed * 5) : offset(truth, de, dn);
    const rad = (heading * Math.PI) / 180;
    const entity: Entity = {
      entity_id: id,
      state: coasting ? "coasting" : this.tS < 66 ? "tentative" : "confirmed",
      affiliation: { identity: "suspect", basis: "library", reasons: ["Library class syn.delta declares 'suspect' for this class."] },
      symbol: { sidc: "SSAP-----------" },
      position: pos(position),
      position_uncertainty: {
        basis: "mixed",
        cov_en_m2: roundCov(covariance(a, b, heading)),
        mixture: { measured: 2 * n, assumed: 0, unreported: n },
      },
      velocity: { east_mps: round(speed * Math.sin(rad), 3), north_mps: round(speed * Math.cos(rad), 3) },
      freq_hz: 412_250_000,
      bandwidth_hz: 50_000,
      first_seen: previous?.first_seen ?? t,
      last_seen: lastHeard,
      sources: [
        { source_id: "SRC-A", observations: 2 * n },
        { source_id: "SRC-B", observations: n },
      ],
      classification: {
        status: "classified",
        candidates: [
          {
            class: "syn.delta",
            confidence: 0.45,
            wording: "Possible synthetic class Delta emitter",
            reasons: ["Bandwidth consistent with synthetic class Delta.", "Moving at about 40 m/s, consistent with an airborne emitter."],
          },
        ],
      },
      library: LIBRARY,
      ...(coasting ? {} : { fix_evidence: { bearings: this.bearings(id, truth, 2.5, t) } }),
    };
    return { id, entity, createdReason: "Bearings from SRC-A and a position from SRC-B agree." };
  }

  private e6(t: string): Update | undefined {
    const id = "E6";
    if (this.tS % 10 !== 0 && this.entities.has(id)) return undefined;
    const truth = at(90, 11000);
    const n = this.countFix(id);
    const a = 90 + 400 / Math.sqrt(n);
    const [de, dn] = sampleOffset(this.rng(`${id}.fix`), a, a * 0.7, 95);
    const previous = this.entities.get(id);
    const entity: Entity = {
      entity_id: id,
      state: "confirmed",
      affiliation: { identity: "neutral", basis: "operator", reasons: ["Operator configuration declares this a civil broadcast emitter."] },
      symbol: { sidc: "SNGP-----------" },
      position: pos(offset(truth, de, dn)),
      position_uncertainty: { basis: "measured", cov_en_m2: roundCov(covariance(a, a * 0.7, 95)) },
      freq_hz: 415_000_000,
      bandwidth_hz: 200_000,
      first_seen: previous?.first_seen ?? t,
      last_seen: t,
      sources: [{ source_id: "SRC-A", observations: n * 3 }],
      classification: { status: "unclassified", reason: "No synthetic library class covers this channel." },
      library: LIBRARY,
      fix_evidence: { bearings: this.bearings(id, truth, 2, t) },
    };
    return { id, entity, createdReason: "Bearings from three sensors intersect." };
  }

  /** A static emitter located from bearings, with a measured covariance that tightens. */
  private bearingEntity(id: string, t: string, truth: GeoPoint, o: BearingEntityOptions): Entity {
    const heard = o.heard ?? true;
    const previous = this.entities.get(id);
    const n = heard ? this.countFix(id) : (this.fixCounts.get(id) ?? 1);
    const a = o.floorM + o.spreadM / Math.sqrt(n);
    const b = a * o.aspect;
    const [de, dn] = heard ? sampleOffset(this.rng(`${id}.fix`), a, b, o.orientation) : [0, 0];
    return {
      entity_id: id,
      state: o.state,
      affiliation: o.affiliation,
      symbol: { sidc: o.sidc },
      position: heard || !previous?.position ? pos(offset(truth, de, dn)) : previous.position,
      position_uncertainty: { basis: "measured", cov_en_m2: roundCov(covariance(a, b, o.orientation)) },
      freq_hz: o.freqHz,
      bandwidth_hz: o.bandwidthHz,
      first_seen: previous?.first_seen ?? t,
      last_seen: heard ? t : (previous?.last_seen ?? t),
      sources: o.sources ?? [{ source_id: "SRC-A", observations: n * 3 }],
      classification: o.classification,
      library: LIBRARY,
      ...(heard ? { fix_evidence: { bearings: this.bearings(id, truth, 2, t) } } : {}),
      ...(o.lineage ? { lineage: o.lineage } : {}),
    };
  }

  private e7(t: string): Update | undefined {
    const id = "E7";
    if (this.tS < 90) return undefined;
    const heard = this.tS < 225;
    if (!heard && this.entities.get(id)?.state === "coasting") return undefined;
    if (this.tS % 5 !== 0 && this.entities.has(id)) return undefined;
    const entity = this.bearingEntity(id, t, truthOf.X7(), {
      heard,
      state: !heard ? "coasting" : this.tS < 100 ? "tentative" : "confirmed",
      affiliation: { identity: "hostile", basis: "library", reasons: ["Library class syn.echo declares 'hostile' for this class."] },
      sidc: "SHGP-----------",
      floorM: 70,
      spreadM: 500,
      aspect: 0.5,
      orientation: 150,
      freqHz: 399_500_000,
      bandwidthHz: 12_500,
      classification: {
        status: "classified",
        candidates: [
          {
            class: "syn.echo",
            confidence: 0.5,
            wording: "Possible synthetic class Echo emitter",
            reasons: ["Short control bursts consistent with synthetic class Echo.", "Usually transmits first in exchanges with E2."],
          },
        ],
      },
    });
    return { id, entity, createdReason: "Bearings from three sensors intersect." };
  }

  private e8(t: string): Update | undefined {
    const id = "E8";
    if (this.tS < 150) return undefined;
    const merged = this.tS >= 175 && this.tS < 235;
    const forced = this.tS === 175 || this.tS === 235;
    if (!forced && this.tS % 3 !== 0 && this.entities.has(id)) return undefined;
    const n = this.fixCounts.get(id) ?? 0;
    const entity = this.bearingEntity(id, t, truthOf.X8(), {
      state: this.tS < 158 ? "tentative" : "confirmed",
      affiliation: { identity: "unknown", basis: "default", reasons: [] },
      sidc: "SUGP-----------",
      floorM: 80,
      spreadM: 450,
      aspect: 0.55,
      orientation: 70,
      freqHz: 418_000_000,
      bandwidthHz: 12_500,
      classification: { status: "unclassified", reason: "Fewer than five transmissions observed; not enough to compare with the library." },
      sources: merged
        ? [
            { source_id: "SRC-A", observations: (n + 1) * 3 },
            { source_id: "SRC-B", observations: Math.floor((this.tS - 150) / 5) },
          ]
        : undefined,
      lineage: merged ? { merged_from: ["E9"], merge_confidence: 0.62 } : undefined,
    });
    return { id, entity, createdReason: "Bearings from three sensors intersect." };
  }

  private e9(t: string): Update | undefined {
    const id = "E9";
    if (this.tS < 152) return undefined;
    const refs = [
      { kind: "entity" as const, id: "E8" },
      { kind: "entity" as const, id: "E9" },
    ];
    if (this.tS === 175) {
      return {
        id,
        remove: "Merged into E8.",
        events: [
          {
            kind: "merged",
            t,
            objects: refs,
            from: ["E8", "E9"],
            into: ["E8"],
            reason: "Position and frequency consistent within both sources' stated uncertainties: taken to be one emitter (0.62).",
          },
        ],
      };
    }
    if (this.tS > 175 && this.tS < 235) return undefined;
    const reappearing = this.tS === 235;
    if (!reappearing && this.tS % 5 !== 0 && this.entities.has(id)) return undefined;
    const rng = this.rng(`${id}.report`);
    const reported = offset(truthOf.X9(), rng.gauss() * 60, rng.gauss() * 60);
    const n = this.countFix(id);
    const previous = this.entities.get(id);
    const unreported: PositionUncertainty = { basis: "unreported" };
    const entity: Entity = {
      entity_id: id,
      state: "confirmed",
      affiliation: { identity: "unknown", basis: "default", reasons: [] },
      symbol: { sidc: "SUGP-----------" },
      position: pos(reported),
      position_uncertainty: unreported,
      freq_hz: 418_003_000,
      bandwidth_hz: 12_500,
      first_seen: previous?.first_seen ?? t,
      last_seen: t,
      sources: [{ source_id: "SRC-B", observations: n }],
      classification: { status: "unclassified", reason: "Source SRC-B reports no emission timing; not enough to classify." },
      library: LIBRARY,
      fix_evidence: { positions: [{ observation_id: `${id}-SRC-B-${n}`, source_id: "SRC-B", position: pos(reported), uncertainty: unreported, t }] },
    };
    return {
      id,
      entity,
      explained: reappearing,
      createdReason: "Position reported by SRC-B, which states no uncertainty.",
      events: reappearing
        ? [
            {
              kind: "unmerged",
              t,
              objects: refs,
              from: ["E8"],
              into: ["E8", "E9"],
              reason: "Frequencies diverged by 3 kHz over 60 s, beyond both sources' stated tolerances: two emitters, not one.",
            },
          ]
        : undefined,
    };
  }

  private e10(t: string): Update | undefined {
    const id = "E10";
    if (this.tS < 250 || (this.tS % 10 !== 0 && this.entities.has(id))) return undefined;
    const splitting = !this.entities.has(id);
    const entity = this.bearingEntity(id, t, truthOf.X10(), {
      state: "confirmed",
      affiliation: { identity: "unknown", basis: "default", reasons: [] },
      sidc: "SUGP-----------",
      floorM: 120,
      spreadM: 400,
      aspect: 0.6,
      orientation: 100,
      freqHz: 415_000_000,
      bandwidthHz: 25_000,
      classification: { status: "unclassified", reason: "No synthetic library class covers this channel." },
      lineage: { split_from: "E6" },
    });
    return {
      id,
      entity,
      explained: splitting,
      events: splitting
        ? [
            {
              kind: "split",
              t,
              objects: [
                { kind: "entity", id: "E6" },
                { kind: "entity", id: "E10" },
              ],
              from: ["E6"],
              into: ["E6", "E10"],
              reason: "A second emitter on E6's channel resolved: bearings from S1 and S2 have disagreed by 4 degrees consistently for 40 s.",
            },
          ]
        : undefined,
    };
  }

  /** The negative control: beside E4 all run, unrelated, and never grouped with it. */
  private e11(t: string): Update | undefined {
    const id = "E11";
    if (this.tS % 10 !== 0 && this.entities.has(id)) return undefined;
    const entity = this.bearingEntity(id, t, truthOf.X11(), {
      state: "confirmed",
      affiliation: { identity: "unknown", basis: "default", reasons: [] },
      sidc: "SUGP-----------",
      floorM: 90,
      spreadM: 350,
      aspect: 0.6,
      orientation: 40,
      freqHz: 431_500_000,
      bandwidthHz: 12_500,
      classification: { status: "unclassified", reason: "No synthetic library class covers this channel." },
    });
    return { id, entity, createdReason: "Bearings from three sensors intersect." };
  }

  private g1(t: string): { upsert?: Group; remove?: string; events?: LifecycleEvent[] } | undefined {
    if (this.tS < 110 || this.tS > 270) return undefined;
    const objects = [
      { kind: "group" as const, id: "G1" },
      { kind: "entity" as const, id: "E7" },
      { kind: "entity" as const, id: "E2" },
    ];
    if (this.tS === 270) {
      return {
        remove: "No coupling evidence for 45 s; retired.",
        events: [{ kind: "group_retired", t, objects, reason: "E7 has not been heard since 225 s; no coupling evidence for 45 s." }],
      };
    }
    const state = this.tS < 140 ? "hypothesis" : this.tS < 230 ? "published" : "decaying";
    const changed = this.groups.get("G1")?.state !== state;
    if (!changed && this.tS % 10 !== 0) return undefined;
    const confidence = state === "hypothesis" ? 0.3 : state === "published" ? 0.55 : round(0.55 - 0.004 * (this.tS - 230), 3);
    const group: Group = {
      group_id: "G1",
      kind: "controller/controlled",
      members: [
        { entity_id: "E7", role: "controller" },
        { entity_id: "E2", role: "controlled" },
      ],
      confidence,
      member_identity_bound: 0.7,
      evidence: [
        { type: "temporal_coupling", summary: "E2 transmits within 1.5 s of E7 in 14 of 16 of E7's transmissions.", value: 0.875 },
        { type: "channel_pairing", summary: "E2's channel stays 3 MHz above E7's across 9 channel changes.", value: 3_000_000 },
      ],
      state,
      limitations: [
        "Which entity directs the other rests on weak behavioural asymmetry (E7 usually transmits first); externals alone cannot establish it.",
        "Coupling over 16 exchanges could still be coincidence in a busy band.",
      ],
    };
    const reasons = {
      hypothesis: ["group_formed", "Temporal coupling between E7 and E2 above the hypothesis threshold."],
      published: ["group_published", "Coupling sustained for 30 s and channel pairing observed: above the publication threshold."],
      decaying: ["group_decaying", "E7 has not been heard since 225 s; the coupling evidence is ageing."],
    } as const;
    const [kind, reason] = reasons[state];
    return { upsert: group, events: changed ? [{ kind, t, objects, reason }] : [] };
  }

  private groupCotMessage(group: Group, t: string): PictureMessage {
    const record: CotRecord = {
      object: { kind: "group", id: group.group_id },
      built_t: t,
      events: [],
      disposition: {
        status: "withheld",
        reason_code: "no_representation",
        reason: "No CoT representation for groups has been decided (Vigilans 11.2), so none was built.",
      },
    };
    this.cot.set(`group:${group.group_id}`, record);
    return { ...this.envelope("cot"), t, record };
  }

  /**
   * Where the simulator put every emitter now: truth.v0, a separate channel. The engine
   * never sees this, and the picture never carries it (VIDENS_SPEC.md 8.7).
   */
  truth(): TruthFrame {
    const s = this.tS;
    const emitters: TruthEmitter[] = [];
    const add = (emitter_id: string, p: GeoPoint, active: boolean, entity_id: string) =>
      emitters.push({ emitter_id, ...pos(p), active, entity_id });
    if (s >= 1) add("X1", truthOf.X1(), true, "E1");
    if (s >= 5) add("X2", truthOf.X2(s), true, "E2");
    if (s >= 20) add("X3", truthOf.X3(), true, "E3");
    add("X4", truthOf.X4(), true, "E4");
    if (s >= 60) add("X5", truthOf.X5(s), s < 150, "E5");
    add("X6", truthOf.X6(), true, "E6");
    if (s >= 90) add("X7", truthOf.X7(), s < 225, "E7");
    if (s >= 150) add("X8", truthOf.X8(), true, "E8");
    if (s >= 152) add("X9", truthOf.X9(), true, "E9");
    if (s >= 200) add("X10", truthOf.X10(), true, "E10");
    add("X11", truthOf.X11(), true, "E11");
    return { schema: "truth.v0", type: "truth", run_id: this.runId, t: this.time(), emitters };
  }
}

interface BearingEntityOptions {
  heard?: boolean;
  state: Entity["state"];
  affiliation: Entity["affiliation"];
  sidc: string;
  floorM: number;
  spreadM: number;
  aspect: number;
  orientation: number;
  freqHz: number;
  bandwidthHz: number;
  classification: Entity["classification"];
  sources?: Entity["sources"];
  lineage?: Entity["lineage"];
}

/** True emitter positions: the simulator's, never the picture's. */
const truthOf = {
  X1: () => at(30, 2500),
  X2: (s: number) => at(200 + (((12 / 5000) * 180) / Math.PI) * (s - 5), 5000),
  X3: () => at(300, 6000),
  X4: () => at(120, 4000),
  X5: (s: number) => {
    const start = at(250, 9000);
    return geodesicDirect(start.lat, start.lon, 60, 40 * (s - 60));
  },
  X6: () => at(90, 11000),
  X7: () => at(170, 3000),
  X8: () => at(60, 7500),
  X9: () => offset(at(60, 7500), 120, 60),
  X10: () => at(92, 11600),
  X11: () => offset(at(120, 4000), 200, -150),
};

interface Update {
  id: string;
  entity?: Entity;
  remove?: string;
  events?: LifecycleEvent[];
  createdReason?: string;
  /** Its appearance is explained by an event in the same update (a split, an unmerge). */
  explained?: boolean;
}

function roundCov(c: { ee: number; en: number; nn: number }) {
  return { ee: round(c.ee, 3), en: round(c.en, 3), nn: round(c.nn, 3) };
}
