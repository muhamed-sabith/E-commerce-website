import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Admin read models (ARCHITECTURE §3): the aggregate and filtered queries
 * behind the dashboard, inventory, order, and user lists. Every query is
 * parameterized, bounded (LIMIT/OFFSET), and computed in PostgreSQL — the
 * admin UI never loads whole tables to count or filter them.
 */

export type StockFilter = "all" | "low" | "out";

/** "Effective" low-stock threshold: per-product override, else the store default. */
const threshold = (globalDefault: number) => Prisma.sql`COALESCE(p.low_stock_threshold, ${globalDefault})`;

function stockCondition(filter: StockFilter, globalDefault: number): Prisma.Sql {
  if (filter === "out") return Prisma.sql`p.stock_quantity = 0`;
  if (filter === "low") return Prisma.sql`p.stock_quantity > 0 AND p.stock_quantity <= ${threshold(globalDefault)}`;
  return Prisma.sql`TRUE`;
}

export interface InventoryRow {
  id: bigint;
  name: string;
  sku: string;
  slug: string;
  status: string;
  stockQuantity: number;
  lowStockThreshold: number | null;
  effectiveThreshold: number;
  categoryName: string;
  updatedAt: Date;
}

export const adminRepository = {
  // ---------- inventory ----------

  async inventory(opts: { filter: StockFilter; q: string | null; globalThreshold: number; skip: number; take: number }) {
    const where: Prisma.Sql[] = [Prisma.sql`p.status <> 'archived'`, stockCondition(opts.filter, opts.globalThreshold)];
    if (opts.q) {
      where.push(Prisma.sql`(p.name ILIKE ${"%" + opts.q + "%"} OR p.sku ILIKE ${opts.q + "%"})`);
    }
    const w = Prisma.join(where, " AND ");
    const [rows, totals, counts] = await Promise.all([
      prisma.$queryRaw<InventoryRow[]>(Prisma.sql`
        SELECT p.id, p.name, p.sku, p.slug, p.status,
               p.stock_quantity AS "stockQuantity",
               p.low_stock_threshold AS "lowStockThreshold",
               ${threshold(opts.globalThreshold)}::int AS "effectiveThreshold",
               c.name AS "categoryName", p.updated_at AS "updatedAt"
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE ${w}
        ORDER BY p.stock_quantity ASC, p.name ASC, p.id ASC
        LIMIT ${opts.take} OFFSET ${opts.skip}
      `),
      prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS total FROM products p WHERE ${w}
      `),
      this.stockCounts(opts.globalThreshold),
    ]);
    return { rows, total: Number(totals[0]?.total ?? 0), counts };
  },

  /** Tab counts for the inventory filters (non-archived products). */
  async stockCounts(globalThreshold: number) {
    const rows = await prisma.$queryRaw<{ all: bigint; low: bigint; out: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS all,
             COUNT(*) FILTER (WHERE p.stock_quantity > 0 AND p.stock_quantity <= ${threshold(globalThreshold)}) AS low,
             COUNT(*) FILTER (WHERE p.stock_quantity = 0) AS out
      FROM products p
      WHERE p.status <> 'archived'
    `);
    const r = rows[0];
    return { all: Number(r?.all ?? 0), low: Number(r?.low ?? 0), out: Number(r?.out ?? 0) };
  },

  // ---------- dashboard ----------

  async orderStats(todayStart: Date) {
    const rows = await prisma.$queryRaw<
      {
        status: string;
        n: bigint;
        today: bigint;
      }[]
    >(Prisma.sql`
      SELECT status, COUNT(*) AS n, COUNT(*) FILTER (WHERE placed_at >= ${todayStart}) AS today
      FROM orders GROUP BY status
    `);
    const money = await prisma.$queryRaw<
      { paid: Prisma.Decimal | null; awaiting: Prisma.Decimal | null; awaiting_n: bigint; today_value: Prisma.Decimal | null }[]
    >(Prisma.sql`
      SELECT
        SUM(grand_total) FILTER (WHERE payment_status = 'PAID' AND status <> 'cancelled') AS paid,
        SUM(grand_total) FILTER (WHERE payment_status = 'PENDING_PAYMENT' AND status <> 'cancelled') AS awaiting,
        COUNT(*) FILTER (WHERE payment_status = 'PENDING_PAYMENT' AND status <> 'cancelled') AS awaiting_n,
        SUM(grand_total) FILTER (WHERE status <> 'cancelled' AND placed_at >= ${todayStart}) AS today_value
      FROM orders
    `);
    return { byStatus: rows, money: money[0] };
  },

  stockList(filter: "low" | "out", globalThreshold: number, take: number) {
    return prisma.$queryRaw<InventoryRow[]>(Prisma.sql`
      SELECT p.id, p.name, p.sku, p.slug, p.status,
             p.stock_quantity AS "stockQuantity",
             p.low_stock_threshold AS "lowStockThreshold",
             ${threshold(globalThreshold)}::int AS "effectiveThreshold",
             c.name AS "categoryName", p.updated_at AS "updatedAt"
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.status <> 'archived' AND ${stockCondition(filter, globalThreshold)}
      ORDER BY p.stock_quantity ASC, p.name ASC, p.id ASC
      LIMIT ${take}
    `);
  },

  // ---------- orders ----------

  async listOrders(opts: {
    q: string | null;
    status: string | null;
    payment: string | null;
    skip: number;
    take: number;
  }) {
    const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (opts.status) where.push(Prisma.sql`o.status = ${opts.status}`);
    if (opts.payment) where.push(Prisma.sql`o.payment_status = ${opts.payment}`);
    if (opts.q) {
      const like = "%" + opts.q + "%";
      where.push(Prisma.sql`(o.order_number ILIKE ${like} OR u.email ILIKE ${like} OR u.name ILIKE ${like})`);
    }
    const w = Prisma.join(where, " AND ");
    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<
        {
          id: bigint;
          orderNumber: string;
          placedAt: Date;
          status: string;
          paymentStatus: string;
          grandTotal: Prisma.Decimal;
          itemCount: bigint;
          userId: bigint;
          userName: string;
          userEmail: string;
        }[]
      >(Prisma.sql`
        SELECT o.id, o.order_number AS "orderNumber", o.placed_at AS "placedAt",
               o.status, o.payment_status AS "paymentStatus", o.grand_total AS "grandTotal",
               (SELECT COALESCE(SUM(quantity), 0) FROM order_items i WHERE i.order_id = o.id) AS "itemCount",
               u.id AS "userId", u.name AS "userName", u.email AS "userEmail"
        FROM orders o JOIN users u ON u.id = o.user_id
        WHERE ${w}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ${opts.take} OFFSET ${opts.skip}
      `),
      prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS total FROM orders o JOIN users u ON u.id = o.user_id WHERE ${w}
      `),
    ]);
    return { rows, total: Number(totals[0]?.total ?? 0) };
  },

  // ---------- users ----------

  async listUsers(opts: { q: string | null; status: "active" | "blocked" | null; skip: number; take: number }) {
    const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (opts.status === "blocked") where.push(Prisma.sql`u.is_blocked = true`);
    if (opts.status === "active") where.push(Prisma.sql`u.is_blocked = false`);
    if (opts.q) {
      const like = "%" + opts.q + "%";
      where.push(Prisma.sql`(u.email ILIKE ${like} OR u.name ILIKE ${like})`);
    }
    const w = Prisma.join(where, " AND ");
    // Explicit column list: password_hash is never selected.
    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<
        {
          id: bigint;
          name: string;
          email: string;
          role: string;
          isBlocked: boolean;
          blockedReason: string | null;
          blockedAt: Date | null;
          createdAt: Date;
          orderCount: bigint;
          lastOrderAt: Date | null;
        }[]
      >(Prisma.sql`
        SELECT u.id, u.name, u.email, u.role, u.is_blocked AS "isBlocked",
               u.blocked_reason AS "blockedReason", u.blocked_at AS "blockedAt", u.created_at AS "createdAt",
               (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS "orderCount",
               (SELECT MAX(o.placed_at) FROM orders o WHERE o.user_id = u.id) AS "lastOrderAt"
        FROM users u
        WHERE ${w}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ${opts.take} OFFSET ${opts.skip}
      `),
      prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM users u WHERE ${w}`),
    ]);
    return { rows, total: Number(totals[0]?.total ?? 0) };
  },
};
