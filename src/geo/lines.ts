// Lines of bearing and their error wedges, as geodesics (VIDENS_SPEC.md rule 4, 8.3).
//
// A bearing is a geodesic azimuth, so its line is a geodesic: sampled along the curve,
// never drawn as a straight line in Web Mercator. At 50 km and 60 degrees north that
// shortcut is tens of metres wrong -- the rendering twin of the prototype's 15 m bias.

import { geodesicDirect, geodesicInverse } from "./geodesic.ts";

export const LINE_SAMPLES = 16;

/** Points along the geodesic leaving (lat, lon) at azimuthDeg, for lengthM metres, as [lon, lat]. */
export function geodesicLine(lat: number, lon: number, azimuthDeg: number, lengthM: number, samples = LINE_SAMPLES): [number, number][] {
  const points: [number, number][] = [];
  for (let k = 0; k <= samples; k++) {
    const p = k === 0 ? { lat, lon } : geodesicDirect(lat, lon, azimuthDeg, (lengthM * k) / samples);
    points.push([p.lon, p.lat]);
  }
  return points;
}

/** The geodesic between two points, sampled, as [lon, lat]. */
export function geodesicBetween(lat1: number, lon1: number, lat2: number, lon2: number, samples = LINE_SAMPLES): [number, number][] {
  const { distanceM, azimuthDeg } = geodesicInverse(lat1, lon1, lat2, lon2);
  return geodesicLine(lat1, lon1, azimuthDeg, distanceM, samples);
}

/**
 * The +/- sigma wedge around a bearing: two geodesic edges and the arc joining their far
 * ends at the same range. A closed ring of [lon, lat].
 */
export function bearingWedge(lat: number, lon: number, azimuthDeg: number, sigmaDeg: number, lengthM: number): [number, number][] {
  const left = geodesicLine(lat, lon, azimuthDeg - sigmaDeg, lengthM);
  const right = geodesicLine(lat, lon, azimuthDeg + sigmaDeg, lengthM);
  const arc: [number, number][] = [];
  const steps = Math.max(2, Math.ceil(sigmaDeg * 2));
  for (let k = 1; k < steps; k++) {
    const p = geodesicDirect(lat, lon, azimuthDeg - sigmaDeg + (2 * sigmaDeg * k) / steps, lengthM);
    arc.push([p.lon, p.lat]);
  }
  return [...left, ...arc, ...right.reverse(), left[0]!];
}
