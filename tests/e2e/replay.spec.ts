// Replay, groups, lifecycle and truth, through the UI, against the committed recording.

import { expect, test } from "@playwright/test";

import { clickEntity, clickGhost, FIXTURE_PICTURE, FIXTURE_TRUTH, renderedCount, seekTo, VIEWERS, watchForErrors } from "./helpers.ts";

test.beforeEach(async ({ page }) => {
  await page.goto(VIEWERS.none);
  await page.locator('input[type="file"]').setInputFiles([FIXTURE_PICTURE, FIXTURE_TRUTH]);
  await expect(page.locator(".status")).toContainText("Replay: demo.picture.jsonl");
});

test("a recording replays as a recording, never taken for live", async ({ page }) => {
  const errors = watchForErrors(page);
  await expect(page.locator(".banner")).toContainText("This is not live");
  await seekTo(page, 60);
  await expect.poll(() => page.evaluate(() => (window as any).__videns.shown.value.t)).toBe("2026-01-01T00:01:00.000Z");
  await page.getByRole("button", { name: /Live/ }).click();
  await expect(page.locator(".status")).not.toContainText("Replay:");
  expect(errors).toEqual([]);
});

test("a merge leaves one symbol and a clickable record of the other; the unmerge brings it back", async ({ page }) => {
  await seekTo(page, 180);
  const state = () =>
    page.evaluate(() => {
      const s = (window as any).__videns.shown.value;
      return { e8: s.entities.has("E8"), e9: s.entities.has("E9"), ghost: s.departed.get("E9")?.into ?? null };
    });
  expect(await state()).toEqual({ e8: true, e9: false, ghost: "E8" });
  await expect.poll(() => renderedCount(page, ["ghosts"])).toBeGreaterThan(0);
  await clickGhost(page, "E9");
  await expect(page.locator(".inspector")).toContainText("Merged into");
  await expect(page.locator(".inspector")).toContainText("E8");

  await seekTo(page, 240);
  expect(await state()).toEqual({ e8: true, e9: true, ghost: null });
});

test("a published group is drawn and explains itself; hypotheses stay hidden unless asked", async ({ page }) => {
  await seekTo(page, 120);
  await expect.poll(() => renderedCount(page, ["group-links", "group-links-weak"])).toBe(0);
  await page.getByLabel("Group hypotheses").check();
  await expect.poll(() => renderedCount(page, ["group-links-weak"])).toBeGreaterThan(0);

  await seekTo(page, 200);
  await expect.poll(() => renderedCount(page, ["group-links"])).toBeGreaterThan(0);
  await page.evaluate(() => ((window as any).__videns.selection.value = { kind: "group", id: "G1" }));
  await expect(page.locator(".inspector")).toContainText("controller/controlled");
  await expect(page.locator(".inspector")).toContainText("at most 0.70");
  await page.getByRole("tab", { name: "CoT" }).click();
  await expect(page.locator(".cot__disposition")).toContainText("no CoT representation has been decided");
});

test("simulation truth draws where the emitters really were and compares with the picture", async ({ page }) => {
  await seekTo(page, 100);
  await page.getByLabel("Simulation truth").check();
  await expect.poll(() => renderedCount(page, ["truth"])).toBeGreaterThan(0);
  await clickEntity(page, "E1");
  await expect(page.locator(".inspector")).toContainText("Simulation truth");
  await expect(page.locator(".inspector")).toContainText(/Inside|Outside/);
});

test("evidence: lines of bearing for the selection", async ({ page }) => {
  await seekTo(page, 60);
  await clickEntity(page, "E1");
  await expect.poll(() => renderedCount(page, ["bearings"])).toBeGreaterThan(0);
});
