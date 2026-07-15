import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env.js";
import { recordAdminAction } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";

/**
 * Store settings (REQUIREMENTS §3.11, API_CONTRACT §4). One row of
 * operational values; until an admin saves, the documented defaults apply
 * (low stock 5, shipping from the environment — ₹99 / free from ₹2,999 —,
 * newest first, 12 per page). Brand identity (HEYRAH, "Wings of Style",
 * logo, colors) and the currency (INR) are constants: read-only here and
 * rejected if a client tries to send them.
 */

export const SORT_KEYS = ["newest", "price_asc", "price_desc", "name_asc", "name_desc"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const BRAND = Object.freeze({ name: "HEYRAH", tagline: "Wings of Style" });
export const CURRENCY = "INR" as const;

export interface StoreSettings {
  lowStockThreshold: number;
  shippingFlatRate: Prisma.Decimal;
  shippingFreeThreshold: Prisma.Decimal;
  defaultSort: SortKey;
  pageSize: number;
}

function defaults(): StoreSettings {
  return {
    lowStockThreshold: 5,
    shippingFlatRate: new Prisma.Decimal(env.SHIPPING_FLAT_RATE),
    shippingFreeThreshold: new Prisma.Decimal(env.SHIPPING_FREE_THRESHOLD),
    defaultSort: "newest",
    pageSize: 12,
  };
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Current settings; one indexed single-row read per call (no stale cache). */
export async function getSettings(db: Db = prisma): Promise<StoreSettings & { updatedAt: Date | null }> {
  const row = await db.storeSettings.findUnique({ where: { id: 1 } });
  if (!row) return { ...defaults(), updatedAt: null };
  return {
    lowStockThreshold: row.lowStockThreshold,
    shippingFlatRate: row.shippingFlatRate,
    shippingFreeThreshold: row.shippingFreeThreshold,
    defaultSort: (SORT_KEYS as readonly string[]).includes(row.defaultSort) ? (row.defaultSort as SortKey) : "newest",
    pageSize: row.pageSize,
    updatedAt: row.updatedAt,
  };
}

const money = z
  .string({ invalid_type_error: "Enter an amount like 99.00" })
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter an amount like 99.00 (up to 2 decimals)");

/** Strict: brand, currency, or any unknown key is a 400, never silently ignored. */
export const settingsUpdateSchema = z
  .object({
    low_stock_threshold: z
      .number({ invalid_type_error: "Enter a whole number" })
      .int("Enter a whole number")
      .min(0, "Can't be negative")
      .max(1000, "Keep it at 1,000 or below"),
    shipping_flat_rate: money,
    shipping_free_threshold: money,
    default_sort: z.enum(SORT_KEYS, { errorMap: () => ({ message: "Choose a sort option" }) }),
    page_size: z
      .number({ invalid_type_error: "Enter a whole number" })
      .int("Enter a whole number")
      .min(4, "At least 4 per page")
      .max(48, "At most 48 per page"),
  })
  .strict();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export function settingsView(s: StoreSettings & { updatedAt: Date | null }) {
  return {
    settings: {
      lowStockThreshold: s.lowStockThreshold,
      shippingFlatRate: { amount: s.shippingFlatRate.toFixed(2) },
      shippingFreeThreshold: { amount: s.shippingFreeThreshold.toFixed(2) },
      defaultSort: s.defaultSort,
      pageSize: s.pageSize,
      updatedAt: s.updatedAt?.toISOString() ?? null,
      isDefault: s.updatedAt === null,
    },
    // Read-only context so the admin sees what is fixed and why.
    fixed: { brand: BRAND, currency: CURRENCY },
  };
}

export async function updateSettings(actorId: bigint, input: SettingsUpdate) {
  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    const data = {
      lowStockThreshold: input.low_stock_threshold,
      shippingFlatRate: new Prisma.Decimal(input.shipping_flat_rate),
      shippingFreeThreshold: new Prisma.Decimal(input.shipping_free_threshold),
      defaultSort: input.default_sort,
      pageSize: input.page_size,
      updatedBy: actorId,
    };
    await tx.storeSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await recordAdminAction(tx, {
      actorId,
      action: "settings.update",
      targetType: "settings",
      targetId: "1",
      details: {
        before: {
          low_stock_threshold: before.lowStockThreshold,
          shipping_flat_rate: before.shippingFlatRate.toFixed(2),
          shipping_free_threshold: before.shippingFreeThreshold.toFixed(2),
          default_sort: before.defaultSort,
          page_size: before.pageSize,
        },
        after: input,
      },
    });
    return getSettings(tx);
  });
}
