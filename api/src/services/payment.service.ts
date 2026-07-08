import { env } from "../config/env.js";
import type { Tx } from "../repositories/order.repository.js";
import { orderRepository } from "../repositories/order.repository.js";

/**
 * Payment abstraction (ARCHITECTURE §5.5).
 *
 *   Checkout → OrderService → PaymentService → PaymentProvider
 *                                               ├── DemoPaymentProvider (v1)
 *                                               └── RealPaymentProvider (future, same interface)
 *
 * PaymentService is the ONLY module that moves an order's payment_status.
 * Providers decide what a payment attempt means; the service applies the
 * transition, audits it, and enforces the rules that never change with the
 * provider (own order, PENDING_PAYMENT only, not cancelled, idempotent PAID).
 */

export type PaymentMode = "demo" | "manual";

/** What the order service tells the client right after checkout. */
export interface PaymentInstructions {
  mode: PaymentMode;
  /** Present only in demo mode — the SPA route of the demo payment page. */
  demo_payment_url?: string;
}

export interface PaymentAttemptResult {
  outcome: "paid" | "failed";
  /** Audit note written with the transition (never contains credentials). */
  note: string;
}

/**
 * The provider contract. A real gateway later implements `instructionsFor`
 * (e.g. create a provider order + return its client params) and verifies
 * callbacks/webhooks before reporting `paid` — nothing else changes.
 */
export interface PaymentProvider {
  readonly mode: PaymentMode;
  instructionsFor(order: { id: bigint }): PaymentInstructions;
}

/** v1 demo simulator: deterministic, offline, never touches real money. */
export class DemoPaymentProvider implements PaymentProvider {
  readonly mode = "demo" as const;

  instructionsFor(order: { id: bigint }): PaymentInstructions {
    return { mode: "demo", demo_payment_url: `/payment/demo/${order.id.toString()}` };
  }

  /** Simulated outcomes — the caller chooses; nothing is random. */
  simulate(outcome: "success" | "failure", method: DemoMethod): PaymentAttemptResult {
    const label = DEMO_METHOD_LABEL[method];
    return outcome === "success"
      ? { outcome: "paid", note: `Demo payment confirmed (${label}, test mode)` }
      : { outcome: "failed", note: `Demo payment failed (${label}, test mode) — order kept, retry allowed` };
  }
}

/** Manual mode: no customer payment path; an admin confirms offline payment. */
export class ManualPaymentProvider implements PaymentProvider {
  readonly mode = "manual" as const;

  instructionsFor(): PaymentInstructions {
    return { mode: "manual" };
  }
}

export const DEMO_METHODS = ["demo_card", "demo_upi", "demo_qr"] as const;
export type DemoMethod = (typeof DEMO_METHODS)[number];
const DEMO_METHOD_LABEL: Record<DemoMethod, string> = {
  demo_card: "Demo Card",
  demo_upi: "Demo UPI",
  demo_qr: "Demo QR",
};

export function providerFor(mode: PaymentMode): PaymentProvider {
  return mode === "demo" ? new DemoPaymentProvider() : new ManualPaymentProvider();
}

export class PaymentTransitionError extends Error {
  constructor(
    readonly reason: "not_found" | "already_paid" | "not_payable",
    message: string,
  ) {
    super(message);
  }
}

export interface PaymentService {
  readonly mode: PaymentMode;
  instructionsFor(order: { id: bigint }): PaymentInstructions;
  /**
   * Record a payment attempt for the caller's own order, inside `tx`.
   * `paid` → PENDING_PAYMENT → PAID (audited). `failed` → unchanged
   * PENDING_PAYMENT (audited). Replaying `paid` on a PAID order is a no-op
   * (idempotent); a failure report on a PAID order is refused.
   */
  recordAttempt(
    tx: Tx,
    args: { orderId: bigint; userId: bigint; result: PaymentAttemptResult },
  ): Promise<{ changed: boolean }>;
  /**
   * Manual confirmation by an admin (API_CONTRACT §4) — available in every
   * mode; in manual mode it is the only path to PAID. PENDING_PAYMENT → PAID
   * only: an already-PAID order is refused (`already_paid`, nothing written)
   * and a cancelled order can't be paid (`not_payable`). Audited as ADMIN.
   */
  confirmManually(
    tx: Tx,
    args: { orderId: bigint; adminId: bigint; note?: string },
  ): Promise<void>;
}

export function createPaymentService(provider: PaymentProvider): PaymentService {
  return {
    mode: provider.mode,
    instructionsFor: (order) => provider.instructionsFor(order),

    async confirmManually(tx, { orderId, adminId, note }) {
      const order = await orderRepository.lockOrder(tx, orderId);
      if (!order) throw new PaymentTransitionError("not_found", "Order not found");
      if (order.paymentStatus === "PAID") {
        throw new PaymentTransitionError("already_paid", "This order is already marked as paid.");
      }
      if (order.status === "cancelled") {
        throw new PaymentTransitionError("not_payable", "This order was cancelled and can't be paid.");
      }
      await orderRepository.setPaymentStatus(tx, orderId, "PAID");
      await orderRepository.addHistory(tx, {
        orderId,
        fromStatus: "PENDING_PAYMENT",
        toStatus: "PAID",
        actorType: "ADMIN",
        actorId: adminId,
        note: note ? `Payment confirmed manually — ${note}` : "Payment confirmed manually",
      });
    },

    async recordAttempt(tx, { orderId, userId, result }) {
      const order = await orderRepository.lockOwnedOrder(tx, orderId, userId);
      if (!order) throw new PaymentTransitionError("not_found", "Order not found");

      if (order.paymentStatus === "PAID") {
        if (result.outcome === "paid") return { changed: false }; // idempotent replay
        throw new PaymentTransitionError("already_paid", "This order has already been paid.");
      }
      if (order.status === "cancelled") {
        throw new PaymentTransitionError("not_payable", "This order was cancelled and can't be paid.");
      }

      if (result.outcome === "paid") {
        await orderRepository.setPaymentStatus(tx, orderId, "PAID");
        await orderRepository.addHistory(tx, {
          orderId,
          fromStatus: "PENDING_PAYMENT",
          toStatus: "PAID",
          actorType: "USER",
          actorId: userId,
          note: result.note,
        });
        return { changed: true };
      }

      await orderRepository.addHistory(tx, {
        orderId,
        fromStatus: "PENDING_PAYMENT",
        toStatus: "PENDING_PAYMENT",
        actorType: "USER",
        actorId: userId,
        note: result.note,
      });
      return { changed: false };
    },
  };
}

/** Process-wide instance configured from the environment. */
export const paymentService = createPaymentService(providerFor(env.PAYMENT_MODE));
