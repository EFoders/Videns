// Form fields that commit once, on change -- so one edit is one undo step -- and never
// accept a value that is not a number where a number is meant.

import type { ComponentChildren } from "preact";

interface Common {
  label: string;
  hint?: string;
  testId?: string;
}

export function NumberField({
  label,
  value,
  unit,
  onCommit,
  step = "any",
  min,
  max,
  optional = false,
  placeholder,
  hint,
  scale = 1,
  testId,
}: Common & {
  value: number | null | undefined;
  unit?: string;
  onCommit: (v: number | null) => void;
  step?: number | "any";
  min?: number;
  max?: number;
  optional?: boolean;
  placeholder?: string;
  /** Show value / scale, commit input * scale: e.g. MHz on screen, Hz in the file. */
  scale?: number;
}) {
  const shown = value === null || value === undefined ? "" : String(Number((value / scale).toPrecision(12)));
  return (
    <label class="field-row" title={hint}>
      <span class="field-row__label">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={shown}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => {
          const text = (e.currentTarget as HTMLInputElement).value.trim();
          if (text === "") {
            if (optional) onCommit(null);
            else (e.currentTarget as HTMLInputElement).value = shown;
            return;
          }
          const n = Number(text);
          if (!Number.isFinite(n)) {
            (e.currentTarget as HTMLInputElement).value = shown;
            return;
          }
          onCommit(n * scale);
        }}
      />
      {unit && <span class="field-row__unit">{unit}</span>}
    </label>
  );
}

export function TextField({ label, value, onCommit, hint, testId, placeholder }: Common & { value: string | undefined; onCommit: (v: string) => void; placeholder?: string }) {
  return (
    <label class="field-row" title={hint}>
      <span class="field-row__label">{label}</span>
      <input type="text" value={value ?? ""} placeholder={placeholder} data-testid={testId} onChange={(e) => onCommit((e.currentTarget as HTMLInputElement).value.trim())} />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onCommit,
  hint,
  testId,
}: Common & { value: T; options: readonly { value: T; label: string }[]; onCommit: (v: T) => void }) {
  return (
    <label class="field-row" title={hint}>
      <span class="field-row__label">{label}</span>
      <select value={value} data-testid={testId} onChange={(e) => onCommit((e.currentTarget as HTMLSelectElement).value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckField({ label, value, onCommit, hint, testId }: Common & { value: boolean; onCommit: (v: boolean) => void }) {
  return (
    <label class="field-row field-row--check" title={hint}>
      <input type="checkbox" checked={value} data-testid={testId} onChange={(e) => onCommit((e.currentTarget as HTMLInputElement).checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Group({ title, children, note }: { title: string; children: ComponentChildren; note?: string }) {
  return (
    <section class="section">
      <h3 class="section__title">{title}</h3>
      {note && <p class="muted">{note}</p>}
      {children}
    </section>
  );
}
