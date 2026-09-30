// Rule 14: no third-party requests except the tile server of the basemap in use.

import { expect, test, type Page } from "@playwright/test";

import { VIEWERS, waitForLive, watchForErrors } from "./helpers.ts";

function recordOrigins(page: Page): Set<string> {
  const origins = new Set<string>();
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.protocol === "http:" || url.protocol === "https:") origins.add(url.origin);
  });
  return origins;
}

test("with basemap none, nothing leaves the viewer's own origin", async ({ page }) => {
  const origins = recordOrigins(page);
  const errors = watchForErrors(page);
  await page.goto(VIEWERS.none);
  await waitForLive(page);
  await page.waitForTimeout(5000);
  expect([...origins]).toEqual([new URL(VIEWERS.none).origin]);
  expect(errors).toEqual([]);
});

test("with the street basemap, only its tile server is contacted, and another only once chosen", async ({ page }) => {
  const origins = recordOrigins(page);
  await page.goto(VIEWERS.street);
  await waitForLive(page);
  await page.waitForTimeout(5000);
  const own = new URL(VIEWERS.street).origin;
  expect([...origins].sort()).toEqual([own, "https://tile.openstreetmap.org"].sort());
  await expect(page.locator(".status")).toContainText("Online basemap: tile.openstreetmap.org");

  await page.getByRole("button", { name: /Street/ }).click();
  await page.getByRole("menuitemradio", { name: /Terrain/ }).click();
  await expect.poll(() => origins.has("https://tile.opentopomap.org"), { timeout: 15_000 }).toBe(true);
  expect(origins.has("https://server.arcgisonline.com")).toBe(false);
});
