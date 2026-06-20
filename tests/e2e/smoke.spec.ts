import { expect, test } from "@playwright/test";

/**
 * Phase 4 smoke suite — proves the whole chain works end to end:
 * browser → Vite web app → Express api → PostgreSQL.
 */

test("api health reports ok with the database up", async ({ request }) => {
  const res = await request.get("http://localhost:4000/healthz");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.service).toBe("heyrah-api");
  expect(body.database).toBe("up");
});

test("web renders HEYRAH and reaches the api", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "HEYRAH" })).toBeVisible();
  await expect(page.getByTestId("api-status")).toContainText("up", { timeout: 10_000 });
});
