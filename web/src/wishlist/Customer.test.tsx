import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { Address, AddressInput, Wishlist, WishlistItem } from "../api/customer";
import type { ProductDetail } from "../api/catalog";

/**
 * Wishlist + address book UI tests. The API layer is replaced by small
 * in-memory fakes that follow the server's rules (idempotent save, first
 * address default, one default, default-delete needs a replacement) so the
 * UI is exercised against realistic answers.
 */

const mocks = vi.hoisted(() => ({
  wishlist: { get: vi.fn(), add: vi.fn(), remove: vi.fn() },
  address: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), setDefault: vi.fn() },
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
    listProducts: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 12, totalItems: 0, totalPages: 0 }),
    getProduct: mocks.getProduct,
  },
}));
vi.mock("../api/customer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/customer")>();
  return { ...actual, wishlistApi: mocks.wishlist, addressApi: mocks.address };
});
vi.mock("../api/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/cart")>();
  return { ...actual, cartApi: mocks.cart };
});
vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, ensureCsrf: vi.fn().mockResolvedValue(undefined), authApi: mocks.auth };
});

const amira = { id: "9", name: "Amira", email: "amira@example.com", role: "USER" as const };
const emptyCart = {
  items: [],
  itemCount: 0,
  subtotal: { amount: "0.00" },
  discountTotal: { amount: "0.00" },
  total: { amount: "0.00" },
};

// ---------- fake wishlist server ----------

function wishItem(id: string, name: string, over: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id,
    savedAt: "2026-09-30T10:00:00.000Z",
    product: { id, name, slug: name.toLowerCase().replace(/\s+/g, "-"), categoryName: "Dresses", image: null },
    price: { amount: "5400.00" },
    finalPrice: { amount: "4590.00" },
    availability: "in_stock",
    purchasable: true,
    ...over,
  };
}

let saved: WishlistItem[] = [];
const wl = (): Wishlist => ({ items: saved });

// ---------- fake address server ----------

let book: Address[] = [];
let seq = 1;
const now = "2026-09-30T10:00:00.000Z";

function toAddress(input: AddressInput, isDefault: boolean): Address {
  return {
    id: String(seq++),
    receiverName: input.receiver_name,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    state: input.state,
    postalCode: input.postal_code,
    countryCode: input.country_code,
    isDefault,
    createdAt: now,
    updatedAt: now,
  };
}

const sorted = () => ({ items: [...book].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)) });

function installFakes() {
  mocks.wishlist.get.mockImplementation(async () => wl());
  mocks.wishlist.add.mockImplementation(async (id: string) => {
    if (!saved.some((s) => s.id === id)) saved = [wishItem(id, "Linen Wrap Dress"), ...saved];
    return wl();
  });
  mocks.wishlist.remove.mockImplementation(async (id: string) => {
    saved = saved.filter((s) => s.id !== id);
    return wl();
  });

  mocks.address.list.mockImplementation(async () => sorted());
  mocks.address.create.mockImplementation(async (input: AddressInput) => {
    const a = toAddress(input, book.length === 0);
    book = [...book, a];
    return { address: a };
  });
  mocks.address.update.mockImplementation(async (id: string, input: Partial<AddressInput>) => {
    book = book.map((a) =>
      a.id === id
        ? {
            ...a,
            ...(input.receiver_name !== undefined ? { receiverName: input.receiver_name } : {}),
            ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
            ...(input.city !== undefined ? { city: input.city } : {}),
          }
        : a,
    );
    return { address: book.find((a) => a.id === id)! };
  });
  mocks.address.setDefault.mockImplementation(async (id: string) => {
    book = book.map((a) => ({ ...a, isDefault: a.id === id }));
    return sorted();
  });
  mocks.address.remove.mockImplementation(async (id: string, newDefaultId?: string) => {
    book = book.filter((a) => a.id !== id);
    if (newDefaultId) book = book.map((a) => ({ ...a, isDefault: a.id === newDefaultId }));
    return sorted();
  });

  mocks.cart.get.mockResolvedValue(emptyCart);
  mocks.cart.addItem.mockImplementation(async () => ({ ...emptyCart, itemCount: 1 }));
}

const kochi: AddressInput = {
  receiver_name: "Amira Rahman",
  phone: "+91 98765 43210",
  line1: "12 Marine Drive",
  line2: null,
  city: "Kochi",
  state: "Kerala",
  postal_code: "682001",
  country_code: "IN",
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saved = [];
  book = [];
  seq = 1;
  installFakes();
  mocks.auth.me.mockResolvedValue({ user: amira });
});

// =============================================================
// WISHLIST
// =============================================================

