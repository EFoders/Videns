import "maplibre-gl/dist/maplibre-gl.css";
import "../styles.css";
import "./editor.css";

import { render } from "preact";

import { adoptConfig } from "../app/state.ts";
import { loadConfig } from "../config.ts";
import { EditorApp } from "./EditorApp.tsx";
import { installKeys } from "./keys.ts";
import { loadLibrary, restoreDraft } from "./state.ts";

// The editor uses the viewer's configuration for its basemaps; it starts no feed.
async function start(): Promise<void> {
  try {
    adoptConfig(await loadConfig());
  } catch {
    // Without a configuration there is simply no basemap; the editor still works.
  }
  restoreDraft();
  await loadLibrary();
  installKeys();
  render(<EditorApp />, document.getElementById("app")!);
}

void start();
