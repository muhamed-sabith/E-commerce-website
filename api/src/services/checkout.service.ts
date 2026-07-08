import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../middleware/error.js";
import { addressRepository } from "../repositories/address.repository.js";
import { cartRepository, type CartLineRow } from "../repositories/cart.repository.js";
import { orderRepository, type LockedProduct, type NewOrderItem } from "../repositories/order.repository.js";
import { computeFinalPrice, type Money } from "./catalog.service.js";
import type { PaymentInstructions, PaymentService } from "./payment.service.js";
import { getSettings } from "./settings.service.js";

/**
 * Checkout (REQUIREMENTS §10, ARCHITECTURE §5, API_CONTRACT §3).
 *
 * The server is the only authority: the request names an address and
 * nothing else; every price, discount, stock level, and total is re-read
 * from the database. `placeOrder` runs in ONE transaction — any failure
 * rolls back the order, its snapshots, every stock decrement, the audit
 * rows, and the cart-line removal together.
 */

export const checkoutSchema = z
  .object({
    address_id: z
      .string({ required_error: "Choose a delivery address", invalid_type_error: "Invalid address" })
      .regex(/^\d{1,18}$/, "Invalid address")
      .transform((v) => BigInt(v)),
  })
  .strict();

export const previewSchema = z
  .object({
    address_id: z
      .string()
      .regex(/^\d{1,18}$/, "Invalid address")
      .transform((v) => BigInt(v))
      .optional(),
  })
  .strict();

// ---------- pure money rules (unit-tested) ----------

const ZERO = new Prisma.Decimal(0);

export interface ShippingRule {
  flatRate: Prisma.Decimal;
  freeThreshold: Prisma.Decimal;
}

/** Environment defaults — used until an admin saves store settings. */
export const shippingRule: ShippingRule = {
  flatRate: new Prisma.Decimal(env.SHIPPING_FLAT_RATE),
  freeThreshold: new Prisma.Decimal(env.SHIPPING_FREE_THRESHOLD),
};

/** The rule in force right now: admin settings (Phase 10), else the env defaults. */
export async function currentShippingRule(db?: Prisma.TransactionClient): Promise<ShippingRule> {
  const s = await getSettings(db);
  return { flatRate: s.shippingFlatRate, freeThreshold: s.shippingFreeThreshold };
}

/** v1: flat rate, free when the discounted merchandise total reaches the threshold. */
export function shippingFor(merchandiseTotal: Prisma.Decimal, rule: ShippingRule = shippingRule): Prisma.Decimal {
  if (merchandiseTotal.lessThanOrEqualTo(ZERO)) return ZERO;
  return merchandiseTotal.greaterThanOrEqualTo(rule.freeThreshold) ? ZERO : rule.flatRate;
}

