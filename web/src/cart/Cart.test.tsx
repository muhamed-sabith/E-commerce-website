import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { Cart, CartLine } from "../api/cart";
import type { ProductDetail } from "../api/catalog";

/**
 * Cart UI tests. The API layer is mocked with a tiny in-memory stand-in for
 * the server cart so mutations behave realistically; the assertions check
 * that the UI only sends intents (product id + qty) and renders whatever the
 * "server" answers.
 */

const mocks = vi.hoisted(() => ({
  cart: { get: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn() },
  auth: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
    updateProfile: vi.fn(),
  },
  getProduct: vi.fn(),
}));

vi.mock("../api/catalog", () => ({
  catalogApi: {
    listCategories: vi.fn().mockResolvedValue({ items: [] }),
    listProducts: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 12,
      totalItems: 0,
      totalPages: 0,
    }),
    getProduct: mocks.getProduct,
  },
}));

vi.mock("../api/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/cart")>();
  return { ...actual, cartApi: mocks.cart };
});

vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, ensureCsrf: vi.fn().mockResolvedValue(undefined), authApi: mocks.auth };
});

vi.mock("../api/customer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/customer")>();
  return {
    ...actual,
    wishlistApi: { get: vi.fn().mockResolvedValue({ items: [] }), add: vi.fn(), remove: vi.fn() },
  };
});

// ---------- fake server ----------

interface LineSpec {
  id: string;
  name: string;
  qty: number;
  price: string;
  final?: string;
  availability?: CartLine["availability"];
  issue?: string;
}

function line(partial: LineSpec): CartLine {
  const final = partial.final ?? partial.price;
  return {
    id: partial.id,
    product: {
      id: `p${partial.id}`,
      name: partial.name,
      slug: partial.name.toLowerCase().replace(/\s+/g, "-"),
      sku: `SKU-${partial.id}`,
      image: null,
    },
    quantity: partial.qty,
    price: { amount: partial.price },
    finalPrice: { amount: final },
    lineTotal: { amount: (Number(final) * partial.qty).toFixed(2) },
    availability: partial.availability ?? "available",
    ...(partial.issue ? { issue: partial.issue } : {}),
  };
}

/** Recompute totals the way the server does: available lines only. */
function cartOf(lines: CartLine[]): Cart {
  const available = lines.filter((l) => l.availability === "available");
  const subtotal = available.reduce((s, l) => s + Number(l.price.amount) * l.quantity, 0);
  const total = available.reduce((s, l) => s + Number(l.finalPrice.amount) * l.quantity, 0);
  return {
    items: lines,
    itemCount: available.reduce((n, l) => n + l.quantity, 0),
    subtotal: { amount: subtotal.toFixed(2) },
    discountTotal: { amount: (subtotal - total).toFixed(2) },
    total: { amount: total.toFixed(2) },
  };
}

let serverLines: CartLine[] = [];

