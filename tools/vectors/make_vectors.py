"""Reference geodesic values for Videns' geometry tests (VIDENS_SPEC.md section 10).

Generated with Python geographiclib -- the library Vigilans uses -- so the TypeScript
geometry is checked against an independent implementation rather than against itself.
The ellipse construction is written out again here from its definition, not ported from
the TypeScript: a convention slip in either (sin for cos, anticlockwise for clockwise)
makes the two disagree.

Run in a container:
  docker run --rm -v "$PWD":/w -w /w python:3.13-slim \
    sh -c "pip install -q geographiclib==2.0 && python tools/vectors/make_vectors.py"
"""

import json
import math

from geographiclib.geodesic import Geodesic

WGS84 = Geodesic.WGS84
MASK = Geodesic.STANDARD | Geodesic.LONG_UNROLL

# Where the prototype's planar-angle bias hid: at the frame centre it was invisible.
POINTS = {
    "neutral_origin": (50.0, -105.0),
    "50km_north": (50.4497, -105.0),
    "60N": (60.0, 10.0),
    "equator": (0.5, 30.0),
    "antimeridian": (10.0, 179.995),
    "southern": (-45.0, 170.0),
}
AZIMUTHS = [0.0, 30.0, 90.0, 135.0, 200.0, 315.0]
DISTANCES = [1_000.0, 50_000.0]


def direct(lat, lon, azi, s):
    r = WGS84.Direct(lat, lon, azi, s, MASK)
    return r["lat2"], r["lon2"]


def ellipse_ring(lat, lon, a, b, orientation_deg, n):
    """Vertex i at parametric angle 2*pi*i/n: a*cos along the major axis, b*sin along the
    minor axis, which is a quarter turn clockwise of the major. Placed by exact geodesic
    distance and azimuth from the centre."""
    th = math.radians(orientation_deg)
    ring = []
    for i in range(n):
        t = 2 * math.pi * i / n
        along, across = a * math.cos(t), b * math.sin(t)
        # Major axis at azimuth th -> (east, north) = (sin th, cos th).
        # Minor axis at azimuth th + 90 -> (sin(th+90), cos(th+90)) = (cos th, -sin th).
        east = along * math.sin(th) + across * math.cos(th)
        north = along * math.cos(th) - across * math.sin(th)
        dist = math.hypot(east, north)
        azi = math.degrees(math.atan2(east, north))
        lat2, lon2 = direct(lat, lon, azi, dist) if dist > 0 else (lat, lon)
        ring.append([lon2, lat2])
    return ring


def main():
    vectors = {"model": "WGS84, geographiclib (Karney), LONG_UNROLL", "direct": [], "inverse": [], "ellipses": [], "lines": []}
    for name, (lat, lon) in POINTS.items():
        for azi in AZIMUTHS:
            for s in DISTANCES:
                lat2, lon2 = direct(lat, lon, azi, s)
                vectors["direct"].append({"from": name, "lat1": lat, "lon1": lon, "azi1": azi, "s12": s, "lat2": lat2, "lon2": lon2})
        for other, (lat2, lon2) in POINTS.items():
            if other == name:
                continue
            r = WGS84.Inverse(lat, lon, lat2, lon2)
            vectors["inverse"].append({"from": name, "to": other, "lat1": lat, "lon1": lon, "lat2": lat2, "lon2": lon2, "s12": r["s12"], "azi1": r["azi1"] % 360})
        for a, b, orientation in [(1000.0, 400.0, 30.0), (250.0, 250.0, 0.0), (5000.0, 800.0, 117.5)]:
            vectors["ellipses"].append(
                {"at": name, "lat": lat, "lon": lon, "semi_major_m": a, "semi_minor_m": b, "orientation_deg": orientation, "vertices": 72,
                 "ring": ellipse_ring(lat, lon, a, b, orientation, 72)}
            )
        # A 50 km line of bearing, sampled: the Phase 3 gate is 1 m at 50 km.
        for azi in (45.0, 250.0):
            line = WGS84.Line(lat, lon, azi, MASK | Geodesic.DISTANCE_IN)
            samples = [line.Position(50_000.0 * k / 16, MASK) for k in range(17)]
            vectors["lines"].append(
                {"from": name, "lat": lat, "lon": lon, "azimuth_deg": azi, "length_m": 50_000.0,
                 "points": [[p["lon2"], p["lat2"]] for p in samples]}
            )
    with open("tests/vectors/geodesic.json", "w", encoding="utf-8") as f:
        # allow_nan=False: a NaN here is a generator bug, and JSON cannot carry it anyway.
        json.dump(vectors, f, indent=1, allow_nan=False)
        f.write("\n")
    print(f"wrote {len(vectors['direct'])} direct, {len(vectors['inverse'])} inverse, {len(vectors['ellipses'])} ellipses, {len(vectors['lines'])} lines")


if __name__ == "__main__":
    main()
