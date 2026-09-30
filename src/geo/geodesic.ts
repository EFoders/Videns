// The one place Videns touches the geodesic library: WGS84, Karney's algorithms, the same
// model as Python's geographiclib on the Vigilans side.

import geographiclib from "geographiclib-geodesic";

const { Geodesic } = geographiclib;
const WGS84 = Geodesic.WGS84;
const DIRECT_MASK = Geodesic.STANDARD | Geodesic.LONG_UNROLL;

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** The point `distanceM` from (lat, lon) along the geodesic leaving at `azimuthDeg` true. */
export function geodesicDirect(lat: number, lon: number, azimuthDeg: number, distanceM: number): GeoPoint {
  const r = WGS84.Direct(lat, lon, azimuthDeg, distanceM, DIRECT_MASK);
  return { lat: r.lat2!, lon: r.lon2! };
}

export interface Inverse {
  distanceM: number;
  /** Azimuth at the first point, degrees true in [0, 360). */
  azimuthDeg: number;
}

export function geodesicInverse(lat1: number, lon1: number, lat2: number, lon2: number): Inverse {
  const r = WGS84.Inverse(lat1, lon1, lat2, lon2);
  return { distanceM: r.s12!, azimuthDeg: ((r.azi1! % 360) + 360) % 360 };
}
