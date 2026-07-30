import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { CheckoutPreview, OrderDetail, OrderList } from "../api/orders";

/**
 * Checkout, demo payment, and order UI tests. API modules are replaced by
 * fakes that follow server rules; assertions check the UI sends only ids /
 * methods and renders the server's answers, including the timed payment
 * sequence (driven with fake timers).
 */

const mocks = vi.hoisted(() => ({
  checkout: { preview: vi.fn(), placeOrder: vi.fn() },
  orders: { list: vi.fn(), get: vi.fn(), confirmDemoPayment: vi.fn(), failDemoPayment: vi.fn() },
  cart: { get: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn() },
  auth: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
    updateProfile: vi.fn(),
  },
}));

vi.mock("../api/catalog", () => ({
  catalogApi: {
    listCategories: vi.fn().mockResolvedValue({ items: [] }),
    listProducts: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 12, totalItems: 0, totalPages: 0 }),
    getProduct: vi.fn(),
  },
}));
vi.mock("../api/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/orders")>();
  return { ...actual, checkoutApi: mocks.checkout, ordersApi: mocks.orders };
});
vi.mock("../api/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/cart")>();
  return { ...actual, cartApi: mocks.cart };
});
vi.mock("../api/customer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/customer")>();
  return { ...actual, wishlistApi: { get: vi.fn().mockResolvedValue({ items: [] }), add: vi.fn(), remove: vi.fn() } };
});
vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, ensureCsrf: vi.fn().mockResolvedValue(undefined), authApi: mocks.auth };
});

const amira = { id: "9", name: "Amira", email: "amira@example.com", role: "USER" as const };
const m = (amount: string) => ({ amount });

const kochi = {
  id: "1",
  receiverName: "Amira Rahman",
  phone: "+91 98765 43210",
  line1: "12 Marine Drive",
  line2: null,
  city: "Kochi",
  state: "Kerala",
  postalCode: "682001",
  countryCode: "IN",
  isDefault: true,
};
const mumbai = { ...kochi, id: "2", line1: "4 Hill Road", city: "Mumbai", state: "Maharashtra", postalCode: "400050", isDefault: false };

function preview(over: Partial<CheckoutPreview> = {}): CheckoutPreview {
  return {
    lines: [
      {
        id: "11",
        product: { id: "7", name: "Silk Slip Dress", slug: "silk-slip-dress", image: null },
        quantity: 1,
        unitPrice: m("5400.00"),
        discount: m("810.00"),
        finalPrice: m("4590.00"),
        lineTotal: m("4590.00"),
        problem: null,
      },
    ],
    problems: [],
    canPlaceOrder: true,
    address: kochi,
    addresses: [kochi, mumbai],
    itemCount: 1,
    subtotal: m("5400.00"),
    discountTotal: m("810.00"),
    shippingTotal: m("0.00"),
    grandTotal: m("4590.00"),
    shipping: { flatRate: m("99.00"), freeThreshold: m("2999.00") },
    ...over,
  };
}

function order(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "42",
    orderNumber: "HEY-260930-0007",
    placedAt: "2026-09-30T10:00:00.000Z",
    status: "pending",
    paymentStatus: "PENDING_PAYMENT",
    grandTotal: m("4590.00"),
    itemCount: 1,
    items: [
      {
        id: "1",
        productId: "7",
        name: "Silk Slip Dress",
        sku: "HEY-DRS-00004",
        unitPrice: m("5400.00"),
        discount: m("810.00"),
        finalPrice: m("4590.00"),
        quantity: 1,
        lineTotal: m("4590.00"),
        image: null,
      },
    ],
    shipping: {
      receiverName: "Amira Rahman",
      phone: "+91 98765 43210",
      line1: "12 Marine Drive",
      line2: null,
      city: "Kochi",
      state: "Kerala",
      postalCode: "682001",
      countryCode: "IN",
    },
    subtotal: m("5400.00"),
    discountTotal: m("810.00"),
    shippingTotal: m("0.00"),
    confirmedAt: null,
    cancelledAt: null,
    timeline: [],
    payment: { mode: "demo", canPay: true, demo_payment_url: "/payment/demo/42" },
    ...over,
  };
}

