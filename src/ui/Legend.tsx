// The legend: what the frames, regions, lines and badges mean, the confidence level every
// drawn region is at (VIDENS_SPEC.md rule 3), and the layers the reader can switch.

import { useState } from "preact/hooks";

import { cursor, ellipseConfidence, evidenceMode, showHypotheses, showTrails } from "../app/state.ts";
import { setTruth, truthAvailability, truthOn } from "../app/truth.ts";
import { IDENTITIES, IDENTITY_LABEL, IDENTITY_SIDC_CHAR } from "../contract/identity.ts";
import { ONE_SIGMA_2D } from "../geo/ellipse.ts";
import { symbolDataUrl } from "../map/symbols.ts";
import { confidenceLabel, latLon } from "./format.ts";

const LEVELS = [ONE_SIGMA_2D, 0.5, 0.95];

export function Legend() {
  const [open, setOpen] = useState(true);
  const level = ellipseConfidence.value;
  const truth = truthAvailability.value;
  return (
    <aside class={`legend${open ? "" : " legend--closed"}`}>
      <button type="button" class="legend__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        Legend and layers
      </button>
      {open && (
        <div class="legend__body">
          <label class="legend__level">
            Regions contain
            <select value={String(level)} onChange={(e) => (ellipseConfidence.value = Number((e.currentTarget as HTMLSelectElement).value))}>
              {[...new Set([...LEVELS, level])].sort().map((p) => (
                <option key={p} value={String(p)}>
                  {confidenceLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <ul class="legend__identities">
            {IDENTITIES.map((identity) => (
              <li key={identity}>
                <img src={symbolDataUrl(`S${IDENTITY_SIDC_CHAR[identity]}GP-----------`, 16)} alt="" />
                {IDENTITY_LABEL[identity]}
              </li>
            ))}
          </ul>
          <ul class="legend__keys">
            <li>
              <span class="swatch swatch--solid" /> measured uncertainty
            </li>
            <li>
              <span class="swatch swatch--dashed" /> assumed or mixed
            </li>
            <li>
              <span class="badge badge--warn">?</span> unreported: no region drawn
            </li>
            <li>
              <span class="badge">L</span>
              <span class="badge">O</span> affiliation declared by library / operator
            </li>
            <li>
              <span class="swatch swatch--evidence" /> line of bearing, ±1σ wedge
            </li>
            <li>
              <span class="swatch swatch--group" /> group link: width and label give confidence
            </li>
            <li>
              <span class="swatch swatch--ghost" /> departed: merged or retired
            </li>
            {truthOn.value && (
              <li>
                <span class="truthmark" aria-hidden="true">
                  +
                </span>{" "}
                SIM TRUTH: where the simulator put it
              </li>
            )}
            <li class="muted">Faded: tentative or coasting</li>
          </ul>
          <fieldset class="legend__layers">
            <legend>Layers</legend>
            <label>
              <input type="checkbox" checked={showTrails.value} onChange={(e) => (showTrails.value = (e.currentTarget as HTMLInputElement).checked)} /> Trails
            </label>
            <label>
              Evidence
              <select value={evidenceMode.value} onChange={(e) => (evidenceMode.value = (e.currentTarget as HTMLSelectElement).value as typeof evidenceMode.value)}>
                <option value="selected">for the selection</option>
                <option value="all">for everything</option>
                <option value="off">off</option>
              </select>
            </label>
            <label title="Groups below Vigilans' publication threshold">
              <input type="checkbox" checked={showHypotheses.value} onChange={(e) => (showHypotheses.value = (e.currentTarget as HTMLInputElement).checked)} /> Group
              hypotheses
            </label>
            <label title={truth.available ? "Where the simulator put each emitter" : `Unavailable: ${truth.reason}`}>
              <input
                type="checkbox"
                checked={truthOn.value}
                disabled={!truth.available}
                onChange={(e) => setTruth((e.currentTarget as HTMLInputElement).checked)}
              />{" "}
              Simulation truth
            </label>
            {!truth.available && <div class="legend__why">Truth unavailable: {truth.reason}.</div>}
          </fieldset>
        </div>
      )}
      {cursor.value && <div class="legend__cursor">{latLon(cursor.value.lat, cursor.value.lon)}</div>}
    </aside>
  );
}
