import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { seed } from "../prisma/seed";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";
import { UPLOAD_ROOT, sniffImageType } from "../src/lib/images.js";
import { resetRateLimiter } from "../src/middleware/rate-limit.js";
import { createPaymentService, DemoPaymentProvider, ManualPaymentProvider } from "../src/services/payment.service.js";
import { storeDayStart } from "../src/services/admin-ops.service.js";

/**
 * Phase 10 — admin module against real PostgreSQL (`npm run test:db`).
 * Covers the authorization matrix, every admin endpoint, the deletion and
 * image-security rules, audited inventory, the order ladder with exactly-once
 * cancellation restock (including parallel cancels), manual payment, user
 * blocking, and settings.
 */

let app: Express; // demo mode
let manualApp: Express;
const base = "/api/v1";

type Jar = Record<string, string>;

function extractCookies(res: request.Response): Jar {
  const jar: Jar = {};
  for (const line of (res.headers["set-cookie"] ?? []) as unknown as string[]) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}
const cookieHeader = (jar: Jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

async function bootstrap(target: Express = app): Promise<Jar> {
  return extractCookies(await request(target).get(base + "/auth/csrf"));
}

const PASSWORD = "Str0ngPass!x";
const unique = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function login(email: string, target: Express = app): Promise<Jar> {
  const guest = await bootstrap(target);
  const res = await request(target)
    .post(base + "/auth/login")
    .set("Cookie", cookieHeader(guest))
    .set("X-CSRF-Token", guest["heyrah_csrf"])
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { ...guest, ...extractCookies(res) };
}

async function newAdmin(target: Express = app) {
  const email = unique("admin");
  const u = await prisma.user.create({
    data: { email, name: "Ops Admin", role: "ADMIN", passwordHash: await hashPassword(PASSWORD) },
  });
  return { id: u.id, jar: await login(email, target) };
}

async function newCustomer(target: Express = app) {
  const guest = await bootstrap(target);
  const email = unique("cust");
  const res = await request(target)
    .post(base + "/auth/register")
    .set("Cookie", cookieHeader(guest))
    .set("X-CSRF-Token", guest["heyrah_csrf"])
    .send({ name: "Customer", email, password: PASSWORD });
  expect(res.status).toBe(201);
  return { id: BigInt(res.body.user.id), email, jar: { ...guest, ...extractCookies(res) } };
}

function as(jar: Jar, target: Express = app) {
  const auth = (r: request.Test) => r.set("Cookie", cookieHeader(jar)).set("X-CSRF-Token", jar["heyrah_csrf"] ?? "");
  return {
    get: (p: string) => request(target).get(base + p).set("Cookie", cookieHeader(jar)),
    post: (p: string, body?: object) => auth(request(target).post(base + p)).send(body ?? {}),
    patch: (p: string, body: object) => auth(request(target).patch(base + p)).send(body),
    put: (p: string, body: object) => auth(request(target).put(base + p)).send(body),
    del: (p: string) => auth(request(target).delete(base + p)),
    upload: (p: string, file: Buffer, filename: string, contentType = "application/octet-stream") =>
      auth(request(target).post(base + p)).attach("image", file, { filename, contentType }),
  };
}

const address = {
  receiver_name: "Amira Rahman",
  phone: "+91 98765 43210",
  line1: "12 Marine Drive",
  city: "Kochi",
  state: "Kerala",
  postal_code: "682001",
  country_code: "IN",
};

const product = (slug: string) => prisma.product.findUniqueOrThrow({ where: { slug } });

/** A customer who has placed one order for the given lines. */
async function placeOrder(lines: { slug: string; qty: number }[], target: Express = app) {
  const c = await newCustomer(target);
  const client = as(c.jar, target);
  const addr = await client.post("/addresses", address);
  expect(addr.status).toBe(201);
  for (const l of lines) {
    const p = await product(l.slug);
    expect((await client.post("/cart/items", { product_id: p.id.toString(), qty: l.qty })).status).toBe(200);
  }
  const res = await client.post("/checkout", { address_id: addr.body.address.id });
  expect(res.status).toBe(201);
  return { customer: c, client, orderId: res.body.order.id as string, orderNumber: res.body.order.orderNumber as string };
}

let admin: Awaited<ReturnType<typeof newAdmin>>;
let A: ReturnType<typeof as>;
let dresses: bigint;
let accessories: bigint;

beforeAll(async () => {
  await seed();
  app = createApp({ payments: createPaymentService(new DemoPaymentProvider()) });
  manualApp = createApp({ payments: createPaymentService(new ManualPaymentProvider()) });
  resetRateLimiter();
  admin = await newAdmin();
  A = as(admin.jar);
  dresses = (await prisma.category.findUniqueOrThrow({ where: { slug: "dresses" } })).id;
  accessories = (await prisma.category.findUniqueOrThrow({ where: { slug: "accessories" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  resetRateLimiter();
});

// Real image fixtures (generated, so they decode).
const jpeg = () => sharp({ create: { width: 640, height: 800, channels: 3, background: "#0d3b3f" } }).jpeg().toBuffer();
const png = () => sharp({ create: { width: 400, height: 400, channels: 4, background: "#c9a24b" } }).png().toBuffer();

let skuSeq = 70000;
const nextSku = (cat = "TST") => `HEY-${cat}-${String(++skuSeq).padStart(5, "0")}`;

function productBody(over: Record<string, unknown> = {}) {
  return {
    name: "Admin Test Kaftan",
    sku: nextSku(),
    description: "A test product created by the admin suite.",
    price: "2499.00",
    category_id: dresses.toString(),
    status: "inactive",
    stock_quantity: 0,
    ...over,
  };
}

// =============================================================
// Authorization matrix
// =============================================================

describe("admin authorization (server-side)", () => {
  const surface: [string, string][] = [
    ["get", "/admin/dashboard"],
    ["get", "/admin/products"],
    ["post", "/admin/products"],
    ["get", "/admin/products/1"],
    ["patch", "/admin/products/1"],
    ["delete", "/admin/products/1"],
    ["post", "/admin/products/1/images"],
    ["post", "/admin/products/1/stock-adjustments"],
    ["delete", "/admin/images/1"],
    ["post", "/admin/images/1/primary"],
    ["get", "/admin/categories"],
    ["post", "/admin/categories"],
    ["patch", "/admin/categories/1"],
    ["delete", "/admin/categories/1"],
    ["get", "/admin/inventory"],
    ["get", "/admin/orders"],
    ["get", "/admin/orders/1"],
    ["post", "/admin/orders/1/status"],
    ["post", "/admin/orders/1/payment-status"],
    ["get", "/admin/users"],
    ["post", "/admin/users/1/block"],
    ["post", "/admin/users/1/unblock"],
    ["get", "/admin/settings"],
    ["put", "/admin/settings"],
  ];

  const call = (jar: Jar, method: string, p: string) => {
    const c = as(jar);
    if (method === "get") return c.get(p);
    if (method === "post") return c.post(p, {});
    if (method === "patch") return c.patch(p, {});
    if (method === "put") return c.put(p, {});
    return c.del(p);
  };

  it("guest → 401 authentication_required on every admin endpoint", async () => {
    const guest = await bootstrap();
    for (const [m, p] of surface) {
      const res = await call(guest, m, p);
      expect(res.status, `${m} ${p}`).toBe(401);
      expect(res.body.error.code).toBe("authentication_required");
    }
  });

  it("USER → 403 access_denied on every admin endpoint", async () => {
    const c = await newCustomer();
    for (const [m, p] of surface) {
      const res = await call(c.jar, m, p);
      expect(res.status, `${m} ${p}`).toBe(403);
      expect(res.body.error.code).toBe("access_denied");
    }
  });

  it("ADMIN → allowed (responses are private, no-store)", async () => {
    for (const p of ["/admin/dashboard", "/admin/products", "/admin/categories", "/admin/inventory", "/admin/orders", "/admin/users", "/admin/settings"]) {
      const res = await A.get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("role comes from the database, never the request", async () => {
    const c = await newCustomer();
    const res = await as(c.jar).get("/admin/dashboard?role=ADMIN").set("X-Role", "ADMIN");
    expect(res.status).toBe(403);
    // Registration ignores a client-sent role: the account is a USER and can't reach admin
    const guest = await bootstrap();
    const reg = await request(app)
      .post(base + "/auth/register")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({ name: "Sneaky", email: unique("sneaky"), password: PASSWORD, role: "ADMIN" });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe("USER");
    const sneaky = { ...guest, ...extractCookies(reg) };
    expect((await as(sneaky).get("/admin/dashboard")).status).toBe(403);
  });

  it("a demoted admin loses access on the very next request", async () => {
    const a = await newAdmin();
    expect((await as(a.jar).get("/admin/dashboard")).status).toBe(200);
    await prisma.user.update({ where: { id: a.id }, data: { role: "USER" } });
    expect((await as(a.jar).get("/admin/dashboard")).status).toBe(403);
  });

  it("admin mutations require the CSRF token", async () => {
    const res = await request(app)
      .post(base + "/admin/categories")
      .set("Cookie", cookieHeader(admin.jar))
      .send({ name: "No Token" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("csrf_failed");
  });
});

// =============================================================
// Dashboard
// =============================================================

describe("dashboard", () => {
  it("store day starts at India midnight", () => {
    expect(storeDayStart(new Date("2026-10-01T20:00:00Z")).toISOString()).toBe("2026-10-01T18:30:00.000Z");
    expect(storeDayStart(new Date("2026-10-01T10:00:00Z")).toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  it("reports real counts and money from the database", async () => {
    const before = (await A.get("/admin/dashboard")).body;
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 2 }]);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(placed.orderId) } });

    const after = (await A.get("/admin/dashboard")).body;
    expect(after.orders.total).toBe(before.orders.total + 1);
    expect(after.orders.today).toBe(before.orders.today + 1);
    expect(after.orders.byStatus.pending).toBe(before.orders.byStatus.pending + 1);
    expect(Number(after.revenue.awaitingPayment.amount)).toBeCloseTo(
      Number(before.revenue.awaitingPayment.amount) + Number(order.grandTotal),
      2,
    );
    expect(after.recentOrders[0].orderNumber).toBe(placed.orderNumber);
    expect(typeof after.revenue.paid.amount).toBe("string");

    // matches an independent SQL count
    const total = await prisma.order.count();
    expect(after.orders.total).toBe(total);
    const out = await prisma.product.count({ where: { status: { not: "archived" }, stockQuantity: 0 } });
    expect(after.inventory.outOfStockCount).toBe(out);
    expect(after.inventory.outOfStock.every((p: { stockQuantity: number }) => p.stockQuantity === 0)).toBe(true);
    expect(after.inventory.lowStock.every((p: { stockQuantity: number; effectiveThreshold: number }) => p.stockQuantity > 0 && p.stockQuantity <= p.effectiveThreshold)).toBe(true);
  });

  it("paid revenue counts only PAID, non-cancelled orders", async () => {
    const before = (await A.get("/admin/dashboard")).body;
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    const total = (await prisma.order.findUniqueOrThrow({ where: { id: BigInt(placed.orderId) } })).grandTotal;
    expect((await A.post(`/admin/orders/${placed.orderId}/payment-status`, { status: "PAID" })).status).toBe(200);
    const after = (await A.get("/admin/dashboard")).body;
    expect(Number(after.revenue.paid.amount)).toBeCloseTo(Number(before.revenue.paid.amount) + Number(total), 2);
  });
});

// =============================================================
// Products
// =============================================================

describe("product CRUD", () => {
  it("creates a product (inactive, slug derived, opening stock audited)", async () => {
    const body = productBody({ name: "Moonlit Kaftan", stock_quantity: 7, low_stock_threshold: 3, specifications: [{ key: "Material", value: "Silk" }] });
    const res = await A.post("/admin/products", body);
    expect(res.status).toBe(201);
    const p = res.body.product;
    expect(p).toMatchObject({ name: "Moonlit Kaftan", slug: "moonlit-kaftan", sku: body.sku, status: "inactive", stockQuantity: 7, lowStockThreshold: 3 });
    expect(p.price.amount).toBe("2499.00");
    expect(p.specifications).toEqual([{ key: "Material", value: "Silk" }]);
    const adj = await prisma.stockAdjustment.findMany({ where: { productId: BigInt(p.id) } });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ reason: "initial", delta: 7, resultingQuantity: 7, actorType: "ADMIN", actorId: admin.id });
    const audit = await prisma.adminAuditLog.findFirst({ where: { action: "product.create", targetId: p.id } });
    expect(audit?.actorId).toBe(admin.id);
  });

  it("derives a unique slug when the name repeats", async () => {
    const a = await A.post("/admin/products", productBody({ name: "Twin Scarf" }));
    const b = await A.post("/admin/products", productBody({ name: "Twin Scarf" }));
    expect(a.body.product.slug).toBe("twin-scarf");
    expect(b.body.product.slug).toBe("twin-scarf-2");
  });

  it("rejects a duplicate SKU (case-insensitive) with a field error", async () => {
    const res = await A.post("/admin/products", productBody({ sku: "hey-kur-00001" }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("sku_taken");
    expect(res.body.error.details[0].path).toEqual(["sku"]);
  });

  it("rejects invalid prices", async () => {
    for (const price of ["0", "0.00", "-5", "abc", "12.345", 100]) {
      const res = await A.post("/admin/products", productBody({ price }));
      expect(res.status, String(price)).toBe(400);
      expect(res.body.error.code).toBe("validation_failed");
    }
  });

  it("rejects invalid discounts", async () => {
    const cases = [
      { type: "percent", value: "100" },
      { type: "percent", value: "0" },
      { type: "fixed", value: "2499.00" },
      { type: "fixed", value: "3000.00" },
      { type: "bogus" },
    ];
    for (const discount of cases) {
      const res = await A.post("/admin/products", productBody({ discount }));
      expect(res.status, JSON.stringify(discount)).toBe(400);
    }
    const ok = await A.post("/admin/products", productBody({ discount: { type: "percent", value: "15" } }));
    expect(ok.status).toBe(201);
    expect(ok.body.product.finalPrice.amount).toBe("2124.15");
  });

  it("rejects unknown, inactive, or missing categories", async () => {
    const inactive = await prisma.category.findUniqueOrThrow({ where: { slug: "archive-preview" } });
    expect((await A.post("/admin/products", productBody({ category_id: "999999" }))).status).toBe(400);
    expect((await A.post("/admin/products", productBody({ category_id: inactive.id.toString() }))).status).toBe(400);
    expect((await A.post("/admin/products", productBody({ category_id: undefined }))).status).toBe(400);
  });

  it("rejects negative stock, client ids, and audit fields (no mass assignment)", async () => {
    expect((await A.post("/admin/products", productBody({ stock_quantity: -1 }))).status).toBe(400);
    expect((await A.post("/admin/products", productBody({ id: "5" }))).status).toBe(400);
    expect((await A.post("/admin/products", productBody({ created_at: "2020-01-01" }))).status).toBe(400);
    expect((await A.post("/admin/products", productBody({ status: "published" }))).status).toBe(400);
  });

  it("a product can't go active without an image", async () => {
    const res = await A.post("/admin/products", productBody({ status: "active" }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("image_required");
    const created = (await A.post("/admin/products", productBody())).body.product;
    const patch = await A.patch(`/admin/products/${created.id}`, { status: "active" });
    expect(patch.status).toBe(409);
  });

  it("updates fields; stock is not editable through PATCH", async () => {
    const p = (await A.post("/admin/products", productBody({ name: "Editable Wrap" }))).body.product;
    const res = await A.patch(`/admin/products/${p.id}`, {
      name: "Edited Wrap",
      price: "1999.50",
      discount: { type: "fixed", value: "500.00" },
      category_id: accessories.toString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.product).toMatchObject({ name: "Edited Wrap", slug: p.slug, category: { id: accessories.toString() } });
    expect(res.body.product.price.amount).toBe("1999.50");
    expect(res.body.product.finalPrice.amount).toBe("1499.50");

    expect((await A.patch(`/admin/products/${p.id}`, { stock_quantity: 999 })).status).toBe(400);
    // price lowered below an existing fixed discount → refused
    const low = await A.patch(`/admin/products/${p.id}`, { price: "400.00" });
    expect(low.status).toBe(400);
    expect(low.body.error.details[0].path).toEqual(["discount", "value"]);
  });

  it("unknown or malformed ids → 404", async () => {
    expect((await A.get("/admin/products/999999999")).status).toBe(404);
    expect((await A.get("/admin/products/abc")).status).toBe(404);
    expect((await A.patch("/admin/products/999999999", { name: "Nope" })).status).toBe(404);
  });

  it("lists with search and status filter", async () => {
    const res = await A.get("/admin/products?q=hey-kur&page_size=48");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(3);
    expect(res.body.items.every((p: { sku: string }) => p.sku.startsWith("HEY-KUR"))).toBe(true);
    const archived = await A.get("/admin/products?status=archived");
    expect(archived.body.items.every((p: { status: string }) => p.status === "archived")).toBe(true);
  });
});

describe("product deletion policy", () => {
  it("hard-deletes a product that was never ordered or stocked", async () => {
    const p = (await A.post("/admin/products", productBody({ name: "Disposable Draft" }))).body.product;
    const res = await A.del(`/admin/products/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("deleted");
    expect(await prisma.product.findUnique({ where: { id: BigInt(p.id) } })).toBeNull();
  });

  it("archives an ordered product; the order snapshot stays intact", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    const tie = await product("cotton-hair-tie");
    const res = await A.del(`/admin/products/${tie.id}`);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("archived");
    expect((await product("cotton-hair-tie")).status).toBe("archived");
    // storefront hides it; the customer's order still renders fully
    expect((await request(app).get(base + "/products/cotton-hair-tie")).status).toBe(404);
    const detail = await placed.client.get(`/orders/${placed.orderId}`);
    expect(detail.body.order.items[0].name).toBe("Cotton Hair Tie");
    // restore for later tests
    await prisma.product.update({ where: { id: tie.id }, data: { status: "active" } });
  });

  it("archives a product that has inventory history", async () => {
    const p = (await A.post("/admin/products", productBody({ stock_quantity: 4 }))).body.product;
    const res = await A.del(`/admin/products/${p.id}`);
    expect(res.body.result).toBe("archived");
  });
});

// =============================================================
// Images
// =============================================================

describe("product images", () => {
  let pid: string;
  beforeAll(async () => {
    pid = (await A.post("/admin/products", productBody({ name: "Image Test Tunic" }))).body.product.id;
  });

  it("accepts a JPEG, re-encodes to WebP, strips metadata, generates the filename", async () => {
    const withExif = await sharp({ create: { width: 640, height: 800, channels: 3, background: "#146a70" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: "Secret Photographer", Copyright: "GPS 12.97,77.59" } } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const res = await A.upload(`/admin/products/${pid}/images`, withExif, "../../evil name.php.jpg", "image/jpeg");
    expect(res.status).toBe(201);
    const img = res.body.product.images[0];
    expect(img.src).toMatch(/^\/assets\/products\/\d+\/[0-9a-f-]{36}\.webp$/);
    expect(img.src).not.toContain("evil");
    expect(img.isPrimary).toBe(true);

    const stored = readFileSync(path.join(UPLOAD_ROOT, img.src.replace("/assets/", "")));
    expect(sniffImageType(stored)).toBe("webp");
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("webp");
    expect(stored.includes(Buffer.from("Secret Photographer"))).toBe(false);

    // served by the API with hardened headers
    const served = await request(app).get(img.src);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/webp");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("accepts PNG and appends to the gallery", async () => {
    const res = await A.upload(`/admin/products/${pid}/images`, await png(), "second.png", "image/png");
    expect(res.status).toBe(201);
    expect(res.body.product.images.map((i: { position: number }) => i.position)).toEqual([0, 1]);
  });

  it("rejects a disguised non-image (bad magic bytes, image extension and MIME)", async () => {
    const script = Buffer.from("<?php system($_GET['c']); ?>\n<script>alert(1)</script>");
    const res = await A.upload(`/admin/products/${pid}/images`, script, "photo.jpg", "image/jpeg");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_image");
  });

  it("rejects an unsupported real type (GIF, SVG) regardless of extension", async () => {
    const gif = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");
    expect((await A.upload(`/admin/products/${pid}/images`, gif, "x.png", "image/png")).status).toBe(415);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    expect((await A.upload(`/admin/products/${pid}/images`, svg, "x.webp", "image/webp")).status).toBe(415);
  });

  it("rejects a valid JPEG header with a corrupt body", async () => {
    const good = await jpeg();
    const broken = Buffer.concat([good.subarray(0, 40), Buffer.alloc(200, 0x41)]);
    expect((await A.upload(`/admin/products/${pid}/images`, broken, "x.jpg")).status).toBe(415);
  });

  it("strips a payload appended after a real image (polyglot)", async () => {
    const polyglot = Buffer.concat([await jpeg(), Buffer.from("<script>alert('x')</script>")]);
    const res = await A.upload(`/admin/products/${pid}/images`, polyglot, "poly.jpg");
    expect(res.status).toBe(201);
    const img = res.body.product.images.at(-1);
    const stored = readFileSync(path.join(UPLOAD_ROOT, img.src.replace("/assets/", "")));
    expect(stored.includes(Buffer.from("<script>"))).toBe(false);
  });

  it("rejects oversized files and too-small images", async () => {
    const big = Buffer.concat([await jpeg(), Buffer.alloc(5_100_000, 0)]);
    const res = await A.upload(`/admin/products/${pid}/images`, big, "big.jpg");
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("file_too_large");
    const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#fff" } }).png().toBuffer();
    expect((await A.upload(`/admin/products/${pid}/images`, tiny, "tiny.png")).status).toBe(422);
  });

  it("rejects an upload with no file", async () => {
    const res = await A.post(`/admin/products/${pid}/images`, {});
    expect(res.status).toBe(400);
  });

  it("makes another image primary and removes images, re-packing positions", async () => {
    const before = (await A.get(`/admin/products/${pid}`)).body.product.images;
    const second = before[1];
    const prim = await A.post(`/admin/images/${second.id}/primary`);
    expect(prim.status).toBe(200);
    expect(prim.body.product.images[0].id).toBe(second.id);

    const firstFile = path.join(UPLOAD_ROOT, before[0].src.replace("/assets/", ""));
    expect(existsSync(firstFile)).toBe(true);
    const del = await A.del(`/admin/images/${before[0].id}`);
    expect(del.status).toBe(200);
    expect(del.body.product.images.map((i: { position: number }) => i.position)).toEqual(
      del.body.product.images.map((_: unknown, n: number) => n),
    );
    expect(existsSync(firstFile)).toBe(false);
  });

  it("an active product keeps at least one image", async () => {
    let p = (await A.get(`/admin/products/${pid}`)).body.product;
    // trim to one image
    for (const img of p.images.slice(1)) await A.del(`/admin/images/${img.id}`);
    expect((await A.patch(`/admin/products/${pid}`, { status: "active" })).status).toBe(200);
    p = (await A.get(`/admin/products/${pid}`)).body.product;
    expect(p.images).toHaveLength(1);
    const res = await A.del(`/admin/images/${p.images[0].id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("last_image");
    // inactive products may drop to zero
    await A.patch(`/admin/products/${pid}`, { status: "inactive" });
    expect((await A.del(`/admin/images/${p.images[0].id}`)).status).toBe(200);
  });

  it("customers can't upload", async () => {
    const c = await newCustomer();
    expect((await as(c.jar).upload(`/admin/products/${pid}/images`, await jpeg(), "a.jpg")).status).toBe(403);
  });
});

// =============================================================
// Categories
// =============================================================

describe("categories", () => {
  it("creates, updates, and validates slugs", async () => {
    const res = await A.post("/admin/categories", { name: "Resort Wear", sort_order: 7 });
    expect(res.status).toBe(201);
    const c = res.body.items.find((x: { slug: string }) => x.slug === "resort-wear");
    expect(c).toMatchObject({ name: "Resort Wear", isActive: true, sortOrder: 7, productCount: 0 });

    const dup = await A.post("/admin/categories", { name: "Another", slug: "resort-wear" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("slug_taken");
    expect((await A.post("/admin/categories", { name: "Bad", slug: "Bad Slug!" })).status).toBe(400);
    expect((await A.post("/admin/categories", { name: "X" })).status).toBe(400);

    const up = await A.patch(`/admin/categories/${c.id}`, { name: "Resort", is_active: false });
    expect(up.status).toBe(200);
    expect(up.body.items.find((x: { id: string }) => x.id === c.id)).toMatchObject({ name: "Resort", isActive: false });
    // inactive categories disappear from the storefront nav
    const nav = (await request(app).get(base + "/categories")).body.items;
    expect(nav.some((x: { slug: string }) => x.slug === "resort-wear")).toBe(false);
    expect((await A.patch(`/admin/categories/${c.id}`, { slug: "dresses" })).status).toBe(409);
  });

  it("blocks deletion while products are assigned; reassigns then deletes", async () => {
    const cat = (await A.post("/admin/categories", { name: "Temporary Edit" })).body.items.find(
      (x: { slug: string }) => x.slug === "temporary-edit",
    );
    const p = (await A.post("/admin/products", productBody({ category_id: cat.id }))).body.product;

    const blocked = await A.del(`/admin/categories/${cat.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("category_in_use");
    expect(blocked.body.error.details.product_count).toBe(1);

    expect((await A.del(`/admin/categories/${cat.id}?reassign_to=${cat.id}`)).status).toBe(400);
    const res = await A.del(`/admin/categories/${cat.id}?reassign_to=${accessories}`);
    expect(res.status).toBe(200);
    expect(await prisma.category.findUnique({ where: { id: BigInt(cat.id) } })).toBeNull();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: BigInt(p.id) } })).categoryId).toBe(accessories);
    expect(await prisma.adminAuditLog.count({ where: { action: "category.reassign", targetId: cat.id } })).toBe(1);
  });

  it("deletes an empty category", async () => {
    const cat = (await A.post("/admin/categories", { name: "Empty Shelf" })).body.items.find((x: { slug: string }) => x.slug === "empty-shelf");
    expect((await A.del(`/admin/categories/${cat.id}`)).status).toBe(200);
  });
});

// =============================================================
// Inventory + stock adjustments
// =============================================================

describe("inventory", () => {
  it("lists all / low / out using the effective threshold", async () => {
    const all = (await A.get("/admin/inventory?page_size=48")).body;
    expect(all.counts.all).toBe(await prisma.product.count({ where: { status: { not: "archived" } } }));
    const out = (await A.get("/admin/inventory?filter=out&page_size=48")).body;
    expect(out.items.length).toBe(out.counts.out);
    expect(out.items.every((i: { stockQuantity: number; stockState: string }) => i.stockQuantity === 0 && i.stockState === "out_of_stock")).toBe(true);
    const low = (await A.get("/admin/inventory?filter=low&page_size=48")).body;
    expect(low.items.length).toBe(low.counts.low);
    expect(low.items.every((i: { stockQuantity: number; effectiveThreshold: number }) => i.stockQuantity > 0 && i.stockQuantity <= i.effectiveThreshold)).toBe(true);
    expect((await A.get("/admin/inventory?filter=weird")).status).toBe(400);
  });

  it("a per-product threshold overrides the store default", async () => {
    const p = (await A.post("/admin/products", productBody({ stock_quantity: 20, low_stock_threshold: 25 }))).body.product;
    const low = (await A.get(`/admin/inventory?filter=low&q=${p.sku}`)).body;
    expect(low.items.map((i: { id: string }) => i.id)).toEqual([p.id]);
  });
});

describe("stock adjustments", () => {
  let pid: string;
  beforeAll(async () => {
    pid = (await A.post("/admin/products", productBody({ stock_quantity: 10 }))).body.product.id;
  });

  it("restock, damaged, correction, admin_set — each audited with actor and result", async () => {
    let r = await A.post(`/admin/products/${pid}/stock-adjustments`, { reason: "restock", delta: 5 });
    expect(r.status).toBe(201);
    expect(r.body.stockQuantity).toBe(15);
    r = await A.post(`/admin/products/${pid}/stock-adjustments`, { reason: "damaged", delta: -3 });
    expect(r.body.stockQuantity).toBe(12);
    r = await A.post(`/admin/products/${pid}/stock-adjustments`, { reason: "correction", delta: -2 });
    expect(r.body.stockQuantity).toBe(10);
    r = await A.post(`/admin/products/${pid}/stock-adjustments`, { reason: "admin_set", quantity: 4 });
    expect(r.body).toMatchObject({ stockQuantity: 4, adjustment: { delta: -6, reason: "admin_set", resultingQuantity: 4 } });

    const rows = await prisma.stockAdjustment.findMany({ where: { productId: BigInt(pid) }, orderBy: { id: "asc" } });
    expect(rows.map((a) => [a.reason, a.delta, a.resultingQuantity])).toEqual([
      ["initial", 10, 10],
      ["restock", 5, 15],
      ["damaged", -3, 12],
      ["correction", -2, 10],
      ["admin_set", -6, 4],
    ]);
    expect(rows.slice(1).every((a) => a.actorType === "ADMIN" && a.actorId === admin.id)).toBe(true);
  });

  it("refuses an adjustment that would go below zero (nothing written)", async () => {
    const before = await prisma.stockAdjustment.count({ where: { productId: BigInt(pid) } });
    const r = await A.post(`/admin/products/${pid}/stock-adjustments`, { reason: "damaged", delta: -5 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("negative_stock");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: BigInt(pid) } })).stockQuantity).toBe(4);
    expect(await prisma.stockAdjustment.count({ where: { productId: BigInt(pid) } })).toBe(before);
  });

  it("validates reason/sign and rejects sale/cancel_restore from clients", async () => {
    const bad = [
      { reason: "restock", delta: -1 },
      { reason: "damaged", delta: 2 },
      { reason: "correction", delta: 0 },
      { reason: "admin_set", quantity: -1 },
      { reason: "sale", delta: -1 },
      { reason: "cancel_restore", delta: 1 },
      { reason: "restock", delta: 1.5 },
      { reason: "restock", delta: 1, actor_id: "1" },
    ];
    for (const body of bad) {
      expect((await A.post(`/admin/products/${pid}/stock-adjustments`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await A.post(`/admin/products/${pid}/stock-adjustments`, { reason: "admin_set", quantity: 4 })).status).toBe(400);
    expect((await A.post(`/admin/products/999999999/stock-adjustments`, { reason: "restock", delta: 1 })).status).toBe(404);
  });

  it("concurrent negative adjustments never oversell the count", async () => {
    // stock is 4; five parallel −1 adjustments → exactly four succeed
    const results = await Promise.all(
      Array.from({ length: 5 }, () => A.post(`/admin/products/${pid}/stock-adjustments`, { reason: "damaged", delta: -1 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: BigInt(pid) } })).stockQuantity).toBe(0);
    const results2 = await Promise.all(
      Array.from({ length: 3 }, () => A.post(`/admin/products/${pid}/stock-adjustments`, { reason: "restock", delta: 2 })),
    );
    expect(results2.every((r) => r.status === 201)).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: BigInt(pid) } })).stockQuantity).toBe(6);
  });
});

// =============================================================
// Orders
// =============================================================

describe("admin orders", () => {
  it("lists newest first, searches by number and customer, filters by status", async () => {
    const a = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    const b = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    const list = (await A.get("/admin/orders")).body;
    expect(list.items[0].orderNumber).toBe(b.orderNumber);
    expect(list.items[1].orderNumber).toBe(a.orderNumber);
    expect(list.page_size).toBe(24);

    const byNumber = (await A.get(`/admin/orders?q=${a.orderNumber}`)).body;
    expect(byNumber.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([a.orderNumber]);
    const byEmail = (await A.get(`/admin/orders?q=${encodeURIComponent(b.customer.email)}`)).body;
    expect(byEmail.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([b.orderNumber]);

    await A.post(`/admin/orders/${a.orderId}/status`, { status: "confirmed" });
    const confirmed = (await A.get("/admin/orders?status=confirmed&page_size=48")).body;
    expect(confirmed.items.some((o: { id: string }) => o.id === a.orderId)).toBe(true);
    expect(confirmed.items.every((o: { status: string }) => o.status === "confirmed")).toBe(true);
    expect((await A.get("/admin/orders?status=lost")).status).toBe(400);
    expect((await A.get("/admin/orders?q=' OR 1=1 --")).body.items).toEqual([]);
  });

  it("detail shows snapshots, totals, shipping, and history; no password data", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 3 }]);
    const res = await A.get(`/admin/orders/${placed.orderId}`);
    expect(res.status).toBe(200);
    const o = res.body.order;
    expect(o.items[0]).toMatchObject({ name: "Cotton Hair Tie", quantity: 3 });
    expect(o.shipping.city).toBe("Kochi");
    expect(o.customer.email).toBe(placed.customer.email);
    expect(o.timeline[0]).toMatchObject({ kind: "status", from: null, to: "pending" });
    expect(o.actions).toEqual({ nextStatuses: ["confirmed", "cancelled"], canConfirmPayment: true });
    expect(JSON.stringify(res.body)).not.toMatch(/password|passwordHash/i);
  });

  it("snapshots stay immutable after the product is repriced and renamed", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    const before = (await A.get(`/admin/orders/${placed.orderId}`)).body.order;
    const tie = await product("cotton-hair-tie");
    await A.patch(`/admin/products/${tie.id}`, { name: "Renamed Tie", price: "999.00" });
    const after = (await A.get(`/admin/orders/${placed.orderId}`)).body.order;
    expect(after.items).toEqual(before.items);
    expect(after.grandTotal).toEqual(before.grandTotal);
    await A.patch(`/admin/products/${tie.id}`, { name: tie.name, price: tie.price.toFixed(2) });
    // there is no endpoint to edit an order's money or items
    expect((await A.patch(`/admin/orders/${placed.orderId}`, { grand_total: "1.00" })).status).toBe(404);
  });

  it("walks the ladder and rejects illegal transitions", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    const id = placed.orderId;
    const step = (status: string) => A.post(`/admin/orders/${id}/status`, { status });

    expect((await step("shipped")).body.error.code).toBe("illegal_transition"); // skip
    expect((await step("delivered")).status).toBe(409);
    expect((await step("confirmed")).status).toBe(200);
    expect((await step("confirmed")).status).toBe(409); // repeat
    expect((await A.post(`/admin/orders/${id}/status`, { status: "pending" })).status).toBe(400); // backwards (not an input)
    expect((await step("shipped")).status).toBe(200);
    expect((await step("cancelled")).status).toBe(409); // shipped can't cancel
    const done = await step("delivered");
    expect(done.status).toBe(200);
    expect(done.body.order.actions.nextStatuses).toEqual([]);
    expect((await step("cancelled")).status).toBe(409);

    const hist = await prisma.orderStatusHistory.findMany({ where: { orderId: BigInt(id) }, orderBy: { id: "asc" } });
    expect(hist.map((h) => `${h.fromStatus ?? "∅"}→${h.toStatus}`)).toEqual([
      "∅→pending",
      "pending→confirmed",
      "confirmed→shipped",
      "shipped→delivered",
    ]);
    expect(hist.slice(1).every((h) => h.actorType === "ADMIN" && h.actorId === admin.id)).toBe(true);
    expect((await A.post(`/admin/orders/999999999/status`, { status: "confirmed" })).status).toBe(404);
  });
});

describe("cancellation + stock restoration", () => {
  async function stockOf(slug: string) {
    return (await product(slug)).stockQuantity;
  }

  it("cancelling a pending order restores every unit exactly once, audited", async () => {
    const s0 = await stockOf("cashmere-scarf");
    const t0 = await stockOf("cotton-hair-tie");
    const placed = await placeOrder([
      { slug: "cashmere-scarf", qty: 2 },
      { slug: "cotton-hair-tie", qty: 3 },
    ]);
    expect(await stockOf("cashmere-scarf")).toBe(s0 - 2);
    expect(await stockOf("cotton-hair-tie")).toBe(t0 - 3);

    const res = await A.post(`/admin/orders/${placed.orderId}/status`, { status: "cancelled", note: "Customer called" });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("cancelled");
    expect(res.body.order.actions.nextStatuses).toEqual([]);
    expect(await stockOf("cashmere-scarf")).toBe(s0);
    expect(await stockOf("cotton-hair-tie")).toBe(t0);

    const restores = await prisma.stockAdjustment.findMany({
      where: { reason: "cancel_restore", actorId: admin.id, productId: { in: [(await product("cashmere-scarf")).id, (await product("cotton-hair-tie")).id] } },
      orderBy: { id: "desc" },
      take: 2,
    });
    expect(restores.map((r) => r.delta).sort()).toEqual([2, 3]);
    expect(restores.every((r) => r.actorType === "ADMIN")).toBe(true);

    // repeating the cancel is refused and restores nothing
    const again = await A.post(`/admin/orders/${placed.orderId}/status`, { status: "cancelled" });
    expect(again.status).toBe(409);
    expect(await stockOf("cashmere-scarf")).toBe(s0);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(placed.orderId) } });
    expect(row.cancelledAt).not.toBeNull();
    const hist = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: row.id, toStatus: "cancelled" } });
    expect(hist.note).toBe("Customer called · 5 units returned to stock");
    expect(hist).toMatchObject({ actorType: "ADMIN", actorId: admin.id, fromStatus: "pending" });
  });

  it("cancelling a confirmed order restores stock", async () => {
    const s0 = await stockOf("cashmere-scarf");
    const placed = await placeOrder([{ slug: "cashmere-scarf", qty: 1 }]);
    await A.post(`/admin/orders/${placed.orderId}/status`, { status: "confirmed" });
    expect((await A.post(`/admin/orders/${placed.orderId}/status`, { status: "cancelled" })).status).toBe(200);
    expect(await stockOf("cashmere-scarf")).toBe(s0);
  });

  it("shipped and delivered orders can't be cancelled; stock untouched", async () => {
    const placed = await placeOrder([{ slug: "cashmere-scarf", qty: 1 }]);
    const after = await stockOf("cashmere-scarf");
    const scarfId = (await product("cashmere-scarf")).id;
    const restoresBefore = await prisma.stockAdjustment.count({ where: { reason: "cancel_restore", productId: scarfId } });
    for (const s of ["confirmed", "shipped"]) await A.post(`/admin/orders/${placed.orderId}/status`, { status: s });
    expect((await A.post(`/admin/orders/${placed.orderId}/status`, { status: "cancelled" })).status).toBe(409);
    await A.post(`/admin/orders/${placed.orderId}/status`, { status: "delivered" });
    expect((await A.post(`/admin/orders/${placed.orderId}/status`, { status: "cancelled" })).status).toBe(409);
    expect(await stockOf("cashmere-scarf")).toBe(after);
    expect(await prisma.stockAdjustment.count({ where: { reason: "cancel_restore", productId: scarfId } })).toBe(restoresBefore);
  });

  it("parallel cancels restore stock exactly once", async () => {
    const s0 = await stockOf("cashmere-scarf");
    const placed = await placeOrder([{ slug: "cashmere-scarf", qty: 2 }]);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => A.post(`/admin/orders/${placed.orderId}/status`, { status: "cancelled" })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stockOf("cashmere-scarf")).toBe(s0);
    const cancelRows = await prisma.orderStatusHistory.count({ where: { orderId: BigInt(placed.orderId), toStatus: "cancelled" } });
    expect(cancelRows).toBe(1);
  });

  it("a restored unit is purchasable again", async () => {
    const tie = await product("cotton-hair-tie");
    await prisma.product.update({ where: { id: tie.id }, data: { stockQuantity: 1 } });
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    expect(await stockOf("cotton-hair-tie")).toBe(0);
    await A.post(`/admin/orders/${placed.orderId}/status`, { status: "cancelled" });
    expect(await stockOf("cotton-hair-tie")).toBe(1);
    await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    expect(await stockOf("cotton-hair-tie")).toBe(0);
    await prisma.product.update({ where: { id: tie.id }, data: { stockQuantity: tie.stockQuantity } });
  });
});

describe("manual payment confirmation", () => {
  it("PENDING_PAYMENT → PAID, audited as ADMIN (works in manual mode)", async () => {
    const m = await newAdmin(manualApp);
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }], manualApp);
    const res = await as(m.jar, manualApp).post(`/admin/orders/${placed.orderId}/payment-status`, { status: "PAID", note: "UPI ref 4411" });
    expect(res.status).toBe(200);
    expect(res.body.order.paymentStatus).toBe("PAID");
    expect(res.body.order.actions.canConfirmPayment).toBe(false);
    const hist = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: BigInt(placed.orderId), toStatus: "PAID" } });
    expect(hist).toMatchObject({ fromStatus: "PENDING_PAYMENT", actorType: "ADMIN", actorId: m.id });
    expect(hist.note).toContain("UPI ref 4411");
    // customer sees it
    expect((await placed.client.get(`/orders/${placed.orderId}`)).body.order.paymentStatus).toBe("PAID");
  });

  it("accepts only PAID", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    for (const status of ["PENDING_PAYMENT", "REFUNDED", "paid", ""]) {
      expect((await A.post(`/admin/orders/${placed.orderId}/payment-status`, { status })).status, status).toBe(400);
    }
    expect((await A.post(`/admin/orders/${placed.orderId}/payment-status`, { status: "PAID", amount: "1.00" })).status).toBe(400);
  });

  it("an already-paid order is refused without a second audit row", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    expect((await A.post(`/admin/orders/${placed.orderId}/payment-status`, { status: "PAID" })).status).toBe(200);
    const again = await A.post(`/admin/orders/${placed.orderId}/payment-status`, { status: "PAID" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_paid");
    expect(await prisma.orderStatusHistory.count({ where: { orderId: BigInt(placed.orderId), toStatus: "PAID" } })).toBe(1);
  });

  it("parallel confirmations write exactly one PAID row", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    const res = await Promise.all(Array.from({ length: 4 }, () => A.post(`/admin/orders/${placed.orderId}/payment-status`, { status: "PAID" })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: BigInt(placed.orderId), toStatus: "PAID" } })).toBe(1);
  });

  it("a cancelled order can't be paid", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    await A.post(`/admin/orders/${placed.orderId}/status`, { status: "cancelled" });
    const res = await A.post(`/admin/orders/${placed.orderId}/payment-status`, { status: "PAID" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_payable");
  });

  it("demo payment still works alongside the admin path", async () => {
    const placed = await placeOrder([{ slug: "cotton-hair-tie", qty: 1 }]);
    const res = await placed.client.post(`/orders/${placed.orderId}/demo-payment/confirm`, { method: "demo_upi" });
    expect(res.status).toBe(200);
    expect(res.body.order.paymentStatus).toBe("PAID");
    expect((await A.post(`/admin/orders/${placed.orderId}/payment-status`, { status: "PAID" })).body.error.code).toBe("already_paid");
  });
});

// =============================================================
// Users
// =============================================================

describe("user management", () => {
  it("lists users without password hashes or secrets", async () => {
    const c = await newCustomer();
    const res = await A.get(`/admin/users?q=${encodeURIComponent(c.email)}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ email: c.email, status: "active", orderCount: 0, role: "USER" });
    const raw = JSON.stringify((await A.get("/admin/users?page_size=48")).body);
    expect(raw).not.toMatch(/password|hash|\$2[aby]\$/i);
  });

  it("block requires a reason, revokes sessions, and stops access; unblock restores", async () => {
    const c = await newCustomer();
    const client = as(c.jar);
    expect((await client.get("/wishlist")).status).toBe(200);

    expect((await A.post(`/admin/users/${c.id}/block`, {})).status).toBe(400);
    expect((await A.post(`/admin/users/${c.id}/block`, { reason: "  " })).status).toBe(400);
    expect((await A.post(`/admin/users/${c.id}/block`, { reason: "ok", is_admin: true })).status).toBe(400);

    const res = await A.post(`/admin/users/${c.id}/block`, { reason: "Chargeback fraud" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ status: "blocked", blockedReason: "Chargeback fraud" });
    expect(await prisma.session.count({ where: { userId: c.id } })).toBe(0);

    expect((await client.get("/wishlist")).status).toBe(401);
    const guest = await bootstrap();
    const relogin = await request(app)
      .post(base + "/auth/login")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({ email: c.email, password: PASSWORD });
    expect(relogin.status).toBe(403);
    expect(relogin.body.error.code).toBe("account_blocked");
    expect((await A.post(`/admin/users/${c.id}/block`, { reason: "again" })).status).toBe(409);

    const un = await A.post(`/admin/users/${c.id}/unblock`);
    expect(un.status).toBe(200);
    expect(un.body.user).toMatchObject({ status: "active", blockedReason: null });
    expect((await as(await login(c.email)).get("/wishlist")).status).toBe(200);
    expect((await A.post(`/admin/users/${c.id}/unblock`)).status).toBe(409);

    const audit = await prisma.adminAuditLog.findMany({ where: { targetType: "user", targetId: c.id.toString() }, orderBy: { id: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["user.block", "user.unblock"]);
  });

  it("admins can't block themselves or other admins; no role changes exist", async () => {
    expect((await A.post(`/admin/users/${admin.id}/block`, { reason: "oops" })).body.error.code).toBe("cannot_block_self");
    const other = await newAdmin();
    expect((await A.post(`/admin/users/${other.id}/block`, { reason: "nope" })).body.error.code).toBe("cannot_block_admin");
    expect((await A.patch(`/admin/users/${other.id}`, { role: "USER" })).status).toBe(404);
    expect((await A.post(`/admin/users/999999999/block`, { reason: "ghost" })).status).toBe(404);
  });
});

// =============================================================
// Settings
// =============================================================

describe("settings", () => {
  const valid = {
    low_stock_threshold: 4,
    shipping_flat_rate: "149.00",
    shipping_free_threshold: "3999.00",
    default_sort: "price_asc",
    page_size: 8,
  };

  it("returns documented defaults with fixed brand + currency", async () => {
    await prisma.storeSettings.deleteMany();
    const res = await A.get("/admin/settings");
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      lowStockThreshold: 5,
      shippingFlatRate: { amount: "99.00" },
      shippingFreeThreshold: { amount: "2999.00" },
      defaultSort: "newest",
      pageSize: 12,
      isDefault: true,
    });
    expect(res.body.fixed).toEqual({ brand: { name: "HEYRAH", tagline: "Wings of Style" }, currency: "INR" });
  });

  it("validates every field and refuses brand/currency keys", async () => {
    const bad: Record<string, unknown>[] = [
      { ...valid, low_stock_threshold: -1 },
      { ...valid, low_stock_threshold: 2.5 },
      { ...valid, shipping_flat_rate: "-1" },
      { ...valid, shipping_flat_rate: 99 },
      { ...valid, default_sort: "random" },
      { ...valid, page_size: 100 },
      { ...valid, brand_name: "HYRA" },
      { ...valid, tagline: "Something else" },
      { ...valid, currency: "USD" },
      { low_stock_threshold: 4 },
    ];
    for (const body of bad) expect((await A.put("/admin/settings", body)).status, JSON.stringify(body)).toBe(400);
  });

  it("updates, audits, and drives low stock, shipping, sort, and page size", async () => {
    const res = await A.put("/admin/settings", valid);
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ lowStockThreshold: 4, shippingFlatRate: { amount: "149.00" }, defaultSort: "price_asc", pageSize: 8, isDefault: false });
    expect(await prisma.adminAuditLog.count({ where: { action: "settings.update", actorId: admin.id } })).toBeGreaterThan(0);

    // storefront default sort + page size
    const list = (await request(app).get(base + "/products")).body;
    expect(list.pageSize).toBe(8);
    expect(list.sort).toBe("price_asc");
    const prices = list.items.map((i: { finalPrice: { amount: string } }) => Number(i.finalPrice.amount));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect((await request(app).get(base + "/products?sort=newest&page_size=12")).body.pageSize).toBe(12);

    // checkout preview uses the configured shipping
    const c = await newCustomer();
    const client = as(c.jar);
    await client.post("/addresses", address);
    const tie = await product("cotton-hair-tie");
    await client.post("/cart/items", { product_id: tie.id.toString(), qty: 1 });
    const preview = (await client.post("/checkout/preview")).body;
    expect(preview.shipping).toEqual({ flatRate: { amount: "149.00" }, freeThreshold: { amount: "3999.00" } });
    expect(preview.shippingTotal.amount).toBe("149.00");

    // inventory threshold
    const inv = (await A.get("/admin/inventory?filter=low")).body;
    expect(inv.lowStockThreshold).toBe(4);

    await prisma.storeSettings.deleteMany();
  });
});