const paidOrder = () => order({ paymentStatus: "PAID", payment: { mode: "demo", canPay: false } });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.auth.me.mockResolvedValue({ user: amira });
  mocks.cart.get.mockResolvedValue({ items: [], itemCount: 0, subtotal: m("0.00"), discountTotal: m("0.00"), total: m("0.00") });
  mocks.checkout.preview.mockResolvedValue(preview());
  mocks.orders.get.mockResolvedValue({ order: order() });
});

// =============================================================
// CHECKOUT
// =============================================================

describe("checkout page", () => {
  it("shows address choice, pieces, and server totals", async () => {
    renderAt("/checkout");
    const lines = await screen.findAllByTestId("checkout-line");
    expect(lines).toHaveLength(1);
    expect(within(lines[0]).getByText("Silk Slip Dress")).toBeTruthy();
    expect(within(lines[0]).getByText("₹4,590.00", { selector: ".co__line-total" })).toBeTruthy();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);

    expect(screen.getByTestId("co-subtotal").textContent).toBe("₹5,400.00");
    expect(screen.getByTestId("co-discount").textContent).toContain("₹810.00");
    expect(screen.getByTestId("co-shipping").textContent).toBe("Free");
    expect(screen.getByTestId("co-total").textContent).toBe("₹4,590.00");
    expect(screen.getByTestId("place-order").textContent).toBe("Place order · ₹4,590.00");
  });

  it("changing the address re-previews with that id only", async () => {
    const user = userEvent.setup();
    renderAt("/checkout");
    await screen.findAllByTestId("checkout-line");
    mocks.checkout.preview.mockResolvedValueOnce(preview({ address: mumbai }));
    await user.click(screen.getByRole("radio", { name: /Mumbai/ }));
    await waitFor(() => expect(mocks.checkout.preview).toHaveBeenLastCalledWith("2"));
    await waitFor(() => expect((screen.getByRole("radio", { name: /Mumbai/ }) as HTMLInputElement).checked).toBe(true));
  });

  it("places the order with the address id and goes to the demo payment page", async () => {
    const user = userEvent.setup();
    mocks.checkout.placeOrder.mockResolvedValue({
      order: { id: "42", orderNumber: "HEY-260930-0007", status: "pending", paymentStatus: "PENDING_PAYMENT", grandTotal: m("4590.00") },
      payment: { mode: "demo", demo_payment_url: "/payment/demo/42" },
    });
    renderAt("/checkout");
    await user.click(await screen.findByTestId("place-order"));
    await waitFor(() => expect(mocks.checkout.placeOrder).toHaveBeenCalledWith("1"));
    expect(mocks.checkout.placeOrder.mock.calls[0]).toHaveLength(1);
    expect(await screen.findByRole("heading", { name: "Complete your payment" })).toBeTruthy();
    expect(screen.getByTestId("demo-banner").textContent).toContain("DEMO / TEST MODE");
  });

  it("in manual mode goes to the order page instead", async () => {
    const user = userEvent.setup();
    mocks.checkout.placeOrder.mockResolvedValue({
      order: { id: "42", orderNumber: "HEY-260930-0007", status: "pending", paymentStatus: "PENDING_PAYMENT", grandTotal: m("4590.00") },
      payment: { mode: "manual" },
    });
    mocks.orders.get.mockResolvedValue({ order: order({ payment: { mode: "manual", canPay: false } }) });
    renderAt("/checkout");
    await user.click(await screen.findByTestId("place-order"));
    expect(await screen.findByTestId("order-placed")).toBeTruthy();
    expect(screen.getByText("Payment for this order will be confirmed by our team.")).toBeTruthy();
  });

  it("ignores a second click while placing (one request)", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mocks.checkout.placeOrder.mockReturnValue(new Promise((r) => (resolve = r)));
    renderAt("/checkout");
    const btn = await screen.findByTestId("place-order");
    await user.click(btn);
    await user.click(btn);
    expect(mocks.checkout.placeOrder).toHaveBeenCalledTimes(1);
    expect(btn.textContent).toContain("Placing your order");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      resolve({ order: { id: "42" }, payment: { mode: "demo", demo_payment_url: "/payment/demo/42" } });
    });
  });

  it("stock changes: shows the server's reason, re-reads the preview, focuses the alert", async () => {
    const user = userEvent.setup();
    const { ApiRequestError } = await import("../api/client");
    mocks.checkout.placeOrder.mockRejectedValue(
      new ApiRequestError(409, "stock_shortage", "Silk Slip Dress just sold out. Remove it from your bag to continue."),
    );
    renderAt("/checkout");
    const place = await screen.findByTestId("place-order");
    // the server's state after someone else bought the last one
    mocks.checkout.preview.mockResolvedValue(
      preview({
        canPlaceOrder: false,
        problems: [{ line_id: "11", product_id: "7", name: "Silk Slip Dress", reason: "out_of_stock", requested: 1, available: 0 }],
        lines: [{ ...preview().lines[0], problem: { line_id: "11", product_id: "7", name: "Silk Slip Dress", reason: "out_of_stock", requested: 1, available: 0 } }],
      }),
    );
    await user.click(place);
    const alert = await screen.findByTestId("checkout-error");
    expect(alert.textContent).toContain("just sold out");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(await screen.findByTestId("line-problem")).toBeTruthy();
    expect(screen.getByTestId("place-order").getAttribute("aria-disabled")).toBe("true");
  });

  it("flags unavailable lines and blocks placing, with a reason", async () => {
    mocks.checkout.preview.mockResolvedValue(
      preview({
        canPlaceOrder: false,
        problems: [{ line_id: "11", product_id: "7", name: "Silk Slip Dress", reason: "insufficient_stock", requested: 3, available: 1 }],
        lines: [{ ...preview().lines[0], quantity: 3, problem: { line_id: "11", product_id: "7", name: "Silk Slip Dress", reason: "insufficient_stock", requested: 3, available: 1 } }],
      }),
    );
    renderAt("/checkout");
    expect((await screen.findByTestId("line-problem")).textContent).toContain("Only 1 left, you have 3");
    const btn = screen.getByTestId("place-order");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(btn.getAttribute("aria-describedby")!)?.textContent).toContain("need attention");
  });

  it("no address: explains and links to the address book", async () => {
    mocks.checkout.preview.mockResolvedValue(preview({ address: null, addresses: [], canPlaceOrder: false }));
    renderAt("/checkout");
    expect(await screen.findByTestId("no-address")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add an address" }).getAttribute("href")).toBe("/account/addresses");
    expect(screen.getByTestId("place-order").getAttribute("aria-disabled")).toBe("true");
  });

  it("empty bag and load error states", async () => {
    const user = userEvent.setup();
    const { ApiRequestError } = await import("../api/client");
    mocks.checkout.preview.mockRejectedValueOnce(new ApiRequestError(409, "cart_empty", "Your bag is empty."));
    const { unmount } = renderAt("/checkout");
    expect(await screen.findByTestId("checkout-empty")).toBeTruthy();
    unmount();

    mocks.checkout.preview.mockRejectedValueOnce(new Error("offline"));
    renderAt("/checkout");
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't load your checkout");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByTestId("checkout-line")).toHaveLength(1);
  });

  it("guests are sent to sign in, which returns them to checkout", async () => {
    mocks.auth.me.mockResolvedValue({ user: null });
    renderAt("/checkout");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(mocks.checkout.preview).not.toHaveBeenCalled();
  });
});

