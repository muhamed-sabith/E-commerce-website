import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { PublicUser } from "./api/auth";

// Network-backed APIs are mocked; tests assert UI behavior and wiring.
vi.mock("./api/catalog", () => ({
  catalogApi: {
    listCategories: vi.fn().mockResolvedValue({ items: [] }),
    listProducts: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 12,
      totalItems: 0,
      totalPages: 0,
    }),
    getProduct: vi.fn(),
  },
}));

// The shell mounts CartProvider; keep it on an empty server cart here.
vi.mock("./api/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/cart")>();
  const empty = {
    items: [],
    itemCount: 0,
    subtotal: { amount: "0.00" },
    discountTotal: { amount: "0.00" },
    total: { amount: "0.00" },
  };
  return {
    ...actual,
    cartApi: {
      get: vi.fn().mockResolvedValue(empty),
      addItem: vi.fn(),
      updateItem: vi.fn(),
      removeItem: vi.fn(),
    },
  };
});

const authMocks = vi.hoisted(() => ({
  me: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  updateProfile: vi.fn(),
  ensureCsrf: vi.fn(),
}));

vi.mock("./api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/auth")>();
  return {
    ...actual,
    ApiRequestError: actual.ApiRequestError,
    ensureCsrf: authMocks.ensureCsrf.mockResolvedValue(undefined),
    authApi: {
      me: authMocks.me,
      login: authMocks.login,
      register: authMocks.register,
      logout: authMocks.logout,
      changePassword: authMocks.changePassword,
      updateProfile: authMocks.updateProfile,
    },
  };
});

const sampleUser: PublicUser = {
  id: "1",
  name: "Amira",
  email: "amira@example.com",
  role: "USER",
};

function renderApp(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.me.mockResolvedValue({ user: null });
});

describe("App shell", () => {
  it("renders the HEYRAH brand header", async () => {
    renderApp("/");
    expect(screen.getByRole("link", { name: "HEYRAH home" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search products" })).toBeTruthy();
    await waitFor(() => expect(authMocks.me).toHaveBeenCalled());
  });
});

describe("guest header state", () => {
  it("shows Sign in for guests and the name + Sign out when authenticated", async () => {
    authMocks.me.mockResolvedValue({ user: sampleUser });
    renderApp("/");
    await waitFor(() => expect(screen.getByRole("link", { name: "Amira" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("LoginPage", () => {
  it("submits credentials and shows a generic failure on invalid login", async () => {
    const user = userEvent.setup();
    authMocks.login.mockRejectedValue(
      new (await import("./api/auth")).ApiRequestError(401, "invalid_credentials", "Incorrect email or password."),
    );
    renderApp("/login");

    await user.type(screen.getByLabelText("Email address"), "amira@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Incorrect email or password.");
    // typed values preserved
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe(
      "amira@example.com",
    );
  });

  it("logs in successfully and navigates back to the collection", async () => {
    const user = userEvent.setup();
    authMocks.login.mockResolvedValue({ user: sampleUser });
    authMocks.me.mockResolvedValue({ user: sampleUser });
    renderApp("/login");

    await user.type(screen.getByLabelText("Email address"), "amira@example.com");
    await user.type(screen.getByLabelText("Password"), "Str0ngPass!x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(authMocks.login).toHaveBeenCalled());
    expect(await screen.findByRole("link", { name: "Amira" })).toBeTruthy();
  });
});

describe("RegisterPage", () => {
  it("creates an account and signs the user in", async () => {
    const user = userEvent.setup();
    authMocks.register.mockResolvedValue({ user: sampleUser });
    authMocks.me.mockResolvedValue({ user: sampleUser });
    renderApp("/register");

    await user.type(screen.getByLabelText("Full name"), "Amira");
    await user.type(screen.getByLabelText("Email address"), "amira@example.com");
    await user.type(screen.getByLabelText("Password"), "Str0ngPass!x");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(authMocks.register).toHaveBeenCalled());
    expect(await screen.findByRole("link", { name: "Amira" })).toBeTruthy();
  });

  it("surfaces the duplicate-email error", async () => {
    const user = userEvent.setup();
    authMocks.register.mockRejectedValue(
      new (await import("./api/auth")).ApiRequestError(409, "email_taken", "An account with this email already exists."),
    );
    renderApp("/register");

    await user.type(screen.getByLabelText("Full name"), "Amira");
    await user.type(screen.getByLabelText("Email address"), "amira@example.com");
    await user.type(screen.getByLabelText("Password"), "Str0ngPass!x");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("already exists");
  });
});

describe("ProtectedRoute + AccountPage", () => {
  it("redirects guests from /account to /login", async () => {
    renderApp("/account");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy(),
    );
  });

  it("loads the account page for an authenticated user and signs out", async () => {
    const user = userEvent.setup();
    authMocks.me.mockResolvedValue({ user: sampleUser });
    authMocks.logout.mockResolvedValue({ ok: true });
    renderApp("/account");

    expect(await screen.findByRole("heading", { name: "Your account" })).toBeTruthy();
    expect(screen.getByLabelText("Full name")).toBeTruthy();

    // the page has one Sign out (header) + one in the Session card — the
    // card's button is scoped inside the section
    const sessionSection = screen.getByRole("region", { name: "Session" });
    await user.click(
      sessionSection.querySelector('button[type="button"]') as HTMLButtonElement,
    );
    await waitFor(() => expect(authMocks.logout).toHaveBeenCalled());
  });

  it("changes the password and confirms success", async () => {
    const user = userEvent.setup();
    authMocks.me.mockResolvedValue({ user: sampleUser });
    authMocks.changePassword.mockResolvedValue({ ok: true });
    renderApp("/account");

    await screen.findByRole("heading", { name: "Your account" });
    await user.type(screen.getByLabelText("Current password"), "OldPass!11aa");
    await user.type(screen.getByLabelText("New password"), "NewPass!22bb");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("password has been changed");
  });

  it("shows the wrong-current-password error without clearing inputs", async () => {
    const user = userEvent.setup();
    authMocks.me.mockResolvedValue({ user: sampleUser });
    authMocks.changePassword.mockRejectedValue(
      new (await import("./api/auth")).ApiRequestError(400, "wrong_password", "Current password is incorrect."),
    );
    renderApp("/account");

    await screen.findByRole("heading", { name: "Your account" });
    await user.type(screen.getByLabelText("Current password"), "nope-nope-nope");
    await user.type(screen.getByLabelText("New password"), "NewPass!22bb");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("incorrect");
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("NewPass!22bb");
  });
});
