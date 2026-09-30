"""The scenario editor's gate (VIDENS_SPEC.md 16.6), run against the Vigilans prototype
itself: a scenario drawn in the editor and exported for the prototype loads with the
prototype's own loader, runs in its simulator, and its emitters are where they were drawn.

  check_prototype.py <exported.yaml> <expected.json>

expected.json (written by the editor's browser test) holds, per emitter, where it was
clicked on the map and where the editor's preview put it at sampled times:
  {"emitters": {"E1": {"samples": [{"t_s": 0, "lat": .., "lon": ..}, ...]}}}

Run in a container with the prototype mounted read-only at /proto:
  docker run --rm -v "<Videns>":/w -v "<prototype>":/proto:ro -w /w python:3.13-slim sh -c \
    "pip install -q numpy scipy 'pydantic>=2' pyproj pyyaml && \
     PYTHONPATH=/proto/src python tools/vectors/check_prototype.py <exported.yaml> <expected.json>"
"""

import json
import sys
from pathlib import Path

from pyproj import Geod

from vigilans.scenarios import load_scenario
from vigilans.sim.runner import CollectingTruthSink, SimulationRunner

TOLERANCE_M = 1.0
GEOD = Geod(ellps="WGS84")


def main(exported: str, expected_path: str) -> int:
    scenario = load_scenario(Path(exported))
    print(f"loaded {exported} with the prototype's loader: {scenario.name}, "
          f"{len(scenario.sensors)} sensors, {len(scenario.emitters)} emitters")

    sink = CollectingTruthSink()
    detections = SimulationRunner(scenario, truth_sink=sink).run()
    print(f"ran the prototype's simulator: {len(detections)} detections, {len(sink.truth.emitters)} truth states")

    start = min(state.t for state in sink.truth.emitters)
    by_emitter: dict[str, dict[float, tuple[float, float]]] = {}
    for state in sink.truth.emitters:
        by_emitter.setdefault(state.emitter_id, {})[round((state.t - start).total_seconds(), 6)] = (state.lat, state.lon)

    expected = json.loads(Path(expected_path).read_text(encoding="utf-8"))
    failures = 0
    for emitter_id, spec in expected["emitters"].items():
        states = by_emitter.get(emitter_id)
        if not states:
            print(f"FAIL {emitter_id}: not in the simulator's truth")
            failures += 1
            continue
        for sample in spec["samples"]:
            t = round(float(sample["t_s"]), 6)
            if t not in states:
                print(f"FAIL {emitter_id}: no truth state at {t} s")
                failures += 1
                continue
            lat, lon = states[t]
            _, _, distance = GEOD.inv(sample["lon"], sample["lat"], lon, lat)
            verdict = "ok  " if distance <= TOLERANCE_M else "FAIL"
            failures += distance > TOLERANCE_M
            print(f"{verdict} {emitter_id} at {t:7.1f} s: simulator {lat:.6f}, {lon:.6f}; drawn {sample['lat']:.6f}, {sample['lon']:.6f}; {distance:.3f} m apart")
    print("GATE PASSED" if failures == 0 else f"GATE FAILED: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
