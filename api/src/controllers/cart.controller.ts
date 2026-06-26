import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../middleware/error.js";
import { addToCartSchema, updateCartItemSchema } from "../services/cart.service.js";
import { cartOps } from "../services/cart.ops.js";

/**
 * Cart controllers (API_CONTRACT §3) — translate HTTP ↔ cartOps; no business
 * decisions here. Identity: authenticated user wins; otherwise the guest
 * session hash (sha256 of the session cookie, resolved by ensureSession).
 * Cart routes REQUIRE a resolvable session — guests whose cookie never
 * bootstrapped get the refresh-and-retry envelope.
 */

interface CartIdentity {
  userId: bigint | null;
  sessionHash: string | null;
}

function identityOf(req: Request): CartIdentity {
  if (req.user) {
    return { userId: req.user.id, sessionHash: req.session?.id ?? null };
  }
  return { userId: null, sessionHash: req.session?.id ?? null };
}

function requireIdentity(req: Request): CartIdentity {
  const identity = identityOf(req);
  if (identity.userId === null && identity.sessionHash === null) {
    throw new ApiError(
      401,
      "authentication_required",
      "Your session has expired. Please refresh the page.",
    );
  }
  return identity;
}

function parseLineId(raw: unknown): bigint {
  const s = typeof raw === "string" ? raw : "";
  if (!/^\d+$/.test(s)) {
    throw new ApiError(400, "validation_failed", "Invalid cart item id");
  }
  return BigInt(s);
}

/** Wraps a handler with the identity requirement; everything else flows to errorHandler. */
function withIdentity(
  fn: (req: Request, res: Response, identity: CartIdentity) => Promise<void>,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res, requireIdentity(req));
    } catch (err) {
      next(err);
    }
  };
}

export const getCart: RequestHandler = withIdentity(async (_req, res, identity) => {
  res.json(await cartOps.getCart(identity));
});

export const addCartItem: RequestHandler = withIdentity(async (req, res, identity) => {
  const input = addToCartSchema.parse(req.body);
  res.status(200).json(await cartOps.addItem(identity, BigInt(input.product_id), input.qty));
});

export const updateCartItem: RequestHandler = withIdentity(async (req, res, identity) => {
  const lineId = parseLineId(req.params.id);
  const input = updateCartItemSchema.parse(req.body);
  res.json(await cartOps.updateItem(identity, lineId, input.qty));
});

export const removeCartItem: RequestHandler = withIdentity(async (req, res, identity) => {
  const lineId = parseLineId(req.params.id);
  res.json(await cartOps.removeItem(identity, lineId));
});
