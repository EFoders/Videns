// The inspector: everything about the selected object, following it live as it changes.
// Every claim is shown with its basis and reasons (VIDENS_SPEC.md rules 5-7); numbers sit
// beside the hedged wording, never instead of it.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import { ellipseConfidence, select, selection, shown } from "../app/state.ts";
import { compareWithTruth, truthNow } from "../app/truth.ts";
import type { Affiliation, Entity, Group, PositionUncertainty, Sensor } from "../contract/generated/picture.ts";
import { BASIS_LABEL, IDENTITY_LABEL } from "../contract/identity.ts";
import { drawableEllipse } from "../geo/ellipse.ts";
import { symbolDataUrl } from "../map/symbols.ts";
import { cotKey, type Departure } from "../store/picture.ts";
import { CotView } from "./CotView.tsx";
import { bandwidth, clock, confidenceLabel, dateTime, frequency, latLon, metres } from "./format.ts";

type Tab = "summary" | "evidence" | "cot" | "raw";
const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "evidence", label: "Evidence" },
  { id: "cot", label: "CoT" },
  { id: "raw", label: "Raw" },
];

export function Inspector() {
  const [tab, setTab] = useState<Tab>("summary");
  const selected = selection.value;
  const state = shown.value;

  if (!selected) {
    return <p class="muted panel__empty">Select a symbol, a group link or a departure on the map to see what Vigilans believes about it, and why.</p>;
  }
  const object = selected.kind === "entity" ? state.entities.get(selected.id) : selected.kind === "sensor" ? state.sensors.get(selected.id) : state.groups.get(selected.id);
  if (!object) {
    const departure = selected.kind === "entity" ? state.departed.get(selected.id) : undefined;
    if (departure) return <Departed id={selected.id} departure={departure} />;
    return (
      <div class="panel__empty">
        <p>
          {selected.kind} <strong>{selected.id}</strong> is not in the picture at this moment. The Log tab records why.
        </p>
        <button type="button" class="button" onClick={() => select(null)}>
          Clear selection
        </button>
      </div>
    );
  }
  const record = state.cot.get(cotKey(selected.kind, selected.id));

  return (
    <div class="inspector">
      {selected.kind === "group" ? <GroupHeader group={object as Group} /> : <Header kind={selected.kind} object={object as Entity | Sensor} />}
      <nav class="tabs tabs--inner" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} class={`tab${tab === t.id ? " tab--active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div class="inspector__body">
        {tab === "summary" &&
          (selected.kind === "entity" ? (
            <EntitySummary entity={object as Entity} />
          ) : selected.kind === "group" ? (
            <GroupSummary group={object as Group} />
          ) : (
            <SensorSummary sensor={object as Sensor} />
          ))}
        {tab === "evidence" &&
          (selected.kind === "entity" ? (
            <EntityEvidence entity={object as Entity} />
          ) : selected.kind === "group" ? (
            <GroupEvidence group={object as Group} />
          ) : (
            <p class="muted">Sensors carry no evidence of their own.</p>
          ))}
        {tab === "cot" && <CotView record={record} />}
        {tab === "raw" && <pre class="raw">{JSON.stringify(object, null, 2)}</pre>}
      </div>
    </div>
  );
}

/** An entity that just left: what it was, when it left, and why (spec 8.6, Phase 4 gate). */
function Departed({ id, departure }: { id: string; departure: Departure }) {
  return (
    <div class="inspector">
      <Header kind="entity" object={departure.entity} note="departed" />
      <div class="inspector__body">
        <Section title="Left the picture">
          <p>
            At {dateTime(departure.t)}: {departure.reason}
          </p>
          {departure.into && (
            <p>
              Merged into <EntityLink id={departure.into} />. A merge is a hypothesis and can be reversed; the Log tab records it.
            </p>
          )}
        </Section>
        <p class="muted">Shown as it was when it left.</p>
        <EntitySummary entity={departure.entity} />
      </div>
    </div>
  );
}

function GroupHeader({ group }: { group: Group }) {
  return (
    <header class="inspector__header">
      <div class="inspector__groupmark" aria-hidden="true">
        ⟷
      </div>
      <div>
        <div class="inspector__title">{group.group_id}</div>
        <div class="muted">
          group · {group.kind} · {group.state}
        </div>
      </div>
      <button type="button" class="button button--small inspector__close" onClick={() => select(null)} aria-label="Clear selection">
        ×
      </button>
    </header>
  );
}

function GroupSummary({ group }: { group: Group }) {
  const state = shown.value;
  return (
    <>
      <Section title="Claim">
        <p>
          Possibly operating together as <strong>{group.kind}</strong>, confidence {group.confidence.toFixed(2)}.
        </p>
        <p class="muted">
          Bounded by how sure Vigilans is of each member's identity: at most {group.member_identity_bound.toFixed(2)}. A group cannot be
          surer than its members.
        </p>
        <p class="muted">{GROUP_STATE_TEXT[group.state]}</p>
      </Section>
      <Section title="Members">
        {group.members.map((m) => {
          const e = state.entities.get(m.entity_id);
          return (
            <Row
              key={m.entity_id}
              label={m.role ?? "member"}
              value={
                <>
                  <EntityLink id={m.entity_id} /> {e ? <span class="muted">— {IDENTITY_LABEL[e.affiliation.identity]}, {e.state}</span> : <span class="muted">— not in the picture now</span>}
                </>
              }
            />
          );
        })}
      </Section>
      {group.limitations?.length ? (
        <Section title="What this cannot show">
          <Reasons reasons={group.limitations} />
        </Section>
      ) : null}
    </>
  );
}

const GROUP_STATE_TEXT: Readonly<Record<Group["state"], string>> = {
  hypothesis: "A hypothesis: below the threshold Vigilans publishes groups at. Hidden unless hypotheses are shown.",
  published: "Published: above Vigilans' publication threshold, which is set higher than for entities.",
  decaying: "Decaying: the evidence is ageing without being renewed. A group that was true earlier is not a fact now.",
  retired: "Retired.",
};

function GroupEvidence({ group }: { group: Group }) {
  return (
    <Section title="Evidence">
      <ul class="reasons">
        {group.evidence.map((e, i) => (
          <li key={i}>
            <strong>{e.type.replace(/_/g, " ")}</strong>: {e.summary}
            {e.value !== undefined && <span class="muted"> ({e.value})</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function EntityLink({ id }: { id: string }) {
  return (
    <button type="button" class="link" onClick={() => select({ kind: "entity", id })}>
      {id}
    </button>
  );
}

function Header({ kind, object, note }: { kind: string; object: Entity | Sensor; note?: string }) {
  const id = "entity_id" in object ? object.entity_id : object.sensor_id;
  const state = note ?? ("entity_id" in object ? object.state : object.health);
  return (
    <header class="inspector__header">
      <img src={symbolDataUrl(object.symbol.sidc, 30)} alt="" class="inspector__symbol" />
      <div>
        <div class="inspector__title">{object.label ?? id}</div>
        <div class="muted">
          {kind} · {state} · <code>{object.symbol.sidc}</code>
        </div>
      </div>
      <button type="button" class="button button--small inspector__close" onClick={() => select(null)} aria-label="Clear selection">
        ×
      </button>
    </header>
  );
}

function AffiliationBlock({ affiliation }: { affiliation: Affiliation }) {
  return (
    <Section title="Affiliation">
      <p>
        <strong>{IDENTITY_LABEL[affiliation.identity]}</strong> <span class="muted">— {BASIS_LABEL[affiliation.basis]}</span>
      </p>
      {affiliation.basis === "default" ? (
        <p class="muted">Nobody has declared an affiliation for this object, so it is Unknown. Videns never assigns one.</p>
      ) : (
        <Reasons reasons={affiliation.reasons} />
      )}
    </Section>
  );
}

function EntitySummary({ entity }: { entity: Entity }) {
  const c = entity.classification;
  return (
    <>
      <AffiliationBlock affiliation={entity.affiliation} />
      <Section title="Classification">
        {c.status === "classified" ? (
          c.candidates?.map((candidate) => (
            <div key={candidate.class} class="candidate">
              <p>
                <strong>{candidate.wording}</strong> <span class="muted">({candidate.confidence.toFixed(2)}, {candidate.class})</span>
              </p>
              <Reasons reasons={candidate.reasons} />
            </div>
          ))
        ) : (
          <p>
            <strong>Unclassified.</strong> {c.reason}
          </p>
        )}
        <p class="muted">
          Library: {entity.library.available ? `${entity.library.name} ${entity.library.version}` : "unavailable"}
        </p>
      </Section>
      <Section title="Position">
        {entity.position ? (
          <>
            <p>{latLon(entity.position.lat, entity.position.lon)}</p>
            {entity.position_uncertainty && <UncertaintyBlock u={entity.position_uncertainty} />}
          </>
        ) : (
          <p class="muted">No fix yet.</p>
        )}
        {entity.velocity && <Velocity east={entity.velocity.east_mps} north={entity.velocity.north_mps} />}
      </Section>
      <Section title="Signal">
        <Row label="Frequency" value={frequency(entity.freq_hz)} />
        <Row label="Bandwidth" value={bandwidth(entity.bandwidth_hz)} />
        <Row label="First seen" value={dateTime(entity.first_seen)} />
        <Row label="Last seen" value={dateTime(entity.last_seen)} />
        <Row label="Sources" value={entity.sources.map((s) => `${s.source_id} (${s.observations})`).join(", ")} />
      </Section>
      {entity.lineage && <LineageBlock lineage={entity.lineage} />}
      <TruthBlock entity={entity} />
    </>
  );
}

function LineageBlock({ lineage }: { lineage: NonNullable<Entity["lineage"]> }) {
  return (
    <Section title="Lineage">
      {lineage.merged_from?.length ? (
        <p>
          Merged from{" "}
          {lineage.merged_from.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <EntityLink id={id} />
            </span>
          ))}
          {lineage.merge_confidence !== undefined && <span class="muted"> ({lineage.merge_confidence.toFixed(2)})</span>}. A merge is a
          hypothesis Vigilans can reverse.
        </p>
      ) : null}
      {lineage.split_from && (
        <p>
          Split from <EntityLink id={lineage.split_from} />.
        </p>
      )}
    </Section>
  );
}

/**
 * Where the simulator really put this emitter, when the truth overlay is on. Shown only
 * for an association the truth states; a comparison to look at, not a score.
 */
function TruthBlock({ entity }: { entity: Entity }) {
  const level = ellipseConfidence.value;
  const comparison = compareWithTruth(entity, truthNow.value, level);
  if (!comparison) return null;
  const { emitter, distanceM, inside } = comparison;
  return (
    <Section title="Simulation truth">
      <p>
        True emitter {emitter.emitter_id} is <strong>{metres(distanceM)}</strong> from this position
        {emitter.active ? "" : " (not transmitting at this moment)"}.
      </p>
      <p class="muted">
        {inside === null
          ? "There is no region to compare it with."
          : inside
            ? `Inside the ${confidenceLabel(level)} region.`
            : `Outside the ${confidenceLabel(level)} region.`}{" "}
        Simulated runs only; truth never reaches the engine.
      </p>
    </Section>
  );
}

function UncertaintyBlock({ u }: { u: PositionUncertainty }) {
  const level = ellipseConfidence.value;
  if (u.basis === "unreported") {
    return (
      <p class="callout callout--warn">
        Uncertainty <strong>unreported</strong> by the source. No region is drawn, because any region would be invented.
      </p>
    );
  }
  const axes = drawableEllipse(u, level);
  return (
    <>
      <p>
        Uncertainty <strong>{u.basis}</strong>
        {axes && (
          <>
            : {confidenceLabel(level)} region {metres(axes.semiMajorM)} × {metres(axes.semiMinorM)} (semi-axes), major axis{" "}
            {axes.orientationDeg.toFixed(0)}° true
          </>
        )}
      </p>
      {u.assumption && (
        <p class="callout">
          Assumed, not measured. Declared by {u.assumption.declared_by}: {u.assumption.note}
        </p>
      )}
      {u.mixture && (
        <p class="callout">
          Mixed: {u.mixture.measured} measured, {u.mixture.assumed} assumed and {u.mixture.unreported} unreported observations contribute.
        </p>
      )}
    </>
  );
}

function Velocity({ east, north }: { east: number; north: number }) {
  const speed = Math.hypot(east, north);
  const heading = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  return <Row label="Velocity" value={`${speed.toFixed(1)} m/s towards ${heading.toFixed(0)}° true`} />;
}

function EntityEvidence({ entity }: { entity: Entity }) {
  const bearings = entity.fix_evidence?.bearings ?? [];
  const positions = entity.fix_evidence?.positions ?? [];
  return (
    <>
      <Section title="Bearings in the current fix">
        {bearings.length === 0 ? (
          <p class="muted">None.</p>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Sensor</th>
                <th>Bearing</th>
                <th>σ</th>
                <th>Weight</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {bearings.map((b) => (
                <tr key={b.observation_id}>
                  <td>{b.sensor_id ?? b.source_id}</td>
                  <td>{b.bearing_deg.toFixed(1)}°</td>
                  <td>{b.bearing_uncertainty.basis === "unreported" ? "unreported" : `${b.bearing_uncertainty.sigma_deg}°${b.bearing_uncertainty.basis === "assumed" ? " (assumed)" : ""}`}</td>
                  <td>{b.weight.toFixed(3)}</td>
                  <td>{clock(b.t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Reported positions">
        {positions.length === 0 ? (
          <p class="muted">None.</p>
        ) : (
          positions.map((p) => (
            <p key={p.observation_id}>
              {p.source_id}: {latLon(p.position.lat, p.position.lon)} at {clock(p.t)}, uncertainty {p.uncertainty.basis}
            </p>
          ))
        )}
      </Section>
      {entity.reidentification && (
        <Section title="Re-identification">
          <p>
            Consistent with {entity.reidentification.consistent_with} ({entity.reidentification.confidence.toFixed(2)})
          </p>
          <Reasons reasons={entity.reidentification.reasons} />
        </Section>
      )}
      {entity.meta && (
        <Section title="Meta (not interpreted)">
          <pre class="raw">{JSON.stringify(entity.meta, null, 2)}</pre>
        </Section>
      )}
    </>
  );
}

function SensorSummary({ sensor }: { sensor: Sensor }) {
  return (
    <>
      <AffiliationBlock affiliation={sensor.affiliation} />
      <Section title="Sensor">
        <Row label="Source" value={sensor.source_id} />
        <Row label="Health" value={sensor.health} />
        <Row label="Last heard" value={dateTime(sensor.last_heard)} />
        {sensor.position && <Row label="Position" value={latLon(sensor.position.lat, sensor.position.lon)} />}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="section">
      <h3 class="section__title">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ComponentChildren }) {
  return (
    <div class="row">
      <span class="row__label">{label}</span>
      <span class="row__value">{value}</span>
    </div>
  );
}

function Reasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul class="reasons">
      {reasons.map((reason, i) => (
        <li key={i}>{reason}</li>
      ))}
    </ul>
  );
}