// =============================================================
// DEMO PAYMENT
// =============================================================

describe("demo payment", () => {
  async function openSheet(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByTestId("open-demo-payment"));
  }

  it("always shows DEMO / TEST MODE and the order summary; asks for no credentials", async () => {
    renderAt("/payment/demo/42");
    expect(await screen.findByRole("heading", { name: "Complete your payment" })).toBeTruthy();
    expect(screen.getByTestId("demo-banner").textContent).toContain("DEMO / TEST MODE");
    expect(screen.getByText("Order HEY-260930-0007", { selector: ".pay__eyebrow" })).toBeTruthy();
    expect(screen.getByTestId("pay-total").textContent).toBe("₹4,590.00");
    expect(screen.getByTestId("open-demo-payment").textContent).toBe("Pay ₹4,590.00 (Demo)");
    // nothing on the payment page is shaped like a payment credential
    const main = screen.getByRole("main");
    expect(main.querySelectorAll("input:not([type=radio]), textarea")).toHaveLength(0);
    expect(main.textContent).not.toMatch(/CVV|card number|UPI PIN|OTP|expiry/i);
  });

  it("opening sequence: pressed button → Securing → Connecting → method choice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt("/payment/demo/42");
    await openSheet(user);

    const btn = screen.getByTestId("open-demo-payment");
    expect(btn.textContent).toContain("Opening");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const status = screen.getByTestId("sheet-status");
    expect(status.textContent).toBe("Securing your payment…");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(status.textContent).toBe("Connecting securely…");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole("group", { name: "Choose a demo method" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual([
      expect.stringContaining("Demo Card"),
      expect.stringContaining("Demo UPI"),
      expect.stringContaining("Demo QR"),
    ]);
    expect(screen.getByTestId("sheet-demo-badge").textContent).toBe("DEMO / TEST MODE");
    expect(document.activeElement).toBe(screen.getByTestId("demo-pay"));
  });

  it("success: Securing → Processing → Payment confirmed → success page with actions", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.orders.confirmDemoPayment.mockResolvedValue({ order: paidOrder() });
    renderAt("/payment/demo/42");
    await openSheet(user);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await user.click(screen.getByRole("radio", { name: /Demo UPI/ }));
    await user.click(screen.getByTestId("demo-pay"));

    // reduced-motion step = 180ms in jsdom (no matchMedia)
    const status = screen.getByTestId("sheet-status");
    expect(status.textContent).toBe("Securing your payment…");
    await act(async () => { await vi.advanceTimersByTimeAsync(190); });
    expect(status.textContent).toBe("Processing…");
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await waitFor(() => expect(status.textContent).toBe("Payment confirmed"));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(mocks.orders.confirmDemoPayment).toHaveBeenCalledWith("42", "demo_upi");
    const success = await screen.findByTestId("payment-success");
    expect(within(success).getByRole("heading", { name: "Payment successful" })).toBeTruthy();
    expect(screen.getByTestId("paid-order-number").textContent).toBe("HEY-260930-0007");
    expect(screen.getByTestId("paid-status").textContent).toContain("Paid");
    expect(within(success).getByRole("link", { name: "View order" }).getAttribute("href")).toBe("/orders/42");
    expect(within(success).getByRole("link", { name: "Continue shopping" })).toBeTruthy();
    expect(screen.getByTestId("demo-banner")).toBeTruthy(); // still labelled as demo
  });

  it("failure keeps the order payable; Try again returns to the method choice and can succeed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.orders.failDemoPayment.mockResolvedValue({ order: order() });
    mocks.orders.confirmDemoPayment.mockResolvedValue({ order: paidOrder() });
    renderAt("/payment/demo/42");
    await openSheet(user);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await user.click(screen.getByTestId("demo-fail"));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const failed = await screen.findByTestId("payment-failed");
    expect(within(failed).getByRole("heading", { name: "Payment unsuccessful" })).toBeTruthy();
    expect(failed.textContent).toContain("nothing was charged");
    expect(mocks.orders.failDemoPayment).toHaveBeenCalledWith("42", "demo_card");

    await user.click(within(failed).getByTestId("demo-retry"));
    await user.click(screen.getByTestId("demo-pay"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(await screen.findByTestId("payment-success")).toBeTruthy();
    expect(mocks.orders.confirmDemoPayment).toHaveBeenCalledTimes(1);
  });

  it("a network error during payment shows the failure state, not a crash", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.orders.confirmDemoPayment.mockRejectedValue(new Error("offline"));
    renderAt("/payment/demo/42");
    await openSheet(user);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await user.click(screen.getByTestId("demo-pay"));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect((await screen.findByTestId("payment-failed")).textContent).toContain("couldn't reach the demo payment service");
  });

  it("an already-paid order opens straight to the success state", async () => {
    mocks.orders.get.mockResolvedValue({ order: paidOrder() });
    renderAt("/payment/demo/42");
    expect(await screen.findByTestId("payment-success")).toBeTruthy();
    expect(screen.queryByTestId("open-demo-payment")).toBeNull();
  });

  it("manual mode / not payable: no payment action", async () => {
    mocks.orders.get.mockResolvedValue({ order: order({ payment: { mode: "manual", canPay: false } }) });
    renderAt("/payment/demo/42");
    expect(await screen.findByTestId("payment-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("open-demo-payment")).toBeNull();
  });

  it("another user's order id shows not found", async () => {
    const { ApiRequestError } = await import("../api/client");
    mocks.orders.get.mockRejectedValue(new ApiRequestError(404, "unknown_resource", "Order not found"));
    renderAt("/payment/demo/99");
    expect(await screen.findByRole("heading", { name: "Order not found" })).toBeTruthy();
  });
});

// =============================================================
// ORDERS
// =============================================================

describe("orders", () => {
  const list: OrderList = {
    items: [
      { id: "42", orderNumber: "HEY-260930-0007", placedAt: "2026-09-30T10:00:00.000Z", status: "pending", paymentStatus: "PAID", grandTotal: m("4590.00"), itemCount: 1 },
      { id: "41", orderNumber: "HEY-260929-0002", placedAt: "2026-09-29T10:00:00.000Z", status: "cancelled", paymentStatus: "PENDING_PAYMENT", grandTotal: m("349.00"), itemCount: 2 },
    ],
    page: 1,
    page_size: 12,
    total_items: 2,
    total_pages: 1,
  };

  it("history lists number, date, total, status and payment in words", async () => {
    mocks.orders.list.mockResolvedValue(list);
    renderAt("/orders");
    const rows = await screen.findAllByTestId("order-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link", { name: "HEY-260930-0007" }).getAttribute("href")).toBe("/orders/42");
    expect(within(rows[0]).getByText("Paid")).toBeTruthy();
    expect(within(rows[0]).getByText("Placed")).toBeTruthy();
    expect(within(rows[0]).getByText("₹4,590.00")).toBeTruthy();
    expect(within(rows[1]).getByText("Cancelled")).toBeTruthy();
    expect(within(rows[1]).getByText("Awaiting payment")).toBeTruthy();
  });

  it("empty history and error states", async () => {
    const user = userEvent.setup();
    mocks.orders.list.mockResolvedValueOnce({ ...list, items: [], total_items: 0, total_pages: 0 });
    const { unmount } = renderAt("/orders");
    expect(await screen.findByTestId("orders-empty")).toBeTruthy();
    unmount();
    mocks.orders.list.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(list);
    renderAt("/orders");
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't load your orders");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByTestId("order-row")).toHaveLength(2);
  });

  it("detail shows purchase-time snapshot, shipping snapshot, totals, and a pay link while pending", async () => {
    renderAt("/orders/42");
    expect((await screen.findByTestId("order-number")).textContent).toBe("HEY-260930-0007");
    const item = screen.getByTestId("order-item");
    expect(item.textContent).toContain("Silk Slip Dress");
    expect(item.textContent).toContain("1 × ₹4,590.00");
    expect(item.textContent).toContain("₹5,400.00");
    expect(item.textContent).toContain("SKU HEY-DRS-00004");
    expect(screen.getByTestId("order-address").textContent).toContain("Kochi, Kerala 682001");
    expect(screen.getByTestId("order-total").textContent).toBe("₹4,590.00");
    expect(screen.getByText("Awaiting payment")).toBeTruthy();
    expect(within(screen.getByTestId("order-pay-cta")).getByRole("link").getAttribute("href")).toBe("/payment/demo/42");
  });

  it("detail renders snapshot text as text, never markup", async () => {
    mocks.orders.get.mockResolvedValue({
      order: order({ shipping: { ...order().shipping, line1: `<img src=x onerror="alert(1)">` } }),
    });
    renderAt("/orders/42");
    const addr = await screen.findByTestId("order-address");
    expect(addr.querySelector("img")).toBeNull();
    expect(addr.textContent).toContain(`<img src=x onerror="alert(1)">`);
  });

  it("an unknown or foreign order shows not found", async () => {
    const { ApiRequestError } = await import("../api/client");
    mocks.orders.get.mockRejectedValue(new ApiRequestError(404, "unknown_resource", "Order not found"));
    renderAt("/orders/999");
    expect(await screen.findByTestId("order-missing")).toBeTruthy();
  });

  it("the account page links to orders", async () => {
    renderAt("/account");
    expect(await screen.findByRole("heading", { name: "Your account" })).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: /^Orders/ }).getAttribute("href")).toBe("/orders");
  });
});
