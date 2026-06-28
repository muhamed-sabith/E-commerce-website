import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Phase 7 e2e: the bag in a real browser against the real stack
 * (browser, Vite, Express, PostgreSQL seeded dev DB).
 *
 * Seed facts relied on: Linen Wrap Dress (250.00, stock 10), Cashmere Scarf
 * (1000.00, stock 40), Midnight Evening Gown (stock 3), Braided Jute Tote
 * (stock 35). The "dropped" scenario flips one product inactive through
 * Prisma and restores it in `finally`; the file runs serially so nothing
 * else observes it.
 */
test.describe.configure({ mode: "serial" });

const password = "BagWings!2026x";
const uniqueEmail = () => `bag-${Date.now()}-${Math.floor(Math.random() * 1e6)}@heyrah.test`;

const prisma = new PrismaClient({
  datasourceUrl:
    process.env.E2E_DATABASE_URL ?? "postgresql://postgres@localhost:5432/heyrah_dev",
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ---------- helpers ----------

const bagCount = (page: Page) => page.getByTestId("bag-count");
const bagHeading = (page: Page) => page.getByRole("heading", { name: "Your bag", exact: true });

async function addFromProductPage(page: Page, slug: string, times = 1): Promise<void> {
  await page.goto(`/product/${slug}`);
  const add = page.getByRole("button", { name: "Add to bag" });
  await expect(add).toBeEnabled({ timeout: 10_000 });
  for (let i = 0; i < times; i++) {
    const before = Number(await bagCount(page).innerText());
    await add.click();
    await expect(bagCount(page)).toHaveText(String(before + 1), { timeout: 10_000 });
  }
}

async function register(page: Page, email: string, name = "Bag Tester"): Promise<void> {
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Full name" }).fill(name);
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible({ timeout: 10_000 });
}

async function signIn(page: Page, email: string, name = "Bag Tester"): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible({ timeout: 10_000 });
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(bagCount(page)).toHaveText("0", { timeout: 10_000 });
}

const lineFor = (page: Page, name: string) =>
  page.getByTestId("bag-line").filter({ has: page.getByRole("link", { name }) });

/** Press Tab until `target` holds focus (keyboard-only navigation). */
async function tabTo(page: Page, target: Locator, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("target never received keyboard focus");
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// ---------- guest bag ----------

test("guest adds, opens, changes quantity, removes; bag survives reload", async ({ page }) => {
  // 1 + 2: guest adds a product; the header count comes from the server
  await page.goto("/products");
  await expect(bagCount(page)).toHaveText("0", { timeout: 10_000 });
  await addFromProductPage(page, "linen-wrap-dress");
  await expect(page.getByTestId("add-confirmation")).toContainText("Added to your bag.");
  await expect(page.getByTestId("cart-announcer")).toHaveText(
    "Linen Wrap Dress added to your bag. 1 item in bag.",
  );
  await addFromProductPage(page, "cashmere-scarf");
  await expect(bagCount(page)).toHaveText("2");

  // 3: open the bag from the header
  await page.getByTestId("header-bag").click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(bagHeading(page)).toBeVisible();
  await expect(page.getByTestId("bag-line")).toHaveCount(2);
  await expect(page.getByTestId("bag-total")).toHaveText("₹1,250.00");

  // 4: change quantity; totals are the server's answer
  await lineFor(page, "Linen Wrap Dress")
    .getByRole("button", { name: "Increase quantity of Linen Wrap Dress" })
    .click();
  await expect(lineFor(page, "Linen Wrap Dress").getByRole("textbox", { name: "Quantity", exact: true })).toHaveValue("2");
  await expect(lineFor(page, "Linen Wrap Dress").getByTestId("line-total")).toHaveText("₹500.00");
  await expect(page.getByTestId("bag-total")).toHaveText("₹1,500.00");
  await expect(bagCount(page)).toHaveText("3");

  // 6: reload; the server-side guest bag is still there
  await page.reload();
  await expect(page.getByTestId("bag-line")).toHaveCount(2, { timeout: 10_000 });
  await expect(bagCount(page)).toHaveText("3");

  // 5: remove an item
  await page.getByRole("button", { name: "Remove Cashmere Scarf from bag" }).click();
  await expect(page.getByTestId("bag-line")).toHaveCount(1);
  await expect(page.getByTestId("bag-total")).toHaveText("₹500.00");
  await expect(bagCount(page)).toHaveText("2");
});

// ---------- guest to user merge ----------

test("signing in merges the guest bag, summing duplicates; persists after reload", async ({
  page,
}) => {
  const email = uniqueEmail();
  // the account already holds one Cashmere Scarf
  await register(page, email);
  await addFromProductPage(page, "cashmere-scarf");
  await signOut(page);

  // 7: as a guest, add the same scarf plus a dress, then sign in
  await addFromProductPage(page, "cashmere-scarf");
  await addFromProductPage(page, "linen-wrap-dress");
  await expect(bagCount(page)).toHaveText("2");
  await signIn(page, email);

  // 8: the merge is reported in plain words
  const notice = page.getByTestId("merge-notice");
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice.getByRole("heading", { name: "We've saved your bag" })).toBeVisible();
  await expect(notice).toContainText("Cashmere Scarf");
  await expect(notice).toContainText("Linen Wrap Dress");
  await expect(notice).not.toContainText(/session|token/i);

  // 9: duplicate quantities summed server-side (1 account + 1 guest = 2)
  await expect(bagCount(page)).toHaveText("3", { timeout: 10_000 });
  await notice.getByRole("link", { name: "Review your bag" }).click();
  await expect(lineFor(page, "Cashmere Scarf").getByRole("textbox", { name: "Quantity", exact: true })).toHaveValue("2");
  await expect(lineFor(page, "Linen Wrap Dress").getByRole("textbox", { name: "Quantity", exact: true })).toHaveValue("1");

  // 12: the account bag survives a reload
  await page.reload();
  await expect(page.getByTestId("bag-line")).toHaveCount(2, { timeout: 10_000 });
  await expect(bagCount(page)).toHaveText("3");
  await expect(page.getByRole("link", { name: "Bag Tester" })).toBeVisible();
});

test("merged quantity is capped to stock and the cap is shown", async ({ page }) => {
  const email = uniqueEmail();
  const gown = await prisma.product.findUniqueOrThrow({
    where: { slug: "midnight-evening-gown" },
  });
  expect(gown.stockQuantity).toBe(3);

  await register(page, email);
  await addFromProductPage(page, "midnight-evening-gown");
  await signOut(page);

  // guest takes all 3, so the combined request of 4 exceeds stock
  await addFromProductPage(page, "midnight-evening-gown", 3);
  await signIn(page, email);

  // 10: the cap is explained
  const notice = page.getByTestId("merge-notice");
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice.getByTestId("merge-capped")).toHaveText(
    "Midnight Evening Gown: 3 of the 4 you wanted",
  );
  await expect(bagCount(page)).toHaveText("3", { timeout: 10_000 });
});