/** Final unit price rounded to the cent, half-up (REQUIREMENTS §8 rounding law). */
export function roundedFinal(p: { price: Prisma.Decimal; discountType: string; discountValue: Prisma.Decimal | null }) {
  return computeFinalPrice(p.price, p.discountType, p.discountValue).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface Totals {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  shippingTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
}

/** Σ rounded lines, so the displayed parts always add to the displayed whole. */
export function totalsFor(
  lines: { unitPrice: Prisma.Decimal; finalPrice: Prisma.Decimal; quantity: number }[],
  rule: ShippingRule = shippingRule,
): Totals {
  let subtotal = ZERO;
  let merchandise = ZERO;
  for (const l of lines) {
    subtotal = subtotal.plus(l.unitPrice.mul(l.quantity));
    merchandise = merchandise.plus(l.finalPrice.mul(l.quantity));
  }
  const discountTotal = subtotal.minus(merchandise);
  const shippingTotal = shippingFor(merchandise, rule);
  return { subtotal, discountTotal, shippingTotal, grandTotal: merchandise.plus(shippingTotal) };
}

// ---------- line validation ----------

export interface LineProblem {
  line_id: string;
  product_id: string;
  name: string;
  reason: "unavailable" | "out_of_stock" | "insufficient_stock";
  requested: number;
  available: number;
}

type ProductState = Pick<LockedProduct, "status" | "stockQuantity" | "name">;

function problemFor(lineId: bigint, productId: bigint, qty: number, p: ProductState | undefined): LineProblem | null {
  const base = { line_id: lineId.toString(), product_id: productId.toString(), requested: qty };
  if (!p || p.status !== "active") {
    return { ...base, name: p?.name ?? "Unavailable item", reason: "unavailable", available: 0 };
  }
  if (p.stockQuantity <= 0) return { ...base, name: p.name, reason: "out_of_stock", available: 0 };
  if (qty > p.stockQuantity) {
    return { ...base, name: p.name, reason: "insufficient_stock", available: p.stockQuantity };
  }
  return null;
}

function problemMessage(problems: LineProblem[]): string {
  if (problems.length === 1) {
    const p = problems[0];
    if (p.reason === "unavailable") return `${p.name} is no longer available. Remove it from your bag to continue.`;
    if (p.reason === "out_of_stock") return `${p.name} just sold out. Remove it from your bag to continue.`;
    return `Only ${p.available} of ${p.name} left. Reduce the quantity to continue.`;
  }
  return "Some items in your bag changed. Review your bag to continue.";
}

// ---------- wire shapes ----------

function money(d: Prisma.Decimal): Money {
  return { amount: d.toFixed(2) };
}

export interface CheckoutAddress {
  id: string;
  receiverName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
}

export interface PreviewLine {
  id: string;
  product: { id: string; name: string; slug: string; image: { src: string; alt: string } | null };
  quantity: number;
  unitPrice: Money;
  discount: Money;
  finalPrice: Money;
  lineTotal: Money;
  problem: LineProblem | null;
}

export interface CheckoutPreview {
  lines: PreviewLine[];
  problems: LineProblem[];
  canPlaceOrder: boolean;
  address: CheckoutAddress | null;
  addresses: CheckoutAddress[];
  itemCount: number;
  subtotal: Money;
  discountTotal: Money;
  shippingTotal: Money;
  grandTotal: Money;
  shipping: { flatRate: Money; freeThreshold: Money };
}

function toAddress(a: Awaited<ReturnType<typeof addressRepository.listForUser>>[number]): CheckoutAddress {
  return {
    id: a.id.toString(),
    receiverName: a.receiverName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    countryCode: a.countryCode,
    isDefault: a.isDefault,
  };
}

function lineFromRow(row: CartLineRow): { view: PreviewLine; unitPrice: Prisma.Decimal; finalPrice: Prisma.Decimal } {
  const unitPrice = row.price;
  const finalPrice = roundedFinal(row);
  const problem = problemFor(row.itemId, row.productId, row.quantity, row);
  return {
    unitPrice,
    finalPrice,
    view: {
      id: row.itemId.toString(),
      product: {
        id: row.productId.toString(),
        name: row.name,
        slug: row.status === "active" ? row.slug : "",
        image: row.imagePath ? { src: `/assets/${row.imagePath}`, alt: row.imageAlt ?? row.name } : null,
      },
      quantity: row.quantity,
      unitPrice: money(unitPrice),
      discount: money(unitPrice.minus(finalPrice)),
      finalPrice: money(finalPrice),
      lineTotal: money(finalPrice.mul(row.quantity)),
      problem,
    },
  };
}

export interface PlacedOrder {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    grandTotal: Money;
  };
  payment: PaymentInstructions;
}

