// Preview: where every emitter is at a moment of the run, from the simulator's own motion
// model, and a play control to watch the scenario unfold before exporting it.

import { useEffect } from "preact/hooks";

import { playback, previewT, scenario } from "./state.ts";

const RATES = [1, 5, 10, 30, 60];

function mmss(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PreviewBar() {
  const duration = scenario.value.duration_s;
  const { playing, rate } = playback.value;

  useEffect(() => {
    if (!playing) return;
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      const next = previewT.value + dt * playback.value.rate;
      if (next >= scenario.value.duration_s) {
        previewT.value = scenario.value.duration_s;
        playback.value = { ...playback.value, playing: false };
        return;
      }
      previewT.value = next;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return (
    <div class="timeline" aria-label="Preview">
      <span class="muted">Preview</span>
      <button
        type="button"
        class="button button--small"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          if (!playing && previewT.value >= duration) previewT.value = 0;
          playback.value = { ...playback.value, playing: !playing };
        }}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <select class="timeline__rate" value={String(rate)} onChange={(e) => (playback.value = { ...playback.value, rate: Number((e.currentTarget as HTMLSelectElement).value) })} aria-label="Preview speed">
        {RATES.map((r) => (
          <option key={r} value={String(r)}>
            {r}×
          </option>
        ))}
      </select>
      <div class="timeline__track">
        <input
          type="range"
          class="timeline__slider"
          min={0}
          max={duration}
          step={1}
          value={Math.min(previewT.value, duration)}
          aria-label="Scenario time"
          onInput={(e) => {
            playback.value = { ...playback.value, playing: false };
            previewT.value = Number((e.currentTarget as HTMLInputElement).value);
          }}
        />
      </div>
      <span class="timeline__time">
        {mmss(previewT.value)} / {mmss(duration)}
      </span>
    </div>
  );
}
