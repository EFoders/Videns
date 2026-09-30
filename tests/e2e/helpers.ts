import { expect, type Page } from "@playwright/test";

/** The viewers compose starts for these tests, one per situation. */
export const VIEWERS = {
  street: process.env.E2E_STREET ?? "http://e2e-street:8080",
  none: process.env.E2E_NONE ?? "http://e2e-none:8080",
  faulty: process.env.E2E_FAULTY ?? "http://e2e-faulty:8080",
  stall: process.env.E2E_STALL ?? "http://e2e-stall:8080",
  hang: process.env.E2E_HANG ?? "http://e2e-hang:8080",
  nofeed: process.env.E2E_NOFEED ?? "http://e2e-nofeed:8080",
};

export const FIXTURE_PICTURE = "fixtures/demo.picture.jsonl";
export const FIXTURE_TRUTH = "fixtures/demo.truth.jsonl";
export const EPOCH = Date.parse("2026-01-01T00:00:00.000Z");

/** Fail the test on any uncaught page error or Content-Security-Policy violation. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(`csp: ${m.text()}`);
  });
  return errors;
}

export function feedPill(page: Page) {
  return page.locator(".status .pill").first();
}

export async function waitForLive(page: Page): Promise<void> {
  await expect(feedPill(page)).toHaveText("Live", { timeout: 30_000 });
}

/** Wait until the picture on screen has at least `n` entities. */
export async function waitForEntities(page: Page, n: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as any).__videns.shown.value.entities.size), { timeout: 30_000 }).toBeGreaterThanOrEqual(n);
}

export async function renderedCount(page: Page, layers: string[]): Promise<number> {
  return page.evaluate((l) => (window as any).__videns.map.queryRenderedFeatures({ layers: l }).length, layers);
}

/** Centre the map on an entity, zoomed in far enough to separate neighbours, and click it. */
export async function clickEntity(page: Page, id: string): Promise<void> {
  await page.evaluate((entityId) => {
    const v = (window as any).__videns;
    const e = v.shown.value.entities.get(entityId) ?? v.shown.value.departed.get(entityId)?.entity;
    v.map.jumpTo({ center: [e.position.lon, e.position.lat], zoom: 16 });
  }, id);
  await page.waitForTimeout(400);
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Click a departure's note, which sits just above where the entity was. */
export async function clickGhost(page: Page, id: string): Promise<void> {
  const point = await page.evaluate((entityId) => {
    const v = (window as any).__videns;
    const p = v.shown.value.departed.get(entityId).entity.position;
    v.map.jumpTo({ center: [p.lon, p.lat], zoom: 12.5 });
    const xy = v.map.project([p.lon, p.lat]);
    return { x: xy.x, y: xy.y };
  }, id);
  await page.waitForTimeout(400);
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  // The note is 20 px tall, anchored 22 px above the position.
  await page.mouse.click(box.x + point.x, box.y + point.y - 32);
}

/** Move the timeline to a picture time, seconds after the demo scenario's epoch. */
export async function seekTo(page: Page, seconds: number): Promise<void> {
  await page.locator(".timeline__slider").fill(String(EPOCH + seconds * 1000));
  await page.waitForTimeout(300);
}
