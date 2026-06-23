import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "./error.js";

/**
 * Request identity (REQUIREMENTS §11.4/§11.6):
 *   ensureSession  — resolve the cookie to req.session (may stay guest/null)
 *   requireUser    — authenticated + not blocked, else 401/403 envelope
 *   requireAdmin   — USER/ADMIN separation, server-side on every request
 * Role is never accepted from the client; it is read from the users row.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: {
        id: string;
        userId: bigint | null;
        expiresAt: Date;
      };
      user?: {
        id: bigint;
        name: string;
        email: string;
        role: "USER" | "ADMIN";
      };
    }
  }
}

export async function ensureSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    "heyrah_session"
  ] as string | undefined;

  if (token) {
    const { resolveSession } = await import("../lib/session.js");
    const session = await resolveSession(token);
    if (session) {
      req.session = {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
      };
      if (session.userId !== null) {
        const user = await prisma.user.findUnique({ where: { id: session.userId } });
        if (user && !user.isBlocked) {
          req.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role === "ADMIN" ? "ADMIN" : "USER",
          };
        }
      }
    }
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(
      new ApiError(
        401,
        "authentication_required",
        "Please sign in to continue.",
      ),
    );
    return;
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new ApiError(401, "authentication_required", "Please sign in to continue."));
    return;
  }
  if (req.user.role !== "ADMIN") {
    next(new ApiError(403, "access_denied", "You do not have access to this resource."));
    return;
  }
  next();
}
