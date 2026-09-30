// The scenario editor's state (VIDENS_SPEC.md 16.4). The scenario is an immutable value;
// every edit commits a new one, which is what makes undo and redo a pair of lists. A drag
// previews without committing and commits once when it ends.

import { batch, computed, signal } from "@preact/signals";

import type { Scenario, Side } from "../scenario/types.ts";
import { blankScenario } from "../scenario/defaults.ts";
import { exportPrototype, openScenario, saveScenario } from "../scenario/io.ts";
import { parseLibrary, type Library } from "../scenario/library.ts";
import { scenarioIssues } from "../scenario/validate.ts";

export type Tool = "select" | "sensor" | "emitter" | "path" | "origin";

export type EditorSelection =
  | { kind: "sensor"; id: string }
  | { kind: "emitter"; id: string }
  | { kind: "waypoint"; id: string; index: number }
  | { kind: "net"; id: string }
  | { kind: "source"; id: string }
  | { kind: "relation"; index: number }
  | { kind: "scenario" }
  | null;

const HISTORY_LIMIT = 200;
const DRAFT_KEY = "videns.editor.draft";

export const scenario = signal<Scenario>(blankScenario());
export const selection = signal<EditorSelection>(null);
export const tool = signal<Tool>("select");
/** The emitter type the emitter tool places: a library class id, or "custom". */
export const paletteClass = signal<string>("custom");
export const paletteSide = signal<Side>("hostile");
export const previewT = signal(0);
export const playback = signal<{ playing: boolean; rate: number }>({ playing: false, rate: 10 });
export const library = signal<Library>({ classes: [], roles: [], problems: [] });
export const librarySource = signal<string>("not loaded");
export const fileName = signal<string | null>(null);
export const dirty = signal(false);
/** What the last export or open had to say: dropped items, or why a file would not open. */
export const notice = signal<{ title: string; lines: string[] } | null>(null);
export const hint = signal<string | null>(null);

const past: Scenario[] = [];
const future: Scenario[] = [];
export const historyRevision = signal(0);

export const issues = computed(() => scenarioIssues(scenario.value, library.value));

export function canUndo(): boolean {
  historyRevision.value;
  return past.length > 0;
}

export function canRedo(): boolean {
  historyRevision.value;
  return future.length > 0;
}

/** Make `next` the scenario, as one undoable step. */
export function commit(next: Scenario, from: Scenario = scenario.value): void {
  if (next === from && next === scenario.value) return;
  past.push(from);
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  batch(() => {
    scenario.value = next;
    dirty.value = true;
    historyRevision.value += 1;
  });
  saveDraft();
}

/** Show `next` without recording a step: for the middle of a drag. */
export function preview(next: Scenario): void {
  scenario.value = next;
}

export function undo(): void {
  const previous = past.pop();
  if (!previous) return;
  future.push(scenario.value);
  batch(() => {
    scenario.value = previous;
    historyRevision.value += 1;
    dirty.value = true;
  });
  saveDraft();
}

export function redo(): void {
  const next = future.pop();
  if (!next) return;
  past.push(scenario.value);
  batch(() => {
    scenario.value = next;
    historyRevision.value += 1;
    dirty.value = true;
  });
  saveDraft();
}

export function select(ref: EditorSelection): void {
  selection.value = ref;
}

// --- Files -----------------------------------------------------------------------------

export async function openFile(file: File): Promise<void> {
  const opened = openScenario(await file.text());
  if (!opened.scenario) {
    notice.value = { title: `${file.name} did not open`, lines: opened.problems };
    return;
  }
  batch(() => {
    commit(opened.scenario!);
    fileName.value = file.name;
    dirty.value = false;
    selection.value = null;
    previewT.value = 0;
    notice.value =
      opened.flavour === "v2"
        ? null
        : {
            title: `Opened ${file.name}`,
            lines: [
              opened.flavour === "prototype"
                ? "A prototype scenario. It saves as scenario.v2; Export for prototype writes the prototype's format again."
                : "An older scenario.v1 file. It saves as scenario.v2.",
              ...(opened.notes.length ? ["Changed on the way:", ...opened.notes] : []),
            ],
          };
  });
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) => s.trim().replace(/[^A-Za-z0-9_.-]+/g, "_") || "scenario";

export function saveFile(): void {
  const name = `${slug(scenario.value.name)}.scenario.yaml`;
  download(name, saveScenario(scenario.value));
  fileName.value = name;
  dirty.value = false;
}

/** The prototype's format; anything it cannot express is listed, never dropped silently. */
export function exportForPrototype(): void {
  const { text, dropped } = exportPrototype(scenario.value);
  download(`${slug(scenario.value.name)}.yaml`, text);
  notice.value = {
    title: "Exported for the prototype",
    lines: dropped.length ? ["Not carried over, because the prototype cannot express it:", ...dropped] : ["Everything carried over."],
  };
}

export function newScenario(): void {
  batch(() => {
    commit({ ...blankScenario(scenario.value.origin), name: "untitled" });
    fileName.value = null;
    selection.value = null;
    previewT.value = 0;
  });
}

// --- Draft and library -------------------------------------------------------------------

/** A per-viewer convenience: the draft survives a reload. Nothing depends on it. */
function saveDraft(): void {
  try {
    localStorage.setItem(DRAFT_KEY, saveScenario(scenario.value));
  } catch {
    // storage unavailable: the draft simply is not kept
  }
}

export function restoreDraft(): boolean {
  try {
    const text = localStorage.getItem(DRAFT_KEY);
    if (!text) return false;
    const opened = openScenario(text);
    if (!opened.scenario) return false;
    scenario.value = opened.scenario;
    return true;
  } catch {
    return false;
  }
}

export const LIBRARY_PATH = "/library";

export async function loadLibrary(): Promise<void> {
  try {
    const [sig, roles] = await Promise.all([fetch(`${LIBRARY_PATH}/signatures.yaml`, { cache: "no-store" }), fetch(`${LIBRARY_PATH}/roles.yaml`, { cache: "no-store" })]);
    if (!sig.ok) throw new Error(`HTTP ${sig.status} for ${LIBRARY_PATH}/signatures.yaml`);
    const loaded = parseLibrary(await sig.text(), roles.ok ? await roles.text() : "");
    batch(() => {
      library.value = loaded;
      librarySource.value = `${LIBRARY_PATH}/signatures.yaml (${loaded.classes.length} classes)`;
      if (paletteClass.value === "custom" && loaded.classes[0]) paletteClass.value = loaded.classes[0].id;
    });
  } catch (error) {
    library.value = { classes: [], roles: [], problems: [`The signature library could not be loaded: ${(error as Error).message}. Custom emitters still work.`] };
    librarySource.value = "unavailable";
  }
}
