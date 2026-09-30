// The map. The background comes from configuration (src/map/basemap.ts); everything drawn
// on top of it -- regions, symbols, evidence, groups, truth -- is Videns' own and needs no
// tiles, fonts or sprites: symbols and labels are images drawn in the page.
//
// It draws `shown`: the live picture while following it, or the picture at the moment the
// reader chose on the timeline.

import { effect } from "@preact/signals";
import * as maplibre from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef } from "preact/hooks";

import { exposeForInspection } from "../app/inspection.ts";
import {
  activeBasemap,
  basemapId,
  config,
  cursor,
  ellipseConfidence,
  evidenceMode,
  lastMessageAt,
  now,
  select,
  selection,
  showHypotheses,
  shown,
  showTrails,
  view,
  atLiveEdge,
} from "../app/state.ts";
import { truthNow } from "../app/truth.ts";
import type { ObjectRef } from "../contract/generated/picture.ts";
import type { TruthFrame } from "../contract/generated/truth.ts";
import type { PictureState } from "../store/picture.ts";
import { summarise } from "../ui/status.ts";
import { swapBasemap, watchBasemap } from "./basemapLayer.ts";
import {
  evidenceFeatures,
  ghostFeatures,
  graticule,
  groupFeatures,
  pointFeatures,
  regionFeatures,
  RingCache,
  selectionFeatures,
  trailFeatures,
  truthFeatures,
} from "./features.ts";
import { parseIconKey, renderIcon, renderSpecial } from "./symbols.ts";

maplibre.setWorkerUrl(workerUrl);

const COLORS = {
  background: "#1b2229",
  graticule: "#2f3a45",
  region: "#cfe3ff",
  selection: "#ffd166",
  evidence: "#fbbf24",
  truth: "#f472b6",
  ghost: "#94a3b8",
};

/**
 * Group links are coloured by relationship kind, never by anything that could read as
 * affiliation (spec 4.2): no reds, blues or greens that a reader would take for a side.
 */
const GROUP_COLOURS: maplibre.ExpressionSpecification = [
  "match",
  ["get", "relation"],
  "controller/controlled",
  "#e2b04a",
  "superior/subordinate",
  "#c084fc",
  "peer",
  "#5eead4",
  "#cbd5e1",
];

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

const SOURCES = [
  "graticule",
  "wedges",
  "bearings",
  "evidence-links",
  "reported",
  "trails",
  "regions",
  "group-links",
  "group-labels",
  "truth-errors",
  "truth",
  "ghost-links",
  "ghosts",
  "points",
  "selected",
] as const;

