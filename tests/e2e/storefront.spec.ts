import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 11 e2e: storefront chrome, homepage merchandising, SEO tags in the
 * live DOM, crawl surfaces through the dev proxy, automated accessibility
 * (axe-core, WCAG 2.1 A/AA rules) on public pages, and responsive checks at
 * every target width. Automated checks only — not a screen-reader pass.
 */

const WIDTHS = [1440, 1280, 1024, 820, 768, 430, 390, 375];

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target.join(" ")}`);
}

test.describe("homepage", () => {
  test("real merchandising: new in, categories with counts, honest info", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Wings of Style/);
    const newIn = page.getByTestId("rail-new");
    await expect(newIn.locator(".product-card")).toHaveCount(8, { timeout: 10_000 });
    // Newest first: the first card is the most recently created active product.
    const first = await newIn.locator(".product-card__name").first().innerText();
    const api = await (await page.request.get("http://localhost:4000/api/v1/products?sort=newest&in_stock=true&page_size=1")).json();
    expect(first).toBe(api.items[0].name);

    const tiles = page.getByTestId("category-tiles").getByRole("link");
    await expect(tiles).toHaveCount(5);
    const cats = await (await page.request.get("http://localhost:4000/api/v1/categories")).json();
    for (const c of cats.items) {
      await expect(page.getByTestId("category-tiles").getByRole("link", { name: new RegExp(`^${c.name}\\s+${c.productCount} piece`) })).toHaveAttribute(
        "href",
        `/category/${c.slug}`,
      );
    }
    // The price edit only shows pieces at or under ₹1,000, none repeated from New in.
    const edit = page.getByTestId("rail-edit");
    const newNames = await newIn.locator(".product-card__name").allInnerTexts();
    for (const n of await edit.locator(".product-card__name").allInnerTexts()) expect(newNames).not.toContain(n);
    for (const t of await edit.locator(".product-card__final").allInnerTexts()) expect(Number(t.replace(/[^\d.]/g, ""))).toBeLessThanOrEqual(1000);

    // Information strip + trust section state the configured shipping rule, nothing more.
    await expect(page.getByTestId("info-strip")).toContainText("₹2,999.00");
    await expect(page.getByText(/trusted by|customers|reviews|rating/i)).toHaveCount(0);
  });

  test("every footer and header link resolves to a real page", async ({ page }) => {
    await page.goto("/");
    const hrefs = new Set<string>();
    for (const sel of ["footer a", "header a", ".site-strip a"]) {
      for (const h of await page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute("href")))) if (h) hrefs.add(h);
    }
    for (const h of hrefs) {
      if (h.startsWith("#")) continue;
      await page.goto(h);
      await expect(page.getByRole("heading", { name: "Page not found" }), h).toHaveCount(0);
    }
  });
});

test.describe("product images", () => {
  test("catalog, product and category tiles load real image files", async ({ page }) => {
    await page.goto("/products");
    const img = page.getByTestId("product-grid").locator("img").first();
    await expect(img).toBeVisible({ timeout: 10_000 });
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(900);
    await page.goto("/product/silk-slip-dress");
    const stage = page.locator(".pdp__stage img");
    await expect(stage).toBeVisible();
    await expect.poll(() => stage.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(900);
    // thumbnails switch the main image and expose state
    const second = page.getByRole("button", { name: "Show image 2 of 2" });
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(stage).toHaveAttribute("alt", "Silk Slip Dress, alternate placeholder");
  });
});

test.describe("SEO in the browser", () => {
  test("titles, canonicals and robots follow the route", async ({ page }) => {
    await page.goto("/product/silk-slip-dress");
    await expect(page).toHaveTitle("Silk Slip Dress | HEYRAH");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/product\/silk-slip-dress$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");

    await page.goto("/category/dresses");
    await expect(page).toHaveTitle("Dresses | HEYRAH");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/category\/dresses$/);

    await page.goto("/products?q=linen&sort=price_asc");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/products$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");

    for (const p of ["/cart", "/login"]) {
      await page.goto(p);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    }
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  });

  test("one h1 per public page", async ({ page }) => {
    for (const p of ["/", "/products", "/category/kurtas", "/product/silk-slip-dress", "/help"]) {
      await page.goto(p);
      await expect(page.locator("h1"), p).toHaveCount(1, { timeout: 10_000 });
    }
  });

  test("sitemap and robots.txt are reachable on the web origin", async ({ page }) => {
    const sm = await page.request.get("/sitemap.xml");
    expect(sm.status()).toBe(200);
    expect(await sm.text()).toContain("/product/silk-slip-dress</loc>");
    const rb = await page.request.get("/robots.txt");
    expect(await rb.text()).toContain("Disallow: /checkout");
  });
});

test.describe("mobile header + drawer", () => {
  for (const width of [375, 390, 430, 768]) {
    test(`compact header at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 840 });
      await page.goto("/");
      const header = page.locator(".site-header");
      await expect(header).toBeVisible();
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64);
      // logo keeps its native aspect ratio
      const mark = page.locator(".site-header__mark");
      const box = (await mark.boundingBox())!;
      expect(Math.abs(box.width / box.height - 196 / 122)).toBeLessThan(0.03);
      for (const name of ["Menu", "Bag, 0 items"]) {
        const el = page.getByRole(name === "Menu" ? "button" : "link", { name });
        expect((await el.boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("drawer: focus moves in, Escape closes and restores focus, search works", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Menu" });
    await menu.click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("searchbox", { name: "Search products" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await drawer.getByRole("searchbox", { name: "Search products" }).fill("linen");
    await drawer.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/products\?q=linen$/);
    await expect(drawer).toBeHidden();
    await expect(page.getByTestId("product-grid").locator(".product-card").first()).toBeVisible({ timeout: 10_000 });

    await menu.click();
    await drawer.getByRole("link", { name: "Dresses" }).click();
    await expect(page).toHaveURL(/\/category\/dresses$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dresses" })).toBeVisible();
  });

  test("catalog filters collapse behind a toggle on small screens", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/products");
    const toggle = page.getByRole("button", { name: /^Filters/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("checkbox", { name: "In stock only" })).toBeHidden();
    await toggle.click();
    // The checkbox is URL-driven (state lives in the query string), so click and assert the URL.
    await page.getByRole("checkbox", { name: "In stock only" }).click();
    await expect(page).toHaveURL(/in_stock=true/);
    await expect(page.getByRole("checkbox", { name: "In stock only" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
  });
});

test.describe("policy + contact pages", () => {
  test("unpublished pages say so, are noindex, and are not linked", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("policy-pending")).toContainText("hasn't been published yet");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator("footer").getByRole("link", { name: "Privacy policy" })).toHaveCount(0);
  });

  test("an admin publishes contact text; it shows verbatim, is linked, and indexable", async ({ page, playwright }) => {
    const { PrismaClient } = await import("@prisma/client");
    const bcrypt = (await import("bcryptjs")).default;
    const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL ?? "postgresql://postgres@localhost:5432/heyrah_dev" });
    const email = `pages-e2e-${Date.now()}@heyrah.test`;
    await db.user.create({ data: { email, name: "Pages Admin", role: "ADMIN", passwordHash: await bcrypt.hash("AdminWings!2026x", 10) } });
    try {
      await page.goto("/login");
      await page.getByRole("textbox", { name: "Email address" }).fill(email);
      await page.getByRole("textbox", { name: "Password" }).fill("AdminWings!2026x");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 10_000 });
      await page.goto("/admin/pages");
      const form = page.locator("form", { has: page.getByRole("heading", { name: "Contact us" }) });
      const text = "Write to us at care@heyrah.example.\n\nWe reply on working days.";
      await form.getByLabel("Page text").fill(text);
      await form.getByRole("button", { name: "Publish page" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Contact us published." })).toBeVisible({ timeout: 10_000 });

      const guest = await playwright.chromium.launch({ channel: "chrome" });
      const g = await guest.newPage({ baseURL: "http://localhost:5173" });
      await g.goto("/contact");
      await expect(g.getByTestId("policy-body").locator("p").first()).toHaveText("Write to us at care@heyrah.example.");
      await expect(g.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
      await expect(g.locator("footer").getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/contact");
      await guest.close();
    } finally {
      await db.storePage.deleteMany({ where: { slug: "contact" } });
      await db.$disconnect();
    }
  });
});

test.describe("touch targets", () => {
  test("desktop header search, bag, and catalog chips are at least 44px tall", async ({ page }) => {
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/products");
      await expect(page.getByTestId("product-grid").locator(".product-card").first()).toBeVisible({ timeout: 10_000 });
      const targets = [
        page.getByRole("searchbox", { name: "Search products" }),
        page.getByRole("button", { name: "Submit search" }),
        page.getByTestId("header-bag"),
        ...(await page.getByRole("navigation", { name: "Categories" }).last().getByRole("link").all()),
      ];
      for (const t of targets) {
        if (!(await t.isVisible())) continue;
        const box = (await t.boundingBox())!;
        expect(box.height, `${await t.getAttribute("aria-label") ?? await t.innerText()} at ${width}px`).toBeGreaterThanOrEqual(44);
      }
      // the header did not grow
      expect((await page.locator(".site-header").boundingBox())!.height).toBeLessThanOrEqual(69);
    }
  });

  test("mobile category chips and bag are at least 44px tall", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/products");
    await expect(page.getByTestId("product-grid").locator(".product-card").first()).toBeVisible({ timeout: 10_000 });
    for (const chip of await page.locator(".catalog__chip").all()) {
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect((await page.getByTestId("header-bag").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("category landing", () => {
  test("scopes the catalog and keeps pagination/sort inside the category", async ({ page }) => {
    await page.goto("/category/accessories?sort=price_asc");
    await expect(page.getByRole("heading", { level: 1, name: "Accessories" })).toBeVisible();
    const cats = await page.locator(".product-card__category").allInnerTexts();
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats)).toEqual(new Set(["Accessories"]));
    const prices = (await page.locator(".product-card__final").allInnerTexts()).map((t) => Number(t.replace(/[^\d.]/g, "")));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    await expect(page.getByRole("link", { name: "Browse every category" })).toBeVisible();
  });

  test("unknown category is a not-found page", async ({ page }) => {
    await page.goto("/category/archive-preview");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("accessibility (axe-core automated)", () => {
  for (const p of ["/", "/products", "/category/dresses", "/product/silk-slip-dress", "/help", "/privacy", "/contact", "/login", "/register", "/cart", "/no-such-page"]) {
    test(`no WCAG A/AA violations on ${p}`, async ({ page }) => {
      await page.goto(p);
      await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });
      await page.waitForLoadState("networkidle");
      expect(await axe(page)).toEqual([]);
    });
  }

  test("drawer open has no violations", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("skip link moves focus to the main content", async ({ page }) => {
    await page.goto("/products");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });
});

test.describe("responsive storefront", () => {
  const pages = ["/", "/products", "/category/kurtas", "/product/silk-slip-dress", "/help", "/returns", "/cart", "/login"];
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const p of pages) {
        await page.goto(p);
        await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });
        await page.waitForLoadState("networkidle");
        expect(await overflow(page), `${p} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }
});
