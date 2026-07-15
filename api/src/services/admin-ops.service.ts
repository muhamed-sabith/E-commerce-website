import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { recordAdminAction } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../middleware/error.js";
import { adminRepository, type InventoryRow } from "../repositories/admin.repository.js";
import { orderRepository } from "../repositories/order.repository.js";
import type {
  blockSchema,
  inventoryQuery,
  orderListQuery,
  orderStatusSchema,
  paymentStatusSchema,
  stockAdjustmentSchema,
  userListQuery,
} from "./admin.schemas.js";
import type { Money } from "./catalog.service.js";
import { transitionOrderStatus } from "./order.service.js";
import { PaymentTransitionError, type PaymentService } from "./payment.service.js";
import { getSettings } from "./settings.service.js";

/**
 * Admin operations (REQUIREMENTS §3.2/§3.5–§3.10, API_CONTRACT §4):
 * dashboard, inventory + audited stock adjustments, order management
 * (ladder transitions through the single `transitionOrderStatus`, manual
 * payment through `PaymentService`), and customer blocking.
 */

const money = (d: Prisma.Decimal | null | undefined): Money => ({ amount: (d ?? new Prisma.Decimal(0)).toFixed(2) });

/** Midnight today in the store's timezone (India, UTC+05:30, no DST). */
export function storeDayStart(now: Date): Date {
  const offset = 330 * 60_000;
  const ist = new Date(now.getTime() + offset);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - offset);
}

