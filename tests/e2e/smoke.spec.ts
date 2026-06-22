import { expect, test } from "@playwright/test";

/**
 * Phase 5 e2e — the catalog chain in a real browser:
 * browser → Vite web app → Express api → PostgreSQL (seeded).
 */

test("api health reports ok with the database up", async ({ request }) => {
  const res = await request.get("http://localhost:4000/healthz");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.service).toBe("heyrah-api");
  expect(body.database).toBe("up");
});

test("catalog grid renders seeded products", async ({ page }) => {
  await page.goto("/products");
  await expect(page.getByTestId("product-grid").locator(".product-card").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("result-count")).toContainText("Showing");
});

test("numeric price sorting is ascending across the grid (§7.1)", async ({ page }) => {
  await page.goto("/products?sort=price_asc&page_size=48");
  const grid = page.getByTestId("product-grid");
  await expect(grid.locator(".product-card").first()).toBeVisible({ timeout: 10_000 });

  // Prices render as formatted INR strings — parse back to numbers and
  // assert monotonic non-decreasing order in the DOM (page size is a
  // fixed, documented 12 on the storefront).
  const prices = await grid.locator(".product-card__final").allInnerTexts();
  const numbers = prices.map((t) => Number(t.replace(/[^\d.]/g, "")));
  expect(numbers.length).toBe(12);
  for (let i = 1; i < numbers.length; i++) {
    expect(numbers[i]).toBeGreaterThanOrEqual(numbers[i - 1]);
  }
  // The acceptance quad opens the ascending grid: 25, 100, 250, …
  expect(numbers[0]).toBe(25);
  expect(numbers[1]).toBe(100);
});

test("search from the header finds the linen products", async ({ page }) => {
  await page.goto("/products");
  await page.getByRole("searchbox", { name: "Search products" }).fill("linen");
  await page.getByRole("button", { name: "Submit search" }).click();
  await expect(page).toHaveURL(/q=linen/);
  await expect(page.getByTestId("result-count")).toContainText("of 2", { timeout: 10_000 });
});

test("category filter narrows results via URL state", async ({ page }) => {
  await page.goto("/products?category=footwear");
  await expect(page.getByTestId("result-count")).toContainText("of 4", { timeout: 10_000 });
});

test("product detail renders with availability state", async ({ page }) => {
  await page.goto("/product/linen-kurta-indigo");
  await expect(page.getByRole("heading", { name: "Linen Kurta — Indigo" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("availability")).toHaveText("In stock");
  await expect(page.getByText("HEY-KUR-00003")).toBeVisible();
});

test("out-of-stock product disables the purchase path", async ({ page }) => {
  await page.goto("/product/trench-overcoat");
  await expect(page.getByTestId("availability")).toHaveText("Out of stock", { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Unavailable" })).toBeDisabled();
});

test("inactive product deep link shows the not-found state", async ({ page }) => {
  await page.goto("/product/archive-sample-tote");
  await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible({
    timeout: 10_000,
  });
});
