/**
 * Typed auth + account API surface (API_CONTRACT §1). Cookie-session based:
 * every call sends credentials; the session + CSRF cookies are managed by
 * the API. Mutations echo the CSRF token in X-CSRF-Token (double-submit).
 * The web app never sees or stores the session cookie value.
 */

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** The CSRF cookie is JS-readable by design (double-submit). */
function readCsrfCookie(): string {
  const match = document.cookie.match(/(?:^|;\s*)heyrah_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const method = options.method ?? "GET";
  if (method !== "GET") {
    headers["X-CSRF-Token"] = readCsrfCookie();
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { code: string; message: string } })
    | null;

  if (!res.ok) {
    const code = data?.error?.code ?? "internal_error";
    const message = data?.error?.message ?? "Something went wrong. Please try again.";
    // Validation errors carry per-field details — surface them verbatim.
    throw new ApiRequestError(res.status, code, message);
  }
  return data as T;
}

/** Bootstrap: mint guest session + CSRF token before first mutation. */
export async function ensureCsrf(): Promise<void> {
  await fetch(`${baseUrl}/api/v1/auth/csrf`, { credentials: "include" }).catch(() => undefined);
}

export const authApi = {
  register(input: { name: string; email: string; password: string }): Promise<{ user: PublicUser }> {
    return apiRequest("/api/v1/auth/register", { method: "POST", body: input });
  },
  login(input: { email: string; password: string }): Promise<{ user: PublicUser }> {
    return apiRequest("/api/v1/auth/login", { method: "POST", body: input });
  },
  logout(): Promise<{ ok: boolean }> {
    return apiRequest("/api/v1/auth/logout", { method: "POST" });
  },
  me(): Promise<{ user: PublicUser | null }> {
    return apiRequest("/api/v1/auth/me");
  },
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ ok: boolean }> {
    return apiRequest("/api/v1/account/password", { method: "PATCH", body: input });
  },
  updateProfile(input: { name: string }): Promise<{ user: PublicUser }> {
    return apiRequest("/api/v1/account/profile", { method: "PATCH", body: input });
  },
};
