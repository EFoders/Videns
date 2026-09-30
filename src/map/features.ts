// The picture as GeoJSON for MapLibre. Pure apart from the ring cache: the same state and
// settings always give the same features. Every line here is a geodesic (rule 4).

import type { Feature, FeatureCollection, GeoJsonProperties, LineString, Point, Polygon } from "geojson";

import type { Entity, Group, ObjectRef } from "../contract/generated/picture.ts";
import type { TruthFrame } from "../contract/generated/truth.ts";
import { drawableEllipse, ellipseRing } from "../geo/ellipse.ts";
import { geodesicInverse } from "../geo/geodesic.ts";
import { bearingWedge, geodesicBetween, geodesicLine } from "../geo/lines.ts";
import type { PictureState } from "../store/picture.ts";
import { entityIcon, iconKey, labelKey, sensorIcon, TRUTH_ICON } from "./symbols.ts";

type FC<G extends LineString | Point | Polygon, P = GeoJsonProperties> = FeatureCollection<G, P>;
const collection = <G extends LineString | Point | Polygon, P>(features: Feature<G, P>[]): FC<G, P> => ({ type: "FeatureCollection", features });

export interface PointProps {
  kind: "entity" | "sensor";
  id: string;
  icon: string;
  opacity: number;
  sort: number;
}

export interface RegionProps {
  kind: "entity";
  id: string;
  basis: "measured" | "assumed" | "mixed";
  selected: boolean;
  dim: boolean;
}

const STATE_OPACITY: Readonly<Record<Entity["state"], number>> = {
  confirmed: 1,
  tentative: 0.7,
  coasting: 0.45,
  retired: 0.3,
};

/** Selecting a group dims everything that is not one of its members (spec 8.4). */
const DIMMED = 0.3;

function groupMembers(state: PictureState, selection: ObjectRef | null): Set<string> | null {
  if (selection?.kind !== "group") return null;
  const group = state.groups.get(selection.id);
  return group ? new Set(group.members.map((m) => m.entity_id)) : null;
}

export function pointFeatures(state: PictureState, selection: ObjectRef | null = null): FC<Point, PointProps> {
  const members = groupMembers(state, selection);
  const features: Feature<Point, PointProps>[] = [];
  for (const sensor of state.sensors.values()) {
    if (!sensor.position) continue;
    features.push({
      type: "Feature",
      id: `sensor:${sensor.sensor_id}`,
      geometry: { type: "Point", coordinates: [sensor.position.lon, sensor.position.lat] },
      properties: {
        kind: "sensor",
        id: sensor.sensor_id,
        icon: iconKey(sensorIcon(sensor)),
        opacity: (sensor.health === "reporting" ? 0.9 : 0.45) * (members ? DIMMED : 1),
        sort: 0,
      },
    });
  }
  for (const entity of state.entities.values()) {
    if (!entity.position) continue;
    features.push({
      type: "Feature",
      id: `entity:${entity.entity_id}`,
      geometry: { type: "Point", coordinates: [entity.position.lon, entity.position.lat] },
      properties: {
        kind: "entity",
        id: entity.entity_id,
        icon: iconKey(entityIcon(entity)),
        opacity: STATE_OPACITY[entity.state] * (members && !members.has(entity.entity_id) ? DIMMED : 1),
        sort: entity.state === "confirmed" ? 2 : 1,
      },
    });
  }
  return collection(features);
}

type Ring = [number, number][];

/** Rings keyed by what they depend on, so an unchanged entity is not re-traced every message. */
export class RingCache {
  private readonly rings = new Map<string, { key: string; ring: Ring | null }>();

  ring(entity: Entity, confidence: number): Ring | null {
    const key = JSON.stringify([entity.position, entity.position_uncertainty, confidence]);
    const cached = this.rings.get(entity.entity_id);
    if (cached?.key === key) return cached.ring;
    const axes = entity.position && entity.position_uncertainty ? drawableEllipse(entity.position_uncertainty, confidence) : undefined;
    const ring = axes && entity.position ? ellipseRing(entity.position.lat, entity.position.lon, axes) : null;
    this.rings.set(entity.entity_id, { key, ring });
    return ring;
  }

  prune(live: Set<string>): void {
    for (const id of this.rings.keys()) if (!live.has(id)) this.rings.delete(id);
  }
}

export function regionFeatures(state: PictureState, confidence: number, selection: ObjectRef | null, cache: RingCache): FC<Polygon, RegionProps> {
  const members = groupMembers(state, selection);
  const features: Feature<Polygon, RegionProps>[] = [];
  for (const entity of state.entities.values()) {
    const basis = entity.position_uncertainty?.basis;
    // Unreported: nothing to draw, by rule. The symbol carries a "?" instead.
    if (!basis || basis === "unreported") continue;
    const ring = cache.ring(entity, confidence);
    if (!ring) continue;
    features.push({
      type: "Feature",
      id: `region:${entity.entity_id}`,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        kind: "entity",
        id: entity.entity_id,
        basis,
        selected: (selection?.kind === "entity" && selection.id === entity.entity_id) || Boolean(members?.has(entity.entity_id)),
        dim: Boolean(members && !members.has(entity.entity_id)),
      },
    });
  }
  cache.prune(new Set(state.entities.keys()));
  return collection(features);
}

