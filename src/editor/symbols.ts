// The editor's symbols: MIL-STD-2525 frames from each emitter's TRUE side and category --
// the author's world, not a claim of Vigilans' (VIDENS_SPEC.md 16.4). Civilian uses the
// neutral frame in the standard's civilian colour.

import ms from "milsymbol";

import type { Side } from "../scenario/types.ts";
import type { RenderedIcon } from "../map/symbols.ts";

const PREFIX = "ed|";
export const ORIGIN_ICON = "ed-origin";
const CIVILIAN_FILL = "rgb(255, 161, 255)";

const SIDE_CHAR: Readonly<Record<Side, string>> = { friend: "F", hostile: "H", neutral: "N", civilian: "N", unknown: "U" };

export const SIDE_LABEL: Readonly<Record<Side, string>> = {
  friend: "Friend",
  hostile: "Hostile",
  neutral: "Neutral",
  civilian: "Civilian",
  unknown: "Unknown",
};

export function sideSidc(side: Side, category: "ground" | "air"): string {
  return `S${SIDE_CHAR[side]}${category === "air" ? "A" : "G"}P-----------`;
}

export const SENSOR_SIDC = "SFGPES---------";

export function editorIconKey(sidc: string, label: string, civilian: boolean, faded: boolean): string {
  return `${PREFIX}${sidc}|${label.replace(/\|/g, "/")}|${civilian ? "c" : ""}|${faded ? "f" : ""}`;
}

export function renderEditorIcon(key: string, pixelRatio: number): RenderedIcon | null {
  if (key === ORIGIN_ICON) return renderOrigin(pixelRatio);
  if (!key.startsWith(PREFIX)) return null;
  const [sidc, label, civilian] = key.slice(PREFIX.length).split("|");
  if (!sidc) return null;
  const symbol = new ms.Symbol(sidc, {
    size: 24,
    uniqueDesignation: label ?? "",
    infoColor: "#f1f5f9",
    infoOutlineColor: "#0b1015",
    infoOutlineWidth: 3,
    outlineColor: "#0b1015",
    outlineWidth: 2,
    ...(civilian === "c" ? { fillColor: CIVILIAN_FILL } : {}),
  });
  const source = symbol.asCanvas(pixelRatio);
  const anchor = symbol.getAnchor();
  const size = symbol.getSize();
  const halfW = Math.max(anchor.x, size.width - anchor.x) + 4;
  const halfH = Math.max(anchor.y, size.height - anchor.y) + 4;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(2 * halfW * pixelRatio);
  canvas.height = Math.ceil(2 * halfH * pixelRatio);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.drawImage(source, halfW - anchor.x, halfH - anchor.y, size.width, size.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data, pixelRatio };
}

/** The scenario origin: a ringed cross, unlike any symbol. */
function renderOrigin(pixelRatio: number): RenderedIcon {
  const size = 26;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size * pixelRatio);
  canvas.height = Math.ceil(size * pixelRatio);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(pixelRatio, pixelRatio);
  const c = size / 2;
  for (const [colour, width] of [["#0b1015", 4], ["#ffd166", 1.75]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, 7, 0, 2 * Math.PI);
    ctx.moveTo(c, 1);
    ctx.lineTo(c, size - 1);
    ctx.moveTo(1, c);
    ctx.lineTo(size - 1, c);
    ctx.stroke();
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data, pixelRatio };
}
