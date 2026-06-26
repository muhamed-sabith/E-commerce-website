import { ApiError } from "../middleware/error.js";
import { prisma } from "../lib/prisma.js";
import { cartRepository } from "../repositories/cart.repository.js";
import {
  assertAddable,
  buildCartResponse,
  MAX_LINE_QTY,
  type CartResponse,
  type MergeReport,
} from "./cart.service.js";

/**
 * Cart instance operations + the guest→user merge (API_CONTRACT §3).
 * Identity resolution: the controller passes the resolved session/user;
 * every write verifies ownership server-side before touching a line.
 * The merge runs in ONE interactive transaction — a failure rolls back
 * everything; stock caps make an oversell unrepresentable.
 */

interface Identity {
  /** Authenticated user id, when present. */
  userId: bigint | null;
  /** Hashed guest session token (sessions.id), when a session exists. */
  sessionHash: string | null;
}

/** Resolve (or lazily create) the caller's cart. Never throws for guests. */
async function resolveCart(identity: Identity, create: true): Promise<{ id: bigint }>;
async function resolveCart(identity: Identity, create: false): Promise<{ id: bigint } | null>;
async function resolveCart(
  identity: Identity,
  create: boolean,
): Promise<{ id: bigint } | null> {
  if (identity.userId !== null) {
    const existing = await cartRepository.findCartByUserId(identity.userId);
    if (existing) return existing;
    return create ? cartRepository.createCart({ userId: identity.userId }) : null;
  }
  if (identity.sessionHash !== null) {
    const existing = await cartRepository.findCartBySessionToken(identity.sessionHash);
    if (existing) return existing;
    return create ? cartRepository.createCart({ sessionToken: identity.sessionHash }) : null;
  }
  // No session at all: the ensureSession middleware mints one on /auth
  // routes; cart routes require it, enforced by the controller.
  return null;
}

