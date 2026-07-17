import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { ApiRequestError } from "../api/client";
import type { AdminCategory, AdminOrderDetail, AdminProduct, AdminUser, Dashboard, StoreSettings } from "../api/admin";
import { validateProduct } from "./ProductForm";

// Minimal DOM matchers (the project doesn't depend on jest-dom).
declare module "vitest" {
  interface Assertion {
    toBeInTheDocument(): void;
    toHaveAttribute(name: string, value?: string): void;
    toHaveTextContent(text: string): void;
    toHaveFocus(): void;
    toBeDisabled(): void;
    toHaveValue(value: string): void;
  }
}
expect.extend({
  toBeInTheDocument(el: Element | null) {
    const pass = el !== null && el.ownerDocument.contains(el);
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be in the document` };
  },
  toHaveAttribute(el: Element, name: string, value?: string) {
    const actual = el.getAttribute(name);
    const pass = value === undefined ? actual !== null : actual === value;
    return { pass, message: () => `expected [${name}] ${pass ? "not " : ""}to be ${value ?? "present"}, got ${actual}` };
  },
  toHaveTextContent(el: Element, text: string) {
    const actual = el.textContent ?? "";
    const pass = actual.includes(text);
    return { pass, message: () => `expected text ${pass ? "not " : ""}to include "${text}", got "${actual}"` };
  },
  toHaveFocus(el: Element) {
    const pass = el.ownerDocument.activeElement === el;
    return { pass, message: () => `expected element ${pass ? "not " : ""}to have focus (active: ${el.ownerDocument.activeElement?.outerHTML.slice(0, 80)})` };
  },
  toBeDisabled(el: Element) {
    const pass = (el as HTMLButtonElement).disabled === true;
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be disabled` };
  },
  toHaveValue(el: Element, value: string) {
    const actual = (el as HTMLInputElement).value;
    return { pass: actual === value, message: () => `expected value "${value}", got "${actual}"` };
  },
});

/**
 * Admin UI tests. The admin API is replaced by in-memory fakes that answer
 * like the server (ladder, payment rules, deletion policy, block rules), so
 * the screens are exercised against realistic responses and errors.
 */

const mocks = vi.hoisted(() => ({
  admin: {
    dashboard: vi.fn(),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    uploadImage: vi.fn(),
    deleteImage: vi.fn(),
    makePrimary: vi.fn(),
    listCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    inventory: vi.fn(),
    adjustStock: vi.fn(),
    listOrders: vi.fn(),
    getOrder: vi.fn(),
    setOrderStatus: vi.fn(),
    confirmPayment: vi.fn(),
    listUsers: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
    getSettings: vi.fn(),
    putSettings: vi.fn(),
  },
  auth: { me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(), changePassword: vi.fn(), updateProfile: vi.fn() },
  cart: { get: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn() },
}));

vi.mock("../api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/admin")>();
  return { ...actual, adminApi: mocks.admin };
});
vi.mock("../api/catalog", () => ({
  catalogApi: {
    listCategories: vi.fn().mockResolvedValue({ items: [] }),
    listProducts: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 12, totalItems: 0, totalPages: 0 }),
    getProduct: vi.fn(),
  },
}));
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

const admin = { id: "1", name: "Rahima Admin", email: "rahima@heyrah.test", role: "ADMIN" as const };
const customer = { id: "9", name: "Amira", email: "amira@example.com", role: "USER" as const };
const m = (amount: string) => ({ amount });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

// ---------- fixtures ----------

const emptyDashboard: Dashboard = {
  generatedAt: "2026-10-01T10:00:00.000Z",
  orders: { total: 0, today: 0, byStatus: { pending: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 } },
  revenue: { paid: m("0.00"), awaitingPayment: m("0.00"), awaitingPaymentCount: 0, todayOrderValue: m("0.00") },
  inventory: { lowStockThreshold: 5, productCount: 0, lowStockCount: 0, outOfStockCount: 0, lowStock: [], outOfStock: [] },
  recentOrders: [],
  paymentMode: "manual",
};

