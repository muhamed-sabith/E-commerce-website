import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";

/**
 * Phase 10 e2e: the admin module in a real browser against the real stack
 * (Vite → Express → PostgreSQL dev DB). One admin session walks the whole
 * operational loop; customers and their orders are created through the API
 * the same way the storefront does (CSRF double-submit, cookie session).
 */
test.describe.configure({ mode: "serial" });

const API = "http://localhost:4000/api/v1";
const prisma = new PrismaClient({
  datasourceUrl: process.env.E2E_DATABASE_URL ?? "postgresql://postgres@localhost:5432/heyrah_dev",
});
const stamp = `${Date.now()}`.slice(-6);
const adminEmail = `admin-e2e-${stamp}@heyrah.test`;
const adminPassword = "AdminWings!2026x";
const customerPassword = "Customer!2026x";

test.beforeAll(async () => {
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN" },
    create: { email: adminEmail, name: "E2E Admin", role: "ADMIN", passwordHash: await bcrypt.hash(adminPassword, 10) },
  });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ---------- helpers ----------

async function csrf(api: APIRequestContext): Promise<string> {
  await api.get(`${API}/auth/csrf`);
  const state = await api.storageState();
  return state.cookies.find((c) => c.name === "heyrah_csrf")?.value ?? "";
}

/** A customer with one placed order, created through the public API. */
async function customerWithOrder(playwright: typeof import("@playwright/test")["request"], slug: string, qty: number) {
  const api = await playwright.newContext();
  let token = await csrf(api);
  const email = `cust-e2e-${Date.now()}-${Math.floor(Math.random() * 1e5)}@heyrah.test`;
  const reg = await api.post(`${API}/auth/register`, {
    headers: { "X-CSRF-Token": token },
    data: { name: "Noor Customer", email, password: customerPassword },
  });
  expect(reg.status()).toBe(201);
  token = await csrf(api);
  const h = { "X-CSRF-Token": token };
  const addr = await api.post(`${API}/addresses`, {
    headers: h,
    data: { receiver_name: "Noor Customer", phone: "+91 98765 43210", line1: "4 Fort Road", city: "Kochi", state: "Kerala", postal_code: "682001", country_code: "IN" },
  });
  expect(addr.status()).toBe(201);
  const product = await prisma.product.findUniqueOrThrow({ where: { slug } });
  expect((await api.post(`${API}/cart/items`, { headers: h, data: { product_id: product.id.toString(), qty } })).status()).toBe(200);
  const order = await api.post(`${API}/checkout`, { headers: h, data: { address_id: (await addr.json()).address.id } });
  expect(order.status()).toBe(201);
  const body = await order.json();
  return { api, email, orderId: body.order.id as string, orderNumber: body.order.orderNumber as string };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 10_000 });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function sharedPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:5173" });
  return context.newPage();
}

const stockOf = async (slug: string) => (await prisma.product.findUniqueOrThrow({ where: { slug } })).stockQuantity;

// =============================================================
// Access control
// =============================================================

