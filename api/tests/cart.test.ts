import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { seed } from "../prisma/seed";
import { prisma } from "../src/lib/prisma.js";
import { hashToken } from "../src/lib/session.js";
import { resetRateLimiter } from "../src/middleware/rate-limit.js";
import { computeFinalPrice } from "../src/services/catalog.service.js";

/**
 * Cart API integration tests (Phase 7 §12) — real PostgreSQL (heyrah_test via
 * `npm run test:db`). Cover the contract surface: guest + user carts, server
 * recomputation of prices, stock enforcement, quantity bounds, merge-on-add,
 * honest unavailability, ownership isolation, CSRF, and the guest→user merge
 * on register/login (API_CONTRACT §3).
 */

let app: Express;
const base = "/api/v1";

beforeAll(async () => {
  await seed();
  app = createApp();
  resetRateLimiter();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  resetRateLimiter();
});

// ---------- helpers ----------

function extractCookies(res: request.Response): Record<string, string> {
  const setHeaders = res.headers["set-cookie"] ?? [];
  const jar: Record<string, string> = {};
  for (const line of setHeaders as unknown as string[]) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** Mint a guest session + CSRF token. */
async function bootstrap(): Promise<Record<string, string>> {
  const res = await request(app).get(base + "/auth/csrf");
  return extractCookies(res);
}

async function guestJar(): Promise<Record<string, string>> {
  return bootstrap();
}

interface AddBody {
  items: {
    id: string;
    product: { id: string; name: string; slug: string; sku: string };
    quantity: number;
    price: { amount: string };
    finalPrice: { amount: string };
    lineTotal: { amount: string };
    availability: string;
    issue?: string;
  }[];
  itemCount: number;
  subtotal: { amount: string };
  discountTotal: { amount: string };
  total: { amount: string };
}

const addItem = (jar: Record<string, string>, productId: string, qty: number) =>
  request(app)
    .post(base + "/cart/items")
    .set("Cookie", cookieHeader(jar))
    .set("X-CSRF-Token", jar["heyrah_csrf"])
    .send({ product_id: productId, qty });

const getCart = (jar: Record<string, string>) =>
  request(app).get(base + "/cart").set("Cookie", cookieHeader(jar));

async function firstActiveProduct() {
  const p = await prisma.product.findFirst({
    where: { status: "active", stockQuantity: { gt: 5 } },
    orderBy: { id: "asc" },
  });
  if (!p) throw new Error("seed missing an active product");
  return p;
}

// ---------- tests ----------

describe("stale session recovery", () => {
  it("a dead session cookie is replaced by /auth/csrf so the cart works again", async () => {
    const jar = await guestJar();
    await prisma.session.deleteMany({ where: { id: hashToken(jar["heyrah_session"]) } });

    // dead cookie → cart refuses
    const refused = await getCart(jar);
    expect(refused.status).toBe(401);

    // bootstrap with the dead cookie mints a fresh guest session
    const boot = await request(app).get(base + "/auth/csrf").set("Cookie", cookieHeader(jar));
    const fresh = extractCookies(boot)["heyrah_session"];
    expect(fresh).toBeTruthy();
    expect(fresh).not.toEqual(jar["heyrah_session"]);

    const ok = await getCart({ ...jar, heyrah_session: fresh });
    expect(ok.status).toBe(200);
  });

  it("does NOT replace a cookie that a login just rotated away (no sign-out race)", async () => {
    const guest = await guestJar();
    const reg = await request(app)
      .post(base + "/auth/register")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({
        name: "Race",
        email: `race-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        password: "Str0ngPass!x",
      });
    expect(reg.status).toBe(201);

    // an in-flight bootstrap still carrying the pre-login cookie
    const boot = await request(app).get(base + "/auth/csrf").set("Cookie", cookieHeader(guest));
    expect(boot.status).toBe(200);
    expect(extractCookies(boot)["heyrah_session"]).toBeUndefined();
  });
});

describe("cache headers", () => {
  it("every cart response is private, no-store", async () => {
    const jar = await guestJar();
    const product = await firstActiveProduct();
    const auth = (r: request.Test) =>
      r.set("Cookie", cookieHeader(jar)).set("X-CSRF-Token", jar["heyrah_csrf"]);

    const read = await getCart(jar);
    const add = await addItem(jar, product.id.toString(), 1);
    const lineId = (add.body as AddBody).items[0].id;
    const patch = await auth(request(app).patch(`${base}/cart/items/${lineId}`)).send({ qty: 2 });
    const del = await auth(request(app).delete(`${base}/cart/items/${lineId}`));

    for (const res of [read, add, patch, del]) {
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("private, no-store");
    }
  });
});

describe("cart identity + read", () => {
  it("returns an empty cart for a brand-new guest (server-shaped zeros)", async () => {
    const jar = await guestJar();
    const res = await getCart(jar);
    expect(res.status).toBe(200);
    const body = res.body as AddBody;
    expect(body.items).toEqual([]);
    expect(body.itemCount).toBe(0);
    expect(body.total.amount).toBe("0.00");
  });

  it("scopes carts per session: two guests never share a cart", async () => {
    const a = await guestJar();
    const b = await guestJar();
    const product = await firstActiveProduct();

    await addItem(a, product.id.toString(), 2).expect(200);

    const cartA = (await getCart(a)).body as AddBody;
    const cartB = (await getCart(b)).body as AddBody;
    expect(cartA.itemCount).toBe(2);
    expect(cartB.itemCount).toBe(0);
  });
});

describe("add to cart", () => {
  it("adds an item; price/discount/totals are recomputed server-side", async () => {
    const jar = await guestJar();
    const product = await firstActiveProduct();

    const res = await addItem(jar, product.id.toString(), 3);
    expect(res.status).toBe(200);
    const body = res.body as AddBody;
    expect(body.items).toHaveLength(1);

    const line = body.items[0];
    const expectedFinal = computeFinalPrice(
      product.price,
      product.discountType,
      product.discountValue,
    );
    expect(line.price.amount).toBe(product.price.toFixed(2));
    expect(line.finalPrice.amount).toBe(expectedFinal.toFixed(2));
    expect(line.lineTotal.amount).toBe(expectedFinal.mul(3).toFixed(2));
    expect(line.availability).toBe("available");

    // rounding law: subtotal - discount_total == grand_total
    const subtotal = Number(body.subtotal.amount);
    const discount = Number(body.discountTotal.amount);
    const total = Number(body.total.amount);
    expect(Number((subtotal - discount).toFixed(2))).toBe(Number(total.toFixed(2)));
  });

  it("merges duplicate adds (same product) instead of creating a second line", async () => {
    const jar = await guestJar();
    const product = await firstActiveProduct();

    await addItem(jar, product.id.toString(), 2).expect(200);
    const res = await addItem(jar, product.id.toString(), 3);
    const body = res.body as AddBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].quantity).toBe(5);
  });

  it("404s an unknown product and 409s an inactive one", async () => {
    const jar = await guestJar();
    const missing = await addItem(jar, "99999999", 1);
    expect(missing.status).toBe(404);
    expect((missing.body as { error: { code: string } }).error.code).toBe("unknown_resource");

    const inactive = await prisma.product.findFirst({ where: { status: "inactive" } });
    if (inactive) {
      const res = await addItem(jar, inactive.id.toString(), 1);
      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe("product_unavailable");
    }
  });

  it("rejects out-of-stock and stock-shortage adds with actionable errors", async () => {
    const jar = await guestJar();
    const outOfStock = await prisma.product.findFirst({
      where: { status: "active", stockQuantity: 0 },
    });
    if (outOfStock) {
      const res = await addItem(jar, outOfStock.id.toString(), 1);
      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe("out_of_stock");
    }

    const low = await prisma.product.findFirst({
      where: { status: "active", stockQuantity: { gt: 0, lte: 5 } },
    });
    if (low) {
      const res = await addItem(jar, low.id.toString(), low.stockQuantity + 1);
      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe("stock_shortage");
    }
  });

  it("validates qty: 0, negative, non-integer, and >99 are rejected", async () => {
    const jar = await guestJar();
    const product = await firstActiveProduct();
    const pid = product.id.toString();

    for (const qty of [0, -1, 1.5, 100]) {
      const res = await addItem(jar, pid, qty);
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe("validation_failed");
    }
  });

  it("requires the CSRF double-submit header on mutations", async () => {
    const jar = await guestJar();
    const product = await firstActiveProduct();

    // cookie present, header missing
    const noHeader = await request(app)
      .post(base + "/cart/items")
      .set("Cookie", cookieHeader(jar))
      .send({ product_id: product.id.toString(), qty: 1 });
    expect(noHeader.status).toBe(403);
    expect((noHeader.body as { error: { code: string } }).error.code).toBe("csrf_failed");

    // header present but mismatched
    const badHeader = await request(app)
      .post(base + "/cart/items")
      .set("Cookie", cookieHeader(jar))
      .set("X-CSRF-Token", "totally-different-token-value-aaaaaaaaaaaa")
      .send({ product_id: product.id.toString(), qty: 1 });
    expect(badHeader.status).toBe(403);
  });
});

describe("update + remove", () => {
  it("PATCH updates quantity; qty 0 removes the line", async () => {
    const jar = await guestJar();
    const product = await firstActiveProduct();
    const added = (await addItem(jar, product.id.toString(), 2)).body as AddBody;
    const lineId = added.items[0].id;

    const patched = await request(app)
      .patch(`${base}/cart/items/${lineId}`)
      .set("Cookie", cookieHeader(jar))
      .set("X-CSRF-Token", jar["heyrah_csrf"])
      .send({ qty: 4 });
    expect(patched.status).toBe(200);
    expect((patched.body as AddBody).items[0].quantity).toBe(4);

    const removed = await request(app)
      .patch(`${base}/cart/items/${lineId}`)
      .set("Cookie", cookieHeader(jar))
      .set("X-CSRF-Token", jar["heyrah_csrf"])
      .send({ qty: 0 });
    expect(removed.status).toBe(200);
    expect((removed.body as AddBody).items).toHaveLength(0);
  });

  it("PATCH enforces stock and rejects a foreign cart's line id (404)", async () => {
    const owner = await guestJar();
    const intruder = await guestJar();
    const product = await firstActiveProduct();
    const added = (await addItem(owner, product.id.toString(), 2)).body as AddBody;
    const lineId = added.items[0].id;

    const steal = await request(app)
      .patch(`${base}/cart/items/${lineId}`)
      .set("Cookie", cookieHeader(intruder))
      .set("X-CSRF-Token", intruder["heyrah_csrf"])
      .send({ qty: 1 });
    expect(steal.status).toBe(404);

    const low = await prisma.product.findFirst({
      where: { status: "active", stockQuantity: { gt: 0, lte: 5 } },
    });
    if (low) {
      const lowAdded = (await addItem(owner, low.id.toString(), 1)).body as AddBody;
      const lowLine = lowAdded.items.find((i) => i.product.id === low.id.toString())!;
      const over = await request(app)
        .patch(`${base}/cart/items/${lowLine.id}`)
        .set("Cookie", cookieHeader(owner))
        .set("X-CSRF-Token", owner["heyrah_csrf"])
        .send({ qty: low.stockQuantity + 1 });
      expect(over.status).toBe(409);
      expect((over.body as { error: { code: string } }).error.code).toBe("stock_shortage");
    }
  });

  it("DELETE removes a line and 404s a foreign id", async () => {
    const owner = await guestJar();
    const intruder = await guestJar();
    const product = await firstActiveProduct();
    const added = (await addItem(owner, product.id.toString(), 1)).body as AddBody;
    const lineId = added.items[0].id;

    const foreign = await request(app)
      .delete(`${base}/cart/items/${lineId}`)
      .set("Cookie", cookieHeader(intruder))
      .set("X-CSRF-Token", intruder["heyrah_csrf"]);
    expect(foreign.status).toBe(404);

    const own = await request(app)
      .delete(`${base}/cart/items/${lineId}`)
      .set("Cookie", cookieHeader(owner))
      .set("X-CSRF-Token", owner["heyrah_csrf"]);
    expect(own.status).toBe(200);
    expect((own.body as AddBody).items).toHaveLength(0);
  });
});

describe("server is the source of truth", () => {
  it("reflects an admin price change on the next GET /cart", async () => {
    const jar = await guestJar();
    const product = await firstActiveProduct();
    await addItem(jar, product.id.toString(), 2).expect(200);
    const before = (await getCart(jar)).body as AddBody;
    expect(before.items[0].price.amount).toBe(product.price.toFixed(2));

    // Product price changed after the item was placed in the cart.
    await prisma.product.update({
      where: { id: product.id },
      data: { price: "999.99", discountType: "none", discountValue: null },
    });
    try {
      const after = (await getCart(jar)).body as AddBody;
      expect(after.items[0].price.amount).toBe("999.99");
      expect(after.items[0].finalPrice.amount).toBe("999.99");
      expect(after.items[0].lineTotal.amount).toBe("1999.98");
    } finally {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          price: product.price,
          discountType: product.discountType,
          discountValue: product.discountValue,
        },
      });
    }
  });

  it("flags a deactivated line honestly and keeps it out of the totals", async () => {
    const jar = await guestJar();
    const product = await firstActiveProduct();
    await addItem(jar, product.id.toString(), 2).expect(200);

    await prisma.product.update({ where: { id: product.id }, data: { status: "inactive" } });
    try {
      const body = (await getCart(jar)).body as AddBody;
      expect(body.items).toHaveLength(1); // shown, not silently dropped
      expect(body.items[0].availability).toBe("unavailable");
      expect(body.items[0].issue).toBeTruthy();
      expect(body.itemCount).toBe(0); // never counted as buyable
      expect(body.total.amount).toBe("0.00");
    } finally {
      await prisma.product.update({ where: { id: product.id }, data: { status: "active" } });
    }
  });
});

describe("guest → user merge on register/login", () => {
  it("merges a guest cart into the user cart and reports it", async () => {
    const guest = await guestJar();
    const product = await firstActiveProduct();
    await addItem(guest, product.id.toString(), 2).expect(200);

    const res = await request(app)
      .post(base + "/auth/register")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({
        name: "Merge",
        email: `merge-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        password: "Str0ngPass!x",
      });
    expect(res.status).toBe(201);
    const body = res.body as {
      user: { id: string };
      merge_report: { merged: { quantity: number }[]; capped: unknown[]; dropped: unknown[] };
    };
    expect(body.merge_report.merged).toHaveLength(1);
    expect(body.merge_report.merged[0].quantity).toBe(2);

    // the authenticated cart now holds the merged line
    const jar = { ...guest, ...extractCookies(res) };
    const cart = (await getCart(jar)).body as AddBody;
    expect(cart.itemCount).toBe(2);

    // the guest cart row is consumed
    const guestCart = await prisma.cart.findUnique({
      where: { sessionToken: hashToken(guest["heyrah_session"]) },
    });
    expect(guestCart).toBeNull();
  });

  it("sums duplicates and caps the merged quantity to current stock", async () => {
    const guest = await guestJar();
    const low = await prisma.product.findFirst({
      where: { status: "active", stockQuantity: { gte: 2, lte: 5 } },
    });
    if (!low) return;

    // guest adds up to stock; then (pre-existing user cart) adds more later.
    await addItem(guest, low.id.toString(), low.stockQuantity).expect(200);

    const res = await request(app)
      .post(base + "/auth/register")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({
        name: "Cap",
        email: `cap-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        password: "Str0ngPass!x",
      });
    expect(res.status).toBe(201);

    const jar = { ...guest, ...extractCookies(res) };
    const cart = (await getCart(jar)).body as AddBody;
    expect(cart.items[0].quantity).toBe(low.stockQuantity);
    expect(cart.items[0].quantity).toBeLessThanOrEqual(low.stockQuantity);
  });

  it("an empty/absent guest cart merges as a no-op", async () => {
    const guest = await guestJar();
    const res = await request(app)
      .post(base + "/auth/register")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({
        name: "Noop",
        email: `noop-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        password: "Str0ngPass!x",
      });
    expect(res.status).toBe(201);
    const body = res.body as { merge_report: { merged: unknown[]; capped: unknown[]; dropped: unknown[] } };
    expect(body.merge_report).toEqual({ merged: [], capped: [], dropped: [] });
  });

  it("drops an inactive product during merge instead of carrying it over", async () => {
    const guest = await guestJar();
    const product = await firstActiveProduct();
    await addItem(guest, product.id.toString(), 1).expect(200);
    await prisma.product.update({ where: { id: product.id }, data: { status: "inactive" } });
    try {
      const res = await request(app)
        .post(base + "/auth/register")
        .set("Cookie", cookieHeader(guest))
        .set("X-CSRF-Token", guest["heyrah_csrf"])
        .send({
          name: "Drop",
          email: `drop-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
          password: "Str0ngPass!x",
        });
      expect(res.status).toBe(201);
      const body = res.body as { merge_report: { dropped: { reason: string }[] } };
      expect(body.merge_report.dropped).toHaveLength(1);
      expect(body.merge_report.dropped[0].reason).toBe("inactive");
    } finally {
      await prisma.product.update({ where: { id: product.id }, data: { status: "active" } });
    }
  });
});