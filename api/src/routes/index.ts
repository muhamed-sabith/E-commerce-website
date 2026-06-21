import { Router } from "express";
import { catalogRouter } from "./catalog.routes.js";

/**
 * /api/v1 — the versioned business surface (docs/API_CONTRACT.md).
 * Routers mount here phase by phase: catalog (live), then cart, checkout,
 * orders, demo payment, admin. Nothing business-related ships before its phase.
 */
export const v1Router = Router();

v1Router.use(catalogRouter);

