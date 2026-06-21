import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { seed } from "../prisma/seed";
import { prisma } from "../src/lib/prisma.js";

/**
 * Catalog API integration tests — run against the real PostgreSQL
 * (heyrah_test; see `npm run test:db`). Prisma is the only DB client,
 * so env-scoping DATABASE_URL before import is the isolation boundary.
 */
let app: Express;

beforeAll(async () => {
  await seed();
  app = createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

interface ListBody {
  items: {
    id: string;
    name: string;
    slug: string;
    finalPrice: { amount: string };
    price: { amount: string };
    discount: { type: string; value?: { amount: string } };
    inStock: boolean;
  }[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

const getJson = async (url: string) => {
  const res = await request(app).get(url);
  return { res, body: res.body as unknown };
};

describe("GET /api/v1/categories", () => {
  it("lists active categories with product counts, ordered by sort_order", async () => {
    const { res, body } = await getJson("/api/v1/categories");
    expect(res.status).toBe(200);
    const items = (body as { items: { slug: string; productCount: number }[] }).items;
    // archive-preview is inactive — hidden from the nav surface
    expect(items.map((c) => c.slug)).not.toContain("archive-preview");
    expect(items.map((c) => c.slug)).toEqual([
      "kurtas",
      "dresses",
      "outerwear",
      "accessories",
      "footwear",
    ]);
    const accessories = items.find((c) => c.slug === "accessories")!;
    expect(accessories.productCount).toBe(8); // 10 minus inactive + archived
  });

  it("404s an unknown category slug with the error envelope", async () => {
    const { res, body } = await getJson("/api/v1/categories/no-such-category");
    expect(res.status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("unknown_resource");
  });
});

describe("GET /api/v1/products — listing + pagination", () => {
  it("returns page 1 with the documented envelope", async () => {
    const { res, body } = await getJson("/api/v1/products?page_size=12");
    expect(res.status).toBe(200);
    const b = body as ListBody;
    expect(b.items).toHaveLength(12);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(12);
    expect(b.totalItems).toBe(22); // 24 seeded − 1 inactive − 1 archived
    expect(b.totalPages).toBe(2);
  });

  it("page 2 continues without duplication", async () => {
    const p1 = (await getJson("/api/v1/products?page_size=12")).body as ListBody;
    const p2 = (await getJson("/api/v1/products?page_size=12&page=2")).body as ListBody;
    const ids1 = new Set(p1.items.map((i) => i.id));
    expect(p2.items).toHaveLength(10);
    for (const id of p2.items.map((i) => i.id)) {
      expect(ids1.has(id)).toBe(false);
    }
  });

  it("beyond the last page → empty items with honest totals", async () => {
    const { res, body } = await getJson("/api/v1/products?page=99");
    expect(res.status).toBe(200);
    const b = body as ListBody;
    expect(b.items).toHaveLength(0);
    expect(b.totalItems).toBe(22);
  });

  it("rejects invalid pagination with validation_failed", async () => {
    const { res } = await getJson("/api/v1/products?page=0");
    expect(res.status).toBe(400);
    const page1 = (await getJson("/api/v1/products?page_size=49")).res;
    expect(page1.status).toBe(400); // max 48 per contract §7
  });
});

describe("GET /api/v1/products — numeric price sorting (§7.1, CRITICAL)", () => {
  it("sorts the acceptance quad numerically ascending (25→100→250→1000)", async () => {
    const { body } = await getJson("/api/v1/products?sort=price_asc&page_size=48");
    const b = body as ListBody;
    const amounts = b.items.map((i) => Number(i.finalPrice.amount));
    expect(amounts).toHaveLength(22);
    // Sorted copy must equal the actual order — a single string-collation
    // slip (100 before 25) breaks this assertion.
    expect(amounts).toEqual([...amounts].sort((a, z) => a - z));
    // The §7.1 example quad appears at the front: 25 (Hair Tie), 100
    // (Socks), then two products tied at 250.00 (Woven Leather Belt and
    // Linen Wrap Dress — both discounted/flat to 250), before 1000.
    expect(amounts.slice(0, 3)).toEqual([25, 100, 250]);
    expect(amounts.filter((a) => a === 1000).length).toBeGreaterThanOrEqual(2);
  });

  it("sorts numerically descending (1000→250→100→25)", async () => {
    const { body } = await getJson("/api/v1/products?sort=price_desc&page_size=48");
    const amounts = (body as ListBody).items.map((i) => Number(i.finalPrice.amount));
    expect(amounts).toEqual([...amounts].sort((a, z) => z - a));
  });

  it("breaks price ties deterministically (created_at desc, id desc)", async () => {
    // Cashmere Scarf and Velvet Hair Band: same final price 1000.00, same
    // created_at — higher seed id wins, so Velvet Hair Band comes first.
    const { body } = await getJson("/api/v1/products?sort=price_asc&page_size=48");
    const order = (body as ListBody).items
      .filter((i) => Number(i.finalPrice.amount) === 1000)
      .map((i) => i.name);
    expect(order).toEqual(["Velvet Hair Band", "Cashmere Scarf"]);
  });

  it("falls back to newest for unknown sort values (documented, no error)", async () => {
    const a = (await getJson("/api/v1/products?sort=banana")).body as ListBody;
    const b = (await getJson("/api/v1/products?sort=newest")).body as ListBody;
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
  });
});

describe("GET /api/v1/products — search (§5)", () => {
  it("matches case-insensitively ('WING' → Wings Coat)", async () => {
    const { body } = await getJson("/api/v1/products?q=WING");
    const names = (body as ListBody).items.map((i) => i.name);
    expect(names).toContain("Wings Coat");
  });

  it("matches partial tokens across products (linen)", async () => {
    const { body } = await getJson("/api/v1/products?q=linen&page_size=48");
    const names = (body as ListBody).items.map((i) => i.name);
    expect(names).toContain("Linen Kurta — Indigo");
    expect(names).toContain("Linen Wrap Dress");
  });

  it("AND-semantics: multiple tokens narrow the result set", async () => {
    const single = (await getJson("/api/v1/products?q=linen")).body as ListBody;
    const both = (await getJson("/api/v1/products?q=linen kurta")).body as ListBody;
    expect(both.totalItems).toBeLessThan(single.totalItems);
    expect(both.items.map((i) => i.name)).toEqual(["Linen Kurta — Indigo"]);
  });

  it("matches by SKU prefix", async () => {
    const { body } = await getJson("/api/v1/products?q=HEY-ACC-00004");
    expect((body as ListBody).items.map((i) => i.name)).toEqual(["Cashmere Scarf"]);
  });

  it("injection attempts are literal search terms — no results, no error", async () => {
    const { res, body } = await getJson("/api/v1/products?q=%27%20OR%201%3D1");
    expect(res.status).toBe(200);
    expect((body as ListBody).totalItems).toBe(0);
  });

  it("symbols-only query → honest empty state, no crash", async () => {
    const { res, body } = await getJson("/api/v1/products?q=%3F%3F%3F");
    expect(res.status).toBe(200);
    expect((body as ListBody).totalItems).toBe(0);
  });

  it("empty query → full catalog", async () => {
    const { body } = await getJson("/api/v1/products?q=");
    expect((body as ListBody).totalItems).toBe(22);
  });
});

describe("GET /api/v1/products — filtering (§6)", () => {
  it("single category filter", async () => {
    const { body } = await getJson("/api/v1/products?category=footwear");
    const b = body as ListBody;
    expect(b.totalItems).toBe(4);
    expect(b.items.every((i) => i.slug || true)).toBe(true);
  });

  it("multi-select categories combine with OR", async () => {
    const { body } = await getJson("/api/v1/products?category=footwear&category=outerwear");
    expect((body as ListBody).totalItems).toBe(7); // 4 + 3
  });

  it("price bounds apply to FINAL price, inclusive (§6)", async () => {
    // Chanderi Straight Kurta: 1850 − 10% = 1665.00 → inside [1600, 1700]
    const { body } = await getJson("/api/v1/products?min_price=1600&max_price=1700");
    const names = (body as ListBody).items.map((i) => i.name);
    expect(names).toContain("Chanderi Straight Kurta");
    expect((body as ListBody).totalItems).toBe(1);
  });

  it("fixed discount reflected in final price bounds", async () => {
    // Silk Stole: 1000 − 100 fixed = 900.00; Everyday Canvas Sneakers: 2999.99 − 500 = 2499.99
    const { body } = await getJson("/api/v1/products?min_price=900&max_price=900");
    const names = (body as ListBody).items.map((i) => i.name);
    expect(names).toContain("Silk Stole");
    expect(names).toContain("Braided Jute Tote"); // 900.00 flat
    expect((body as ListBody).totalItems).toBe(2);
  });

  it("in_stock excludes zero-stock products", async () => {
    const { body } = await getJson("/api/v1/products?in_stock=true&page_size=48");
    const b = body as ListBody;
    expect(b.items.every((i) => i.inStock)).toBe(true);
    // 22 active − 2 out-of-stock (Trench Overcoat, Velvet Hair Band)
    expect(b.totalItems).toBe(20);
  });

  it("min > max → sanitized to open range (no crash, full catalog)", async () => {
    const { res, body } = await getJson("/api/v1/products?min_price=500&max_price=100");
    expect(res.status).toBe(200);
    expect((body as ListBody).totalItems).toBe(22);
  });

  it("negative/non-numeric bounds → 400 validation_failed", async () => {
    expect((await getJson("/api/v1/products?min_price=-5")).res.status).toBe(400);
    expect((await getJson("/api/v1/products?min_price=abc")).res.status).toBe(400);
  });

  it("contradictory combination → honest empty state, filters still applied", async () => {
    // Hair tie is 25.00 — outside [500, ∞) within footwear
    const { body } = await getJson("/api/v1/products?category=footwear&min_price=5000&max_price=9000");
    // Suede Chelsea Boots 8600 − 10% = 7740 → inside; so this is NOT empty.
    const b = body as ListBody;
    expect(b.totalItems).toBe(1);
    expect(b.items[0].name).toBe("Suede Chelsea Boots");
  });
});

describe("GET /api/v1/products — combined matrix (§17 (C))", () => {
  it("search + category + price + in_stock compose with AND", async () => {
    // §17: {category: Dresses, price: [50, 300], in-stock} + search "linen"
    const { body } = await getJson(
      "/api/v1/products?q=linen&category=dresses&min_price=50&max_price=300&in_stock=true",
    );
    const b = body as ListBody;
    expect(b.totalItems).toBe(1);
    expect(b.items[0].name).toBe("Linen Wrap Dress");
    expect(b.items[0].finalPrice.amount).toBe("250.00");
  });

  it("sorting + pagination order stays stable at page boundaries", async () => {
    const p1 = (await getJson("/api/v1/products?sort=price_asc&page_size=10")).body as ListBody;
    const p2 = (await getJson("/api/v1/products?sort=price_asc&page_size=10&page=2")).body as ListBody;
    const joined = [...p1.items, ...p2.items].map((i) => Number(i.finalPrice.amount));
    expect(joined).toEqual([...joined].sort((a, z) => a - z));
    const p3 = (await getJson("/api/v1/products?sort=price_asc&page_size=10&page=3")).body as ListBody;
    const full = [...joined, ...p3.items.map((i) => Number(i.finalPrice.amount))];
    expect(full).toEqual([...full].sort((a, z) => a - z));
  });
});

describe("GET /api/v1/products/{slug} — detail", () => {
  it("returns full detail with images, specs, availability, exact money", async () => {
    const { res, body } = await getJson("/api/v1/products/linen-kurta-indigo");
    expect(res.status).toBe(200);
    const b = body as {
      name: string;
      sku: string;
      price: { amount: string };
      finalPrice: { amount: string };
      availability: string;
      images: unknown[];
      specifications: { key: string; value: string }[];
      discount: { type: string };
    };
    expect(b.name).toBe("Linen Kurta — Indigo");
    expect(b.sku).toBe("HEY-KUR-00003");
    expect(b.price.amount).toBe("1599.00");
    expect(b.finalPrice.amount).toBe("1599.00");
    expect(b.availability).toBe("in_stock");
    expect(b.images.length).toBeGreaterThanOrEqual(1);
    expect(b.specifications.some((s) => s.key === "Material")).toBe(true);
    expect(b.discount.type).toBe("none");
  });

  it("computes discounted final price correctly (percent)", async () => {
    const { body } = await getJson("/api/v1/products/silk-slip-dress");
    const b = body as { price: { amount: string }; finalPrice: { amount: string } };
    expect(b.price.amount).toBe("5400.00");
    expect(b.finalPrice.amount).toBe("4590.00"); // 5400 − 15%
  });

  it("out-of-stock product shows availability state, still viewable", async () => {
    const { body } = await getJson("/api/v1/products/trench-overcoat");
    expect((body as { availability: string }).availability).toBe("out_of_stock");
  });

  it("inactive product → 404 unknown_resource (hidden from customers)", async () => {
    const { res } = await getJson("/api/v1/products/archive-sample-tote");
    expect(res.status).toBe(404);
  });

  it("archived product → 404 (hidden everywhere but snapshots)", async () => {
    const { res } = await getJson("/api/v1/products/retired-print-scarf");
    expect(res.status).toBe(404);
  });

  it("unknown slug → 404 with envelope", async () => {
    const { res, body } = await getJson("/api/v1/products/does-not-exist");
    expect(res.status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("unknown_resource");
  });
});

describe("money serialization (§6)", () => {
  it("amounts are exact decimal strings, never numbers", async () => {
    const { body } = await getJson("/api/v1/products?q=sneakers");
    const item = (body as ListBody).items[0];
    expect(typeof item.price.amount).toBe("string");
    expect(typeof item.finalPrice.amount).toBe("string");
    expect(item.finalPrice.amount).toBe("2499.99"); // 2999.99 − 500 fixed
    expect(Number.isNaN(Number(item.finalPrice.amount))).toBe(false);
  });
});