describe("wishlist page", () => {
  it("renders saved pieces with live server price and availability", async () => {
    saved = [
      wishItem("7", "Silk Slip Dress"),
      wishItem("9", "Trench Overcoat", {
        price: { amount: "7200.00" },
        finalPrice: { amount: "7200.00" },
        availability: "out_of_stock",
        purchasable: false,
      }),
    ];
    renderAt("/wishlist");

    const cards = await screen.findAllByTestId("wish-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole("link", { name: "Silk Slip Dress" })).toBeTruthy();
    expect(within(cards[0]).getByTestId("wish-price").textContent).toContain("₹4,590.00");
    expect(within(cards[0]).getByTestId("wish-price").textContent).toContain("₹5,400.00");
    expect(within(cards[0]).getByTestId("wish-availability").textContent).toBe("In stock");
    expect(within(cards[1]).getByTestId("wish-availability").textContent).toBe("Out of stock");
  });

  it("shows the empty state", async () => {
    renderAt("/wishlist");
    expect(await screen.findByTestId("empty-wishlist")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Explore the collection" })).toBeTruthy();
  });

  it("flags unavailable pieces in words, without a link or add-to-bag", async () => {
    saved = [
      wishItem("5", "Archive Tote", {
        product: { id: "5", name: "Archive Tote", slug: "", categoryName: "Accessories", image: null },
        availability: "unavailable",
        purchasable: false,
      }),
    ];
    renderAt("/wishlist");
    const card = await screen.findByTestId("wish-card");
    expect(within(card).getByTestId("wish-availability").textContent).toBe("No longer available");
    expect(within(card).queryByRole("link", { name: "Archive Tote" })).toBeNull();
    const add = within(card).getByRole("button", { name: "Out of stock" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });

  it("removes a piece, announces it, and lands on the empty state", async () => {
    const user = userEvent.setup();
    saved = [wishItem("7", "Silk Slip Dress")];
    renderAt("/wishlist");

    await user.click(await screen.findByRole("button", { name: "Remove Silk Slip Dress from wishlist" }));
    await waitFor(() => expect(mocks.wishlist.remove).toHaveBeenCalledWith("7"));
    expect(await screen.findByTestId("empty-wishlist")).toBeTruthy();
    expect(screen.getByTestId("wishlist-announcer").textContent).toBe(
      "Silk Slip Dress removed from your wishlist.",
    );
  });

  it("adds a purchasable piece to the bag by product id only", async () => {
    const user = userEvent.setup();
    saved = [wishItem("7", "Silk Slip Dress")];
    renderAt("/wishlist");

    const card = await screen.findByTestId("wish-card");
    await user.click(within(card).getByRole("button", { name: "Add Silk Slip Dress to bag" }));
    await waitFor(() => expect(mocks.cart.addItem).toHaveBeenCalledWith("7", 1));
    await waitFor(() => expect(screen.getByTestId("bag-count").textContent).toBe("1"));
  });

  it("shows a load error with retry", async () => {
    const user = userEvent.setup();
    mocks.wishlist.get.mockRejectedValueOnce(new Error("offline"));
    renderAt("/wishlist");

    expect((await screen.findByRole("alert")).textContent).toContain("couldn't load your wishlist");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("empty-wishlist")).toBeTruthy();
  });

  it("sends guests to sign in", async () => {
    mocks.auth.me.mockResolvedValue({ user: null });
    renderAt("/wishlist");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(mocks.wishlist.get).not.toHaveBeenCalled();
  });
});

describe("save toggle", () => {
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

  it("saves, shows the saved state, and unsaves", async () => {
    const user = userEvent.setup();
    mocks.getProduct.mockResolvedValue(product);
    renderAt("/product/linen-wrap-dress");

    const toggle = await screen.findByRole("button", { name: "Save Linen Wrap Dress to wishlist" });
    await waitFor(() => expect(toggle.getAttribute("aria-disabled")).toBe("false"));
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggle);
    await waitFor(() => expect(mocks.wishlist.add).toHaveBeenCalledWith("4"));
    const savedToggle = await screen.findByRole("button", { name: "Saved Linen Wrap Dress to wishlist" });
    expect(savedToggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("wishlist-announcer").textContent).toBe(
      "Linen Wrap Dress saved to your wishlist.",
    );

    await user.click(savedToggle);
    await waitFor(() => expect(mocks.wishlist.remove).toHaveBeenCalledWith("4"));
    expect((await screen.findByRole("button", { name: "Save Linen Wrap Dress to wishlist" })).getAttribute("aria-pressed")).toBe("false");
  });

  it("surfaces an API error without changing the saved state", async () => {
    const user = userEvent.setup();
    const { ApiRequestError } = await import("../api/client");
    mocks.getProduct.mockResolvedValue(product);
    mocks.wishlist.add.mockRejectedValueOnce(new ApiRequestError(500, "internal_error", "boom"));
    renderAt("/product/linen-wrap-dress");

    const toggle = await screen.findByRole("button", { name: "Save Linen Wrap Dress to wishlist" });
    await waitFor(() => expect(toggle.getAttribute("aria-disabled")).toBe("false"));
    await user.click(toggle);
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't update your wishlist. Try again.");
    expect(screen.getByRole("button", { name: "Save Linen Wrap Dress to wishlist" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("sends a guest to sign in instead of saving", async () => {
    const user = userEvent.setup();
    mocks.auth.me.mockResolvedValue({ user: null });
    mocks.getProduct.mockResolvedValue(product);
    renderAt("/product/linen-wrap-dress");

    await user.click(await screen.findByRole("button", { name: "Save Linen Wrap Dress to wishlist" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(mocks.wishlist.add).not.toHaveBeenCalled();
  });
});

// =============================================================
// ADDRESSES
// =============================================================

async function fillForm(user: ReturnType<typeof userEvent.setup>, v: Partial<Record<string, string>>) {
  const set = async (label: RegExp, value: string | undefined) => {
    if (value === undefined) return;
    const el = screen.getByLabelText(label);
    await user.clear(el);
    await user.type(el, value);
  };
  await set(/^Full name/, v.name);
  await set(/^Phone/, v.phone);
  await set(/^Address line 1/, v.line1);
  await set(/^City/, v.city);
  await set(/^State/, v.state);
  await set(/^Postal code/, v.postal);
}

describe("address book", () => {
  it("shows the empty state", async () => {
    renderAt("/account/addresses");
    expect(await screen.findByTestId("empty-addresses")).toBeTruthy();
  });

  it("creates the first address, which becomes the default", async () => {
    const user = userEvent.setup();
    renderAt("/account/addresses");
    await user.click(await screen.findByRole("button", { name: "Add an address" }));

    await fillForm(user, {
      name: "Amira Rahman",
      phone: "+91 98765 43210",
      line1: "12 Marine Drive",
      city: "Kochi",
      state: "Kerala",
      postal: "682001",
    });
    await user.click(screen.getByRole("button", { name: "Save address" }));

    await waitFor(() =>
      expect(mocks.address.create).toHaveBeenCalledWith({ ...kochi }),
    );
    const card = await screen.findByTestId("address-card");
    expect(within(card).getByTestId("default-badge").textContent).toBe("Default");
    expect(screen.getByTestId("address-status").textContent).toBe(
      "Address saved. It's your default address.",
    );
  });

  it("validates inline and does not submit invalid data", async () => {
    const user = userEvent.setup();
    renderAt("/account/addresses");
    await user.click(await screen.findByRole("button", { name: "Add an address" }));
    await fillForm(user, { name: "A", phone: "abc", postal: "12" });
    await user.click(screen.getByRole("button", { name: "Save address" }));

    const name = screen.getByLabelText(/^Full name/);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name); // focus moves to the first error
    const described = name.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described.split(" ").pop()!)?.textContent).toContain(
      "Enter the full name",
    );
    expect(screen.getByText(/Indian PIN codes are 6 digits/)).toBeTruthy();
    expect(screen.getByText(/Use 7 to 15 digits/)).toBeTruthy();
    expect(mocks.address.create).not.toHaveBeenCalled();
  });

  it("maps server field errors back to inputs", async () => {
    const user = userEvent.setup();
    const { ApiRequestError } = await import("../api/client");
    mocks.address.create.mockRejectedValueOnce(
      new ApiRequestError(400, "validation_failed", "Validation failed", [
        { path: ["city"], message: "City contains invalid characters" },
      ]),
    );
    renderAt("/account/addresses");
    await user.click(await screen.findByRole("button", { name: "Add an address" }));
    await fillForm(user, {
      name: "Amira Rahman",
      phone: "+91 98765 43210",
      line1: "12 Marine Drive",
      city: "Kochi",
      state: "Kerala",
      postal: "682001",
    });
    await user.click(screen.getByRole("button", { name: "Save address" }));
    expect(await screen.findByText("City contains invalid characters")).toBeTruthy();
    expect(screen.getByLabelText(/^City/).getAttribute("aria-invalid")).toBe("true");
    // typed values are preserved
    expect((screen.getByLabelText(/^Full name/) as HTMLInputElement).value).toBe("Amira Rahman");
  });

  it("edits an address", async () => {
    const user = userEvent.setup();
    book = [toAddress(kochi, true)];
    renderAt("/account/addresses");

    await user.click(await screen.findByRole("button", { name: "Edit address for Amira Rahman, Kochi" }));
    await fillForm(user, { line1: "7 Beach Road" });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.address.update).toHaveBeenCalled());
    expect(mocks.address.update.mock.calls[0][1]).toMatchObject({ line1: "7 Beach Road" });
    expect(await screen.findByText(/7 Beach Road/)).toBeTruthy();
    expect(screen.getByTestId("address-status").textContent).toBe("Address updated.");
  });

  it("sets another address as default; the badge moves", async () => {
    const user = userEvent.setup();
    book = [toAddress(kochi, true), toAddress({ ...kochi, city: "Mumbai", state: "Maharashtra", postal_code: "400001" }, false)];
    renderAt("/account/addresses");

    await user.click(await screen.findByRole("button", { name: "Make Amira Rahman, Mumbai your default address" }));
    await waitFor(() => expect(mocks.address.setDefault).toHaveBeenCalledWith("2"));

    const cards = await screen.findAllByTestId("address-card");
    await waitFor(() => expect(within(cards[0]).getByText(/Mumbai/)).toBeTruthy());
    expect(screen.getAllByTestId("default-badge")).toHaveLength(1);
    expect(within(screen.getAllByTestId("address-card")[0]).getByTestId("default-badge")).toBeTruthy();
    expect(screen.getByTestId("address-status").textContent).toContain("Mumbai is now your default");
  });

  it("deletes a non-default address after confirmation", async () => {
    const user = userEvent.setup();
    book = [toAddress(kochi, true), toAddress({ ...kochi, city: "Mumbai", state: "Maharashtra", postal_code: "400001" }, false)];
    renderAt("/account/addresses");

    await user.click(await screen.findByRole("button", { name: "Delete address for Amira Rahman, Mumbai" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this address?" });
    expect(within(dialog).queryByRole("radio")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Delete address" }));

    await waitFor(() => expect(mocks.address.remove).toHaveBeenCalledWith("2", undefined));
    expect(await screen.findAllByTestId("address-card")).toHaveLength(1);
    expect(screen.getByTestId("address-status").textContent).toBe("Address deleted.");
  });

  it("deleting the default asks for a replacement and sends it", async () => {
    const user = userEvent.setup();
    book = [
      toAddress(kochi, true),
      toAddress({ ...kochi, city: "Mumbai", state: "Maharashtra", postal_code: "400001" }, false),
      toAddress({ ...kochi, city: "Delhi", state: "Delhi", postal_code: "110001" }, false),
    ];
    renderAt("/account/addresses");

    await user.click(await screen.findByRole("button", { name: "Delete address for Amira Rahman, Kochi" }));
    const dialog = await screen.findByRole("dialog");
    const group = within(dialog).getByRole("group", { name: /Choose a new default/ });
    await user.click(within(group).getByRole("radio", { name: /Delhi/ }));
    await user.click(within(dialog).getByRole("button", { name: "Delete address" }));

    await waitFor(() => expect(mocks.address.remove).toHaveBeenCalledWith("1", "3"));
    const cards = await screen.findAllByTestId("address-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText(/Delhi/)).toBeTruthy();
    expect(within(cards[0]).getByTestId("default-badge")).toBeTruthy();
  });

  it("cancelling the dialog keeps the address", async () => {
    const user = userEvent.setup();
    book = [toAddress(kochi, true)];
    renderAt("/account/addresses");
    await user.click(await screen.findByRole("button", { name: "Delete address for Amira Rahman, Kochi" }));
    await user.click(await screen.findByRole("button", { name: "Keep address" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.address.remove).not.toHaveBeenCalled();
  });

  it("shows a load error with retry", async () => {
    const user = userEvent.setup();
    mocks.address.list.mockRejectedValueOnce(new Error("offline"));
    renderAt("/account/addresses");
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't load your addresses");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("empty-addresses")).toBeTruthy();
  });

  it("renders address text as text, never markup", async () => {
    book = [toAddress({ ...kochi, line1: `<img src=x onerror="alert(1)">` }, true)];
    renderAt("/account/addresses");
    const card = await screen.findByTestId("address-card");
    expect(card.querySelector("img")).toBeNull();
    expect(card.textContent).toContain(`<img src=x onerror="alert(1)">`);
  });
});

describe("account integration", () => {
  it("links to the wishlist and addresses", async () => {
    renderAt("/account");
    expect(await screen.findByRole("heading", { name: "Your account" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Addresses/ }).getAttribute("href")).toBe("/account/addresses");
    const wishLinks = screen.getAllByRole("link", { name: /^Wishlist/ });
    expect(wishLinks.every((l) => l.getAttribute("href") === "/wishlist")).toBe(true);
  });
});
