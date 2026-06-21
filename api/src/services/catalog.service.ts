import { Prisma } from "@prisma/client";
import type { ProductListRow } from "../repositories/catalog.types.js";
import { ApiError } from "../middleware/error.js";

/**
 * Catalog business rules (REQUIREMENTS §5–§7, API_CONTRACT §2/§5/§6).
 * Layering: controllers translate HTTP ↔ this service; the service owns
 * every business decision; repositories only fetch/store.
 */

// ---------- shared catalog types ----------

export interface Money {
  /** Exact decimal string per API_CONTRACT §6 — never a float on the wire. */
  amount: string;
}

export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  categoryName: string;
  categorySlug: string;
  price: Money;
  finalPrice: Money;
  discount:
    | { type: "none" }
    | { type: "percent"; value: Money }
    | { type: "fixed"; value: Money };
  inStock: boolean;
  image: { src: string; alt: string } | null;
}

export interface ProductListResult {
  items: ProductListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  productCount: number;
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  categoryName: string;
  categorySlug: string;
  price: Money;
  finalPrice: Money;
  discount:
    | { type: "none" }
    | { type: "percent"; value: Money }
    | { type: "fixed"; value: Money };
  availability: "in_stock" | "out_of_stock";
  images: { src: string; alt: string }[];
  specifications: { key: string; value: string }[];
}

// ---------- pricing (single definition, reused everywhere) ----------

/**
 * The one place final price is computed in application code. The database
 * computes the same expression in SQL for filter/sort correctness; this
 * mirrors it for response shaping. Inputs come from DB rows, never clients.
 */
export function computeFinalPrice(
  price: Prisma.Decimal,
  discountType: string,
  discountValue: Prisma.Decimal | null,
): Prisma.Decimal {
  switch (discountType) {
    case "percent":
      return price.mul(Prisma.Decimal(1).minus(discountValue!.div(100)));
    case "fixed":
      return price.minus(discountValue!);
    default:
      return price;
  }
}

/** Exact decimal string — API_CONTRACT §6: money is never a JSON number. */
function money(d: Prisma.Decimal): Money {
  return { amount: d.toFixed(2) };
}

// ---------- sort contract (API_CONTRACT §5) ----------

const SORTS: Record<string, Prisma.Sql> = {
  price_asc: Prisma.sql`"finalPrice" ASC, p.created_at DESC, p.id DESC`,
  price_desc: Prisma.sql`"finalPrice" DESC, p.created_at DESC, p.id DESC`,
  newest: Prisma.sql`p.created_at DESC, p.id DESC`,
  name_asc: Prisma.sql`p.name ASC, p.created_at DESC, p.id DESC`,
  name_desc: Prisma.sql`p.name DESC, p.created_at DESC, p.id DESC`,
};

function resolveSort(sort: string | undefined): Prisma.Sql {
  // Unknown/garbage → documented default `newest`, never an error (§5).
  return SORTS[sort ?? ""] ?? SORTS.newest;
}

// ---------- search tokenization (REQUIREMENTS §5) ----------

/**
 * Trim, lowercase, collapse internal whitespace, split into AND tokens.
 * Cap length so oversized input degrades to "no results", not a crash.
 * Tokens are parameters in the repository — injection-safe by construction.
 */
export function tokenizeSearch(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const collapsed = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (collapsed.length === 0) return [];
  return collapsed.split(" ").filter((t) => t.length > 0).slice(0, 8);
}

// ---------- validation schemas (Zod) ----------

import { z } from "zod";

const decimalString = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "must be a non-negative decimal amount");

export const catalogQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  min_price: decimalString.optional(),
  max_price: decimalString.optional(),
  in_stock: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  sort: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(48).default(12),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

// ---------- catalog service ----------

export interface CatalogDataSource {
  listCategories(includeHidden: boolean): Promise<
    { id: bigint; name: string; slug: string; productCount: number }[]
  >;
  findCategoryBySlug(
    slug: string,
  ): Promise<{ id: bigint; name: string; slug: string; isActive: boolean } | null>;
  listProducts(options: {
    categoryIds: bigint[];
    searchTokens: string[];
    minFinalPrice: Prisma.Decimal | null;
    maxFinalPrice: Prisma.Decimal | null;
    inStockOnly: boolean;
    sortClause: Prisma.Sql;
    page: number;
    pageSize: number;
  }): Promise<{ rows: ProductListRow[]; totalItems: number }>;
  findProductBySlug(slug: string, includeHidden: boolean): Promise<{
    id: bigint;
    name: string;
    slug: string;
    sku: string;
    description: string;
    price: Prisma.Decimal;
    discountType: string;
    discountValue: Prisma.Decimal | null;
    status: string;
    stockQuantity: number;
    createdAt: Date;
    categoryName: string;
    categorySlug: string;
    images: { filePath: string; altText: string; position: number }[];
    specifications: { specKey: string; specValue: string }[];
  } | null>;
}