/** Rings around what is selected: the object itself, or every member of a selected group. */
export function selectionFeatures(state: PictureState, selection: ObjectRef | null): FC<Point> {
  const at = (p: { lat: number; lon: number } | undefined): Feature<Point>[] =>
    p ? [{ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: {} }] : [];
  if (!selection) return collection([]);
  if (selection.kind === "group") {
    const group = state.groups.get(selection.id);
    return collection(group ? group.members.flatMap((m) => at(state.entities.get(m.entity_id)?.position)) : []);
  }
  if (selection.kind === "sensor") return collection(at(state.sensors.get(selection.id)?.position));
  return collection(at(state.entities.get(selection.id)?.position ?? state.departed.get(selection.id)?.entity.position));
}

// --- Trails ------------------------------------------------------------------------------

export function trailFeatures(state: PictureState): FC<LineString, { id: string }> {
  const features: Feature<LineString, { id: string }>[] = [];
  for (const entity of state.entities.values()) {
    const points = entity.trail ?? [];
    if (points.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) },
      properties: { id: entity.entity_id },
    });
  }
  return collection(features);
}

// --- Evidence ----------------------------------------------------------------------------

export interface EvidenceFeatures {
  bearings: FC<LineString, { id: string; basis: string }>;
  wedges: FC<Polygon, { id: string; basis: string }>;
  reported: FC<Point, { id: string; source: string; basis: string }>;
  links: FC<LineString, { id: string }>;
}

const MIN_BEARING_M = 1_000;
const DEFAULT_BEARING_M = 15_000;

/** Lines of bearing and reported positions behind each fix, for the entities chosen. */
export function evidenceFeatures(state: PictureState, mode: "selected" | "all" | "off", selection: ObjectRef | null): EvidenceFeatures {
  const out: EvidenceFeatures = { bearings: collection([]), wedges: collection([]), reported: collection([]), links: collection([]) };
  if (mode === "off") return out;
  const chosen =
    mode === "all"
      ? [...state.entities.values()]
      : selection?.kind === "entity"
        ? [state.entities.get(selection.id)].filter((e): e is Entity => Boolean(e))
        : selection?.kind === "group"
          ? (state.groups.get(selection.id)?.members ?? []).map((m) => state.entities.get(m.entity_id)).filter((e): e is Entity => Boolean(e))
          : [];
  for (const entity of chosen) {
    for (const b of entity.fix_evidence?.bearings ?? []) {
      const s = b.sensor_position;
      // Long enough to pass through the fix and a little beyond it.
      const reach = entity.position ? geodesicInverse(s.lat, s.lon, entity.position.lat, entity.position.lon).distanceM * 1.25 : DEFAULT_BEARING_M;
      const length = Math.max(reach, MIN_BEARING_M);
      const basis = b.bearing_uncertainty.basis;
      out.bearings.features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: geodesicLine(s.lat, s.lon, b.bearing_deg, length) },
        properties: { id: entity.entity_id, basis },
      });
      // An unreported sigma gets no wedge: its width would be invented (rule 2).
      if (b.bearing_uncertainty.sigma_deg !== undefined) {
        out.wedges.features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [bearingWedge(s.lat, s.lon, b.bearing_deg, b.bearing_uncertainty.sigma_deg, length)] },
          properties: { id: entity.entity_id, basis },
        });
      }
    }
    for (const p of entity.fix_evidence?.positions ?? []) {
      out.reported.features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.position.lon, p.position.lat] },
        properties: { id: entity.entity_id, source: p.source_id, basis: p.uncertainty.basis },
      });
      if (entity.position) {
        out.links.features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: geodesicBetween(p.position.lat, p.position.lon, entity.position.lat, entity.position.lon, 4) },
          properties: { id: entity.entity_id },
        });
      }
    }
  }
  return out;
}

// --- Groups ------------------------------------------------------------------------------

export interface GroupLinkProps {
  kind: "group";
  id: string;
  relation: Group["kind"];
  state: Group["state"];
  confidence: number;
  selected: boolean;
}

export interface GroupFeatures {
  links: FC<LineString, GroupLinkProps>;
  labels: FC<Point, { kind: "group"; id: string; icon: string }>;
}

/** Whether a group is drawn: retired never, hypotheses only when asked for (spec 8.4). */
export function groupVisible(group: Group, showHypotheses: boolean): boolean {
  if (group.state === "retired") return false;
  return group.state !== "hypothesis" || showHypotheses;
}

export function groupLabel(group: Group): string {
  const state = group.state === "published" ? "" : ` · ${group.state}`;
  return `${group.group_id} · ${group.kind} · ${group.confidence.toFixed(2)}${state}`;
}

