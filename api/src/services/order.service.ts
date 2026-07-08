import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../middleware/error.js";
import { orderRepository, type Tx } from "../repositories/order.repository.js";
import type { Money } from "./catalog.service.js";
import {
  DEMO_METHODS,
  DemoPaymentProvider,
  PaymentTransitionError,
  type PaymentService,
} from "./payment.service.js";

/**
 * Orders (REQUIREMENTS §2.13/§10, API_CONTRACT §3): customer views, the
 * status ladder, and the demo payment transitions. Customers read their own
 * orders only; they cannot change order status. The ladder is the single
 * definition every future admin endpoint must go through.
 */

// ---------- status ladder (REQUIREMENTS §10) ----------

export type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

const LADDER: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return LADDER[from].includes(to);
}

/**
 * Apply one ladder transition with its audit row. Used by admin order
 * management (Phase 10); no customer route calls it. Illegal moves throw.
 * Cancellation restores every ordered unit in the same transaction.
 */
export async function transitionOrderStatus(args: {
  orderId: bigint;
  to: OrderStatus;
  actorType: "ADMIN" | "SYSTEM";
  actorId: bigint | null;
  note?: string;
}): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      // The order row lock serializes every status move on this order: a
      // second cancel waits here, then sees `cancelled` and is refused by
      // the ladder — so stock is restored exactly once.
      const order = await orderRepository.lockOrder(tx, args.orderId);
      if (!order) throw new ApiError(404, "unknown_resource", "Order not found");
      const from = order.status as OrderStatus;
      if (from === args.to) {
        throw new ApiError(409, "illegal_transition", `This order is already ${from}.`);
      }
      if (!canTransition(from, args.to)) {
        throw new ApiError(409, "illegal_transition", `An order can't move from ${from} to ${args.to}.`);
      }

      const restocked = args.to === "cancelled" ? await restoreStock(tx, args.orderId, args.actorType, args.actorId) : 0;

      const now = new Date();
      await orderRepository.setStatus(tx, args.orderId, args.to, {
        ...(args.to === "confirmed" ? { confirmedAt: now } : {}),
        ...(args.to === "cancelled" ? { cancelledAt: now } : {}),
      });
      const paidNote = args.to === "cancelled" && order.paymentStatus === "PAID" ? "Paid order cancelled — settle the refund offline" : null;
      const restockNote = args.to === "cancelled" ? `${restocked} ${restocked === 1 ? "unit" : "units"} returned to stock` : null;
      const note = [args.note, restockNote, paidNote].filter(Boolean).join(" · ") || undefined;
      await orderRepository.addHistory(tx, {
        orderId: args.orderId,
        fromStatus: from,
        toStatus: args.to,
        actorType: args.actorType,
        actorId: args.actorId,
        note,
      });
    },
    { timeout: 15_000, maxWait: 10_000 },
  );
}

/**
 * Cancellation restock (REQUIREMENTS §9): every ordered unit goes back,
 * one `cancel_restore` audit row per product, inside the caller's
 * transaction. Products are locked in ascending id order — the same order
 * checkout uses — so a concurrent checkout and cancellation cannot deadlock.
 */
async function restoreStock(
  tx: Tx,
  orderId: bigint,
  actorType: "ADMIN" | "SYSTEM",
  actorId: bigint | null,
): Promise<number> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { productId: true, quantity: true } });
  const perProduct = new Map<string, { productId: bigint; qty: number }>();
  for (const i of items) {
    const k = i.productId.toString();
    const cur = perProduct.get(k);
    perProduct.set(k, { productId: i.productId, qty: (cur?.qty ?? 0) + i.quantity });
  }
  const ordered = [...perProduct.values()].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  await orderRepository.lockProducts(tx, ordered.map((p) => p.productId));
  for (const p of ordered) {
    const resulting = await orderRepository.incrementStock(tx, p.productId, p.qty);
    await orderRepository.addStockAdjustment(tx, {
      productId: p.productId,
      delta: p.qty,
      resultingQuantity: resulting,
      reason: "cancel_restore",
      actorType,
      actorId,
    });
  }
  return ordered.reduce((n, p) => n + p.qty, 0);
}

// ---------- validation ----------

export const listOrdersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(48).default(12),
  })
  .strict();

export const demoPaymentSchema = z
  .object({ method: z.enum(DEMO_METHODS).default("demo_card") })
  .strict();

export function parseOrderId(raw: unknown): bigint {
  const s = typeof raw === "string" ? raw : "";
  if (!/^\d{1,18}$/.test(s)) throw new ApiError(404, "unknown_resource", "Order not found");
  return BigInt(s);
}

// ---------- wire shapes ----------

function money(d: Prisma.Decimal): Money {
  return { amount: d.toFixed(2) };
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  placedAt: string;
  status: string;
  paymentStatus: string;
  grandTotal: Money;
  itemCount: number;
}

