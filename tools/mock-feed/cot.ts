// A stand-in for Vigilans' CoT builder, so the CoT tab has real-shaped bytes to show before
// Vigilans exists. It follows the prototype's conventions (Vigilans-prototype
// src/vigilans/publish/cot.py): millisecond UTC times, `m-f` for fused emitter markers,
// `9999999.0` for unknown values, a native `u-d-c-e` ellipse carrying semi-axes, and a
// `<__vigilans>` detail mirroring the remarks.
//
// This lives in the mock feed, never in the viewer: Videns displays CoT, it does not build
// it (VIDENS_SPEC.md rule 8). When Vigilans publishes for real, this file retires.

import type { CotEvent, Entity, Sensor, StandardIdentity } from "../../src/contract/generated/picture.ts";
import { drawableEllipse } from "../../src/geo/ellipse.ts";

const UNKNOWN_VALUE = "9999999.0";
const COT_CONFIDENCE = 0.95;

const IDENTITY_COT_CHAR: Readonly<Record<StandardIdentity, string>> = {
  pending: "p",
  unknown: "u",
  assumed_friend: "a",
  friend: "f",
  neutral: "n",
  suspect: "s",
  hostile: "h",
};

export function cotTime(iso: string, offsetS = 0): string {
  const ms = Date.parse(iso) + offsetS * 1000;
  return new Date(ms).toISOString(); // already millisecond precision with a literal Z
}

/** CoT type from the identity and the battle dimension in the symbol code. */
export function cotType(identity: StandardIdentity, sidc: string, suffix = ""): string {
  const dimension = sidc.charAt(2) || "G";
  return `a-${IDENTITY_COT_CHAR[identity]}-${dimension}${suffix}`;
}

