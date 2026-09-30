// The CoT tab shows Vigilans' bytes as text, never as markup (VIDENS_SPEC.md rules 8, 15).

import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import type { CotRecord } from "../src/contract/generated/picture.ts";
import { CotView } from "../src/ui/CotView.tsx";
import { entity, T0 } from "./helpers.ts";
import { emitterEvents } from "../tools/mock-feed/cot.ts";

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<event version="2.0" uid="vigilans.E1" type="a-u-G">\n  <detail><remarks>a &amp; b <script>alert(1)</script></remarks></detail>\n</event>\n`;

const published: CotRecord = {
  object: { kind: "entity", id: "E1" },
  built_t: T0,
  events: [{ uid: "vigilans.E1", type: "a-u-G", xml }],
  disposition: { status: "published", destinations: [{ name: "tak-lab (tcp)", outcome: "sent" }] },
};

describe("CotView", () => {
  it("renders the XML as escaped text, so nothing in it becomes markup", () => {
    const html = renderToString(<CotView record={published} />);
    expect(html).toContain("&lt;event version=&quot;2.0&quot;");
    expect(html).toContain("&lt;script>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<event");
  });

  it("shows every byte it was given", () => {
    const html = renderToString(<CotView record={published} />);
    const unescaped = html
      .match(/<pre class="xml">([\s\S]*?)<\/pre>/)![1]!
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    expect(unescaped).toBe(xml);
  });

  it("says where published CoT went", () => {
    expect(renderToString(<CotView record={published} />)).toContain("tak-lab (tcp): sent");
  });

  it("says withheld CoT is what TAK would have received, and why it did not", () => {
    const withheld: CotRecord = {
      ...published,
      disposition: { status: "withheld", reason_code: "below_threshold", reason: "Tentative entities are not published." },
    };
    const html = renderToString(<CotView record={withheld} />);
    expect(html).toContain("Withheld");
    expect(html).toContain("below the publication threshold");
    expect(html).toContain("would have looked like");
  });

  it("says so when there is no record, rather than showing an empty box", () => {
    expect(renderToString(<CotView record={undefined} />)).toContain("has not built any CoT");
  });
});

describe("mock CoT builder", () => {
  it("builds no ellipse event and an unknown ce for an unreported uncertainty", () => {
    const events = emitterEvents(entity("E3", { position_uncertainty: { basis: "unreported" } }), T0, "mock", 30);
    expect(events.map((e) => e.type)).toEqual(["a-u-G"]);
    expect(events[0]!.xml).toContain('ce="9999999.0"');
  });

  it("uses the affiliation's CoT character and escapes text", () => {
    const e = entity("E2", {
      affiliation: { identity: "hostile", basis: "library", reasons: ['Class "syn.bravo" & friends <x>'] },
      symbol: { sidc: "SHAP-----------" },
    });
    const [marker, ellipse] = emitterEvents(e, T0, "mock", 30);
    expect(marker!.type).toBe("a-h-A");
    expect(marker!.xml).toContain("Class &quot;syn.bravo&quot; &amp; friends &lt;x&gt;");
    expect(ellipse!.type).toBe("u-d-c-e");
  });
});
