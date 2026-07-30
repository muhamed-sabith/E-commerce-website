import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Phase 8 e2e: wishlist + address book in a real browser against the real
 * stack (browser, Vite, Express, PostgreSQL seeded dev DB).
 *
 * Each describe block shares one signed-in page so the suite stays well
 * under the auth rate limit. Seed facts relied on: Linen Wrap Dress
 * (250.00), Silk Slip Dress (5400 → 4590), Trench Overcoat (out of stock).
 */
test.describe.configure({ mode: "serial" });

const password = "WishWings!2026x";
const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@heyrah.test`;

const prisma = new PrismaClient({
  datasourceUrl: process.env.E2E_DATABASE_URL ?? "postgresql://postgres@localhost:5432/heyrah_dev",
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ---------- helpers ----------

async function register(page: Page, email: string, name: string): Promise<void> {
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Full name" }).fill(name);
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("banner").getByRole("link", { name })).toBeVisible({ timeout: 10_000 });
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

/** Wait until the toggle knows the wishlist state (not busy / not loading). */
async function readyToggle(page: Page): Promise<Locator> {
  const toggle = page.getByTestId("save-toggle").first();
  await expect(toggle).toHaveAttribute("aria-disabled", "false", { timeout: 10_000 });
  return toggle;
}

async function sharedPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:5173" });
  return context.newPage();
}

// =============================================================
// WISHLIST
// =============================================================

test.describe("wishlist", () => {
  let page: Page;
  const email = uniqueEmail("wish");
  const name = "Wish Tester";

  test.beforeAll(async ({ browser }) => {
    page = await sharedPage(browser);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("logged-out wishlist access leads to sign in; catalog stays browsable", async () => {
    // an account to sign into later
    await register(page, email, name);
    await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible({
      timeout: 10_000,
    });

    // 1: header entry point → login flow
    await page.getByTestId("header-wishlist").click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // browsing needs no account; saving asks to sign in
    await page.goto("/product/linen-wrap-dress");
    await expect(page.getByRole("heading", { name: "Linen Wrap Dress" })).toBeVisible({ timeout: 10_000 });
    const toggle = await readyToggle(page);
    await toggle.click();
    await expect(page).toHaveURL(/\/login$/);

    // 2: sign in → back where she was
    await page.getByRole("textbox", { name: "Email address" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/product\/linen-wrap-dress$/, { timeout: 10_000 });
    await expect(page.getByRole("banner").getByRole("link", { name })).toBeVisible();
  });

  test("save a product; saved state shows on detail and catalog card", async () => {
    // 3 + 5
    const toggle = await readyToggle(page);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAccessibleName("Save Linen Wrap Dress to wishlist");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await expect(toggle).toContainText("Saved");
    await expect(page.getByTestId("wishlist-announcer")).toHaveText(
      "Linen Wrap Dress saved to your wishlist.",
    );

    await page.goto("/products?q=linen+wrap");
    const card = page.locator(".product-card").filter({ hasText: "Linen Wrap Dress" });
    await expect(card.getByTestId("save-toggle")).toHaveAttribute("aria-pressed", "true", {
      timeout: 10_000,
    });

    // saved state survives a reload (server truth, not local storage)
    await page.reload();
    await expect(card.getByTestId("save-toggle")).toHaveAttribute("aria-pressed", "true", {
      timeout: 10_000,
    });
  });

  test("wishlist lists the product; duplicate save stays a single entry", async () => {
    // 8: a second save of the same product (straight to the API, same session)
    const csrf = (await page.context().cookies()).find((c) => c.name === "heyrah_csrf")!.value;
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: "linen-wrap-dress" } });
    const again = await page.request.post("http://localhost:4000/api/v1/wishlist/items", {
      headers: { "X-CSRF-Token": csrf },
      data: { product_id: product.id.toString() },
    });
    expect(again.status()).toBe(200);

    // 4
    await page.getByTestId("header-wishlist").click();
    await expect(page).toHaveURL(/\/wishlist$/);
    await expect(page.getByTestId("wish-card")).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByTestId("wish-card").getByRole("link", { name: "Linen Wrap Dress" })).toBeVisible();
  });

  test("wishlist shows current price and availability", async () => {
    // 9: live price — an admin-side change shows up on reload
    const dress = await prisma.product.findUniqueOrThrow({ where: { slug: "linen-wrap-dress" } });
    await prisma.product.update({
      where: { id: dress.id },
      data: { discountType: "fixed", discountValue: "50.00" },
    });
    try {
      await page.reload();
      const card = page.getByTestId("wish-card");
      await expect(card.getByTestId("wish-price")).toContainText("₹200.00", { timeout: 10_000 });
      await expect(card.getByTestId("wish-price")).toContainText("₹250.00");
      await expect(card.getByTestId("wish-availability")).toHaveText("In stock");
    } finally {
      await prisma.product.update({
        where: { id: dress.id },
        data: { discountType: dress.discountType, discountValue: dress.discountValue },
      });
    }

    // an out-of-stock piece is listed, labelled, and not purchasable
    await page.goto("/product/trench-overcoat");
    await (await readyToggle(page)).click();
    // the product's own toggle (the "More �" rail below has its own)
    await expect(page.locator(".pdp__actions").getByTestId("save-toggle")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await page.goto("/wishlist");
    const trench = page.getByTestId("wish-card").filter({ hasText: "Trench Overcoat" });
    await expect(trench.getByTestId("wish-availability")).toHaveText("Out of stock", { timeout: 10_000 });
    await expect(trench.getByRole("button", { name: "Out of stock" })).toBeDisabled();

    // a purchasable piece goes straight to the bag
    const linen = page.getByTestId("wish-card").filter({ hasText: "Linen Wrap Dress" });
    await linen.getByRole("button", { name: "Add Linen Wrap Dress to bag" }).click();
    await expect(page.getByTestId("bag-count")).toHaveText("1", { timeout: 10_000 });
  });

  test("mobile 375px: wishlist and catalog have no horizontal overflow", async () => {
    // 10
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto("/wishlist");
    await expect(page.getByTestId("wish-card")).toHaveCount(2, { timeout: 10_000 });
    await noHorizontalOverflow(page);
    const remove = page.getByRole("button", { name: "Remove Trench Overcoat from wishlist" });
    const box = await remove.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await page.goto("/products");
    await expect(page.getByTestId("product-grid").locator(".product-card").first()).toBeVisible({ timeout: 10_000 });
    await noHorizontalOverflow(page);
    const save = await readyToggle(page);
    const saveBox = await save.boundingBox();
    expect(saveBox?.width).toBeGreaterThanOrEqual(44);
    expect(saveBox?.height).toBeGreaterThanOrEqual(44);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("remove pieces until the wishlist is empty", async () => {
    // 6 + 7
    await page.goto("/wishlist");
    await expect(page.getByTestId("wish-card")).toHaveCount(2, { timeout: 10_000 });
    await page.getByRole("button", { name: "Remove Trench Overcoat from wishlist" }).click();
    await expect(page.getByTestId("wish-card")).toHaveCount(1);
    await expect(page.getByTestId("wishlist-announcer")).toHaveText(
      "Trench Overcoat removed from your wishlist.",
    );
    await page.getByRole("button", { name: "Remove Linen Wrap Dress from wishlist" }).click();
    await expect(page.getByTestId("empty-wishlist")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Wishlist" })).toBeFocused();

    await page.reload();
    await expect(page.getByTestId("empty-wishlist")).toBeVisible({ timeout: 10_000 });
  });
});

// =============================================================
// ADDRESSES
// =============================================================

test.describe("addresses", () => {
  let page: Page;
  const name = "Addr Tester";

  test.beforeAll(async ({ browser }) => {
    page = await sharedPage(browser);
    await register(page, uniqueEmail("addr"), name);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  const field = (label: string) => page.getByRole("textbox", { name: new RegExp(`^${label}`) });
  const cards = () => page.getByTestId("address-card");
  const cardFor = (city: string) => cards().filter({ hasText: city });

  async function fillAddress(v: { line1: string; city: string; state: string; postal: string }) {
    await field("Full name").fill("Amira Rahman");
    await field("Phone").fill("+91 98765 43210");
    await field("Address line 1").fill(v.line1);
    await field("City").fill(v.city);
    await field("State").fill(v.state);
    await field("Postal code").fill(v.postal);
  }

  test("open addresses from the account; add the first address, which becomes default", async () => {
    // 11
    await page.goto("/account");
    await page.getByRole("link", { name: /^Addresses/ }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/);
    await expect(page.getByTestId("empty-addresses")).toBeVisible({ timeout: 10_000 });

    // inline validation before anything is sent
    await page.getByRole("button", { name: "Add an address" }).click();
    await page.getByRole("button", { name: "Save address" }).click();
    await expect(field("Full name")).toHaveAttribute("aria-invalid", "true");
    await expect(field("Full name")).toBeFocused();
    await expect(page.getByText("Enter the postal code.")).toBeVisible();

    // 12 + 13
    await fillAddress({ line1: "12 Marine Drive", city: "Kochi", state: "Kerala", postal: "682001" });
    await page.getByRole("button", { name: "Save address" }).click();
    await expect(cards()).toHaveCount(1, { timeout: 10_000 });
    await expect(cardFor("Kochi").getByTestId("default-badge")).toHaveText("Default");
    await expect(page.getByTestId("address-status")).toHaveText("Address saved. It's your default address.");
  });

  test("add a second address, make it default; the previous default clears", async () => {
    // 14
    await page.getByRole("button", { name: "Add an address" }).click();
    await fillAddress({ line1: "4 Hill Road", city: "Mumbai", state: "Maharashtra", postal: "400050" });
    await page.getByRole("button", { name: "Save address" }).click();
    await expect(cards()).toHaveCount(2, { timeout: 10_000 });
    await expect(cardFor("Mumbai").getByTestId("default-badge")).toHaveCount(0);

    // 15 + 16
    await page.getByRole("button", { name: "Make Amira Rahman, Mumbai your default address" }).click();
    await expect(cardFor("Mumbai").getByTestId("default-badge")).toBeVisible({ timeout: 10_000 });
    await expect(cardFor("Kochi").getByTestId("default-badge")).toHaveCount(0);
    await expect(page.getByTestId("default-badge")).toHaveCount(1);

    // survives a reload — server truth
    await page.reload();
    await expect(cardFor("Mumbai").getByTestId("default-badge")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("default-badge")).toHaveCount(1);
  });

  test("edit an address", async () => {
    // 17
    await page.getByRole("button", { name: "Edit address for Amira Rahman, Kochi" }).click();
    await expect(page.getByRole("heading", { name: "Edit address" })).toBeFocused();
    await field("Address line 1").fill("7 Beach Road");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByTestId("address-status")).toHaveText("Address updated.", { timeout: 10_000 });
    await expect(cardFor("Kochi")).toContainText("7 Beach Road");
    // focus returns to the Edit button the shopper used
    await expect(page.getByRole("button", { name: "Edit address for Amira Rahman, Kochi" })).toBeFocused();
  });

  test("delete a non-default address", async () => {
    // 18
    await page.getByRole("button", { name: "Delete address for Amira Rahman, Kochi" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this address?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Delete address" }).click();
    await expect(cards()).toHaveCount(1, { timeout: 10_000 });
    await expect(cardFor("Mumbai").getByTestId("default-badge")).toBeVisible();
  });

  test("deleting the default requires choosing a new default", async () => {
    // 19
    await page.getByRole("button", { name: "Add an address" }).click();
    await fillAddress({ line1: "22 Park Street", city: "Kolkata", state: "West Bengal", postal: "700016" });
    await page.getByRole("button", { name: "Save address" }).click();
    await expect(cards()).toHaveCount(2, { timeout: 10_000 });

    await page.getByRole("button", { name: "Delete address for Amira Rahman, Mumbai" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this address?" });
    await expect(dialog.getByRole("group", { name: /Choose a new default/ })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /Kolkata/ })).toBeChecked();

    // Escape keeps the address
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(cards()).toHaveCount(2);

    await page.getByRole("button", { name: "Delete address for Amira Rahman, Mumbai" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete address" }).click();
    await expect(cards()).toHaveCount(1, { timeout: 10_000 });
    await expect(cardFor("Kolkata").getByTestId("default-badge")).toBeVisible();
    await expect(page.getByTestId("default-badge")).toHaveCount(1);
  });

  test("mobile 375px: form and cards fit without horizontal overflow", async () => {
    // 20
    await page.setViewportSize({ width: 375, height: 740 });
    await page.reload();
    await expect(cards()).toHaveCount(1, { timeout: 10_000 });
    await noHorizontalOverflow(page);
    const edit = page.getByRole("button", { name: /^Edit address/ });
    expect((await edit.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await page.getByRole("button", { name: "Add an address" }).click();
    await expect(field("Full name")).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("keyboard only: add, make default, and delete with a replacement", async () => {
    // 21
    await page.goto("/account/addresses");
    const add = page.getByRole("button", { name: "Add an address" });
    await expect(add).toBeVisible({ timeout: 10_000 });
    await tabTo(page, add);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Add an address" })).toBeFocused();

    // walk the form in order with Tab
    await page.keyboard.press("Tab");
    await expect(field("Full name")).toBeFocused();
    await page.keyboard.type("Keys Only");
    for (const [label, value] of [
      ["Phone", "080 4123 4567"],
      ["Address line 1", "9 MG Road"],
      ["Address line 2", ""],
      ["City", "Bengaluru"],
      ["State", "Karnataka"],
    ] as const) {
      await page.keyboard.press("Tab");
      await expect(field(label)).toBeFocused();
      if (value) await page.keyboard.type(value);
    }
    await page.keyboard.press("Tab"); // country select (India preselected)
    await expect(page.getByRole("combobox", { name: /^Country/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(field("Postal code")).toBeFocused();
    await page.keyboard.type("560001");
    await page.keyboard.press("Enter");

    await expect(cards()).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId("address-status")).toHaveText("Address saved.");

    const makeDefault = page.getByRole("button", { name: "Make Keys Only, Bengaluru your default address" });
    await tabTo(page, makeDefault);
    await page.keyboard.press("Enter");
    await expect(cardFor("Bengaluru").getByTestId("default-badge")).toBeVisible({ timeout: 10_000 });

    const del = page.getByRole("button", { name: "Delete address for Keys Only, Bengaluru" });
    await tabTo(page, del);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Delete this address?" });
    await expect(dialog.getByRole("button", { name: "Keep address" })).toBeFocused();
    // Tab stays inside the modal: the replacement radio, then the actions
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("radio", { name: /Kolkata/ })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete address" }).focus();
    await page.keyboard.press("Enter");

    await expect(cards()).toHaveCount(1, { timeout: 10_000 });
    await expect(cardFor("Kolkata").getByTestId("default-badge")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Addresses", exact: true })).toBeFocused();
  });
});
