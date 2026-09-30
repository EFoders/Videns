// Choose the map background. Each option says where its tiles come from: an online one
// tells a third party which area is being viewed; "none" requests nothing at all.

import { useEffect, useRef, useState } from "preact/hooks";

import { activeBasemap, basemapId, chooseBasemap, config } from "../app/state.ts";
import { describeBasemap } from "../config.ts";

const KIND_TAG = { online: "online", none: "private" } as const;

export function BasemapSwitcher() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const options = config.value?.basemaps ?? [];
  const active = activeBasemap();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (options.length < 2) return null;
  return (
    <div class="basemaps" ref={root}>
      <button type="button" class="basemaps__button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Choose the basemap">
        <span class="basemaps__icon" aria-hidden="true">
          ▤
        </span>
        {active.label}
      </button>
      {open && (
        <ul class="basemaps__menu" role="menu">
          {options.map((option) => {
            const selected = option.id === basemapId.value;
            return (
              <li key={option.id} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  class={`basemaps__option${selected ? " basemaps__option--selected" : ""}`}
                  onClick={() => {
                    chooseBasemap(option.id);
                    setOpen(false);
                  }}
                >
                  <span class="basemaps__row">
                    <span class="basemaps__radio" aria-hidden="true">
                      {selected ? "●" : "○"}
                    </span>
                    <span class="basemaps__label">{option.label}</span>
                    <span class={`basemaps__tag basemaps__tag--${option.kind}`}>{KIND_TAG[option.kind]}</span>
                  </span>
                  <span class="basemaps__detail">{describeBasemap(option)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
