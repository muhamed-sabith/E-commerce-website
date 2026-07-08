import { Router } from "express";
import { paymentService, type PaymentService } from "../services/payment.service.js";
import { authRouter } from "./auth.routes.js";
import { cartRouter } from "./cart.routes.js";
import { catalogRouter } from "./catalog.routes.js";
import { customerRouter } from "./customer.routes.js";
import { createOrderRouter } from "./order.routes.js";

/**
 * /api/v1 — the versioned business surface (docs/API_CONTRACT.md).
 * Live: catalog, auth/account, cart, wishlist/addresses, checkout, orders,
 * demo payment (demo mode only).
 */
export function createV1Router(payments: PaymentService = paymentService): Router {
  const v1 = Router();
  v1.use(authRouter);
  v1.use(cartRouter);
  v1.use(customerRouter);
  v1.use(createOrderRouter(payments));
  v1.use(catalogRouter);
  return v1;
}
