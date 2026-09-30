// Viewer configuration: /videns.config.json, rendered by the container from its
// environment and its basemap list (VIDENS_SPEC.md section 11). Validated here, shown in
// the About tab, and never silently replaced by defaults: an unreadable or invalid file is
// an error on screen.

/**
 * Where a map background comes from (VIDENS_SPEC.md section 8.1, rule 14).
 *  - none: a plain background and graticule; no map data, no requests.
 *  - online: raster tiles from a third-party server. Every tile request tells that server
 *    which area is being looked at, so it is an explicit choice and always shown as one.
 */
export type Basemap =
  | { kind: "none" }
  | { kind: "online"; url: string; origin: string; attribution: string; maxZoom: number; tone: "muted" | "natural" };

/** One entry in the basemap switcher. */
export type BasemapOption = Basemap & { id: string; label: string };

export interface ViewerConfig {
  /** Base path of the picture feed on this origin, or null for file-only use. */
  feed: string | null;
  /** Every basemap the reader may choose, in menu order. */
  basemaps: BasemapOption[];
  /** The id of the basemap shown first. */
  basemapDefault: string;
  /** Probability the drawn uncertainty regions contain, in (0, 1). */
  ellipseConfidence: number;
  view: { lat: number; lon: number; zoom: number } | null;
  coordinateFormat: "dd";
  truthOverlay: boolean;
  /** Where the configuration came from, for the About tab. */
  loadedFrom: string;
}

export const CONFIG_PATH = "/videns.config.json";
export const NO_BASEMAP: BasemapOption = { id: "none", label: "None", kind: "none" };

export class ConfigError extends Error {}

export async function loadConfig(fetcher: typeof fetch = fetch): Promise<ViewerConfig> {
  let response: Response;
  try {
    response = await fetcher(CONFIG_PATH, { cache: "no-store" });
  } catch (error) {
    throw new ConfigError(`could not fetch ${CONFIG_PATH}: ${(error as Error).message}`);
  }
  if (!response.ok) throw new ConfigError(`${CONFIG_PATH} returned HTTP ${response.status}`);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throw new ConfigError(`${CONFIG_PATH} is not valid JSON: ${(error as Error).message}`);
  }
  return parseConfig(raw, CONFIG_PATH);
}

export function parseConfig(raw: unknown, loadedFrom: string): ViewerConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ConfigError("configuration must be a JSON object");
  const c = raw as Record<string, unknown>;
  const problems: string[] = [];
  const known = new Set(["feed", "basemaps", "basemap", "ellipse_confidence", "view", "coordinate_format", "truth_overlay"]);
  for (const key of Object.keys(c)) if (!known.has(key)) problems.push(`unknown setting "${key}"`);

  let feed: string | null = null;
  if (c.feed === "none") feed = null;
  else if (typeof c.feed === "string" && c.feed.startsWith("/")) feed = c.feed.replace(/\/+$/, "");
  else problems.push(`feed must be a same-origin path beginning with "/" or "none", got ${JSON.stringify(c.feed)}`);

  const basemaps = parseBasemaps(c.basemaps, problems);
  const basemapDefault = typeof c.basemap === "string" ? c.basemap : "";
  if (basemaps && !basemaps.some((b) => b.id === basemapDefault)) {
    problems.push(`basemap ${JSON.stringify(c.basemap)} is not one of the configured basemaps (${basemaps.map((b) => b.id).join(", ")})`);
  }

  const confidence = Number(c.ellipse_confidence);
  if (!(confidence > 0 && confidence < 1)) problems.push(`ellipse_confidence must be in (0, 1), got ${JSON.stringify(c.ellipse_confidence)}`);

  let view: ViewerConfig["view"] = null;
  if (c.view !== null && c.view !== undefined) {
    const v = c.view as Record<string, unknown>;
    const lat = Number(v.lat);
    const lon = Number(v.lon);
    const zoom = Number(v.zoom);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && zoom >= 0 && zoom <= 22) view = { lat, lon, zoom };
    else problems.push(`view must be {lat, lon, zoom} within range, got ${JSON.stringify(c.view)}`);
  }

  if ((c.coordinate_format ?? "dd") !== "dd") problems.push(`coordinate_format ${JSON.stringify(c.coordinate_format)} is not supported yet; only "dd"`);
  if (c.truth_overlay !== undefined && typeof c.truth_overlay !== "boolean") problems.push("truth_overlay must be true or false");

  if (problems.length || !basemaps) throw new ConfigError(problems.join("; "));
  return {
    feed,
    basemaps,
    basemapDefault,
    ellipseConfidence: confidence,
    view,
    coordinateFormat: "dd",
    truthOverlay: c.truth_overlay === true,
    loadedFrom,
  };
}