function stockItem(r: InventoryRow) {
  const state = r.stockQuantity <= 0 ? "out_of_stock" : r.stockQuantity <= r.effectiveThreshold ? "low_stock" : "in_stock";
  return {
    id: r.id.toString(),
    name: r.name,
    sku: r.sku,
    slug: r.slug,
    status: r.status,
    categoryName: r.categoryName,
    stockQuantity: r.stockQuantity,
    lowStockThreshold: r.lowStockThreshold,
    effectiveThreshold: r.effectiveThreshold,
    stockState: state,
    /** Same rule the storefront uses: active AND stock > 0. */
    purchasable: r.status === "active" && r.stockQuantity > 0,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function orderSummary(r: Awaited<ReturnType<typeof adminRepository.listOrders>>["rows"][number]) {
  return {
    id: r.id.toString(),
    orderNumber: r.orderNumber,
    placedAt: r.placedAt.toISOString(),
    status: r.status,
    paymentStatus: r.paymentStatus,
    grandTotal: money(r.grandTotal),
    itemCount: Number(r.itemCount),
    customer: { id: r.userId.toString(), name: r.userName, email: r.userEmail },
  };
}

const NEXT_STATUSES: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function createAdminOpsService(payments: PaymentService) {
  async function orderDetail(id: bigint) {
    const o = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, isBlocked: true } },
        items: { orderBy: { id: "asc" } },
        statusHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    if (!o) throw new ApiError(404, "unknown_resource", "Order not found");
    const actorIds = [...new Set(o.statusHistory.map((h) => h.actorId).filter((a): a is bigint => a !== null))];
    const actors = new Map(
      (await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [
        u.id.toString(),
        u.name,
      ]),
    );
    const isPayment = (s: string | null) => s === "PENDING_PAYMENT" || s === "PAID";
    const timeline = o.statusHistory.map((h) => ({
      id: h.id.toString(),
      kind: isPayment(h.toStatus) ? ("payment" as const) : ("status" as const),
      from: h.fromStatus,
      to: h.toStatus,
      at: h.createdAt.toISOString(),
      actorType: h.actorType,
      actorName: h.actorId ? (actors.get(h.actorId.toString()) ?? null) : null,
      note: h.note,
    }));
    const canConfirmPayment = o.paymentStatus === "PENDING_PAYMENT" && o.status !== "cancelled";
    return {
      id: o.id.toString(),
      orderNumber: o.orderNumber,
      placedAt: o.placedAt.toISOString(),
      status: o.status,
      paymentStatus: o.paymentStatus,
      customer: { id: o.user.id.toString(), name: o.user.name, email: o.user.email, isBlocked: o.user.isBlocked },
      items: o.items.map((i) => ({
        id: i.id.toString(),
        productId: i.productId.toString(),
        name: i.productNameSnapshot,
        sku: i.skuSnapshot,
        unitPrice: money(i.unitPrice),
        discount: money(i.discountAmount),
        finalPrice: money(i.finalPrice),
        quantity: i.quantity,
        lineTotal: money(i.lineTotal),
      })),
      itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      subtotal: money(o.subtotal),
      discountTotal: money(o.discountTotal),
      shippingTotal: money(o.shippingTotal),
      grandTotal: money(o.grandTotal),
      shipping: {
        receiverName: o.shipReceiverName,
        phone: o.shipPhone,
        line1: o.shipLine1,
        line2: o.shipLine2,
        city: o.shipCity,
        state: o.shipState,
        postalCode: o.shipPostalCode,
        countryCode: o.shipCountryCode,
      },
      confirmedAt: o.confirmedAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      timeline,
      actions: {
        nextStatuses: NEXT_STATUSES[o.status] ?? [],
        canConfirmPayment,
      },
      paymentMode: payments.mode,
    };
  }

  return {
    // ---------- dashboard ----------

    async dashboard(now = new Date()) {
      const settings = await getSettings();
      const dayStart = storeDayStart(now);
      const [stats, counts, low, out, recent] = await Promise.all([
        adminRepository.orderStats(dayStart),
        adminRepository.stockCounts(settings.lowStockThreshold),
        adminRepository.stockList("low", settings.lowStockThreshold, 8),
        adminRepository.stockList("out", settings.lowStockThreshold, 8),
        adminRepository.listOrders({ q: null, status: null, payment: null, skip: 0, take: 8 }),
      ]);
      const byStatus = { pending: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 } as Record<string, number>;
      let total = 0;
      let today = 0;
      for (const r of stats.byStatus) {
        byStatus[r.status] = Number(r.n);
        total += Number(r.n);
        today += Number(r.today);
      }
      return {
        generatedAt: now.toISOString(),
        orders: { total, today, byStatus },
        revenue: {
          /** PAID, not cancelled. */
          paid: money(stats.money?.paid),
          /** PENDING_PAYMENT, not cancelled — money the store is waiting on. */
          awaitingPayment: money(stats.money?.awaiting),
          awaitingPaymentCount: Number(stats.money?.awaiting_n ?? 0),
          /** Value of today's non-cancelled orders (any payment state). */
          todayOrderValue: money(stats.money?.today_value),
        },
        inventory: {
          lowStockThreshold: settings.lowStockThreshold,
          productCount: counts.all,
          lowStockCount: counts.low,
          outOfStockCount: counts.out,
          lowStock: low.map(stockItem),
          outOfStock: out.map(stockItem),
        },
        recentOrders: recent.rows.map(orderSummary),
        paymentMode: payments.mode,
      };
    },

    // ---------- inventory ----------

    async inventory(query: z.infer<typeof inventoryQuery>) {
      const settings = await getSettings();
      const { rows, total, counts } = await adminRepository.inventory({
        filter: query.filter,
        q: query.q,
        globalThreshold: settings.lowStockThreshold,
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      });
      return {
        items: rows.map(stockItem),
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.ceil(total / query.page_size),
        counts,
        lowStockThreshold: settings.lowStockThreshold,
      };
    },

    /**
     * Audited stock adjustment (REQUIREMENTS §3.6/§9). The product row is
     * locked, the delta applied with a conditional UPDATE (never below 0 —
     * the CHECK is the final backstop), and the audit row written in the
     * same transaction. Concurrent adjustments serialize on the row lock.
     */
    async adjustStock(actorId: bigint, productId: bigint, input: z.infer<typeof stockAdjustmentSchema>) {
      const result = await prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ stock_quantity: number; status: string }[]>`
            SELECT stock_quantity, status FROM products WHERE id = ${productId} FOR UPDATE
          `;
          const current = rows[0];
          if (!current) throw new ApiError(404, "unknown_resource", "Product not found");
          const delta = input.reason === "admin_set" ? input.quantity - current.stock_quantity : input.delta;
          if (delta === 0) {
            throw new ApiError(400, "validation_failed", "Stock is already at that quantity.", [
              { path: ["quantity"], message: `Stock is already ${current.stock_quantity}` },
            ]);
          }
          if (current.stock_quantity + delta < 0) {
            throw new ApiError(
              409,
              "negative_stock",
              `Only ${current.stock_quantity} in stock — this adjustment would take it below zero.`,
              [{ path: ["delta"], message: `Can remove at most ${current.stock_quantity}` }],
            );
          }
          const updated = await tx.$queryRaw<{ stock_quantity: number }[]>`
            UPDATE products SET stock_quantity = stock_quantity + ${delta}, updated_at = now()
            WHERE id = ${productId} AND stock_quantity + ${delta} >= 0
            RETURNING stock_quantity
          `;
          if (!updated[0]) throw new ApiError(409, "negative_stock", "This adjustment would take stock below zero.");
          const adj = await orderRepository.addStockAdjustment(tx, {
            productId,
            delta,
            resultingQuantity: updated[0].stock_quantity,
            reason: input.reason,
            actorType: "ADMIN",
            actorId,
          });
          return { adj, quantity: updated[0].stock_quantity };
        },
        { timeout: 15_000, maxWait: 10_000 },
      );
      return {
        adjustment: {
          id: result.adj.id.toString(),
          delta: result.adj.delta,
          reason: result.adj.reason,
          resultingQuantity: result.adj.resultingQuantity,
          at: result.adj.createdAt.toISOString(),
        },
        stockQuantity: result.quantity,
      };
    },

    // ---------- orders ----------

    async listOrders(query: z.infer<typeof orderListQuery>) {
      const { rows, total } = await adminRepository.listOrders({
        q: query.q,
        status: query.status ?? null,
        payment: query.payment ?? null,
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      });
      return {
        items: rows.map(orderSummary),
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.ceil(total / query.page_size),
      };
    },

    orderDetail,

    async changeStatus(actorId: bigint, orderId: bigint, input: z.infer<typeof orderStatusSchema>) {
      await transitionOrderStatus({ orderId, to: input.status, actorType: "ADMIN", actorId, note: input.note });
      return orderDetail(orderId);
    },

    async confirmPayment(actorId: bigint, orderId: bigint, input: z.infer<typeof paymentStatusSchema>) {
      try {
        await prisma.$transaction((tx) => payments.confirmManually(tx, { orderId, adminId: actorId, note: input.note }));
      } catch (err) {
        if (err instanceof PaymentTransitionError) {
          if (err.reason === "not_found") throw new ApiError(404, "unknown_resource", "Order not found");
          throw new ApiError(409, err.reason, err.message);
        }
        throw err;
      }
      return orderDetail(orderId);
    },

    // ---------- users ----------

    async listUsers(query: z.infer<typeof userListQuery>) {
      const { rows, total } = await adminRepository.listUsers({
        q: query.q,
        status: query.status ?? null,
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      });
      return {
        items: rows.map((u) => ({
          id: u.id.toString(),
          name: u.name,
          email: u.email,
          role: u.role === "ADMIN" ? "ADMIN" : "USER",
          status: u.isBlocked ? "blocked" : "active",
          blockedReason: u.blockedReason,
          blockedAt: u.blockedAt?.toISOString() ?? null,
          orderCount: Number(u.orderCount),
          lastOrderAt: u.lastOrderAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.ceil(total / query.page_size),
      };
    },

    /**
     * Block (REQUIREMENTS §3.10): customers only — admins are managed by the
     * bootstrap script, and an admin can never block themselves. Every live
     * session is revoked in the same transaction, so access ends at once.
     */
    async blockUser(actorId: bigint, userId: bigint, input: z.infer<typeof blockSchema>) {
      await prisma.$transaction(async (tx) => {
        const u = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isBlocked: true } });
        if (!u) throw new ApiError(404, "unknown_resource", "User not found");
        if (userId === actorId) throw new ApiError(409, "cannot_block_self", "You can't block your own account.");
        if (u.role === "ADMIN") {
          throw new ApiError(409, "cannot_block_admin", "Administrator accounts are managed outside the admin panel.");
        }
        if (u.isBlocked) throw new ApiError(409, "already_blocked", "This customer is already blocked.");
        await tx.user.update({
          where: { id: userId },
          data: { isBlocked: true, blockedReason: input.reason, blockedAt: new Date() },
        });
        const revoked = await tx.session.deleteMany({ where: { userId } });
        await recordAdminAction(tx, {
          actorId,
          action: "user.block",
          targetType: "user",
          targetId: userId,
          details: { reason: input.reason, sessions_revoked: revoked.count },
        });
      });
      return this.userRow(userId);
    },

    async unblockUser(actorId: bigint, userId: bigint) {
      await prisma.$transaction(async (tx) => {
        const u = await tx.user.findUnique({ where: { id: userId }, select: { isBlocked: true, blockedReason: true } });
        if (!u) throw new ApiError(404, "unknown_resource", "User not found");
        if (!u.isBlocked) throw new ApiError(409, "not_blocked", "This customer isn't blocked.");
        await tx.user.update({ where: { id: userId }, data: { isBlocked: false, blockedReason: null, blockedAt: null } });
        await recordAdminAction(tx, {
          actorId,
          action: "user.unblock",
          targetType: "user",
          targetId: userId,
          details: { previous_reason: u.blockedReason },
        });
      });
      return this.userRow(userId);
    },

    async userRow(userId: bigint) {
      const u = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, isBlocked: true, blockedReason: true, blockedAt: true, createdAt: true },
      });
      const [orderCount, last] = await Promise.all([
        prisma.order.count({ where: { userId } }),
        prisma.order.findFirst({ where: { userId }, orderBy: { placedAt: "desc" }, select: { placedAt: true } }),
      ]);
      return {
        user: {
          id: u.id.toString(),
          name: u.name,
          email: u.email,
          role: u.role === "ADMIN" ? "ADMIN" : "USER",
          status: u.isBlocked ? "blocked" : "active",
          blockedReason: u.blockedReason,
          blockedAt: u.blockedAt?.toISOString() ?? null,
          orderCount,
          lastOrderAt: last?.placedAt.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        },
      };
    },
  };
}
