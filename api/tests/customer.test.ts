import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { seed } from "../prisma/seed";
import { prisma } from "../src/lib/prisma.js";
import { resetRateLimiter } from "../src/middleware/rate-limit.js";

/**
 * Wishlist + address book integration tests (Phase 8) against real
 * PostgreSQL (heyrah_test via `npm run test:db`). Covers auth, ownership,
 * idempotency, live catalog state, validation, default-address rules,
 * CSRF, and mass-assignment resistance.
 */

let app: Express;
const base = "/api/v1";

beforeAll(async () => {
  await seed();
  app = createApp();
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

async function bootstrap(): Promise<Jar> {
  return extractCookies(await request(app).get(base + "/auth/csrf"));
}

/** Register a fresh USER; returns the authenticated cookie jar + id. */
async function newUser(): Promise<{ jar: Jar; id: bigint }> {
  const guest = await bootstrap();
  const res = await request(app)
    .post(base + "/auth/register")
    .set("Cookie", cookieHeader(guest))
    .set("X-CSRF-Token", guest["heyrah_csrf"])
    .send({
      name: "Shopper",
      email: `p8-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      password: "Str0ngPass!x",
    });
  expect(res.status).toBe(201);
  return { jar: { ...guest, ...extractCookies(res) }, id: BigInt(res.body.user.id) };
}

function as(jar: Jar) {
  const auth = (r: request.Test) => r.set("Cookie", cookieHeader(jar)).set("X-CSRF-Token", jar["heyrah_csrf"]);
  return {
    get: (path: string) => request(app).get(base + path).set("Cookie", cookieHeader(jar)),
    post: (path: string, body?: object) => auth(request(app).post(base + path)).send(body ?? {}),
    patch: (path: string, body: object) => auth(request(app).patch(base + path)).send(body),
    del: (path: string) => auth(request(app).delete(base + path)),
  };
}

async function productBySlug(slug: string) {
  return prisma.product.findUniqueOrThrow({ where: { slug } });
}

const validAddress = {
  receiver_name: "Amira Rahman",
  phone: "+91 98765 43210",
  line1: "12 Marine Drive",
  line2: "Flat 4B",
  city: "Kochi",
  state: "Kerala",
  postal_code: "682001",
  country_code: "IN",
};

interface WishlistBody {
  items: {
    id: string;
    product: { id: string; name: string; slug: string };
    price: { amount: string };
    finalPrice: { amount: string };
    availability: string;
    purchasable: boolean;
  }[];
}

interface AddressBody {
  items: { id: string; isDefault: boolean; receiverName: string; city: string }[];
}

// =============================================================
// WISHLIST
// =============================================================

describe("wishlist — authentication", () => {
  it("rejects guests with 401 authentication_required on every endpoint", async () => {
    const guest = await bootstrap();
    const g = as(guest);
    for (const res of [
      await g.get("/wishlist"),
      await g.post("/wishlist/items", { product_id: 1 }),
      await g.del("/wishlist/items/1"),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("authentication_required");
    }
  });

  it("returns an empty wishlist for a new user, not cacheable", async () => {
    const { jar } = await newUser();
    const res = await as(jar).get("/wishlist");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(res.headers["cache-control"]).toContain("no-store");
  });
});

describe("wishlist — add / remove", () => {
  it("adds a product with live catalog data", async () => {
    const { jar } = await newUser();
    const silk = await productBySlug("silk-slip-dress");

    const res = await as(jar).post("/wishlist/items", { product_id: silk.id.toString() });
    expect(res.status).toBe(200);
    const body = res.body as WishlistBody;
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.id).toBe(silk.id.toString());
    expect(item.product.name).toBe("Silk Slip Dress");
    expect(item.price.amount).toBe("5400.00");
    expect(item.finalPrice.amount).toBe("4590.00"); // 15% off, server-computed
    expect(item.availability).toBe("in_stock");
    expect(item.purchasable).toBe(true);
  });

  it("duplicate add is idempotent — still a single entry", async () => {
    const { jar, id } = await newUser();
    const scarf = await productBySlug("cashmere-scarf");
    const u = as(jar);

    await u.post("/wishlist/items", { product_id: scarf.id.toString() }).expect(200);
    const again = await u.post("/wishlist/items", { product_id: scarf.id.toString() });
    expect(again.status).toBe(200);
    expect((again.body as WishlistBody).items).toHaveLength(1);
    expect(await prisma.wishlistItem.count({ where: { userId: id } })).toBe(1);
  });

  it("removes an item", async () => {
    const { jar } = await newUser();
    const scarf = await productBySlug("cashmere-scarf");
    const u = as(jar);
    await u.post("/wishlist/items", { product_id: scarf.id.toString() }).expect(200);

    const res = await u.del(`/wishlist/items/${scarf.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });

    // removing again → clean 404
    const gone = await u.del(`/wishlist/items/${scarf.id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe("unknown_resource");
  });

  it("404s a missing product and a hidden (inactive/archived) product", async () => {
    const { jar } = await newUser();
    const u = as(jar);
    const missing = await u.post("/wishlist/items", { product_id: "99999999" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("unknown_resource");

    for (const status of ["inactive", "archived"]) {
      const hidden = await prisma.product.findFirstOrThrow({ where: { status } });
      const res = await u.post("/wishlist/items", { product_id: hidden.id.toString() });
      expect(res.status).toBe(404);
    }
  });

  it("validates input and rejects client-supplied extras (mass assignment)", async () => {
    const { jar } = await newUser();
    const u = as(jar);
    for (const body of [{}, { product_id: "abc" }, { product_id: -3 }, { product_id: 1.5 }]) {
      const res = await u.post("/wishlist/items", body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("validation_failed");
    }
    const scarf = await productBySlug("cashmere-scarf");
    const extras = await u.post("/wishlist/items", {
      product_id: scarf.id.toString(),
      price: "1.00",
      user_id: "1",
    });
    expect(extras.status).toBe(400);

    const badId = await u.del("/wishlist/items/not-a-number");
    expect(badId.status).toBe(400);
  });
});

describe("wishlist — live state (no snapshot)", () => {
  it("reflects a price change on the next GET", async () => {
    const { jar } = await newUser();
    const belt = await productBySlug("woven-leather-belt");
    const u = as(jar);
    await u.post("/wishlist/items", { product_id: belt.id.toString() }).expect(200);

    await prisma.product.update({
      where: { id: belt.id },
      data: { price: "777.00", discountType: "percent", discountValue: "10.00" },
    });
    try {
      const item = ((await u.get("/wishlist")).body as WishlistBody).items[0];
      expect(item.price.amount).toBe("777.00");
      expect(item.finalPrice.amount).toBe("699.30");
    } finally {
      await prisma.product.update({
        where: { id: belt.id },
        data: {
          price: belt.price,
          discountType: belt.discountType,
          discountValue: belt.discountValue,
        },
      });
    }
  });

  it("flags out-of-stock and deactivated products honestly, never purchasable", async () => {
    const { jar } = await newUser();
    const tote = await productBySlug("braided-jute-tote");
    const u = as(jar);
    await u.post("/wishlist/items", { product_id: tote.id.toString() }).expect(200);

    await prisma.product.update({ where: { id: tote.id }, data: { stockQuantity: 0 } });
    try {
      const item = ((await u.get("/wishlist")).body as WishlistBody).items[0];
      expect(item.availability).toBe("out_of_stock");
      expect(item.purchasable).toBe(false);
    } finally {
      await prisma.product.update({ where: { id: tote.id }, data: { stockQuantity: tote.stockQuantity } });
    }

    await prisma.product.update({ where: { id: tote.id }, data: { status: "archived" } });
    try {
      const body = (await u.get("/wishlist")).body as WishlistBody;
      expect(body.items).toHaveLength(1); // still listed
      expect(body.items[0].availability).toBe("unavailable");
      expect(body.items[0].purchasable).toBe(false);
      expect(body.items[0].product.slug).toBe(""); // no dead public link
    } finally {
      await prisma.product.update({ where: { id: tote.id }, data: { status: tote.status } });
    }
  });
});

describe("wishlist — isolation + CSRF", () => {
  it("users never see or modify each other's wishlists", async () => {
    const a = await newUser();
    const b = await newUser();
    const scarf = await productBySlug("cashmere-scarf");
    await as(a.jar).post("/wishlist/items", { product_id: scarf.id.toString() }).expect(200);

    expect((await as(b.jar).get("/wishlist")).body).toEqual({ items: [] });

    const steal = await as(b.jar).del(`/wishlist/items/${scarf.id}`);
    expect(steal.status).toBe(404);
    expect(await prisma.wishlistItem.count({ where: { userId: a.id } })).toBe(1);
  });

  it("requires the CSRF header on mutations", async () => {
    const { jar } = await newUser();
    const scarf = await productBySlug("cashmere-scarf");
    const noHeader = await request(app)
      .post(base + "/wishlist/items")
      .set("Cookie", cookieHeader(jar))
      .send({ product_id: scarf.id.toString() });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe("csrf_failed");

    const badHeader = await request(app)
      .delete(`${base}/wishlist/items/${scarf.id}`)
      .set("Cookie", cookieHeader(jar))
      .set("X-CSRF-Token", "x".repeat(43));
    expect(badHeader.status).toBe(403);
  });
});

// =============================================================
// ADDRESSES
// =============================================================

describe("addresses — authentication", () => {
  it("rejects guests on every endpoint", async () => {
    const g = as(await bootstrap());
    for (const res of [
      await g.get("/addresses"),
      await g.post("/addresses", validAddress),
      await g.patch("/addresses/1", { city: "X" }),
      await g.del("/addresses/1"),
      await g.post("/addresses/1/default"),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("authentication_required");
    }
  });
});

describe("addresses — create + list", () => {
  it("creates the first address as default and normalizes input", async () => {
    const { jar } = await newUser();
    const res = await as(jar).post("/addresses", {
      ...validAddress,
      receiver_name: "  Amira   Rahman ",
      country_code: "in",
    });
    expect(res.status).toBe(201);
    expect(res.body.address).toMatchObject({
      receiverName: "Amira Rahman",
      countryCode: "IN",
      postalCode: "682001",
      line2: "Flat 4B",
      isDefault: true,
    });
    expect(res.body.address).not.toHaveProperty("userId");
  });

  it("second address is not default; list puts the default first", async () => {
    const { jar } = await newUser();
    const u = as(jar);
    await u.post("/addresses", validAddress).expect(201);
    const second = await u.post("/addresses", { ...validAddress, city: "Mumbai", state: "Maharashtra", postal_code: "400001" });
    expect(second.body.address.isDefault).toBe(false);

    const list = (await u.get("/addresses")).body as AddressBody;
    expect(list.items).toHaveLength(2);
    expect(list.items[0].isDefault).toBe(true);
    expect(list.items[0].city).toBe("Kochi");
    expect(list.items.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it("treats blank line2 as absent", async () => {
    const { jar } = await newUser();
    const res = await as(jar).post("/addresses", { ...validAddress, line2: "   " });
    expect(res.status).toBe(201);
    expect(res.body.address.line2).toBeNull();
  });
});

describe("addresses — validation", () => {
  it.each([
    ["missing receiver", { receiver_name: undefined }],
    ["blank line1", { line1: "   " }],
    ["short name", { receiver_name: "A" }],
    ["too long city", { city: "x".repeat(81) }],
    ["phone letters", { phone: "call me" }],
    ["phone too few digits", { phone: "12345" }],
    ["phone too many digits", { phone: "1234567890123456" }],
    ["country 3 letters", { country_code: "IND" }],
    ["country digits", { country_code: "12" }],
    ["IN PIN not 6 digits", { postal_code: "6820" }],
    ["postal symbols", { country_code: "GB", postal_code: "SW1A#1AA" }],
    ["control characters", { line1: "12 Marine\u0000Drive" }],
    ["number as name", { receiver_name: 12345 }],
  ])("rejects %s", async (_label, override) => {
    const { jar } = await newUser();
    const body: Record<string, unknown> = { ...validAddress, ...override };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    const res = await as(jar).post("/addresses", body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("accepts a non-IN address with an alphanumeric postal code", async () => {
    const { jar } = await newUser();
    const res = await as(jar).post("/addresses", {
      ...validAddress,
      city: "London",
      state: "Greater London",
      postal_code: "sw1a 1aa",
      country_code: "GB",
      phone: "+44 20 7946 0958",
    });
    expect(res.status).toBe(201);
    expect(res.body.address.postalCode).toBe("SW1A 1AA");
  });

  it("rejects mass assignment: user_id, is_default, id", async () => {
    const victim = await newUser();
    const { jar } = await newUser();
    for (const extra of [{ user_id: victim.id.toString() }, { is_default: true }, { id: "1" }]) {
      const res = await as(jar).post("/addresses", { ...validAddress, ...extra });
      expect(res.status).toBe(400);
    }
    expect(await prisma.address.count({ where: { userId: victim.id } })).toBe(0);
  });
});

describe("addresses — update", () => {
  it("updates own address fields", async () => {
    const { jar } = await newUser();
    const u = as(jar);
    const created = (await u.post("/addresses", validAddress)).body.address;
    const res = await u.patch(`/addresses/${created.id}`, { line1: "7 Beach Road", line2: null });
    expect(res.status).toBe(200);
    expect(res.body.address).toMatchObject({ line1: "7 Beach Road", line2: null, city: "Kochi", isDefault: true });
  });

  it("validates the merged country/postal pair and rejects empty or foreign patches", async () => {
    const { jar } = await newUser();
    const u = as(jar);
    const gb = (await u.post("/addresses", { ...validAddress, country_code: "GB", postal_code: "SW1A 1AA" })).body.address;

    // switching to IN while keeping a UK postcode is invalid
    const merged = await u.patch(`/addresses/${gb.id}`, { country_code: "IN" });
    expect(merged.status).toBe(400);

    expect((await u.patch(`/addresses/${gb.id}`, {})).status).toBe(400);
    expect((await u.patch(`/addresses/${gb.id}`, { is_default: true })).status).toBe(400);
  });
});

describe("addresses — default rules", () => {
  async function bookOf3() {
    const { jar, id } = await newUser();
    const u = as(jar);
    const a = (await u.post("/addresses", validAddress)).body.address;
    const b = (await u.post("/addresses", { ...validAddress, city: "Mumbai", state: "Maharashtra", postal_code: "400001" })).body.address;
    const c = (await u.post("/addresses", { ...validAddress, city: "Delhi", state: "Delhi", postal_code: "110001" })).body.address;
    return { u, id, a, b, c };
  }

  it("setting a default clears the previous one (exactly one default)", async () => {
    const { u, id, a, b } = await bookOf3();
    const res = await u.post(`/addresses/${b.id}/default`);
    expect(res.status).toBe(200);
    const body = res.body as AddressBody;
    expect(body.items.find((x) => x.id === b.id)?.isDefault).toBe(true);
    expect(body.items.find((x) => x.id === a.id)?.isDefault).toBe(false);
    expect(await prisma.address.count({ where: { userId: id, isDefault: true } })).toBe(1);

    // idempotent re-set
    expect((await u.post(`/addresses/${b.id}/default`)).status).toBe(200);
    expect(await prisma.address.count({ where: { userId: id, isDefault: true } })).toBe(1);
  });

  it("deletes a non-default address directly", async () => {
    const { u, a, c } = await bookOf3();
    const res = await u.del(`/addresses/${c.id}`);
    expect(res.status).toBe(200);
    const body = res.body as AddressBody;
    expect(body.items).toHaveLength(2);
    expect(body.items.find((x) => x.id === a.id)?.isDefault).toBe(true);
  });

  it("deleting the default requires choosing a replacement", async () => {
    const { u, id, a, b } = await bookOf3();
    const blocked = await u.del(`/addresses/${a.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("default_reassignment_required");
    expect(await prisma.address.count({ where: { userId: id } })).toBe(3);

    const self = await u.del(`/addresses/${a.id}?new_default_id=${a.id}`);
    expect(self.status).toBe(400);

    const ok = await u.del(`/addresses/${a.id}?new_default_id=${b.id}`);
    expect(ok.status).toBe(200);
    const body = ok.body as AddressBody;
    expect(body.items).toHaveLength(2);
    expect(body.items.find((x) => x.id === b.id)?.isDefault).toBe(true);
    expect(await prisma.address.count({ where: { userId: id, isDefault: true } })).toBe(1);
  });

  it("deleting the only address leaves an empty book", async () => {
    const { jar, id } = await newUser();
    const u = as(jar);
    const only = (await u.post("/addresses", validAddress)).body.address;
    const res = await u.del(`/addresses/${only.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(await prisma.address.count({ where: { userId: id } })).toBe(0);

    // the next address becomes default again
    const next = await u.post("/addresses", validAddress);
    expect(next.body.address.isDefault).toBe(true);
  });

  it("concurrent creates for a new user still yield exactly one default", async () => {
    const { jar, id } = await newUser();
    const u = as(jar);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => u.post("/addresses", { ...validAddress, line1: `${i + 1} Marine Drive` })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await prisma.address.count({ where: { userId: id } })).toBe(5);
    expect(await prisma.address.count({ where: { userId: id, isDefault: true } })).toBe(1);
  });

  it("the database refuses a second default even if app rules were bypassed", async () => {
    const { u, id, b } = await bookOf3();
    void u;
    await expect(
      prisma.address.update({ where: { id: BigInt(b.id) }, data: { isDefault: true } }),
    ).rejects.toThrow();
    expect(await prisma.address.count({ where: { userId: id, isDefault: true } })).toBe(1);
  });
});

describe("addresses — ownership + CSRF", () => {
  it("cross-user read/edit/delete/default/reassign are all 404 and change nothing", async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const o = as(owner.jar);
    const i = as(intruder.jar);
    const a = (await o.post("/addresses", validAddress)).body.address;
    const b = (await o.post("/addresses", { ...validAddress, city: "Mumbai", state: "Maharashtra", postal_code: "400001" })).body.address;
    const mine = (await i.post("/addresses", validAddress)).body.address;

    expect(((await i.get("/addresses")).body as AddressBody).items.map((x) => x.id)).toEqual([mine.id]);
    expect((await i.patch(`/addresses/${a.id}`, { city: "Hacked" })).status).toBe(404);
    expect((await i.del(`/addresses/${b.id}`)).status).toBe(404);
    expect((await i.post(`/addresses/${b.id}/default`)).status).toBe(404);
    // intruder deletes own default naming the owner's address as replacement
    // (only one address → no reassignment needed; add a second first)
    await i.post("/addresses", { ...validAddress, city: "Pune", state: "Maharashtra", postal_code: "411001" });
    expect((await i.del(`/addresses/${mine.id}?new_default_id=${b.id}`)).status).toBe(404);

    const ownerRows = await prisma.address.findMany({ where: { userId: owner.id }, orderBy: { id: "asc" } });
    expect(ownerRows.map((r) => r.city)).toEqual(["Kochi", "Mumbai"]);
    expect(ownerRows.map((r) => r.isDefault)).toEqual([true, false]);
  });

  it("requires the CSRF header on every mutation", async () => {
    const { jar } = await newUser();
    const a = (await as(jar).post("/addresses", validAddress)).body.address;
    const cookie = cookieHeader(jar);
    for (const res of [
      await request(app).post(base + "/addresses").set("Cookie", cookie).send(validAddress),
      await request(app).patch(`${base}/addresses/${a.id}`).set("Cookie", cookie).send({ city: "X" }),
      await request(app).delete(`${base}/addresses/${a.id}`).set("Cookie", cookie),
      await request(app).post(`${base}/addresses/${a.id}/default`).set("Cookie", cookie),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("csrf_failed");
    }
  });

  it("stores markup verbatim (rendered escaped by the client)", async () => {
    const { jar } = await newUser();
    const res = await as(jar).post("/addresses", {
      ...validAddress,
      line1: `<img src=x onerror="alert(1)">`,
    });
    expect(res.status).toBe(201);
    expect(res.body.address.line1).toBe(`<img src=x onerror="alert(1)">`);
    expect(res.headers["content-type"]).toContain("application/json");
  });
});
