// Browser tests against running viewers (VIDENS_SPEC.md 10). Run in containers:
//   docker compose --profile e2e up --build --abort-on-container-exit --exit-code-from e2e

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 3,
  reporter: [["list"]],
  use: {
    headless: true,
    viewport: { width: 1400, height: 900 },
    // WebGL in a headless container: software rendering.
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    trace: "retain-on-failure",
  },
});
