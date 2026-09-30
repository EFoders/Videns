// Uncertainty regions, in metres on the WGS84 ellipsoid (VIDENS_SPEC.md rule 4).
//
// An ellipse is traced in the azimuthal-equidistant frame about its centre -- the same
// construction the prototype used for CoT polygons -- where each vertex is an exact
// geodesic distance and azimuth from the centre. Vertices go through Karney's direct
// solution, so the ring is right far from any frame origin, at high latitude, and across
// the antimeridian. Nothing here works in screen pixels or Mercator metres.

import type { CovarianceEN, Ellipse, PositionUncertainty } from "../contract/generated/picture.ts";
import { geodesicDirect } from "./geodesic.ts";

export const RING_VERTICES = 72;

/** Probability mass inside the 1-sigma ellipse of a 2D Gaussian: 1 - exp(-1/2). */
export const ONE_SIGMA_2D = 1 - Math.exp(-0.5);

/** Mahalanobis radius of the ellipse containing probability p of a 2D Gaussian. */
export function sigmaScale(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`confidence must be in (0, 1), got ${p}`);
  return Math.sqrt(-2 * Math.log(1 - p));
}

export interface EllipseAxes {
  semiMajorM: number;
  semiMinorM: number;
  /** Major axis, degrees true, in [0, 180). */
  orientationDeg: number;
  confidence: number;
}

/** The 1-sigma ellipse of an east/north covariance. */
export function covarianceToEllipse(cov: CovarianceEN): EllipseAxes {
  const { ee, en, nn } = cov;
  const mean = (ee + nn) / 2;
  const radius = Math.hypot((ee - nn) / 2, en);
  const major = mean + radius;
  const minor = Math.max(mean - radius, 0);
  // Angle of the major axis from east, anticlockwise; then turn it into an azimuth.
  const fromEast = 0.5 * Math.atan2(2 * en, ee - nn);
  return {
    semiMajorM: Math.sqrt(major),
    semiMinorM: Math.sqrt(minor),
    orientationDeg: normaliseAxis(90 - (fromEast * 180) / Math.PI),
    confidence: ONE_SIGMA_2D,
  };
}

/** Rescale an ellipse from the probability it was given at to another. */
export function atConfidence(axes: EllipseAxes, confidence: number): EllipseAxes {
  const factor = sigmaScale(confidence) / sigmaScale(axes.confidence);
  return {
    semiMajorM: axes.semiMajorM * factor,
    semiMinorM: axes.semiMinorM * factor,
    orientationDeg: axes.orientationDeg,
    confidence,
  };
}

/**
 * The ellipse to draw for an uncertainty at the chosen confidence, or undefined when
 * there is nothing honest to draw: an unreported uncertainty has no region (rule 2).
 */
export function drawableEllipse(u: PositionUncertainty, confidence: number): EllipseAxes | undefined {
  if (u.basis === "unreported") return undefined;
  const base = u.cov_en_m2 ? covarianceToEllipse(u.cov_en_m2) : u.ellipse ? fromContract(u.ellipse) : undefined;
  return base ? atConfidence(base, confidence) : undefined;
}

/** The east/north covariance of an ellipse, at 1-sigma. */
export function ellipseToCovariance(axes: EllipseAxes): CovarianceEN {
  const one = atConfidence(axes, ONE_SIGMA_2D);
  const th = (one.orientationDeg * Math.PI) / 180;
  const a2 = one.semiMajorM ** 2;
  const b2 = one.semiMinorM ** 2;
  const s = Math.sin(th);
  const c = Math.cos(th);
  return { ee: a2 * s * s + b2 * c * c, nn: a2 * c * c + b2 * s * s, en: (a2 - b2) * s * c };
}

/**
 * Whether an east/north offset from the centre lies inside the region drawn at
 * `confidence`: its squared Mahalanobis distance against the chi-square bound. Null when
 * there is no region to be inside -- an unreported uncertainty, or a degenerate one.
 */
export function insideRegion(u: PositionUncertainty, eastM: number, northM: number, confidence: number): boolean | null {
  if (u.basis === "unreported") return null;
  const cov = u.cov_en_m2 ?? (u.ellipse ? ellipseToCovariance(fromContract(u.ellipse)) : undefined);
  if (!cov) return null;
  const det = cov.ee * cov.nn - cov.en * cov.en;
  if (!(det > 0)) return null;
  const d2 = (cov.nn * eastM * eastM - 2 * cov.en * eastM * northM + cov.ee * northM * northM) / det;
  return d2 <= sigmaScale(confidence) ** 2;
}

function fromContract(e: Ellipse): EllipseAxes {
  return {
    semiMajorM: e.semi_major_m,
    semiMinorM: e.semi_minor_m,
    orientationDeg: normaliseAxis(e.orientation_deg),
    confidence: e.confidence,
  };
}

/**
 * A closed ring of [lon, lat] vertices. Vertex 0 lies semiMajorM from the centre along
 * orientationDeg. Longitudes are unrolled, so a ring that crosses the antimeridian stays
 * continuous (e.g. 179.9 -> 180.1) instead of jumping across the map.
 */
export function ellipseRing(lat: number, lon: number, axes: EllipseAxes, vertices = RING_VERTICES): [number, number][] {
  if (vertices < 3) throw new RangeError(`an ellipse needs at least 3 vertices, got ${vertices}`);
  const theta = (axes.orientationDeg * Math.PI) / 180;
  // Unit vectors in (east, north): the major axis at azimuth theta, the minor a quarter turn clockwise.
  const majorE = Math.sin(theta);
  const majorN = Math.cos(theta);
  const minorE = Math.cos(theta);
  const minorN = -Math.sin(theta);

  const ring: [number, number][] = [];
  for (let i = 0; i < vertices; i++) {
    const angle = (2 * Math.PI * i) / vertices;
    const along = axes.semiMajorM * Math.cos(angle);
    const across = axes.semiMinorM * Math.sin(angle);
    const east = along * majorE + across * minorE;
    const north = along * majorN + across * minorN;
    const distance = Math.hypot(east, north);
    if (distance === 0) {
      ring.push([lon, lat]);
      continue;
    }
    const azimuth = (Math.atan2(east, north) * 180) / Math.PI;
    const end = geodesicDirect(lat, lon, azimuth, distance);
    ring.push([end.lon, end.lat]);
  }
  ring.push(ring[0]!);
  return ring;
}

function normaliseAxis(deg: number): number {
  const d = ((deg % 180) + 180) % 180;
  return d === 180 ? 0 : d;
}
