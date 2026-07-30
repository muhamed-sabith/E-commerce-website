import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyPage } from "./PolicyPage";

/** Policy pages render business text verbatim, or an honest unpublished state. */

const reply = (page: object) => ({ ok: true, json: async () => ({ page }) }) as Response;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("PolicyPage", () => {
  it("shows the not-published state and noindex", async () => {
    vi.mocked(fetch).mockResolvedValue(reply({ slug: "terms", title: "Terms of service", published: false, body: null, updatedAt: null }));
    render(<MemoryRouter><PolicyPage slug="terms" /></MemoryRouter>);
    expect((await screen.findByTestId("policy-pending")).textContent).toContain("hasn't been published yet");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Terms of service");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("renders published text as escaped paragraphs with a canonical", async () => {
    const body = "First <b>paragraph</b>.\n\nSecond line one\nline two.";
    vi.mocked(fetch).mockResolvedValue(reply({ slug: "returns", title: "Returns & refunds", published: true, body, updatedAt: "2026-10-01T10:00:00Z" }));
    render(<MemoryRouter><PolicyPage slug="returns" /></MemoryRouter>);
    const article = await screen.findByTestId("policy-body");
    const paras = article.querySelectorAll("p.help__para");
    expect(paras).toHaveLength(2);
    expect(paras[0].textContent).toBe("First <b>paragraph</b>.");
    expect(article.querySelector("b")).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(/\/returns$/);
    expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/v1\/pages\/returns$/);
  });

  it("shows an error state when the page can't load", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<MemoryRouter><PolicyPage slug="privacy" /></MemoryRouter>);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("This page couldn't load");
  });
});