/** YYMMDD in the store's timezone (India, UTC+05:30 — no DST). */
export function orderDatePart(now: Date): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const yy = String(ist.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

// ---------- service ----------

export function createCheckoutService(payments: PaymentService) {
  return {
    /** Read-only, authoritative summary; never mutates anything. */
    async preview(userId: bigint, addressId?: bigint): Promise<CheckoutPreview> {
      const cart = await cartRepository.findCartByUserId(userId);
      const rows = cart ? await cartRepository.listLines(cart.id) : [];
      if (rows.length === 0) {
        throw new ApiError(409, "cart_empty", "Your bag is empty.");
      }

      const addresses = (await addressRepository.listForUser(userId)).map(toAddress);
      let address: CheckoutAddress | null;
      if (addressId !== undefined) {
        address = addresses.find((a) => a.id === addressId.toString()) ?? null;
        if (!address) throw new ApiError(404, "unknown_resource", "Address not found");
      } else {
        address = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
      }

      const lines = rows.map(lineFromRow);
      const problems = lines.map((l) => l.view.problem).filter((p): p is LineProblem => p !== null);
      const buyable = lines.filter((l) => l.view.problem === null);
      const rule = await currentShippingRule();
      const totals = totalsFor(
        buyable.map((l) => ({ unitPrice: l.unitPrice, finalPrice: l.finalPrice, quantity: l.view.quantity })),
        rule,
      );

      return {
        lines: lines.map((l) => l.view),
        problems,
        canPlaceOrder: problems.length === 0 && address !== null,
        address,
        addresses,
        itemCount: buyable.reduce((n, l) => n + l.view.quantity, 0),
        subtotal: money(totals.subtotal),
        discountTotal: money(totals.discountTotal),
        shippingTotal: money(totals.shippingTotal),
        grandTotal: money(totals.grandTotal),
        shipping: { flatRate: money(rule.flatRate), freeThreshold: money(rule.freeThreshold) },
      };
    },

    /** The authoritative order creation (one transaction). */
    async placeOrder(userId: bigint, addressId: bigint): Promise<PlacedOrder> {
      const created = await prisma.$transaction(
        async (tx) => {
          // 1. One checkout per user at a time: a double-click or a second tab
          //    waits here, then finds the purchased lines already gone.
          await orderRepository.lockUser(tx, userId);

          // 2. Current cart, read inside the lock.
          const cart = await tx.cart.findUnique({ where: { userId } });
          const cartLines = cart
            ? await tx.cartItem.findMany({ where: { cartId: cart.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
            : [];
          if (!cart || cartLines.length === 0) {
            throw new ApiError(409, "cart_empty", "Your bag is empty.");
          }

          // 3. Address must belong to this user.
          const address = await addressRepository.findOwned(addressId, userId, tx);
          if (!address) throw new ApiError(404, "unknown_resource", "Address not found");

          // 4–8. Lock every product row (ascending id), re-read price/status/stock.
          const products = await orderRepository.lockProducts(
            tx,
            [...new Set(cartLines.map((l) => l.productId))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
          );
          const byId = new Map(products.map((p) => [p.id.toString(), p]));
          const problems = cartLines
            .map((l) => problemFor(l.id, l.productId, l.quantity, byId.get(l.productId.toString())))
            .filter((p): p is LineProblem => p !== null);
          if (problems.length > 0) {
            const reason = problems.every((p) => p.reason === "unavailable") ? "cart_stale" : "stock_shortage";
            throw new ApiError(409, reason, problemMessage(problems), problems);
          }

          // 9. Authoritative snapshot lines + totals from the locked rows.
          const items: NewOrderItem[] = cartLines.map((l) => {
            const p = byId.get(l.productId.toString())!;
            const finalPrice = roundedFinal(p);
            return {
              productId: p.id,
              productNameSnapshot: p.name,
              skuSnapshot: p.sku,
              unitPrice: p.price,
              discountAmount: p.price.minus(finalPrice),
              finalPrice,
              quantity: l.quantity,
              lineTotal: finalPrice.mul(l.quantity),
            };
          });
          const totals = totalsFor(items, await currentShippingRule(tx));

          // 10. Conditional decrements (+ 15. audit rows). The WHERE guard means
          //     stock can never go negative even if a check above were wrong.
          for (const item of items) {
            const remaining = await orderRepository.decrementStock(tx, item.productId, item.quantity);
            if (remaining === null) {
              const p = byId.get(item.productId.toString())!;
              throw new ApiError(409, "stock_shortage", `Only ${p.stockQuantity} of ${p.name} left.`);
            }
            await orderRepository.addStockAdjustment(tx, {
              productId: item.productId,
              delta: -item.quantity,
              resultingQuantity: remaining,
              reason: "sale",
              actorType: "USER",
              actorId: userId,
            });
          }

          // 11–13. Order + snapshot lines + shipping snapshot.
          const now = new Date();
          const orderNumber = await orderRepository.nextOrderNumber(tx, orderDatePart(now));
          const order = await orderRepository.createOrder(
            tx,
            {
              orderNumber,
              userId,
              ...totals,
              ship: {
                receiverName: address.receiverName,
                phone: address.phone,
                line1: address.line1,
                line2: address.line2,
                city: address.city,
                state: address.state,
                postalCode: address.postalCode,
                countryCode: address.countryCode,
              },
              placedAt: now,
            },
            items,
          );

          // 14. Audit the creation.
          await orderRepository.addHistory(tx, {
            orderId: order.id,
            fromStatus: null,
            toStatus: "pending",
            actorType: "USER",
            actorId: userId,
            note: `Order placed (payment mode: ${payments.mode})`,
          });

          // 16. Remove exactly the purchased lines.
          await orderRepository.deleteCartLines(tx, cart.id, cartLines.map((l) => l.id));

          return order;
        },
        // Row locks do the concurrency work; allow for waiting behind them.
        { timeout: 15_000, maxWait: 10_000 },
      );

      return {
        order: {
          id: created.id.toString(),
          orderNumber: created.orderNumber,
          status: created.status,
          paymentStatus: created.paymentStatus,
          grandTotal: money(created.grandTotal),
        },
        payment: payments.instructionsFor(created),
      };
    },
  };
}
