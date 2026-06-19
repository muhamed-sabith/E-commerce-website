import { env } from "./env.js";

/**
 * Session foundation (Phase 4): hardened cookie configuration only.
 *
 * The session middleware (express-session + a Postgres-backed store) and
 * the auth routes themselves are implemented in the authentication phase —
 * per REQUIREMENTS §11.4: httpOnly, Secure, SameSite, server-side state,
 * rotation at login, logout revocation.
 *
 * Everything below is the contract that implementation must satisfy.
 */
export const sessionCookieOptions = {
  /** JavaScript must never read the session cookie. */
  httpOnly: true,
  /** Sent over HTTPS only — in production. Local dev runs on http. */
  secure: env.NODE_ENV === "production",
  /** CSRF baseline: cookies never cross sites. */
  sameSite: "lax" as const,
  path: "/",
  maxAge: 1000 * 60 * 60 * 24 * 7, // one week absolute ceiling; idle expiry lands with the session store
};

export const SESSION_SECRET = env.SESSION_SECRET;
