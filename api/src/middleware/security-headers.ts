import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/**
 * Baseline security headers for every API response (REQUIREMENTS §12.7–12.8).
 * The API only ever returns JSON, XML, text, or images, so its CSP denies
 * everything; the HTML document's own CSP is set by the web server.
 * Static product images keep their stricter, route-specific headers.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (!req.path.startsWith("/assets/")) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  }
  if (env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}
