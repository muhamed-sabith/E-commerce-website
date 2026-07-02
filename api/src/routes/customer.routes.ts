import { Router } from "express";
import { ensureSession, requireUser } from "../middleware/auth.js";
import { csrfProtect } from "../middleware/csrf.js";
import {
  addWishlistItem,
  createAddress,
  deleteAddress,
  getWishlist,
  listAddresses,
  removeWishlistItem,
  setDefaultAddress,
  updateAddress,
} from "../controllers/customer.controller.js";

/**
 * Customer-only resources (API_CONTRACT §3): wishlist + address book.
 * Order per route: identity → authenticated USER (401 envelope for guests)
 * → CSRF on mutations → controller. Authorization is server-side on every
 * request; ownership is enforced inside every query.
 */
export const customerRouter = Router();

const guarded = [ensureSession, requireUser];

customerRouter.get("/wishlist", ...guarded, getWishlist);
customerRouter.post("/wishlist/items", ...guarded, csrfProtect, addWishlistItem);
customerRouter.delete("/wishlist/items/:id", ...guarded, csrfProtect, removeWishlistItem);

customerRouter.get("/addresses", ...guarded, listAddresses);
customerRouter.post("/addresses", ...guarded, csrfProtect, createAddress);
customerRouter.patch("/addresses/:id", ...guarded, csrfProtect, updateAddress);
customerRouter.delete("/addresses/:id", ...guarded, csrfProtect, deleteAddress);
customerRouter.post("/addresses/:id/default", ...guarded, csrfProtect, setDefaultAddress);
