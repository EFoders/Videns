// The properties panel (VIDENS_SPEC.md 16.4): the selected object's every setting, in the
// units a person thinks in (MHz, kHz), stored in the units the simulator reads (Hz), and
// only the settings that apply to it (a position system's receiver has no bearing error).

import { IDENTITY_LABEL } from "../contract/identity.ts";
import { holdOf } from "../scenario/defaults.ts";
import {
  declarationFor,
  deleteEmitter,
  deleteNet,
  deleteRelation,
  deleteSensor,
  deleteSource,
  moveWaypoint,
  removeWaypoint,
  renameEmitter,
  renameNet,
  renameSensor,
  renameSource,
  setDeclaration,
  setHold,
  setOrigin,
  setWindows,
  updateEmitter,
  updateNet,
  updateRelation,
  updateSensor,
  updateSource,
} from "../scenario/editing.ts";
import { toLatLon } from "../scenario/frame.ts";
import { classDefaults, classFor } from "../scenario/library.ts";
import { passDuration } from "../scenario/motion.ts";
import type { Activity, Emitter, Identity, Net, OperatorDeclaration, Scenario, Sensor, Side, Source, SourceClaim, TruthRelation } from "../scenario/types.ts";
import { sensorsHearing, sourceKind } from "../scenario/validate.ts";
import { clock } from "../ui/format.ts";
import { CheckField, Group, NumberField, SelectField, TextField } from "./fields.tsx";
import { commit, library, librarySource, previewT, scenario, select, selection } from "./state.ts";
import { SIDE_LABEL } from "./symbols.ts";

const SIDES: Side[] = ["friend", "hostile", "neutral", "civilian", "unknown"];
const IDENTITIES: Identity[] = ["friend", "assumed_friend", "neutral", "suspect", "hostile", "unknown", "pending"];
const RELATION_KINDS: TruthRelation["kind"][] = ["controller/controlled", "superior/subordinate", "peer", "co-sited"];
const FAULTS: NonNullable<Source["fault"]>["kind"][] = ["flat_sigma", "radians", "local_time", "missing_provenance"];
const FAULT_LABEL: Record<(typeof FAULTS)[number], string> = {
  flat_sigma: "Flat sigma (a made-up error figure)",
  radians: "Bearings in radians",
  local_time: "Local time, not UTC",
  missing_provenance: "Missing provenance",
};
const CLAIM_SCHEMES: SourceClaim["scheme"][] = ["remote_id", "ads_b", "ais", "other"];
const CLAIM_LABEL: Record<SourceClaim["scheme"], string> = { remote_id: "Remote ID", ads_b: "ADS-B", ais: "AIS", other: "Other" };

export function Properties() {
  const sel = selection.value;
  const s = scenario.value;
  if (!sel || sel.kind === "scenario") return <ScenarioForm s={s} />;
  if (sel.kind === "source") {
    const source = s.sources?.find((x) => x.id === sel.id);
    return source ? <SourceForm s={s} source={source} /> : <Gone />;
  }
  if (sel.kind === "sensor") {
    const sensor = s.sensors.find((x) => x.id === sel.id);
    return sensor ? <SensorForm s={s} sensor={sensor} /> : <Gone />;
  }
  if (sel.kind === "emitter" || sel.kind === "waypoint") {
    const e = s.emitters.find((x) => x.id === sel.id);
    return e ? <EmitterForm s={s} e={e} waypoint={sel.kind === "waypoint" ? sel.index : null} /> : <Gone />;
  }
  if (sel.kind === "net") {
    const net = s.nets?.find((x) => x.id === sel.id);
    return net ? <NetForm s={s} net={net} /> : <Gone />;
  }
  const r = s.truth_relations?.[sel.index];
  return r ? <RelationForm s={s} r={r} index={sel.index} /> : <Gone />;
}

function Gone() {
  return (
    <p class="muted panel__empty">
      That object is no longer in the scenario.{" "}
      <button type="button" class="link" onClick={() => select(null)}>
        Show the scenario
      </button>
    </p>
  );
}

function Header({ title, subtitle, onDelete }: { title: string; subtitle: string; onDelete?: () => void }) {
  return (
    <header class="inspector__header">
      <div>
        <div class="inspector__title">{title}</div>
        <div class="muted">{subtitle}</div>
      </div>
      <span class="inspector__close">
        {onDelete && (
          <button type="button" class="button button--small" onClick={onDelete}>
            Delete
          </button>
        )}{" "}
        <button type="button" class="button button--small" onClick={() => select(null)} aria-label="Clear selection">
          ×
        </button>
      </span>
    </header>
  );
}

