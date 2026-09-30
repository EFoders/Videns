// MIL-STD-2525 symbols for the map, drawn by milsymbol from the symbol code Vigilans chose.
//
// Each distinct (code, label, badges) combination becomes one map image, created on demand
// when MapLibre first asks for it. The symbol is placed so its anchor -- the point the
// standard says sits on the position -- is the centre of the image; the map can then use
// a plain centre anchor.
//
// Two badges are Videns' own, and both exist to stop the map overclaiming:
//   "?"  bottom-left: the position's uncertainty is unreported, so no region is drawn.
//   L/O  top-left: the affiliation was declared by a library or an operator. A default
//        affiliation carries no badge; it is always Unknown.

import ms from "milsymbol";

import type { Entity, Sensor } from "../contract/generated/picture.ts";

export const SYMBOL_SIZE = 26;
const PREFIX = "v1|";

export interface IconSpec {
  sidc: string;
  label: string;
  unreported: boolean;
  basis: "" | "L" | "O";
}

export function entityIcon(entity: Entity): IconSpec {
  return {
    sidc: entity.symbol.sidc,
    label: entity.label ?? entity.entity_id,
    unreported: entity.position_uncertainty?.basis === "unreported",
    basis: basisBadge(entity.affiliation.basis),
  };
}

export function sensorIcon(sensor: Sensor): IconSpec {
  return { sidc: sensor.symbol.sidc, label: sensor.label ?? sensor.sensor_id, unreported: false, basis: basisBadge(sensor.affiliation.basis) };
}

function basisBadge(basis: "default" | "library" | "operator"): IconSpec["basis"] {
  return basis === "library" ? "L" : basis === "operator" ? "O" : "";
}

export function iconKey(spec: IconSpec): string {
  const label = spec.label.replace(/\|/g, "/");
  return `${PREFIX}${spec.sidc}|${label}|${spec.unreported ? "?" : ""}|${spec.basis}`;
}

export function parseIconKey(key: string): IconSpec | null {
  if (!key.startsWith(PREFIX)) return null;
  const [sidc, label, unreported, basis] = key.slice(PREFIX.length).split("|");
  if (!sidc || label === undefined) return null;
  return { sidc, label, unreported: unreported === "?", basis: basis === "L" || basis === "O" ? basis : "" };
}

export interface RenderedIcon {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  pixelRatio: number;
}

export function renderIcon(spec: IconSpec, pixelRatio: number): RenderedIcon {
  const symbol = new ms.Symbol(spec.sidc, {
    size: SYMBOL_SIZE,
    uniqueDesignation: spec.label,
    infoColor: "#f1f5f9",
    infoOutlineColor: "#0b1015",
    infoOutlineWidth: 3,
    outlineColor: "#0b1015",
    outlineWidth: 2,
  });
  const source = symbol.asCanvas(pixelRatio);
  const anchor = symbol.getAnchor();
  const size = symbol.getSize();

  // Room either side of the anchor so it lands on the image centre, plus badge room.
  const margin = 14;
  const halfW = Math.max(anchor.x, size.width - anchor.x) + margin;
  const halfH = Math.max(anchor.y, size.height - anchor.y) + margin;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(2 * halfW * pixelRatio);
  canvas.height = Math.ceil(2 * halfH * pixelRatio);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.drawImage(source, halfW - anchor.x, halfH - anchor.y, size.width, size.height);

  const frame = SYMBOL_SIZE * 0.85;
  if (spec.unreported) badge(ctx, halfW - frame, halfH + frame * 0.7, "?", "#fbbf24", "#111827");
  if (spec.basis) badge(ctx, halfW - frame, halfH - frame * 0.8, spec.basis, "#e2e8f0", "#111827");

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data, pixelRatio };
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink: string): void {
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#0b1015";
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
}

/** A small symbol as a data URL, for the legend and the inspector header. */
export function symbolDataUrl(sidc: string, size = 22): string {
  return new ms.Symbol(sidc, { size }).toDataURL();
}

// --- Labels and markers that are not 2525 symbols ---------------------------------------
//
// Group labels, departure notes and the truth crosshair are drawn as images too, so the
// map still needs no glyphs from anywhere.

const LABEL_PREFIX = "lbl|";
export const TRUTH_ICON = "truth|crosshair";

export type LabelTone = "group" | "hypothesis" | "ghost";

export function labelKey(tone: LabelTone, text: string): string {
  return `${LABEL_PREFIX}${tone}|${text.replace(/\|/g, "/")}`;
}

export function renderSpecial(key: string, pixelRatio: number): RenderedIcon | null {
  if (key === TRUTH_ICON) return renderTruth(pixelRatio);
  if (!key.startsWith(LABEL_PREFIX)) return null;
  const [tone, ...rest] = key.slice(LABEL_PREFIX.length).split("|");
  return renderLabel(rest.join("|"), tone as LabelTone, pixelRatio);
}

const LABEL_STYLE: Readonly<Record<LabelTone, { fill: string; ink: string; border: string; dash: number[] }>> = {
  group: { fill: "rgba(17, 22, 27, 0.9)", ink: "#f1f5f9", border: "#e2b04a", dash: [] },
  hypothesis: { fill: "rgba(17, 22, 27, 0.85)", ink: "#cbd5e1", border: "#94a3b8", dash: [3, 2] },
  ghost: { fill: "rgba(17, 22, 27, 0.8)", ink: "#cbd5e1", border: "#64748b", dash: [3, 2] },
};

function renderLabel(text: string, tone: LabelTone, pixelRatio: number): RenderedIcon {
  const style = LABEL_STYLE[tone] ?? LABEL_STYLE.group;
  const font = "600 11px system-ui, sans-serif";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + 14;
  const height = 20;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(style.dash);
  ctx.beginPath();
  ctx.roundRect(0.75, 0.75, width - 1.5, height - 1.5, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = style.ink;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 7, height / 2 + 0.5);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data, pixelRatio };
}

/** Thin magenta crosshair: a style reserved for simulation truth, unlike any symbol. */
function renderTruth(pixelRatio: number): RenderedIcon {
  const size = 22;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size * pixelRatio);
  canvas.height = Math.ceil(size * pixelRatio);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(pixelRatio, pixelRatio);
  const c = size / 2;
  ctx.strokeStyle = "#0b1015";
  ctx.lineWidth = 3.5;
  const cross = () => {
    ctx.beginPath();
    ctx.moveTo(c, 1);
    ctx.lineTo(c, c - 3);
    ctx.moveTo(c, c + 3);
    ctx.lineTo(c, size - 1);
    ctx.moveTo(1, c);
    ctx.lineTo(c - 3, c);
    ctx.moveTo(c + 3, c);
    ctx.lineTo(size - 1, c);
    ctx.stroke();
  };
  cross();
  ctx.strokeStyle = "#f472b6";
  ctx.lineWidth = 1.5;
  cross();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data, pixelRatio };
}
