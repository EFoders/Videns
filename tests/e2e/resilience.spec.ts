// A viewer with nothing to show says why, and a failing part never takes the picture down.

import { expect, test } from "@playwright/test";

import { feedPill, renderedCount, VIEWERS, waitForEntities, waitForLive } from "./helpers.ts";

test("a tile server that never answers does not stop the picture, and is reported", async ({ page }) => {
  await page.goto(VIEWERS.hang);
  await waitForEntities(page, 3);
  await expect.poll(() => renderedCount(page, ["points"])).toBeGreaterThan(3);
  await expect(page.locator(".status .pill--bad")).toHaveText("Basemap failing", { timeout: 20_000 });
});

test("malformed messages are rejected with a reason, gaps resync, and the feed comes back live", async ({ page }) => {
  await page.goto(VIEWERS.faulty);
  await waitForLive(page);
  await expect.poll(() => page.evaluate(() => (window as any).__videns.counters.value.rejected), { timeout: 45_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__videns.counters.value.resyncs), { timeout: 45_000 }).toBeGreaterThan(0);
  await page.getByRole("tab", { name: /Diagnostics/ }).click();
  await expect(page.locator(".diagnostics")).toContainText("rejected by picture.v0");
  await expect(page.locator(".diagnostics")).toContainText("position_uncertainty");
  await waitForLive(page);
});

test("a stalled feed is shown as stalled, the picture marked stale, and it recovers", async ({ page }) => {
  await page.goto(VIEWERS.stall);
  await waitForLive(page);
  await expect(feedPill(page)).toHaveText("Stalled", { timeout: 30_000 });
  await expect(page.locator(".map--stale")).toHaveCount(1);
  await expect(page.locator(".banner")).toContainText("stalled");
  await waitForLive(page);
});

test("a feed that cannot be reached is shown as disconnected, never as an empty live map", async ({ page }) => {
  await page.goto(VIEWERS.nofeed);
  await expect(feedPill(page)).toHaveText(/Disconnected|Connecting/, { timeout: 20_000 });
  await expect(page.locator(".banner")).toContainText(/reconnecting|Not connected/);
  await expect(feedPill(page)).not.toHaveText("Live");
});
