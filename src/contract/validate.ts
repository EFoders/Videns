// Every message goes through here before it reaches the store: JSON parse, schema
// validation, then the checks JSON Schema cannot express. A failure is returned with its
// reasons so the diagnostics panel can show it (VIDENS_SPEC.md rule 12); it is never
// thrown and never silently dropped.

import type { PictureMessage } from "./generated/picture.ts";
import type { TruthFrame } from "./generated/truth.ts";
import * as validators from "./generated/validators.js";
import type { ValidateFunction } from "./generated/validators.js";
import { semanticIssues } from "./semantic.ts";

export interface Issue {
  path: string;
  message: string;
}

export type Validated =
  | { ok: true; message: PictureMessage }
  | { ok: false; type?: string; seq?: number; runId?: string; issues: Issue[] };

const BY_TYPE: Readonly<Record<string, ValidateFunction>> = {
  hello: validators.hello,
  snapshot: validators.snapshot,
  delta: validators.delta,
  cot: validators.cot,
  heartbeat: validators.heartbeat,
  notice: validators.notice,
};

export function parseMessage(raw: string): Validated {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, issues: [{ path: "", message: `not JSON: ${(error as Error).message}` }] };
  }
  return validateMessage(data);
}

export function validateMessage(data: unknown): Validated {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, issues: [{ path: "", message: "a message must be a JSON object" }] };
  }
  const record = data as Record<string, unknown>;
  const header = {
    type: typeof record.type === "string" ? record.type : undefined,
    seq: typeof record.seq === "number" ? record.seq : undefined,
    runId: typeof record.run_id === "string" ? record.run_id : undefined,
  };
  if (record.schema !== "picture.v0") {
    return { ok: false, ...header, issues: [{ path: "/schema", message: `unsupported schema ${JSON.stringify(record.schema)}; expected "picture.v0"` }] };
  }
  const validate = header.type ? BY_TYPE[header.type] : undefined;
  if (!validate) {
    return { ok: false, ...header, issues: [{ path: "/type", message: `unknown message type ${JSON.stringify(record.type)}` }] };
  }
  if (!validate(data)) {
    const issues = (validate.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      message: describe(error.keyword, error.message, error.params),
    }));
    return { ok: false, ...header, issues: dedupe(issues) };
  }
  const message = data as PictureMessage;
  const semantic = semanticIssues(message);
  if (semantic.length > 0) return { ok: false, ...header, issues: semantic };
  return { ok: true, message };
}

export type ValidatedTruth = { ok: true; frame: TruthFrame } | { ok: false; issues: Issue[] };

/** A truth.v0 frame: a separate contract from the picture's (VIDENS_SPEC.md 8.7). */
export function validateTruth(data: unknown): ValidatedTruth {
  if (!validators.truth(data)) {
    const issues = (validators.truth.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      message: describe(error.keyword, error.message, error.params),
    }));
    return { ok: false, issues: dedupe(issues) };
  }
  return { ok: true, frame: data as TruthFrame };
}

export function parseTruth(raw: string): ValidatedTruth {
  try {
    return validateTruth(JSON.parse(raw));
  } catch (error) {
    return { ok: false, issues: [{ path: "", message: `not JSON: ${(error as Error).message}` }] };
  }
}

function describe(keyword: string, message: string | undefined, params: Record<string, unknown>): string {
  if (keyword === "additionalProperties") return `unexpected property "${String(params.additionalProperty)}"`;
  if (keyword === "enum") return `${message ?? "not an allowed value"}: ${JSON.stringify(params.allowedValues)}`;
  return message ?? keyword;
}

/** if/then/else and oneOf report the same fault several ways; keep one line per fault. */
function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
