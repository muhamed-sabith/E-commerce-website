import type { NextFunction, Request, Response } from "express";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../config/session.js";
import { newCsrfToken, tokensEqual } from "../lib/session.js";

/**
 * Double-submit CSRF (API_CONTRACT §7, REQUIREMENTS §12.8): the token lives in
 * a JS-readable cookie AND must be echoed in the X-CSRF-Token header. A cross-
 * site attacker cannot read the cookie, so cannot echo it — SameSite=strict
 * already blocks the cookie from leaving; this is defense in depth.
 * Applied to state-changing methods only.
 */
export function csrfProtect(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    cookieToken.length === 0 ||
    !tokensEqual(cookieToken, headerToken)
  ) {
    res.status(403).json({
      error: { code: "csrf_failed", message: "Invalid or missing CSRF token." },
    });
    return;
  }

  next();
}

/** Issue or refresh the CSRF cookie; return the current token value. */
export function issueCsrfToken(req: Request, res: Response): string {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  const existing = cookies[CSRF_COOKIE_NAME];
  if (typeof existing === "string" && existing.length >= 32) {
    // Refresh the cookie so multi-cookie flows (bootstrap → register) always
    // carry a current token in Set-Cookie.
    res.cookie(CSRF_COOKIE_NAME, existing, csrfCookieOptions());
    return existing;
  }
  const token = newCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  return token;
}

function csrfCookieOptions() {
  return {
    httpOnly: false, // double-submit requires the SPA to read it
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  };
}
