// HEYRAH — deterministic development seed (repeatable: full reset + recreate).
// Realistic catalog data engineered against the acceptance cases:
//   §7.1 numeric sort — products priced exactly 25 / 100 / 250 / 1000
//   §17 search matrix — "linen" products, "Wings Coat", Dresses ∩ [50,300] ∩ in-stock
//   tie-breaks — equal final prices sharing created_at (order settles on id DESC)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ISO date helper — all timestamps fixed, so `newest` order is stable.
const at = (iso: string) => new Date(iso);

interface SeedImage {
  filePath: string;
  altText: string;
  position: number;
}
interface SeedSpec {
  key: string;
  value: string;
}
interface SeedProduct {
  name: string;
  sku: string;
  price: string;
  discountType: "none" | "percent" | "fixed";
  discountValue?: string;
  stock: number;
  status?: "active" | "inactive" | "archived";
  createdAt: string;
  images: SeedImage[];
  specs: SeedSpec[];
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function imagesFor(sku: string, name: string): SeedImage[] {
  const base = sku.toLowerCase().replace(/-/g, "");
  return [
    { filePath: `products/${base}-1.svg`, altText: `${name} — primary view`, position: 0 },
    { filePath: `products/${base}-2.svg`, altText: `${name} — alternate view`, position: 1 },
  ];
}

const CATEGORIES: { name: string; slug: string; sortOrder: number; isActive: boolean }[] = [
  { name: "Kurtas", slug: "kurtas", sortOrder: 1, isActive: true },
  { name: "Dresses", slug: "dresses", sortOrder: 2, isActive: true },
  { name: "Outerwear", slug: "outerwear", sortOrder: 3, isActive: true },
  { name: "Accessories", slug: "accessories", sortOrder: 4, isActive: true },
  { name: "Footwear", slug: "footwear", sortOrder: 5, isActive: true },
  { name: "Archive Preview", slug: "archive-preview", sortOrder: 6, isActive: false },
];

const PRODUCTS: { category: string; items: SeedProduct[] }[] = [
  {
    category: "kurtas",
    items: [
      {
        name: "Cotton Silk Kurta Set",
        sku: "HEY-KUR-00001",
        price: "2450.00",
        discountType: "none",
        stock: 24,
        createdAt: "2026-06-21T11:00:00+05:30",
        images: imagesFor("HEY-KUR-00001", "Cotton Silk Kurta Set"),
        specs: [
          { key: "Material", value: "Cotton silk blend" },
          { key: "Care", value: "Dry clean recommended" },
          { key: "Fit", value: "Straight" },
        ],
      },
      {
        name: "Chanderi Straight Kurta",
        sku: "HEY-KUR-00002",
        price: "1850.00",
        discountType: "percent",
        discountValue: "10.00",
        stock: 12,
        createdAt: "2026-06-24T15:30:00+05:30",
        images: imagesFor("HEY-KUR-00002", "Chanderi Straight Kurta"),
        specs: [
          { key: "Material", value: "Chanderi cotton" },
          { key: "Care", value: "Gentle hand wash" },
        ],
      },
      {
        name: "Linen Kurta — Indigo",
        sku: "HEY-KUR-00003",
        price: "1599.00",
        discountType: "none",
        stock: 30,
        createdAt: "2026-07-02T10:15:00+05:30",
        images: imagesFor("HEY-KUR-00003", "Linen Kurta Indigo"),
        specs: [
          { key: "Material", value: "Pure linen" },
          { key: "Care", value: "Machine wash cold" },
        ],
      },
    ],
  },
  {
    category: "dresses",
    items: [
      {
        name: "Linen Wrap Dress",
        sku: "HEY-DRS-00001",
        price: "250.00",
        discountType: "none",
        stock: 10,
        createdAt: "2026-07-05T12:00:00+05:30",
        images: imagesFor("HEY-DRS-00001", "Linen Wrap Dress"),
        specs: [
          { key: "Material", value: "Linen viscose" },
          { key: "Care", value: "Hand wash" },
          { key: "Length", value: "Midi" },
        ],
      },
      {
        name: "Midnight Evening Gown",
        sku: "HEY-DRS-00002",
        price: "10000.00",
        discountType: "none",
        stock: 3,
        createdAt: "2026-07-09T18:45:00+05:30",
        images: imagesFor("HEY-DRS-00002", "Midnight Evening Gown"),
        specs: [
          { key: "Material", value: "Crepe silk" },
          { key: "Care", value: "Professional dry clean" },
        ],
      },
      {
        name: "Tiered Midi Dress",
        sku: "HEY-DRS-00003",
        price: "3200.00",
        discountType: "fixed",
        discountValue: "400.00",
        stock: 8,
        createdAt: "2026-07-14T09:20:00+05:30",
        images: imagesFor("HEY-DRS-00003", "Tiered Midi Dress"),
        specs: [
          { key: "Material", value: "Cotton poplin" },
          { key: "Care", value: "Machine wash cold" },
        ],
      },
      {
        name: "Silk Slip Dress",
        sku: "HEY-DRS-00004",
        price: "5400.00",
        discountType: "percent",
        discountValue: "15.00",
        stock: 5,
        createdAt: "2026-08-01T16:10:00+05:30",
        images: imagesFor("HEY-DRS-00004", "Silk Slip Dress"),
        specs: [
          { key: "Material", value: "Mulberry silk" },
          { key: "Care", value: "Dry clean only" },
        ],
      },
    ],
  },
  {
    category: "outerwear",
    items: [
      {
        name: "Wings Coat",
        sku: "HEY-OUT-00001",
        price: "3500.00",
        discountType: "none",
        stock: 7,
        createdAt: "2026-07-20T13:40:00+05:30",
        images: imagesFor("HEY-OUT-00001", "Wings Coat"),
        specs: [
          { key: "Material", value: "Wool blend twill" },
          { key: "Care", value: "Dry clean" },
          { key: "Lining", value: "Satin" },
        ],
      },
      {
        name: "Trench Overcoat",
        sku: "HEY-OUT-00002",
        price: "7200.00",
        discountType: "none",
        stock: 0, // out of stock — unpurchasable, excluded by in_stock filter
        createdAt: "2026-06-30T10:00:00+05:30",
        images: imagesFor("HEY-OUT-00002", "Trench Overcoat"),
        specs: [
          { key: "Material", value: "Cotton gabardine" },
          { key: "Care", value: "Dry clean" },
        ],
      },
      {
        name: "Quilted Sherpa Jacket",
        sku: "HEY-OUT-00003",
        price: "6100.00",
        discountType: "percent",
        discountValue: "12.50",
        stock: 9,
        createdAt: "2026-08-08T11:55:00+05:30",
        images: imagesFor("HEY-OUT-00003", "Quilted Sherpa Jacket"),
        specs: [
          { key: "Material", value: "Recycled polyester" },
          { key: "Care", value: "Machine wash gentle" },
        ],
      },
    ],
  },
  {
    category: "accessories",
    items: [
      // §7.1 acceptance quad — 25 / 100 / 250 / 1000 must sort numerically.
      {
        name: "Cotton Hair Tie",
        sku: "HEY-ACC-00001",
        price: "25.00",
        discountType: "none",
        stock: 200,
        createdAt: "2026-07-25T09:00:00+05:30",
        images: imagesFor("HEY-ACC-00001", "Cotton Hair Tie"),
        specs: [{ key: "Material", value: "Organic cotton" }],
      },
      {
        name: "Ribbed Ankle Socks",
        sku: "HEY-ACC-00002",
        price: "100.00",
        discountType: "none",
        stock: 150,
        createdAt: "2026-07-26T09:00:00+05:30",
        images: imagesFor("HEY-ACC-00002", "Ribbed Ankle Socks"),
        specs: [{ key: "Material", value: "Combed cotton" }],
      },
      {
        name: "Woven Leather Belt",
        sku: "HEY-ACC-00003",
        price: "250.00",
        discountType: "none",
        stock: 60,
        createdAt: "2026-07-27T09:00:00+05:30",
        images: imagesFor("HEY-ACC-00003", "Woven Leather Belt"),
        specs: [
          { key: "Material", value: "Vegetable-tanned leather" },
          { key: "Care", value: "Condition quarterly" },
        ],
      },
      {
        name: "Cashmere Scarf",
        sku: "HEY-ACC-00004",
        price: "1000.00",
        discountType: "none",
        stock: 40,
        createdAt: "2026-07-28T09:00:00+05:30",
        images: imagesFor("HEY-ACC-00004", "Cashmere Scarf"),
        specs: [
          { key: "Material", value: "100% cashmere" },
          { key: "Care", value: "Dry clean" },
        ],
      },
      {
        name: "Velvet Hair Band",
        sku: "HEY-ACC-00006",
        price: "1000.00",
        discountType: "none",
        stock: 0, // equal final price + same created_at as Cashmere Scarf — tie-break test; also out of stock
        createdAt: "2026-07-28T09:00:00+05:30",
        images: imagesFor("HEY-ACC-00006", "Velvet Hair Band"),
        specs: [{ key: "Material", value: "Velvet" }],
      },
      {
        name: "Silk Stole",
        sku: "HEY-ACC-00005",
        price: "1000.00",
        discountType: "fixed",
        discountValue: "100.00",
        stock: 25,
        createdAt: "2026-08-02T14:30:00+05:30",
        images: imagesFor("HEY-ACC-00005", "Silk Stole"),
        specs: [
          { key: "Material", value: "Silk modal" },
          { key: "Care", value: "Hand wash" },
        ],
      },
      {
        name: "Braided Jute Tote",
        sku: "HEY-ACC-00007",
        price: "900.00",
        discountType: "none",
        stock: 35,
        createdAt: "2026-08-12T10:30:00+05:30",
        images: imagesFor("HEY-ACC-00007", "Braided Jute Tote"),
        specs: [{ key: "Material", value: "Braided jute" }],
      },
      {
        name: "Minimal Leather Cardholder",
        sku: "HEY-ACC-00008",
        price: "1200.00",
        discountType: "none",
        stock: 50,
        createdAt: "2026-08-15T12:20:00+05:30",
        images: imagesFor("HEY-ACC-00008", "Minimal Leather Cardholder"),
        specs: [{ key: "Material", value: "Full-grain leather" }],
      },
      {
        name: "Archive Sample Tote",
        sku: "HEY-ACC-00009",
        price: "1500.00",
        discountType: "none",
        stock: 10,
        status: "inactive", // hidden from storefront lists + detail
        createdAt: "2026-09-10T10:00:00+05:30",
        images: imagesFor("HEY-ACC-00009", "Archive Sample Tote"),
        specs: [{ key: "Material", value: "Canvas" }],
      },
      {
        name: "Retired Print Scarf",
        sku: "HEY-ACC-00010",
        price: "800.00",
        discountType: "none",
        stock: 5,
        status: "archived", // hidden everywhere except future order snapshots
        createdAt: "2026-09-12T10:00:00+05:30",
        images: imagesFor("HEY-ACC-00010", "Retired Print Scarf"),
        specs: [{ key: "Material", value: "Silk twill" }],
      },
    ],
  },
  {
    category: "footwear",
    items: [
      {
        name: "Handloom Kolhapuri Sandals",
        sku: "HEY-FTW-00001",
        price: "2200.00",
        discountType: "none",
        stock: 18,
        createdAt: "2026-08-20T11:00:00+05:30",
        images: imagesFor("HEY-FTW-00001", "Handloom Kolhapuri Sandals"),
        specs: [
          { key: "Material", value: "Handwoven leather" },
          { key: "Sole", value: "TPR" },
        ],
      },
      {
        name: "Leather Loafers — Chestnut",
        sku: "HEY-FTW-00002",
        price: "4999.99",
        discountType: "none",
        stock: 14,
        createdAt: "2026-08-24T15:00:00+05:30",
        images: imagesFor("HEY-FTW-00002", "Leather Loafers Chestnut"),
        specs: [
          { key: "Material", value: "Calf leather" },
          { key: "Care", value: "Shine weekly" },
        ],
      },
      {
        name: "Suede Chelsea Boots",
        sku: "HEY-FTW-00003",
        price: "8600.00",
        discountType: "percent",
        discountValue: "10.00",
        stock: 6,
        createdAt: "2026-09-01T10:40:00+05:30",
        images: imagesFor("HEY-FTW-00003", "Suede Chelsea Boots"),
        specs: [
          { key: "Material", value: "Suede" },
          { key: "Care", value: "Brush after wear" },
        ],
      },
      {
        name: "Everyday Canvas Sneakers",
        sku: "HEY-FTW-00004",
        price: "2999.99",
        discountType: "fixed",
        discountValue: "500.00",
        stock: 22,
        createdAt: "2026-09-08T09:30:00+05:30",
        images: imagesFor("HEY-FTW-00004", "Everyday Canvas Sneakers"),
        specs: [{ key: "Material", value: "Canvas upper" }],
      },
    ],
  },
];

export async function seed(): Promise<{ categories: number; products: number }> {
  // FK-safe reset — repeatable: seed can run any number of times.
  await prisma.productSpecification.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();

  for (const c of CATEGORIES) {
    await prisma.category.create({
      data: {
        name: c.name,
        slug: c.slug,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        createdAt: at("2026-06-20T09:00:00+05:30"),
        updatedAt: at("2026-06-20T09:00:00+05:30"),
      },
    });
  }

  let count = 0;
  for (const group of PRODUCTS) {
    const category = await prisma.category.findUnique({ where: { slug: group.category } });
    if (!category) throw new Error(`seed: missing category ${group.category}`);
    for (const p of group.items) {
      await prisma.product.create({
        data: {
          name: p.name,
          slug: slugify(p.name),
          sku: p.sku,
          description: `${p.name} from the HEYRAH atelier — considered materials, quiet details, made to last beyond seasons.`,
          price: p.price,
          discountType: p.discountType,
          discountValue: p.discountValue ?? null,
          status: p.status ?? "active",
          stockQuantity: p.stock,
          createdAt: at(p.createdAt),
          updatedAt: at(p.createdAt),
          categoryId: category.id,
          images: { create: p.images },
          specifications: { create: p.specs.map((s) => ({ specKey: s.key, specValue: s.value })) },
        },
      });
      count += 1;
    }
  }
  return { categories: CATEGORIES.length, products: count };
}

async function main() {
  const result = await seed();
  console.log(
    `[seed] done: ${result.categories} categories, ${result.products} products (deterministic)`,
  );
}

// Auto-run only when executed directly (`npm run seed`), never on import —
// the test suite imports seed() and drives it itself.
async function isDirectRun(): Promise<boolean> {
  const arg = process.argv[1];
  if (!arg) return false;
  const { pathToFileURL } = await import("node:url");
  return import.meta.url === pathToFileURL(arg).href;
}

if (await isDirectRun()) {
  main()
    .catch((e) => {
      console.error("[seed] failed:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
