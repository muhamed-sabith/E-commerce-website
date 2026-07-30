/**
 * Typed admin API (API_CONTRACT §4). Every endpoint is ADMIN-only on the
 * server; this module only shapes requests. Money arrives as exact decimal
 * strings and is displayed, never computed.
 */
import { apiRequest } from "./client";
import type { Money } from "./catalog";
import type { OrderStatus, PaymentStatus } from "./orders";

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export type StockState = "in_stock" | "low_stock" | "out_of_stock";
export type ProductStatus = "active" | "inactive" | "archived";
export type Discount = { type: "none" } | { type: "percent"; value: Money } | { type: "fixed"; value: Money };

export interface StockItem {
  id: string;
  name: string;
  sku: string;
  slug: string;
  status: ProductStatus;
  categoryName: string;
  stockQuantity: number;
  lowStockThreshold: number | null;
  effectiveThreshold: number;
  stockState: StockState;
  purchasable: boolean;
  updatedAt: string;
}

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  grandTotal: Money;
  itemCount: number;
  customer: { id: string; name: string; email: string };
}

export interface Dashboard {
  generatedAt: string;
  orders: { total: number; today: number; byStatus: Record<OrderStatus, number> };
  revenue: { paid: Money; awaitingPayment: Money; awaitingPaymentCount: number; todayOrderValue: Money };
  inventory: {
    lowStockThreshold: number;
    productCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    lowStock: StockItem[];
    outOfStock: StockItem[];
  };
  recentOrders: AdminOrderSummary[];
  paymentMode: "demo" | "manual";
}

export interface AdminProductRow {
  id: string;
  name: string;
  sku: string;
  slug: string;
  categoryName: string;
  price: Money;
  finalPrice: Money;
  status: ProductStatus;
  stockQuantity: number;
  stockState: StockState;
  image: { src: string; alt: string } | null;
  updatedAt: string;
}

export interface AdminImage {
  id: string;
  src: string;
  alt: string;
  position: number;
  isPrimary: boolean;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  price: Money;
  discount: Discount;
  finalPrice: Money;
  category: { id: string; name: string; isActive: boolean };
  status: ProductStatus;
  stockQuantity: number;
  lowStockThreshold: number | null;
  effectiveLowStockThreshold: number;
  stockState: StockState;
  images: AdminImage[];
  specifications: { key: string; value: string }[];
  deletion: "archive" | "delete";
  orderLineCount: number;
  stockHistory: { id: string; delta: number; resultingQuantity: number; reason: string; actorType: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  slug?: string;
  sku: string;
  description: string;
  price: string;
  discount: { type: "none" } | { type: "percent" | "fixed"; value: string };
  category_id: string;
  status: ProductStatus;
  low_stock_threshold: number | null;
  specifications: { key: string; value: string }[];
  stock_quantity?: number;
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
  activeProductCount: number;
  updatedAt: string;
}

export interface InventoryPage extends Page<StockItem> {
  counts: { all: number; low: number; out: number };
  lowStockThreshold: number;
}

export type AdjustmentInput =
  | { reason: "restock"; delta: number }
  | { reason: "damaged"; delta: number }
  | { reason: "correction"; delta: number }
  | { reason: "admin_set"; quantity: number };

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  customer: { id: string; name: string; email: string; isBlocked: boolean };
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
  }[];
  itemCount: number;
  subtotal: Money;
  discountTotal: Money;
  shippingTotal: Money;
  grandTotal: Money;
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
  confirmedAt: string | null;
  cancelledAt: string | null;
  timeline: {
    id: string;
    kind: "status" | "payment";
    from: string | null;
    to: string;
    at: string;
    actorType: "USER" | "ADMIN" | "SYSTEM";
    actorName: string | null;
    note: string | null;
  }[];
  actions: { nextStatuses: OrderStatus[]; canConfirmPayment: boolean };
  paymentMode: "demo" | "manual";
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "active" | "blocked";
  blockedReason: string | null;
  blockedAt: string | null;
  orderCount: number;
  lastOrderAt: string | null;
  createdAt: string;
}

export type SortKey = "newest" | "price_asc" | "price_desc" | "name_asc" | "name_desc";

export interface StoreSettings {
  settings: {
    lowStockThreshold: number;
    shippingFlatRate: Money;
    shippingFreeThreshold: Money;
    defaultSort: SortKey;
    pageSize: number;
    updatedAt: string | null;
    isDefault: boolean;
  };
  fixed: { brand: { name: string; tagline: string }; currency: string };
}

export interface StorePage {
  slug: "privacy" | "terms" | "returns" | "shipping" | "contact";
  title: string;
  published: boolean;
  body: string | null;
  updatedAt: string | null;
}

export interface SettingsInput {
  low_stock_threshold: number;
  shipping_flat_rate: string;
  shipping_free_threshold: string;
  default_sort: SortKey;
  page_size: number;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "page" && Number(v) <= 1) continue;
    s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

const id = encodeURIComponent;
const A = "/api/v1/admin";

