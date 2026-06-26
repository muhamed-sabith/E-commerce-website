import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../config/session.js";
import { issueCsrfToken } from "../middleware/csrf.js";
import { hashToken, wasRotatedAway } from "../lib/session.js";
import { cartOps } from "../services/cart.ops.js";
import {
  registerSchema,
  loginSchema,
  passwordChangeSchema,
  profileUpdateSchema,
} from "../services/auth.schemas.js";
import { authService, type PublicUser } from "../services/auth.service.js";

/**
 * Auth controllers — translate HTTP ↔ service (API_CONTRACT §1). No business
 * decisions here. Session cookie is set on register/login (rotated), cleared
 * on logout. CSRF cookie is (re)issued on every auth response so the SPA can
 * echo it on mutations.
 */

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

function readSessionToken(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string | undefined> }).cookies;
  const token = cookies?.[SESSION_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : null;
}

function sendUser(
  res: Response,
  user: PublicUser,
  merge_report?: { merged: unknown[]; capped: unknown[]; dropped: unknown[] },
): void {
  res.json(merge_report ? { user, merge_report } : { user });
}

/** sha256 of the raw session cookie — the guest cart key (sessions.id). */
function hashForMerge(token: string): string {
  return hashToken(token);
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = registerSchema.parse(req.body);
    const user = await authService.register(input);

    // Rotate: any pre-existing (guest) session is consumed; the new session
    // belongs to the freshly created user (§11.4 rotation).
    const oldToken = readSessionToken(req);
    const token = await authService.rotateLoginSession(oldToken, BigInt(user.id));
    setSessionCookie(res, token);
    issueCsrfToken(req, res);

    // Guest cart merges into the user cart in one transaction (§3) — keyed
    // by the OLD session's hash, which rotateLoginSession just consumed.
    const merge_report =
      oldToken !== null
        ? await cartOps.mergeGuestCart(hashForMerge(oldToken), BigInt(user.id))
        : { merged: [], capped: [], dropped: [] };

    res.status(201).json({ user, merge_report });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);
    const user = await authService.login(input);

    const oldToken = readSessionToken(req);
    const token = await authService.rotateLoginSession(oldToken, BigInt(user.id));
    setSessionCookie(res, token);
    issueCsrfToken(req, res);

    const merge_report =
      oldToken !== null
        ? await cartOps.mergeGuestCart(hashForMerge(oldToken), BigInt(user.id))
        : { merged: [], capped: [], dropped: [] };

    sendUser(res, user, merge_report);
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readSessionToken(req);
    if (token) {
      await authService.endSession(token);
    }
    clearSessionCookie(res);
    issueCsrfToken(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Contract (API_CONTRACT §1): every visitor — including guests — is
    // issued a session. First contact answers user:null and mints the guest
    // session + CSRF cookie the SPA needs for future mutations. Stale-cookie
    // recovery lives in /auth/csrf only (see there).
    if (!req.session && !readSessionToken(req)) {
      const token = await authService.startSession(null);
      setSessionCookie(res, token);
    }
    issueCsrfToken(req, res);

    if (!req.user) {
      res.json({ user: null });
      return;
    }
    res.json({
      user: {
        id: req.user.id.toString(),
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/csrf — bootstrap endpoint: mints the guest session (if absent)
 * and the double-submit CSRF cookie. The SPA calls this once at load; tests
 * call it before mutating. Returns the token for convenience.
 */
export async function csrf(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // No live session → mint a guest one. A stale cookie (expired, revoked,
    // DB reset) is replaced too, otherwise the visitor is stuck and cart
    // calls 401 forever — EXCEPT a cookie a login just rotated away: that
    // client is receiving its new cookie now, and a replacement here would
    // race it and sign the user out.
    if (!req.session) {
      const stale = readSessionToken(req);
      if (stale === null || !(await wasRotatedAway(stale))) {
        const token = await authService.startSession(null);
        setSessionCookie(res, token);
      }
    }
    const token = issueCsrfToken(req, res);
    res.json({ csrfToken: token });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        error: { code: "authentication_required", message: "Please sign in to continue." },
      });
      return;
    }
    const input = passwordChangeSchema.parse(req.body);
    await authService.changePassword(req.user.id, input);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        error: { code: "authentication_required", message: "Please sign in to continue." },
      });
      return;
    }
    const input = profileUpdateSchema.parse(req.body);
    const user = await authService.updateProfile(req.user.id, input);
    sendUser(res, user);
  } catch (err) {
    next(err);
  }
}
