import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Cart data access — the ONLY layer that touches Prisma for carts
 * (ARCHITECTURE §3). Repositories fetch/store; business decisions live in
 * the service. All reads that shape customer responses pull the product
 * JOIN so every response is recomputed from current catalog state
 * (API_CONTRACT §3: the server never trusts a stored price).
 */

/** Row shape for a cart line joined with live product data. */
export interface CartLineRow {
  itemId: bigint;
  productId: bigint;
  quantity: number;
  name: string;
  slug: string;
  sku: string;
  price: Prisma.Decimal;
  discountType: string;
  discountValue: Prisma.Decimal | null;
  status: string;
  stockQuantity: number;
  categorySlug: string;
  imagePath: string | null;
  imageAlt: string | null;
}

export const cartRepository = {
  /** Find the active cart for a user (one per user, enforced by unique index). */
  findCartByUserId(userId: bigint) {
    return prisma.cart.findUnique({ where: { userId } });
  },

  /** Find the guest cart keyed by the hashed session token. */
  findCartBySessionToken(sessionToken: string) {
    return prisma.cart.findUnique({ where: { sessionToken } });
  },

  createCart(data: { userId?: bigint; sessionToken?: string }) {
    return prisma.cart.create({ data });
  },

  /** Get a cart by id, verifying its identity (used for ownership checks). */
  findCartById(cartId: bigint) {
    return prisma.cart.findUnique({ where: { id: cartId } });
  },

  /**
   * All lines of a cart joined with live product + primary image. Availability,
   * pricing, and totals are derived from these CURRENT values — never from
   * anything stored at add time.
   */
  async listLines(cartId: bigint): Promise<CartLineRow[]> {
    const rows = await prisma.$queryRaw<CartLineRow[]>(Prisma.sql`
      SELECT ci.id            AS "itemId",
             p.id             AS "productId",
             ci.quantity      AS quantity,
             p.name           AS name,
             p.slug           AS slug,
             p.sku            AS sku,
             p.price          AS price,
             p.discount_type  AS "discountType",
             p.discount_value AS "discountValue",
             p.status         AS status,
             p.stock_quantity AS "stockQuantity",
             c.slug           AS "categorySlug",
             img.file_path    AS "imagePath",
             img.alt_text     AS "imageAlt"
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT file_path, alt_text
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.position ASC
        LIMIT 1
      ) img ON true
      WHERE ci.cart_id = ${cartId}
      ORDER BY ci.created_at ASC, ci.id ASC
    `);
    return rows;
  },

  /** A single line, ownership-checked by cart id (never trusts client ids alone). */
  findLine(lineId: bigint, cartId: bigint) {
    return prisma.cartItem.findFirst({ where: { id: lineId, cartId } });
  },

  findLineByProduct(cartId: bigint, productId: bigint) {
    return prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId } },
    });
  },

  createLine(cartId: bigint, productId: bigint, quantity: number) {
    return prisma.cartItem.create({ data: { cartId, productId, quantity } });
  },

  updateLineQuantity(lineId: bigint, quantity: number) {
    return prisma.cartItem.update({ where: { id: lineId }, data: { quantity } });
  },

  deleteLine(lineId: bigint) {
    return prisma.cartItem.delete({ where: { id: lineId } });
  },

  deleteCart(cartId: bigint) {
    return prisma.cart.delete({ where: { id: cartId } });
  },
};
