// The live picture, the inspector and the CoT tab, in a real browser.

import { expect, test } from "@playwright/test";

import { clickEntity, renderedCount, VIEWERS, waitForEntities, waitForLive, watchForErrors } from "./helpers.ts";

test("shows the scenario live, with symbols on the map", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto(VIEWERS.none);
  await waitForLive(page);
  await waitForEntities(page, 3);
  await expect.poll(() => renderedCount(page, ["points"])).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test("the CoT tab shows exactly the bytes in the CoT record", async ({ page }) => {
  await page.goto(VIEWERS.none);
  await waitForLive(page);
  await waitForEntities(page, 4);
  await clickEntity(page, "E4");
  await expect(page.locator(".inspector__title")).toHaveText("E4");
  await page.getByRole("tab", { name: "CoT" }).click();
  // Records are rebuilt every few seconds; compare what is on screen with what is held.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const v = (window as any).__videns;
        const held = v.shown.value.cot.get("entity:E4")?.events.map((e: { xml: string }) => e.xml) ?? [];
        const onScreen = [...document.querySelectorAll("pre.xml")].map((p) => p.textContent);
        return held.length > 0 && JSON.stringify(held) === JSON.stringify(onScreen);
      }),
    )
    .toBe(true);
  await expect(page.locator(".cot__disposition")).toContainText("Published");
});

test("the inspector shows affiliation with its basis, and an unreported uncertainty as such", async ({ page }) => {
  await page.goto(VIEWERS.none);
  await waitForLive(page);
  await expect.poll(() => page.evaluate(() => (window as any).__videns.shown.value.entities.has("E3")), { timeout: 60_000 }).toBe(true);
  await clickEntity(page, "E3");
  await expect(page.locator(".inspector")).toContainText("Nobody has said (default)");
  await expect(page.locator(".inspector")).toContainText("No region is drawn");
});

test("selecting a row in the entity list selects it on the map", async ({ page }) => {
  await page.goto(VIEWERS.none);
  await waitForLive(page);
  await waitForEntities(page, 3);
  await page.getByRole("tab", { name: /Entities/ }).click();
  await page.locator(".table--entities tbody tr", { hasText: "E4" }).first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__videns.selection.value)).toEqual({ kind: "entity", id: "E4" });
});

test("scrubbing back pauses on the past, and Live returns", async ({ page }) => {
  await page.goto(VIEWERS.none);
  await waitForLive(page);
  await page.waitForTimeout(6000);
  const slider = page.locator(".timeline__slider");
  const min = Number(await slider.getAttribute("min"));
  await slider.fill(String(min + 2000));
  await expect(page.locator(".status")).toContainText("Paused");
  await expect(page.locator(".banner")).toContainText("The live feed continues");
  await page.getByRole("button", { name: /Live/ }).click();
  await expect(page.locator(".status")).not.toContainText("Paused");
});
