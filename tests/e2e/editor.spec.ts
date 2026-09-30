// The scenario editor in a real browser (VIDENS_SPEC.md 16.6): build a scenario by
// clicking, save scenario.v2, export for the prototype, open a prototype scenario, drag
// and undo, declare a source. The saved scenario, the export and the drawn positions are
// written to test-results/ for the gates: tools/vectors/check_hub.py runs the scenario.v2
// file in vigilans-hub, tools/vectors/check_prototype.py the export in the prototype.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";

import { VIEWERS, watchForErrors } from "./helpers.ts";

const EDITOR = `${VIEWERS.none}/editor.html`;

async function canvasClick(page: Page, x: number, y: number) {
  await page.locator(".maplibregl-canvas").click({ position: { x, y } });
}

async function download(page: Page, button: string): Promise<string> {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button, exact: true }).click()]);
  return readFileSync((await file.path())!, "utf8");
}

async function setField(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press("Tab");
}

test("builds a scenario by clicking, saves scenario.v2, and exports for the prototype", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto(EDITOR);
  await expect(page.locator(".mode--on")).toHaveText("Scenario editor");
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "Sensor", exact: true }).click();
  for (const [x, y] of [[250, 200], [700, 220], [480, 560]] as const) await canvasClick(page, x, y);

  await page.getByLabel("Emitter type").selectOption("sig.vhf_net");
  await page.locator(".palette select").nth(1).selectOption("hostile");
  await page.getByRole("button", { name: "Emitter", exact: true }).click();
  // Record exactly where the map says each click landed: that is where it was drawn.
  await page.evaluate(() => {
    const w = window as any;
    w.__clicks = [];
    w.__videns.map.on("click", (e: any) => w.__clicks.push({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
  });
  await canvasClick(page, 430, 380);
  await page.getByRole("button", { name: "Path", exact: true }).click();
  await canvasClick(page, 600, 360);
  await canvasClick(page, 640, 470);
  await page.keyboard.press("Escape");
  await setField(page, "emitter-speed", "12");

  // A second emitter that waits, then moves, and is switched on only for a while.
  await page.getByRole("button", { name: "Emitter", exact: true }).click();
  await canvasClick(page, 300, 450);
  await page.getByRole("button", { name: "Path", exact: true }).click();
  await canvasClick(page, 350, 300);
  await canvasClick(page, 200, 300);
  await page.keyboard.press("Escape");
  await setField(page, "emitter-speed", "15");
  await setField(page, "hold-0", "40");
  await setField(page, "hold-1", "25");
  await page.getByTestId("add-window").click();
  await expect(page.locator(".editor-bar .pill")).not.toContainText("error");

  expect(await page.evaluate(() => (window as any).__videns.scenario.value.emitters.map((e: any) => e.path_m.length))).toEqual([3, 3]);

  const v2 = parse(await download(page, "Save"));
  expect(v2.schema).toBe("scenario.v2");
  expect(v2.sources).toEqual([expect.objectContaining({ id: "SIM", kind: "bearing" })]);
  expect(v2.sensors).toHaveLength(3);
  expect(v2.sensors.every((x: any) => x.source_id === "SIM")).toBe(true);
  expect(v2.emitters).toHaveLength(2);
  expect(v2.emitters[0]).toMatchObject({ id: "E1", speed_mps: 12, truth: { class_id: "sig.vhf_net", side: "hostile" } });
  expect(v2.emitters[1]).toMatchObject({ id: "E2", speed_mps: 15, active_windows_s: [[0, 60]] });
  expect(v2.emitters[1].path_m[0][2]).toBe(40);
  expect(v2.emitters[1].path_m[1][2]).toBe(25);
  for (const gone of ["legs", "active:", "freq_hz: ["]) expect(JSON.stringify(v2)).not.toContain(gone);

  const exported = await download(page, "Export for prototype");
  expect(exported).not.toContain("schema:");
  expect(exported).not.toContain("side:");
  await expect(page.locator(".notice")).toContainText("True sides");
  await expect(page.locator(".notice")).toContainText("E2: 2 waypoint holds");

  // For the gates: where the editor puts each emitter over time, and where it was drawn.
  const samples = await page.evaluate(() => {
    const v = (window as any).__videns;
    const at = (id: string, times: number[]) => times.map((t) => ({ t_s: t, ...v.previewAt(id, t) }));
    return { E1: at("E1", [0, 10, 30, 60, 90, 300]), E2: at("E2", [0, 20, 39, 40, 41, 60, 90, 120, 150, 300]) };
  });
  const drawn = (await page.evaluate(() => (window as any).__clicks)) as { lat: number; lon: number }[];
  const apart = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
  // Stored to the centimetre, so what is kept is within a centimetre of the click.
  expect(apart(samples.E1[0]!, drawn[0]!)).toBeLessThan(0.02);
  expect(apart(samples.E2[0]!, drawn[3]!)).toBeLessThan(0.02);
  // Holding at its first waypoint for 40 s.
  expect(apart(samples.E2[2]!, drawn[3]!)).toBeLessThan(0.02);
  expect(apart(samples.E2[4]!, drawn[3]!)).toBeGreaterThan(10);
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/editor-scenario.yaml", await download(page, "Save"));
  writeFileSync("test-results/editor-export.yaml", exported);
  writeFileSync("test-results/editor-expected.json", JSON.stringify({ emitters: { E1: { drawn: drawn.slice(0, 3), samples: samples.E1 } } }, null, 1));
  writeFileSync(
    "test-results/editor-hub-expected.json",
    JSON.stringify({ emitters: { E1: { samples: samples.E1 }, E2: { samples: samples.E2, windows: [[0, 60]] } } }, null, 1),
  );
  expect(errors).toEqual([]);
});

test("opens a prototype scenario; dragging moves a sensor and undo puts it back", async ({ page }) => {
  await page.goto(EDITOR);
  await page.locator('input[type="file"]').setInputFiles("fixtures/scenarios/static_net.yaml");
  await expect(page.locator(".notice")).toContainText("A prototype scenario");
  await expect(page.locator(".notice")).toContainText("expect:");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("tab", { name: "World" }).click();
  await expect(page.locator(".list-row", { hasText: "E4" })).toHaveCount(1);

  const before = await page.evaluate(() => (window as any).__videns.scenario.value.sensors[0].pos_m);
  const at = await page.evaluate(() => {
    const v = (window as any).__videns;
    const f = v.map.queryRenderedFeatures({ layers: ["sensors"] }).find((x: any) => x.properties.id === "S1");
    return v.map.project(f.geometry.coordinates);
  });
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + 60, box.y + at.y + 40, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => (window as any).__videns.scenario.value.sensors[0].pos_m);
  expect(after).not.toEqual(before);

  await page.keyboard.press("Control+z");
  expect(await page.evaluate(() => (window as any).__videns.scenario.value.sensors[0].pos_m)).toEqual(before);
});

