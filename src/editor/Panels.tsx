// The editor's other tabs: everything in the world at a glance, and the issues list.

import { IDENTITY_LABEL } from "../contract/identity.ts";
import { addNet, addRelation, addSource, declarationFor } from "../scenario/editing.ts";
import type { Source } from "../scenario/types.ts";
import { sourceKind, type ScenarioRef } from "../scenario/validate.ts";
import { commit, issues, scenario, select, selection } from "./state.ts";
import { SIDE_LABEL } from "./symbols.ts";

export function WorldPanel() {
  const s = scenario.value;
  const sel = selection.value;
  const is = (kind: string, id: string) => (sel && "id" in sel && sel.kind === kind && sel.id === id ? " row--selected" : "");
  const add = (kind: Source["kind"]) => {
    const { scenario: next, id } = addSource(s, kind);
    commit(next);
    select({ kind: "source", id });
  };
  return (
    <div class="world">
      <section class="section">
        <h3 class="section__title">
          Sources ({s.sources?.length ?? 0}){" "}
          <button type="button" class="button button--small" onClick={() => add("bearing")}>
            Add DF net
          </button>{" "}
          <button type="button" class="button button--small" onClick={() => add("position")}>
            Add position system
          </button>
        </h3>
        <p class="muted">The systems that report to Vigilans. Each sensor belongs to one; what the operator declares is declared per source.</p>
        {(s.sources ?? []).map((x) => {
          const declared = declarationFor(s, x.id);
          const count = s.sensors.filter((y) => y.source_id === x.id).length;
          return (
            <button key={x.id} type="button" class={`list-row${is("source", x.id)}`} onClick={() => select({ kind: "source", id: x.id })}>
              <strong>{x.id}</strong> {x.label && <span>{x.label}</span>}{" "}
              <span class="muted">
                {x.kind === "bearing" ? "bearings" : "positions"} · {count} sensor{count === 1 ? "" : "s"}
                {declared?.affiliation ? ` · declared ${IDENTITY_LABEL[declared.affiliation].toLowerCase()}` : ""}
              </span>
            </button>
          );
        })}
      </section>
      <section class="section">
        <h3 class="section__title">Sensors ({s.sensors.length})</h3>
        {s.sensors.length === 0 && <p class="muted">None: use the Sensor tool.</p>}
        {s.sensors.map((x) => (
          <button key={x.id} type="button" class={`list-row${is("sensor", x.id)}`} onClick={() => select({ kind: "sensor", id: x.id })}>
            <strong>{x.id}</strong> {x.label && <span>{x.label}</span>}{" "}
            <span class="muted">
              {x.source_id}
              {sourceKind(s, x) === "bearing" ? ` · σ ${x.bearing_sigma_deg ?? "?"}°` : " · receiver"}
              {x.scan ? " · scanning" : ""}
            </span>
          </button>
        ))}
      </section>
      <section class="section">
        <h3 class="section__title">Emitters ({s.emitters.length})</h3>
        {s.emitters.length === 0 && <p class="muted">None: choose a type and use the Emitter tool.</p>}
        {s.emitters.map((e) => (
          <button key={e.id} type="button" class={`list-row${is("emitter", e.id)}`} onClick={() => select({ kind: "emitter", id: e.id })}>
            <strong>{e.id}</strong> {e.label && <span>{e.label}</span>}{" "}
            <span class={`side side--${e.truth?.side ?? "unknown"}`}>{SIDE_LABEL[e.truth?.side ?? "unknown"]}</span>{" "}
            <span class="muted">
              {(e.freq_hz / 1e6).toFixed(3)} MHz{e.path_m.length > 1 ? ` · ${e.path_m.length} waypoints` : ""}
            </span>
          </button>
        ))}
      </section>
      <section class="section">
        <h3 class="section__title">
          Nets ({s.nets?.length ?? 0}){" "}
          <button type="button" class="button button--small" onClick={() => {
            const { scenario: next, id } = addNet(s);
            commit(next);
            select({ kind: "net", id });
          }}>
            Add net
          </button>
        </h3>
        {(s.nets ?? []).map((n) => (
          <button key={n.id} type="button" class={`list-row${is("net", n.id)}`} onClick={() => select({ kind: "net", id: n.id })}>
            <strong>{n.id}</strong> <span class="muted">{s.emitters.filter((e) => e.activity?.net_id === n.id).length} members</span>
          </button>
        ))}
      </section>
      <section class="section">
        <h3 class="section__title">
          True relations ({s.truth_relations?.length ?? 0}){" "}
          <button
            type="button"
            class="button button--small"
            disabled={s.emitters.length < 2}
            title="Relate the selected emitter to another; edit the members after"
            onClick={() => {
              const first = sel?.kind === "emitter" || sel?.kind === "waypoint" ? sel.id : s.emitters[0]!.id;
              const second = s.emitters.find((e) => e.id !== first)!.id;
              const { scenario: next, index } = addRelation(s, "controller/controlled", [
                { emitter_id: first, role: "controller" },
                { emitter_id: second, role: "controlled" },
              ]);
              commit(next);
              select({ kind: "relation", index });
            }}
          >
            Add relation
          </button>
        </h3>
        <p class="muted">Truth for scoring grouping. Emitters left out of every relation are the negative controls.</p>
        {(s.truth_relations ?? []).map((r, index) => (
          <button
            key={index}
            type="button"
            class={`list-row${sel?.kind === "relation" && sel.index === index ? " row--selected" : ""}`}
            onClick={() => select({ kind: "relation", index })}
          >
            <strong>{index + 1}</strong> {r.kind} <span class="muted">{r.members.map((m) => m.emitter_id).join(", ")}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

export function IssuesPanel() {
  const list = issues.value;
  if (!list.length) return <p class="muted panel__empty">No issues: the simulator would load this scenario, and every emitter can be heard.</p>;
  const errors = list.filter((i) => i.severity === "error");
  const warnings = list.filter((i) => i.severity === "warning");
  const go = (ref: ScenarioRef) => select(ref.kind === "scenario" ? { kind: "scenario" } : ref);
  return (
    <div>
      {errors.length > 0 && (
        <section class="section">
          <h3 class="section__title">Errors: the simulator would refuse this ({errors.length})</h3>
          <ul class="issue-list">
            {errors.map((i, k) => (
              <li key={k}>
                <button type="button" class="issue issue--error" onClick={() => go(i.ref)}>
                  {i.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section class="section">
          <h3 class="section__title">Warnings: would load, probably not as meant ({warnings.length})</h3>
          <ul class="issue-list">
            {warnings.map((i, k) => (
              <li key={k}>
                <button type="button" class="issue issue--warning" onClick={() => go(i.ref)}>
                  {i.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
