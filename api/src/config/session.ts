import type { CookieOptions } from "express";

/**
 * Session cookie contract (REQUIREMENTS §11.4, API_CONTRACT §7):
 * httpOnly (never readable by JS), secure in production, SameSite=strict
 * (cookies never cross sites — the CSRF baseline, backed by the double-submit
 * token for defense in depth), one-week ceiling matching the absolute TTL.
 */
export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

export const SESSION_COOKIE_NAME = "heyrah_session";
export const CSRF_COOKIE_NAME = "heyrah_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
