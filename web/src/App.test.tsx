import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

// Catalog API is network-backed; jsdom tests assert shell rendering only.
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

describe("App shell", () => {
  it("renders the HEYRAH brand header", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "HEYRAH home" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search products" })).toBeTruthy();
  });
});
