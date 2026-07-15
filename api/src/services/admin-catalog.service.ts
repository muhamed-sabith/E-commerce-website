import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { recordAdminAction } from "../lib/audit.js";
import { processProductImage, removeStoredImage, storeProductImage } from "../lib/images.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../middleware/error.js";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  productCreateSchema,
  productListQuery,
  productUpdateSchema,
  refineProductUpdate,
  slugify,
} from "./admin.schemas.js";
import { computeFinalPrice, type Money } from "./catalog.service.js";
import { getSettings } from "./settings.service.js";

/**
 * Admin catalog (REQUIREMENTS §3.3/§3.4/§4, API_CONTRACT §4): products,
 * product images, categories. Every mutation runs in one transaction with
 * its admin_audit_log row. Stock is never written here — it moves only
 * through audited stock adjustments (admin-inventory.service.ts).
 */

const money = (d: Prisma.Decimal): Money => ({ amount: d.toFixed(2) });

type Tx = Prisma.TransactionClient;

/** Field-level conflict in the validation_failed shape the admin form maps. */
function conflict(code: string, field: string, message: string): ApiError {
  return new ApiError(409, code, message, [{ path: [field], message }]);
}

function isUniqueViolation(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta?.target ?? []) as string[] | string;
  return Array.isArray(target) ? target.includes(field) : String(target).includes(field);
}

// =============================================================
// Products
// =============================================================

