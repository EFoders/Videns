import { activeBasemap, basemapId, basemapProblem, config, counters, lastMessageAt, now, picture, shown, view } from "../app/state.ts";
import { timeView } from "../app/timeview.ts";
import { age, dateTime } from "./format.ts";
import { summarise } from "./status.ts";

export function StatusBar() {
  // The feed's health is always the live feed's; everything else describes what is on screen.
  const live = picture.value;
  const onScreen = shown.value;
  const status = summarise(view.value, live, lastMessageAt.value, now.value);
  const hello = onScreen.hello;
  const c = counters.value;
  const last = lastMessageAt.value;
  const sim = hello?.clock.mode === "sim";
  const time = timeView.value;

  return (
    <header class="status">
      <span class="brand">Videns</span>
      <a class="status__link" href="/editor.html" title="Build Vigilans scenarios on a map">
        Scenario editor
      </a>
      <span class={`pill pill--${status.tone}`} title="The live feed">
        {status.label}
      </span>
      {time.kind === "past" && (
        <span class="pill pill--warn" title="A moment from this run's history, not the present">
          Paused, {age(time.behindMs)} behind
        </span>
      )}
      {time.kind === "file" && (
        <span class="pill pill--replay" title="A recording, not the live feed">
          Replay: {time.name}
        </span>
      )}
      <Field label="Run" value={onScreen.runId ?? "—"} />
      {hello?.scenario && <Field label="Scenario" value={hello.scenario} />}
      {hello && (
        <span class={`pill ${sim ? "pill--sim" : "pill--idle"}`} title={sim ? "Simulated time: not a real picture" : "Wall-clock time"}>
          {sim ? `SIM ×${hello.clock.rate}` : "WALL"}
        </span>
      )}
      <Field label="Picture time" value={dateTime(onScreen.t)} />
      <Field label="Last message" value={last === null ? "never" : `${age(now.value - last)} ago`} />
      <Field label="Entities" value={String(onScreen.entities.size)} />
      <Field label="Seq" value={live.lastSeq === undefined ? "—" : `#${live.lastSeq}`} />
      <Field label="Gaps" value={String(c.gaps)} warn={c.gaps > 0} />
      <Field label="Rejected" value={String(c.rejected)} warn={c.rejected > 0} />
      <Field label="Contract" value="picture.v0" />
      <BasemapPill />
    </header>
  );
}

/**
 * An online basemap sends the viewed area to a third party with every pan. That is allowed
 * by configuration, and never quietly (VIDENS_SPEC.md rule 14).
 */
function BasemapPill() {
  basemapId.value; // re-render on a change of basemap
  const basemap = config.value ? activeBasemap() : undefined;
  const problem = basemapProblem.value;
  if (problem) {
    return (
      <span class="pill pill--bad" title={problem}>
        Basemap failing
      </span>
    );
  }
  if (basemap?.kind !== "online") return null;
  return (
    <span class="pill pill--warn" title={`Tiles come from ${basemap.origin}. Every tile request tells that server which area is being viewed.`}>
      Online basemap: {basemap.origin.replace("https://", "")}
    </span>
  );
}

function Field({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <span class={`field${warn ? " field--warn" : ""}`}>
      <span class="field__label">{label}</span>
      <span class="field__value">{value}</span>
    </span>
  );
}
