// Ellipse arithmetic and geodesic tracing.
//
// Expectations here are closed-form values or independent geodesic facts, not re-runs of
// the code under test. Python geographiclib test vectors arrive in Phase 1 (spec 10).

import { describe, expect, it } from "vitest";

import {
  atConfidence,
  covarianceToEllipse,
  drawableEllipse,
  ellipseRing,
  ONE_SIGMA_2D,
  sigmaScale,
} from "../src/geo/ellipse.ts";
import { geodesicInverse } from "../src/geo/geodesic.ts";

describe("sigmaScale", () => {
  it("matches the chi-square quantiles for two degrees of freedom", () => {
    expect(sigmaScale(ONE_SIGMA_2D)).toBeCloseTo(1, 12);
    expect(sigmaScale(0.95)).toBeCloseTo(2.447746830680816, 12); // sqrt(5.991464547...)
    expect(sigmaScale(0.5)).toBeCloseTo(1.177410022515475, 12); // sqrt(2 ln 2)
  });

  it("refuses probabilities outside (0, 1)", () => {
    expect(() => sigmaScale(0)).toThrow(RangeError);
    expect(() => sigmaScale(1)).toThrow(RangeError);
  });
});

describe("covarianceToEllipse", () => {
  it("reads a north-elongated diagonal covariance as a north-pointing major axis", () => {
    const e = covarianceToEllipse({ ee: 100, en: 0, nn: 400 });
    expect(e.semiMajorM).toBeCloseTo(20, 9);
    expect(e.semiMinorM).toBeCloseTo(10, 9);
    expect(e.orientationDeg).toBeCloseTo(0, 9);
    expect(e.confidence).toBeCloseTo(ONE_SIGMA_2D, 12);
  });

  it("reads an east-elongated covariance as 90 degrees true, not 0", () => {
    // The trap: maths angles run anticlockwise from east; bearings run clockwise from north.
    const e = covarianceToEllipse({ ee: 400, en: 0, nn: 100 });
    expect(e.orientationDeg).toBeCloseTo(90, 9);
  });

  it("puts positive east-north correlation on the north-east diagonal", () => {
    // Variance 1 along 045 and 0 across it: ee = nn = en = 0.5.
    const e = covarianceToEllipse({ ee: 0.5, en: 0.5, nn: 0.5 });
    expect(e.orientationDeg).toBeCloseTo(45, 9);
    expect(e.semiMajorM).toBeCloseTo(1, 9);
    expect(e.semiMinorM).toBeCloseTo(0, 6);
  });

  it("puts negative correlation on the north-west diagonal (135 true)", () => {
    const e = covarianceToEllipse({ ee: 0.5, en: -0.5, nn: 0.5 });
    expect(e.orientationDeg).toBeCloseTo(135, 9);
  });

  it("round-trips a covariance built from known axes", () => {
    const a = 300;
    const b = 120;
    const th = (32 * Math.PI) / 180;
    const cov = {
      ee: a * a * Math.sin(th) ** 2 + b * b * Math.cos(th) ** 2,
      nn: a * a * Math.cos(th) ** 2 + b * b * Math.sin(th) ** 2,
      en: (a * a - b * b) * Math.sin(th) * Math.cos(th),
    };
    const e = covarianceToEllipse(cov);
    expect(e.semiMajorM).toBeCloseTo(a, 6);
    expect(e.semiMinorM).toBeCloseTo(b, 6);
    expect(e.orientationDeg).toBeCloseTo(32, 6);
  });

  it("survives a degenerate covariance", () => {
    const e = covarianceToEllipse({ ee: 0, en: 0, nn: 0 });
    expect(e.semiMajorM).toBe(0);
    expect(e.semiMinorM).toBe(0);
  });
});

