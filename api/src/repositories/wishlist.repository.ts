import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Wishlist data access — the only layer touching Prisma for wishlists
 * (ARCHITECTURE §3). Every query is scoped by user id; reads join LIVE
 * product state (no snapshot), so price/stock/status are always current.
 */

export interface WishlistRow {
  productId: bigint;
  createdAt: Date;
  name: string;
  slug: string;
  price: Prisma.Decimal;
  discountType: string;
  discountValue: Prisma.Decimal | null;
  status: string;
  stockQuantity: number;
  categoryName: string;
  imagePath: string | null;
  imageAlt: string | null;
}

export const wishlistRepository = {
  /** Saved products for one user, newest first, joined with live catalog data. */
  listForUser(userId: bigint): Promise<WishlistRow[]> {
    return prisma.$queryRaw<WishlistRow[]>(Prisma.sql`
      SELECT w.product_id      AS "productId",
             w.created_at      AS "createdAt",
             p.name            AS name,
             p.slug            AS slug,
             p.price           AS price,
             p.discount_type   AS "discountType",
             p.discount_value  AS "discountValue",
             p.status          AS status,
             p.stock_quantity  AS "stockQuantity",
             c.name            AS "categoryName",
             img.file_path     AS "imagePath",
             img.alt_text      AS "imageAlt"
      FROM wishlists w
      JOIN products p   ON p.id = w.product_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT file_path, alt_text
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.position ASC
        LIMIT 1
      ) img ON true
      WHERE w.user_id = ${userId}
      ORDER BY w.created_at DESC, w.product_id DESC
    `);
  },

  findProduct(productId: bigint) {
    return prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true },
    });
  },

  /** Idempotent: the composite PK makes a second insert a no-op. */
  async add(userId: bigint, productId: bigint): Promise<void> {
    await prisma.wishlistItem.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });
  },

  /** Returns true when a row owned by this user was removed. */
  async remove(userId: bigint, productId: bigint): Promise<boolean> {
    const { count } = await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
    return count > 0;
  },
};
