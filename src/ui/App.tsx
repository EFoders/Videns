import { useEffect, useState } from "preact/hooks";

import { openFiles } from "../app/files.ts";
import { counters, lastMessageAt, now, picture, selection, shown, view } from "../app/state.ts";
import { timeView } from "../app/timeview.ts";
import { MapView } from "../map/MapView.tsx";
import { BasemapSwitcher } from "./BasemapSwitcher.tsx";
import { EntityList } from "./EntityList.tsx";
import { Inspector } from "./Inspector.tsx";
import { Legend } from "./Legend.tsx";
import { AboutPanel, DiagnosticsPanel, LogPanel } from "./Panels.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { summarise } from "./status.ts";
import { TimelineBar } from "./TimelineBar.tsx";

type Tab = "inspector" | "entities" | "log" | "diagnostics" | "about";

export function App() {
  const [tab, setTab] = useState<Tab>("inspector");
  const [dragging, setDragging] = useState(false);
  const status = summarise(view.value, picture.value, lastMessageAt.value, now.value, timeView.value);
  const rejected = counters.value.rejected + counters.value.gaps;
  // A new selection brings the inspector forward, once; the reader can still switch away.
  const selected = selection.value;
  useEffect(() => {
    if (selected) setTab("inspector");
  }, [selected?.kind, selected?.id]);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "inspector", label: "Inspector" },
    { id: "entities", label: "Entities", badge: shown.value.entities.size },
    { id: "log", label: "Log", badge: shown.value.log.length },
    { id: "diagnostics", label: "Diagnostics", badge: rejected },
    { id: "about", label: "About" },
  ];

  return (
    <div class="app">
      <StatusBar />
      <main class="main">
        <div
          class={`map-wrap${dragging ? " map-wrap--drop" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer?.files.length) void openFiles(e.dataTransfer.files);
          }}
        >
          {/* The map waits for the configuration, because the basemap comes from it. */}
          {view.value.kind !== "loading" && <MapView />}
          {status.banner && <div class={`banner banner--${status.tone}`}>{status.banner}</div>}
          {dragging && <div class="dropzone">Drop a .picture.jsonl recording, and its .truth.jsonl, to replay it</div>}
          <BasemapSwitcher />
          <Legend />
          <TimelineBar />
        </div>
        <aside class="panel">
          <nav class="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} class={`tab${tab === t.id ? " tab--active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
                {t.badge ? <span class={`tab__badge${t.id === "diagnostics" ? " tab__badge--warn" : ""}`}>{t.badge}</span> : null}
              </button>
            ))}
          </nav>
          <div class="panel__body">
            {tab === "inspector" && <Inspector />}
            {tab === "entities" && <EntityList />}
            {tab === "log" && <LogPanel />}
            {tab === "diagnostics" && <DiagnosticsPanel />}
            {tab === "about" && <AboutPanel />}
          </div>
        </aside>
      </main>
    </div>
  );
}
