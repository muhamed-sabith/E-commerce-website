import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ApiError } from "../middleware/error.js";
import { computeFinalPrice } from "./catalog.service.js";
import type { Money } from "./catalog.service.js";
import type { CartLineRow } from "../repositories/cart.repository.js";

/**
 * Cart business rules (REQUIREMENTS §8, API_CONTRACT §3):
 * - the server is the sole source of truth: every response is recomputed
 *   from CURRENT catalog rows (price, discount, stock, status) — a price
 *   change in the admin surfaces on the next GET /cart (§9 of the phase)
 * - qty: integer 1..99 per line; add/PATCH validated against current stock
 * - duplicates merge; merged quantity must still respect stock
 * - inactive/archived products cannot be added; if they become unavailable
 *   later, lines are flagged honestly — never silently purchasable
 * - no inventory is deducted for holding items in a cart
 * Money: exact decimal strings on the wire; totals are Σ rounded lines
 * (rounding law: subtotal - discount_total == grand_total to the cent).
 */

export const MAX_LINE_QTY = 99;

// ---------- boundary validation ----------

export const addToCartSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  qty: z.coerce.number().int().min(1, "Quantity must be at least 1").max(MAX_LINE_QTY),
});

export const updateCartItemSchema = z.object({
  qty: z.coerce
    .number()
    .int()
    .min(0, "Quantity cannot be negative")
    .max(MAX_LINE_QTY, `Quantity cannot exceed ${MAX_LINE_QTY}`),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

// ---------- wire types ----------

export type LineAvailability = "available" | "out_of_stock" | "unavailable";

export interface CartLine {
  id: string;
  product: {
    id: string;
    name: string;
    slug: string;
    sku: string;
    image: { src: string; alt: string } | null;
  };
  quantity: number;
  price: Money;
  finalPrice: Money;
  lineTotal: Money;
  availability: LineAvailability;
  /** Present only when the line cannot be bought as-is; actionable copy. */
  issue?: string;
}

export interface CartResponse {
  items: CartLine[];
  itemCount: number;
  subtotal: Money;
  discountTotal: Money;
  total: Money;
}

export interface MergeReport {
  merged: { product_id: string; name: string; quantity: number }[];
  capped: { product_id: string; name: string; quantity: number; requested: number }[];
  dropped: { product_id: string; name: string; reason: string }[];
}

// ---------- money helpers ----------

function money(d: Prisma.Decimal): Money {
  return { amount: d.toFixed(2) };
}

/** Per-line purchasability from CURRENT product state (never the client's). */
function lineAvailability(row: {
  status: string;
  stockQuantity: number;
  quantity: number;
}): { availability: LineAvailability; issue?: string } {
  if (row.status !== "active") {
    return { availability: "unavailable", issue: "This item is no longer available and will not be counted." };
  }
  if (row.stockQuantity <= 0) {
    return { availability: "out_of_stock", issue: "Out of stock — remove it or save it for later." };
  }
  if (row.quantity > row.stockQuantity) {
    return {
      availability: "out_of_stock",
      issue: `Only ${row.stockQuantity} left — reduce the quantity to continue.`,
    };
  }
  return { availability: "available" };
}

/** Shape one joined row into the wire line (current prices, honest state). */
export function toCartLine(row: CartLineRow): CartLine {
  const finalPrice = computeFinalPrice(row.price, row.discountType, row.discountValue);
  const { availability, issue } = lineAvailability(row);
  return {
    id: row.itemId.toString(),
    product: {
      id: row.productId.toString(),
      name: row.name,
      slug: row.slug,
      sku: row.sku,
      // Same public path shape as the catalog (catalog.service toListItem).
      image: row.imagePath
        ? { src: `/assets/${row.imagePath}`, alt: row.imageAlt ?? row.name }
        : null,
    },
    quantity: row.quantity,
    price: money(row.price),
    finalPrice: money(finalPrice),
    lineTotal: money(finalPrice.mul(row.quantity)),
    availability,
    ...(issue ? { issue } : {}),
  };
}

/**
 * Totals follow the rounding law: each line contributes its rounded final
 * price × qty; discount_total is the sum of per-line savings. Only
 * AVAILABLE lines count — an unavailable item is shown but never totaled
 * as buyable.
 */
export function computeTotals(lines: CartLine[]): {
  itemCount: number;
  subtotal: Money;
  discountTotal: Money;
  total: Money;
} {
  const available = lines.filter((l) => l.availability === "available");
  let subtotal = new Prisma.Decimal(0);
  let total = new Prisma.Decimal(0);
  for (const line of available) {
    subtotal = subtotal.plus(new Prisma.Decimal(line.price.amount).mul(line.quantity));
    total = total.plus(new Prisma.Decimal(line.finalPrice.amount).mul(line.quantity));
  }
  const discountTotal = subtotal.minus(total);
  return {
    itemCount: available.reduce((n, l) => n + l.quantity, 0),
    subtotal: money(subtotal),
    discountTotal: money(discountTotal),
    total: money(total),
  };
}

/** Assemble the full cart response from joined rows. */
export function buildCartResponse(rows: CartLineRow[]): CartResponse {
  const lines = rows.map(toCartLine);
  const totals = computeTotals(lines);
  return { items: lines, ...totals };
}

/** Shared add rule: exists + active + purchasable qty against current stock. */
export function assertAddable(
  product: {
    id: bigint;
    status: string;
    stockQuantity: number;
    name: string;
  } | null,
  requestedQty: number,
): asserts product is {
  id: bigint;
  status: string;
  stockQuantity: number;
  name: string;
} {
  if (!product) {
    throw new ApiError(404, "unknown_resource", "Product not found");
  }
  if (product.status !== "active") {
    throw new ApiError(409, "product_unavailable", "This product is not available for purchase.");
  }
  if (product.stockQuantity <= 0) {
    throw new ApiError(409, "out_of_stock", "This product is out of stock.");
  }
  if (requestedQty > product.stockQuantity) {
    throw new ApiError(
      409,
      "stock_shortage",
      `Only ${product.stockQuantity} in stock — reduce the quantity.`,
    );
  }
}
