// The side panel's other tabs: the lifecycle log, diagnostics, and what this view is
// actually configured to do.

import { activeBasemap, basemapProblem, config, counters, diagnostics, select, shown, source } from "../app/state.ts";
import { describeBasemap } from "../config.ts";
import type { LogEntry } from "../store/picture.ts";
import { clock, confidenceLabel } from "./format.ts";

export function LogPanel() {
  const log = shown.value.log;
  if (log.length === 0) return <p class="muted panel__empty">No lifecycle events or notices in this run yet.</p>;
  return (
    <ol class="log">
      {[...log].reverse().map((entry, i) => (
        <LogLine key={`${entry.seq}-${i}`} entry={entry} />
      ))}
    </ol>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  if (entry.kind === "notice") {
    const n = entry.notice;
    return (
      <li class={`log__line log__line--${n.severity}`}>
        <span class="log__time">{clock(n.t)}</span>
        <span class="log__kind">notice · {n.severity}</span>
        <span>{n.text}</span>
      </li>
    );
  }
  const e = entry.event;
  return (
    <li class="log__line">
      <span class="log__time">{clock(e.t)}</span>
      <span class="log__kind">{e.kind.replace(/_/g, " ")}</span>
      <span>
        {e.objects.map((o) => (
          <button key={`${o.kind}:${o.id}`} type="button" class="link" onClick={() => select(o)}>
            {o.id}
          </button>
        ))}{" "}
        {e.reason}
      </span>
    </li>
  );
}

export function DiagnosticsPanel() {
  const c = counters.value;
  const list = diagnostics.value;
  return (
    <div>
      <dl class="counters">
        <Counter label="Received" value={c.received} />
        <Counter label="Rejected" value={c.rejected} warn />
        <Counter label="Gaps" value={c.gaps} warn />
        <Counter label="Duplicates" value={c.duplicates} warn />
        <Counter label="Resyncs" value={c.resyncs} warn />
      </dl>
      {list.length === 0 ? (
        <p class="muted">Nothing to report: every message so far was valid and in sequence.</p>
      ) : (
        <ol class="diagnostics">
          {[...list].reverse().map((d, i) => (
            <li key={`${d.at}-${i}`} class={`diagnostic diagnostic--${d.kind}`}>
              <div>
                <span class="log__time">{new Date(d.at).toISOString().slice(11, 19)}Z</span> <strong>{d.kind.replace(/_/g, " ")}</strong>: {d.summary}
              </div>
              {d.issues && (
                <ul class="issues">
                  {d.issues.map((issue, j) => (
                    <li key={j}>
                      <code>{issue.path}</code> {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              {d.raw && (
                <details>
                  <summary>Message as received</summary>
                  <pre class="raw">{d.raw}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Counter({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div class={`counter${warn && value > 0 ? " counter--warn" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function AboutPanel() {
  const c = config.value;
  const hello = shown.value.hello;
  const src = source.value;
  return (
    <div>
      <section class="section">
        <h3 class="section__title">This view</h3>
        {c ? (
          <dl class="about">
            <dt>Configuration</dt>
            <dd>{c.loadedFrom}</dd>
            <dt>Feed</dt>
            <dd>{c.feed ? `${c.feed}/stream (same origin)` : "none"}</dd>
            <dt>Basemap</dt>
            <dd>
              {activeBasemap().label}: {describeBasemap(activeBasemap())}
              {basemapProblem.value && <div class="field--warn">{basemapProblem.value}</div>}
            </dd>
            <dt>Basemaps offered</dt>
            <dd>
              {c.basemaps.map((b) => (
                <div key={b.id}>
                  {b.label}
                  {b.id === c.basemapDefault ? " (default)" : ""}
                  {b.kind !== "none" && <span class="muted"> — {b.attribution}</span>}
                </div>
              ))}
            </dd>
            <dt>Default region level</dt>
            <dd>{confidenceLabel(c.ellipseConfidence)}</dd>
            <dt>Initial view</dt>
            <dd>{c.view ? `${c.view.lat}, ${c.view.lon} at zoom ${c.view.zoom}` : "follow the run's origin"}</dd>
            <dt>Coordinates</dt>
            <dd>decimal degrees, WGS84</dd>
            <dt>Truth overlay</dt>
            <dd>{c.truthOverlay ? "may be offered" : "off"}</dd>
          </dl>
        ) : (
          <p class="muted">No configuration loaded.</p>
        )}
      </section>
      <section class="section">
        <h3 class="section__title">This run</h3>
        <p class="muted">
          {src.kind === "file"
            ? `From the recording ${src.name}${src.rejected ? `, with ${src.rejected} line(s) rejected` : ""}.`
            : "From the live feed."}
        </p>
        {hello ? (
          <dl class="about">
            <dt>Run</dt>
            <dd>{hello.run_id}</dd>
            <dt>Engine</dt>
            <dd>
              {hello.engine.name} {hello.engine.version}
            </dd>
            <dt>Contracts</dt>
            <dd>{hello.contracts.join(", ")}</dd>
            <dt>Clock</dt>
            <dd>{hello.clock.mode === "sim" ? `simulated, ×${hello.clock.rate}` : "wall clock"}</dd>
            <dt>Library</dt>
            <dd>
              {hello.library.available ? `${hello.library.name} ${hello.library.version}${hello.library.private ? " (private content enabled)" : ""}` : "unavailable"}
            </dd>
            <dt>Sources</dt>
            <dd>
              {hello.sources.map((s) => (
                <div key={s.source_id}>
                  {s.source_id}
                  {s.label ? ` — ${s.label}` : ""}
                </div>
              ))}
            </dd>
            <dt>Origin</dt>
            <dd>
              {hello.origin.lat}, {hello.origin.lon}
            </dd>
          </dl>
        ) : (
          <p class="muted">No run header received yet.</p>
        )}
      </section>
    </div>
  );
}