const categories: AdminCategory[] = [
  { id: "1", name: "Dresses", slug: "dresses", isActive: true, sortOrder: 1, productCount: 2, activeProductCount: 2, updatedAt: "2026-09-01T00:00:00Z" },
  { id: "2", name: "Accessories", slug: "accessories", isActive: true, sortOrder: 2, productCount: 0, activeProductCount: 0, updatedAt: "2026-09-01T00:00:00Z" },
];

function product(over: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: "50",
    name: "Silk Slip Dress",
    slug: "silk-slip-dress",
    sku: "HEY-DRS-00004",
    description: "Bias-cut silk.",
    price: m("5400.00"),
    discount: { type: "none" },
    finalPrice: m("5400.00"),
    category: { id: "1", name: "Dresses", isActive: true },
    status: "active",
    stockQuantity: 5,
    lowStockThreshold: null,
    effectiveLowStockThreshold: 5,
    stockState: "low_stock",
    images: [{ id: "900", src: "/assets/products/50/a.webp", alt: "Silk Slip Dress", position: 0, isPrimary: true }],
    specifications: [],
    deletion: "archive",
    orderLineCount: 3,
    stockHistory: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function order(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: "77",
    orderNumber: "HEY-261001-0007",
    placedAt: "2026-10-01T05:00:00Z",
    status: "pending",
    paymentStatus: "PENDING_PAYMENT",
    customer: { id: "9", name: "Amira", email: "amira@example.com", isBlocked: false },
    items: [
      { id: "1", productId: "50", name: "Silk Slip Dress", sku: "HEY-DRS-00004", unitPrice: m("5400.00"), discount: m("0.00"), finalPrice: m("5400.00"), quantity: 2, lineTotal: m("10800.00") },
    ],
    itemCount: 2,
    subtotal: m("10800.00"),
    discountTotal: m("0.00"),
    shippingTotal: m("0.00"),
    grandTotal: m("10800.00"),
    shipping: { receiverName: "Amira Rahman", phone: "+91 98765 43210", line1: "12 Marine Drive", line2: null, city: "Kochi", state: "Kerala", postalCode: "682001", countryCode: "IN" },
    confirmedAt: null,
    cancelledAt: null,
    timeline: [{ id: "1", kind: "status", from: null, to: "pending", at: "2026-10-01T05:00:00Z", actorType: "USER", actorName: null, note: null }],
    actions: { nextStatuses: ["confirmed", "cancelled"], canConfirmPayment: true },
    paymentMode: "manual",
    ...over,
  };
}

const settings: StoreSettings = {
  settings: { lowStockThreshold: 5, shippingFlatRate: m("99.00"), shippingFreeThreshold: m("2999.00"), defaultSort: "newest", pageSize: 12, updatedAt: null, isDefault: true },
  fixed: { brand: { name: "HEYRAH", tagline: "Wings of Style" }, currency: "INR" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.me.mockResolvedValue({ user: admin });
  mocks.auth.logout.mockResolvedValue({ ok: true });
  mocks.cart.get.mockResolvedValue({ items: [], itemCount: 0, subtotal: m("0.00"), discountTotal: m("0.00"), total: m("0.00") });
  mocks.admin.dashboard.mockResolvedValue(emptyDashboard);
  mocks.admin.listCategories.mockResolvedValue({ items: categories });
  // jsdom has no showModal; the dialog falls back to the open attribute.
});

// =============================================================