export const adminApi = {
  dashboard: (): Promise<Dashboard> => apiRequest(`${A}/dashboard`),

  listProducts: (p: { q?: string; status?: string; category_id?: string; page?: number }): Promise<Page<AdminProductRow>> =>
    apiRequest(`${A}/products${qs(p)}`),
  getProduct: (pid: string): Promise<{ product: AdminProduct }> => apiRequest(`${A}/products/${id(pid)}`),
  createProduct: (body: ProductInput): Promise<{ product: AdminProduct }> =>
    apiRequest(`${A}/products`, { method: "POST", body }),
  updateProduct: (pid: string, body: Partial<ProductInput>): Promise<{ product: AdminProduct }> =>
    apiRequest(`${A}/products/${id(pid)}`, { method: "PATCH", body }),
  deleteProduct: (pid: string): Promise<{ result: "archived" | "deleted" }> =>
    apiRequest(`${A}/products/${id(pid)}`, { method: "DELETE" }),

  uploadImage: (pid: string, file: File, altText?: string): Promise<{ product: AdminProduct }> => {
    const form = new FormData();
    if (altText) form.append("alt_text", altText);
    form.append("image", file);
    return apiRequest(`${A}/products/${id(pid)}/images`, { method: "POST", body: form });
  },
  deleteImage: (imageId: string): Promise<{ product: AdminProduct }> =>
    apiRequest(`${A}/images/${id(imageId)}`, { method: "DELETE" }),
  makePrimary: (imageId: string): Promise<{ product: AdminProduct }> =>
    apiRequest(`${A}/images/${id(imageId)}/primary`, { method: "POST" }),

  listCategories: (): Promise<{ items: AdminCategory[] }> => apiRequest(`${A}/categories`),
  createCategory: (body: { name: string; slug?: string; is_active: boolean; sort_order: number }): Promise<{ items: AdminCategory[] }> =>
    apiRequest(`${A}/categories`, { method: "POST", body }),
  updateCategory: (
    cid: string,
    body: Partial<{ name: string; slug: string; is_active: boolean; sort_order: number }>,
  ): Promise<{ items: AdminCategory[] }> => apiRequest(`${A}/categories/${id(cid)}`, { method: "PATCH", body }),
  deleteCategory: (cid: string, reassignTo?: string): Promise<{ items: AdminCategory[] }> =>
    apiRequest(`${A}/categories/${id(cid)}${qs({ reassign_to: reassignTo })}`, { method: "DELETE" }),

  inventory: (p: { filter?: "all" | "low" | "out"; q?: string; page?: number }): Promise<InventoryPage> =>
    apiRequest(`${A}/inventory${qs({ ...p, filter: p.filter === "all" ? undefined : p.filter })}`),
  adjustStock: (
    pid: string,
    body: AdjustmentInput,
  ): Promise<{ adjustment: { id: string; delta: number; reason: string; resultingQuantity: number }; stockQuantity: number }> =>
    apiRequest(`${A}/products/${id(pid)}/stock-adjustments`, { method: "POST", body }),

  listOrders: (p: { q?: string; status?: string; payment?: string; page?: number }): Promise<Page<AdminOrderSummary>> =>
    apiRequest(`${A}/orders${qs(p)}`),
  getOrder: (oid: string): Promise<{ order: AdminOrderDetail }> => apiRequest(`${A}/orders/${id(oid)}`),
  setOrderStatus: (oid: string, status: OrderStatus, note?: string): Promise<{ order: AdminOrderDetail }> =>
    apiRequest(`${A}/orders/${id(oid)}/status`, { method: "POST", body: note ? { status, note } : { status } }),
  confirmPayment: (oid: string, note?: string): Promise<{ order: AdminOrderDetail }> =>
    apiRequest(`${A}/orders/${id(oid)}/payment-status`, {
      method: "POST",
      body: note ? { status: "PAID", note } : { status: "PAID" },
    }),

  listUsers: (p: { q?: string; status?: string; page?: number }): Promise<Page<AdminUser>> =>
    apiRequest(`${A}/users${qs(p)}`),
  blockUser: (uid: string, reason: string): Promise<{ user: AdminUser }> =>
    apiRequest(`${A}/users/${id(uid)}/block`, { method: "POST", body: { reason } }),
  unblockUser: (uid: string): Promise<{ user: AdminUser }> =>
    apiRequest(`${A}/users/${id(uid)}/unblock`, { method: "POST" }),

  listPages: (): Promise<{ items: StorePage[] }> => apiRequest(`${A}/pages`),
  savePage: (slug: string, body: string): Promise<{ page: StorePage }> =>
    apiRequest(`${A}/pages/${id(slug)}`, { method: "PUT", body: { body } }),
  unpublishPage: (slug: string): Promise<{ page: StorePage }> => apiRequest(`${A}/pages/${id(slug)}`, { method: "DELETE" }),

  getSettings: (): Promise<StoreSettings> => apiRequest(`${A}/settings`),
  putSettings: (body: SettingsInput): Promise<StoreSettings> => apiRequest(`${A}/settings`, { method: "PUT", body }),
};

export const SORT_LABEL: Record<SortKey, string> = {
  newest: "Newest first",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  name_asc: "Name: A to Z",
  name_desc: "Name: Z to A",
};

export const STOCK_REASON_LABEL: Record<string, string> = {
  restock: "Restock",
  correction: "Correction",
  damaged: "Damaged",
  admin_set: "Set count",
  sale: "Sale",
  cancel_restore: "Cancellation restock",
  initial: "Opening stock",
};
