import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

describe("scaffold smoke", () => {
  it("renders the HEYRAH brand", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "HEYRAH" })).toBeTruthy();
  });
});
