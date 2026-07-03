/**
 * Typed wishlist + address book API (API_CONTRACT §3, customer-only).
 * The client sends identities and form fields only — never prices, owners,
 * or default flags; every response is the server's current truth.
 */
import { apiRequest } from "./client";
import type { Money } from "./catalog";

// ---------- wishlist ----------

export type WishlistAvailability = "in_stock" | "out_of_stock" | "unavailable";

export interface WishlistItem {
  /** Equals the saved product's id. */
  id: string;
  savedAt: string;
  product: {
    id: string;
    name: string;
    /** Empty when the product has no public page any more. */
    slug: string;
    categoryName: string;
    image: { src: string; alt: string } | null;
  };
  price: Money;
  finalPrice: Money;
  availability: WishlistAvailability;
  purchasable: boolean;
}

export interface Wishlist {
  items: WishlistItem[];
}

export const wishlistApi = {
  get(): Promise<Wishlist> {
    return apiRequest("/api/v1/wishlist");
  },
  add(productId: string): Promise<Wishlist> {
    return apiRequest("/api/v1/wishlist/items", { method: "POST", body: { product_id: productId } });
  },
  remove(productId: string): Promise<Wishlist> {
    return apiRequest(`/api/v1/wishlist/items/${encodeURIComponent(productId)}`, {
      method: "DELETE",
    });
  },
};

// ---------- addresses ----------

export interface Address {
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
  createdAt: string;
  updatedAt: string;
}

/** Form payload — exactly the fields the API accepts (strict schema). */
export interface AddressInput {
  receiver_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
}

export const addressApi = {
  list(): Promise<{ items: Address[] }> {
    return apiRequest("/api/v1/addresses");
  },
  create(input: AddressInput): Promise<{ address: Address }> {
    return apiRequest("/api/v1/addresses", { method: "POST", body: input });
  },
  update(id: string, input: Partial<AddressInput>): Promise<{ address: Address }> {
    return apiRequest(`/api/v1/addresses/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
  },
  remove(id: string, newDefaultId?: string): Promise<{ items: Address[] }> {
    const qs = newDefaultId ? `?new_default_id=${encodeURIComponent(newDefaultId)}` : "";
    return apiRequest(`/api/v1/addresses/${encodeURIComponent(id)}${qs}`, { method: "DELETE" });
  },
  setDefault(id: string): Promise<{ items: Address[] }> {
    return apiRequest(`/api/v1/addresses/${encodeURIComponent(id)}/default`, { method: "POST" });
  },
};
