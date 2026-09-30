import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

import { render } from "preact";

import { start } from "./app/state.ts";
import { App } from "./ui/App.tsx";

render(<App />, document.getElementById("app")!);
void start();
