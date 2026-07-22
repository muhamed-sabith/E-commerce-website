import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { env } from "../config/env.js";
import { ApiError } from "../middleware/error.js";
import {
  blockSchema,
  categoryCreateSchema,
  categoryDeleteQuery,
  categoryUpdateSchema,
  imageAltSchema,
  inventoryQuery,
  orderListQuery,
  orderStatusSchema,
  parseId,
  paymentStatusSchema,
  productCreateSchema,
  productListQuery,
  productUpdateSchema,
  stockAdjustmentSchema,
  unblockSchema,
  userListQuery,
} from "../services/admin.schemas.js";
import { adminCatalogService } from "../services/admin-catalog.service.js";
import type { createAdminOpsService } from "../services/admin-ops.service.js";
import { getSettings, settingsUpdateSchema, settingsView, updateSettings } from "../services/settings.service.js";
import { pageUpdateSchema, parseSlug, storePageService } from "../services/store-pages.service.js";

/**
 * Admin controllers (API_CONTRACT §4). HTTP only: parse with strict Zod →
 * service → respond. The actor is always the session admin (req.user, set
 * from the database by ensureSession); no body can name an actor, a role,
 * an id, a total, or an audit timestamp. Every response is private, no-store.
 */

type Ops = ReturnType<typeof createAdminOpsService>;

function actor(req: Request): bigint {
  if (!req.user || req.user.role !== "ADMIN") {
    throw new ApiError(403, "access_denied", "You do not have access to this resource.");
  }
  return req.user.id;
}

function handler(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return async (req, res, next: NextFunction) => {
    try {
      const body = await fn(req, res);
      res.set("Cache-Control", "private, no-store");
      if (!res.headersSent) res.json(body);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Multipart intake for images: memory only (nothing touches disk before
 * validation), one file, hard size cap. Field name `image`, optional `alt_text`.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 2, fieldSize: 1024, parts: 3 },
});

export const imageUpload: RequestHandler = (req, res, next) => {
  upload.single("image")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        const mb = Math.round(env.UPLOAD_MAX_BYTES / 100_000) / 10;
        return next(new ApiError(413, "file_too_large", `Images can be up to ${mb} MB.`));
      }
      return next(new ApiError(400, "validation_failed", "Upload one image in the “image” field.", [{ path: ["image"], message: "Upload one image" }]));
    }
    next(new ApiError(400, "validation_failed", "Couldn't read the upload."));
  });
};

export function adminControllers(ops: Ops) {
  return {
    dashboard: handler(async () => ops.dashboard()),

    // products
    listProducts: handler(async (req) => adminCatalogService.listProducts(productListQuery.parse(req.query))),
    getProduct: handler(async (req) => ({ product: await adminCatalogService.getProduct(parseId(req.params.id, "Product")) })),
    createProduct: handler(async (req, res) => {
      const product = await adminCatalogService.createProduct(actor(req), productCreateSchema.parse(req.body ?? {}));
      res.status(201);
      return { product };
    }),
    updateProduct: handler(async (req) => {
      const id = parseId(req.params.id, "Product");
      return { product: await adminCatalogService.updateProduct(actor(req), id, productUpdateSchema.parse(req.body ?? {})) };
    }),
    deleteProduct: handler(async (req) => adminCatalogService.deleteProduct(actor(req), parseId(req.params.id, "Product"))),

    // images
    uploadImage: handler(async (req, res) => {
      const id = parseId(req.params.id, "Product");
      const { alt_text } = imageAltSchema.parse(req.body ?? {});
      const product = await adminCatalogService.uploadImage(actor(req), id, req.file?.buffer, alt_text);
      res.status(201);
      return { product };
    }),
    deleteImage: handler(async (req) => ({ product: await adminCatalogService.deleteImage(actor(req), parseId(req.params.id, "Image")) })),
    makePrimary: handler(async (req) => ({ product: await adminCatalogService.makePrimary(actor(req), parseId(req.params.id, "Image")) })),

    // categories
    listCategories: handler(async () => adminCatalogService.listCategories()),
    createCategory: handler(async (req, res) => {
      const out = await adminCatalogService.createCategory(actor(req), categoryCreateSchema.parse(req.body ?? {}));
      res.status(201);
      return out;
    }),
    updateCategory: handler(async (req) =>
      adminCatalogService.updateCategory(actor(req), parseId(req.params.id, "Category"), categoryUpdateSchema.parse(req.body ?? {})),
    ),
    deleteCategory: handler(async (req) => {
      const { reassign_to } = categoryDeleteQuery.parse(req.query);
      return adminCatalogService.deleteCategory(
        actor(req),
        parseId(req.params.id, "Category"),
        reassign_to === undefined ? undefined : BigInt(reassign_to),
      );
    }),

    // inventory
    inventory: handler(async (req) => ops.inventory(inventoryQuery.parse(req.query))),
    adjustStock: handler(async (req, res) => {
      const out = await ops.adjustStock(actor(req), parseId(req.params.id, "Product"), stockAdjustmentSchema.parse(req.body ?? {}));
      res.status(201);
      return out;
    }),

    // orders
    listOrders: handler(async (req) => ops.listOrders(orderListQuery.parse(req.query))),
    orderDetail: handler(async (req) => ({ order: await ops.orderDetail(parseId(req.params.id, "Order")) })),
    changeStatus: handler(async (req) => ({
      order: await ops.changeStatus(actor(req), parseId(req.params.id, "Order"), orderStatusSchema.parse(req.body ?? {})),
    })),
    confirmPayment: handler(async (req) => ({
      order: await ops.confirmPayment(actor(req), parseId(req.params.id, "Order"), paymentStatusSchema.parse(req.body ?? {})),
    })),

    // users
    listUsers: handler(async (req) => ops.listUsers(userListQuery.parse(req.query))),
    blockUser: handler(async (req) => ops.blockUser(actor(req), parseId(req.params.id, "User"), blockSchema.parse(req.body ?? {}))),
    unblockUser: handler(async (req) => {
      unblockSchema.parse(req.body ?? {});
      return ops.unblockUser(actor(req), parseId(req.params.id, "User"));
    }),

    // settings
    getSettings: handler(async () => settingsView(await getSettings())),
    putSettings: handler(async (req) => settingsView(await updateSettings(actor(req), settingsUpdateSchema.parse(req.body ?? {})))),

    // policy + contact pages
    listPages: handler(async () => storePageService.list()),
    putPage: handler(async (req) => {
      const slug = parseSlug(req.params.slug);
      const { body } = pageUpdateSchema.parse(req.body ?? {});
      return { page: await storePageService.save(actor(req), slug, body) };
    }),
    deletePage: handler(async (req) => ({ page: await storePageService.unpublish(actor(req), parseSlug(req.params.slug)) })),
  };
}
