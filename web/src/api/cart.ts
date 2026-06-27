/**
 * Typed cart API surface (API_CONTRACT §3). The server is the sole source of
 * truth: every response is a fully recomputed cart (current prices, stock,
 * availability, totals). The client only ever sends a product id and a
 * quantity — never a price or a total.
 */
import { apiRequest } from "./client";
import type { Money } from "./catalog";

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
  /** Present only when the line cannot be bought as-is. */
  issue?: string;
}

export interface Cart {
  items: CartLine[];
  /** Count of purchasable units (available lines only). */
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

/** Server-side per-line cap (REQUIREMENTS §8). Mirrors the API for input bounds only. */
export const MAX_LINE_QTY = 99;

export const cartApi = {
  get(): Promise<Cart> {
    return apiRequest("/api/v1/cart");
  },
  addItem(productId: string, qty: number): Promise<Cart> {
    return apiRequest("/api/v1/cart/items", {
      method: "POST",
      body: { product_id: productId, qty },
    });
  },
  updateItem(lineId: string, qty: number): Promise<Cart> {
    return apiRequest(`/api/v1/cart/items/${encodeURIComponent(lineId)}`, {
      method: "PATCH",
      body: { qty },
    });
  },
  removeItem(lineId: string): Promise<Cart> {
    return apiRequest(`/api/v1/cart/items/${encodeURIComponent(lineId)}`, {
      method: "DELETE",
    });
  },
};

/** True when the report has anything worth telling the shopper. */
export function hasMergeNews(report: MergeReport | undefined): report is MergeReport {
  return (
    !!report &&
    report.merged.length + report.capped.length + report.dropped.length > 0
  );
}
