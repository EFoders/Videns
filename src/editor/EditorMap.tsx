// The editor's map: place sensors and emitters, draw and reshape paths, drag things about,
// move the origin. Every point is converted into the scenario's local frame the moment it
// is placed (src/scenario/frame.ts), so what is stored is what the simulator reads.

import { effect } from "@preact/signals";
import * as maplibre from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef } from "preact/hooks";

import { exposeForInspection } from "../app/inspection.ts";
import { activeBasemap, basemapId } from "../app/state.ts";
import type { Scenario } from "../scenario/types.ts";
import { graticule } from "../map/features.ts";
import { swapBasemap, watchBasemap } from "../map/basemapLayer.ts";
import { addEmitter, addSensor, appendWaypoint, moveSensor, moveWaypoint, setOrigin, translateEmitter } from "../scenario/editing.ts";
import { toLatLon, toLocal } from "../scenario/frame.ts";
import { classFor } from "../scenario/library.ts";
import { positionAt } from "../scenario/motion.ts";
import { editorFeatures, selectedEmitterId } from "./features.ts";
import { commit, hint, library, paletteClass, paletteSide, preview, previewT, scenario, select, selection, tool } from "./state.ts";
import { renderEditorIcon } from "./symbols.ts";

maplibre.setWorkerUrl(workerUrl);

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const SOURCES = ["graticule", "ranges", "relations", "paths", "waypoints", "sensors", "emitters", "origin", "selected"] as const;

const STYLE: maplibre.StyleSpecification = {
  version: 8,
  sources: Object.fromEntries(SOURCES.map((id) => [id, { type: "geojson", data: empty() }])),
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#1b2229" } },
    { id: "graticule", type: "line", source: "graticule", paint: { "line-color": "#2f3a45", "line-width": 0.8 } },
    {
      // How far each sensor could hear the selected emitter: median, no shadowing.
      id: "ranges",
      type: "line",
      source: "ranges",
      paint: { "line-color": ["case", ["get", "inBand"], "#7dd3fc", "#64748b"], "line-width": 1.2, "line-dasharray": [4, 3], "line-opacity": 0.8 },
    },
    { id: "ranges-fill", type: "fill", source: "ranges", filter: ["get", "inBand"], paint: { "fill-color": "#7dd3fc", "fill-opacity": 0.04 } },
    { id: "relations", type: "line", source: "relations", paint: { "line-color": "#e2b04a", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.8 } },
    {
      id: "paths",
      type: "line",
      source: "paths",
      filter: ["!", ["get", "closing"]],
      paint: { "line-color": ["case", ["get", "selected"], "#ffd166", "#cbd5e1"], "line-width": ["case", ["get", "selected"], 3, 2], "line-opacity": 0.9 },
    },
    {
      id: "paths-closing",
      type: "line",
      source: "paths",
      filter: ["get", "closing"],
      paint: { "line-color": ["case", ["get", "selected"], "#ffd166", "#cbd5e1"], "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.8 },
    },
    {
      id: "waypoints",
      type: "circle",
      source: "waypoints",
      paint: {
        "circle-radius": ["case", ["get", "selected"], 7, 5],
        "circle-color": ["case", ["get", "selected"], "#ffd166", "#1b2229"],
        "circle-stroke-color": "#ffd166",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "selected-ring",
      type: "circle",
      source: "selected",
      paint: { "circle-radius": 24, "circle-opacity": 0, "circle-stroke-color": "#ffd166", "circle-stroke-width": 2 },
    },
    {
      id: "sensors",
      type: "symbol",
      source: "sensors",
      layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true },
    },
    {
      id: "emitters",
      type: "symbol",
      source: "emitters",
      layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true },
      // Switched off at the previewed moment (outside its active windows): shown faint.
      paint: { "icon-opacity": ["case", ["get", "present"], 1, 0.35] },
    },
    { id: "origin", type: "symbol", source: "origin", layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true } },
  ],
};

const HIT_LAYERS = ["waypoints", "emitters", "sensors", "paths"];