function installFakeServer() {
  mocks.cart.get.mockImplementation(async () => cartOf(serverLines));
  mocks.cart.updateItem.mockImplementation(async (id: string, qty: number) => {
    serverLines =
      qty === 0
        ? serverLines.filter((l) => l.id !== id)
        : serverLines.map((l) =>
            l.id === id
              ? { ...l, quantity: qty, lineTotal: { amount: (Number(l.finalPrice.amount) * qty).toFixed(2) } }
              : l,
          );
    return cartOf(serverLines);
  });
  mocks.cart.removeItem.mockImplementation(async (id: string) => {
    serverLines = serverLines.filter((l) => l.id !== id);
    return cartOf(serverLines);
  });
  mocks.cart.addItem.mockImplementation(async (productId: string, qty: number) => {
    const existing = serverLines.find((l) => l.product.id === productId);
    if (existing) {
      const next = existing.quantity + qty;
      serverLines = serverLines.map((l) =>
        l === existing
          ? { ...l, quantity: next, lineTotal: { amount: (Number(l.finalPrice.amount) * next).toFixed(2) } }
          : l,
      );
    } else {
      const added = line({ id: String(serverLines.length + 100), name: "Linen Wrap Dress", qty, price: "250.00" });
      serverLines = [...serverLines, { ...added, product: { ...added.product, id: productId } }];
    }
    return cartOf(serverLines);
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const bagCount = () => screen.getByTestId("bag-count").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  serverLines = [];
  installFakeServer();
  mocks.auth.me.mockResolvedValue({ user: null });
});

// ---------- tests ----------

describe("cart page", () => {
  it("renders lines, server prices, discount, and totals", async () => {
    serverLines = [
      line({ id: "1", name: "Silk Slip Dress", qty: 2, price: "5400.00", final: "4590.00" }),
      line({ id: "2", name: "Cashmere Scarf", qty: 1, price: "1000.00" }),
    ];
    renderAt("/cart");

    const lines = await screen.findAllByTestId("bag-line");
    expect(lines).toHaveLength(2);

    const silk = lines[0];
    expect(within(silk).getByRole("link", { name: "Silk Slip Dress" })).toBeTruthy();
    // discount: was + now, both server values
    expect(within(silk).getByText("₹5,400.00")).toBeTruthy();
    expect(within(silk).getByText("₹4,590.00")).toBeTruthy();
    expect(within(silk).getByTestId("line-total").textContent).toBe("₹9,180.00");

    expect(screen.getByTestId("bag-subtotal").textContent).toBe("₹11,800.00");
    expect(screen.getByTestId("bag-discount").textContent).toContain("₹1,620.00");
    expect(screen.getByTestId("bag-total").textContent).toBe("₹10,180.00");
    expect(screen.getByRole("link", { name: "Continue shopping" })).toBeTruthy();
  });

  it("shows the empty state with a way back to the collection", async () => {
    renderAt("/cart");
    expect(await screen.findByTestId("empty-bag")).toBeTruthy();
    expect(screen.getByText("Your bag is empty.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Explore the collection" }).getAttribute("href")).toBe(
      "/products",
    );
  });

  it("increases quantity by sending only the new quantity", async () => {
    const user = userEvent.setup();
    serverLines = [line({ id: "7", name: "Cashmere Scarf", qty: 1, price: "1000.00" })];
    renderAt("/cart");

    await user.click(await screen.findByRole("button", { name: "Increase quantity of Cashmere Scarf" }));

    await waitFor(() => expect(mocks.cart.updateItem).toHaveBeenCalledWith("7", 2));
    expect(await screen.findByDisplayValue("2")).toBeTruthy();
    expect(screen.getByTestId("bag-total").textContent).toBe("₹2,000.00");
    await waitFor(() => expect(bagCount()).toBe("2"));
  });

  it("decreases quantity and disables decrease at 1", async () => {
    const user = userEvent.setup();
    serverLines = [line({ id: "7", name: "Cashmere Scarf", qty: 2, price: "1000.00" })];
    renderAt("/cart");

    const dec = await screen.findByRole("button", { name: "Decrease quantity of Cashmere Scarf" });
    await user.click(dec);

    await waitFor(() => expect(mocks.cart.updateItem).toHaveBeenCalledWith("7", 1));
    const decAtOne = screen.getByRole("button", { name: "Decrease quantity of Cashmere Scarf" });
    await waitFor(() => expect(decAtOne.getAttribute("aria-disabled")).toBe("true"));

    // at the lower bound a further press is a no-op (qty 0 is only via Remove)
    await user.click(decAtOne);
    expect(mocks.cart.updateItem).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid typed quantity without calling the server", async () => {
    const user = userEvent.setup();
    serverLines = [line({ id: "7", name: "Cashmere Scarf", qty: 2, price: "1000.00" })];
    renderAt("/cart");

    const input = await screen.findByLabelText("Quantity");
    await user.clear(input);
    await user.type(input, "abc{Enter}");

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Enter a whole number of pieces.");
    expect(mocks.cart.updateItem).not.toHaveBeenCalled();
  });

  it("removes a line and announces it", async () => {
    const user = userEvent.setup();
    serverLines = [line({ id: "7", name: "Cashmere Scarf", qty: 1, price: "1000.00" })];
    renderAt("/cart");

    await user.click(await screen.findByRole("button", { name: "Remove Cashmere Scarf from bag" }));

    await waitFor(() => expect(mocks.cart.removeItem).toHaveBeenCalledWith("7"));
    expect(await screen.findByTestId("empty-bag")).toBeTruthy();
    expect(screen.getByTestId("cart-announcer").textContent).toBe("Cashmere Scarf removed from your bag.");
  });

  it("surfaces a server error on the line and reconciles from the server", async () => {
    const user = userEvent.setup();
    const { ApiRequestError } = await import("../api/client");
    serverLines = [line({ id: "7", name: "Cashmere Scarf", qty: 3, price: "1000.00" })];
    mocks.cart.updateItem.mockRejectedValueOnce(
      new ApiRequestError(409, "stock_shortage", "Only 3 in stock — reduce the quantity."),
    );
    renderAt("/cart");

    await user.click(await screen.findByRole("button", { name: "Increase quantity of Cashmere Scarf" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Only 3 in stock — reduce the quantity.");
    // re-fetched: initial load + reconcile
    await waitFor(() => expect(mocks.cart.get).toHaveBeenCalledTimes(2));
    expect(screen.getByDisplayValue("3")).toBeTruthy();
  });

  it("shows the load error state with a retry", async () => {
    const user = userEvent.setup();
    mocks.cart.get.mockRejectedValueOnce(new Error("offline"));
    renderAt("/cart");

    expect((await screen.findByRole("alert")).textContent).toContain("couldn't load your bag");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("empty-bag")).toBeTruthy();
  });

  it("flags unavailable lines in words and keeps them out of the total", async () => {
    serverLines = [
      line({ id: "1", name: "Cashmere Scarf", qty: 1, price: "1000.00" }),
      line({
        id: "2",
        name: "Archive Tote",
        qty: 2,
        price: "900.00",
        availability: "unavailable",
        issue: "This item is no longer available and will not be counted.",
      }),
    ];
    renderAt("/cart");

    const lines = await screen.findAllByTestId("bag-line");
    const archived = lines[1];
    expect(within(archived).getByTestId("line-issue").textContent).toContain("Unavailable");
    expect(within(archived).queryByRole("group", { name: /Quantity/ })).toBeNull();
    expect(within(archived).getByTestId("line-total").textContent).toBe("—");
    expect(within(archived).getByRole("button", { name: "Remove Archive Tote from bag" })).toBeTruthy();

    expect(screen.getByTestId("bag-total").textContent).toBe("₹1,000.00");
    expect(screen.getByText(/Items marked unavailable aren't included in your total\./)).toBeTruthy();
    // checkout is blocked, with the reason attached
    const checkout = screen.getByTestId("checkout-link");
    expect(checkout.getAttribute("aria-disabled")).toBe("true");
    expect(checkout.getAttribute("aria-describedby")).toBe("bag-checkout-blocked");
    // header count is the server's purchasable count
    expect(bagCount()).toBe("1");
  });
});

describe("header bag count", () => {
  it("shows the server-derived count with an accessible name", async () => {
    serverLines = [line({ id: "1", name: "Cashmere Scarf", qty: 3, price: "1000.00" })];
    renderAt("/products");

    await waitFor(() => expect(bagCount()).toBe("3"));
    expect(screen.getByRole("link", { name: "Bag, 3 items" }).getAttribute("href")).toBe("/cart");
  });
});

describe("add to bag", () => {
  const product: ProductDetail = {
    id: "4",
    name: "Linen Wrap Dress",
    slug: "linen-wrap-dress",
    sku: "HEY-DRS-00001",
    description: "A wrap dress.",
    categoryName: "Dresses",
    categorySlug: "dresses",
    price: { amount: "250.00" },
    finalPrice: { amount: "250.00" },
    discount: { type: "none" },
    availability: "in_stock",
    images: [],
    specifications: [],
  };

  it("sends only the product id and quantity, then updates the count", async () => {
    const user = userEvent.setup();
    mocks.getProduct.mockResolvedValue(product);
    renderAt("/product/linen-wrap-dress");

    await user.click(await screen.findByRole("button", { name: "Add to bag" }));

    await waitFor(() => expect(mocks.cart.addItem).toHaveBeenCalledWith("4", 1));
    // exactly two args: no price, no total
    expect(mocks.cart.addItem.mock.calls[0]).toHaveLength(2);
    expect(await screen.findByText(/Added to your bag/)).toBeTruthy();
    await waitFor(() => expect(bagCount()).toBe("1"));
  });

  it("disables the action for out-of-stock products", async () => {
    mocks.getProduct.mockResolvedValue({ ...product, availability: "out_of_stock" });
    renderAt("/product/linen-wrap-dress");

    const btn = await screen.findByRole("button", { name: "Unavailable" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.cart.addItem).not.toHaveBeenCalled();
  });
});

describe("authenticated bag + merge", () => {
  const amira = { id: "9", name: "Amira", email: "amira@example.com", role: "USER" as const };

  it("loads the persistent bag for a signed-in user", async () => {
    mocks.auth.me.mockResolvedValue({ user: amira });
    serverLines = [line({ id: "1", name: "Silk Stole", qty: 2, price: "900.00" })];
    renderAt("/cart");

    expect(await screen.findByRole("link", { name: "Amira" })).toBeTruthy();
    expect((await screen.findAllByTestId("bag-line"))).toHaveLength(1);
    expect(bagCount()).toBe("2");
  });

  it("renders the merge report after sign-in and reloads the bag", async () => {
    const user = userEvent.setup();
    renderAt("/login");
    await waitFor(() => expect(mocks.cart.get).toHaveBeenCalledTimes(1));

    mocks.auth.login.mockResolvedValue({
      user: amira,
      merge_report: {
        merged: [{ product_id: "14", name: "Cashmere Scarf", quantity: 2 }],
        capped: [{ product_id: "5", name: "Midnight Evening Gown", quantity: 3, requested: 5 }],
        dropped: [{ product_id: "19", name: "Archive Sample Tote", reason: "inactive" }],
      },
    });
    mocks.auth.me.mockResolvedValue({ user: amira });
    serverLines = [
      line({ id: "1", name: "Cashmere Scarf", qty: 2, price: "1000.00" }),
      line({ id: "2", name: "Midnight Evening Gown", qty: 3, price: "10000.00" }),
    ];

    await user.type(await screen.findByLabelText("Email address"), "amira@example.com");
    await user.type(screen.getByLabelText("Password"), "Str0ngPass!x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const notice = await screen.findByTestId("merge-notice");
    expect(within(notice).getByRole("heading", { name: "We've saved your bag" })).toBeTruthy();
    expect(within(notice).getByText(/Cashmere Scarf/)).toBeTruthy();
    expect(within(notice).getByTestId("merge-capped").textContent).toBe(
      "Midnight Evening Gown: 3 of the 5 you wanted",
    );
    expect(within(notice).getByTestId("merge-dropped").textContent).toBe(
      "Archive Sample Tote, no longer available",
    );
    // no internals leak into the copy
    expect(notice.textContent).not.toMatch(/\b(session|token|cart_id|product_id)\b/i);

    // identity changed → the bag is re-fetched and the count reflects the merge
    await waitFor(() => expect(bagCount()).toBe("5"));

    await user.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("merge-notice")).toBeNull();
  });
});
