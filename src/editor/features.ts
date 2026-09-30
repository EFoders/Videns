// The scenario as GeoJSON for the editor's map. Pure: scenario, preview time and selection
// in; features out. Paths are densified in the local plane and converted point by point,
// so the line drawn is the line the simulator will follow.

import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";

import type { Scenario } from "../scenario/types.ts";
import { ellipseRing } from "../geo/ellipse.ts";
import { toLatLon } from "../scenario/frame.ts";
import { classFor, type Library } from "../scenario/library.ts";
import { isSwitchedOn, pathSamples, positionAt } from "../scenario/motion.ts";
import { maxRangeM } from "../scenario/propagation.ts";
import type { EditorSelection } from "./state.ts";
import { editorIconKey, ORIGIN_ICON, SENSOR_SIDC, sideSidc } from "./symbols.ts";

const fc = <G extends Point | LineString | Polygon, P>(features: Feature<G, P>[]): FeatureCollection<G, P> => ({ type: "FeatureCollection", features });

export interface EditorFeatures {
  paths: FeatureCollection<LineString, { id: string; selected: boolean; closing: boolean }>;
  waypoints: FeatureCollection<Point, { kind: "waypoint"; id: string; index: number; selected: boolean }>;
  emitters: FeatureCollection<Point, { kind: "emitter"; id: string; icon: string; present: boolean }>;
  sensors: FeatureCollection<Point, { kind: "sensor"; id: string; icon: string }>;
  ranges: FeatureCollection<Polygon, { sensor: string; inBand: boolean }>;
  relations: FeatureCollection<LineString, { index: number }>;
  origin: FeatureCollection<Point, { icon: string }>;
  selected: FeatureCollection<Point, Record<string, never>>;
}

export function selectedEmitterId(sel: EditorSelection): string | null {
  return sel?.kind === "emitter" || sel?.kind === "waypoint" ? sel.id : null;
}

export function editorFeatures(s: Scenario, t: number, sel: EditorSelection, library: Library): EditorFeatures {
  const origin = s.origin ?? { lat: 50, lon: -105 };
  const ll = (p: readonly number[]): [number, number] => {
    const q = toLatLon(origin, p[0]!, p[1]!);
    return [q.lon, q.lat];
  };
  const chosen = selectedEmitterId(sel);

  const paths: EditorFeatures["paths"]["features"] = [];
  const waypoints: EditorFeatures["waypoints"]["features"] = [];
  const emitters: EditorFeatures["emitters"]["features"] = [];
  const at = new Map<string, [number, number]>();

  for (const e of s.emitters) {
    const selected = e.id === chosen;
    if (e.path_m.length > 1) {
      const { points, closing } = pathSamples(e);
      paths.push({ type: "Feature", geometry: { type: "LineString", coordinates: points.map(ll) }, properties: { id: e.id, selected, closing: false } });
      if (closing) paths.push({ type: "Feature", geometry: { type: "LineString", coordinates: closing.map(ll) }, properties: { id: e.id, selected, closing: true } });
    }
    e.path_m.forEach((p, index) => {
      waypoints.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: ll(p) },
        properties: { kind: "waypoint", id: e.id, index, selected: sel?.kind === "waypoint" && sel.id === e.id && sel.index === index },
      });
    });
    const here = ll(positionAt(e, t));
    at.set(e.id, here);
    const present = isSwitchedOn(e, t);
    const category = classFor(library, e.truth?.class_id)?.category ?? ((e.alt_m ?? 0) > 50 ? "air" : "ground");
    const side = e.truth?.side ?? "unknown";
    emitters.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: here },
      properties: { kind: "emitter", id: e.id, icon: editorIconKey(sideSidc(side, category), e.label || e.id, side === "civilian", false), present },
    });
  }

  const sensors: EditorFeatures["sensors"]["features"] = s.sensors.map((x) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: ll(x.pos_m) },
    properties: { kind: "sensor", id: x.id, icon: editorIconKey(SENSOR_SIDC, x.label || x.id, false, false) },
  }));

  // For the selected emitter: how far each sensor could hear it (median, no shadowing).
  const ranges: EditorFeatures["ranges"]["features"] = [];
  const e = s.emitters.find((x) => x.id === chosen);
  if (e) {
    for (const x of s.sensors) {
      const [lo, hi] = x.freq_range_hz ?? [20e6, 3e9];
      const inBand = e.freq_hz >= lo! && e.freq_hz <= hi!;
      const r = maxRangeM({ eirpDbm: e.eirp_dbm ?? 40, freqHz: e.freq_hz, exponent: s.propagation?.exponent ?? 2.7, noiseFloorDbm: x.noise_floor_dbm ?? -110, thresholdDb: x.threshold_db ?? 6 });
      if (!(r > 0) || r > 2_000_000) continue;
      const c = toLatLon(origin, x.pos_m[0]!, x.pos_m[1]!);
      ranges.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ellipseRing(c.lat, c.lon, { semiMajorM: r, semiMinorM: r, orientationDeg: 0, confidence: 0.5 }, 90)] },
        properties: { sensor: x.id, inBand },
      });
    }
  }

  const relations: EditorFeatures["relations"]["features"] = [];
  for (const [index, r] of (s.truth_relations ?? []).entries()) {
    const pts = r.members.map((m) => at.get(m.emitter_id)).filter((p): p is [number, number] => Boolean(p));
    for (let i = 1; i < pts.length; i++) relations.push({ type: "Feature", geometry: { type: "LineString", coordinates: [pts[0]!, pts[i]!] }, properties: { index } });
  }

  const selectedPoint =
    sel?.kind === "sensor"
      ? s.sensors.find((x) => x.id === sel.id)?.pos_m
      : sel?.kind === "waypoint"
        ? s.emitters.find((x) => x.id === sel.id)?.path_m[sel.index]
        : undefined;
  const selected: EditorFeatures["selected"]["features"] = [];
  if (selectedPoint) selected.push({ type: "Feature", geometry: { type: "Point", coordinates: ll(selectedPoint) }, properties: {} });
  else if (chosen && at.get(chosen)) selected.push({ type: "Feature", geometry: { type: "Point", coordinates: at.get(chosen)! }, properties: {} });

  return {
    paths: fc(paths),
    waypoints: fc(waypoints),
    emitters: fc(emitters),
    sensors: fc(sensors),
    ranges: fc(ranges),
    relations: fc(relations),
    origin: fc([{ type: "Feature", geometry: { type: "Point", coordinates: [origin.lon, origin.lat] }, properties: { icon: ORIGIN_ICON } }]),
    selected: fc(selected),
  };
}
