/**
 * Typed API client foundation. The base URL comes from the environment —
 * never hardcode endpoints in components (ARCHITECTURE §2).
 */
const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000";

interface HealthResponse {
  status: string;
  service: string;
  database: string;
  timestamp: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} on ${path}`);
  }
  return (await res.json()) as T;
}

export const apiClient = {
  getHealth: () => request<HealthResponse>("/healthz"),
};
