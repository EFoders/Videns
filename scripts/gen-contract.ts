// Generate TypeScript types and standalone validators from the contract schemas:
// contract/picture.v0, truth.v0 and scenario.v2 (a copy of the Vigilans contract package's,
// kept in step by scripts/sync-contract.sh), plus the editor's legacy scenario.v1, read only
// to open old files.
//
// Standalone, because the page's Content-Security-Policy forbids eval, and Ajv's normal
// mode compiles validators with `new Function` at runtime (VIDENS_SPEC.md rule 14). The
// schemas are the single source of truth; nothing under src/contract/generated/ is edited
// by hand or committed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";
import { compile } from "json-schema-to-typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "contract", "generated");
const read = (name: string) => JSON.parse(readFileSync(join(root, "contract", name), "utf8"));

const picture = read("picture.v0.schema.json");
const truth = read("truth.v0.schema.json");
const scenario = read("scenario.v2.schema.json");
// Retitled so its generated names cannot be mistaken for the current format's.
const scenarioV1 = { ...read("scenario.v1.schema.json"), title: "ScenarioV1" };
const MESSAGE_TYPES = ["hello", "snapshot", "delta", "cot", "heartbeat", "notice"] as const;

const banner = `// GENERATED from contract/*.schema.json by scripts/gen-contract.ts. Do not edit.\n`;

mkdirSync(outDir, { recursive: true });

// --- Types -------------------------------------------------------------------------
const typeOptions = {
  bannerComment: banner,
  additionalProperties: false,
  unreachableDefinitions: true,
  strictIndexSignatures: true,
  // Bounds are the validator's job; as tuple unions they make the types unreadable.
  ignoreMinAndMaxItems: true,
  format: true,
};
writeFileSync(join(outDir, "picture.ts"), await compile(picture, "PictureMessage", typeOptions));
writeFileSync(join(outDir, "truth.ts"), await compile(truth, "TruthFrame", typeOptions));
writeFileSync(join(outDir, "scenario.ts"), await compile(scenario, "Scenario", typeOptions));
writeFileSync(join(outDir, "scenario-v1.ts"), await compile(scenarioV1, "ScenarioV1", typeOptions));

// --- Validators --------------------------------------------------------------------
const ajv = new Ajv({
  code: { source: true, esm: true },
  allErrors: true,
  strict: true,
  strictTypes: false,
  // if/then branches name properties declared by the enclosing schema, not their own.
  strictRequired: false,
  allowUnionTypes: true,
  // One shared function per definition instead of a copy at every $ref: a fraction of the size.
  inlineRefs: false,
});
addFormats(ajv);
ajv.addSchema(picture);
ajv.addSchema(truth);
ajv.addSchema(scenario);
ajv.addSchema(scenarioV1);

const exports: Record<string, string> = {};
for (const type of MESSAGE_TYPES) exports[type] = `${picture.$id}#/definitions/${type}`;
exports.truth = truth.$id;
exports.scenario = scenario.$id;
exports.scenarioV1 = scenarioV1.$id;

// Ajv's `esm` option changes how validators are exported but still pulls its runtime
// helpers in with require(), which does not exist in a browser -- and a default import of
// those CommonJS modules means different things in Node and in Vite. Each known helper is
// replaced by a local ES-module stand-in (src/contract/ajv-runtime.ts); an unknown one
// fails the build rather than shipping a validator that throws at runtime.
const RUNTIME: Readonly<Record<string, string>> = {
  "ajv/dist/runtime/ucs2length": "ucs2lengthModule",
  "ajv-formats/dist/formats": "formatsModule",
};
const used = new Set<string>();
const code = standaloneCode(ajv, exports).replace(/require\("([^"]+)"\)/g, (_match, spec: string) => {
  const name = RUNTIME[spec];
  if (!name) throw new Error(`standalone validators require "${spec}", which has no stand-in in src/contract/ajv-runtime.ts`);
  used.add(name);
  return name;
});
const imports = used.size ? `import { ${[...used].sort().join(", ")} } from "../ajv-runtime.ts";\n` : "";
writeFileSync(join(outDir, "validators.js"), `${banner}${imports}${code}\n`);

const declarations = [
  banner,
  `export interface ValidationError { instancePath: string; schemaPath: string; keyword: string; message?: string; params: Record<string, unknown>; }`,
  `export interface ValidateFunction { (data: unknown): boolean; errors?: ValidationError[] | null; }`,
  ...Object.keys(exports).map((name) => `export declare const ${name}: ValidateFunction;`),
  "",
].join("\n");
writeFileSync(join(outDir, "validators.d.ts"), declarations);

console.log(`contract: generated types and ${Object.keys(exports).length} validators in ${outDir}`);
