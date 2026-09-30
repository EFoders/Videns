"""Reference values for the scenario editor, from the Vigilans prototype's own code
(VIDENS_SPEC.md 16.6): its LocalFrame (pyproj azimuthal equidistant, ADR-0006) and its
simulator's position_at. The editor's frame and motion are checked against these, so
what the editor draws is what the simulator will do.

Run in a container with the prototype mounted read-only at /proto:
  docker run --rm -v "<Videns>":/w -v "<Vigilans prototype>":/proto:ro -w /w python:3.13-slim sh -c \
    "pip install -q numpy 'pydantic>=2' pyproj pyyaml && PYTHONPATH=/proto/src python tools/vectors/make_scenario_vectors.py"
"""

import json

from vigilans.geo import LocalFrame
from vigilans.models.scenario import EmitterSpec
from vigilans.sim.emitters import position_at

ORIGINS = {
    "neutral_origin": (50.0, -105.0),
    "60N": (60.0, 10.0),
    "southern": (-33.9, 151.2),
    "equator": (0.5, 30.0),
}
# East/north offsets, metres: near, far, and far enough that a planar shortcut would show.
OFFSETS = [(0.0, 0.0), (1000.0, 2000.0), (-12000.0, 7500.0), (45000.0, -30000.0), (0.0, 150000.0), (-120000.0, -90000.0)]

EMITTERS = {
    "static": {"path_m": [[2000, 4000]], "speed_mps": 0.0},
    "two_leg": {"path_m": [[2000, 4000], [11000, 6500]], "speed_mps": 15.0},
    "three_leg": {"path_m": [[0, 0], [5000, 0], [5000, 5000], [-3000, 8000]], "speed_mps": 22.5},
    "loop": {"path_m": [[0, 0], [4000, 0], [4000, 3000]], "speed_mps": 10.0, "loop": True},
    "loop_closed": {"path_m": [[0, 0], [4000, 0], [0, 0]], "speed_mps": 7.0, "loop": True},
}
TIMES = [0.0, 1.0, 37.5, 100.0, 333.3, 600.0, 1234.5, 5000.0]


def main():
    frames = []
    for name, (lat, lon) in ORIGINS.items():
        frame = LocalFrame(origin_lat=lat, origin_lon=lon)
        for east, north in OFFSETS:
            p_lat, p_lon = frame.to_latlon(east, north)
            back_e, back_n = frame.to_en(p_lat, p_lon)
            frames.append({"origin": name, "origin_lat": lat, "origin_lon": lon, "east_m": east, "north_m": north,
                           "lat": p_lat, "lon": p_lon, "round_trip_east_m": back_e, "round_trip_north_m": back_n})
    motion = []
    for name, spec in EMITTERS.items():
        emitter = EmitterSpec(id=name, freq_hz=45.0e6, bandwidth_hz=25.0e3, **spec)
        for t in TIMES:
            east, north = position_at(emitter, t)
            motion.append({"emitter": name, **spec, "loop": spec.get("loop", False), "t_s": t, "east_m": float(east), "north_m": float(north)})
    with open("tests/vectors/scenario.json", "w", encoding="utf-8") as f:
        json.dump({"source": "Vigilans prototype LocalFrame and position_at", "frames": frames, "motion": motion}, f, indent=1, allow_nan=False)
        f.write("\n")
    print(f"wrote {len(frames)} frame and {len(motion)} motion vectors")


if __name__ == "__main__":
    main()
