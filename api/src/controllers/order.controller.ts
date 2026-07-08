import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../middleware/error.js";
import { checkoutSchema, previewSchema, type createCheckoutService } from "../services/checkout.service.js";
import {
  demoPaymentSchema,
  listOrdersQuerySchema,
  parseOrderId,
  type createOrderService,
} from "../services/order.service.js";

/**
 * Checkout + order controllers (API_CONTRACT §3). HTTP only: parse →
 * service → respond. The owner is always the session user; bodies can name
 * an address or a demo method, never a price, a total, a status, or a user.
 */

type CheckoutService = ReturnType<typeof createCheckoutService>;
type OrderService = ReturnType<typeof createOrderService>;

function ownerId(req: Request): bigint {
  if (!req.user) throw new ApiError(401, "authentication_required", "Please sign in to continue.");
  return req.user.id;
}

function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

const noStore = (res: Response) => res.set("Cache-Control", "private, no-store");

export function checkoutControllers(checkout: CheckoutService, orders: OrderService) {
  return {
    preview: handler(async (req, res) => {
      const { address_id } = previewSchema.parse(req.body ?? {});
      noStore(res).json(await checkout.preview(ownerId(req), address_id));
    }),

    placeOrder: handler(async (req, res) => {
      const { address_id } = checkoutSchema.parse(req.body ?? {});
      noStore(res).status(201).json(await checkout.placeOrder(ownerId(req), address_id));
    }),

    listOrders: handler(async (req, res) => {
      const { page, page_size } = listOrdersQuerySchema.parse(req.query ?? {});
      noStore(res).json(await orders.list(ownerId(req), page, page_size));
    }),

    orderDetail: handler(async (req, res) => {
      noStore(res).json({ order: await orders.detail(ownerId(req), parseOrderId(req.params.id)) });
    }),

    demoConfirm: handler(async (req, res) => {
      const { method } = demoPaymentSchema.parse(req.body ?? {});
      const order = await orders.confirmDemoPayment(ownerId(req), parseOrderId(req.params.id), method);
      noStore(res).json({ order });
    }),

    demoFail: handler(async (req, res) => {
      const { method } = demoPaymentSchema.parse(req.body ?? {});
      const order = await orders.failDemoPayment(ownerId(req), parseOrderId(req.params.id), method);
      noStore(res).json({ order });
    }),
  };
}
