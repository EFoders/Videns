// Tools, the emitter palette, history and files.

import { useRef } from "preact/hooks";

import type { Side } from "../scenario/types.ts";
import { fitScenario } from "./EditorMap.tsx";
import {
  canRedo,
  canUndo,
  dirty,
  exportForPrototype,
  fileName,
  issues,
  library,
  newScenario,
  openFile,
  paletteClass,
  paletteSide,
  redo,
  saveFile,
  scenario,
  tool,
  undo,
  type Tool,
} from "./state.ts";
import { SIDE_LABEL } from "./symbols.ts";

const TOOLS: { id: Tool; label: string; key: string; title: string }[] = [
  { id: "select", label: "Select", key: "V", title: "Select, and drag to move (V)" },
  { id: "sensor", label: "Sensor", key: "S", title: "Click the map to place a sensor (S)" },
  { id: "emitter", label: "Emitter", key: "E", title: "Click the map to place an emitter of the chosen type (E)" },
  { id: "path", label: "Path", key: "P", title: "Click to add waypoints to the selected emitter's path (P)" },
  { id: "origin", label: "Origin", key: "O", title: "Click to move the scenario origin (O)" },
];

const SIDES: Side[] = ["hostile", "friend", "neutral", "civilian", "unknown"];

export function Toolbar() {
  const input = useRef<HTMLInputElement>(null);
  const list = issues.value;
  const errors = list.filter((i) => i.severity === "error").length;
  const warnings = list.length - errors;
  return (
    <header class="status editor-bar">
      <span class="brand">Videns</span>
      <nav class="modes">
        <a href="/" class="mode">
          Viewer
        </a>
        <span class="mode mode--on">Scenario editor</span>
      </nav>
      <div class="toolset" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" class={`tool${tool.value === t.id ? " tool--on" : ""}`} title={t.title} aria-pressed={tool.value === t.id} onClick={() => (tool.value = t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <label class="palette" title="What the Emitter tool places">
        <select value={paletteClass.value} onChange={(e) => (paletteClass.value = (e.currentTarget as HTMLSelectElement).value)} aria-label="Emitter type">
          {library.value.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <select value={paletteSide.value} onChange={(e) => (paletteSide.value = (e.currentTarget as HTMLSelectElement).value as Side)} aria-label="True side">
          {SIDES.map((s) => (
            <option key={s} value={s}>
              {SIDE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <span class="toolset">
        <button type="button" class="button button--small" onClick={undo} disabled={!canUndo()} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" class="button button--small" onClick={redo} disabled={!canRedo()} title="Redo (Ctrl+Y)">
          Redo
        </button>
      </span>
      <span class="toolset">
        <button type="button" class="button button--small" onClick={newScenario} title="Start an empty scenario at this origin (undoable)">
          New
        </button>
        <button type="button" class="button button--small" onClick={() => input.current?.click()} title="Open a scenario.v1 or prototype scenario">
          Open…
        </button>
        <button type="button" class="button button--small" onClick={saveFile} title="Save as scenario.v1">
          Save
        </button>
        <button type="button" class="button button--small" onClick={exportForPrototype} title="Write the prototype's scenario format; lists anything it cannot carry">
          Export for prototype
        </button>
      </span>
      <input
        ref={input}
        type="file"
        accept=".yaml,.yml"
        hidden
        onChange={async (e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          (e.currentTarget as HTMLInputElement).value = "";
          if (f) {
            await openFile(f);
            fitScenario();
          }
        }}
      />
      <span class="field">
        <span class="field__label">File</span>
        <span class="field__value">
          {fileName.value ?? scenario.value.name}
          {dirty.value ? " •" : ""}
        </span>
      </span>
      <span class={`pill ${errors ? "pill--bad" : warnings ? "pill--warn" : "pill--ok"}`} title="See the Issues tab">
        {errors ? `${errors} error${errors > 1 ? "s" : ""}` : warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : "Valid"}
      </span>
    </header>
  );
}
