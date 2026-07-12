import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Phase 9 e2e: the full purchase journey in a real browser against the real
 * stack (Vite → Express with PAYMENT_MODE=demo → PostgreSQL dev DB).
 *
 * Sessions are reused per describe block to stay under the auth rate limit.
 * Stock-sensitive scenarios set and restore stock through Prisma in finally.
 */
test.describe.configure({ mode: "serial" });

const password = "OrderWings!2026x";
const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@heyrah.test`;

const prisma = new PrismaClient({
  datasourceUrl: process.env.E2E_DATABASE_URL ?? "postgresql://postgres@localhost:5432/heyrah_dev",
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ---------- helpers ----------

const bagCount = (page: Page) => page.getByTestId("bag-count");

async function addToBag(page: Page, slug: string): Promise<void> {
  await page.goto(`/product/${slug}`);
  const add = page.getByRole("button", { name: "Add to bag" });
  await expect(add).toBeEnabled({ timeout: 10_000 });
  const before = Number(await bagCount(page).innerText());
  await add.click();
  await expect(bagCount(page)).toHaveText(String(before + 1), { timeout: 10_000 });
}

async function addAddress(page: Page, city = "Kochi"): Promise<void> {
  await page.goto("/account/addresses");
  await page.getByRole("button", { name: "Add an address" }).click();
  const f = (label: string) => page.getByRole("textbox", { name: new RegExp(`^${label}`) });
  await f("Full name").fill("Amira Rahman");
  await f("Phone").fill("+91 98765 43210");
  await f("Address line 1").fill("12 Marine Drive");
  await f("City").fill(city);
  await f("State").fill("Kerala");
  await f("Postal code").fill("682001");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByTestId("address-card").filter({ hasText: city })).toBeVisible({ timeout: 10_000 });
}

async function register(page: Page, email: string, name: string): Promise<void> {
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Full name" }).fill(name);
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("banner").getByRole("link", { name })).toBeVisible({ timeout: 10_000 });
}

async function sharedPage(browser: Browser, opts: { reducedMotion?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({
    baseURL: "http://localhost:5173",
    reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
  });
  return context.newPage();
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("target never received keyboard focus");
}

// =============================================================
// The complete journey
// =============================================================

test.describe("guest → paid order", () => {
  let page: Page;
  const name = "Journey Tester";
  const email = uniqueEmail("journey");

  test.beforeAll(async ({ browser }) => {
    page = await sharedPage(browser);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("browse, bag, checkout wall, register, return to checkout", async () => {
    // Guest browses and adds to the bag
    await page.goto("/products");
    await expect(page.getByTestId("product-grid").locator(".product-card").first()).toBeVisible({ timeout: 10_000 });
    await addToBag(page, "silk-slip-dress");
    await addToBag(page, "linen-wrap-dress");

    // Bag → Checkout (guest is asked to sign in)
    await page.getByTestId("header-bag").click();
    await expect(page).toHaveURL(/\/cart$/);
    const checkout = page.getByTestId("checkout-link");
    await expect(checkout).toHaveText("Sign in to check out");
    await checkout.click();
    await expect(page).toHaveURL(/\/login$/);

    // Choose to create an account — the destination carries over
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/register$/);
    await page.getByRole("textbox", { name: "Full name" }).fill(name);
    await page.getByRole("textbox", { name: "Email address" }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    // Back at checkout with the merged bag; no address yet
    await expect(page).toHaveURL(/\/checkout$/, { timeout: 10_000 });
    await expect(page.getByTestId("merge-notice")).toContainText("Silk Slip Dress");
    await expect(page.getByTestId("checkout-line")).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId("no-address")).toBeVisible();
    await expect(page.getByTestId("place-order")).toHaveAttribute("aria-disabled", "true");
  });

  test("add an address, select it, review server totals, place the order", async () => {
    await addAddress(page, "Kochi");
    await addAddress(page, "Thrissur");
    await page.goto("/checkout");
    await expect(page.getByTestId("checkout-line")).toHaveCount(2, { timeout: 10_000 });

    // first address is the default and preselected; choose the second
    const kochi = page.getByRole("radio", { name: /Kochi/ });
    await expect(kochi).toBeChecked();
    await page.getByRole("radio", { name: /Thrissur/ }).check();
    await expect(page.getByRole("radio", { name: /Thrissur/ })).toBeChecked();

    // 5400→4590 + 250 = 4840, free shipping (≥ 2999)
    await expect(page.getByTestId("co-subtotal")).toHaveText("₹5,650.00");
    await expect(page.getByTestId("co-discount")).toContainText("₹810.00");
    await expect(page.getByTestId("co-shipping")).toHaveText("Free");
    await expect(page.getByTestId("co-total")).toHaveText("₹4,840.00");

    await page.getByTestId("place-order").click();
    await expect(page).toHaveURL(/\/payment\/demo\/\d+$/, { timeout: 10_000 });
    await expect(bagCount(page)).toHaveText("0", { timeout: 10_000 });
  });

  test("demo payment: opening sequence, method choice, processing, success", async () => {
    await expect(page.getByTestId("demo-banner")).toContainText("DEMO / TEST MODE");
    await expect(page.getByTestId("pay-total")).toHaveText("₹4,840.00");
    const open = page.getByTestId("open-demo-payment");
    await expect(open).toHaveText("Pay ₹4,840.00 (Demo)");

    await open.click();
    // opening steps are announced in order
    const status = page.getByTestId("sheet-status");
    await expect(status).toHaveText("Securing your payment…");
    await expect(open).toContainText("Opening");
    await expect(status).toHaveText("Connecting securely…");
    const sheet = page.getByTestId("demo-sheet");
    await expect(sheet.getByRole("group", { name: "Choose a demo method" })).toBeVisible();
    await expect(sheet.getByTestId("sheet-demo-badge")).toHaveText("DEMO / TEST MODE");
    // no credential-shaped inputs anywhere
    await expect(sheet.locator("input:not([type=radio])")).toHaveCount(0);

    await sheet.getByRole("radio", { name: /Demo QR/ }).check();
    await sheet.getByTestId("demo-pay").click();
    await expect(status).toHaveText("Securing your payment…");
    await expect(status).toHaveText("Processing…");
    await expect(status).toHaveText("Payment confirmed");

    const success = page.getByTestId("payment-success");
    await expect(success).toBeVisible({ timeout: 10_000 });
    await expect(success.getByRole("heading", { name: "Payment successful" })).toBeFocused();
    await expect(page.getByTestId("paid-status")).toContainText("Paid");
    await expect(page.getByTestId("paid-order-number")).toHaveText(/^HEY-\d{6}-\d{4}$/);
  });

  test("view order → order history", async () => {
    const number = await page.getByTestId("paid-order-number").innerText();
    await page.getByRole("link", { name: "View order" }).click();
    await expect(page.getByTestId("order-number")).toHaveText(number, { timeout: 10_000 });
    await expect(page.getByText("Paid", { exact: true })).toBeVisible();
    await expect(page.getByTestId("order-item")).toHaveCount(2);
    await expect(page.getByTestId("order-address")).toContainText("Thrissur");
    await expect(page.getByTestId("order-total")).toHaveText("₹4,840.00");
    await expect(page.getByTestId("order-pay-cta")).toHaveCount(0);

    await page.getByRole("link", { name: "All orders" }).click();
    const row = page.getByTestId("order-row").filter({ hasText: number });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Paid");
    await expect(row).toContainText("₹4,840.00");

    // refresh shows the same server state; the bag stays empty
    await page.reload();
    await expect(page.getByTestId("order-row").filter({ hasText: number })).toBeVisible({ timeout: 10_000 });
    await expect(bagCount(page)).toHaveText("0");
  });
});

// =============================================================
// Failure, retry, stock, authorization
// =============================================================

test.describe("payment failure, retry, and edge cases", () => {
  let page: Page;
  const email = uniqueEmail("edge");
  const name = "Edge Tester";

  test.beforeAll(async ({ browser }) => {
    page = await sharedPage(browser, { reducedMotion: true });
    await register(page, email, name);
    await addAddress(page);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("simulated failure keeps the order; retry succeeds; nothing duplicated", async () => {
    const scarf = await prisma.product.findUniqueOrThrow({ where: { slug: "cashmere-scarf" } });
    await addToBag(page, "cashmere-scarf");
    await page.goto("/checkout");
    await page.getByTestId("place-order").click();
    await expect(page).toHaveURL(/\/payment\/demo\/(\d+)$/, { timeout: 10_000 });
    const orderId = page.url().split("/").pop()!;

    await page.getByTestId("open-demo-payment").click();
    const sheet = page.getByTestId("demo-sheet");
    await sheet.getByTestId("demo-fail").click();
    const failed = sheet.getByTestId("payment-failed");
    await expect(failed).toBeVisible({ timeout: 10_000 });
    await expect(failed.getByRole("heading", { name: "Payment unsuccessful" })).toBeVisible();

    const mid = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(orderId) } });
    expect(mid.paymentStatus).toBe("PENDING_PAYMENT");
    expect(mid.status).toBe("pending");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: scarf.id } })).stockQuantity).toBe(
      scarf.stockQuantity - 1,
    );

    await failed.getByTestId("demo-retry").click();
    await sheet.getByTestId("demo-pay").click();
    await expect(page.getByTestId("payment-success")).toBeVisible({ timeout: 10_000 });

    const done = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(orderId) } });
    expect(done.paymentStatus).toBe("PAID");
    expect(await prisma.order.count({ where: { userId: done.userId } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: scarf.id } })).stockQuantity).toBe(
      scarf.stockQuantity - 1,
    );
  });

  test("closing the sheet leaves the order payable from order detail", async () => {
    await addToBag(page, "linen-wrap-dress");
    await page.goto("/checkout");
    await page.getByTestId("place-order").click();
    await expect(page).toHaveURL(/\/payment\/demo\/\d+$/, { timeout: 10_000 });
    await page.getByTestId("open-demo-payment").click();
    await expect(page.getByTestId("demo-pay")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("demo-sheet")).not.toBeVisible();
    await expect(page.getByTestId("open-demo-payment")).toBeFocused();

    await page.goto("/orders");
    await page.getByTestId("order-row").first().getByRole("link").click();
    await expect(page.getByText("Awaiting payment")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("order-pay-cta").getByRole("link").click();
    await expect(page.getByTestId("open-demo-payment")).toBeVisible({ timeout: 10_000 });
  });

  test("stock shortage at placement: clean message, no order, bag kept", async () => {
    const belt = await prisma.product.findUniqueOrThrow({ where: { slug: "woven-leather-belt" } });
    const ordersBefore = await prisma.order.count({ where: { user: { email } } });
    await addToBag(page, "woven-leather-belt");
    await page.goto("/checkout");
    await expect(page.getByTestId("place-order")).toHaveAttribute("aria-disabled", "false", { timeout: 10_000 });

    // someone else buys the last one between review and placement
    await prisma.product.update({ where: { id: belt.id }, data: { stockQuantity: 0 } });
    try {
      await page.getByTestId("place-order").click();
      const alert = page.getByTestId("checkout-error");
      await expect(alert).toContainText("Woven Leather Belt", { timeout: 10_000 });
      await expect(alert).toBeFocused();
      await expect(page.getByTestId("line-problem")).toContainText("Sold out");
      await expect(page.getByTestId("place-order")).toHaveAttribute("aria-disabled", "true");
      expect(await prisma.order.count({ where: { user: { email } } })).toBe(ordersBefore);
    } finally {
      await prisma.product.update({ where: { id: belt.id }, data: { stockQuantity: belt.stockQuantity } });
    }
    await page.goto("/cart");
    await expect(page.getByTestId("bag-line")).toHaveCount(1, { timeout: 10_000 });
  });

  test("another customer's order is not reachable", async ({ browser }) => {
    const mine = await prisma.order.findFirstOrThrow({ where: { user: { email } }, orderBy: { id: "desc" } });
    const other = await sharedPage(browser);
    try {
      await register(other, uniqueEmail("intruder"), "Intruder Tester");
      await other.goto(`/orders/${mine.id}`);
      await expect(other.getByTestId("order-missing")).toBeVisible({ timeout: 10_000 });
      await expect(other.getByText(mine.orderNumber)).toHaveCount(0);
      await other.goto(`/payment/demo/${mine.id}`);
      await expect(other.getByRole("heading", { name: "Order not found" })).toBeVisible({ timeout: 10_000 });
      const csrf = (await other.context().cookies()).find((c) => c.name === "heyrah_csrf")!.value;
      const res = await other.request.post(`http://localhost:4000/api/v1/orders/${mine.id}/demo-payment/confirm`, {
        headers: { "X-CSRF-Token": csrf },
        data: {},
      });
      expect(res.status()).toBe(404);
    } finally {
      await other.context().close();
    }
  });
});

