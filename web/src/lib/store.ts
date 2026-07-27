import { useEffect, useState } from "react";
import { API_BASE_URL } from "../api/client";
import type { Money } from "../api/catalog";

/**
 * Public store facts (GET /api/v1/store): the shipping rule an admin set,
 * the payment mode, the brand. The storefront states only these — no
 * invented promises. Fetched once per page load and shared.
 */
export interface StoreInfo {
  brand: { name: string; tagline: string };
  currency: "INR";
  shipping: { flatRate: Money; freeThreshold: Money };
  paymentMode: "demo" | "manual";
  /** Policy/contact pages the business has published. */
  pages: ("privacy" | "terms" | "returns" | "shipping" | "contact")[];
}

let cached: Promise<StoreInfo | null> | null = null;

export function loadStore(): Promise<StoreInfo | null> {
  cached ??= fetch(`${API_BASE_URL}/api/v1/store`, { credentials: "include" })
    .then((r) => (r.ok ? (r.json() as Promise<StoreInfo>) : null))
    .catch(() => null);
  return cached;
}

/** Test seam. */
export function resetStoreCache() {
  cached = null;
}

export function useStore(): StoreInfo | null {
  const [store, setStore] = useState<StoreInfo | null>(null);
  useEffect(() => {
    let live = true;
    void loadStore().then((s) => {
      if (live) setStore(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return store;
}
