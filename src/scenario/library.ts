// The signature library the editor offers emitter types from: the Vigilans prototype's
// format. Read as data, never as code (Vigilans 9.1). The image ships a synthetic one; a
// deployment mounts its own over it (VIDENS_SPEC.md 16.2 rule 5).

import { parse } from "yaml";

import type { Activity, Emitter } from "./types.ts";

export interface EmitterClass {
  id: string;
  label: string;
  category: "ground" | "air";
  affiliationDefault: string;
  freqHz: [number, number];
  bandwidthHz: [number, number] | null;
  activity: { pattern: string; meanOnS: [number, number] | null } | null;
}

export interface Role {
  id: string;
  label: string;
}

export interface Library {
  classes: EmitterClass[];
  roles: Role[];
  /** Problems reading the library, for the issues panel. The rest still loads. */
  problems: string[];
}

const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number") ? [v[0] as number, v[1] as number] : null;

export function parseLibrary(signaturesYaml: string, rolesYaml = ""): Library {
  const problems: string[] = [];
  const classes: EmitterClass[] = [];
  const roles: Role[] = [];
  try {
    const doc = parse(signaturesYaml) as { signatures?: unknown[] } | null;
    for (const [i, raw] of (doc?.signatures ?? []).entries()) {
      const s = raw as Record<string, any>;
      const freq = pair(s?.required?.freq_hz);
      if (typeof s?.id !== "string" || !freq) {
        problems.push(`signature ${i + 1}: needs an id and required.freq_hz [low, high]`);
        continue;
      }
      classes.push({
        id: s.id,
        label: typeof s.label === "string" ? s.label : s.id,
        category: s.category === "air" ? "air" : "ground",
        affiliationDefault: typeof s.affiliation_default === "string" ? s.affiliation_default : "unknown",
        freqHz: freq,
        bandwidthHz: pair(s.features?.bandwidth_hz?.range),
        activity: s.features?.activity?.pattern ? { pattern: String(s.features.activity.pattern), meanOnS: pair(s.features.activity.mean_on_s) } : null,
      });
    }
  } catch (error) {
    problems.push(`signatures: not valid YAML (${(error as Error).message})`);
  }
  if (rolesYaml) {
    try {
      const doc = parse(rolesYaml) as { roles?: unknown[] } | null;
      for (const raw of doc?.roles ?? []) {
        const r = raw as Record<string, unknown>;
        if (typeof r?.id === "string") roles.push({ id: r.id, label: typeof r.label === "string" ? r.label : r.id });
      }
    } catch (error) {
      problems.push(`roles: not valid YAML (${(error as Error).message})`);
    }
  }
  return { classes, roles, problems };
}

/** Round a frequency to a 12.5 kHz channel, so a default reads like a real channel. */
const channel = (hz: number) => Math.round(hz / 12_500) * 12_500;

/**
 * An emitter's frequency, bandwidth, height and activity filled from its class: inside the
 * class's band, at a typical bandwidth. The author can change any of it.
 */
export function classDefaults(c: EmitterClass): Pick<Emitter, "freq_hz" | "bandwidth_hz" | "activity" | "alt_m"> {
  const [lo, hi] = c.freqHz;
  const bw = c.bandwidthHz ? Math.max(c.bandwidthHz[0], Math.min(c.bandwidthHz[1], (c.bandwidthHz[0] + c.bandwidthHz[1]) / 2)) : 25_000;
  let activity: Activity = { type: "continuous", hub: false };
  if (c.activity?.pattern === "bursty") {
    const on = c.activity.meanOnS ? (c.activity.meanOnS[0] + c.activity.meanOnS[1]) / 2 : 6;
    activity = { type: "bursty", mean_on_s: on, mean_off_s: 20, hub: false };
  }
  return { freq_hz: channel((lo + hi) / 2), bandwidth_hz: bw, activity, alt_m: c.category === "air" ? 120 : 0 };
}

export function classFor(library: Library, id: string | null | undefined): EmitterClass | undefined {
  return id ? library.classes.find((c) => c.id === id) : undefined;
}
