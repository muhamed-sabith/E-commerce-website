import { API_BASE_URL } from "./client";
/**
 * Typed catalog API surface (API_CONTRACT §2/§6). Money arrives as exact
 * decimal strings — the web app never computes prices, it only displays.
 */

export interface Money {
  amount: string;
}

export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  categoryName: string;
  categorySlug: string;
  price: Money;
  finalPrice: Money;
  discount: { type: "none" } | { type: "percent"; value: Money } | { type: "fixed"; value: Money };
  inStock: boolean;
  image: { src: string; alt: string } | null;
}

export interface ProductListResult {
  items: ProductListItem[];
  /** The sort the server applied (the store default when none was requested). */
  sort: CatalogSort;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  categoryName: string;
  categorySlug: string;
  price: Money;
  finalPrice: Money;
  discount: { type: "none" } | { type: "percent"; value: Money } | { type: "fixed"; value: Money };
  availability: "in_stock" | "out_of_stock";
  images: { src: string; alt: string }[];
  specifications: { key: string; value: string }[];
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  productCount: number;
}

export type CatalogSort = "price_asc" | "price_desc" | "newest" | "name_asc" | "name_desc";

export interface CatalogParams {
  q?: string;
  category?: string[];
  min_price?: string;
  max_price?: string;
  in_stock?: boolean;
  sort?: CatalogSort;
  page?: number;
  page_size?: number;
}

function toQueryString(params: CatalogParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  for (const c of params.category ?? []) search.append("category", c);
  if (params.min_price) search.set("min_price", params.min_price);
  if (params.max_price) search.set("max_price", params.max_price);
  if (params.in_stock) search.set("in_stock", "true");
  if (params.sort) search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  // Omitted page size → the store's configured default (admin Settings).
  if (params.page_size) search.set("page_size", String(params.page_size));
  return search.toString();
}

export const catalogApi = {
  listProducts(params: CatalogParams = {}): Promise<ProductListResult> {
    const qs = toQueryString(params);
    return apiGet(`/api/v1/products${qs ? `?${qs}` : ""}`);
  },
  getProduct(slug: string): Promise<ProductDetail> {
    return apiGet(`/api/v1/products/${encodeURIComponent(slug)}`);
  },
  listCategories(): Promise<{ items: CategorySummary[] }> {
    return apiGet("/api/v1/categories");
  },
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} on ${path}`);
  }
  return (await res.json()) as T;
}
