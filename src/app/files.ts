// Opening files: picture recordings (.picture.jsonl) and simulation truth (.truth.jsonl),
// told apart by the contract each line declares, not by the file name.

import { signal } from "@preact/signals";

import { openRecording } from "./state.ts";
import { openTruth } from "./truth.ts";

/** What the last open did, in a sentence, for the timeline bar. */
export const fileNote = signal<string | null>(null);

export async function openFiles(files: Iterable<File>): Promise<void> {
  const kinds = await Promise.all([...files].map(async (file) => ({ file, schema: await declaredSchema(file) })));
  const notes: string[] = [];
  // The recording first, so its truth has a run to belong to.
  for (const { file } of kinds.filter((k) => k.schema === "picture.v0")) {
    await openRecording(file);
    notes.push(`replaying ${file.name}`);
  }
  for (const { file } of kinds.filter((k) => k.schema === "truth.v0")) {
    const { accepted, rejected } = await openTruth(file);
    notes.push(`${file.name}: ${accepted} truth frames${rejected ? `, ${rejected} rejected` : ""}`);
  }
  for (const { file, schema } of kinds.filter((k) => k.schema !== "picture.v0" && k.schema !== "truth.v0")) {
    notes.push(`${file.name}: not a picture.v0 or truth.v0 file${schema ? ` (declares ${schema})` : ""}`);
  }
  fileNote.value = notes.join("; ") || null;
}

async function declaredSchema(file: File): Promise<string | null> {
  const head = await file.slice(0, 64 * 1024).text();
  const first = head.split(/\r?\n/).find((line) => line.trim());
  if (!first) return null;
  try {
    const schema = (JSON.parse(first) as { schema?: unknown }).schema;
    return typeof schema === "string" ? schema : null;
  } catch {
    return null;
  }
}
