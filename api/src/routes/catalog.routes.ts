import { Router } from "express";
import {
  getCategory,
  getProduct,
  listCategories,
  listProducts,
} from "../controllers/catalog.controller.js";

/**
 * Public catalog surface (API_CONTRACT §2). No auth — every visitor role
 * can browse; the server still decides what is visible (active only).
 */
export const catalogRouter = Router();

catalogRouter.get("/products", listProducts);
catalogRouter.get("/products/:slug", getProduct);
catalogRouter.get("/categories", listCategories);
catalogRouter.get("/categories/:slug", getCategory);
