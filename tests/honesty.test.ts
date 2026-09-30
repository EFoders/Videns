// The honesty rules, checked where the map's geometry is decided (VIDENS_SPEC.md 4.1, 10).

import { describe, expect, it } from "vitest";

import { sidcIdentity } from "../src/contract/identity.ts";
import { pointFeatures, regionFeatures, RingCache } from "../src/map/features.ts";
import { entityIcon, iconKey, parseIconKey } from "../src/map/symbols.ts";
import { applyMessage, emptyPicture } from "../src/store/picture.ts";
import { entity, hello, snapshot } from "./helpers.ts";

function pictureOf(...entities: ReturnType<typeof entity>[]) {
  let state = applyMessage(emptyPicture(), hello()).state;
  state = applyMessage(state, snapshot(0, entities)).state;
  return state;
}

describe("uncertainty regions", () => {
  it("draws no region at all for an unreported uncertainty", () => {
    const state = pictureOf(entity("E3", { position_uncertainty: { basis: "unreported" } }));
    const regions = regionFeatures(state, 0.95, null, new RingCache());
    expect(regions.features).toEqual([]);
  });

  it("still draws the entity itself, badged, so it is not lost", () => {
    const e = entity("E3", { position_uncertainty: { basis: "unreported" } });
    const points = pointFeatures(pictureOf(e));
    expect(points.features).toHaveLength(1);
    expect(parseIconKey(points.features[0]!.properties.icon)?.unreported).toBe(true);
  });

  it("marks assumed and mixed regions with their basis so they are drawn dashed", () => {
    const state = pictureOf(
      entity("A", {
        position_uncertainty: {
          basis: "assumed",
          ellipse: { semi_major_m: 150, semi_minor_m: 150, orientation_deg: 0, confidence: 0.3935 },
          assumption: { declared_by: "operator", note: "assumed" },
        },
      }),
      entity("M", { position_uncertainty: { basis: "mixed", cov_en_m2: { ee: 100, en: 0, nn: 100 }, mixture: { measured: 1, assumed: 0, unreported: 1 } } }),
      entity("X"),
    );
    const bases = Object.fromEntries(regionFeatures(state, 0.95, null, new RingCache()).features.map((f) => [f.properties.id, f.properties.basis]));
    expect(bases).toEqual({ A: "assumed", M: "mixed", X: "measured" });
  });
});

describe("affiliation", () => {
  it("renders the symbol code Vigilans sent, unchanged", () => {
    const e = entity("E2", { affiliation: { identity: "hostile", basis: "library", reasons: ["syn.bravo"] }, symbol: { sidc: "SHGP-----------" } });
    expect(parseIconKey(iconKey(entityIcon(e)))?.sidc).toBe("SHGP-----------");
  });

  it("badges declared affiliations with their basis and leaves the default unbadged", () => {
    const declared = entityIcon(entity("A", { affiliation: { identity: "friend", basis: "operator", reasons: ["own"] }, symbol: { sidc: "SFGP-----------" } }));
    const library = entityIcon(entity("B", { affiliation: { identity: "suspect", basis: "library", reasons: ["syn"] }, symbol: { sidc: "SSGP-----------" } }));
    const nobody = entityIcon(entity("C"));
    expect([declared.basis, library.basis, nobody.basis]).toEqual(["O", "L", ""]);
  });

  it("reads the standard identity from a 2525C code", () => {
    expect(sidcIdentity("SHGP-----------")).toBe("hostile");
    expect(sidcIdentity("SAGP-----------")).toBe("assumed_friend");
    expect(sidcIdentity("SJGP-----------")).toBeUndefined(); // joker: exercise only, not in v0
  });
});
