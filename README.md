# Videns

A lightweight live map of the Vigilans picture: who is transmitting, with what affiliation
and uncertainty, why Vigilans thinks so, which entities are operating together, how that
changed over time — and, for any object, the exact CoT Vigilans built for it. The
specification is `../specs/VIDENS_SPEC.md`.

**Status: Phases 0–4 complete (2026-09-30), paused until Vigilans publishes the picture.**
Until then Videns runs against a mock feed that plays a synthetic scenario live. Everything
is synthetic, at an arbitrary neutral origin.

## Run it

Docker is the only requirement; nothing is installed on the host.

```bash
docker compose up --build
```

Then open <http://127.0.0.1:8080>. Ports bind to loopback only: v1 has no authentication.

| Want | Do |
|---|---|
| Faster picture | `MOCK_RATE=4 docker compose up --build` |
| Exercise diagnostics | `MOCK_FAULTS=malformed,gap,stall docker compose up --build` |
| No third-party requests | `VIDENS_BASEMAP=none docker compose up` (or mount a basemap list without online entries) |
| Unit tests | `docker compose run --rm test` |
| Browser tests | `docker compose --profile e2e up --build --abort-on-container-exit --exit-code-from e2e e2e` |
| Record a fixture | `docker compose run --rm test node tools/mock-feed/record.ts 300 1 fixtures/demo.picture.jsonl` |
| Regenerate geodesic vectors | see `tools/vectors/make_vectors.py` (runs in a Python container) |

## Using it

- **Live, and the past.** The map follows the live feed. Drag the timeline back to see any
  earlier moment of the run while the feed carries on; **Live** returns. **Save** writes the
  run so far as a `.picture.jsonl` recording.
- **Replay.** **Open…** or drag a `.picture.jsonl` onto the map (with its `.truth.jsonl` if
  there is one). Play at 0.25×–16×, step message by message, click a marker to jump to a
  merge, split, group change or notice.
- **Inspect.** Click a symbol, a group link or a departure note. Tabs: Summary, Evidence,
  CoT (Vigilans' bytes, published or withheld), Raw. The Entities tab lists and filters
  everything on screen.
- **Layers** (legend): trails; evidence (lines of bearing and reported positions) for the
  selection, everything, or off; group hypotheses; simulation truth (simulated runs only).
- **Basemap** (top right): Street, Terrain, Satellite (online — their tile servers see the
  area being viewed, and the status bar says so) or None. Check each provider's terms
  before any use beyond development.

## Scenario editor

<http://127.0.0.1:8080/editor.html> (or **Scenario editor** in the viewer's header): build
**Vigilans scenarios** — the simulator's input — on a map.

- **Tools** (keys in brackets): Select and drag (V), Sensor (S), Emitter (E) of the type and
  true side chosen beside the tools, Path (P) to click waypoints onto the selected emitter,
  Origin (O). Delete removes the selection; Esc returns to Select; Ctrl+Z / Ctrl+Y.
- **Properties**: every setting the simulator reads, in MHz and kHz, and only those that
  apply (a position system's receiver has no bearing error). An emitter's true side
  (friend, hostile, neutral, civilian, unknown) is truth only. Waypoint holds, switched-on
  windows, activity patterns (a periodic's first-transmission offset), net membership and a
  self-identification broadcast (Remote ID, ADS-B, AIS). Sensors join a source and may scan.
- **World**: sources (DF nets and position-reporting systems, with their reporting honesty,
  biases, coverage records and deliberate faults, and the operator's declaration for each),
  all objects, nets and true relations (for scoring grouping). **Issues**: what vigilans-hub
  would refuse, and warnings such as an emitter no sensor can hear.
- **Preview**: play the scenario to see where everything is when; the selected emitter
  shows each sensor's detection range and margin.
- **Save** writes `scenario.v2`, the Vigilans contract's format, which `vigilans-hub` runs
  as it stands. **Open** also takes the editor's older `scenario.v1` files and prototype
  scenarios, and lists anything that changed on the way. **Export for prototype** writes
  the prototype's format and lists anything dropped.

Emitter types come from `config/library/` (synthetic). Mount your own library over
`/etc/videns/library` — never commit it. Scenarios you make may describe real places and
parameters: they are saved to your computer only; keep them out of the repositories.

Checked against vigilans-hub itself: `tools/vectors/check_hub.py` validates a saved scenario
with the contract's validator, loads and simulates it in the hub, and compares every emitter
with where the editor drew it, and when it is switched on (the browser test writes
`test-results/editor-scenario.yaml` for it). `tools/vectors/check_prototype.py` does the same
for a prototype export. Both run by hand in a Python container; see each file's docstring.

`contract/scenario.v2.schema.json` is a copy of the Vigilans contract package's, the single
source of truth: `scripts/sync-contract.sh` refreshes it, and the scenario test fails on any
difference when `VIGILANS_CONTRACT_DIR` points at the package's schemas.

## Layout

```
contract/                     picture.v0, truth.v0; scenario.v2 (copied from the Vigilans contract package); scenario.v1 (read only, to open old files)
config/library/               the synthetic signature library the scenario editor offers
config/basemaps.json          the basemap list the image ships; the CSP is derived from it
src/contract/                 generated types and standalone validators (npm run gen), semantic checks
src/store/  src/geo/          pure: picture state, timeline, geodesic ellipses and lines
src/app/                      state, time, truth, files
src/feed/                     SSE client
src/map/  src/ui/             MapLibre, 2525 symbols, panels, CoT view, timeline, entity list
src/scenario/  src/editor/    scenario core (frame, motion, propagation, files, validation) and the editor page
tools/mock-feed/              synthetic scenario player (picture and truth) and recorder
tools/vectors/                Python: reference values and gates, run against the prototype and vigilans-hub themselves
fixtures/                     recordings, and invalid messages with the reason each must fail
tests/  tests/e2e/            unit tests; Playwright browser tests
nginx/  Dockerfile  compose.yaml
```

## Rules that shape the code

Videns displays and never decides; uncertainty is always drawn and never invented (an
unreported one gets a `?` and no region); affiliation is Vigilans', shown with its basis;
the CoT shown is Vigilans' bytes; a group is never surer than its members; a merge is shown
as a merge, not a vanishing symbol; truth is a separate channel and never pairs itself with
entities; a viewer with nothing to show says why. See spec §4.
