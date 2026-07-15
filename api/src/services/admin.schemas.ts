import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../middleware/error.js";
import { SORT_KEYS } from "./settings.service.js";

/**
 * Admin request schemas (REQUIREMENTS §3–§4, §12.1). Every schema is
 * `.strict()`: unknown keys — ids, audit timestamps, stock_quantity on an
 * update, roles, totals — are a 400, never silently written (no mass
 * assignment). The database CHECKs remain the final word.
 */

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label} is required` : `${label} needs at least ${min} characters`)
        .max(max, `${label} can be at most ${max} characters`)
        // eslint-disable-next-line no-control-regex
        .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), `${label} contains invalid characters`),
    );

const slug = (max: number) =>
  z
    .string({ invalid_type_error: "Slug must be text" })
    .trim()
    .toLowerCase()
    .max(max, `Slug can be at most ${max} characters`)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens");

export const slugify = (s: string, max: number) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");

export const money = (label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be an amount like 1499.00` })
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, `${label} must be an amount like 1499.00 (up to 2 decimals)`);

export const idParam = z
  .string()
  .regex(/^\d{1,18}$/)
  .transform((v) => BigInt(v));

/** Path ids: anything malformed is a 404, exactly like an unknown id. */
export function parseId(raw: unknown, what = "Resource"): bigint {
  const r = idParam.safeParse(raw);
  if (!r.success) throw new ApiError(404, "unknown_resource", `${what} not found`);
  return r.data;
}

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(48).default(24),
};

const searchText = z
  .string()
  .max(120)
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .optional()
  .transform((s) => (s ? s : null));

// ---------- products ----------

export const PRODUCT_STATUSES = ["active", "inactive", "archived"] as const;

const discountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("percent"), value: money("Discount") }).strict(),
  z.object({ type: z.literal("fixed"), value: money("Discount") }).strict(),
]);

const specsSchema = z
  .array(
    z
      .object({ key: trimmed(1, 60, "Specification name"), value: trimmed(1, 255, "Specification value") })
      .strict(),
  )
  .max(30, "Up to 30 specifications")
  .superRefine((specs, ctx) => {
    const seen = new Set<string>();
    specs.forEach((s, i) => {
      const k = s.key.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: [i, "key"], message: `"${s.key}" is listed twice` });
      seen.add(k);
    });
  });

const lowStockThreshold = z
  .number({ invalid_type_error: "Enter a whole number" })
  .int("Enter a whole number")
  .min(0, "Can't be negative")
  .max(1000, "Keep it at 1,000 or below")
  .nullable();

const productFields = {
  name: trimmed(2, 120, "Name"),
  slug: slug(140).optional(),
  sku: z
    .string({ required_error: "SKU is required", invalid_type_error: "SKU must be text" })
    .trim()
    .toUpperCase()
    .regex(/^HEY-[A-Z]{3}-\d{5}$/, "Use the HEYRAH pattern HEY-ABC-12345"),
  description: z
    .string({ required_error: "Description is required" })
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "Description is required").max(5000, "Description can be at most 5,000 characters")),
  price: money("Price"),
  discount: discountSchema.default({ type: "none" }),
  category_id: z
    .string({ required_error: "Choose a category", invalid_type_error: "Choose a category" })
    .regex(/^\d{1,18}$/, "Choose a category"),
  status: z.enum(PRODUCT_STATUSES, { errorMap: () => ({ message: "Choose a status" }) }),
  low_stock_threshold: lowStockThreshold.default(null),
  specifications: specsSchema.default([]),
};

/** Price/discount coherence (mirrors products_discount_coherence_check). */
function checkPricing(
  v: { price?: string; discount?: z.infer<typeof discountSchema> },
  ctx: z.RefinementCtx,
  currentPrice?: Prisma.Decimal,
) {
  // Field-level format errors are already reported; only compare well-formed amounts.
  const ok = (s: unknown): s is string => typeof s === "string" && /^\d{1,8}(\.\d{1,2})?$/.test(s.trim());
  if (v.price !== undefined && !ok(v.price)) return;
  if (v.discount && v.discount.type !== "none" && !ok(v.discount.value)) return;
  const price = v.price !== undefined ? new Prisma.Decimal(v.price) : currentPrice;
  if (v.price !== undefined && price && price.lessThanOrEqualTo(0)) {
    ctx.addIssue({ code: "custom", path: ["price"], message: "Price must be greater than 0" });
  }
  const d = v.discount;
  if (!d || d.type === "none") return;
  const value = new Prisma.Decimal(d.value);
  if (value.lessThanOrEqualTo(0)) {
    ctx.addIssue({ code: "custom", path: ["discount", "value"], message: "Discount must be greater than 0" });
  } else if (d.type === "percent" && value.greaterThanOrEqualTo(100)) {
    ctx.addIssue({ code: "custom", path: ["discount", "value"], message: "A percent discount must be below 100" });
  } else if (d.type === "fixed" && price && value.greaterThanOrEqualTo(price)) {
    ctx.addIssue({ code: "custom", path: ["discount", "value"], message: "A fixed discount must be less than the price" });
  }
}