test("a product that became unavailable is reported as dropped", async ({ page }) => {
  const email = uniqueEmail();
  await addFromProductPage(page, "braided-jute-tote");
  await addFromProductPage(page, "linen-wrap-dress");

  const tote = await prisma.product.findUniqueOrThrow({ where: { slug: "braided-jute-tote" } });
  await prisma.product.update({ where: { id: tote.id }, data: { status: "inactive" } });
  try {
    await register(page, email);

    // 11: dropped item named, with a reason a shopper understands
    const notice = page.getByTestId("merge-notice");
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice.getByTestId("merge-dropped")).toHaveText(
      "Braided Jute Tote, no longer available",
    );
    await expect(bagCount(page)).toHaveText("1", { timeout: 10_000 });

    await page.goto("/cart");
    await expect(page.getByTestId("bag-line")).toHaveCount(1, { timeout: 10_000 });
    await expect(lineFor(page, "Linen Wrap Dress")).toBeVisible();
  } finally {
    await prisma.product.update({ where: { id: tote.id }, data: { status: tote.status } });
  }
});

// ---------- responsive + keyboard ----------

test("bag has no horizontal overflow at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await addFromProductPage(page, "silk-slip-dress");
  await addFromProductPage(page, "cashmere-scarf");

  await page.goto("/cart");
  await expect(page.getByTestId("bag-line")).toHaveCount(2, { timeout: 10_000 });
  await noHorizontalOverflow(page);

  // controls keep a 44px touch target
  const inc = page.getByRole("button", { name: "Increase quantity of Silk Slip Dress" });
  const box = await inc.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await page.goto("/products");
  await expect(page.getByTestId("product-grid").locator(".product-card").first()).toBeVisible({
    timeout: 10_000,
  });
  await noHorizontalOverflow(page);
});

test("keyboard-only: add, open bag, change quantity, remove", async ({ page }) => {
  await page.goto("/product/linen-wrap-dress");
  const add = page.getByRole("button", { name: "Add to bag" });
  await expect(add).toBeEnabled({ timeout: 10_000 });

  await tabTo(page, add);
  await page.keyboard.press("Enter");
  await expect(bagCount(page)).toHaveText("1", { timeout: 10_000 });

  // the confirmation offers a keyboard path to the bag
  const viewBag = page.getByRole("link", { name: "View bag" });
  await tabTo(page, viewBag);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cart$/);

  const inc = page.getByRole("button", { name: "Increase quantity of Linen Wrap Dress" });
  await expect(inc).toBeVisible({ timeout: 10_000 });
  await tabTo(page, inc);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Quantity", exact: true })).toHaveValue("2", { timeout: 10_000 });
  // focus stays on the stepper after the update
  await expect(inc).toBeFocused();

  // typed quantity commits on Enter
  const qty = page.getByRole("textbox", { name: "Quantity", exact: true });
  await page.keyboard.press("Shift+Tab");
  await expect(qty).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("4");
  await page.keyboard.press("Enter");
  await expect(qty).toHaveValue("4", { timeout: 10_000 });
  await expect(bagCount(page)).toHaveText("4");

  const remove = page.getByRole("button", { name: "Remove Linen Wrap Dress from bag" });
  await tabTo(page, remove);
  await page.keyboard.press("Space");
  await expect(page.getByTestId("empty-bag")).toBeVisible({ timeout: 10_000 });
  await expect(bagCount(page)).toHaveText("0");
  // focus lands on the page heading, not <body>
  await expect(bagHeading(page)).toBeFocused();
});
