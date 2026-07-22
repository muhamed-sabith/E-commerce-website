import { Router } from "express";
import { adminControllers, imageUpload } from "../controllers/admin.controller.js";
import { ensureSession, requireAdmin } from "../middleware/auth.js";
import { csrfProtect } from "../middleware/csrf.js";
import { createAdminOpsService } from "../services/admin-ops.service.js";
import type { PaymentService } from "../services/payment.service.js";

/**
 * /api/v1/admin/* (API_CONTRACT §4). One gate for the whole tree, applied
 * before any route matches: identity from the session row → ADMIN role read
 * from the users table (guest 401, USER 403) → CSRF double-submit on every
 * state-changing method. Nothing under /admin is reachable without all three.
 */
export function createAdminRouter(payments: PaymentService): Router {
  const router = Router();
  const c = adminControllers(createAdminOpsService(payments));

  router.use(ensureSession, requireAdmin, csrfProtect);

  router.get("/dashboard", c.dashboard);

  router.get("/products", c.listProducts);
  router.post("/products", c.createProduct);
  router.get("/products/:id", c.getProduct);
  router.patch("/products/:id", c.updateProduct);
  router.delete("/products/:id", c.deleteProduct);
  router.post("/products/:id/images", imageUpload, c.uploadImage);
  router.post("/products/:id/stock-adjustments", c.adjustStock);

  router.delete("/images/:id", c.deleteImage);
  router.post("/images/:id/primary", c.makePrimary);

  router.get("/categories", c.listCategories);
  router.post("/categories", c.createCategory);
  router.patch("/categories/:id", c.updateCategory);
  router.delete("/categories/:id", c.deleteCategory);

  router.get("/inventory", c.inventory);

  router.get("/orders", c.listOrders);
  router.get("/orders/:id", c.orderDetail);
  router.post("/orders/:id/status", c.changeStatus);
  router.post("/orders/:id/payment-status", c.confirmPayment);

  router.get("/users", c.listUsers);
  router.post("/users/:id/block", c.blockUser);
  router.post("/users/:id/unblock", c.unblockUser);

  router.get("/settings", c.getSettings);
  router.put("/settings", c.putSettings);

  router.get("/pages", c.listPages);
  router.put("/pages/:slug", c.putPage);
  router.delete("/pages/:slug", c.deletePage);

  return router;
}