export const productCreateSchema = z
  .object({
    ...productFields,
    status: productFields.status.default("inactive"),
    stock_quantity: z
      .number({ invalid_type_error: "Enter a whole number" })
      .int("Enter a whole number")
      .min(0, "Stock can't be negative")
      .max(100_000, "Keep opening stock at 100,000 or below")
      .default(0),
  })
  .strict()
  .superRefine((v, ctx) => checkPricing(v, ctx));

/** Partial; stock is NOT here — it only moves through audited adjustments. */
export const productUpdateSchema = z
  .object({
    name: productFields.name.optional(),
    slug: productFields.slug,
    sku: productFields.sku.optional(),
    description: productFields.description.optional(),
    price: productFields.price.optional(),
    discount: discountSchema.optional(),
    category_id: productFields.category_id.optional(),
    status: productFields.status.optional(),
    low_stock_threshold: lowStockThreshold.optional(),
    specifications: specsSchema.optional(),
  })
  .strict();

export function refineProductUpdate(v: z.infer<typeof productUpdateSchema>, currentPrice: Prisma.Decimal, currentDiscount: { type: string; value: Prisma.Decimal | null }) {
  // Re-check coherence against the stored values for whichever side wasn't sent.
  const discount =
    v.discount ??
    (currentDiscount.type === "none" || currentDiscount.value === null
      ? ({ type: "none" } as const)
      : ({ type: currentDiscount.type as "percent" | "fixed", value: currentDiscount.value.toFixed(2) } as const));
  const r = z
    .unknown()
    .superRefine((_, ctx) => checkPricing({ price: v.price, discount }, ctx, currentPrice))
    .safeParse(null);
  if (!r.success) throw r.error;
}

export const productListQuery = z
  .object({
    q: searchText,
    status: z.enum(PRODUCT_STATUSES).optional(),
    category_id: z.string().regex(/^\d{1,18}$/).optional(),
    ...pageQuery,
  })
  .strict();

// ---------- categories ----------

export const categoryCreateSchema = z
  .object({
    name: trimmed(2, 80, "Name"),
    slug: slug(90).optional(),
    is_active: z.boolean().default(true),
    sort_order: z.number().int("Enter a whole number").min(0, "Can't be negative").max(9999).default(0),
  })
  .strict();

export const categoryUpdateSchema = z
  .object({
    name: trimmed(2, 80, "Name").optional(),
    slug: slug(90).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int("Enter a whole number").min(0, "Can't be negative").max(9999).optional(),
  })
  .strict();

export const categoryDeleteQuery = z
  .object({ reassign_to: z.string().regex(/^\d{1,18}$/).optional() })
  .strict();

// ---------- images ----------

export const imageAltSchema = z.object({ alt_text: trimmed(1, 200, "Alt text").optional() }).strict();

// ---------- inventory ----------

export const inventoryQuery = z
  .object({ filter: z.enum(["all", "low", "out"]).default("all"), q: searchText, ...pageQuery })
  .strict();

export const ADJUSTMENT_REASONS = ["restock", "correction", "damaged", "admin_set"] as const;

/**
 * `delta` for restock (+), damaged (−), correction (±); `quantity` (the new
 * absolute count) for admin_set. The server computes the delta for admin_set.
 */
export const stockAdjustmentSchema = z
  .discriminatedUnion("reason", [
    z.object({ reason: z.literal("restock"), delta: z.number().int().min(1, "Restock adds at least 1").max(100_000) }).strict(),
    z.object({ reason: z.literal("damaged"), delta: z.number().int().max(-1, "Damaged stock removes at least 1").min(-100_000) }).strict(),
    z
      .object({
        reason: z.literal("correction"),
        delta: z
          .number()
          .int()
          .min(-100_000)
          .max(100_000)
          .refine((d) => d !== 0, "A correction must change the count"),
      })
      .strict(),
    z.object({ reason: z.literal("admin_set"), quantity: z.number().int().min(0, "Stock can't be negative").max(1_000_000) }).strict(),
  ]);

// ---------- orders ----------

export const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"] as const;

export const orderListQuery = z
  .object({
    q: searchText,
    status: z.enum(ORDER_STATUSES).optional(),
    payment: z.enum(["PENDING_PAYMENT", "PAID"]).optional(),
    ...pageQuery,
  })
  .strict();

const note = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(200, "Keep the note under 200 characters"))
  .optional()
  .transform((s) => (s ? s : undefined));

export const orderStatusSchema = z
  .object({ status: z.enum(["confirmed", "shipped", "delivered", "cancelled"]), note })
  .strict();

/** Manual confirmation accepts exactly one value. */
export const paymentStatusSchema = z.object({ status: z.literal("PAID"), note }).strict();

// ---------- users ----------

export const userListQuery = z
  .object({ q: searchText, status: z.enum(["active", "blocked"]).optional(), ...pageQuery })
  .strict();

export const blockSchema = z.object({ reason: trimmed(3, 255, "Reason") }).strict();
export const unblockSchema = z.object({}).strict();

export { SORT_KEYS };