describe("admin routing + authorization UI", () => {
  it("a customer sees a staff-only message and no admin navigation", async () => {
    mocks.auth.me.mockResolvedValue({ user: customer });
    renderAt("/admin/orders");
    expect(await screen.findByRole("heading", { name: "This area is for HEYRAH staff" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Admin" })).not.toBeInTheDocument();
    expect(mocks.admin.listOrders).not.toHaveBeenCalled();
  });

  it("a guest is redirected to sign in", async () => {
    mocks.auth.me.mockResolvedValue({ user: null });
    renderAt("/admin");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("an admin gets the shell with identity, navigation, and sign out", async () => {
    renderAt("/admin");
    const nav = await screen.findByRole("navigation", { name: "Admin" });
    for (const label of ["Dashboard", "Orders", "Products", "Categories", "Inventory", "Customers", "Settings"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByText("rahima@heyrah.test")).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("button", { name: "Sign out" }));
    expect(mocks.auth.logout).toHaveBeenCalled();
  });

  it("the storefront header links admins (only admins) to the panel", async () => {
    renderAt("/products");
    expect(await screen.findByRole("link", { name: "Admin", exact: true } as never)).toHaveAttribute("href", "/admin");
  });

  it("mobile menu toggle exposes its state", async () => {
    renderAt("/admin");
    const toggle = await screen.findByRole("button", { name: "Menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("dashboard", () => {
  it("shows honest zeros and empty states", async () => {
    renderAt("/admin");
    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByText("Every product is well stocked")).toBeInTheDocument();
    const paid = screen.getByText("Paid revenue").closest(".adm-figure")!;
    expect(within(paid as HTMLElement).getByText("₹0.00")).toBeInTheDocument();
  });

  it("renders real values from the API", async () => {
    mocks.admin.dashboard.mockResolvedValue({
      ...emptyDashboard,
      orders: { total: 12, today: 3, byStatus: { pending: 4, confirmed: 2, shipped: 3, delivered: 2, cancelled: 1 } },
      revenue: { paid: m("25400.00"), awaitingPayment: m("8100.00"), awaitingPaymentCount: 4, todayOrderValue: m("6300.00") },
      inventory: {
        ...emptyDashboard.inventory,
        outOfStockCount: 1,
        outOfStock: [{ id: "5", name: "Trench Overcoat", sku: "HEY-OUT-00002", slug: "t", status: "active", categoryName: "Outerwear", stockQuantity: 0, lowStockThreshold: null, effectiveThreshold: 5, stockState: "out_of_stock", purchasable: false, updatedAt: "" }],
      },
      recentOrders: [{ id: "77", orderNumber: "HEY-261001-0007", placedAt: "2026-10-01T05:00:00Z", status: "pending", paymentStatus: "PENDING_PAYMENT", grandTotal: m("10800.00"), itemCount: 2, customer: { id: "9", name: "Amira", email: "a@x" } }],
    });
    renderAt("/admin");
    expect(await screen.findByText("₹25,400.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Awaiting payment/ })).toHaveAttribute("href", "/admin/orders?payment=PENDING_PAYMENT");
    expect(screen.getByRole("link", { name: "HEY-261001-0007" })).toHaveAttribute("href", "/admin/orders/77");
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /4\s*Placed/ })).toHaveAttribute("href", "/admin/orders?status=pending");
  });

  it("shows an error with retry", async () => {
    mocks.admin.dashboard.mockRejectedValueOnce(new ApiRequestError(500, "internal_error", "Server unavailable"));
    renderAt("/admin");
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
  });
});

describe("products", () => {
  it("validates the product form like the server", () => {
    const base = {
      name: "Kaftan",
      slug: "",
      sku: "HEY-DRS-00099",
      description: "d",
      price: "1000.00",
      discountType: "none" as const,
      discountValue: "",
      categoryId: "1",
      status: "inactive" as const,
      lowStock: "",
      stock: "0",
      specs: [],
    };
    expect(validateProduct(base, "create", false)).toEqual({});
    expect(validateProduct({ ...base, price: "0" }, "create", false).price).toBe("Price must be greater than 0");
    expect(validateProduct({ ...base, price: "12.345" }, "create", false).price).toBeDefined();
    expect(validateProduct({ ...base, sku: "ABC" }, "create", false).sku).toBeDefined();
    expect(validateProduct({ ...base, discountType: "percent", discountValue: "100" }, "create", false)["discount.value"]).toBe("A percent discount must be below 100");
    expect(validateProduct({ ...base, discountType: "fixed", discountValue: "1000" }, "create", false)["discount.value"]).toBe("A fixed discount must be less than the price");
    expect(validateProduct({ ...base, stock: "-1" }, "create", false).stock).toBeDefined();
    expect(validateProduct({ ...base, status: "active" }, "edit", false).status).toBeDefined();
    expect(validateProduct({ ...base, status: "active" }, "edit", true).status).toBeUndefined();
  });

  it("create: client errors focus the first field; server errors map to fields and keep input", async () => {
    mocks.admin.createProduct.mockRejectedValueOnce(
      new ApiRequestError(409, "sku_taken", "Another product already uses this SKU", [{ path: ["sku"], message: "Another product already uses this SKU" }]),
    );
    mocks.admin.createProduct.mockResolvedValueOnce({ product: product({ id: "61", name: "Saffron Kaftan", status: "inactive", images: [] }) });
    mocks.admin.getProduct.mockResolvedValue({ product: product({ id: "61", name: "Saffron Kaftan", status: "inactive", images: [] }) });
    const user = userEvent.setup();
    renderAt("/admin/products/new");

    await user.click(await screen.findByRole("button", { name: "Create product" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Check the highlighted fields.");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");

    await user.type(screen.getByLabelText("Name"), "Saffron Kaftan");
    await user.type(screen.getByLabelText("SKU"), "hey-kur-00001");
    await user.selectOptions(screen.getByLabelText("Category"), "Dresses");
    await user.type(screen.getByLabelText("Description"), "Linen.");
    await user.type(screen.getByLabelText("Price (₹)"), "3200.00");
    await user.click(screen.getByRole("button", { name: "Create product" }));

    expect(await screen.findByText("Another product already uses this SKU", { selector: ".adm-field__error" })).toBeInTheDocument();
    expect(screen.getByLabelText("SKU")).toHaveFocus();
    expect(screen.getByLabelText("Name")).toHaveValue("Saffron Kaftan");
    expect(mocks.admin.createProduct.mock.calls[0][0]).toMatchObject({ sku: "HEY-KUR-00001", price: "3200.00", stock_quantity: 0, status: "inactive" });

    await user.clear(screen.getByLabelText("SKU"));
    await user.type(screen.getByLabelText("SKU"), "HEY-DRS-00061");
    await user.click(screen.getByRole("button", { name: "Create product" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Saffron Kaftan" })).toBeInTheDocument();
  });

  it("prevents a double submit while saving", async () => {
    let resolve!: (v: unknown) => void;
    mocks.admin.getProduct.mockResolvedValue({ product: product() });
    mocks.admin.updateProduct.mockImplementation(() => new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderAt("/admin/products/50");
    const save = await screen.findByRole("button", { name: "Save changes" });
    await user.click(save);
    expect(await screen.findByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Saving…" }));
    expect(mocks.admin.updateProduct).toHaveBeenCalledTimes(1);
    resolve({ product: product() });
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
  });

  it("archive needs confirmation; the dialog explains why it's archive not delete", async () => {
    mocks.admin.getProduct.mockResolvedValue({ product: product() });
    mocks.admin.deleteProduct.mockResolvedValue({ result: "archived" });
    const user = userEvent.setup();
    renderAt("/admin/products/50");
    expect(await screen.findByText(/can only be archived/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archive product" }));
    const dialog = screen.getByRole("dialog", { name: "Archive Silk Slip Dress?" });
    expect(within(dialog).getByRole("button", { name: "Keep product" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Keep product" }));
    expect(mocks.admin.deleteProduct).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Archive product" }));
    mocks.admin.getProduct.mockResolvedValue({ product: product({ status: "archived" }) });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive product" }));
    expect(mocks.admin.deleteProduct).toHaveBeenCalledWith("50");
    expect(await screen.findByText("Silk Slip Dress archived.")).toBeInTheDocument();
  });

  it("image upload: client checks, server error shown, success announced; last image of an active product is locked", async () => {
    mocks.admin.getProduct.mockResolvedValue({ product: product() });
    mocks.admin.uploadImage
      .mockRejectedValueOnce(new ApiRequestError(415, "unsupported_image", "Upload a JPEG, PNG, or WebP image."))
      .mockResolvedValueOnce({
        product: product({
          images: [
            { id: "900", src: "/a.webp", alt: "a", position: 0, isPrimary: true },
            { id: "901", src: "/b.webp", alt: "b", position: 1, isPrimary: false },
          ],
        }),
      });
    const user = userEvent.setup({ applyAccept: false });
    renderAt("/admin/products/50");
    const remove = await screen.findByRole("button", { name: /Remove image 1/ });
    expect(remove).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Upload image" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose an image to upload.");

    const input = screen.getByLabelText("Add an image");
    await user.upload(input, new File(["x"], "notes.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: "Upload image" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Upload a JPEG, PNG, or WebP image.");
    expect(mocks.admin.uploadImage).not.toHaveBeenCalled();

    await user.upload(input, new File([new Uint8Array(6_000_000)], "big.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Upload image" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Images can be up to 5 MB.");

    await user.upload(input, new File(["fake"], "fake.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Upload image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload a JPEG, PNG, or WebP image.");

    await user.upload(input, new File(["real"], "real.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Upload image" }));
    expect(await screen.findByText("Image uploaded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove image 1/ })).not.toBeDisabled();
  });
});

describe("categories", () => {
  it("delete with products asks for a destination", async () => {
    mocks.admin.deleteCategory.mockResolvedValue({ items: categories.slice(1) });
    const user = userEvent.setup();
    renderAt("/admin/categories");
    const row = (await screen.findByText("Dresses", { selector: ".adm-rowtitle" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: /Delete/ }));
    const dialog = screen.getByRole("dialog", { name: "Delete Dresses?" });
    expect(within(dialog).getByText(/2 products are in this category/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Move products to")).toHaveValue("2");
    await user.click(within(dialog).getByRole("button", { name: "Move products and delete" }));
    expect(mocks.admin.deleteCategory).toHaveBeenCalledWith("1", "2");
    expect(await screen.findByText("Dresses deleted.")).toBeInTheDocument();
  });

  it("create shows the server's slug conflict on the field", async () => {
    mocks.admin.createCategory.mockRejectedValue(
      new ApiRequestError(409, "slug_taken", "Another category already uses this slug", [{ path: ["slug"], message: "Another category already uses this slug" }]),
    );
    const user = userEvent.setup();
    renderAt("/admin/categories");
    await user.click(await screen.findByRole("button", { name: "Add category" }));
    await user.type(screen.getByLabelText("Name"), "Dresses Two");
    await user.type(screen.getByLabelText(/URL slug/), "dresses");
    await user.click(screen.getAllByRole("button", { name: "Add category" }).at(-1)!);
    expect(await screen.findByText("Another category already uses this slug", { selector: ".adm-field__error" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Dresses Two");
  });
});

describe("inventory", () => {
  const item = { id: "50", name: "Silk Slip Dress", sku: "HEY-DRS-00004", slug: "s", status: "active" as const, categoryName: "Dresses", stockQuantity: 3, lowStockThreshold: null, effectiveThreshold: 5, stockState: "low_stock" as const, purchasable: true, updatedAt: "" };

  it("filters through the API and adjusts stock with validation", async () => {
    mocks.admin.inventory.mockResolvedValue({ items: [item], page: 1, page_size: 24, total_items: 1, total_pages: 1, counts: { all: 20, low: 1, out: 2 }, lowStockThreshold: 5 });
    mocks.admin.adjustStock.mockResolvedValue({ adjustment: { id: "1", delta: -2, reason: "damaged", resultingQuantity: 1 }, stockQuantity: 1 });
    const user = userEvent.setup();
    renderAt("/admin/inventory");
    expect(await screen.findByText("Low stock", { selector: ".adm-badge" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Out of stock/ }));
    await waitFor(() => expect(mocks.admin.inventory).toHaveBeenLastCalledWith({ filter: "out", q: "", page: 1 }));
    expect(screen.getByRole("button", { name: /Out of stock/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(await screen.findByRole("button", { name: /Adjust stock for Silk Slip Dress/ }));
    await user.selectOptions(screen.getByLabelText("Reason"), "damaged");
    await user.type(screen.getByLabelText("Units"), "9");
    await user.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Only 3 in stock");
    expect(mocks.admin.adjustStock).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Units"));
    await user.type(screen.getByLabelText("Units"), "2");
    await user.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(mocks.admin.adjustStock).toHaveBeenCalledWith("50", { reason: "damaged", delta: -2 });
    expect(await screen.findByText("Silk Slip Dress: −2, now 1 in stock.")).toBeInTheDocument();
  });

  it("honest empty state per filter", async () => {
    mocks.admin.inventory.mockResolvedValue({ items: [], page: 1, page_size: 24, total_items: 0, total_pages: 0, counts: { all: 20, low: 0, out: 0 }, lowStockThreshold: 5 });
    renderAt("/admin/inventory?filter=out");
    expect(await screen.findByText("Nothing is out of stock")).toBeInTheDocument();
  });
});

describe("orders", () => {
  it("list: searches and filters through the URL", async () => {
    mocks.admin.listOrders.mockResolvedValue({ items: [], page: 1, page_size: 24, total_items: 0, total_pages: 0 });
    const user = userEvent.setup();
    renderAt("/admin/orders");
    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search orders" }), "HEY-261001");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(mocks.admin.listOrders).toHaveBeenLastCalledWith({ q: "HEY-261001", status: "", payment: "", page: 1 }));
    await user.selectOptions(screen.getByLabelText("Status"), "cancelled");
    await waitFor(() => expect(mocks.admin.listOrders).toHaveBeenLastCalledWith({ q: "HEY-261001", status: "cancelled", payment: "", page: 1 }));
    expect(await screen.findByText("No orders match")).toBeInTheDocument();
  });

  it("detail: snapshot, totals, and only the allowed actions", async () => {
    mocks.admin.getOrder.mockResolvedValue({ order: order() });
    renderAt("/admin/orders/77");
    expect(await screen.findByRole("heading", { level: 1, name: "Order HEY-261001-0007" })).toBeInTheDocument();
    expect(screen.getAllByText("₹10,800.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Order placed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm payment received" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as shipped" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /total|price/i })).not.toBeInTheDocument();
  });

  it("cancel requires confirmation, sends the note, and reports the restock", async () => {
    mocks.admin.getOrder.mockResolvedValue({ order: order() });
    mocks.admin.setOrderStatus.mockResolvedValue({
      order: order({ status: "cancelled", actions: { nextStatuses: [], canConfirmPayment: false } }),
    });
    const user = userEvent.setup();
    renderAt("/admin/orders/77");
    await user.click(await screen.findByRole("button", { name: "Cancel order" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel order HEY-261001-0007?" });
    expect(within(dialog).getByText(/All 2 units go back into stock/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep order" })).toHaveFocus();
    await user.type(within(dialog).getByLabelText(/Note for the order history/), "Customer called");
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    expect(mocks.admin.setOrderStatus).toHaveBeenCalledWith("77", "cancelled", "Customer called");
    expect(await screen.findByText("Order cancelled. 2 units returned to stock.")).toBeInTheDocument();
    expect(screen.getByText("This order was cancelled. Its stock has been returned.")).toBeInTheDocument();
  });

  it("manual payment confirmation; a server refusal stays in the dialog", async () => {
    mocks.admin.getOrder.mockResolvedValue({ order: order() });
    mocks.admin.confirmPayment
      .mockRejectedValueOnce(new ApiRequestError(409, "already_paid", "This order is already marked as paid."))
      .mockResolvedValueOnce({ order: order({ paymentStatus: "PAID", actions: { nextStatuses: ["confirmed", "cancelled"], canConfirmPayment: false } }) });
    const user = userEvent.setup();
    renderAt("/admin/orders/77");
    await user.click(await screen.findByRole("button", { name: "Confirm payment received" }));
    const dialog = screen.getByRole("dialog", { name: "Mark HEY-261001-0007 as paid?" });
    await user.type(within(dialog).getByLabelText(/Payment reference/), "UPI 4411");
    await user.click(within(dialog).getByRole("button", { name: "Confirm ₹10,800.00 received" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This order is already marked as paid.");
    await user.click(within(dialog).getByRole("button", { name: "Confirm ₹10,800.00 received" }));
    expect(mocks.admin.confirmPayment).toHaveBeenLastCalledWith("77", "UPI 4411");
    expect(await screen.findByText("Payment confirmed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm payment received" })).not.toBeInTheDocument();
  });

  it("unknown order → not found", async () => {
    mocks.admin.getOrder.mockRejectedValue(new ApiRequestError(404, "unknown_resource", "Order not found"));
    renderAt("/admin/orders/999");
    expect(await screen.findByRole("heading", { name: "Order not found" })).toBeInTheDocument();
  });
});

describe("customers", () => {
  const amira: AdminUser = { id: "9", name: "Amira", email: "amira@example.com", role: "USER", status: "active", blockedReason: null, blockedAt: null, orderCount: 2, lastOrderAt: "2026-09-30T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" };
  const boss: AdminUser = { ...amira, id: "1", name: "Rahima Admin", email: "rahima@heyrah.test", role: "ADMIN", orderCount: 0, lastOrderAt: null };

  it("block requires a reason; admins can't be blocked here", async () => {
    mocks.admin.listUsers.mockResolvedValue({ items: [amira, boss], page: 1, page_size: 24, total_items: 2, total_pages: 1 });
    mocks.admin.blockUser.mockResolvedValue({ user: { ...amira, status: "blocked" } });
    const user = userEvent.setup();
    renderAt("/admin/users");
    const bossRow = (await screen.findByText("Rahima Admin", { selector: ".adm-rowtitle" })).closest("tr")!;
    expect(within(bossRow).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/password/i, { selector: "td" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Block Amira" }));
    const dialog = screen.getByRole("dialog", { name: "Block Amira?" });
    await user.click(within(dialog).getByRole("button", { name: "Block customer" }));
    expect(within(dialog).getByText("Give a reason of at least 3 characters")).toBeInTheDocument();
    expect(mocks.admin.blockUser).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("Reason"), "Chargebacks");
    await user.click(within(dialog).getByRole("button", { name: "Block customer" }));
    expect(mocks.admin.blockUser).toHaveBeenCalledWith("9", "Chargebacks");
    expect(await screen.findByText("Amira is blocked and has been signed out.")).toBeInTheDocument();
  });

  it("unblock", async () => {
    mocks.admin.listUsers.mockResolvedValue({ items: [{ ...amira, status: "blocked", blockedReason: "Chargebacks" }], page: 1, page_size: 24, total_items: 1, total_pages: 1 });
    mocks.admin.unblockUser.mockResolvedValue({ user: amira });
    const user = userEvent.setup();
    renderAt("/admin/users");
    await user.click(await screen.findByRole("button", { name: "Unblock Amira" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Unblock customer" }));
    expect(mocks.admin.unblockUser).toHaveBeenCalledWith("9");
    expect(await screen.findByText("Amira can sign in again.")).toBeInTheDocument();
  });
});

describe("settings", () => {
  it("validates, saves, and shows brand values read-only", async () => {
    mocks.admin.getSettings.mockResolvedValue(settings);
    mocks.admin.putSettings.mockResolvedValue({ ...settings, settings: { ...settings.settings, pageSize: 8, isDefault: false, updatedAt: "2026-10-01T10:00:00Z" } });
    const user = userEvent.setup();
    renderAt("/admin/settings");
    expect(await screen.findByText("Wings of Style")).toBeInTheDocument();
    expect(screen.getByText("HEYRAH", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /tagline|store name|currency/i })).not.toBeInTheDocument();

    const size = screen.getByLabelText("Products per page");
    await user.clear(size);
    await user.type(size, "100");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(screen.getByText("Enter a number from 4 to 48")).toBeInTheDocument();
    expect(size).toHaveFocus();
    expect(mocks.admin.putSettings).not.toHaveBeenCalled();

    await user.clear(size);
    await user.type(size, "8");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(mocks.admin.putSettings).toHaveBeenCalledWith({
      low_stock_threshold: 5,
      shipping_flat_rate: "99.00",
      shipping_free_threshold: "2999.00",
      default_sort: "newest",
      page_size: 8,
    });
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });
});