export const cartOps = {
  async getCart(identity: Identity): Promise<CartResponse> {
    const cart = await resolveCart(identity, false);
    if (!cart) {
      return { items: [], itemCount: 0, subtotal: { amount: "0.00" }, discountTotal: { amount: "0.00" }, total: { amount: "0.00" } };
    }
    const rows = await cartRepository.listLines(cart.id);
    return buildCartResponse(rows);
  },

  /** Add (or merge-into) a line; stock-checked against CURRENT availability. */
  async addItem(
    identity: Identity,
    productId: bigint,
    qty: number,
  ): Promise<CartResponse> {
    const product = await prismaProduct(productId);
    assertAddable(product, qty);

    const cart = await resolveCart(identity, true);
    if (!cart) {
      throw new ApiError(401, "authentication_required", "Your session has expired. Refresh and try again.");
    }

    const existing = await cartRepository.findLineByProduct(cart.id, product.id);
    if (existing) {
      const merged = existing.quantity + qty;
      if (merged > product.stockQuantity) {
        throw new ApiError(
          409,
          "stock_shortage",
          `You already have ${existing.quantity} in your cart; only ${product.stockQuantity} in stock.`,
        );
      }
      if (merged > MAX_LINE_QTY) {
        throw new ApiError(409, "max_quantity", `Quantity cannot exceed ${MAX_LINE_QTY} per item.`);
      }
      await cartRepository.updateLineQuantity(existing.id, merged);
    } else {
      await cartRepository.createLine(cart.id, product.id, qty);
    }

    const rows = await cartRepository.listLines(cart.id);
    return buildCartResponse(rows);
  },

  /**
   * Update quantity (0 = remove). Stock-checked; ownership via cart id.
   * Line ids are scoped to the caller's cart in the query itself.
   */
  async updateItem(
    identity: Identity,
    lineId: bigint,
    qty: number,
  ): Promise<CartResponse> {
    const cart = await resolveCart(identity, false);
    if (!cart) {
      throw new ApiError(404, "unknown_resource", "Cart item not found");
    }
    const line = await cartRepository.findLine(lineId, cart.id);
    if (!line) {
      throw new ApiError(404, "unknown_resource", "Cart item not found");
    }
    if (qty === 0) {
      await cartRepository.deleteLine(line.id);
    } else {
      const product = await prismaProduct(line.productId);
      if (!product || product.status !== "active") {
        throw new ApiError(409, "product_unavailable", "This product is no longer available. Remove it to continue.");
      }
      if (qty > product.stockQuantity) {
        throw new ApiError(
          409,
          "stock_shortage",
          `Only ${product.stockQuantity} in stock — reduce the quantity.`,
        );
      }
      await cartRepository.updateLineQuantity(line.id, qty);
    }
    const rows = await cartRepository.listLines(cart.id);
    return buildCartResponse(rows);
  },

  /** Remove a line. Idempotent-safe: a foreign/unknown id is a clean 404. */
  async removeItem(identity: Identity, lineId: bigint): Promise<CartResponse> {
    const cart = await resolveCart(identity, false);
    if (!cart) {
      throw new ApiError(404, "unknown_resource", "Cart item not found");
    }
    const line = await cartRepository.findLine(lineId, cart.id);
    if (!line) {
      throw new ApiError(404, "unknown_resource", "Cart item not found");
    }
    await cartRepository.deleteLine(line.id);
    const rows = await cartRepository.listLines(cart.id);
    return buildCartResponse(rows);
  },

  /**
   * Guest → user merge (API_CONTRACT §3). ONE interactive transaction:
   * union lines, sum duplicates, cap sums to current stock, drop
   * inactive/archived/missing products, delete the guest cart. A guest cart
   * absent or empty is a no-op with an empty report.
   */
  async mergeGuestCart(
    guestSessionHash: string | null,
    userId: bigint,
  ): Promise<MergeReport> {
    const report: MergeReport = { merged: [], capped: [], dropped: [] };
    if (!guestSessionHash) return report;

    return prisma.$transaction(async (tx) => {
      const guestCart = await tx.cart.findUnique({
        where: { sessionToken: guestSessionHash },
      });
      if (!guestCart) return report;

      const guestItems = await tx.cartItem.findMany({
        where: { cartId: guestCart.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (guestItems.length === 0) {
        await tx.cart.delete({ where: { id: guestCart.id } });
        return report;
      }

      // One active cart per user — create it inside the tx if missing.
      let userCart = await tx.cart.findUnique({ where: { userId } });
      if (!userCart) {
        userCart = await tx.cart.create({ data: { userId } });
      }

      for (const item of guestItems) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          report.dropped.push({
            product_id: item.productId.toString(),
            name: "Product no longer exists",
            reason: "removed_from_catalog",
          });
          continue;
        }
        if (product.status !== "active") {
          report.dropped.push({
            product_id: item.productId.toString(),
            name: product.name,
            reason: product.status === "archived" ? "archived" : "inactive",
          });
          continue;
        }

        const existingLine = await tx.cartItem.findUnique({
          where: { cartId_productId: { cartId: userCart.id, productId: item.productId } },
        });

        const requested = (existingLine?.quantity ?? 0) + item.quantity;
        const cappedTo = Math.min(requested, product.stockQuantity, MAX_LINE_QTY);

        if (cappedTo <= 0) {
          // e.g. back-in-stock race — treat as out of stock, honest drop.
          report.dropped.push({
            product_id: item.productId.toString(),
            name: product.name,
            reason: "out_of_stock",
          });
          continue;
        }

        if (existingLine) {
          await tx.cartItem.update({
            where: { id: existingLine.id },
            data: { quantity: cappedTo },
          });
        } else {
          await tx.cartItem.create({
            data: { cartId: userCart.id, productId: item.productId, quantity: cappedTo },
          });
        }

        if (cappedTo < requested) {
          report.capped.push({
            product_id: item.productId.toString(),
            name: product.name,
            quantity: cappedTo,
            requested,
          });
        } else {
          report.merged.push({
            product_id: item.productId.toString(),
            name: product.name,
            quantity: cappedTo,
          });
        }
      }

      // Guest cart is consumed — its identity is a consumed session anyway.
      await tx.cart.delete({ where: { id: guestCart.id } });

      return report;
    });
  },
};

/** Catalog row for stock/availability checks — fresh on every call. */
async function prismaProduct(productId: bigint) {
  return prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, status: true, stockQuantity: true },
  });
}