const ID_HINT = "Letters, digits and . _ : - only, up to 64 characters";

function ScenarioForm({ s }: { s: Scenario }) {
  const set = (patch: Partial<Scenario>) => commit({ ...s, ...patch });
  return (
    <div class="inspector">
      <Header title={s.name} subtitle="scenario.v2" />
      <Group title="Scenario">
        <TextField label="Name" value={s.name} onCommit={(name) => name && set({ name: name.slice(0, 64) })} testId="scenario-name" />
        <label class="field-row field-row--wide">
          <span class="field-row__label">Description</span>
          <textarea rows={3} value={s.description ?? ""} onChange={(e) => set({ description: (e.currentTarget as HTMLTextAreaElement).value })} />
        </label>
        <NumberField label="Duration" unit="s" value={s.duration_s} min={1} max={86400} hint="Up to 86400 s (a day)" onCommit={(v) => v && v > 0 && set({ duration_s: v })} testId="scenario-duration" />
        <NumberField label="Tick" unit="s" value={s.tick_s} min={0.01} max={60} onCommit={(v) => v && v > 0 && set({ tick_s: v })} />
        <NumberField label="Seed" value={s.seed} step={1} hint="Same seed, same records, byte for byte" onCommit={(v) => v !== null && set({ seed: Math.round(v) })} />
      </Group>
      <Group title="Origin" note="Positions are stored as metres east and north of here. Moving it keeps everything where it is on the ground. The Origin tool moves it by clicking the map.">
        <NumberField label="Latitude" unit="°" value={s.origin.lat} min={-90} max={90} onCommit={(lat) => lat !== null && commit(setOrigin(s, { lat, lon: s.origin.lon }))} />
        <NumberField label="Longitude" unit="°" value={s.origin.lon} min={-180} max={180} onCommit={(lon) => lon !== null && commit(setOrigin(s, { lat: s.origin.lat, lon }))} />
      </Group>
      <Group title="Propagation" note="The simulator's model, to decide what a sensor hears: free-space loss at 1 m, then log-distance decay, with log-normal shadowing. The engine has none.">
        <NumberField label="Exponent" value={s.propagation?.exponent} min={0.1} step={0.1} hint="2.0 is free space; higher is more cluttered ground" onCommit={(v) => v && v > 0 && set({ propagation: { ...s.propagation, exponent: v } })} />
        <NumberField label="Shadowing σ" unit="dB" value={s.propagation?.shadowing_sigma_db} min={0} step={0.5} onCommit={(v) => v !== null && v >= 0 && set({ propagation: { ...s.propagation, shadowing_sigma_db: v } })} />
      </Group>
      <Group title="Library">
        <p class="muted">Emitter types from {librarySource.value}. Mount a deployment's own library over /etc/videns/library; it is never committed.</p>
      </Group>
      <Group title="Your scenarios">
        <p class="muted">
          A realistic scenario may describe real places and, through a private library, real parameters. It is saved to your computer only. Keep it
          out of the repositories.
        </p>
      </Group>
    </div>
  );
}

