import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { CatalogRepository, ProductListRow } from "./catalog.types.js";

/**
 * Catalog data access — the ONLY layer that touches Prisma for catalog
 * (ARCHITECTURE §3). Final price is computed in SQL as an exact numeric
 * expression so filtering (§6: bounds apply to final price, inclusive)
 * and sorting (§7.1: numeric, never string collation) are correct.
 */
export const catalogRepository: CatalogRepository = {
  async listCategories(includeHidden) {
    const rows = await prisma.$queryRaw<
      { id: bigint; name: string; slug: string; product_count: bigint }[]
    >(Prisma.sql`
      SELECT c.id, c.name, c.slug,
             COUNT(p.id) FILTER (WHERE p.status = 'active') AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      ${includeHidden ? Prisma.empty : Prisma.sql`WHERE c.is_active = true`}
      GROUP BY c.id, c.name, c.slug, c.sort_order
      ORDER BY c.sort_order ASC, c.name ASC
    `);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      productCount: Number(r.product_count),
    }));
  },

  findCategoryBySlug(slug) {
    return prisma.category.findFirst({
      select: { id: true, name: true, slug: true, isActive: true },
      where: { slug },
    });
  },

  async listProducts({
    categoryIds,
    searchTokens,
    minFinalPrice,
    maxFinalPrice,
    inStockOnly,
    sortClause,
    page,
    pageSize,
  }) {
    const conditions: Prisma.Sql[] = [Prisma.sql`p.status = 'active'`];

    if (categoryIds.length > 0) {
      conditions.push(Prisma.sql`p.category_id IN (${Prisma.join(categoryIds)})`);
    }

    // §5: multiple tokens = AND semantics; token matches name/category
    // (substring) or description (weighted lower) or SKU (prefix).
    for (const token of searchTokens) {
      const like = `%${token}%`;
      conditions.push(Prisma.sql`
        (
          p.name ILIKE ${like}
          OR c.name ILIKE ${like}
          OR p.sku ILIKE ${token + "%"}
          OR p.description ILIKE ${like}
        )
      `);
    }

    // Exact NUMERIC expression — the single definition of final price.
    // Declared before the WHERE build because price-bound filters must
    // inline it (a SELECT alias is invisible to WHERE in PostgreSQL).
    const finalPrice = Prisma.sql`
      CASE p.discount_type
        WHEN 'percent' THEN ROUND(p.price * (1 - p.discount_value / 100), 2)
        WHEN 'fixed'   THEN ROUND(p.price - p.discount_value, 2)
        ELSE p.price
      END
    `;

    if (minFinalPrice !== null) {
      conditions.push(Prisma.sql`${finalPrice} >= ${minFinalPrice}`);
    }
    if (maxFinalPrice !== null) {
      conditions.push(Prisma.sql`${finalPrice} <= ${maxFinalPrice}`);
    }
    if (inStockOnly) {
      conditions.push(Prisma.sql`p.stock_quantity > 0`);
    }

    const where = Prisma.join(conditions, " AND ");

    const baseFrom = Prisma.sql`
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT file_path, alt_text
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.position ASC
        LIMIT 1
      ) img ON true
    `;

    // Two queries (count + page) — a window-function count dies when the
    // page is empty (beyond last), and honest totals must survive that.
    const countRows = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS total
      ${baseFrom}
      WHERE ${where}
    `);
    const totalItems = Number(countRows[0]?.total ?? 0);

    // COUNT(*) OVER() — one roundtrip for the page plus honest totals.
    const rows = await prisma.$queryRaw<
      (Omit<ProductListRow, "primaryImage"> & {
        primaryImageFilePath: string | null;
        primaryImageAltText: string | null;
      })[]
    >(Prisma.sql`
      SELECT p.id, p.name, p.slug, p.price, p.discount_type AS "discountType", p.discount_value AS "discountValue",
             p.stock_quantity AS "stockQuantity", p.created_at AS "createdAt",
             c.name AS "categoryName", c.slug AS "categorySlug",
             img.file_path AS "primaryImageFilePath", img.alt_text AS "primaryImageAltText",
             ${finalPrice} AS "finalPrice"
      ${baseFrom}
      WHERE ${where}
      ORDER BY ${sortClause}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);

    const mapped: ProductListRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      price: r.price,
      discountType: r.discountType,
      discountValue: r.discountValue,
      finalPrice: r.finalPrice,
      stockQuantity: r.stockQuantity,
      createdAt: r.createdAt,
      categoryName: r.categoryName,
      categorySlug: r.categorySlug,
      primaryImage:
        r.primaryImageFilePath && r.primaryImageAltText
          ? { filePath: r.primaryImageFilePath, altText: r.primaryImageAltText }
          : null,
    }));

    return { rows: mapped, totalItems };
  },

  async findProductBySlug(slug, includeHidden) {
    const row = await prisma.product.findFirst({
      where: includeHidden ? { slug } : { slug, status: { not: "archived" } },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        description: true,
        price: true,
        discountType: true,
        discountValue: true,
        status: true,
        stockQuantity: true,
        lowStockThreshold: true,
        createdAt: true,
        category: { select: { name: true, slug: true } },
        images: {
          select: { filePath: true, altText: true, position: true },
          orderBy: { position: "asc" },
        },
        specifications: { select: { specKey: true, specValue: true } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      sku: row.sku,
      description: row.description,
      price: row.price,
      discountType: row.discountType,
      discountValue: row.discountValue,
      status: row.status,
      stockQuantity: row.stockQuantity,
      lowStockThreshold: row.lowStockThreshold,
      createdAt: row.createdAt,
      categoryName: row.category.name,
      categorySlug: row.category.slug,
      images: row.images.map((i) => ({
        filePath: i.filePath,
        altText: i.altText,
        position: i.position,
      })),
      specifications: row.specifications.map((s) => ({
        specKey: s.specKey,
        specValue: s.specValue,
      })),
    };
  },
};
