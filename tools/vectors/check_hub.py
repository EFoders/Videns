"""The scenario editor's gate for scenario.v2 (VIDENS_SPEC.md 16.6), run against vigilans-hub
itself: a scenario drawn and saved in the editor passes the contract's validator, loads in
the hub, simulates, and its emitters are where the editor drew them at every sampled time,
switched on exactly when the editor said.

  check_hub.py <scenario.yaml> <expected.json>

expected.json (written by the editor's browser test) holds, per emitter, where the editor's
preview put it at sampled times, and its active windows:
  {"emitters": {"E2": {"samples": [{"t_s": 0, "lat": .., "lon": ..}, ...], "windows": [[0, 60]]}}}

Run in a container with Vigilans 2.0 mounted read-only at /v2:
  docker run --rm -v "<Videns>":/w -v "<Vigilans 2.0>":/v2:ro -w /w python:3.13-slim sh -c \
    "pip install -q numpy pyproj pyyaml aiohttp jsonschema rfc3339-validator && \
     PYTHONPATH=/v2/contract/src:/v2/vigilans/src:/v2/hub/src python tools/vectors/check_hub.py <scenario.yaml> <expected.json>"
"""

import json
import sys
from pathlib import Path

import yaml
from pyproj import Geod

from vigilans_contract import validate_scenario
from vigilans_hub.world import _switched_on, load_world, simulate, truth_position

TOLERANCE_M = 1.0
GEOD = Geod(ellps="WGS84")


def main(scenario_path: str, expected_path: str) -> int:
    raw = yaml.safe_load(Path(scenario_path).read_text(encoding="utf-8"))
    result = validate_scenario(raw)
    print(f"contract validator: {'ok' if result.ok else result.summary()}")
    if not result.ok:
        print("GATE FAILED")
        return 1

    world = load_world(Path(scenario_path))
    print(f"loaded {scenario_path} in vigilans-hub: {world.name}, {len(world.sources)} sources, "
          f"{len(world.sensors)} sensors, {len(world.emitters)} emitters")
    records, _truth = simulate(world)
    print(f"simulated: {len(records)} observation records")

    expected = json.loads(Path(expected_path).read_text(encoding="utf-8"))
    failures = 0 if records else 1
    for emitter_id, spec in expected["emitters"].items():
        emitter = next((e for e in world.emitters if e["id"] == emitter_id), None)
        if emitter is None:
            print(f"FAIL {emitter_id}: not in the scenario")
            failures += 1
            continue
        for sample in spec["samples"]:
            t = float(sample["t_s"])
            lat, lon, _ = truth_position(world, emitter_id, t)
            _, _, distance = GEOD.inv(sample["lon"], sample["lat"], lon, lat)
            verdict = "ok  " if distance <= TOLERANCE_M else "FAIL"
            failures += distance > TOLERANCE_M
            print(f"{verdict} {emitter_id} at {t:7.1f} s: hub {lat:.6f}, {lon:.6f}; drawn {sample['lat']:.6f}, {sample['lon']:.6f}; {distance:.3f} m apart")
        windows = spec.get("windows")
        if windows is not None:
            for t in [s["t_s"] for s in spec["samples"]]:
                expected_on = any(a <= t < b for a, b in windows) if windows else True
                if _switched_on(emitter, t) != expected_on:
                    print(f"FAIL {emitter_id} at {t} s: hub switched {'on' if not expected_on else 'off'}, editor said {'on' if expected_on else 'off'}")
                    failures += 1
            print(f"ok   {emitter_id} switched on exactly in {windows}")
    print("GATE PASSED" if failures == 0 else f"GATE FAILED: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
