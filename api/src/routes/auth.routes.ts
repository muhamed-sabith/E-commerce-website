import { Router } from "express";
import { env } from "../config/env.js";
import { ensureSession, requireUser } from "../middleware/auth.js";
import { csrfProtect } from "../middleware/csrf.js";
import { rateLimit, resetRateLimiter } from "../middleware/rate-limit.js";
import {
  changePassword,
  csrf,
  login,
  logout,
  me,
  register,
  updateProfile,
} from "../controllers/auth.controller.js";

/**
 * Auth + account surface (API_CONTRACT §1). Rate-limited credential
 * endpoints (default 10/min/IP, tunable via RATE_LIMIT_MAX/WINDOW_MS);
 * every mutation rides the CSRF double-submit check; /account/* requires
 * an authenticated, unblocked user (server-side).
 */
export const authRouter = Router();

export { resetRateLimiter };

const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  name: "auth-credentials",
});

// Identity resolution runs before every auth route so register/login can
// rotate the existing (guest) session and /me can answer guests with null.
authRouter.use(ensureSession);

// Identity, session, and CSRF responses are per-visitor: never stored by
// browsers' shared caches or any proxy.
authRouter.use(["/auth", "/account"], (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

authRouter.post("/auth/register", authLimiter, csrfProtect, register);
authRouter.post("/auth/login", authLimiter, csrfProtect, login);
authRouter.post("/auth/logout", csrfProtect, logout);
authRouter.get("/auth/me", me);
authRouter.get("/auth/csrf", csrf);

authRouter.patch("/account/password", requireUser, csrfProtect, changePassword);
authRouter.patch("/account/profile", requireUser, csrfProtect, updateProfile);