/** The picture's own layers. Basemap layers are slotted in beneath "graticule" (swapBasemap). */
function buildStyle(): maplibre.StyleSpecification {
  return {
    version: 8,
    sources: Object.fromEntries(SOURCES.map((id) => [id, { type: "geojson", data: empty() }])),
    layers: [
      { id: "background", type: "background", paint: { "background-color": COLORS.background } },
      { id: "graticule", type: "line", source: "graticule", paint: { "line-color": COLORS.graticule, "line-width": 0.8, "line-opacity": 1 } },
      // Evidence: the ±1-sigma wedge, then the bearing itself. An unreported sigma has a
      // dashed line and no wedge -- its width would be invented.
      { id: "wedges", type: "fill", source: "wedges", paint: { "fill-color": COLORS.evidence, "fill-opacity": 0.1 } },
      {
        id: "bearings",
        type: "line",
        source: "bearings",
        filter: ["!=", ["get", "basis"], "unreported"],
        paint: { "line-color": COLORS.evidence, "line-width": 1.2, "line-opacity": 0.85 },
      },
      {
        id: "bearings-unreported",
        type: "line",
        source: "bearings",
        filter: ["==", ["get", "basis"], "unreported"],
        paint: { "line-color": COLORS.evidence, "line-width": 1.2, "line-opacity": 0.85, "line-dasharray": [2, 2] },
      },
      { id: "evidence-links", type: "line", source: "evidence-links", paint: { "line-color": COLORS.evidence, "line-width": 1, "line-dasharray": [1, 2] } },
      {
        id: "reported",
        type: "circle",
        source: "reported",
        paint: { "circle-radius": 4, "circle-color": COLORS.background, "circle-stroke-color": COLORS.evidence, "circle-stroke-width": 1.5 },
      },
      { id: "trails", type: "line", source: "trails", paint: { "line-color": "#e2e8f0", "line-width": 1.5, "line-opacity": 0.45 } },
      {
        id: "region-fill",
        type: "fill",
        source: "regions",
        paint: { "fill-color": COLORS.region, "fill-opacity": ["case", ["get", "selected"], 0.22, ["get", "dim"], 0.03, 0.1] },
      },
      {
        id: "region-measured",
        type: "line",
        source: "regions",
        filter: ["==", ["get", "basis"], "measured"],
        paint: {
          "line-color": COLORS.region,
          "line-width": ["case", ["get", "selected"], 2.2, 1.4],
          "line-opacity": ["case", ["get", "dim"], 0.25, 0.9],
        },
      },
      {
        // Assumed and mixed regions are dashed: a number someone declared, or one that is
        // only partly measured, must not look like a measurement (spec 8.2).
        id: "region-declared",
        type: "line",
        source: "regions",
        filter: ["in", ["get", "basis"], ["literal", ["assumed", "mixed"]]],
        paint: {
          "line-color": COLORS.region,
          "line-width": ["case", ["get", "selected"], 2.2, 1.4],
          "line-opacity": ["case", ["get", "dim"], 0.25, 0.9],
          "line-dasharray": [3, 2],
        },
      },
      {
        // Confidence is carried by width and by the label -- never by width alone (spec 8.4).
        id: "group-links",
        type: "line",
        source: "group-links",
        filter: ["==", ["get", "state"], "published"],
        paint: {
          "line-color": GROUP_COLOURS,
          "line-width": ["+", 1, ["*", 5, ["get", "confidence"]], ["case", ["get", "selected"], 1.5, 0]],
          "line-opacity": 0.9,
        },
      },
      {
        // Hypotheses and decaying groups are dashed and faded: weaker claims look weaker.
        id: "group-links-weak",
        type: "line",
        source: "group-links",
        filter: ["!=", ["get", "state"], "published"],
        paint: {
          "line-color": GROUP_COLOURS,
          "line-width": ["+", 1, ["*", 5, ["get", "confidence"]], ["case", ["get", "selected"], 1.5, 0]],
          "line-opacity": 0.6,
          "line-dasharray": [2, 2],
        },
      },
      { id: "truth-errors", type: "line", source: "truth-errors", paint: { "line-color": COLORS.truth, "line-width": 1, "line-dasharray": [1, 1.5] } },
      {
        id: "truth",
        type: "symbol",
        source: "truth",
        layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true },
        paint: { "icon-opacity": ["case", ["get", "active"], 1, 0.5] },
      },
      { id: "ghost-links", type: "line", source: "ghost-links", paint: { "line-color": COLORS.ghost, "line-width": 1.2, "line-dasharray": [2, 2] } },
      {
        id: "ghost-rings",
        type: "circle",
        source: "ghosts",
        paint: { "circle-radius": 9, "circle-opacity": 0, "circle-stroke-color": COLORS.ghost, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.8 },
      },
      {
        id: "selected-ring",
        type: "circle",
        source: "selected",
        paint: { "circle-radius": 26, "circle-opacity": 0, "circle-stroke-color": COLORS.selection, "circle-stroke-width": 2 },
      },
      {
        id: "points",
        type: "symbol",
        source: "points",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["get", "sort"],
        },
        paint: { "icon-opacity": ["get", "opacity"] },
      },
      {
        id: "group-labels",
        type: "symbol",
        source: "group-labels",
        layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-offset": [0, -26] },
      },
      {
        // A departure's note sits above where it was and above the symbols: a merged
        // entity usually lies almost on top of the one it merged into, and its record
        // must stay visible and clickable (Phase 4 gate).
        id: "ghosts",
        type: "symbol",
        source: "ghosts",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "bottom",
          "icon-offset": [0, -22],
        },
        paint: { "icon-opacity": 0.9 },
      },
    ],
  };
}

const CLICKABLE = ["points", "region-fill", "group-links", "group-links-weak", "group-labels", "ghosts"];

export function MapView() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const map = createMap(container.current!);
    let disposePicture = () => {};
    let disposeBasemap = () => {};
    let frame = 0;

    // Draw the picture as soon as the style exists -- not on "load", which waits for the
    // first basemap tiles. The picture must never depend on a tile server answering.
    const start = () => {
      disposePicture = effect(() => {
        const inputs: RenderInputs = {
          state: shown.value,
          confidence: ellipseConfidence.value,
          selected: selection.value,
          trails: showTrails.value,
          evidence: evidenceMode.value,
          hypotheses: showHypotheses.value,
          truth: truthNow.value,
        };
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => render(map, inputs));
      });
      disposeBasemap = effect(() => {
        basemapId.value;
        swapBasemap(map, activeBasemap(), "graticule", (has) => graticuleFor(map, has));
      });
    };
    if (map.isStyleLoaded()) start();
    else map.once("style.load", start);

    return () => {
      disposePicture();
      disposeBasemap();
      cancelAnimationFrame(frame);
      map.remove();
    };
  }, []);

  // Only the live view can be stale; a moment from the history is exactly what it was.
  const { stale } = summarise(view.value, shown.value, lastMessageAt.value, now.value);
  return <div ref={container} class={`map${stale && atLiveEdge.value ? " map--stale" : ""}`} aria-label="Map of the Vigilans picture" />;
}