test("declares a source to the engine; an assumed uncertainty needs a reason; a position system's receiver has no bearing error", async ({ page }) => {
  await page.goto(EDITOR);
  await page.locator('input[type="file"]').setInputFiles("fixtures/scenarios/static_net.yaml");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("tab", { name: "World" }).click();
  await page.locator(".list-row").filter({ has: page.locator("strong", { hasText: /^SIM$/ }) }).click();
  await page.getByTestId("source-affiliation").selectOption("friend");
  await setField(page, "source-assumed-bearing", "3");
  await expect(page.locator(".editor-bar .pill")).toContainText("error");
  await page.getByTestId("source-assumption-note").fill("Synthetic: characterised against known emitters.");
  await page.getByTestId("source-assumption-note").press("Tab");
  await expect(page.locator(".editor-bar .pill")).not.toContainText("error");

  await page.getByRole("tab", { name: "World" }).click();
  await page.getByRole("button", { name: "Add position system" }).click();
  await page.getByRole("tab", { name: "World" }).click();
  await page.locator(".list-row").filter({ has: page.locator("strong", { hasText: /^S1$/ }) }).click();
  await expect(page.getByTestId("sensor-bearing-sigma")).toHaveCount(1);
  await page.getByTestId("sensor-source").selectOption("POS1");
  await expect(page.getByTestId("sensor-bearing-sigma")).toHaveCount(0);

  const v2 = parse(await download(page, "Save"));
  expect(v2.operator.declarations).toEqual([
    { source_id: "SIM", affiliation: "friend", assumed_bearing_sigma_deg: 3, assumption_note: "Synthetic: characterised against known emitters." },
  ]);
  expect(v2.sensors.find((x: any) => x.id === "S1")).toMatchObject({ source_id: "POS1" });
  expect(v2.sensors.find((x: any) => x.id === "S1").bearing_sigma_deg).toBeUndefined();
  await download(page, "Export for prototype");
  await expect(page.locator(".notice")).toContainText("Operator declarations (1)");
  await expect(page.locator(".notice")).toContainText("Position-source receivers (S1)");
});
