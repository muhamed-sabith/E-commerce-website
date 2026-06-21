import type { Prisma } from "@prisma/client";

/**
 * List-row shape returned by the SQL query — final price is computed by the
 * database (exact NUMERIC) so every consumer agrees on one definition.
 */
export interface ProductListRow {
  id: bigint;
  name: string;
  slug: string;
  price: Prisma.Decimal;
  discountType: string;
  discountValue: Prisma.Decimal | null;
  /** Exact final price after discount, computed in SQL (NUMERIC). */
  finalPrice: Prisma.Decimal;
  stockQuantity: number;
  createdAt: Date;
  categoryName: string;
  categorySlug: string;
  primaryImage: { filePath: string; altText: string } | null;
}

export interface CatalogRepository {
  listCategories(includeHidden: boolean): Promise<
    {
      id: bigint;
      name: string;
      slug: string;
      productCount: number;
    }[]
  >;

  findCategoryBySlug(slug: string): Promise<{
    id: bigint;
    name: string;
    slug: string;
    isActive: boolean;
  } | null>;

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

  findProductBySlug(
    slug: string,
    includeHidden: boolean,
  ): Promise<{
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
    lowStockThreshold: number | null;
    createdAt: Date;
    categoryName: string;
    categorySlug: string;
    images: { filePath: string; altText: string; position: number }[];
    specifications: { specKey: string; specValue: string }[];
  } | null>;
}
