// Putting a basemap under a map's own layers, and saying so when it fails -- shared by the
// viewer and the scenario editor. The basemap's layers go beneath `beforeLayer`; a tile
// server that fails or hangs is reported through basemapProblem, never left blank.

import type * as maplibre from "maplibre-gl";

import { basemapProblem } from "../app/state.ts";
import type { BasemapOption } from "../config.ts";
import { basemapStyle } from "./basemap.ts";

const PREFIX = "bm:";
/** How long a newly chosen basemap may take to deliver its first tile before we say so. */
const FIRST_TILE_WITHIN_MS = 10_000;

interface Watch {
  generation: number;
  tileArrived: number;
  timer?: ReturnType<typeof setTimeout>;
}

const watches = new WeakMap<maplibre.Map, Watch>();

/** Report tile failures and track tile arrival for one map. Call once, after creating it. */
export function watchBasemap(map: maplibre.Map): void {
  const watch: Watch = { generation: 0, tileArrived: 0 };
  watches.set(map, watch);
  map.on("error", (event) => {
    if ((event as { sourceId?: string }).sourceId !== "basemap") return;
    if (!basemapProblem.value) basemapProblem.value = `basemap tiles failed to load: ${event.error?.message ?? "unknown error"}`;
  });
  map.on("data", (event) => {
    const e = event as { sourceId?: string; tile?: unknown };
    if (e.sourceId !== "basemap" || !e.tile) return;
    watch.tileArrived = watch.generation;
    // Tiles are arriving again: a problem about them no longer holds.
    if (basemapProblem.value?.startsWith("basemap tiles failed") || basemapProblem.value?.startsWith("no ")) basemapProblem.value = null;
  });
}

/** Replace the basemap's source and layers, leaving the map's own untouched. */
export function swapBasemap(map: maplibre.Map, option: BasemapOption, beforeLayer: string, onChange?: (hasBasemap: boolean) => void): void {
  const watch = watches.get(map);
  const generation = watch ? ++watch.generation : 0;
  const style = basemapStyle(option);

  // Prefixed ids, so a basemap's own "background" cannot collide with the map's.
  for (const layer of map.getStyle().layers) if (layer.id.startsWith(PREFIX)) map.removeLayer(layer.id);
  if (map.getSource("basemap")) map.removeSource("basemap");
  for (const [id, source] of Object.entries(style.sources)) map.addSource(id, source);
  for (const layer of style.layers) map.addLayer({ ...layer, id: `${PREFIX}${layer.id}` } as maplibre.LayerSpecification, beforeLayer);
  const hasBasemap = style.layers.length > 0;
  onChange?.(hasBasemap);

  // A tile server that hangs raises no error at all; without this the map would sit blank
  // under a pill that says all is well.
  if (!watch) return;
  clearTimeout(watch.timer);
  if (hasBasemap) {
    watch.timer = setTimeout(() => {
      if (generation === watch.generation && watch.tileArrived !== generation && !basemapProblem.value) {
        const from = option.kind === "online" ? ` from ${option.origin}` : "";
        basemapProblem.value = `no ${option.label} tiles received${from} in ${FIRST_TILE_WITHIN_MS / 1000} s`;
      }
    }, FIRST_TILE_WITHIN_MS);
  }
}