export function uid(namespace: string, ...parts: string[]): string {
  return ["vigilans", namespace, ...parts].filter(Boolean).join(".");
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Node {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: Node[];
}

function render(node: Node, depth = 0): string {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(node.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escape(v)}"`)
    .join("");
  if (!node.children?.length && node.text === undefined) return `${pad}<${node.tag}${attrs} />`;
  if (!node.children?.length) return `${pad}<${node.tag}${attrs}>${escape(node.text ?? "")}</${node.tag}>`;
  const inner = node.children.map((child) => render(child, depth + 1)).join("\n");
  return `${pad}<${node.tag}${attrs}>\n${inner}\n${pad}</${node.tag}>`;
}

function document(node: Node): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(node)}\n`;
}

function event(uidValue: string, type: string, how: string, t: string, staleS: number, point: Record<string, string>, detail: Node[]): Node {
  return {
    tag: "event",
    attrs: { version: "2.0", uid: uidValue, type, how, time: cotTime(t), start: cotTime(t), stale: cotTime(t, staleS) },
    children: [{ tag: "point", attrs: point }, { tag: "detail", children: detail }],
  };
}

export function emitterEvents(entity: Entity, t: string, namespace: string, staleS: number): CotEvent[] {
  if (!entity.position || !entity.position_uncertainty) return [];
  const ellipse = drawableEllipse(entity.position_uncertainty, COT_CONFIDENCE);
  const type = cotType(entity.affiliation.identity, entity.symbol.sidc);
  const markerUid = uid(namespace, entity.entity_id);
  const leading = entity.classification.candidates?.[0];

  const classClause = leading ? `Class: ${leading.wording} (${leading.confidence.toFixed(2)}).` : "Class: unclassified.";
  const fixClause = ellipse
    ? `Fix: 95% ellipse a=${ellipse.semiMajorM.toFixed(0)} m b=${ellipse.semiMinorM.toFixed(0)} m @ ${ellipse.orientationDeg.toFixed(0).padStart(3, "0")}.`
    : "Fix: uncertainty unreported by source.";
  const why = leading ? ` Why: ${leading.reasons.join("; ")}.` : "";
  const heard = `Last heard ${entity.last_seen.slice(11, 19)}Z.`;

  const reasons = [...(leading?.reasons ?? []), ...entity.affiliation.reasons];
  const marker = event(
    markerUid,
    type,
    "m-f",
    t,
    staleS,
    {
      lat: entity.position.lat.toFixed(6),
      lon: entity.position.lon.toFixed(6),
      hae: UNKNOWN_VALUE,
      ce: ellipse ? Math.sqrt(ellipse.semiMajorM * ellipse.semiMinorM).toFixed(1) : UNKNOWN_VALUE,
      le: UNKNOWN_VALUE,
    },
    [
      { tag: "contact", attrs: { callsign: entity.label ?? entity.entity_id } },
      { tag: "remarks", text: `${classClause}${why} ${fixClause} ${heard}` },
      {
        tag: "__vigilans",
        attrs: {
          entity: entity.entity_id,
          state: entity.state,
          affiliation: entity.affiliation.identity,
          affiliation_basis: entity.affiliation.basis,
          uncertainty_basis: entity.position_uncertainty.basis,
          ...(leading ? { class: leading.class, class_conf: leading.confidence.toFixed(2) } : {}),
        },
        children: [
          {
            tag: "fix",
            attrs: {
              channel_hz: entity.freq_hz.toFixed(0),
              bandwidth_hz: entity.bandwidth_hz.toFixed(0),
              last_seen: cotTime(entity.last_seen),
              ...(ellipse
                ? {
                    probability: COT_CONFIDENCE.toFixed(2),
                    semi_major_m: ellipse.semiMajorM.toFixed(1),
                    semi_minor_m: ellipse.semiMinorM.toFixed(1),
                    orientation_deg: ellipse.orientationDeg.toFixed(1),
                  }
                : {}),
            },
          },
          ...reasons.map((reason) => ({ tag: "reason", text: reason })),
        ],
      },
    ],
  );

  const events: CotEvent[] = [{ uid: markerUid, type, xml: document(marker) }];
  if (ellipse) {
    const ellipseUid = `${markerUid}.ellipse`;
    const shape = event(
      ellipseUid,
      "u-d-c-e",
      "h-e",
      t,
      staleS,
      { lat: entity.position.lat.toFixed(6), lon: entity.position.lon.toFixed(6), hae: UNKNOWN_VALUE, ce: UNKNOWN_VALUE, le: UNKNOWN_VALUE },
      [
        {
          tag: "shape",
          children: [
            {
              tag: "ellipse",
              attrs: {
                major: ellipse.semiMajorM.toFixed(1),
                minor: ellipse.semiMinorM.toFixed(1),
                angle: ellipse.orientationDeg.toFixed(1),
              },
            },
            {
              tag: "link",
              attrs: { uid: `${ellipseUid}.style`, type: "b-x-KmlStyle", relation: "p-c" },
              children: [
                {
                  tag: "Style",
                  children: [
                    { tag: "LineStyle", children: [{ tag: "color", text: "ff0000ff" }, { tag: "width", text: "2" }] },
                    { tag: "PolyStyle", children: [{ tag: "color", text: "330000ff" }] },
                  ],
                },
              ],
            },
          ],
        },
        { tag: "contact", attrs: { callsign: `${entity.label ?? entity.entity_id} 95%` } },
      ],
    );
    events.push({ uid: ellipseUid, type: "u-d-c-e", xml: document(shape) });
  }
  return events;
}

export function sensorEvents(sensor: Sensor, t: string, namespace: string, staleS: number): CotEvent[] {
  if (!sensor.position) return [];
  const markerUid = uid(namespace, "sensor", sensor.sensor_id);
  const type = cotType(sensor.affiliation.identity, sensor.symbol.sidc, "-E-S");
  const xml = document(
    event(
      markerUid,
      type,
      "m-g",
      t,
      staleS,
      { lat: sensor.position.lat.toFixed(6), lon: sensor.position.lon.toFixed(6), hae: UNKNOWN_VALUE, ce: "10.0", le: UNKNOWN_VALUE },
      [
        { tag: "contact", attrs: { callsign: sensor.label ?? sensor.sensor_id } },
        { tag: "remarks", text: `Sensor ${sensor.sensor_id} (${sensor.source_id}), health ${sensor.health}.` },
      ],
    ),
  );
  return [{ uid: markerUid, type, xml }];
}
