"""Reference values for the scenario editor's scenario.v2 motion, from vigilans-hub itself
(Vigilans 2.0 hub/src/vigilans_hub/world.py): position_en with waypoint holds and loops, and
_switched_on for active windows. The editor's motion.ts is checked against these, so what
the editor draws is what the hub will simulate.

Run in a container with Vigilans 2.0 mounted read-only at /v2:
  docker run --rm -v "<Videns>":/w -v "<Vigilans 2.0>":/v2:ro -w /w python:3.13-slim sh -c \
    "pip install -q numpy pyproj pyyaml aiohttp jsonschema rfc3339-validator && \
     PYTHONPATH=/v2/contract/src:/v2/vigilans/src:/v2/hub/src python tools/vectors/make_hub_vectors.py"
"""

import json

from vigilans_hub.world import _switched_on, position_en

EMITTERS = {
    "static_with_hold": {"path_m": [[2000, 4000, 30]], "speed_mps": 0.0},
    "hold_then_leg": {"path_m": [[0, 0, 300], [3600, 6235]], "speed_mps": 8.0},
    "holds_everywhere": {"path_m": [[0, 0, 20], [1000, 0, 45], [1000, 1000, 10], [0, 1000]], "speed_mps": 12.5},
    "last_hold": {"path_m": [[0, 0], [5000, 0, 120], [5000, 5000]], "speed_mps": 25.0},
    "final_hold": {"path_m": [[0, 0], [2000, 0, 60]], "speed_mps": 10.0},
    "loop_holds": {"path_m": [[0, 0, 15], [4000, 0], [4000, 3000, 40]], "speed_mps": 10.0, "loop": True},
    "loop_closed_hold": {"path_m": [[0, 0, 5], [4000, 0, 5], [0, 0]], "speed_mps": 7.0, "loop": True},
    "loop_no_holds": {"path_m": [[0, 0], [4000, 0], [4000, 3000]], "speed_mps": 10.0, "loop": True},
}
TIMES = [0.0, 1.0, 14.9, 15.0, 37.5, 100.0, 299.0, 300.0, 333.3, 600.0, 1234.5, 5000.0]

WINDOWS = {
    "none": None,
    "one": [[60, 300]],
    "two": [[0, 30], [100, 160.5]],
}
WINDOW_TIMES = [0.0, 29.9, 30.0, 59.9, 60.0, 100.0, 160.4, 160.5, 299.9, 300.0, 1000.0]


def main():
    motion = []
    for name, spec in EMITTERS.items():
        emitter = {"id": name, "freq_hz": 45.0e6, "bandwidth_hz": 25.0e3, **spec}
        for t in TIMES:
            east, north = position_en(emitter, t)
            motion.append({"emitter": name, **spec, "loop": spec.get("loop", False), "t_s": t,
                           "east_m": float(east), "north_m": float(north)})
    windows = []
    for name, spec in WINDOWS.items():
        emitter = {"id": name, **({"active_windows_s": spec} if spec else {})}
        for t in WINDOW_TIMES:
            windows.append({"case": name, "active_windows_s": spec, "t_s": t, "on": _switched_on(emitter, t)})
    with open("tests/vectors/hub-motion.json", "w", encoding="utf-8") as f:
        json.dump({"source": "vigilans-hub world.position_en and _switched_on", "motion": motion, "windows": windows},
                  f, indent=1, allow_nan=False)
        f.write("\n")
    print(f"wrote {len(motion)} motion and {len(windows)} window vectors")


if __name__ == "__main__":
    main()
