import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../middleware/error.js";
import {
  addressService,
  createAddressSchema,
  deleteAddressQuerySchema,
  parseAddressId,
  updateAddressSchema,
} from "../services/address.service.js";
import {
  addWishlistItemSchema,
  parseWishlistItemId,
  wishlistService,
} from "../services/wishlist.service.js";

/**
 * Wishlist + address controllers (API_CONTRACT §3, customer-only). HTTP
 * translation only: parse → service → respond. The owner is ALWAYS the
 * session user (requireUser ran first); no id in a body or query can name
 * another user.
 */

function ownerId(req: Request): bigint {
  if (!req.user) {
    // requireUser guards every route; this keeps the type honest.
    throw new ApiError(401, "authentication_required", "Please sign in to continue.");
  }
  return req.user.id;
}

function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

// Personal data: never cache in shared/proxy caches.
function noStore(res: Response): Response {
  return res.set("Cache-Control", "private, no-store");
}

// ---------- wishlist ----------

export const getWishlist = handler(async (req, res) => {
  noStore(res).json(await wishlistService.list(ownerId(req)));
});

export const addWishlistItem = handler(async (req, res) => {
  const input = addWishlistItemSchema.parse(req.body ?? {});
  noStore(res).json(await wishlistService.add(ownerId(req), BigInt(input.product_id)));
});

export const removeWishlistItem = handler(async (req, res) => {
  const productId = parseWishlistItemId(req.params.id);
  noStore(res).json(await wishlistService.remove(ownerId(req), productId));
});

// ---------- addresses ----------

export const listAddresses = handler(async (req, res) => {
  noStore(res).json(await addressService.list(ownerId(req)));
});

export const createAddress = handler(async (req, res) => {
  const input = createAddressSchema.parse(req.body ?? {});
  const address = await addressService.create(ownerId(req), input);
  noStore(res).status(201).json({ address });
});

export const updateAddress = handler(async (req, res) => {
  const id = parseAddressId(req.params.id);
  const input = updateAddressSchema.parse(req.body ?? {});
  const address = await addressService.update(ownerId(req), id, input);
  noStore(res).json({ address });
});

export const deleteAddress = handler(async (req, res) => {
  const id = parseAddressId(req.params.id);
  const { new_default_id } = deleteAddressQuerySchema.parse(req.query ?? {});
  noStore(res).json(await addressService.remove(ownerId(req), id, new_default_id));
});

export const setDefaultAddress = handler(async (req, res) => {
  const id = parseAddressId(req.params.id);
  noStore(res).json(await addressService.setDefault(ownerId(req), id));
});