interface RenderInputs {
  state: PictureState;
  confidence: number;
  selected: ObjectRef | null;
  trails: boolean;
  evidence: "selected" | "all" | "off";
  hypotheses: boolean;
  truth: TruthFrame | null;
}

// Follow the run's origin until the reader takes over the view.
let following = true;
let followedRun: string | undefined;
const rings = new RingCache();

function setData(map: maplibre.Map, source: (typeof SOURCES)[number], data: GeoJSON.FeatureCollection): void {
  (map.getSource(source) as maplibre.GeoJSONSource).setData(data);
}

function render(map: maplibre.Map, i: RenderInputs): void {
  const { state } = i;
  if (following && state.hello && state.hello.run_id !== followedRun) {
    followedRun = state.hello.run_id;
    map.jumpTo({ center: [state.hello.origin.lon, state.hello.origin.lat], zoom: 10.5 });
  }
  const evidence = evidenceFeatures(state, i.evidence, i.selected);
  const groups = groupFeatures(state, i.hypotheses, i.selected);
  const ghosts = ghostFeatures(state);
  const truth = truthFeatures(i.truth, state);
  setData(map, "wedges", evidence.wedges);
  setData(map, "bearings", evidence.bearings);
  setData(map, "evidence-links", evidence.links);
  setData(map, "reported", evidence.reported);
  setData(map, "trails", i.trails ? trailFeatures(state) : empty());
  setData(map, "regions", regionFeatures(state, i.confidence, i.selected, rings));
  setData(map, "group-links", groups.links);
  setData(map, "group-labels", groups.labels);
  setData(map, "truth-errors", truth.errors);
  setData(map, "truth", truth.points);
  setData(map, "ghost-links", ghosts.links);
  setData(map, "ghosts", ghosts.points);
  setData(map, "points", pointFeatures(state, i.selected));
  setData(map, "selected", selectionFeatures(state, i.selected));
}

/** The graticule recedes when there is a basemap to read positions from instead. */
export function graticuleFor(map: maplibre.Map, hasBasemap: boolean): void {
  map.setPaintProperty("graticule", "line-color", hasBasemap ? "#9fb3c8" : COLORS.graticule);
  map.setPaintProperty("graticule", "line-opacity", hasBasemap ? 0.18 : 1);
}

function createMap(element: HTMLElement): maplibre.Map {
  const configured = config.value?.view;
  const map = new maplibre.Map({
    container: element,
    style: buildStyle(),
    center: configured ? [configured.lon, configured.lat] : [-105, 50],
    zoom: configured?.zoom ?? 9,
    maxZoom: 20,
    // Data licences require attribution; shown uncollapsed. It lists whatever the current
    // basemap's source declares.
    attributionControl: { compact: false },
    maxPitch: 0,
  });
  if (configured) following = false;
  map.addControl(new maplibre.NavigationControl({ visualizePitch: false }), "top-left");
  map.addControl(new maplibre.ScaleControl({ unit: "metric", maxWidth: 140 }), "bottom-right");
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  exposeForInspection({ map });

  // Symbols and labels are drawn the first time the map asks for one, not ahead of time.
  map.setMissingStyleImageResolver((id) => {
    if (map.hasImage(id)) return;
    const ratio = window.devicePixelRatio || 1;
    const spec = parseIconKey(id);
    const icon = spec ? renderIcon(spec, ratio) : renderSpecial(id, ratio);
    if (icon) map.addImage(id, { width: icon.width, height: icon.height, data: icon.data }, { pixelRatio: icon.pixelRatio });
  });

  // A basemap that fails or hangs says so, rather than leaving a blank background.
  watchBasemap(map);

  const updateGraticule = () => {
    const b = map.getBounds();
    (map.getSource("graticule") as maplibre.GeoJSONSource).setData(graticule(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()));
  };
  map.once("style.load", updateGraticule);
  map.on("moveend", updateGraticule);
  map.on("dragstart", () => (following = false));
  map.on("zoomstart", (e) => {
    if ((e as { originalEvent?: Event }).originalEvent) following = false;
  });

  map.on("click", (event) => {
    const hit = map.queryRenderedFeatures(event.point, { layers: CLICKABLE })[0];
    const props = hit?.properties as { kind?: ObjectRef["kind"]; id?: string } | undefined;
    select(props?.kind && props.id ? { kind: props.kind, id: props.id } : null);
  });
  map.on("mousemove", (event) => {
    cursor.value = { lat: event.lngLat.lat, lon: event.lngLat.lng };
    const hit = map.queryRenderedFeatures(event.point, { layers: CLICKABLE }).length > 0;
    map.getCanvas().style.cursor = hit ? "pointer" : "";
  });
  map.on("mouseout", () => (cursor.value = null));
  return map;
}