export interface OrderDetail extends Omit<OrderSummary, "itemCount"> {
  itemCount: number;
  items: {
    id: string;
    productId: string;
    name: string;
    sku: string;
    unitPrice: Money;
    discount: Money;
    finalPrice: Money;
    quantity: number;
    lineTotal: Money;
    image: { src: string; alt: string } | null;
  }[];
  shipping: {
    receiverName: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
  };
  subtotal: Money;
  discountTotal: Money;
  shippingTotal: Money;
  confirmedAt: string | null;
  cancelledAt: string | null;
  timeline: { from: string | null; to: string; at: string; note: string | null }[];
  /** What the customer can do next about payment, per the configured mode. */
  payment: { mode: "demo" | "manual"; canPay: boolean; demo_payment_url?: string };
}

// ---------- service ----------

export function createOrderService(payments: PaymentService) {
  const demo = payments.mode === "demo" ? new DemoPaymentProvider() : null;

  async function detail(userId: bigint, orderId: bigint): Promise<OrderDetail> {
    const o = await orderRepository.findOwnedDetail(orderId, userId);
    // Foreign and unknown ids are indistinguishable (no existence leak).
    if (!o) throw new ApiError(404, "unknown_resource", "Order not found");
    const images = await orderRepository.primaryImages(o.items.map((i) => i.productId));
    const canPay = o.paymentStatus === "PENDING_PAYMENT" && o.status !== "cancelled";
    return {
      id: o.id.toString(),
      orderNumber: o.orderNumber,
      placedAt: o.placedAt.toISOString(),
      status: o.status,
      paymentStatus: o.paymentStatus,
      grandTotal: money(o.grandTotal),
      itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      items: o.items.map((i) => {
        const img = images.get(i.productId.toString());
        return {
          id: i.id.toString(),
          productId: i.productId.toString(),
          name: i.productNameSnapshot,
          sku: i.skuSnapshot,
          unitPrice: money(i.unitPrice),
          discount: money(i.discountAmount),
          finalPrice: money(i.finalPrice),
          quantity: i.quantity,
          lineTotal: money(i.lineTotal),
          image: img ? { src: `/assets/${img.filePath}`, alt: img.altText } : null,
        };
      }),
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
      subtotal: money(o.subtotal),
      discountTotal: money(o.discountTotal),
      shippingTotal: money(o.shippingTotal),
      confirmedAt: o.confirmedAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      timeline: o.statusHistory.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        at: h.createdAt.toISOString(),
        note: h.note,
      })),
      payment: {
        mode: payments.mode,
        canPay: canPay && payments.mode === "demo",
        ...(canPay && payments.mode === "demo" ? payments.instructionsFor(o) : {}),
      },
    };
  }

  async function demoAttempt(
    userId: bigint,
    orderId: bigint,
    outcome: "success" | "failure",
    method: (typeof DEMO_METHODS)[number],
  ): Promise<OrderDetail> {
    if (!demo) {
      // Routes are unmounted in manual mode; this is defense in depth.
      throw new ApiError(404, "unknown_resource", "Resource not found");
    }
    try {
      await prisma.$transaction((tx) =>
        payments.recordAttempt(tx, { orderId, userId, result: demo.simulate(outcome, method) }),
      );
    } catch (err) {
      if (err instanceof PaymentTransitionError) {
        if (err.reason === "not_found") throw new ApiError(404, "unknown_resource", "Order not found");
        throw new ApiError(409, err.reason === "already_paid" ? "already_paid" : "not_payable", err.message);
      }
      throw err;
    }
    return detail(userId, orderId);
  }

  return {
    async list(userId: bigint, page: number, pageSize: number) {
      const [rows, total] = await orderRepository.listForUser(userId, (page - 1) * pageSize, pageSize);
      const units = await orderRepository.unitCounts(rows.map((o) => o.id));
      const items: OrderSummary[] = rows.map((o) => ({
        id: o.id.toString(),
        orderNumber: o.orderNumber,
        placedAt: o.placedAt.toISOString(),
        status: o.status,
        paymentStatus: o.paymentStatus,
        grandTotal: money(o.grandTotal),
        itemCount: units.get(o.id.toString()) ?? 0,
      }));
      return {
        items,
        page,
        page_size: pageSize,
        total_items: total,
        total_pages: Math.ceil(total / pageSize),
      };
    },
    detail,
    confirmDemoPayment: (userId: bigint, orderId: bigint, method: (typeof DEMO_METHODS)[number]) =>
      demoAttempt(userId, orderId, "success", method),
    failDemoPayment: (userId: bigint, orderId: bigint, method: (typeof DEMO_METHODS)[number]) =>
      demoAttempt(userId, orderId, "failure", method),
  };
}