function SourceForm({ s, source }: { s: Scenario; source: Source }) {
  const set = (patch: Partial<Source>) => commit(updateSource(s, source.id, patch));
  const sensors = s.sensors.filter((x) => x.source_id === source.id);
  const declaration: OperatorDeclaration = declarationFor(s, source.id) ?? { source_id: source.id };
  const declare = (patch: Partial<OperatorDeclaration>) => commit(setDeclaration(s, source.id, patch));
  const position = source.kind === "position";
  const reported = source.reports_uncertainty !== false;
  return (
    <div class="inspector">
      <Header
        title={source.label || source.id}
        subtitle={position ? "source: a system that reports emitter positions" : "source: a direction-finding net that reports bearings"}
        onDelete={() => (commit(deleteSource(s, source.id)), select(null))}
      />
      <Group title="Identity">
        <TextField label="Id" value={source.id} hint={`The source_id its observations carry. ${ID_HINT}`} onCommit={(id) => id && id !== source.id && (commit(renameSource(s, source.id, id)), select({ kind: "source", id }))} />
        <TextField label="Label" value={source.label} onCommit={(label) => set({ label: label || undefined })} />
        <SelectField
          label="Reports"
          value={source.kind}
          testId="source-kind"
          options={[
            { value: "bearing", label: "Bearings (each sensor a DF)" },
            { value: "position", label: "Positions (sensors are its receivers)" },
          ]}
          onCommit={(kind) => set({ kind })}
        />
      </Group>
      <Group title="How honestly it reports" note="The simulator applies the error either way. A source that reports none is the honest model of equipment that gives no error figure: its records say the uncertainty is unreported.">
        <CheckField label="Reports its uncertainty" value={reported} onCommit={(reports_uncertainty) => set({ reports_uncertainty })} testId="source-reports" />
        {position && (
          <>
            <NumberField label="Position σ" unit="m" value={source.position_sigma_m} min={0.1} hint="1-sigma error applied to each reported position" onCommit={(v) => v && v > 0 && set({ position_sigma_m: v })} />
            <NumberField label="Region confidence" value={source.region_confidence} min={0.01} max={0.99} step={0.05} hint="Of the circle it reports; 0.5 models a CEP50 system" onCommit={(v) => v && v > 0 && v < 1 && set({ region_confidence: v })} />
          </>
        )}
      </Group>
      <Group title="Systematic errors" note="What Vigilans must learn about this source: every frequency reported high, every time reported late.">
        <NumberField label="Frequency bias" unit="Hz" value={source.freq_bias_hz} onCommit={(v) => v !== null && set({ freq_bias_hz: v })} />
        <NumberField label="Clock offset" unit="s" value={source.clock_offset_s} onCommit={(v) => v !== null && set({ clock_offset_s: v })} />
      </Group>
      <Group title="Records">
        <CheckField label="Sends coverage records" hint="What each sensor listened to, and when. Without them, timing features are unreported." value={Boolean(source.emits_coverage)} onCommit={(emits_coverage) => set({ emits_coverage })} />
        <SelectField
          label="Deliberate fault"
          value={source.fault?.kind ?? ""}
          options={[{ value: "", label: "None" }, ...FAULTS.map((k) => ({ value: k, label: FAULT_LABEL[k] }))]}
          onCommit={(kind) => set({ fault: kind ? { kind, every: source.fault?.every ?? 10 } : undefined })}
        />
        {source.fault && <NumberField label="Every" unit="records" value={source.fault.every} min={1} step={1} onCommit={(v) => v && v >= 1 && set({ fault: { ...source.fault!, every: Math.round(v) } })} />}
      </Group>
      <Group
        title="Operator declaration"
        note="What the operator tells Vigilans about this source, and takes responsibility for: engine configuration, never sent over the network. An assumed uncertainty applies only where the source reports none, and needs a note saying why."
      >
        <SelectField
          label="Its sensors are"
          value={declaration.affiliation ?? ""}
          testId="source-affiliation"
          options={[{ value: "", label: "Not declared" }, ...IDENTITIES.map((i) => ({ value: i, label: IDENTITY_LABEL[i] }))]}
          onCommit={(affiliation) => declare({ affiliation: (affiliation || undefined) as Identity | undefined })}
        />
        {position ? (
          <NumberField label="Assumed position σ" unit="m" value={declaration.assumed_position_sigma_m} optional placeholder="none" min={0.1} onCommit={(v) => declare({ assumed_position_sigma_m: v ?? undefined })} />
        ) : (
          <>
            <NumberField label="Assumed bearing σ" unit="°" value={declaration.assumed_bearing_sigma_deg} optional placeholder="none" min={0.01} step={0.1} testId="source-assumed-bearing" onCommit={(v) => declare({ assumed_bearing_sigma_deg: v ?? undefined })} />
            <NumberField label="Assumed elevation σ" unit="°" value={declaration.assumed_elevation_sigma_deg} optional placeholder="none" min={0.01} step={0.1} onCommit={(v) => declare({ assumed_elevation_sigma_deg: v ?? undefined })} />
          </>
        )}
        <label class="field-row field-row--wide">
          <span class="field-row__label">Why</span>
          <textarea
            rows={2}
            maxLength={2000}
            data-testid="source-assumption-note"
            placeholder="Required with an assumed σ: where the number comes from"
            value={declaration.assumption_note ?? ""}
            onChange={(e) => declare({ assumption_note: (e.currentTarget as HTMLTextAreaElement).value.trim() || undefined })}
          />
        </label>
      </Group>
      <Group title={`Sensors (${sensors.length})`} note="A sensor joins a source from its own settings.">
        {sensors.length === 0 && <p class="muted">None: this source reports nothing.</p>}
        {sensors.map((x) => (
          <div key={x.id} class="row">
            <button type="button" class="link" onClick={() => select({ kind: "sensor", id: x.id })}>
              {x.label || x.id}
            </button>
          </div>
        ))}
      </Group>
    </div>
  );
}

