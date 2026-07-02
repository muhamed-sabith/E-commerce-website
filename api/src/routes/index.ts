import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { cartRouter } from "./cart.routes.js";
import { catalogRouter } from "./catalog.routes.js";
import { customerRouter } from "./customer.routes.js";

/**
 * /api/v1 — the versioned business surface (docs/API_CONTRACT.md).
 * Routers mount here phase by phase: catalog + auth/account + cart +
 * wishlist/addresses (live), then checkout, orders, demo payment, admin.
 * Nothing business-related ships before its phase.
 */
export const v1Router = Router();

v1Router.use(authRouter);
v1Router.use(cartRouter);
v1Router.use(customerRouter);
v1Router.use(catalogRouter);