test.describe("admin access", () => {
  test("a guest visiting /admin is sent to sign in; the API refuses with 401", async ({ page, request }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
    const res = await request.get(`${API}/admin/dashboard`);
    expect(res.status()).toBe(401);
  });

  test("a customer sees no admin tools; the API refuses with 403", async ({ page, playwright }) => {
    const c = await customerWithOrder(playwright.request, "cotton-hair-tie", 1);
    await signIn(page, c.email, customerPassword);
    await expect(page.getByRole("banner").getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    await page.goto("/admin/orders");
    await expect(page.getByRole("heading", { name: "This area is for HEYRAH staff" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
    const res = await c.api.get(`${API}/admin/orders`);
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe("access_denied");
    await c.api.dispose();
  });
});

// =============================================================
// The operational loop
// =============================================================

test.describe("admin workflow", () => {
  let page: Page;
  const sku = `HEY-QAE-${stamp.slice(-5).padStart(5, "0")}`;
  const productName = `Saffron Linen Kaftan ${stamp}`;
  let productId = "";

  test.beforeAll(async ({ browser }) => {
    page = await sharedPage(browser);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("sign in → dashboard with live numbers", async () => {
    await signIn(page, adminEmail, adminPassword);
    await page.getByRole("banner").getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    const total = await prisma.order.count();
    await expect(page.locator(".adm-figure").filter({ hasText: "All orders" }).locator(".adm-figure__value")).toHaveText(String(total));
    const out = await prisma.product.count({ where: { status: { not: "archived" }, stockQuantity: 0 } });
    await expect(page.getByText(new RegExp(`^${out} out of stock`))).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  test("create a product: validation keeps input, duplicate SKU is explained, then it saves", async () => {
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Products" }).click();
    await page.getByRole("link", { name: "Add product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/new$/);

    // client-side validation: focus moves to the first problem
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("alert")).toHaveText("Check the highlighted fields.");
    await expect(page.getByLabel("Name", { exact: true })).toBeFocused();

    await page.getByLabel("Name", { exact: true }).fill(productName);
    await page.getByLabel("SKU").fill("HEY-KUR-00001"); // taken
    await page.getByLabel("Category").selectOption({ label: "Dresses" });
    await page.getByLabel("Description").fill("Hand-loomed linen with a saffron border.");
    await page.getByLabel("Price (₹)").fill("3200.00");
    await page.getByLabel("Discount").selectOption("percent");
    await page.getByLabel("Percent off").fill("10");
    await page.getByLabel("Opening stock").fill("6");
    await page.getByRole("button", { name: "Create product" }).click();

    // server conflict maps onto the field; everything typed survives
    await expect(page.getByText("Another product already uses this SKU").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("SKU")).toBeFocused();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(productName);
    await expect(page.getByLabel("Price (₹)")).toHaveValue("3200.00");

    await page.getByLabel("SKU").fill(sku);
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("heading", { level: 1, name: productName })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("status").filter({ hasText: "created" })).toBeVisible();
    productId = page.url().split("/").pop()!;
    const row = await prisma.product.findUniqueOrThrow({ where: { sku } });
    expect(row.stockQuantity).toBe(6);
    expect(row.status).toBe("inactive");
    expect(row.price.toFixed(2)).toBe("3200.00");
  });

  test("upload an image (bad file refused), then make it active", async () => {
    // A text file disguised as a JPEG is refused by the server
    await page.getByLabel("Add an image").setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really an image") });
    await page.getByRole("button", { name: "Upload image" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /JPEG, PNG, or WebP/ })).toBeVisible({ timeout: 10_000 });

    const jpeg = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#d9a441" } }).jpeg().toBuffer();
    await page.getByLabel("Add an image").setInputFiles({ name: "kaftan front.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByLabel("Alt text").fill("Saffron kaftan, front");
    await page.getByRole("button", { name: "Upload image" }).click();
    const gallery = page.locator(".adm-gallery__item");
    await expect(gallery).toHaveCount(1, { timeout: 10_000 });
    await expect(gallery.first().getByText("Primary")).toBeVisible();
    const src = await gallery.first().locator("img").getAttribute("src");
    expect(src).toMatch(/^\/assets\/products\/\d+\/[0-9a-f-]{36}\.webp$/);
    // the stored file is served (through the Vite proxy) as a real image
    const res = await page.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/webp");

    await page.getByLabel("Status").selectOption("active");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".adm-head .adm-badge", { hasText: "Active" })).toBeVisible();
    // the last image of an active product can't be removed
    await expect(gallery.first().getByRole("button", { name: /Remove/ })).toBeDisabled();
  });

  test("edit price; the storefront shows the server's final price", async () => {
    await page.getByLabel("Price (₹)").fill("3000.00");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible({ timeout: 10_000 });
    const slug = (await prisma.product.findUniqueOrThrow({ where: { sku } })).slug;
    const res = await page.request.get(`${API}/products/${slug}`);
    expect((await res.json()).finalPrice.amount).toBe("2700.00");
  });

  test("stock adjustment from the product page is audited", async () => {
    const panel = page.locator(".adm-panel", { has: page.getByRole("heading", { name: "Stock" }) });
    await panel.getByLabel("Reason").selectOption("damaged");
    await panel.getByLabel("Units").fill("10");
    await panel.getByRole("button", { name: "Save adjustment" }).click();
    await expect(panel.getByRole("alert")).toHaveText("Only 6 in stock");
    await panel.getByLabel("Units").fill("2");
    await panel.getByRole("button", { name: "Save adjustment" }).click();
    await expect(page.getByRole("status").filter({ hasText: "now 4 in stock" })).toBeVisible({ timeout: 10_000 });
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { productId: BigInt(productId) }, orderBy: { id: "desc" } });
    expect(adj).toMatchObject({ reason: "damaged", delta: -2, resultingQuantity: 4, actorType: "ADMIN" });
  });

  test("categories: add one, block deletion while in use, move products and delete", async () => {
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Categories" }).click();
    await page.getByRole("button", { name: "Add category" }).click();
    await page.getByLabel("Name", { exact: true }).fill(`Festive ${stamp}`);
    await page.getByRole("button", { name: "Add category" }).last().click();
    await expect(page.getByRole("status").filter({ hasText: "added" })).toBeVisible({ timeout: 10_000 });
    const cat = await prisma.category.findFirstOrThrow({ where: { name: `Festive ${stamp}` } });
    await prisma.product.update({ where: { id: BigInt(productId) }, data: { categoryId: cat.id } });
    await page.reload();

    const row = page.getByRole("row", { name: new RegExp(`Festive ${stamp}`) });
    await row.getByRole("button", { name: /Delete/ }).click();
    const dialog = page.getByRole("dialog", { name: `Delete Festive ${stamp}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep category" })).toBeFocused();
    await dialog.getByLabel("Move products to").selectOption({ label: "Dresses" });
    await dialog.getByRole("button", { name: "Move products and delete" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole("row", { name: new RegExp(`Festive ${stamp}`) })).toHaveCount(0);
    const dresses = await prisma.category.findUniqueOrThrow({ where: { slug: "dresses" } });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: BigInt(productId) } })).categoryId).toBe(dresses.id);
  });

  test("inventory: filters and an inline restock", async () => {
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Inventory" }).click();
    await page.getByRole("button", { name: /Out of stock/ }).click();
    await expect(page).toHaveURL(/filter=out/);
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    for (const t of await page.locator("tbody .adm-big").allInnerTexts()) expect(t).toBe("0");

    await page.getByRole("button", { name: /^All/ }).click();
    await page.getByRole("searchbox", { name: "Search inventory" }).fill(sku);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole("button", { name: /Adjust stock for/ }).click();
    await page.getByLabel("Units").fill("5");
    await page.getByRole("button", { name: "Save adjustment" }).click();
    await expect(page.getByRole("status").filter({ hasText: "now 9 in stock" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("tbody .adm-big").first()).toHaveText("9");
  });

  test("orders: find by number, confirm payment, advance the ladder", async ({ playwright }) => {
    const c = await customerWithOrder(playwright.request, "cotton-hair-tie", 1);
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Orders" }).click();
    await page.getByRole("searchbox", { name: "Search orders" }).fill(c.orderNumber);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("link", { name: c.orderNumber }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Order ${c.orderNumber}` })).toBeVisible();
    await expect(page.getByText("Ships to")).toBeVisible();

    await page.getByRole("button", { name: "Confirm payment received" }).click();
    const pay = page.getByRole("dialog", { name: `Mark ${c.orderNumber} as paid?` });
    await pay.getByLabel("Payment reference").fill("UPI 77812");
    await pay.getByRole("button", { name: /Confirm .* received/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Payment confirmed." })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Confirm payment received" })).toHaveCount(0);

    await page.getByRole("button", { name: "Confirm order" }).click();
    await expect(page.getByRole("button", { name: "Mark as shipped" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Mark as shipped" }).click();
    await expect(page.getByRole("button", { name: "Mark as delivered" })).toBeVisible({ timeout: 10_000 });
    // shipped orders can't be cancelled
    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(c.orderId) }, include: { statusHistory: { orderBy: { id: "asc" } } } });
    expect(order).toMatchObject({ status: "shipped", paymentStatus: "PAID" });
    expect(order.statusHistory.map((h) => h.toStatus)).toEqual(["pending", "PAID", "confirmed", "shipped"]);
    const customerView = await c.api.get(`${API}/orders/${c.orderId}`);
    expect((await customerView.json()).order.paymentStatus).toBe("PAID");
    await c.api.dispose();
  });

  test("cancel an eligible order: confirmation, then stock is restored exactly once", async ({ playwright }) => {
    const before = await stockOf("cashmere-scarf");
    const c = await customerWithOrder(playwright.request, "cashmere-scarf", 2);
    expect(await stockOf("cashmere-scarf")).toBe(before - 2);

    await page.goto(`/admin/orders/${c.orderId}`);
    await page.getByRole("button", { name: "Cancel order" }).click();
    const dialog = page.getByRole("dialog", { name: `Cancel order ${c.orderNumber}?` });
    await expect(dialog.getByRole("button", { name: "Keep order" })).toBeFocused();
    // Escape keeps the order
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await stockOf("cashmere-scarf")).toBe(before - 2);

    await page.getByRole("button", { name: "Cancel order" }).click();
    await dialog.getByLabel(/Note for the order history/).fill("Customer asked to cancel");
    await dialog.getByRole("button", { name: "Cancel order" }).click();
    await expect(page.getByRole("status").filter({ hasText: "returned to stock" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("This order was cancelled. Its stock has been returned.")).toBeVisible();
    expect(await stockOf("cashmere-scarf")).toBe(before);

    // A replayed cancel through the API is refused and restores nothing
    const token = (await page.context().cookies()).find((k) => k.name === "heyrah_csrf")?.value ?? "";
    const replay = await page.request.post(`${API}/admin/orders/${c.orderId}/status`, {
      headers: { "X-CSRF-Token": token },
      data: { status: "cancelled" },
    });
    expect(replay.status()).toBe(409);
    expect(await stockOf("cashmere-scarf")).toBe(before);
    await c.api.dispose();
  });

  test("customers: block with a reason, then unblock", async ({ playwright }) => {
    const c = await customerWithOrder(playwright.request, "cotton-hair-tie", 1);
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Customers" }).click();
    await page.getByRole("searchbox", { name: "Search customers" }).fill(c.email);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).not.toContainText(/password|hash/i);

    await page.getByRole("button", { name: /^Block/ }).click();
    const dialog = page.getByRole("dialog", { name: /^Block/ });
    await dialog.getByRole("button", { name: "Block customer" }).click();
    await expect(dialog.getByText("Give a reason of at least 3 characters")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Repeated chargebacks");
    await dialog.getByRole("button", { name: "Block customer" }).click();
    await expect(page.getByRole("status").filter({ hasText: "is blocked" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("tbody")).toContainText("Repeated chargebacks");
    // their session is gone
    expect((await c.api.get(`${API}/orders`)).status()).toBe(401);

    await page.getByRole("button", { name: /^Unblock/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unblock customer" }).click();
    await expect(page.getByRole("status").filter({ hasText: "can sign in again" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("tbody .adm-badge", { hasText: "Active" })).toBeVisible();
    await c.api.dispose();
  });

  test("settings: validation, save, storefront follows, brand stays fixed", async () => {
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Settings" }).click();
    await expect(page.getByText("Wings of Style")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /tagline|store name/i })).toHaveCount(0);

    await page.getByLabel("Products per page").fill("100");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Enter a number from 4 to 48")).toBeVisible();
    await expect(page.getByLabel("Products per page")).toBeFocused();

    await page.getByLabel("Products per page").fill("8");
    await page.getByLabel("Default sort").selectOption("price_asc");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible({ timeout: 10_000 });

    const list = await (await page.request.get(`${API}/products`)).json();
    expect(list.pageSize).toBe(8);
    expect(list.sort).toBe("price_asc");

    // restore defaults for the rest of the suite
    await prisma.storeSettings.deleteMany();
  });

  test("archive the new product (it has stock history), then sign out", async () => {
    await page.goto(`/admin/products/${productId}`);
    await page.getByRole("button", { name: "Archive product" }).click();
    const dialog = page.getByRole("dialog", { name: /^Archive/ });
    await dialog.getByRole("button", { name: "Archive product" }).click();
    await expect(page.getByRole("status").filter({ hasText: "archived" })).toBeVisible({ timeout: 10_000 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: BigInt(productId) } })).status).toBe("archived");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  });
});

// =============================================================
// Responsive + keyboard
// =============================================================

test.describe("admin layout", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await sharedPage(browser);
    await signIn(page, adminEmail, adminPassword);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("no horizontal overflow at desktop, tablet, and phone widths", async () => {
    test.setTimeout(120_000); // 8 pages � 5 widths
    const paths = ["/admin", "/admin/orders", "/admin/products", "/admin/inventory", "/admin/users", "/admin/settings", "/admin/categories", "/admin/pages"];
    for (const width of [1440, 1280, 1024, 820, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const p of paths) {
        await page.goto(p);
        await expect(page.locator("[data-admin-heading]")).toBeVisible({ timeout: 10_000 });
        await page.waitForLoadState("networkidle");
        await noHorizontalOverflow(page);
      }
    }
  });

  test("mobile menu: opens, focuses the first link, closes on Escape", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin/orders");
    const toggle = page.getByRole("button", { name: "Menu" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Dashboard" })).toBeHidden();
    const box = await toggle.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Dashboard" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Inventory" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  });

  test("keyboard only: skip link, navigate, filter, and open an order", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();

    // Tab through the sidebar to Orders and follow it with Enter
    const ordersLink = page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Orders" });
    for (let i = 0; i < 12 && !(await ordersLink.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(ordersLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeFocused();

    const search = page.getByRole("searchbox", { name: "Search orders" });
    for (let i = 0; i < 20 && !(await search.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(search).toBeFocused();
    await page.keyboard.type("HEY-");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=HEY-/);
    const first = page.locator("tbody .adm-rowlink").first();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: /^Order HEY-/ })).toBeFocused({ timeout: 10_000 });
  });
});