type Drag =
  | { kind: "sensor"; id: string; start: Scenario }
  | { kind: "waypoint"; id: string; index: number; start: Scenario }
  | { kind: "emitter"; id: string; start: Scenario; from: [number, number] };

export function EditorMap() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = scenario.value;
    const map = new maplibre.Map({
      container: container.current!,
      style: STYLE,
      center: [s.origin?.lon ?? -105, s.origin?.lat ?? 50],
      zoom: 11,
      maxZoom: 20,
      attributionControl: { compact: false },
      maxPitch: 0,
      doubleClickZoom: false,
    });
    map.addControl(new maplibre.NavigationControl({ visualizePitch: false }), "top-left");
    map.addControl(new maplibre.ScaleControl({ unit: "metric", maxWidth: 140 }), "bottom-right");
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    watchBasemap(map);
    exposeForInspection({
      map,
      scenario,
      selection,
      previewT,
      tool,
      // Where the preview puts an emitter at time t, for tests that check the simulator agrees.
      previewAt: (id: string, t: number) => {
        const e = scenario.value.emitters.find((x) => x.id === id);
        if (!e) return null;
        const [east, north] = positionAt(e, t);
        return toLatLon(scenario.value.origin ?? { lat: 50, lon: -105 }, east, north);
      },
    });

    map.setMissingStyleImageResolver((id) => {
      if (map.hasImage(id)) return;
      const icon = renderEditorIcon(id, window.devicePixelRatio || 1);
      if (icon) map.addImage(id, { width: icon.width, height: icon.height, data: icon.data }, { pixelRatio: icon.pixelRatio });
    });

    const local = (lngLat: maplibre.LngLat): [number, number] => toLocal(scenario.value.origin ?? { lat: 50, lon: -105 }, lngLat.lat, lngLat.lng);
    const updateGraticule = () => {
      const b = map.getBounds();
      (map.getSource("graticule") as maplibre.GeoJSONSource).setData(graticule(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()));
    };

    let drag: Drag | null = null;
    let dragged = false;

    map.on("mousedown", (event) => {
      if (tool.value !== "select") return;
      const hit = map.queryRenderedFeatures(event.point, { layers: ["waypoints", "sensors", "emitters"] })[0];
      const p = hit?.properties as { kind?: string; id?: string; index?: number } | undefined;
      if (!p?.kind || !p.id) return;
      event.preventDefault();
      map.dragPan.disable();
      dragged = false;
      const start = scenario.value;
      if (p.kind === "sensor") drag = { kind: "sensor", id: p.id, start };
      else if (p.kind === "waypoint") drag = { kind: "waypoint", id: p.id, index: Number(p.index), start };
      else drag = { kind: "emitter", id: p.id, start, from: local(event.lngLat) };
    });

    map.on("mousemove", (event) => {
      if (drag) {
        dragged = true;
        const to = local(event.lngLat);
        if (drag.kind === "sensor") preview(moveSensor(drag.start, drag.id, to));
        else if (drag.kind === "waypoint") preview(moveWaypoint(drag.start, drag.id, drag.index, to));
        else preview(translateEmitter(drag.start, drag.id, [to[0] - drag.from[0], to[1] - drag.from[1]]));
        return;
      }
      const hover = tool.value === "select" && map.queryRenderedFeatures(event.point, { layers: HIT_LAYERS }).length > 0;
      map.getCanvas().style.cursor = tool.value === "select" ? (hover ? "pointer" : "") : "crosshair";
    });

    const endDrag = () => {
      if (!drag) return;
      map.dragPan.enable();
      if (dragged) commit(scenario.value, drag.start);
      else if (drag.kind === "waypoint") select({ kind: "waypoint", id: drag.id, index: drag.index });
      else select({ kind: drag.kind, id: drag.id });
      drag = null;
    };
    map.on("mouseup", endDrag);
    map.getCanvas().addEventListener("mouseleave", endDrag);

    map.on("click", (event) => {
      if (dragged) {
        dragged = false;
        return;
      }
      const at = local(event.lngLat);
      const current = scenario.value;
      switch (tool.value) {
        case "select": {
          const hit = map.queryRenderedFeatures(event.point, { layers: HIT_LAYERS })[0];
          const p = hit?.properties as { kind?: string; id?: string; index?: number } | undefined;
          if (!p?.id) select(null);
          else if (p.kind === "sensor") select({ kind: "sensor", id: p.id });
          else if (p.kind === "waypoint") select({ kind: "waypoint", id: p.id, index: Number(p.index) });
          else select({ kind: "emitter", id: p.id });
          return;
        }
        case "sensor": {
          const { scenario: next, id } = addSensor(current, at);
          commit(next);
          select({ kind: "sensor", id });
          return;
        }
        case "emitter": {
          const cls = classFor(library.value, paletteClass.value) ?? null;
          const { scenario: next, id } = addEmitter(current, at, cls, paletteSide.value);
          commit(next);
          select({ kind: "emitter", id });
          return;
        }
        case "path": {
          const id = selectedEmitterId(selection.value);
          if (!id) {
            hint.value = "Select an emitter first, then click to add waypoints to its path.";
            return;
          }
          const e = current.emitters.find((x) => x.id === id)!;
          const air = classFor(library.value, e.truth?.class_id)?.category === "air";
          commit(appendWaypoint(current, id, at, air ? 25 : 10));
          return;
        }
        case "origin":
          commit(setOrigin(current, { lat: event.lngLat.lat, lon: event.lngLat.lng }));
          tool.value = "select";
          return;
      }
    });

    let frame = 0;
    let disposeScene = () => {};
    let disposeBasemap = () => {};
    const start = () => {
      updateGraticule();
      disposeScene = effect(() => {
        const f = editorFeatures(scenario.value, previewT.value, selection.value, library.value);
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          for (const id of SOURCES) if (id !== "graticule") (map.getSource(id) as maplibre.GeoJSONSource).setData(f[id as Exclude<(typeof SOURCES)[number], "graticule">]);
        });
      });
      disposeBasemap = effect(() => {
        basemapId.value;
        swapBasemap(map, activeBasemap(), "graticule", (has) => {
          map.setPaintProperty("graticule", "line-color", has ? "#9fb3c8" : "#2f3a45");
          map.setPaintProperty("graticule", "line-opacity", has ? 0.18 : 1);
        });
      });
    };
    map.on("moveend", updateGraticule);
    if (map.isStyleLoaded()) start();
    else map.once("style.load", start);

    // Fly to a scenario when one is opened or started afresh somewhere else.
    let lastOrigin = `${s.origin?.lat},${s.origin?.lon}`;
    const disposeFollow = effect(() => {
      const o = scenario.value.origin;
      const key = `${o?.lat},${o?.lon}`;
      if (key !== lastOrigin && tool.peek() !== "origin" && scenario.value.emitters.length + scenario.value.sensors.length === 0) {
        map.jumpTo({ center: [o?.lon ?? -105, o?.lat ?? 50] });
      }
      lastOrigin = key;
    });

    return () => {
      disposeScene();
      disposeBasemap();
      disposeFollow();
      cancelAnimationFrame(frame);
      map.remove();
    };
  }, []);

  return <div ref={container} class={`map editor-map editor-map--${tool.value}`} aria-label="Scenario map" />;
}

/** Centre the map on everything in the scenario, after opening a file. */
export function fitScenario(): void {
  const map = (globalThis as unknown as { __videns?: { map?: maplibre.Map } }).__videns?.map;
  const s = scenario.value;
  if (!map) return;
  const points = [...s.sensors.map((x) => x.pos_m), ...s.emitters.flatMap((e) => e.path_m)];
  if (!points.length) {
    map.jumpTo({ center: [s.origin?.lon ?? -105, s.origin?.lat ?? 50] });
    return;
  }
  const origin = s.origin ?? { lat: 50, lon: -105 };
  const bounds = new maplibre.LngLatBounds();
  for (const p of points) {
    const q = toLatLon(origin, p[0]!, p[1]!);
    bounds.extend([q.lon, q.lat]);
  }
  map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 0 });
}
