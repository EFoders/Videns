// A read-only window onto the running viewer for browser tests and debugging:
// `window.__videns.shown.value`, `window.__videns.map`. Nothing here changes state, and
// nothing in the viewer reads it back.

import { counters, cursorT, diagnostics, picture, selection, shown, source, view } from "./state.ts";

const inspection: Record<string, unknown> = { picture, shown, source, cursorT, counters, diagnostics, selection, view };

export function exposeForInspection(extra: Record<string, unknown>): void {
  Object.assign(inspection, extra);
  (globalThis as unknown as { __videns: Record<string, unknown> }).__videns = inspection;
}

exposeForInspection({});
