/**
 * Typed API client foundation. The base URL comes from the environment —
 * never hardcode endpoints in components (ARCHITECTURE §2).
 *
 * Cookie-session based: every call sends credentials; mutations echo the
 * JS-readable CSRF cookie in X-CSRF-Token (double-submit). The web app never
 * sees or stores the session cookie value.
 */
// An empty VITE_API_URL means same-origin (production: the web server proxies /api).
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

interface HealthResponse {
  status: string;
  service: string;
  database: string;
  timestamp: string;
}

/** Error envelope surfaced to the UI (API_CONTRACT §6). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Field-level issues on validation_failed (API_CONTRACT §6). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** The CSRF cookie is JS-readable by design (double-submit). */
function readCsrfCookie(): string {
  const match = document.cookie.match(/(?:^|;\s*)heyrah_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const mutating = method !== "GET";
  // Multipart (image upload): the browser sets the boundary header itself.
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;

  // A mutation can fire before the load-time bootstrap has set the CSRF
  // cookie (fast submit on first paint). Bootstrap first rather than send
  // an empty token.
  if (mutating && !readCsrfCookie()) {
    await ensureCsrf();
  }

  const send = () => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined && !isForm) {
      headers["Content-Type"] = "application/json";
    }
    if (mutating) {
      headers["X-CSRF-Token"] = readCsrfCookie();
    }
    return fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body:
        options.body === undefined
          ? undefined
          : isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body),
    });
  };

  let res = await send();

  // One re-bootstrap + retry if the token was stale (e.g. cookie rotated
  // by a concurrent bootstrap). Never loops.
  if (mutating && res.status === 403) {
    const peek = (await res.clone().json().catch(() => null)) as
      | { error?: { code?: string } }
      | null;
    if (peek?.error?.code === "csrf_failed") {
      await ensureCsrf();
      res = await send();
    }
  }

  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { code: string; message: string; details?: unknown } })
    | null;

  if (!res.ok) {
    const code = data?.error?.code ?? "internal_error";
    const message = data?.error?.message ?? "Something went wrong. Please try again.";
    throw new ApiRequestError(res.status, code, message, data?.error?.details);
  }
  return data as T;
}

/** Bootstrap: mint guest session + CSRF token before first mutation. */
export async function ensureCsrf(): Promise<void> {
  // Read the (tiny) body to completion: the response is `no-store`, so an
  // unread body would keep the request — and its connection — open.
  await fetch(`${API_BASE_URL}/api/v1/auth/csrf`, { credentials: "include" })
    .then((r) => r.text())
    .catch(() => undefined);
}

export const apiClient = {
  getHealth: () => apiRequest<HealthResponse>("/healthz"),
};
