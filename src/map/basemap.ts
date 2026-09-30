// The map background: one of the configured basemaps (src/config.ts, VIDENS_SPEC.md 8.1),
// as a source and layers that MapView slots in beneath the picture.
//
// Online raster tiles are darkened and desaturated so symbols and regions stay the most
// prominent thing on the map; imagery keeps more of its colour so it can still be read.

import type * as maplibre from "maplibre-gl";

import type { Basemap } from "../config.ts";

export interface BasemapStyle {
  sources: Record<string, maplibre.SourceSpecification>;
  layers: maplibre.LayerSpecification[];
}

export function basemapStyle(basemap: Basemap): BasemapStyle {
  switch (basemap.kind) {
    case "none":
      return { sources: {}, layers: [] };

    case "online":
      return {
        sources: {
          basemap: { type: "raster", tiles: [basemap.url], tileSize: 256, maxzoom: basemap.maxZoom, attribution: basemap.attribution },
        },
        layers: [
          {
            id: "basemap",
            type: "raster",
            source: "basemap",
            paint:
              basemap.tone === "natural"
                ? { "raster-saturation": -0.15, "raster-brightness-max": 0.85, "raster-fade-duration": 0 }
                : { "raster-saturation": -0.6, "raster-brightness-max": 0.55, "raster-contrast": 0.15, "raster-fade-duration": 0 },
          },
        ],
      };
  }
}