function parseBasemaps(raw: unknown, problems: string[]): BasemapOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push("basemaps must be a non-empty list");
    return null;
  }
  const options: BasemapOption[] = [];
  const ids = new Set<string>();
  raw.forEach((entry, i) => {
    const b = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const where = `basemaps[${i}]`;
    const id = typeof b.id === "string" && /^[a-z0-9_-]{1,32}$/.test(b.id) ? b.id : "";
    const label = typeof b.label === "string" && b.label.trim() ? b.label.trim() : "";
    if (!id) problems.push(`${where}: id must be 1-32 lowercase letters, digits, - or _`);
    else if (ids.has(id)) problems.push(`${where}: duplicate id "${id}"`);
    if (!label) problems.push(`${where}: needs a label`);
    ids.add(id);
    const basemap = parseBasemap(b, where, problems);
    if (id && label && basemap) options.push({ ...basemap, id, label });
  });
  return options.length === raw.length ? options : null;
}

function parseBasemap(b: Record<string, unknown>, where: string, problems: string[]): Basemap | null {
  const attribution = typeof b.attribution === "string" ? b.attribution.trim() : "";
  if (b.kind === "none") return { kind: "none" };
  if (b.kind === "online") {
    const url = typeof b.url === "string" ? b.url : "";
    const match = /^(https:\/\/[^/{}]+)\//.exec(url);
    const maxZoom = b.max_zoom === undefined ? 19 : Number(b.max_zoom);
    const tone = b.tone === undefined ? "muted" : b.tone;
    if (!match) problems.push(`${where}: an online basemap url must be https://, got ${JSON.stringify(b.url)}`);
    else if (!["{z}", "{x}", "{y}"].every((p) => url.includes(p))) problems.push(`${where}: an online basemap url needs {z}, {x} and {y}, got ${url}`);
    // Map data licences require attribution; a basemap without one is not offered at all.
    if (!attribution) problems.push(`${where}: an online basemap needs its attribution`);
    if (!(Number.isInteger(maxZoom) && maxZoom >= 0 && maxZoom <= 22)) problems.push(`${where}: max_zoom must be 0-22, got ${JSON.stringify(b.max_zoom)}`);
    if (tone !== "muted" && tone !== "natural") problems.push(`${where}: tone must be "muted" or "natural", got ${JSON.stringify(b.tone)}`);
    return match && attribution && (tone === "muted" || tone === "natural")
      ? { kind: "online", url, origin: match[1]!, attribution, maxZoom, tone }
      : null;
  }
  // Offline (PMTiles) basemaps were descoped on 2026-09-30; say so rather than "unknown".
  const hint = b.kind === "pmtiles" ? " (offline basemaps are out of scope)" : "";
  problems.push(`${where}: unknown kind ${JSON.stringify(b.kind)}${hint}; expected "online" or "none"`);
  return null;
}

/** One line describing a basemap, for the About tab and the switcher. */
export function describeBasemap(basemap: Basemap): string {
  switch (basemap.kind) {
    case "none":
      return "no map data, nothing requested";
    case "online":
      return `online tiles from ${basemap.origin}, which sees the area being viewed`;
  }
}
