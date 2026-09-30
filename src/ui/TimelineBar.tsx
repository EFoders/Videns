// Time (VIDENS_SPEC.md 8.6): follow live, or step back into the run's history, or replay
// a recording. One click leaves live and one click returns. Scrubbing shows exactly the
// state at that moment; nothing is interpolated between messages.

import { useMemo, useRef } from "preact/hooks";

import { fileNote, openFiles } from "../app/files.ts";
import {
  activeTimeline,
  atLiveEdge,
  cursorT,
  goLive,
  liveRevision,
  playback,
  recordingOfLive,
  seek,
  setPlaying,
  setRate,
  source,
  step,
} from "../app/state.ts";
import type { TimelineMarker } from "../store/timeline.ts";
import { clock } from "./format.ts";

const RATES = [0.25, 0.5, 1, 2, 4, 8, 16];

const MARKER_CLASS: Partial<Record<TimelineMarker["kind"], string>> = {
  merged: "lifecycle",
  unmerged: "lifecycle",
  split: "lifecycle",
  reidentified: "lifecycle",
  entity_retired: "retired",
  affiliation_changed: "affiliation",
  group_formed: "group",
  group_published: "group",
  group_decaying: "group",
  group_retired: "group",
  notice: "notice",
};

export function TimelineBar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const src = source.value;
  const revision = src.kind === "live" ? liveRevision.value : 0;
  const timeline = activeTimeline();
  const start = timeline.start;
  const end = timeline.end;
  const t = cursorT.value ?? end;
  const live = atLiveEdge.value;
  const { playing, rate } = playback.value;

  // Entity creation happens constantly; the markers show the changes worth finding again.
  const markers = useMemo(() => timeline.markers().filter((m) => m.kind !== "entity_created"), [timeline, revision]);
  const span = start !== undefined && end !== undefined && end > start ? end - start : null;
  const pct = (x: number) => (span === null || start === undefined ? 0 : ((x - start) / span) * 100);

  const save = () => {
    const recording = recordingOfLive();
    if (!recording) return;
    const url = URL.createObjectURL(new Blob([recording.text], { type: "application/x-ndjson" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = recording.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div class="timeline" aria-label="Timeline">
      <button
        type="button"
        class={`button button--small timeline__live${live ? " timeline__live--on" : ""}`}
        onClick={goLive}
        title={live ? "Following the live feed" : "Return to the live feed"}
      >
        ● Live
      </button>
      <button type="button" class="button button--small" onClick={() => step(-1)} title="Previous message" aria-label="Previous message" disabled={span === null}>
        ⏮
      </button>
      <button
        type="button"
        class="button button--small"
        onClick={() => setPlaying(!playing)}
        title={playing ? "Pause" : "Play from here"}
        aria-label={playing ? "Pause" : "Play"}
        disabled={span === null}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button type="button" class="button button--small" onClick={() => step(1)} title="Next message" aria-label="Next message" disabled={span === null || live}>
        ⏭
      </button>
      <select class="timeline__rate" value={String(rate)} onChange={(e) => setRate(Number((e.currentTarget as HTMLSelectElement).value))} title="Playback speed" aria-label="Playback speed">
        {RATES.map((r) => (
          <option key={r} value={String(r)}>
            {r}×
          </option>
        ))}
      </select>
      <div class="timeline__track">
        <div class="timeline__markers" aria-hidden="true">
          {span !== null &&
            markers.map((m, i) => (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                class={`timeline__marker timeline__marker--${MARKER_CLASS[m.kind] ?? "other"}`}
                style={{ left: `${pct(m.t)}%` }}
                title={`${clock(new Date(m.t).toISOString())} ${m.label}`}
                onClick={() => {
                  setPlaying(false);
                  seek(m.t);
                }}
              />
            ))}
        </div>
        <input
          type="range"
          class="timeline__slider"
          min={start ?? 0}
          max={end ?? 1}
          step={100}
          value={t ?? 0}
          disabled={span === null}
          aria-label="Picture time"
          onInput={(e) => {
            setPlaying(false);
            seek(Number((e.currentTarget as HTMLInputElement).value));
          }}
        />
      </div>
      <span class="timeline__time">{t !== undefined ? clock(new Date(t).toISOString()) : "—"}</span>
      <button type="button" class="button button--small" onClick={() => fileInput.current?.click()} title="Open a .picture.jsonl recording, and its .truth.jsonl if there is one">
        Open…
      </button>
      <button type="button" class="button button--small" onClick={save} disabled={src.kind !== "live"} title="Save this run's live history as a .picture.jsonl recording">
        Save
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".jsonl,.json,application/x-ndjson"
        multiple
        hidden
        onChange={(e) => {
          const files = (e.currentTarget as HTMLInputElement).files;
          if (files?.length) void openFiles(files);
          (e.currentTarget as HTMLInputElement).value = "";
        }}
      />
      {fileNote.value && <span class="timeline__note">{fileNote.value}</span>}
    </div>
  );
}
