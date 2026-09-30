// Keyboard: tools, delete, escape, undo and redo. Ignored while typing in a field.

import { deleteEmitter, deleteNet, deleteRelation, deleteSensor, deleteSource, removeWaypoint } from "../scenario/editing.ts";
import { commit, redo, scenario, select, selection, tool, undo, type Tool } from "./state.ts";

const TOOL_KEYS: Record<string, Tool> = { v: "select", s: "sensor", e: "emitter", p: "path", o: "origin" };

export function deleteSelected(): void {
  const sel = selection.value;
  const s = scenario.value;
  if (!sel || sel.kind === "scenario") return;
  if (sel.kind === "sensor") commit(deleteSensor(s, sel.id));
  else if (sel.kind === "emitter") commit(deleteEmitter(s, sel.id));
  else if (sel.kind === "net") commit(deleteNet(s, sel.id));
  else if (sel.kind === "relation") commit(deleteRelation(s, sel.index));
  else if (sel.kind === "source") commit(deleteSource(s, sel.id));
  else if (sel.kind === "waypoint") {
    const e = s.emitters.find((x) => x.id === sel.id);
    if (e && e.path_m.length > 1) {
      commit(removeWaypoint(s, sel.id, sel.index));
      select({ kind: "emitter", id: sel.id });
      return;
    }
    commit(deleteEmitter(s, sel.id));
  }
  select(null);
}

export function installKeys(): void {
  document.addEventListener("keydown", (e) => {
    const focused = e.target as HTMLElement | null;
    if (focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA" || focused.tagName === "SELECT")) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === "escape") tool.value = "select";
    else if (key === "delete" || key === "backspace") {
      e.preventDefault();
      deleteSelected();
    } else if (TOOL_KEYS[key]) tool.value = TOOL_KEYS[key]!;
  });
}
