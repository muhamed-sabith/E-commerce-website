import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { seed } from "../prisma/seed";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";
import { UPLOAD_ROOT } from "../src/lib/images.js";
import { resetRateLimiter } from "../src/middleware/rate-limit.js";
import { createPaymentService, DemoPaymentProvider, ManualPaymentProvider } from "../src/services/payment.service.js";
import { isPrivatePath } from "../src/services/seo.service.js";

/**
 * Phase 11 — public site data, SEO surfaces, seed artwork, security
 * headers, admin idle timeout. Real PostgreSQL (`npm run test:db`).
 */

let app: Express;
const base = "/api/v1";

beforeAll(async () => {
  await seed();
  app = createApp({ payments: createPaymentService(new DemoPaymentProvider()) });
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(() => resetRateLimiter());

describe("seed artwork (image root cause)", () => {
  it("every seeded image row points at a real, servable WebP file", async () => {
    const images = await prisma.productImage.findMany({ select: { filePath: true } });
    expect(images.length).toBeGreaterThan(0);
    for (const i of images) {
      expect(i.filePath).toMatch(/^products\/seed\/hey-[a-z]{3}-\d{5}-[12]\.webp$/);
      expect(existsSync(path.join(UPLOAD_ROOT, i.filePath))).toBe(true);
    }
    const first = images[0].filePath;
    const res = await request(app).get(`/assets/${first}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    const meta = await sharp(res.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 900, height: 1200 });
  });

  it("catalog and detail responses carry the same paths", async () => {
    const list = (await request(app).get(`${base}/products?page_size=48`)).body;
    expect(list.items.every((p: { image: { src: string } | null }) => p.image && p.image.src.startsWith("/assets/products/seed/"))).toBe(true);
    const detail = (await request(app).get(`${base}/products/silk-slip-dress`)).body;
    expect(detail.images).toHaveLength(2);
    expect(detail.images[0].alt).toBe("Silk Slip Dress, placeholder artwork");
  });
});

describe("GET /store", () => {
  it("states only configured facts", async () => {
    const res = await request(app).get(`${base}/store`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brand: { name: "HEYRAH", tagline: "Wings of Style" },
      currency: "INR",
      shipping: { flatRate: { amount: "99.00" }, freeThreshold: { amount: "2999.00" } },
      paymentMode: "demo",
      pages: [],
    });
    const manual = createApp({ payments: createPaymentService(new ManualPaymentProvider()) });
    expect((await request(manual).get(`${base}/store`)).body.paymentMode).toBe("manual");
  });
});

describe("SEO meta", () => {
  const meta = async (p: string) => (await request(app).get(`${base}/seo/meta`).query({ path: p })).body;

  it("home: brand title, canonical, organization JSON-LD", async () => {
    const m = await meta("/");
    expect(m.title).toBe("HEYRAH — Wings of Style");
    expect(m.canonical).toBe("http://localhost:5173/");
    expect(m.robots).toBe("index, follow");
    expect(m.jsonLd[0]).toMatchObject({ "@type": "Organization", name: "HEYRAH", slogan: "Wings of Style" });
    expect(m.links.map((l: { href: string }) => l.href)).toContain("/category/dresses");
  });

  it("product: specific title/description and JSON-LD from real values only", async () => {
    const m = await meta("/product/silk-slip-dress");
    expect(m.status).toBe(200);
    expect(m.title).toBe("Silk Slip Dress | HEYRAH");
    expect(m.canonical).toBe("http://localhost:5173/product/silk-slip-dress");
    expect(m.ogType).toBe("product");
    expect(m.image).toMatch(/^http:\/\/localhost:5173\/assets\/products\/seed\/hey-drs-00004-1\.webp$/);
    const product = m.jsonLd.find((j: { "@type": string }) => j["@type"] === "Product");
    const row = await prisma.product.findUniqueOrThrow({ where: { slug: "silk-slip-dress" } });
    expect(product).toMatchObject({
      name: "Silk Slip Dress",
      sku: row.sku,
    });
    // Exactly the verified offer fields: no condition, rating, or invented values.
    expect(product.offers).toEqual({
      "@type": "Offer",
      url: "http://localhost:5173/product/silk-slip-dress",
      priceCurrency: "INR",
      price: "4590.00",
      availability: "https://schema.org/InStock",
    });
    expect(JSON.stringify(m)).not.toMatch(/aggregateRating|review|itemCondition|stockQuantity|"id"/);
    const crumbs = m.jsonLd.find((j: { "@type": string }) => j["@type"] === "BreadcrumbList");
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Home", "Dresses", "Silk Slip Dress"]);
  });

  it("out-of-stock product says so", async () => {
    const m = await meta("/product/trench-overcoat");
    const product = m.jsonLd.find((j: { "@type": string }) => j["@type"] === "Product");
    expect(product.offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("inactive, archived, and unknown products are 404 + noindex", async () => {
    for (const p of ["/product/archive-sample-tote", "/product/does-not-exist", "/category/archive-preview", "/nope"]) {
      const m = await meta(p);
      expect(m.status, p).toBe(404);
      expect(m.robots).toBe("noindex, follow");
      expect(m.canonical).toBeNull();
    }
  });

  it("category: specific meta; filter/sort/search variants canonicalize to the base", async () => {
    const m = await meta("/category/dresses");
    expect(m).toMatchObject({ title: "Dresses | HEYRAH", canonical: "http://localhost:5173/category/dresses", robots: "index, follow" });
    expect((await meta("/category/dresses?sort=price_asc")).robots).toBe("noindex, follow");
    const searched = await meta("/products?q=linen&sort=price_asc&page=2");
    expect(searched).toMatchObject({ canonical: "http://localhost:5173/products", robots: "noindex, follow" });
    expect((await meta("/products")).robots).toBe("index, follow");
    expect((await meta("/products/")).canonical).toBe("http://localhost:5173/products");
  });

  it("private routes are noindex, nofollow with no canonical", async () => {
    for (const p of ["/login", "/register", "/account", "/account/addresses", "/cart", "/checkout", "/payment/demo/4", "/orders", "/orders/7", "/wishlist", "/admin", "/admin/orders/3"]) {
      const m = await meta(p);
      expect(m.robots, p).toBe("noindex, nofollow");
      expect(m.canonical).toBeNull();
      expect(isPrivatePath(p)).toBe(true);
    }
    expect(isPrivatePath("/products")).toBe(false);
    expect(isPrivatePath("/orderly")).toBe(false);
  });

  it("ignores absolute/foreign URLs in the path parameter", async () => {
    const m = await meta("https://evil.example/product/silk-slip-dress");
    expect(m.canonical).toBe("http://localhost:5173/");
  });
});

describe("sitemap + robots", () => {
  it("sitemap lists only public canonical URLs", async () => {
    const res = await request(app).get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const active = await prisma.product.count({ where: { status: "active", category: { isActive: true } } });
    const cats = await prisma.category.count({ where: { isActive: true } });
    expect(locs).toHaveLength(3 + cats + active); // no policy pages published in the seed
    expect(locs).toContain("http://localhost:5173/product/silk-slip-dress");
    expect(locs).not.toContain("http://localhost:5173/product/archive-sample-tote");
    expect(locs.some((l) => /\/(cart|checkout|payment|account|admin|orders|login|register|wishlist)/.test(l))).toBe(false);
    expect(locs.every((l) => l.startsWith("http://localhost:5173/") && !l.includes("?"))).toBe(true);
  });

  it("robots.txt disallows private areas and points at the sitemap", async () => {
    const res = await request(app).get("/robots.txt");
    expect(res.status).toBe(200);
    for (const p of ["/admin", "/cart", "/checkout", "/payment", "/account", "/orders", "/api/"]) expect(res.text).toContain(`Disallow: ${p}`);
    expect(res.text).not.toMatch(/Disallow: \/(products|product|category)\b/);
    expect(res.text).toContain("Sitemap: http://localhost:5173/sitemap.xml");
  });
});

describe("security headers", () => {
  it("are present on API responses", async () => {
    const res = await request(app).get(`${base}/categories`);
    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    });
    expect(res.headers["permissions-policy"]).toContain("camera=()");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("product images keep their sandboxed CSP", async () => {
    const img = await prisma.productImage.findFirstOrThrow();
    const res = await request(app).get(`/assets/${img.filePath}`);
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  });

  it("CORS only reflects the configured web origin", async () => {
    const ok = await request(app).get(`${base}/categories`).set("Origin", "http://localhost:5173");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const evil = await request(app).get(`${base}/categories`).set("Origin", "https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
  });
});

describe("catalog read rate limit", () => {
  it("cools bursts per IP with 429 + Retry-After", async () => {
    // Runs under `npm run test:db`, which pins the documented default (300/min).
    const { env } = await import("../src/config/env.js");
    let last: request.Response | null = null;
    for (let i = 0; i <= env.CATALOG_RATE_LIMIT_MAX; i++) last = await request(app).get(`${base}/categories`);
    expect(last!.status).toBe(429);
    expect(last!.headers["retry-after"]).toBeDefined();
    resetRateLimiter();
    expect((await request(app).get(`${base}/categories`)).status).toBe(200);
  });
});

describe("admin idle timeout", () => {
  async function loginAs(role: "USER" | "ADMIN") {
    const email = `idle-${role.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.com`;
    const user = await prisma.user.create({ data: { email, name: "Idle", role, passwordHash: await hashPassword("Str0ngPass!x") } });
    const jar = new Map<string, string>();
    const take = (r: request.Response) => {
      for (const line of (r.headers["set-cookie"] ?? []) as unknown as string[]) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    };
    const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    take(await request(app).get(`${base}/auth/csrf`));
    const res = await request(app)
      .post(`${base}/auth/login`)
      .set("Cookie", header())
      .set("X-CSRF-Token", jar.get("heyrah_csrf")!)
      .send({ email, password: "Str0ngPass!x" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    take(res);
    return { user, cookie: header() };
  }
  const idleBy = (userId: bigint, minutes: number) =>
    prisma.session.updateMany({ where: { userId }, data: { lastSeenAt: new Date(Date.now() - minutes * 60_000) } });

  it("an admin idle for 61 minutes is signed out; 59 minutes is fine", async () => {
    const a = await loginAs("ADMIN");
    await idleBy(a.user.id, 59);
    expect((await request(app).get(`${base}/admin/dashboard`).set("Cookie", a.cookie)).status).toBe(200);
    await idleBy(a.user.id, 61);
    expect((await request(app).get(`${base}/admin/dashboard`).set("Cookie", a.cookie)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: a.user.id } })).toBe(0);
  });

  it("a customer idle for 61 minutes keeps their session (24h idle window)", async () => {
    const c = await loginAs("USER");
    await idleBy(c.user.id, 61);
    expect((await request(app).get(`${base}/auth/me`).set("Cookie", c.cookie)).body.user?.email).toBe(c.user.email);
    await idleBy(c.user.id, 25 * 60);
    expect((await request(app).get(`${base}/auth/me`).set("Cookie", c.cookie)).body.user).toBeNull();
  });
});


describe("policy + contact pages", () => {
  async function adminClient() {
    const email = `pages-admin-${Date.now()}@example.com`;
    const user = await prisma.user.create({ data: { email, name: "Pages Admin", role: "ADMIN", passwordHash: await hashPassword("Str0ngPass!x") } });
    const jar = new Map<string, string>();
    const take = (r: request.Response) => {
      for (const line of (r.headers["set-cookie"] ?? []) as unknown as string[]) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    };
    const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    take(await request(app).get(`${base}/auth/csrf`));
    take(await request(app).post(`${base}/auth/login`).set("Cookie", header()).set("X-CSRF-Token", jar.get("heyrah_csrf")!).send({ email, password: "Str0ngPass!x" }));
    const send = (r: request.Test) => r.set("Cookie", header()).set("X-CSRF-Token", jar.get("heyrah_csrf")!);
    return {
      id: user.id,
      put: (slug: string, body: object) => send(request(app).put(`${base}/admin/pages/${slug}`)).send(body),
      del: (slug: string) => send(request(app).delete(`${base}/admin/pages/${slug}`)),
      list: () => request(app).get(`${base}/admin/pages`).set("Cookie", header()),
    };
  }
  const text = "Write to care@example.com. We reply on working days.\n\nPostal: 12 Marine Drive, Kochi.";

  it("start unpublished: honest state, noindex, not in sitemap or footer facts", async () => {
    const r = await request(app).get(`${base}/pages/privacy`);
    expect(r.status).toBe(200);
    expect(r.body.page).toEqual({ slug: "privacy", title: "Privacy policy", published: false, body: null, updatedAt: null });
    const m = (await request(app).get(`${base}/seo/meta`).query({ path: "/privacy" })).body;
    expect(m).toMatchObject({ robots: "noindex, follow", canonical: null });
    expect((await request(app).get("/sitemap.xml")).text).not.toContain("/privacy");
    expect((await request(app).get(`${base}/pages/nonsense`)).status).toBe(404);
  });

  it("admin publishes text verbatim; validation; audited; then public + indexed + in sitemap", async () => {
    const a = await adminClient();
    expect((await a.put("contact", { body: "short" })).status).toBe(400);
    expect((await a.put("contact", { body: text, title: "x" })).status).toBe(400);
    expect((await a.put("nonsense", { body: text })).status).toBe(404);
    const ok = await a.put("contact", { body: text });
    expect(ok.status).toBe(200);
    expect(ok.body.page).toMatchObject({ slug: "contact", published: true, body: text });
    expect(await prisma.adminAuditLog.count({ where: { action: "page.update", targetId: "contact", actorId: a.id } })).toBe(1);

    expect((await request(app).get(`${base}/pages/contact`)).body.page.body).toBe(text);
    expect((await request(app).get(`${base}/store`)).body.pages).toEqual(["contact"]);
    const m = (await request(app).get(`${base}/seo/meta`).query({ path: "/contact" })).body;
    expect(m).toMatchObject({ robots: "index, follow", canonical: "http://localhost:5173/contact", title: "Contact us | HEYRAH" });
    expect((await request(app).get("/sitemap.xml")).text).toContain("<loc>http://localhost:5173/contact</loc>");

    const list = (await a.list()).body.items;
    expect(list.map((p: { slug: string }) => p.slug)).toEqual(["privacy", "terms", "returns", "shipping", "contact"]);

    expect((await a.del("contact")).body.page.published).toBe(false);
    expect((await request(app).get(`${base}/store`)).body.pages).toEqual([]);
  });

  it("customers and guests can't edit pages", async () => {
    const guest = await request(app).put(`${base}/admin/pages/terms`).send({ body: text });
    expect(guest.status).toBe(401);
  });
});