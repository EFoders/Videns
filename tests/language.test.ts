// No targeting language anywhere a reader could see it (VIDENS_SPEC.md rule 6): not in
// the UI source, not in the mock feed's wording, not in fixtures.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const FORBIDDEN = /\b(target(?:s|ed|ing)?|strike[sd]?|striking|engage(?:s|d|ment)?|engaging|kill(?:s|ed|ing)?)\b/gi;
// DOM and code idioms that are not language a reader sees.
const ALLOWED = [/\.target\b/g, /\bcurrentTarget\b/g, /\btarget:\s*process\.env/g, /\btarget: "es\d+"/g, /"target":/g, /\{ target:/g];

function files(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "generated" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, extensions));
    else if (extensions.some((e) => name.endsWith(e))) out.push(path);
  }
  return out;
}

function offences(path: string): string[] {
  let text = readFileSync(path, "utf8");
  for (const allowed of ALLOWED) text = text.replace(allowed, "");
  return [...text.matchAll(FORBIDDEN)].map((m) => `${relative(ROOT, path)}: "${m[0]}"`);
}

describe("language", () => {
  it("finds no targeting language in the viewer, the mock feed or the fixtures", () => {
    const scanned = [
      ...files(join(ROOT, "src"), [".ts", ".tsx", ".css"]),
      ...files(join(ROOT, "tools"), [".ts"]),
      ...files(join(ROOT, "fixtures"), [".json", ".jsonl"]),
      join(ROOT, "index.html"),
    ];
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned.flatMap(offences)).toEqual([]);
  });

  it("would catch it", () => {
    const text = "Likely a target; recommend strike.";
    expect([...text.matchAll(FORBIDDEN)].map((m) => m[0])).toEqual(["target", "strike"]);
  });
});
