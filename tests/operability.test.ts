// A viewer with nothing to show says why (VIDENS_SPEC.md rules 10, 11, 13).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigError, describeBasemap, parseConfig } from "../src/config.ts";
import type { ViewStatus } from "../src/app/state.ts";
import { applyMessage, emptyPicture } from "../src/store/picture.ts";
import { summarise } from "../src/ui/status.ts";
import { delta, entity, hello, snapshot } from "./helpers.ts";

const NOW = 1_000_000;
const feed = (status: "connecting" | "live" | "stalled" | "reconnecting"): ViewStatus => ({ kind: "feed", status, detail: "d", since: NOW });

describe("status", () => {
  const empty = applyMessage(applyMessage(emptyPicture(), hello()).state, snapshot(0)).state;
  const populated = applyMessage(empty, delta(1, { upsert: { entities: [entity("E1")] } })).state;

  it("gives every situation its own label and banner", () => {
    const situations = [
      summarise({ kind: "loading" }, emptyPicture(), null, NOW),
      summarise({ kind: "config_error", detail: "bad" }, emptyPicture(), null, NOW),
      summarise({ kind: "no_feed" }, emptyPicture(), null, NOW),
      summarise(feed("connecting"), emptyPicture(), null, NOW),
      summarise(feed("reconnecting"), populated, NOW - 12_000, NOW),
      summarise(feed("stalled"), populated, NOW - 40_000, NOW),
      summarise(feed("live"), emptyPicture(), NOW - 500, NOW), // live but no snapshot yet
      summarise(feed("live"), empty, NOW - 1000, NOW),
    ];
    const banners = situations.map((s) => s.banner);
    expect(new Set(banners).size).toBe(banners.length);
    expect(banners.every((b) => b !== null && b.length > 0)).toBe(true);
  });

  it("says how long the feed has been silent", () => {
    expect(summarise(feed("stalled"), populated, NOW - 40_000, NOW).banner).toContain("40 s");
  });

  it("marks the picture stale unless it is live and in sequence", () => {
    expect(summarise(feed("live"), populated, NOW - 500, NOW).stale).toBe(false);
    expect(summarise(feed("stalled"), populated, NOW - 9000, NOW).stale).toBe(true);
    expect(summarise(feed("reconnecting"), populated, NOW - 9000, NOW).stale).toBe(true);
    const gapped = { ...populated, needsSnapshot: true };
    expect(summarise(feed("live"), gapped, NOW - 500, NOW).stale).toBe(true);
  });

  it("shows no banner when there is a live picture to look at", () => {
    expect(summarise(feed("live"), populated, NOW - 500, NOW).banner).toBeNull();
  });
});

describe("configuration", () => {
  const osm = { id: "street", label: "Street", kind: "online", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors", max_zoom: 19 };
  const none = { id: "none", label: "None", kind: "none" };
  const good = { feed: "/picture/v0", basemap: "none", basemaps: [osm, none], ellipse_confidence: 0.95, view: null, coordinate_format: "dd", truth_overlay: false };

  it("reads what the container renders", () => {
    const c = parseConfig(good, "test");
    expect(c.feed).toBe("/picture/v0");
    expect(c.ellipseConfidence).toBe(0.95);
    expect(c.basemapDefault).toBe("none");
  });

  it("reads the basemap list the image ships", () => {
    const shipped = JSON.parse(readFileSync(join(import.meta.dirname, "..", "config", "basemaps.json"), "utf8"));
    const c = parseConfig({ ...good, basemap: "street", basemaps: shipped }, "t");
    expect(c.basemaps.map((b) => `${b.id}:${b.kind}`)).toEqual(["street:online", "terrain:online", "satellite:online", "none:none"]);
  });

  it("accepts feed none for file-only use", () => {
    expect(parseConfig({ ...good, feed: "none" }, "test").feed).toBeNull();
  });

  describe("basemaps", () => {
    it("reads an online basemap and the one origin it will contact", () => {
      const [b] = parseConfig(good, "t").basemaps;
      expect(b).toEqual({ id: "street", label: "Street", kind: "online", url: osm.url, origin: "https://tile.openstreetmap.org", attribution: osm.attribution, maxZoom: 19, tone: "muted" });
    });

    it("refuses an online basemap without attribution, over plain http, or without tile placeholders", () => {
      const withStreet = (patch: object) => ({ ...good, basemaps: [{ ...osm, ...patch }, none] });
      expect(() => parseConfig(withStreet({ attribution: " " }), "t")).toThrow(/attribution/);
      expect(() => parseConfig(withStreet({ url: "http://tile.example/{z}/{x}/{y}.png" }), "t")).toThrow(/https/);
      expect(() => parseConfig(withStreet({ url: "https://tile.example/tiles.png" }), "t")).toThrow(/\{z\}/);
      expect(() => parseConfig(withStreet({ tone: "neon" }), "t")).toThrow(/tone/);
    });

    it("refuses offline PMTiles basemaps, which are out of scope, and says so", () => {
      const offline = { id: "offline", label: "Offline", kind: "pmtiles", url: "/basemaps/region.pmtiles", attribution: "© OpenStreetMap contributors" };
      expect(() => parseConfig({ ...good, basemaps: [offline], basemap: "offline" }, "t")).toThrow(/offline basemaps are out of scope/);
    });

    it("refuses a default that is not in the list, duplicate ids, and an empty list", () => {
      expect(() => parseConfig({ ...good, basemap: "satellite" }, "t")).toThrow(/not one of the configured basemaps/);
      expect(() => parseConfig({ ...good, basemaps: [osm, osm] }, "t")).toThrow(/duplicate id/);
      expect(() => parseConfig({ ...good, basemaps: [] }, "t")).toThrow(/non-empty/);
    });

    it("says, in the switcher's words, that an online basemap sees the viewed area", () => {
      const [street, off] = parseConfig(good, "t").basemaps;
      expect(describeBasemap(street!)).toContain("sees the area being viewed");
      expect(describeBasemap(off!)).toContain("nothing requested");
    });
  });

  it("rejects rather than defaulting", () => {
    expect(() => parseConfig({ ...good, ellipse_confidence: 1.5 }, "t")).toThrow(ConfigError);
    expect(() => parseConfig({ ...good, feed: "https://elsewhere.example/picture" }, "t")).toThrow(/same-origin/);
    expect(() => parseConfig({ ...good, feeds: "/x" }, "t")).toThrow(/unknown setting "feeds"/);
  });
});
