// Every entity on screen, sortable and filterable (VIDENS_SPEC.md 8.5). Selecting a row
// selects on the map. Filters narrow what is listed; they never hide anything on the map.

import { useMemo, useState } from "preact/hooks";

import { select, selection, shown } from "../app/state.ts";
import type { Entity } from "../contract/generated/picture.ts";
import { IDENTITIES, IDENTITY_LABEL } from "../contract/identity.ts";
import { symbolDataUrl } from "../map/symbols.ts";
import { clock, frequency } from "./format.ts";

type SortKey = "id" | "state" | "identity" | "class" | "uncertainty" | "freq" | "last";

const STATES: Entity["state"][] = ["tentative", "confirmed", "coasting", "retired"];
const BASES = ["measured", "assumed", "mixed", "unreported"] as const;

function leading(e: Entity): string {
  return e.classification.candidates?.[0]?.wording ?? "Unclassified";
}

const SORTERS: Record<SortKey, (a: Entity, b: Entity) => number> = {
  id: (a, b) => a.entity_id.localeCompare(b.entity_id, undefined, { numeric: true }),
  state: (a, b) => a.state.localeCompare(b.state),
  identity: (a, b) => IDENTITIES.indexOf(a.affiliation.identity) - IDENTITIES.indexOf(b.affiliation.identity),
  class: (a, b) => leading(a).localeCompare(leading(b)),
  uncertainty: (a, b) => (a.position_uncertainty?.basis ?? "").localeCompare(b.position_uncertainty?.basis ?? ""),
  freq: (a, b) => a.freq_hz - b.freq_hz,
  last: (a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen),
};

export function EntityList() {
  const [text, setText] = useState("");
  const [state, setState] = useState("");
  const [identity, setIdentity] = useState("");
  const [basis, setBasis] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sort, setSort] = useState<SortKey>("id");
  const picture = shown.value;
  const entities = [...picture.entities.values()];
  const sources = useMemo(() => [...new Set(entities.flatMap((e) => e.sources.map((s) => s.source_id)))].sort(), [picture]);

  const needle = text.trim().toLowerCase();
  const rows = entities
    .filter((e) => !state || e.state === state)
    .filter((e) => !identity || e.affiliation.identity === identity)
    .filter((e) => !basis || e.position_uncertainty?.basis === basis)
    .filter((e) => !sourceId || e.sources.some((s) => s.source_id === sourceId))
    .filter((e) => !needle || `${e.entity_id} ${e.label ?? ""} ${leading(e)} ${e.classification.candidates?.[0]?.class ?? ""}`.toLowerCase().includes(needle))
    .sort(SORTERS[sort]);

  const header = (key: SortKey, label: string) => (
    <th>
      <button type="button" class={`sort${sort === key ? " sort--on" : ""}`} onClick={() => setSort(key)}>
        {label}
      </button>
    </th>
  );

  return (
    <div class="entities">
      <div class="filters">
        <input type="search" placeholder="Search id or class" value={text} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} aria-label="Search entities" />
        <select value={state} onChange={(e) => setState((e.currentTarget as HTMLSelectElement).value)} aria-label="Filter by state">
          <option value="">Any state</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={identity} onChange={(e) => setIdentity((e.currentTarget as HTMLSelectElement).value)} aria-label="Filter by affiliation">
          <option value="">Any affiliation</option>
          {IDENTITIES.map((i) => (
            <option key={i} value={i}>
              {IDENTITY_LABEL[i]}
            </option>
          ))}
        </select>
        <select value={basis} onChange={(e) => setBasis((e.currentTarget as HTMLSelectElement).value)} aria-label="Filter by uncertainty basis">
          <option value="">Any uncertainty</option>
          {BASES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={sourceId} onChange={(e) => setSourceId((e.currentTarget as HTMLSelectElement).value)} aria-label="Filter by source">
          <option value="">Any source</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <p class="muted">
        {rows.length} of {entities.length} entities
      </p>
      <table class="table table--entities">
        <thead>
          <tr>
            <th />
            {header("id", "Id")}
            {header("state", "State")}
            {header("identity", "Affiliation")}
            {header("class", "Assessment")}
            {header("uncertainty", "Uncert.")}
            {header("freq", "Freq")}
            {header("last", "Heard")}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const selected = selection.value?.kind === "entity" && selection.value.id === e.entity_id;
            return (
              <tr key={e.entity_id} class={selected ? "row--selected" : ""} onClick={() => select({ kind: "entity", id: e.entity_id })}>
                <td>
                  <img src={symbolDataUrl(e.symbol.sidc, 14)} alt="" class="entities__symbol" />
                </td>
                <td>{e.label ?? e.entity_id}</td>
                <td>{e.state}</td>
                <td>
                  {IDENTITY_LABEL[e.affiliation.identity]}
                  {e.affiliation.basis !== "default" && <span class="muted"> ({e.affiliation.basis})</span>}
                </td>
                <td>{leading(e)}</td>
                <td>{e.position_uncertainty?.basis ?? "no fix"}</td>
                <td>{frequency(e.freq_hz)}</td>
                <td>{clock(e.last_seen)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
