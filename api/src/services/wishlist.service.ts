import { z } from "zod";
import { ApiError } from "../middleware/error.js";
import { wishlistRepository, type WishlistRow } from "../repositories/wishlist.repository.js";
import { computeFinalPrice, type Money } from "./catalog.service.js";

/**
 * Wishlist rules (REQUIREMENTS §2.9, API_CONTRACT §3, DATABASE_SCHEMA §2.7):
 * - USER-only; every read/write is scoped to the authenticated user
 * - identity is (user, product): the item id on the wire IS the product id
 * - add is idempotent (composite PK); only the product id is accepted
 * - no price snapshot: responses are recomputed from live catalog rows
 * - inactive/archived/out-of-stock stay listed, flagged, never purchasable
 * - saving an unknown or hidden product is refused (404 — hidden products
 *   are invisible to customers, same as the catalog)
 */

export const addWishlistItemSchema = z
  .object({
    product_id: z.coerce.number().int().positive(),
  })
  .strict();

export type WishlistAvailability = "in_stock" | "out_of_stock" | "unavailable";

export interface WishlistItem {
  /** Stable item id — the saved product's id (composite key user+product). */
  id: string;
  savedAt: string;
  product: {
    id: string;
    name: string;
    slug: string;
    categoryName: string;
    image: { src: string; alt: string } | null;
  };
  price: Money;
  finalPrice: Money;
  availability: WishlistAvailability;
  /** Whether add-to-bag is allowed right now (active and in stock). */
  purchasable: boolean;
}

export interface WishlistResponse {
  items: WishlistItem[];
}

function money(d: { toFixed(n: number): string }): Money {
  return { amount: d.toFixed(2) };
}

export function toWishlistItem(row: WishlistRow): WishlistItem {
  const active = row.status === "active";
  const availability: WishlistAvailability = !active
    ? "unavailable"
    : row.stockQuantity > 0
      ? "in_stock"
      : "out_of_stock";
  return {
    id: row.productId.toString(),
    savedAt: row.createdAt.toISOString(),
    product: {
      id: row.productId.toString(),
      name: row.name,
      // Hidden products have no public page; don't hand out a dead link.
      slug: active ? row.slug : "",
      categoryName: row.categoryName,
      image: row.imagePath
        ? { src: `/assets/${row.imagePath}`, alt: row.imageAlt ?? row.name }
        : null,
    },
    price: money(row.price),
    finalPrice: money(computeFinalPrice(row.price, row.discountType, row.discountValue)),
    availability,
    purchasable: availability === "in_stock",
  };
}

export function parseWishlistItemId(raw: unknown): bigint {
  const s = typeof raw === "string" ? raw : "";
  if (!/^\d{1,18}$/.test(s)) {
    throw new ApiError(400, "validation_failed", "Invalid wishlist item id");
  }
  return BigInt(s);
}

export const wishlistService = {
  async list(userId: bigint): Promise<WishlistResponse> {
    const rows = await wishlistRepository.listForUser(userId);
    return { items: rows.map(toWishlistItem) };
  },

  async add(userId: bigint, productId: bigint): Promise<WishlistResponse> {
    const product = await wishlistRepository.findProduct(productId);
    if (!product || product.status !== "active") {
      throw new ApiError(404, "unknown_resource", "Product not found");
    }
    await wishlistRepository.add(userId, productId);
    return this.list(userId);
  },

  /** Foreign or unknown ids are a clean 404 — never reveal other users' data. */
  async remove(userId: bigint, productId: bigint): Promise<WishlistResponse> {
    const removed = await wishlistRepository.remove(userId, productId);
    if (!removed) {
      throw new ApiError(404, "unknown_resource", "Wishlist item not found");
    }
    return this.list(userId);
  },
};
