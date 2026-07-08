import { Router } from "express";
import { ensureSession, requireUser } from "../middleware/auth.js";
import { csrfProtect } from "../middleware/csrf.js";
import { checkoutControllers } from "../controllers/order.controller.js";
import { createCheckoutService } from "../services/checkout.service.js";
import { createOrderService } from "../services/order.service.js";
import type { PaymentService } from "../services/payment.service.js";

/**
 * Checkout + orders (API_CONTRACT §3). Authenticated USER only; CSRF on
 * every POST. The demo payment endpoints are mounted ONLY when the payment
 * service runs in demo mode — in manual mode they do not exist (404), so no
 * customer-reachable path to PAID exists at all.
 */
export function createOrderRouter(payments: PaymentService): Router {
  const router = Router();
  const c = checkoutControllers(createCheckoutService(payments), createOrderService(payments));
  const guarded = [ensureSession, requireUser];

  router.post("/checkout/preview", ...guarded, csrfProtect, c.preview);
  router.post("/checkout", ...guarded, csrfProtect, c.placeOrder);

  router.get("/orders", ...guarded, c.listOrders);
  router.get("/orders/:id", ...guarded, c.orderDetail);

  if (payments.mode === "demo") {
    router.post("/orders/:id/demo-payment/confirm", ...guarded, csrfProtect, c.demoConfirm);
    router.post("/orders/:id/demo-payment/fail", ...guarded, csrfProtect, c.demoFail);
  }

  return router;
}
