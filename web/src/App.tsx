import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { apiClient } from "./api/client";

type HealthState = "checking" | "up" | "down";

/**
 * Phase 4 scaffold smoke screen: proves React + Vite + Router render,
 * and that the env-var-driven API client reaches the Express backend.
 * The real storefront replaces this in the next phase.
 */
export function App() {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getHealth()
      .then((h) => {
        if (!cancelled) setHealth(h.database === "up" ? "up" : "down");
      })
      .catch(() => {
        if (!cancelled) setHealth("down");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Routes>
      <Route
        path="/"
        element={
          <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
            <h1>HEYRAH</h1>
            <p>Scaffold verification page — storefront arrives in the next phase.</p>
            <p data-testid="api-status">
              api health: <strong>{health}</strong>
            </p>
          </main>
        }
      />
    </Routes>
  );
}
