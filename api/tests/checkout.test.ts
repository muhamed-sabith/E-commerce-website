import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { seed } from "../prisma/seed";
import { prisma } from "../src/lib/prisma.js";
import { resetRateLimiter } from "../src/middleware/rate-limit.js";
import {
  orderDatePart,
  shippingFor,
  totalsFor,
} from "../src/services/checkout.service.js";
import { canTransition, transitionOrderStatus } from "../src/services/order.service.js";
import {
  createPaymentService,
  DemoPaymentProvider,
  ManualPaymentProvider,
} from "../src/services/payment.service.js";

/**
 * Checkout, orders, inventory, and demo payment (Phase 9) against real
 * PostgreSQL (heyrah_test via `npm run test:db`). The concurrency test uses
 * genuinely parallel HTTP requests from two users on separate connections.
 */

let app: Express; // demo mode
let manualApp: Express; // manual mode — demo routes must not exist
const base = "/api/v1";

beforeAll(async () => {
  await seed();
  app = createApp({ payments: createPaymentService(new DemoPaymentProvider()) });
  manualApp = createApp({ payments: createPaymentService(new ManualPaymentProvider()) });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  resetRateLimiter();
});

// ---------- helpers ----------

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

async function newUser(target: Express = app): Promise<{ jar: Jar; id: bigint }> {
  const guest = await bootstrap(target);
  const res = await request(target)
    .post(base + "/auth/register")
    .set("Cookie", cookieHeader(guest))
    .set("X-CSRF-Token", guest["heyrah_csrf"])
    .send({
      name: "Buyer",
      email: `p9-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      password: "Str0ngPass!x",
    });
  expect(res.status).toBe(201);
  return { jar: { ...guest, ...extractCookies(res) }, id: BigInt(res.body.user.id) };
}

function as(jar: Jar, target: Express = app) {
  const auth = (r: request.Test) => r.set("Cookie", cookieHeader(jar)).set("X-CSRF-Token", jar["heyrah_csrf"]);
  return {
    get: (path: string) => request(target).get(base + path).set("Cookie", cookieHeader(jar)),
    post: (path: string, body?: object) => auth(request(target).post(base + path)).send(body ?? {}),
    patch: (path: string, body: object) => auth(request(target).patch(base + path)).send(body),
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

async function product(slug: string) {
  return prisma.product.findUniqueOrThrow({ where: { slug } });
}

/** A signed-in user with an address and the given bag. */
async function shopper(lines: { slug: string; qty: number }[], target: Express = app) {
  const u = await newUser(target);
  const client = as(u.jar, target);
  const addr = await client.post("/addresses", address);
  expect(addr.status).toBe(201);
  for (const l of lines) {
    const p = await product(l.slug);
    const r = await client.post("/cart/items", { product_id: p.id.toString(), qty: l.qty });
    expect(r.status).toBe(200);
  }
  return { ...u, client, addressId: addr.body.address.id as string };
}

async function setStock(slug: string, stockQuantity: number) {
  await prisma.product.update({ where: { slug }, data: { stockQuantity } });
}

// =============================================================
// Pure rules
// =============================================================

describe("money + numbering rules", () => {
  const rule = { flatRate: new Prisma.Decimal("99.00"), freeThreshold: new Prisma.Decimal("2999.00") };

  it("shipping is flat below the threshold, free at/above it, zero for nothing", () => {
    expect(shippingFor(new Prisma.Decimal("2998.99"), rule).toFixed(2)).toBe("99.00");
    expect(shippingFor(new Prisma.Decimal("2999.00"), rule).toFixed(2)).toBe("0.00");
    expect(shippingFor(new Prisma.Decimal("0"), rule).toFixed(2)).toBe("0.00");
  });

  it("totals are Σ rounded lines and always add up", () => {
    const t = totalsFor(
      [
        { unitPrice: new Prisma.Decimal("6100.00"), finalPrice: new Prisma.Decimal("5337.50"), quantity: 1 },
        { unitPrice: new Prisma.Decimal("250.00"), finalPrice: new Prisma.Decimal("250.00"), quantity: 2 },
      ],
      rule,
    );
    expect(t.subtotal.toFixed(2)).toBe("6600.00");
    expect(t.discountTotal.toFixed(2)).toBe("762.50");
    expect(t.shippingTotal.toFixed(2)).toBe("0.00");
    expect(t.grandTotal.toFixed(2)).toBe("5837.50");
    expect(t.subtotal.minus(t.discountTotal).plus(t.shippingTotal).equals(t.grandTotal)).toBe(true);
  });

  it("order dates use India time (UTC+05:30)", () => {
    expect(orderDatePart(new Date("2026-09-30T18:29:59Z"))).toBe("260930");
    expect(orderDatePart(new Date("2026-09-30T18:30:00Z"))).toBe("261001");
  });

  it("status ladder allows only documented moves", () => {
    expect(canTransition("pending", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "shipped")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("confirmed", "cancelled")).toBe(true);
    expect(canTransition("shipped", "cancelled")).toBe(false);
    expect(canTransition("shipped", "pending")).toBe(false);
    expect(canTransition("pending", "shipped")).toBe(false);
    expect(canTransition("delivered", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "pending")).toBe(false);
  });
});

// =============================================================
// Authentication
// =============================================================

describe("checkout requires an authenticated USER", () => {
  it("guests get 401 on every checkout and order endpoint", async () => {
    const g = as(await bootstrap());
    for (const res of [
      await g.post("/checkout/preview"),
      await g.post("/checkout", { address_id: "1" }),
      await g.get("/orders"),
      await g.get("/orders/1"),
      await g.post("/orders/1/demo-payment/confirm"),
      await g.post("/orders/1/demo-payment/fail"),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("authentication_required");
    }
  });

  it("requires the CSRF header on checkout mutations", async () => {
    const s = await shopper([{ slug: "cashmere-scarf", qty: 1 }]);
    const res = await request(app)
      .post(base + "/checkout")
      .set("Cookie", cookieHeader(s.jar))
      .send({ address_id: s.addressId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("csrf_failed");
  });
});

// =============================================================
// Preview
// =============================================================

describe("POST /checkout/preview", () => {
  it("returns authoritative totals, shipping, and the default address", async () => {
    const s = await shopper([
      { slug: "silk-slip-dress", qty: 1 }, // 5400 → 4590
      { slug: "linen-wrap-dress", qty: 2 }, // 250
    ]);
    const res = await s.client.post("/checkout/preview");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    const p = res.body;
    expect(p.lines).toHaveLength(2);
    expect(p.subtotal.amount).toBe("5900.00");
    expect(p.discountTotal.amount).toBe("810.00");
    expect(p.shippingTotal.amount).toBe("0.00"); // 5090 ≥ 2999
    expect(p.grandTotal.amount).toBe("5090.00");
    expect(p.itemCount).toBe(3);
    expect(p.address.id).toBe(s.addressId);
    expect(p.address.isDefault).toBe(true);
    expect(p.canPlaceOrder).toBe(true);
  });

  it("charges flat shipping below the free threshold", async () => {
    const s = await shopper([{ slug: "linen-wrap-dress", qty: 1 }]);
    const p = (await s.client.post("/checkout/preview")).body;
    expect(p.shippingTotal.amount).toBe("99.00");
    expect(p.grandTotal.amount).toBe("349.00");
  });

  it("rejects an empty bag", async () => {
    const { jar } = await newUser();
    const res = await as(jar).post("/checkout/preview");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("cart_empty");
  });

  it("validates the selected address: foreign → 404, garbage → 400, none → cannot place", async () => {
    const other = await shopper([]);
    const s = await shopper([{ slug: "cashmere-scarf", qty: 1 }]);
    expect((await s.client.post("/checkout/preview", { address_id: other.addressId })).status).toBe(404);
    expect((await s.client.post("/checkout/preview", { address_id: "abc" })).status).toBe(400);
    expect((await s.client.post("/checkout/preview", { address_id: s.addressId, total: "1.00" })).status).toBe(400);

    const bare = await newUser();
    const client = as(bare.jar);
    const scarf = await product("cashmere-scarf");
    await client.post("/cart/items", { product_id: scarf.id.toString(), qty: 1 });
    const p = (await client.post("/checkout/preview")).body;
    expect(p.address).toBeNull();
    expect(p.canPlaceOrder).toBe(false);
  });

  it("flags unavailable and short-stock lines and excludes them from totals", async () => {
    const s = await shopper([
      { slug: "woven-leather-belt", qty: 2 },
      { slug: "ribbed-ankle-socks", qty: 1 },
    ]);
    const belt = await product("woven-leather-belt");
    await setStock("woven-leather-belt", 1);
    await prisma.product.update({ where: { slug: "ribbed-ankle-socks" }, data: { status: "inactive" } });
    try {
      const p = (await s.client.post("/checkout/preview")).body;
      expect(p.canPlaceOrder).toBe(false);
      const reasons = p.problems.map((x: { reason: string }) => x.reason).sort();
      expect(reasons).toEqual(["insufficient_stock", "unavailable"]);
      expect(p.grandTotal.amount).toBe("0.00");
    } finally {
      await setStock("woven-leather-belt", belt.stockQuantity);
      await prisma.product.update({ where: { slug: "ribbed-ankle-socks" }, data: { status: "active" } });
    }
  });

  it("reflects a price change made after the item was added", async () => {
    const s = await shopper([{ slug: "cotton-hair-tie", qty: 1 }]);
    const tie = await product("cotton-hair-tie");
    await prisma.product.update({ where: { id: tie.id }, data: { price: "40.00" } });
    try {
      const p = (await s.client.post("/checkout/preview")).body;
      expect(p.lines[0].unitPrice.amount).toBe("40.00");
      expect(p.subtotal.amount).toBe("40.00");
    } finally {
      await prisma.product.update({ where: { id: tie.id }, data: { price: tie.price } });
    }
  });
});

// =============================================================
// Order creation
// =============================================================

describe("POST /checkout — atomic order creation", () => {
  it("creates the order, snapshots, audit rows; deducts stock; clears the bag", async () => {
    const s = await shopper([
      { slug: "quilted-sherpa-jacket", qty: 1 }, // 6100 → 5337.50
      { slug: "cashmere-scarf", qty: 2 }, // 1000
    ]);
    const jacket = await product("quilted-sherpa-jacket");
    const scarf = await product("cashmere-scarf");

    const res = await s.client.post("/checkout", { address_id: s.addressId });
    expect(res.status).toBe(201);
    const { order, payment } = res.body;
    expect(order.orderNumber).toMatch(/^HEY-\d{6}-\d{4}$/);
    expect(order.status).toBe("pending");
    expect(order.paymentStatus).toBe("PENDING_PAYMENT");
    expect(order.grandTotal.amount).toBe("7337.50");
    expect(payment).toEqual({ mode: "demo", demo_payment_url: `/payment/demo/${order.id}` });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: BigInt(order.id) },
      include: { items: { orderBy: { id: "asc" } }, statusHistory: true },
    });
    expect(row.userId).toBe(s.id);
    expect(row.subtotal.toFixed(2)).toBe("8100.00");
    expect(row.discountTotal.toFixed(2)).toBe("762.50");
    expect(row.shippingTotal.toFixed(2)).toBe("0.00");
    expect(row.shipCity).toBe("Kochi");
    expect(row.shipPostalCode).toBe("682001");
    expect(row.items.map((i) => [i.productNameSnapshot, i.skuSnapshot, i.unitPrice.toFixed(2), i.discountAmount.toFixed(2), i.finalPrice.toFixed(2), i.quantity, i.lineTotal.toFixed(2)])).toEqual([
      ["Quilted Sherpa Jacket", jacket.sku, "6100.00", "762.50", "5337.50", 1, "5337.50"],
      ["Cashmere Scarf", scarf.sku, "1000.00", "0.00", "1000.00", 2, "2000.00"],
    ]);
    expect(row.statusHistory.map((h) => [h.fromStatus, h.toStatus, h.actorType])).toEqual([[null, "pending", "USER"]]);

    expect((await product("quilted-sherpa-jacket")).stockQuantity).toBe(jacket.stockQuantity - 1);
    expect((await product("cashmere-scarf")).stockQuantity).toBe(scarf.stockQuantity - 2);
    const adj = await prisma.stockAdjustment.findMany({
      where: { productId: { in: [jacket.id, scarf.id] }, actorId: s.id },
      orderBy: { id: "asc" },
    });
    expect(adj.map((a) => [a.reason, a.delta, a.resultingQuantity])).toEqual([
      ["sale", -1, jacket.stockQuantity - 1],
      ["sale", -2, scarf.stockQuantity - 2],
    ]);

    const cart = await s.client.get("/cart");
    expect(cart.body.items).toEqual([]);
    expect(cart.body.itemCount).toBe(0);
  });

  it("ignores client-supplied money: extras are rejected, not honoured", async () => {
    const s = await shopper([{ slug: "cashmere-scarf", qty: 1 }]);
    for (const extra of [{ total: "1.00" }, { grand_total: "1" }, { payment_status: "PAID" }, { user_id: "1" }]) {
      const res = await s.client.post("/checkout", { address_id: s.addressId, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("validation_failed");
    }
    expect(await prisma.order.count({ where: { userId: s.id } })).toBe(0);
  });

  it("rejects empty bag, missing/foreign address", async () => {
    const empty = await shopper([]);
    const r1 = await empty.client.post("/checkout", { address_id: empty.addressId });
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe("cart_empty");

    const s = await shopper([{ slug: "cashmere-scarf", qty: 1 }]);
    expect((await s.client.post("/checkout", {})).status).toBe(400);
    const foreign = await s.client.post("/checkout", { address_id: empty.addressId });
    expect(foreign.status).toBe(404);
    expect(await prisma.order.count({ where: { userId: s.id } })).toBe(0);
  });

  it("stock shortage rolls back everything: no order, no deduction, bag intact", async () => {
    const s = await shopper([
      { slug: "silk-stole", qty: 2 },
      { slug: "tiered-midi-dress", qty: 1 },
    ]);
    const stole = await product("silk-stole");
    const dress = await product("tiered-midi-dress");
    await setStock("tiered-midi-dress", 0);
    try {
      const res = await s.client.post("/checkout", { address_id: s.addressId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("stock_shortage");
      expect(res.body.error.details[0]).toMatchObject({ name: "Tiered Midi Dress", reason: "out_of_stock" });

      expect(await prisma.order.count({ where: { userId: s.id } })).toBe(0);
      expect((await product("silk-stole")).stockQuantity).toBe(stole.stockQuantity);
      expect(await prisma.stockAdjustment.count({ where: { actorId: s.id } })).toBe(0);
      const cart = (await s.client.get("/cart")).body;
      expect(cart.items).toHaveLength(2);
    } finally {
      await setStock("tiered-midi-dress", dress.stockQuantity);
    }
  });

  it("an unavailable line yields cart_stale with details", async () => {
    const s = await shopper([{ slug: "cashmere-scarf", qty: 1 }]);
    const scarf = await product("cashmere-scarf");
    await prisma.product.update({ where: { id: scarf.id }, data: { status: "archived" } });
    try {
      const res = await s.client.post("/checkout", { address_id: s.addressId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("cart_stale");
      expect(res.body.error.details[0].reason).toBe("unavailable");
    } finally {
      await prisma.product.update({ where: { id: scarf.id }, data: { status: "active" } });
    }
  });

  it("a failure after stock was deducted rolls back the deduction too", async () => {
    // Force the ORDER INSERT (step 11) to fail after both stock decrements
    // and their audit rows (step 10) have already run inside the transaction.
    const s = await shopper([
      { slug: "braided-jute-tote", qty: 1 },
      { slug: "minimal-leather-cardholder", qty: 2 },
    ]);
    const tote = await product("braided-jute-tote");
    const holder = await product("minimal-leather-cardholder");
    await prisma.$executeRaw`ALTER TABLE orders ADD CONSTRAINT tmp_block CHECK (ship_city <> 'Kochi') NOT VALID`;
    try {
      const res = await s.client.post("/checkout", { address_id: s.addressId });
      expect(res.status).toBe(500);
      expect(await prisma.order.count({ where: { userId: s.id } })).toBe(0);
      expect((await product("braided-jute-tote")).stockQuantity).toBe(tote.stockQuantity);
      expect((await product("minimal-leather-cardholder")).stockQuantity).toBe(holder.stockQuantity);
      expect(await prisma.stockAdjustment.count({ where: { actorId: s.id } })).toBe(0);
      expect((await s.client.get("/cart")).body.items).toHaveLength(2);
    } finally {
      await prisma.$executeRaw`ALTER TABLE orders DROP CONSTRAINT tmp_block`;
    }
  });

  it("repeated clicks place exactly one order", async () => {
    const s = await shopper([{ slug: "cashmere-scarf", qty: 1 }]);
    const scarf = await product("cashmere-scarf");
    const results = await Promise.all(
      Array.from({ length: 3 }, () => s.client.post("/checkout", { address_id: s.addressId })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === "cart_empty")).toBe(true);
    expect(await prisma.order.count({ where: { userId: s.id } })).toBe(1);
    expect((await product("cashmere-scarf")).stockQuantity).toBe(scarf.stockQuantity - 1);
  });

  it("order numbers are unique and sequential per day", async () => {
    const a = await shopper([{ slug: "cotton-hair-tie", qty: 1 }]);
    const b = await shopper([{ slug: "cotton-hair-tie", qty: 1 }]);
    const [ra, rb] = await Promise.all([
      a.client.post("/checkout", { address_id: a.addressId }),
      b.client.post("/checkout", { address_id: b.addressId }),
    ]);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    const na = ra.body.order.orderNumber as string;
    const nb = rb.body.order.orderNumber as string;
    expect(na).not.toBe(nb);
    expect(na.slice(0, 11)).toBe(nb.slice(0, 11));
    expect(Math.abs(Number(na.slice(11)) - Number(nb.slice(11)))).toBe(1);
  });
});

// =============================================================
// Concurrency — the last unit
// =============================================================

describe("inventory concurrency", () => {
  it("two users racing for the last unit: exactly one order, stock 0, clean error", async () => {
    const gown = await product("midnight-evening-gown");
    const a = await shopper([{ slug: "midnight-evening-gown", qty: 1 }]);
    const b = await shopper([{ slug: "midnight-evening-gown", qty: 1 }]);
    await setStock("midnight-evening-gown", 1);
    try {
      const [ra, rb] = await Promise.all([
        a.client.post("/checkout", { address_id: a.addressId }),
        b.client.post("/checkout", { address_id: b.addressId }),
      ]);
      const statuses = [ra.status, rb.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = ra.status === 409 ? ra : rb;
      expect(loser.body.error.code).toBe("stock_shortage");
      expect(loser.body.error.message).toContain("Midnight Evening Gown");

      expect((await product("midnight-evening-gown")).stockQuantity).toBe(0);
      const sold = await prisma.orderItem.count({
        where: { productId: gown.id, order: { userId: { in: [a.id, b.id] } } },
      });
      expect(sold).toBe(1);
      const adj = await prisma.stockAdjustment.findMany({
        where: { productId: gown.id, actorId: { in: [a.id, b.id] } },
      });
      expect(adj).toHaveLength(1);
      expect(adj[0].resultingQuantity).toBe(0);

      // the loser keeps their bag (flagged), nothing half-created
      const loserClient = ra.status === 409 ? a.client : b.client;
      const loserId = ra.status === 409 ? a.id : b.id;
      expect(await prisma.order.count({ where: { userId: loserId } })).toBe(0);
      const bag = (await loserClient.get("/cart")).body;
      expect(bag.items).toHaveLength(1);
      expect(bag.items[0].availability).toBe("out_of_stock");
    } finally {
      await setStock("midnight-evening-gown", gown.stockQuantity);
    }
  });

  it("the database refuses negative stock even outside the service", async () => {
    const gown = await product("midnight-evening-gown");
    await expect(
      prisma.product.update({ where: { id: gown.id }, data: { stockQuantity: -1 } }),
    ).rejects.toThrow();
  });
});

// =============================================================
// Order history + authorization
// =============================================================

describe("GET /orders", () => {
  it("lists own orders newest first with totals and statuses; detail has snapshots", async () => {
    const s = await shopper([{ slug: "linen-wrap-dress", qty: 1 }]);
    const first = (await s.client.post("/checkout", { address_id: s.addressId })).body.order;
    const dress = await product("linen-wrap-dress");
    await s.client.post("/cart/items", { product_id: dress.id.toString(), qty: 2 });
    const second = (await s.client.post("/checkout", { address_id: s.addressId })).body.order;

    const list = await s.client.get("/orders");
    expect(list.status).toBe(200);
    expect(list.body.total_items).toBe(2);
    expect(list.body.items.map((o: { id: string }) => o.id)).toEqual([second.id, first.id]);
    expect(list.body.items[0]).toMatchObject({
      orderNumber: second.orderNumber,
      status: "pending",
      paymentStatus: "PENDING_PAYMENT",
      grandTotal: { amount: "599.00" },
      itemCount: 2,
    });

    // snapshots survive later catalog + address edits
    await prisma.product.update({ where: { id: dress.id }, data: { price: "999.00", name: "Renamed Dress" } });
    await s.client.patch(`/addresses/${s.addressId}`, { city: "Mumbai", state: "Maharashtra", postal_code: "400001" });
    try {
      const d = (await s.client.get(`/orders/${first.id}`)).body.order;
      expect(d.items[0]).toMatchObject({ name: "Linen Wrap Dress", unitPrice: { amount: "250.00" }, quantity: 1 });
      expect(d.shipping.city).toBe("Kochi");
      expect(d.subtotal.amount).toBe("250.00");
      expect(d.shippingTotal.amount).toBe("99.00");
      expect(d.grandTotal.amount).toBe("349.00");
      expect(d.timeline[0]).toMatchObject({ from: null, to: "pending" });
      expect(d.payment).toMatchObject({ mode: "demo", canPay: true, demo_payment_url: `/payment/demo/${first.id}` });
    } finally {
      await prisma.product.update({ where: { id: dress.id }, data: { price: dress.price, name: dress.name } });
    }
  });

  it("never exposes another user's order (404, same as nonexistent)", async () => {
    const owner = await shopper([{ slug: "cotton-hair-tie", qty: 1 }]);
    const order = (await owner.client.post("/checkout", { address_id: owner.addressId })).body.order;
    const intruder = await newUser();
    const i = as(intruder.jar);
    expect((await i.get("/orders")).body.items).toEqual([]);
    const peek = await i.get(`/orders/${order.id}`);
    expect(peek.status).toBe(404);
    expect(peek.body.error.code).toBe("unknown_resource");
    expect((await i.get("/orders/999999999")).status).toBe(404);
    expect((await i.get("/orders/abc")).status).toBe(404);
    expect((await i.post(`/orders/${order.id}/demo-payment/confirm`)).status).toBe(404);
    expect((await i.post(`/orders/${order.id}/demo-payment/fail`)).status).toBe(404);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(order.id) } });
    expect(row.paymentStatus).toBe("PENDING_PAYMENT");
  });

  it("customers have no route to change order status", async () => {
    const s = await shopper([{ slug: "cotton-hair-tie", qty: 1 }]);
    const order = (await s.client.post("/checkout", { address_id: s.addressId })).body.order;
    expect((await s.client.patch(`/orders/${order.id}`, { status: "delivered" })).status).toBe(404);
    expect((await s.client.post(`/orders/${order.id}/status`, { status: "confirmed" })).status).toBe(404);
    expect((await s.client.post(`/orders/${order.id}/payment-status`, { status: "PAID" })).status).toBe(404);
  });
});

describe("order status ladder (service)", () => {
  it("applies legal moves with audit + milestones and rejects illegal ones", async () => {
    const s = await shopper([{ slug: "cotton-hair-tie", qty: 1 }]);
    const id = BigInt((await s.client.post("/checkout", { address_id: s.addressId })).body.order.id);

    await expect(transitionOrderStatus({ orderId: id, to: "shipped", actorType: "ADMIN", actorId: null })).rejects.toMatchObject({ code: "illegal_transition" });
    await transitionOrderStatus({ orderId: id, to: "confirmed", actorType: "ADMIN", actorId: null });
    await transitionOrderStatus({ orderId: id, to: "shipped", actorType: "ADMIN", actorId: null });
    await expect(transitionOrderStatus({ orderId: id, to: "cancelled", actorType: "ADMIN", actorId: null })).rejects.toMatchObject({ code: "illegal_transition" });
    await expect(transitionOrderStatus({ orderId: id, to: "pending", actorType: "ADMIN", actorId: null })).rejects.toMatchObject({ code: "illegal_transition" });
    await transitionOrderStatus({ orderId: id, to: "delivered", actorType: "ADMIN", actorId: null });

    const row = await prisma.order.findUniqueOrThrow({ where: { id }, include: { statusHistory: { orderBy: { id: "asc" } } } });
    expect(row.status).toBe("delivered");
    expect(row.confirmedAt).not.toBeNull();
    expect(row.statusHistory.map((h) => `${h.fromStatus ?? "∅"}→${h.toStatus}`)).toEqual([
      "∅→pending",
      "pending→confirmed",
      "confirmed→shipped",
      "shipped→delivered",
    ]);
  });

  it("cancellation from pending records cancelled_at", async () => {
    const s = await shopper([{ slug: "cotton-hair-tie", qty: 1 }]);
    const id = BigInt((await s.client.post("/checkout", { address_id: s.addressId })).body.order.id);
    await transitionOrderStatus({ orderId: id, to: "cancelled", actorType: "SYSTEM", actorId: null });
    const row = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("cancelled");
    expect(row.cancelledAt).not.toBeNull();
    await expect(transitionOrderStatus({ orderId: id, to: "confirmed", actorType: "ADMIN", actorId: null })).rejects.toMatchObject({ code: "illegal_transition" });
  });
});

describe("immutability (database)", () => {
  it("order money, snapshots, and audit rows cannot be changed or deleted", async () => {
    const s = await shopper([{ slug: "cotton-hair-tie", qty: 1 }]);
    const id = BigInt((await s.client.post("/checkout", { address_id: s.addressId })).body.order.id);
    await expect(prisma.order.update({ where: { id }, data: { grandTotal: "1.00" } })).rejects.toThrow();
    await expect(prisma.order.update({ where: { id }, data: { shipCity: "Elsewhere" } })).rejects.toThrow();
    await expect(prisma.order.delete({ where: { id } })).rejects.toThrow();
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: id } });
    await expect(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 5 } })).rejects.toThrow();
    await expect(prisma.orderItem.delete({ where: { id: item.id } })).rejects.toThrow();
    const hist = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: id } });
    await expect(prisma.orderStatusHistory.delete({ where: { id: hist.id } })).rejects.toThrow();
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { actorId: s.id } });
    await expect(prisma.stockAdjustment.update({ where: { id: adj.id }, data: { delta: -99 } })).rejects.toThrow();
  });
});

// =============================================================
// Demo payment
// =============================================================

describe("demo payment (PAYMENT_MODE=demo)", () => {
  async function placed() {
    const s = await shopper([{ slug: "cashmere-scarf", qty: 1 }]);
    const order = (await s.client.post("/checkout", { address_id: s.addressId })).body.order;
    return { ...s, order };
  }

  it("failure keeps the order PENDING_PAYMENT, audits it, and allows retry to success", async () => {
    const { client, order, id: userId } = await placed();
    const stockBefore = (await product("cashmere-scarf")).stockQuantity;

    const fail = await client.post(`/orders/${order.id}/demo-payment/fail`, { method: "demo_upi" });
    expect(fail.status).toBe(200);
    expect(fail.body.order).toMatchObject({ paymentStatus: "PENDING_PAYMENT", status: "pending" });
    expect(fail.body.order.payment.canPay).toBe(true);

    const again = await client.post(`/orders/${order.id}/demo-payment/fail`);
    expect(again.status).toBe(200);

    const ok = await client.post(`/orders/${order.id}/demo-payment/confirm`, { method: "demo_card" });
    expect(ok.status).toBe(200);
    expect(ok.body.order).toMatchObject({ paymentStatus: "PAID", status: "pending" });
    expect(ok.body.order.payment.canPay).toBe(false);

    // no second order, no second deduction
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
    expect((await product("cashmere-scarf")).stockQuantity).toBe(stockBefore);

    const hist = await prisma.orderStatusHistory.findMany({ where: { orderId: BigInt(order.id) }, orderBy: { id: "asc" } });
    expect(hist.map((h) => `${h.fromStatus ?? "∅"}→${h.toStatus}`)).toEqual([
      "∅→pending",
      "PENDING_PAYMENT→PENDING_PAYMENT",
      "PENDING_PAYMENT→PENDING_PAYMENT",
      "PENDING_PAYMENT→PAID",
    ]);
    expect(hist[1].note).toContain("Demo UPI");
    expect(hist[3].note).toContain("Demo Card");
    expect(hist.every((h) => h.actorType === "USER" && h.actorId === userId)).toBe(true);
  });

  it("confirm is idempotent; fail after PAID is refused", async () => {
    const { client, order } = await placed();
    expect((await client.post(`/orders/${order.id}/demo-payment/confirm`)).status).toBe(200);
    const replay = await client.post(`/orders/${order.id}/demo-payment/confirm`);
    expect(replay.status).toBe(200);
    expect(replay.body.order.paymentStatus).toBe("PAID");
    const paidRows = await prisma.orderStatusHistory.count({ where: { orderId: BigInt(order.id), toStatus: "PAID" } });
    expect(paidRows).toBe(1);

    const late = await client.post(`/orders/${order.id}/demo-payment/fail`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("already_paid");
  });

  it("parallel confirms record exactly one PAID transition", async () => {
    const { client, order } = await placed();
    const res = await Promise.all(
      Array.from({ length: 4 }, () => client.post(`/orders/${order.id}/demo-payment/confirm`)),
    );
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: BigInt(order.id), toStatus: "PAID" } })).toBe(1);
  });

  it("a cancelled order can't be paid", async () => {
    const { client, order } = await placed();
    await transitionOrderStatus({ orderId: BigInt(order.id), to: "cancelled", actorType: "SYSTEM", actorId: null });
    const res = await client.post(`/orders/${order.id}/demo-payment/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_payable");
  });

  it("validates the method and rejects extra fields", async () => {
    const { client, order } = await placed();
    expect((await client.post(`/orders/${order.id}/demo-payment/confirm`, { method: "visa" })).status).toBe(400);
    expect((await client.post(`/orders/${order.id}/demo-payment/confirm`, { card_number: "4111111111111111" })).status).toBe(400);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(order.id) } });
    expect(row.paymentStatus).toBe("PENDING_PAYMENT");
  });
});

describe("manual mode (PAYMENT_MODE=manual)", () => {
  it("unmounts the demo endpoints and reports manual payment", async () => {
    const s = await shopper([{ slug: "cotton-hair-tie", qty: 1 }], manualApp);
    const res = await s.client.post("/checkout", { address_id: s.addressId });
    expect(res.status).toBe(201);
    expect(res.body.payment).toEqual({ mode: "manual" });
    const id = res.body.order.id;

    for (const path of [`/orders/${id}/demo-payment/confirm`, `/orders/${id}/demo-payment/fail`]) {
      const r = await s.client.post(path);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("unknown_resource");
    }
    const detail = (await s.client.get(`/orders/${id}`)).body.order;
    expect(detail.payment).toEqual({ mode: "manual", canPay: false });
    expect(detail.paymentStatus).toBe("PENDING_PAYMENT");
  });
});