function SensorForm({ s, sensor }: { s: Scenario; sensor: Sensor }) {
  const set = (patch: Partial<Sensor>) => commit(updateSensor(s, sensor.id, patch));
  const band = sensor.freq_range_hz ?? [20e6, 3e9];
  const ll = toLatLon(s.origin, sensor.pos_m[0]!, sensor.pos_m[1]!);
  const kind = sourceKind(s, sensor);
  return (
    <div class="inspector">
      <Header
        title={sensor.label || sensor.id}
        subtitle={kind === "bearing" ? "direction-finding sensor" : "receiver of a position system"}
        onDelete={() => (commit(deleteSensor(s, sensor.id)), select(null))}
      />
      <Group title="Identity">
        <TextField label="Id" value={sensor.id} hint={ID_HINT} onCommit={(id) => id && id !== sensor.id && (commit(renameSensor(s, sensor.id, id)), select({ kind: "sensor", id }))} />
        <TextField label="Label" value={sensor.label} onCommit={(label) => set({ label: label || undefined })} />
        <SelectField
          label="Source"
          value={sensor.source_id ?? ""}
          testId="sensor-source"
          options={(s.sources ?? []).map((x) => ({ value: x.id, label: `${x.id} (${x.kind === "bearing" ? "bearings" : "positions"})` }))}
          onCommit={(source_id) => set({ source_id })}
        />
      </Group>
      <Group title="Position" note={`${ll.lat.toFixed(6)}, ${ll.lon.toFixed(6)}`}>
        <NumberField label="East" unit="m" value={sensor.pos_m[0]} onCommit={(v) => v !== null && set({ pos_m: [v, sensor.pos_m[1]!] })} />
        <NumberField label="North" unit="m" value={sensor.pos_m[1]} onCommit={(v) => v !== null && set({ pos_m: [sensor.pos_m[0]!, v] })} />
        <NumberField label="Height" unit="m" value={sensor.alt_m} hint="Above the WGS84 ellipsoid" onCommit={(v) => v !== null && set({ alt_m: v })} />
      </Group>
      <Group title="Measurement" note={kind === "position" ? "It decides what its system hears; the system reports positions, with its source's error." : undefined}>
        {kind === "bearing" && (
          <>
            <NumberField label="Bearing σ" unit="°" value={sensor.bearing_sigma_deg} min={0.01} max={90} step={0.1} testId="sensor-bearing-sigma" onCommit={(v) => v && v > 0 && set({ bearing_sigma_deg: v })} />
            <NumberField label="Elevation σ" unit="°" value={sensor.elevation_sigma_deg} optional placeholder="cannot measure" min={0.01} step={0.1} hint="Leave empty for a sensor that cannot measure elevation, the common case" onCommit={(v) => set({ elevation_sigma_deg: v })} />
          </>
        )}
        <NumberField label="Band low" unit="MHz" scale={1e6} value={band[0]} onCommit={(v) => v !== null && set({ freq_range_hz: [v, band[1]!] })} />
        <NumberField label="Band high" unit="MHz" scale={1e6} value={band[1]} onCommit={(v) => v !== null && set({ freq_range_hz: [band[0]!, v] })} />
        <NumberField label="Noise floor" unit="dBm" value={sensor.noise_floor_dbm} onCommit={(v) => v !== null && set({ noise_floor_dbm: v })} />
        <NumberField label="Threshold" unit="dB" value={sensor.threshold_db} onCommit={(v) => v !== null && set({ threshold_db: v })} />
        <NumberField label="Report every" unit="s" value={sensor.report_interval_s} min={0.01} onCommit={(v) => v && v > 0 && set({ report_interval_s: v })} />
        <NumberField label="P(miss)" value={sensor.p_miss} min={0} max={1} step={0.01} onCommit={(v) => v !== null && set({ p_miss: v })} />
        {kind === "bearing" && (
          <>
            <NumberField label="P(outlier)" value={sensor.p_outlier} min={0} max={1} step={0.01} onCommit={(v) => v !== null && set({ p_outlier: v })} />
            <NumberField label="False alarms" unit="/s" value={sensor.false_alarm_rate_hz} min={0} step={0.01} onCommit={(v) => v !== null && set({ false_alarm_rate_hz: v })} />
          </>
        )}
      </Group>
      <Group title="Scanning" note="A scanning receiver listens to any one frequency for its dwell out of every revisit, and misses what it is not tuned to.">
        <CheckField label="Scans its band" value={Boolean(sensor.scan)} testId="sensor-scan" onCommit={(on) => set({ scan: on ? { dwell_s: 0.5, revisit_s: 5 } : undefined })} />
        {sensor.scan && (
          <>
            <NumberField label="Dwell" unit="s" value={sensor.scan.dwell_s} min={0.001} onCommit={(v) => v && v > 0 && set({ scan: { ...sensor.scan!, dwell_s: v } })} />
            <NumberField label="Revisit" unit="s" value={sensor.scan.revisit_s} min={0.001} onCommit={(v) => v && v > 0 && set({ scan: { ...sensor.scan!, revisit_s: v } })} />
          </>
        )}
      </Group>
    </div>
  );
}