const productInclude = {
  category: { select: { id: true, name: true, slug: true, isActive: true } },
  images: { orderBy: { position: "asc" as const } },
  specifications: { orderBy: { id: "asc" as const } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function discountOf(p: { discountType: string; discountValue: Prisma.Decimal | null }) {
  if (p.discountType === "none" || p.discountValue === null) return { type: "none" as const };
  return { type: p.discountType as "percent" | "fixed", value: money(p.discountValue) };
}

function stockState(qty: number, threshold: number): "in_stock" | "low_stock" | "out_of_stock" {
  if (qty <= 0) return "out_of_stock";
  return qty <= threshold ? "low_stock" : "in_stock";
}

async function productView(p: ProductRow, globalThreshold: number, db: Tx | typeof prisma = prisma) {
  const [orderLines, adjustments] = await Promise.all([
    db.orderItem.count({ where: { productId: p.id } }),
    db.stockAdjustment.findMany({
      where: { productId: p.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
    }),
  ]);
  const threshold = p.lowStockThreshold ?? globalThreshold;
  return {
    id: p.id.toString(),
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    description: p.description,
    price: money(p.price),
    discount: discountOf(p),
    finalPrice: money(computeFinalPrice(p.price, p.discountType, p.discountValue).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
    category: { id: p.category.id.toString(), name: p.category.name, isActive: p.category.isActive },
    status: p.status,
    stockQuantity: p.stockQuantity,
    lowStockThreshold: p.lowStockThreshold,
    effectiveLowStockThreshold: threshold,
    stockState: stockState(p.stockQuantity, threshold),
    images: p.images.map((i) => ({
      id: i.id.toString(),
      src: `/assets/${i.filePath}`,
      alt: i.altText,
      position: i.position,
      isPrimary: i.position === p.images[0]?.position,
    })),
    specifications: p.specifications.map((s) => ({ key: s.specKey, value: s.specValue })),
    /** Deletion policy input: ordered or audited products are archived, never hard-deleted. */
    deletion: orderLines > 0 || adjustments.length > 0 ? ("archive" as const) : ("delete" as const),
    orderLineCount: orderLines,
    stockHistory: adjustments.map((a) => ({
      id: a.id.toString(),
      delta: a.delta,
      resultingQuantity: a.resultingQuantity,
      reason: a.reason,
      actorType: a.actorType,
      at: a.createdAt.toISOString(),
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function requireActiveCategory(db: Tx, raw: string): Promise<bigint> {
  const id = BigInt(raw);
  const c = await db.category.findUnique({ where: { id }, select: { isActive: true } });
  if (!c) throw new ApiError(400, "validation_failed", "Choose a category", [{ path: ["category_id"], message: "Choose a category" }]);
  if (!c.isActive) {
    throw new ApiError(400, "validation_failed", "Choose an active category", [
      { path: ["category_id"], message: "That category is inactive — choose an active one" },
    ]);
  }
  return id;
}

/** Explicit slug must be free; a derived slug gets -2, -3… until free. */
async function resolveSlug(db: Tx, explicit: string | undefined, name: string, exceptId?: bigint): Promise<string> {
  const taken = async (s: string) => {
    const hit = await db.product.findUnique({ where: { slug: s }, select: { id: true } });
    return hit !== null && hit.id !== exceptId;
  };
  if (explicit) {
    if (await taken(explicit)) throw conflict("slug_taken", "slug", "Another product already uses this slug");
    return explicit;
  }
  const base = slugify(name, 130) || "product";
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw conflict("slug_taken", "slug", "Choose a slug for this product");
}

async function requireSkuFree(db: Tx, sku: string, exceptId?: bigint) {
  const hit = await db.product.findUnique({ where: { sku }, select: { id: true } });
  if (hit && hit.id !== exceptId) throw conflict("sku_taken", "sku", "Another product already uses this SKU");
}

function mapUniqueErrors(err: unknown): never {
  if (isUniqueViolation(err, "sku")) throw conflict("sku_taken", "sku", "Another product already uses this SKU");
  if (isUniqueViolation(err, "slug")) throw conflict("slug_taken", "slug", "Another product already uses this slug");
  throw err;
}

const publishNeedsImage = () =>
  new ApiError(409, "image_required", "Add at least one image before setting this product to active.", [
    { path: ["status"], message: "Add at least one image before going active" },
  ]);

function discountColumns(d: z.infer<typeof productCreateSchema>["discount"]) {
  return d.type === "none"
    ? { discountType: "none", discountValue: null }
    : { discountType: d.type, discountValue: new Prisma.Decimal(d.value) };
}

export const adminCatalogService = {
  async listProducts(query: z.infer<typeof productListQuery>) {
    const settings = await getSettings();
    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.category_id ? { categoryId: BigInt(query.category_id) } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { sku: { startsWith: query.q.toUpperCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        include: { category: { select: { name: true } }, images: { orderBy: { position: "asc" }, take: 1 } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      prisma.product.count({ where }),
    ]);
    return {
      items: rows.map((p) => {
        const threshold = p.lowStockThreshold ?? settings.lowStockThreshold;
        return {
          id: p.id.toString(),
          name: p.name,
          sku: p.sku,
          slug: p.slug,
          categoryName: p.category.name,
          price: money(p.price),
          finalPrice: money(computeFinalPrice(p.price, p.discountType, p.discountValue).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
          status: p.status,
          stockQuantity: p.stockQuantity,
          stockState: stockState(p.stockQuantity, threshold),
          image: p.images[0] ? { src: `/assets/${p.images[0].filePath}`, alt: p.images[0].altText } : null,
          updatedAt: p.updatedAt.toISOString(),
        };
      }),
      page: query.page,
      page_size: query.page_size,
      total_items: total,
      total_pages: Math.ceil(total / query.page_size),
    };
  },

  async getProduct(id: bigint) {
    const p = await prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!p) throw new ApiError(404, "unknown_resource", "Product not found");
    return productView(p, (await getSettings()).lowStockThreshold);
  },

  async createProduct(actorId: bigint, input: z.infer<typeof productCreateSchema>) {
    // A new product has no images yet, so it can't start out active (§4: ≥ 1 image).
    if (input.status === "active") throw publishNeedsImage();
    try {
      const id = await prisma.$transaction(async (tx) => {
        const categoryId = await requireActiveCategory(tx, input.category_id);
        await requireSkuFree(tx, input.sku);
        const slug = await resolveSlug(tx, input.slug, input.name);
        const p = await tx.product.create({
          data: {
            name: input.name,
            slug,
            sku: input.sku,
            description: input.description,
            price: new Prisma.Decimal(input.price),
            ...discountColumns(input.discount),
            categoryId,
            status: input.status,
            stockQuantity: input.stock_quantity,
            lowStockThreshold: input.low_stock_threshold,
            specifications: { create: input.specifications.map((s) => ({ specKey: s.key, specValue: s.value })) },
          },
        });
        // Opening stock is an inventory event like any other.
        if (input.stock_quantity > 0) {
          await tx.stockAdjustment.create({
            data: {
              productId: p.id,
              delta: input.stock_quantity,
              resultingQuantity: input.stock_quantity,
              reason: "initial",
              actorType: "ADMIN",
              actorId,
            },
          });
        }
        await recordAdminAction(tx, {
          actorId,
          action: "product.create",
          targetType: "product",
          targetId: p.id,
          details: { sku: p.sku, name: p.name, price: input.price, status: input.status, stock: input.stock_quantity },
        });
        return p.id;
      });
      return this.getProduct(id);
    } catch (err) {
      mapUniqueErrors(err);
    }
  },

  async updateProduct(actorId: bigint, id: bigint, input: z.infer<typeof productUpdateSchema>) {
    try {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
        if (!rows[0]) throw new ApiError(404, "unknown_resource", "Product not found");
        const current = await tx.product.findUniqueOrThrow({ where: { id }, include: { images: { select: { id: true } } } });

        refineProductUpdate(input, current.price, { type: current.discountType, value: current.discountValue });

        if (input.status === "active" && current.images.length === 0) throw publishNeedsImage();

        const data: Prisma.ProductUncheckedUpdateInput = {};
        const changed: Record<string, unknown> = {};
        if (input.name !== undefined && input.name !== current.name) {
          data.name = input.name;
          changed.name = input.name;
        }
        if (input.slug !== undefined && input.slug !== current.slug) {
          data.slug = await resolveSlug(tx, input.slug, input.name ?? current.name, id);
          changed.slug = data.slug;
        }
        if (input.sku !== undefined && input.sku !== current.sku) {
          await requireSkuFree(tx, input.sku, id);
          data.sku = input.sku;
          changed.sku = input.sku;
        }
        if (input.description !== undefined && input.description !== current.description) {
          data.description = input.description;
          changed.description = true;
        }
        if (input.price !== undefined && !current.price.equals(input.price)) {
          data.price = new Prisma.Decimal(input.price);
          changed.price = { from: current.price.toFixed(2), to: input.price };
        }
        if (input.discount !== undefined) {
          const cols = discountColumns(input.discount);
          const same =
            cols.discountType === current.discountType &&
            ((cols.discountValue === null && current.discountValue === null) ||
              (cols.discountValue !== null && current.discountValue !== null && cols.discountValue.equals(current.discountValue)));
          if (!same) {
            Object.assign(data, cols);
            changed.discount = input.discount;
          }
        }
        if (input.category_id !== undefined && BigInt(input.category_id) !== current.categoryId) {
          data.categoryId = await requireActiveCategory(tx, input.category_id);
          changed.category_id = input.category_id;
        }
        if (input.status !== undefined && input.status !== current.status) {
          data.status = input.status;
          changed.status = { from: current.status, to: input.status };
        }
        if (input.low_stock_threshold !== undefined && input.low_stock_threshold !== current.lowStockThreshold) {
          data.lowStockThreshold = input.low_stock_threshold;
          changed.low_stock_threshold = input.low_stock_threshold;
        }
        if (input.specifications !== undefined) {
          await tx.productSpecification.deleteMany({ where: { productId: id } });
          await tx.productSpecification.createMany({
            data: input.specifications.map((s) => ({ productId: id, specKey: s.key, specValue: s.value })),
          });
          changed.specifications = input.specifications.length;
        }

        if (Object.keys(data).length > 0) await tx.product.update({ where: { id }, data });
        if (Object.keys(changed).length > 0) {
          await recordAdminAction(tx, {
            actorId,
            action: "product.update",
            targetType: "product",
            targetId: id,
            details: changed as Prisma.InputJsonValue,
          });
        }
      });
    } catch (err) {
      mapUniqueErrors(err);
    }
    return this.getProduct(id);
  },

  /**
   * Deletion policy (REQUIREMENTS §3.3): a product that appears in any
   * order — or has inventory history, which is append-only — is archived
   * (hidden everywhere, snapshots untouched). Only a never-ordered,
   * never-stocked product is hard-deleted.
   */
  async deleteProduct(actorId: bigint, id: bigint): Promise<{ result: "archived" | "deleted" }> {
    const outcome = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: bigint; status: string; sku: string }[]>`
        SELECT id, status, sku FROM products WHERE id = ${id} FOR UPDATE
      `;
      const p = rows[0];
      if (!p) throw new ApiError(404, "unknown_resource", "Product not found");
      const [ordered, audited] = await Promise.all([
        tx.orderItem.count({ where: { productId: id } }),
        tx.stockAdjustment.count({ where: { productId: id } }),
      ]);
      if (ordered > 0 || audited > 0) {
        if (p.status !== "archived") await tx.product.update({ where: { id }, data: { status: "archived" } });
        await recordAdminAction(tx, {
          actorId,
          action: "product.archive",
          targetType: "product",
          targetId: id,
          details: { sku: p.sku, from: p.status, ordered_lines: ordered },
        });
        return { result: "archived" as const, files: [] as string[] };
      }
      const images = await tx.productImage.findMany({ where: { productId: id }, select: { filePath: true } });
      await tx.product.delete({ where: { id } }); // images, specs, cart/wishlist lines cascade
      await recordAdminAction(tx, { actorId, action: "product.delete", targetType: "product", targetId: id, details: { sku: p.sku } });
      return { result: "deleted" as const, files: images.map((i) => i.filePath) };
    });
    await Promise.all(outcome.files.map(removeStoredImage));
    return { result: outcome.result };
  },

  // =============================================================
  // Images
  // =============================================================

  async uploadImage(actorId: bigint, productId: bigint, file: Buffer | undefined, altText: string | undefined) {
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
    if (!product) throw new ApiError(404, "unknown_resource", "Product not found");
    if (!file || file.length === 0) {
      throw new ApiError(400, "validation_failed", "Choose an image to upload", [{ path: ["image"], message: "Choose an image to upload" }]);
    }
    const processed = await processProductImage(file);
    const filePath = await storeProductImage(productId, processed.data);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
        const count = await tx.productImage.count({ where: { productId } });
        if (count >= 12) throw new ApiError(409, "too_many_images", "A product can have up to 12 images.");
        const last = await tx.productImage.aggregate({ where: { productId }, _max: { position: true } });
        const image = await tx.productImage.create({
          data: {
            productId,
            filePath,
            altText: altText ?? product.name,
            position: (last._max.position ?? -1) + 1,
          },
        });
        await recordAdminAction(tx, {
          actorId,
          action: "image.upload",
          targetType: "image",
          targetId: image.id,
          details: { product_id: productId.toString(), width: processed.width, height: processed.height, bytes: processed.data.length },
        });
      });
    } catch (err) {
      await removeStoredImage(filePath); // nothing references it
      throw err;
    }
    return this.getProduct(productId);
  },

  /** Remove one image; an active product must keep at least one. Positions re-pack from 0. */
  async deleteImage(actorId: bigint, imageId: bigint) {
    const result = await prisma.$transaction(async (tx) => {
      const image = await tx.productImage.findUnique({ where: { id: imageId } });
      if (!image) throw new ApiError(404, "unknown_resource", "Image not found");
      const rows = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM products WHERE id = ${image.productId} FOR UPDATE
      `;
      const count = await tx.productImage.count({ where: { productId: image.productId } });
      if (rows[0]?.status === "active" && count <= 1) {
        throw new ApiError(
          409,
          "last_image",
          "An active product needs at least one image. Upload another first, or set the product to inactive.",
        );
      }
      await tx.productImage.delete({ where: { id: imageId } });
      await repack(tx, image.productId);
      await recordAdminAction(tx, {
        actorId,
        action: "image.delete",
        targetType: "image",
        targetId: imageId,
        details: { product_id: image.productId.toString() },
      });
      return image;
    });
    await removeStoredImage(result.filePath);
    return this.getProduct(result.productId);
  },

  /** Make an image the primary (position 0); the others keep their order. */
  async makePrimary(actorId: bigint, imageId: bigint) {
    const productId = await prisma.$transaction(async (tx) => {
      const image = await tx.productImage.findUnique({ where: { id: imageId } });
      if (!image) throw new ApiError(404, "unknown_resource", "Image not found");
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${image.productId} FOR UPDATE`;
      await repack(tx, image.productId, imageId);
      await recordAdminAction(tx, {
        actorId,
        action: "image.primary",
        targetType: "image",
        targetId: imageId,
        details: { product_id: image.productId.toString() },
      });
      return image.productId;
    });
    return this.getProduct(productId);
  },

  // =============================================================
  // Categories
  // =============================================================

  async listCategories() {
    const rows = await prisma.$queryRaw<
      { id: bigint; name: string; slug: string; isActive: boolean; sortOrder: number; total: bigint; active: bigint; updatedAt: Date }[]
    >`
      SELECT c.id, c.name, c.slug, c.is_active AS "isActive", c.sort_order AS "sortOrder", c.updated_at AS "updatedAt",
             COUNT(p.id) AS total,
             COUNT(p.id) FILTER (WHERE p.status = 'active') AS active
      FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC
    `;
    return {
      items: rows.map((c) => ({
        id: c.id.toString(),
        name: c.name,
        slug: c.slug,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        productCount: Number(c.total),
        activeProductCount: Number(c.active),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  },

  async createCategory(actorId: bigint, input: z.infer<typeof categoryCreateSchema>) {
    const slug = input.slug ?? slugify(input.name, 90);
    if (!slug) throw conflict("slug_taken", "slug", "Choose a slug for this category");
    try {
      await prisma.$transaction(async (tx) => {
        if (await tx.category.findUnique({ where: { slug } })) {
          throw conflict("slug_taken", "slug", "Another category already uses this slug");
        }
        const c = await tx.category.create({
          data: { name: input.name, slug, isActive: input.is_active, sortOrder: input.sort_order },
        });
        await recordAdminAction(tx, { actorId, action: "category.create", targetType: "category", targetId: c.id, details: { name: c.name, slug } });
      });
    } catch (err) {
      if (isUniqueViolation(err, "slug")) throw conflict("slug_taken", "slug", "Another category already uses this slug");
      throw err;
    }
    return this.listCategories();
  },

  async updateCategory(actorId: bigint, id: bigint, input: z.infer<typeof categoryUpdateSchema>) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.category.findUnique({ where: { id } });
        if (!current) throw new ApiError(404, "unknown_resource", "Category not found");
        if (input.slug !== undefined && input.slug !== current.slug) {
          const hit = await tx.category.findUnique({ where: { slug: input.slug } });
          if (hit) throw conflict("slug_taken", "slug", "Another category already uses this slug");
        }
        const data = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
          ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
        };
        await tx.category.update({ where: { id }, data });
        await recordAdminAction(tx, { actorId, action: "category.update", targetType: "category", targetId: id, details: input });
      });
    } catch (err) {
      if (isUniqueViolation(err, "slug")) throw conflict("slug_taken", "slug", "Another category already uses this slug");
      throw err;
    }
    return this.listCategories();
  },

  /**
   * Delete is blocked while any product (archived ones included — the FK is
   * RESTRICT) is assigned. With `reassign_to`, every product moves to that
   * active category first, in the same transaction, then the category goes.
   */
  async deleteCategory(actorId: bigint, id: bigint, reassignTo: bigint | undefined) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.category.findUnique({ where: { id } });
      if (!current) throw new ApiError(404, "unknown_resource", "Category not found");
      const assigned = await tx.product.count({ where: { categoryId: id } });
      if (assigned > 0) {
        if (reassignTo === undefined) {
          throw new ApiError(
            409,
            "category_in_use",
            `${assigned} ${assigned === 1 ? "product is" : "products are"} still in this category. Move them to another category first.`,
            { product_count: assigned },
          );
        }
        if (reassignTo === id) {
          throw new ApiError(400, "validation_failed", "Choose a different category", [{ path: ["reassign_to"], message: "Choose a different category" }]);
        }
        const target = await tx.category.findUnique({ where: { id: reassignTo } });
        if (!target) throw new ApiError(404, "unknown_resource", "Target category not found");
        if (!target.isActive) {
          throw new ApiError(400, "validation_failed", "Move products to an active category", [
            { path: ["reassign_to"], message: "Choose an active category" },
          ]);
        }
        const moved = await tx.product.updateMany({ where: { categoryId: id }, data: { categoryId: reassignTo } });
        await recordAdminAction(tx, {
          actorId,
          action: "category.reassign",
          targetType: "category",
          targetId: id,
          details: { to: reassignTo.toString(), products: moved.count },
        });
      }
      await tx.category.delete({ where: { id } });
      await recordAdminAction(tx, { actorId, action: "category.delete", targetType: "category", targetId: id, details: { slug: current.slug } });
    });
    return this.listCategories();
  },
};

/**
 * Re-number a product's images 0..n-1 (optionally moving `firstId` to 0).
 * Two passes so the UNIQUE(product_id, position) index never sees a clash.
 */
async function repack(tx: Tx, productId: bigint, firstId?: bigint) {
  const images = await tx.productImage.findMany({ where: { productId }, orderBy: { position: "asc" }, select: { id: true } });
  const ordered = firstId === undefined ? images : [...images.filter((i) => i.id === firstId), ...images.filter((i) => i.id !== firstId)];
  for (const [n, img] of ordered.entries()) {
    await tx.productImage.update({ where: { id: img.id }, data: { position: -1 - n } });
  }
  for (const [n, img] of ordered.entries()) {
    await tx.productImage.update({ where: { id: img.id }, data: { position: n } });
  }
}
