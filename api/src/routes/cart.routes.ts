import { Router } from "express";
import { ensureSession } from "../middleware/auth.js";
import { csrfProtect } from "../middleware/csrf.js";
import {
  addCartItem,
  getCart,
  removeCartItem,
  updateCartItem,
} from "../controllers/cart.controller.js";

/**
 * Cart surface (API_CONTRACT §3) — identical for guests and users; only the
 * storage differs server-side. Every mutation rides CSRF; reads recompute
 * the whole cart from current catalog state.
 */
export const cartRouter = Router();

cartRouter.use(ensureSession);

cartRouter.get("/cart", getCart);
cartRouter.post("/cart/items", csrfProtect, addCartItem);
cartRouter.patch("/cart/items/:id", csrfProtect, updateCartItem);
cartRouter.delete("/cart/items/:id", csrfProtect, removeCartItem);
