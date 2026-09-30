import { useEffect, useState } from "preact/hooks";

import { BasemapSwitcher } from "../ui/BasemapSwitcher.tsx";
import { EditorMap } from "./EditorMap.tsx";
import { IssuesPanel, WorldPanel } from "./Panels.tsx";
import { PreviewBar } from "./PreviewBar.tsx";
import { Properties } from "./Properties.tsx";
import { deleteSelected } from "./keys.ts";
import { hint, issues, notice, selection, tool } from "./state.ts";
import { Toolbar } from "./Toolbar.tsx";

type Tab = "properties" | "world" | "issues";

const TOOL_HELP: Record<string, string> = {
  select: "Click to select; drag sensors, emitters and waypoints to move them. Delete removes the selection.",
  sensor: "Click the map to place a sensor. Esc to stop.",
  emitter: "Click the map to place an emitter of the type and side chosen above. Esc to stop.",
  path: "Click to add waypoints to the selected emitter's path. Esc to stop.",
  origin: "Click the map to move the scenario origin. Everything stays where it is.",
};

export function EditorApp() {
  const [tab, setTab] = useState<Tab>("properties");
  const sel = selection.value;
  useEffect(() => {
    if (sel) setTab("properties");
  }, [sel && "id" in sel ? `${sel.kind}:${sel.id}` : sel && "index" in sel ? `${sel.kind}:${sel.index}` : sel?.kind]);
  useEffect(() => {
    if (!hint.value) return;
    const t = setTimeout(() => (hint.value = null), 4000);
    return () => clearTimeout(t);
  }, [hint.value]);

  const list = issues.value;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "properties", label: "Properties" },
    { id: "world", label: "World" },
    { id: "issues", label: "Issues", badge: list.length },
  ];
  return (
    <div class="app">
      <Toolbar />
      <main class="main">
        <div class="map-wrap">
          <EditorMap />
          <div class="banner banner--idle editor-help">{hint.value ?? TOOL_HELP[tool.value]}</div>
          {notice.value && (
            <div class="notice" role="dialog" aria-label={notice.value.title}>
              <strong>{notice.value.title}</strong>
              <ul>
                {notice.value.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              <button type="button" class="button button--small" onClick={() => (notice.value = null)}>
                Close
              </button>
            </div>
          )}
          <BasemapSwitcher />
          <PreviewBar />
        </div>
        <aside class="panel">
          <nav class="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} class={`tab${tab === t.id ? " tab--active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
                {t.badge ? <span class={`tab__badge${list.some((i) => i.severity === "error") ? " tab__badge--warn" : ""}`}>{t.badge}</span> : null}
              </button>
            ))}
          </nav>
          <div class="panel__body">
            {tab === "properties" && <Properties />}
            {tab === "world" && <WorldPanel />}
            {tab === "issues" && <IssuesPanel />}
          </div>
          {sel && sel.kind !== "scenario" && tab === "properties" && (
            <div class="panel__foot">
              <button type="button" class="button button--small" onClick={deleteSelected}>
                Delete selected
              </button>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