export function createCatalogService(dataSource: CatalogDataSource) {
  return {
    async listCategories(includeHidden = false): Promise<CategorySummary[]> {
      const rows = await dataSource.listCategories(includeHidden);
      return rows.map((r) => ({
        id: r.id.toString(),
        name: r.name,
        slug: r.slug,
        productCount: r.productCount,
      }));
    },

    /**
     * Resolve category filter slugs → ids. Unknown slugs yield an empty
     * intersection (empty result set, not a 404) per REQUIREMENTS §6.
     */
    async resolveCategoryIds(slugs: string[]): Promise<bigint[]> {
      if (slugs.length === 0) return [];
      const matched = await Promise.all(slugs.map((s) => dataSource.findCategoryBySlug(s)));
      return matched.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => c.id);
    },

    toListResult(rows: ProductListRow[], page: number, pageSize: number, totalItems: number): ProductListResult {
      return {
        items: rows.map(toListItem),
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      };
    },

    async listProducts(query: CatalogQuery): Promise<ProductListResult> {
      const slugs = normalizeCategorySlugs(query.category);
      const categoryIds = await this.resolveCategoryIds(slugs);
      const searchTokens = tokenizeSearch(query.q);

      // §6: bounds apply to FINAL price, inclusive. Contradictory range →
      // filter ignored (§6: server rejects nonsense bounds with a notice —
      // we keep the documented "sanitize to open range" behavior).
      let minFinal = query.min_price ? new Prisma.Decimal(query.min_price) : null;
      let maxFinal = query.max_price ? new Prisma.Decimal(query.max_price) : null;
      if (minFinal !== null && maxFinal !== null && minFinal.greaterThan(maxFinal)) {
        [minFinal, maxFinal] = [null, null];
      }

      const sortClause = resolveSort(query.sort);

      const { rows, totalItems } = await dataSource.listProducts({
        categoryIds,
        searchTokens,
        minFinalPrice: minFinal,
        maxFinalPrice: maxFinal,
        inStockOnly: query.in_stock,
        sortClause,
        page: query.page,
        pageSize: query.page_size,
      });

      return this.toListResult(rows, query.page, query.page_size, totalItems);
    },

    async getProductBySlug(slug: string): Promise<ProductDetail> {
      const row = await dataSource.findProductBySlug(slug, false);
      if (!row || row.status === "inactive") {
        // Inactive → hidden from customers; archived → hidden everywhere
        // except order snapshots. Both are unknown_resource to the visitor.
        throw new ApiError(404, "unknown_resource", "Product not found");
      }
      return toDetail(row);
    },

    /** Category landing metadata (API_CONTRACT §2). Inactive → 404. */
    async getCategoryBySlug(slug: string): Promise<{
      name: string;
      slug: string;
      productCount: number;
    }> {
      const category = await dataSource.findCategoryBySlug(slug);
      if (!category || !category.isActive) {
        throw new ApiError(404, "unknown_resource", "Category not found");
      }
      const all = await dataSource.listCategories(false);
      const summary = all.find((c) => c.id === category.id);
      return {
        name: category.name,
        slug: category.slug,
        productCount: summary?.productCount ?? 0,
      };
    },
  };
}

function normalizeCategorySlugs(category: string | string[] | undefined): string[] {
  if (!category) return [];
  const list = Array.isArray(category) ? category : [category];
  return list
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.length <= 90)
    .slice(0, 10); // sane cap; facet is small by construction
}

// ---------- row → API shape ----------

function discountOf(
  discountType: string,
  discountValue: Prisma.Decimal | null,
): ProductListItem["discount"] {
  if (discountType === "percent" && discountValue !== null) {
    return { type: "percent", value: money(discountValue) };
  }
  if (discountType === "fixed" && discountValue !== null) {
    return { type: "fixed", value: money(discountValue) };
  }
  return { type: "none" };
}

function toListItem(row: ProductListRow): ProductListItem {
  return {
    id: row.id.toString(),
    name: row.name,
    slug: row.slug,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    price: money(row.price),
    finalPrice: money(row.finalPrice),
    discount: discountOf(row.discountType, row.discountValue),
    inStock: row.stockQuantity > 0,
    image: row.primaryImage
      ? { src: `/assets/${row.primaryImage.filePath}`, alt: row.primaryImage.altText }
      : null,
  };
}

function toDetail(row: NonNullable<Awaited<ReturnType<CatalogDataSource["findProductBySlug"]>>>): ProductDetail {
  return {
    id: row.id.toString(),
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    description: row.description,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    price: money(row.price),
    finalPrice: money(computeFinalPrice(row.price, row.discountType, row.discountValue)),
    discount: discountOf(row.discountType, row.discountValue),
    availability: row.stockQuantity > 0 ? "in_stock" : "out_of_stock",
    images: row.images.map((i) => ({ src: `/assets/${i.filePath}`, alt: i.altText })),
    specifications: row.specifications.map((s) => ({ key: s.specKey, value: s.specValue })),
  };
}
