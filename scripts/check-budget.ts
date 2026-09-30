// Fail the build when the bundle outgrows its budget (VIDENS_SPEC.md section 5.1):
// 800 KB gzipped, excluding basemaps and source maps.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 800 * 1024;
const dist = join(import.meta.dirname, "..", "dist");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(dist).filter((f) => !f.endsWith(".map") && !f.includes(`${join("dist", "basemaps")}`) && !f.endsWith("videns.config.json"));
let total = 0;
for (const file of files) {
  const gz = gzipSync(readFileSync(file)).length;
  total += gz;
  console.log(`${(gz / 1024).toFixed(1).padStart(8)} KB  ${file.slice(dist.length + 1)}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(8)} KB  total gzipped (budget ${BUDGET_BYTES / 1024} KB)`);
if (total > BUDGET_BYTES) {
  console.error(`bundle is ${((total - BUDGET_BYTES) / 1024).toFixed(1)} KB over budget`);
  process.exit(1);
}
