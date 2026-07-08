import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Order + inventory data access (ARCHITECTURE §3). Everything that must be
 * atomic takes the transaction client `tx`; row locks are explicit
 * (`SELECT … FOR UPDATE`) and always taken in ascending id order so two
 * concurrent checkouts can never deadlock each other.
 */

export type Tx = Prisma.TransactionClient;

/** stock_adjustments.reason CHECK values (DATABASE_SCHEMA §2.13). */
export type StockReason = "restock" | "correction" | "damaged" | "sale" | "cancel_restore" | "admin_set" | "initial";

export interface LockedProduct {
  id: bigint;
  name: string;
  sku: string;
  price: Prisma.Decimal;
  discountType: string;
  discountValue: Prisma.Decimal | null;
  status: string;
  stockQuantity: number;
}

export interface NewOrderItem {
  productId: bigint;
  productNameSnapshot: string;
  skuSnapshot: string;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  finalPrice: Prisma.Decimal;
  quantity: number;
  lineTotal: Prisma.Decimal;
}

export interface NewOrder {
  orderNumber: string;
  userId: bigint;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  shippingTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  ship: {
    receiverName: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
  };
  placedAt: Date;
}

export const orderRepository = {
  /** Serialize one user's checkouts (double-click / two tabs) — held until tx end. */
  async lockUser(tx: Tx, userId: bigint): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  },

  /** Row-lock products in ascending id order and return their current state. */
  lockProducts(tx: Tx, ids: bigint[]): Promise<LockedProduct[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.$queryRaw<LockedProduct[]>(Prisma.sql`
      SELECT id, name, sku, price,
             discount_type  AS "discountType",
             discount_value AS "discountValue",
             status,
             stock_quantity AS "stockQuantity"
      FROM products
      WHERE id IN (${Prisma.join(ids)})
      ORDER BY id
      FOR UPDATE
    `);
  },

  /**
   * Conditional decrement — the database refuses to go below zero even if
   * a caller's arithmetic were wrong. Returns the new quantity, or null
   * when the condition failed (nothing changed).
   */
  async decrementStock(tx: Tx, productId: bigint, qty: number): Promise<number | null> {
    const rows = await tx.$queryRaw<{ stock_quantity: number }[]>`
      UPDATE products
      SET stock_quantity = stock_quantity - ${qty}, updated_at = now()
      WHERE id = ${productId} AND stock_quantity >= ${qty}
      RETURNING stock_quantity
    `;
    return rows[0]?.stock_quantity ?? null;
  },

  addStockAdjustment(
    tx: Tx,
    row: {
      productId: bigint;
      delta: number;
      resultingQuantity: number;
      reason: StockReason;
      actorType: "USER" | "ADMIN" | "SYSTEM";
      actorId: bigint | null;
    },
  ) {
    return tx.stockAdjustment.create({ data: row });
  },

  /** Put units back (cancellation). Increment only — the CHECK still guards the row. */
  async incrementStock(tx: Tx, productId: bigint, qty: number): Promise<number> {
    const rows = await tx.$queryRaw<{ stock_quantity: number }[]>`
      UPDATE products
      SET stock_quantity = stock_quantity + ${qty}, updated_at = now()
      WHERE id = ${productId}
      RETURNING stock_quantity
    `;
    if (!rows[0]) throw new Error(`product ${productId} vanished during stock restore`);
    return rows[0].stock_quantity;
  },

  /** Lock any order row (admin paths — no ownership filter). */
  async lockOrder(tx: Tx, orderId: bigint) {
    const rows = await tx.$queryRaw<{ id: bigint; status: string; paymentStatus: string }[]>`
      SELECT id, status, payment_status AS "paymentStatus"
      FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  },

  /** Per-day sequence: HEY-YYMMDD-#### (4+ digits). Unique index is the backstop. */
  async nextOrderNumber(tx: Tx, datePart: string): Promise<string> {
    // Serialize number assignment per day across concurrent checkouts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order_number:" + datePart}))`;
    const prefix = `HEY-${datePart}-`;
    // Prefix is fixed-width ("HEY-YYMMDD-" = 11 chars); the tail is digits.
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING(order_number FROM 12) AS INTEGER))::int AS max
      FROM orders
      WHERE order_number LIKE ${prefix + "%"}
    `;
    const next = (rows[0]?.max ?? 0) + 1;
    return `${prefix}${String(next).padStart(4, "0")}`;
  },

  createOrder(tx: Tx, order: NewOrder, items: NewOrderItem[]) {
    return tx.order.create({
      data: {
        orderNumber: order.orderNumber,
        userId: order.userId,
        status: "pending",
        paymentStatus: "PENDING_PAYMENT",
        subtotal: order.subtotal,
        discountTotal: order.discountTotal,
        shippingTotal: order.shippingTotal,
        grandTotal: order.grandTotal,
        shipReceiverName: order.ship.receiverName,
        shipPhone: order.ship.phone,
        shipLine1: order.ship.line1,
        shipLine2: order.ship.line2,
        shipCity: order.ship.city,
        shipState: order.ship.state,
        shipPostalCode: order.ship.postalCode,
        shipCountryCode: order.ship.countryCode,
        placedAt: order.placedAt,
        items: { create: items },
      },
      include: { items: { orderBy: { id: "asc" } } },
    });
  },

  addHistory(
    tx: Tx,
    row: {
      orderId: bigint;
      fromStatus: string | null;
      toStatus: string;
      actorType: "USER" | "ADMIN" | "SYSTEM";
      actorId: bigint | null;
      note?: string;
    },
  ) {
    return tx.orderStatusHistory.create({ data: row });
  },

  /** Remove exactly the purchased cart lines (by id, scoped to the cart). */
  deleteCartLines(tx: Tx, cartId: bigint, lineIds: bigint[]) {
    return tx.cartItem.deleteMany({ where: { cartId, id: { in: lineIds } } });
  },

  /** Lock the caller's own order row (ownership in the WHERE). */
  async lockOwnedOrder(tx: Tx, orderId: bigint, userId: bigint) {
    const rows = await tx.$queryRaw<{ id: bigint; status: string; paymentStatus: string }[]>`
      SELECT id, status, payment_status AS "paymentStatus"
      FROM orders
      WHERE id = ${orderId} AND user_id = ${userId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  },

  setPaymentStatus(tx: Tx, orderId: bigint, paymentStatus: "PAID") {
    return tx.order.update({ where: { id: orderId }, data: { paymentStatus } });
  },

  setStatus(
    tx: Tx,
    orderId: bigint,
    status: string,
    milestone: { confirmedAt?: Date; cancelledAt?: Date },
  ) {
    return tx.order.update({ where: { id: orderId }, data: { status, ...milestone } });
  },

  // ---------- reads (customer views) ----------

  listForUser(userId: bigint, skip: number, take: number) {
    return prisma.$transaction([
      prisma.order.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      prisma.order.count({ where: { userId } }),
    ]);
  },

  /** Units per order for a page of orders (one grouped query). */
  async unitCounts(orderIds: bigint[]): Promise<Map<string, number>> {
    if (orderIds.length === 0) return new Map();
    const rows = await prisma.orderItem.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.orderId.toString(), r._sum.quantity ?? 0]));
  },

  findOwnedDetail(orderId: bigint, userId: bigint) {
    return prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        items: { orderBy: { id: "asc" } },
        statusHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
  },

  /** Primary image per product for display beside snapshots (not part of the snapshot). */
  async primaryImages(productIds: bigint[]): Promise<Map<string, { filePath: string; altText: string }>> {
    if (productIds.length === 0) return new Map();
    const rows = await prisma.productImage.findMany({
      where: { productId: { in: productIds }, position: 0 },
      select: { productId: true, filePath: true, altText: true },
    });
    return new Map(rows.map((r) => [r.productId.toString(), { filePath: r.filePath, altText: r.altText }]));
  },
};
