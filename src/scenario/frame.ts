// The scenario's local frame: east/north metres from the origin in a WGS84 azimuthal
// equidistant projection -- exactly what the prototype's LocalFrame (pyproj, ADR-0006)
// does: a point's local offset is its geodesic distance and azimuth from the origin.
// Tested against the prototype's own values (tests/vectors/scenario.json).

import { geodesicDirect, geodesicInverse } from "../geo/geodesic.ts";

export interface Origin {
  lat: number;
  lon: number;
}

/** A latitude and longitude as [east, north] metres from the origin. */
export function toLocal(origin: Origin, lat: number, lon: number): [number, number] {
  const { distanceM, azimuthDeg } = geodesicInverse(origin.lat, origin.lon, lat, lon);
  if (distanceM === 0) return [0, 0];
  const rad = (azimuthDeg * Math.PI) / 180;
  return [distanceM * Math.sin(rad), distanceM * Math.cos(rad)];
}

/** [east, north] metres from the origin as a latitude and longitude. */
export function toLatLon(origin: Origin, east: number, north: number): { lat: number; lon: number } {
  const distance = Math.hypot(east, north);
  if (distance === 0) return { lat: origin.lat, lon: origin.lon };
  const p = geodesicDirect(origin.lat, origin.lon, (Math.atan2(east, north) * 180) / Math.PI, distance);
  return { lat: p.lat, lon: ((((p.lon + 180) % 360) + 360) % 360) - 180 };
}

/** Re-express a local point in another origin's frame, keeping it where it is on the ground. */
export function reframe(from: Origin, to: Origin, point: readonly number[]): [number, number] {
  const p = toLatLon(from, point[0]!, point[1]!);
  return toLocal(to, p.lat, p.lon);
}

/** Round to a centimetre: finer than any placement, and keeps files readable. */
export function roundPoint(p: readonly number[]): [number, number] {
  return [Math.round(p[0]! * 100) / 100, Math.round(p[1]! * 100) / 100];
}