function EmitterForm({ s, e, waypoint }: { s: Scenario; e: Emitter; waypoint: number | null }) {
  const set = (patch: Partial<Emitter>) => commit(updateEmitter(s, e.id, patch));
  const lib = library.value;
  const cls = classFor(lib, e.truth?.class_id);
  const activity: Activity = e.activity ?? { type: "continuous" };
  const setActivity = (patch: Partial<Activity>) => set({ activity: { ...activity, ...patch } });
  const windows = e.active_windows_s ?? [];
  const setWindow = (j: number, edge: 0 | 1, v: number) => commit(setWindows(s, e.id, windows.map((w, k) => (k === j ? (edge === 0 ? [v, w[1]!] : [w[0]!, v]) : w))));
  const claim = e.source_claim;
  const t = previewT.value;
  const hearing = sensorsHearing(s, e, t);
  const pass = passDuration(e);
  const typeOptions = [{ value: "custom", label: "Custom (set by hand)" }, ...lib.classes.map((c) => ({ value: c.id, label: c.label }))];

  return (
    <div class="inspector">
      <Header title={e.label || e.id} subtitle={`emitter · truly ${SIDE_LABEL[e.truth?.side ?? "unknown"].toLowerCase()} · ${cls?.label ?? "custom"}`} onDelete={() => (commit(deleteEmitter(s, e.id)), select(null))} />
      <Group title="Identity">
        <TextField label="Id" value={e.id} hint={ID_HINT} onCommit={(id) => id && id !== e.id && (commit(renameEmitter(s, e.id, id)), select({ kind: "emitter", id }))} />
        <TextField label="Label" value={e.label} onCommit={(label) => set({ label: label || undefined })} />
        <SelectField
          label="Type"
          value={e.truth?.class_id && cls ? e.truth.class_id : "custom"}
          options={typeOptions}
          testId="emitter-type"
          onCommit={(id) => {
            const c = classFor(lib, id);
            set({ truth: { ...e.truth, class_id: c ? c.id : null }, ...(c ? classDefaults(c) : {}) });
          }}
        />
        <SelectField label="True role" value={e.truth?.role_id ?? ""} options={[{ value: "", label: "None" }, ...lib.roles.map((r) => ({ value: r.id, label: r.label }))]} onCommit={(role) => set({ truth: { ...e.truth, role_id: role || null } })} />
      </Group>
      <Group title="Side" note="The true side is for the simulator and scorer only: the engine never sees it. What the operator tells Vigilans is declared per source, in World.">
        <SelectField label="True side" value={e.truth?.side ?? "unknown"} options={SIDES.map((v) => ({ value: v, label: SIDE_LABEL[v] }))} testId="emitter-side" onCommit={(side) => set({ truth: { ...e.truth, side } })} />
      </Group>
      <Group title="Signal">
        <NumberField label="Frequency" unit="MHz" scale={1e6} step={0.0125} value={e.freq_hz} testId="emitter-freq" onCommit={(v) => v && v > 0 && set({ freq_hz: v })} />
        <NumberField label="Bandwidth" unit="kHz" scale={1e3} value={e.bandwidth_hz} onCommit={(v) => v && v > 0 && set({ bandwidth_hz: v })} />
        <NumberField label="EIRP" unit="dBm" value={e.eirp_dbm} onCommit={(v) => v !== null && set({ eirp_dbm: v })} />
        {cls && <p class="muted">{cls.label}: {(cls.freqHz[0] / 1e6).toFixed(3)}–{(cls.freqHz[1] / 1e6).toFixed(3)} MHz.</p>}
      </Group>
      <Group title="Activity">
        <SelectField
          label="Pattern"
          value={activity.type ?? "continuous"}
          options={[
            { value: "continuous", label: "Continuous" },
            { value: "periodic", label: "Periodic" },
            { value: "bursty", label: "Bursty" },
            { value: "net", label: "Net member" },
          ]}
          onCommit={(type) => {
            const netId = activity.net_id ?? s.nets?.[0]?.id;
            set({
              activity:
                type === "periodic"
                  ? { type, period_s: activity.period_s ?? 60, on_s: activity.on_s ?? 10, offset_s: activity.offset_s ?? 0, hub: false }
                  : type === "bursty"
                    ? { type, mean_on_s: activity.mean_on_s ?? 6, mean_off_s: activity.mean_off_s ?? 20, hub: false }
                    : type === "net"
                      ? { type, ...(netId ? { net_id: netId } : {}), hub: false }
                      : { type, hub: false },
            });
          }}
        />
        {activity.type === "periodic" && (
          <>
            <NumberField label="Period" unit="s" value={activity.period_s} onCommit={(v) => v && v > 0 && setActivity({ period_s: v })} />
            <NumberField label="On for" unit="s" value={activity.on_s} onCommit={(v) => v && v > 0 && setActivity({ on_s: v })} />
            <NumberField label="First at" unit="s" value={activity.offset_s} min={0} hint="Offset of the first transmission" testId="emitter-offset" onCommit={(v) => v !== null && v >= 0 && setActivity({ offset_s: v })} />
          </>
        )}
        {activity.type === "bursty" && (
          <>
            <NumberField label="Mean on" unit="s" value={activity.mean_on_s} onCommit={(v) => v && v > 0 && setActivity({ mean_on_s: v })} />
            <NumberField label="Mean off" unit="s" value={activity.mean_off_s} onCommit={(v) => v && v > 0 && setActivity({ mean_off_s: v })} />
          </>
        )}
        {activity.type === "net" && (
          <>
            <SelectField
              label="Net"
              value={activity.net_id ?? ""}
              options={[{ value: "", label: s.nets?.length ? "Choose a net" : "No nets yet: add one in World" }, ...(s.nets ?? []).map((n) => ({ value: n.id, label: n.label ? `${n.id} — ${n.label}` : n.id }))]}
              onCommit={(net_id) => setActivity({ net_id: net_id || undefined })}
            />
            <CheckField label="Hub: answers the net's calls" value={Boolean(activity.hub)} onCommit={(hub) => setActivity({ hub })} />
          </>
        )}
      </Group>
      <Group title="Switched on" note="When the transmitter is on at all; its pattern applies inside. It keeps moving either way. No windows: on for the whole run.">
        {windows.map((w, j) => (
          <div key={j} class="member-row" data-testid={`window-${j}`}>
            <CellNumber value={w[0]} onCommit={(v) => v !== null && setWindow(j, 0, v)} />
            <span class="muted">to</span>
            <CellNumber value={w[1]} onCommit={(v) => v !== null && setWindow(j, 1, v)} />
            <span class="muted">s</span>
            <button type="button" class="button button--small" aria-label={`Remove window ${j + 1}`} onClick={() => commit(setWindows(s, e.id, windows.filter((_, k) => k !== j)))}>
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          class="button button--small"
          data-testid="add-window"
          onClick={() => {
            const start = windows.at(-1)?.[1] ?? 0;
            commit(setWindows(s, e.id, [...windows, [start, start + 60]]));
          }}
        >
          Add window
        </button>
      </Group>
      <Group title="Movement" note={e.path_m.length > 1 ? (Number.isFinite(pass) ? `One pass takes ${pass.toFixed(0)} s, holds included.` : undefined) : "Static. Select the Path tool and click the map to give it a path."}>
        <NumberField label="Height" unit="m" value={e.alt_m} hint="Above the WGS84 ellipsoid" onCommit={(v) => v !== null && set({ alt_m: v })} />
        <NumberField label="Speed" unit="m/s" value={e.speed_mps} min={0} testId="emitter-speed" onCommit={(v) => v !== null && v >= 0 && set({ speed_mps: v })} />
        <CheckField label="Loop back to the first waypoint" value={Boolean(e.loop)} onCommit={(loop) => set({ loop })} />
      </Group>
      {e.path_m.length > 0 && (
        <Group title="Path" note="A hold is a wait at that waypoint before moving on.">
          <table class="table waypoints">
            <thead>
              <tr>
                <th>#</th>
                <th>East m</th>
                <th>North m</th>
                <th>Hold s</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {e.path_m.map((p, i) => (
                <tr key={i} class={waypoint === i ? "row--selected" : ""} onClick={() => select({ kind: "waypoint", id: e.id, index: i })}>
                  <td>{i + 1}</td>
                  <td>
                    <CellNumber value={p[0]!} onCommit={(v) => v !== null && commit(moveWaypoint(s, e.id, i, [v, p[1]!]))} />
                  </td>
                  <td>
                    <CellNumber value={p[1]!} onCommit={(v) => v !== null && commit(moveWaypoint(s, e.id, i, [p[0]!, v]))} />
                  </td>
                  <td>
                    <CellNumber value={holdOf(p) || undefined} placeholder="0" optional testId={`hold-${i}`} onCommit={(v) => commit(setHold(s, e.id, i, v))} />
                  </td>
                  <td>
                    {e.path_m.length > 1 && (
                      <button type="button" class="button button--small" aria-label={`Remove waypoint ${i + 1}`} onClick={(ev) => (ev.stopPropagation(), commit(removeWaypoint(s, e.id, i)))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      )}
      <Group title="Self-identification" note="A broadcast the emitter makes about itself (Remote ID, ADS-B, AIS). Sources decode it and pass it on as the source's claim, never as fact.">
        <SelectField
          label="Broadcasts"
          value={claim?.scheme ?? ""}
          testId="emitter-claim"
          options={[{ value: "", label: "Nothing" }, ...CLAIM_SCHEMES.map((k) => ({ value: k, label: CLAIM_LABEL[k] }))]}
          onCommit={(scheme) => set({ source_claim: scheme ? { ...claim, scheme, category: claim?.category ?? "unspecified" } : undefined })}
        />
        {claim && (
          <>
            <TextField label="Category" value={claim.category} onCommit={(category) => category && set({ source_claim: { ...claim, category: category.slice(0, 64) } })} />
            <TextField label="Claimed id" value={claim.claimed_id} placeholder="none" hint={ID_HINT} onCommit={(claimed_id) => set({ source_claim: { ...claim, claimed_id: claimed_id || undefined } })} />
          </>
        )}
      </Group>
      <Group title={`Who hears it at ${clock(new Date(Date.UTC(2000, 0, 1) + t * 1000).toISOString())} into the run`} note={`Median margin above each sensor's threshold. Shadowing of ${s.propagation?.shadowing_sigma_db ?? 4} dB σ makes margins near zero come and go; a scanning sensor hears only while tuned.`}>
        <table class="table">
          <thead>
            <tr>
              <th>Sensor</th>
              <th>Range</th>
              <th>Margin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {hearing.map((h) => (
              <tr key={h.sensorId}>
                <td>{h.sensorId}</td>
                <td>{(h.distanceM / 1000).toFixed(1)} km</td>
                <td>{h.inBand ? `${h.marginDb >= 0 ? "+" : ""}${h.marginDb.toFixed(1)} dB` : "out of band"}</td>
                <td class={h.hears ? "hears" : "deaf"}>{h.hears ? "hears" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Group>
    </div>
  );
}

function CellNumber({ value, onCommit, placeholder, optional = false, testId }: { value: number | undefined; onCommit: (v: number | null) => void; placeholder?: string; optional?: boolean; testId?: string }) {
  const shown = value === undefined ? "" : String(value);
  return (
    <input
      type="number"
      step="any"
      class="cell-input"
      value={shown}
      placeholder={placeholder}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const text = (e.currentTarget as HTMLInputElement).value.trim();
        if (text === "" && optional) return onCommit(null);
        const n = Number(text);
        if (text === "" || !Number.isFinite(n)) (e.currentTarget as HTMLInputElement).value = shown;
        else onCommit(n);
      }}
    />
  );
}

function NetForm({ s, net }: { s: Scenario; net: Net }) {
  const set = (patch: Partial<Net>) => commit(updateNet(s, net.id, patch));
  const members = s.emitters.filter((e) => e.activity?.type === "net" && e.activity.net_id === net.id);
  const turnaround = net.turnaround_s ?? [1, 3];
  return (
    <div class="inspector">
      <Header title={net.label || net.id} subtitle="net: members share a channel and take turns" onDelete={() => (commit(deleteNet(s, net.id)), select(null))} />
      <Group title="Identity">
        <TextField label="Id" value={net.id} hint={ID_HINT} onCommit={(id) => id && id !== net.id && (commit(renameNet(s, net.id, id)), select({ kind: "net", id }))} />
        <TextField label="Label" value={net.label} onCommit={(label) => set({ label: label || undefined })} />
      </Group>
      <Group title="Timing">
        <NumberField label="Mean call" unit="s" value={net.mean_tx_s} onCommit={(v) => v && v > 0 && set({ mean_tx_s: v })} />
        <NumberField label="Mean gap" unit="s" value={net.mean_gap_s} onCommit={(v) => v && v > 0 && set({ mean_gap_s: v })} />
        <NumberField label="Hub replies" value={net.hub_reply_prob} min={0} max={1} step={0.05} onCommit={(v) => v !== null && set({ hub_reply_prob: v })} />
        <NumberField label="Turnaround min" unit="s" value={turnaround[0]} onCommit={(v) => v !== null && set({ turnaround_s: [v, turnaround[1]!] })} />
        <NumberField label="Turnaround max" unit="s" value={turnaround[1]} onCommit={(v) => v !== null && set({ turnaround_s: [turnaround[0]!, v] })} />
      </Group>
      <Group title="Members" note="An emitter joins a net from its Activity settings.">
        {members.length === 0 && <p class="muted">None yet.</p>}
        {members.map((m) => (
          <div key={m.id} class="row">
            <button type="button" class="link" onClick={() => select({ kind: "emitter", id: m.id })}>
              {m.label || m.id}
            </button>
            {m.activity?.hub && <span class="muted"> hub</span>}
          </div>
        ))}
      </Group>
    </div>
  );
}

function RelationForm({ s, r, index }: { s: Scenario; r: TruthRelation; index: number }) {
  const set = (patch: Partial<TruthRelation>) => commit(updateRelation(s, index, patch));
  const emitterOptions = s.emitters.map((e) => ({ value: e.id, label: e.label ? `${e.id} — ${e.label}` : e.id }));
  return (
    <div class="inspector">
      <Header title={`Relation ${index + 1}`} subtitle="true relationship, for scoring grouping; the engine never sees it" onDelete={() => (commit(deleteRelation(s, index)), select(null))} />
      <Group title="Kind">
        <SelectField label="Kind" value={r.kind} options={RELATION_KINDS.map((k) => ({ value: k, label: k }))} onCommit={(kind) => set({ kind })} />
      </Group>
      <Group title="Members">
        {r.members.map((m, i) => (
          <div key={i} class="member-row">
            <select value={m.emitter_id} onChange={(e) => set({ members: r.members.map((x, j) => (j === i ? { ...x, emitter_id: (e.currentTarget as HTMLSelectElement).value } : x)) })}>
              {emitterOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input type="text" placeholder="role" maxLength={64} value={m.role ?? ""} onChange={(e) => set({ members: r.members.map((x, j) => (j === i ? { ...x, role: (e.currentTarget as HTMLInputElement).value || undefined } : x)) })} />
            {r.members.length > 2 && (
              <button type="button" class="button button--small" onClick={() => set({ members: r.members.filter((_, j) => j !== i) })}>
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          class="button button--small"
          disabled={s.emitters.length <= r.members.length}
          onClick={() => {
            const free = s.emitters.find((e) => !r.members.some((m) => m.emitter_id === e.id));
            if (free) set({ members: [...r.members, { emitter_id: free.id }] });
          }}
        >
          Add member
        </button>
      </Group>
      <Group title="Note">
        <label class="field-row field-row--wide">
          <span class="field-row__label">Note</span>
          <textarea rows={2} maxLength={2000} value={r.note ?? ""} onChange={(e) => set({ note: (e.currentTarget as HTMLTextAreaElement).value.trim() || undefined })} />
        </label>
      </Group>
    </div>
  );
}