export function groupFeatures(state: PictureState, showHypotheses: boolean, selection: ObjectRef | null): GroupFeatures {
  const links: Feature<LineString, GroupLinkProps>[] = [];
  const labels: Feature<Point, { kind: "group"; id: string; icon: string }>[] = [];
  for (const group of state.groups.values()) {
    if (!groupVisible(group, showHypotheses)) continue;
    const placed = group.members
      .map((m) => ({ member: m, position: state.entities.get(m.entity_id)?.position }))
      .filter((m): m is { member: (typeof group.members)[number]; position: { lat: number; lon: number } } => Boolean(m.position));
    if (placed.length < 2) continue;
    // Hierarchical kinds link from the controller or superior to each other member; the
    // symmetric kinds link every pair.
    const hub = placed.find((m) => m.member.role === "controller" || m.member.role === "superior");
    const pairs =
      (group.kind === "controller/controlled" || group.kind === "superior/subordinate") && hub
        ? placed.filter((m) => m !== hub).map((m) => [hub, m] as const)
        : placed.flatMap((a, i) => placed.slice(i + 1).map((b) => [a, b] as const));
    const selected = selection?.kind === "group" && selection.id === group.group_id;
    for (const [a, b] of pairs) {
      links.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: geodesicBetween(a.position.lat, a.position.lon, b.position.lat, b.position.lon) },
        properties: { kind: "group", id: group.group_id, relation: group.kind, state: group.state, confidence: group.confidence, selected },
      });
    }
    const lat = placed.reduce((s, m) => s + m.position.lat, 0) / placed.length;
    const lon = placed.reduce((s, m) => s + m.position.lon, 0) / placed.length;
    labels.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { kind: "group", id: group.group_id, icon: labelKey(group.state === "published" ? "group" : "hypothesis", groupLabel(group)) },
    });
  }
  return { links: collection(links), labels: collection(labels) };
}

// --- Departures --------------------------------------------------------------------------

export interface GhostFeatures {
  points: FC<Point, { kind: "entity"; id: string; icon: string }>;
  links: FC<LineString, { id: string }>;
}

/**
 * Entities that just left, where they last were: a merge leaves one symbol and a visible,
 * clickable record of the other (Phase 4 gate), rather than a symbol that vanishes.
 */
export function ghostFeatures(state: PictureState): GhostFeatures {
  const points: GhostFeatures["points"]["features"] = [];
  const links: GhostFeatures["links"]["features"] = [];
  for (const [id, d] of state.departed) {
    const p = d.entity.position;
    if (!p) continue;
    const text = d.into ? `${id} merged into ${d.into}` : `${id} left: ${d.reason.replace(/\.$/, "")}`;
    points.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { kind: "entity", id, icon: labelKey("ghost", text) } });
    const into = d.into ? state.entities.get(d.into)?.position : undefined;
    if (into) links.push({ type: "Feature", geometry: { type: "LineString", coordinates: geodesicBetween(p.lat, p.lon, into.lat, into.lon, 4) }, properties: { id } });
  }
  return { points: collection(points), links: collection(links) };
}

// --- Truth -------------------------------------------------------------------------------

export interface TruthFeatures {
  points: FC<Point, { id: string; icon: string; active: boolean }>;
  errors: FC<LineString, { id: string }>;
}

/** Where the simulator put each emitter, and a line from the entity it associated with it. */
export function truthFeatures(frame: TruthFrame | null, state: PictureState): TruthFeatures {
  const out: TruthFeatures = { points: collection([]), errors: collection([]) };
  if (!frame) return out;
  for (const e of frame.emitters) {
    out.points.features.push({ type: "Feature", geometry: { type: "Point", coordinates: [e.lon, e.lat] }, properties: { id: e.emitter_id, icon: TRUTH_ICON, active: e.active } });
    const p = e.entity_id ? state.entities.get(e.entity_id)?.position : undefined;
    if (p) out.errors.features.push({ type: "Feature", geometry: { type: "LineString", coordinates: geodesicBetween(p.lat, p.lon, e.lat, e.lon, 4) }, properties: { id: e.emitter_id } });
  }
  return out;
}

/** Meridians and parallels over the visible bounds at a spacing suited to the zoom. */
export function graticule(west: number, south: number, east: number, north: number): FC<LineString> {
  const span = Math.max(east - west, north - south);
  const steps = [30, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005];
  const step = steps.find((s) => span / s <= 14) ?? steps[steps.length - 1]!;
  const lat0 = Math.max(-85, Math.floor(south / step) * step);
  const lat1 = Math.min(85, Math.ceil(north / step) * step);
  const lon0 = Math.floor(west / step) * step;
  const lon1 = Math.ceil(east / step) * step;
  const features: Feature<LineString>[] = [];
  for (let lon = lon0; lon <= lon1 + 1e-9; lon += step) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lon, lat0], [lon, lat1]] }, properties: {} });
  }
  for (let lat = lat0; lat <= lat1 + 1e-9; lat += step) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lon0, lat], [lon1, lat]] }, properties: {} });
  }
  return collection(features);
}
