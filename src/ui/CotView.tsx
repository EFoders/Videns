// The CoT tab: exactly the events Vigilans built for this object, and what became of them
// (VIDENS_SPEC.md rule 8, section 6.9). The XML is shown as text -- Preact escapes it --
// and is never parsed, reformatted or regenerated here.

import { useState } from "preact/hooks";

import type { CotRecord } from "../contract/generated/picture.ts";
import { dateTime } from "./format.ts";

const REASON_LABEL: Readonly<Record<string, string>> = {
  below_threshold: "below the publication threshold",
  publishing_disabled: "publishing is disabled",
  no_destination: "no destination is configured",
  no_representation: "no CoT representation has been decided",
};

export function CotView({ record }: { record: CotRecord | undefined }) {
  if (!record) {
    return <p class="muted">Vigilans has not built any CoT for this object yet.</p>;
  }
  const d = record.disposition;
  return (
    <div class="cot">
      {d.status === "published" ? (
        <div class="cot__disposition cot__disposition--published">
          <strong>Published</strong> at {dateTime(record.built_t)}
          <ul>
            {d.destinations?.map((dest) => (
              <li key={dest.name}>
                {dest.name}: {dest.outcome === "sent" ? "sent" : `failed (${dest.reason ?? "no reason given"})`}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div class="cot__disposition cot__disposition--withheld">
          <strong>Withheld</strong>: {REASON_LABEL[d.reason_code ?? ""] ?? d.reason_code}. {d.reason}
          <p>Built at {dateTime(record.built_t)}. This is what the CoT would have looked like; TAK did not receive it.</p>
        </div>
      )}
      {record.events.length === 0 && <p class="muted">No events: there is nothing to show until a representation exists.</p>}
      {record.events.map((event) => (
        <CotEventView key={event.uid} uid={event.uid} type={event.type} xml={event.xml} />
      ))}
    </div>
  );
}

function CotEventView({ uid, type, xml }: { uid: string; type: string; xml: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(xml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section class="cot__event">
      <header class="cot__header">
        <code>{type}</code>
        <span class="cot__uid" title={uid}>
          {uid}
        </span>
        <button type="button" class="button button--small" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </header>
      <pre class="xml">{xml}</pre>
    </section>
  );
}
