import type { CookieOptions } from "express";
import { env } from "./env.js";

/**
 * Session cookie contract (REQUIREMENTS §11.4, API_CONTRACT §7):
 * httpOnly (never readable by JS), secure in production, SameSite=strict
 * (cookies never cross sites — the CSRF baseline, backed by the double-submit
 * token for defense in depth), one-week ceiling matching the absolute TTL.
 */
export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  // Secure in production � enforced: production also refuses to boot with a
  // non-https origin (config/env.ts), so this can't silently be off.
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  // Browser lifetime matches the server-side absolute ceiling.
  maxAge: env.SESSION_ABSOLUTE_TTL_HOURS * 60 * 60 * 1000,
});

export const SESSION_COOKIE_NAME = "heyrah_session";
export const CSRF_COOKIE_NAME = "heyrah_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