// =============================================================
// Mobile + keyboard
// =============================================================

test.describe("mobile and keyboard checkout", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await sharedPage(browser);
    await register(page, uniqueEmail("kbd"), "Keys Tester");
    await addAddress(page);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("375px: checkout, payment sheet, and orders fit without overflow", async () => {
    await page.setViewportSize({ width: 375, height: 760 });
    await addToBag(page, "quilted-sherpa-jacket");
    await page.goto("/checkout");
    await expect(page.getByTestId("checkout-line")).toHaveCount(1, { timeout: 10_000 });
    await noHorizontalOverflow(page);
    const place = page.getByTestId("place-order");
    expect((await place.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await place.click();
    await expect(page).toHaveURL(/\/payment\/demo\/\d+$/, { timeout: 10_000 });
    await noHorizontalOverflow(page);
    await page.getByTestId("open-demo-payment").click();
    const pay = page.getByTestId("demo-pay");
    await expect(pay).toBeVisible({ timeout: 10_000 });
    const box = (await page.getByTestId("demo-sheet").boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(375);
    expect(box.x).toBeGreaterThanOrEqual(0);
    await pay.click();
    await expect(page.getByTestId("payment-success")).toBeVisible({ timeout: 10_000 });
    await noHorizontalOverflow(page);

    await page.goto("/orders");
    await expect(page.getByTestId("order-row")).toHaveCount(1, { timeout: 10_000 });
    await noHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("keyboard only: bag → checkout → place → pay → view order", async () => {
    await addToBag(page, "cotton-hair-tie");
    await page.goto("/cart");
    const checkout = page.getByTestId("checkout-link");
    await expect(checkout).toBeVisible({ timeout: 10_000 });
    await tabTo(page, checkout);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/checkout$/);

    const place = page.getByTestId("place-order");
    await expect(place).toHaveAttribute("aria-disabled", "false", { timeout: 10_000 });
    await tabTo(page, place);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/payment\/demo\/\d+$/, { timeout: 10_000 });

    const open = page.getByTestId("open-demo-payment");
    await expect(open).toBeVisible({ timeout: 10_000 });
    await tabTo(page, open);
    await page.keyboard.press("Enter");
    // focus lands on the sheet's pay button once the method choice appears
    const pay = page.getByTestId("demo-pay");
    await expect(pay).toBeFocused({ timeout: 10_000 });
    // arrow keys move between demo methods inside the radio group
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /Demo UPI/ })).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(pay).toBeFocused();
    await page.keyboard.press("Enter");

    const heading = page.getByRole("heading", { name: "Payment successful" });
    await expect(heading).toBeFocused({ timeout: 10_000 });
    const view = page.getByRole("link", { name: "View order" });
    await tabTo(page, view);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("order-number")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  });
});
