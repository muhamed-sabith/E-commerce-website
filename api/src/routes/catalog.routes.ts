import { Router } from "express";
import { env } from "../config/env.js";
import { rateLimit } from "../middleware/rate-limit.js";
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

// Search/browse burst-cooling (REQUIREMENTS �12.7): generous for people,
// a ceiling for scrapers. Per IP, per minute.
const catalogLimiter = rateLimit({ windowMs: 60_000, max: env.CATALOG_RATE_LIMIT_MAX, name: "catalog-reads" });
catalogRouter.use(["/products", "/categories"], catalogLimiter);

catalogRouter.get("/products", listProducts);
catalogRouter.get("/products/:slug", getProduct);
catalogRouter.get("/categories", listCategories);
catalogRouter.get("/categories/:slug", getCategory);
