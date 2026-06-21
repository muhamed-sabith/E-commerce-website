import type { Request, Response } from "express";
import { catalogQuerySchema, createCatalogService } from "../services/catalog.service.js";
import { catalogRepository } from "../repositories/catalog.repository.js";

/** Controllers translate HTTP ↔ service; no business decisions live here. */
const catalogService = createCatalogService(catalogRepository);

function parseQuery(req: Request) {
  return catalogQuerySchema.parse(req.query);
}

/**
 * GET /api/v1/products — list + search + filter + sort + pagination.
 * Validation errors fall through the shared ZodError handler (400).
 */
export async function listProducts(req: Request, res: Response): Promise<void> {
  const query = parseQuery(req);
  const result = await catalogService.listProducts(query);
  res.json(result);
}

/** GET /api/v1/products/{slug} — detail or 404 unknown_resource. */
export async function getProduct(req: Request, res: Response): Promise<void> {
  const slug = typeof req.params.slug === "string" ? req.params.slug : "";
  const product = await catalogService.getProductBySlug(slug);
  res.json(product);
}

/** GET /api/v1/categories — active categories for nav. */
export async function listCategories(_req: Request, res: Response): Promise<void> {
  const categories = await catalogService.listCategories(false);
  res.json({ items: categories });
}

/** GET /api/v1/categories/{slug} — category landing metadata. */
export async function getCategory(req: Request, res: Response): Promise<void> {
  const slug = typeof req.params.slug === "string" ? req.params.slug : "";
  const category = await catalogService.getCategoryBySlug(slug);
  res.json(category);
}
