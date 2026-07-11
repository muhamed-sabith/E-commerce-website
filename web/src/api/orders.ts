/**
 * Typed checkout + orders API (API_CONTRACT §3). Requests carry an address
 * id or a demo method — never a price, total, status, or owner. Everything
 * shown to the shopper is the server's answer.
 */
import { apiRequest } from "./client";
import type { Money } from "./catalog";
import type { Address } from "./customer";

export type CheckoutAddress = Omit<Address, "createdAt" | "updatedAt">;

export interface LineProblem {
  line_id: string;
  product_id: string;
  name: string;
  reason: "unavailable" | "out_of_stock" | "insufficient_stock";
  requested: number;
  available: number;
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

export interface PaymentInstructions {
  mode: "demo" | "manual";
  demo_payment_url?: string;
}

export interface PlacedOrder {
  order: { id: string; orderNumber: string; status: string; paymentStatus: string; grandTotal: Money };
  payment: PaymentInstructions;
}

export type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type PaymentStatus = "PENDING_PAYMENT" | "PAID";

export interface OrderSummary {
  id: string;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  grandTotal: Money;
  itemCount: number;
}

export interface OrderDetail extends OrderSummary {
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
    image: { src: string; alt: string } | null;
  }[];
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
  subtotal: Money;
  discountTotal: Money;
  shippingTotal: Money;
  confirmedAt: string | null;
  cancelledAt: string | null;
  timeline: { from: string | null; to: string; at: string; note: string | null }[];
  payment: { mode: "demo" | "manual"; canPay: boolean; demo_payment_url?: string };
}

export interface OrderList {
  items: OrderSummary[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export type DemoMethod = "demo_card" | "demo_upi" | "demo_qr";

export const checkoutApi = {
  preview(addressId?: string): Promise<CheckoutPreview> {
    return apiRequest("/api/v1/checkout/preview", {
      method: "POST",
      body: addressId ? { address_id: addressId } : {},
    });
  },
  placeOrder(addressId: string): Promise<PlacedOrder> {
    return apiRequest("/api/v1/checkout", { method: "POST", body: { address_id: addressId } });
  },
};

export const ordersApi = {
  list(page = 1): Promise<OrderList> {
    return apiRequest(`/api/v1/orders${page > 1 ? `?page=${page}` : ""}`);
  },
  get(id: string): Promise<{ order: OrderDetail }> {
    return apiRequest(`/api/v1/orders/${encodeURIComponent(id)}`);
  },
  confirmDemoPayment(id: string, method: DemoMethod): Promise<{ order: OrderDetail }> {
    return apiRequest(`/api/v1/orders/${encodeURIComponent(id)}/demo-payment/confirm`, {
      method: "POST",
      body: { method },
    });
  },
  failDemoPayment(id: string, method: DemoMethod): Promise<{ order: OrderDetail }> {
    return apiRequest(`/api/v1/orders/${encodeURIComponent(id)}/demo-payment/fail`, {
      method: "POST",
      body: { method },
    });
  },
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Placed",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
};