describe("atConfidence", () => {
  it("scales a 1-sigma ellipse to 95 % by 2.4477", () => {
    const e = atConfidence({ semiMajorM: 100, semiMinorM: 40, orientationDeg: 10, confidence: ONE_SIGMA_2D }, 0.95);
    expect(e.semiMajorM).toBeCloseTo(244.7746830680816, 9);
    expect(e.semiMinorM).toBeCloseTo(97.90987322723264, 9);
    expect(e.orientationDeg).toBe(10);
  });

  it("is the identity at the ellipse's own confidence", () => {
    const e = atConfidence({ semiMajorM: 220, semiMinorM: 80, orientationDeg: 0, confidence: 0.95 }, 0.95);
    expect(e.semiMajorM).toBeCloseTo(220, 12);
  });
});

describe("drawableEllipse", () => {
  it("draws nothing for an unreported uncertainty (rule 2)", () => {
    expect(drawableEllipse({ basis: "unreported" }, 0.95)).toBeUndefined();
  });

  it("draws assumed and mixed uncertainties like measured ones; styling differs, geometry does not", () => {
    const assumed = drawableEllipse(
      {
        basis: "assumed",
        ellipse: { semi_major_m: 150, semi_minor_m: 150, orientation_deg: 0, confidence: ONE_SIGMA_2D },
        assumption: { declared_by: "operator", note: "150 m assumed" },
      },
      0.95,
    );
    expect(assumed?.semiMajorM).toBeCloseTo(150 * 2.447746830680816, 6);
  });
});

describe("ellipseRing", () => {
  const cases = [
    { name: "at the neutral origin", lat: 50, lon: -105 },
    { name: "50 km from it", lat: 50.45, lon: -105 },
    { name: "at 60 degrees north", lat: 60, lon: 10 },
    { name: "near the equator", lat: 0.5, lon: 30 },
  ];

  for (const c of cases) {
    it(`places every vertex at the right geodesic distance and azimuth ${c.name}`, () => {
      const axes = { semiMajorM: 1000, semiMinorM: 400, orientationDeg: 30, confidence: 0.95 };
      const ring = ellipseRing(c.lat, c.lon, axes, 72);
      expect(ring).toHaveLength(73);
      expect(ring[72]).toEqual(ring[0]);

      // Vertex 0 is the major-axis tip: 1000 m at 030 true, measured independently.
      const tip = geodesicInverse(c.lat, c.lon, ring[0]![1], ring[0]![0]);
      expect(tip.distanceM).toBeCloseTo(1000, 3);
      expect(tip.azimuthDeg).toBeCloseTo(30, 6);

      // Vertex 18 (a quarter turn) is the minor-axis tip: 400 m at 120 true.
      const side = geodesicInverse(c.lat, c.lon, ring[18]![1], ring[18]![0]);
      expect(side.distanceM).toBeCloseTo(400, 3);
      expect(side.azimuthDeg).toBeCloseTo(120, 6);
    });
  }

  it("is not a circle in degrees: a north-south ellipse at 60 N spans twice the longitude span of the same metres east-west", () => {
    // A metre of longitude at 60 N is half a metre of longitude at the equator. A ring
    // drawn in screen space or in raw degrees would get this wrong.
    const ring = ellipseRing(60, 10, { semiMajorM: 1000, semiMinorM: 1000, orientationDeg: 0, confidence: 0.95 }, 72);
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);
    const lonSpan = Math.max(...lons) - Math.min(...lons);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    expect(lonSpan / latSpan).toBeCloseTo(2, 1);
  });

  it("stays continuous across the antimeridian", () => {
    const ring = ellipseRing(10, 179.995, { semiMajorM: 2000, semiMinorM: 2000, orientationDeg: 0, confidence: 0.95 }, 36);
    const lons = ring.map(([lon]) => lon);
    expect(Math.max(...lons)).toBeGreaterThan(180);
    for (let i = 1; i < lons.length; i++) expect(Math.abs(lons[i]! - lons[i - 1]!)).toBeLessThan(0.1);
  });
});
